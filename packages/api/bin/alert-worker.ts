import { argv, exit } from 'node:process';
import { open, redact } from '@playerone/store';
import { deliverAlerts, runAlertWorker } from '../src/alert-delivery.ts';
import { storageQuotaFromEnv } from '../src/alerts.ts';

const env = process.env;
const databaseUrl = env['DATABASE_URL'] ?? '';
if (databaseUrl === '') {
  console.error('DATABASE_URL is not set');
  exit(2);
}

const storageQuotaBytes = storageQuotaFromEnv(env);
const db = await open(databaseUrl, { max: Number(env['PLAYERONE_DB_POOL'] ?? 4) });
const intervalMs = Number(env['PLAYERONE_ALERT_INTERVAL_MS'] ?? 60_000);

if (argv.includes('--once')) {
  let code = 1;
  try {
    const report = await deliverAlerts(db, { last: new Map(), pending: new Map(), storageQuotaBytes });
    console.log(`alerts delivered ${report.delivered.length}, failed ${report.failed.length}`);
    code = report.failed.length === 0 ? 0 : 1;
  } catch (err) {
    console.error('alerts evaluation failed:', err);
  } finally {
    await db.close();
  }
  exit(code);
}

const worker = runAlertWorker(db, { intervalMs, storageQuotaBytes });
const shutdown = async (signal: string) => {
  console.log(`${signal}: stopping`);
  worker.stop();
  await db.close();
  exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(`alert-worker every ${intervalMs} ms (${redact(databaseUrl)})`);
