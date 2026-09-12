import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { open, type Db } from '../../store/src/index.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase, violates } from '../../store/test/db.ts';
import { buildApi, signToken } from '../src/index.ts';

useDatabase('claim_recovery');
const uid = () => randomUUID();
const secret = 'claim-recovery-test';

describe.skipIf(!hasDb())('APP-10 / NFR-03: concurrent claims and lost responses', () => {
  const apps: ReturnType<typeof buildApi>[] = [];
  const connections: Db[] = [];
  beforeEach(truncate);
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(connections.splice(0).map((connection) => connection.close()));
  });
  afterAll(closeDb);

  async function fixture() {
    const d = await db();
    const collector = uid(), other = uid(), task = uid(), secondTask = uid();
    await d.execute(sql`insert into collectors (id, external_ref, status, exam_result, exam_decided_at)
      values (${collector}, 'claim-a', 'qualified', 'pass', now()),
             (${other}, 'claim-b', 'qualified', 'pass', now())`);
    await d.execute(sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
      select c.id, a, 'v1', now() from collectors c cross join
      unnest(array['user','privacy','data_collection','commercial_use','manual_review','offline_settlement']) a`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
      values (${task}, 'housework', 1200, 1, 'published'), (${secondTask}, 'office', 900, 1, 'published')`);
    const headers = (id = collector) => ({
      authorization: `Bearer ${signToken(secret, { kind: 'collector', collectorId: id, epoch: 1 })}`,
    });
    // Each server has its own connection: Promise.all on db()'s one-connection
    // pool would serialise the writes before PostgreSQL could exercise its lock.
    const server = async () => {
      const url = new URL(dbUrl());
      const role = process.env['PLAYERONE_DB_ROLE'];
      if (role) url.searchParams.set('role', role);
      const connection = await open(url.toString(), { max: 2 });
      connections.push(connection);
      if (role) {
        const [actual] = await connection.execute(sql`select current_user as role, rolsuper, rolbypassrls
          from pg_roles where rolname = current_user`);
        expect(actual).toEqual({ role, rolsuper: false, rolbypassrls: false });
      }
      const app = buildApi({ db: connection, tokenSecret: secret });
      apps.push(app);
      return app;
    };
    return { d, collector, other, task, secondTask, headers, server };
  }

  it('double tap with the same request id creates and audits one claim', async () => {
    const f = await fixture();
    const a = await f.server(), b = await f.server(), id = uid();
    const request = { method: 'POST' as const, url: `/api/me/tasks/${f.task}/claims`, headers: f.headers(), payload: { id } };
    const responses = await Promise.all([a.inject(request), b.inject(request)]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(responses[0]!.json().claimed_at).toBe(responses[1]!.json().claimed_at);
    const [counts] = await f.d.execute(sql`select
      (select count(*)::int from task_claims) as claims,
      (select count(*)::int from audit_events where action = 'collector.claim') as audits`);
    expect(counts).toEqual({ claims: 1, audits: 1 });
    const [money] = await f.d.execute(sql`select
      (select count(*)::int from settlements) as settlements,
      (select count(*)::int from bills) as bills,
      (select count(*)::int from payout_attempts) as attempts`);
    expect(money).toEqual({ settlements: 0, bills: 0, attempts: 0 });
  });

  it('two phones with different request ids cannot give one collector two live claims', async () => {
    const f = await fixture();
    // Leave capacity available so the unique index, not capacity, rejects it.
    await f.d.execute(sql`update tasks set max_concurrent_claimants = 2 where id = ${f.task}`);
    const a = await f.server(), b = await f.server();
    const request = { method: 'POST' as const, url: `/api/me/tasks/${f.task}/claims`, headers: f.headers() };
    const responses = await Promise.all([a.inject({ ...request, payload: { id: uid() } }), b.inject({ ...request, payload: { id: uid() } })]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.statusCode === 409)!.json().constraint).toBe('already_claimed');
    await violates('task_claims_live_key', f.d.execute(sql`insert into task_claims (id, task_id, collector_id)
      values (${uid()}, ${f.task}, ${f.collector})`));
    const recovered = (await b.inject({ url: '/api/me/claims', headers: f.headers() })).json().claims;
    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe(responses.find((r) => r.statusCode === 201)!.json().id);
  });

  it('two collectors racing for the last slot leave one winner, without filling another task', async () => {
    const f = await fixture();
    const a = await f.server(), b = await f.server();
    let pending: Promise<{ statusCode: number; json: () => { constraint: string } }> | undefined;
    try {
      await f.d.transaction(async (tx) => {
        await tx.execute(sql`insert into task_claims (id, task_id, collector_id) values (${uid()}, ${f.task}, ${f.collector})`);
        pending = a.inject({ method: 'POST', url: `/api/me/tasks/${f.task}/claims`, headers: f.headers(f.other), payload: { id: uid() } }).then((r) => r);
        await expect.poll(async () => {
          const [row] = await tx.execute(sql`select count(*)::int as waiting
            from pg_stat_activity where datname = current_database()
            and pg_backend_pid() = any(pg_blocking_pids(pid))`);
          return row!.waiting;
        }, { timeout: 10_000 }).toBe(1);
        // A different task must stay usable while this task is locked, and
        // the first collector may hold both: there is no collector-wide cap.
        expect((await b.inject({ method: 'POST', url: `/api/me/tasks/${f.secondTask}/claims`, headers: f.headers(), payload: { id: uid() } })).statusCode).toBe(201);
      });
      const response = await pending!;
      expect(response.statusCode).toBe(409);
      expect(response.json().constraint).toBe('task_at_capacity');
    } finally {
      await pending;
    }
    await violates('task_claims_capacity', f.d.execute(sql`insert into task_claims (id, task_id, collector_id)
      values (${uid()}, ${f.task}, ${f.collector})`));
    const counts = await f.d.execute(sql`select task_id, count(*)::int as n from task_claims where released_at is null group by task_id`);
    expect(counts).toHaveLength(2);
    expect(counts.every((r) => r.n === 1)).toBe(true);
  }, 20_000);

  it('recovers a committed claim after its response is lost, server restart and task withdrawal', async () => {
    const f = await fixture();
    const app = await f.server(), id = uid();
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.method === 'POST' && reply.statusCode === 201) reply.raw.destroy();
      return payload;
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    await expect(fetch(`${address}/api/me/tasks/${f.task}/claims`, {
      method: 'POST', headers: { ...f.headers(), 'content-type': 'application/json' }, body: JSON.stringify({ id }),
    })).rejects.toThrow();
    const [original] = await f.d.execute(sql`select id, claimed_at from task_claims where id = ${id}`);
    expect(original).toBeDefined();
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    await f.d.execute(sql`update tasks set status = 'taken_down' where id = ${f.task}`);
    const restarted = await f.server();
    const replay = await restarted.inject({ method: 'POST', url: `/api/me/tasks/${f.task}/claims`, headers: f.headers(), payload: { id } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ id, replayed: true, claimed_at: new Date(original!.claimed_at as string).toISOString() });
    const mine = (await restarted.inject({ url: '/api/me/claims', headers: f.headers() })).json().claims;
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(id);
    const foreignReplay = await restarted.inject({ method: 'POST', url: `/api/me/tasks/${f.task}/claims`, headers: f.headers(f.other), payload: { id } });
    expect(foreignReplay.statusCode).toBe(409);
    expect(foreignReplay.json().constraint).toBe('claim_id_reused');
  });

  it('a claim waiting behind task withdrawal observes the committed taken-down state', async () => {
    const f = await fixture();
    const app = await f.server();
    let pending: Promise<{ statusCode: number; json: () => { constraint: string } }> | undefined;
    try {
      await f.d.transaction(async (tx) => {
        await tx.execute(sql`update tasks set status = 'taken_down' where id = ${f.task}`);
        pending = app.inject({ method: 'POST', url: `/api/me/tasks/${f.task}/claims`, headers: f.headers(), payload: { id: uid() } }).then((r) => r);
        // Observe PostgreSQL's actual blocker, not a sleep that assumes the
        // request reached the trigger. Without the task lock this must fail.
        await expect.poll(async () => {
          const [row] = await tx.execute(sql`select count(*)::int as waiting
            from pg_stat_activity where datname = current_database()
            and pg_backend_pid() = any(pg_blocking_pids(pid))`);
          return row!.waiting;
        }, { timeout: 10_000 }).toBe(1);
      });
      const response = await pending!;
      expect(response.statusCode).toBe(409);
      expect(response.json().constraint).toBe('task_not_claimable');
      await violates('task_claims_published_gate', f.d.execute(sql`insert into task_claims (id, task_id, collector_id)
        values (${uid()}, ${f.task}, ${f.collector})`));
      const [row] = await f.d.execute(sql`select count(*)::int as n from task_claims`);
      expect(row!.n).toBe(0);
    } finally {
      await pending;
    }
  }, 20_000);
});
