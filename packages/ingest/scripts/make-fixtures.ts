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
  /** Header-only sidecars beside zero-byte video: the device wrote nothing. */
  emptyStreams?: boolean;
  /** Video cut short mid-transfer, with the sidecars left intact. */
  truncatedContainer?: boolean;
  /** No camera files at all. */
  noMedia?: boolean;
  /** Cut the audio sidecar mid-number, as 072538's is at exactly 8192 bytes. */
  truncateSidecar?: boolean;
  /** Open with N IMU rows carrying the epoch twice, as 072516's first 916 do. */
  clockFaultRows?: number;
  /** Real IMU interval, when it should disagree with the declared 1 kHz. */
  imuStepUs?: bigint;
  /** Start audio this far before the cameras, to drive the skew past its threshold. */
  audioLeadUs?: bigint;
  /** A closed manifest that overstates duration and frame counts, as every real one does. */
  closed?: boolean;
  /** Statistics written as all zero. */
  zeroStats?: boolean;
  /** Plausible counts left over from an earlier recording, on a session that never closed. */
  staleStats?: boolean;
  /** Segment count the manifest declares, when more parts are claimed than exist. */
  declaredSegments?: number;
};

/** A sidecar the device opened and never wrote a row into. */
const HEADER_ONLY = 'timestamp_us' + String.fromCharCode(10);

const ptsCsv = (start: bigint, n: number, step: bigint) =>
  ['timestamp_us', ...Array.from({ length: n }, (_, i) => String(start + BigInt(i) * step))].join('\n') + '\n';

/** 2026-01-01 in microseconds. Adding it to an already absolute timestamp is the fault 072516 shows. */
const EPOCH_2026_US = 1_767_225_583_000_000n;

const imuCsv = (start: bigint, samples: number, faultRows = 0, step = IMU_US) => {
  const rows = ['timestamp_us\t,x\t,y\t,z\t,type'];
  for (let i = 0; i < samples; i++) {
    const t = start + BigInt(i) * step + (i < faultRows ? EPOCH_2026_US : 0n);
    rows.push(`${t},0.100000,-9.800000,0.200000,accel`);
    rows.push(`${t},0.001000,0.002000,0.003000,gyro`);
  }
  return rows.join('\n') + '\n';
};

/**
 * The smallest MP4 whose boxes tile the file exactly: an `ftyp` and an empty
 * `free`. Enough to satisfy the structural check without carrying any video.
 */
function minimalMp4(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write('ftypisom', 4, 'latin1');
  ftyp.writeUInt32BE(512, 12);
  ftyp.write('isomiso2', 16, 'latin1');
  const free = Buffer.alloc(8);
  free.writeUInt32BE(8, 0);
  free.write('free', 4, 'latin1');
  return Buffer.concat([ftyp, free]);
}

/** An `mdat` that promises far more than the file delivers: a transfer cut short. */
function truncatedMp4(): Buffer {
  const head = minimalMp4();
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(4_000_000, 0);
  mdat.write('mdat', 4, 'latin1');
  return Buffer.concat([head, mdat, Buffer.alloc(64, 0x11)]);
}

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

