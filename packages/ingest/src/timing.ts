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
  /**
   * `lastUs` came from measuring the media, because the sidecar's index was cut
   * short. The stream's end is known; it just was not the sidecar that knew it.
   * Absent or false with `truncatedTail` set means the end is a floor: real, but
   * short by an unknown amount.
   */
  endFromMedia?: boolean;
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
 * Uncompressed PCM, so the duration is arithmetic on the file size — no decoder
 * and no ffprobe. The declared sizes are not used and must not be: 072538's
 * header still says `RIFF size 36` and `data size 0` because the device never
 * went back to patch them, exactly as it never set `end_time`. The bytes on
 * disk are the recording; the header is a claim about it.
 */
export async function wavDurationUs(path: string, bytes: number): Promise<bigint | null> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    if (bytesRead < 44) return null;
    if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
      return null;
    }

    // Walk the chunk list rather than assuming the canonical 44-byte layout:
    // some writers put LIST/fact chunks before the data.
    let byteRate = 0;
    let at = 12;
    while (at + 8 <= bytesRead) {
      const id = head.toString('latin1', at, at + 4);
      const size = head.readUInt32LE(at + 4);
      // fmt payload: format(2) channels(2) sampleRate(4) byteRate(4) ...
      if (id === 'fmt ' && at + 20 <= bytesRead) byteRate = head.readUInt32LE(at + 16);
      if (id === 'data') {
        const payload = bytes - (at + 8);
        if (byteRate <= 0 || payload <= 0) return null;
        return BigInt(Math.round((payload / byteRate) * 1e6));
      }
      if (size === 0) break; // unpatched placeholder: nothing after this is trustworthy
      at += 8 + size + (size % 2);
    }
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * How much recording the media itself holds, summed over the parts. This is the
 * evidence a cut sidecar cannot give: the frames and the samples exist whether
 * or not anything got round to indexing them.
 *
 * Null when any part cannot be measured — a partial answer over a multi-part
 * stream would understate it, and understating is still getting it wrong.
 */
