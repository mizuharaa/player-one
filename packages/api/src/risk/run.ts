import type { Db } from '@playerone/store';
import type { RiskEngine } from './engine.ts';
import { tick, type TickOptions, type TickResult } from './worker.ts';

/** Drive advisory evaluation without overlapping ticks in one process. */
export function runRiskWorker(
  db: Db,
  engine: RiskEngine,
  options: TickOptions & {
    intervalMs?: number;
    log?: (report: TickResult) => void;
    onError?: (err: unknown) => void;
  } = {},
): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('risk worker interval must be positive');
  let running = false;
  const once = async () => {
    if (running) return;
    running = true;
    try {
      options.log?.(await tick(db, engine, options));
    } catch (err) {
      (options.onError ?? console.error)(err);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void once(), intervalMs);
  void once();
  return { stop: () => clearInterval(handle) };
}
