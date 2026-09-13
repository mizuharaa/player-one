/**
 * Wrap an ordinary MP4 into an Ego session directory the engine will measure.
 *
 *   node packages/api/scripts/make-session.mjs <clip.mp4> <outdir> \
 *     [--serial SYNTH76400FE] [--start 20260913_090000]
 *
 * Prints the directory it made. Point the console's **Debug delivery** page at
 * that folder and it goes through the phone's own routes: hashed in the
 * browser, registered as an unmeasured delivery, PUT to the object store with
 * the server's signed URLs, completed, measured by the engine server-side.
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT
 *
 * The five real sample sessions live on one machine and are 630 MB
 * (`CLAUDE.md`). Anybody who wants to watch a delivery happen needs a session
 * directory and has a phone clip instead. This turns one into the other, using
 * the same naming and the same sidecar shape as `session-footage.mjs` gives
 * `e2e-loop.mjs`.
 *
 * It is NOT a substitute for the corpus. The sidecars here are perfect — they
 * are derived from the clip's own packet times — and PaXini's are not: the real
 * ones are cut, the manifests overstate duration by about a third, and the
 * frame counts disagree. A green run against this directory says the platform
 * works; it says nothing about the encoder. Keep using the corpus for that.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  mediaFileName,
  sessionBasename,
  sessionStamp,
  writeSidecars,
} from './session-footage.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const [clip, outDir] = positional;

if (clip === undefined || outDir === undefined) {
  console.error(
    'usage: node packages/api/scripts/make-session.mjs <clip.mp4> <outdir> ' +
      '[--serial SYNTH76400FE] [--start YYYYMMDD_HHMMSS]',
  );
  process.exit(2);
}

/**
 * The serial goes in the directory name and in every file name, and the engine
 * cross-checks the two (`SERIAL-CONFLICT`). `[^_]+` is all the naming rule
 * allows, so an underscore in it would produce a directory nothing can read.
 */
const serial = flag('serial') ?? 'SYNTH76400FE';
if (!/^[A-Za-z0-9-]+$/.test(serial)) {
  console.error(`--serial ${serial}: letters, digits and hyphens only (an underscore splits the name)`);
  process.exit(2);
}

const startFlag = flag('start');
if (startFlag !== undefined && !/^\d{8}_\d{6}$/.test(startFlag)) {
  console.error(`--start ${startFlag}: expected YYYYMMDD_HHMMSS`);
  process.exit(2);
}

/**
 * The recording's wall-clock start, which is also the stamp in the name.
 *
 * Default: now. `resolve.ts` crosschecks a device's custody period against the
 * episode's start instant and an episode that starts before every period on
 * record is "not checkable" — so a session stamped in the past proves less,
 * and is offered only because somebody demonstrating a backlog wants one.
 */
const start =
  startFlag === undefined
    ? new Date()
    : new Date(
        Number(startFlag.slice(0, 4)),
        Number(startFlag.slice(4, 6)) - 1,
        Number(startFlag.slice(6, 8)),
        Number(startFlag.slice(9, 11)),
        Number(startFlag.slice(11, 13)),
        Number(startFlag.slice(13, 15)),
      );
if (Number.isNaN(start.getTime())) {
  console.error(`--start ${startFlag}: not a date`);
  process.exit(2);
}

const basename = sessionBasename(serial, start);
const dir = resolve(join(outDir, basename));
const media = join(dir, mediaFileName(basename));

const source = resolve(clip);
if (!(await stat(source).catch(() => null))?.isFile()) {
  console.error(`${source} is not a file`);
  process.exit(2);
}

await mkdir(dir, { recursive: true });

/**
 * Remuxed, not re-encoded, and the `moov` box moved to the front.
 *
 * `-c copy` keeps the operator's own footage exactly as it is — this script has
 * no business re-compressing somebody's clip to make a demo — while
 * `+faststart` is what a ranged read of a partially uploaded object needs. A
 * clip whose codec an MP4 container cannot hold fails here, by ffmpeg's own
 * message, rather than silently producing a session the engine cannot decode.
 */
execFileSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', media],
  { stdio: 'inherit' },
);

const startUs = BigInt(start.getTime()) * 1000n;
const { frames, firstUs, lastUs } = await writeSidecars(dir, basename, media, startUs);
const bytes = (await stat(media)).size;

console.log(dir);
console.log(
  `  ${mediaFileName(basename)}  ${bytes} bytes, ${frames} frames, ` +
    `${((Number(lastUs - firstUs) / 1e6)).toFixed(3)} s of PTS`,
);
console.log(`  session stamp ${sessionStamp(start)} (local time), serial ${serial}`);
console.log('  pick this folder on the console’s Debug delivery page.');
