import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RiskReader, RiskSummary } from '../../../src/payout/domain/risk.ts';
import { tick as reconTick, linesOfRun } from '../../../src/payout/recon/index.ts';
import { runBatch } from '../../../src/payout/worker/batch.ts';
import { tick, type TickOptions } from '../../../src/payout/worker/poll.ts';
import { closeDb, hasDb, truncate, useDatabase, violates } from '../../../../store/test/db.ts';
import { auditRow, insertAttemptAs, P0, P1, rows, seedAccount, seedBill, seedBills, seedFractionalBill, seedSettlement, uid } from '../domain/fixture.ts';
import {
  DAY,
  HOUR,
  attempt,
  attemptCount,
  attemptsOf,
  billTotal,
  count,
  harness,
  later,
  plantOrder,
  queries,
  settlementStates,
  ticketKinds,
  transfers,
  type Harness,
  type Headers,
} from './harness.ts';

/**
 * THE EDGE CASE SUITE — E01..E29 (payout brief, AGENT F, BUILD 4).
 *
 * Six families, as the brief names them: double-spend (E01–E06),
 * unknown-state (E07–E11), money-boundary (E12–E17), authority (E18–E21),
 * integrity (E22–E26), risk-interaction (E27–E29). The original brief's
 * per-case list was not on this machine; each case here is derived from the
 * family name and the VERIFY clauses of Parts 0, 2 and 3, and is named for
 * the "cannot happen" it treats as a test case.
 *
 * Every case runs Agent A's real client against Agent A's fake server, through
 * Agent B's routes, workers and triggers, and ends on two assertions: what
 * the database holds, and how many requests the fake received. Not one of
 * them modifies A's or B's source; where the system does not hold, the test
 * says so and is marked `.fails` with the finding.
 */

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('payout_recon_edges');

type Seeded = Harness & { bill1: string; bill2: string; account1: string; account2: string };

async function seeded(over: Parameters<typeof harness>[0] = {}, opts: Parameters<typeof harness>[1] = {}): Promise<Seeded> {
  const h = await harness(over, opts);
  const bills = await seedBills(h.d, h.ids);
  const account1 = await seedAccount(h.d, h.ids, 1);
  const account2 = await seedAccount(h.d, h.ids, 2);
  return { ...h, ...bills, account1, account2 };
}

const pay = (h: Harness, billId: string, who: Headers = h.finA) => h.send('POST', `/api/payout/bills/${billId}/pay`, who);
const markPaid = (h: Harness, billId: string, who: Headers, body: unknown) => h.send('POST', `/api/payout/bills/${billId}/mark-paid`, who, body);
const resolve = (h: Harness, attemptId: string, who: Headers, body: unknown) => h.send('POST', `/api/payout/attempts/${attemptId}/resolve`, who, body);
/** B's poller, always due: no jitter, no pause. */
const poll = (h: Harness, at: Date, extra: TickOptions = {}) => tick(h.d, h.client, at, { pauseMs: 0, jitter: () => 0, ...extra });
const po = (billId: string, seq: number) => `PO-${billId}-${seq}`;

