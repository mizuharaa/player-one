import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential, readAlerts, type Alert } from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

useDatabase('alerts');

/**
 * PLT-12 / PRD §11.4: the nine alert conditions, derived from rows the platform
 * already writes. See `packages/api/src/alerts.ts` for why three of them answer
 * `no_signal` instead of zero.
 */

const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

const ORDER = [
  'upload_failures',
  'devices_offline',
  'upload_centres_offline_or_backlogged',
  'upload_devices_low_disk',
  'card_import_failures',
  'cloud_write_failures',
  'checksum_failures',
  'review_cannot_read_cloud',
  'cross_border_timeouts',
];

describe.skipIf(!hasDb())('operational alerts', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const byId = async (): Promise<Record<string, Alert>> =>
    Object.fromEntries((await readAlerts(await db())).map((a) => [a.id, a]));

  it('answers all nine in the PRD\'s order, and names the two nothing records', async () => {
    const rows = await readAlerts(await db());
    expect(rows.map((a) => a.id)).toEqual(ORDER);

    // An empty platform has nothing wrong with it, except what it cannot see.
    // Two conditions still have no source at all and say so rather than
    // reading a reassuring zero. The other seven now read from rows: on an
    // empty platform there are no active machines to be quiet about and no
    // recorded transport failure, so their zeroes are honest.
    const blind = new Set(['review_cannot_read_cloud', 'cross_border_timeouts']);
    for (const a of rows) {
      if (blind.has(a.id)) {
        expect(a, a.id).toMatchObject({ state: 'no_signal', observed: null, threshold: null });
      } else {
        expect(a, a.id).toMatchObject({ state: 'ok', observed: 0 });
      }
    }
  });

  it('is readable by an operator session and by nobody else', async () => {
    const d = await db();
    const centre = uid();
    const machine = uid();
    const operator = uid();
    const reviewer = uid();
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status)
      values (${centre}, 'HCM', 'A', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${machine}, ${centre}, 'M1', 'active', ${hash})`);
    // A PaXini reviewer has no centre at all; `operators_centre_check` allows
    // the null only because the role says reviewer.
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${operator}, ${centre}, 'op1', 'centre_operator', ${hash}),
             (${reviewer}, null, 'pax-01', 'reviewer', ${hash})`);

    const app = buildApi({ db: await appDb(), tokenSecret: 'k' });
    await app.ready();
    const token = async (url: string, payload: unknown) =>
      (await app.inject({ method: 'POST', url, payload: payload as never })).json().token as string;

    const m = await token('/auth/machine', { machine_identifier: 'M1', secret: 'pw' });
    const o = await token('/auth/operator', { external_ref: 'op1', secret: 'pw' });
    const session = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { external_ref: 'pax-01', operator_secret: 'pw' },
    });
    const setCookie = [session.headers['set-cookie'] ?? []].flat().join(' | ');
    const r = decodeURIComponent(/po_operator=([^;]+)/.exec(setCookie)?.[1] ?? '');

    const asOperator = await app.inject({
      method: 'GET',
      url: '/api/alerts',
      headers: { 'x-machine-token': `Bearer ${m}`, authorization: `Bearer ${o}` },
    });
    expect(asOperator.statusCode, asOperator.body).toBe(200);
    expect(asOperator.json().alerts).toHaveLength(9);

    // A PaXini reviewer is scoped to the review lane and this is not in it.
    const asReviewer = await app.inject({
      method: 'GET',
      url: '/api/alerts',
      headers: { authorization: `Bearer ${r}` },
    });
    expect(asReviewer.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/alerts' })).statusCode).toBe(401);
    await app.close();
  });

  it('7: fires on one episode whose bytes did not read back', async () => {
    const d = await db();
    await d.execute(sql`insert into episodes
      (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at, verification_state)
      values (${uid()}, 'AZER76400FE', '20260813_072310', now(), now(), 'failed')`);
    expect((await byId())['checksum_failures']).toMatchObject({
      state: 'firing',
      observed: 1,
      threshold: 1,
    });
  });

  it('2: fires on a bound device that has recorded nothing for a week, and not on a fresh one', async () => {
    const d = await db();
    const type = uid();
    const collector = uid();
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${type}, 'ego', 'g1')`);
    // Handed over yesterday: not overdue, even with no footage yet.
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status, bound_collector_id, bound_at)
      values (${uid()}, ${type}, 'FRESH0001', 'active', ${collector}, now() - interval '1 day')`);
    expect((await byId())['devices_offline']).toMatchObject({ state: 'ok', observed: 0 });

    const quiet = uid();
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status, bound_collector_id, bound_at)
      values (${quiet}, ${type}, 'QUIET0001', 'active', ${collector}, now() - interval '30 days')`);
    expect((await byId())['devices_offline']).toMatchObject({ state: 'firing', observed: 1 });

    // One episode from yesterday, and the device is accounted for again. The
    // serial is the join, because that is what an episode records (§4.3).
    await d.execute(sql`insert into episodes
      (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at)
      values (${uid()}, 'QUIET0001', '20260813_072310', now() - interval '1 day', now() - interval '1 day')`);
    expect((await byId())['devices_offline']).toMatchObject({ state: 'ok', observed: 0 });
  });

  it('3 and 4: an active machine that has never reported is offline, then quiet, backed-up and full ones count', async () => {
    const d = await db();
    // Two centres, per the fixture rule: "machines platform-wide" has to be
    // measured across more than one, or a per-centre mistake reads correct.
    const centreA = uid();
    const centreB = uid();
    const hash = await hashCredential('pw');
    const machines = [uid(), uid(), uid(), uid()];
    await d.execute(sql`insert into upload_centres (id, region, name, status) values
      (${centreA}, 'HCM', 'A', 'active'), (${centreB}, 'HN', 'B', 'active')`);
    for (const [i, id] of machines.entries()) {
      await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
        values (${id}, ${i < 2 ? centreA : centreB}, ${`M${i}`}, 'active', ${hash})`);
    }

    // Four active machines and not one heartbeat. A machine the platform
    // cannot see IS the condition: the centre process beats at boot, so a
    // configured machine leaves this count as soon as it starts, and what is
    // left is a machine nobody configured. Counting these as healthy is what
    // would make a centre dark since installation unable to fire at all.
    let now = await byId();
    expect(now['upload_centres_offline_or_backlogged']).toMatchObject({ state: 'firing', observed: 4 });
    // No machine has reported a disk figure, so none is known to be low. That
    // is condition 3's sentence to say, not this one's.
    expect(now['upload_devices_low_disk']).toMatchObject({ state: 'ok', observed: 0 });

    const beat = (id: string, ago: string, queue: number, freeGb: number) =>
      d.execute(sql`insert into upload_device_status
        (upload_device_id, last_heartbeat_at, queue_depth, disk_free_bytes)
        values (${id}, now() - ${sql.raw(`interval '${ago}'`)}, ${queue}, ${freeGb * 1_000_000_000})`);

    for (const id of machines) await beat(id, '1 minute', 2, 500); // all healthy
    now = await byId();
    expect(now['upload_centres_offline_or_backlogged']).toMatchObject({ state: 'ok', observed: 0 });
    expect(now['upload_devices_low_disk']).toMatchObject({ state: 'ok', observed: 0 });

    await d.execute(sql`update upload_device_status
      set last_heartbeat_at = now() - interval '2 hours' where upload_device_id = ${machines[1]!}`);
    await d.execute(sql`update upload_device_status
      set queue_depth = 90 where upload_device_id = ${machines[2]!}`);
    await d.execute(sql`update upload_device_status
      set disk_free_bytes = ${10 * 1_000_000_000} where upload_device_id = ${machines[3]!}`);
    now = await byId();
    expect(now['upload_centres_offline_or_backlogged']).toMatchObject({ state: 'firing', observed: 2 });
    expect(now['upload_devices_low_disk']).toMatchObject({ state: 'firing', observed: 1 });

    // A retired machine's last reading must not stay red for ever. It is
    // neither offline nor low on disk: it is gone.
    const retired = uid();
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${retired}, ${centreB}, 'M-OLD', 'retired', ${hash})`);
    await beat(retired, '30 days', 0, 1);
    now = await byId();
    expect(now['upload_centres_offline_or_backlogged']).toMatchObject({ state: 'firing', observed: 2 });
    expect(now['upload_devices_low_disk']).toMatchObject({ state: 'firing', observed: 1 });
  });

  it('6: counts recorded cloud transport failures from the last day, not older ones', async () => {
    const d = await db();
    const centre = uid();
    const machine = uid();
    const operator = uid();
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${centre}, 'HCM', 'A', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${machine}, ${centre}, 'M1', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${operator}, ${centre}, 'op1', 'centre_operator', ${hash})`);

    // Nothing recorded yet, and that is now an honest zero rather than
    // `no_signal`: upload.ts records on the only path that produces the fact.
    expect((await byId())['cloud_write_failures']).toMatchObject({
      state: 'ok',
      observed: 0,
      threshold: 3,
    });

    const failure = (ago: string) =>
      d.execute(sql`insert into audit_events
        (occurred_at, action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id, after)
        values (now() - ${sql.raw(`interval '${ago}'`)}, 'episode.cloud_transport_failed', 'episodes',
                ${uid()}, 'operator', ${operator}, ${machine}, ${centre}, '{"error":"link down"}'::jsonb)`);

    await failure('1 hour');
    await failure('2 hours');
    // Yesterday's outage is not this morning's.
    await failure('30 hours');
    expect((await byId())['cloud_write_failures']).toMatchObject({ state: 'ok', observed: 2, threshold: 3 });

    await failure('3 hours');
    expect((await byId())['cloud_write_failures']).toMatchObject({ state: 'firing', observed: 3 });
  });

  it('5: fires on the third failed card import of the day, not the first', async () => {
    const d = await db();
    const centre = uid();
    const machine = uid();
    const operator = uid();
    const collector = uid();
    const type = uid();
    const device = uid();
    const handover = uid();
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${centre}, 'HCM', 'A', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${machine}, ${centre}, 'M1', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${operator}, ${centre}, 'op1', 'centre_operator', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${type}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status)
      values (${device}, ${type}, 'AZER76400FE', 'active')`);
    await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
      values (${handover}, ${collector}, ${device}, 'CARD-1', ${centre}, ${operator}, ${new Date(T).toISOString()})`);

    const batch = (status: string, ago: string) =>
      d.execute(sql`insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status)
        values (${uid()}, ${handover}, ${machine}, now() - ${sql.raw(`interval '${ago}'`)}, ${status})`);

    await batch('failed', '1 hour');
    await batch('failed', '2 hours');
    await batch('imported', '3 hours');
    // Yesterday's failure is not this morning's card reader.
    await batch('failed', '30 hours');
    expect((await byId())['card_import_failures']).toMatchObject({ state: 'ok', observed: 2, threshold: 3 });

    await batch('failed', '4 hours');
    expect((await byId())['card_import_failures']).toMatchObject({ state: 'firing', observed: 3 });
  });

  it('1: counts Path A deliveries that failed and never landed, not ones a retry fixed', async () => {
    const d = await db();
    const task = uid();
    const scenario = uid();
    const collector = uid();
    const session = uid();
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
      values (${task}, 'housework', 1200, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${scenario}, 'home', 'low')`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into collection_sessions
      (id, task_id, collector_id, scenario_id, others_in_frame, sensitive_info_present, session_origin)
      values (${session}, ${task}, ${collector}, ${scenario}, false, false, 'app')`);

    /** One episode, one delivery of it, and the attempt rows it went through. */
    const delivery = async (states: string[], hoursAgo = 1) => {
      const episode = uid();
      const ingest = uid();
      await d.execute(sql`insert into episodes
        (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at)
        values (${episode}, 'AZER76400FE', '20260813_072310', now(), now())`);
      await d.execute(sql`insert into episode_ingests
        (ingest_id, episode_id, content_fingerprint, state, source_basename, measured_duration_s,
         timing_source, timing_confidence, manifest_present, engine_version, host, ingested_at, record_json)
        values (${ingest}, ${episode}, 'f', 'ok', 'ego_x', 1, 'pts_sidecar', 'exact', true, '0', 'h', now(), '{}'::jsonb)`);
      for (const state of states) {
        await d.execute(sql`insert into collector_uploads
          (id, collector_id, collection_session_id, device_serial, episode_id, ingest_id,
           source_basename, file_count, total_bytes, state, completed_at, registered_at)
          values (${uid()}, ${collector}, ${session}, 'AZER76400FE', ${episode}, ${ingest},
                  'ego_x', 1, 10, ${state}, now(),
                  now() - ${sql.raw(`interval '${hoursAgo} hours'`)})`);
      }
    };

    await delivery(['failed']);
    await delivery(['failed']);
    // A phone that failed and then got it up is history, not a fault.
    await delivery(['failed', 'verified']);
    // Yesterday's failure is not today's.
    await delivery(['failed'], 30);
    expect((await byId())['upload_failures']).toMatchObject({ state: 'ok', observed: 2, threshold: 3 });

    await delivery(['failed']);
    expect((await byId())['upload_failures']).toMatchObject({ state: 'firing', observed: 3 });
  });
});