function manifestJson(
  o: Opts,
  stem: string,
  frames: number,
  imuSamples: number,
  first: bigint,
  last: bigint,
): string {
  const camera = {
    enabled: true,
    file: `${stem}_camera_left.mp4`, // deliberately unresolvable, as on the real device
    fps: 30,
    segment_duration_sec: 3600,
    segments: Array.from({ length: o.declaredSegments ?? o.parts.length }, (_, i) => ({
      index: i + 1,
      frame_count: FRAMES,
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
      recording: o.closed
        ? {
            // Wall clock, which is what the device writes: start-up and shut-down included.
            duration_sec: Number((last - first) / 1000n) / 1000 * 1.51,
            end_time: '2026-08-13T09:00:12.000',
            start_time: '2026-08-13T09:00:00.000',
            status: 'completed',
            video_segment_duration_sec: 3600,
          }
        : {
            duration_sec: 0,
            end_time: '',
            start_time: '2026-08-13T09:00:00.000',
            status: 'recording',
            video_segment_duration_sec: 3600,
          },
      statistics: o.zeroStats
        ? {
            audio_frame_count: 0,
            imu_accel_count: 0,
            imu_gyro_count: 0,
            video_left_frame_count: 0,
            video_right_frame_count: 0,
          }
        : {
            audio_frame_count: 0,
            // A closed session declares more than it holds, as all five real ones do.
            // A stale block belongs to a different recording entirely.
            imu_accel_count: o.staleStats ? 12_640 : o.closed ? imuSamples + 900 : imuSamples,
            imu_gyro_count: o.staleStats ? 12_640 : o.closed ? imuSamples + 900 : imuSamples,
            video_left_frame_count: o.staleStats ? 316 : o.closed ? frames + 4 : frames,
            video_right_frame_count: o.staleStats ? 318 : o.closed ? frames + 7 : frames,
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

  if (!o.noMedia) {
    for (const p of o.parts) {
      const tag = `part${String(p.part).padStart(4, '0')}`;
      for (const role of ['camera_left', 'camera_right']) {
        if (o.corruptMedia) {
          await writeFile(join(dir, `${stem}_${role}_${tag}.mp4`), Buffer.from('not an mp4 at all'));
          continue;
        }
        await writeFile(
          join(dir, `${stem}_${role}_${tag}.mp4`),
          o.truncatedContainer ? truncatedMp4() : minimalMp4(),
        );
        await writeFile(
          join(dir, `${stem}_${role}_${tag}_pts.csv`),
          o.emptyStreams ? HEADER_ONLY : ptsCsv(p.start, p.frames, FPS_US),
        );
      }
    }
  }

  await writeFile(
    join(dir, `${stem}_imu_part0001.csv`),
    imuCsv(first, imuSamples, o.clockFaultRows ?? 0, o.imuStepUs ?? IMU_US),
  );
  await writeFile(join(dir, `${stem}_audio.wav`), '');
  const audioStart = first - (o.audioLeadUs ?? 0n);
  const audio = ptsCsv(audioStart, Math.max(2, Number((last - audioStart) / AUDIO_US) + 1), AUDIO_US);
  await writeFile(
    join(dir, `${stem}_audio_pts.csv`),
    o.truncateSidecar ? audio.slice(0, audio.length - 9) : audio,
  );

  if (o.calibration !== false) {
    await writeFile(join(dir, `${stem}_calibration_camera.yaml`), CALIB_CAMERA);
    await writeFile(join(dir, `${stem}_calibration_imu.yaml`), CALIB_IMU);
  }
  if (o.manifest !== false) {
    await writeFile(
      join(dir, `meta_${stem}.json`),
      manifestJson(o, stem, frames, imuSamples, first, last),
    );
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

  // Sidecars opened and never written into, beside zero-byte video.
  { label: 'empty-streams', time: '090900', parts: contiguous(1), emptyStreams: true },

  // Calibration and a manifest, but the camera never wrote a file.
  { label: 'no-media', time: '091000', parts: contiguous(1), noMedia: true },

  // The audio sidecar stops mid-number, as 072538's does at exactly 8192 bytes.
  { label: 'truncated-sidecar', time: '091100', parts: contiguous(1), truncateSidecar: true },

  // The IMU opens with rows carrying the epoch twice, as 072516's first 916 do.
  // Without the clock check this session reports a duration of zero.
  { label: 'clock-fault', time: '091200', parts: contiguous(1), clockFaultRows: 300 },

  // A closed session, which is where the manifest overstates everything.
  { label: 'inflated-manifest', time: '091300', parts: contiguous(1), closed: true },

  // Closed, with a statistics block that was never written.
  { label: 'zeroed-stats', time: '091400', parts: contiguous(1), closed: true, zeroStats: true },

  // Three segments declared, one part on disk: the recording stopped early.
  { label: 'missing-tail-part', time: '091500', parts: contiguous(1), declaredSegments: 3 },

  // Audio running two seconds ahead of the cameras.
  { label: 'high-skew', time: '091600', parts: contiguous(1), audioLeadUs: 2_000_000n },

  // An IMU sampling at 500 Hz while the manifest declares 1 kHz.
  { label: 'imu-rate-anomaly', time: '091700', parts: contiguous(1), imuStepUs: 2_000n },

  // Finished recording, damaged afterwards. The sidecars are intact so timing
  // looks healthy, and only the container's own box lengths give it away.
  {
    label: 'truncated-container',
    time: '091900',
    parts: contiguous(1),
    truncatedContainer: true,
    closed: true,
  },

  // The same broken container on a recording that never closed. The device died
  // mid-write, so this is footage to review, not footage to hold.
  {
    label: 'interrupted-recording',
    time: '092000',
    parts: contiguous(1),
    truncatedContainer: true,
  },

  // Never closed, carrying another recording's counts. They look credible and
  // are wrong, which is exactly what 072538 does with 072516's numbers.
  { label: 'stale-stats', time: '091800', parts: contiguous(1), staleStats: true },
];

console.log('writing fixtures:');
for (const f of fixtures) console.log(`  ${await build(f)}`);
console.log('done');
