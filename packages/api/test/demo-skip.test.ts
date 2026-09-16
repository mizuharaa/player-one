import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, signToken, verifyToken } from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

useDatabase('demo_skip');
const secret = 'demo-skip-test-secret', key = 'demo-skip-test-key-'.repeat(4);
const id = randomUUID(), other = randomUUID();

it('rejects malformed and forged demo capabilities without invalidating ordinary tokens', () => {
  const base = { kind: 'collector' as const, collectorId: id, epoch: 1 };
  expect(verifyToken(secret, signToken(secret, base))).toEqual(expect.objectContaining(base));
  expect(verifyToken(secret, signToken(secret, { ...base, demoRunId: 'admin' }))).toBeNull();
  const token = signToken(secret, base);
  const body = Buffer.from(JSON.stringify({ ...base, demoRunId: randomUUID(), exp: 9999999999 })).toString('base64url');
  expect(verifyToken(secret, `${body}.${token.split('.')[1]}`)).toBeNull();
});

describe.skipIf(!hasDb())('audited preview navigation', () => {
  beforeEach(async () => {
    await truncate();
    await (await db()).execute(sql`insert into collectors(id, external_ref, phone, status) values
      (${id}, 'demo-collector', '+84900000491', 'prospect'),
      (${other}, 'other-demo-skip', '+84900000492', 'prospect')`);
  });
  afterAll(closeDb);
  const app = async (enabled = true) => buildApi({ db: await appDb(), tokenSecret: secret, ...(enabled ? { demoBypassKey: key } : {}) });
  const login = async (a: Awaited<ReturnType<typeof app>>) => {
    const res = await a.inject({ method: 'POST', url: '/auth/collector/demo', payload: { key } });
    expect(res.statusCode).toBe(200);
    return { authorization: `Bearer ${res.json().token}` };
  };
  const skip = (a: Awaited<ReturnType<typeof app>>, headers: Record<string, string>, payload = { from: 'agreements', to: 'exam' }) =>
    a.inject({ method: 'POST', url: '/api/me/demo/skip', headers, payload });

  it('correlates login and skip, persists audit, and leaves every real gate unchanged', async () => {
    const a = await app();
    try {
      const headers = await login(a);
      const context = await a.inject({ method: 'GET', url: '/api/me/demo', headers });
      expect(context.json().runId).toMatch(/^[0-9a-f-]{36}$/);
      const result = await skip(a, headers);
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json()).toMatchObject({ runId: context.json().runId, outcome: 'preview_only' });
      const d = await db();
      const rows = await d.execute(sql`select action, actor_role, collector_id, after from audit_events order by id`);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.after).toMatchObject({ source: 'demo_bypass', demoRunId: context.json().runId });
      expect(rows[1]).toMatchObject({ action: 'collector.demo_skip', actor_role: 'collector', collector_id: id });
      expect(rows[1]!.after).toMatchObject({ from: 'agreements', to: 'exam', outcome: 'preview_only' });
      expect(JSON.stringify(rows)).not.toContain(key);
      const [state] = await d.execute(sql`select status, exam_result, training_completed_at,
        (select count(*)::int from collector_agreements) as agreements,
        (select count(*)::int from task_claims) as claims,
        (select count(*)::int from collection_sessions) as sessions,
        (select count(*)::int from settlements) as settlements from collectors where id=${id}`);
      expect(state).toMatchObject({ status: 'prospect', exam_result: null, training_completed_at: null, agreements: 0, claims: 0, sessions: 0, settlements: 0 });
    } finally { await a.close(); }
  });

  it('refuses ordinary, staff, forged, disabled and revoked sessions', async () => {
    const a = await app(), disabled = await app(false);
    try {
      for (const collectorId of [id, other]) {
        const headers = { authorization: `Bearer ${signToken(secret, { kind: 'collector', collectorId, epoch: 1 })}` };
        expect((await a.inject({ method: 'GET', url: '/api/me/demo', headers })).json()).toEqual({ runId: null });
        expect((await skip(a, headers)).statusCode).toBe(403);
      }
      const staff = { authorization: `Bearer ${signToken(secret, { kind: 'reviewer', reviewerId: randomUUID() })}` };
      expect((await skip(a, staff)).statusCode).toBe(403);
      const headers = await login(a);
      expect((await skip(disabled, headers)).statusCode).toBe(403);
      expect((await disabled.inject({ method: 'GET', url: '/api/me/demo', headers })).json()).toEqual({ runId: null });
      const token = headers.authorization.slice(7);
      const forged = `${token.split('.')[0]}.${'a'.repeat(43)}`;
      expect((await skip(a, { authorization: `Bearer ${forged}` })).statusCode).toBe(401);
      await (await db()).execute(sql`update collectors set token_epoch=2 where id=${id}`);
      expect((await skip(a, headers)).statusCode).toBe(401);
    } finally { await a.close(); await disabled.close(); }
  });

  it('refuses unlisted steps and caller-supplied authority', async () => {
    const a = await app();
    try {
      const headers = await login(a);
      for (const payload of [{ from: 'agreements', to: 'paid' }, { from: 'agreements', to: 'exam', admin: true }, { from: 'agreements', to: 'exam', runId: randomUUID() }]) {
        expect((await a.inject({ method: 'POST', url: '/api/me/demo/skip', headers, payload })).statusCode).toBe(400);
      }
      expect((await (await db()).execute(sql`select id from audit_events where action='collector.demo_skip'`))).toHaveLength(0);
    } finally { await a.close(); }
  });

  it('does not acknowledge navigation when the audit transaction fails', async () => {
    const a = await app();
    try {
      const headers = await login(a), d = await db();
      await d.execute(sql`alter table audit_events add constraint demo_skip_test_refusal check(action <> 'collector.demo_skip')`);
      try { expect((await skip(a, headers)).statusCode).toBe(500); }
      finally { await d.execute(sql`alter table audit_events drop constraint demo_skip_test_refusal`); }
      expect((await d.execute(sql`select id from audit_events where action='collector.demo_skip'`))).toHaveLength(0);
    } finally { await a.close(); }
  });
});
