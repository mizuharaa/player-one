/**
 * Generates the synthetic sessions the real sample data cannot provide: the
 * five real sessions are all single-part, all have calibration, and none is
 * truncated.
 *
 *   node packages/ingest/scripts/make-fixtures.ts [outDir]
 *
 * Everything written here is text or empty, so the whole set commits to the
 * repo and the suite runs in CI forever with no large-file storage. Sessions
 * are deliberately short. Benchmarks that genuinely need video live in the
 * media suite behind PLAYERONE_MEDIA.
 *
 * Layout: fixtures/sessions/<label>/ego_SYNTH0000001_20260813_<hhmmss>/
 * The label is the parent, so every session directory name is well formed and
 * a duplicate delivery is the same directory under two different parents.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const out = process.argv[2] ?? 'fixtures/sessions';

const SERIAL = 'SYNTH0000001';
const FPS_US = 33_334n;
const IMU_US = 1_000n;
const AUDIO_US = 42_667n;
const FRAMES = 20; // 0.667 s per part, so the IMU log stays small enough to commit
/** 2026-08-13T09:00:00Z, well clear of the real sessions. */
const T0 = 1_786_611_600_000_000n;

type Part = { part: number; start: bigint; frames: number };

type Opts = {
  label: string;
  time: string;
  parts: Part[];
  manifest?: boolean;
  calibration?: boolean;
  firmware?: string;
  /** Unreadable bytes and no sidecar, so ffprobe must fail without crashing. */
  corruptMedia?: boolean;
};

const ptsCsv = (start: bigint, n: number, step: bigint) =>
  ['timestamp_us', ...Array.from({ length: n }, (_, i) => String(start + BigInt(i) * step))].join('\n') + '\n';

const imuCsv = (start: bigint, samples: number) => {
  const rows = ['timestamp_us\t,x\t,y\t,z\t,type'];
  for (let i = 0; i < samples; i++) {
    const t = start + BigInt(i) * IMU_US;
    rows.push(`${t},0.100000,-9.800000,0.200000,accel`);
    rows.push(`${t},0.001000,0.002000,0.003000,gyro`);
  }
  return rows.join('\n') + '\n';
};

const CALIB_CAMERA = `calibration_info:
  format_version: 1.0
  calibration_date: 2026-8-13
  serial_number: SYNTHCAL001
  num_cameras: 2
  reference_camera: cam_0
cameras:
  - id: cam_0
    name: IR_L
    image_width: 1600
    image_height: 1300
  - id: cam_1
    name: IR_R
    image_width: 1600
    image_height: 1300
`;

const CALIB_IMU = `cam0:
  camera_model: pinhole
  resolution: [1600, 1300]
imu0:
  imu_model: misalignment
  update_rate: 1000
gravity: [0., 0., 9.81]
`;

function manifestJson(o: Opts, stem: string, frames: number, imuSamples: number): string {
  const camera = {
    enabled: true,
    file: `${stem}_camera_left.mp4`, // deliberately unresolvable, as on the real device
    fps: 30,
    segment_duration_sec: 3600,
    segments: o.parts.map((p) => ({
      index: p.part,
      frame_count: p.frames,
      start_timestamp_us: '0',
      end_timestamp_us: '0',
    })),
  };
  return JSON.stringify(
    {
      device: {
        firmware_version: o.firmware ?? '1.0.3',
        name: 'ego',
        sdk: 'OrbbecSDK',
        serial_number: SERIAL,
      },
      files: { video_left: `${stem}_camera_left.mp4` },
      recording: {
        duration_sec: 0,
        end_time: '',
        start_time: '2026-08-13T09:00:00.000',
        status: 'recording',
        video_segment_duration_sec: 3600,
      },
      statistics: {
        audio_frame_count: 0,
        imu_accel_count: imuSamples,
        imu_gyro_count: imuSamples,
        video_left_frame_count: frames,
        video_right_frame_count: frames,
      },
      streams: {
        audio: { enabled: true },
        color_left: camera,
        color_right: camera,
        imu: { accel_sample_rate_hz: 1000 },
      },
      timebase: { clock_source: 'device_timestamp', precision: 'microsecond', unit: 'seconds' },
    },
    null,
    2,
  );
}

