import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZaloPayHttpClient, zaloPayClientFromEnv } from '../../../src/payout/zalopay/client.ts';
import {
  BASE_URLS,
  DEFAULT_TIMEOUTS,
  ENDPOINTS,
  SUB_RETURN_CODES,
  ZaloPayError,
  ZaloPayTransportError,
  type TransferFundResult,
  type ZaloPayConfig,
  type ZaloPayWarning,
  type ZlpStatus,
} from '../../../src/payout/zalopay/types.ts';
import { FakeZaloPay, startFakeZaloPay } from './fake-server.ts';
import { OFFICIAL, TEST_RSA } from './fixtures.ts';

/**
 * The client against the fake server (§2.2 seam). Everything on 127.0.0.1,
 * no credentials, no database: these run in the `env -u DATABASE_URL`
 * configuration.
 *
 * The chaos budget is short here (2 s) so the suite runs in seconds; the
 * production budgets are asserted as constants below. What the mapping does
 * is independent of how long it waited.
 */

let fake: FakeZaloPay;
let warnings: ZaloPayWarning[];

const config = (overrides: Partial<ZaloPayConfig> = {}): ZaloPayConfig => ({
  ...fake.clientConfig(),
  timeouts: { transferFundMs: 2_000, otherMs: 2_000 },
  warn: (e) => warnings.push(e),
  ...overrides,
});
const client = (overrides: Partial<ZaloPayConfig> = {}) => new ZaloPayHttpClient(config(overrides));

const WALLET = { method: 'WALLET', mUId: 'MU-0901234567' } as const;
const BANK = { method: 'BANK_ACCOUNT', bankCode: 'VCB', accountNo: '0011002233445', accountHolderName: 'NGUYEN VAN A' } as const;
const CARD = { method: 'BANK_CARD', bankCode: 'TCB', cardNo: '9704000000000001', cardHolderName: 'TRAN THI B' } as const;

let n = 0;
const po = () => `PO-${String(++n).padStart(4, '0')}`;
const transfer = (c: ZaloPayHttpClient, partnerOrderId = po(), receiver: typeof WALLET | typeof BANK | typeof CARD = WALLET) =>
  c.transferFund({ partnerOrderId, receiver, amountVnd: 150_000, description: 'Player One payout' });

beforeAll(async () => {
  fake = await startFakeZaloPay();
});
afterAll(async () => {
  await fake.close();
});
beforeEach(() => {
  warnings = [];
  fake.received.length = 0;
  for (const q of Object.values(fake.queue)) q.length = 0;
  fake.strictMac = true;
});

// ---------------------------------------------------------------------------

describe('construction', () => {
  it('wires HMAC only; the legacy HMAC+RSA scheme is built but refused until the contract is known', () => {
    expect(() => client({ signing: 'hmac' })).not.toThrow();
    expect(() => client({ signing: 'hmac-rsa', rsaPrivateKeyPkcs8Pem: TEST_RSA.privateKeyPkcs8Pem })).toThrow(
      /not wired.*escalation/,
    );
  });

  it('fails closed on a missing key1, public key or payment id', () => {
    expect(() => client({ key1: '' })).toThrow(/key1/);
    expect(() => client({ zaloPayPublicKeyPem: '' })).toThrow(/zaloPayPublicKeyPem/);
    expect(() => client({ paymentId: '' })).toThrow(/paymentId/);
  });

  it('takes its base URL from the environment name, or from an explicit override', async () => {
    const urls: string[] = [];
    const capture: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ return_code: 1, data: { balance: 1 } }));
    };
    await new ZaloPayHttpClient({ ...config(), baseUrl: undefined, env: 'sandbox', fetch: capture }).balance();
    await new ZaloPayHttpClient({ ...config(), baseUrl: undefined, env: 'production', fetch: capture }).balance();
    await new ZaloPayHttpClient({ ...config(), baseUrl: 'http://proxy.local/', fetch: capture }).balance();
    expect(urls).toEqual([
      `${BASE_URLS.sandbox}${ENDPOINTS.balance}`,
      `${BASE_URLS.production}${ENDPOINTS.balance}`,
      `http://proxy.local${ENDPOINTS.balance}`,
    ]);
    expect(BASE_URLS.sandbox).toBe('https://sb-openapi.zalopay.vn');
    expect(BASE_URLS.production).toBe('https://openapi.zalopay.vn');
  });

  it('budgets 20 s for transfer-fund and 10 s for everything else', () => {
    // Measured once against a hanging fake with the defaults: transfer-fund
    // answered {kind:'unknown', cause:'timeout'} at 20 029 ms with exactly one
    // request sent; balance threw at 10 014 ms. The suite uses 2 s: 300 ms timed out a plain request under 31 parallel files.
    expect(DEFAULT_TIMEOUTS).toEqual({ transferFundMs: 20_000, otherMs: 10_000 });
  });

  it('loads under Node’s strip-only type stripping, which is how bin/ runs .ts', () => {
    // vitest transforms with esbuild and would hide, say, a constructor
    // parameter property — which node --strip-types refuses. A worker in bin/
    // importing this client must not be the first thing to find out.
    const entry = pathToFileURL(fileURLToPath(new URL('../../../src/payout/zalopay/client.ts', import.meta.url))).href;
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `const m = await import(${JSON.stringify(entry)}); console.log(typeof m.ZaloPayHttpClient)`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out.trim()).toBe('function');
  });
});

