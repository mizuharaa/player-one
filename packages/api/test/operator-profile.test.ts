import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApi, MACHINE_COOKIE, OPERATOR_COOKIE, signToken } from '../src/index.ts';
import { operatorActivityWindow } from '../src/operator-profile.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

useDatabase(`api_operator_profile_${randomUUID().replaceAll('-', '').slice(0, 10)}`);
const SECRET = 'operator-profile-test-signing-key';
const NOW = new Date('2026-09-09T17:00:00.000Z'); // Midnight Sep 10 in Vietnam.
const PATH = '/api/operator/profile';

describe('operator activity calendar', () => {
  it('rolls over at 17:00 UTC and keeps exactly 84 consecutive local dates', () => {
    const before = operatorActivityWindow(new Date(NOW.getTime() - 1));
    const after = operatorActivityWindow(NOW);
    expect(before.to).toBe('2026-09-09');
    expect(after.to).toBe('2026-09-10');
    expect(after.from).toBe('2026-06-19');
    expect(after.start).toBe('2026-06-19T00:00:00+07:00');
    expect(after.dates).toHaveLength(84);
    for (let i = 1; i < after.dates.length; i++) {
      expect(Date.parse(after.dates[i]!) - Date.parse(after.dates[i - 1]!)).toBe(86_400_000);
    }
  });

  it('crosses year and leap-day boundaries without losing calendar dates', () => {
    const window = operatorActivityWindow(new Date('2024-03-01T01:00:00Z'));
    expect(window.from).toBe('2023-12-09');
    expect(window.dates.slice(-3)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });
});

describe.skipIf(!hasDb())('own operator profile API', () => {
  let app: Awaited<ReturnType<typeof buildApi>>;
  let ids: { centre: string; otherCentre: string; machine: string; operator: string; peer: string; other: string; reviewer: string };
  let headers: { authorization: string; 'x-machine-token': string };

  beforeEach(async () => {
    await truncate();
    const d = await db();
    ids = { centre: randomUUID(), otherCentre: randomUUID(), machine: randomUUID(),
      operator: randomUUID(), peer: randomUUID(), other: randomUUID(), reviewer: randomUUID() };
    await d.execute(sql`insert into upload_centres (id, region, name, status) values
      (${ids.centre}, 'HCM', 'Test HCM', 'active'), (${ids.otherCentre}, 'HAN', 'Test HAN', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status)
      values (${ids.machine}, ${ids.centre}, 'PROFILE-TEST', 'active')`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
      (${ids.operator}, ${ids.centre}, 'profile-own', 'centre_operator', 'never-return-this-hash'),
      (${ids.peer}, ${ids.centre}, 'profile-peer', 'centre_operator', null),
      (${ids.other}, ${ids.otherCentre}, 'profile-other', 'centre_operator', null),
      (${ids.reviewer}, null, 'profile-reviewer', 'reviewer', null)`);
    app = await buildApi({ db: await appDb(), tokenSecret: SECRET });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    headers = {
      authorization: `Bearer ${signToken(SECRET, { kind: 'operator', operatorId: ids.operator, uploadCentreId: ids.centre })}`,
      'x-machine-token': `Bearer ${signToken(SECRET, { kind: 'machine', uploadDeviceId: ids.machine, uploadCentreId: ids.centre })}`,
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await app?.close();
  });
  afterAll(closeDb);

  async function event(at: string, action = 'task.create', operator = ids.operator, centre = ids.centre) {
    await (await db()).execute(sql`insert into audit_events
      (occurred_at, action, target_table, target_id, operator_id, upload_device_id, upload_centre_id, after)
      values (${at}::timestamptz, ${action}, 'tasks', 'private-target', ${operator}, ${ids.machine}, ${centre},
        '{"private":"never-return-audit-payload"}'::jsonb)`);
  }

  it('returns only real own identity and a confirmed empty 84-day series via browser cookies', async () => {
    const res = await app.inject({ url: PATH, headers: { cookie:
      `${OPERATOR_COOKIE}=${headers.authorization.slice(7)}; ${MACHINE_COOKIE}=${headers['x-machine-token'].slice(7)}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().operator).toEqual({ id: ids.operator, external_ref: 'profile-own', role: 'centre_operator',
      status: 'active', centre: { id: ids.centre, name: 'Test HCM', region: 'HCM' } });
    expect(res.json().activity).toMatchObject({ timezone: 'Asia/Ho_Chi_Minh', from: '2026-06-19', to: '2026-09-10',
      total_actions: 0, active_days: 0, scope: 'recorded_operator_actions' });
    expect(res.json().activity.days).toHaveLength(84);
    expect(res.json().activity.days.every((day: { count: number }) => day.count === 0)).toBe(true);
    expect(res.body).not.toContain('hash');
    expect(res.body).not.toContain(ids.peer);
  });

  it('isolates own events, ignores supplied identity/range parameters and excludes authentication', async () => {
    await event('2026-09-09T10:00:00Z');
    await event('2026-09-09T10:00:01Z', 'session.create');
    await event('2026-09-09T10:00:02Z', 'operator.login');
    await event('2026-09-09T10:00:03Z', 'operator.login_failed');
    await event('2026-09-09T10:00:04Z', 'task.create', ids.peer);
    await event('2026-09-09T10:00:05Z', 'task.create', ids.other, ids.otherCentre);
    const res = await app.inject({ url: `${PATH}?operator_id=${ids.peer}&from=1900-01-01&to=2100-01-01`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().operator.id).toBe(ids.operator);
    expect(res.json().activity).toMatchObject({ from: '2026-06-19', to: '2026-09-10', total_actions: 2, active_days: 1 });
    expect(res.json().activity.days.find((day: { date: string }) => day.date === '2026-09-09').count).toBe(2);
    for (const secret of ['private-target', 'never-return-audit-payload', ids.peer, ids.other]) expect(res.body).not.toContain(secret);
  });

  it('includes the lower midnight and now, groups the UTC rollover correctly, and excludes all future events', async () => {
    await event('2026-06-18T16:59:59.999Z'); // Too old.
    await event('2026-06-18T17:00:00.000Z'); // First day midnight.
    await event('2026-09-09T16:59:59.999Z'); // Yesterday in Vietnam.
    await event('2026-09-09T17:00:00.000Z'); // Today, exactly now.
    await event('2026-09-09T17:00:00.001Z'); // Same date, future.
    await event('2026-09-10T17:00:00.000Z'); // Tomorrow, future.
    const res = await app.inject({ url: PATH, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().activity).toMatchObject({ total_actions: 3, active_days: 3 });
    expect(res.json().activity.days.filter((day: { count: number }) => day.count > 0)).toEqual([
      { date: '2026-06-19', count: 1 }, { date: '2026-09-09', count: 1 }, { date: '2026-09-10', count: 1 },
    ]);
  });

  it('requires both valid matching operator and machine credentials', async () => {
    for (const h of [{}, { authorization: headers.authorization }, { 'x-machine-token': headers['x-machine-token'] },
      { ...headers, authorization: 'Bearer invalid' }]) {
      expect((await app.inject({ url: PATH, headers: h })).statusCode).toBe(401);
    }
    const otherMachine = signToken(SECRET, { kind: 'machine', uploadDeviceId: randomUUID(), uploadCentreId: ids.otherCentre });
    expect((await app.inject({ url: PATH, headers: { ...headers, 'x-machine-token': `Bearer ${otherMachine}` } })).statusCode).toBe(403);
  });

  it('preserves reviewer and collector scope boundaries', async () => {
    const tokens = [
      signToken(SECRET, { kind: 'reviewer', reviewerId: ids.reviewer }),
      signToken(SECRET, { kind: 'collector', collectorId: randomUUID(), epoch: 1 }),
    ];
    for (const token of tokens) {
      expect((await app.inject({ url: PATH, headers: { ...headers, authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    }
  });

  it('reads current role and rejects retirement on an already issued session', async () => {
    for (const role of ['admin', 'finance']) {
      await (await db()).execute(sql`update operators set role = ${role} where id = ${ids.operator}`);
      const res = await app.inject({ url: PATH, headers });
      expect(res.statusCode).toBe(200);
      expect(res.json().operator.role).toBe(role);
    }
    await (await db()).execute(sql`update operators set status = 'retired' where id = ${ids.operator}`);
    const res = await app.inject({ url: PATH, headers });
    expect(res.statusCode).toBe(401);
    expect(res.json()).not.toHaveProperty('activity');
  });

  it('returns the standard referenced 500 when activity fails instead of a fabricated zero', async () => {
    vi.spyOn(await appDb(), 'execute').mockRejectedValueOnce(new Error('private database failure'));
    const res = await app.inject({ url: PATH, headers });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal', ref: expect.any(String) });
    expect(res.body).not.toContain('private database failure');
    expect(res.json()).not.toHaveProperty('activity');
  });
});
