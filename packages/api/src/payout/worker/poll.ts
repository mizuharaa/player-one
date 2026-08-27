import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import type { ZaloPayClient } from '../domain/client-contract.ts';
import {
  applyEvent,
  recordPoll,
  shapeAttempt,
  type AttemptRow,
} from '../domain/attempts.ts';
import { emitEvent, hasEvent } from '../domain/events.ts';
import { IllegalTransition, POLLABLE } from '../domain/state.ts';

/**
 * The reconciliation poller. Mandatory, not optional: ZaloPay has no webhook
 * (Part 0, F2). After transfer-fund answers PROCESSING, and after a lost
 * answer, the only way to learn what happened is to ask.
 *
 * A pure `tick(db, client, now)` driven by a `setInterval` in `run.ts` and
 * `bin/payout-worker.ts` (Part R3: no queue, no broker). Idempotency across
 * instances is `FOR UPDATE SKIP LOCKED` on the attempt row: two processes
 * ticking at once take different rows, and a row somebody else holds is simply
 * not this tick's business. A duplicate run cannot create anything — the
 * poller only ever UPDATEs, and only the three states it is allowed to touch.
 *
 * Three things it never does, and each is enforced somewhere the poller
 * cannot reach:
 *
 *   - It never sends a transfer. There is no call to `transferFund` in this
 *     file, and the test that matters most in the payout system asserts on
 *     the fake client's transfer count.
 *   - It never touches `pending_zlp`. The SELECT excludes it, `state.ts`
 *     refuses it, and `payout_attempts_pending_resolved` (0012) refuses it for
 *     any writer without an operator's typed reason.
 *   - It never fails an attempt on its own judgement. `failed` comes from a
 *     polled status 2 and nothing else; an order ZaloPay cannot find is a
 *     ticket, not a failure.
 *
 * Backoff (Agent B brief, BUILD 7): 5s, 15s, 30s, 60s, then every 5 minutes
 * until the attempt is 24 hours old, then hourly until it is 7 days old, then
 * stop and raise an operator ticket. Full jitter: each wait is a uniform draw
 * from [0, base), which spreads a burst of attempts out instead of having them
 * hit ZaloPay in lockstep. The draw is deterministic per (attempt, poll_count)
 * so that a tick every few seconds cannot re-roll its way to an early poll —
 * with a fresh draw per tick the effective wait would be the minimum of many
 * draws, which is not jitter, it is haste.
 */

export const BACKOFF = {
  initialMs: [5_000, 15_000, 30_000, 60_000] as readonly number[],
  fiveMinutesMs: 5 * 60_000,
  firstDayMs: 24 * 60 * 60_000,
  hourlyMs: 60 * 60_000,
  stopAfterMs: 7 * 24 * 60 * 60_000,
} as const;

/** The base wait before the next poll, or `null` once polling should stop. */
export function baseDelayMs(pollCount: number, ageMs: number): number | null {
  if (ageMs >= BACKOFF.stopAfterMs) return null;
  const initial = BACKOFF.initialMs[pollCount];
  if (initial !== undefined) return initial;
  return ageMs < BACKOFF.firstDayMs ? BACKOFF.fiveMinutesMs : BACKOFF.hourlyMs;
}

/** A uniform draw in [0, 1), fixed for one attempt at one poll count. */
export function jitterFor(attemptId: string, pollCount: number): number {
  const digest = createHash('sha256').update(`${attemptId}:${pollCount}`).digest();
  return digest.readUInt32BE(0) / 2 ** 32;
}

export type Jitter = (attemptId: string, pollCount: number) => number;

/**
 * When an attempt is next due, or `null` when polling has stopped for it.
 * The wait is anchored on the last poll (or the creation, before any), and
 * the age that chooses the tier is measured at the same anchor, so the
 * schedule is a function of the row and nothing else.
 */
export function dueAt(
  attempt: Pick<AttemptRow, 'id' | 'createdAt' | 'lastPolledAt' | 'pollCount'>,
  jitter: Jitter = jitterFor,
): Date | null {
  const anchor = attempt.lastPolledAt ?? attempt.createdAt;
  const base = baseDelayMs(attempt.pollCount, anchor.getTime() - attempt.createdAt.getTime());
  if (base === null) return null;
  return new Date(anchor.getTime() + Math.floor(base * jitter(attempt.id, attempt.pollCount)));
}

export type PollOutcome =
  | 'moved' // the status changed
  | 'unchanged' // polled, still processing / not found / a transient refusal
  | 'not_due'
  | 'locked' // another instance holds the row
  | 'exhausted' // seven days; ticket raised (once)
  | 'error'; // the client threw; recorded as a poll, retried on schedule

export type TickReport = {
  now: string;
  candidates: number;
  outcomes: { attemptId: string; partnerOrderId: string; outcome: PollOutcome; from: string; to: string }[];
};

