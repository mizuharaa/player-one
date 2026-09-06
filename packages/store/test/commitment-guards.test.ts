import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, hasDb, liveClaim, truncate, violates, useDatabase } from './db.ts';

useDatabase('commitment_guards');

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

async function contract() {
  const ids = await seed();
  const d = await db();
  const id = uid();
  await d.execute(sql`update tasks set commitment_hours_options = '{1,2}', commitment_weeks = 2 where id = ${ids.taskA}`);
  await d.execute(sql`insert into task_commitments (id, claim_id, pledged_hours_per_week, started_on, ends_on)
    values (${id}, ${ids.claim1A}, 1, current_date - 14, current_date)`);
  return { ...ids, id };
}

describe.skipIf(!hasDb())('commitment guards (0024)', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it.each(['{}', '{NULL}', '{1,NULL}', '{0}', '{-1}'])('refuses hours options %s', async (options) => {
    const d = await db();
    await violates('tasks_commitment_shape_check', d.execute(sql`
      insert into tasks (id, name, unit_price, status, commitment_hours_options, commitment_weeks)
      values (${uid()}, 'pledge', 1200, 'draft', ${options}::integer[], 2)`));
  });

  it('accepts absent terms and a non-empty positive offer', async () => {
    const d = await db();
    await d.execute(sql`insert into tasks (id, name, unit_price, status) values (${uid()}, 'optional', 1200, 'draft')`);
    await contract();
  });

  it.each([null, '', '   '])('refuses abandonment reason %j', async (reason) => {
    const { id } = await contract();
    const d = await db();
    await violates('task_commitments_abandon_reason_check', d.execute(sql`
      update task_commitments set state = 'abandoned', closed_at = now(), close_reason = ${reason} where id = ${id}`));
  });

  it.each(['claim_id', 'pledged_hours_per_week', 'started_on', 'ends_on'])('cannot rewrite %s', async (field) => {
    const ids = await contract();
    const d = await db();
    const changes = {
      claim_id: sql`claim_id = ${ids.claim2A}`,
      pledged_hours_per_week: sql`pledged_hours_per_week = 2`,
      started_on: sql`started_on = started_on - 7`,
      ends_on: sql`ends_on = ends_on + 7`,
    };
    await violates('task_commitments_terms_immutable', d.execute(sql`
      update task_commitments set ${changes[field as keyof typeof changes]} where id = ${ids.id}`));
  });

  it.each(['completed', 'released', 'abandoned'])('cannot insert already %s', async (state) => {
    const ids = await contract();
    const d = await db();
    await violates('task_commitments_insert_active', d.execute(sql`
      insert into task_commitments (id, claim_id, pledged_hours_per_week, started_on, ends_on, state, closed_at, close_reason)
      values (${uid()}, ${ids.claim2A}, 1, current_date - 14, current_date, ${state}, now(), 'recorded reason')`));
  });

  it.each(['active', 'completed'])('cannot delete a %s contract', async (state) => {
    const { id } = await contract();
    const d = await db();
    if (state === 'completed') await d.execute(sql`update task_commitments set state = 'completed', closed_at = now() where id = ${id}`);
    await violates('task_commitments_no_delete', d.execute(sql`delete from task_commitments where id = ${id}`));
  });

  it('allows unchanged terms and records a reasoned closure once', async () => {
    const { id } = await contract();
    const d = await db();
    await d.execute(sql`update task_commitments set claim_id = claim_id, pledged_hours_per_week = pledged_hours_per_week,
      started_on = started_on, ends_on = ends_on, state = 'abandoned', closed_at = now(), close_reason = 'No footage delivered' where id = ${id}`);
    const events = await d.execute(sql`select event from commitment_events where commitment_id = ${id}`);
    expect([...events]).toEqual([{ event: 'abandoned' }]);
  });

  it('counts attributed unset-clock footage by its session day and freezes it on closure', async () => {
    const ids = await contract();
    const d = await db();
    const session = uid();
    await d.execute(sql`insert into collection_sessions
      (id, handover_id, task_id, collector_id, scenario_id, others_in_frame, sensitive_info_present, session_origin, task_claim_id, unit_price, currency, prepare_time)
      values (${session}, ${ids.handover1}, ${ids.taskA}, ${ids.collector1}, ${ids.scenario}, false, false, 'handover', ${ids.claim1A}, 1200, 'VND', current_date - 7)`);
    const review = await reviewed(session);
    await d.execute(sql`update episodes set session_started_at = '19700101_003357' where collection_session_id = ${session}`);
    await d.execute(settlementInsert(uid(), review, ids.taskA, ids.claim1A));
    const delivered = async () => {
      const [row] = await d.execute(sql`select commitment_delivered_minutes(${ids.id}) as minutes`);
      return Number(row!.minutes);
    };
    expect(await delivered()).toBe(1);
    await d.execute(sql`update collection_sessions set prepare_time = current_date where id = ${session}`);
    expect(await delivered()).toBe(0);
    await d.execute(sql`update collection_sessions set prepare_time = current_date - 14 where id = ${session}`);
    expect(await delivered()).toBe(1);
    await d.execute(sql`update episodes set session_started_at = to_char(current_date, 'YYYYMMDD') || '_003357' where collection_session_id = ${session}`);
    expect(await delivered()).toBe(0);
    await d.execute(sql`update episodes set session_started_at = '19700101_003357' where collection_session_id = ${session}`);
    await d.execute(sql`update task_commitments set state = 'completed', closed_at = now() where id = ${ids.id}`);
    const [event] = await d.execute(sql`select delivered_minutes from commitment_events where commitment_id = ${ids.id}`);
    expect(Number(event!.delivered_minutes)).toBe(1);
  });
});
