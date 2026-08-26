import { execFile } from 'node:child_process';

/**
 * Frame decoding and the per-frame statistics every media signal reads.
 *
 * One ffmpeg pass per file: sampled at `fps` (1 by default), scaled to a
 * small grey square (64×64 by default). Everything downstream — motion energy,
 * luma, the noise floor, the frame fingerprint, PRNU, recapture cues — is
 * computed from these frames, so a two-hour episode is 7,200 frames of 4 KiB
 * and never a decode of the full-resolution stream.
 *
 * That is also the honest limit of these analysers: they see a 64×64 summary,
 * not the sensor. tools/analysers/NOTES.md says what a production build needs
 * per signal.
 */

export type FrameSet = { width: number; height: number; fps: number; frames: Uint8Array[] };

export type DecodeOptions = {
  width?: number;
  height?: number;
  fps?: number;
  /** Stop after this many sampled frames. Unset decodes the whole file. */
  maxFrames?: number;
  ffmpeg?: string;
};

export class ToolMissing extends Error {}

/** Runs a tool and returns its stdout as bytes. ENOENT is a missing tool, never a verdict on the file. */
export function runTool(
  cmd: string,
  args: string[],
  opts: { maxBuffer?: number; input?: Buffer } = {},
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { encoding: 'buffer', maxBuffer: opts.maxBuffer ?? 512 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string }) | null;
        if (e && e.code === 'ENOENT') {
          reject(new ToolMissing(`${cmd} was not found on PATH`));
          return;
        }
        const code = typeof e?.code === 'number' ? e.code : e ? -1 : 0;
        resolve({ stdout: stdout as unknown as Buffer, stderr: String(stderr), code });
      },
    );
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input);
    }
  });
}

export async function decodeFrames(file: string, o: DecodeOptions = {}): Promise<FrameSet> {
  const width = o.width ?? 64;
  const height = o.height ?? 64;
  const fps = o.fps ?? 1;
  const args = ['-v', 'error', '-nostdin', '-i', file, '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=gray`];
  if (o.maxFrames !== undefined) args.push('-frames:v', String(o.maxFrames));
  args.push('-f', 'rawvideo', '-pix_fmt', 'gray', '-');
  const { stdout, code, stderr } = await runTool(o.ffmpeg ?? 'ffmpeg', args);
  if (code !== 0 && stdout.length === 0) throw new Error(`ffmpeg could not decode ${file}: ${stderr.trim()}`);
  const n = width * height;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + n <= stdout.length; at += n) frames.push(new Uint8Array(stdout.subarray(at, at + n)));
  return { width, height, fps, frames };
}

/** Several parts of one stream, in order, as one frame set. */
export async function decodeParts(files: readonly string[], o: DecodeOptions = {}): Promise<FrameSet> {
  const sets = [];
  for (const f of files) sets.push(await decodeFrames(f, o));
  const first = sets[0] ?? { width: o.width ?? 64, height: o.height ?? 64, fps: o.fps ?? 1, frames: [] };
  return { ...first, frames: sets.flatMap((s) => s.frames) };
}

// ---------------------------------------------------------------------------
// Pure arithmetic on grey frames.

/** 3×3 box blur with clamped edges. Linear, so residuals add. */
export function boxBlur3(frame: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { sum += frame[yy * w + xx]!; n++; }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

export const meanOf = (a: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return a.length === 0 ? 0 : s / a.length;
};

export const stdOf = (a: ArrayLike<number>): number => {
  const m = meanOf(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i]! - m; s += d * d; }
  return a.length === 0 ? 0 : Math.sqrt(s / a.length);
};

export const medianOf = (a: ArrayLike<number>): number => {
  if (a.length === 0) return 0;
  const s = Float64Array.from(a as ArrayLike<number>).sort();
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Mean absolute difference between two blurred frames: the motion proxy. */
export function motionBetween(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
}

/**
 * The noise standard deviation of one frame, by Immerkær's fast estimator:
 * the response of the second-difference mask
 *     1 −2  1
 *    −2  4 −2
 *     1 −2  1
 * has zero response to any locally linear or quadratic surface and a known
 * response to white noise, so σ = sqrt(π/2) · Σ|I∗M| / (6 (W−2)(H−2)). A
 * box-blur residual was tried first and measured the content — a smooth
 * sine already read 1.3 — where this reads the sensor.
 */
export function noiseFloorOf(frame: Uint8Array, _blurred: Float32Array, w: number, h: number): number {
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = (yy: number, xx: number): number => frame[yy * w + xx]!;
    const v =
      p(y - 1, x - 1) - 2 * p(y - 1, x) + p(y - 1, x + 1) -
      2 * p(y, x - 1) + 4 * p(y, x) - 2 * p(y, x + 1) +
      p(y + 1, x - 1) - 2 * p(y + 1, x) + p(y + 1, x + 1);
    sum += Math.abs(v);
  }
  return (Math.sqrt(Math.PI / 2) * sum) / (6 * (w - 2) * (h - 2));
}

/**
 * Average hash: 8×8 block means against their mean, 64 bits as 16 hex chars.
 * Stable across re-encoding at any bitrate, which is what a duplicate check
 * needs; a sha256 of the file is defeated by a re-encode and this is not.
 */
export function aHash(frame: Uint8Array, w: number, h: number): string {
  const bw = Math.max(1, Math.floor(w / 8));
  const bh = Math.max(1, Math.floor(h / 8));
  const cells = new Float64Array(64);
  for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
    let s = 0;
    for (let y = by * bh; y < (by + 1) * bh; y++) for (let x = bx * bw; x < (bx + 1) * bw; x++) s += frame[y * w + x]!;
    cells[by * 8 + bx] = s / (bw * bh);
  }
  const m = meanOf(cells);
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4; b++) nib = (nib << 1) | (cells[i + b]! > m ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d + Math.abs(a.length - b.length) * 4;
}

export type FrameStats = {
  count: number;
  width: number;
  height: number;
  /** Mean grey level per frame, 0–255. */
  meanLuma: number[];
  /** Spatial standard deviation per frame. */
  std: number[];
  /** Motion proxy between consecutive sampled frames; length count−1. */
  motion: number[];
  /** Noise floor per frame. */
  noiseFloor: number[];
  /** Average hash per frame. */
  ahash: string[];
};

export function frameStats(set: FrameSet): FrameStats {
  const { width: w, height: h } = set;
  const meanLuma: number[] = [];
  const std: number[] = [];
  const motion: number[] = [];
  const noiseFloor: number[] = [];
  const ahash: string[] = [];
  let prev: Float32Array | null = null;
  for (const f of set.frames) {
    const blurred = boxBlur3(f, w, h);
    meanLuma.push(meanOf(f));
    std.push(stdOf(f));
    noiseFloor.push(noiseFloorOf(f, blurred, w, h));
    ahash.push(aHash(f, w, h));
    if (prev !== null) motion.push(motionBetween(blurred, prev));
    prev = blurred;
  }
  return { count: set.frames.length, width: w, height: h, meanLuma, std, motion, noiseFloor, ahash };
}