describe('zaloPayClientFromEnv', () => {
  const complete = {
    PLAYERONE_ZALOPAY_APP_ID: '2553',
    PLAYERONE_ZALOPAY_PAYMENT_ID: 'PM-001',
    PLAYERONE_ZALOPAY_KEY1: 'k1',
    PLAYERONE_ZALOPAY_PUBLIC_KEY: TEST_RSA.publicKeySpkiPem,
  };

  it('answers null with nothing set in sandbox (no contract, manual payout)', () => {
    expect(zaloPayClientFromEnv({})).toBeNull();
    expect(zaloPayClientFromEnv({ PLAYERONE_ZALOPAY_ENV: 'sandbox' })).toBeNull();
  });

  it('fails closed on a partial configuration, naming what is missing', () => {
    expect(() => zaloPayClientFromEnv({ PLAYERONE_ZALOPAY_APP_ID: '2553' })).toThrow(
      /PLAYERONE_ZALOPAY_PAYMENT_ID, PLAYERONE_ZALOPAY_KEY1, PLAYERONE_ZALOPAY_PUBLIC_KEY are not set/,
    );
  });

  it('§2.4: production without all of app_id, payment_id, key1 and the RSA public key throws', () => {
    expect(() => zaloPayClientFromEnv({ PLAYERONE_ZALOPAY_ENV: 'production' })).toThrow(/production/);
    const { PLAYERONE_ZALOPAY_PUBLIC_KEY: _drop, ...noKey } = complete;
    expect(() => zaloPayClientFromEnv({ PLAYERONE_ZALOPAY_ENV: 'production', ...noKey })).toThrow(
      /PLAYERONE_ZALOPAY_PUBLIC_KEY is not set/,
    );
    expect(zaloPayClientFromEnv({ PLAYERONE_ZALOPAY_ENV: 'production', ...complete })).toBeInstanceOf(ZaloPayHttpClient);
  });

  it('rejects an environment name it does not know, and a non-integer app id', () => {
    expect(() => zaloPayClientFromEnv({ PLAYERONE_ZALOPAY_ENV: 'staging', ...complete })).toThrow(/sandbox or production/);
    expect(() => zaloPayClientFromEnv({ ...complete, PLAYERONE_ZALOPAY_APP_ID: 'abc' })).toThrow(/integer/);
  });

  it('restores a PEM whose newlines an .env file flattened to \\n', async () => {
    const flattened = TEST_RSA.publicKeySpkiPem.replaceAll('\n', '\\n');
    const c = zaloPayClientFromEnv({ ...complete, PLAYERONE_ZALOPAY_PUBLIC_KEY: flattened });
    expect(c).not.toBeNull();
    // A broken PEM would throw inside publicEncrypt on first use.
    const capture: typeof fetch = async () => new Response(JSON.stringify({ return_code: 1, data: { m_u_id: 'MU' } }));
    const usable = new ZaloPayHttpClient({ ...config(), zaloPayPublicKeyPem: flattened.replaceAll('\\n', '\n'), fetch: capture });
    await expect(usable.verifyAccount({ receiver: { method: 'WALLET', phone: '0901234567' }, amountVnd: 1 })).resolves.toMatchObject({ kind: 'verified' });
  });

  it('refuses to construct the unwired signing scheme from the environment too', () => {
    expect(() => zaloPayClientFromEnv({ ...complete, PLAYERONE_ZALOPAY_SIGNING: 'hmac-rsa' })).toThrow(/not wired/);
    expect(() => zaloPayClientFromEnv({ ...complete, PLAYERONE_ZALOPAY_SIGNING: 'rsa' })).toThrow(/hmac or hmac-rsa/);
  });
});

