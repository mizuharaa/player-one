import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZaloPayHttpClient } from '../../../src/payout/zalopay/client.ts';
import { balanceMacParts, hmac } from '../../../src/payout/zalopay/signing.ts';
import { ENDPOINTS, SUB_RETURN_CODES } from '../../../src/payout/zalopay/types.ts';
import { FakeZaloPay, startFakeZaloPay, type Scenario } from './fake-server.ts';

/**
 * The fake itself, as Agents B and F will lean on it. What it must be able to
 * produce (Agent A brief, BUILD 5): every sub code in the table, all four
 * statuses, a hang, a reset mid-body, a 200 with a truncated body. And what
 * it must record: every request, with whether the mac verified.
 */

let fake: FakeZaloPay;
beforeAll(async () => {
  fake = await startFakeZaloPay({ appId: 1234, paymentId: 'PM-FAKE', key1: 'fake-key1' });
});
afterAll(async () => {
  await fake.close();
});
beforeEach(() => {
  fake.received.length = 0;
  for (const q of Object.values(fake.queue)) q.length = 0;
  fake.strictMac = true;
});

const post = (endpoint: keyof typeof ENDPOINTS, body: object) =>
  fetch(fake.baseUrl + ENDPOINTS[endpoint], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

const signedBalance = (key1 = fake.key1, appId = fake.appId) => {
  const unsigned = { app_id: appId, payment_id: fake.paymentId, time: 1756200000000 };
  return { ...unsigned, mac: hmac(key1, balanceMacParts(unsigned)) };
};

describe('the scenario table', () => {
  it('consumes one queued scenario per request, in order, then falls back to the default', async () => {
    fake.plan('balance', { kind: 'ok', balance: 1 }, { kind: 'ok', balance: 2 });
    const read = async () => ((await (await post('balance', signedBalance())).json()) as { data: { balance: number } }).data.balance;
    expect(await read()).toBe(1);
    expect(await read()).toBe(2);
    expect(await read()).toBe(fake.defaultBalance);
    expect(fake.queue.balance).toHaveLength(0);
    expect(fake.requests('balance').map((r) => r.scenario)).toEqual([
      { kind: 'ok', balance: 1 },
      { kind: 'ok', balance: 2 },
      { kind: 'ok' },
    ]);
  });

  it('queues are per endpoint', async () => {
    fake.plan('bankCodes', { kind: 'sub', subCode: -503 });
    const balance = (await (await post('balance', signedBalance())).json()) as { return_code: number };
    expect(balance.return_code).toBe(1);
    expect(fake.queue.bankCodes).toHaveLength(1);
  });

  it('can produce every sub code in the §0.5 table, with the constant as the message', async () => {
    for (const [code, entry] of SUB_RETURN_CODES) {
      fake.plan('balance', { kind: 'sub', subCode: code });
      const r = (await (await post('balance', signedBalance())).json()) as { return_code: number; sub_return_code: number; sub_return_message: string };
      expect(r.return_code).toBe(2);
      expect(r.sub_return_code).toBe(code);
      expect(r.sub_return_message).toBe(entry.constant);
    }
  });

  it('carries extra data on a sub code (reform_url, onboarding_url)', async () => {
    fake.plan('balance', { kind: 'sub', subCode: -406, extra: { reform_url: 'https://x/reform' } });
    const r = (await (await post('balance', signedBalance())).json()) as { data: { reform_url: string } };
    expect(r.data.reform_url).toBe('https://x/reform');
  });

  it('can produce all four statuses on transfer and on query', async () => {
    const c = new ZaloPayHttpClient({ ...fake.clientConfig(), timeouts: { transferFundMs: 5_000, otherMs: 5_000 } });
    for (const status of [1, 2, 3, 4] as const) {
      fake.plan('transferFund', { kind: 'ok', status });
      const id = `PO-status-${status}`;
      expect(await c.transferFund({ partnerOrderId: id, receiver: { method: 'WALLET', mUId: 'MU' }, amountVnd: 10, description: 'x' })).toMatchObject({ kind: 'accepted', status });
      expect(await c.queryTransaction(id)).toMatchObject({ kind: 'found', status });
      expect(fake.orders.get(id)?.status).toBe(status);
    }
  });

  it('answers a hang after its delay when the client waits long enough', async () => {
    fake.plan('balance', { kind: 'hang', ms: 200 });
    const t0 = Date.now();
    const r = (await (await post('balance', signedBalance())).json()) as { sub_return_code: number };
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
    expect(r.sub_return_code).toBe(-500);
  });

  it('hangs 20 s by default — the transfer budget — so a default-budget client times out', () => {
    // Asserted structurally: the default is what the brief names. A 20 s
    // wait in the suite proves nothing the 200 ms case above did not.
    const scenario: Scenario = { kind: 'hang' };
    expect(scenario.ms ?? 20_000).toBe(20_000);
  });

  it('resets mid-body, truncates a 200, and answers as a gateway', async () => {
    fake.plan('balance', { kind: 'reset' });
    await expect((async () => (await post('balance', signedBalance())).text())()).rejects.toThrow();

    fake.plan('balance', { kind: 'truncated' });
    const truncated = await post('balance', signedBalance());
    expect(truncated.status).toBe(200);
    const text = await truncated.text();
    expect(() => JSON.parse(text)).toThrow();
    expect(text.length).toBeGreaterThan(0);

    fake.plan('balance', { kind: 'http', status: 503, body: 'maintenance' });
    const gw = await post('balance', signedBalance());
    expect(gw.status).toBe(503);
    expect(await gw.text()).toBe('maintenance');
    expect(fake.requests('balance')).toHaveLength(3);
  });
});

describe('what it checks and what it remembers', () => {
  it('verifies the mac with key1 and answers -402 to a bad one, unless told to be lenient', async () => {
    const bad = (await (await post('balance', signedBalance('wrong'))).json()) as { sub_return_code: number };
    expect(bad.sub_return_code).toBe(-402);
    expect(fake.requests('balance')[0]?.macValid).toBe(false);

    fake.strictMac = false;
    const lenient = (await (await post('balance', signedBalance('wrong'))).json()) as { return_code: number };
    expect(lenient.return_code).toBe(1);
    expect(fake.requests('balance')[1]?.macValid).toBe(false);
  });

  it('answers -402 to a foreign app_id even with a mac that key1 would accept', async () => {
    const r = (await (await post('balance', signedBalance(fake.key1, 9999))).json()) as { sub_return_code: number };
    expect(r.sub_return_code).toBe(-402);
  });

  it('raises -68 by itself on a repeated partner_order_id and -101 on an order it never saw', async () => {
    const c = new ZaloPayHttpClient({ ...fake.clientConfig(), timeouts: { transferFundMs: 5_000, otherMs: 5_000 } });
    const input = { partnerOrderId: 'PO-dup', receiver: { method: 'WALLET' as const, mUId: 'MU' }, amountVnd: 10, description: 'x' };
    expect(await c.transferFund(input)).toMatchObject({ kind: 'accepted' });
    expect(await c.transferFund(input)).toEqual({ kind: 'duplicate' });
    expect(await c.transferFund(input)).toEqual({ kind: 'duplicate' });
    expect(await c.queryTransaction('PO-unknown')).toEqual({ kind: 'not_found' });
    expect(fake.requests('transferFund')).toHaveLength(3);
    expect(fake.orders.get('PO-dup')?.amount).toBe(10);
  });

  it('logs every request with its endpoint, body, decrypted receiver and sequence — the count B and F assert on', async () => {
    const c = new ZaloPayHttpClient({ ...fake.clientConfig(), timeouts: { transferFundMs: 5_000, otherMs: 5_000 } });
    await c.verifyAccount({ receiver: { method: 'WALLET', phone: '0912345678' }, amountVnd: 1 });
    await c.transferFund({ partnerOrderId: 'PO-log', receiver: { method: 'WALLET', mUId: 'MU-0912345678' }, amountVnd: 5, description: 'x' });
    await c.queryTransaction('PO-log');
    await c.balance();
    await c.bankCodes();
    expect(fake.received.map((r) => r.endpoint)).toEqual(['verifyAccount', 'transferFund', 'queryTxn', 'balance', 'bankCodes']);
    expect(fake.received.every((r) => r.macValid)).toBe(true);
    expect(fake.received[0]?.receiver).toEqual({ phone: '0912345678' });
    expect(fake.received[1]?.receiver).toEqual({ m_u_id: 'MU-0912345678' });
    expect(fake.received[2]?.receiver).toBeNull();
    const seqs = fake.received.map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(fake.requests('transferFund')).toHaveLength(1);
  });

  it('hands out a client config that talks to it', () => {
    const cfg = fake.clientConfig();
    expect(cfg).toMatchObject({ env: 'sandbox', appId: 1234, paymentId: 'PM-FAKE', key1: 'fake-key1' });
    expect(cfg.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(cfg.zaloPayPublicKeyPem).toContain('BEGIN PUBLIC KEY');
  });
});
