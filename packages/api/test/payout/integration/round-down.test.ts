import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EpisodeRecord } from '@playerone/contracts';
import { runBatch } from '../../../src/payout/worker/batch.ts';
import { closeDb, hasDb, truncate, useDatabase } from '../../../../store/test/db.ts';
import { episodeRecord } from '../../fixtures.ts';
import { P0, rows, seedAccount, seedBill } from '../domain/fixture.ts';
import { attempt, attemptCount, harness, transfers, type Harness } from './harness.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('round_down');

/**
 * Bill totals round down (Daniel, 2026-08-27), proved on a bill a reviewer
 * actually produced.
 *
 * Every review-lane bill is fractional. Seventeen seconds at 1,200 a minute is
 * `0.283333` minutes and `339.9996` dong, because the amount is computed from
 * the *rounded* minutes so that `unit_price × effective_minutes` reproduces
 * `amount` on the invoice. Two such episodes make a bill of `679.9992`, and
 * until the rounding rule was chosen nothing could turn that into the whole
 * dong a transfer moves — so no collector could be paid at all.
 *
 * EVERY figure in this file is chosen to separate DOWN from the alternatives.
 * `679.9992` floors to 679 and rounds half-away-from-zero to 680; `6799.9920`
 * floors to 6799 and rounds to 6800. A bill like `640.0008` would NOT do: it
 * gives 640 under either rule, so a test written on it stays green with the
 * floor removed and proves nothing about the rule it claims to pin. Three of
 * the four tests here were written that way and are now on 17-second episodes.
 * The check on any figure added later is the same one: does the assertion
 * change if `wholeVnd` and 0018 use `half-away` instead of `floor`.
 *
 * The floor is taken once, on the bill total, at the moment it becomes the
 * dong an attempt is for. It is NOT taken on the line: a line's amount is what
 * the invoice has to reproduce from its own price and minutes, and flooring
 * every line would lose up to a dong per line instead of up to a dong per bill.
 * `the rounding loss` below measures both.
 *
 * The fixture is the payout fixture, driven through the REAL routes: ingest,
 * review claim, review verdict, settle. Nothing here writes a settlement in
 * SQL, because the point is that the number the review lane produces is the
 * number that can now be paid.
 */

/** Seventeen seconds is `0.283333` minutes and `339.9996` — a fractional part just under a whole dong. */
const SEVENTEEN_SECONDS = 17;

const record = (seconds: number): EpisodeRecord =>
  episodeRecord({ measured: seconds, serial: 'AZER76400FE' });

/**
 * `count` episodes of `seconds` each, ingested on collector 1's card, reviewed
 * `good`, and billed. Returns the bill and its stored total.
 */
async function reviewedBill(
  h: Harness,
  count: number,
  seconds: number,
): Promise<{ billId: string; total: string; period: { start: Date; end: Date } }> {
  const submitted = await h.send('POST', `/upload-batches/${h.ids.batch1}/episodes`, h.opA, {
    episodes: Array.from({ length: count }, () => record(seconds)),
  });
  expect(submitted.statusCode, submitted.body).toBe(200);
  for (const e of submitted.json().episodes as { resolution_state: string }[]) {
    expect(e.resolution_state).toBe('resolved');
  }

  for (;;) {
    const claimed = await h.send('POST', '/api/review/claim', h.opA);
    if (claimed.statusCode === 204) break;
    expect(claimed.statusCode, claimed.body).toBe(200);
    const episode = claimed.json();
    const committed = await h.send('POST', '/api/review/verdict', h.opA, {
      verdict_id: randomUUID(),
      episode_id: episode.episode_id,
      decision: 'good',
      spans: [],
      reject_reasons: [],
    });
    expect(committed.statusCode, committed.body).toBe(200);
  }

  const cycle = await h.send('POST', '/api/settle/bills', h.opA, {
    period_start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  });
  expect(cycle.statusCode, cycle.body).toBe(200);
  const bills = cycle.json().bills as { id: string; collector_ref: string; total: string; lines: number }[];
  const bill = bills.find((b) => b.collector_ref === 'c-0001')!;
  expect(bill.lines).toBe(count);
  // The cycle's own window, not one recomputed from the clock: a batch period
  // that starts a millisecond later than the bill's does not contain the bill.
  const period = { start: new Date(cycle.json().period_start as string), end: new Date(cycle.json().period_end as string) };
  return { billId: bill.id, total: bill.total, period };
}

