import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../../src/index.ts';
import { signToken } from '../../src/credentials.ts';
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
    app = buildApi({ db: await appDb(), tokenSecret: 'k', payout: { zaloPayEnv: 'sandbox' } });
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

  it('fixture-verified payment records floored dong, reference and finance actor, then reads paid afresh', async () => {
    const h = await setup();
    await seedAccount(h.d, h.ids, 1);
    const res = await h.mark();
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ amount_vnd: 679, manual_reference: 'SIMULATION-REF-X', status: 'succeeded', simulation: true });
    const audits = await h.d.execute(sql`select operator_id from audit_events where action = 'bill.mark_paid'`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.operator_id).toBe(h.ids.finA);
    const payout = await app.inject({ url: '/api/me/payout', headers: h.collector() });
    expect(payout.json()).toMatchObject({ status: 'verified', simulation: true, payment: { reference: 'SIMULATION-REF-X', amount_vnd: 679 } });
    const income = await app.inject({ url: '/api/me/income', headers: h.collector() });
    expect(income.json().episodes[0]).toMatchObject({ state: 'paid', payment_reference: 'SIMULATION-REF-X' });
    const finance = await app.inject({ url: `/api/payout/batches/${P1.start.toISOString()}`, headers: h.finance });
    expect(finance.json().bills[0]).toMatchObject({ paid: true, simulation: true, attempt: { manual_reference: 'SIMULATION-REF-X' } });
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
