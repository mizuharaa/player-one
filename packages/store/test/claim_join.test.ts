import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, hasDb, liveClaim, truncate, violates, useDatabase } from './db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('claim_join');

/**
 * Migration 0016: the claims -> sessions -> settlements join, in raw SQL with
 * no application in the path. Two collectors, two tasks, two centres and two
 * cards, because every shape here is about a row naming the WRONG one.
 */

const uid = () => randomUUID();

async function seed() {
  const d = await db();
  const ids = {
    taskA: uid(),
    taskB: uid(),
    collector1: uid(),
    collector2: uid(),
    deviceType: uid(),
    device1: uid(),
    device2: uid(),
    scenario: uid(),
    centreA: uid(),
    centreB: uid(),
    machineA: uid(),
    machineB: uid(),
    opA: uid(),
    opB: uid(),
    handover1: uid(),
    handover2: uid(),
  };
  await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
    values (${ids.taskA}, 'housework', 1200.0000, 5, 'published'), (${ids.taskB}, 'factory', 900.0000, 5, 'published')`);
  await d.execute(sql`insert into collectors (id, external_ref, status)
    values (${ids.collector1}, 'c-0001', 'qualified'), (${ids.collector2}, 'c-0002', 'qualified')`);
  await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego_headset', 'gen1')`);
  await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status)
    values (${ids.device1}, ${ids.deviceType}, 'AZER76400FE', 'active'), (${ids.device2}, ${ids.deviceType}, 'AZER76400FF', 'active')`);
  await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
  await d.execute(sql`insert into upload_centres (id, region, name, status)
    values (${ids.centreA}, 'HCM', 'District 7', 'active'), (${ids.centreB}, 'HAN', 'Cau Giay', 'active')`);
  await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status)
    values (${ids.machineA}, ${ids.centreA}, 'HCM-01', 'active'), (${ids.machineB}, ${ids.centreB}, 'HAN-01', 'active')`);
  await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role)
    values (${ids.opA}, ${ids.centreA}, 'op-hcm', 'centre_operator'), (${ids.opB}, ${ids.centreB}, 'op-han', 'centre_operator')`);
  await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
    values (${ids.handover1}, ${ids.collector1}, ${ids.device1}, 'CARD-1', ${ids.centreA}, ${ids.opA}, now()),
           (${ids.handover2}, ${ids.collector2}, ${ids.device2}, 'CARD-2', ${ids.centreB}, ${ids.opB}, now())`);
  const claim1A = await liveClaim(d, ids.taskA, ids.collector1);
  const claim2A = await liveClaim(d, ids.taskA, ids.collector2);
  const claim1B = await liveClaim(d, ids.taskB, ids.collector1);
  return { ...ids, claim1A, claim2A, claim1B };
}

type Ids = Awaited<ReturnType<typeof seed>>;

const sessionInsert = (
  ids: Ids,
  opts: { id: string; handover: string; task: string; collector: string; claim: string | null; price?: string | null; currency?: string | null },
) => sql`
  insert into collection_sessions (id, handover_id, task_id, collector_id, scenario_id, others_in_frame,
                                   sensitive_info_present, session_origin, task_claim_id, unit_price, currency)
    values (${opts.id}, ${opts.handover}, ${opts.task}, ${opts.collector}, ${ids.scenario}, false, false, 'handover',
            ${opts.claim}, ${opts.price === undefined ? (opts.claim === null ? null : '1200.0000') : opts.price},
            ${opts.currency === undefined ? (opts.claim === null ? null : 'VND') : opts.currency})`;

/** A resolved episode on `sessionId`, with a decided review, ready for a settlement. */
async function reviewed(sessionId: string): Promise<string> {
  const d = await db();
  const episodeId = uid();
  const ingestId = uid();
  const reviewId = uid();
  await d.execute(sql`
    insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at, ingest_count,
                          collection_session_id, resolution_state, upload_path)
      values (${episodeId}, 'AZER76400FE', '20260813_072310', now(), now(), 1, ${sessionId}, 'resolved', 'C')`);
  await d.execute(sql`
    insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename, measured_duration_s,
                                 timing_source, timing_confidence, manifest_present, engine_version, host, ingested_at, record_json)
      values (${ingestId}, ${episodeId}, repeat('a', 64), 'ok', 'ego_AZER76400FE_20260813_072310', '60.000000',
              'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb)`);
  await d.execute(sql`
    insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, effective_duration_s, review_state, reviewed_at, verdict_id)
      values (${reviewId}, ${episodeId}, ${ingestId}, '60.000000', '60.000000', 'pass', now(), ${uid()})`);
  return reviewId;
}

const settlementInsert = (id: string, reviewId: string, task: string, claim: string | null) => sql`
  insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes, amount, settlement_state)
    values (${id}, ${reviewId}, ${task}, ${claim}, '1200.0000', '1.000000', '1200.0000', 'pending_settlement')`;

