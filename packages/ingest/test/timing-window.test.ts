import { describe, expect, it } from 'vitest';
import { computeTiming, type StreamTiming } from '../src/timing.ts';

/**
 * The payable window, as interval arithmetic.
 *
 * Every case here is money: rawDurationS is multiplied by a unit price and paid
 * to a collector. The rule under test is one sentence — payable time is the set
 * of instants every usable stream demonstrably covered — and each test names the
 * way the scalar implementation broke it.
 */

const S = 1_000_000n;
const T0 = 1_000_000_000_000_000n;
const HZ = 33_334n; // ~30 fps, the sample corpus's camera interval

/** One contiguous stream from `from` to `to`, seconds relative to T0. */
function stream(
  role: string,
  from: number,
  to: number,
  extra: Partial<StreamTiming> = {},
): StreamTiming {
  const first = T0 + BigInt(Math.round(from * 1e6));
  const last = T0 + BigInt(Math.round(to * 1e6));
  return {
    role,
    parts: [],
    partTimings: [{ partNumber: 1, firstUs: first, lastUs: last }],
    source: 'sidecar',
    firstUs: first,
    lastUs: last,
    spanUs: last - first,
    sampleCount: Number((last - first) / HZ) + 1,
    medianDeltaUs: HZ,
    truncatedTail: false,
    backwardsSteps: 0,
    incompleteParts: [],
    malformedRows: 0,
    ...extra,
  };
}

/** A stream in two parts, with a hole between `gapFrom` and `gapTo`. */
function gapped(role: string, from: number, gapFrom: number, gapTo: number, to: number): StreamTiming {
  const at = (s: number) => T0 + BigInt(Math.round(s * 1e6));
  const base = stream(role, from, to);
  return {
    ...base,
    // Part 1's last sample sits one interval before the hole starts: the engine
    // credits the join with one sample period, so coverage ends exactly at
    // `gapFrom` and the hole is exactly [gapFrom, gapTo].
    partTimings: [
      { partNumber: 1, firstUs: at(from), lastUs: at(gapFrom) - HZ },
      { partNumber: 2, firstUs: at(gapTo), lastUs: at(to) },
    ],
  };
}

/** A length with no position: a container that knows how long it is, not when it began. */
function unpositioned(role: string, seconds: number): StreamTiming {
  return {
    role,
    parts: [],
    partTimings: [],
    source: 'container',
    firstUs: null,
    lastUs: null,
    spanUs: BigInt(Math.round(seconds * 1e6)),
    sampleCount: Math.round(seconds * 30),
    medianDeltaUs: HZ,
    truncatedTail: false,
    backwardsSteps: 0,
    incompleteParts: [],
    malformedRows: 0,
  };
}

const NO_MANIFEST = { start_time: null, end_time: null };

describe('gaps are unioned as intervals, not maxed as scalars', () => {
  it('two cameras with separate one-second holes lose both seconds, not the worse one', () => {
    // left  covers [0,2] and [3,10]; right covers [0,5] and [6,10].
    // Every instant both cameras hold: 10s minus [2,3] minus [5,6] = 8s.
    const t = computeTiming(
      [gapped('camera_left', 0, 2, 3, 10), gapped('camera_right', 0, 5, 6, 10)],
      NO_MANIFEST,
    );
    expect(t.rawDurationS).toBeCloseTo(8, 3);
    expect(t.gapS).toBeCloseTo(2, 3);
  });

  it('a hole outside the common window is not deducted from it', () => {
    // The IMU runs long and has a hole at [12,13], outside the cameras' window.
    // Nobody is paid for [12,13] anyway, so deducting it charges twice.
    const t = computeTiming(
      [stream('camera_left', 0, 10), gapped('imu_accel', 0, 12, 13, 20)],
      NO_MANIFEST,
    );
    expect(t.rawDurationS).toBeCloseTo(10, 3);
    expect(t.gapS).toBeCloseTo(0, 3);
  });
});

describe('an unpositioned container caps the window, it never creates one', () => {
  it('two cameras that never overlap are worth nothing, whatever the container says', () => {
    // left [0,4], right [6,10]: zero instants in common. A 5 s container length
    // is a duration, not evidence that anything was recorded simultaneously.
    const t = computeTiming(
      [stream('camera_left', 0, 4), stream('camera_right', 6, 10), unpositioned('audio', 5)],
      NO_MANIFEST,
    );
    expect(t.rawDurationS).toBe(0);
  });

  it('still caps a real overlap, which is what keeps a container-derived camera honest', () => {
    const t = computeTiming(
      [stream('camera_left', 0, 10), stream('camera_right', 0, 10), unpositioned('audio', 6)],
      NO_MANIFEST,
    );
    expect(t.rawDurationS).toBeCloseTo(6, 3);
  });
});

describe('a cut sidecar is a file that stopped, and the record says how much is inferred', () => {
  it('does not shorten the window when an untruncated stream still defines it', () => {
    // The repo's deliberate rule, and 072538 depends on it: the audio sidecar
    // stops early, the video holds the real end.
    const t = computeTiming(
      [stream('camera_left', 0, 5, { truncatedTail: true }), stream('imu_accel', 0, 10)],
      NO_MANIFEST,
    );
    expect(t.rawDurationS).toBeCloseTo(10, 3);
  });

  it('but never calls the inferred part exact', () => {
    const t = computeTiming(
      [stream('camera_left', 0, 5, { truncatedTail: true }), stream('imu_accel', 0, 10)],
      NO_MANIFEST,
    );
    // Five of the ten seconds rest on an assumption about a file that was cut.
    expect(t.confidence).not.toBe('exact');
  });

  it('falls back to the evidence that exists when every sidecar is cut, never to zero', () => {
    const t = computeTiming(
      [
        stream('camera_left', 0, 8, { truncatedTail: true }),
        stream('camera_right', 0, 10, { truncatedTail: true }),
      ],
      NO_MANIFEST,
    );
    // Both were cut, so nothing proves anything past 8 s — but 8 s of footage
    // demonstrably exists and returning 0 makes it unpayable.
    expect(t.rawDurationS).toBeCloseTo(8, 3);
    expect(t.confidence).toBe('estimated');
  });
});

describe('the ordinary case is unchanged', () => {
  it('two clean overlapping streams pay their intersection, exactly', () => {
    const t = computeTiming(
      [stream('camera_left', 0, 10), stream('camera_right', 1, 9)],
      NO_MANIFEST,
    );
    expect(t.rawDurationS).toBeCloseTo(8, 3);
    expect(t.confidence).toBe('exact');
    expect(t.gapS).toBeCloseTo(0, 3);
  });

  it('reports the union it rejected, so review can see the other answer', () => {
    const t = computeTiming(
      [stream('camera_left', 0, 10), stream('camera_right', 1, 9)],
      NO_MANIFEST,
    );
    expect(t.unionDurationS).toBeCloseTo(10, 3);
  });
});