export type TickOptions = {
  jitter?: Jitter;
  /** Sequential, and conservative: the wait between two calls. Zero in tests. */
  pauseMs?: number;
  /** At most this many polls per tick. */
  limit?: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type RawRow = Parameters<typeof shapeAttempt>[0];

export async function tick(
  db: Db,
  client: ZaloPayClient,
  now: Date = new Date(),
  options: TickOptions = {},
): Promise<TickReport> {
  const jitter = options.jitter ?? jitterFor;
  const pauseMs = options.pauseMs ?? 250;
  const limit = options.limit ?? 100;

  /**
   * The candidates, by id only. The row itself is read again under the lock,
   * because what this list says about a row is already stale by the time the
   * row is taken.
   */
  const candidates = (await db.execute(sql`
    select id from payout_attempts
     where status in ('submitted', 'processing', 'unknown')
     order by coalesce(last_polled_at, created_at) asc, attempt_seq asc
     limit ${limit}
  `)) as unknown as { id: string }[];

  const report: TickReport = { now: now.toISOString(), candidates: candidates.length, outcomes: [] };
  let polled = 0;

  for (const { id } of candidates) {
    if (polled > 0 && pauseMs > 0) await sleep(pauseMs);
    const outcome = await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select * from payout_attempts
         where id = ${id} and status in ('submitted', 'processing', 'unknown')
         for update skip locked
      `)) as unknown as RawRow[];
      if (rows[0] === undefined) return { outcome: 'locked' as const, attempt: null };
      const attempt = shapeAttempt(rows[0]);
      if (!POLLABLE.has(attempt.status)) return { outcome: 'locked' as const, attempt };

      const due = dueAt(attempt, jitter);
      if (due === null) {
        if (!(await hasEvent(tx, 'TICKET.POLL_EXHAUSTED', attempt.id))) {
          await emitEvent(tx, {
            kind: 'TICKET.POLL_EXHAUSTED',
            billId: attempt.billId,
            payoutAttemptId: attempt.id,
            evidence: {
              partner_order_id: attempt.partnerOrderId,
              status: attempt.status,
              poll_count: attempt.pollCount,
              created_at: attempt.createdAt.toISOString(),
              last_polled_at: attempt.lastPolledAt?.toISOString() ?? null,
              message:
                'Polling stopped after 7 days without a terminal answer from ZaloPay. ' +
                'An operator must query the order with ZaloPay and resolve the attempt with a reason.',
            },
          });
        }
        return { outcome: 'exhausted' as const, attempt };
      }
      if (due.getTime() > now.getTime()) return { outcome: 'not_due' as const, attempt };

      polled += 1;
      return pollOne(tx, client, attempt, now);
    });
    report.outcomes.push({
      attemptId: id,
      partnerOrderId: outcome.attempt?.partnerOrderId ?? '',
      outcome: outcome.outcome,
      from: outcome.attempt?.status ?? '',
      to: 'after' in outcome && outcome.after !== undefined ? outcome.after.status : (outcome.attempt?.status ?? ''),
    });
  }
  return report;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function pollOne(
  tx: Tx,
  client: ZaloPayClient,
  attempt: AttemptRow,
  now: Date,
): Promise<{ outcome: PollOutcome; attempt: AttemptRow; after?: AttemptRow }> {
  let result: Awaited<ReturnType<ZaloPayClient['queryTransaction']>>;
  try {
    result = await client.queryTransaction(attempt.partnerOrderId);
  } catch {
    // A lost answer to a read is just a poll that learned nothing. Recorded,
    // so the backoff advances; retried on schedule.
    await recordPoll(tx, attempt, now);
    return { outcome: 'error', attempt };
  }

  switch (result.kind) {
    case 'found': {
      const moved = await applyEvent(
        tx,
        attempt,
        { type: 'POLL', status: result.status },
        { zlpOrderId: result.zlpOrderId, zpTransId: result.zpTransId, polledAt: now },
      );
      if (moved instanceof IllegalTransition || moved === null) {
        // Not reachable for a row this transaction holds in a pollable state;
        // if it ever is, the trigger has the same list and will have said so.
        const after = await recordPoll(tx, attempt, now);
        return { outcome: 'unchanged', attempt, after };
      }
      return { outcome: moved.to === attempt.status ? 'unchanged' : 'moved', attempt, after: moved.attempt };
    }
    case 'not_found': {
      /**
       * ZaloPay holds no order under this id. For a `submitted` or `unknown`
       * attempt that may mean the transfer was never created — and it may mean
       * it is not visible yet. Neither is a failure this worker may declare
       * (only a polled status 2 is), so it is recorded, and once the initial
       * backoff is spent it is a ticket for a person: they confirm with ZaloPay
       * and resolve the attempt with a reason, after which a new attempt is
       * possible.
       */
      const after = await recordPoll(tx, attempt, now);
      if (after.pollCount > BACKOFF.initialMs.length && !(await hasEvent(tx, 'TICKET.ORDER_NOT_FOUND', attempt.id))) {
        await emitEvent(tx, {
          kind: 'TICKET.ORDER_NOT_FOUND',
          billId: attempt.billId,
          payoutAttemptId: attempt.id,
          evidence: {
            partner_order_id: attempt.partnerOrderId,
            status: attempt.status,
            poll_count: after.pollCount,
            message:
              'ZaloPay reports no order under this partner_order_id after repeated queries. ' +
              'Confirm with ZaloPay whether the transfer was created; if it was not, resolve the ' +
              'attempt as failed with a reason, and a new attempt can be made.',
          },
        });
      }
      return { outcome: 'unchanged', attempt, after };
    }
    case 'rejected':
    case 'system': {
      // -402 bad signature, -503 maintenance: neither says anything about
      // the order. Recorded and retried.
      const after = await recordPoll(tx, attempt, now);
      return { outcome: 'unchanged', attempt, after };
    }
  }
}