// ---------------------------------------------------------------------------

describe('verify-account', () => {
  it('wallet route: sends the phone, gets the m_u_id the transfer will need — and NO name (official shape, F-35)', async () => {
    const r = await client().verifyAccount({ receiver: { method: 'WALLET', phone: '0901234567' }, amountVnd: 1 });
    expect(r).toEqual({ kind: 'verified', verifiedName: null, mUId: 'MU-0901234567' });
    const [req] = fake.requests('verifyAccount');
    expect(req?.macValid).toBe(true);
    expect(req?.receiver).toEqual({ phone: '0901234567' });
    expect(req?.body['disbursement_type']).toBe('WALLET');
    expect(req?.body['amount']).toBe(1);
  });

  it('bank routes: the holder name goes in, the verified name comes back by route, no m_u_id; a card is BANK on the wire (F-34)', async () => {
    fake.plan('verifyAccount', { kind: 'ok', name: 'NGUYEN VAN B' });
    const r = await client().verifyAccount({ receiver: BANK, amountVnd: 2_000 });
    expect(r).toEqual({ kind: 'verified', verifiedName: 'NGUYEN VAN B', mUId: null });
    expect(fake.requests('verifyAccount')[0]?.receiver).toEqual({
      bank_code: 'VCB',
      account_no: '0011002233445',
      account_holder_name: 'NGUYEN VAN A',
    });
    expect(fake.requests('verifyAccount')[0]?.body['disbursement_type']).toBe('BANK');

    const r2 = await client().verifyAccount({ receiver: CARD, amountVnd: 2_000 });
    expect(r2).toEqual({ kind: 'verified', verifiedName: 'TRAN THI B', mUId: null });
    expect(fake.requests('verifyAccount')[1]?.receiver).toEqual({
      bank_code: 'TCB',
      card_no: '9704000000000001',
      card_holder_name: 'TRAN THI B',
    });
    expect(fake.requests('verifyAccount')[1]?.body['disbursement_type']).toBe('BANK');
    expect(fake.requests('verifyAccount').every((q) => q.macValid)).toBe(true);
  });

  it('-101 no wallet: rejected, carrying the onboarding page for the collector', async () => {
    fake.plan('verifyAccount', { kind: 'sub', subCode: -101, extra: { onboarding_url: 'https://zalopay.vn/onboard/abc' } });
    const r = await client().verifyAccount({ receiver: { method: 'WALLET', phone: '0900000000' }, amountVnd: 1 });
    expect(r).toEqual({ kind: 'rejected', subCode: -101, retryable: false, onboardingUrl: 'https://zalopay.vn/onboard/abc' });
  });

  it('-406 KYC limit: rejected, carrying the reform page', async () => {
    fake.plan('verifyAccount', { kind: 'sub', subCode: -406, extra: { reform_url: 'https://zalopay.vn/reform/abc' } });
    const r = await client().verifyAccount({ receiver: { method: 'WALLET', phone: '0900000000' }, amountVnd: 1 });
    expect(r).toEqual({ kind: 'rejected', subCode: -406, retryable: false, reformUrl: 'https://zalopay.vn/reform/abc' });
  });

  it('-1104 wrong name, -1103 unverified, -1011 locked: rejected with the code for B to map and C to flag', async () => {
    for (const code of [-1104, -1103, -1011]) {
      fake.plan('verifyAccount', { kind: 'sub', subCode: code });
      const r = await client().verifyAccount({ receiver: BANK, amountVnd: 2_000 });
      expect(r).toEqual({ kind: 'rejected', subCode: code, retryable: false });
    }
  });

  it('-503 maintenance: system, retryable', async () => {
    fake.plan('verifyAccount', { kind: 'sub', subCode: -503 });
    const r = await client().verifyAccount({ receiver: BANK, amountVnd: 2_000 });
    expect(r).toEqual({ kind: 'system', subCode: -503, retryable: true });
  });

  it('transport failures THROW here (a read may simply be asked again), with the cause named', async () => {
    const c = client();
    const input = { receiver: BANK, amountVnd: 2_000 } as const;
    fake.plan('verifyAccount', { kind: 'hang', ms: 10_000 });
    await expect(c.verifyAccount(input)).rejects.toMatchObject({ name: 'ZaloPayTransportError', cause: 'timeout' });
    fake.plan('verifyAccount', { kind: 'reset' });
    await expect(c.verifyAccount(input)).rejects.toMatchObject({ name: 'ZaloPayTransportError', cause: 'network' });
    fake.plan('verifyAccount', { kind: 'truncated' });
    await expect(c.verifyAccount(input)).rejects.toMatchObject({ name: 'ZaloPayTransportError', cause: 'malformed' });
    fake.plan('verifyAccount', { kind: 'http', status: 502, body: '<html>bad gateway</html>' });
    await expect(c.verifyAccount(input)).rejects.toMatchObject({ name: 'ZaloPayTransportError', cause: 'malformed' });
    fake.plan('verifyAccount', { kind: 'ok', name: '' });
    await expect(c.verifyAccount(input)).rejects.toBeInstanceOf(ZaloPayTransportError);
  });
});

