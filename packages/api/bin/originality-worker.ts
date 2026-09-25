import { setTimeout } from 'node:timers/promises';
import { open } from '@playerone/store';
import { sql } from 'drizzle-orm';
import { evaluateOriginality, originalityDue } from '../src/originality-worker.ts';
import { s3StoreFromEnv } from '../src/upload-worker.ts';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const intervalMs = Number(process.env['PLAYERONE_ORIGINALITY_INTERVAL_MS'] ?? 60_000);
const limit = Number(process.env['PLAYERONE_ORIGINALITY_BATCH'] ?? 20);
if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 3_600_000) throw new Error('invalid originality interval');
if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('invalid originality batch');
const db = await open(url, { max: 2 });
const o = { mediaRoot: process.env['PLAYERONE_MEDIA_ROOT'], objectStore: s3StoreFromEnv() ?? undefined };
let stopping = false;
const timer = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; timer.abort(); });
try {
  do {
    let failures = 0;
    // ponytail: conservative 250-hour operational ceiling, warning at 125 h.
    // Revalidate on field footage and partition retrieval before expanding it;
    // 1M seeded frames (~278 h) passed with the publication join, not fleet scale.
    const [capacity] = await db.execute(sql`select coalesce(sum(frame_count),0)::text as frames from originality_fingerprints`);
    const indexedFrames = Number(capacity?.frames ?? 0);
    if (indexedFrames >= 450_000) console.error(JSON.stringify({
      event: 'originality_capacity', level: indexedFrames >= 900_000 ? 'critical' : 'warning',
      indexedFrames, corpusHours: indexedFrames / 3600, pilotCeilingHours: 250,
      action: indexedFrames >= 900_000 ? 'hold_new_collection_admissions_and_redesign_retrieval' : 'schedule_capacity_review_before_250_hours',
    }));
    const ids = await originalityDue(db, limit);
    for (const id of ids) {
      if (stopping) break;
      try { console.log(JSON.stringify(await evaluateOriginality(db, id, o))); }
      catch (error) {
        failures++;
        // No credentials, URLs or object bodies in worker output.
        console.error(JSON.stringify({ ingestId: id, outcome: 'failed', error: error instanceof Error ? error.name : 'Error' }));
      }
    }
    if (process.argv.includes('--once')) { process.exitCode = failures ? 1 : 0; break; }
    if (!stopping) await setTimeout(intervalMs, undefined, { signal: timer.signal }).catch(() => {});
  } while (!stopping);
} finally { await db.close(); }
