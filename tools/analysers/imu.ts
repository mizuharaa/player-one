import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { FrameStats } from './frames.ts';

/**
 * The IMU trace as a per-second motion series, and its correlation with what
 * the picture did — PROV.IMU_VIDEO_DECORR.
 *
 * A head-worn camera's picture moves when the head moves. The gyro records
 * the head moving. Footage that was not recorded by this device on this head
 * — generated, recaptured from a screen, copied from another unit — has a
 * picture that moves without the IMU agreeing, or an IMU that moves without
 * the picture agreeing. The Pearson correlation between the two per-second
 * series is cheap, robust, needs no model, and is wrong only in a way an
 * operator can see: a static scene under a still head correlates poorly too,
 * which is why CONT.STATIC_SCENE is a separate signal and why this one is
 * 'review' and not 'hold'.
 *
 * The CSV is the device's: header `timestamp_us\t,x\t,y\t,z\t,type`, rows
 * `us,x,y,z,accel|gyro`, the same layout packages/ingest/src/csv.ts reads.
 */

export type ImuSeries = {
  firstUs: bigint | null;
  accelRows: number;
  gyroRows: number;
  /** Mean |ω| (rad/s) per whole second from the first sane gyro row. */
  gyroPerSecond: number[];
  /** Rows whose clock is more than an hour from the first sane row. */
  clockOutlierRows: number;
};

const SANE_WINDOW_US = 3600n * 1_000_000n;

/**
 * `referenceUs` is the clock the rows are judged against — the camera's first
 * PTS, which the ingest record carries. Without one the first row is the
 * reference, and a trace that OPENS with a clock fault (072516: 916 rows 56
 * years ahead) would then count every sane row as the outlier. corpus_check.py
 * makes the same choice with the manifest's start_time.
 */
export async function readImuCsv(path: string, o: { referenceUs?: bigint | null } = {}): Promise<ImuSeries> {
  const sums: number[] = [];
  const counts: number[] = [];
  let firstUs: bigint | null = null;
  let accelRows = 0;
  let gyroRows = 0;
  let outliers = 0;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const tsText = parts[0]!.trim();
    if (!/^\d+$/.test(tsText)) continue;
    const ts = BigInt(tsText);
    const type = parts[4]!.trim();
    const reference = o.referenceUs ?? firstUs ?? ts;
    const fromReference = ts - reference;
    if (fromReference < -SANE_WINDOW_US || fromReference > SANE_WINDOW_US) { outliers++; continue; }
    if (firstUs === null) firstUs = ts;
    const delta = ts - firstUs;
    if (type === 'accel') { accelRows++; continue; }
    if (type !== 'gyro') continue;
    gyroRows++;
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const z = Number(parts[3]);
    const s = Number(delta / 1_000_000n);
    sums[s] = (sums[s] ?? 0) + Math.sqrt(x * x + y * y + z * z);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const gyroPerSecond: number[] = [];
  for (let i = 0; i < sums.length; i++) gyroPerSecond.push(counts[i] ? sums[i]! / counts[i]! : 0);
  return { firstUs, accelRows, gyroRows, gyroPerSecond, clockOutlierRows: outliers };
}

export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]!; mb += b[i]!; }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  // Both flat: nothing to compare. One flat: the picture moved while the head
  // did not, or the head moved while the picture did not — no correlation, and
  // that is a real answer, not a missing one.
  if (saa === 0 && sbb === 0) return null;
  if (saa === 0 || sbb === 0) return 0;
  return sab / Math.sqrt(saa * sbb);
}

/**
 * Frame i of a 1 fps sample is second i; motion[i] is the change from second
 * i to i+1, which is what the gyro bucket i+1 measured. Both series are
 * aligned on that and trimmed to the shorter one.
 */
export function imuVideoCorrelation(
  frames: Pick<FrameStats, 'motion'>,
  imu: Pick<ImuSeries, 'gyroPerSecond'>,
): { correlation: number; seconds: number } | null {
  const motion = frames.motion;
  const gyro = imu.gyroPerSecond.slice(1);
  const n = Math.min(motion.length, gyro.length);
  const r = pearson(motion.slice(0, n), gyro.slice(0, n));
  return r === null ? null : { correlation: r, seconds: n };
}
