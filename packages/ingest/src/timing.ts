import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FileEntry } from './discover.ts';
import { reduceImuTimestamps, reduceTimestamps } from './csv.ts';

/**
 * ING-06..13. The money path.
 *
 * Raw duration comes from stream timestamps, never from the manifest, and the
 * usable extent is the INTERSECTION of stream coverage, not the union. Every
 * stream is a window; the payable footage is where all the windows overlap.
 * Taking the union pays for the widest stream, which is always the IMU, because
 * the IMU always starts first and ends last.
 */

export type PtsSource = 'sidecar' | 'container' | 'absent';

export type StreamTiming = {
  role: string;
  parts: FileEntry[];
  source: PtsSource;
  /**
   * Absolute epoch microseconds. Null when the source gives a length but not a
   * position: a container knows it holds 20.98 s of video, not when that began.
   */
  firstUs: bigint | null;
  lastUs: bigint | null;
  spanUs: bigint | null;
  sampleCount: number;
  medianDeltaUs: bigint | null;
  truncatedTail: boolean;
  /** Rows delivered out of order. Harmless: first/last are min/max. */
  backwardsSteps: number;
};

/**
 * A stream cannot span vastly more time than its own samples account for.
 * 072516's IMU holds 25,280 samples at ~1 ms, so it covers about 25 s — but its
 * first 916 rows carry the epoch twice, so min-to-max reads as 56 years. The
 * check anchors on the stream's own count and interval, so it needs no constant
 * tuned to any particular device or rate.
 */
export function hasClockFault(s: StreamTiming): boolean {
  if (s.spanUs === null || s.medianDeltaUs === null || s.medianDeltaUs <= 0n) return false;
  const implied = BigInt(s.sampleCount) * s.medianDeltaUs;
  return implied > 0n && s.spanUs > implied * 10n;
}

export type Timing = {
  method: 'pts_sidecar' | 'container' | 'imu_span' | 'wall_clock';
  confidence: 'exact' | 'derived' | 'estimated';
  usableStartUs: bigint | null;
  usableEndUs: bigint | null;
  rawDurationS: number;
  maxStreamSkewMs: number;
  /** Not on the episode record. Carried so review and tests can see the answer that was rejected. */
  unionDurationS: number;
};

const maxOf = (xs: bigint[]): bigint => xs.reduce((a, b) => (b > a ? b : a));
const minOf = (xs: bigint[]): bigint => xs.reduce((a, b) => (b < a ? b : a));
const toS = (us: bigint): number => Number(us) / 1e6;

// ---------------------------------------------------------------------------
// Reading the streams

const run = promisify(execFile);

/** Container duration in microseconds, or null if ffprobe cannot read the file. */
export async function probeDurationUs(path: string): Promise<bigint | null> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      path,
    ]);
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? BigInt(Math.round(seconds * 1e6)) : null;
  } catch {
    return null;
  }
}

/**
 * ING-11 fallback chain, per stream: PTS sidecar, then the container. The IMU
 * and wall-clock rungs are episode-wide decisions and live in computeTiming.
 */
export async function readStreams(entries: FileEntry[]): Promise<StreamTiming[]> {
  const media = entries.filter((e) => e.kind === 'media');
  const roles = [...new Set(media.map((e) => e.role).filter((r): r is string => r !== null))].sort();

  const out: StreamTiming[] = [];
  for (const role of roles) {
    const parts = media
      .filter((e) => e.role === role)
      .sort((a, b) => (a.partNumber ?? 0) - (b.partNumber ?? 0));

    if (role === 'imu') {
      out.push(...(await readImu(parts)));
      continue;
    }

    const sidecars = entries
      .filter((e) => e.kind === 'pts' && e.role === role)
      .sort((a, b) => (a.partNumber ?? 0) - (b.partNumber ?? 0));

    const reduced = [];
    for (const s of sidecars) {
      const r = await reduceTimestamps(s.path);
      if (r) reduced.push(r);
    }

    if (reduced.length > 0) {
      const first = minOf(reduced.map((r) => r.first));
      const last = maxOf(reduced.map((r) => r.last));
      out.push({
        role,
        parts,
        source: 'sidecar',
        firstUs: first,
        lastUs: last,
        spanUs: last - first,
        sampleCount: reduced.reduce((n, r) => n + r.count, 0),
        medianDeltaUs: reduced[0]!.medianDeltaUs,
        truncatedTail: reduced.some((r) => r.truncatedTail),
        backwardsSteps: reduced.reduce((n, r) => n + r.backwardsSteps, 0),
      });
      continue;
    }

    // Empty or absent sidecar. The container knows the length, not the position.
    let spanUs: bigint | null = null;
    for (const p of parts) {
      const d = await probeDurationUs(p.path);
      if (d !== null) spanUs = (spanUs ?? 0n) + d;
    }
    out.push({
      role,
      parts,
      source: spanUs === null ? 'absent' : 'container',
      firstUs: null,
      lastUs: null,
      spanUs,
      sampleCount: 0,
      medianDeltaUs: null,
      truncatedTail: false,
      backwardsSteps: 0,
    });
  }
  return out;
}

