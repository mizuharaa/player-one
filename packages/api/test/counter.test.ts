import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { buildApi, hashCredential } from '../src/index.ts';
import { appDb, closeDb, db, hasDb, liveClaim, truncate, useDatabase, violates } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('counter');

/**
 * The counter workflow, over HTTP.
 *
 * The criteria that matter here are the two that a rural upload centre will
 * exercise on its own: re-posting a queue after the link came back must not
 * duplicate anything (§10.6), and a session cannot exist without both APP-17b
 * declarations (§10.10).
 */

const SECRET = 'test-signing-key';
const uid = () => randomUUID();

async function seed() {
  const d = await db();
  const ids = {
    centre: uid(),
    device: uid(),
    operator: uid(),
    collector: uid(),
    deviceType: uid(),
    egoDevice: uid(),
    task: uid(),
    scenario: uid(),
  };
  const hash = await hashCredential('pw');
  await d.execute(sql`insert into upload_centres (id, region, name, status)
    values (${ids.centre}, 'HCM', 'centre', 'active')`);
  await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
    values (${ids.device}, ${ids.centre}, 'HCM-01', 'active', ${hash})`);
  await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
    values (${ids.operator}, ${ids.centre}, 'op-1', 'centre_operator', ${hash})`);
  await d.execute(sql`insert into collectors (id, external_ref, status)
    values (${ids.collector}, 'c-1', 'qualified')`);
  await d.execute(sql`insert into device_types (id, code, generation)
    values (${ids.deviceType}, 'ego_headset', 'gen1')`);
  await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status)
    values (${ids.egoDevice}, ${ids.deviceType}, 'AZER76400FE', 'active')`);
  await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
    values (${ids.task}, 'housework', 1200.0000, 5, 'published')`);
  await d.execute(sql`insert into scenarios (id, code, privacy_risk_level)
    values (${ids.scenario}, 'home', 'low')`);
  // A session is recorded under a live claim (0016); the counter refuses one without.
  const claim = await liveClaim(d, ids.task, ids.collector);
  return { ...ids, claim };
}

