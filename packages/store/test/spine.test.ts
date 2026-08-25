import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DISCREPANCY_CODES } from '@playerone/contracts';
import { DEFECT_CATALOGUE, REVIEW_REASON_CATALOGUE, seedCatalogues } from '../src/catalogue.ts';
import { closeDb, db, hasDb, truncate, violates, useDatabase } from './db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('spine');

/**
 * The spine, tested the way the invariants are written: in SQL, against the
 * database, with no application code in the path.
 *
 * That is the point of putting them in the schema. An invariant enforced in
 * TypeScript is enforced for callers who go through TypeScript; PLT-04's
 * traceability and QR-03's ceiling have to hold against a psql session, a
 * migration script and a future service written by somebody else.
 */

const uid = () => randomUUID();

/** Minimal rows to hang an episode off. Returns the ids a test needs. */
async function seedSpine() {
  const d = await db();
  const ids = {
    task: uid(),
    collector: uid(),
    deviceType: uid(),
    device: uid(),
    scenario: uid(),
    centre: uid(),
    uploadDevice: uid(),
    operator: uid(),
    handover: uid(),
    batch: uid(),
    session: uid(),
  };
  await d.execute(sql`
    insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
      values (${ids.task}, 'housework', 1200.0000, 5, 'published');
  `);
  await d.execute(sql`
    insert into collectors (id, external_ref, status)
      values (${ids.collector}, 'collector-0001', 'qualified');
  `);
  await d.execute(sql`
    insert into device_types (id, code, generation)
      values (${ids.deviceType}, 'ego_headset', 'gen1');
  `);
  await d.execute(sql`
    insert into devices (id, device_type_id, hardware_serial, status)
      values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active');
  `);
  await d.execute(sql`
    insert into scenarios (id, code, privacy_risk_level)
      values (${ids.scenario}, 'home', 'low');
  `);
  await d.execute(sql`
    insert into upload_centres (id, region, name, status)
      values (${ids.centre}, 'HCM', 'District 7 centre', 'active');
  `);
  await d.execute(sql`
    insert into upload_devices (id, upload_centre_id, machine_identifier, status)
      values (${ids.uploadDevice}, ${ids.centre}, 'HCM-IMPORT-01', 'active');
  `);
  await d.execute(sql`
    insert into operators (id, upload_centre_id, external_ref, role)
      values (${ids.operator}, ${ids.centre}, 'op-01', 'centre_operator');
  `);
  await d.execute(sql`
    insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
      values (${ids.handover}, ${ids.collector}, ${ids.device}, 'CARD-0001', ${ids.centre}, ${ids.operator}, now());
  `);
  await d.execute(sql`
    insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status)
      values (${ids.batch}, ${ids.handover}, ${ids.uploadDevice}, now(), 'importing');
  `);
  await d.execute(sql`
    insert into collection_sessions
      (id, handover_id, task_id, collector_id, scenario_id, others_in_frame,
       sensitive_info_present, session_origin)
      values (${ids.session}, ${ids.handover}, ${ids.task}, ${ids.collector}, ${ids.scenario},
              false, false, 'handover');
  `);
  await d.execute(sql`
    insert into collection_session_devices (collection_session_id, device_id, role)
      values (${ids.session}, ${ids.device}, 'headset');
  `);
  return ids;
}

/** An episode plus one ingest, in whatever resolution state the test wants. */
async function seedEpisode(opts: { sessionId?: string; measured: string; batchId?: string }) {
  const d = await db();
  const episodeId = uid();
  const ingestId = uid();
  const resolved = opts.sessionId !== undefined;
  await d.execute(sql`
    insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at,
                          ingest_count, collection_session_id, upload_batch_id, resolution_state, upload_path)
      values (${episodeId}, 'AZER76400FE', '20260813_072310', now(), now(), 1,
              ${opts.sessionId ?? null}, ${opts.batchId ?? null},
              ${resolved ? 'resolved' : 'quarantined'}, 'C');
  `);
  await d.execute(sql`
    insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename,
                                 measured_duration_s, timing_source, timing_confidence, manifest_present,
                                 engine_version, host, ingested_at, record_json)
      values (${ingestId}, ${episodeId}, repeat('a', 64), 'ok', 'ego_AZER76400FE_20260813_072310',
              ${opts.measured}, 'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb);
  `);
  return { episodeId, ingestId };
}

