import type { Db } from '@playerone/store';
import { RiskBusy, type RiskEngine } from './engine.ts';
import { billsDue, collectorsDue, episodesDue } from './sources.ts';

/**
 * One pass of the engine over everything that is due: a pure `tick`, in the
 * shape Part R asks for (no queue, no broker), driven by a `setInterval` in
 * `bin/` by whoever wires it. Idempotent across instances: every evaluation
 * takes `pg_try_advisory_xact_lock` on its subject inside its own transaction,
 * and a subject another instance holds is skipped and counted, not retried.
 *
 * Order matters and is fixed: episodes, then collectors, then bills. A bill's
 * summary rolls up its collector's and its episodes' current flags, so those
 * must be fresh before the bill is judged; `billsDue` sees the new
 * evaluation timestamps and picks the bill up in the same tick.
 */

export type TickResult = {
  evaluated: { episodes: number; collectors: number; bills: number };
  skipped: number;
  failed: { subject: string; error: string }[];
  startedAt: string;
  finishedAt: string;
};

export type TickOptions = {
  /** PLAYERONE_RISK_ENGINE=0 makes a tick a no-op that says so. */
  enabled?: boolean;
  /** Collectors are re-evaluated when their last run is older than this. */
  collectorStaleMs?: number;
  /** Hard cap per subject type per tick, so a backlog drains in bounded passes. */
  limit?: number;
  now?: () => Date;
};

export async function tick(db: Db, engine: RiskEngine, o: TickOptions = {}): Promise<TickResult> {
  const now = o.now ?? (() => new Date());
  const startedAt = now();
  const result: TickResult = {
    evaluated: { episodes: 0, collectors: 0, bills: 0 },
    skipped: 0,
    failed: [],
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
  };
  if (o.enabled === false) return result;
  const limit = o.limit ?? 200;

  const run = async (subject: string, fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (err) {
      if (err instanceof RiskBusy) result.skipped += 1;
      else result.failed.push({ subject, error: (err as Error).message });
      return false;
    }
  };

  for (const id of (await episodesDue(db)).slice(0, limit)) {
    if (await run(`episode ${id}`, () => engine.evaluateEpisode(id))) result.evaluated.episodes += 1;
  }
  const stale = new Date(now().getTime() - (o.collectorStaleMs ?? 60 * 60 * 1000));
  for (const id of (await collectorsDue(db, stale)).slice(0, limit)) {
    if (await run(`collector ${id}`, () => engine.evaluateCollector(id))) result.evaluated.collectors += 1;
  }
  for (const id of (await billsDue(db)).slice(0, limit)) {
    if (await run(`bill ${id}`, () => engine.evaluateBill(id))) result.evaluated.bills += 1;
  }
  result.finishedAt = now().toISOString();
  return result;
}
