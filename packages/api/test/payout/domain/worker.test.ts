import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { open } from '@playerone/store';
import type { Actor } from '../../../src/actor.ts';
import { tick } from '../../../src/payout/worker/poll.ts';
import { runBatch } from '../../../src/payout/worker/batch.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase } from '../../../../store/test/db.ts';
import {
  attemptRow,
  countOf,
  insertAttemptAs,
  P1,
  rows,
  seedAccount,
  seedBills,
  seedPayout,
  type Ids,
} from './fixture.ts';
import { StubZaloPay } from './stub-client.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('payout_worker');

const DAY = 24 * 60 * 60_000;

describe.skipIf(!hasDb())('the payout workers', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function seeded() {
    const d = await db();
    const ids = await seedPayout(d);
    const { bill1, bill2 } = await seedBills(d, ids);
    const account1 = await seedAccount(d, ids, 1);
    const account2 = await seedAccount(d, ids, 2);
    return { d, ids, bill1, bill2, account1, account2 };
  }

  /** An attempt in `status`, walked there along legal edges, created at `createdAt`. */
  async function attemptIn(
    d: Awaited<ReturnType<typeof db>>,
    ids: Ids,
    billId: string,
    accountId: string,
    status: 'submitted' | 'processing' | 'unknown' | 'pending_zlp',
    createdAt = new Date(),
  ): Promise<string> {
    const [bill] = await rows<{ total: string }>(d, sql`select total::text as total from bills where id = ${billId}`);
    const id = await insertAttemptAs(d, ids, ids.finA, { billId, accountId, amountVnd: Number(bill!.total), createdAt });
    await d.execute(sql`update payout_attempts set status = 'submitted' where id = ${id}`);
    if (status !== 'submitted') await d.execute(sql`update payout_attempts set status = ${status} where id = ${id}`);
    return id;
  }

  const finA = (ids: Ids): Actor => ({
    machine: { kind: 'machine', uploadDeviceId: ids.machineA, uploadCentreId: ids.centreA },
    operator: { kind: 'operator', operatorId: ids.finA, uploadCentreId: ids.centreA },
  });

  // -------------------------------------------------------------------------

  describe('the poller', () => {
    it('records every poll, backs off, and moves the attempt when ZaloPay answers', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const created = new Date();
      const id = await attemptIn(d, ids, bill1, account1, 'submitted', created);
      const stub = new StubZaloPay();
      stub.query = (po, nth) =>
        nth < 3
          ? { kind: 'found', status: 3, zlpOrderId: `zlp-${po}`, zpTransId: null, amountVnd: null, resultUrl: null }
          : { kind: 'found', status: 1, zlpOrderId: `zlp-${po}`, zpTransId: `zp-${po}`, amountVnd: 2400, resultUrl: null };
      const half = () => 0.5;

      // Due 2.5 s after creation (5 s × 0.5). Not before.
      let report = await tick(d, stub, new Date(created.getTime() + 1_000), { jitter: half, pauseMs: 0 });
      expect(report.outcomes[0]!.outcome).toBe('not_due');
      expect(stub.calls.queryTransaction).toBe(0);

      report = await tick(d, stub, new Date(created.getTime() + 3_000), { jitter: half, pauseMs: 0 });
      expect(report.outcomes[0]).toMatchObject({ outcome: 'moved', from: 'submitted', to: 'processing' });
      let row = await attemptRow(d, id);
      expect(row).toMatchObject({ status: 'processing', poll_count: 1, zlp_order_id: `zlp-PO-${bill1}-1` });
      expect(row['last_polled_at']).not.toBeNull();

      // Next: 15 s × 0.5 after that poll.
      const polledAt = new Date(row['last_polled_at'] as string);
      report = await tick(d, stub, new Date(polledAt.getTime() + 5_000), { jitter: half, pauseMs: 0 });
      expect(report.outcomes[0]!.outcome).toBe('not_due');
      report = await tick(d, stub, new Date(polledAt.getTime() + 8_000), { jitter: half, pauseMs: 0 });
      expect(report.outcomes[0]).toMatchObject({ outcome: 'unchanged', from: 'processing', to: 'processing' });
      expect((await attemptRow(d, id))['poll_count']).toBe(2);

      report = await tick(d, stub, new Date(polledAt.getTime() + 60_000), { jitter: half, pauseMs: 0 });
      expect(report.outcomes[0]).toMatchObject({ outcome: 'moved', to: 'succeeded' });
      row = await attemptRow(d, id);
      expect(row).toMatchObject({ status: 'succeeded', poll_count: 3, zp_trans_id: `zp-PO-${bill1}-1` });
      expect(row['settled_at']).not.toBeNull();

      // Terminal: no longer a candidate.
      report = await tick(d, stub, new Date(polledAt.getTime() + DAY), { jitter: half, pauseMs: 0 });
      expect(report.candidates).toBe(0);
      expect(stub.calls.queryTransaction).toBe(3);
      expect(stub.calls.transferFund).toBe(0);

      const trail = await rows<{ kind: string; evidence: Record<string, unknown> }>(d, sql`select kind, evidence from payout_events where payout_attempt_id = ${id} order by id`);
      expect(trail.map((e) => e.kind)).toEqual(['ATTEMPT.POLLED', 'ATTEMPT.POLLED', 'ATTEMPT.POLLED']);
      expect(trail[1]!.evidence).toMatchObject({ from: 'processing', to: 'processing', zlp_status: 3 });
      expect(trail[2]!.evidence).toMatchObject({ from: 'processing', to: 'succeeded', zlp_status: 1 });
    });

    it('never sends a transfer, whatever it finds', async () => {
      const { d, ids, bill1, bill2, account1, account2 } = await seeded();
      await attemptIn(d, ids, bill1, account1, 'unknown');
      await attemptIn(d, ids, bill2, account2, 'submitted');
      const stub = new StubZaloPay();
      stub.query = { kind: 'not_found' };
      for (let i = 0; i < 6; i += 1) {
        await tick(d, stub, new Date(Date.now() + i * DAY), { jitter: () => 0, pauseMs: 0 });
      }
      expect(stub.calls.transferFund).toBe(0);
      expect(stub.transfers).toEqual([]);
    });

    it('never touches pending_zlp', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await attemptIn(d, ids, bill1, account1, 'pending_zlp', new Date(Date.now() - 30 * DAY));
      const stub = new StubZaloPay();
      const report = await tick(d, stub, new Date(), { jitter: () => 0, pauseMs: 0 });
      expect(report.candidates).toBe(0);
      expect(stub.calls.queryTransaction).toBe(0);
      expect(await attemptRow(d, id)).toMatchObject({ status: 'pending_zlp', poll_count: 0 });
      expect(await countOf(d, sql`select count(*) as n from payout_events`)).toBe(0);
    });

    it('skips a row another instance holds, so two pollers never poll one attempt at once', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await attemptIn(d, ids, bill1, account1, 'processing');
      const stub = new StubZaloPay();
      const other = await open(dbUrl(), { max: 1 });
      try {
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holding = other.transaction(async (tx) => {
          await tx.execute(sql`select 1 from payout_attempts where id = ${id} for update`);
          await held;
        });
        // Give the lock time to be taken.
        await new Promise((r) => setTimeout(r, 200));
        const report = await tick(d, stub, new Date(Date.now() + DAY), { jitter: () => 0, pauseMs: 0 });
        expect(report.outcomes[0]!.outcome).toBe('locked');
        expect(stub.calls.queryTransaction).toBe(0);
        release();
        await holding;
      } finally {
        await other.close();
      }
      const report = await tick(d, stub, new Date(Date.now() + DAY), { jitter: () => 0, pauseMs: 0 });
      expect(report.outcomes[0]!.outcome).toBe('moved');
    });

    it('is idempotent across concurrent ticks: each due attempt is polled once', async () => {
      const { d, ids, bill1, bill2, account1, account2 } = await seeded();
      await attemptIn(d, ids, bill1, account1, 'processing');
      await attemptIn(d, ids, bill2, account2, 'processing');
      const stub = new StubZaloPay();
      const pooled = await open(dbUrl(), { max: 8 });
      try {
        const at = new Date(Date.now() + DAY);
        await Promise.all(Array.from({ length: 4 }, () => tick(pooled, stub, at, { jitter: () => 0, pauseMs: 0 })));
      } finally {
        await pooled.close();
      }
      expect(stub.calls.queryTransaction).toBe(2);
      expect(await countOf(d, sql`select count(*) as n from payout_attempts where status = 'succeeded' and poll_count = 1`)).toBe(2);
    });

    it('stops after seven days and raises one ticket, which no later tick repeats', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await attemptIn(d, ids, bill1, account1, 'unknown', new Date(Date.now() - 8 * DAY));
      await d.execute(sql`update payout_attempts set poll_count = 300, last_polled_at = now() - interval '1 day' where id = ${id}`);
      const stub = new StubZaloPay();
      for (let i = 0; i < 3; i += 1) {
        const report = await tick(d, stub, new Date(Date.now() + i * 60_000), { jitter: () => 0, pauseMs: 0 });
        expect(report.outcomes[0]!.outcome).toBe('exhausted');
      }
      expect(stub.calls.queryTransaction).toBe(0);
      const tickets = await rows<{ kind: string; evidence: Record<string, unknown> }>(d, sql`select kind, evidence from payout_events where payout_attempt_id = ${id}`);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]!.kind).toBe('TICKET.POLL_EXHAUSTED');
      expect(tickets[0]!.evidence['partner_order_id']).toBe(`PO-${bill1}-1`);
      expect(await attemptRow(d, id)).toMatchObject({ status: 'unknown', poll_count: 300 });
    });

    it('raises one ticket for an order ZaloPay cannot find, and never fails it', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const created = new Date(Date.now() - 60 * 60_000);
      const id = await attemptIn(d, ids, bill1, account1, 'unknown', created);
      const stub = new StubZaloPay();
      stub.query = { kind: 'not_found' };
      let at = created.getTime();
      for (let i = 0; i < 7; i += 1) {
        at += 10 * 60_000;
        await tick(d, stub, new Date(at), { jitter: () => 0, pauseMs: 0 });
      }
      expect(await attemptRow(d, id)).toMatchObject({ status: 'unknown', poll_count: 7 });
      const tickets = await rows<{ kind: string }>(d, sql`select kind from payout_events where payout_attempt_id = ${id} and kind like 'TICKET.%'`);
      expect(tickets.map((t) => t.kind)).toEqual(['TICKET.ORDER_NOT_FOUND']);
    });

    it('records a poll the client could not complete, and retries on schedule', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await attemptIn(d, ids, bill1, account1, 'processing');
      const stub = new StubZaloPay();
      stub.query = () => {
        throw new Error('ECONNRESET');
      };
      const report = await tick(d, stub, new Date(Date.now() + DAY), { jitter: () => 0, pauseMs: 0 });
      expect(report.outcomes[0]!.outcome).toBe('error');
      expect(await attemptRow(d, id)).toMatchObject({ status: 'processing', poll_count: 1 });
    });
  });

  // -------------------------------------------------------------------------

  describe('the batch', () => {
    it('refuses the whole batch when the balance is short: zero transfers, one ticket', async () => {
      const { d, ids } = await seeded();
      const stub = new StubZaloPay();
      stub.balanceVnd = 3_779; // 3,600 × 1.05 = 3,780
      const run = await runBatch(d, stub, finA(ids), P1, { pauseMs: 0 });
      expect(run.preflight.ok).toBe(false);
      expect(run.sent).toEqual([]);
      expect(stub.calls.transferFund).toBe(0);
      expect(await countOf(d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      const tickets = await rows<{ kind: string; evidence: Record<string, unknown> }>(d, sql`select kind, evidence from payout_events`);
      expect(tickets.map((t) => t.kind)).toEqual(['TICKET.BATCH_REFUSED']);
      expect(tickets[0]!.evidence).toMatchObject({ balance_vnd: 3_779, required_vnd: 3_780 });
    });

    it('pays sequentially in collector order when the balance covers it, and skips the bills with issues', async () => {
      const { d, ids, bill1, bill2 } = await seeded();
      const stub = new StubZaloPay();
      stub.balanceVnd = 3_780;
      const order: string[] = [];
      stub.transfer = (i) => {
        order.push(i.partnerOrderId);
        return { kind: 'accepted', zlpOrderId: `zlp-${i.partnerOrderId}`, status: 1 };
      };
      const run = await runBatch(d, stub, finA(ids), P1, { pauseMs: 0 });
      expect(run.preflight.ok).toBe(true);
      expect(run.sent.map((s) => s.billId)).toEqual([bill1, bill2]);
      expect(order).toEqual([`PO-${bill1}-1`, `PO-${bill2}-1`]);
      expect(run.stopped_at).toBeNull();
      expect(await countOf(d, sql`select count(*) as n from payout_attempts where status = 'succeeded'`)).toBe(2);
      // A second run has nothing payable: both bills are paid, nothing is sent.
      const again = await runBatch(d, stub, finA(ids), P1, { pauseMs: 0 });
      expect(again.preflight.payable).toBe(0);
      expect(again.sent).toEqual([]);
      expect(stub.calls.transferFund).toBe(2);
    });

    it('stops at the first failure and reports it', async () => {
      const { d, ids, bill1, bill2 } = await seeded();
      const stub = new StubZaloPay();
      stub.transfer = { kind: 'rejected', subCode: -107, retryable: false };
      const run = await runBatch(d, stub, finA(ids), P1, { pauseMs: 0 });
      expect(run.sent.map((s) => s.billId)).toEqual([bill1]);
      expect(run.stopped_at).toEqual({ billId: bill1, constraint: 'payout_transfer_rejected' });
      expect(stub.calls.transferFund).toBe(1);
      expect(await countOf(d, sql`select count(*) as n from payout_attempts where bill_id = ${bill2}`)).toBe(0);
    });
  });
});
