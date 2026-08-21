import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { FileEntry } from './discover.ts';
import { reduceImuTimestamps, reduceTimestamps, type Reduction } from './csv.ts';

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

export type PartTiming = { partNumber: number | null; firstUs: bigint; lastUs: bigint };

export type StreamTiming = {
  role: string;
  parts: FileEntry[];
  /** One entry per part that had readable timestamps, in file-name order. */
  partTimings: PartTiming[];
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
  /** Parts whose container is structurally short, with the reason. Empty when every part is whole. */
  incompleteParts: { file: string; detail: string }[];
  /** Rows in this stream's timestamp files that were not timestamps and were skipped. */
  malformedRows: number;
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
  /** Time inside the window with no footage in it, already removed from rawDurationS. */
  gapS: number;
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

/**
 * Is the MP4 all there?
 *
 * An ISO base media file is a tree of boxes, each declaring its own length, and
 * the top-level ones must tile the file exactly. A file cut short still carries
 * an intact `moov`, so it answers ffprobe with a full duration and looks
 * healthy: the 072310 sample cut to 45% of its bytes reports 8.515 s, longer
 * than the intact original. What it cannot hide is an `mdat` that claims more
 * bytes than the file has left.
 *
 * This reads box headers only — a few hundred bytes of seeks, not a pass over
 * the media — so it can run on every video rather than only on the ones whose
 * sidecar failed.
 */
export async function checkMp4Complete(path: string): Promise<string | null> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    if (size === 0) return 'the file is empty';

    const head = Buffer.alloc(16);
    let off = 0;
    while (off < size) {
      const { bytesRead } = await fh.read(head, 0, 16, off);
      if (bytesRead < 8) return `a box header at ${off} runs past the end of the file`;

      let len = head.readUInt32BE(0);
      // Past a bad box the walk is reading media as headers, so the "type" is
      // whatever bytes happened to be there. Show it, but readably.
      const type = head.toString('latin1', 4, 8).replace(/[^ -~]/g, '.');
      if (len === 1) {
        if (bytesRead < 16) return `a 64-bit box header at ${off} runs past the end of the file`;
        len = Number(head.readBigUInt64BE(8));
      } else if (len === 0) {
        len = size - off; // the last box may run to the end
      }

      if (len < 8) return `the box at ${off} declares an impossible length of ${len}`;
      if (off + len > size) {
        return `${type} at ${off} declares ${len} bytes but only ${size - off} remain`;
      }
      off += len;
    }
    return null;
  } finally {
    await fh.close();
  }
}

export type Probe = { durationUs: bigint; packets: number };

/**
 * ffprobe is absent from the machine, which is an install fault and not a
 * property of the delivery. It gets its own type because the CLI already treats
 * a bare ENOENT as "the operator mistyped the directory".
 */
export class FfprobeMissingError extends Error {}

/**
 * Container timing, or null when the file is damaged.
 *
 * `format=duration` alone is not enough: a real MP4 cut to 45% of its bytes
 * still answers with a duration, and a slightly longer one than the intact
 * file. Counting packets is what exposes it — the intact sample reports 256
 * packets and matches its sidecar exactly, the truncated copy reports 121 and
 * writes NAL errors to stderr.
 *
 * ponytail: this is a second full read of the file, so it runs only where the
 * sidecar is unusable and the container is the only source left. A truncated
 * file that still has a good sidecar is not caught here; that is a corrupted
 * delivery, and CHECKSUM-MISMATCH against the sending side is the check for it.
 */
export async function probeContainer(path: string): Promise<Probe | null> {
  try {
    const { stdout, stderr } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-count_packets',
      '-show_entries', 'format=duration:stream=nb_read_packets',
      '-of', 'json',
      path,
    ]);
    if (stderr.trim() !== '') return null; // decoder complained: the container is damaged
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { nb_read_packets?: string }[];
    };
    const seconds = Number(parsed.format?.duration);
    const packets = Number(parsed.streams?.[0]?.nb_read_packets ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return { durationUs: BigInt(Math.round(seconds * 1e6)), packets };
  } catch (err) {
    /**
     * A spawn ENOENT is ffprobe missing from PATH, never the media file: this
     * path is only reached for a file discovery already found on disk. Returning
     * null for it would be indistinguishable from "the container is damaged",
     * so every session at an upload centre without ffmpeg would quietly fall
     * through to a weaker timing rung and be measured — and paid — wrong. An
     * install fault must not present as a data defect.
     */
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FfprobeMissingError(
        'ffprobe was not found on PATH. Install ffmpeg: the container is the ' +
          'timing fallback when a PTS sidecar is unusable, and without it durations are wrong.',
      );
    }
    return null;
  }
}

/**
 * ING-11 fallback chain, per stream: PTS sidecar, then the container. The IMU
 * and wall-clock rungs are episode-wide decisions and live in computeTiming.
 */
