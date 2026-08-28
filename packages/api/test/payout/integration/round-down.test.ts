import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EpisodeRecord } from '@playerone/contracts';
import { runBatch } from '../../../src/payout/worker/batch.ts';
import { closeDb, hasDb, truncate, useDatabase } from '../../../../store/test/db.ts';
import { episodeRecord } from '../../fixtures.ts';
import { rows, seedAccount } from '../domain/fixture.ts';
import { attempt, attemptCount, harness, transfers, type Harness } from './harness.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('round_down');

/**
 * Bill totals round down (Daniel, 2026-08-27), proved on a bill a reviewer
 * actually produced.
 *
 * Every review-lane bill is fractional. Sixteen seconds at 1,200 a minute is
 * `0.266667` minutes and `320.0004` dong, because the amount is computed from
 * the *rounded* minutes so that `unit_price × effective_minutes` reproduces
 * `amount` on the invoice. Two such episodes make a bill of `640.0008`, and
 * until the rounding rule was chosen nothing could turn that into the whole
 * dong a transfer moves — so no collector could be paid at all.
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

const SIXTEEN_SECONDS = 16;
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

  it('the API rail sends the floor of the total: 640.0008 goes out as 640', async () => {
    const h = await harness();
    try {
      await seedAccount(h.d, h.ids, 1);
      const { billId, total } = await reviewedBill(h, 2, SIXTEEN_SECONDS);
      expect(total).toBe('640.0008');

      const res = await h.send('POST', `/api/payout/bills/${billId}/pay`, h.finA);
      expect(res.statusCode, res.body).toBe(201);
      expect(transfers(h)).toHaveLength(1);
      expect(transfers(h)[0]!.body['amount']).toBe(640);
      expect(Number((await attempt(h.d, res.json().attempt_id))['amount_vnd'])).toBe(640);
      // The bill itself is untouched: it still states what the lines say.
      expect((await rows<{ t: string }>(h.d, sql`select total::text as t from bills where id = ${billId}`))[0]!.t).toBe('640.0008');
    } finally {
      await h.close();
    }
  });

  it('the manual rail records the same floor, and refuses the un-floored figure', async () => {
    const h = await harness({}, { mode: 'manual' });
    try {
      await seedAccount(h.d, h.ids, 1);
      const { billId, total } = await reviewedBill(h, 2, SIXTEEN_SECONDS);
      expect(total).toBe('640.0008');

      const wrong = await h.send('POST', `/api/payout/bills/${billId}/mark-paid`, h.finA, {
        manual_reference: 'VCB-1',
        amount_vnd: 641,
      });
      expect(wrong.statusCode, wrong.body).toBe(409);
      expect(wrong.json().constraint).toBe('payout_attempts_amount_check');

      const ok = await h.send('POST', `/api/payout/bills/${billId}/mark-paid`, h.finA, {
        manual_reference: 'VCB-2',
        amount_vnd: 640,
      });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(Number((await attempt(h.d, ok.json().attempt_id))['amount_vnd'])).toBe(640);
      expect(transfers(h)).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it('the batch runner pays it too, and nothing is left in a preflight issue', async () => {
    const h = await harness();
    try {
      await seedAccount(h.d, h.ids, 1);
      const { billId, period } = await reviewedBill(h, 2, SIXTEEN_SECONDS);
      const run = await runBatch(h.d, h.client, h.actor('finA'), period, { pauseMs: 0 });
      expect(run.refused).toEqual([]);
      expect(run.sent.map((s) => s.billId)).toEqual([billId]);
      expect(run.preflight.payable).toBe(1);
      expect(run.preflight.total_vnd).toBe(640);
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