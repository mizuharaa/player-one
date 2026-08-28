import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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

export const episodes = pgTable(
  'episodes',
  {
    episodeId: uuid('episode_id').primaryKey(),
    /**
     * The serial as observed in the basename. Evidence, not a key: the platform
     * identity of the device is `collection_session_devices.device_id`, reached
     * through the session. A device that is re-bound later must not retroactively
     * change the attribution of episodes already recorded (§4.3).
     */
    deviceSerial: text('device_serial').notNull(),
    /** `YYYYMMDD_HHMMSS`, exactly as parsed from the directory basename. */
    sessionStartedAt: text('session_started_at').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    latestIngestId: uuid('latest_ingest_id').references((): AnyPgColumn => episodeIngests.ingestId),
    ingestCount: integer('ingest_count').notNull().default(0),

    // -- the spine ----------------------------------------------------------
    collectionSessionId: uuid('collection_session_id').references(
      (): AnyPgColumn => collectionSessions.id,
    ),
    uploadBatchId: uuid('upload_batch_id').references((): AnyPgColumn => uploadBatches.id),
    resolutionState: text('resolution_state').notNull().default('quarantined'),
    uploadPath: text('upload_path'),
    verificationState: text('verification_state').notNull().default('pending'),
    /**
     * How this episode got its session, and whether a human has endorsed it.
     * Settlement rests on the answer, so "why is this episode on this session?"
     * has to be answerable from Postgres alone.
     */
    resolutionMethod: text('resolution_method'),
    resolutionConfirmedAt: timestamp('resolution_confirmed_at', { withTimezone: true }),
  },
  (t) => [
    index('episodes_session_idx').on(t.collectionSessionId),
    index('episodes_batch_idx').on(t.uploadBatchId),
    index('episodes_resolution_idx').on(t.resolutionState),
    /**
     * PLT-05. Two states and no third: an episode is resolved to exactly one
     * session, or it is quarantined for a human. There is no way to spell
     * "accepted but unattributed", which is the state §4.3 says must not exist
     * even briefly, even in an error path.
     */
    check(
      'episodes_resolution_check',
      sql`(${t.resolutionState} = 'resolved' and ${t.collectionSessionId} is not null)
          or (${t.resolutionState} = 'quarantined' and ${t.collectionSessionId} is null)`,
    ),
    check(
      'episodes_upload_path_check',
      sql`${t.uploadPath} is null or ${t.uploadPath} in ('A', 'B', 'C')`,
    ),
    /**
     * The cloud read-back verdict, and a fact about ONE delivery's bytes.
     * Migration 0009 carries the other half: a trigger resets this to
     * 'pending' whenever `latest_ingest_id` moves, because a changed
     * redelivery's bytes have never been uploaded and must not inherit the
     * previous ingest's verdict.
     */
    check(
      'episodes_verification_check',
      sql`${t.verificationState} in ('pending', 'verified', 'failed')`,
    ),
    /**
     * `app_declared` is Path A's (0019). The collector's app bound the session
     * before recording (APP-16) and then pulled that session's own files off
     * the device, so the attribution is a declaration made before the fact by
     * the person who made the recording — not a machine's proposal from a
     * card's contents and not an operator overruling one.
     */
    check(
      'episodes_resolution_method_check',
      sql`${t.resolutionMethod} is null
          or ${t.resolutionMethod} in ('automatic_single', 'automatic_time_window', 'manual', 'app_declared')`,
    ),
    /** A method implies an owner. Complements episodes_resolution_check, not a duplicate. */
    check(
      'episodes_method_requires_resolved_check',
      sql`${t.resolutionMethod} is null or ${t.resolutionState} = 'resolved'`,
    ),
    /** Only a machine proposal needs endorsing; a manual attachment is already human. */
    check(
      'episodes_confirm_only_automatic_check',
      sql`${t.resolutionConfirmedAt} is null
          or ${t.resolutionMethod} in ('automatic_single', 'automatic_time_window')`,
    ),
  ],
);

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
    /**
     * Not a constraint on this table — `ingest_id` is already unique on its own.
     * It exists to be the target of `episode_reviews`' composite foreign key,
     * which is what lets QR-03 be a CHECK. See episodeReviews.
     *
     * Deliberately NOT unique on content_fingerprint: two different empty
     * sessions share e3b0c442…b855, the sha256 of nothing, and 072415 is one of
     * them. A unique fingerprint would reject the second and lose a real
     * episode (ING-17).
     */
    unique('episode_ingests_review_target_key').on(t.episodeId, t.ingestId, t.measuredDurationS),
    /** The target of `episode_clearings_delivery_fk`: a clear must name a delivery of its own episode. */
    unique('episode_ingests_delivery_key').on(t.episodeId, t.ingestId),
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

/**
 * A person clearing ONE episode out of a CHECKSUM-MISMATCH quarantine by
 * naming which delivery is the authoritative one. Migration 0016 says why it
 * is shaped this way; the short version is Rule 6 — nothing modifies an
 * earlier delivery's record, so the answer to "which bytes are real" is a new
 * row here and a move of `episodes.latest_ingest_id`, and nothing else.
 *
 * Append-only: `episode_clearings_append_only` (0016) refuses UPDATE and
 * DELETE. A second clear is a second row.
 */