/** ING-27: accel and gyro interleave and share timestamps, so they are two streams, counted by type. */
async function readImu(parts: FileEntry[]): Promise<StreamTiming[]> {
  const out: StreamTiming[] = [];
  for (const type of ['accel', 'gyro'] as const) {
    const reduced = [];
    for (const p of parts) {
      const r = await reduceImuTimestamps(p.path);
      const t = type === 'accel' ? r.accel : r.gyro;
      if (t) reduced.push(t);
    }
    if (reduced.length === 0) continue;
    const first = minOf(reduced.map((r) => r.first));
    const last = maxOf(reduced.map((r) => r.last));
    out.push({
      role: `imu_${type}`,
      parts,
      source: 'sidecar',
      firstUs: first,
      lastUs: last,
      spanUs: last - first,
      sampleCount: reduced.reduce((n, r) => n + r.count, 0),
      medianDeltaUs: reduced[0]!.medianDeltaUs,
      truncatedTail: reduced.some((r) => r.truncatedTail),
      backwardsSteps: reduced.reduce((n, r) => n + r.backwardsSteps, 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The intersection

export function computeTiming(
  streams: StreamTiming[],
  declared: { start_time: string | null; end_time: string | null },
): Timing {
  /**
   * A stream with a broken clock is excluded rather than repaired. Guessing
   * which half of a bad clock to trust is how a collector gets paid the wrong
   * number. Excluding it costs the episode a flag; including 072516's IMU cost
   * that episode all 10.4 s of its good video, silently, as a zero.
   */
  const usable = streams.filter((s) => !hasClockFault(s));

  const positioned = usable.filter(
    (s): s is StreamTiming & { firstUs: bigint; lastUs: bigint } =>
      s.firstUs !== null && s.lastUs !== null,
  );

  if (positioned.length === 0) return fromWallClock(declared);

  const starts = positioned.map((s) => s.firstUs);
  const ends = positioned.map((s) => s.lastUs);

  // intersection, NOT union
  const usableStart = maxOf(starts);

  /**
   * A cut sidecar ends early because the file stops, not because the stream
   * did, so it must not be allowed to shorten the window. If every sidecar is
   * cut there is no trustworthy end left, and the container length becomes the
   * answer. 072538: the audio sidecar stops at 20.48 s, the video holds 20.98 s.
   */
  const enders = positioned.filter((s) => !s.truncatedTail);
  const usableEnd = enders.length > 0 ? minOf(enders.map((s) => s.lastUs)) : null;
  const windowUs =
    usableEnd !== null && usableEnd > usableStart ? usableEnd - usableStart : null;

  /**
   * A stream with a length but no position cannot move the window, but it can
   * shorten it: an overlap cannot outlast the shortest stream taking part in it.
   * This is what keeps a container-derived camera honest.
   */
  const caps = usable.filter((s) => s.firstUs === null && s.spanUs !== null).map((s) => s.spanUs!);
  const rawUs =
    windowUs !== null
      ? caps.length > 0
        ? minOf([windowUs, ...caps])
        : windowUs
      : caps.length > 0
        ? minOf(caps)
        : 0n;

  const cameras = usable.filter((s) => s.role.startsWith('camera_'));
  const camerasTimed = cameras.filter((s) => s.spanUs !== null);

  let method: Timing['method'];
  let confidence: Timing['confidence'];
  if (cameras.length > 0 && camerasTimed.length === 0) {
    // No camera timing at all: the answer rests on the IMU.
    method = 'imu_span';
    confidence = 'estimated';
  } else if (usable.some((s) => s.source === 'container')) {
    method = 'container';
    confidence = 'derived';
  } else {
    method = 'pts_sidecar';
    confidence = 'exact';
  }

  return {
    method,
    confidence,
    usableStartUs: usableStart,
    usableEndUs: usableEnd,
    rawDurationS: toS(rawUs),
    maxStreamSkewMs: Number(maxOf(starts) - minOf(starts)) / 1e3,
    unionDurationS: toS(maxOf(ends) - minOf(starts)),
  };
}

/**
 * ING-13. Last resort. Wall clock includes start-up and shut-down, so it
 * overstates media by up to 34%. There is nothing left to measure the start-up
 * offset against here, so the value is not discounted — it is flagged for
 * manual duration review instead.
 */
function fromWallClock(declared: { start_time: string | null; end_time: string | null }): Timing {
  const start = declared.start_time ? Date.parse(declared.start_time) : NaN;
  const end = declared.end_time ? Date.parse(declared.end_time) : NaN;
  const seconds =
    Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 1e3 : 0;
  return {
    method: 'wall_clock',
    confidence: 'estimated',
    usableStartUs: null,
    usableEndUs: null,
    rawDurationS: seconds,
    maxStreamSkewMs: 0,
    unionDurationS: seconds,
  };
}
