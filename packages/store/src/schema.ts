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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('collectors_external_ref_key').on(t.externalRef),
    check(
      'collectors_status_check',
      sql`${t.status} in ('pending', 'qualified', 'suspended')`,
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_hardware_serial_key').on(t.hardwareSerial),
    check('devices_status_check', sql`${t.status} in ('active', 'faulty', 'retired')`),
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
 *
 * `collector_id` and `currency` are copied for the same reason, and it is the
 * same reason twice. Who is owed and in what unit are facts about the moment
 * the verdict was committed, not about the state of the world when finance runs
 * the cycle. Read live, the payee would come back through
 * `episode_reviews → episodes → collection_sessions → collectors`, so reassigning
 * a session after the fact would pay a different person for footage already
 * scored; and the unit would come back from `PLAYERONE_CURRENCY`, so changing
 * that environment variable would relabel every historic amount without
 * touching a number. Neither is reachable now: the settlement carries both.
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
    /** SET-04's payee, snapshot rather than joined. See the note above. */
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    /** What `unit_price` is denominated in, snapshot for the same reason. */
    currency: text('currency').notNull(),
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
      sql`${t.settlementState} in ('pending_review', 'pending_settlement', 'bill_generated', 'manually_paid', 'exception', 'not_payable')`,
    ),
    check('settlements_amount_nonneg_check', sql`${t.amount} >= 0`),
    /**
     * SET-01's terminal outcome, and the reason it is keyed on the amount.
     *
     * The review lane writes a settlement for every verdict, a `fail` included,
     * because that row is the score of the review and what a dispute over a
     * refused episode points at. Worth 0.0000, it can never reach a bill --
     * `bill_lines_membership_guard` refuses it a line -- so in
     * `pending_settlement` it would be simultaneously awaiting settlement and
     * unable to reach one, rescanned by every cycle for ever.
     *
     * `not_payable` is that outcome named, and it is terminal: the transition
     * guard gives it no outgoing edge and no incoming one either, so a zero row
     * must be *born* there and real money cannot be written off with an UPDATE.
     * The rule is the amount rather than the verdict on purpose -- a partial
     * pass whose every span was cut is also worth 0.0000.
     *
     * A biconditional, not an implication. `amount > 0 or state =
     * 'not_payable'` states only the half that is obvious, and leaves the
     * expensive half legal: the transition guard lets a row be *born*
     * `not_payable`, so a single INSERT could park a formula-valid positive
     * settlement in a terminal state, where nothing can move it and nothing can
     * change its amount. That is a real debt written off for ever by a
     * statement that broke no rule. Worth nothing and finished are one fact.
     */
    check(
      'settlements_zero_not_payable_check',
      sql`(${t.amount} = 0) = (${t.settlementState} = 'not_payable')`,
    ),
    /**
     * The money rule, as a row that cannot exist rather than as a function
     * nobody outside `money.ts` is obliged to call.
     *
     * `settlementFor` computes `amount` as `quantise(unit_price ×
     * effective_minutes, 4)` and CLAUDE.md pins that to exactly one site.
     * Postgres's `round(numeric, 4)` is half away from zero, which is
     * `quantise`'s rule, and both operands are exact decimals — so this CHECK
     * is the same arithmetic, and any writer that skips `money.ts` is refused.
     * Note it is the *quantised* product, not the raw one: 1 second at 1 a
     * minute stores `0.016667` minutes and `0.0167`, where the raw product is
     * `0.016667`. The raw equality does not hold and never did.
     */
    check(
      'settlements_amount_formula_check',
      sql`${t.amount} = round(${t.unitPrice} * ${t.effectiveMinutes}, 4)`,
    ),
    /** A negative price or a negative duration is not a discount, it is a bug. */
    check(
      'settlements_operands_nonneg_check',
      sql`${t.unitPrice} >= 0 and ${t.effectiveMinutes} >= 0`,
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
 * UPDATE trigger written by hand in `0005_settlement_lifecycle.sql` and
 * extended by `0006_settlement_lifecycle_guards.sql`; drizzle has no way to
 * declare a trigger, so the migrations are the source and this comment is the
 * pointer to them.
 *
 * The period is a parameter, not a constant: weekly is `[ASSUMED]` in the
 * brief's §13.2, so it is stored on every bill rather than implied by one.
 * `bills_collector_period_key` stops a *duplicate* period and nothing more —
 * `[17 Aug, 24 Aug)` and `[18 Aug, 25 Aug)` are different keys, both insertable,
 * and whichever generator ran first would decide which cycle a settlement was
 * paid in. Non-overlap is `bills_no_overlap`, an EXCLUDE constraint over the
 * half-open range in `0006_settlement_lifecycle_guards.sql`; drizzle cannot
 * emit EXCLUDE, so that file is the source and this is the pointer.
 *
 * `total` is stored and is the sum of the line amounts, and that sentence is a
 * constraint rather than a comment: `bills_total_matches_lines`, a DEFERRABLE
 * constraint trigger in `0006_settlement_lifecycle_guards.sql`, recomputes the sum at
 * commit and refuses the transaction if the header disagrees. Deferred because
 * the generator writes the header before the lines it is the sum of. Three more
 * guards in the same migration keep that sum meaningful: a settlement's `amount`
 * cannot change after it is written, a `bill_lines` row cannot be updated or
 * deleted, and a line's settlement must belong to the same collector and be
 * denominated in the same currency as the header. That is why `bill_lines`
 * carries no money of its own — there is exactly one place each figure lives.
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
    /**
     * A cycle begins at local midnight in Vietnam and nowhere else.
     *
     * The unique index above only stops a *duplicate* period. It cannot stop
     * two overlapping ones — `[17 Aug, 24 Aug)` and `[18 Aug, 25 Aug)` are
     * different keys, both insertable, and whichever generator ran first would
     * decide which cycle a settlement was paid in. Pinning both ends to local
     * midnight is what makes the cycles tile instead of overlap; `settle.ts`
     * additionally aligns the start to a fixed Monday anchor, and this is the
     * half of that contract a psql session cannot skip.
     *
     * `Asia/Ho_Chi_Minh` rather than a fixed `+07:00`: Vietnam has observed no
     * DST since 1975, so today they are the same, and naming the zone means a
     * future political change is the tz database's problem and not ours.
     */
    check(
      'bills_period_local_midnight_check',
      sql`${t.periodStart} = date_trunc('day', ${t.periodStart} at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
          and ${t.periodEnd} = date_trunc('day', ${t.periodEnd} at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'`,
    ),
  ],
);

/**
 * One settlement on one bill. The primary key is the settlement alone, so a
 * settlement that is already billed cannot be added to a second bill — double
 * payment is unrepresentable rather than guarded against.
 *
 * SET-01 makes payable settlements out of pass and partial-pass reviews only.
 * The review lane writes a settlement for a rejected episode too, worth 0.0000,
 * because that row is the score of the review; `bill_lines_membership_guard` in
 * `0006_settlement_lifecycle_guards.sql` is what keeps it off a bill, so a
 * refused episode cannot print a zero-value line. It is the *verdict* that
 * decides, with the amount as a second condition: checking only the amount let
 * raw SQL attach a formula-valid positive settlement to a failed review.
 *
 * The two foreign keys are independent, which on their own would let a line
 * attach one collector's settlement to another collector's bill and let a line
 * be moved or deleted after the header was totalled. `bill_lines_membership_guard`
 * closes both: it refuses a line whose settlement disagrees with the header on
 * collector or currency, and refuses every UPDATE and DELETE. Membership is
 * written once, which is what lets `bills.total` mean anything.
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