export const episodeClearings = pgTable(
  'episode_clearings',
  {
    id: uuid('id').primaryKey(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.episodeId),
    /** The delivery named as authoritative. Bound to this episode by the composite FK below. */
    ingestId: uuid('ingest_id').notNull(),
    /** What `latest_ingest_id` was when the clear was made: the state cleared from. */
    priorLatestIngestId: uuid('prior_latest_ingest_id')
      .notNull()
      .references(() => episodeIngests.ingestId),
    fromState: text('from_state').notNull(),
    clearedBy: uuid('cleared_by')
      .notNull()
      .references(() => operators.id),
    clearedAt: timestamp('cleared_at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.episodeId, t.ingestId],
      foreignColumns: [episodeIngests.episodeId, episodeIngests.ingestId],
      name: 'episode_clearings_delivery_fk',
    }),
    index('episode_clearings_episode_idx').on(t.episodeId, t.clearedAt.desc()),
    index('episode_clearings_ingest_idx').on(t.ingestId),
    check('episode_clearings_reason_check', sql`length(trim(${t.reason})) > 0`),
    check(
      'episode_clearings_from_state_check',
      sql`${t.fromState} in ('ok', 'flagged', 'quarantined')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// The identity spine (PLT-04)
//
// Everything above this line describes a measurement. Everything below gives it
// an owner. §4.3: "Every episode must resolve to exactly one task, collector,
// device, scenario, upload path, reviewer decision and settlement record" — and
// an episode that cannot is quarantined with a human to resolve it, never
// silently accepted and never dropped (PLT-05).
//
// Same two rules as above: money and durations are `numeric` with
// `mode: 'string'`, and closed sets are text with a CHECK while sets that are
// expected to grow are text with none.

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * APP-08: the task hall lists "type, unit price, target duration, current
     * progress and claimable state", so type is the one thing BO-02 configures
     * that this table did not carry.
     *
     * No CHECK, by the file's own rule: the collection taxonomy is PaXini's and
     * grows — kitchen, assembly, retail — and an enum migration per new theme is
     * a tax. Nullable because the rows that exist predate the column; the API
     * requires it on create, so nothing new is written without one.
     */
    type: text('type'),
    /** Per effective minute. Never a float: this is multiplied into a payment. */
    unitPrice: numeric('unit_price', { precision: 12, scale: 4, mode: 'string' }).notNull(),
    targetEffectiveDurationS: numeric('target_effective_duration_s', {
      precision: 20,
      scale: 6,
      mode: 'string',
    }),
    maxConcurrentClaimants: integer('max_concurrent_claimants').notNull().default(1),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * BO-01's four verbs — create, edit, publish, take down — are three states
     * and two legal moves. The CHECK below says which states exist; it cannot
     * say which moves are legal, because a CHECK only ever sees the new row.
     * `tasks_status_transition` (migration 0006) is the BEFORE UPDATE trigger
     * that refuses `published -> draft` and anything out of `taken_down`, and
     * it is at the database rather than in the route for the usual reason: a
     * second writer must not be able to un-take-down a task by knowing SQL.
     */
    check('tasks_status_check', sql`${t.status} in ('draft', 'published', 'taken_down')`),
    /**
     * Positive is all a CHECK can say. `tasks_capacity_below_live` (migration
     * 0007) is the other half: a cap cannot be lowered under the claims already
     * live on the task, which needs the count of other rows and the same task
     * lock `task_claims_guard` takes.
     */
    check('tasks_claimants_check', sql`${t.maxConcurrentClaimants} > 0`),
  ],
);

export const collectors = pgTable(
  'collectors',
  {
    id: uuid('id').primaryKey(),
    externalRef: text('external_ref').notNull(),
    status: text('status').notNull(),
    /**
     * APP-04: "An exam follows training. Pass/fail is recorded." Both answers,
     * so a fail is a recorded fact and not the absence of one — which matters
     * because APP-05 refuses a claim on anything that is not 'pass', and
     * "refused because they failed" and "refused because nobody examined them"
     * are different conversations at a counter.
     *
     * ponytail: one result, not an attempts table. APP-07 (retake policy) is P2
     * and undecided; when it lands, this becomes the latest row of
     * `collector_exam_attempts` and the gate reads that instead.
     */
    examResult: text('exam_result'),
    examDecidedAt: timestamp('exam_decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('collectors_external_ref_key').on(t.externalRef),
    check(
      'collectors_status_check',
      sql`${t.status} in ('pending', 'qualified', 'suspended')`,
    ),
    check(
      'collectors_exam_result_check',
      sql`${t.examResult} is null or ${t.examResult} in ('pass', 'fail')`,
    ),
    /** A result without a date is not a record of anything. Both or neither. */
    check(
      'collectors_exam_decided_check',
      sql`(${t.examResult} is null) = (${t.examDecidedAt} is null)`,
    ),
  ],
);

/**
 * APP-02 and PRV-01: the six agreements, each with the version accepted and the
 * moment it was accepted.
 *
 * A child table rather than twelve columns on `collectors`. The six names are a
 * closed set today and the set is legal's to change — a seventh agreement is
 * then one CHECK edit, not two more columns and every query rewritten. It also
 * makes "which agreements is this collector missing?" a query rather than a
 * hand-written twelve-way null test.
 *
 * The version is text, not a number: legal versions these as "2026-08-v2" and
 * whatever they hand over is what has to be storable verbatim.
 *
 * The version is IN the key, which is what makes this append-only in fact and
 * not only in intent. Keyed on `(collector_id, agreement)` alone, accepting a
 * reissued privacy policy could only overwrite the acceptance of the old one —
 * and the question a regulator asks is "what did this person agree to, and
 * when", which needs both rows. So a new version is a new row, re-posting the
 * same version is a no-op, and nothing here is ever updated in place.
 *
 * "Has this collector accepted all six?" is therefore `count(distinct
 * agreement)`, not `count(*)` — which is exactly how `task_claims_guard` asks
 * it, because PRODUCT.md gates claiming a task on all six.
 *
 * `collector_agreements_append_only` (migration 0006) refuses UPDATE and
 * DELETE on this table. Append-only was the intent from the start; the trigger
 * is what makes it true for writers that are not this API.
 */
export const collectorAgreements = pgTable(
  'collector_agreements',
  {
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    agreement: text('agreement').notNull(),
    version: text('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collectorId, t.agreement, t.version] }),
    check(
      'collector_agreements_name_check',
      sql`${t.agreement} in ('user', 'privacy', 'data_collection', 'commercial_use', 'manual_review', 'offline_settlement')`,
    ),
    check('collector_agreements_version_check', sql`length(trim(${t.version})) > 0`),
  ],
);

/**
 * APP-10 / BO-02: a collector holds a claim on a task, and a task at its
 * maximum concurrent claimants is not claimable.
 *
 * The cap is a cross-row invariant, so it is not a CHECK — a CHECK sees one row
 * and cannot count the others. It is not application code either: two counters
 * both reading "4 of 5 taken" and both inserting is the classic overshoot, and
 * no amount of care in one route protects against a second writer.
 *
 * `task_claims_guard` (migration 0006) takes `select ... for update` on the
 * task row before counting, so two genuinely concurrent claims for the last
 * slot serialise on that lock: the second one waits, then counts the first and
 * is refused. It carries the eligibility gates in the same place for the same
 * reason — a gate that lives in one route is a gate one route can forget.
 *
 * Three of them, which is what PRODUCT.md asks for: the exam pass (APP-05),
 * `qualified` status, and all six agreements (APP-02 / PRV-01). Training is the
 * fourth and is missing because nothing here records it yet.
 *
 * `released_at` rather than a delete: who held what, and until when, is the
 * evidence behind a settlement dispute. `task_claims_history_immutable`
 * (migration 0007) is what makes that true rather than customary — a claim row
 * cannot be deleted, `claimed_at` cannot move, and a `released_at` already set
 * cannot be rewritten. Releasing and re-claiming are still allowed, and the
 * re-claim clears the gates again.
 */
export const taskClaims = pgTable(
  'task_claims',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_claims_task_idx').on(t.taskId, t.releasedAt),
    index('task_claims_collector_idx').on(t.collectorId),
    /**
     * One live claim per collector per task. Partial, so a released claim stays
     * on the record and the same collector can claim the task again later.
     */
    uniqueIndex('task_claims_live_key')
      .on(t.taskId, t.collectorId)
      .where(sql`${t.releasedAt} is null`),
    check(
      'task_claims_released_after_check',
      sql`${t.releasedAt} is null or ${t.releasedAt} >= ${t.claimedAt}`,
    ),
    /**
     * Not uniqueness — `id` is the primary key. These are the targets of the
     * composite foreign keys on `collection_sessions` and `settlements`
     * (migration 0016), which is what lets "this claim is for this task and
     * this collector" be checked by the database rather than by the route.
     */
    unique('task_claims_task_key').on(t.id, t.taskId),
    unique('task_claims_pairing_key').on(t.id, t.taskId, t.collectorId),
  ],
);

/** P2-03. Capability differs by type, so type is an entity and not a string on the device. */
export const deviceTypes = pgTable(
  'device_types',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    generation: text('generation').notNull(),
    /** No CHECK: phase 2 adds glove and six-camera-headset capabilities. */
    capabilities: jsonb('capabilities').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('device_types_code_key').on(t.code)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    deviceTypeId: uuid('device_type_id')
      .notNull()
      .references(() => deviceTypes.id),
    /** As stamped on the hardware and spelled in the session basename: AZER76400FE. */
    hardwareSerial: text('hardware_serial').notNull(),
    firmwareVersion: text('firmware_version'),
    status: text('status').notNull(),
    /**
     * BO-04 / APP-14: who holds this device now. One column and not a bindings
     * table, because §4.3 already forbids inferring a session's device from
     * "whoever last had it" — the session records its own device, so this is
     * only ever the *current* answer and history belongs to `audit_events`,
     * where SEC-04 requires unbinding to appear anyway.
     *
     * ponytail: current-binding column. A bindings table earns its place when a
     * device must be held by two collectors at once, which phase 1 forbids.
     */
    boundCollectorId: uuid('bound_collector_id').references(() => collectors.id),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    /** BO-04's fault state, said out loud. `status = 'faulty'` is the flag; this is why. */
    faultNote: text('fault_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_hardware_serial_key').on(t.hardwareSerial),
    check('devices_status_check', sql`${t.status} in ('active', 'faulty', 'retired')`),
    /** A binding is always a binding *since* a moment, or it is not a binding. */
    check(
      'devices_bound_at_check',
      sql`(${t.boundCollectorId} is null) = (${t.boundAt} is null)`,
    ),
    /**
     * A retired device is off the fleet, so it cannot be in someone's hands. A
     * faulty one deliberately still can: hardware fails while it is being worn,
     * and a constraint that unbound it on the way in would erase who had it.
     */
    check(
      'devices_retired_unbound_check',
      sql`${t.status} <> 'retired' or ${t.boundCollectorId} is null`,
    ),
    index('devices_bound_collector_idx').on(t.boundCollectorId),
  ],
);

/**
 * BO-04's other half: who holds a device FOR A PERIOD, rather than who holds it
 * at this moment.
 *
 * Daniel, from PaXini, 2026-08-25: one collector holds a given headset for an
 * allotted period of about three months, and at the end of it the credentials
 * swap to the next collector. So a device serial plus a recording start instant
 * names a collector — which makes this a CROSSCHECK on payment attribution and
 * not a replacement for one. The resolver's handover scoping is still the outer
 * bound; `resolve.ts` says why, and this table only ever narrows what that scope
 * already produced.
 *
 * `devices.bound_collector_id` is not this and does not become this. It is the
 * current answer with no history and no instants, so it cannot say who held
 * AZER76400FE on 13 August. Both stay: the column is what the counter reads when
 * a card arrives, this table is what settlement replays six months later.
 *
 * THE invariant — two assignments of one device can never overlap in time — is
 * `device_assignments_no_overlap` in migration 0010 and not in this file.
 * Drizzle cannot express an EXCLUDE constraint, and no CHECK can see another
 * row. Adjacent periods are deliberately legal: the range is half-open, so a
 * handover at the instant the last period ends is one continuous custody chain
 * and not an overlap.
 */
export const deviceAssignments = pgTable(
  'device_assignments',
  {
    id: uuid('id').primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    /** Null is the open period: this collector holds the device now. */
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** A period ends after it starts, or it is not a period. */
    check(
      'device_assignments_period_check',
      sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`,
    ),
    /**
     * Only the collector side. The exclusion constraint in 0010 is backed by a
     * gist index on `(device_id, period)`, which already serves every lookup by
     * device — a second btree index on the same column would be dead weight.
     */
    index('device_assignments_collector_idx').on(t.collectorId),
  ],
);

export const scenarios = pgTable(
  'scenarios',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    privacyRiskLevel: text('privacy_risk_level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('scenarios_code_key').on(t.code),
    check(
      'scenarios_privacy_risk_check',
      sql`${t.privacyRiskLevel} in ('low', 'medium', 'high')`,
    ),
  ],
);

export const uploadCentres = pgTable(
  'upload_centres',
  {
    id: uuid('id').primaryKey(),
    region: text('region').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('upload_centres_status_check', sql`${t.status} in ('active', 'suspended')`)],
);

/**
 * §6.15, in full. `authorisation_status` is what PRV-07 reads: scenario
 * authorisation is recorded before collection at any non-home site, and
 * factory, warehouse, medical, retail and customer-facing scenarios need
 * individual approval.
 */
