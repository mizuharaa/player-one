/**
 * Slice 2 smoke test. Prints declared duration, per-stream spans, the
 * intersection and the union side by side, per session.
 *
 * The union is printed deliberately: a human should be able to see both answers
 * and confirm the right one was taken.
 *
 *   node packages/ingest/scripts/timing-smoke.ts <dir-of-sessions|session-dir>
 */
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { discover } from '../src/discover.ts';
import { readCalibration } from '../src/calibration.ts';
import { readManifest, statsAreZeroed } from '../src/manifest.ts';
import { computeTiming, hasClockFault, readStreams } from '../src/timing.ts';

const root = process.argv[2];
if (!root) {
  console.error('usage: timing-smoke.ts <dir-of-sessions|session-dir>');
  process.exit(1);
}

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

const top = await discover(root);
const dirs =
  top.layout === 'session'
    ? [root]
    : (await readdir(root, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => join(root, d.name))
        .sort();

const summary: string[] = [];

for (const dir of dirs) {
  const d = await discover(dir);
  if (d.layout !== 'session') continue;

  const onDisk = new Set(d.entries.map((e) => e.file).concat(d.unclassified));
  const manifestPath = d.entries.find((e) => e.kind === 'manifest')?.path ?? null;
  const m = await readManifest(manifestPath, onDisk);
  const cal = await readCalibration(d.entries);
  const streams = await readStreams(d.entries);
  const t = computeTiming(streams, m.declared);

  console.log(`\n${'='.repeat(96)}`);
  console.log(`${basename(dir)}   device ${d.deviceName ?? '-'}   serial ${d.deviceSerial ?? '-'}`);
  console.log(
    `manifest ${m.present ? (m.parsed ? 'parsed' : 'UNPARSEABLE') : 'ABSENT'}` +
      `   firmware ${m.firmwareVersion ?? '-'}` +
      `   status ${m.declared.status ?? '-'}` +
      `   declared ${m.declared.duration_sec ?? '-'} s`,
  );
  console.log(
    `calibration ${cal.present ? 'both files' : 'INCOMPLETE'}` +
      `   serial ${cal.serial ?? '-'}` +
      `   cameras ${cal.cameraNames.join('/') || '-'} (manifest says ${m.cameraNames.join('/') || '-'})`,
  );
  console.log(
    `files block unresolved: ${m.unresolvedFiles.length}` +
      `   stats zeroed: ${statsAreZeroed(m.declared)}`,
  );

  console.log(
    `\n${pad('STREAM', 14)}${pad('SRC', 10)}${padL('COUNT', 7)}${padL('FIRST_US', 19)}${padL('LAST_US', 19)}${padL('SPAN_S', 10)}${padL('RATE_HZ', 9)}`,
  );
  for (const s of streams) {
    console.log(
      pad(s.role, 14) +
        pad(s.source, 10) +
        padL(String(s.sampleCount || '-'), 7) +
        padL(s.firstUs === null ? 'unpositioned' : String(s.firstUs), 19) +
        padL(s.lastUs === null ? '-' : String(s.lastUs), 19) +
        padL(s.spanUs === null ? '-' : (Number(s.spanUs) / 1e6).toFixed(6), 10) +
        padL(s.medianDeltaUs ? (1e6 / Number(s.medianDeltaUs)).toFixed(2) : '-', 9) +
        (hasClockFault(s) ? '   CLOCK FAULT - EXCLUDED' : '') +
        (s.backwardsSteps > 0 ? `   ${s.backwardsSteps} out of order` : '') +
        (s.truncatedTail ? '   cut mid-line' : ''),
    );
  }

  const declared = m.declared.duration_sec;
  const ratio = declared && t.rawDurationS > 0 ? declared / t.rawDurationS : null;
  console.log(
    `\n  declared (manifest)  ${padL((declared ?? 0).toFixed(3), 9)} s` +
      (ratio ? `   ${ratio.toFixed(2)}x the measured value` : `   (status ${m.declared.status ?? 'unknown'})`),
  );
  console.log(`  UNION  (rejected)    ${padL(t.unionDurationS.toFixed(6), 9)} s`);
  console.log(`  INTERSECTION (used)  ${padL(t.rawDurationS.toFixed(6), 9)} s   <- raw_duration_s`);
  console.log(
    `  method ${t.method}   confidence ${t.confidence}   skew ${t.maxStreamSkewMs.toFixed(2)} ms`,
  );

  summary.push(
    pad(basename(dir).slice(-6), 8) +
      padL((declared ?? 0).toFixed(3), 10) +
      padL(t.unionDurationS.toFixed(3), 10) +
      padL(t.rawDurationS.toFixed(3), 14) +
      '   ' +
      pad(t.method, 13) +
      pad(t.confidence, 11) +
      padL(t.maxStreamSkewMs.toFixed(1), 9),
  );
}

console.log(`\n${'='.repeat(96)}`);
console.log(
  pad('SESSION', 8) + padL('DECLARED', 10) + padL('UNION', 10) + padL('INTERSECTION', 14) + '   ' + pad('METHOD', 13) + pad('CONF', 11) + padL('SKEW_MS', 9),
);
for (const line of summary) console.log(line);
console.log();