describe.skipIf(!hasDb())('the counter workflow', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const client = async () => {
    const app = buildApi({ db: await appDb(), tokenSecret: SECRET });
    const m = await app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: 'HCM-01', secret: 'pw' },
    });
    const o = await app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: 'op-1', secret: 'pw' },
    });
    const headers = {
      'x-machine-token': `Bearer ${m.json().token}`,
      authorization: `Bearer ${o.json().token}`,
    };
    const send = async (
      method: 'POST' | 'PATCH',
      url: string,
      payload: Record<string, unknown>,
    ): Promise<LightMyRequestResponse> =>
      (await app.inject({ method, url, payload, headers })) as unknown as LightMyRequestResponse;

    return {
      app,
      // One cast, one place: fastify's inject() overloads resolve to an
      // intersection with a chainable, which the awaited type then inherits.
      post: (url: string, payload: Record<string, unknown>) => send('POST', url, payload),
      patch: (url: string, payload: Record<string, unknown>) => send('PATCH', url, payload),
    };
  };

  const count = async (table: string): Promise<number> => {
    const rows = (await (await db()).execute(
      sql`select count(*)::int as n from ${sql.raw(table)}`,
    )) as unknown as { n: number }[];
    return rows[0]!.n;
  };

  /** One full counter run: handover, two sessions, a batch, completed. */
  async function fullRun(c: Awaited<ReturnType<typeof client>>, ids: Awaited<ReturnType<typeof seed>>) {
    const handover = uid();
    const sessionA = uid();
    const sessionB = uid();
    const batch = uid();

    const queue = [
      () =>
        c.post('/handovers', {
          id: handover,
          collector_id: ids.collector,
          device_id: ids.egoDevice,
          tf_card_id: 'CARD-0001',
          handover_time: '2026-08-21T09:00:00.000Z',
        }),
      () =>
        c.post(`/handovers/${handover}/sessions`, {
          id: sessionA,
          task_id: ids.task,
          scenario_id: ids.scenario,
          others_in_frame: false,
          sensitive_info_present: false,
          prepare_time: '2026-08-21T07:00:00.000Z',
        }),
      () =>
        c.post(`/handovers/${handover}/sessions`, {
          id: sessionB,
          task_id: ids.task,
          scenario_id: ids.scenario,
          others_in_frame: true,
          sensitive_info_present: false,
          prepare_time: '2026-08-21T13:00:00.000Z',
        }),
      () =>
        c.post('/upload-batches', {
          id: batch,
          handover_id: handover,
          import_started_at: '2026-08-21T09:05:00.000Z',
        }),
      () =>
        c.patch(`/upload-batches/${batch}`, {
          import_completed_at: '2026-08-21T09:20:00.000Z',
          file_count: 10,
          total_size_bytes: 40419210,
          batch_status: 'imported',
        }),
    ];
    for (const step of queue) {
      const res = await step();
      expect(res.statusCode, res.body).toBeLessThan(300);
    }
    return { handover, sessionA, sessionB, batch, queue };
  }

  it('records a handover, its sessions and a batch', async () => {
    const ids = await seed();
    const c = await client();
    const { handover, batch } = await fullRun(c, ids);

    expect(await count('handovers')).toBe(1);
    expect(await count('collection_sessions')).toBe(2);
    expect(await count('collection_session_devices')).toBe(2);
    expect(await count('upload_batches')).toBe(1);

    const rows = (await (await db()).execute(sql`
      select h.operator_id, h.upload_centre_id, b.upload_device_id, b.batch_status
      from handovers h join upload_batches b on b.handover_id = h.id
      where h.id = ${handover} and b.id = ${batch}`)) as unknown as Record<string, string>[];
    // Taken from the tokens, never the body.
    expect(rows[0]!['operator_id']).toBe(ids.operator);
    expect(rows[0]!['upload_centre_id']).toBe(ids.centre);
    expect(rows[0]!['upload_device_id']).toBe(ids.device);
    expect(rows[0]!['batch_status']).toBe('imported');
  });

  it('reconstructs sessions as handover-origin, so the drift stays measurable', async () => {
    const ids = await seed();
    const c = await client();
    await fullRun(c, ids);
    const rows = (await (await db()).execute(
      sql`select distinct session_origin, collector_id from collection_sessions`,
    )) as unknown as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!['session_origin']).toBe('handover');
    // The collector comes from the handover, not from the session body.
    expect(rows[0]!['collector_id']).toBe(ids.collector);
  });

  // -- §10.6 ---------------------------------------------------------------

  it('re-posting the whole queue duplicates nothing, audit rows included', async () => {
    const ids = await seed();
    const c = await client();
    const { queue } = await fullRun(c, ids);

    const before = {
      handovers: await count('handovers'),
      sessions: await count('collection_sessions'),
      sessionDevices: await count('collection_session_devices'),
      batches: await count('upload_batches'),
      audit: await count('audit_events'),
    };

    // The link came back and the console flushes its queue again, in order.
    for (const step of queue) {
      const res = await step();
      expect(res.statusCode, res.body).toBeLessThan(300);
    }

    expect(await count('handovers')).toBe(before.handovers);
    expect(await count('collection_sessions')).toBe(before.sessions);
    expect(await count('collection_session_devices')).toBe(before.sessionDevices);
    expect(await count('upload_batches')).toBe(before.batches);
    // The PATCH is idempotent in effect but is a real write each time, so one
    // more audit row is expected for it and nothing else.
    expect(await count('audit_events')).toBe(before.audit + 1);
  });

  it('reports a replayed create as replayed rather than as new', async () => {
    const ids = await seed();
    const c = await client();
    const handover = uid();
    const payload = {
      id: handover,
      collector_id: ids.collector,
      device_id: ids.egoDevice,
      tf_card_id: 'CARD-0001',
      handover_time: '2026-08-21T09:00:00.000Z',
    };
    const first = await c.post('/handovers', payload);
    const second = await c.post('/handovers', payload);
    expect(first.statusCode).toBe(201);
    expect(first.json().replayed).toBe(false);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
  });

  // -- §10.10 --------------------------------------------------------------

  describe('APP-17b: a session cannot exist without both declarations', () => {
    it('is refused by the database', async () => {
      const ids = await seed();
      const d = await db();
      await violates(
        'others_in_frame',
        d.execute(sql`
          insert into collection_sessions
            (id, task_id, collector_id, scenario_id, others_in_frame, sensitive_info_present, session_origin)
          values (${uid()}, ${ids.task}, ${ids.collector}, ${ids.scenario}, null, false, 'handover')`),
      );
    });

    it('is refused by the API when either field is missing', async () => {
      const ids = await seed();
      const c = await client();
      const handover = uid();
      await c.post('/handovers', {
        id: handover,
        collector_id: ids.collector,
        device_id: ids.egoDevice,
        tf_card_id: 'CARD-0001',
        handover_time: '2026-08-21T09:00:00.000Z',
      });

      const base = {
        task_id: ids.task,
        scenario_id: ids.scenario,
        prepare_time: '2026-08-21T07:00:00.000Z',
      };
      for (const partial of [
        { others_in_frame: false },
        { sensitive_info_present: false },
        {},
      ]) {
        const res = await c.post(`/handovers/${handover}/sessions`, {
          id: uid(),
          ...base,
          ...partial,
        });
        expect(res.statusCode, JSON.stringify(partial)).toBe(400);
      }
      expect(await count('collection_sessions')).toBe(0);
    });

    it('does not accept a string, a number or null as an answer', async () => {
      // "false" and 0 look like answers and are not. A schema that coerced them
      // would record a declaration nobody made.
      const ids = await seed();
      const c = await client();
      const handover = uid();
      await c.post('/handovers', {
        id: handover,
        collector_id: ids.collector,
        device_id: ids.egoDevice,
        tf_card_id: 'CARD-0001',
        handover_time: '2026-08-21T09:00:00.000Z',
      });

      for (const bad of ['false', 0, null, 'yes']) {
        const res = await c.post(`/handovers/${handover}/sessions`, {
          id: uid(),
          task_id: ids.task,
          scenario_id: ids.scenario,
          others_in_frame: bad,
          sensitive_info_present: false,
          prepare_time: '2026-08-21T07:00:00.000Z',
        });
        expect(res.statusCode, `others_in_frame=${JSON.stringify(bad)}`).toBe(400);
      }
    });

    it('accepts false as a real answer', async () => {
      const ids = await seed();
      const c = await client();
      await fullRun(c, ids);
      const rows = (await (await db()).execute(
        sql`select others_in_frame from collection_sessions order by prepare_time`,
      )) as unknown as { others_in_frame: boolean }[];
      expect(rows.map((r) => r.others_in_frame)).toEqual([false, true]);
    });
  });

  // -- scope and deferred validation ---------------------------------------

  it('refuses a session against another centre’s handover', async () => {
    const ids = await seed();
    const d = await db();
    const c = await client();

    // A handover that exists, but at a centre this operator does not serve.
    const otherCentre = uid();
    const otherOperator = uid();
    const foreign = uid();
    await d.execute(sql`insert into upload_centres (id, region, name, status)
      values (${otherCentre}, 'HAN', 'other', 'active')`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role)
      values (${otherOperator}, ${otherCentre}, 'op-2', 'centre_operator')`);
    await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
      values (${foreign}, ${ids.collector}, ${ids.egoDevice}, 'CARD-X', ${otherCentre}, ${otherOperator}, now())`);

    const res = await c.post(`/handovers/${foreign}/sessions`, {
      id: uid(),
      task_id: ids.task,
      scenario_id: ids.scenario,
      others_in_frame: false,
      sensitive_info_present: false,
      prepare_time: '2026-08-21T07:00:00.000Z',
    });
    expect(res.statusCode).toBe(404);
    expect(await count('collection_sessions')).toBe(0);
  });

  it('names which reference it could not resolve, so the operator can fix it', async () => {
    // PRD §11.3.1 rule 3. The item stays in the console's queue rather than
    // being stored as a dangling reference.
    const ids = await seed();
    const c = await client();
    const res = await c.post('/handovers', {
      id: uid(),
      collector_id: uid(), // never synced, or a typo
      device_id: ids.egoDevice,
      tf_card_id: 'CARD-0001',
      handover_time: '2026-08-21T09:00:00.000Z',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('unresolved_reference');
    expect(res.json().collector).toBe('unknown');
    expect(res.json().device).toBe('ok');
    expect(await count('handovers')).toBe(0);
  });

  it('cannot mark a cache cleaned, because that endpoint does not accept it', async () => {
    // UPL-06 is the next slice. The console has no field to try.
    const ids = await seed();
    const c = await client();
    const { batch } = await fullRun(c, ids);
    const res = await c.patch(`/upload-batches/${batch}`, {
      local_cache_cleaned_at: '2026-08-21T09:30:00.000Z',
      cloud_verified_at: '2026-08-21T09:29:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    const rows = (await (await db()).execute(
      sql`select cloud_verified_at, local_cache_cleaned_at from upload_batches where id = ${batch}`,
    )) as unknown as Record<string, unknown>[];
    expect(rows[0]!['cloud_verified_at']).toBeNull();
    expect(rows[0]!['local_cache_cleaned_at']).toBeNull();
  });

  it('lets a machine report only its own state', async () => {
    const ids = await seed();
    const c = await client();
    const mine = await c.post(`/upload-devices/${ids.device}/heartbeat`, {
      network_state: 'offline',
      disk_free_bytes: 512_000_000_000,
      card_reader_state: 'ready',
      queue_depth: 4,
      client_version: '0.1.0',
    });
    expect(mine.statusCode).toBe(200);
    const theirs = await c.post(`/upload-devices/${uid()}/heartbeat`, { network_state: 'online' });
    expect(theirs.statusCode).toBe(403);

    const rows = (await (await db()).execute(
      sql`select queue_depth, network_state from upload_device_status`,
    )) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!['queue_depth']).toBe(4);
  });

  it('audits every counter mutation, naming operator and machine', async () => {
    const ids = await seed();
    const c = await client();
    await fullRun(c, ids);
    const rows = (await (await db()).execute(sql`
      select action, operator_id, upload_device_id from audit_events
      where action not like '%.login' order by id`)) as unknown as Record<string, string>[];

    expect(rows.map((r) => r['action'])).toEqual([
      'handover.create',
      'session.create',
      'session.create',
      'batch.import_start',
      'batch.import_complete',
    ]);
    for (const r of rows) {
      expect(r['operator_id']).toBe(ids.operator);
      expect(r['upload_device_id']).toBe(ids.device);
    }
  });

  // -- the claim behind the session (APP-10, migration 0016) ----------------

  describe('a session is recorded under a live claim', () => {
    /** A second centre, operator, collector, device and card — the shape that hides a scoping bug. */
    async function secondCentre(ids: Awaited<ReturnType<typeof seed>>) {
      const d = await db();
      const other = { centre: uid(), device: uid(), operator: uid(), collector: uid(), egoDevice: uid(), handover: uid() };
      const hash = await hashCredential('pw');
      await d.execute(sql`insert into upload_centres (id, region, name, status) values (${other.centre}, 'HAN', 'other', 'active')`);
      await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
        values (${other.device}, ${other.centre}, 'HAN-01', 'active', ${hash})`);
      await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${other.operator}, ${other.centre}, 'op-2', 'centre_operator', ${hash})`);
      await d.execute(sql`insert into collectors (id, external_ref, status) values (${other.collector}, 'c-2', 'qualified')`);
      await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status)
        values (${other.egoDevice}, ${ids.deviceType}, 'AZER76400FF', 'active')`);
      await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
        values (${other.handover}, ${other.collector}, ${other.egoDevice}, 'CARD-2', ${other.centre}, ${other.operator}, now())`);

      const app = buildApi({ db: await appDb(), tokenSecret: SECRET });
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'HAN-01', secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: 'op-2', secret: 'pw' } });
      const headers = { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
      const post = async (url: string, payload: Record<string, unknown>) =>
        (await app.inject({ method: 'POST', url, payload, headers })) as unknown as LightMyRequestResponse;
      return { ...other, post };
    }

    const sessionBody = (ids: { task: string; scenario: string }) => ({
      id: uid(),
      task_id: ids.task,
      scenario_id: ids.scenario,
      others_in_frame: false,
      sensitive_info_present: false,
      prepare_time: '2026-08-21T07:00:00.000Z',
    });

    it('stamps the claim and the price onto the session, not the task’s current price', async () => {
      const ids = await seed();
      const c = await client();
      const { sessionA } = await fullRun(c, ids);
      const [row] = (await (await db()).execute(
        sql`select task_claim_id, unit_price, currency from collection_sessions where id = ${sessionA}`,
      )) as unknown as Record<string, string>[];
      expect(row).toEqual({ task_claim_id: ids.claim, unit_price: '1200.0000', currency: 'VND' });
    });

    it('refuses a session for a collector with no claim on the task', async () => {
      const ids = await seed();
      const other = await secondCentre(ids);
      // The task is claimed — by the FIRST collector. That is not this collector's claim.
      const res = await other.post(`/handovers/${other.handover}/sessions`, sessionBody(ids));
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ error: 'refused', constraint: 'session_claim_missing' });
      expect(await count('collection_sessions')).toBe(0);
    });

    it('refuses a session under a claim that has been released', async () => {
      const ids = await seed();
      const c = await client();
      await (await db()).execute(sql`update task_claims set released_at = now() where id = ${ids.claim}`);
      const handover = uid();
      await c.post('/handovers', {
        id: handover,
        collector_id: ids.collector,
        device_id: ids.egoDevice,
        tf_card_id: 'CARD-0001',
        handover_time: '2026-08-21T09:00:00.000Z',
      });
      const res = await c.post(`/handovers/${handover}/sessions`, sessionBody(ids));
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ error: 'refused', constraint: 'session_claim_released' });
      expect(await count('collection_sessions')).toBe(0);
    });

    it('refuses a session against a task that has been taken down, even under a live claim', async () => {
      const ids = await seed();
      const c = await client();
      await (await db()).execute(sql`update tasks set status = 'taken_down' where id = ${ids.task}`);
      const handover = uid();
      await c.post('/handovers', {
        id: handover,
        collector_id: ids.collector,
        device_id: ids.egoDevice,
        tf_card_id: 'CARD-0001',
        handover_time: '2026-08-21T09:00:00.000Z',
      });
      const res = await c.post(`/handovers/${handover}/sessions`, sessionBody(ids));
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ error: 'refused', constraint: 'session_task_not_published' });
    });

    it('records the second collector’s session under their own claim at their own centre', async () => {
      const ids = await seed();
      const other = await secondCentre(ids);
      const claim2 = await liveClaim(await db(), ids.task, other.collector);
      const body = sessionBody(ids);
      const res = await other.post(`/handovers/${other.handover}/sessions`, body);
      expect(res.statusCode, res.body).toBe(201);
      const [row] = (await (await db()).execute(
        sql`select task_claim_id, collector_id from collection_sessions where id = ${body.id}`,
      )) as unknown as Record<string, string>[];
      expect(row).toEqual({ task_claim_id: claim2, collector_id: other.collector });
    });
  });
});
