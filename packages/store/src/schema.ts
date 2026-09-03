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
    check(
      'episodes_verification_check',
      sql`${t.verificationState} in ('pending', 'verified', 'failed')`,
    ),
    check(
      'episodes_resolution_method_check',
      sql`${t.resolutionMethod} is null
          or ${t.resolutionMethod} in ('automatic_single', 'automatic_time_window', 'manual')`,
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
    /**
     * A CACHE of `rep_score(id, rep_computed_at)`, and nothing more. Nothing
     * increments it: `rep_recompute` overwrites it from the `rep_events` fold,
     * so deleting both columns and rebuilding them yields the same numbers.
     * `the cached score is only ever a replay of the log` is the test that says
     * so, and the admin recompute endpoint is how an operator proves it on real
     * data.
     *
     * The gates do NOT read this column — `task_claims_guard` calls
     * `rep_score(...)` live, so a cache that is a day stale cannot decide who
     * may claim. This is here so that listing five hundred collectors is one
     * query rather than five hundred folds.
     *
     * 500 is the cold start the design names: a new collector is mid-ladder,
     * not zero, because a first review must not be a hundred-point coin flip.
     * The same 500 is the base inside `rep_score()`; the replay test is what
     * keeps the two from drifting.
     */
    repScore: integer('rep_score').notNull().default(500),
    repComputedAt: timestamp('rep_computed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('collectors_external_ref_key').on(t.externalRef),
    check('collectors_rep_score_check', sql`${t.repScore} between 0 and 1000`),
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
 * evidence behind a settlement dispute.
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
    check(
      'collection_sessions_origin_check',
      sql`${t.sessionOrigin} in ('handover', 'app', 'backoffice')`,
    ),
    /** A session reconstructed at the counter belongs to the card on the counter. */
    check(
      'collection_sessions_handover_required_check',
      sql`${t.sessionOrigin} <> 'handover' or ${t.handoverId} is not null`,
    ),
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

export const operators = pgTable(
  'operators',
  {
    id: uuid('id').primaryKey(),
    uploadCentreId: uuid('upload_centre_id')
      .notNull()
      .references(() => uploadCentres.id),
    externalRef: text('external_ref').notNull(),
    role: text('role').notNull(),
    /** scrypt, `N$salt$hash`. Never a secret at rest, never logged. */
    credentialHash: text('credential_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('operators_ref_key').on(t.uploadCentreId, t.externalRef)],
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
     * Who holds this review. On a pending row that is the current leaseholder;
     * on a decided row it is who decided. One column and not two, because a
     * lease that expires and is re-claimed transfers both facts at once — the
     * new claimant is the one who will decide — and two columns would raise a
     * "which is authoritative" question that has no useful answer.
     */
    reviewerRef: text('reviewer_ref'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
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
     * exact bytes it judged. Re-reviewing one delivery is the dispute flow,
     * which is P2 and deliberately not built; when it lands it needs a
     * supersedes column here rather than a second row, or this index moves.
     */
    uniqueIndex('episode_reviews_delivery_key').on(t.episodeId, t.ingestId),
    /**
     * The idempotency guarantee, at the database. Two concurrent requests
     * carrying the same `verdict_id` — a double-tap, or a retry racing the
     * original — cannot both write: one commits and the other is rejected here,
     * and the endpoint answers the loser with what the winner decided.
     */
    uniqueIndex('episode_reviews_verdict_key').on(t.verdictId),
    /**
     * The queue read, in one index: pending rows ordered by how long they have
     * waited, with the lease column alongside so reclaiming an expired lease is
     * the same scan and not a second one.
     */
    index('episode_reviews_queue_idx').on(t.reviewState, t.leaseExpiresAt, t.createdAt),
    check(
      'episode_reviews_state_check',
      sql`${t.reviewState} in ('pending', 'pass', 'partial_pass', 'fail')`,
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
    unitPrice: numeric('unit_price', { precision: 12, scale: 4, mode: 'string' }).notNull(),
    effectiveMinutes: numeric('effective_minutes', {
      precision: 20,
      scale: 6,
      mode: 'string',
    }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 4, mode: 'string' }).notNull(),
    settlementState: text('settlement_state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** SET-04: one settlement per review, so a verdict cannot be billed twice. */
    uniqueIndex('settlements_review_key').on(t.episodeReviewId),
    check(
      'settlements_state_check',
      sql`${t.settlementState} in ('pending_review', 'pending_settlement', 'bill_generated', 'manually_paid', 'exception')`,
    ),
    check('settlements_amount_nonneg_check', sql`${t.amount} >= 0`),
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
    uploadDeviceId: uuid('upload_device_id').references(() => uploadDevices.id),
    uploadCentreId: uuid('upload_centre_id').references(() => uploadCentres.id),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
  },
  (t) => [
    index('audit_events_target_idx').on(t.targetTable, t.targetId, t.occurredAt.desc()),
    index('audit_events_operator_idx').on(t.operatorId, t.occurredAt.desc()),
    /** An unattributed audit row defeats the table. Logins are the one case with no actor yet. */
    check(
      'audit_events_attributed_check',
      sql`${t.action} like '%.login'
          or (${t.operatorId} is not null and ${t.uploadDeviceId} is not null)`,
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
// Reputation and achievements (§6.14, and the design record in docs/reputation.md)

/**
 * What each kind of reputation event is worth, as rows.
 *
 * Rows and not a TypeScript constant for the same reason `review_reason_codes`
 * is a table: every weight in the design is a STARTING VALUE and the pilot is
 * expected to retune all of them. A retune has to be an UPDATE somebody runs,
 * not a deployment.
 *
 * The weight is copied onto `rep_events.points` when the event is written, by
 * `rep_events_points` (migration 0013) — the same rule `settlements` follows
 * for `unit_price`. Retuning changes what future events are worth; it does not
 * silently rewrite what a collector was already scored on.
 *
 * Three kinds are seeded and cannot yet be written, because the rows they would
 * point at do not exist on any branch: `commitment_kept`, `commitment_abandoned`
 * (the APP-10/APP-11 claim target) and `device_fault_attributed` (the BO-04
 * fault record). They are here so the shape is agreed before the branch that
 * builds them lands, and they score zero until it does.
 */
export const repEventKinds = pgTable('rep_event_kinds', {
  kind: text('kind').primaryKey(),
  /** Signed. Negative is a penalty; zero is a fact that deliberately moves nothing. */
  points: integer('points').notNull(),
  description: text('description').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The reputation log. Append-only, and the only thing a score is made of.
 *
 * `rep_score(collector, at)` is a fold over these rows and nothing else — no
 * counter is incremented anywhere, so the cache on `collectors` can be thrown
 * away and rebuilt to the same number. That property is what the recompute
 * endpoint and its test exist to prove.
 *
 * **Every row is backed by a row somewhere else.** Four nullable foreign keys,
 * and `rep_events_source_check` requires exactly one of them — except for
 * `exam_passed`, whose source IS the collector row this event already names by
 * a NOT NULL foreign key. There is no free-floating reputation: nothing here
 * can be written about a fact that did not happen in another table.
 *
 * **One event per kind per source row**, which is where idempotency comes from.
 * A reviewer double-taps commit; `episode_reviews_verdict_key` already refuses
 * the second verdict, and `rep_events_source_key` refuses the second reputation
 * event even if some future path forgets. A retry cannot double-count.
 *
 * `rep_events_batch_key` is stricter still: one event per upload batch, of any
 * kind. A card's import either raised an integrity defect or it did not, and
 * both `card_clean` and `card_integrity_defect` landing against one batch would
 * be the engine paying and fining for the same fact.
 */
export const repEvents = pgTable(
  'rep_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    kind: text('kind')
      .notNull()
      .references(() => repEventKinds.kind),
    /**
     * Copied from the catalogue by a BEFORE INSERT trigger, never sent by a
     * caller. Frozen afterwards by `rep_events_append_only`: the score a
     * collector had last month has to still be explicable next month.
     */
    points: integer('points').notNull().default(0),
    /**
     * When the fact happened, which is not always when the row was written. The
     * 90-day window is measured against this, so a backfilled event ages
     * correctly rather than starting its life today.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    reviewId: uuid('review_id').references(() => episodeReviews.id),
    handoverId: uuid('handover_id').references(() => handovers.id),
    uploadBatchId: uuid('upload_batch_id').references(() => uploadBatches.id),
    settlementId: uuid('settlement_id').references(() => settlements.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rep_events_collector_idx').on(t.collectorId, t.occurredAt),
    check(
      'rep_events_source_check',
      sql`num_nonnulls(${t.reviewId}, ${t.handoverId}, ${t.uploadBatchId}, ${t.settlementId})
          = case when ${t.kind} = 'exam_passed' then 0 else 1 end`,
    ),
  ],
);

/**
 * The four tiers, as rows, because `min_score` is a starting value like
 * everything else in the design.
 *
 * `max_concurrent_claims` is the one unlock this branch enforces — the rest of
 * the `unlocks` column is prose for the console until the branches that own
 * those gates land. `task_claims_guard` (migration 0013) reads this column, so
 * retuning the cap is an UPDATE, not a deployment, and no route can forget it.
 *
 * `min_decided_reviews` and `min_handovers` are the evidence gate that sits ON
 * TOP of the score gate: a high score computed from four reviews is a small
 * sample, and the top two tiers unlock work that a small sample should not buy.
 */
export const repTiers = pgTable(
  'rep_tiers',
  {
    key: text('key').primaryKey(),
    /** 1 is the bottom. Ordering is by rank, never by `min_score`, so a retune cannot reorder the ladder. */
    rank: integer('rank').notNull(),
    minScore: integer('min_score').notNull(),
    minDecidedReviews: integer('min_decided_reviews').notNull().default(0),
    minHandovers: integer('min_handovers').notNull().default(0),
    maxConcurrentClaims: integer('max_concurrent_claims').notNull(),
    nameVi: text('name_vi').notNull(),
    nameEn: text('name_en').notNull(),
    nameZh: text('name_zh').notNull(),
    unlocks: text('unlocks').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rep_tiers_rank_key').on(t.rank),
    check('rep_tiers_min_score_check', sql`${t.minScore} >= 0 and ${t.minScore} <= 1000`),
    check('rep_tiers_claims_check', sql`${t.maxConcurrentClaims} > 0`),
  ],
);

/**
 * The badge catalogue, as rows.
 *
 * `metric` names a key in `rep_metrics(collector)` and `threshold` is what it
 * has to reach. That pair IS the criteria language, and it is deliberately the
 * whole of it: twenty-nine badges reduce to nineteen counters, and a counter
 * with a number beside it is something an operator can retune during the pilot
 * without anybody writing SQL.
 *
 * ponytail: threshold on a named metric, not a general expression language. The
 * ceiling is a badge whose criteria are not monotonic in one number — "three
 * scenarios in one week" needs two. When one arrives it becomes another key in
 * `rep_metrics`, not a parser here.
 *
 * `criteria` and `source_events` are the design record's own words, carried so
 * the console can explain a badge without a second copy of the catalogue.
 */
export const badgeDefinitions = pgTable(
  'badge_definitions',
  {
    key: text('key').primaryKey(),
    /** No CHECK: the grouping is PaXini's, like `review_reason_codes.category`. */
    category: text('category').notNull(),
    tier: text('tier').notNull(),
    metric: text('metric').notNull(),
    threshold: numeric('threshold', { precision: 14, scale: 3, mode: 'string' }).notNull(),
    nameVi: text('name_vi').notNull(),
    nameEn: text('name_en').notNull(),
    nameZh: text('name_zh').notNull(),
    descVi: text('desc_vi').notNull(),
    descEn: text('desc_en').notNull(),
    descZh: text('desc_zh').notNull(),
    criteria: text('criteria').notNull(),
    sourceEvents: text('source_events').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('badge_definitions_category_idx').on(t.category),
    check('badge_definitions_tier_check', sql`${t.tier} in ('bronze', 'silver', 'gold')`),
    check('badge_definitions_threshold_check', sql`${t.threshold} > 0`),
  ],
);

/**
 * One award, once, forever.
 *
 * `badge_awards_collector_badge_key` is the once. `badge_awards_irrevocable`
 * (migration 0013) is the forever: UPDATE and DELETE are refused for every
 * writer, so there is no un-award path to be called by mistake or in anger. A
 * badge unlocks nothing — that is the design's reason for making awards
 * permanent — so a wrong award costs a note in `audit_events` and no privilege.
 *
 * `metric_value` is what the metric read at the moment of the award, and
 * `rep_event_id` is the event whose arrival triggered the evaluation. Together
 * they are why this row exists, which is the question asked about a badge that
 * looks wrong. `rep_event_id` is null when an administrator's recompute awarded
 * it rather than an event.
 */
export const badgeAwards = pgTable(
  'badge_awards',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    badgeKey: text('badge_key')
      .notNull()
      .references(() => badgeDefinitions.key),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
    repEventId: bigint('rep_event_id', { mode: 'number' }).references(() => repEvents.id),
    metricValue: numeric('metric_value', { precision: 14, scale: 3, mode: 'string' }).notNull(),
  },
  (t) => [uniqueIndex('badge_awards_collector_badge_key').on(t.collectorId, t.badgeKey)],
);
