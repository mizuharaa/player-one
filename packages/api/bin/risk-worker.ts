/**
 * The risk worker: one `tick` (src/risk/worker.ts) every PLAYERONE_RISK_INTERVAL_MS
 * (default 60 s), forever, until SIGINT/SIGTERM. `--once` runs a single tick,
 * prints its report, and exits 0 (1 if any subject failed) — for a cron, and
 * for proving the wiring against a real database.
 *
 *   DATABASE_URL=... node packages/api/bin/risk-worker.ts [--once]
 */
import { argv, exit } from 'node:process';
import { open, redact } from '@playerone/store';
import { riskConfigFromEnv } from '../src/risk/config.ts';
import { RiskEngine } from '../src/risk/engine.ts';
import { runRiskWorker } from '../src/risk/run.ts';
import { tick, type TickResult } from '../src/risk/worker.ts';

const env = process.env;
const databaseUrl = env['DATABASE_URL'] ?? '';
if (databaseUrl === '') {
  console.error('DATABASE_URL is not set');
  exit(2);
}

const config = riskConfigFromEnv(env);
const db = await open(databaseUrl, { max: Number(env['PLAYERONE_DB_POOL'] ?? 4) });
const intervalMs = Number(env['PLAYERONE_RISK_INTERVAL_MS'] ?? 60_000);
const engine = new RiskEngine(db, { mediaRoot: config.mediaRoot, holdsEnabled: config.holdsEnabled });
const line = (report: TickResult): string => {
  const total = report.evaluated.episodes + report.evaluated.collectors + report.evaluated.bills;
  return `${report.finishedAt} risk${config.engineEnabled ? '' : ' (engine off)'} evaluated ${total} (episodes ${report.evaluated.episodes}, collectors ${report.evaluated.collectors}, bills ${report.evaluated.bills}), skipped ${report.skipped}, failed ${report.failed.length}`;
};

if (argv.includes('--once')) {
  const report = await tick(db, engine, { enabled: config.engineEnabled });
  console.log(line(report));
  for (const f of report.failed) console.error(`  ${f.subject}: ${f.error}`);
  await db.close();
  exit(report.failed.length === 0 ? 0 : 1);
}

const worker = runRiskWorker(db, engine, {
  enabled: config.engineEnabled,
  intervalMs,
  log: (report) => {
    const total = report.evaluated.episodes + report.evaluated.collectors + report.evaluated.bills;
    if (total > 0 || report.failed.length > 0) console.log(line(report));
  },
});

const shutdown = async (signal: string) => {
  console.log(`${signal}: stopping`);
  worker.stop();
  await db.close();
  exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(`risk-worker every ${intervalMs} ms (${redact(databaseUrl)}, engine=${config.engineEnabled ? 'on' : 'off'}, holds=${config.holdsEnabled ? 'on' : 'off'})`);
