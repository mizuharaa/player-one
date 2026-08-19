/**
 * Slice 1 smoke test. Eyeballable, not asserting.
 *   node packages/ingest/scripts/smoke.ts <session-dir>
 */
import { basename } from 'node:path';
import { discover } from '../src/discover.ts';
import { reduceImuTimestamps, reduceTimestamps, spanS } from '../src/csv.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: smoke.ts <session-dir>');
  process.exit(1);
}

const pad = (s: string, n: number) => s.padEnd(n);
const d = await discover(dir);

console.log(`\ndirectory ${basename(d.dir)}`);
console.log(`layout    ${d.layout}`);
console.log(`device    ${d.deviceName ?? '-'}    serial    ${d.deviceSerial ?? '-'}    timestamp ${d.sessionTimestamp ?? '-'}\n`);

if (d.layout !== 'session') {
  console.log(`${d.subdirs.length} subdirectories, ${d.unclassified.length} files this engine does not read`);
  for (const n of d.subdirs.slice(0, 5)) console.log(`  dir   ${n}`);
  for (const n of d.unclassified.slice(0, 5)) console.log(`  file  ${n}`);
  if (d.unclassified.length > 5) console.log(`  ...   and ${d.unclassified.length - 5} more`);
  console.log();
  process.exit(0);
}

console.log(`${pad('KIND', 12)}${pad('ROLE', 14)}${pad('PART', 6)}${pad('BYTES', 12)}FILE`);
for (const e of d.entries) {
  console.log(
    pad(e.kind, 12) +
      pad(e.role ?? '-', 14) +
      pad(e.partNumber === null ? '-' : String(e.partNumber), 6) +
      pad(String(e.bytes), 12) +
      e.file,
  );
}
console.log(`\nunclassified: ${d.unclassified.length ? d.unclassified.join(', ') : '(none)'}\n`);

const row = (label: string, count: number, first: bigint, last: bigint, span: number, median: bigint | null, cut: boolean) =>
  pad(label, 16) +
  pad(String(count), 8) +
  pad(String(first), 18) +
  pad(String(last), 18) +
  pad(span.toFixed(6), 11) +
  pad(String(median ?? '-'), 9) +
  (cut ? 'CUT MID-LINE' : '');

console.log(
  `${pad('STREAM', 16)}${pad('COUNT', 8)}${pad('FIRST_US', 18)}${pad('LAST_US', 18)}${pad('SPAN_S', 11)}${pad('DELTA_US', 9)}NOTE`,
);
for (const e of d.entries.filter((x) => x.kind === 'pts')) {
  const r = await reduceTimestamps(e.path);
  if (!r) {
    console.log(pad(e.role ?? '?', 16) + 'EMPTY (0-byte sidecar)');
    continue;
  }
  console.log(row(e.role ?? '?', r.count, r.first, r.last, spanS(r), r.medianDeltaUs, r.truncatedTail));
}
for (const e of d.entries.filter((x) => x.kind === 'media' && x.role === 'imu')) {
  const r = await reduceImuTimestamps(e.path);
  for (const [type, red] of [['accel', r.accel], ['gyro', r.gyro]] as const) {
    if (!red) continue;
    console.log(row(`imu_${type}`, red.count, red.first, red.last, spanS(red), red.medianDeltaUs, red.truncatedTail));
  }
  console.log(`imu rows ${r.rows}`);
}
console.log();