describe.skipIf(!hasDb())('a bill from a real review is payable, rounded down', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('the API rail sends the floor of the total: 679.9992 goes out as 679, not 680', async () => {
    const h = await harness();
    try {
      await seedAccount(h.d, h.ids, 1);
      const { billId, total } = await reviewedBill(h, 2, SEVENTEEN_SECONDS);
      expect(total).toBe('679.9992');

      const res = await h.send('POST', `/api/payout/bills/${billId}/pay`, h.finA);
      expect(res.statusCode, res.body).toBe(201);
      expect(transfers(h)).toHaveLength(1);
      expect(transfers(h)[0]!.body['amount']).toBe(679);
      expect(Number((await attempt(h.d, res.json().attempt_id))['amount_vnd'])).toBe(679);
      // The bill itself is untouched: it still states what the lines say.
      expect((await rows<{ t: string }>(h.d, sql`select total::text as t from bills where id = ${billId}`))[0]!.t).toBe('679.9992');
    } finally {
      await h.close();
    }
  });

  it('the manual rail records the same floor, 679, and refuses the rounded-up 680', async () => {
    const h = await harness({}, { mode: 'manual' });
    try {
      await seedAccount(h.d, h.ids, 1);
      const { billId, total } = await reviewedBill(h, 2, SEVENTEEN_SECONDS);
      expect(total).toBe('679.9992');

      const wrong = await h.send('POST', `/api/payout/bills/${billId}/mark-paid`, h.finA, {
        manual_reference: 'VCB-1',
        amount_vnd: 680,
      });
      expect(wrong.statusCode, wrong.body).toBe(409);
      expect(wrong.json().constraint).toBe('payout_attempts_amount_check');

      const ok = await h.send('POST', `/api/payout/bills/${billId}/mark-paid`, h.finA, {
        manual_reference: 'VCB-2',
        amount_vnd: 679,
      });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(Number((await attempt(h.d, ok.json().attempt_id))['amount_vnd'])).toBe(679);
      expect(transfers(h)).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it('the batch runner pays the same 679, and nothing is left in a preflight issue', async () => {
    const h = await harness();
    try {
      await seedAccount(h.d, h.ids, 1);
      const { billId, period } = await reviewedBill(h, 2, SEVENTEEN_SECONDS);
      const run = await runBatch(h.d, h.client, h.actor('finA'), period, { pauseMs: 0 });
      expect(run.refused).toEqual([]);
      expect(run.sent.map((s) => s.billId)).toEqual([billId]);
      expect(run.preflight.payable).toBe(1);
      expect(run.preflight.total_vnd).toBe(679);
      expect(await attemptCount(h.d)).toBe(1);
    } finally {
      await h.close();
    }
  });

  /**
   * The measurement that decides where the floor goes.
   *
   * Twenty seventeen-second episodes: each line is `339.9996`, so each line's
   * fractional part is 0.9996 — nearly a whole dong. Flooring the LINE would
   * lose 20 × 0.9996 = 19.992 dong on this bill and would grow with every
   * line. Flooring the TOTAL loses the fractional part of the sum, once.
   */
  it('the rounding loss is under one dong for the whole bill, not one per line', async () => {
    const h = await harness();
    try {
      await seedAccount(h.d, h.ids, 1);
      const lines = 20;
      const { billId, total } = await reviewedBill(h, lines, SEVENTEEN_SECONDS);
      expect(total).toBe('6799.9920');

      const res = await h.send('POST', `/api/payout/bills/${billId}/pay`, h.finA);
      expect(res.statusCode, res.body).toBe(201);
      const sent = transfers(h)[0]!.body['amount'] as number;
      expect(sent).toBe(6799);

      const exact = Number(total);
      const lossOnTotal = exact - sent;
      const lossPerLineFloor = exact - lines * Math.floor(339.9996);
      expect(lossOnTotal).toBeCloseTo(0.992, 6);
      expect(lossOnTotal).toBeLessThan(1);
      expect(lossPerLineFloor).toBeCloseTo(19.992, 6);
      // Never more than they earned.
      expect(sent).toBeLessThanOrEqual(exact);
    } finally {
      await h.close();
    }
  });
});
/**
 * The floor's own edge: a bill worth less than one dong.
 *
 * `wholeVnd` floors it to 0, and `payout_attempts_amount_positive_check` (0012)
 * says an attempt is for more than nothing. Before the floor rule such a bill
 * carried `total_fractional` and was refused in preflight; with the floor and
 * no issue for it, preflight called it payable, `payBill` reached the insert,
 * and the constraint's throw came back as `BatchAborted` — which stops the
 * whole period, so every OTHER collector on that period went unpaid too.
 *
 * These two tests are the measurement of that: the sub-dong bill must be
 * refused by name, and the healthy bill beside it must still be paid.
 */
describe.skipIf(!hasDb())('a bill worth less than one dong', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('is refused by name in preflight, and the healthy bill in the same period is still paid', async () => {
    const h = await harness();
    try {
      await seedAccount(h.d, h.ids, 1);
      await seedAccount(h.d, h.ids, 2);
      // c-0001 sorts before c-0002, so the sub-dong bill is reached first: if
      // it aborts, the healthy one never gets its transfer.
      const dust = await seedBill(h.d, h.ids, 1, P0, ['0.8004'], '0.8004');
      const healthy = await seedBill(h.d, h.ids, 2, P0, ['1200.0000'], '1200.0000');

      const run = await runBatch(h.d, h.client, h.actor('finA'), P0, { pauseMs: 0 });

      expect(run.preflight.payable).toBe(1);
      expect(run.preflight.total_vnd).toBe(1200);
      expect(run.preflight.counts.under_one_dong).toBe(1);
      expect(run.refused).toEqual([
        { billId: dust, collectorRef: 'c-0001', constraint: 'payout_attempts_amount_positive_check' },
      ]);
      expect(run.stopped_at).toBeNull();
      expect(run.sent.map((s) => s.billId)).toEqual([healthy]);
      expect(transfers(h)).toHaveLength(1);
      expect(transfers(h)[0]!.body['amount']).toBe(1200);
      // Nothing was ever inserted for the dust bill, so nothing tripped.
      expect(await attemptCount(h.d)).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('answers the pay route with a named 409, not a 500 carrying the raw query', async () => {
    const h = await harness();
    try {
      await seedAccount(h.d, h.ids, 1);
      const dust = await seedBill(h.d, h.ids, 1, P0, ['0.8004'], '0.8004');

      const res = await h.send('POST', `/api/payout/bills/${dust}/pay`, h.finA);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().constraint).toBe('payout_attempts_amount_positive_check');
      expect(res.body).not.toContain('Failed query');

      const view = await h.send('GET', `/api/payout/batches/${P0.start.toISOString()}`, h.finA);
      expect((view.json().bills as { id: string; issues: string[]; amount_vnd: number }[]).find((b) => b.id === dust)).toMatchObject({
        issues: ['under_one_dong'],
        amount_vnd: 0,
      });
      expect(await attemptCount(h.d)).toBe(0);
      expect(transfers(h)).toHaveLength(0);
    } finally {
      await h.close();
    }
  });
});
