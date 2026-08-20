import { z } from 'zod';

/**
 * EpisodeRecord — the one document every downstream component reads.
 * Spec: docs/playerone-ingest-engine-spec.md §5.
 *
 * Microsecond timestamps are decimal strings, not numbers: they are read as
 * BigInt in the engine and JSON has no integer type wide enough to be trusted
 * with a value that decides what a collector is paid.
 */

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Micros = z.string().regex(/^\d+$/);

export const DISCREPANCY_CODES = [
  'DUR-MANIFEST-INFLATED',
  'FRAMECOUNT-MISMATCH',
  'AUDIO-STATS-ZERO',
  'MANIFEST-FILES-UNRESOLVED',
  'SESSION-UNCLOSED',
  'STATS-ZEROED',
  'PTS-EMPTY',
  'PTS-ABSENT',
  // Observed while building the timing engine, not in the original taxonomy.
  'PTS-TRUNCATED', // sidecar cut mid-digit; the final partial line is dropped
  'STATS-STALE', // statistics block copied verbatim from a previous session
  'STREAM-CLOCK-FAULT', // stream span cannot be explained by its own sample count
  'PART-MISSING-TAIL', // the spec requires this behaviour but names no code for it
  'TIMING-ESTIMATED',
  'STREAM-SKEW-HIGH',
  'PART-GAP',
  'PART-ORDER-CONFLICT',
  'FIRMWARE-UNKNOWN',
  'CAMERA-NAMING-CONFLICT',
  'IMU-RATE-ANOMALY',
  'CALIB-MISSING',
  'MEDIA-MISSING',
  'MEDIA-UNREADABLE',
  'MEDIA-TRUNCATED', // the container is structurally short: the transfer did not finish
  'ROWS-MALFORMED', // a timestamp file held rows that were not timestamps
  'CALIB-UNREADABLE', // the calibration is on disk but will not parse
  'MANIFEST-UNREADABLE', // the manifest is on disk but will not parse
  'PART-MISSING-INTERIOR',
  'CHECKSUM-MISMATCH',
] as const;

export const Discrepancy = z.object({
  code: z.enum(DISCREPANCY_CODES),
  severity: z.enum(['info', 'flag', 'quarantine']),
  detail: z.string(),
});

const FileRef = z.object({
  file: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: Sha256,
});

/** Open list, per P2-02: phase 2 adds glove encoder and tactile roles with no migration. */
export const Stream = z.object({
  role: z.string(),
  parts: z.array(FileRef),
  // 'hdf5': the Super EID Factory format carries a timestamp dataset per stream
  // rather than a sidecar. One enum value now beats a schema migration in phase 2.
  pts_source: z.enum(['sidecar', 'container', 'hdf5', 'absent']),
  first_pts_us: Micros.nullable(),
  last_pts_us: Micros.nullable(),
  sample_count: z.number().int().nonnegative(),
  span_s: z.number().nonnegative(),
  nominal_rate_hz: z.number().positive().nullable(),
});

/** Straight from the manifest, kept beside the measured values so a payment dispute is answerable from the record alone. */
export const Declared = z.object({
  session_id: z.string().nullable(),
  status: z.string().nullable(),
  duration_sec: z.number().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  video_left_frame_count: z.number().nullable(),
  video_right_frame_count: z.number().nullable(),
  imu_accel_count: z.number().nullable(),
  imu_gyro_count: z.number().nullable(),
  audio_frame_count: z.number().nullable(),
});

export const EpisodeRecord = z.object({
  schema_version: z.literal('1.0.0'),
  episode_id: z.string().regex(/^[0-9a-f-]{36}$/),
  content_fingerprint: Sha256,
  state: z.enum(['ok', 'flagged', 'quarantined']),

  source: z.object({
    path: z.string(),
    ingest_tool_version: z.string(),
    ingested_at: z.string(),
    ingest_host: z.string(),
  }),

  device: z.object({
    serial: z.string(),
    firmware_declared: z.string().nullable(),
    calibration_serial: z.string().nullable(),
  }),

  declared: Declared.nullable(),
  streams: z.array(Stream),

  timing: z.object({
    method: z.enum(['pts_sidecar', 'container', 'imu_span', 'wall_clock']),
    confidence: z.enum(['exact', 'derived', 'estimated']),
    usable_start_us: Micros.nullable(),
    usable_end_us: Micros.nullable(),
    raw_duration_s: z.number().nonnegative(),
    max_stream_skew_ms: z.number().nonnegative(),
  }),

  calibration: z.object({
    present: z.boolean(),
    files: z.array(FileRef),
  }),

  discrepancies: z.array(Discrepancy),
  unclassified_files: z.array(z.string()),
});

export type EpisodeRecord = z.infer<typeof EpisodeRecord>;
export type Discrepancy = z.infer<typeof Discrepancy>;
export type Stream = z.infer<typeof Stream>;
export type Declared = z.infer<typeof Declared>;
