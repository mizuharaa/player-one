import { readFile } from 'node:fs/promises';
import type { Declared } from '@playerone/contracts';

/**
 * ING-02, ING-03. The manifest is context only. Nothing here decides duration,
 * frame counts or whether a stream exists — those come from the files.
 * A missing or unparseable manifest must not fail ingest.
 */

export type ManifestInfo = {
  present: boolean;
  parsed: boolean;
  deviceSerial: string | null;
  firmwareVersion: string | null;
  declared: Declared;
  /** Camera keys as the manifest names them: `color_left`, `color_right`. Compared with calibration, never resolved (ING-25). */
  cameraNames: string[];
  /** Declared IMU sample rate, compared against the measured one (ING-28). */
  imuRateHz: number | null;
  /** Declared segment count per camera key. Used to spot a missing tail part, never for duration. */
  segmentCounts: Record<string, number>;
  /** ING-01 evidence. Names the manifest lists that are not on disk. */
  unresolvedFiles: string[];
};

const EMPTY: Declared = {
  session_id: null,
  status: null,
  duration_sec: null,
  start_time: null,
  end_time: null,
  video_left_frame_count: null,
  video_right_frame_count: null,
  imu_accel_count: null,
  imu_gyro_count: null,
  audio_frame_count: null,
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export async function readManifest(
  path: string | null,
  filesOnDisk: ReadonlySet<string>,
): Promise<ManifestInfo> {
  const absent: ManifestInfo = {
    present: false,
    parsed: false,
    deviceSerial: null,
    firmwareVersion: null,
    declared: EMPTY,
    cameraNames: [],
    imuRateHz: null,
    segmentCounts: {},
    unresolvedFiles: [],
  };
  if (path === null) return absent;

  let root: Record<string, any>;
  try {
    root = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { ...absent, present: true };
  }

  const device = root['device'] ?? {};
  const rec = root['recording'] ?? {};
  const stats = root['statistics'] ?? {};
  const streams = root['streams'] ?? {};
  const files: unknown = root['files'];

  return {
    present: true,
    parsed: true,
    deviceSerial: str(device['serial_number']),
    firmwareVersion: str(device['firmware_version']),
    declared: {
      // No manifest in the sample set carries a session id; identity comes from the directory.
      session_id: str(root['session_id']),
      status: str(rec['status']),
      duration_sec: num(rec['duration_sec']),
      start_time: str(rec['start_time']),
      end_time: str(rec['end_time']),
      video_left_frame_count: num(stats['video_left_frame_count']),
      video_right_frame_count: num(stats['video_right_frame_count']),
      imu_accel_count: num(stats['imu_accel_count']),
      imu_gyro_count: num(stats['imu_gyro_count']),
      audio_frame_count: num(stats['audio_frame_count']),
    },
    cameraNames: Object.keys(streams).filter((k) => k !== 'audio' && k !== 'imu'),
    imuRateHz: num(streams['imu']?.['accel_sample_rate_hz']),
    segmentCounts: Object.fromEntries(
      Object.entries(streams)
        .filter(([k]) => k !== 'audio' && k !== 'imu')
        .map(([k, v]) => [k, Array.isArray((v as any)?.segments) ? (v as any).segments.length : 0]),
    ),
    unresolvedFiles:
      files && typeof files === 'object'
        ? Object.values(files as Record<string, unknown>)
            .filter((v): v is string => typeof v === 'string' && !filesOnDisk.has(v))
            .sort()
        : [],
  };
}

/** All statistics zero, with media present, means the block was never written (STATS-ZEROED). */
export const statsAreZeroed = (d: Declared): boolean =>
  [d.video_left_frame_count, d.video_right_frame_count, d.imu_accel_count, d.imu_gyro_count].every(
    (n) => n === 0,
  );