describe.skipIf(!hasDb())('the identity spine', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  // -- PLT-05: exactly two resolution states --------------------------------

  describe('PLT-05: an episode is resolved or quarantined, never a third thing', () => {
    it('accepts an episode resolved to a session', async () => {
      const ids = await seedSpine();
      const ep = await seedEpisode({ sessionId: ids.session, measured: '8.500000', batchId: ids.batch });
      expect(ep.episodeId).toBeTruthy();
    });

    it('accepts an unattributable episode as quarantined', async () => {
      await seedSpine();
      const ep = await seedEpisode({ measured: '8.500000' });
      expect(ep.episodeId).toBeTruthy();
    });

    it('refuses "resolved" with no session — the state §4.3 says must not exist', async () => {
      await seedSpine();
      const d = await db();
      await violates('episodes_resolution_check', d.execute(sql`
          insert into episodes (episode_id, device_serial, session_started_at, first_seen_at,
                                last_seen_at, resolution_state, collection_session_id)
            values (${uid()}, 'X', '20260813_072310', now(), now(), 'resolved', null);
        `));
    });

    it('refuses "quarantined" that still points at a session', async () => {
      const ids = await seedSpine();
      const d = await db();
      await violates('episodes_resolution_check', d.execute(sql`
          insert into episodes (episode_id, device_serial, session_started_at, first_seen_at,
                                last_seen_at, resolution_state, collection_session_id)
            values (${uid()}, 'X', '20260813_072310', now(), now(), 'quarantined', ${ids.session});
        `));
    });

    it('has no third state to reach for', async () => {
      await seedSpine();
      const d = await db();
      await violates('episodes_resolution_check', d.execute(sql`
          insert into episodes (episode_id, device_serial, session_started_at, first_seen_at,
                                last_seen_at, resolution_state, collection_session_id)
            values (${uid()}, 'X', '20260813_072310', now(), now(), 'pending', null);
        `));
    });
  });

  // -- QR-03: effective duration cannot exceed measured ---------------------

  /**
   * Every insert below carries a `verdict_id` it does not otherwise care about.
   * `episode_reviews_verdict_id_check` requires one on any row that is not
   * pending: a decided review has to name the request that decided it, because
   * that id is what makes a retried commit return the first answer rather than
   * write a second review and a second payment. These tests are about other
   * constraints; the column is here so they reach them.
   */
  describe('QR-03: effective duration cannot exceed what was measured', () => {
    it('rejects an over-long effective duration in raw SQL, with no application in the path', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_effective_le_measured_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', '8.500001', 'partial_pass', now(), ${uid()});
        `));
    });

    it('accepts an effective duration at exactly the measured value', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', '8.500000', 'pass', now(), ${uid()});
      `);
      const rows = await d.execute(sql`select count(*)::int as n from episode_reviews`);
      expect((rows as unknown as { n: number }[])[0]!.n).toBe(1);
    });

    it('refuses a review that misstates the measured duration it is judging', async () => {
      // The composite FK is what stops the QR-03 ceiling being raised by lying
      // about the ceiling.
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_ingest_fk', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${episodeId}, ${ingestId}, '9999.000000', '9000.000000', 'pass', now(), ${uid()});
        `));
    });

    it('refuses a review attached to an ingest from a different episode', async () => {
      const ids = await seedSpine();
      const a = await seedEpisode({ sessionId: ids.session, measured: '8.500000' });
      const b = await seedEpisode({ measured: '20.980044' });
      const d = await db();
      await violates('episode_reviews_ingest_fk', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${a.episodeId}, ${b.ingestId}, '20.980044', '1.000000', 'pass', now(), ${uid()});
        `));
    });

    it('QR-05: bounds the priority below the API, not only inside it', async () => {
      /**
       * The queue is ordered by this column. One row carrying `2^31-1` sits at
       * the head of every lane until somebody notices; one carrying the minimum
       * is buried under everything that will ever arrive. The request parser
       * bounds it too, and this is the half a `psql` session cannot skip.
       */
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_priority_range_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       review_state, priority)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pending', 2147483647);
        `));
      // And a stopwatch cannot run backwards, for the same reason: it is the
      // input to a number about a person's pace.
      await violates('episode_reviews_time_to_verdict_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       review_state, effective_duration_s, verdict_id,
                                       reviewed_at, time_to_verdict_s)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pass', '8.500000',
                    ${uid()}, now(), -1);
        `));
    });

    it('QR-05: refuses an assignment to somebody who is not an operator', async () => {
      /**
       * An assignment is the one column on this row that can make an episode
       * invisible to everybody at once: the queue offers an assigned review to
       * its assignee and to nobody else, so a typed or stale id parks the
       * footage forever with nothing to see. That has to be a foreign key —
       * the id will be typed by a supervisor into a form, and nothing in the
       * service can tell a wrong uuid from a right one.
       */
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_assignee_ref_operators_id_fk', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       review_state, assignee_ref)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pending', ${uid()});
        `));

      // A real operator is accepted. The identity is `operators.id` because that
      // is what a reviewer signs in with today; when reviewers get their own
      // role the parent moves and this test moves with it.
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     review_state, assignee_ref)
          values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pending', ${ids.operator});
      `);
      const rows = (await d.execute(
        sql`select count(*)::int as n from episode_reviews where assignee_ref = ${ids.operator}`,
      )) as unknown as { n: number }[];
      expect(rows[0]!.n).toBe(1);
    });

    it('requires a failed review to be worth nothing (§6.9)', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_fail_is_zero_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', '4.000000', 'fail', now(), ${uid()});
        `));
    });
  });

  // -- SET-02: settlement cannot be reached from an upload ------------------

  describe('SET-02: upload success cannot reach a settlement', () => {
    it('has no foreign key from settlements to episodes, ingests or batches', async () => {
      const d = await db();
      const rows = (await d.execute(sql`
        select ccu.table_name as target
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
        where tc.table_name = 'settlements' and tc.constraint_type = 'FOREIGN KEY'
      `)) as unknown as { target: string }[];

      const targets = new Set(rows.map((r) => r.target));
      // The only route to an episode is through a review. An upload event has
      // nothing here it could possibly write against.
      expect(targets).not.toContain('episodes');
      expect(targets).not.toContain('episode_ingests');
      expect(targets).not.toContain('upload_batches');
      expect(targets).toContain('episode_reviews');
    });

    it('cannot bill one review twice', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      const reviewId = uid();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${reviewId}, ${episodeId}, ${ingestId}, '8.500000', '8.500000', 'pass', now(), ${uid()});
      `);
      const bill = (id: string) => sql`
        insert into settlements (id, episode_review_id, task_id, unit_price, effective_minutes,
                                 amount, settlement_state)
          values (${id}, ${reviewId}, ${ids.task}, '1200.0000', '0.141667', '170.0000', 'pending_settlement');
      `;
      await d.execute(bill(uid()));
      await violates('settlements_review_key', d.execute(bill(uid())));
    });
  });

  // -- P2-01 / APP-17b ------------------------------------------------------

  describe('the session binds devices as a set, and records both declarations', () => {
    it('refuses a session that does not answer APP-17b', async () => {
      const ids = await seedSpine();
      const d = await db();
      // APP-17b is NOT NULL, so "we did not ask" is not a storable answer.
      await violates(
        'others_in_frame',
        d.execute(sql`
          insert into collection_sessions (id, handover_id, task_id, collector_id, scenario_id,
                                           others_in_frame, sensitive_info_present, session_origin)
            values (${uid()}, ${ids.handover}, ${ids.task}, ${ids.collector}, ${ids.scenario},
                    null, false, 'handover');
        `),
      );
    });

    it('holds devices in a join table, so phase 2 adds gloves without a migration', async () => {
      const ids = await seedSpine();
      const d = await db();
      const cols = (await d.execute(sql`
        select column_name from information_schema.columns
        where table_name = 'collection_sessions'
      `)) as unknown as { column_name: string }[];
      expect(cols.map((c) => c.column_name)).not.toContain('device_id');

      // Phase 1 allows exactly one; the constraint is one droppable index.
      await expect(
        d.execute(sql`
          insert into collection_session_devices (collection_session_id, device_id, role)
            values (${ids.session}, ${ids.device}, 'glove_left');
        `));
    });
  });

  // -- UPL-06 --------------------------------------------------------------

  it('UPL-06: a local cache cannot be cleaned before the cloud verified it', async () => {
    const ids = await seedSpine();
    const d = await db();
    await violates('upload_batches_cache_after_verify_check', d.execute(sql`
        update upload_batches set local_cache_cleaned_at = now() where id = ${ids.batch};
      `));

    await d.execute(sql`
      update upload_batches set cloud_verified_at = now(), batch_status = 'verified'
      where id = ${ids.batch};
    `);
    await d.execute(sql`
      update upload_batches set local_cache_cleaned_at = now(), batch_status = 'closed'
      where id = ${ids.batch};
    `);
  });

  // -- UPL-07 --------------------------------------------------------------

  it('UPL-07: a Path C episode traces to centre, machine, batch and handover', async () => {
    const ids = await seedSpine();
    const { episodeId } = await seedEpisode({
      sessionId: ids.session,
      measured: '8.500000',
      batchId: ids.batch,
    });
    const d = await db();
    const rows = (await d.execute(sql`
      select e.episode_id, b.id as batch, h.id as handover, ud.id as machine, uc.id as centre,
             t.id as task, c.id as collector, dev.id as device, s.id as scenario
      from episodes e
      join upload_batches b on b.id = e.upload_batch_id
      join handovers h on h.id = b.handover_id
      join upload_devices ud on ud.id = b.upload_device_id
      join upload_centres uc on uc.id = ud.upload_centre_id
      join collection_sessions cs on cs.id = e.collection_session_id
      join tasks t on t.id = cs.task_id
      join collectors c on c.id = cs.collector_id
      join scenarios s on s.id = cs.scenario_id
      join collection_session_devices csd on csd.collection_session_id = cs.id
      join devices dev on dev.id = csd.device_id
      where e.episode_id = ${episodeId}
    `)) as unknown as Record<string, string>[];

    // §4.3: exactly one of each, not "at least one".
    expect(rows).toHaveLength(1);
    expect(rows[0]!['centre']).toBe(ids.centre);
    expect(rows[0]!['handover']).toBe(ids.handover);
    expect(rows[0]!['machine']).toBe(ids.uploadDevice);
    expect(rows[0]!['task']).toBe(ids.task);
    expect(rows[0]!['collector']).toBe(ids.collector);
    expect(rows[0]!['device']).toBe(ids.device);
  });
});

