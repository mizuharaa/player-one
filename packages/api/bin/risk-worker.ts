import { exit } from 'node:process';
import { open, redact } from '@playerone/store';
import { riskConfigFromEnv } from '../src/risk/config.ts';
import { RiskEngine } from '../src/risk/engine.ts';
import { runRiskWorker } from '../src/risk/run.ts';

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
const worker = runRiskWorker(db, engine, {
  enabled: config.engineEnabled,
  intervalMs,
  log: (report) => {
    const total = report.evaluated.episodes + report.evaluated.collectors + report.evaluated.bills;
    if (total > 0 || report.failed.length > 0) {
      console.log(`${report.finishedAt} risk evaluated ${total}, skipped ${report.skipped}, failed ${report.failed.length}`);
    }
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
