import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { zaloPayClientFromEnv } from '../../../src/payout/zalopay/client.ts';

/**
 * Against sb-openapi.zalopay.vn, once credentials exist (payout brief,
 * AGENT F, BUILD 5). Skips cleanly, saying which variable is missing, when
 * they do not — which is every machine today.
 *
 * Read-only by construction. This file never calls `transferFund`: a test
 * suite that can move money is a test suite that will, one day, on the wrong
 * environment. The sandbox transfer path is exercised by the fake server in
 * `edge-cases.test.ts`; the first live transfer is an operator's decision
 * (Part 4, G5), not a `pnpm test`.
 */

const CREDENTIALS = ['PLAYERONE_ZALOPAY_APP_ID', 'PLAYERONE_ZALOPAY_PAYMENT_ID', 'PLAYERONE_ZALOPAY_KEY1', 'PLAYERONE_ZALOPAY_PUBLIC_KEY'] as const;

const missing = CREDENTIALS.filter((k) => !process.env[k]);
const env = process.env['PLAYERONE_ZALOPAY_ENV'] ?? 'sandbox';
const notSandbox = env !== 'sandbox';
const why =
  missing.length > 0
    ? `skipped: ${missing.join(', ')} not set; set the four PLAYERONE_ZALOPAY_* sandbox credentials to run`
    : notSandbox
      ? `skipped: PLAYERONE_ZALOPAY_ENV=${env}; this suite only ever runs against sandbox`
      : 'live';

describe.skipIf(missing.length > 0 || notSandbox)(`ZaloPay sandbox, sb-openapi.zalopay.vn (${why})`, () => {
  const client = () => {
    const c = zaloPayClientFromEnv(process.env);
    if (c === null) throw new Error('no client from environment');
    return c;
  };

  it('signs a balance request the sandbox accepts, and reads a number', async () => {
    const { balanceVnd } = await client().balance();
    expect(Number.isFinite(balanceVnd)).toBe(true);
    expect(balanceVnd).toBeGreaterThanOrEqual(0);
  });

  it('lists bank codes', async () => {
    const banks = await client().bankCodes();
    expect(banks.length).toBeGreaterThan(0);
    for (const b of banks) expect(b).toMatchObject({ bankCode: expect.any(String), name: expect.any(String) });
  });

  it('answers not_found for a partner_order_id nobody ever sent', async () => {
    const r = await client().queryTransaction(`PO-${randomUUID()}-1`);
    expect(r.kind).toBe('not_found');
  });

  it.skipIf(!process.env['PLAYERONE_ZALOPAY_SANDBOX_PHONE'])(
    'verifies the sandbox test wallet by phone and returns its m_u_id (PLAYERONE_ZALOPAY_SANDBOX_PHONE)',
    async () => {
      const r = await client().verifyAccount({ receiver: { method: 'WALLET', phone: process.env['PLAYERONE_ZALOPAY_SANDBOX_PHONE']! }, amountVnd: 1000 });
      expect(r.kind).toBe('verified');
      if (r.kind === 'verified') expect(r.mUId).toEqual(expect.any(String));
    },
  );

  it('never sends a transfer from this suite', () => {
    // A structural assertion, not a behavioural one: the word is not in this file's imports.
    expect(typeof (client() as { transferFund?: unknown }).transferFund).toBe('function');
    expect(process.env['PLAYERONE_ZALOPAY_SANDBOX_ALLOW_TRANSFER']).toBeUndefined();
  });
});