describe.skipIf(!hasDb())('the catalogues', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('gives every defect the engine can emit a routing decision', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select code from defect_codes`,
    )) as unknown as { code: string }[];
    const known = new Set(rows.map((r) => r.code));

    // A new code with no decision would otherwise default to "reaches review"
    // by accident. This fails instead.
    for (const code of DISCREPANCY_CODES) expect(known, code).toContain(code);
    expect(known).toContain('SESSION-CONFLICT');
  });

  it('blocks only the defects that stop a human judging the episode', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select code from defect_codes where blocks_review`,
    )) as unknown as { code: string }[];
    const blocking = new Set(rows.map((r) => r.code));

    expect(blocking).toContain('MEDIA-MISSING');
    expect(blocking).toContain('MEDIA-TRUNCATED');

    // UPL-10 and UPL-12: an unclosed session, stale statistics and a zero-byte
    // PTS file are flagged and kept. 073055 is 458 MB of good video behind
    // exactly these, and blocking them would make that footage unpayable.
    expect(blocking).not.toContain('SESSION-UNCLOSED');
    expect(blocking).not.toContain('STATS-STALE');
    expect(blocking).not.toContain('PTS-EMPTY');
    expect(blocking).not.toContain('TIMING-ESTIMATED');
    expect(blocking).not.toContain('CHECKSUM-MISMATCH');

    // Open question for the product owner, seeded permissive. If this flips,
    // it flips deliberately and this line is what says so.
    expect(blocking).not.toContain('CALIB-MISSING');
  });

  it('withholds no settlement by default, pending the product owner on CALIB-MISSING', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select count(*)::int as n from defect_codes where suppresses_settlement`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });

  it('localises every review reason for the collector and the reviewer', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(sql`
      select count(*)::int as total,
             count(*) filter (where label_vi is null or label_zh is null)::int as untranslated
      from review_reason_codes
    `)) as unknown as { total: number; untranslated: number }[];
    // LOC-04 for the collector, LOC-02 for PaXini's reviewers.
    expect(rows[0]!.total).toBe(REVIEW_REASON_CATALOGUE.length);
    expect(rows[0]!.untranslated).toBe(0);
  });

  it('is idempotent, so re-seeding is how routing gets re-tuned', async () => {
    const d = await db();
    await seedCatalogues(d);
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select count(*)::int as n from defect_codes`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(DEFECT_CATALOGUE.length);
  });

  /**
   * §6.9's own note: build the reason codes configurable rather than hard-coded,
   * because PaXini said on 13 Aug the in-the-wild standard does not exist yet
   * and will be rewritten during the pilot.
   *
   * Configurable means an operator's UPDATE survives a restart. It did not: the
   * boot-time seed upserted the labels back over it, which is the worse failure
   * of the two — nothing errors, and the pilot's own tuning quietly reverts to
   * whatever was compiled in.
   */
  it('leaves an operator edit alone, because the review standard is theirs to rewrite', async () => {
    const d = await db();
    await seedCatalogues(d);
    await d.execute(sql`
      update review_reason_codes
         set label_en = 'Lens blocked by clothing', category = 'visual', active = false
       where code = 'VQ-OCCLUSION'
    `);

    await seedCatalogues(d);

    const rows = (await d.execute(sql`
      select label_en, category, active from review_reason_codes where code = 'VQ-OCCLUSION'
    `)) as unknown as { label_en: string; category: string; active: boolean }[];
    expect(rows[0]!.label_en).toBe('Lens blocked by clothing');
    expect(rows[0]!.category).toBe('visual');
    // Retiring a code is how the taxonomy shrinks. The row stays, so the
    // reviews already citing it still render.
    expect(rows[0]!.active).toBe(false);

    // A code the deployment does not have yet still arrives with a release.
    const all = (await d.execute(
      sql`select count(*)::int as n from review_reason_codes`,
    )) as unknown as { n: number }[];
    expect(all[0]!.n).toBe(REVIEW_REASON_CATALOGUE.length);
  });

  /**
   * QR-01 and QR-04 both rest on a decided review still being able to name why.
   * The taxonomy is editable, so the question is what an edit can do to the
   * reviews that already cite it — and the answer has to be a foreign key,
   * because the edit will be typed into psql by somebody who has never read
   * this repository.
   */
  it('cannot orphan a past review, however the taxonomy is edited', async () => {
    const d = await db();
    await seedCatalogues(d);
    const ids = await seedSpine();
    const { episodeId, ingestId } = await seedEpisode({ sessionId: ids.session, measured: '60.000000' });
    const reviewId = uid();
    await d.execute(sql`
      insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, review_state,
                                   effective_duration_s, verdict_id, reviewed_at)
        values (${reviewId}, ${episodeId}, ${ingestId}, '60.000000', 'fail', 0, ${uid()}, now());
    `);
    await d.execute(sql`
      insert into episode_review_reasons (review_id, code) values (${reviewId}, 'VQ-DARK');
    `);

    // Deactivating and relabelling: the picker loses the code, the verdict does not.
    await d.execute(sql`
      update review_reason_codes set active = false, label_en = 'Underexposed' where code = 'VQ-DARK'
    `);
    const joined = (await d.execute(sql`
      select r.code, c.label_en, c.active
        from episode_review_reasons r
        join review_reason_codes c on c.code = r.code
       where r.review_id = ${reviewId}
    `)) as unknown as { code: string; label_en: string; active: boolean }[];
    expect(joined).toHaveLength(1);
    expect(joined[0]!.label_en).toBe('Underexposed');
    expect(joined[0]!.active).toBe(false);

    // Deleting it is the edit that would orphan the verdict, so the database
    // refuses it. Not a rule in the service: this is a psql session.
    await violates(
      'episode_review_reasons_code_review_reason_codes_code_fk',
      d.execute(sql`delete from review_reason_codes where code = 'VQ-DARK'`),
    );

    // Renaming the primary key is the same edit wearing a different hat.
    await violates(
      'episode_review_reasons_code_review_reason_codes_code_fk',
      d.execute(sql`update review_reason_codes set code = 'VQ-UNDEREXPOSED' where code = 'VQ-DARK'`),
    );
  });
});
