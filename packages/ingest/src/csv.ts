import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

/**
 * Streaming timestamp reduce. These files are append-only timestamp streams,
 * not tables: a two-hour IMU capture is 14.4M rows and must never be resident.
 * ING-07, ING-26..28.
 */

export type Reduction = {
  first: bigint;
  last: bigint;
  count: number;
  /** null when fewer than two samples. */
  medianDeltaUs: bigint | null;
  /**
   * The file's final line had no terminating newline and was discarded.
   * Real: 072538's audio PTS sidecar stops mid-digit at exactly 8192 bytes.
   */
  truncatedTail: boolean;
  /**
   * Rows whose timestamp went backwards relative to the previous row. Small
   * steps are out-of-order delivery and harmless once first/last are min/max;
   * a huge one means the clock base changed. Real: 072538's audio reorders by
   * 2-6 sample intervals, 072516's IMU jumps 56 years.
   */
  backwardsSteps: number;
  /**
   * Rows that were not a timestamp at all and were skipped. A device that
   * writes a half-line or a decimal must not take the whole ingest down with
   * it, but it must not do so quietly either.
   */
  malformedRows: number;
};

/**
 * A microsecond timestamp is a non-negative integer, nothing else. Anything
 * with a sign, a decimal point or a letter is not a timestamp, and BigInt()
 * throws on all three. Nineteen digits is past the year 300,000.
 */
const TIMESTAMP = /^[0-9]{1,19}$/;

export const parseTimestamp = (field: string): bigint | null =>
  TIMESTAMP.test(field) ? BigInt(field) : null;

class Accumulator {
  // first/last are min/max, not the first and last rows: audio sidecars deliver
  // a few buffers out of order, and the row order is not the time order.
  first: bigint | null = null;
  last: bigint | null = null;
  count = 0;
  private prev: bigint | null = null;
  // ponytail: exact median from a delta histogram. Distinct delta values are in
  // the hundreds for these streams; swap for reservoir sampling if a stream ever
  // shows unbounded jitter.
  //
  // Keyed by Number, not BigInt: a BigInt map key is boxed and hashed on every
  // one of 14.4M rows, and that showed up as real time in the profile. A delta
  // is exact as a double below 2^53 microseconds — 285 years — and the widest
  // real fault in the corpus is 072516's 56-year clock jump. First and last stay
  // BigInt, because those are the money path; this histogram only feeds
  // nominal_rate_hz.
  private deltas = new Map<number, number>();
  backwardsSteps = 0;

  push(ts: bigint): void {
    if (this.prev !== null) {
      const d = Number(ts - this.prev);
      if (d < 0) this.backwardsSteps++;
      this.deltas.set(d, (this.deltas.get(d) ?? 0) + 1);
    }
    if (this.first === null || ts < this.first) this.first = ts;
    if (this.last === null || ts > this.last) this.last = ts;
    this.prev = ts;
    this.count++;
  }

  malformedRows = 0;

  result(truncatedTail: boolean): Reduction | null {
    if (this.first === null || this.last === null) return null;
    return {
      first: this.first,
      last: this.last,
      count: this.count,
      medianDeltaUs: this.median(),
      truncatedTail,
      backwardsSteps: this.backwardsSteps,
      malformedRows: this.malformedRows,
    };
  }

  private median(): bigint | null {
    if (this.deltas.size === 0) return null;
    const sorted = [...this.deltas.entries()].sort((a, b) => a[0] - b[0]);
    const total = this.count - 1;
    let seen = 0;
    for (const [delta, n] of sorted) {
      seen += n;
      if (seen * 2 > total) return BigInt(delta);
    }
    return BigInt(sorted[sorted.length - 1]![0]);
  }
}

/**
 * Calls `onLine` for every newline-terminated line. A file whose last line is
 * not terminated was cut off mid-write; that partial line is not data and
 * parsing it yields a plausible-looking small integer, which is worse than
 * dropping it — so the final line is held back and only delivered when the file
 * ended cleanly.
 *
 * A callback rather than an async generator, and chunk-at-a-time rather than
 * `readline`. Both are throughput, not taste: a two-hour IMU capture is 14.4M
 * rows, and yielding each one across an async generator costs a microtask per
 * row. This awaits once per megabyte instead of once per row, which is where
 * most of the parser's time was going.
 */