export const collectionPoints = pgTable(
  'collection_points',
  {
    id: uuid('id').primaryKey(),
    siteId: text('site_id').notNull(),
    country: text('country'),
    city: text('city'),
    region: text('region'),
    scenarioId: uuid('scenario_id').references(() => scenarios.id),
    siteOwner: text('site_owner'),
    /** No CHECK: network taxonomies grow, and this one is descriptive. */
    networkType: text('network_type'),
    operator: text('operator'),
    /** Measured, not advertised. numeric so a 0.5 Mbit site is expressible. */
    uplinkMbps: numeric('uplink_mbps', { precision: 10, scale: 3, mode: 'string' }),
    grade: text('grade'),
    centralisedUploadAvailable: boolean('centralised_upload_available'),
    defaultUploadCentreId: uuid('default_upload_centre_id').references(() => uploadCentres.id),
    chargingAvailable: boolean('charging_available'),
    sensitiveInfoInvolved: boolean('sensitive_info_involved'),
    authorisationStatus: text('authorisation_status').notNull().default('pending'),
    responsiblePerson: text('responsible_person'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('collection_points_site_id_key').on(t.siteId),
    check(
      'collection_points_authorisation_check',
      sql`${t.authorisationStatus} in ('pending', 'approved', 'refused', 'withdrawn')`,
    ),
  ],
);


/**
 * The anchor. Everything downstream hangs off a session id.
 *
 * `session_origin` records who created it, because the answer changes and the
 * drift must be measurable: in the pilot the upload-centre client creates the
 * session at handover and reconstructs the two APP-17b declarations
 * retroactively, which is acceptable at 20 devices and is not acceptable at
 * 500. Later the collector app creates it before recording (APP-16) — a third
 * caller of the same table and the same API, needing no schema change.
 */
export const collectionSessions = pgTable(
  'collection_sessions',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id),
    collectionPointId: uuid('collection_point_id').references(() => collectionPoints.id),
    /**
     * The card this session was declared against.
     *
     * Nullable, and deliberately so: APP-16 has the collector app create a
     * session *before* recording, when no card has been handed in yet, so an
     * app-origin session has no handover to point at. A handover-origin session
     * always does, which the CHECK below enforces.
     *
     * Without this the resolver had to scope candidate sessions by collector,
     * which meant every session that collector had ever declared was a
     * candidate for every later card. One card per collector hides it; the
     * second card quarantines the whole batch, and under time-window matching
     * it could attach this week's footage to last week's task at last week's
     * unit price.
     */
    handoverId: uuid('handover_id').references((): AnyPgColumn => handovers.id),
    /**
     * The claim this session was recorded under (APP-10), and what that claim
     * paid at the moment the session was declared — copied here so a task
     * edited later cannot change what footage already recorded earns, and so
     * the verdict never has to read `tasks` for a price.
     *
     * `collection_sessions_claim_fk` is composite on (claim, task, collector):
     * a session cannot name another collector's claim, or a claim on another
     * task. Whether the claim was LIVE when the session was declared is the
     * counter's check (counter.ts), because "live at that moment" is about a
     * time the schema does not hold.
     *
     * Nullable for rows from before migration 0016, which are never
     * backfilled; the migration says why. A session with no claim has no
     * price, and the verdict refuses it rather than guessing one.
     */
    taskClaimId: uuid('task_claim_id'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 4, mode: 'string' }),
    currency: text('currency'),
    /**
     * APP-17b. NOT NULL on purpose: these drive QR-07 review routing and PRV-07
     * authorisation checks, and "we did not ask" is not one of the answers.
     */
    othersInFrame: boolean('others_in_frame').notNull(),
    sensitiveInfoPresent: boolean('sensitive_info_present').notNull(),
    sessionOrigin: text('session_origin').notNull(),
    prepareTime: timestamp('prepare_time', { withTimezone: true }),
    createdBy: text('created_by'),
    clientVersion: text('client_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('collection_sessions_collector_idx').on(t.collectorId),
    index('collection_sessions_task_idx').on(t.taskId),
    index('collection_sessions_handover_idx').on(t.handoverId),
    index('collection_sessions_claim_idx').on(t.taskClaimId),
    foreignKey({
      columns: [t.taskClaimId, t.taskId, t.collectorId],
      foreignColumns: [taskClaims.id, taskClaims.taskId, taskClaims.collectorId],
      name: 'collection_sessions_claim_fk',
    }),
    /** A claim without its price, or a price without its claim, is half a record. */
    check(
      'collection_sessions_claim_snapshot_check',
      sql`(${t.taskClaimId} is null) = (${t.unitPrice} is null)
          and (${t.taskClaimId} is null) = (${t.currency} is null)`,
    ),
    check(
      'collection_sessions_origin_check',
      sql`${t.sessionOrigin} in ('handover', 'app', 'backoffice')`,
    ),
    /** A session reconstructed at the counter belongs to the card on the counter. */
    check(
      'collection_sessions_handover_required_check',
      sql`${t.sessionOrigin} <> 'handover' or ${t.handoverId} is not null`,
    ),
    /**
     * The target of `collector_uploads_session_fk` (0019). `id` is already the
     * primary key, so this restricts nothing on this table; it exists so a
     * Path A upload can name (session, collector) as a pair and have the pair
     * checked by Postgres. "That session is not yours" is then unrepresentable
     * rather than only refused by a route.
     */
    unique('collection_sessions_owner_key').on(t.id, t.collectorId),
  ],
);

/**
 * P2-01. A session may bind more than one device: phase 2 pairs a headset with
 * one or two gloves. A one-device-per-session assumption is expensive to undo
 * once 40,000 hours exist, so the join table exists now and phase 1 constrains
 * it rather than collapsing it.
 *
 * `collection_session_devices_phase1_one_per_session` IS the phase-1
 * assumption, in one line. Dropping that index is the whole of the phase-2
 * migration for this table.
 */
export const collectionSessionDevices = pgTable(
  'collection_session_devices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    collectionSessionId: uuid('collection_session_id').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    /** No CHECK: 'headset' now, 'glove_left' and 'glove_right' in phase 2. */
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Named explicitly for the same 63-byte reason as cp_alt_centres above.
    foreignKey({
      columns: [t.collectionSessionId],
      foreignColumns: [collectionSessions.id],
      name: 'csd_session_fk',
    }),
    uniqueIndex('collection_session_devices_role_key').on(t.collectionSessionId, t.role),
    uniqueIndex('collection_session_devices_phase1_one_per_session').on(t.collectionSessionId),
  ],
);

