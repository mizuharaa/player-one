import { boxBlur3, type FrameSet } from './frames.ts';

/**
 * PRNU — photo-response non-uniformity — as a provenance check.
 *
 * Every sensor has a fixed pattern of per-pixel gain error. It survives
 * compression well enough to be measured, it cannot be removed without
 * knowing it, and it is different on every unit that leaves the factory.
 * "Did this footage come from the unit we handed the collector" is therefore
 * a correlation between two noise residuals, not a classifier — classical
 * forensics (Lukáš, Fridrich, Goljan 2006), no model, no training data.
 *
 * Two halves, and only one of them is here:
 *
 *   Enrolment  — hardware checkout records a unit's fingerprint from footage
 *                it knows the unit produced (flat, evenly lit frames are
 *                best). That is a change to `packages/hardware-checkout`,
 *                which this engine may not edit. `PrnuEnrolmentSource` is the
 *                seam it will fill; `noEnrolment` is what runs until it does,
 *                and PROV.PRNU_MISMATCH is simply not evaluated.
 *   Matching   — below. The reference implementation works on the 64×64 grey
 *                frames every other analyser uses, which is enough to prove
 *                the signal on synthetic input and NOT enough for a real
 *                sensor: PRNU lives at native resolution. NOTES.md has the
 *                production requirements.
 */

export type PrnuFingerprint = {
  deviceSerial: string;
  width: number;
  height: number;
  /** How many frames the fingerprint averages. */
  frames: number;
  enrolledAt: string;
  /** Where it came from: a checkout session id, a file, a test. */
  source: string;
  /** Zero-mean, unit-norm residual, row-major, width×height. */
  values: number[];
};

export interface PrnuEnrolmentSource {
  /** The enrolled fingerprint for a unit, or null when the unit has none. */
  fingerprintFor(deviceSerial: string): Promise<PrnuFingerprint | null>;
}

/** What runs until hardware checkout enrols units: nothing is evaluated. */
export const noEnrolment: PrnuEnrolmentSource = { fingerprintFor: async () => null };

/** For tests, and for a checkout script that keeps a JSON file per unit. */
export class InMemoryEnrolment implements PrnuEnrolmentSource {
  private readonly by = new Map<string, PrnuFingerprint>();
  constructor(fingerprints: readonly PrnuFingerprint[] = []) {
    for (const f of fingerprints) this.by.set(f.deviceSerial, f);
  }
  add(f: PrnuFingerprint): void {
    this.by.set(f.deviceSerial, f);
  }
  async fingerprintFor(deviceSerial: string): Promise<PrnuFingerprint | null> {
    return this.by.get(deviceSerial) ?? null;
  }
}

/** frame − denoised(frame). A 3×3 box blur is the denoiser here; a wavelet one is the production choice. */
export function residual(frame: Uint8Array, w: number, h: number): Float32Array {
  const blurred = boxBlur3(frame, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = frame[i]! - blurred[i]!;
  return out;
}

/** Zero-mean, unit-norm copy. Correlation between two of these is a dot product. */
export function normalise(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i]!;
  mean /= Math.max(1, v.length);
  let norm = 0;
  for (let i = 0; i < v.length; i++) { out[i] = v[i]! - mean; norm += out[i]! * out[i]!; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

/**
 * The mean residual over a frame set. Scene content averages towards zero
 * as frames accumulate; the sensor's fixed pattern does not, which is the
 * whole trick.
 */
export function residualMean(set: FrameSet): Float32Array {
  const n = set.width * set.height;
  const acc = new Float64Array(n);
  for (const f of set.frames) {
    const r = residual(f, set.width, set.height);
    for (let i = 0; i < n; i++) acc[i]! += r[i]!;
  }
  const count = Math.max(1, set.frames.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = acc[i]! / count;
  return out;
}

/** Normalised cross-correlation of two equal-length vectors, in [−1, 1]. */
export function correlate(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const na = normalise(a);
  const nb = normalise(b);
  let s = 0;
  for (let i = 0; i < na.length; i++) s += na[i]! * nb[i]!;
  return s;
}

/** What hardware checkout would run over known-good footage of one unit. */
export function enrol(
  set: FrameSet,
  deviceSerial: string,
  meta: { source: string; enrolledAt?: string },
): PrnuFingerprint {
  return {
    deviceSerial,
    width: set.width,
    height: set.height,
    frames: set.frames.length,
    enrolledAt: meta.enrolledAt ?? new Date().toISOString(),
    source: meta.source,
    values: Array.from(normalise(residualMean(set))),
  };
}

/** Correlation of an episode's residual with an enrolled fingerprint, or null when they cannot be compared. */
export function prnuCorrelation(set: FrameSet, fp: PrnuFingerprint): number | null {
  if (fp.width !== set.width || fp.height !== set.height || set.frames.length === 0) return null;
  return correlate(residualMean(set), fp.values);
}