/** Every .mp4 part that does not tile its own file length. */
async function incompleteIn(parts: FileEntry[]): Promise<{ file: string; detail: string }[]> {
  const out = [];
  for (const p of parts) {
    if (!p.file.toLowerCase().endsWith('.mp4')) continue;
    const detail = await checkMp4Complete(p.path);
    if (detail !== null) out.push({ file: p.file, detail });
  }
  return out;
}

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

    const incompleteParts = await incompleteIn(parts);

    const sidecars = entries
      .filter((e) => e.kind === 'pts' && e.role === role)
      .sort((a, b) => (a.partNumber ?? 0) - (b.partNumber ?? 0));

    const reduced = [];
    const partTimings: PartTiming[] = [];
    for (const s of sidecars) {
      const r = await reduceTimestamps(s.path);
      if (!r) continue;
      reduced.push(r);
      partTimings.push({ partNumber: s.partNumber, firstUs: r.first, lastUs: r.last });
    }

    if (reduced.length > 0) {
      const first = minOf(reduced.map((r) => r.first));
      const last = maxOf(reduced.map((r) => r.last));
      out.push({
        role,
        parts,
        partTimings,
        source: 'sidecar',
        firstUs: first,
        lastUs: last,
        spanUs: last - first,
        sampleCount: reduced.reduce((n, r) => n + r.count, 0),
        medianDeltaUs: reduced[0]!.medianDeltaUs,
        truncatedTail: reduced.some((r) => r.truncatedTail),
        backwardsSteps: reduced.reduce((n, r) => n + r.backwardsSteps, 0),
        incompleteParts,
        malformedRows: reduced.reduce((n, r) => n + r.malformedRows, 0),
      });
      continue;
    }

    // Empty or absent sidecar. The container knows the length, not the position.
    let spanUs: bigint | null = null;
    let packets = 0;
    let damaged = false;
    for (const p of parts) {
      const probe = await probeContainer(p.path);
      if (probe === null) {
        damaged = true;
        continue;
      }
      spanUs = (spanUs ?? 0n) + probe.durationUs;
      packets += probe.packets;
    }
    if (damaged) spanUs = null; // one unreadable part makes the whole stream untrustworthy
    out.push({
      role,
      parts,
      partTimings: [],
      source: spanUs === null ? 'absent' : 'container',
      firstUs: null,
      lastUs: null,
      spanUs,
      sampleCount: spanUs === null ? 0 : packets,
      medianDeltaUs: null,
      truncatedTail: false,
      backwardsSteps: 0,
      incompleteParts,
      malformedRows: 0,
    });
  }
  return out;
}

/**
 * ING-27: accel and gyro interleave and share timestamps, so they are two
 * streams counted by type. One pass over the file yields both — a two-hour log
 * is 14.4M rows and reading it once per type doubles the bill for nothing.
 */
async function readImu(parts: FileEntry[]): Promise<StreamTiming[]> {
  const byType = { accel: [] as Reduction[], gyro: [] as Reduction[] };
  const timings = { accel: [] as PartTiming[], gyro: [] as PartTiming[] };
  let malformedRows = 0;

  for (const p of parts) {
    const r = await reduceImuTimestamps(p.path);
    malformedRows += r.malformedRows;
    for (const type of ['accel', 'gyro'] as const) {
      const t = r[type];
      if (!t) continue;
      byType[type].push(t);
      timings[type].push({ partNumber: p.partNumber, firstUs: t.first, lastUs: t.last });
    }
  }

  const out: StreamTiming[] = [];

  // Rows arrived but none carried a type we know, so there is no accel or gyro
  // stream to hang the complaint on. Emit the file itself so it is not silent.
  if (byType.accel.length === 0 && byType.gyro.length === 0) {
    if (malformedRows === 0) return out;
    return [
      {
        role: 'imu',
        parts,
        partTimings: [],
        source: 'absent',
        firstUs: null,
        lastUs: null,
        spanUs: null,
        sampleCount: 0,
        medianDeltaUs: null,
        truncatedTail: false,
        backwardsSteps: 0,
        incompleteParts: [],
        malformedRows,
      },
    ];
  }

  for (const type of ['accel', 'gyro'] as const) {
    const reduced = byType[type];
    if (reduced.length === 0) continue;
    const first = minOf(reduced.map((r) => r.first));
    const last = maxOf(reduced.map((r) => r.last));
    out.push({
      role: `imu_${type}`,
      parts,
      partTimings: timings[type],
      source: 'sidecar',
      firstUs: first,
      lastUs: last,
      spanUs: last - first,
      sampleCount: reduced.reduce((n, r) => n + r.count, 0),
      medianDeltaUs: reduced[0]!.medianDeltaUs,
      truncatedTail: reduced.some((r) => r.truncatedTail),
      backwardsSteps: reduced.reduce((n, r) => n + r.backwardsSteps, 0),
      incompleteParts: [],
      malformedRows,
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
  const covered =
    windowUs !== null
      ? caps.length > 0
        ? minOf([windowUs, ...caps])
        : windowUs
      : caps.length > 0
        ? minOf(caps)
        : 0n;

  /**
   * A hole between two parts is time nobody recorded, so it is not payable.
   * ponytail: takes the worst stream's total gap rather than the union of gap
   * intervals across streams. Parts only ever split on the segment boundary, so
   * the cameras gap together; compute a real interval union if that stops
   * holding.
   */
  const gapUs = usable.reduce((worst, s) => {
    const g = gapWithin(s);
    return g > worst ? g : worst;
  }, 0n);
  const rawUs = covered > gapUs ? covered - gapUs : 0n;

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
    gapS: toS(gapUs),
    maxStreamSkewMs: Number(maxOf(starts) - minOf(starts)) / 1e3,
    unionDurationS: toS(maxOf(ends) - minOf(starts)),
  };
}

/** ING-20. Total time between one part ending and the next starting, beyond one sample interval. */
export function gapWithin(s: StreamTiming): bigint {
  if (s.partTimings.length < 2 || s.medianDeltaUs === null || s.medianDeltaUs <= 0n) return 0n;
  const ordered = [...s.partTimings].sort((a, b) =>
    a.firstUs === b.firstUs ? (a.partNumber ?? 0) - (b.partNumber ?? 0) : a.firstUs < b.firstUs ? -1 : 1,
  );
  let total = 0n;
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i]!.firstUs - ordered[i - 1]!.lastUs - s.medianDeltaUs;
    if (gap > 0n) total += gap;
  }
  return total;
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
    gapS: 0,
    maxStreamSkewMs: 0,
    unionDurationS: seconds,
  };
}
