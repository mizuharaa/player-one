import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';

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
};

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
  private deltas = new Map<bigint, number>();
  backwardsSteps = 0;

  push(ts: bigint): void {
    if (this.prev !== null) {
      const d = ts - this.prev;
      if (d < 0n) this.backwardsSteps++;
      this.deltas.set(d, (this.deltas.get(d) ?? 0) + 1);
    }
    if (this.first === null || ts < this.first) this.first = ts;
    if (this.last === null || ts > this.last) this.last = ts;
    this.prev = ts;
    this.count++;
  }

  result(truncatedTail: boolean): Reduction | null {
    if (this.first === null || this.last === null) return null;
    return {
      first: this.first,
      last: this.last,
      count: this.count,
      medianDeltaUs: this.median(),
      truncatedTail,
      backwardsSteps: this.backwardsSteps,
    };
  }

  private median(): bigint | null {
    if (this.deltas.size === 0) return null;
    const sorted = [...this.deltas.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const total = this.count - 1;
    let seen = 0;
    for (const [delta, n] of sorted) {
      seen += n;
      if (seen * 2 > total) return delta;
    }
    return sorted[sorted.length - 1]![0];
  }
}

/**
 * Yields only newline-terminated lines. A file whose last line is not
 * terminated was cut off mid-write; that partial line is not data and parsing
 * it yields a plausible-looking small integer, which is worse than dropping it.
 */
async function* lines(path: string, complete: boolean): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let pending: string | null = null;
  for await (const line of rl) {
    if (pending !== null) yield pending;
    pending = line;
  }
  if (pending !== null && complete) yield pending;
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
  for await (const line of lines(path, !truncated)) {
    const s = line.trim();
    if (!s) continue;
    if (header) {
      header = false;
      if (s === 'timestamp_us') continue;
    }
    acc.push(BigInt(s));
  }
  return acc.result(truncated);
}

export type ImuReduction = {
  rows: number;
  accel: Reduction | null;
  gyro: Reduction | null;
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
  let header = true;

  for await (const line of lines(path, !truncated)) {
    if (!line.trim()) continue;
    const fields = line.split(',');
    if (header) {
      header = false;
      const names = fields.map((f) => f.trim());
      if (names.includes('timestamp_us')) {
        tsCol = names.indexOf('timestamp_us');
        typeCol = names.indexOf('type');
        continue;
      }
    }
    rows++;
    const ts = BigInt(fields[tsCol]!.trim());
    const type = fields[typeCol]?.trim();
    if (type === 'accel') accel.push(ts);
    else if (type === 'gyro') gyro.push(ts);
  }

  return { rows, accel: accel.result(truncated), gyro: gyro.result(truncated) };
}

export const spanUs = (r: Reduction): bigint => r.last - r.first;
export const spanS = (r: Reduction): number => Number(r.last - r.first) / 1e6;