export const uploadDevices = pgTable(
  'upload_devices',
  {
    id: uuid('id').primaryKey(),
    uploadCentreId: uuid('upload_centre_id')
      .notNull()
      .references(() => uploadCentres.id),
    machineIdentifier: text('machine_identifier').notNull(),
    status: text('status').notNull(),
    /** PRD §11.3.2 rule 4: device credentials, scoped to controlled upload paths. */
    credentialHash: text('credential_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('upload_devices_machine_key').on(t.uploadCentreId, t.machineIdentifier),
    check('upload_devices_status_check', sql`${t.status} in ('active', 'retired')`),
  ],
);

/**
 * People who sign in. Two kinds, one table, told apart by `role`.
 *
 * PLT-10 wants PaXini's reviewers to reach in from China, scoped to review and
 * fully logged. They are not standing at a VNG counter, so `upload_centre_id`
 * cannot be mandatory for them — and a second `reviewers` table would mean a
 * second credential store, a second login path, and a second nullable actor
 * column on `audit_events` with a CHECK to say exactly one is set. The `role`
 * column was already here and already `not null`; using it is the smaller and
 * the more auditable change.
 *
 * `role` still has no CHECK: the value set is a back-office concern that grows,
 * and the two constraints below are the ones that carry weight.
 */
export const operators = pgTable(
  'operators',
  {
    id: uuid('id').primaryKey(),
    /** Null only for a reviewer — see `operators_centre_check`. */
    uploadCentreId: uuid('upload_centre_id').references(() => uploadCentres.id),
    externalRef: text('external_ref').notNull(),
    role: text('role').notNull(),
    /** scrypt, `N$salt$hash`. Never a secret at rest, never logged. */
    credentialHash: text('credential_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('operators_ref_key').on(t.uploadCentreId, t.externalRef),
    /**
     * A reviewer's reference is unique on its own, because `operators_ref_key`
     * cannot hold it: two rows with a null centre are distinct to a unique
     * index no matter what the second column says, so without this a second
     * `pax-01` would insert cleanly and `authenticateReviewer` would sign in
     * whichever row came back first.
     */
    uniqueIndex('operators_reviewer_ref_key')
      .on(t.externalRef)
      .where(sql`role = 'reviewer'`),
    /**
     * Everyone but a reviewer belongs to a centre. Dropping `not null` to make
     * room for reviewers must not quietly make it optional for the operators
     * BO-11 / SEC-02 scope by centre.
     */
    check(
      'operators_centre_check',
      sql`${t.uploadCentreId} is not null or ${t.role} = 'reviewer'`,
    ),
  ],
);

/**
 * A card changing hands. §4.3: devices circulate between collectors and cards
 * circulate between devices, and neither may ever be inferred from "whoever
 * last had it" — so the collector and the device are recorded on the handover
 * itself, at the counter, and never looked up afterwards.
 */
export const handovers = pgTable(
  'handovers',
  {
    id: uuid('id').primaryKey(),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    tfCardId: text('tf_card_id').notNull(),
    uploadCentreId: uuid('upload_centre_id')
      .notNull()
      .references(() => uploadCentres.id),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    handoverTime: timestamp('handover_time', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('handovers_collector_idx').on(t.collectorId),
    index('handovers_card_idx').on(t.tfCardId),
  ],
);

/**
 * One import run off one card on one machine. `batch_status` follows §4.4's
 * upload-batch lifecycle. The cache-cleanup gate (UPL-06) is a CHECK rather
 * than a procedure: an upload centre's local copy is the only copy until the
 * cloud says otherwise, so "cleaned before verified" must be unrepresentable.
 *
 * The other half of that gate lives in migrations 0007 and 0009, because
 * drizzle cannot express a trigger: `upload_batches_cloud_verify_guard` refuses
 * to set EITHER `cloud_verified_at` OR `local_cache_cleaned_at` unless the batch
 * has at least one episode and every episode on it reads `verification_state = 'verified'`
 * at that moment — the byte read-back verdict written by the upload leg
 * (packages/api/src/upload.ts), never an ETag (spec ING-29). Both timestamps,
 * because "verified once" is a fact that stays true while "safe to delete the
 * only local copy" is a question about now.
 */
export const uploadBatches = pgTable(
  'upload_batches',
  {
    id: uuid('id').primaryKey(),
    handoverId: uuid('handover_id')
      .notNull()
      .references(() => handovers.id),
    uploadDeviceId: uuid('upload_device_id')
      .notNull()
      .references(() => uploadDevices.id),
    importStartedAt: timestamp('import_started_at', { withTimezone: true }).notNull(),
    importCompletedAt: timestamp('import_completed_at', { withTimezone: true }),
    cloudVerifiedAt: timestamp('cloud_verified_at', { withTimezone: true }),
    localCacheCleanedAt: timestamp('local_cache_cleaned_at', { withTimezone: true }),
    fileCount: integer('file_count'),
    totalSizeBytes: bigint('total_size_bytes', { mode: 'number' }),
    batchStatus: text('batch_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('upload_batches_handover_idx').on(t.handoverId),
    check(
      'upload_batches_status_check',
      sql`${t.batchStatus} in ('importing', 'imported', 'uploading', 'verifying', 'verified', 'closed', 'failed')`,
    ),
    check(
      'upload_batches_cache_after_verify_check',
      sql`${t.localCacheCleanedAt} is null or (${t.cloudVerifiedAt} is not null and ${t.localCacheCleanedAt} >= ${t.cloudVerifiedAt})`,
    ),
  ],
);

/**
 * Path A: one delivery, by one collector, of one session (migration 0019).
 *
 * UPL-07 asks that an episode trace to the parties that handled it. Path C
 * traces through `upload_batches` to a handover, and from there to a centre, a
 * machine, an operator, a collector and a device. Path A has none of those
 * hops — the phone is the whole chain — so this row carries the three that
 * exist: the collector who sent it, the session it was recorded under, and the
 * device that recorded it.
 *
 * It is not a second `upload_batches`. A batch is a card's worth of episodes
 * imported by a machine, and its lifecycle carries the UPL-06 cache gate,
 * which has no meaning here: there is no upload-centre cache on Path A and no
 * code path anywhere clears the phone. One row is one episode's delivery.
 *
 * The multipart upload id and the parts already in the cloud are deliberately
 * NOT columns here. `upload-worker.ts` explains why for Path C and the same
 * argument is stronger on Path A: the object store is the one record that
 * cannot disagree with the object store, and a phone that is reinstalled
 * still resumes because the server asks the cloud rather than a table.
 */
export const collectorUploads = pgTable(
  'collector_uploads',
  {
    /** Client-generated, so a replayed registration lands once. */
    id: uuid('id').primaryKey(),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    collectionSessionId: uuid('collection_session_id').notNull(),
    /** As the session directory's basename spells it. Evidence, not identity. */
    deviceSerial: text('device_serial').notNull(),
    /** The platform row that serial resolves to, when the fleet has one. */
    deviceId: uuid('device_id').references(() => devices.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.episodeId),
    ingestId: uuid('ingest_id')
      .notNull()
      .references(() => episodeIngests.ingestId),
    sourceBasename: text('source_basename').notNull(),
    /** Declared by the phone, never measured here: the server never sees its disk. */
    fileCount: integer('file_count').notNull(),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
    /**
     * The files of the delivery that are not in `episode_files` — in practice
     * the manifest, which ING-02 keeps out of the fingerprint. Path C
     * recomputes this set by scanning the centre's disk (`transportInventory`);
     * Path A has no disk to scan, so the phone declares it and it is stored.
     */
    extraFiles: jsonb('extra_files').notNull().default([]),
    state: text('state').notNull().default('registered'),
    clientVersion: text('client_version'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('collector_uploads_collector_idx').on(t.collectorId, t.registeredAt.desc()),
    index('collector_uploads_session_idx').on(t.collectionSessionId),
    index('collector_uploads_episode_idx').on(t.episodeId),
    /** The session has to be this collector's; a key on the session alone would take anybody's. */
    foreignKey({
      columns: [t.collectionSessionId, t.collectorId],
      foreignColumns: [collectionSessions.id, collectionSessions.collectorId],
      name: 'collector_uploads_session_fk',
    }),
    /** The delivery has to be one of that episode's own. */
    foreignKey({
      columns: [t.episodeId, t.ingestId],
      foreignColumns: [episodeIngests.episodeId, episodeIngests.ingestId],
      name: 'collector_uploads_delivery_fk',
    }),
    check('collector_uploads_state_check', sql`${t.state} in ('registered', 'verified', 'failed')`),
    check(
      'collector_uploads_completed_check',
      sql`(${t.state} = 'registered') = (${t.completedAt} is null)`,
    ),
    /**
     * `>= 0`. Sample session 072415 is a real recorded session with no media in
     * it, and ING-17 says nothing is discarded: an empty delivery still stores
     * and still gets a row saying a phone offered it.
     */
    check(
      'collector_uploads_counts_check',
      sql`${t.fileCount} >= 0 and ${t.totalBytes} >= 0`,
    ),
    /**
     * One verified upload per delivery, and no second one. Partial, because a
     * delivery may be attempted more than once and each attempt is a row —
     * what must not exist twice is the sentence "these bytes are up and
     * checked", which is what a settlement reads.
     */
    uniqueIndex('collector_uploads_verified_key')
      .on(t.episodeId, t.ingestId)
      .where(sql`state = 'verified'`),
  ],
);

/**
 * Defect routing, as a catalogue rather than a CHECK or an enum.
 *
 * PaXini said on 13 Aug that the in-the-wild review standard does not exist yet
 * and will be rewritten during the pilot, so the routing decision has to be a
 * row an operator can edit, not a deployment.
 *
 * Two independent flags, because they answer two different questions and one
 * boolean cannot serve both. `blocks_review` asks whether a human can judge
 * this episode at all. `suppresses_settlement` asks whether it is payable.
 * CALIB-MISSING is the case that forces the distinction: acceptance 10.3.8
 * wants calibration on every episode, but the collector did not cause its
 * absence — 073055 shipped a camera calibration and no IMU one, which is the
 * device's doing. It is seeded `blocks_review = false` pending the product
 * owner's answer, and either answer is an UPDATE rather than a migration.
 *
 * `severity` on episode_defects is left alone: that is the engine's own reading
 * of how bad a thing is, and it is not the same question as routing.
 */
export const defectCodes = pgTable(
  'defect_codes',
  {
    code: text('code').primaryKey(),
    blocksReview: boolean('blocks_review').notNull(),
    suppressesSettlement: boolean('suppresses_settlement').notNull(),
    description: text('description').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('defect_codes_blocking_idx').on(t.blocksReview)],
);

/**
 * §6.9's failure reasons, as rows. LOC-04 requires them localised for
 * collectors, and QR-04 requires the reason to reach the collector "in a form
 * they can act on" — which a bare enum value in a text[] is not.
 *
 * `category` is text with no CHECK for the same reason the codes are rows: the
 * grouping is PaXini's and will move during the pilot.
 */
export const reviewReasonCodes = pgTable(
  'review_reason_codes',
  {
    code: text('code').primaryKey(),
    category: text('category').notNull(),
    labelEn: text('label_en').notNull(),
    /** LOC-04: the collector reads Vietnamese. */
    labelVi: text('label_vi'),
    /** LOC-02: PaXini reviewers work in Chinese during phase 1. */
    labelZh: text('label_zh'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_reason_codes_category_idx').on(t.category)],
);

/**
 * QR-08. A collector challenging a verdict, raised by an operator on their
 * behalf — the pilot has no collector login.
 *
 * Append-only: written once, closed once (`review_disputes_guard`, 0016).
 * Raising one moves nothing in money. It is answered by a second review row
 * carrying `dispute_id`, and the outcome is written here when that verdict
 * lands: `upheld` when it agrees and the original settlement stands,
 * `overturned` when it differs and the original is superseded.
 *
 * What may be disputed is a database rule, not a route's: a decided review
 * that is not itself a second review, whose settlement is still
 * `pending_settlement`. A bill is never revised, so a billed or paid
 * settlement cannot be reopened until that workflow exists.
 */
export const reviewDisputes = pgTable(
  'review_disputes',
  {
    id: uuid('id').primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references((): AnyPgColumn => episodeReviews.id),
    raisedBy: uuid('raised_by')
      .notNull()
      .references(() => operators.id),
    reason: text('reason').notNull(),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    outcome: text('outcome'),
  },
  (t) => [
    /** One OPEN dispute per review. */
    uniqueIndex('review_disputes_open_key').on(t.reviewId).where(sql`${t.resolvedAt} is null`),
    index('review_disputes_review_idx').on(t.reviewId),
    check('review_disputes_reason_check', sql`length(btrim(${t.reason})) > 0`),
    check(
      'review_disputes_outcome_check',
      sql`${t.outcome} is null or ${t.outcome} in ('upheld', 'overturned')`,
    ),
    check('review_disputes_resolved_check', sql`(${t.resolvedAt} is null) = (${t.outcome} is null)`),
  ],
);

/**
 * The reviewer's verdict, and the reason QR-03 is enforceable at all.
 *
 * `effective_duration_s <= measured_duration_s` has to be a CHECK, and a CHECK
 * cannot reach into another table. `measured_duration_s` lives on
 * `episode_ingests` because it describes one delivery, so the review carries a
 * copy and a composite foreign key makes the copy honest: the three columns
 * must match a real ingest row, which means the copy cannot drift and the
 * comparison happens between two columns of a single row.
 *
 * The key is (episode_id, ingest_id, measured_duration_s), not just the last
 * two — otherwise a review could be attached to an ingest belonging to a
 * different episode, and the verdict would be about footage nobody looked at.
 *
 * A review is bound to the exact delivery it judged. That matters when a second
 * delivery of the same session arrives with a different measured duration after
 * a review already exists: the old verdict stays attached to what it saw.
 */
export const episodeReviews = pgTable(
  'episode_reviews',
  {
    id: uuid('id').primaryKey(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.episodeId),
    ingestId: uuid('ingest_id').notNull(),
    /** Carried, not duplicated: the composite FK below forces it to match. */
    measuredDurationS: numeric('measured_duration_s', {
      precision: 20,
      scale: 6,
      mode: 'string',
    }).notNull(),
    effectiveDurationS: numeric('effective_duration_s', {
      precision: 20,
      scale: 6,
      mode: 'string',
    }),
    reviewState: text('review_state').notNull(),
    /**
     * QR-07. Which lane this review waits in.
     *
     * `privacy` is set when the collection session carries either APP-17b
     * declaration — others in frame, or sensitive information — and by a
     * reviewer or the back office flagging one mid-review (PRV-04, BO-15). A
     * column and not a join, because the reviewer's flag has to be recordable
     * *without* rewriting the collector's own declaration: those two booleans
     * are what the collector said before recording, and a reviewer overwriting
     * them would destroy the only evidence of what was declared.
     *
     * The lane is materialised at claim time from the declarations, so the
     * derivation lives in one SQL expression in `review.ts` and this column is
     * what the queue reads.
     */
    queue: text('queue').notNull().default('standard'),
    /**
     * QR-05. Higher goes first; ties break on how long the row has waited.
     *
     * Only rows that exist can be prioritised, which is a real consequence of a
     * lazy queue: an episode nobody has claimed has no review row and therefore
     * no priority. `POST /api/review/route/:episodeId` materialises the row, so
     * prioritising an unseen episode is one request rather than a backfill.
     */
    priority: integer('priority').notNull().default(0),
    /**
     * QR-05. When set, only this reviewer is offered the row.
     *
     * Separate from `reviewer_ref`, which is a lease and moves on its own: an
     * assignment is somebody's intent and survives the lease expiring. Nullable
     * and null by default — the pilot queue is a pool and assignment is the
     * exception.
     *
     * A foreign key and not free text. An assignment is the one column here
     * that can make a row invisible to everybody — the queue offers an assigned
     * review to its assignee and to nobody else — so a typed or stale id would
     * park an episode forever with no error anywhere. `operators` is the right
     * parent today because that is the identity a reviewer signs in with; see
     * `reviewerOf` in `review.ts`.
     */
    assigneeRef: uuid('assignee_ref').references(() => operators.id),
    /**
     * Who holds this review. On a pending row that is the current leaseholder;
     * on a decided row it is who decided. One column and not two, because a
     * lease that expires and is re-claimed transfers both facts at once — the
     * new claimant is the one who will decide — and two columns would raise a
     * "which is authoritative" question that has no useful answer.
     *
     * A real foreign key, and `uuid` rather than `text` since PLT-10. It held
     * an `operators.id` from the first day and always will — a PaXini reviewer
     * and a VNG counter operator are both rows in that table — so leaving it as
     * unconstrained text meant the one column naming who decided a payment
     * could hold a string that matches nobody. Every verdict is money and this
     * is the only record of who made it.
     */
    reviewerRef: uuid('reviewer_ref').references(() => operators.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /**
     * The client's own id for one verdict attempt, and the whole of the
     * idempotency guarantee. A reviewer double-taps commit, or the write times
     * out and the browser retries: the second request carries the same id, the
     * unique index below refuses the second insert, and the endpoint returns
     * what the first one decided. Without it a retry is a second review row and
     * — through `settlements_review_key` being per-review — a second payment.
     *
     * Nullable because a pending row has no verdict yet, and Postgres allows
     * many nulls in a unique index. `episode_reviews_verdict_id_check` makes it
     * mandatory the moment the row is decided.
     */
    verdictId: uuid('verdict_id'),
    /** QR-04: free text the collector may be shown alongside the reason codes. */
    reviewerNote: text('reviewer_note'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    /**
     * When this claim stops being exclusive. A reviewer who closes the tab must
     * not strand an episode, so the queue reclaims anything past its lease
     * rather than waiting for a release that may never come.
     */
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    /**
     * Load to verdict, in seconds. Instrumentation, never money: reviewer
     * throughput is the programme's capacity ceiling at 40,000 hours and this
     * is the baseline to optimise against. Deliberately not `numeric(20,6)` —
     * it is a stopwatch, not a measurement anything is paid on.
     */
    timeToVerdictS: numeric('time_to_verdict_s', { precision: 12, scale: 3, mode: 'string' }),
    /**
     * QR-08. Set on a second review and on nothing else: the dispute this row
     * answers. `episode_reviews_dispute_guard` (0016) makes it an OPEN dispute
     * on the same delivery, held by anyone but the reviewer under challenge,
     * and written once.
     */
    disputeId: uuid('dispute_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.disputeId],
      foreignColumns: [reviewDisputes.id],
      name: 'episode_reviews_dispute_id_review_disputes_id_fk',
    }),
    foreignKey({
      columns: [t.episodeId, t.ingestId, t.measuredDurationS],
      foreignColumns: [
        episodeIngests.episodeId,
        episodeIngests.ingestId,
        episodeIngests.measuredDurationS,
      ],
      name: 'episode_reviews_ingest_fk',
    }),
    index('episode_reviews_episode_idx').on(t.episodeId),
    /**
     * One review per delivery, and the reason the queue needs no separate lock
     * table: claiming is an insert, and a second reviewer racing for the same
     * never-seen episode loses on this index rather than on application logic.
     *
     * A second delivery of the same session is a different `ingest_id` and so
     * gets its own review — which is the point of binding a verdict to the
     * exact bytes it judged. Re-reviewing one delivery is the dispute flow
     * (QR-08, 0016): the second review is a second row carrying `dispute_id`,
     * so this index is partial — one review per delivery that is NOT a second
     * review — and `episode_reviews_dispute_key` is one second review per
     * dispute. The `on conflict` targets in review.ts carry the predicate.
     */
    uniqueIndex('episode_reviews_delivery_key')
      .on(t.episodeId, t.ingestId)
      .where(sql`${t.disputeId} is null`),
    uniqueIndex('episode_reviews_dispute_key').on(t.disputeId),
    /**
     * The idempotency guarantee, at the database. Two concurrent requests
     * carrying the same `verdict_id` — a double-tap, or a retry racing the
     * original — cannot both write: one commits and the other is rejected here,
     * and the endpoint answers the loser with what the winner decided.
     */
    uniqueIndex('episode_reviews_verdict_key').on(t.verdictId),
    /**
     * The queue read, in one index: within a lane, pending rows in the order
     * they are handed out.
     *
     * `lease_expires_at` used to sit where `queue` and `priority` now are. It
     * never served the scan: the predicate that reclaims an expired lease is
     * `reviewer_ref is null or lease_expires_at < now()`, an OR across two
     * columns, which no btree can use as a key — it was always a filter, and
     * holding second position stopped `created_at` from supplying the sort.
     * Both `review_state` and `queue` are equality here, so the remaining two
     * columns are the ORDER BY exactly.
     */
    index('episode_reviews_queue_idx').on(
      t.reviewState,
      t.queue,
      t.priority.desc(),
      t.createdAt,
    ),
    check(
      'episode_reviews_state_check',
      sql`${t.reviewState} in ('pending', 'pass', 'partial_pass', 'fail')`,
    ),
    /**
     * Two lanes, and the second-review lane (QR-08). A misspelt lane is an
     * episode nobody is offered.
     */
    check(
      'episode_reviews_queue_check',
      sql`${t.queue} in ('standard', 'privacy', 'second_review')`,
    ),
    /**
     * QR-05, bounded at the database and not only in the request parser.
     *
     * The queue is ordered by this column, so one row with `2^31-1` on it sits
     * at the head of every lane until somebody notices, and one with the
     * minimum buries an episode under everything that will ever arrive. The
     * API bounds it too; this is the half a `psql` session cannot skip.
     */
    check('episode_reviews_priority_range_check', sql`${t.priority} between -1000 and 1000`),
    /**
     * A stopwatch cannot run backwards. `time_to_verdict_s` feeds
     * `/api/review/throughput`, which is a number about a person's pace, and a
     * negative row there would divide the rate rather than adding to it.
     */
    check(
      'episode_reviews_time_to_verdict_check',
      sql`${t.timeToVerdictS} is null or ${t.timeToVerdictS} >= 0`,
    ),
    /**
     * A decided review names the request that decided it. This is what makes
     * the idempotency key load-bearing rather than advisory: a verdict written
     * by a path that forgot to carry one cannot be inserted at all.
     */
    check(
      'episode_reviews_verdict_id_check',
      sql`${t.reviewState} = 'pending' or ${t.verdictId} is not null`,
    ),
    /** A claim is always a claim *until* a moment. An open-ended one strands the episode. */
    check(
      'episode_reviews_lease_check',
      sql`${t.reviewerRef} is null
          or (${t.claimedAt} is not null and ${t.leaseExpiresAt} is not null)`,
    ),
    /** QR-03, at the database, bypassable by nothing that speaks SQL. */
    check(
      'episode_reviews_effective_le_measured_check',
      sql`${t.effectiveDurationS} is null or ${t.effectiveDurationS} <= ${t.measuredDurationS}`,
    ),
    check(
      'episode_reviews_effective_nonneg_check',
      sql`${t.effectiveDurationS} is null or ${t.effectiveDurationS} >= 0`,
    ),
    /** §6.9: "Fail — effective duration 0, no settlement by default." */
    check(
      'episode_reviews_fail_is_zero_check',
      sql`${t.reviewState} <> 'fail' or ${t.effectiveDurationS} = 0`,
    ),
    /** A decided review has to say when, and by whom it was decided. */
    check(
      'episode_reviews_decided_check',
      sql`${t.reviewState} = 'pending' or (${t.reviewedAt} is not null and ${t.effectiveDurationS} is not null)`,
    ),
  ],
);

/** QR-01: one or more reason codes per verdict, each resolving to the catalogue. */
export const episodeReviewReasons = pgTable(
  'episode_review_reasons',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => episodeReviews.id),
    code: text('code')
      .notNull()
      .references(() => reviewReasonCodes.code),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.code] })],
);

/**
 * The segments a reviewer marked as useful, in episode-relative seconds.
 *
 * `effective_duration_s` on the review is their sum, and storing only the sum
 * was the first design. It does not survive a dispute: a collector who is paid
 * for 4 of 11 minutes will ask *which* 4, and "the reviewer typed 4" is not an
 * answer anyone can check. These rows are what makes the number re-derivable
 * from evidence rather than asserted.
 *
 * Always normalised before insert — clamped to the measured duration, sorted,
 * overlaps merged — so the sum of these rows equals `effective_duration_s` by
 * construction. That equality cannot be a CHECK because a CHECK cannot reach
 * across rows, so it is a property of the one function that writes them and is
 * tested there.
 *
 * `ordinal` rather than a surrogate key: the spans of a review are an ordered
 * list, and the order is the reviewer's own reading of the footage.
 */
export const episodeReviewSpans = pgTable(
  'episode_review_spans',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => episodeReviews.id),
    ordinal: integer('ordinal').notNull(),
    startS: numeric('start_s', { precision: 20, scale: 6, mode: 'string' }).notNull(),
    endS: numeric('end_s', { precision: 20, scale: 6, mode: 'string' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reviewId, t.ordinal] }),
    check('episode_review_spans_start_nonneg_check', sql`${t.startS} >= 0`),
    /**
     * Strictly greater: a zero-length span is not a shorter piece of footage,
     * it is a marking mistake, and normalisation drops it before it reaches
     * here. If one arrives, the write is wrong and should fail loudly.
     */
    check('episode_review_spans_ordered_check', sql`${t.endS} > ${t.startS}`),
  ],
);

