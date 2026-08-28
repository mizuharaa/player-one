export * from './identity.ts';
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
  /**
   * Raised at store time, like CHECKSUM-MISMATCH: the record's own
   * `raw_duration_s` is longer than the window its own timestamps describe.
   * See `windowDiscrepancies` at the foot of this file.
   */
  'DUR-EXCEEDS-WINDOW',
  // Identity, from milestone 0.3. Both are cross-checks on the session
  // directory name, which is what the episode id is derived from.
  'EPISODE-ID-FALLBACK', // the basename does not parse; the id falls back to the raw name
  'SERIAL-CONFLICT', // basename, manifest and calibration disagree on the device serial
  /**
   * Raised at store time, not by the engine, exactly like CHECKSUM-MISMATCH: the
   * manifest's own session id disagrees with the handover the card arrived on.
   * Advisory — the manifest is a hint about the device, and UPL-08 applies to
   * its session id as much as to its duration.
   */
  'SESSION-CONFLICT',
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

/**
 * One source file of the delivery. `relative_path` rather than `file` so the
 * array is the exact input type `contentFingerprint` takes: a consumer can call
 * `contentFingerprint(record.source_files)` and compare, with no reshaping and
 * no chance of reshaping it wrong.
 */
const SourceFileRef = z.object({
  relative_path: z.string(),
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
  // 1.1.0 adds source_files. Additive, but the version moves because the
  // fingerprint became verifiable from the document, which is a contract
  // consumers may now rely on.
  schema_version: z.literal('1.1.0'),
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

  /**
   * Every file `content_fingerprint` is computed over, sorted by path in byte
   * order — the same set, the same order, so the digest recomputes from the
   * record alone:
   *
   *     contentFingerprint(record.source_files) === record.content_fingerprint
   *
   * Without this the record named digests for media and calibration only, and a
   * session's PTS sidecars, its manifest-excluded remainder and any
   * unclassified file had no digest anywhere in the document. The fingerprint
   * was then verifiable only by a consumer who also held the store's
   * `episode_files` rows — which is not a property of the record, and the
   * record is what every downstream component reads.
   *
   * The manifest is absent by the same argument that keeps it out of the
   * digest (ING-02, docs/episode-identity.md): a device rewriting its own
   * metadata is not a corrupted delivery. `unclassified_files` stays as a
   * names-only index into this array.
   */
  source_files: z.array(SourceFileRef),

  discrepancies: z.array(Discrepancy),
  unclassified_files: z.array(z.string()),
});

export type EpisodeRecord = z.infer<typeof EpisodeRecord>;
export type Discrepancy = z.infer<typeof Discrepancy>;
export type Stream = z.infer<typeof Stream>;
export type Declared = z.infer<typeof Declared>;

/**
 * The state a set of discrepancies implies. Lives here rather than in the
 * engine because the store applies the same rule when a store-time discovery
 * (CHECKSUM-MISMATCH) is attached to an already-measured record.
 */
export function stateFrom(discrepancies: readonly Discrepancy[]): EpisodeRecord['state'] {
  if (discrepancies.some((x) => x.severity === 'quarantine')) return 'quarantined';
  if (discrepancies.some((x) => x.severity === 'flag')) return 'flagged';
  return 'ok';
}

/**
 * One millisecond. `raw_duration_s` and the `*_pts_us` strings are both derived
 * from the same integer microseconds, so the only difference a correct record
 * can show is the float64 division in `Number(us) / 1e6`, which is far below
 * this. A millisecond is also the unit `max_stream_skew_ms` is already reported
 * in, so the record states timing slack in one unit and not two.
 */
export const DURATION_TOLERANCE_S = 0.001;

/**
 * The record checked against itself: is the duration it claims longer than the
 * window its own timestamps describe?
 *
 * `raw_duration_s` is the number a collector is paid on, and until now nothing
 * on the server ever compared it with anything. The record carries the material
 * to check it. `usable_start_us` and `usable_end_us` are the intersection of
 * stream coverage — the widest instant every stream covered — and the engine's
 * own duration is the *measure* of that intersection with its holes removed,
 * so `raw_duration_s` can never exceed `usable_end_us - usable_start_us`. It is
 * an upper bound, never a floor, so nothing here can raise a payment: a
 * duration shorter than the window is a session with gaps in it and is correct.
 *
 * The window is used and not the sum of the stream spans, because the widest
 * stream is the union and the union is not what anybody is paid for
 * (docs/review.md, §5.3.3, UPL-14).
 *
 * A record with no window — `wall_clock` timing, where no stream carried both
 * a first and a last PTS — has nothing to be checked against and is left alone.
 * Its duration comes from the manifest, which is advisory by decision, and the
 * ceiling on the payment path is what bounds it.
 *
 * The result is `quarantine` and not a refusal. ING-17: a bad measurement must
 * never be the reason a delivery fails to store. The delivery stores, keeps its
 * media and is still visible; what it does not do is enter review, because
 * which of the two numbers is the real one is a question for a person.
 *
 * The way out is the way out of every ingest quarantine: the card is never
 * cleared (ING-34), so the session is measured again and the redelivery becomes
 * the latest ingest, which is the row review eligibility reads. There is no
 * route that edits this one, and there should not be.
 */
export function windowDiscrepancies(record: EpisodeRecord): Discrepancy[] {
  const { usable_start_us, usable_end_us, raw_duration_s } = record.timing;
  if (usable_start_us === null || usable_end_us === null) return [];
  const start = BigInt(usable_start_us);
  const end = BigInt(usable_end_us);
  const windowS = end > start ? Number(end - start) / 1e6 : 0;
  if (raw_duration_s <= windowS + DURATION_TOLERANCE_S) return [];
  return [
    {
      code: 'DUR-EXCEEDS-WINDOW',
      severity: 'quarantine',
      detail:
        `claims ${raw_duration_s.toFixed(6)} s of media inside a window of ` +
        `${windowS.toFixed(6)} s (${usable_start_us} to ${usable_end_us})`,
    },
  ];
}
