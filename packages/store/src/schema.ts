import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * The episode store. Five tables: `episodes` is identity, `episode_ingests` is
 * append-only history — one row per ingest run. Files, streams and defects hang
 * off an *ingest*, never off an episode, because two deliveries of the same
 * session can legitimately differ and both have to survive.
 *
 * Two rules run through all of it.
 *
 * Every duration and every timestamp is `numeric`, never `double precision`.
 * The engine reads timestamps as BigInt and carries them as decimal strings so
 * that nothing rounds a number a collector is paid on; throwing that away at
 * the last hop into Postgres would put the bug back. Every numeric column is
 * declared `mode: 'string'` for the same reason — a numeric read into a JS
 * `number` is the same silent precision loss wearing a different hat.
 *
 * Closed sets (state, severity, timing source, timing confidence) are text with
 * a CHECK. Open ones (defect code, stream name) are text with no CHECK and are
 * validated against the TypeScript unions at the application layer: the defect
 * catalogue grows every milestone, and P2-02 adds glove and tactile streams in
 * phase 2. Enum migrations for a list that is expected to grow are a tax.
 */

export const episodes = pgTable('episodes', {
  episodeId: uuid('episode_id').primaryKey(),
  deviceSerial: text('device_serial').notNull(),
  /** `YYYYMMDD_HHMMSS`, exactly as parsed from the directory basename. */
  sessionStartedAt: text('session_started_at').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  latestIngestId: uuid('latest_ingest_id').references((): AnyPgColumn => episodeIngests.ingestId),
  ingestCount: integer('ingest_count').notNull().default(0),
});

export const episodeIngests = pgTable(
  'episode_ingests',
  {
    /** Random per run. Unlike `episode_id`, this row *is* run-specific. */
    ingestId: uuid('ingest_id').primaryKey(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.episodeId),
    contentFingerprint: text('content_fingerprint').notNull(),
    state: text('state').notNull(),
    sourceBasename: text('source_basename').notNull(),
    /**
     * Spec'd as numeric(12,6). Widened to (20,6) — a strict superset, so no
     * precision is given up, only the ceiling moves. `declared_duration_s` is
     * copied from a manifest off a collector's card and is not trusted to be
     * sane, and `measured_duration_s` must never be the reason a session fails
     * to store (ING-17: nothing is discarded).
     */
    declaredDurationS: numeric('declared_duration_s', { precision: 20, scale: 6, mode: 'string' }),
    measuredDurationS: numeric('measured_duration_s', {
      precision: 20,
      scale: 6,
      mode: 'string',
    }).notNull(),
    timingSource: text('timing_source').notNull(),
    timingConfidence: text('timing_confidence').notNull(),
    streamSkewMs: numeric('stream_skew_ms', { precision: 20, scale: 3, mode: 'string' }),
    deviceFirmware: text('device_firmware'),
    calibrationSerial: text('calibration_serial'),
    manifestPresent: boolean('manifest_present').notNull(),
    engineVersion: text('engine_version').notNull(),
    host: text('host').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull(),
    /** The full EpisodeRecord, verbatim. The typed columns above are for
     * querying; this is the source of truth and is never reshaped. */
    recordJson: jsonb('record_json').notNull(),
  },
  (t) => [
    index('episode_ingests_episode_idx').on(t.episodeId, t.ingestedAt.desc()),
    index('episode_ingests_fingerprint_idx').on(t.contentFingerprint),
    check('episode_ingests_state_check', sql`${t.state} in ('ok', 'flagged', 'quarantined')`),
    check(
      'episode_ingests_timing_source_check',
      sql`${t.timingSource} in ('pts_sidecar', 'container', 'imu_span', 'wall_clock')`,
    ),
    check(
      'episode_ingests_timing_confidence_check',
      sql`${t.timingConfidence} in ('exact', 'derived', 'estimated')`,
    ),
  ],
);

/**
 * Every source file of one delivery, and exactly the set the fingerprint is
 * computed over — the manifest is not here, by the same argument that keeps it
 * out of the fingerprint (see docs/episode-identity.md). That makes the
 * fingerprint recomputable from these rows alone, which is what lets a reviewer
 * check a payment dispute against the store rather than against the card.
 */
export const episodeFiles = pgTable(
  'episode_files',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ingestId: uuid('ingest_id')
      .notNull()
      .references(() => episodeIngests.ingestId),
    relativePath: text('relative_path').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
  },
  (t) => [
    index('episode_files_ingest_idx').on(t.ingestId),
    uniqueIndex('episode_files_ingest_path_key').on(t.ingestId, t.relativePath),
  ],
);

export const episodeStreams = pgTable(
  'episode_streams',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ingestId: uuid('ingest_id')
      .notNull()
      .references(() => episodeIngests.ingestId),
    /** No CHECK: P2-02 adds glove encoder and tactile roles with no migration. */
    streamName: text('stream_name').notNull(),
    sampleCount: bigint('sample_count', { mode: 'number' }).notNull(),
    /**
     * (20,6), not (12,6). A stream with a broken clock is a real, committed
     * fixture: `clock-fault` spans 1_767_225_582.999 s on 30 samples. At (12,6)
     * Postgres rejects the row and the session cannot be stored at all, which
     * would break ING-17 for exactly the sessions that most need recording.
     */
    durationS: numeric('duration_s', { precision: 20, scale: 6, mode: 'string' }).notNull(),
    timingSource: text('timing_source').notNull(),
    /** numeric(20,0), string mode: these round-trip BigInt microseconds exactly. */
    firstTimestampUs: numeric('first_timestamp_us', { precision: 20, scale: 0, mode: 'string' }),
    lastTimestampUs: numeric('last_timestamp_us', { precision: 20, scale: 0, mode: 'string' }),
    /** Excluded from the usable window, e.g. STREAM-CLOCK-FAULT. Kept, never dropped. */
    excluded: boolean('excluded').notNull().default(false),
    exclusionReason: text('exclusion_reason'),
  },
  (t) => [index('episode_streams_ingest_idx').on(t.ingestId)],
);

export const episodeDefects = pgTable(
  'episode_defects',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ingestId: uuid('ingest_id')
      .notNull()
      .references(() => episodeIngests.ingestId),
    /** No CHECK: the catalogue grows every milestone. Validated in TypeScript. */
    code: text('code').notNull(),
    severity: text('severity').notNull(),
    payload: jsonb('payload'),
  },
  (t) => [
    index('episode_defects_ingest_idx').on(t.ingestId),
    check('episode_defects_severity_check', sql`${t.severity} in ('info', 'flag', 'quarantine')`),
  ],
);