/**
 * SET-02, made structural rather than procedural.
 *
 * There is deliberately NO foreign key from here to `episodes`, to
 * `episode_ingests` or to `upload_batches`. The only path from a settlement to
 * an episode runs through a review. An upload event therefore has nothing to
 * write against — "upload success does not trigger settlement" stops being a
 * rule somebody has to remember and becomes a row that cannot be inserted.
 *
 * `unit_price` and `effective_minutes` are copied at generation time on
 * purpose: a task's price may change later, and a bill already issued must
 * still explain its own arithmetic.
 */
export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey(),
    episodeReviewId: uuid('episode_review_id')
      .notNull()
      .references(() => episodeReviews.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    /**
     * The claim the reviewed footage was recorded under — the session's, not
     * any claim on the task. Nullable only for rows from before migration
     * 0016; `settlements_claim_guard` there refuses a new row without one, or
     * with one that is not the session's, and freezes it afterwards.
     */
    taskClaimId: uuid('task_claim_id'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 4, mode: 'string' }).notNull(),
    effectiveMinutes: numeric('effective_minutes', {
      precision: 20,
      scale: 6,
      mode: 'string',
    }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 4, mode: 'string' }).notNull(),
    settlementState: text('settlement_state').notNull(),
    /**
     * Set while `settlement_state = 'exception'` and null otherwise (0016).
     * `exception_from_state` is the state the row was parked from and the only
     * state it can return to; the trigger checks it against OLD on the way in.
     */
    exceptionFromState: text('exception_from_state'),
    exceptionReason: text('exception_reason'),
    exceptionNote: text('exception_note'),
    /**
     * QR-08. Set when a second verdict differed: the settlement written from
     * that verdict, which is the one that gets billed. A row with this set
     * sits in `exception` for good — parked from its own state with reason
     * `superseded`, which has no release edge — and `bill_lines_dispute_guard`
     * refuses it a line. Both in 0016.
     */
    supersededBy: uuid('superseded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.supersededBy],
      foreignColumns: [t.id],
      name: 'settlements_superseded_by_settlements_id_fk',
    }),
    /** SET-04: one settlement per review, so a verdict cannot be billed twice. */
    uniqueIndex('settlements_review_key').on(t.episodeReviewId),
    index('settlements_claim_idx').on(t.taskClaimId),
    foreignKey({
      columns: [t.taskClaimId, t.taskId],
      foreignColumns: [taskClaims.id, taskClaims.taskId],
      name: 'settlements_claim_fk',
    }),
    uniqueIndex('settlements_superseded_by_key').on(t.supersededBy),
    check(
      'settlements_state_check',
      sql`${t.settlementState} in ('pending_review', 'pending_settlement', 'bill_generated', 'manually_paid', 'exception')`,
    ),
    check('settlements_amount_nonneg_check', sql`${t.amount} >= 0`),
    check(
      'settlements_exception_reason_check',
      // `superseded` is reserved for a second review that rewrites a
      // settlement (0016's header). No route may write it, and the transition
      // guard gives a row parked under it no way back.
      sql`${t.exceptionReason} is null or ${t.exceptionReason} in ('disputed', 'duplicate', 'wrong_collector', 'manual_hold', 'superseded')`,
    ),
    check(
      'settlements_exception_shape_check',
      sql`case when ${t.settlementState} = 'exception' then ${t.exceptionFromState} is not null and ${t.exceptionReason} is not null else ${t.exceptionFromState} is null and ${t.exceptionReason} is null and ${t.exceptionNote} is null end`,
    ),
  ],
);