// ---------------------------------------------------------------------------

describe('transfer-fund', () => {
  it('accepted: ZaloPay answers PROCESSING (3) with an order id, and the order is now known to it', async () => {
    const id = po();
    const r = await transfer(client(), id);
    expect(r).toMatchObject({ kind: 'accepted', status: 3 });
    expect((r as Extract<TransferFundResult, { kind: 'accepted' }>).zlpOrderId).toBe(fake.orders.get(id)?.orderId);
    const [req] = fake.requests('transferFund');
    expect(req?.macValid).toBe(true);
    expect(req?.receiver).toEqual({ m_u_id: 'MU-0901234567' });
    expect(req?.body['payment_id']).toBe(fake.paymentId);
    expect(req?.body['partner_order_id']).toBe(id);
    expect(req?.body['amount']).toBe(150_000);
  });

  it('all four statuses come through as accepted with the status, including the PENDING trap (4)', async () => {
    for (const status of [1, 2, 3, 4] as ZlpStatus[]) {
      fake.plan('transferFund', { kind: 'ok', status });
      expect(await transfer(client())).toMatchObject({ kind: 'accepted', status });
    }
  });

  it('bank account and card routes: the wire disbursement_type and receiver follow the method', async () => {
    await transfer(client(), po(), BANK);
    await transfer(client(), po(), CARD);
    const [a, b] = fake.requests('transferFund');
    expect(a?.body['disbursement_type']).toBe('BANK');
    expect(a?.receiver).toEqual({ bank_code: 'VCB', account_no: '0011002233445', account_holder_name: 'NGUYEN VAN A' });
    // F-34: a card is `BANK` on the wire; only the encrypted payload says card.
    expect(b?.body['disbursement_type']).toBe('BANK');
    expect(b?.receiver).toEqual({ bank_code: 'TCB', card_no: '9704000000000001', card_holder_name: 'TRAN THI B' });
    expect(b?.macValid).toBe(true);
  });

  it('partner_embed_data and extra_info default to "{}" — not "", not omitted — and "" is corrected to "{}"', async () => {
    const c = client();
    await transfer(c);
    await c.transferFund({ partnerOrderId: po(), receiver: WALLET, amountVnd: 1, description: 'x', partnerEmbedData: '', extraInfo: '' });
    await c.transferFund({ partnerOrderId: po(), receiver: WALLET, amountVnd: 1, description: 'x', partnerEmbedData: '{"bill":"b"}' });
    const bodies = fake.requests('transferFund').map((r) => r.body);
    expect(bodies[0]).toMatchObject({ partner_embed_data: '{}', extra_info: '{}' });
    expect(bodies[1]).toMatchObject({ partner_embed_data: '{}', extra_info: '{}' });
    expect(bodies[2]).toMatchObject({ partner_embed_data: '{"bill":"b"}', extra_info: '{}' });
    expect(fake.requests('transferFund').every((r) => r.macValid)).toBe(true);
  });

  it('-68 is {kind:"duplicate"}, not an error: the fake raises it by itself on a repeated partner_order_id (F3)', async () => {
    const id = po();
    const c = client();
    expect(await transfer(c, id)).toMatchObject({ kind: 'accepted' });
    expect(await transfer(c, id)).toEqual({ kind: 'duplicate' });
    expect(fake.orders.size).toBeGreaterThan(0);
    // And when scripted explicitly, same answer.
    fake.plan('transferFund', { kind: 'sub', subCode: -68 });
    expect(await transfer(c)).toEqual({ kind: 'duplicate' });
  });

  it('every sub code in the §0.5 table maps to exactly one result kind', async () => {
    const c = client();
    const seen = new Map<number, TransferFundResult['kind']>();
    for (const [code, entry] of SUB_RETURN_CODES) {
      fake.plan('transferFund', { kind: 'sub', subCode: code });
      const r = await transfer(c);
      seen.set(code, r.kind);
      const expected = entry.class === 'idempotent' ? 'duplicate' : entry.class === 'system' ? 'system' : 'rejected';
      expect(r.kind, `sub code ${code} ${entry.constant}`).toBe(expected);
      if (r.kind === 'rejected') expect(r).toEqual({ kind: 'rejected', subCode: code, retryable: false });
      if (r.kind === 'system') expect(r).toEqual({ kind: 'system', subCode: code, retryable: true });
    }
    expect(seen.size).toBe(SUB_RETURN_CODES.size);
    expect(seen.size).toBe(17);
    expect([...seen.values()].filter((k) => k === 'duplicate')).toHaveLength(1);
    expect([...seen.values()].filter((k) => k === 'system')).toHaveLength(3); // -107, -500, -503
    expect([...seen.values()].filter((k) => k === 'rejected')).toHaveLength(13);
    expect(warnings).toHaveLength(0);
  });

  it('a sub code NOT in the table is system/retryable and is logged loudly — without a key or a receiver in the log', async () => {
    fake.plan('transferFund', { kind: 'sub', subCode: -9999, message: 'SOMETHING_NEW' });
    const id = po();
    const r = await transfer(client(), id);
    expect(r).toEqual({ kind: 'system', subCode: -9999, retryable: true });
    expect(warnings).toEqual([
      {
        event: 'unknown_sub_return_code',
        endpoint: 'transferFund',
        returnCode: 2,
        subReturnCode: -9999,
        subReturnMessage: 'SOMETHING_NEW',
        partnerOrderId: id,
      },
    ]);
    const logged = JSON.stringify(warnings);
    expect(logged).not.toContain(fake.key1);
    expect(logged).not.toContain('0901234567');
  });

  it('the default warn writes to console.warn (so it is loud when nobody injected one)', async () => {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
    try {
      fake.plan('transferFund', { kind: 'sub', subCode: -4242 });
      await transfer(new ZaloPayHttpClient({ ...config(), warn: undefined }));
    } finally {
      console.warn = original;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/unknown_sub_return_code.*sub_return_code=-4242/);
    expect(lines[0]).not.toContain(fake.key1);
  });

  describe('chaos: a lost answer is {kind:"unknown"}, never a failure and never a throw', () => {
    it('hang past the budget → unknown/timeout, and exactly ONE request was sent', async () => {
      fake.plan('transferFund', { kind: 'hang', ms: 10_000 });
      const r = await transfer(client());
      expect(r).toEqual({ kind: 'unknown', cause: 'timeout' });
      expect(fake.requests('transferFund')).toHaveLength(1);
    });

    it('connection reset mid-body → unknown/network', async () => {
      fake.plan('transferFund', { kind: 'reset' });
      expect(await transfer(client())).toEqual({ kind: 'unknown', cause: 'network' });
      expect(fake.requests('transferFund')).toHaveLength(1);
    });

    it('200 with a truncated JSON body → unknown/malformed', async () => {
      fake.plan('transferFund', { kind: 'truncated' });
      expect(await transfer(client())).toEqual({ kind: 'unknown', cause: 'malformed' });
    });

    it('a gateway answering instead of ZaloPay (502 html) → unknown/malformed', async () => {
      fake.plan('transferFund', { kind: 'http', status: 502, body: '<html>bad gateway</html>' });
      expect(await transfer(client())).toEqual({ kind: 'unknown', cause: 'malformed' });
    });

    it('nothing listening at all → unknown/network', async () => {
      const r = await transfer(client({ baseUrl: 'http://127.0.0.1:9' }));
      expect(r).toEqual({ kind: 'unknown', cause: 'network' });
    });

    it('200 with return_code 2 → the documented kind for its sub code, not unknown', async () => {
      fake.plan('transferFund', { kind: 'sub', subCode: -107 });
      expect(await transfer(client())).toEqual({ kind: 'system', subCode: -107, retryable: true });
    });

    it('an answer we cannot act on — accepted without an order id, or failed without a sub code — is unknown/malformed', async () => {
      const fetchFn = (body: object): typeof fetch => async () => new Response(JSON.stringify(body));
      expect(await transfer(client({ fetch: fetchFn({ return_code: 1, data: {} }) }))).toEqual({ kind: 'unknown', cause: 'malformed' });
      expect(await transfer(client({ fetch: fetchFn({ return_code: 1, data: { order_id: 'x', status: 9 } }) }))).toEqual({ kind: 'unknown', cause: 'malformed' });
      expect(await transfer(client({ fetch: fetchFn({ return_code: 2 }) }))).toEqual({ kind: 'unknown', cause: 'malformed' });
      expect(await transfer(client({ fetch: fetchFn({ return_code: 7 }) }))).toEqual({ kind: 'unknown', cause: 'malformed' });
      expect(await transfer(client({ fetch: fetchFn([]) }))).toEqual({ kind: 'unknown', cause: 'malformed' });
    });
  });

  it('never retries: a hang is one request, a reset is one request, a -500 is one request', async () => {
    const c = client();
    fake.plan('transferFund', { kind: 'hang', ms: 10_000 }, { kind: 'reset' }, { kind: 'sub', subCode: -500 });
    await transfer(c);
    await transfer(c);
    await transfer(c);
    expect(fake.requests('transferFund')).toHaveLength(3);
  });

  it('refuses input that cannot go on the wire BEFORE sending anything', async () => {
    const c = client();
    await expect(c.transferFund({ partnerOrderId: po(), receiver: WALLET, amountVnd: 150000.5, description: 'x' })).rejects.toThrow(/whole number/);
    await expect(c.transferFund({ partnerOrderId: po(), receiver: WALLET, amountVnd: 0, description: 'x' })).rejects.toThrow(/whole number/);
    await expect(c.transferFund({ partnerOrderId: '', receiver: WALLET, amountVnd: 1, description: 'x' })).rejects.toThrow(/partnerOrderId/);
    await expect(c.queryTransaction('')).rejects.toThrow(/partnerOrderId/);
    expect(fake.received).toHaveLength(0);
  });

  it('a wrong key1 is a real -402 from the fake, mapped to rejected (the signature check is live)', async () => {
    expect(await transfer(client({ key1: 'not-the-key' }))).toEqual({ kind: 'rejected', subCode: -402, retryable: false });
    expect(fake.requests('transferFund')[0]?.macValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('query-txn', () => {
  it('finds an order and follows it from PROCESSING to SUCCESS with the zp_trans_id', async () => {
    const c = client();
    const id = po();
    await transfer(c, id);
    expect(await c.queryTransaction(id)).toMatchObject({ kind: 'found', status: 3, zpTransId: null, amountVnd: 150_000 });
    fake.setOrderStatus(id, 1, 'ZP-TRANS-1');
    const done = await c.queryTransaction(id);
    expect(done).toMatchObject({ kind: 'found', status: 1, zpTransId: 'ZP-TRANS-1' });
    expect((done as { resultUrl: string | null }).resultUrl).toMatch(/^https:\/\//);
    expect(fake.requests('queryTxn').every((r) => r.macValid)).toBe(true);
  });

  it('a status can be scripted for one poll (FAIL, PENDING) without touching the order', async () => {
    const c = client();
    const id = po();
    await transfer(c, id);
    fake.plan('queryTxn', { kind: 'ok', status: 4 }, { kind: 'ok', status: 2 });
    expect(await c.queryTransaction(id)).toMatchObject({ kind: 'found', status: 4 });
    expect(await c.queryTransaction(id)).toMatchObject({ kind: 'found', status: 2 });
    expect(await c.queryTransaction(id)).toMatchObject({ kind: 'found', status: 3 });
  });

  it('-101 for an order ZaloPay never saw is not_found', async () => {
    expect(await client().queryTransaction('PO-never-sent')).toEqual({ kind: 'not_found' });
  });

  it('other refusals and system faults keep their code', async () => {
    fake.plan('queryTxn', { kind: 'sub', subCode: -401 }, { kind: 'sub', subCode: -500 });
    expect(await client().queryTransaction('PO-x')).toEqual({ kind: 'rejected', subCode: -401, retryable: false });
    expect(await client().queryTransaction('PO-x')).toEqual({ kind: 'system', subCode: -500, retryable: true });
  });

  it('transport failures throw with the cause', async () => {
    fake.plan('queryTxn', { kind: 'hang', ms: 10_000 }, { kind: 'reset' }, { kind: 'truncated' });
    await expect(client().queryTransaction('PO-x')).rejects.toMatchObject({ cause: 'timeout' });
    await expect(client().queryTransaction('PO-x')).rejects.toMatchObject({ cause: 'network' });
    await expect(client().queryTransaction('PO-x')).rejects.toMatchObject({ cause: 'malformed' });
  });
});

// ---------------------------------------------------------------------------

describe('balance and get-bank-code', () => {
  it('balance reads the float', async () => {
    fake.plan('balance', { kind: 'ok', balance: 123_456_789 });
    expect(await client().balance()).toEqual({ balanceVnd: 123_456_789 });
    expect(fake.requests('balance')[0]?.macValid).toBe(true);
    expect(fake.requests('balance')[0]?.body['payment_id']).toBe(fake.paymentId);
  });

  it('bank codes come back as a typed list', async () => {
    expect(await client().bankCodes()).toEqual([
      { bankCode: 'VCB', name: 'Vietcombank' },
      { bankCode: 'TCB', name: 'Techcombank' },
    ]);
    expect(fake.requests('bankCodes')[0]?.macValid).toBe(true);
  });

  it('a business refusal on these throws ZaloPayError carrying the sub code, because §2.2 gives them no union', async () => {
    fake.plan('balance', { kind: 'sub', subCode: -503 });
    await expect(client().balance()).rejects.toMatchObject({ name: 'ZaloPayError', subCode: -503, retryable: true });
    fake.plan('bankCodes', { kind: 'sub', subCode: -402 });
    const err = await client().bankCodes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZaloPayError);
    expect(err).toMatchObject({ endpoint: 'bankCodes', subCode: -402, retryable: false });
  });

  it('a success without the field we need is malformed', async () => {
    const fetchFn = (body: object): typeof fetch => async () => new Response(JSON.stringify(body));
    await expect(client({ fetch: fetchFn({ return_code: 1, data: {} }) }).balance()).rejects.toMatchObject({ cause: 'malformed' });
    await expect(client({ fetch: fetchFn({ return_code: 1, data: { banks: [{ name: 'x' }] } }) }).bankCodes()).rejects.toMatchObject({ cause: 'malformed' });
  });
});

// ---------------------------------------------------------------------------

/**
 * The vendor's own examples (fixtures.ts `OFFICIAL`), fed to the client
 * through an injected fetch — no fake in the loop — and then the fake held to
 * the same key sets. Bridge findings F-34 and F-35: the first version of this
 * module passed 85 tests against a shape only its own fake produced.
 */
describe('official shapes from docs.zalopay.vn', () => {
  const answer = (body: object): typeof fetch => async () => new Response(JSON.stringify(body));

  it('verify-account, wallet route: m_u_id and no name → verified with verifiedName null', async () => {
    const c = client({ fetch: answer(OFFICIAL.verifyAccountWalletResponse) });
    const r = await c.verifyAccount({ receiver: { method: 'WALLET', phone: '0901234567' }, amountVnd: 10000 });
    expect(r).toEqual({ kind: 'verified', verifiedName: null, mUId: 'Yh2mBCG983efb1Iwu4FuZJO5TgpnCXT-4fwvhNJV1a8' });
  });

  it('verify-account, bank-account route: account_holder_name', async () => {
    const c = client({ fetch: answer(OFFICIAL.verifyAccountBankAccountResponse) });
    expect(await c.verifyAccount({ receiver: BANK, amountVnd: 10000 })).toEqual({ kind: 'verified', verifiedName: 'NGUYEN VAN A', mUId: null });
  });

  it('verify-account, ATM card route: card_holder_name', async () => {
    const c = client({ fetch: answer(OFFICIAL.verifyAccountAtmCardResponse) });
    expect(await c.verifyAccount({ receiver: CARD, amountVnd: 10000 })).toEqual({ kind: 'verified', verifiedName: 'NGUYEN VAN A', mUId: null });
  });

  it('a route answered with the OTHER route’s field is malformed, not silently accepted', async () => {
    // A card answered with account_holder_name, a wallet answered with a name and no m_u_id.
    await expect(client({ fetch: answer(OFFICIAL.verifyAccountBankAccountResponse) }).verifyAccount({ receiver: CARD, amountVnd: 1 })).rejects.toMatchObject({ cause: 'malformed' });
    await expect(client({ fetch: answer({ return_code: 1, data: { account_holder_name: 'X' } }) }).verifyAccount({ receiver: { method: 'WALLET', phone: '0901234567' }, amountVnd: 1 })).rejects.toMatchObject({ cause: 'malformed' });
  });

  it('transfer-fund response from the guide → accepted, PROCESSING, with the order id', async () => {
    const r = await transfer(client({ fetch: answer(OFFICIAL.transferFundWalletResponse) }));
    expect(r).toEqual({ kind: 'accepted', zlpOrderId: '51642840027000060', status: 3 });
  });

  it('balance response from the guide', async () => {
    expect(await client({ fetch: answer(OFFICIAL.balanceResponse) }).balance()).toEqual({ balanceVnd: 42712 });
  });

  it('the request the client sends has the key set of the guide’s transfer-fund example, with disbursement_type BANK for a card', async () => {
    const sent: Record<string, unknown>[] = [];
    const capture: typeof fetch = async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(OFFICIAL.transferFundWalletResponse));
    };
    await transfer(client({ fetch: capture }), 'PO-official-1', CARD);
    await transfer(client({ fetch: capture }), 'PO-official-2', WALLET);
    const official = Object.keys(OFFICIAL.transferFundAtmCardRequest).filter((k) => k !== 'mc_reference_id').sort();
    expect(Object.keys(sent[0]!).sort()).toEqual(official);
    expect(sent[0]).toMatchObject({ disbursement_type: 'BANK' });
    expect(sent[1]).toMatchObject({ disbursement_type: 'WALLET' });
    // Signed under `mac`, as every transfer-fund example in the guide is. The
    // spec page's table names a `sig` row instead — WIRE_NAMES_TO_CONFIRM.
    expect(sent[0]).toHaveProperty('mac');
    expect(sent[0]).not.toHaveProperty('sig');
  });

  it('the fake answers verify-account in exactly the official key set per route', async () => {
    const c = client();
    await c.verifyAccount({ receiver: { method: 'WALLET', phone: '0901234567' }, amountVnd: 1 });
    await c.verifyAccount({ receiver: BANK, amountVnd: 1 });
    await c.verifyAccount({ receiver: CARD, amountVnd: 1 });
    const raw = await Promise.all(
      fake.requests('verifyAccount').map(async (q) => {
        // Re-ask the fake directly for the same body to see the exact JSON it produced.
        const res = await fetch(fake.baseUrl + ENDPOINTS.verifyAccount, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q.body) });
        return (await res.json()) as { data: Record<string, unknown> };
      }),
    );
    expect(Object.keys(raw[0]!.data)).toEqual(Object.keys(OFFICIAL.verifyAccountWalletResponse.data));
    expect(Object.keys(raw[1]!.data)).toEqual(Object.keys(OFFICIAL.verifyAccountBankAccountResponse.data));
    expect(Object.keys(raw[2]!.data)).toEqual(Object.keys(OFFICIAL.verifyAccountAtmCardResponse.data));
  });

  it('the fake’s transfer and query data use only keys the spec documents (plus the two Part 0 names, flagged)', async () => {
    // A fetch that records what the fake actually sent back, byte for byte.
    const answers: { data: Record<string, unknown> }[] = [];
    const recording: typeof fetch = async (url, init) => {
      const res = await fetch(url, init);
      const text = await res.text();
      answers.push(JSON.parse(text) as { data: Record<string, unknown> });
      return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
    };
    const c = client({ fetch: recording });
    expect(await transfer(c, 'PO-keys', BANK)).toMatchObject({ kind: 'accepted', status: 3 });
    fake.setOrderStatus('PO-keys', 1);
    expect(await c.queryTransaction('PO-keys')).toMatchObject({ kind: 'found', status: 1 });
    expect(answers).toHaveLength(2);
    const allowed = new Set<string>([...OFFICIAL.transferOrQueryDataKeys, 'zp_trans_id', 'result_url']);
    for (const a of answers) {
      for (const k of Object.keys(a.data)) expect(allowed.has(k), `undocumented key ${k}`).toBe(true);
      expect(a.data).toMatchObject({ disbursement_type: 'BANK', bank_code: 'VCB', account_holder_name: 'NGUYEN VAN A' });
    }
  });
});
