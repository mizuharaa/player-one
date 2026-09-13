/**
 * Making an Ego session directory out of nothing, or out of an ordinary clip.
 *
 * Two callers, and they want different halves of it:
 *
 *   - `e2e-loop.mjs` wants footage that needs no corpus. It posts a MEASURED
 *     episode, so it only needs the directory name and a real, seekable MP4 —
 *     it writes the record itself and the engine never runs.
 *   - `make-session.mjs` wants a directory the ENGINE will measure, from a clip
 *     somebody already has. That needs the sidecars too, because without them
 *     the only timing available is the container's.
 *
 * This module is the part they share, extracted rather than copied. The naming
 * rule in particular has exactly one home now: `parseSessionBasename` in
 * `packages/contracts` and `looksLikeSessionDirectory` in
 * `packages/delivery` both refuse a name this does not produce, and a second
 * copy of the stamp format is a second thing to get wrong.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * `yyyymmdd_hhmmss`, which is the only stamp `parseSessionBasename` accepts.
 *
 * Local time, not UTC. The stamp is what an operator reads off the folder to
 * recognise their own recording, and this project runs at UTC+7 — a UTC stamp
 * on a session recorded at 09:00 says 02:00 and gets reported as the wrong
 * session. Nothing derives an instant from it: the engine measures time from
 * the PTS sidecars, and this string only has to be unique and recognisable.
 */
export const sessionStamp = (date = new Date()) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
};

/** `ego_<serial>_<yyyymmdd_hhmmss>`, the directory name and the episode's identity. */
export const sessionBasename = (serial, date = new Date()) =>
  `ego_${serial}_${sessionStamp(date)}`;

/**
 * The one media file name these sessions carry.
 *
 * `camera_left_part0001`, because that is what the device writes and what
 * `discover.ts`'s `REST` pattern classifies as a stream with a part number. A
 * name without `_partNNNN` is also valid — EgoViewer writes those — but the TF
 * card's shape is the one the pilot's sessions have.
 */
export const mediaFileName = (basename) => `${basename}_camera_left_part0001.mp4`;
export const ptsFileName = (basename) => `${basename}_camera_left_part0001_pts.csv`;
export const imuFileName = (basename) => `${basename}_imu_part0001.csv`;

/**
 * A real, seekable MP4 rather than a stub.
 *
 * The cloud leg hashes these bytes for real on the way out and again on the way
 * back, and `ffprobe` decodes them to measure the session, so they have to be
 * bytes. `+faststart` puts the `moov` box first, which is what makes a ranged
 * read of a partially uploaded object useful.
 */
export function syntheticClip(path, { seconds = 20, rate = 30, size = '640x480' } = {}) {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${rate}:duration=${seconds}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path,
    ],
    { stdio: 'inherit' },
  );
}

/** Every video packet's presentation time, in seconds, in decode order. */
export function packetTimes(path) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', path,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const times = out
    .split(/\r?\n/)
    .map((line) => Number(line.replace(/,$/, '')))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (times.length === 0) throw new Error(`${path} has no decodable video packets`);
  return times;
}

/** One column, one row per sample. `timing.ts` reads these as absolute microseconds. */
export const ptsCsv = (timestampsUs) =>
  ['timestamp_us', ...timestampsUs.map(String)].join('\n') + '\n';

/**
 * The IMU, at `rateHz`, spanning exactly `[firstUs, lastUs]`.
 *
 * Exactly, and that is the load-bearing part. Payable time is the
 * INTERSECTION of stream coverage and not the union (CLAUDE.md, §5.3.3,
 * UPL-14), so an IMU that starts a second late shortens the payable span of
 * the video beside it. A synthetic session whose streams disagree would be
 * measuring this script rather than the footage.
 *
 * The tab-and-comma header is the device's own, reproduced from the five real
 * sample sessions: `timestamp_us\t,x\t,y\t,z\t,type`.
 */
export function imuCsv(firstUs, lastUs, rateHz = 1000) {
  const step = BigInt(Math.round(1_000_000 / rateHz));
  const rows = ['timestamp_us\t,x\t,y\t,z\t,type'];
  for (let t = firstUs; t <= lastUs; t += step) {
    rows.push(`${t},0.100000,-9.800000,0.200000,accel`);
    rows.push(`${t},0.001000,0.002000,0.003000,gyro`);
  }
  // The last sample lands on the video's last frame however the rate divides,
  // so the intersection is not cut short by a rounding remainder.
  const last = rows.at(-1).split(',')[0];
  if (BigInt(last) !== lastUs) {
    rows.push(`${lastUs},0.100000,-9.800000,0.200000,accel`);
    rows.push(`${lastUs},0.001000,0.002000,0.003000,gyro`);
  }
  return rows.join('\n') + '\n';
}

/**
 * Calibration, synthetic, and written because its ABSENCE is a quarantine.
 *
 * Measured on this laptop: a session holding the clip and both sidecars and
 * nothing else ingests `quarantined` on one discrepancy, `CALIB-MISSING`
 * (severity `quarantine`) — a quarantined episode cannot be reviewed and
 * cannot be paid, so a debug delivery of one would reach `ingested` and then
 * dead-end. These two files are the same shape and the same synthetic values
 * `packages/ingest/scripts/make-fixtures.ts` writes, and the serial says
 * `SYNTHCAL001` so nobody mistakes them for a device's own calibration.
 *
 * There is no manifest. It is advisory on every path (UPL-08) and a synthetic
 * one would only add discrepancies about numbers this script invented.
 */
const CALIB_CAMERA = `calibration_info:
  format_version: 1.0
  calibration_date: 2026-8-13
  serial_number: SYNTHCAL001
  num_cameras: 2
  reference_camera: cam_0
cameras:
  - id: cam_0
    name: IR_L
    image_width: 1600
    image_height: 1300
  - id: cam_1
    name: IR_R
    image_width: 1600
    image_height: 1300
`;

const CALIB_IMU = `cam0:
  camera_model: pinhole
  resolution: [1600, 1300]
imu0:
  imu_model: misalignment
  update_rate: 1000
gravity: [0., 0., 9.81]
`;

/**
 * A whole session directory the engine can measure, from one MP4.
 *
 * `clip` is copied in by name only — the caller has already put the bytes at
 * `mediaFileName(basename)` — and the sidecars are written from the clip's OWN
 * packet times, so the sidecar index and the media agree. Borrowing a span
 * from anywhere else is the fault CLAUDE.md names: "a cut PTS sidecar is an
 * incomplete index, not a stopped sensor", and its end is measured from its own
 * media.
 *
 * A synthetic calibration goes in beside them; see `CALIB_CAMERA` above for why.
 */
export async function writeSidecars(dir, basename, mediaPath, startUs) {
  await mkdir(dir, { recursive: true });
  const times = packetTimes(mediaPath);
  const stamps = times.map((t) => startUs + BigInt(Math.round(t * 1_000_000)));
  await writeFile(join(dir, ptsFileName(basename)), ptsCsv(stamps), 'utf8');
  await writeFile(
    join(dir, imuFileName(basename)),
    imuCsv(stamps[0], stamps.at(-1)),
    'utf8',
  );
  await writeFile(join(dir, `${basename}_calibration_camera.yaml`), CALIB_CAMERA, 'utf8');
  await writeFile(join(dir, `${basename}_calibration_imu.yaml`), CALIB_IMU, 'utf8');
  return { frames: stamps.length, firstUs: stamps[0], lastUs: stamps.at(-1) };
}