/**
 * SET-06 / BO-08: what finance pays, for one collector, for one cycle.
 *
 * `settlements_state_check` says which states exist. It cannot say which
 * *changes* are allowed, because a CHECK only ever sees the row in front of it
 * — `manually_paid → pending_review` satisfies it in both directions. The
 * ordering is enforced by `settlements_transition_guard`, a BEFORE INSERT OR
 * UPDATE trigger written by hand in `0005_settlement_lifecycle.sql`; drizzle
 * has no way to declare a trigger, so the migration is the source and this
 * comment is the pointer to it.
 *
 * The period is a parameter, not a constant: weekly is `[ASSUMED]` in the
 * brief's §13.2, so it is stored on every bill rather than implied by one.
 *
 * `total` is stored and is the sum of the line amounts. It is a denormalisation
 * with a guard: the same trigger refuses any later change to a settlement's
 * `amount`, so a bill's arithmetic cannot be invalidated after it is issued.
 * That is also why `bill_lines` carries no money of its own — there is exactly
 * one place each figure is written down.
 */
export const bills = pgTable(
  'bills',
  {
    id: uuid('id').primaryKey(),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    /** No column on `tasks` says this yet; see the known gaps in docs/review.md. */
    currency: text('currency').notNull(),
    total: numeric('total', { precision: 14, scale: 4, mode: 'string' }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * SET-07's idempotency, as an index rather than as a check in the
     * generator: re-running a cycle has nowhere to put a second bill, so a
     * regeneration provably changes nothing even if it is issued by a cron that
     * fired twice, by two operators at once, or straight from psql.
     */
    uniqueIndex('bills_collector_period_key').on(t.collectorId, t.periodStart, t.periodEnd),
    check('bills_period_check', sql`${t.periodEnd} > ${t.periodStart}`),
    check('bills_total_nonneg_check', sql`${t.total} >= 0`),
  ],
);

/**
 * One settlement on one bill. The primary key is the settlement alone, so a
 * settlement that is already billed cannot be added to a second bill — double
 * payment is unrepresentable rather than guarded against.
 *
 * SET-01 makes payable settlements out of pass and partial-pass reviews only.
 * The review lane writes a settlement for a rejected episode too, worth 0.0000,
 * because that row is the score of the review; `bill_lines_payable_guard` in
 * `0005_settlement_lifecycle.sql` is what keeps it off a bill, so a refused
 * episode cannot print a zero-value line.
 */
export const billLines = pgTable(
  'bill_lines',
  {
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id),
    settlementId: uuid('settlement_id')
      .notNull()
      .references(() => settlements.id),
  },
  (t) => [
    primaryKey({ name: 'bill_lines_settlement_key', columns: [t.settlementId] }),
    index('bill_lines_bill_idx').on(t.billId),
  ],
);

// ---------------------------------------------------------------------------
// Auth, audit and machine status (PLT-06/07/08, SEC-01/02/04/05)

/**
 * PRD §8.3.2 rule 1: "Upload center operators must log in to fixed upload
 * devices before importing data." So both identities are credentialed — the
 * machine proves where, the operator proves who — and both land on every audit
 * row. scrypt, so no native dependency.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** No CHECK: the action list grows every slice. */
    action: text('action').notNull(),
    targetTable: text('target_table').notNull(),
    /** text, not uuid: not every target is uuid-keyed. */
    targetId: text('target_id').notNull(),
    operatorId: uuid('operator_id').references(() => operators.id),
    /**
     * The third kind of actor (0019). A collector is not an `operators` row and
     * must not become one: `operator_id` names people who sign in to VNG
     * systems, and putting collectors in it would make "did a member of staff
     * touch this episode" unanswerable. Path A is the first route a collector
     * can mutate anything through, so it is the first row shape that needs it.
     */
    collectorId: uuid('collector_id').references(() => collectors.id),
    uploadDeviceId: uuid('upload_device_id').references(() => uploadDevices.id),
    uploadCentreId: uuid('upload_centre_id').references(() => uploadCentres.id),
    /**
     * Which kind of person `operator_id` names. PLT-10 asks for reviewer access
     * that is *fully logged*, and "logged" is not the same as "distinguishable"
     * — a reviewer's row and a counter operator's row both point into
     * `operators`, so without this column the trail cannot answer "did anything
     * a remote reviewer did touch this episode" without a join that a future
     * schema change can silently break.
     *
     * It is also what keeps the attribution CHECK below enforceable. A reviewer
     * has no upload device and no centre, so the old two-columns-not-null rule
     * had to be relaxed; relaxing it on the strength of a value stored on the
     * row itself keeps a counter mutation with a missing device unrepresentable.
     */
    actorRole: text('actor_role').notNull().default('operator'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
  },
  (t) => [
    index('audit_events_target_idx').on(t.targetTable, t.targetId, t.occurredAt.desc()),
    index('audit_events_operator_idx').on(t.operatorId, t.occurredAt.desc()),
    index('audit_events_collector_idx').on(t.collectorId, t.occurredAt.desc()),
    check(
      'audit_events_actor_role_check',
      sql`${t.actorRole} in ('operator', 'reviewer', 'collector')`,
    ),
    /**
     * An unattributed audit row defeats the table. Logins are the one case with
     * no actor yet; a reviewer is the one case with a person and no machine; a
     * collector (0019) is the one case with a person who is not staff.
     *
     * Three complete shapes and no overlap between them, rather than three "at
     * least this much" predicates. A half-filled row — a reviewer carrying an
     * upload device, an operator with no centre, a collector carrying an
     * operator row — would satisfy a loose check and still be evidence of
     * something that did not happen, which is the one failure this table exists
     * to prevent.
     *
     * `%.login_failed` belongs to `feat/rate-limiting`'s migration 0017, which
     * rewrites this same constraint and runs before 0019. The clause is carried
     * here so a later rewrite does not silently drop it; it matches nothing
     * until that branch lands.
     */
    check(
      'audit_events_attributed_check',
      sql`${t.action} like '%.login'
          or ${t.action} like '%.login_failed'
          or (${t.actorRole} = 'reviewer'
              and ${t.operatorId} is not null
              and ${t.collectorId} is null
              and ${t.uploadDeviceId} is null
              and ${t.uploadCentreId} is null)
          or (${t.actorRole} = 'operator'
              and ${t.operatorId} is not null
              and ${t.collectorId} is null
              and ${t.uploadDeviceId} is not null
              and ${t.uploadCentreId} is not null)
          or (${t.actorRole} = 'collector'
              and ${t.collectorId} is not null
              and ${t.operatorId} is null
              and ${t.uploadDeviceId} is null
              and ${t.uploadCentreId} is null)`,
    ),
    /** Manual resolution overrides the machine on a money path. It says why. */
    check(
      'audit_events_manual_reason_check',
      sql`${t.action} <> 'episode.resolve_manual' or ${t.reason} is not null`,
    ),
  ],
);