async function mediaSpanUs(parts: FileEntry[]): Promise<bigint | null> {
  let total = 0n;
  for (const p of parts) {
    const wav = p.file.toLowerCase().endsWith('.wav')
      ? await wavDurationUs(p.path, p.bytes)
      : null;
    if (wav !== null) {
      total += wav;
      continue;
    }
    const probe = await probeContainer(p.path);
    if (probe === null) return null;
    total += probe.durationUs;
  }
  return parts.length > 0 ? total : null;
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
      let last = maxOf(reduced.map((r) => r.last));
      const truncatedTail = reduced.some((r) => r.truncatedTail);

      /**
       * A cut sidecar is an incomplete INDEX, not a stream that stopped.
       * 072538's audio sidecar ends at 8192 bytes exactly — an unflushed write
       * buffer — while the WAV beside it holds 21.16 s of real sound that the
       * index never named. The media is the recording, so the media measures
       * the end. UPL-08 and 5.3.7 already say this about the manifest; a
       * sidecar is metadata too.
       *
       * When the media cannot be measured the sidecar's end stands as a floor:
       * short, possibly, but never longer than what was recorded.
       */
      let endFromMedia = false;
      if (truncatedTail) {
        const mediaUs = await mediaSpanUs(parts);
        if (mediaUs !== null && first + mediaUs > last) {
          last = first + mediaUs;
          endFromMedia = true;
          // coverageOf reads partTimings, so the measured end goes there too.
          const tail = partTimings.reduce((a, b) => (b.lastUs > a.lastUs ? b : a));
          tail.lastUs = last;
        }
      }

      out.push({
        role,
        parts,
        partTimings,
        source: 'sidecar',
        firstUs: first,
        lastUs: last,
        endFromMedia,
        spanUs: last - first,
        sampleCount: reduced.reduce((n, r) => n + r.count, 0),
        medianDeltaUs: reduced[0]!.medianDeltaUs,
        truncatedTail,
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

  /**
   * The instants every stream covered, as intervals. A scalar window cannot
   * express this: two cameras with holes in different places lose both holes,
   * and a hole outside the shared window costs nobody anything. Both of those
   * are money, so the arithmetic is done on intervals and the scalars are read
   * back off the result.
   *
   * Every stream carries a real end by the time it gets here: a cut sidecar had
   * its end measured from its own media in readStreams, so there is no unknown
   * left to special-case. That is the whole of the truncation handling now.
   */
  const common = positioned.map(coverageOf).reduce((a, b) => intersect(a, b));

  const usableStart = maxOf(starts); // intersection, NOT union
  const usableEnd = common.length > 0 ? common[common.length - 1]!.end : null;
  const commonUs = measure(common);

  /**
   * A stream with a length but no position cannot move the window, and it
   * cannot create one either: a duration is not evidence that anything was
   * recorded at the same moment as anything else. It only ever bounds, which is
   * what keeps a container-derived camera honest.
   *
   * Monotone and sound by construction: the result is one `min` over every
   * constraint in play, so adding a stream can only lower it, and it can never
   * exceed what any single stream covered. There is no branch left that lets a
   * lower rung override a higher one.
   */
  const caps = usable.filter((s) => s.firstUs === null && s.spanUs !== null).map((s) => s.spanUs!);
  const covered = caps.length > 0 ? minOf([commonUs, ...caps]) : commonUs;

  // Holes are already absent from `common`, so the gap is what the window lost.
  const windowUs = usableEnd !== null && usableEnd > usableStart ? usableEnd - usableStart : 0n;
  const gapUs = windowUs > commonUs ? windowUs - commonUs : 0n;
  const rawUs = covered;

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

  /**
   * Time that rests on a file which was cut is inferred, whatever the source
   * was. With nothing intact left to bound the inference, the whole window is
   * inference. Neither may be reported as exact: `exact` is what tells a
   * reviewer the number needs no second look.
   */
  const cut = positioned.filter((s) => s.truncatedTail);
  if (cut.length > 0 && cut.every((s) => s.endFromMedia !== true)) {
    // Nothing could confirm where those streams ended, so the answer is a floor.
    confidence = 'estimated';
  } else if (confidence === 'exact' && cut.length > 0) {
    // Measured, but from the media rather than from the timestamps.
    confidence = 'derived';
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

/** A half-open span of stream time. `end` is always greater than `start`. */
type Interval = { start: bigint; end: bigint };


/**
 * The instants one stream demonstrably covered. Parts are the unit: a hole
 * between two parts is time nobody recorded and is simply absent from the
 * result, which is what makes the intersection below do the right thing without
 * a separate gap subtraction. Two parts are contiguous when the join is no
 * wider than one sample interval — a normal segment boundary is not a hole.
 *
 * `lastUs` is already the stream's real end — measured from its media when the
 * sidecar was cut — so there is nothing to extend or borrow here.
 */
function coverageOf(s: StreamTiming & { firstUs: bigint; lastUs: bigint }): Interval[] {
  const step = s.medianDeltaUs !== null && s.medianDeltaUs > 0n ? s.medianDeltaUs : 0n;
  const sorted =
    s.partTimings.length > 0
      ? [...s.partTimings].sort((a, b) =>
          a.firstUs < b.firstUs ? -1 : a.firstUs > b.firstUs ? 1 : 0,
        )
      : [{ partNumber: null, firstUs: s.firstUs, lastUs: s.lastUs }];

  /**
   * The join between two consecutive parts is one normal sample period, not a
   * hole, so every part but the last is credited with it (ING-20 measures a gap
   * as the excess beyond one interval). The last part is not, which keeps a
   * whole stream's length at `last - first` — the span convention the rest of
   * the engine and the sample expectations are written against.
   */
  const parts = sorted.map((p, i) => ({
    start: p.firstUs,
    end: i < sorted.length - 1 ? p.lastUs + step : p.lastUs,
  }));

  const merged: Interval[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && p.start <= prev.end) {
      if (p.end > prev.end) prev.end = p.end;
    } else {
      merged.push({ ...p });
    }
  }

  return merged;
}

/** Both lists are sorted and disjoint, so one pass suffices. */
function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = a[i]!.start > b[j]!.start ? a[i]!.start : b[j]!.start;
    const end = a[i]!.end < b[j]!.end ? a[i]!.end : b[j]!.end;
    if (end > start) out.push({ start, end });
    if (a[i]!.end < b[j]!.end) i++;
    else j++;
  }
  return out;
}

const measure = (xs: Interval[]): bigint => xs.reduce((n, x) => n + (x.end - x.start), 0n);


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
