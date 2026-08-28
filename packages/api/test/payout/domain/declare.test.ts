import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi } from '../../../src/index.ts';
import type { PayoutOptions } from '../../../src/payout/domain/config.ts';
import { closeDb, db, hasDb, truncate, useDatabase } from '../../../../store/test/db.ts';
import { countOf, insertAttemptAs, rows, seedAccount, seedBills, seedPayout, uid, type Ids } from './fixture.ts';
import { StubZaloPay } from './stub-client.ts';

/**
 * The counter's own declaration route: an operator declares a collector's
 * payout account at the counter, on the collector's behalf.
 *
 * Why it exists. `POST /api/payout/accounts` is finance-only, so a collector
 * with no declared account sits at "approved, awaiting payment" until a
 * finance person happens to type their details, and nobody at the counter —
 * the only place the collector actually is — can do it. There is no collector
 * credential in this service (APP-* is blocked on PaXini), so a
 * collector-facing route would have nothing to authenticate; the operator
 * declares it, exactly as the operator already creates the session and the
 * handover.
 */

useDatabase('payout_declare');

const SECRET = 'k';

describe.skipIf(!hasDb())('declaring a payout account at the counter', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  type Headers = Record<string, string>;

  async function harness(payout: PayoutOptions = {}) {
    const d = await db();
    const ids = await seedPayout(d);
    const app: FastifyInstance = buildApi({ db: d, tokenSecret: SECRET, payout });
    await app.ready();
    const login = async (machine: string, operator: string): Promise<Headers> => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
      expect(m.statusCode, m.body).toBe(200);
      expect(o.statusCode, o.body).toBe(200);
      return { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
    };
    const send = async (method: 'POST' | 'GET', url: string, who: Headers, payload?: unknown): Promise<LightMyRequestResponse> =>
      (await app.inject({ method, url, payload: payload as never, headers: who })) as unknown as LightMyRequestResponse;
    return {
      d,
      ids,
      app,
      opA: await login('HCM-01', 'op-hcm'),
      finA: await login('HCM-01', 'fin-hcm'),
      finB: await login('HAN-01', 'fin-han'),
      send,
    };
  }

  /** collector1 handed a card in at centre A; collector2 at centre B. */
  const at = (ids: Ids, which: 1 | 2) => `/api/payout/collectors/${which === 1 ? ids.collector1 : ids.collector2}/accounts`;
  const wallet = (over: Record<string, unknown> = {}) => ({
    id: uid(),
    method: 'WALLET',
    declared_name: 'Nguyễn Văn A',
    phone: '0912345678',
    ...over,
  });

  it('lets the centre operator declare an account, verified, audited, and masked', async () => {
    const stub = new StubZaloPay();
    stub.verify = { kind: 'verified', verifiedName: 'NGUYEN VAN A', mUId: 'mu-77' };
    const h = await harness({ client: stub });
    const body = wallet();

    const res = await h.send('POST', at(h.ids, 1), h.opA, body);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      id: body.id,
      replayed: false,
      verify_status: 'verified',
      declared_name: 'Nguyễn Văn A',
      verified_name: 'NGUYEN VAN A',
      phone_masked: '******5678',
      onboarding_url: null,
      reform_url: null,
    });

    const [row] = await rows<Record<string, unknown>>(h.d, sql`select * from payout_accounts where id = ${body.id}`);
    expect(row).toMatchObject({ collector_id: h.ids.collector1, verify_status: 'verified', is_current: true, created_by: h.ids.opA });
    // The collector comes from the path, and ZaloPay was asked once.
    expect(stub.calls.verifyAccount).toBe(1);

    // Audited through `mutate`, with the phone masked and no full number anywhere.
    const audits = await rows<{ t: string; operator_id: string }>(
      h.d,
      sql`select after::text as t, operator_id from audit_events where action = 'payout_account.declare'`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.operator_id).toBe(h.ids.opA);
    expect(audits[0]!.t).toContain('******5678');
    expect(audits[0]!.t).not.toContain('0912345678');
  });

  it('stores only the last four digits of a bank account, and hands back the ZaloPay page when there is one', async () => {
    const stub = new StubZaloPay();
    stub.verify = { kind: 'rejected', subCode: -101, retryable: false, onboardingUrl: 'https://zalopay.vn/onboard' };
    const h = await harness({ client: stub });
    const body = { id: uid(), method: 'BANK_ACCOUNT', declared_name: 'Nguyen Van A', bank_code: 'VCB', account_no: '0071000123456' };

    const res = await h.send('POST', at(h.ids, 1), h.opA, body);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      verify_status: 'no_wallet',
      account_no_last4: '3456',
      onboarding_url: 'https://zalopay.vn/onboard',
      reform_url: null,
    });
    const dump = await rows<{ t: string }>(h.d, sql`select row_to_json(a)::text as t from payout_accounts a`);
    expect(dump[0]!.t).not.toContain('0071000123456');
  });

  it('replaces the current account and replays the same declaration without asking ZaloPay again', async () => {
    const stub = new StubZaloPay();
    const h = await harness({ client: stub });
    const first = wallet();
    const second = wallet({ phone: '0987654321' });
    expect((await h.send('POST', at(h.ids, 1), h.opA, first)).statusCode).toBe(201);
    expect((await h.send('POST', at(h.ids, 1), h.opA, second)).statusCode).toBe(201);
    expect(stub.calls.verifyAccount).toBe(2);

    const again = await h.send('POST', at(h.ids, 1), h.opA, first);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ replayed: true, is_current: false });
    expect(stub.calls.verifyAccount).toBe(2);

    // A used id under a different destination is a correction wearing a used id.
    const reused = await h.send('POST', at(h.ids, 1), h.opA, { ...first, declared_name: 'Nguyễn Văn B' });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().constraint).toBe('payout_accounts_id_reused');
    expect(stub.calls.verifyAccount).toBe(2);
    expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(2);
  });

  it('refuses a collector who has handed nothing in at this centre', async () => {
    const stub = new StubZaloPay();
    const h = await harness({ client: stub });
    // collector2's only handover is at centre B; op-hcm is centre A.
    const res = await h.send('POST', at(h.ids, 2), h.opA, wallet());
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().constraint).toBe('payout_account_not_this_centre');
    expect(stub.calls.verifyAccount).toBe(0);
    expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(0);

    // And a collector nobody has ever seen is the same answer, not a 500.
    const nobody = await h.send('POST', `/api/payout/collectors/${uid()}/accounts`, h.opA, wallet());
    expect(nobody.statusCode).toBe(409);
    expect(nobody.json().constraint).toBe('payout_account_not_this_centre');
  });

  it('refuses an invalid declaration by name, before ZaloPay is asked', async () => {
    const stub = new StubZaloPay();
    const h = await harness({ client: stub });
    for (const [what, body] of [
      ['not a Vietnamese mobile', wallet({ phone: '12345' })],
      ['a wallet with no phone', { id: uid(), method: 'WALLET', declared_name: 'Nguyen Van A' }],
      ['a bank route with no account number', { id: uid(), method: 'BANK_ACCOUNT', declared_name: 'Nguyen Van A', bank_code: 'VCB' }],
      ['an empty holder name', wallet({ declared_name: '  ' })],
      ['a method ZaloPay does not have', wallet({ method: 'CASH' })],
    ] as const) {
      const res = await h.send('POST', at(h.ids, 1), h.opA, body);
      expect(res.statusCode, `${what}: ${res.body}`).toBe(409);
      expect(res.json().constraint, what).toBe('payout_account_declaration_invalid');
    }
    expect(stub.calls.verifyAccount).toBe(0);
    expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(0);
  });

  it('refuses while a payout attempt for this collector is still open, on both routes', async () => {
    const stub = new StubZaloPay();
    const h = await harness({ client: stub });
    const { bill1 } = await seedBills(h.d, h.ids);
    const account = await seedAccount(h.d, h.ids, 1);
    // Submitted and not yet answered: money may be moving to `account` right
    // now. An api attempt has to START at `created` (0012's initial-status
    // rule), so the submit is the edge the state machine allows, not an insert.
    const attempt = await insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: bill1, accountId: account, amountVnd: 2400 });
    await h.d.execute(sql`update payout_attempts set status = 'submitted' where id = ${attempt}`);

    const counter = await h.send('POST', at(h.ids, 1), h.opA, wallet());
    expect(counter.statusCode, counter.body).toBe(409);
    expect(counter.json().constraint).toBe('payout_account_locked_while_paying');

    const finance = await h.send('POST', '/api/payout/accounts', h.finA, { ...wallet(), collector_id: h.ids.collector1 });
    expect(finance.statusCode, finance.body).toBe(409);
    expect(finance.json().constraint).toBe('payout_account_locked_while_paying');

    expect(stub.calls.verifyAccount).toBe(0);
    expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(1);

    // Resolved, and the counter can declare again.
    await h.d.execute(sql`update payout_attempts set status = 'failed', settled_at = now() where id = ${attempt}`);
    const after = await h.send('POST', at(h.ids, 1), h.opA, wallet());
    expect(after.statusCode, after.body).toBe(201);
  });

  it('needs both tokens, and refuses a reviewer', async () => {
    const h = await harness({ client: new StubZaloPay() });
    const bare = await h.app.inject({ method: 'POST', url: at(h.ids, 1), payload: wallet() as never });
    expect(bare.statusCode).toBe(401);
    expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(0);
  });

  it('shows the back office who has an account and who has none', async () => {
    const stub = new StubZaloPay();
    const h = await harness({ client: stub });
    const before = await h.send('GET', '/api/collectors', h.opA);
    expect(before.statusCode, before.body).toBe(200);
    const none = (before.json().collectors as { external_ref: string; payout_account: unknown }[]).map((c) => [c.external_ref, c.payout_account]);
    expect(none).toEqual([
      ['c-0001', null],
      ['c-0002', null],
    ]);

    expect((await h.send('POST', at(h.ids, 1), h.opA, wallet())).statusCode).toBe(201);
    const after = await h.send('GET', '/api/collectors', h.opA);
    const listed = (after.json().collectors as { external_ref: string; payout_account: Record<string, unknown> | null }[]);
    expect(listed.find((c) => c.external_ref === 'c-0001')!.payout_account).toEqual({
      method: 'WALLET',
      verify_status: 'verified',
      phone_masked: '******5678',
    });
    // Still findable as the one who cannot be paid.
    expect(listed.find((c) => c.external_ref === 'c-0002')!.payout_account).toBeNull();
  });

  it('refuses to pay an account the payer declared themselves (0013 separation of duty)', async () => {
    const h = await harness({ client: new StubZaloPay() });
    const { bill1 } = await seedBills(h.d, h.ids);

    // fin-hcm declares the destination through the finance route, then tries to
    // send money to it. One person choosing where the money goes AND sending it
    // is the whole of what 0013 exists to stop.
    const declared = await h.send('POST', '/api/payout/accounts', h.finA, { ...wallet(), collector_id: h.ids.collector1 });
    expect(declared.statusCode, declared.body).toBe(201);
    const mine = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2400 });
    expect(mine.statusCode, mine.body).toBe(409);
    expect(mine.json().constraint).toBe('payout_separation_of_duty');
    expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);

    // The other finance operator, who declared nothing, may pay it.
    const theirs = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finB, { manual_reference: 'VCB-1', amount_vnd: 2400 });
    expect(theirs.statusCode, theirs.body).toBe(201);
  });

  it('lets finance pay an account the counter declared', async () => {
    const h = await harness({ client: new StubZaloPay() });
    const { bill1 } = await seedBills(h.d, h.ids);
    expect((await h.send('POST', at(h.ids, 1), h.opA, wallet())).statusCode).toBe(201);
    const paid = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2400 });
    expect(paid.statusCode, paid.body).toBe(201);
  });
});