/** PRD §11.3.2 rule 8, verbatim. Current state per machine, upserted — not a time series. */
export const uploadDeviceStatus = pgTable('upload_device_status', {
  uploadDeviceId: uuid('upload_device_id')
    .primaryKey()
    .references(() => uploadDevices.id),
  networkState: text('network_state'),
  diskFreeBytes: bigint('disk_free_bytes', { mode: 'number' }),
  cardReaderState: text('card_reader_state'),
  queueDepth: integer('queue_depth'),
  clientVersion: text('client_version'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Payout (the §2.1 contract of the payout brief; migrations 0012 and 0013)

/**
 * Where a collector's money goes. Append-only history: a collector who fixes
 * their details declares a new account, and the old row stops being current.
 * `payout_accounts_append_only` (0012) refuses every other change and every
 * delete, because what was declared and what ZaloPay answered is the evidence
 * behind a name-mismatch flag.
 *
 * The full account number is never stored here — `account_no_last4` is for
 * display. The brief places the full value in a secrets store that this repo
 * does not have yet; see the payout handoff.
 */
export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    id: uuid('id').primaryKey(),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    method: text('method').notNull(),
    /** WALLET only. */
    phone: text('phone'),
    /** BANK_* only. */
    bankCode: text('bank_code'),
    accountNoLast4: text('account_no_last4'),
    /** What the collector typed. Never overwritten with ZaloPay's answer. */
    declaredName: text('declared_name').notNull(),
    /** What ZaloPay returned. */
    verifiedName: text('verified_name'),
    /** WALLET only, from verify-account; the transfer route needs it. */
    mUId: text('m_u_id'),
    verifyStatus: text('verify_status').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    isCurrent: boolean('is_current').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => operators.id),
  },
  (t) => [
    /** Exactly one current account per collector. */
    uniqueIndex('payout_accounts_current_key').on(t.collectorId).where(sql`${t.isCurrent}`),
    index('payout_accounts_collector_idx').on(t.collectorId, t.createdAt.desc()),
    check(
      'payout_accounts_method_check',
      sql`${t.method} in ('WALLET', 'BANK_ACCOUNT', 'BANK_CARD')`,
    ),
    check(
      'payout_accounts_verify_status_check',
      sql`${t.verifyStatus} in ('unverified', 'verified', 'name_mismatch', 'no_wallet', 'locked', 'kyc_limit', 'error')`,
    ),
    check(
      'payout_accounts_route_check',
      sql`(${t.method} = 'WALLET' and ${t.phone} is not null and ${t.bankCode} is null)
          or (${t.method} <> 'WALLET' and ${t.bankCode} is not null and ${t.phone} is null and ${t.mUId} is null)`,
    ),
    check('payout_accounts_declared_name_check', sql`length(trim(${t.declaredName})) > 0`),
    check(
      'payout_accounts_last4_check',
      sql`${t.accountNoLast4} is null or length(${t.accountNoLast4}) <= 4`,
    ),
    check(
      'payout_accounts_verified_at_check',
      sql`(${t.verifyStatus} = 'unverified') = (${t.verifiedAt} is null)`,
    ),
  ],
);

/**
 * One row per (bill, attempt). `partner_order_id` is ZaloPay's server-side
 * idempotency key (Part 0, F3) and is computed by `payout_attempts_guard`
 * (0012) as `'PO-' || bill_id || '-' || attempt_seq`; the application never
 * supplies it. The same trigger computes `attempt_seq`, refuses a new attempt
 * while the last one is not `failed`, refuses an amount that is not the bill's
 * whole-dong total, refuses an account that ZaloPay has not verified (in
 * either mode), refuses a bank transfer outside ZaloPay's limits, holds
 * the state machine's edges, writes evidence once, and refuses DELETE.
 * `payout_attempts_pending_resolved` keeps `pending_zlp` for an operator with
 * a typed reason, and `payout_attempts_by_finance` (0013) keeps every INSERT
 * for the finance role.
 *
 * `amount_vnd` is whole dong as a bigint; `mode: 'number'` is safe because a
 * payout above 2^53 dong is not a number this table will ever hold.
 */