describe.skipIf(!hasDb())('the edge-case suite, E01–E29, over a real socket to the fake ZaloPay', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  // =========================================================================
  // Double-spend: E01–E06

  describe('double-spend', () => {
    it('E01 two POST /pay at once for one bill: one attempt, one transfer-fund request, the loser refused by the row lock', async () => {
      const h = await seeded({}, { pool: 8 });
      try {
        const pair = await Promise.all([pay(h, h.bill1, h.finA), pay(h, h.bill1, h.finB)]);
        expect(pair.map((r) => r.statusCode).sort()).toEqual([201, 409]);
        expect(pair.find((r) => r.statusCode === 409)!.json().constraint).toBe('payout_attempts_previous_not_failed');
        expect(await attemptCount(h.d)).toBe(1);
        expect(transfers(h)).toHaveLength(1);
        expect(transfers(h)[0]!.body['partner_order_id']).toBe(po(h.bill1, 1));
        expect(transfers(h)[0]!.macValid).toBe(true);
      } finally {
        await h.close();
      }
    });

    /**
     * E02 — WHY THIS MAY NEVER REGRESS.
     *
     * A timeout on transfer-fund is the one failure in which this system does
     * not know whether money moved: the request left the process and the
     * answer never came back. ZaloPay has no webhook and no batch (Part 0,
     * F1/F2), so the only correct response is to record `unknown` and ASK —
     * query-txn — never to send again. A second send here is not a retry; it
     * is a second payment of the same bill to the same collector, and
     * ZaloPay's own -68 guard (F3) protects only a repeat of the SAME
     * partner_order_id, so anything that mints a new id on retry defeats it.
     *
     * Four layers are built so the second send cannot happen, and this is the
     * one test that exercises all four together over a real socket: the
     * client returns {kind:'unknown'} instead of throwing (A, client.ts); the
     * state machine maps UNKNOWN to `unknown` and only ever polls (B,
     * state.ts); the trigger refuses a second attempt while the first is not
     * `failed` (0012, payout_attempts_previous_not_failed); and the poller has
     * no call to transfer-fund at all (B, poll.ts). The final assertion —
     * exactly ONE transfer-fund request in the fake's log after the answer was
     * lost, after an operator asked to pay again, after the poller resolved
     * it — is the single most important assertion in the payout system. If it
     * ever fails, a collector was paid twice.
     */
    it('E02 transfer-fund hangs past the budget: unknown, polled, resolved, and NO second transfer is ever sent', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'hang', ms: 5_000 });
        const res = await pay(h, h.bill1);
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json()).toMatchObject({ status: 'unknown', result: 'UNKNOWN', partner_order_id: po(h.bill1, 1) });
        const id = res.json().attempt_id as string;
        expect(transfers(h)).toHaveLength(1);

        // The operator, seeing no answer, tries again. The database says no.
        const again = await pay(h, h.bill1);
        expect(again.statusCode).toBe(409);
        expect(again.json().constraint).toBe('payout_attempts_previous_not_failed');
        expect(transfers(h)).toHaveLength(1);

        // ZaloPay never created the order (the hang swallowed it): the poll finds nothing and fails nothing.
        let report = await poll(h, later(60_000));
        expect(report.outcomes[0]).toMatchObject({ outcome: 'unchanged', from: 'unknown', to: 'unknown' });
        expect(await attempt(h.d, id)).toMatchObject({ status: 'unknown', poll_count: 1 });

        // Now suppose it HAD created it and the socket died on the way back: the poll finds it and finishes it.
        plantOrder(h.fake, po(h.bill1, 1), 3, 2400, { orderId: 'zlp-lost-answer' });
        report = await poll(h, later(HOUR));
        expect(report.outcomes[0]).toMatchObject({ outcome: 'moved', from: 'unknown', to: 'processing' });
        h.fake.setOrderStatus(po(h.bill1, 1), 1);
        report = await poll(h, later(2 * HOUR));
        expect(report.outcomes[0]).toMatchObject({ outcome: 'moved', to: 'succeeded' });
        expect(await attempt(h.d, id)).toMatchObject({ status: 'succeeded', zlp_order_id: 'zlp-lost-answer', poll_count: 3 });
        expect(await attemptCount(h.d)).toBe(1);

        // The whole point.
        expect(transfers(h)).toHaveLength(1);
        expect(queries(h)).toHaveLength(3);
        expect(h.fake.orders.size).toBe(1);
      } finally {
        await h.close();
      }
    });

    it('E03 ZaloPay already holds the order (-68): treated as the idempotency working — polled, resolved, no error, one request', async () => {
      const h = await seeded();
      try {
        plantOrder(h.fake, po(h.bill1, 1), 3, 2400, { orderId: 'zlp-existing' });
        const res = await pay(h, h.bill1);
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json()).toMatchObject({ status: 'processing', result: 'DUPLICATE', sub_return_code: null });
        const id = res.json().attempt_id as string;
        expect(transfers(h)).toHaveLength(1);
        expect(await poll(h, later(60_000))).toMatchObject({ outcomes: [{ outcome: 'unchanged' }] });
        h.fake.setOrderStatus(po(h.bill1, 1), 1, 'ZP-existing');
        expect((await poll(h, later(HOUR))).outcomes[0]).toMatchObject({ outcome: 'moved', to: 'succeeded' });
        expect(await attempt(h.d, id)).toMatchObject({ status: 'succeeded', zlp_order_id: 'zlp-existing', zp_trans_id: 'ZP-existing' });
        expect(transfers(h)).toHaveLength(1);
        expect(await attemptCount(h.d)).toBe(1);
      } finally {
        await h.close();
      }
    });

    it('E04 a rejected attempt is retried as a NEW order: a new partner_order_id, never the old one again', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'sub', subCode: -1104 });
        const first = await pay(h, h.bill1);
        expect(first.json()).toMatchObject({ status: 'failed', sub_return_code: -1104, partner_order_id: po(h.bill1, 1) });
        const second = await pay(h, h.bill1);
        expect(second.statusCode, second.body).toBe(201);
        expect(second.json()).toMatchObject({ status: 'processing', partner_order_id: po(h.bill1, 2) });
        expect(transfers(h).map((t) => t.body['partner_order_id'])).toEqual([po(h.bill1, 1), po(h.bill1, 2)]);
        expect((await attemptsOf(h.d, h.bill1)).map((a) => [a['attempt_seq'], a['status']])).toEqual([
          [1, 'failed'],
          [2, 'processing'],
        ]);
        // The refused id never became an order; only the new one did.
        expect([...h.fake.orders.keys()]).toEqual([po(h.bill1, 2)]);
      } finally {
        await h.close();
      }
    });

    it('E05 the same batch run twice sends the period once: the second run has nothing payable and sends nothing', async () => {
      const h = await seeded();
      try {
        const first = await runBatch(h.d, h.client, h.actor('finA'), P1, { pauseMs: 0 });
        expect(first.sent.map((s) => s.billId)).toEqual([h.bill1, h.bill2]);
        expect(transfers(h)).toHaveLength(2);
        const second = await runBatch(h.d, h.client, h.actor('finA'), P1, { pauseMs: 0 });
        expect(second.sent).toEqual([]);
        expect(second.preflight).toMatchObject({ payable: 0, ok: false });
        expect(transfers(h)).toHaveLength(2);
        // Finish both through the poller, and run a third time: still nothing.
        for (const bill of [h.bill1, h.bill2]) h.fake.setOrderStatus(po(bill, 1), 1);
        await poll(h, later(HOUR));
        expect(await count(h.d, sql`select count(*) as n from payout_attempts where status = 'succeeded'`)).toBe(2);
        const third = await runBatch(h.d, h.client, h.actor('finA'), P1, { pauseMs: 0 });
        expect(third.sent).toEqual([]);
        expect(transfers(h)).toHaveLength(2);
        expect(await attemptCount(h.d)).toBe(2);
        // No ticket for either repeat run. `runBatch` raises TICKET.BATCH_REFUSED
        // only when the preflight refuses a period that still had something
        // payable in it; a period whose bills are all already paid has nothing to
        // refuse, so a re-run is silent rather than two tickets an operator has to
        // read and dismiss. That rule arrived with the batch-run route on
        // feat/payout-domain and is written above `runBatch`; this branch was cut
        // before it, and the expectation is updated to it here rather than in
        // either branch.
        expect(await ticketKinds(h.d)).toEqual([]);
      } finally {
        await h.close();
      }
    });

    it('E06 the manual rail and the API rail cannot both pay one bill, in either order', async () => {
      const h = await seeded();
      try {
        // Manual first, then API.
        const manual = await markPaid(h, h.bill1, h.finA, { manual_reference: 'VCB-0001', amount_vnd: 2400 });
        expect(manual.statusCode, manual.body).toBe(201);
        const api = await pay(h, h.bill1);
        expect(api.statusCode).toBe(409);
        expect(api.json().constraint).toBe('payout_already_paid');
        expect(transfers(h)).toHaveLength(0);
        // API first (processing), then manual.
        const api2 = await pay(h, h.bill2);
        expect(api2.statusCode, api2.body).toBe(201);
        const manual2 = await markPaid(h, h.bill2, h.finA, { manual_reference: 'VCB-0002', amount_vnd: 1200 });
        expect(manual2.statusCode).toBe(409);
        expect(manual2.json().constraint).toBe('payout_attempts_previous_not_failed');
        expect(await settlementStates(h.d, h.bill2)).toEqual(['bill_generated']);
        expect(await attemptCount(h.d)).toBe(2);
        expect(transfers(h)).toHaveLength(1);
      } finally {
        await h.close();
      }
    });
  });

  // =========================================================================
  // Unknown-state: E07–E11

  describe('unknown-state', () => {
    /**
     * E07 — WHY THIS MAY NEVER REGRESS.
     *
     * A socket reset in the middle of the response body is the worst of the
     * lost answers, because in this case the order WAS created: ZaloPay
     * accepted the transfer and was in the middle of saying so. From the
     * client's side it is indistinguishable from E02's "never arrived" — the
     * bytes stop either way — and that is the point: the client cannot tell,
     * so nothing built on the client may act as if it could. The one safe
     * move is `unknown` and a query. Sending again here is a certain double
     * payment, not a possible one, and -68 would only catch it if the id were
     * reused exactly. The last assertion is again the request count.
     */
    it('E07 connection reset mid-body on transfer-fund: unknown, found by the poll, finished, ONE request', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'reset' });
        const res = await pay(h, h.bill1);
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json()).toMatchObject({ status: 'unknown', result: 'UNKNOWN' });
        const id = res.json().attempt_id as string;
        // The fake created the order before the wire broke — as ZaloPay would have.
        expect(h.fake.orders.has(po(h.bill1, 1))).toBe(true);
        expect((await pay(h, h.bill1)).json().constraint).toBe('payout_attempts_previous_not_failed');
        expect((await poll(h, later(60_000))).outcomes[0]).toMatchObject({ outcome: 'moved', from: 'unknown', to: 'processing' });
        h.fake.setOrderStatus(po(h.bill1, 1), 1);
        expect((await poll(h, later(HOUR))).outcomes[0]).toMatchObject({ outcome: 'moved', to: 'succeeded' });
        expect(await attempt(h.d, id)).toMatchObject({ status: 'succeeded', poll_count: 2 });
        expect(transfers(h)).toHaveLength(1);
        expect(await attemptCount(h.d)).toBe(1);
      } finally {
        await h.close();
      }
    });

    it('E08 a 200 with a truncated JSON body: unknown, not failed; the order exists and the poll finishes it', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'truncated' });
        const res = await pay(h, h.bill1);
        expect(res.json()).toMatchObject({ status: 'unknown', result: 'UNKNOWN' });
        h.fake.setOrderStatus(po(h.bill1, 1), 1);
        expect((await poll(h, later(60_000))).outcomes[0]).toMatchObject({ outcome: 'moved', from: 'unknown', to: 'succeeded' });
        expect(await attempt(h.d, res.json().attempt_id)).toMatchObject({ status: 'succeeded', zp_trans_id: expect.stringMatching(/^ZP/) });
        expect(transfers(h)).toHaveLength(1);
        expect(await count(h.d, sql`select count(*) as n from payout_attempts where status = 'failed'`)).toBe(0);
      } finally {
        await h.close();
      }
    });

    it('E09 an HTTP 502 from something in front of ZaloPay: unknown; not found for days is a ticket, never a failure; found later, finished', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'http', status: 502, body: '<html>bad gateway</html>' });
        const res = await pay(h, h.bill1);
        expect(res.json()).toMatchObject({ status: 'unknown', result: 'UNKNOWN', sub_return_code: null });
        const id = res.json().attempt_id as string;
        for (let i = 1; i <= 5; i += 1) {
          expect((await poll(h, later(i * 10 * 60_000))).outcomes[0]).toMatchObject({ outcome: 'unchanged', to: 'unknown' });
        }
        expect(await attempt(h.d, id)).toMatchObject({ status: 'unknown', poll_count: 5 });
        expect(await ticketKinds(h.d)).toEqual(['TICKET.ORDER_NOT_FOUND']);
        // The proxy had forwarded it after all.
        plantOrder(h.fake, po(h.bill1, 1), 1, 2400);
        expect((await poll(h, later(HOUR))).outcomes[0]).toMatchObject({ outcome: 'moved', to: 'succeeded' });
        expect(transfers(h)).toHaveLength(1);
        expect(await count(h.d, sql`select count(*) as n from payout_attempts where status = 'failed'`)).toBe(0);
      } finally {
        await h.close();
      }
    });

    it('E10 status 4 parks in pending_zlp: thirty days of ticks, a raw update, and ZaloPay changing its mind move nothing — only the operator route with a reason', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'ok', status: 4 });
        const res = await pay(h, h.bill1);
        expect(res.json()).toMatchObject({ status: 'pending_zlp', result: 'ACCEPTED' });
        const id = res.json().attempt_id as string;

        for (let day = 1; day <= 30; day += 1) {
          const report = await poll(h, later(day * DAY));
          expect(report.candidates, `day ${day}`).toBe(0);
        }
        expect(queries(h)).toHaveLength(0);
        expect(await attempt(h.d, id)).toMatchObject({ status: 'pending_zlp', poll_count: 0, last_polled_at: null });

        // ZaloPay's back office settles it. Still nothing automatic moves it.
        h.fake.setOrderStatus(po(h.bill1, 1), 1);
        expect((await poll(h, later(31 * DAY))).candidates).toBe(0);
        await violates('payout_attempts_pending_operator_only', h.d.execute(sql`update payout_attempts set status = 'succeeded', poll_count = 99999 where id = ${id}`));
        expect(await attempt(h.d, id)).toMatchObject({ status: 'pending_zlp', poll_count: 0 });

        // The daily reconciliation sees it stuck, says so, and does not touch it either.
        const recon = await reconTick(h.d, h.client, later(4 * DAY), { pauseMs: 0 });
        expect(recon.summary.findings_by_kind).toEqual({ STUCK_PENDING: 1, THEY_SAY_PAID_WE_DONT: 1 });
        expect(await attempt(h.d, id)).toMatchObject({ status: 'pending_zlp', poll_count: 0 });
        expect(queries(h)).toHaveLength(recon.summary.queried + recon.summary.orphan_probes);

        // The operator route: no reason, 400; not finance, 403; finance with a reason, moved.
        expect((await resolve(h, id, h.finA, { outcome: 'succeeded' })).statusCode).toBe(400);
        expect((await resolve(h, id, h.opA, { outcome: 'succeeded', reason: 'x' })).statusCode).toBe(403);
        const moved = await resolve(h, id, h.finA, { outcome: 'succeeded', reason: 'ZaloPay ops ticket 4711: settled 2026-08-20', zp_trans_id: 'ZP-4711' });
        expect(moved.statusCode, moved.body).toBe(200);
        expect(await attempt(h.d, id)).toMatchObject({ status: 'succeeded', zp_trans_id: 'ZP-4711' });
        expect(transfers(h)).toHaveLength(1);
      } finally {
        await h.close();
      }
    });

    it('E11 a system error (-500) on transfer-fund is unknown, not failed; only an operator fails it, and the retry is a new order', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'sub', subCode: -500 });
        const res = await pay(h, h.bill1);
        expect(res.json()).toMatchObject({ status: 'unknown', result: 'SYSTEM', sub_return_code: -500 });
        const id = res.json().attempt_id as string;
        for (let i = 1; i <= 5; i += 1) await poll(h, later(i * 10 * 60_000));
        expect(await attempt(h.d, id)).toMatchObject({ status: 'unknown', poll_count: 5 });
        expect(await ticketKinds(h.d)).toEqual(['TICKET.ORDER_NOT_FOUND']);
        expect((await pay(h, h.bill1)).json().constraint).toBe('payout_attempts_previous_not_failed');
        expect(transfers(h)).toHaveLength(1);

        const failed = await resolve(h, id, h.finA, { outcome: 'failed', reason: 'ZaloPay ops confirm no order was created for PO-…-1' });
        expect(failed.statusCode, failed.body).toBe(200);
        const retry = await pay(h, h.bill1);
        expect(retry.statusCode, retry.body).toBe(201);
        expect(retry.json().partner_order_id).toBe(po(h.bill1, 2));
        expect(transfers(h).map((t) => t.body['partner_order_id'])).toEqual([po(h.bill1, 1), po(h.bill1, 2)]);
        expect([...h.fake.orders.keys()]).toEqual([po(h.bill1, 2)]);
      } finally {
        await h.close();
      }
    });
  });

  // =========================================================================
  // Money-boundary: E12–E17

  describe('money-boundary', () => {
    it('E12 a bank bill above 10,000,000 VND is refused by name, by the route and by the database, and is not split; 10,000,000 exactly passes the database', async () => {
      const h = await harness();
      try {
        const account2 = await seedAccount(h.d, h.ids, 2, { method: 'BANK_ACCOUNT' });
        const over = await seedBill(h.d, h.ids, 2, P1, ['10000001.0000'], '10000001.0000');
        const exact = await seedBill(h.d, h.ids, 2, P0, ['10000000.0000'], '10000000.0000');
        const res = await pay(h, over, h.finB);
        expect(res.statusCode).toBe(409);
        expect(res.json().constraint).toBe('payout_attempts_bank_ceiling');
        await violates('payout_attempts_bank_ceiling', insertAttemptAs(h.d, h.ids, h.ids.finB, { billId: over, accountId: account2, amountVnd: 10_000_001 }));
        expect(await attemptCount(h.d)).toBe(0);
        // The route refuses every bank transfer today: nobody holds the full account number (B's `receiverOf`).
        const atCeiling = await pay(h, exact, h.finB);
        expect(atCeiling.statusCode).toBe(409);
        expect(atCeiling.json().constraint).toBe('payout_bank_details_unavailable');
        // The database itself admits exactly the ceiling.
        await insertAttemptAs(h.d, h.ids, h.ids.finB, { billId: exact, accountId: account2, amountVnd: 10_000_000 });
        expect(await attemptCount(h.d)).toBe(1);
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('E13 a bank bill under 2,000 VND is refused by name; 2,000 exactly passes', async () => {
      const h = await harness();
      try {
        const account2 = await seedAccount(h.d, h.ids, 2, { method: 'BANK_CARD' });
        const under = await seedBill(h.d, h.ids, 2, P1, ['1999.0000'], '1999.0000');
        const floor = await seedBill(h.d, h.ids, 2, P0, ['2000.0000'], '2000.0000');
        const res = await pay(h, under, h.finB);
        expect(res.json().constraint).toBe('payout_attempts_bank_minimum');
        await violates('payout_attempts_bank_minimum', insertAttemptAs(h.d, h.ids, h.ids.finB, { billId: under, accountId: account2, amountVnd: 1_999 }));
        await insertAttemptAs(h.d, h.ids, h.ids.finB, { billId: floor, accountId: account2, amountVnd: 2_000 });
        expect(await attemptCount(h.d)).toBe(1);
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('E14 a wallet bill of 1 VND — the wallet minimum — goes out as exactly 1', async () => {
      const h = await harness();
      try {
        await seedAccount(h.d, h.ids, 1);
        const one = await seedBill(h.d, h.ids, 1, P0, ['1.0000'], '1.0000');
        const res = await pay(h, one);
        expect(res.statusCode, res.body).toBe(201);
        expect(transfers(h)).toHaveLength(1);
        expect(transfers(h)[0]!.body['amount']).toBe(1);
        expect(transfers(h)[0]!.receiver).toEqual({ m_u_id: 'mu-0001' });
        expect(Number((await attempt(h.d, res.json().attempt_id))['amount_vnd'])).toBe(1);
        expect(h.fake.orders.get(po(one, 1))!.amount).toBe(1);
      } finally {
        await h.close();
      }
    });

    it('E15 a fractional total (170.0004) is paid at its floor, 170, and 171 is refused by the database', async () => {
      const h = await harness();
      try {
        const account1 = await seedAccount(h.d, h.ids, 1);
        const fractional = await seedFractionalBill(h.d, h.ids);
        // Up is the direction that pays more than the review was worth.
        await violates('payout_attempts_amount_check', insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: fractional, accountId: account1, amountVnd: 171 }));
        const view = await h.send('GET', `/api/payout/batches/${P0.start.toISOString()}`, h.opA);
        expect((view.json().bills as { id: string; issues: string[]; amount_vnd: unknown }[]).find((b) => b.id === fractional)).toMatchObject({ issues: [], amount_vnd: 170 });
        const res = await pay(h, fractional);
        expect(res.statusCode, res.body).toBe(201);
        expect(transfers(h)).toHaveLength(1);
        expect(transfers(h)[0]!.body['amount']).toBe(170);
        expect(await attemptCount(h.d)).toBe(1);
        // The bill keeps its exact figure; only the transfer is whole dong.
        expect((await rows<{ t: string }>(h.d, sql`select total::text as t from bills where id = ${fractional}`))[0]!.t).toBe('170.0004');
      } finally {
        await h.close();
      }
    });

    it('E16 the wallet balance one dong short of total × 1.05 refuses the WHOLE batch; at exactly the margin it pays all of it', async () => {
      const h = await seeded();
      try {
        h.fake.defaultBalance = 3_779; // 3,600 × 1.05 = 3,780
        const short = await runBatch(h.d, h.client, h.actor('finA'), P1, { pauseMs: 0 });
        expect(short.preflight).toMatchObject({ ok: false, required_vnd: 3_780, balance_vnd: 3_779, shortfall_vnd: 1 });
        expect(short.sent).toEqual([]);
        expect(transfers(h)).toHaveLength(0);
        expect(h.fake.requests('balance')).toHaveLength(1);
        expect(await attemptCount(h.d)).toBe(0);
        expect(await ticketKinds(h.d)).toEqual(['TICKET.BATCH_REFUSED']);

        h.fake.defaultBalance = 3_780;
        const enough = await runBatch(h.d, h.client, h.actor('finA'), P1, { pauseMs: 0 });
        expect(enough.preflight.ok).toBe(true);
        expect(enough.sent.map((s) => s.billId)).toEqual([h.bill1, h.bill2]);
        expect(transfers(h).map((t) => t.body['amount'])).toEqual([2400, 1200]);
        expect(h.fake.requests('balance')).toHaveLength(2);
      } finally {
        await h.close();
      }
    });

    it('E17 the amount is the bill total, retyped and matched by the database; an amount ZaloPay later disagrees with is a reconciliation line, not an edit', async () => {
      const h = await seeded();
      try {
        const wrong = await markPaid(h, h.bill1, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2399 });
        expect(wrong.statusCode).toBe(409);
        expect(wrong.json().constraint).toBe('payout_attempts_amount_check');
        expect(await attemptCount(h.d)).toBe(0);
        expect(await settlementStates(h.d, h.bill1)).toEqual(['bill_generated', 'bill_generated']);
        await violates('payout_attempts_amount_check', insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill1, accountId: h.account1, amountVnd: 2401 }));

        h.fake.plan('transferFund', { kind: 'ok', status: 1 });
        const res = await pay(h, h.bill1);
        expect(res.json().status).toBe('succeeded');
        expect(transfers(h)[0]!.body['amount']).toBe(await billTotal(h.d, h.bill1));
        // Their books drift.
        h.fake.orders.get(po(h.bill1, 1))!.amount = 2401;
        const recon = await reconTick(h.d, h.client, later(HOUR), { pauseMs: 0 });
        expect(recon.summary.findings_by_kind).toEqual({ AMOUNT_MISMATCH: 1 });
        const [line] = await linesOfRun(h.d, recon.runId);
        expect(line).toMatchObject({ our_amount: '2400', their_amount: '2401', bill_id: h.bill1 });
        expect(await attempt(h.d, res.json().attempt_id)).toMatchObject({ status: 'succeeded', amount_vnd: '2400' });
        expect(transfers(h)).toHaveLength(1);
      } finally {
        await h.close();
      }
    });
  });

  // =========================================================================
  // Authority: E18–E21

  describe('authority', () => {
    it('E18 an operator without the finance role: 403 on every payout write, and the database refuses the same write made directly', async () => {
      const h = await seeded();
      try {
        expect((await pay(h, h.bill1, h.opA)).statusCode).toBe(403);
        expect((await markPaid(h, h.bill1, h.opA, { manual_reference: 'x', amount_vnd: 2400 })).statusCode).toBe(403);
        expect((await resolve(h, uid(), h.opA, { outcome: 'failed', reason: 'x' })).statusCode).toBe(403);
        expect(await attemptCount(h.d)).toBe(0);
        // Audited as the plain operator, or not audited at all (a worker, psql).
        await violates('payout_finance_required', insertAttemptAs(h.d, h.ids, h.ids.opA, { billId: h.bill1, accountId: h.account1, amountVnd: 2400 }));
        await violates('payout_finance_required', insertAttemptAs(h.d, h.ids, null, { billId: h.bill1, accountId: h.account1, amountVnd: 2400 }));
        expect(await attemptCount(h.d)).toBe(0);
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('E19 separation of duty: the operator who created the collector, or issued the bill, cannot pay it; another finance operator can', async () => {
      const h = await seeded();
      try {
        await auditRow(h.d, h.ids, { action: 'collector.create', targetTable: 'collectors', targetId: h.ids.collector1, operatorId: h.ids.finA });
        const self = await pay(h, h.bill1, h.finA);
        expect(self.statusCode).toBe(409);
        expect(self.json().constraint).toBe('payout_separation_of_duty');
        expect(await attemptCount(h.d)).toBe(0);
        expect(transfers(h)).toHaveLength(0);
        expect((await pay(h, h.bill1, h.finB)).statusCode).toBe(201);
        expect(transfers(h)).toHaveLength(1);

        await auditRow(h.d, h.ids, { action: 'bill.generate', targetTable: 'bills', targetId: h.bill2, operatorId: h.ids.finB });
        expect((await pay(h, h.bill2, h.finB)).json().constraint).toBe('payout_separation_of_duty');
        expect((await pay(h, h.bill2, h.finA)).statusCode).toBe(201);
        expect(transfers(h)).toHaveLength(2);
        expect(await attemptCount(h.d)).toBe(2);
      } finally {
        await h.close();
      }
    });

    it('E20 a worker — no operator, or an operator without a reason, or the wrong action — cannot move pending_zlp', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'ok', status: 4 });
        const id = (await pay(h, h.bill1)).json().attempt_id as string;
        const move = sql`update payout_attempts set status = 'failed' where id = ${id}`;
        await violates('payout_attempts_pending_operator_only', h.d.execute(move));
        await violates(
          'payout_attempts_pending_operator_only',
          h.d.transaction(async (tx) => {
            await tx.execute(move);
            await auditRow(tx, h.ids, { action: 'payout_attempt.resolve', targetTable: 'payout_attempts', targetId: id, operatorId: h.ids.finA });
          }),
        );
        await violates(
          'payout_attempts_pending_operator_only',
          h.d.transaction(async (tx) => {
            await tx.execute(move);
            await auditRow(tx, h.ids, { action: 'payout_attempt.create', targetTable: 'payout_attempts', targetId: id, operatorId: h.ids.finA, reason: 'a reason on the wrong action' });
          }),
        );
        expect((await poll(h, later(7 * DAY))).candidates).toBe(0);
        expect(await attempt(h.d, id)).toMatchObject({ status: 'pending_zlp' });
        expect(transfers(h)).toHaveLength(1);
        expect(queries(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('E21 the superseded route /api/settle/bills/:id/pay is closed to a non-finance operator by the database', async () => {
      const h = await seeded();
      try {
        const res = await h.send('POST', `/api/settle/bills/${h.bill1}/pay`, h.opA);
        expect(res.statusCode).not.toBe(200);
        expect(await settlementStates(h.d, h.bill1)).toEqual(['bill_generated', 'bill_generated']);
        expect(await count(h.d, sql`select count(*) as n from audit_events where action = 'bill.pay'`)).toBe(0);
        expect(await attemptCount(h.d)).toBe(0);
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    /**
     * Was `.fails`: the superseded route once recorded a manual payment for a
     * finance operator with no manual_reference and no payout_attempt.
     * Integration retired the route (2dbd0ff), so the seam is closed and the
     * test holds as written.
     */
    it('E21b the superseded route cannot record a manual payment without a reference, even for finance', async () => {
      const h = await seeded();
      try {
        const res = await h.send('POST', `/api/settle/bills/${h.bill1}/pay`, h.finB);
        expect(res.statusCode).not.toBe(200);
        expect(await settlementStates(h.d, h.bill1)).toEqual(['bill_generated', 'bill_generated']);
      } finally {
        await h.close();
      }
    });
  });

  // =========================================================================
  // Integrity: E22–E26

  describe('integrity', () => {
    it('E22 a succeeded attempt is immutable — API or manual — and no attempt is ever deleted', async () => {
      const h = await seeded();
      try {
        h.fake.plan('transferFund', { kind: 'ok', status: 1 });
        const api = (await pay(h, h.bill1)).json().attempt_id as string;
        const manual = (await markPaid(h, h.bill2, h.finA, { manual_reference: 'VCB-2', amount_vnd: 1200 })).json().attempt_id as string;
        for (const id of [api, manual]) {
          await violates('payout_attempts_succeeded_immutable', h.d.execute(sql`update payout_attempts set status = 'failed' where id = ${id}`));
          await violates('payout_attempts_succeeded_immutable', h.d.execute(sql`update payout_attempts set zp_trans_id = 'forged' where id = ${id}`));
          await violates('payout_attempts_identity_immutable', h.d.execute(sql`update payout_attempts set amount_vnd = 1 where id = ${id}`));
          await violates('payout_attempts_append_only', h.d.execute(sql`delete from payout_attempts where id = ${id}`));
        }
        await violates('payout_attempts_succeeded_immutable', h.d.execute(sql`update payout_attempts set manual_reference = 'other' where id = ${manual}`));
        expect(await count(h.d, sql`select count(*) as n from payout_attempts where status = 'succeeded'`)).toBe(2);
        expect(transfers(h)).toHaveLength(1);
      } finally {
        await h.close();
      }
    });

    it('E23 partner_order_id is computed by the database and is what went over the wire; a supplied one is refused', async () => {
      const h = await seeded();
      try {
        await violates('payout_attempts_identity_computed', insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill1, accountId: h.account1, amountVnd: 2400, partnerOrderId: `PO-${uid()}-1` }));
        await violates('payout_attempts_identity_computed', insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill1, accountId: h.account1, amountVnd: 2400, attemptSeq: 7 }));
        await violates('payout_attempts_identity_computed', insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill1, accountId: h.account1, amountVnd: 2400, partnerOrderId: `PO-${h.bill1}-2` }));
        expect(await attemptCount(h.d)).toBe(0);
        const res = await pay(h, h.bill1);
        expect(res.json().partner_order_id).toBe(po(h.bill1, 1));
        expect(transfers(h)[0]!.body['partner_order_id']).toBe(po(h.bill1, 1));
        expect((await attempt(h.d, res.json().attempt_id))['partner_order_id']).toBe(po(h.bill1, 1));
        // A polled failure, then the next: sequence 2, on the wire and in the row.
        h.fake.setOrderStatus(po(h.bill1, 1), 2);
        await poll(h, later(HOUR));
        const next = await pay(h, h.bill1);
        expect(next.json().partner_order_id).toBe(po(h.bill1, 2));
        expect(transfers(h).map((t) => t.body['partner_order_id'])).toEqual([po(h.bill1, 1), po(h.bill1, 2)]);
      } finally {
        await h.close();
      }
    });

    it('E24 an issued bill and its lines are frozen, so the amount an attempt must equal cannot be moved underneath it', async () => {
      const h = await seeded();
      try {
        await violates('bills_issued_immutable', h.d.execute(sql`update bills set total = 9999.0000 where id = ${h.bill1}`));
        await violates('bills_issued_immutable', h.d.execute(sql`update bills set collector_id = ${h.ids.collector2} where id = ${h.bill1}`));
        await violates(
          'settlements_amount_immutable_check',
          h.d.execute(sql`update settlements set amount = 1.0000 where id in (select settlement_id from bill_lines where bill_id = ${h.bill1})`),
        );
        const other = await seedSettlement(h.d, h.ids, 2, '1200.0000');
        await violates('bill_lines_owner_guard', h.d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${h.bill1}, ${other.settlementId})`));
        expect(await billTotal(h.d, h.bill1)).toBe(2400);
        const res = await pay(h, h.bill1);
        expect(res.statusCode, res.body).toBe(201);
        expect(transfers(h)[0]!.body['amount']).toBe(2400);
      } finally {
        await h.close();
      }
    });

    it('E25 the ledgers are append-only: payout_events, payout_exports, and recon_lines refuse every edit and delete', async () => {
      const h = await seeded();
      try {
        await pay(h, h.bill1);
        const [ev] = await rows<{ id: number }>(h.d, sql`select id from payout_events limit 1`);
        await violates('append-only', h.d.execute(sql`update payout_events set kind = 'ATTEMPT.FORGED' where id = ${ev!.id}`));
        await violates('append-only', h.d.execute(sql`delete from payout_events where id = ${ev!.id}`));
        const exported = await h.send('GET', `/api/payout/export/${P1.start.toISOString()}`, h.finA);
        expect(exported.statusCode, exported.body).toBe(200);
        const [ex] = await rows<{ id: string }>(h.d, sql`select id from payout_exports`);
        await violates('append-only', h.d.execute(sql`update payout_exports set row_count = 0 where id = ${ex!.id}`));
        await violates('append-only', h.d.execute(sql`delete from payout_export_rows where export_id = ${ex!.id}`));
        // The reconciliation's own lines: written once, resolved once, by a person.
        h.fake.orders.get(po(h.bill1, 1))!.amount = 1;
        const recon = await reconTick(h.d, h.client, later(HOUR), { pauseMs: 0 });
        const [line] = await linesOfRun(h.d, recon.runId);
        expect(line!.discrepancy_kind).toBe('AMOUNT_MISMATCH');
        await violates('recon_lines_append_only', h.d.execute(sql`update recon_lines set their_amount = 2400 where id = ${line!.id}`));
        await violates('recon_lines_append_only', h.d.execute(sql`delete from recon_lines where id = ${line!.id}`));
        await violates('recon_lines_resolved_by_operator', h.d.execute(sql`update recon_lines set resolved_at = now(), resolved_by = ${h.ids.finA}, resolve_reason = 'script' where id = ${line!.id}`));
        expect(transfers(h)).toHaveLength(1);
      } finally {
        await h.close();
      }
    });

    it('E26 a change and its audit row commit together or not at all; an export, once hashed, cannot gain a row', async () => {
      const h = await seeded();
      try {
        // One line of the bill moves to exception between the operator's screen and their click.
        const [first] = await rows<{ settlement_id: string }>(h.d, sql`select settlement_id from bill_lines where bill_id = ${h.bill1} order by settlement_id limit 1`);
        // Since 0016_settlement_exception a parked row states where it came
        // from and why, or `settlements_exception_shape_check` refuses it.
        await h.d.execute(sql`update settlements set settlement_state = 'exception', exception_from_state = settlement_state, exception_reason = 'manual_hold', updated_at = now() where id = ${first!.settlement_id}`);
        const res = await markPaid(h, h.bill1, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2400 });
        // Before 0016 this reached the manual rail, tripped `bill_lines_payable_check`
        // inside the transaction and came back as an unnamed 500 that had rolled
        // back. `refusalFor` is now asked by the manual rail too, so the same input
        // is refused by name before anything is written. Nothing written either way,
        // which is what this case is here to prove.
        expect(res.statusCode).toBe(409);
        expect(res.json().constraint).toBe('payout_settlement_exception');
        expect(await attemptCount(h.d)).toBe(0);
        expect(await count(h.d, sql`select count(*) as n from audit_events where action = 'bill.mark_paid'`)).toBe(0);
        expect((await settlementStates(h.d, h.bill1)).sort()).toEqual(['bill_generated', 'exception']);

        const exported = await h.send('GET', `/api/payout/export/${P1.start.toISOString()}`, h.finA);
        expect(exported.statusCode, exported.body).toBe(200);
        const [ex] = await rows<{ id: string; row_count: number }>(h.d, sql`select id, row_count from payout_exports`);
        expect(ex!.row_count).toBe(2);
        const extra = await seedBill(h.d, h.ids, 1, P0, ['1200.0000'], '1200.0000');
        await violates('payout_export_rows_sealed', h.d.execute(sql`insert into payout_export_rows (export_id, bill_id, row_hash) values (${ex!.id}, ${extra}, repeat('0', 64))`));
        expect(await count(h.d, sql`select count(*) as n from payout_export_rows where export_id = ${ex!.id}`)).toBe(2);
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });
  });

  // =========================================================================
  // Risk-interaction: E27–E29

  describe('risk-interaction', () => {
    const reader = (band: RiskSummary['band']): RiskReader & { band: RiskSummary['band'] } => ({
      band,
      async billSummary(billId) {
        return {
          subjectType: 'bill',
          subjectId: billId,
          score: this.band === 'hold' ? 65 : 0,
          band: this.band,
          flags: this.band === 'hold' ? [{ signalId: 'IDENT.PHONE_SHARED', severity: 'hold', points: 65, evidence: { collectors: 2 }, thresholdVersion: 'v1', computedAt: new Date().toISOString() }] : [],
        };
      },
    });

    it('E27 a hold band refuses the attempt while holds are on, and only advises while they are off — the pilot default', async () => {
      const on = await seeded({ risk: reader('hold'), holdsEnabled: true });
      try {
        const res = await pay(on, on.bill1);
        expect(res.statusCode).toBe(409);
        expect(res.json().constraint).toBe('payout_risk_hold');
        const view = await on.send('GET', `/api/payout/batches/${P1.start.toISOString()}`, on.opA);
        expect((view.json().bills as { id: string; issues: string[]; risk: RiskSummary }[]).find((b) => b.id === on.bill1)).toMatchObject({ issues: ['risk_hold'], risk: { band: 'hold', score: 65 } });
        expect(await attemptCount(on.d)).toBe(0);
        expect(transfers(on)).toHaveLength(0);
      } finally {
        await on.close();
      }
      await truncate();
      const off = await seeded({ risk: reader('hold'), holdsEnabled: false });
      try {
        const view = await off.send('GET', `/api/payout/batches/${P1.start.toISOString()}`, off.opA);
        expect((view.json().bills as { id: string; issues: string[]; risk: RiskSummary }[]).find((b) => b.id === off.bill1)).toMatchObject({ issues: [], risk: { band: 'hold' } });
        const res = await pay(off, off.bill1);
        expect(res.statusCode, res.body).toBe(201);
        expect(transfers(off)).toHaveLength(1);
      } finally {
        await off.close();
      }
    });

    it('E28 a hold is reversible: cleared, the bill pays normally, once', async () => {
      const risk = reader('hold');
      const h = await seeded({ risk, holdsEnabled: true });
      try {
        expect((await pay(h, h.bill1)).json().constraint).toBe('payout_risk_hold');
        expect(transfers(h)).toHaveLength(0);
        risk.band = 'clear';
        const res = await pay(h, h.bill1);
        expect(res.statusCode, res.body).toBe(201);
        expect(await attemptCount(h.d)).toBe(1);
        expect(transfers(h)).toHaveLength(1);
        // Held again afterwards changes nothing about what was already sent, and admits nothing new.
        risk.band = 'hold';
        expect((await pay(h, h.bill1)).json().constraint).toBe('payout_risk_hold');
        expect(transfers(h)).toHaveLength(1);
      } finally {
        await h.close();
      }
    });

    it('E29 a name mismatch at declaration keeps both names, tells the risk engine, and is not paid; the declared name is never corrected', async () => {
      const h = await harness();
      try {
        const { bill1, bill2 } = await seedBills(h.d, h.ids);
        h.fake.plan('verifyAccount', { kind: 'ok', name: 'NGUYEN VAN B' });
        const declared = { id: uid(), collector_id: h.ids.collector1, method: 'BANK_ACCOUNT', declared_name: 'Nguyễn Văn A', bank_code: 'VCB', account_no: '00112233445566' };
        const res = await h.send('POST', '/api/payout/accounts', h.finA, declared);
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json()).toMatchObject({ verify_status: 'name_mismatch', declared_name: 'Nguyễn Văn A', verified_name: 'NGUYEN VAN B', account_no_last4: '5566' });
        expect(h.fake.requests('verifyAccount')).toHaveLength(1);
        expect(h.fake.requests('verifyAccount')[0]!.receiver).toEqual({ bank_code: 'VCB', account_no: '00112233445566', account_holder_name: 'Nguyễn Văn A' });
        const [row] = await rows<Record<string, unknown>>(h.d, sql`select * from payout_accounts where id = ${declared.id}`);
        expect(row).toMatchObject({ verify_status: 'name_mismatch', declared_name: 'Nguyễn Văn A', verified_name: 'NGUYEN VAN B', is_current: true, account_no_last4: '5566' });
        const events = await rows<{ kind: string; evidence: Record<string, unknown> }>(h.d, sql`select kind, evidence from payout_events where payout_account_id = ${declared.id}`);
        expect(events.map((e) => e.kind)).toEqual(['IDENT.NAME_MISMATCH']);
        expect(events[0]!.evidence).toMatchObject({ declared_name: 'Nguyễn Văn A', verified_name: 'NGUYEN VAN B' });

        const paid = await pay(h, bill1);
        expect(paid.statusCode).toBe(409);
        expect(paid.json().constraint).toBe('payout_account_unverified');
        expect(await attemptCount(h.d)).toBe(0);

        // -1104 from ZaloPay is the same signal, on the wallet route.
        h.fake.plan('verifyAccount', { kind: 'sub', subCode: -1104 });
        const wallet = await h.send('POST', '/api/payout/accounts', h.finA, { id: uid(), collector_id: h.ids.collector2, method: 'WALLET', declared_name: 'Tran Thi C', phone: '0987654321' });
        expect(wallet.json()).toMatchObject({ verify_status: 'name_mismatch', sub_return_code: -1104 });
        expect((await pay(h, bill2)).json().constraint).toBe('payout_account_unverified');
        expect(await count(h.d, sql`select count(*) as n from payout_events where kind = 'IDENT.NAME_MISMATCH'`)).toBe(2);
        expect(transfers(h)).toHaveLength(0);
        expect(h.fake.requests('verifyAccount')).toHaveLength(2);
      } finally {
        await h.close();
      }
    });
  });
});
