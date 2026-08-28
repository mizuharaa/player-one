import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { NEEDS_OPERATOR, type RiskEngine } from './engine.ts';
import { billHold, holdDecision, holdHistory } from './holds.ts';
import { RISK_LOCALES, sentence } from './sentences.ts';
import type { Flag, RiskSummary } from './types.ts';

/**
 * The operator queue: every bill a person has to look at before it is paid.
 *
 * This is the piece the engine was missing. It had holds, and it had a report
 * of holds cleared, but the only way to learn that a bill was suspicious was
 * to already know its id. A suspicion that nobody is shown is not a control.
 *
 * Four properties, and each is why a line here reads the way it does:
 *
 *   It is a READ. There is no queue table, no assignment, no state machine and
 *   no second copy of a hold. Everything below is derived from `risk_flags`,
 *   `risk_holds`, `bills` and the payout tables that already exist, so nothing
 *   can go stale against them and nothing has to be kept in step.
 *
 *   It carries the EVIDENCE. A row is not "bill 7 looks odd"; it is every flag
 *   with the numbers that raised it and a sentence in all three languages —
 *   the same `sentence()` the console renders — so the person deciding can
 *   decide without a database client.
 *
 *   It says whether money is ACTUALLY blocked. `blocking` is the hold chain's
 *   answer, not the score's, so the queue and the payout preflight can never
 *   disagree about a bill.
 *
 *   It never reaches a collector. `/api/risk/*` is behind `requireActor`,
 *   which requires an operator token AND a machine token of the same centre;
 *   reviewer sessions are refused by PLT-10 scope and there is no collector
 *   session that reaches a `/api/risk` route at all. Signal ids, points,
 *   evidence and scores stay inside VNG.
 */

export type QueueHoldState =
  /** A `risk_holds` row is open. The clear route works; payment is refused. */
  | 'open'
  /**
   * The band asks for a person but no hold row exists yet, because the bill
   * has not been evaluated since holds were switched on. Payment is refused
   * and there is nothing to clear: run POST /api/risk/evaluate/bill/:id and
   * the row appears. The worker does that on its own pass.
   */
  | 'pending_evaluation'
  /** An operator cleared the last hold and every signal now showing was in it. */
  | 'cleared';

export type QueueEntry = {
  billId: string;
  collectorId: string;
  collectorRef: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  total: string;
  score: number;
  band: RiskSummary['band'];
  holdState: QueueHoldState;
  /** True when a payout attempt would be refused for risk right now. */
  blocking: boolean;
  holdId: string | null;
  raisedAt: string | null;
  flags: Flag[];
  lastClear: { at: string; by: string | null; verdict: string; reason: string } | null;
};

type Row = Record<string, unknown>;

/**
 * Candidates: unpaid bills that carry at least one finding somewhere in their
 * roll-up, or that are already held.
 *
 * ponytail: the band itself is computed in TypeScript (`rollup` then
 * `summarise`), so SQL cannot filter on it; this widens to "has any finding at
 * all" and drops the rest in the loop below. At the pilot's scale — 500
 * collectors, one bill each per period — that is a few hundred summaries. If
 * this ever runs over years of bills, add the period window the route already
 * accepts, or store the band on the META.EVALUATED row and filter on it.
 */
const CANDIDATES = (limit: number) => sql`
  select b.id, b.collector_id, c.external_ref, b.period_start, b.period_end, b.currency, b.total,
         coalesce(bool_and(s.settlement_state = 'manually_paid'), false) as all_paid,
         exists (select 1 from payout_attempts a where a.bill_id = b.id and a.status = 'succeeded') as attempt_paid
    from bills b
    join collectors c on c.id = b.collector_id
    left join bill_lines l on l.bill_id = b.id
    left join settlements s on s.id = l.settlement_id
   where exists (select 1 from risk_current_holds h where h.bill_id = b.id)
      or exists (
        select 1 from risk_current_flags f
         where (f.subject_type = 'bill' and f.subject_id = b.id::text)
            or (f.subject_type = 'collector' and f.subject_id = b.collector_id::text)
            or (f.subject_type = 'episode' and f.subject_id in (
                  select r.episode_id::text from bill_lines l2
                    join settlements s2 on s2.id = l2.settlement_id
                    join episode_reviews r on r.id = s2.episode_review_id
                   where l2.bill_id = b.id)))
   group by b.id, b.collector_id, c.external_ref, b.period_start, b.period_end, b.currency, b.total
   order by b.generated_at asc, b.id asc
   limit ${limit}`;

/** Oldest bill first: the queue is worked front to back and nothing ages out of sight. */
export async function reviewQueue(
  db: Db,
  engine: RiskEngine,
  o: { limit?: number; includePaid?: boolean } = {},
): Promise<QueueEntry[]> {
  const rows = (await db.execute(CANDIDATES(o.limit ?? 200))) as unknown as Row[];
  const out: QueueEntry[] = [];
  for (const r of rows) {
    const paid = Boolean(r['all_paid']) || Boolean(r['attempt_paid']);
    if (paid && o.includePaid !== true) continue;
    const billId = String(r['id']);
    const summary = await engine.summary('bill', billId);
    const open = await billHold(db, billId);
    if (open === null && !NEEDS_OPERATOR.includes(summary.band)) continue;

    const decision = await holdDecision(db, billId, summary.flags.map((f) => f.signalId));
    const holdState: QueueHoldState =
      decision === 'already_open' ? 'open' : decision === 'raise' ? 'pending_evaluation' : 'cleared';
    // Exactly what `payoutSummary` answers, from the same two inputs: the
    // queue can never say "held" while the payout preflight says "payable".
    const blocking = decision === 'already_open' || (decision === 'raise' && NEEDS_OPERATOR.includes(summary.band));

    const history = await holdHistory(db, billId);
    const cleared = [...history].reverse().find((h) => h.clearedAt !== null) ?? null;
    out.push({
      billId,
      collectorId: String(r['collector_id']),
      collectorRef: String(r['external_ref']),
      periodStart: new Date(String(r['period_start'])).toISOString(),
      periodEnd: new Date(String(r['period_end'])).toISOString(),
      currency: String(r['currency']),
      total: String(r['total']),
      score: summary.score,
      band: summary.band,
      holdState,
      blocking,
      holdId: open?.id ?? null,
      raisedAt: open?.raisedAt.toISOString() ?? null,
      flags: summary.flags,
      lastClear:
        cleared === null
          ? null
          : {
              at: cleared.clearedAt!.toISOString(),
              by: cleared.clearedBy,
              verdict: cleared.clearVerdict ?? '',
              reason: cleared.clearReason ?? '',
            },
    });
  }
  return out;
}

/** The wire shape. Every flag carries its sentence, so a screen renders with no catalogue of its own. */
export const shapeQueueEntry = (e: QueueEntry) => ({
  bill_id: e.billId,
  collector_id: e.collectorId,
  collector_ref: e.collectorRef,
  period_start: e.periodStart,
  period_end: e.periodEnd,
  currency: e.currency,
  total: e.total,
  score: e.score,
  band: e.band,
  hold_state: e.holdState,
  blocking: e.blocking,
  hold_id: e.holdId,
  raised_at: e.raisedAt,
  last_clear: e.lastClear,
  flags: e.flags.map((f) => ({
    signal_id: f.signalId,
    severity: f.severity,
    points: f.points,
    threshold_version: f.thresholdVersion,
    computed_at: f.computedAt,
    evidence: f.evidence,
    sentence: Object.fromEntries(RISK_LOCALES.map((l) => [l, sentence(f, l)])),
  })),
});
