import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runTool } from './frames.ts';

/**
 * Synthetic sessions with known-planted properties, for the risk tests.
 *
 * Nothing in the committed fixtures can exercise a media signal — they are
 * 32-byte MP4 stubs — and the real corpus is 630 MB that is not in the repo.
 * So the tests render their own frames, deterministically from a seed, and
 * encode them with the ffmpeg on PATH into a session folder shaped exactly
 * like a device's (packages/ingest/src/discover.ts naming, corpus_check.py's
 * manifest fields). Every abuse the brief lists is a knob here: static
 * footage, a covered lens, a filmed screen, an IMU that does not follow the
 * picture, a truncated index, a different sensor pattern, silence.
 *
 * A frame is 64×64 grey. Content is a smooth random texture that scrolls
 * sideways by `motion[s]` pixels per frame during second `s`, plus Gaussian
 * sensor noise, plus an optional fixed per-device pattern (the PRNU stand-in).
 */

export class Prng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  /** xorshift32; [0, 1). */
  next(): number {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 0x1_0000_0000;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  gauss(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export const W = 64;
export const H = 64;

/** A fixed per-unit noise pattern, σ in grey levels. The synthetic sensor. */
export function devicePattern(seed: number, sigma = 6): Float32Array {
  const r = new Prng(seed);
  const p = new Float32Array(W * H);
  for (let i = 0; i < p.length; i++) p[i] = r.gauss() * sigma;
  return p;
}

/** A smooth texture, amplitude ~±60 around 128, tileable in x. */
function texture(seed: number): Float32Array {
  const r = new Prng(seed);
  const t = new Float32Array(W * H);
  const waves = Array.from({ length: 6 }, () => ({
    kx: 1 + r.int(4),
    ky: r.int(4),
    ph: r.next() * Math.PI * 2,
    amp: 12 + r.next() * 14,
  }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 128;
    for (const wv of waves) v += wv.amp * Math.sin((2 * Math.PI * (wv.kx * x)) / W + (2 * Math.PI * wv.ky * y) / H + wv.ph);
    t[y * W + x] = v;
  }
  return t;
}

export type ClipContent = 'moving' | 'static' | 'dark' | 'recapture';

export type ClipSpec = {
  seconds: number;
  fps?: number;
  seed: number;
  content: ClipContent;
  /** Sensor noise σ in grey levels. 0 makes a "too clean" clip. */
  noise?: number;
  pattern?: Float32Array | null;
  /** Pixels per frame of scroll during each second. Random 0.3–3 when unset. */
  motion?: number[];
};

export type RenderedClip = { frames: Uint8Array[]; fps: number; motionPerSecond: number[] };

export function renderClip(spec: ClipSpec): RenderedClip {
  const fps = spec.fps ?? 10;
  const r = new Prng(spec.seed ^ 0x5bd1e995);
  const tex = texture(spec.seed);
  const noise = spec.noise ?? 3;
  // Pixels per frame. Kept well under the texture period so the difference
  // between two 1 fps samples (ten frames of scroll) still grows with the
  // speed; at 3 px per frame the picture has moved half a period between
  // samples and the difference saturates, which is what a real optical-flow
  // measure would not do and a frame difference does.
  const motion = spec.motion ?? Array.from({ length: spec.seconds }, () => 0.05 + r.next() * 0.55);
  const frames: Uint8Array[] = [];
  let offset = 0;
  for (let s = 0; s < spec.seconds; s++) {
    for (let k = 0; k < fps; k++) {
      const moving = spec.content === 'moving' || spec.content === 'recapture';
      if (moving) offset += motion[s] ?? 1;
      const f = new Uint8Array(W * H);
      // A display's refresh beat: the whole picture a little brighter one
      // second and a little darker the next. Small, so the scroll still
      // dominates the frame difference and the IMU still agrees with it.
      const flicker = spec.content === 'recapture' ? (s % 2 === 0 ? 4 : -4) : 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = ((Math.round(x + offset) % W) + W) % W;
        let v = tex[y * W + sx]!;
        if (spec.content === 'dark') v = 4 + (v - 128) * 0.02;
        if (spec.content === 'recapture') {
          const inside = x >= 8 && y >= 8 && x < W - 8 && y < H - 8;
          v = inside ? v + ((x + y) & 1 ? 12 : -12) + flicker : 6;
        }
        v += noise > 0 ? r.gauss() * noise : 0;
        if (spec.pattern) v += spec.pattern[y * W + x]!;
        f[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
      }
      frames.push(f);
    }
  }
  return { frames, fps, motionPerSecond: motion };
}

export type EncodeOptions = {
  file: string;
  fps: number;
  /** Fragmented MP4 with moov at the front, the layout the device writes. */
  fragmented?: boolean;
  /** x264 CRF. Low keeps the sensor noise; the default 8 is nearly lossless. */
  crf?: number;
  ffmpeg?: string;
};

export async function encodeClip(frames: readonly Uint8Array[], o: EncodeOptions): Promise<void> {
  const args = [
    '-v', 'error', '-y', '-nostdin',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', String(o.fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf ?? 8), '-g', '30', '-threads', '1', '-pix_fmt', 'yuv420p',
  ];
  if (o.fragmented ?? true) args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof');
  args.push(o.file);
  const input = Buffer.concat(frames.map((f) => Buffer.from(f)));
  const { code, stderr } = await runTool(o.ffmpeg ?? 'ffmpeg', args, { input });
  if (code !== 0) throw new Error(`ffmpeg failed to encode ${o.file}: ${stderr.trim()}`);
}

export async function writeWav(file: string, seconds: number, o: { silent?: boolean; ffmpeg?: string } = {}): Promise<void> {
  const src = o.silent ? `anullsrc=r=16000:cl=mono` : `sine=frequency=440:sample_rate=16000`;
  const { code, stderr } = await runTool(o.ffmpeg ?? 'ffmpeg', [
    '-v', 'error', '-y', '-nostdin', '-f', 'lavfi', '-i', src, '-t', String(seconds), '-c:a', 'pcm_s16le', file,
  ]);
  if (code !== 0) throw new Error(`ffmpeg failed to write ${file}: ${stderr.trim()}`);
}

/** A PTS sidecar: header, then one microsecond timestamp per row. */
export function ptsCsv(firstUs: bigint, rows: number, intervalUs: bigint, o: { partialTail?: boolean } = {}): string {
  const lines = ['timestamp_us'];
  for (let i = 0; i < rows; i++) lines.push(String(firstUs + BigInt(i) * intervalUs));
  let text = lines.join('\n') + '\n';
  if (o.partialTail) text = text.slice(0, -4);
  return text;
}

export type ImuSpec = {
  seconds: number;
  rateHz?: number;
  firstUs: bigint;
  /** The picture's scroll per second; gyro magnitude follows it when correlated. */
  motionPerSecond: readonly number[];
  seed: number;
  /** Gyro drawn independently of the picture. */
  decorrelated?: boolean;
  /** Leading rows with a clock 56 years ahead, the 072516 defect. */
  clockFaultRows?: number;
};

export function imuCsv(spec: ImuSpec): string {
  const rate = spec.rateHz ?? 100;
  const r = new Prng(spec.seed ^ 0x1234567);
  const lines = ['timestamp_us\t,x\t,y\t,z\t,type'];
  const step = BigInt(Math.round(1_000_000 / rate));
  const indep = Array.from({ length: spec.seconds }, () => 0.3 + r.next() * 2.7);
  const fault = spec.clockFaultRows ?? 0;
  for (let i = 0; i < fault; i++) {
    const ts = spec.firstUs + 1_770_000_000_000_000n + BigInt(i) * step;
    lines.push(`${ts},0.1,-9.8,0.2,accel`);
  }
  for (let s = 0; s < spec.seconds; s++) {
    const drive = spec.decorrelated ? indep[s]! : spec.motionPerSecond[s] ?? 1;
    for (let k = 0; k < rate; k++) {
      const ts = spec.firstUs + BigInt(s * rate + k) * step;
      const ax = (0.1 + r.gauss() * 0.05).toFixed(6);
      const ay = (-9.8 + r.gauss() * 0.05).toFixed(6);
      const az = (0.2 + r.gauss() * 0.05).toFixed(6);
      lines.push(`${ts},${ax},${ay},${az},accel`);
      const mag = drive * 0.4 + Math.abs(r.gauss()) * 0.02;
      const gx = (mag * 0.6).toFixed(6);
      const gy = (mag * 0.8).toFixed(6);
      const gz = (r.gauss() * 0.01).toFixed(6);
      lines.push(`${ts},${gx},${gy},${gz},gyro`);
    }
  }
  return lines.join('\n') + '\n';
}

export type SessionSpec = {
  /** The directory that will CONTAIN the session folder. */
  parent: string;
  serial: string;
  /** YYYYMMDD and HHMMSS, as in the basename. */
  date: string;
  time: string;
  /**
   * Manifest start_time, naive ISO like the device writes. Derived from
   * `firstUs` when absent. corpus_check.py reads the IMU clock against it
   * with an hour's tolerance, so a session whose IMU sits hours away from
   * its manifest is a session full of clock outliers.
   */
  startTime?: string;
  /** Device PTS epoch of the first camera frame, microseconds. */
  firstUs: bigint;
  seconds: number;
  seed: number;
  content?: ClipContent;
  noise?: number;
  pattern?: Float32Array | null;
  motion?: number[];
  fragmented?: boolean;
  status?: 'completed' | 'recording';
  /** Manifest duration_sec. Defaults to 1.34× the media: the known overstatement. */
  declaredDurationSec?: number | null;
  /** How the camera sidecar relates to the media. */
  pts?: 'exact' | 'short' | 'long' | 'partial' | 'none';
  audio?: 'sine' | 'silent' | 'none';
  imu?: 'correlated' | 'decorrelated' | 'clock_fault' | 'none';
  firmware?: string;
  ffmpeg?: string;
};

export type WrittenSession = {
  dir: string;
  basename: string;
  video: string;
  videoPts: string | null;
  audio: string | null;
  imu: string | null;
  manifest: string;
  frames: number;
  motionPerSecond: number[];
  /** The camera's first PTS, which an ingest record would carry as `usable_start_us`. */
  firstUs: bigint;
};

export async function writeSession(spec: SessionSpec): Promise<WrittenSession> {
  const base = `ego_${spec.serial}_${spec.date}_${spec.time}`;
  const dir = join(spec.parent, base);
  await mkdir(dir, { recursive: true });
  const clip = renderClip({
    seconds: spec.seconds,
    seed: spec.seed,
    content: spec.content ?? 'moving',
    noise: spec.noise,
    pattern: spec.pattern ?? null,
    motion: spec.motion,
  });
  const video = join(dir, `${base}_camera_left_part0001.mp4`);
  await encodeClip(clip.frames, { file: video, fps: clip.fps, fragmented: spec.fragmented ?? true, ffmpeg: spec.ffmpeg });

  const frameUs = BigInt(Math.round(1_000_000 / clip.fps));
  let videoPts: string | null = null;
  const pts = spec.pts ?? 'exact';
  if (pts !== 'none') {
    const rows = clip.frames.length + (pts === 'short' ? -10 : pts === 'long' ? 10 : 0);
    videoPts = join(dir, `${base}_camera_left_part0001_pts.csv`);
    await writeFile(videoPts, ptsCsv(spec.firstUs, rows, frameUs, { partialTail: pts === 'partial' }), 'utf8');
  }

  let audio: string | null = null;
  if ((spec.audio ?? 'sine') !== 'none') {
    audio = join(dir, `${base}_audio_part0001.wav`);
    await writeWav(audio, spec.seconds, { silent: spec.audio === 'silent', ffmpeg: spec.ffmpeg });
    await writeFile(join(dir, `${base}_audio_part0001_pts.csv`), ptsCsv(spec.firstUs, spec.seconds * 10, 100_000n), 'utf8');
  }

  let imu: string | null = null;
  const imuMode = spec.imu ?? 'correlated';
  if (imuMode !== 'none') {
    imu = join(dir, `${base}_imu_part0001.csv`);
    await writeFile(
      imu,
      imuCsv({
        seconds: spec.seconds,
        firstUs: spec.firstUs,
        motionPerSecond: clip.motionPerSecond,
        seed: spec.seed,
        decorrelated: imuMode === 'decorrelated',
        clockFaultRows: imuMode === 'clock_fault' ? 916 : 0,
      }),
      'utf8',
    );
  }

  const declared = spec.declaredDurationSec === undefined ? Math.round(spec.seconds * 1.34 * 1000) / 1000 : spec.declaredDurationSec;
  const manifest = join(dir, `meta_${base}.json`);
  await writeFile(
    manifest,
    JSON.stringify(
      {
        device: { firmware_version: spec.firmware ?? '1.0.3', name: 'ego', sdk: 'OrbbecSDK', serial_number: spec.serial },
        files: { video_left: `${base}_camera_left_part0001.mp4` },
        recording: {
          duration_sec: declared ?? 0,
          end_time: '',
          // Four seconds before the first frame: the device's own warm-up gap.
          start_time: spec.startTime ?? new Date(Number(spec.firstUs / 1000n) - 4000).toISOString().slice(0, 23),
          status: spec.status ?? 'completed',
          video_segment_duration_sec: 3600,
        },
        statistics: {
          audio_frame_count: 0,
          imu_accel_count: imu ? spec.seconds * 100 : 0,
          imu_gyro_count: imu ? spec.seconds * 100 : 0,
          video_left_frame_count: clip.frames.length + 4,
          video_right_frame_count: 0,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  return { dir, basename: base, video, videoPts, audio, imu, manifest, frames: clip.frames.length, motionPerSecond: clip.motionPerSecond, firstUs: spec.firstUs };
}
