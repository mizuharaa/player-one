import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../../src/index.ts';
import { signToken } from '../../src/credentials.ts';
import { outcomeOf } from '../../src/payout/domain/verify.ts';
import { payoutOptionsFromEnv } from '../../src/payout/domain/config.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase, violates } from '../../../store/test/db.ts';
import { P1, seedPayout, seedBill, seedAccount, auditRow, insertAttemptAs, uid } from './domain/fixture.ts';

useDatabase('honest');
describe.skipIf(!hasDb())('honest payout demo (SIMULATION, test database only)', () => {
  let app: FastifyInstance;
  beforeEach(truncate);
  afterEach(async () => { await app?.close(); });
  afterAll(closeDb);
  async function setup() {
    const d = await db();
    const ids = await seedPayout(d);
    app = buildApi({ db: await appDb(), tokenSecret: 'k', payout: payoutOptionsFromEnv({ PLAYERONE_ZALOPAY_ENV: 'sandbox' }) });
    await app.ready();
    const login = async (operator: string) => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'HCM-01', secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
      return { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
    };
    const finance = await login('fin-hcm');
    const operator = await login('op-hcm');
    const collector = (id = ids.collector1) => ({ authorization: `Bearer ${signToken('k', { kind: 'collector', collectorId: id, epoch: 1 })}` });
    const bill = await seedBill(d, ids, 1, P1, ['679.9992'], '679.9992');
    const mark = (headers = finance, amount = 679) => app.inject({ method: 'POST', url: `/api/payout/bills/${bill}/mark-paid`, headers, payload: { amount_vnd: amount, manual_reference: 'SIMULATION-REF-X' } });
    const snapshot = async () => JSON.stringify(await d.execute(sql`
      select 'bill' as kind, row_to_json(b)::text as row from bills b
      union all select 'settlement', row_to_json(s)::text from settlements s
      union all select 'attempt', row_to_json(a)::text from payout_attempts a order by kind, row
    `));
    return { d, ids, finance, operator, collector, bill, mark, snapshot };
  }

  it('keeps sandbox declaration provenance after switching the reader to production', async () => {
    const h = await setup();
    await app.close();
    app = buildApi({ db: await appDb(), tokenSecret: 'k', payout: { zaloPayEnv: 'sandbox', client: {
      verifyAccount: async () => ({ kind: 'verified', verifiedName: 'NGUYEN VAN A', mUId: 'simulation-wallet' }),
      transferFund: async () => { throw new Error('no transfer'); }, queryTransaction: async () => ({ kind: 'not_found' }),
      balance: async () => ({ balanceVnd: 0 }), bankCodes: async () => [],
    } } });
    const declared = await app.inject({ method: 'POST', url: '/api/payout/accounts', headers: h.finance,
      payload: { id: uid(), collector_id: h.ids.collector1, method: 'WALLET', phone: '0901234567', declared_name: 'NGUYEN VAN A' } });
    expect(declared.statusCode, declared.body).toBe(201);
    await app.close();
    app = buildApi({ db: await appDb(), tokenSecret: 'k', payout: { zaloPayEnv: 'production', credentialsPresent: { appId: true, paymentId: true, key1: true, publicKey: true } } });
    expect((await app.inject({ url: '/api/me/payout', headers: h.collector() })).json()).toMatchObject({ status: 'verified', simulation: true });
    const batch = await app.inject({ url: `/api/payout/batches/${P1.start.toISOString()}`, headers: h.finance });
    expect(batch.json().bills[0]).toMatchObject({ simulation: true });
    const notifications = await h.d.execute(sql`select payload from collector_notifications where kind = 'payout_account_verified'`);
    expect(notifications[0]!.payload).toMatchObject({ simulation: 'true' });
    const machine = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'HAN-01', secret: 'pw' } });
    const payer = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: 'fin-han', secret: 'pw' } });
    const paidResponse = await h.mark({ 'x-machine-token': `Bearer ${machine.json().token}`, authorization: `Bearer ${payer.json().token}` });
    expect(paidResponse.statusCode, paidResponse.body).toBe(201);
    expect((await app.inject({ url: '/api/me/payout', headers: h.collector() })).json()).toMatchObject({ simulation: false, verification_simulation: true });
    const paid = await app.inject({ url: `/api/payout/batches/${P1.start.toISOString()}`, headers: h.finance });
    expect(paid.json().bills[0]).toMatchObject({ simulation: false, account: { simulation: true } });

  });

  it('fixture-verified payment records floored dong, reference and finance actor, then reads paid afresh', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const res = await h.mark();
    expect(res.statusCode, res.body).toBe(201);
    // Audit finding 3: the reference is a transfer a finance operator made, so
    // the outcome is not a simulation even on the sandbox provider.
    expect(res.json()).toMatchObject({ amount_vnd: 679, manual_reference: 'SIMULATION-REF-X', status: 'succeeded', simulation: false });
    const audits = await h.d.execute(sql`select operator_id from audit_events where action = 'bill.mark_paid'`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.operator_id).toBe(h.ids.finA);
    const payout = await app.inject({ url: '/api/me/payout', headers: h.collector() });
    expect(payout.json()).toMatchObject({ status: 'verified', simulation: false, payment: { reference: 'SIMULATION-REF-X', amount_vnd: 679 } });
    const income = await app.inject({ url: '/api/me/income', headers: h.collector() });
    // A cycle is not one outcome: this field stays the sandbox environment word.
    expect(income.json().simulation).toBe(true);
    expect(income.json().episodes[0]).toMatchObject({ state: 'paid', payment_reference: 'SIMULATION-REF-X' });
    const financeIncome = await app.inject({ url: `/api/payout/collectors/${h.ids.collector1}/income`, headers: h.finance });
    expect(financeIncome.json().simulation).toBe(true);
    expect(financeIncome.json().periods[0]).toMatchObject({ status: 'paid', payment_reference: 'SIMULATION-REF-X' });
    const finance = await app.inject({ url: `/api/payout/batches/${P1.start.toISOString()}`, headers: h.finance });
    expect(finance.json().bills[0]).toMatchObject({ paid: true, simulation: false, attempt: { manual_reference: 'SIMULATION-REF-X' } });
  });

  /**
   * Audit finding 3. `simulation` was `PLAYERONE_ZALOPAY_ENV === 'sandbox'` at
   * five sites, and both example env files set `sandbox` while
   * `assertPayoutBootInvariants` refuses `production` without four ZaloPay
   * credentials nobody has — so every surface said "Simulation. No live
   * transfer." over the manual rail, which is where a finance operator records
   * a real transfer. Both directions are asserted here, on one sandbox
   * deployment, so the label cannot be satisfied by a flag.
   */
  it('the simulation label follows the outcome, not the environment', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const period = `/api/payout/batches/${P1.start.toISOString()}`;
    // Nothing has happened yet: the sandbox provider is all there is to report.
    const unpaid = await app.inject({ url: period, headers: h.finance });
    expect(unpaid.json().bills[0]).toMatchObject({ paid: false, simulation: true });
    expect((await app.inject({ url: '/api/me/payout', headers: h.collector() })).json().simulation).toBe(true);
    // A recorded manual transfer is a real payment on the same deployment.
    expect((await h.mark()).json().simulation).toBe(false);
    expect((await app.inject({ url: period, headers: h.finance })).json().bills[0].simulation).toBe(false);
    expect((await app.inject({ url: '/api/me/payout', headers: h.collector() })).json().simulation).toBe(false);
    // Replaying it says the same thing.
    const replayed = await h.mark();
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({ replayed: true, simulation: false });
    // And the environment word itself is untouched: the console header and the
    // engineering status still say sandbox.
    expect((await app.inject({ url: '/api/payout/environment', headers: h.finance })).json())
      .toEqual({ environment: 'sandbox', simulation: true });
  });

  /**
   * The audit's finding 1, the shape a wallet change produces. The payment
   * subquery was scoped to the collector, the destination above it to the
   * current account, so one response described two accounts: "awaiting —
   * destination unverified" and "paid, reference OLD-REF" at the same time,
   * and the phone renders both lines.
   */
  it('a payment to a replaced destination is not read back beside the new one', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    expect((await h.mark()).statusCode).toBe(201);
    await h.d.execute(sql`update payout_accounts set is_current = false where collector_id = ${h.ids.collector1}`);
    const declared = await app.inject({ method: 'POST', url: '/api/payout/accounts', headers: h.finance,
      payload: { id: uid(), collector_id: h.ids.collector1, method: 'WALLET', declared_name: 'Nguyen Van A', phone: '0912340000' } });
    expect(declared.statusCode, declared.body).toBe(201);
    const phone = await app.inject({ url: '/api/me/payout', headers: h.collector() });
    expect(phone.json()).toMatchObject({ status: 'awaiting', masked: '•••• 0000' });
    expect(phone.json().payment).toBeUndefined();
    expect(phone.body).not.toContain('SIMULATION-REF-X');
  });

  it('duplicate submission replays the same attempt without another payment', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const first = await h.mark();
    expect(first.statusCode, first.body).toBe(201);
    const before = await h.snapshot();
    const second = await h.mark();
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ replayed: true, attempt_id: first.json().attempt_id });
    expect(await h.snapshot()).toBe(before);
  });

  it('concurrent duplicate submissions create one attempt and replay the winner', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const results = await Promise.all([h.mark(), h.mark()]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 201]);
    expect(results[0]!.json().attempt_id).toBe(results[1]!.json().attempt_id);
    expect(await h.d.execute(sql`select id from payout_attempts`)).toHaveLength(1);
  });

  it('the database also refuses a verdict author bypassing the handler', async () => {
    const h = await setup();
    const accountId = await seedAccount(h.d, h.ids, 1);
    const [review] = await h.d.execute(sql`select episode_review_id from settlements limit 1`);
    await auditRow(h.d, h.ids, { action: 'episode.review', targetTable: 'episode_reviews', targetId: String(review!.episode_review_id), operatorId: h.ids.finA });
    const before = await h.snapshot();
    await violates('payout_reviewer_separation_of_duty', insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill, accountId, amountVnd: 679, mode: 'manual', manualReference: 'SIMULATION-REF-X', settledAt: new Date() }));
    expect(await h.snapshot()).toBe(before);
  });

  it('collector A never reads collector B destination or payment', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    await h.mark();
    // B is the attacker here; A owns the only destination and payment.
    const attacker = h.collector(h.ids.collector2);
    const payout = await app.inject({ url: `/api/me/payout?collector_id=${h.ids.collector1}`, headers: attacker });
    expect(payout.json()).toMatchObject({ status: 'none', masked: null });
    expect(payout.body).not.toContain('SIMULATION-REF-X');
    const income = await app.inject({ url: `/api/me/income?collector_id=${h.ids.collector1}`, headers: attacker });
    expect(income.json().episodes).toEqual([]);
    for (const path of ['accounts', 'income']) {
      const response = await app.inject({ url: `/api/payout/collectors/${h.ids.collector1}/${path}`, headers: attacker });
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain('5678');
      expect(response.body).not.toContain('SIMULATION-REF-X');
    }
  });

  /**
   * Audit finding 2. Two halves, and the second one is the gate.
   *
   * The mapper's answer is `unverified`, and an unverified account cannot pay —
   * that is the first half, and it is all the lane proved. But the payable
   * question is `verify_status <> 'verified'`, so the row the mapper used to
   * write — `verified` with no name — was payable by anything that did not go
   * through the mapper. The second half seeds that row shape directly, the way
   * the audit's probe did, and the schema refuses it.
   */
  it('IDENT.NAME_UNCONFIRMED cannot make a wallet eligible for payment', async () => {
    const h = await setup();
    const outcome = outcomeOf('Nguyen Van A', { kind: 'verified', verifiedName: null, mUId: 'mu-unnamed' });
    expect(outcome.event).toBe('IDENT.NAME_UNCONFIRMED');
    expect(outcome.status).toBe('unverified');
    await seedAccount(h.d, h.ids, 1, { verifyStatus: outcome.status, verifiedName: outcome.verifiedName, mUId: outcome.mUId });
    const before = await h.snapshot();
    const res = await h.mark();
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().constraint).toBe('payout_attempts_account_unverified');
    expect(await h.snapshot()).toBe(before);
    // The shape the audit's probe paid 201 on cannot be written at all, so
    // mark-paid never reaches its gate: the constraint refuses the row.
    await h.d.execute(sql`update payout_accounts set is_current = false where collector_id = ${h.ids.collector1}`);
    await violates('payout_accounts_verified_named_check',
      seedAccount(h.d, h.ids, 1, { verifyStatus: 'verified', verifiedName: null, mUId: 'mu-unnamed' }));
    expect(await h.snapshot()).toBe(before);
  });

  it('sandbox configuration is visible to the header and engineering status', async () => {
    const h = await setup();
    const header = await app.inject({ url: '/api/payout/environment', headers: h.finance });
    expect(header.statusCode, header.body).toBe(200);
    expect(header.json()).toEqual({ environment: 'sandbox', simulation: true });
    const reviewer = { authorization: `Bearer ${signToken('k', { kind: 'reviewer', reviewerId: h.ids.opA })}` };
    expect((await app.inject({ url: '/api/payout/environment', headers: reviewer })).statusCode).toBe(200);
    await h.d.execute(sql`update operators set role = 'administrator' where id = ${h.ids.opA}`);
    const status = await app.inject({ url: '/api/engineering/status', headers: h.operator });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().payout_environment).toBe('sandbox');
  });

  /**
   * The demo runs on one administrator credential (op-1) and the owner has to
   * be able to see what it is debugging. So the administrator READS everything
   * finance reads, and can still change nothing: the widening is
   * `financeReadGuard` on GETs only, and every POST keeps `financeGuard`.
   *
   * The refusals below are the ones that were already there, by name. Nothing
   * in the schema moved — `payout_finance_in_transaction` (0018, 0031) and
   * `settle_generate_by_finance` are untouched, and this test's administrator
   * never reaches them because the route refuses first.
   */
  it('the administrator reads every finance view and is refused every finance action', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const admin = h.operator;
    const period = P1.start.toISOString();
    const attempt = (await h.mark()).json().attempt_id as string;
    const reads = [
      `/api/payout/batches/${period}`,
      `/api/payout/collectors/${h.ids.collector1}/income`,
      `/api/payout/collectors/${h.ids.collector1}/accounts`,
      `/api/payout/attempts/${attempt}`,
      `/api/settle/bills?period_start=${encodeURIComponent(period)}`,
      `/api/settle/bills/${h.bill}`,
    ];

    // The hole `financeGuard` was lifted to close stays closed: a plain counter
    // operator reads none of this. Only then does op-hcm become op-1.
    for (const url of reads) {
      expect((await app.inject({ url, headers: h.operator })).statusCode, url).toBe(403);
    }
    await h.d.execute(sql`update operators set role = 'administrator' where id = ${h.ids.opA}`);

    // Reads: the same answer finance gets, route by route.
    for (const url of reads) {
      const asAdmin = await app.inject({ url, headers: admin });
      const asFinance = await app.inject({ url, headers: h.finance });
      expect(asAdmin.statusCode, `${url}: ${asAdmin.body}`).toBe(200);
      expect(asAdmin.body, url).toBe(asFinance.body);
    }

    // Actions: refused, by the name they were already refused with.
    const before = await h.snapshot();
    const refusals: [string, Record<string, unknown>][] = [
      [`/api/payout/accounts`, { id: uid(), collector_id: h.ids.collector2, method: 'WALLET', declared_name: 'Nguyen Van B', phone: '0912345000' }],
      [`/api/payout/bills/${h.bill}/mark-paid`, { amount_vnd: 679, manual_reference: 'ADMIN-SHOULD-NOT-PAY' }],
      [`/api/payout/bills/${h.bill}/pay`, {}],
      [`/api/payout/batches/${period}/preflight`, {}],
      [`/api/payout/batches/${period}/run`, {}],
      [`/api/payout/attempts/${attempt}/resolve`, { outcome: 'failed', reason: 'administrator should not resolve' }],
    ];
    for (const [url, payload] of refusals) {
      const res = await app.inject({ method: 'POST', url, headers: admin, payload });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(403);
      expect(res.json().error, url).toBe('finance role required');
    }
    // An export is a file that leaves the building, so it stays finance's.
    expect((await app.inject({ url: `/api/payout/export/${period}`, headers: admin })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/settle/export.csv?period_start=${encodeURIComponent(period)}`, headers: admin })).statusCode).toBe(403);
    expect(await h.snapshot()).toBe(before);
  });

  it('wrong role cannot record a payment', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const before = await h.snapshot();
    expect((await h.mark(h.operator)).statusCode).toBe(403);
    expect(await h.snapshot()).toBe(before);
  });

  it('wrong amount refuses by name without an attempt', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const before = await h.snapshot();
    const res = await h.mark(h.finance, 680);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().constraint).toBe('payout_attempts_amount_check');
    expect(await h.snapshot()).toBe(before);
  });

  it('the verdict author cannot mark the bill paid even after becoming finance', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const [review] = await h.d.execute(sql`select episode_review_id from settlements limit 1`);
    await auditRow(h.d, h.ids, { action: 'episode.review', targetTable: 'episode_reviews', targetId: String(review!.episode_review_id), operatorId: h.ids.finA });
    const before = await h.snapshot();
    const res = await h.mark();
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().constraint).toBe('payout_reviewer_separation_of_duty');
    expect(await h.snapshot()).toBe(before);
  });

  it('unverified mark-paid refuses by name, preserves every row byte-for-byte and audits refusal', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1, { verifyStatus: 'unverified' });
    const before = await h.snapshot();
    const result = await h.mark();
    expect(result.statusCode, result.body).toBe(409);
    expect(result.json().constraint).toBe('payout_attempts_account_unverified');
    expect(await h.snapshot()).toBe(before);
    const audit = await h.d.execute(sql`select operator_id, reason from audit_events where action = 'bill.mark_paid.refused'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ operator_id: h.ids.finA, reason: 'payout_attempts_account_unverified' });
  });

  it('finance declares a destination that collector and finance read as unverified', async () => {
    const h = await setup();
    const declared = await app.inject({ method: 'POST', url: '/api/payout/accounts', headers: h.finance,
      payload: { id: uid(), collector_id: h.ids.collector1, method: 'WALLET', declared_name: 'Nguyen Van A', phone: '0912345678' } });
    expect(declared.statusCode, declared.body).toBe(201);
    const phone = await app.inject({ url: '/api/me/payout', headers: h.collector() });
    expect(phone.json()).toMatchObject({ status: 'awaiting', masked: '•••• 5678' });
    const console = await app.inject({ url: `/api/payout/batches/${P1.start.toISOString()}`, headers: h.finance });
    expect(console.statusCode, console.body).toBe(200);
    expect(console.json().bills[0].account).toMatchObject({ verify_status: 'unverified', declared_name: 'Nguyen Van A' });
    expect(console.json().bills[0].account.phone_masked).toContain('5678');
    expect(phone.body).not.toContain('0912345678');
  });
});
