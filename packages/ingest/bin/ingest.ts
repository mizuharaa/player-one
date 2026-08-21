#!/usr/bin/env node
/**
 * ingest <dir> [--json] [--out file] [--store]
 * ingest --list [--state <state>] [--limit N]
 * ingest --show <episode-id> [--json]
 *
 * Human-readable summary by default. --json emits the EpisodeRecord.
 *
 * The store is opt-in and nothing else changes when it is off: without --store
 * (and with no DATABASE_URL) this is byte-identical to v0.3.1. The engine runs
 * at upload centres with the link down, so the measurement path never needs a
 * database and never opens a connection.
 */
import { writeFile } from 'node:fs/promises';
import { ingest, UnsupportedLayoutError } from '../src/ingest.ts';
import { FfprobeMissingError } from '../src/timing.ts';
import type { EpisodeRecord } from '@playerone/contracts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const json = args.includes('--json');

if (args.includes('--list')) process.exit(await list());
if (args.includes('--show')) process.exit(await show());

const dir = args.find((a) => !a.startsWith('--') && a !== flag('--out'));
const store = args.includes('--store');
const out = flag('--out');

if (!dir) {
  console.error(
    'usage: ingest <dir> [--json] [--out file] [--store]\n' +
      '       ingest --list [--state <state>] [--limit N]\n' +
      '       ingest --show <episode-id> [--json]',
  );
  process.exit(2);
}

let record: EpisodeRecord;
try {
  record = await ingest(dir);
} catch (err) {
  if (err instanceof UnsupportedLayoutError) {
    console.error(`${err.message}\nThis tool reads ego session directories.`);
    process.exit(2);
  }
  // Before the ENOENT branch below: a missing ffprobe also raises ENOENT, and
  // reporting it as "no such directory" would send the operator hunting a path
  // that is perfectly correct.
  if (err instanceof FfprobeMissingError) {
    console.error(err.message);
    process.exit(2);
  }
  // A path the operator mistyped is not a crash, and a stack trace tells them nothing.
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    console.error(`${dir}: no such directory`);
    process.exit(2);
  }
  if (code === 'ENOTDIR') {
    console.error(`${dir}: not a directory`);
    process.exit(2);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    console.error(`${dir}: permission denied`);
    process.exit(2);
  }
  throw err;
}

/**
 * The measurement is the expensive part of this run and must not be lost
 * because Postgres was down, so a store failure is reported *after* the record
 * has been printed — and never silently swallowed.
 */
let storeLine: string | null = null;
let storeError: Error | null = null;
if (store) {
  try {
    const { open, storeEpisode } = await import('@playerone/store');
    const db = await open();
    try {
      const result = await storeEpisode(db, record);
      record = result.record; // may now carry CHECKSUM-MISMATCH
      storeLine =
        result.outcome === 'duplicate'
          ? 'stored: duplicate (no-op)'
          : result.outcome === 'new'
            ? 'stored: new'
            : `stored: mismatch\n` +
              [
                ...result.mismatch!.changed.map((c) => `    changed  ${c.relative_path}`),
                ...result.mismatch!.added.map((a) => `    added    ${a.relative_path}`),
                ...result.mismatch!.removed.map((r) => `    removed  ${r.relative_path}`),
              ].join('\n');
    } finally {
      await db.close();
    }
  } catch (err) {
    storeError = err as Error;
  }
}

const text = JSON.stringify(record, null, 2);
if (out) await writeFile(out, text);

if (json) {
  if (!out) console.log(text);
} else {
  printRecord(record);
  if (out) console.log(`  written to     ${out}\n`);
}
if (storeLine) console.log(storeLine);
if (storeError) {
  console.error(`store failed: ${storeError.message}`);
  process.exit(3);
}

process.exit(record.state === 'quarantined' ? 1 : 0);

// ---------------------------------------------------------------------------

