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

describe('the two properties, not just the examples', () => {
  /** Deterministic. A seeded LCG so a failure is reproducible from the seed alone. */
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  /**
   * Intersection monotonicity: payable time is the set of instants EVERY stream
   * covered, so adding a stream can only remove instants. If adding one ever
   * raises the number, some branch is taking a max, or letting a lower rung
   * override a higher one, and a collector is being paid for footage that does
   * not exist.
   *
   * Truncated streams and containers are both generated, so the run reaches the
   * open-window branch where the fault lived. Results marked `estimated` are
   * skipped on both sides: those are the case where no positioned stream can
   * close the window, so the number is an explicit floor rather than a
   * measurement, and comparing a floor against a measurement compares two
   * different claims. Everything the engine reports as measured is compared.
   */
  it('adding a stream never increases the payout', () => {
    const rand = rng(20260821);
    for (let trial = 0; trial < 600; trial++) {
      const n = 2 + Math.floor(rand() * 3);
      const streams: StreamTiming[] = [];
      for (let i = 0; i < n; i++) {
        const from = Math.floor(rand() * 6);
        const len = 1 + Math.floor(rand() * 10);
        const cut = rand() < 0.3;
        streams.push(
          rand() < 0.3
            ? gapped(`camera_${i}`, from, from + 1, from + 2, from + len + 2)
            : stream(`camera_${i}`, from, from + len, { truncatedTail: cut }),
        );
      }
      if (rand() < 0.5) streams.push(unpositioned('audio', 1 + Math.floor(rand() * 12)));

      const whole = computeTiming(streams, NO_MANIFEST);
      if (whole.confidence === 'estimated') continue;
      for (let i = 0; i < streams.length; i++) {
        const without = streams.filter((_, j) => j !== i);
        if (without.filter((s) => s.firstUs !== null).length === 0) continue; // rung changed
        const part = computeTiming(without, NO_MANIFEST);
        if (part.confidence === 'estimated') continue;
        expect(
          whole.rawDurationS,
          `trial ${trial}: dropping ${streams[i]!.role} raised ` +
            `${whole.rawDurationS} to ${part.rawDurationS}`,
        ).toBeLessThanOrEqual(part.rawDurationS + 1e-9);
      }
    }
  });

  /**
   * Soundness, which is the property that actually protects the money: the
   * paid duration never exceeds what any single participant demonstrably
   * covered. Truncated streams are excluded because paying past a cut file is
   * the deliberate 072538 rule — an intact stream makes no such claim.
   */
  it('never pays more than any intact stream, or any container, covered', () => {
    const rand = rng(778);
    for (let trial = 0; trial < 400; trial++) {
      const streams: StreamTiming[] = [];
      const n = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const from = Math.floor(rand() * 5);
        const len = 1 + Math.floor(rand() * 10);
        streams.push(
          stream(`camera_${i}`, from, from + len, { truncatedTail: rand() < 0.35 }),
        );
      }
      const caps: number[] = [];
      if (rand() < 0.5) {
        const c = 1 + Math.floor(rand() * 12);
        caps.push(c);
        streams.push(unpositioned('audio', c));
      }

      const paid = computeTiming(streams, NO_MANIFEST).rawDurationS;
      for (const s of streams) {
        if (s.firstUs === null || s.truncatedTail) continue;
        const own = Number(s.lastUs! - s.firstUs) / 1e6;
        expect(paid, `trial ${trial}: paid ${paid} over ${s.role}'s ${own}`).toBeLessThanOrEqual(
          own + 1e-9,
        );
      }
      for (const c of caps) expect(paid).toBeLessThanOrEqual(c + 1e-9);
    }
  });

  /**
   * KNOWN EXCEPTION, and the one place monotonicity does not hold numerically.
   *
   * With every positioned stream cut, no positioned stream can say where the
   * window ends. The engine then reports the container length, per the ING-11 /
   * ING-12 rule that 072538 is built on ("every sidecar is cut, so the
   * container length is the answer"). With no container either, it reports the
   * floor the cut streams proved, because returning nothing would make real
   * footage unpayable.
   *
   * Those two answers are not comparable — a floor is not a measurement — so
   * adding a container moves 3 s to 20 s. Making it strictly monotone means
   * bounding by the floor always, which re-prices 072538 from 20.980 s to
   * 20.480 s. That is a pricing decision, not a coding one, so the behaviour is
   * pinned here rather than changed quietly. Both results are `estimated`.
   */
  it('open window: the container answers, and the floor stands in when there is none', () => {
    const cut = [stream('camera_left', 0, 3, { truncatedTail: true })];
    const alone = computeTiming(cut, NO_MANIFEST);
    const withContainer = computeTiming([...cut, unpositioned('audio', 20)], NO_MANIFEST);

    expect(alone.rawDurationS).toBeCloseTo(3, 3);
    expect(withContainer.rawDurationS).toBeCloseTo(20, 3);
    // The saving grace: neither is ever presented as measured.
    expect(alone.confidence).toBe('estimated');
    expect(withContainer.confidence).toBe('estimated');
  });

  it('a container never overrides a positioned end, it only bounds it', () => {
    // The ordering rule: a lower rung is consulted when the one above returns
    // nothing, never because it returns a bigger number.
    const t = computeTiming([stream('camera_left', 0, 3), unpositioned('audio', 20)], NO_MANIFEST);
    expect(t.rawDurationS).toBeCloseTo(3, 3);
  });

  it('a cut stream does not borrow another stream to outlast a shorter intact one', () => {
    const t = computeTiming(
      [
        stream('camera_left', 0, 3, { truncatedTail: true }),
        stream('imu_accel', 0, 4),
        stream('camera_right', 0, 20),
      ],
      NO_MANIFEST,
    );
    // imu closes the window at 4. The cut camera cannot reach past it by
    // borrowing camera_right's 20.
    expect(t.rawDurationS).toBeCloseTo(4, 3);
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
