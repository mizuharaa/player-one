import { boxBlur3, meanOf, stdOf, type FrameSet } from './frames.ts';

/**
 * Screen-recapture cues: what a camera pointed at a display leaves behind.
 *
 *   border   a persistent rectangular boundary — the display's bezel or the
 *            dark surround — dark, flat, and in the same place on every frame.
 *   grid     a fine periodic pattern from the display's pixel matrix beating
 *            against the sensor's (moiré). Measured as energy at the
 *            alternating (Nyquist) spatial frequency relative to the frame's
 *            own residual, so it is a ratio, not an absolute.
 *   flicker  the display's refresh beating against the camera's exposure:
 *            frame-to-frame brightness oscillation that a lit scene does not
 *            have at this rate.
 *
 * Reference implementation on 64×64 grey frames. Moiré in particular is a
 * native-resolution phenomenon that area-downscaling largely removes, so on
 * real footage this measures the coarse residue of it only; NOTES.md.
 */

export type RecaptureMeasure = {
  frames: number;
  /** Share of frames with a dark, flat outer ring around a brighter interior. */
  borderShare: number;
  /** Nyquist energy over residual energy, averaged over rows and columns and frames. */
  gridEnergy: number;
  /** Mean |Δ mean luma| between consecutive frames, over the mean luma. */
  flicker: number;
};

const RING = 4;

function hasBorder(f: Uint8Array, w: number, h: number): boolean {
  const ring: number[] = [];
  const inner: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f[y * w + x]!;
    if (x < RING || y < RING || x >= w - RING || y >= h - RING) ring.push(v);
    else inner.push(v);
  }
  const ringMean = meanOf(ring);
  return ringMean < 32 && stdOf(ring) < 8 && meanOf(inner) > ringMean + 40;
}

function gridEnergyOf(f: Uint8Array, w: number, h: number): number {
  const blurred = boxBlur3(f, w, h);
  let residualAbs = 0;
  for (let i = 0; i < f.length; i++) residualAbs += Math.abs(f[i]! - blurred[i]!);
  residualAbs /= f.length;
  if (residualAbs < 1e-6) return 0;

  let rows = 0;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += (x & 1 ? -1 : 1) * f[y * w + x]!;
    rows += Math.abs(s) / w;
  }
  let cols = 0;
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += (y & 1 ? -1 : 1) * f[y * w + x]!;
    cols += Math.abs(s) / h;
  }
  return (rows / h + cols / w) / 2 / residualAbs;
}

export function measureRecapture(set: FrameSet): RecaptureMeasure {
  const { width: w, height: h, frames } = set;
  if (frames.length === 0) return { frames: 0, borderShare: 0, gridEnergy: 0, flicker: 0 };
  let border = 0;
  let grid = 0;
  const means: number[] = [];
  for (const f of frames) {
    if (hasBorder(f, w, h)) border++;
    grid += gridEnergyOf(f, w, h);
    means.push(meanOf(f));
  }
  let dm = 0;
  for (let i = 1; i < means.length; i++) dm += Math.abs(means[i]! - means[i - 1]!);
  const overall = meanOf(means) || 1;
  return {
    frames: frames.length,
    borderShare: border / frames.length,
    gridEnergy: grid / frames.length,
    flicker: means.length > 1 ? dm / (means.length - 1) / overall : 0,
  };
}
