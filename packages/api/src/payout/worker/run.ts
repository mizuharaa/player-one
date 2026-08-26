import type { Db } from '@playerone/store';
import type { ZaloPayClient } from '../domain/client-contract.ts';
import { tick, type TickOptions, type TickReport } from './poll.ts';

/**
 * The interval driver for `tick`, so `bin/payout-worker.ts` is one call.
 *
 * One tick at a time in this process: a tick that outlasts the interval is
 * not overlapped, it is followed. Across processes the row lock in `tick`
 * does the same job.
 */
export function runPoller(
  db: Db,
  client: ZaloPayClient,
  options: TickOptions & {
    intervalMs?: number;
    log?: (report: TickReport) => void;
    onError?: (err: unknown) => void;
  } = {},
): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 5_000;
  let running = false;
  const once = async () => {
    if (running) return;
    running = true;
    try {
      const report = await tick(db, client, new Date(), options);
      options.log?.(report);
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