describe.skipIf(!hasDb())('the claim behind a session and a settlement (0016)', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  describe('collection_sessions', () => {
    it('accepts a session under its own collector’s claim on the declared task, with the snapshot', async () => {
      const ids = await seed();
      const d = await db();
      const id = uid();
      await d.execute(sessionInsert(ids, { id, handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1A }));
      const [row] = (await d.execute(sql`select task_claim_id, unit_price, currency from collection_sessions where id = ${id}`)) as unknown as Record<string, string>[];
      expect(row).toEqual({ task_claim_id: ids.claim1A, unit_price: '1200.0000', currency: 'VND' });
    });

    it('refuses a session naming another collector’s claim on the same task', async () => {
      const ids = await seed();
      const d = await db();
      // Collector 1's card, collector 2's claim. Same task, wrong person.
      await violates(
        'collection_sessions_claim_fk',
        d.execute(sessionInsert(ids, { id: uid(), handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim2A })),
      );
    });

    it('refuses a session naming the collector’s claim on a different task', async () => {
      const ids = await seed();
      const d = await db();
      // Collector 1 holds task B too; the session declares task A under the task-B claim.
      await violates(
        'collection_sessions_claim_fk',
        d.execute(sessionInsert(ids, { id: uid(), handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1B })),
      );
    });

    it('refuses a claim without its price, and a price without its claim', async () => {
      const ids = await seed();
      const d = await db();
      await violates(
        'collection_sessions_claim_snapshot_check',
        d.execute(sessionInsert(ids, { id: uid(), handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1A, price: null })),
      );
      await violates(
        'collection_sessions_claim_snapshot_check',
        d.execute(sessionInsert(ids, { id: uid(), handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1A, currency: null })),
      );
      await violates(
        'collection_sessions_claim_snapshot_check',
        d.execute(sessionInsert(ids, { id: uid(), handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: null, price: '1200.0000', currency: 'VND' })),
      );
    });

    it('still stores a claimless session, because rows from before 0016 have none', async () => {
      const ids = await seed();
      const d = await db();
      const id = uid();
      await d.execute(sessionInsert(ids, { id, handover: ids.handover2, task: ids.taskA, collector: ids.collector2, claim: null }));
      const [row] = (await d.execute(sql`select task_claim_id from collection_sessions where id = ${id}`)) as unknown as Record<string, string | null>[];
      expect(row!['task_claim_id']).toBeNull();
    });
  });

  describe('settlements', () => {
    it('refuses a new settlement with no claim', async () => {
      const ids = await seed();
      const d = await db();
      const session = uid();
      await d.execute(sessionInsert(ids, { id: session, handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1A }));
      const reviewId = await reviewed(session);
      await violates('settlements_claim_required', d.execute(settlementInsert(uid(), reviewId, ids.taskA, null)));
    });

    it('refuses a settlement on a claimless session — legacy footage is not paid at a guessed price', async () => {
      const ids = await seed();
      const d = await db();
      const session = uid();
      await d.execute(sessionInsert(ids, { id: session, handover: ids.handover2, task: ids.taskA, collector: ids.collector2, claim: null }));
      const reviewId = await reviewed(session);
      // Even a real claim by the right collector on the right task: it is not what the session says.
      await violates('settlements_claim_matches_session', d.execute(settlementInsert(uid(), reviewId, ids.taskA, ids.claim2A)));
    });

    it('refuses a settlement naming a claim other than the reviewed session’s', async () => {
      const ids = await seed();
      const d = await db();
      const session = uid();
      await d.execute(sessionInsert(ids, { id: session, handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1A }));
      const reviewId = await reviewed(session);
      // Collector 2's live claim on the same task: a valid (claim, task) pair, wrong footage.
      await violates('settlements_claim_matches_session', d.execute(settlementInsert(uid(), reviewId, ids.taskA, ids.claim2A)));
    });

    it('refuses a settlement whose claim is not on its task', async () => {
      const ids = await seed();
      const d = await db();
      const session = uid();
      await d.execute(sessionInsert(ids, { id: session, handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1A }));
      const reviewId = await reviewed(session);
      await violates('settlements_claim_fk', d.execute(settlementInsert(uid(), reviewId, ids.taskB, ids.claim1A)));
    });

    it('accepts the session’s own claim, and then freezes it', async () => {
      const ids = await seed();
      const d = await db();
      const session = uid();
      await d.execute(sessionInsert(ids, { id: session, handover: ids.handover1, task: ids.taskA, collector: ids.collector1, claim: ids.claim1A }));
      const reviewId = await reviewed(session);
      const id = uid();
      await d.execute(settlementInsert(id, reviewId, ids.taskA, ids.claim1A));
      await violates(
        'settlements_claim_immutable',
        d.execute(sql`update settlements set task_claim_id = ${ids.claim2A}, updated_at = now() where id = ${id}`),
      );
      // The lifecycle still moves; the guard is about the claim, not the state.
      await d.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where id = ${id}`);
    });

    it('lets a settlement from before 0016 keep walking its lifecycle', async () => {
      const ids = await seed();
      const d = await db();
      const session = uid();
      await d.execute(sessionInsert(ids, { id: session, handover: ids.handover2, task: ids.taskA, collector: ids.collector2, claim: null }));
      const reviewId = await reviewed(session);
      const id = uid();
      // The only way such a row exists: written before the trigger did.
      await d.execute(sql`alter table settlements disable trigger settlements_claim_guard`);
      try {
        await d.execute(settlementInsert(id, reviewId, ids.taskA, null));
      } finally {
        await d.execute(sql`alter table settlements enable trigger settlements_claim_guard`);
      }
      await d.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where id = ${id}`);
      const [row] = (await d.execute(sql`select settlement_state from settlements where id = ${id}`)) as unknown as Record<string, string>[];
      expect(row!['settlement_state']).toBe('bill_generated');
    });
  });
});
