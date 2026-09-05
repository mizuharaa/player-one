import { exit } from 'node:process';
import { open, redact } from '@playerone/store';
import { payoutOptionsFromEnv } from '../src/payout/domain/config.ts';
import { shadowDiff, shadowRun } from '../src/payout/recon/index.ts';
import { zaloPayClientFromEnv } from '../src/payout/zalopay/client.ts';
import { RiskEngine } from '../src/risk/engine.ts';

/**
 * Shadow mode, as a process an operator can actually run.
 *
 *   node packages/api/bin/payout-shadow.ts run  <period_start> [period_end]
 *   node packages/api/bin/payout-shadow.ts diff <shadow_run_id>
 *
 * `shadowRun` and `shadowDiff` were written, tested and reachable from
 * nothing: no route registers them, `bin/payout-worker.ts` polls the API rail
 * only, and `payout/routes/payout.ts` has no recon surface at all. So the G7
 * gate that `recon/shadow.ts` names — *"Two shadow cycles diffed clean is the
 * gate before `api` becomes discussable"* — could not be reached on a
 * deployment, only from a test. This file is that entry point and nothing
 * more: it parses two dates, opens the database, calls the two functions and
 * prints what they returned.
 *
 * Order of use, per cycle: `run` BEFORE the operator pays the period by hand
 * (it records what the API rail would have sent), `diff` afterwards (it
 * compares that intention against what was actually recorded). Running `run`
 * again after the cycle is paid is not a second cycle and will not read as
 * one — an already-paid bill is one the rail would now refuse, so the diff
 * says SHADOW_UNINTENDED about a payment that was correct. Two cycles means
 * two periods.
 *
 * It writes no attempt and sends no transfer. The only ZaloPay call it can
 * make at all is the wallet balance the preflight reads, and only when this
 * machine has credentials; in the manual pilot there are none, the client is
 * absent, and the run says so on its summary instead of failing.
 *
 * Exit status is the answer, so cron can read it: 0 clean, 1 the diff raised
 * findings, 2 it could not be asked.
 */

const env = process.env;
const [command, first, second] = process.argv.slice(2);

const usage = (message: string): never => {
  console.error(`payout-shadow: ${message}`);
  console.error('usage: payout-shadow run <period_start> [period_end] | payout-shadow diff <shadow_run_id>');
  return exit(2);
};

const databaseUrl = env['DATABASE_URL'] ?? '';
if (databaseUrl === '') usage('DATABASE_URL is not set');
if (command !== 'run' && command !== 'diff') usage(`unknown command '${command ?? ''}'`);
if (first === undefined) usage(command === 'run' ? 'a period start is required' : 'a shadow run id is required');

/**
 * Everything that can fail is inside the try, the database included, because
 * exit 1 is an ANSWER here — the diff raised findings — and an unhandled
 * rejection also exits 1. A bad URL or a mistyped `PLAYERONE_ZALOPAY_ENV`
 * must not read as a dirty cycle.
 */
let db: Awaited<ReturnType<typeof open>> | null = null;

try {
  const options = payoutOptionsFromEnv(env);
  db = await open(databaseUrl, { max: Number(env['PLAYERONE_DB_POOL'] ?? 4) });

  if (command === 'run') {
    const start = new Date(first!);
    if (Number.isNaN(start.getTime())) usage(`'${first}' is not a date`);
    const cycleDays = Number(env['PLAYERONE_SETTLEMENT_CYCLE_DAYS'] ?? 7);
    const end = second === undefined ? new Date(start.getTime() + cycleDays * 86_400_000) : new Date(second);
    if (Number.isNaN(end.getTime())) usage(`'${second}' is not a date`);
    if (end.getTime() <= start.getTime()) usage('the period ends before it starts');

    /**
     * The same cap, hold switch and risk reader `buildApi` hands the payout
     * lane. Without them the shadow run would predict a rail that does not
     * exist: every bill would read `clear`, and a bill the live rail would
     * hold or refuse for being over the cap would be recorded as one it would
     * have sent.
     */
    const engine = new RiskEngine(db, { holdsEnabled: options.holdsEnabled });
    const run = await shadowRun(db, zaloPayClientFromEnv(env) ?? undefined, { start, end }, {
      capVnd: options.capVnd,
      holdsEnabled: options.holdsEnabled,
      risk: { billSummary: (billId: string) => engine.payoutSummary(billId) },
    });
    console.log(JSON.stringify({ ...run, database: redact(databaseUrl) }, null, 2));
    await db.close();
    exit(0);
  }

  const diff = await shadowDiff(db, first!);
  console.log(JSON.stringify(diff, null, 2));
  await db.close();
  exit(diff.raised === 0 ? 0 : 1);
} catch (err) {
  console.error(`payout-shadow: ${(err as Error).message}`);
  await db?.close();
  exit(2);
}
