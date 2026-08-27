import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';

/**
 * The false-positive report: are the thresholds wrong?
 *
 * The brief's budget is one sentence — if more than 20% of held bills are
 * cleared by operators as fine, the thresholds are wrong — and this is the
 * measurement, shipped in the same change as the engine so the two cannot
 * drift apart. It reads `risk_holds` only: a hold raised in the window, and
 * whether its clear row said `false_positive`.
 *
 * Per signal it also says which signals were on the holds that turned out to
 * be nothing, so the retune that follows is aimed at a signal and not at the
 * hold edge as a whole.
 */

export const FALSE_POSITIVE_BUDGET = 0.2;

export type FalsePositiveReport = {
  window: { from: string; to: string };
  budget: number;
  holds: {
    raised: number;
    open: number;
    cleared: number;
    cleared_false_positive: number;
    cleared_accepted: number;
    cleared_resolved: number;
    /** false positives over everything raised in the window. */
    false_positive_rate: number;
    over_budget: boolean;
  };
  by_signal: {
    signal_id: string;
    holds: number;
    false_positive: number;
    accepted: number;
    resolved: number;
    /** false positives over the holds this signal was on. */
    false_positive_share: number;
  }[];
  /** How many days a clear took, for the holds that were cleared. */
  time_to_clear_days: { median: number | null; max: number | null };
};

type Row = Record<string, unknown>;

export async function falsePositiveReport(db: Db, window: { from: Date; to: Date }): Promise<FalsePositiveReport> {
  const rows = (await db.execute(
    sql`with raised as (
           select id, bill_id, raised_by_flag, raised_at, signal_ids
             from risk_holds
            where cleared_at is null and raised_at >= ${window.from.toISOString()}::timestamptz and raised_at < ${window.to.toISOString()}::timestamptz
         ),
         cleared as (
           select c.bill_id, c.raised_by_flag, c.raised_at, c.cleared_at, c.clear_verdict
             from risk_holds c
            where c.cleared_at is not null
         )
         select r.id, r.bill_id, r.raised_at, r.signal_ids, c.cleared_at, c.clear_verdict
           from raised r
           left join cleared c on c.bill_id = r.bill_id and c.raised_by_flag = r.raised_by_flag and c.raised_at = r.raised_at
          order by r.raised_at asc`,
  )) as unknown as Row[];

  const holds = { raised: rows.length, open: 0, cleared: 0, cleared_false_positive: 0, cleared_accepted: 0, cleared_resolved: 0 };
  const bySignal = new Map<string, { holds: number; false_positive: number; accepted: number; resolved: number }>();
  const days: number[] = [];
  for (const r of rows) {
    const verdict = r['clear_verdict'] ? String(r['clear_verdict']) : null;
    if (verdict === null) holds.open += 1;
    else {
      holds.cleared += 1;
      if (verdict === 'false_positive') holds.cleared_false_positive += 1;
      else if (verdict === 'accepted') holds.cleared_accepted += 1;
      else if (verdict === 'resolved') holds.cleared_resolved += 1;
      days.push((new Date(String(r['cleared_at'])).getTime() - new Date(String(r['raised_at'])).getTime()) / 86_400_000);
    }
    for (const s of (r['signal_ids'] as string[]) ?? []) {
      const cur = bySignal.get(s) ?? { holds: 0, false_positive: 0, accepted: 0, resolved: 0 };
      cur.holds += 1;
      if (verdict === 'false_positive') cur.false_positive += 1;
      if (verdict === 'accepted') cur.accepted += 1;
      if (verdict === 'resolved') cur.resolved += 1;
      bySignal.set(s, cur);
    }
  }
  const rate = holds.raised === 0 ? 0 : holds.cleared_false_positive / holds.raised;
  const sorted = [...days].sort((a, b) => a - b);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    budget: FALSE_POSITIVE_BUDGET,
    holds: { ...holds, false_positive_rate: Math.round(rate * 1000) / 1000, over_budget: rate > FALSE_POSITIVE_BUDGET },
    by_signal: [...bySignal]
      .map(([signal_id, v]) => ({
        signal_id,
        ...v,
        false_positive_share: v.holds === 0 ? 0 : Math.round((v.false_positive / v.holds) * 1000) / 1000,
      }))
      .sort((a, b) => b.false_positive_share - a.false_positive_share || b.holds - a.holds || (a.signal_id < b.signal_id ? -1 : 1)),
    time_to_clear_days: {
      median: median === null ? null : Math.round(median * 100) / 100,
      max: sorted.length === 0 ? null : Math.round(sorted[sorted.length - 1]! * 100) / 100,
    },
  };
}
