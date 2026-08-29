import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LOCALES, MESSAGES } from '../src/i18n.ts';
import {
  COLLECTOR_API_REFUSALS,
  CURRENT_AGREEMENTS,
  EXAM_ANSWERS,
  buildApi,
  hashCredential,
  signToken,
} from '../src/index.ts';
import { closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('collector_app');

/**
 * The collector app's own routes (APP-01 → APP-18).
 *
 * Two properties are what this file is really for, and both are money
 * properties rather than shape properties:
 *
 *   - **APP-05 is enforced by the database, not by this route.** A collector
 *     who has not passed the exam cannot claim a task, and the proof is that
 *     `task_claims_guard` refuses the insert — the route contributes nothing to
 *     the decision and could not weaken it if it tried.
 *   - **Nothing internal reaches a collector.** Every 409 these routes send
 *     carries a name from `COLLECTOR_API_REFUSALS`, never the constraint that
 *     actually fired. `task_claims_capacity` is a sentence for a console.
 */

const SECRET = 'k';
const uid = () => randomUUID();

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> =>
  (await (await db()).execute(q)) as unknown as T[];

async function seed() {
  const d = await db();
  const ids = {
    collector: uid(),
    other: uid(),
    centre: uid(),
    machine: uid(),
    operator: uid(),
    task: uid(),
    taskFull: uid(),
    taskDraft: uid(),
    deviceType: uid(),
    device: uid(),
    device2: uid(),
    retired: uid(),
    scenario: uid(),
  };
  const hash = await hashCredential('pw');
  await d.execute(sql`insert into upload_centres (id, region, name, status)
    values (${ids.centre}, 'HCM', 'District 7', 'active')`);
  await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
    values (${ids.machine}, ${ids.centre}, 'HCM-01', 'active', ${hash})`);
  await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
    values (${ids.operator}, ${ids.centre}, 'op-hcm', 'centre_operator', ${hash})`);
  // The counter enrolled them: a reference and a number, and nothing else.
  // Registration is what adds a name, and `pending` is what an operator lifts.
  await d.execute(sql`insert into collectors (id, external_ref, status, phone) values
    (${ids.collector}, 'c-0001', 'pending', '+84900000001'),
    (${ids.other}, 'c-0002', 'qualified', '+84900000002')`);
  await d.execute(sql`insert into tasks (id, name, type, unit_price, target_effective_duration_s, max_concurrent_claimants, status) values
    (${ids.task}, 'housework', 'home_cooking', 1200.0000, 180000.000000, 5, 'published'),
    (${ids.taskFull}, 'office', 'office_work', 1000.0000, null, 1, 'published'),
    (${ids.taskDraft}, 'unpublished', 'warehouse', 1500.0000, null, 5, 'draft')`);
  await d.execute(sql`insert into device_types (id, code, generation)
    values (${ids.deviceType}, 'ego_headset', 'gen1')`);
  await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status, fault_note) values
    (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active', null),
    (${ids.device2}, ${ids.deviceType}, 'AZER76400FF', 'active', null),
    (${ids.retired}, ${ids.deviceType}, 'AZER00000RT', 'retired', 'water damage, do not issue')`);
  await d.execute(sql`insert into scenarios (id, code, privacy_risk_level)
    values (${ids.scenario}, 'home', 'low')`);
  return ids;
}

type Ids = Awaited<ReturnType<typeof seed>>;

describe.skipIf(!hasDb())('the collector app', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const harness = async () => {
    const ids = await seed();
    const app = buildApi({ db: await db(), tokenSecret: SECRET });
    const who = (collectorId: string) => ({
      authorization: `Bearer ${signToken(SECRET, { kind: 'collector', collectorId, epoch: 1 })}`,
    });
    const headers = who(ids.collector);
    return {
      app,
      ids,
      who,
      get: (url: string, h = headers) => app.inject({ method: 'GET', url, headers: h }),
      post: (url: string, payload: unknown = {}, h = headers) =>
        app.inject({ method: 'POST', url, payload: payload as object, headers: h }),
    };
  };

  /** The whole onboarding gate, in the order a collector meets it. */
  const onboard = async (h: Awaited<ReturnType<typeof harness>>) => {
    await h.post('/api/me/register', { name: 'Nguyễn Văn A' });
    await h.post('/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] });
    await h.post('/api/me/training');
    await h.post('/api/me/exam', { answers: [...EXAM_ANSWERS] });
  };

  /** What only the back office can do: BO-03's qualification (SEC-02). */
  const qualify = async (collectorId: string) => {
    await (await db()).execute(
      sql`update collectors set status = 'qualified' where id = ${collectorId}`,
    );
  };

  // -- the scope, which is the reason there is no id in any of these ---------

  const ROUTES: [string, string][] = [
    ['GET', '/api/me/profile'],
    ['GET', '/api/me/agreements'],
    ['GET', '/api/me/tasks'],
    ['GET', '/api/me/claims'],
    ['GET', '/api/me/devices'],
    ['GET', '/api/me/sessions'],
    ['POST', '/api/me/register'],
    ['POST', '/api/me/agreements'],
    ['POST', '/api/me/training'],
    ['POST', '/api/me/exam'],
    ['POST', '/api/me/devices'],
    ['POST', '/api/me/sessions'],
    // The two that carry a task id in the path. It is a task id and not a
    // collector id, and the scope is the prefix either way.
    ['GET', '/api/me/tasks/00000000-0000-4000-8000-000000000000'],
    ['POST', '/api/me/tasks/00000000-0000-4000-8000-000000000000/claims'],
  ];

  it('refuses an operator token on every one of its routes', async () => {
    const h = await harness();
    const m = await h.app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: 'HCM-01', secret: 'pw' },
    });
    const o = await h.app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: 'op-hcm', secret: 'pw' },
    });
    const staff = {
      'x-machine-token': `Bearer ${m.json().token}`,
      authorization: `Bearer ${o.json().token}`,
    };
    for (const [method, url] of ROUTES) {
      const res = await h.app.inject({ method: method as 'GET', url, payload: {}, headers: staff });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('refuses a request with no token at all', async () => {
    const h = await harness();
    for (const [method, url] of ROUTES) {
      const res = await h.app.inject({ method: method as 'GET', url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('answers about the token holder only, with no id anywhere in the request', async () => {
    const h = await harness();
    await h.post('/api/me/register', { name: 'A' });
    await h.post('/api/me/register', { name: 'B' }, h.who(h.ids.other));
    expect((await h.get('/api/me/profile')).json().name).toBe('A');
    expect((await h.get('/api/me/profile', h.who(h.ids.other))).json().name).toBe('B');
  });

  // -- registration (APP-01) ------------------------------------------------

  it('registers a name against the row the counter already enrolled', async () => {
    const h = await harness();
    const res = await h.post('/api/me/register', { name: 'Nguyễn Văn A' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: h.ids.collector,
      name: 'Nguyễn Văn A',
      // The number the counter enrolled, and the one they signed in with. It
      // is never read from the body.
      phone: '+84900000001',
      training_done: false,
      exam_passed: false,
      agreements: [],
    });
  });

  it('will not write a phone from the body, even one that is free', async () => {
    const h = await harness();
    await h.post('/api/me/register', { name: 'A', phone: '+84999999999' });
    const [row] = await rows<{ phone: string }>(
      sql`select phone from collectors where id = ${h.ids.collector}`,
    );
    expect(row!.phone).toBe('+84900000001');
  });

  it('re-posting the same registration writes nothing and audits nothing', async () => {
    const h = await harness();
    expect((await h.post('/api/me/register', { name: 'A' })).statusCode).toBe(201);
    const again = await h.post('/api/me/register', { name: 'A' });
    expect(again.statusCode).toBe(200);
    expect(again.json().name).toBe('A');
    const audit = await rows<{ n: number }>(
      sql`select count(*)::int as n from audit_events where action = 'collector.register'`,
    );
    expect(audit[0]!.n).toBe(1);
  });

  // -- the six agreements (APP-02, PRV-01) ----------------------------------

  it('lists the six current agreements and what is already on record', async () => {
    const h = await harness();
    const before = (await h.get('/api/me/agreements')).json().agreements;
    expect(before).toHaveLength(6);
    expect(before.every((a: { accepted_at: null }) => a.accepted_at === null)).toBe(true);

    await h.post('/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] });
    const after = (await h.get('/api/me/agreements')).json().agreements;
    expect(after.every((a: { accepted_at: string }) => typeof a.accepted_at === 'string')).toBe(true);
  });

  it('records the version accepted and the moment, and the moment is the server’s', async () => {
    const h = await harness();
    await h.post('/api/me/agreements', {
      agreements: [{ agreement: 'privacy', version: '1.0', accepted_at: '1999-01-01T00:00:00.000Z' }],
    });
    const [row] = await rows<{ version: string; accepted_at: Date }>(
      sql`select version, accepted_at from collector_agreements
           where collector_id = ${h.ids.collector} and agreement = 'privacy'`,
    );
    expect(row!.version).toBe('1.0');
    expect(new Date(row!.accepted_at).getFullYear()).toBe(new Date().getFullYear());
  });

  it('refuses an agreement or a version this server is not presenting', async () => {
    const h = await harness();
    const stale = await h.post('/api/me/agreements', {
      agreements: [{ agreement: 'privacy', version: '0.9' }],
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().constraint).toBe('agreement_version_unknown');
    const bogus = await h.post('/api/me/agreements', {
      agreements: [{ agreement: 'blood_oath', version: '1.0' }],
    });
    expect(bogus.json().constraint).toBe('agreement_version_unknown');
    const [n] = await rows<{ n: number }>(
      sql`select count(*)::int as n from collector_agreements`,
    );
    expect(n!.n).toBe(0);
  });

  it('re-accepting keeps the original moment and writes no second audit row', async () => {
    const h = await harness();
    await h.post('/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] });
    const [first] = await rows<{ accepted_at: Date }>(
      sql`select accepted_at from collector_agreements
           where collector_id = ${h.ids.collector} and agreement = 'user'`,
    );
    await h.post('/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] });
    const after = await rows<{ accepted_at: Date; n: number }>(
      sql`select accepted_at from collector_agreements
           where collector_id = ${h.ids.collector} and agreement = 'user'`,
    );
    expect(after).toHaveLength(1);
    expect(new Date(after[0]!.accepted_at).getTime()).toBe(new Date(first!.accepted_at).getTime());
    const [audit] = await rows<{ n: number }>(
      sql`select count(*)::int as n from audit_events where action = 'collector.accept_agreements'`,
    );
    expect(audit!.n).toBe(1);
  });

  // -- training and the exam (APP-03, APP-04) -------------------------------

  it('marks training seen once, and a second call changes nothing', async () => {
    const h = await harness();
    expect((await h.post('/api/me/training')).json().training_done).toBe(true);
    const [first] = await rows<{ t: Date }>(
      sql`select training_completed_at as t from collectors where id = ${h.ids.collector}`,
    );
    await h.post('/api/me/training');
    const [second] = await rows<{ t: Date }>(
      sql`select training_completed_at as t from collectors where id = ${h.ids.collector}`,
    );
    expect(new Date(second!.t).getTime()).toBe(new Date(first!.t).getTime());
    const [audit] = await rows<{ n: number }>(
      sql`select count(*)::int as n from audit_events where action = 'collector.training_complete'`,
    );
    expect(audit!.n).toBe(1);
  });

  it('grades the exam on the server and records pass or fail', async () => {
    const h = await harness();
    const wrong = EXAM_ANSWERS.map((a) => !a);
    expect((await h.post('/api/me/exam', { answers: wrong })).json().passed).toBe(false);
    expect(
      (
        await rows<{ r: string }>(
          sql`select exam_result as r from collectors where id = ${h.ids.collector}`,
        )
      )[0]!.r,
    ).toBe('fail');

    expect((await h.post('/api/me/exam', { answers: [...EXAM_ANSWERS] })).json().passed).toBe(true);
    const [after] = await rows<{ r: string; d: Date }>(
      sql`select exam_result as r, exam_decided_at as d from collectors where id = ${h.ids.collector}`,
    );
    expect(after!.r).toBe('pass');
    expect(after!.d).not.toBeNull();
  });

  it('never overwrites a pass with a later fail', async () => {
    const h = await harness();
    await h.post('/api/me/exam', { answers: [...EXAM_ANSWERS] });
    const fail = await h.post('/api/me/exam', { answers: EXAM_ANSWERS.map((a) => !a) });
    expect(fail.json().passed).toBe(false);
    expect(
      (
        await rows<{ r: string }>(
          sql`select exam_result as r from collectors where id = ${h.ids.collector}`,
        )
      )[0]!.r,
    ).toBe('pass');
  });

  it('stores the verdict and never the answer sheet', async () => {
    const h = await harness();
    await h.post('/api/me/exam', { answers: [...EXAM_ANSWERS] });
    const [row] = await rows<{ after: unknown }>(
      sql`select after from audit_events where action = 'collector.exam'`,
    );
    expect(JSON.stringify(row!.after)).toBe(JSON.stringify({ exam_result: 'pass' }));
  });

  // -- APP-05, the P0 gate --------------------------------------------------

  it('APP-05: no exam pass, no claim — and the database is what refuses it', async () => {
    const h = await harness();
    await h.post('/api/me/register', { name: 'A' });
    await h.post('/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] });
    await qualify(h.ids.collector);

    const res = await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() });
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('exam_not_passed');
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from task_claims`);
    expect(n!.n).toBe(0);
  });

  it('refuses a claim while the collector is not qualified, and while consent is short', async () => {
    const h = await harness();
    await h.post('/api/me/exam', { answers: [...EXAM_ANSWERS] });
    const pending = await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() });
    expect(pending.json().constraint).toBe('not_qualified');

    await qualify(h.ids.collector);
    const short = await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() });
    expect(short.json().constraint).toBe('agreements_incomplete');
  });

  it('never puts a constraint name in front of a collector', async () => {
    const h = await harness();
    await h.post('/api/me/exam', { answers: [...EXAM_ANSWERS] });
    const refusals = [
      await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() }),
      await h.post(`/api/me/tasks/${h.ids.taskDraft}/claims`, { id: uid() }),
      await h.post('/api/me/devices', { hardware_serial: 'NOSUCHSERIAL' }),
      await h.post('/api/me/devices', { hardware_serial: 'AZER00000RT' }),
    ];
    // A GET for a task that is not there is a 404, and carries the same
    // collector-facing name rather than a bare status.
    const missing = await h.get(`/api/me/tasks/${uid()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().constraint).toBe('task_not_found');

    for (const res of refusals) {
      expect(res.statusCode).toBe(409);
      const name = res.json().constraint as string;
      expect(COLLECTOR_API_REFUSALS.has(name), name).toBe(true);
      // The trigger's own names, and every other internal word, stay behind.
      expect(JSON.stringify(res.json())).not.toMatch(/task_claims_|devices_|_gate|_check/);
    }
  });

  // -- the task hall (APP-08, APP-09) ---------------------------------------

  it('lists published tasks with type, price, target, progress and slots', async () => {
    const h = await harness();
    const body = (await h.get('/api/me/tasks')).json();
    const names = body.tasks.map((t: { name: string }) => t.name);
    expect(names).toContain('housework');
    // A draft task is not the collector's business: no price, no terms, no row.
    expect(names).not.toContain('unpublished');

    const task = body.tasks.find((t: { id: string }) => t.id === h.ids.task);
    expect(task).toMatchObject({
      type: 'home_cooking',
      unit_price: '1200.0000',
      currency: 'VND',
      target_effective_duration_s: '180000.000000',
      collected_effective_s: '0',
      max_concurrent_claimants: 5,
      claimants: 0,
      remaining_slots: 5,
      claimed_by_me: false,
      claimable: true,
    });
  });

  it('counts progress from reviewed effective minutes, and nothing else', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' });
    await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() });
    const sessionId = uid();
    await h.post('/api/me/sessions', {
      id: sessionId,
      task_id: h.ids.task,
      device_serial: 'AZER76400FE',
      scenario: 'home',
      others_in_frame: false,
      sensitive_info_present: false,
    });

    // An episode on that session, reviewed at 2.5 effective minutes.
    const d = await db();
    const episodeId = uid();
    const ingestId = uid();
    const reviewId = uid();
    await d.execute(sql`insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at,
        ingest_count, collection_session_id, resolution_state, upload_path)
      values (${episodeId}, 'AZER76400FE', '20260813_072310', now(), now(), 1, ${sessionId}, 'resolved', 'A')`);
    await d.execute(sql`insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename,
        measured_duration_s, timing_source, timing_confidence, manifest_present, engine_version, host, ingested_at, record_json)
      values (${ingestId}, ${episodeId}, repeat('a', 64), 'ok', 'ego_AZER76400FE_20260813_072310', '180.000000',
              'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb)`);
    await d.execute(sql`insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, effective_duration_s,
        review_state, reviewed_at, verdict_id)
      values (${reviewId}, ${episodeId}, ${ingestId}, '180.000000', '150.000000', 'pass', now(), ${uid()})`);
    // `settlements_claim_required`: a settlement names the claim that entitled
    // somebody to record it — and here that is the claim the app's own session
    // route snapshotted, which is the point of the join.
    const [session] = await rows<{ claim: string }>(
      sql`select task_claim_id as claim from collection_sessions where id = ${sessionId}`,
    );
    await d.execute(sql`insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes, amount, settlement_state)
      values (${uid()}, ${reviewId}, ${h.ids.task}, ${session!.claim}, '1200.0000', '2.500000', '3000.0000', 'pending_settlement')`);

    const task = (await h.get(`/api/me/tasks/${h.ids.task}`)).json();
    // 2.5 reviewed minutes is 150 seconds against a 180,000 second target.
    expect(Number(task.collected_effective_s)).toBe(150);
  });

  it('shows a task the collector still holds after it is taken down, and says it is not claimable', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() });
    await (await db()).execute(
      sql`update tasks set status = 'taken_down' where id = ${h.ids.task}`,
    );
    const one = await h.get(`/api/me/tasks/${h.ids.task}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().claimable).toBe(false);
    // And a task nobody holds and nobody published is still not there.
    expect((await h.get(`/api/me/tasks/${h.ids.taskDraft}`)).json().constraint).toBe('task_not_found');
  });

  // -- claiming (APP-10, APP-11) --------------------------------------------

  it('claims a task once the whole gate is cleared, and lists it', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    const claimId = uid();
    const res = await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: claimId });
    expect(res.statusCode).toBe(201);

    const mine = (await h.get('/api/me/claims')).json().claims;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: claimId, task_id: h.ids.task, task_name: 'housework' });

    const hall = (await h.get('/api/me/tasks')).json().tasks;
    const task = hall.find((t: { id: string }) => t.id === h.ids.task);
    expect(task).toMatchObject({ claimants: 1, remaining_slots: 4, claimed_by_me: true, claimable: false });
  });

  it('caps a task at its maximum concurrent claimants, counting other collectors', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    // The one-slot task, taken by somebody else first.
    const other = h.who(h.ids.other);
    await h.post('/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] }, other);
    await h.post('/api/me/exam', { answers: [...EXAM_ANSWERS] }, other);
    expect(
      (await h.post(`/api/me/tasks/${h.ids.taskFull}/claims`, { id: uid() }, other)).statusCode,
    ).toBe(201);

    const res = await h.post(`/api/me/tasks/${h.ids.taskFull}/claims`, { id: uid() });
    expect(res.json().constraint).toBe('task_at_capacity');
  });

  it('replays a claim on the same id, and refuses that id for anything else', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    const claimId = uid();
    await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: claimId });

    const replay = await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: claimId });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);

    const reused = await h.post(`/api/me/tasks/${h.ids.taskFull}/claims`, { id: claimId });
    expect(reused.json().constraint).toBe('claim_id_reused');
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from task_claims`);
    expect(n!.n).toBe(1);
  });

  it('refuses a released claim id rather than reviving it', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    const claimId = uid();
    await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: claimId });
    await (await db()).execute(sql`update task_claims set released_at = now() where id = ${claimId}`);
    const res = await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: claimId });
    expect(res.json().constraint).toBe('claim_released');
    // And the released claim is not "my task" any more.
    expect((await h.get('/api/me/claims')).json().claims).toHaveLength(0);
  });

  it('refuses a claim on a task that is not published', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    const res = await h.post(`/api/me/tasks/${h.ids.taskDraft}/claims`, { id: uid() });
    expect(res.json().constraint).toBe('task_not_claimable');
  });

  // -- devices (APP-14, APP-18) ---------------------------------------------

  it('binds a camera by its serial and opens the custody period with it', async () => {
    const h = await harness();
    const res = await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' });
    expect(res.statusCode).toBe(201);

    const [device] = await rows<{ bound: string; at: Date }>(
      sql`select bound_collector_id as bound, bound_at as at from devices where id = ${h.ids.device}`,
    );
    expect(device!.bound).toBe(h.ids.collector);
    // The column and `device_assignments` are two answers to "who holds it",
    // and a bind that wrote only the column is bridge F-1 all over again.
    const periods = await rows<{ collector_id: string; valid_to: Date | null }>(
      sql`select collector_id, valid_to from device_assignments where device_id = ${h.ids.device}`,
    );
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ collector_id: h.ids.collector, valid_to: null });
  });

  it('lists bound devices without the operator’s fault note', async () => {
    const h = await harness();
    await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' });
    const body = (await h.get('/api/me/devices')).json();
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({ hardware_serial: 'AZER76400FE', status: 'active' });
    expect(JSON.stringify(body)).not.toContain('water damage');
  });

  it('refuses an unknown serial, a retired camera, and one somebody else holds', async () => {
    const h = await harness();
    expect((await h.post('/api/me/devices', { hardware_serial: 'NOSUCH' })).json().constraint).toBe(
      'device_not_found',
    );
    expect(
      (await h.post('/api/me/devices', { hardware_serial: 'AZER00000RT' })).json().constraint,
    ).toBe('device_not_available');

    await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' }, h.who(h.ids.other));
    const taken = await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' });
    expect(taken.json().constraint).toBe('already_bound');
  });

  it('replays a bind the collector already holds', async () => {
    const h = await harness();
    await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' });
    const again = await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' });
    expect(again.statusCode).toBe(200);
    expect(again.json().replayed).toBe(true);
    const [n] = await rows<{ n: number }>(
      sql`select count(*)::int as n from device_assignments where device_id = ${h.ids.device}`,
    );
    expect(n!.n).toBe(1);
  });

  // -- sessions (APP-16, APP-17b) -------------------------------------------

  const sessionBody = (id: string, taskId: string) => ({
    id,
    task_id: taskId,
    device_serial: 'AZER76400FE',
    scenario: 'home',
    others_in_frame: true,
    sensitive_info_present: false,
  });

  /** Everything a session needs behind it: the gate, a claim and a camera. */
  const ready = async (h: Awaited<ReturnType<typeof harness>>) => {
    await onboard(h);
    await qualify(h.ids.collector);
    await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() });
    await h.post('/api/me/devices', { hardware_serial: 'AZER76400FE' });
  };

  it('creates an app-origin session carrying the claim’s price and both declarations', async () => {
    const h = await harness();
    await ready(h);
    const id = uid();
    const res = await h.post('/api/me/sessions', sessionBody(id, h.ids.task));
    expect(res.statusCode).toBe(201);

    const [row] = await rows<{
      origin: string;
      handover_id: string | null;
      unit_price: string;
      currency: string;
      others: boolean;
      sensitive: boolean;
      claim: string | null;
      collector: string;
    }>(sql`select session_origin as origin, handover_id, unit_price, currency,
                  others_in_frame as others, sensitive_info_present as sensitive,
                  task_claim_id as claim, collector_id as collector
             from collection_sessions where id = ${id}`);
    expect(row).toMatchObject({
      origin: 'app',
      handover_id: null,
      unit_price: '1200.0000',
      currency: 'VND',
      others: true,
      sensitive: false,
      collector: h.ids.collector,
    });
    expect(row!.claim).not.toBeNull();

    // P2-01: the device binds through the join table, one per session.
    const [dev] = await rows<{ device_id: string; role: string }>(
      sql`select device_id, role from collection_session_devices where collection_session_id = ${id}`,
    );
    expect(dev).toMatchObject({ device_id: h.ids.device, role: 'headset' });

    const list = (await h.get('/api/me/sessions')).json().sessions;
    expect(list[0]).toMatchObject({
      id,
      task_name: 'housework',
      scenario: 'home',
      device_serial: 'AZER76400FE',
      others_in_frame: true,
    });
  });

  it('refuses a session on a camera the collector has not bound (APP-15)', async () => {
    const h = await harness();
    await onboard(h);
    await qualify(h.ids.collector);
    await h.post(`/api/me/tasks/${h.ids.task}/claims`, { id: uid() });
    const res = await h.post('/api/me/sessions', sessionBody(uid(), h.ids.task));
    expect(res.json().constraint).toBe('device_not_bound');
  });

  it('refuses a session on a task the collector does not hold', async () => {
    const h = await harness();
    await ready(h);
    const res = await h.post('/api/me/sessions', sessionBody(uid(), h.ids.taskFull));
    expect(res.json().constraint).toBe('task_not_claimed');
  });

  it('refuses a scenario this platform does not record', async () => {
    const h = await harness();
    await ready(h);
    const res = await h.post('/api/me/sessions', {
      ...sessionBody(uid(), h.ids.task),
      scenario: 'submarine',
    });
    expect(res.json().constraint).toBe('scenario_not_found');
  });

  it('refuses a session with a declaration missing rather than defaulting it', async () => {
    const h = await harness();
    await ready(h);
    const body = sessionBody(uid(), h.ids.task) as Record<string, unknown>;
    delete body['sensitive_info_present'];
    expect((await h.post('/api/me/sessions', body)).statusCode).toBe(400);
  });

  it('replays a session on the same id, and refuses that id for a different declaration', async () => {
    const h = await harness();
    await ready(h);
    const id = uid();
    await h.post('/api/me/sessions', sessionBody(id, h.ids.task));

    const replay = await h.post('/api/me/sessions', sessionBody(id, h.ids.task));
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);

    const changed = await h.post('/api/me/sessions', {
      ...sessionBody(id, h.ids.task),
      others_in_frame: false,
    });
    expect(changed.json().constraint).toBe('session_id_reused');
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from collection_sessions`);
    expect(n!.n).toBe(1);
  });

  // -- the audit trail (PLT-07, PLT-08) -------------------------------------

  it('attributes every write to the collector, and to nobody on the staff', async () => {
    const h = await harness();
    await ready(h);
    await h.post('/api/me/sessions', sessionBody(uid(), h.ids.task));

    const audit = await rows<{
      action: string;
      actor_role: string;
      collector_id: string;
      operator_id: string | null;
      upload_device_id: string | null;
    }>(sql`select action, actor_role, collector_id, operator_id, upload_device_id
             from audit_events where actor_role = 'collector' and action not like '%.login'`);
    expect(audit.map((a) => a.action).sort()).toEqual([
      'collector.accept_agreements',
      'collector.bind_device',
      'collector.claim',
      'collector.create_session',
      'collector.exam',
      'collector.register',
      'collector.training_complete',
    ]);
    for (const row of audit) {
      expect(row.collector_id).toBe(h.ids.collector);
      expect(row.operator_id).toBeNull();
      expect(row.upload_device_id).toBeNull();
    }
  });

  // -- the sentences --------------------------------------------------------

  it('has an English, a Chinese and a Vietnamese sentence for every refusal it raises', () => {
    for (const constraint of COLLECTOR_API_REFUSALS) {
      for (const locale of LOCALES) {
        const key = `bo.refused.${constraint}` as keyof typeof MESSAGES.en;
        expect(MESSAGES[locale][key], `no ${locale} sentence for ${constraint}`).toBeTruthy();
      }
    }
  });

  it('names no constraint, no reason code and no person in any of those sentences', () => {
    for (const constraint of COLLECTOR_API_REFUSALS) {
      const en = MESSAGES.en[`bo.refused.${constraint}` as keyof typeof MESSAGES.en] as string;
      for (const word of ['task_claims', 'collector_agreements', 'devices_', 'reviewer', '_gate']) {
        expect(en.toLowerCase(), `${constraint} / ${word}`).not.toContain(word);
      }
    }
  });
});

/** The app fixed the six names and this server is the authority on them. */
describe('the agreements this server presents', () => {
  it('is the closed set the collector_agreements CHECK carries', () => {
    expect(CURRENT_AGREEMENTS.map((a) => a.agreement)).toEqual([
      'user',
      'privacy',
      'data_collection',
      'commercial_use',
      'manual_review',
      'offline_settlement',
    ]);
  });
});