function printRecord(record: EpisodeRecord): void {
  const t = record.timing;
  const badge = { ok: 'OK', flagged: 'FLAGGED', quarantined: 'QUARANTINED' }[record.state];
  console.log(`\n${record.source.path}`);
  console.log(`  state          ${badge}`);
  console.log(`  episode        ${record.episode_id}`);
  console.log(`  fingerprint    ${record.content_fingerprint.slice(0, 16)}...`);
  console.log(`  device         ${record.device.serial}   firmware ${record.device.firmware_declared ?? '-'}`);
  console.log(`  calibration    ${record.calibration.present ? `${record.calibration.files.length} files, serial ${record.device.calibration_serial ?? '-'}` : 'MISSING'}`);
  console.log(
    `  duration       ${t.raw_duration_s.toFixed(3)} s   (declared ${record.declared?.duration_sec ?? '-'})`,
  );
  console.log(`  timing         ${t.method}, ${t.confidence}, skew ${t.max_stream_skew_ms.toFixed(1)} ms`);
  console.log(`\n  streams`);
  for (const s of record.streams) {
    console.log(
      `    ${s.role.padEnd(14)}${String(s.sample_count || '-').padStart(7)} samples  ` +
        `${s.span_s.toFixed(3).padStart(9)} s  ${s.pts_source}`,
    );
  }
  if (record.discrepancies.length > 0) {
    console.log(`\n  discrepancies`);
    for (const x of record.discrepancies) {
      console.log(`    [${x.severity}] ${x.code}: ${x.detail}`);
    }
  }
  if (record.unclassified_files.length > 0) {
    console.log(`\n  unclassified   ${record.unclassified_files.join(', ')}`);
  }
  console.log();
}

async function list(): Promise<number> {
  const { open, listEpisodes } = await import('@playerone/store');
  const limit = flag('--limit');
  let db;
  try {
    db = await open();
  } catch (err) {
    console.error((err as Error).message);
    return 3;
  }
  try {
    const rows = await listEpisodes(db, {
      state: flag('--state'),
      limit: limit === undefined ? undefined : Number(limit),
    });
    if (rows.length === 0) {
      console.log('no episodes stored');
      return 0;
    }
    console.log(
      'episode                              state        measured    declared  n  last seen',
    );
    for (const r of rows) {
      console.log(
        `${r.episodeId}  ${(r.state ?? '-').padEnd(11)}  ` +
          `${(r.measuredDurationS ?? '-').padStart(10)}  ${(r.declaredDurationS ?? '-').padStart(9)}  ` +
          `${String(r.ingestCount).padStart(1)}  ${r.lastSeenAt.toISOString()}`,
      );
    }
    return 0;
  } finally {
    await db.close();
  }
}

async function show(): Promise<number> {
  const id = flag('--show');
  if (!id) {
    console.error('usage: ingest --show <episode-id> [--json]');
    return 2;
  }
  const { open, showEpisode } = await import('@playerone/store');
  let db;
  try {
    db = await open();
  } catch (err) {
    console.error((err as Error).message);
    return 3;
  }
  try {
    const detail = await showEpisode(db, id);
    if (detail.latest === null) {
      console.error(`${detail.episodeId} has no ingests`);
      return 1;
    }
    if (json) {
      // The stored record_json, verbatim. This is the source of truth.
      console.log(JSON.stringify(detail.latest.record, null, 2));
      return detail.latest.record.state === 'quarantined' ? 1 : 0;
    }
    printRecord(detail.latest.record);
    console.log(`  ingests        ${detail.ingestCount}, first seen ${detail.firstSeenAt.toISOString()}`);
    for (const p of detail.prior) {
      console.log(
        `    prior        ${p.fingerprint.slice(0, 16)}...  ${p.ingestedAt.toISOString()}  engine ${p.engineVersion}`,
      );
    }
    console.log();
    return detail.latest.record.state === 'quarantined' ? 1 : 0;
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  } finally {
    await db.close();
  }
}
