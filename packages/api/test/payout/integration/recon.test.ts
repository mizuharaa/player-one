import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { open } from '@playerone/store';
import type { Actor } from '../../../src/actor.ts';
import {
  RECON_TICKET_KIND,
  ingestStatement,
  linesOfRun,
  openLines,
  resolveLine,
  shadowDiff,
  shadowRun,
  tick,
} from '../../../src/payout/recon/index.ts';
import { writeLine, type Finding } from '../../../src/payout/recon/lines.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase, violates } from '../../../../store/test/db.ts';
import { auditRow, insertAttemptAs, P0, P1, rows, seedAccount, seedBill, uid } from '../domain/fixture.ts';
import {
  DAY,
  HOUR,
  P2,
  P3,
  P4,
  P5,
  attempt,
  count,
  harness,
  later,
  plantOrder,
  queries,
  seedBillsAtomic,
  ticketKinds,
  transfers,
  walkTo,
  type Harness,
} from './harness.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('payout_recon');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!hasDb())('reconciliation', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  // -------------------------------------------------------------------------

  describe('0015: the recon tables hold their own rules', () => {
    async function run(d: Awaited<ReturnType<typeof db>>): Promise<string> {
      const id = uid();
      await d.execute(sql`
        insert into recon_runs (id, period, period_start, period_end, source)
          values (${id}, '2026-08-17/2026-08-24', ${P1.start.toISOString()}::timestamptz, ${P1.end.toISOString()}::timestamptz, 'zalopay')
      `);
      return id;
    }
    async function line(d: Awaited<ReturnType<typeof db>>, runId: string, over: Partial<Record<string, string | null>> = {}): Promise<string> {
      const id = uid();
      await d.execute(sql`
        insert into recon_lines (id, run_id, bill_id, payout_attempt_id, partner_order_id, reference, our_status, their_status, our_amount, their_amount, discrepancy_kind)
          values (${id}, ${runId}, null, null, ${over['partner_order_id'] ?? null}::text, ${over['reference'] ?? 'VCB-1'}::text, 'succeeded', 'not_on_statement', 2400, null, ${over['kind'] ?? 'WE_SAY_PAID_THEY_DONT'})
      `);
      return id;
    }

    it('a run is started once, finished once, and never deleted', async () => {
      const d = await db();
      const id = await run(d);
      await d.execute(sql`update recon_runs set finished_at = now(), summary = '{"raised": 0}'::jsonb where id = ${id}`);
      await violates('recon_runs_sealed', d.execute(sql`update recon_runs set summary = '{"raised": 9}'::jsonb where id = ${id}`));
      await violates('recon_runs_sealed', d.execute(sql`update recon_runs set finished_at = null where id = ${id}`));
      const open2 = await run(d);
      await violates('recon_runs_sealed', d.execute(sql`update recon_runs set source = 'shadow' where id = ${open2}`));
      await violates('recon_runs_append_only', d.execute(sql`delete from recon_runs where id = ${open2}`));
      expect(await count(d, sql`select count(*) as n from recon_runs`)).toBe(2);
    });

    it('a line is born open and written once; nothing about what was found ever changes (F-43)', async () => {
      const d = await db();
      const ids = await (await import('../domain/fixture.ts')).seedPayout(d);
      const r = await run(d);
      const id = await line(d, r);
      // Born resolved, or born with a reason: refused.
      await violates(
        'recon_lines_born_open',
        d.execute(sql`insert into recon_lines (id, run_id, discrepancy_kind, reference, resolved_at, resolved_by, resolve_reason)
                        values (${uid()}, ${r}, 'AMOUNT_MISMATCH', 'X', now(), ${ids.finA}, 'no')`),
      );
      await violates(
        'recon_lines_born_open',
        d.execute(sql`insert into recon_lines (id, run_id, discrepancy_kind, reference, resolve_reason) values (${uid()}, ${r}, 'AMOUNT_MISMATCH', 'Y', 'a reason on an open line')`),
      );
      // The evidence: frozen.
      for (const change of [
        sql`our_amount = 1`,
        sql`their_status = '1'`,
        sql`discrepancy_kind = 'AMOUNT_MISMATCH'`,
        sql`detail = '{"edited": true}'::jsonb`,
        sql`run_id = ${await run(d)}`,
      ]) {
        await violates('recon_lines_append_only', d.execute(sql`update recon_lines set ${change} where id = ${id}`));
      }
      // F-43: the reason alone, on an open line — add, replace, erase — is refused.
      await violates('recon_lines_append_only', d.execute(sql`update recon_lines set resolve_reason = 'looks fine' where id = ${id}`));
      await violates('recon_lines_append_only', d.execute(sql`update recon_lines set resolve_reason = null where id = ${id}`));
      // A resolution missing its reason is refused by the CHECK; missing its person, likewise.
      await violates('recon_lines_resolution_check', d.execute(sql`update recon_lines set resolved_at = now(), resolved_by = ${ids.finA} where id = ${id}`));
      await violates('recon_lines_resolution_check', d.execute(sql`update recon_lines set resolved_at = now(), resolve_reason = 'x' where id = ${id}`));
      await violates('recon_lines_append_only', d.execute(sql`delete from recon_lines where id = ${id}`));
      expect(await rows(d, sql`select * from recon_lines where id = ${id}`)).toMatchObject([{ our_amount: '2400', resolved_at: null, resolve_reason: null }]);
    });

    it('a resolution is a finance operator with a typed reason in the audit trail, and nobody else', async () => {
      const d = await db();
      const ids = await (await import('../domain/fixture.ts')).seedPayout(d);
      const r = await run(d);
      const id = await line(d, r);
      const resolve = (by: string) => sql`update recon_lines set resolved_at = now(), resolved_by = ${by}, resolve_reason = 'confirmed with the bank' where id = ${id}`;
      // No audit row at all: what a worker or a script looks like.
      await violates('recon_lines_resolved_by_operator', d.execute(resolve(ids.finA)));
      // An audited operator who is not finance.
      await violates(
        'recon_lines_resolved_by_operator',
        d.transaction(async (tx) => {
          await tx.execute(resolve(ids.opA));
          await auditRow(tx, ids, { action: 'recon_line.resolve', targetTable: 'recon_lines', targetId: id, operatorId: ids.opA, reason: 'confirmed with the bank' });
        }),
      );
      // Finance, but the audit row names somebody else.
      await violates(
        'recon_lines_resolved_by_operator',
        d.transaction(async (tx) => {
          await tx.execute(resolve(ids.finB));
          await auditRow(tx, ids, { action: 'recon_line.resolve', targetTable: 'recon_lines', targetId: id, operatorId: ids.finA, reason: 'confirmed with the bank' });
        }),
      );
      // Finance, right person, wrong action or no reason on the trail.
      await violates(
        'recon_lines_resolved_by_operator',
        d.transaction(async (tx) => {
          await tx.execute(resolve(ids.finA));
          await auditRow(tx, ids, { action: 'bill.mark_paid', targetTable: 'recon_lines', targetId: id, operatorId: ids.finA, reason: 'confirmed with the bank' });
        }),
      );
      await violates(
        'recon_lines_resolved_by_operator',
        d.transaction(async (tx) => {
          await tx.execute(resolve(ids.finA));
          await auditRow(tx, ids, { action: 'recon_line.resolve', targetTable: 'recon_lines', targetId: id, operatorId: ids.finA });
        }),
      );
      expect((await rows<{ resolved_at: unknown }>(d, sql`select resolved_at from recon_lines where id = ${id}`))[0]!.resolved_at).toBeNull();
      // The real thing.
      await d.transaction(async (tx) => {
        await tx.execute(resolve(ids.finA));
        await auditRow(tx, ids, { action: 'recon_line.resolve', targetTable: 'recon_lines', targetId: id, operatorId: ids.finA, reason: 'confirmed with the bank' });
      });
      expect(await rows(d, sql`select resolved_by, resolve_reason from recon_lines where id = ${id}`)).toMatchObject([{ resolved_by: ids.finA, resolve_reason: 'confirmed with the bank' }]);
      // Resolved once. Not again, not reopened, not deleted.
      await violates('recon_lines_append_only', d.execute(sql`update recon_lines set resolve_reason = 'changed my mind' where id = ${id}`));
      await violates('recon_lines_append_only', d.execute(sql`update recon_lines set resolved_at = null, resolved_by = null, resolve_reason = null where id = ${id}`));
      await violates('recon_lines_append_only', d.execute(sql`delete from recon_lines where id = ${id}`));
    });

    it('holds one open line per discrepancy, nulls included, and lets a resolved one be raised afresh (F-44)', async () => {
      const d = await db();
      const ids = await (await import('../domain/fixture.ts')).seedPayout(d);
      const r = await run(d);
      const first = await line(d, r, { reference: 'VCB-7' });
      await violates('recon_lines_open_key', line(d, r, { reference: 'VCB-7' }));
      await violates('recon_lines_open_key', line(d, await run(d), { reference: 'VCB-7' }));
      // A different key is a different discrepancy.
      await line(d, r, { reference: 'VCB-8' });
      await line(d, r, { reference: 'VCB-7', kind: 'AMOUNT_MISMATCH' });
      await d.transaction(async (tx) => {
        await tx.execute(sql`update recon_lines set resolved_at = now(), resolved_by = ${ids.finA}, resolve_reason = 'bank confirmed' where id = ${first}`);
        await auditRow(tx, ids, { action: 'recon_line.resolve', targetTable: 'recon_lines', targetId: first, operatorId: ids.finA, reason: 'bank confirmed' });
      });
      await line(d, r, { reference: 'VCB-7' });
      expect(await count(d, sql`select count(*) as n from recon_lines`)).toBe(4);
    });

    it('two transactions raising the same discrepancy commit exactly one line and one ticket (F-44)', async () => {
      const d = await db();
      const r = await run(d);
      const f: Finding = {
        kind: 'THEY_SAY_PAID_WE_DONT',
        billId: null,
        payoutAttemptId: null,
        partnerOrderId: null,
        reference: 'STMT-42',
        ourStatus: null,
        theirStatus: 'statement',
        ourAmount: null,
        theirAmount: 500,
        detail: {},
      };
      const c1 = await open(dbUrl(), { max: 1 });
      const c2 = await open(dbUrl(), { max: 1 });
      try {
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        // Writer 1 inserts and then holds its transaction open.
        const first = c1.transaction(async (tx) => {
          const id = await writeLine(tx, r, f, new Date());
          await held;
          return id;
        });
        await sleep(300);
        // Writer 2 reads "no open line" (writer 1 has not committed), and its INSERT blocks on the index.
        let secondDone = false;
        const second = c2.transaction(async (tx) => {
          const id = await writeLine(tx, r, f, new Date());
          secondDone = true;
          return id;
        });
        await sleep(300);
        expect(secondDone).toBe(false);
        release();
        const [a, b] = await Promise.all([first, second]);
        expect(a).not.toBeNull();
        expect(b).toBeNull();
      } finally {
        await c1.close();
        await c2.close();
      }
      expect(await count(d, sql`select count(*) as n from recon_lines`)).toBe(1);
      expect(await count(d, sql`select count(*) as n from payout_events where kind = ${RECON_TICKET_KIND}`)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------

  /**
   * A corpus with one of everything planted, and three things that must NOT
   * be found: a clean attempt, a manual attempt, and a failure older than the
   * window.
   */
  async function corpus(h: Harness) {
    const { d, ids, fake } = h;
    const account1 = await seedAccount(d, ids, 1);
    const account2 = await seedAccount(d, ids, 2);
    const bill = (which: 1 | 2, period: { start: Date; end: Date }, total: string) => seedBill(d, ids, which, period, [total], total);
    const now = new Date();

    const A = await bill(1, P1, '2400.0000');
    const a = await walkTo(d, ids, { billId: A, accountId: account1, amountVnd: 2400, status: 'succeeded', zlpOrderId: 'zlp-A', zpTransId: 'zp-A' });
    plantOrder(fake, a.partnerOrderId, 2, 2400);

    const B = await bill(2, P1, '1200.0000');
    const b = await walkTo(d, ids, { billId: B, accountId: account2, amountVnd: 1200, status: 'processing', zlpOrderId: 'zlp-B' });
    plantOrder(fake, b.partnerOrderId, 1, 1200);

    const C = await bill(1, P0, '2400.0000');
    const c = await walkTo(d, ids, { billId: C, accountId: account1, amountVnd: 2400, status: 'succeeded', zlpOrderId: 'zlp-C', zpTransId: 'zp-C' });
    plantOrder(fake, c.partnerOrderId, 1, 2401);

    const D = await bill(2, P0, '1200.0000');
    const dd = await walkTo(d, ids, { billId: D, accountId: account2, amountVnd: 1200, status: 'failed', createdAt: new Date(now.getTime() - HOUR), settledAt: new Date(now.getTime() - HOUR) });
    plantOrder(fake, `PO-${D}-2`, 1, 1200);

    const E = await bill(1, P2, '2400.0000');
    const e = await walkTo(d, ids, { billId: E, accountId: account1, amountVnd: 2400, status: 'processing', createdAt: new Date(now.getTime() - 30 * HOUR), zlpOrderId: 'zlp-E' });
    plantOrder(fake, e.partnerOrderId, 3, 2400);

    const F = await bill(2, P2, '1200.0000');
    const f = await walkTo(d, ids, { billId: F, accountId: account2, amountVnd: 1200, status: 'pending_zlp', createdAt: new Date(now.getTime() - 4 * DAY), zlpOrderId: 'zlp-F' });
    plantOrder(fake, f.partnerOrderId, 4, 1200);

    const G = await bill(1, P3, '2400.0000');
    const g = await walkTo(d, ids, { billId: G, accountId: account1, amountVnd: 2400, status: 'succeeded', zlpOrderId: 'zlp-G', zpTransId: 'zp-G' });
    plantOrder(fake, g.partnerOrderId, 1, 2400);

    const Hm = await bill(2, P3, '1200.0000');
    const hm = await insertAttemptAs(d, ids, ids.finB, { billId: Hm, accountId: account2, amountVnd: 1200, mode: 'manual', manualReference: 'VCB-H', settledAt: now });

    const I = await bill(1, P4, '2400.0000');
    const i = await walkTo(d, ids, { billId: I, accountId: account1, amountVnd: 2400, status: 'failed', createdAt: new Date(now.getTime() - 9 * DAY), settledAt: new Date(now.getTime() - 8 * DAY) });

    // F-48: a provider order behind an attempt our ledger never sent, or closed.
    const J = await bill(2, P4, '1200.0000');
    const j = await walkTo(d, ids, { billId: J, accountId: account2, amountVnd: 1200, status: 'created' });
    plantOrder(fake, j.partnerOrderId, 3, 1200);

    const K = await bill(1, P5, '2400.0000');
    const kk = await walkTo(d, ids, { billId: K, accountId: account1, amountVnd: 2400, status: 'created' });
    plantOrder(fake, kk.partnerOrderId, 1, 2400);

    const L = await bill(2, P5, '1200.0000');
    const l = await walkTo(d, ids, { billId: L, accountId: account2, amountVnd: 1200, status: 'failed', createdAt: new Date(now.getTime() - 2 * HOUR), settledAt: new Date(now.getTime() - HOUR) });
    plantOrder(fake, l.partnerOrderId, 4, 1200);

    return { A, B, C, D, E, F, G, H: Hm, I, J, K, L, a, b, c, d: dd, e, f, g, h: hm, i, j, k: kk, l, account1, account2 };
  }

  /** The corpus's planted discrepancies: nine lines, over ten queried attempts and ten probes. */
  const PLANTED = 9;
  const PLANTED_BY_KIND = {
    WE_SAY_PAID_THEY_DONT: 1,
    THEY_SAY_PAID_WE_DONT: 2,
    AMOUNT_MISMATCH: 1,
    ORPHAN_AT_ZLP: 3,
    STALE_PROCESSING: 1,
    STUCK_PENDING: 1,
  };

  const snapshot = (d: Awaited<ReturnType<typeof db>>) =>
    rows<Record<string, unknown>>(d, sql`select id, status, poll_count, last_polled_at, settled_at, zp_trans_id, amount_vnd from payout_attempts order by id`);

  describe('the daily run over query-txn', () => {
    it('finds every planted discrepancy, raises one ticket each, resolves none, moves nothing, sends nothing', async () => {
      const h = await harness();
      try {
        const k = await corpus(h);
        const before = await snapshot(h.d);
        const now = new Date();

        const report = await tick(h.d, h.client, now, { pauseMs: 0 });

        expect(report.summary).toMatchObject({ attempts_considered: 10, queried: 10, unanswered: 0, locked: 0, raised: PLANTED, still_open: 0, orphan_probes: 10, never_sent: 2 });
        expect(report.summary.findings_by_kind).toEqual(PLANTED_BY_KIND);
        // The manual attempt and the eight-day-old failure were never asked about.
        const asked = report.attempts.map((x) => x.attemptId);
        expect(asked).not.toContain(k.h);
        expect(asked).not.toContain(k.i);
        expect(queries(h).map((q) => q.body['partner_order_id'])).not.toContain(`PO-${k.H}-1`);

        const lines = await linesOfRun(h.d, report.runId);
        const on = (billId: string) => lines.filter((l) => l.bill_id === billId);
        expect(on(k.A)).toMatchObject([{ discrepancy_kind: 'WE_SAY_PAID_THEY_DONT', payout_attempt_id: k.a.id, our_status: 'succeeded', their_status: '2', our_amount: '2400', their_amount: '2400' }]);
        expect(on(k.B)).toMatchObject([{ discrepancy_kind: 'THEY_SAY_PAID_WE_DONT', payout_attempt_id: k.b.id, our_status: 'processing', their_status: '1' }]);
        expect(on(k.C)).toMatchObject([{ discrepancy_kind: 'AMOUNT_MISMATCH', payout_attempt_id: k.c.id, our_amount: '2400', their_amount: '2401' }]);
        expect(on(k.D)).toMatchObject([{ discrepancy_kind: 'ORPHAN_AT_ZLP', payout_attempt_id: null, partner_order_id: `PO-${k.D}-2`, our_status: null, their_status: '1', their_amount: '1200' }]);
        expect(on(k.E)).toMatchObject([{ discrepancy_kind: 'STALE_PROCESSING', payout_attempt_id: k.e.id, our_status: 'processing', their_status: '3' }]);
        expect(on(k.F)).toMatchObject([{ discrepancy_kind: 'STUCK_PENDING', payout_attempt_id: k.f.id, our_status: 'pending_zlp', their_status: '4' }]);
        // F-48: never sent by us, held by them — in flight, or complete.
        expect(on(k.J)).toMatchObject([{ discrepancy_kind: 'ORPHAN_AT_ZLP', payout_attempt_id: k.j.id, our_status: 'created', their_status: '3', their_amount: '1200' }]);
        expect(on(k.K)).toMatchObject([{ discrepancy_kind: 'THEY_SAY_PAID_WE_DONT', payout_attempt_id: k.k.id, our_status: 'created', their_status: '1' }]);
        expect(on(k.L)).toMatchObject([{ discrepancy_kind: 'ORPHAN_AT_ZLP', payout_attempt_id: k.l.id, our_status: 'failed', their_status: '4' }]);
        expect(lines).toHaveLength(PLANTED);
        for (const l of lines) {
          expect(l.resolved_at).toBeNull();
          expect(l.resolved_by).toBeNull();
        }
        // The clean attempt has no line; nor does the failed one whose order is gone.
        expect(on(k.G)).toEqual([]);
        expect(lines.find((l) => l.payout_attempt_id === k.d.id)).toBeUndefined();

        // One ticket per line, in B's ledger, readable.
        const tickets = await rows<{ kind: string; bill_id: string | null; evidence: Record<string, unknown> }>(h.d, sql`select kind, bill_id, evidence from payout_events where kind like 'TICKET.%' order by id`);
        expect(tickets).toHaveLength(PLANTED);
        expect(new Set(tickets.map((t) => t.kind))).toEqual(new Set([RECON_TICKET_KIND]));
        expect(tickets.map((t) => t.evidence['discrepancy_kind']).sort()).toEqual(lines.map((l) => l.discrepancy_kind).sort());
        for (const t of tickets) expect(String(t.evidence['message'])).toMatch(/\d/);

        // Nothing on the ledger moved, and nothing was sent.
        expect(await snapshot(h.d)).toEqual(before);
        expect(transfers(h)).toHaveLength(0);
        expect(queries(h)).toHaveLength(20);
        const [runRow] = await rows<{ finished_at: unknown; summary: Record<string, unknown> }>(h.d, sql`select finished_at, summary from recon_runs where id = ${report.runId}`);
        expect(runRow!.finished_at).not.toBeNull();
        expect(runRow!.summary).toMatchObject({ raised: PLANTED });
      } finally {
        await h.close();
      }
    });

    it('re-raises nothing while a line is open, and raises it afresh once an operator resolves it', async () => {
      const h = await harness();
      try {
        const k = await corpus(h);
        const first = await tick(h.d, h.client, new Date(), { pauseMs: 0 });
        expect(first.summary.raised).toBe(PLANTED);
        const second = await tick(h.d, h.client, later(HOUR), { pauseMs: 0 });
        expect(second.summary).toMatchObject({ raised: 0, still_open: PLANTED });
        expect(await count(h.d, sql`select count(*) as n from recon_lines`)).toBe(PLANTED);
        expect(await count(h.d, sql`select count(*) as n from payout_events where kind = ${RECON_TICKET_KIND}`)).toBe(PLANTED);
        // No run resolved anything.
        expect((await openLines(h.d)).length).toBe(PLANTED);

        const lineA = (await linesOfRun(h.d, first.runId)).find((l) => l.bill_id === k.A)!;
        const out = await resolveLine(h.d, h.actor('finA'), lineA.id, 'ZaloPay ops confirmed the order failed; bill re-queued for manual payment');
        expect(out.kind).toBe('resolved');
        const third = await tick(h.d, h.client, later(2 * HOUR), { pauseMs: 0 });
        expect(third.summary).toMatchObject({ raised: 1, still_open: PLANTED - 1 });
        expect(third.summary.findings_by_kind).toEqual({ WE_SAY_PAID_THEY_DONT: 1 });
        expect(await count(h.d, sql`select count(*) as n from recon_lines`)).toBe(PLANTED + 1);
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('two runs at once compare each attempt at most once each and never double a line or a ticket', async () => {
      const h = await harness({}, { pool: 4 });
      const other = await open(dbUrl(), { max: 4 });
      try {
        await corpus(h);
        const at = new Date();
        const [r1, r2] = await Promise.all([tick(h.d, h.client, at, { pauseMs: 0 }), tick(other, h.client, at, { pauseMs: 0 })]);
        expect(r1.summary.raised + r2.summary.raised).toBe(PLANTED);
        expect(await count(h.d, sql`select count(*) as n from recon_lines`)).toBe(PLANTED);
        expect(await count(h.d, sql`select count(*) as n from payout_events where kind = ${RECON_TICKET_KIND}`)).toBe(PLANTED);
        expect(await count(h.d, sql`select count(*) as n from recon_runs where source = 'zalopay' and finished_at is not null`)).toBe(2);
        expect(queries(h).length).toBeLessThanOrEqual(40);
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await other.close();
        await h.close();
      }
    });

    it('learns nothing from a hung, reset or refused query-txn: no line, counted as unanswered, attempt untouched', async () => {
      const h = await harness();
      try {
        const account1 = await seedAccount(h.d, h.ids, 1);
        const { bill1 } = await seedBillsAtomic(h.d, h.ids);
        const a = await walkTo(h.d, h.ids, { billId: bill1, accountId: account1, amountVnd: 2400, status: 'processing', createdAt: new Date(Date.now() - 2 * DAY) });
        plantOrder(h.fake, a.partnerOrderId, 3, 2400);
        // The attempt's query hangs; the orphan probe's socket is reset.
        h.fake.plan('queryTxn', { kind: 'hang', ms: 5_000 }, { kind: 'reset' });
        const r = await tick(h.d, h.client, new Date(), { pauseMs: 0 });
        expect(r.summary).toMatchObject({ queried: 1, unanswered: 2, raised: 0 });
        h.fake.plan('queryTxn', { kind: 'sub', subCode: -402 }, { kind: 'sub', subCode: -503 });
        const r2 = await tick(h.d, h.client, new Date(), { pauseMs: 0 });
        expect(r2.summary).toMatchObject({ queried: 1, unanswered: 2, raised: 0 });
        expect(await count(h.d, sql`select count(*) as n from recon_lines`)).toBe(0);
        expect(await attempt(h.d, a.id)).toMatchObject({ status: 'processing', poll_count: 0 });
        // And once ZaloPay answers, the stale one is found.
        const r3 = await tick(h.d, h.client, new Date(), { pauseMs: 0 });
        expect(r3.summary.findings_by_kind).toEqual({ STALE_PROCESSING: 1 });
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });
  });

  // -------------------------------------------------------------------------

  describe('resolving a line', () => {
    it('is a finance operator with a reason, through the audit trail; a plain operator, a reviewer, or no reason is refused', async () => {
      const h = await harness();
      try {
        await corpus(h);
        const r = await tick(h.d, h.client, new Date(), { pauseMs: 0 });
        const [l] = await linesOfRun(h.d, r.runId);
        expect((await resolveLine(h.d, h.actor('opA'), l!.id, 'fine')).kind).toBe('refused');
        expect((await resolveLine(h.d, h.actor('opA'), l!.id, 'fine'))).toMatchObject({ constraint: 'recon_lines_resolved_by_operator' });
        const reviewer: Actor = { reviewer: { kind: 'reviewer', reviewerId: h.ids.opA } as never };
        expect((await resolveLine(h.d, reviewer, l!.id, 'fine')).kind).toBe('refused');
        expect((await resolveLine(h.d, h.actor('finA'), l!.id, '   ')).kind).toBe('refused');
        expect((await resolveLine(h.d, h.actor('finA'), uid(), 'fine')).kind).toBe('not_found');
        expect((await openLines(h.d)).length).toBe(PLANTED);

        const ok = await resolveLine(h.d, h.actor('finA'), l!.id, 'bank statement line 12 confirms it');
        expect(ok.kind).toBe('resolved');
        if (ok.kind === 'resolved') expect(ok.line).toMatchObject({ resolved_by: h.ids.finA, resolve_reason: 'bank statement line 12 confirms it' });
        const again = await resolveLine(h.d, h.actor('finA'), l!.id, 'again');
        expect(again.kind).toBe('already_resolved');
        if (again.kind === 'already_resolved') expect(again.line.resolve_reason).toBe('bank statement line 12 confirms it');
        expect((await openLines(h.d)).length).toBe(PLANTED - 1);
        const audit = await rows<{ reason: string; operator_id: string }>(h.d, sql`select reason, operator_id from audit_events where action = 'recon_line.resolve'`);
        expect(audit).toEqual([{ reason: 'bank statement line 12 confirms it', operator_id: h.ids.finA }]);
      } finally {
        await h.close();
      }
    });

    it('two operators resolving one line at once: the loser waits, sees the winner\'s resolution, and writes no audit row (F-47)', async () => {
      const h = await harness();
      const c1 = await open(dbUrl(), { max: 1 });
      const c2 = await open(dbUrl(), { max: 1 });
      try {
        await corpus(h);
        const r = await tick(h.d, h.client, new Date(), { pauseMs: 0 });
        const [l] = await linesOfRun(h.d, r.runId);
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        // The winner: finA holds the row locked and resolved, uncommitted.
        const winner = c1.transaction(async (tx) => {
          await tx.execute(sql`select id from recon_lines where id = ${l!.id} for update`);
          await tx.execute(sql`update recon_lines set resolved_at = now(), resolved_by = ${h.ids.finA}, resolve_reason = 'finA: bank confirmed' where id = ${l!.id}`);
          await auditRow(tx, h.ids, { action: 'recon_line.resolve', targetTable: 'recon_lines', targetId: l!.id, operatorId: h.ids.finA, reason: 'finA: bank confirmed' });
          await held;
        });
        await sleep(300);
        // The loser: finB, through the real path, blocks on the lock.
        let settled = false;
        const loser = resolveLine(c2, h.actor('finB'), l!.id, 'finB: looks fine').then((out) => {
          settled = true;
          return out;
        });
        await sleep(300);
        expect(settled).toBe(false);
        release();
        await winner;
        const out = await loser;
        // Not the stale open row: the winner's resolution, as committed.
        expect(out.kind).toBe('already_resolved');
        if (out.kind === 'already_resolved') {
          expect(out.line).toMatchObject({ resolved_by: h.ids.finA, resolve_reason: 'finA: bank confirmed' });
          expect(out.line.resolved_at).not.toBeNull();
        }
        const audit = await rows<{ operator_id: string; reason: string }>(h.d, sql`select operator_id, reason from audit_events where action = 'recon_line.resolve'`);
        expect(audit).toEqual([{ operator_id: h.ids.finA, reason: 'finA: bank confirmed' }]);
        expect(await rows(h.d, sql`select resolved_by, resolve_reason from recon_lines where id = ${l!.id}`)).toEqual([{ resolved_by: h.ids.finA, resolve_reason: 'finA: bank confirmed' }]);
      } finally {
        await c1.close();
        await c2.close();
        await h.close();
      }
    });
  });

  // -------------------------------------------------------------------------

  describe('a statement against the manual rail', () => {
    it('matches on amount, date and reference, and every unmatched thing in either direction is a line and a ticket', async () => {
      const h = await harness({}, { mode: 'manual' });
      try {
        await seedAccount(h.d, h.ids, 1);
        await seedAccount(h.d, h.ids, 2);
        const { bill1, bill2 } = await seedBillsAtomic(h.d, h.ids);
        const bill3 = await seedBill(h.d, h.ids, 1, P0, ['1200.0000'], '1200.0000');
        const paid = async (bill: string, who: Record<string, string>, ref: string, amount: number) => {
          const res = await h.send('POST', `/api/payout/bills/${bill}/mark-paid`, who, { manual_reference: ref, amount_vnd: amount });
          expect(res.statusCode, res.body).toBe(201);
          return res.json().attempt_id as string;
        };
        const m1 = await paid(bill1, h.finA, 'VCB 0001', 2400);
        const m2 = await paid(bill2, h.finA, 'VCB-0002', 1200);
        const m3 = await paid(bill3, h.finB, 'MOMO-3', 1200);
        const before = await snapshot(h.d);
        const now = new Date();
        const at = now.toISOString();
        const csv = [
          'Ngày giao dịch;Số tiền;Mã giao dịch;Nội dung',
          `${at};2.400;VCB0001;Chi tra c-0001`,
          `${at};1.100;VCB-0002;Chi tra c-0002`,
          `${at};500;VCB-0009;"Khong ro; ai"`,
          // F-49: an impossible date. Not the nearest real day; a line for a person.
          `31/02/2026;700;VCB-BAD;Ngay khong ton tai`,
        ].join('\r\n');

        const r = await ingestStatement(h.d, { start: new Date(now.getTime() - DAY), end: new Date(now.getTime() + DAY) }, csv, { now });
        expect(r.parsed.lines).toBe(3);
        expect(r.parsed.errors).toEqual([{ line: 5, reason: "unreadable date '31/02/2026'", reference: 'VCB-BAD', amountVnd: 700, raw: '31/02/2026;700;VCB-BAD;Ngay khong ton tai' }]);
        expect(r.matched).toBe(1);
        expect(r.raised).toBe(4);
        expect(r.findings_by_kind).toEqual({ AMOUNT_MISMATCH: 1, THEY_SAY_PAID_WE_DONT: 2, WE_SAY_PAID_THEY_DONT: 1 });

        const lines = await linesOfRun(h.d, r.runId);
        const one = (pred: (l: (typeof lines)[number]) => boolean) => {
          const hits = lines.filter(pred);
          expect(hits).toHaveLength(1);
          return hits[0]!;
        };
        expect(one((l) => l.discrepancy_kind === 'AMOUNT_MISMATCH')).toMatchObject({ bill_id: bill2, payout_attempt_id: m2, our_amount: '1200', their_amount: '1100', reference: 'VCB-0002' });
        expect(one((l) => l.reference === 'VCB-0009')).toMatchObject({ discrepancy_kind: 'THEY_SAY_PAID_WE_DONT', bill_id: null, payout_attempt_id: null, their_amount: '500', their_status: 'statement' });
        expect(one((l) => l.reference === 'VCB-BAD')).toMatchObject({ discrepancy_kind: 'THEY_SAY_PAID_WE_DONT', bill_id: null, their_amount: '700', their_status: 'unreadable', detail: { statement_line: 5, reason: "unreadable date '31/02/2026'" } });
        expect(one((l) => l.discrepancy_kind === 'WE_SAY_PAID_THEY_DONT')).toMatchObject({ bill_id: bill3, payout_attempt_id: m3, our_amount: '1200', reference: 'MOMO-3', their_status: 'not_on_statement' });
        expect(lines.find((l) => l.payout_attempt_id === m1)).toBeUndefined();
        expect(await ticketKinds(h.d)).toEqual([RECON_TICKET_KIND, RECON_TICKET_KIND, RECON_TICKET_KIND, RECON_TICKET_KIND]);
        const [runRow] = await rows<{ summary: Record<string, unknown> }>(h.d, sql`select summary from recon_runs where id = ${r.runId}`);
        expect(runRow!.summary).toMatchObject({ statement_lines: 3, manual_attempts: 3, matched: [{ attempt_id: m1, statement_line: 2 }] });

        // The ledger did not move; no ZaloPay call was made for a manual attempt.
        expect(await snapshot(h.d)).toEqual(before);
        expect(queries(h)).toHaveLength(0);
        expect(transfers(h)).toHaveLength(0);
        // Ingesting the same statement again raises nothing new.
        const again = await ingestStatement(h.d, { start: new Date(now.getTime() - DAY), end: new Date(now.getTime() + DAY) }, csv, { now });
        expect(again).toMatchObject({ raised: 0, still_open: 4 });
      } finally {
        await h.close();
      }
    });
  });

  // -------------------------------------------------------------------------

  describe('shadow mode', () => {
    it('records what the API rail would have sent while the mode is manual, and sends nothing', async () => {
      const h = await harness({}, { mode: 'manual' });
      try {
        const { bill1, bill2 } = await seedBillsAtomic(h.d, h.ids);
        await seedAccount(h.d, h.ids, 1);
        await seedAccount(h.d, h.ids, 2);
        const s = await shadowRun(h.d, h.client, P1, { now: new Date() });
        expect(s.preflight_ok).toBe(true);
        expect(s.balance_vnd).toBe(50_000_000);
        expect(s.intended.map((i) => [i.bill_id, i.would_send, i.amount_vnd])).toEqual([
          [bill1, true, 2400],
          [bill2, true, 1200],
        ]);
        expect(transfers(h)).toHaveLength(0);
        expect(h.fake.requests('balance')).toHaveLength(1);
        expect(await count(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
        const [runRow] = await rows<{ source: string; finished_at: unknown; summary: Record<string, unknown> }>(h.d, sql`select source, finished_at, summary from recon_runs where id = ${s.runId}`);
        expect(runRow).toMatchObject({ source: 'shadow', summary: { would_send: 2, would_send_total_vnd: 3600 } });
        expect(runRow!.finished_at).not.toBeNull();

        // The operator pays one of the two by hand. The diff names the other.
        const res = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2400 });
        expect(res.statusCode, res.body).toBe(201);
        const diff = await shadowDiff(h.d, s.runId);
        expect(diff).toMatchObject({ bills: 2, agreed: 1, raised: 1, findings_by_kind: { SHADOW_UNPAID: 1 } });
        const lines = await linesOfRun(h.d, diff.runId);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ discrepancy_kind: 'SHADOW_UNPAID', bill_id: bill2, our_status: 'would_send', their_status: 'no_attempt', our_amount: '2400'.replace('2400', '1200') });
        expect(await ticketKinds(h.d)).toEqual([RECON_TICKET_KIND]);
        expect(transfers(h)).toHaveLength(0);
        await expect(shadowDiff(h.d, diff.runId)).rejects.toThrow(/shadow_diff run, not a shadow run/);
      } finally {
        await h.close();
      }
    });

    it('names a manual payment the rail would have refused, with the reason it would have given', async () => {
      const h = await harness({}, { mode: 'manual' });
      try {
        const { bill1, bill2 } = await seedBillsAtomic(h.d, h.ids);
        await seedAccount(h.d, h.ids, 1);
        await seedAccount(h.d, h.ids, 2, { verifyStatus: 'unverified', mUId: null });
        const s = await shadowRun(h.d, h.client, P1, { now: new Date() });
        expect(s.intended.find((i) => i.bill_id === bill2)).toMatchObject({ would_send: false, issues: ['account_unverified'] });
        for (const [bill, amount] of [
          [bill1, 2400],
          [bill2, 1200],
        ] as const) {
          const res = await h.send('POST', `/api/payout/bills/${bill}/mark-paid`, h.finA, { manual_reference: `VCB-${amount}`, amount_vnd: amount });
          expect(res.statusCode, res.body).toBe(201);
        }
        const diff = await shadowDiff(h.d, s.runId);
        expect(diff).toMatchObject({ agreed: 1, raised: 1, findings_by_kind: { SHADOW_UNINTENDED: 1 } });
        const [l] = await linesOfRun(h.d, diff.runId);
        expect(l).toMatchObject({ discrepancy_kind: 'SHADOW_UNINTENDED', bill_id: bill2, their_status: 'manual:succeeded', reference: 'VCB-1200', detail: { issues: ['account_unverified'] } });
        expect(transfers(h)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });
  });
});
