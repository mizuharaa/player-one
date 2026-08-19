/**
 * ingest <dir> [--json] [--out file]
 *
 * Human-readable summary by default. --json emits the EpisodeRecord.
 */
import { writeFile } from 'node:fs/promises';
import { ingest, UnsupportedLayoutError } from '../src/ingest.ts';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const json = args.includes('--json');
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : undefined;

if (!dir) {
  console.error('usage: ingest <dir> [--json] [--out file]');
  process.exit(2);
}

let record;
try {
  record = await ingest(dir);
} catch (err) {
  if (err instanceof UnsupportedLayoutError) {
    console.error(`${err.message}\nThis tool reads ego session directories.`);
    process.exit(2);
  }
  throw err;
}

const text = JSON.stringify(record, null, 2);
if (out) await writeFile(out, text);

if (json) {
  if (!out) console.log(text);
} else {
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
  if (out) console.log(`\n  written to     ${out}`);
  console.log();
}

process.exit(record.state === 'quarantined' ? 1 : 0);
