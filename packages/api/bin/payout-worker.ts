import { exit } from 'node:process';
import { open, redact } from '@playerone/store';
import { payoutOptionsFromEnv, assertPayoutBootInvariants } from '../src/payout/domain/config.ts';
import type { ZaloPayClient } from '../src/payout/domain/client-contract.ts';
import { runPoller } from '../src/payout/worker/run.ts';

/**
 * The reconciliation poller, as a process: `node packages/api/bin/payout-worker.ts`.
 *
 * A `setInterval` around `tick()` (Part R3: no queue, no broker). Several
 * instances may run; `FOR UPDATE SKIP LOCKED` in the tick keeps them off each
 * other's rows. It sends nothing, ever — see `payout/worker/poll.ts`.
 *
 * The ZaloPay client is Agent A's; until its factory is wired here this
 * process refuses to start rather than polling nothing, so a deployment
 * cannot believe reconciliation is running when it is not.
 */

const env = process.env;
const databaseUrl = env['DATABASE_URL'] ?? '';
if (databaseUrl === '') {
  console.error('DATABASE_URL is not set');
  exit(2);
}

const options = payoutOptionsFromEnv(env);
assertPayoutBootInvariants(options);

/**
 * Wire Agent A's client here: `zaloPayClientFromEnv(env)` from
 * `packages/api/src/payout/zalopay/client.ts` once it lands. Left as an
 * explicit refusal so the gap is a startup error, not a silent no-op.
 */
const client: ZaloPayClient | null = null;
if (client === null) {
  console.error('payout-worker: no ZaloPay client is wired; see packages/api/bin/payout-worker.ts');
  exit(2);
}

const db = await open(databaseUrl, { max: Number(env['PLAYERONE_DB_POOL'] ?? 4) });
const intervalMs = Number(env['PLAYERONE_PAYOUT_POLL_INTERVAL_MS'] ?? 5_000);

const poller = runPoller(db, client, {
  intervalMs,
  log: (report) => {
    const moved = report.outcomes.filter((o) => o.outcome === 'moved');
    if (moved.length > 0 || report.candidates > 0) {
      console.log(
        `${report.now} polled ${report.candidates}: ` +
          moved.map((o) => `${o.partnerOrderId} ${o.from}->${o.to}`).join(', '),
      );
    }
  },
});

const shutdown = async (signal: string) => {
  console.log(`${signal}: stopping`);
  poller.stop();
  await db.close();
  exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(`payout-worker polling every ${intervalMs} ms (${redact(databaseUrl)}, ${options.zaloPayEnv})`);