async function forEachLine(
  path: string,
  complete: boolean,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new StringDecoder('utf8');
  let carry = '';
  let pending: string | null = null;

  // Decoded per chunk, so a multi-byte character split across a read boundary is
  // reassembled by StringDecoder rather than becoming two replacement chars.
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    carry += decoder.write(chunk as Buffer);
    let start = 0;
    for (;;) {
      const nl = carry.indexOf('\n', start);
      if (nl === -1) break;
      const end = nl > start && carry.charCodeAt(nl - 1) === 13 ? nl - 1 : nl; // \r\n
      if (pending !== null) onLine(pending);
      pending = carry.slice(start, end);
      start = nl + 1;
    }
    if (start > 0) carry = carry.slice(start);
  }

  carry += decoder.end();
  if (carry !== '') {
    if (pending !== null) onLine(pending);
    pending = carry;
  }
  if (pending !== null && complete) onLine(pending);
}

/**
 * The nth comma-separated field, without materialising the others. `split(',')`
 * on an IMU row allocates five strings per row and we need two of them.
 */
function field(line: string, n: number): string {
  let start = 0;
  for (let i = 0; i < n; i++) {
    const comma = line.indexOf(',', start);
    if (comma === -1) return '';
    start = comma + 1;
  }
  const end = line.indexOf(',', start);
  return end === -1 ? line.slice(start) : line.slice(start, end);
}

async function endsWithNewline(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await fh.close();
  }
}

/** Single-column PTS sidecar with a plain `timestamp_us` header (ING-08 of the brief). */
export async function reduceTimestamps(path: string): Promise<Reduction | null> {
  const acc = new Accumulator();
  const truncated = !(await endsWithNewline(path));
  let header = true;
  await forEachLine(path, !truncated, (line) => {
    const s = line.trim();
    if (!s) return;
    if (header) {
      header = false;
      if (s === 'timestamp_us') return;
    }
    const ts = parseTimestamp(s);
    if (ts === null) {
      acc.malformedRows++;
      return;
    }
    acc.push(ts);
  });
  return acc.result(truncated);
}

export type ImuReduction = {
  rows: number;
  accel: Reduction | null;
  gyro: Reduction | null;
  /** Rows with no usable timestamp, too few columns, or a type that is neither accel nor gyro. */
  malformedRows: number;
};

/**
 * IMU CSV. Header is `timestamp_us\t,x\t,y\t,z\t,type` — comma-separated names
 * each carrying a trailing tab (ING-26). Accel and gyro rows interleave and
 * share timestamps, so per-type counts come from the `type` column, never from
 * halving the row count (ING-27).
 */
export async function reduceImuTimestamps(path: string): Promise<ImuReduction> {
  const accel = new Accumulator();
  const gyro = new Accumulator();
  const truncated = !(await endsWithNewline(path));
  let tsCol = 0;
  let typeCol = 4;
  let rows = 0;
  let malformed = 0;
  let header = true;

  await forEachLine(path, !truncated, (line) => {
    if (!line.trim()) return;
    if (header) {
      header = false;
      // Only the header is split: it is one row, and the column names have to be
      // looked up by name (ING-26 — each carries a trailing tab).
      const names = line.split(',').map((f) => f.trim());
      if (names.includes('timestamp_us')) {
        tsCol = names.indexOf('timestamp_us');
        typeCol = names.indexOf('type');
        return;
      }
    }
    rows++;
    const ts = parseTimestamp(field(line, tsCol).trim());
    const type = field(line, typeCol).trim();
    if (ts === null || (type !== 'accel' && type !== 'gyro')) {
      malformed++;
      return;
    }
    if (type === 'accel') accel.push(ts);
    else gyro.push(ts);
  });

  return {
    rows,
    accel: accel.result(truncated),
    gyro: gyro.result(truncated),
    malformedRows: malformed,
  };
}

export const spanUs = (r: Reduction): bigint => r.last - r.first;
export const spanS = (r: Reduction): number => Number(r.last - r.first) / 1e6;