async function build(o: Opts): Promise<string> {
  const stem = `ego_${SERIAL}_20260813_${o.time}`;
  const dir = join(out, o.label, stem);
  await mkdir(dir, { recursive: true });

  const frames = o.parts.reduce((n, p) => n + p.frames, 0);
  const first = o.parts.reduce((m, p) => (p.start < m ? p.start : m), o.parts[0]!.start);
  const last = o.parts.reduce((m, p) => {
    const end = p.start + BigInt(p.frames - 1) * FPS_US;
    return end > m ? end : m;
  }, 0n);
  const imuSamples = Number((last - first) / IMU_US) + 1;

  for (const p of o.parts) {
    const tag = `part${String(p.part).padStart(4, '0')}`;
    for (const role of ['camera_left', 'camera_right']) {
      if (o.corruptMedia) {
        await writeFile(join(dir, `${stem}_${role}_${tag}.mp4`), Buffer.from('not an mp4 at all'));
        continue;
      }
      await writeFile(join(dir, `${stem}_${role}_${tag}.mp4`), '');
      await writeFile(join(dir, `${stem}_${role}_${tag}_pts.csv`), ptsCsv(p.start, p.frames, FPS_US));
    }
  }

  await writeFile(join(dir, `${stem}_imu_part0001.csv`), imuCsv(first, imuSamples));
  await writeFile(join(dir, `${stem}_audio.wav`), '');
  await writeFile(
    join(dir, `${stem}_audio_pts.csv`),
    ptsCsv(first, Math.max(2, Number((last - first) / AUDIO_US) + 1), AUDIO_US),
  );

  if (o.calibration !== false) {
    await writeFile(join(dir, `${stem}_calibration_camera.yaml`), CALIB_CAMERA);
    await writeFile(join(dir, `${stem}_calibration_imu.yaml`), CALIB_IMU);
  }
  if (o.manifest !== false) {
    await writeFile(join(dir, `meta_${stem}.json`), manifestJson(o, stem, frames, imuSamples));
  }
  return dir;
}

/** Parts that abut exactly: each starts one frame interval after the previous ends. */
const contiguous = (count: number): Part[] =>
  Array.from({ length: count }, (_, i) => ({
    part: i + 1,
    start: T0 + BigInt(i * FRAMES) * FPS_US,
    frames: FRAMES,
  }));

await rm(out, { recursive: true, force: true });

const fixtures: Opts[] = [
  { label: 'multipart', time: '090000', parts: contiguous(3) },

  // Part numbers run backwards against the timestamps. PTS decides the order.
  {
    label: 'reversed-parts',
    time: '090100',
    parts: [
      { part: 1, start: T0 + BigInt(2 * FRAMES) * FPS_US, frames: FRAMES },
      { part: 2, start: T0 + BigInt(FRAMES) * FPS_US, frames: FRAMES },
      { part: 3, start: T0, frames: FRAMES },
    ],
  },

  // part0002 removed from a three-part sequence.
  { label: 'interior-part-missing', time: '090200', parts: [contiguous(3)[0]!, contiguous(3)[2]!] },

  // Two parts that do not abut: a one-second hole with no footage in it.
  {
    label: 'part-gap',
    time: '090300',
    parts: [
      { part: 1, start: T0, frames: FRAMES },
      { part: 2, start: T0 + BigInt(FRAMES) * FPS_US + 1_000_000n, frames: FRAMES },
    ],
  },

  { label: 'no-calibration', time: '090400', parts: contiguous(1), calibration: false },
  { label: 'no-manifest', time: '090500', parts: contiguous(1), manifest: false },
  { label: 'unknown-firmware', time: '090600', parts: contiguous(1), firmware: '9.9.9-unreleased' },
  { label: 'corrupt-container', time: '090700', parts: contiguous(1), corruptMedia: true },

  // The same session delivered twice, by two different paths.
  { label: 'delivery-a', time: '090800', parts: contiguous(1) },
  { label: 'delivery-b', time: '090800', parts: contiguous(1) },
];

console.log('writing fixtures:');
for (const f of fixtures) console.log(`  ${await build(f)}`);
console.log('done');