export const payoutAttempts = pgTable(
  'payout_attempts',
  {
    id: uuid('id').primaryKey(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id),
    payoutAccountId: uuid('payout_account_id')
      .notNull()
      .references(() => payoutAccounts.id),
    /** Computed by the trigger. Declared not-null because it is, once inserted. */
    partnerOrderId: text('partner_order_id').notNull(),
    /** Computed by the trigger. */
    attemptSeq: integer('attempt_seq').notNull(),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    zlpOrderId: text('zlp_order_id'),
    zpTransId: text('zp_trans_id'),
    subReturnCode: integer('sub_return_code'),
    /** Required when mode = 'manual'. */
    manualReference: text('manual_reference'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    pollCount: integer('poll_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    unique('payout_attempts_partner_order_key').on(t.partnerOrderId),
    unique('payout_attempts_bill_seq_key').on(t.billId, t.attemptSeq),
    index('payout_attempts_polling_idx')
      .on(t.status, t.lastPolledAt)
      .where(sql`${t.status} in ('submitted', 'processing', 'unknown')`),
    check('payout_attempts_amount_positive_check', sql`${t.amountVnd} > 0`),
    check('payout_attempts_mode_check', sql`${t.mode} in ('manual', 'api')`),
    check(
      'payout_attempts_status_check',
      sql`${t.status} in ('created', 'submitted', 'processing', 'pending_zlp', 'succeeded', 'failed', 'unknown')`,
    ),
    check(
      'payout_attempts_manual_reference_check',
      sql`${t.mode} <> 'manual' or length(trim(coalesce(${t.manualReference}, ''))) > 0`,
    ),
    check('payout_attempts_poll_count_check', sql`${t.pollCount} >= 0`),
  ],
);

/**
 * What the payout side tells the risk engine, and what its workers did.
 * Append-only (`payout_events_append_only`, 0012). Agent C reads `kind` and
 * `evidence`; the kinds this side writes are listed in
 * `packages/api/src/payout/domain/events.ts`.
 */
export const payoutEvents = pgTable(
  'payout_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    collectorId: uuid('collector_id').references(() => collectors.id),
    payoutAccountId: uuid('payout_account_id').references(() => payoutAccounts.id),
    billId: uuid('bill_id').references(() => bills.id),
    payoutAttemptId: uuid('payout_attempt_id').references(() => payoutAttempts.id),
    evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payout_events_collector_idx').on(t.collectorId, t.occurredAt.desc()),
    index('payout_events_bill_idx').on(t.billId, t.occurredAt.desc()),
    index('payout_events_kind_idx').on(t.kind, t.occurredAt.desc()),
    check('payout_events_kind_check', sql`length(trim(${t.kind})) > 0`),
  ],
);

/**
 * Every export finance was handed, with the hash of the whole file, and one
 * row per bill with the hash of its line — so the file that comes back can be
 * proved to be the file that went out. Beside `bills` rather than on it,
 * because `bills` is frozen by 0011 and is not this slice's table to widen.
 * Append-only, and sealed: rows join an export only in the transaction that
 * creates it (`payout_export_rows_sealed`), and the count must match at
 * commit (`payout_exports_complete`).
 */
export const payoutExports = pgTable(
  'payout_exports',
  {
    id: uuid('id').primaryKey(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    fileHash: text('file_hash').notNull(),
    rowCount: integer('row_count').notNull(),
    exportedAt: timestamp('exported_at', { withTimezone: true }).notNull().defaultNow(),
    exportedBy: uuid('exported_by')
      .notNull()
      .references(() => operators.id),
  },
  (t) => [
    index('payout_exports_period_idx').on(t.periodStart, t.periodEnd, t.exportedAt.desc()),
    check('payout_exports_period_check', sql`${t.periodEnd} > ${t.periodStart}`),
  ],
);

export const payoutExportRows = pgTable(
  'payout_export_rows',
  {
    exportId: uuid('export_id')
      .notNull()
      .references(() => payoutExports.id),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id),
    rowHash: text('row_hash').notNull(),
  },
  (t) => [primaryKey({ name: 'payout_export_rows_pk', columns: [t.exportId, t.billId] })],
);

// ---------------------------------------------------------------------------
// Reconciliation (Agent F of the payout brief; migration 0015)

/**
 * One row per time this system asked whether the other side agrees with its
 * ledger: the daily query-txn run (`zalopay`), a bank or wallet statement
 * matched against manual attempts (`statement`), what the API rail would have
 * sent while the mode is manual (`shadow`), and that intention diffed against
 * what was actually paid (`shadow_diff`). Started once, finished once, never
 * deleted (`recon_runs_sealed`, 0015).
 */
export const reconRuns = pgTable(
  'recon_runs',
  {
    id: uuid('id').primaryKey(),
    /** The window as a label, `2026-08-17/2026-08-24`; the bounds are beside it. */
    period: text('period').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    source: text('source').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('recon_runs_source_idx').on(t.source, t.startedAt.desc()),
    check('recon_runs_source_check', sql`${t.source} in ('zalopay', 'statement', 'shadow', 'shadow_diff')`),
    check('recon_runs_period_check', sql`${t.periodEnd} > ${t.periodStart}`),
    check('recon_runs_finished_check', sql`${t.finishedAt} is null or ${t.finishedAt} >= ${t.startedAt}`),
  ],
);

/**
 * One discrepancy. What we say, what they say, and which of the eight kinds
 * it is. Written once (`recon_lines_append_only`); the one edit it ever takes
 * is its resolution, by an operator with the finance role and a typed reason,
 * proved against the audit trail at commit (`recon_lines_resolved_by_operator`).
 * No run, poll or script resolves a line — that is the whole point of the
 * table.
 */
export const reconLines = pgTable(
  'recon_lines',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconRuns.id),
    /** Null for a statement line that matched nothing of ours. */
    billId: uuid('bill_id').references(() => bills.id),
    payoutAttemptId: uuid('payout_attempt_id').references(() => payoutAttempts.id),
    partnerOrderId: text('partner_order_id'),
    /** The other side's name for it: a zlp order id, or a statement reference. */
    reference: text('reference'),
    ourStatus: text('our_status'),
    theirStatus: text('their_status'),
    ourAmount: bigint('our_amount', { mode: 'number' }),
    theirAmount: bigint('their_amount', { mode: 'number' }),
    /** When the other side says it happened: the statement line's date. Null for the ZaloPay kinds. */
    theirAt: timestamp('their_at', { withTimezone: true }),
    discrepancyKind: text('discrepancy_kind').notNull(),
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => operators.id),
    resolveReason: text('resolve_reason'),
  },
  (t) => [
    index('recon_lines_run_idx').on(t.runId),
    index('recon_lines_bill_idx').on(t.billId, t.raisedAt.desc()),
    index('recon_lines_open_idx')
      .on(t.discrepancyKind, t.raisedAt.desc())
      .where(sql`${t.resolvedAt} is null`),
    /**
     * One open line per discrepancy, held by the database so two runs at
     * once cannot raise and ticket it twice (F-44). The migration declares
     * it `NULLS NOT DISTINCT`, which drizzle cannot express on an index;
     * 0015/0016 are hand-written and are the authority. `their_amount` and
     * `their_at` are in the key so two statement lines under one bank
     * reference stay two discrepancies (0016).
     */
    uniqueIndex('recon_lines_open_key')
      .on(t.discrepancyKind, t.payoutAttemptId, t.billId, t.partnerOrderId, t.reference, t.theirAmount, t.theirAt)
      .where(sql`${t.resolvedAt} is null`),
    check(
      'recon_lines_kind_check',
      sql`${t.discrepancyKind} in ('WE_SAY_PAID_THEY_DONT', 'THEY_SAY_PAID_WE_DONT', 'AMOUNT_MISMATCH', 'ORPHAN_AT_ZLP', 'STALE_PROCESSING', 'STUCK_PENDING', 'SHADOW_UNPAID', 'SHADOW_UNINTENDED')`,
    ),
    /** All three or none, spelled out: an open line carries no reason (F-43). */
    check(
      'recon_lines_resolution_check',
      sql`(${t.resolvedAt} is null and ${t.resolvedBy} is null and ${t.resolveReason} is null)
          or (${t.resolvedAt} is not null and ${t.resolvedBy} is not null and length(trim(coalesce(${t.resolveReason}, ''))) > 0)`,
    ),
    check(
      'recon_lines_amount_check',
      sql`(${t.ourAmount} is null or ${t.ourAmount} >= 0) and (${t.theirAmount} is null or ${t.theirAmount} >= 0)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// The risk engine (migration 0014). Advisory, explainable, append-only,
// versioned. It writes these three tables and nothing else; it never writes
// bills, bill_lines, settlements, payout_attempts or collectors, and the
// `playerone_risk` role created in 0014 is what makes that a property of the
// database rather than of one process. The triggers, the two views and the
// role are in `0014_risk.sql`; drizzle cannot express any of them.

/**
 * The signal catalogue, versioned by row. One current row per signal
 * (`risk_signals_current_key`, partial on `superseded_at is null`); a retune
 * supersedes the row and inserts a new `threshold_version`, never edits in
 * place (`risk_signals_supersede_only`). Bands are rows too, family 'BAND',
 * with the band's lower edge in `default_points`.
 */
export const riskSignals = pgTable(
  'risk_signals',
  {
    signalId: text('signal_id').notNull(),
    thresholdVersion: text('threshold_version').notNull(),
    family: text('family').notNull(),
    description: text('description').notNull(),
    defaultPoints: integer('default_points').notNull(),
    defaultSeverity: text('default_severity').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Every threshold a detector reads. On the row a flag cites, forever. */
    params: jsonb('params').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'risk_signals_pkey', columns: [t.signalId, t.thresholdVersion] }),
    uniqueIndex('risk_signals_current_key')
      .on(t.signalId)
      .where(sql`${t.supersededAt} is null`),
    check(
      'risk_signals_family_check',
      sql`${t.family} in ('IDENT', 'VOL', 'CONT', 'PROV', 'OPS', 'BAND', 'META')`,
    ),
    check(
      'risk_signals_severity_check',
      sql`${t.defaultSeverity} in ('info', 'notice', 'review', 'hold')`,
    ),
    check('risk_signals_points_check', sql`${t.defaultPoints} between 0 and 100`),
    check('risk_signals_id_shape_check', sql`${t.signalId} ~ '^[A-Z]+\\.[A-Z0-9_]+$'`),
    check('risk_signals_version_check', sql`length(trim(${t.thresholdVersion})) > 0`),
    /** The lowest-weight signal is capped at the catalogue; no retune lifts it. */
    check(
      'risk_signals_synthetic_cap_check',
      sql`${t.signalId} <> 'PROV.SYNTHETIC_HEURISTIC' or ${t.defaultSeverity} in ('info', 'notice')`,
    ),
  ],
);

/**
 * One finding, from one evaluation run, about one subject. Never edited
 * (`risk_flags_append_only`). `run_id` groups a run; every run also writes a
 * META.EVALUATED row so the latest run is identifiable even when it found
 * nothing, which is how a flag falls away. The composite FK to `risk_signals`
 * is the explainability guarantee: the exact points and thresholds that judged
 * this flag are reachable from the row for as long as the row exists.
 */
export const riskFlags = pgTable(
  'risk_flags',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Insertion order: what "the latest run" means. `computed_at` is the engine's clock, for the explanation. */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    runId: uuid('run_id').notNull(),
    subjectType: text('subject_type').notNull(),
    /** text: collectors, episodes and bills are uuids; a batch is a period. */
    subjectId: text('subject_id').notNull(),
    signalId: text('signal_id').notNull(),
    thresholdVersion: text('threshold_version').notNull(),
    points: integer('points').notNull(),
    severity: text('severity').notNull(),
    /** Human-readable in the console: the numbers the sentence is built from. */
    evidence: jsonb('evidence').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.signalId, t.thresholdVersion],
      foreignColumns: [riskSignals.signalId, riskSignals.thresholdVersion],
      name: 'risk_flags_signal_fk',
    }),
    index('risk_flags_subject_idx').on(t.subjectType, t.subjectId, t.seq.desc()),
    index('risk_flags_run_idx').on(t.runId),
    index('risk_flags_signal_idx').on(t.signalId, t.computedAt.desc()),
    check(
      'risk_flags_subject_type_check',
      sql`${t.subjectType} in ('collector', 'episode', 'bill', 'batch')`,
    ),
    check('risk_flags_severity_check', sql`${t.severity} in ('info', 'notice', 'review', 'hold')`),
    check('risk_flags_points_check', sql`${t.points} between 0 and 100`),
    check('risk_flags_evidence_object_check', sql`jsonb_typeof(${t.evidence}) = 'object'`),
    check(
      'risk_flags_synthetic_cap_check',
      sql`${t.signalId} <> 'PROV.SYNTHETIC_HEURISTIC' or ${t.severity} in ('info', 'notice')`,
    ),
  ],
);

/**
 * A reversible hold on a bill, as a chain of rows: a raise, then a clear that
 * copies the raise's identity and adds who, when, a typed reason and a
 * verdict. `risk_holds_chain_guard` (0014) refuses a clear with no open hold
 * and a second open hold over one already open; `risk_holds_append_only`
 * refuses UPDATE and DELETE. `risk_current_holds` is the view the payout side
 * reads. `signal_ids` is what the operator saw when they cleared it, and the
 * engine re-holds only on a signal that was not in it.
 */
export const riskHolds = pgTable(
  'risk_holds',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id),
    raisedByFlag: uuid('raised_by_flag')
      .notNull()
      .references(() => riskFlags.id),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    signalIds: text('signal_ids').array().notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    clearedBy: uuid('cleared_by').references(() => operators.id),
    clearReason: text('clear_reason'),
    /** What the false-positive report counts: only 'false_positive' is a mark against the thresholds. */
    clearVerdict: text('clear_verdict'),
  },
  (t) => [
    index('risk_holds_bill_idx').on(t.billId, t.raisedAt.desc(), t.clearedAt.desc().nullsLast()),
    /** A set: at least one signal, none twice. The chain guard in 0014 makes a clear carry the raise's set exactly. */
    check('risk_holds_signal_ids_check', sql`risk_is_signal_set(${t.signalIds})`),
    check(
      'risk_holds_clear_shape_check',
      sql`(${t.clearedAt} is null and ${t.clearedBy} is null and ${t.clearReason} is null and ${t.clearVerdict} is null)
          or (${t.clearedAt} is not null and ${t.clearedBy} is not null
              and length(trim(${t.clearReason})) >= 10
              and ${t.clearVerdict} in ('false_positive', 'accepted', 'resolved')
              and ${t.clearedAt} >= ${t.raisedAt})`,
    ),
  ],
);
