import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { open, schema } from '@playerone/store';
import { COUNTER_REFUSALS, PAYOUT_API_REFUSALS, PAYOUT_REFUSALS, SETTLE_API_REFUSALS, API_REFUSALS, REFUSALS, buildApi, hashCredential } from '../src/index.ts';
import { MESSAGES } from '../src/i18n.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase, violates } from '../../store/test/db.ts';

useDatabase('backoffice');

/**
 * The back office: tasks, collectors and devices (BO-01 → BO-04, APP-05, SEC-04).
 *
 * Four things here are worth more than the CRUD around them, and each one has
 * its own test:
 *
 *   - the claimant cap holds under two *genuinely concurrent* claims for the
 *     last slot, on two separate connections, with the second proved to be
 *     waiting rather than merely late;
 *   - APP-05 refuses a claim with no exam pass at the database, not in a route;
 *   - task states move only the two legal ways, refused by the schema;
 *   - bind and unbind leave named audit rows (SEC-04).
 *
 * The fixture carries two of everything — two centres, two operators, two
 * collectors, two cards, two devices, two tasks — because the last payment bug
 * in this repo survived a full green suite on single-handover fixtures.
 */

const SECRET = 'test-signing-key';
const uid = () => randomUUID();

async function seed() {
  const d = await db();
  const ids = {
    centreA: uid(),
    centreB: uid(),
    machineA: uid(),
    machineB: uid(),
    operatorA: uid(),
    operatorB: uid(),
    collector1: uid(),
    collector2: uid(),
    /** Qualified, examined on demand, and has accepted nothing. The consent gate needs one. */
    collector3: uid(),
    deviceType: uid(),
    device1: uid(),
    device2: uid(),
    taskA: uid(),
    taskB: uid(),
    handover1: uid(),
    handover2: uid(),
  };
  const hash = await hashCredential('pw');

  await d.execute(sql`insert into upload_centres (id, region, name, status) values
    (${ids.centreA}, 'HCM', 'centre-a', 'active'),
    (${ids.centreB}, 'HAN', 'centre-b', 'active')`);
  await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values
    (${ids.machineA}, ${ids.centreA}, 'HCM-01', 'active', ${hash}),
    (${ids.machineB}, ${ids.centreB}, 'HAN-01', 'active', ${hash})`);
  await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
    (${ids.operatorA}, ${ids.centreA}, 'op-a', 'centre_operator', ${hash}),
    (${ids.operatorB}, ${ids.centreB}, 'op-b', 'centre_operator', ${hash})`);
  await d.execute(sql`insert into collectors (id, external_ref, status) values
    (${ids.collector1}, 'c-1', 'qualified'),
    (${ids.collector2}, 'c-2', 'qualified'),
    (${ids.collector3}, 'c-9', 'qualified')`);
  // PRODUCT.md gates claiming on all six agreements, so the two collectors that
  // are supposed to be able to claim have accepted them. `collector3` has not,
  // because acceptances are append-only and a test cannot delete one back out.
  for (const c of [ids.collector1, ids.collector2]) await consent(d, c);
  await d.execute(sql`insert into device_types (id, code, generation)
    values (${ids.deviceType}, 'ego_headset', 'gen1')`);
  await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, firmware_version, status) values
    (${ids.device1}, ${ids.deviceType}, 'AZER76400FE', '1.2.0', 'active'),
    (${ids.device2}, ${ids.deviceType}, 'AZER76400FF', '1.2.0', 'active')`);
  await d.execute(sql`insert into tasks (id, name, type, unit_price, max_concurrent_claimants, status) values
    (${ids.taskA}, 'housework', 'home', 1200.0000, 2, 'published'),
    (${ids.taskB}, 'assembly', 'factory', 1500.0000, 5, 'published')`);
  // Two cards, at two centres, so nothing here can be right by accident.
  await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time) values
    (${ids.handover1}, ${ids.collector1}, ${ids.device1}, 'CARD-0001', ${ids.centreA}, ${ids.operatorA}, now()),
    (${ids.handover2}, ${ids.collector2}, ${ids.device2}, 'CARD-0002', ${ids.centreB}, ${ids.operatorB}, now())`);
  return ids;
}

const SIX = [
  'user',
  'privacy',
  'data_collection',
  'commercial_use',
  'manual_review',
  'offline_settlement',
] as const;

/** All six acceptances, straight into the table; `task_claims_guard` counts them. */
async function consent(d: Awaited<ReturnType<typeof db>>, collectorId: string): Promise<void> {
  for (const agreement of SIX) {
    await d.execute(
      sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
          values (${collectorId}, ${agreement}, '2026-08-v1', now())`,
    );
  }
}

/** Records an exam result straight into the table; the gate reads this column. */
async function examined(collectorId: string, result: 'pass' | 'fail'): Promise<void> {
  const d = await db();
  await d.execute(
    sql`update collectors set exam_result = ${result}, exam_decided_at = now() where id = ${collectorId}`,
  );
}

describe.skipIf(!hasDb())('the back office', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const client = async (machine = 'HCM-01', operator = 'op-a') => {
    const app = buildApi({ db: await db(), tokenSecret: SECRET });
    const m = await app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: machine, secret: 'pw' },
    });
    const o = await app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: operator, secret: 'pw' },
    });
    const headers = {
      'x-machine-token': `Bearer ${m.json().token}`,
      authorization: `Bearer ${o.json().token}`,
    };
    const send = async (
      method: 'GET' | 'POST' | 'PATCH',
      url: string,
      payload?: Record<string, unknown>,
    ): Promise<LightMyRequestResponse> =>
      (await app.inject({ method, url, payload, headers })) as unknown as LightMyRequestResponse;

    return {
      app,
      get: (url: string) => send('GET', url),
      post: (url: string, payload?: Record<string, unknown>) => send('POST', url, payload),
      patch: (url: string, payload: Record<string, unknown>) => send('PATCH', url, payload),
    };
  };

  const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
    (await (await db()).execute(query)) as unknown as T[];

  const count = async (table: string): Promise<number> => {
    const r = await rows<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(table)}`);
    return r[0]!.n;
  };

  // -- BO-01 / BO-02: tasks -------------------------------------------------

  it('creates a task as a draft and configures what BO-02 asks for', async () => {
    await seed();
    const c = await client();
    const id = uid();
    const created = await c.post('/api/tasks', {
      id,
      name: 'kitchen work',
      type: 'home',
      unit_price: '1350.5000',
      target_effective_duration_s: '7200.000000',
      max_concurrent_claimants: 3,
    });
    expect(created.statusCode, created.body).toBe(201);

    const [task] = await rows<Record<string, unknown>>(
      sql`select type, unit_price, target_effective_duration_s, max_concurrent_claimants, status
            from tasks where id = ${id}`,
    );
    expect(task).toMatchObject({
      type: 'home',
      unit_price: '1350.5000',
      target_effective_duration_s: '7200.000000',
      max_concurrent_claimants: 3,
      // BO-01 separates creating from publishing, and so does this route.
      status: 'draft',
    });

    // The price is a decimal string all the way down. A float would arrive as
    // 1350.5 and lose the scale the settlement re-derives an amount from.
    expect(typeof task!['unit_price']).toBe('string');

    const same = {
      id,
      name: 'kitchen work',
      type: 'home',
      unit_price: '1350.5000',
      target_effective_duration_s: '7200.000000',
      max_concurrent_claimants: 3,
    };
    const replay = await c.post('/api/tasks', same);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(await count('tasks')).toBe(3);

    // The figure is compared by the column, not by the string: the same price
    // written with a shorter scale is the same price, and a replay of a form
    // that spelled it `1350.5` must not read as different terms.
    const shorter = await c.post('/api/tasks', { ...same, unit_price: '1350.5' });
    expect(shorter.statusCode, shorter.body).toBe(200);
    expect(shorter.json().replayed).toBe(true);
  });

  it('will not report a create as replayed when that id already names other terms', async () => {
    /**
     * The dangerous half of an idempotent create. `onConflictDoNothing` writes
     * nothing whether the row is identical or completely different, so a form
     * re-submitted with a corrected price used to answer 200 `replayed: true`
     * having changed nothing — the operator is told the new figure is what the
     * table holds, on the number every payment is multiplied by.
     */
    await seed();
    const c = await client();
    const id = uid();
    const body = {
      id,
      name: 'kitchen work',
      type: 'home',
      unit_price: '1350.5000',
      max_concurrent_claimants: 3,
    };
    expect((await c.post('/api/tasks', body)).statusCode).toBe(201);

    const changed = await c.post('/api/tasks', { ...body, unit_price: '1.0000' });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().constraint).toBe('tasks_id_reused');

    const [task] = await rows<{ unit_price: string }>(
      sql`select unit_price from tasks where id = ${id}`,
    );
    expect(task!.unit_price, 'the refused create must not have changed the price').toBe('1350.5000');

    // The same shape for the other two tables, because the same route pattern
    // wrote all three.
    const collector = uid();
    expect((await c.post('/api/collectors', { id: collector, external_ref: 'c-new' })).statusCode).toBe(201);
    const reused = await c.post('/api/collectors', { id: collector, external_ref: 'c-other' });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().constraint).toBe('collectors_id_reused');
  });

  it('refuses a unit price the column cannot hold, before Postgres has to', async () => {
    // numeric(12, 4) is eight digits before the point. Nine of them used to pass
    // validation and overflow in the database, which reaches the operator as a
    // 500 on a form they had no way of knowing was wrong.
    await seed();
    const c = await client();
    const res = await c.post('/api/tasks', {
      id: uid(),
      name: 'too much',
      type: 'home',
      unit_price: '123456789.0000',
      max_concurrent_claimants: 1,
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(await count('tasks')).toBe(2);

    // Eight digits is the largest the column holds, and it goes through.
    const ok = await c.post('/api/tasks', {
      id: uid(),
      name: 'a lot',
      type: 'home',
      unit_price: '12345678.0000',
      max_concurrent_claimants: 1,
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('walks a task draft -> published -> taken_down', async () => {
    await seed();
    const c = await client();
    const id = uid();
    await c.post('/api/tasks', {
      id,
      name: 'kitchen work',
      type: 'home',
      unit_price: '1350.0000',
      max_concurrent_claimants: 1,
    });
    expect((await c.patch(`/api/tasks/${id}`, { status: 'published' })).json().status).toBe('published');
    expect((await c.patch(`/api/tasks/${id}`, { status: 'taken_down' })).json().status).toBe('taken_down');
  });

  describe('BO-01: the schema refuses an illegal lifecycle move', () => {
    it('will not take a published task back to draft', async () => {
      const ids = await seed();
      const d = await db();
      await violates(
        'tasks_status_transition',
        d.execute(sql`update tasks set status = 'draft' where id = ${ids.taskA}`),
      );
    });

    it('will not revive a task that was taken down', async () => {
      const ids = await seed();
      const d = await db();
      await d.execute(sql`update tasks set status = 'taken_down' where id = ${ids.taskA}`);
      for (const target of ['published', 'draft']) {
        await violates(
          'tasks_status_transition',
          d.execute(sql`update tasks set status = ${target} where id = ${ids.taskA}`),
        );
      }
    });

    it('lets an edit that does not touch status through', async () => {
      const ids = await seed();
      const d = await db();
      await d.execute(sql`update tasks set status = status, name = 'renamed' where id = ${ids.taskA}`);
      const [row] = await rows<{ name: string }>(sql`select name from tasks where id = ${ids.taskA}`);
      expect(row!.name).toBe('renamed');
    });

    it('answers the console with a 409 rather than a 500', async () => {
      const ids = await seed();
      const c = await client();
      const res = await c.patch(`/api/tasks/${ids.taskA}`, { status: 'draft' });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('tasks_status_transition');
      // The refused change rolled back, and so did its audit row.
      const [task] = await rows<{ status: string }>(sql`select status from tasks where id = ${ids.taskA}`);
      expect(task!.status).toBe('published');
      expect(await count('audit_events')).toBe(2); // the two logins, nothing else
    });
  });

  // -- APP-05: no exam pass, no claim ---------------------------------------

  describe('APP-05: the exam gate is server-side', () => {
    it('refuses a claim from a collector nobody has examined', async () => {
      const ids = await seed();
      const c = await client();
      const res = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('task_claims_exam_gate');
      expect(await count('task_claims')).toBe(0);
    });

    it('refuses a claim from a collector who failed', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'fail');
      const c = await client();
      const res = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('task_claims_exam_gate');
    });

    it('refuses it at the database, with no application in the path', async () => {
      // The point of APP-05: a second writer that never calls this API is still
      // refused, so the gate is not "enforced only in the UI" or only in a route.
      const ids = await seed();
      const d = await db();
      await violates(
        'task_claims_exam_gate',
        d.execute(sql`insert into task_claims (id, task_id, collector_id)
                      values (${uid()}, ${ids.taskA}, ${ids.collector1})`),
      );
    });

    it('refuses a claim from a collector who has not accepted all six', async () => {
      // PRODUCT.md: six agreements, training and an exam, "enforced server-side,
      // not only in the UI". This is the agreements third of that sentence.
      const ids = await seed();
      await examined(ids.collector3, 'pass');
      const c = await client();
      const res = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector3,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('task_claims_consent_gate');
    });

    it('counts the six by name, so two versions of one are not two agreements', async () => {
      // Five agreements plus a reissued privacy policy is six ROWS and five
      // agreements. Counting rows would let that collector claim.
      const ids = await seed();
      await examined(ids.collector3, 'pass');
      const d = await db();
      for (const agreement of SIX.filter((a) => a !== 'privacy')) {
        await d.execute(
          sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
              values (${ids.collector3}, ${agreement}, '2026-08-v1', now())`,
        );
      }
      // The sixth row is a reissue of one already accepted, not the missing one.
      await d.execute(
        sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
            values (${ids.collector3}, 'user', '2026-09-v2', now())`,
      );
      const [n] = await rows<{ n: number }>(
        sql`select count(*)::int as n from collector_agreements where collector_id = ${ids.collector3}`,
      );
      expect(n!.n).toBe(6);

      const c = await client();
      const res = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector3,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('task_claims_consent_gate');
    });

    it('refuses a claim from a suspended collector holding an old pass', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      const d = await db();
      await d.execute(sql`update collectors set status = 'suspended' where id = ${ids.collector1}`);
      const c = await client();
      const res = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('task_claims_qualified_gate');
    });

    it('lets a pass through', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      const c = await client();
      const res = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(await count('task_claims')).toBe(1);
    });

    it('refuses a claim on a task that is not published', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      const d = await db();
      await d.execute(sql`update tasks set status = 'taken_down' where id = ${ids.taskA}`);
      const c = await client();
      const res = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('task_claims_published_gate');
    });
  });

  // -- APP-10 / BO-02: the claimant cap under concurrency --------------------

  describe('the claimant cap', () => {
    it('counts only the claims on its own task', async () => {
      // taskA caps at 2, taskB at 5. A cap that counted rows across tasks would
      // pass every sequential test and refuse the wrong person in production.
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      await examined(ids.collector2, 'pass');
      const c = await client();
      for (const collector of [ids.collector1, ids.collector2]) {
        expect(
          (await c.post(`/api/tasks/${ids.taskB}/claims`, { id: uid(), collector_id: collector }))
            .statusCode,
        ).toBe(201);
      }
      expect(
        (await c.post(`/api/tasks/${ids.taskA}/claims`, { id: uid(), collector_id: ids.collector1 }))
          .statusCode,
      ).toBe(201);
    });

    it('will not let one collector hold the same task twice', async () => {
      // Two claim ids, one pair. Without the partial unique index this reads as
      // two claimants and eats a second slot on a task capped at two.
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      const c = await client();
      const first = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(first.statusCode, first.body).toBe(201);
      const again = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().constraint).toBe('task_claims_live_key');
      expect(await count('task_claims')).toBe(1);
    });

    it('will not report a different pairing as a replay of an existing claim', async () => {
      // The reply to a create is the caller's only evidence. Answering
      // "replayed" to an id already used for somebody else says collector2
      // holds this task when collector1 does — on the path that decides who is
      // allowed to record and be paid.
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      await examined(ids.collector2, 'pass');
      const c = await client();
      const claim = uid();
      expect(
        (await c.post(`/api/tasks/${ids.taskA}/claims`, { id: claim, collector_id: ids.collector1 }))
          .statusCode,
      ).toBe(201);

      // Same id, same task, same collector: a genuine replay.
      const again = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: claim,
        collector_id: ids.collector1,
      });
      expect(again.statusCode).toBe(200);
      expect(again.json().replayed).toBe(true);

      // Same id, different collector: not a replay, and not a success.
      const other = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: claim,
        collector_id: ids.collector2,
      });
      expect(other.statusCode).toBe(409);
      expect(other.json().constraint).toBe('task_claims_id_reused');

      // Same id, different task: also not a replay.
      const elsewhere = await c.post(`/api/tasks/${ids.taskB}/claims`, {
        id: claim,
        collector_id: ids.collector1,
      });
      expect(elsewhere.statusCode).toBe(409);
      expect(elsewhere.json().constraint).toBe('task_claims_id_reused');
      expect(await count('task_claims')).toBe(1);
    });

    it('refuses the claim past the cap, sequentially', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      await examined(ids.collector2, 'pass');
      const d = await db();
      await d.execute(sql`update tasks set max_concurrent_claimants = 1 where id = ${ids.taskA}`);
      const c = await client();
      expect(
        (await c.post(`/api/tasks/${ids.taskA}/claims`, { id: uid(), collector_id: ids.collector1 }))
          .statusCode,
      ).toBe(201);
      const second = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: ids.collector2,
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().constraint).toBe('task_claims_capacity');
    });

    it('frees the slot when a claim is released, and re-checks on the way back in', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      await examined(ids.collector2, 'pass');
      const d = await db();
      await d.execute(sql`update tasks set max_concurrent_claimants = 1 where id = ${ids.taskA}`);
      const c = await client();
      const claim = uid();
      await c.post(`/api/tasks/${ids.taskA}/claims`, { id: claim, collector_id: ids.collector1 });
      expect((await c.post(`/api/task-claims/${claim}/release`)).statusCode).toBe(200);
      expect(
        (await c.post(`/api/tasks/${ids.taskA}/claims`, { id: uid(), collector_id: ids.collector2 }))
          .statusCode,
      ).toBe(201);

      // Un-releasing is claiming again, and clears the same gate. Without the
      // reclaim trigger this one UPDATE puts two claimants on a task capped at 1.
      await violates(
        'task_claims_capacity',
        d.execute(sql`update task_claims set released_at = null where id = ${claim}`),
      );
    });

    /**
     * The one that proves the design rather than the behaviour.
     *
     * Two connections, two open transactions, both inserting for the last slot.
     * The assertion that matters is the middle one: B's insert has NOT settled
     * while A holds the task row. A cap built from `select count(*)` in the
     * application, or from a CHECK, would let B return immediately and commit a
     * third claimant on a task capped at two.
     */
    it('serialises two genuinely concurrent claims for the last slot', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      await examined(ids.collector2, 'pass');
      const d = await db();
      await d.execute(sql`update tasks set max_concurrent_claimants = 1 where id = ${ids.taskA}`);

      // Two connections, so the two transactions are genuinely concurrent. One
      // pooled connection would serialise them before Postgres ever saw them,
      // and a broken lock would look correct.
      const a = await open(dbUrl(), { max: 1 });
      const b = await open(dbUrl(), { max: 1 });
      try {
        let inserted: () => void = () => {};
        let commit: () => void = () => {};
        const firstInserted = new Promise<void>((resolve) => (inserted = resolve));
        const held = new Promise<void>((resolve) => (commit = resolve));

        const first = a.transaction(async (tx) => {
          await tx
            .insert(schema.taskClaims)
            .values({ id: uid(), taskId: ids.taskA, collectorId: ids.collector1 });
          inserted();
          await held;
        });
        await firstInserted;

        /**
         * Started inside an async function on purpose, so that ONE insert runs.
         * A drizzle query is a lazy thenable: it executes on every `then`, so
         * attaching a settled-flag handler to the builder and then handing the
         * same builder to `violates()` runs the statement twice — the flag would
         * describe one attempt and the assertion a different one. Wrapping it
         * gives a plain promise that both observers share.
         */
        let settled = false;
        const second = (async () =>
          b.insert(schema.taskClaims).values({
            id: uid(),
            taskId: ids.taskA,
            collectorId: ids.collector2,
          }))();
        second.then(
          () => (settled = true),
          () => (settled = true),
        );

        // Long enough that a lock-free design would have finished many times over.
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(settled, 'the second claim did not wait for the first').toBe(false);

        commit();
        await first;
        await violates('task_claims_capacity', second);
      } finally {
        await a.close();
        await b.close();
      }

      const [live] = await rows<{ n: number }>(
        sql`select count(*)::int as n from task_claims where task_id = ${ids.taskA} and released_at is null`,
      );
      expect(live!.n).toBe(1);
    });

    it('will not lower the cap under the collectors already holding the task', async () => {
      /**
       * The insert path is not the only way past a cap. Editing the task down
       * to one, with two collectors already holding it, leaves a row reading
       * `2 / 1` — a state `task_claims_guard` says cannot exist, and one every
       * later reader of `max_concurrent_claimants` has to be taught to
       * distrust.
       */
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      await examined(ids.collector2, 'pass');
      const c = await client();
      const first = uid();
      await c.post(`/api/tasks/${ids.taskA}/claims`, { id: first, collector_id: ids.collector1 });
      await c.post(`/api/tasks/${ids.taskA}/claims`, { id: uid(), collector_id: ids.collector2 });

      const refused = await c.patch(`/api/tasks/${ids.taskA}`, { max_concurrent_claimants: 1 });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().constraint).toBe('tasks_capacity_below_live');

      // Raising is never in question, and neither is lowering to what is held.
      expect(
        (await c.patch(`/api/tasks/${ids.taskA}`, { max_concurrent_claimants: 5 })).statusCode,
      ).toBe(200);
      expect(
        (await c.patch(`/api/tasks/${ids.taskA}`, { max_concurrent_claimants: 2 })).statusCode,
      ).toBe(200);

      // And the wind-down that keeps the invariant true: release, then lower.
      await c.post(`/api/task-claims/${first}/release`);
      expect(
        (await c.patch(`/api/tasks/${ids.taskA}`, { max_concurrent_claimants: 1 })).statusCode,
      ).toBe(200);
    });

    /**
     * The cap edit and the claim insert take the same lock, which is the only
     * reason the pair is safe in either order.
     *
     * A trigger that merely counted would read its own snapshot, see one live
     * claim, allow the drop to one, and only then block on the row — and
     * Postgres does not re-run a BEFORE trigger after it re-fetches a row
     * another transaction updated, so the count would never be taken again.
     * The task ends up capped at one with two collectors on it.
     */
    it('will not lower the cap under a claim that is committing at the same moment', async () => {
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      await examined(ids.collector2, 'pass');
      const c = await client();
      await c.post(`/api/tasks/${ids.taskA}/claims`, { id: uid(), collector_id: ids.collector1 });

      const a = await open(dbUrl(), { max: 1 });
      const b = await open(dbUrl(), { max: 1 });
      try {
        let inserted: () => void = () => {};
        let commit: () => void = () => {};
        const claimInserted = new Promise<void>((resolve) => (inserted = resolve));
        const held = new Promise<void>((resolve) => (commit = resolve));

        // A second claim, in flight and uncommitted, holding the task row.
        const claiming = a.transaction(async (tx) => {
          await tx
            .insert(schema.taskClaims)
            .values({ id: uid(), taskId: ids.taskA, collectorId: ids.collector2 });
          inserted();
          await held;
        });
        await claimInserted;

        // Wrapped, so exactly one statement runs however many observers it has.
        let settled = false;
        const lowering = (async () =>
          b.execute(sql`update tasks set max_concurrent_claimants = 1 where id = ${ids.taskA}`))();
        lowering.then(
          () => (settled = true),
          () => (settled = true),
        );

        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(settled, 'the cap edit did not wait for the claim in flight').toBe(false);

        commit();
        await claiming;
        await violates('tasks_capacity_below_live', lowering);
      } finally {
        await a.close();
        await b.close();
      }

      const [task] = await rows<{ cap: number }>(
        sql`select max_concurrent_claimants as cap from tasks where id = ${ids.taskA}`,
      );
      expect(task!.cap, 'the cap must still be the one both claimants fit under').toBe(2);
    });
  });

  describe('a claim is a record, not a row', () => {
    it('refuses to delete a claim, to move its start, or to rewrite its release', async () => {
      /**
       * `released_at` rather than a delete is what makes a claim the evidence
       * behind a disputed payment. Until these triggers existed that was a
       * description of what the API happened to do: one DELETE erased the
       * claim, and one UPDATE moved the window it covered.
       */
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      const c = await client();
      const claim = uid();
      await c.post(`/api/tasks/${ids.taskA}/claims`, { id: claim, collector_id: ids.collector1 });
      const d = await db();

      await violates(
        'task_claims_history_immutable',
        d.execute(sql`delete from task_claims where id = ${claim}`),
      );
      await violates(
        'task_claims_history_immutable',
        d.execute(
          sql`update task_claims set claimed_at = now() - interval '1 day' where id = ${claim}`,
        ),
      );
      await violates(
        'task_claims_identity_immutable',
        d.execute(sql`update task_claims set task_id = ${ids.taskB} where id = ${claim}`),
      );
      await violates(
        'task_claims_identity_immutable',
        d.execute(sql`update task_claims set collector_id = ${ids.collector2} where id = ${claim}`),
      );

      // Releasing is the one legal change, and it happens once.
      expect((await c.post(`/api/task-claims/${claim}/release`)).statusCode).toBe(200);
      await violates(
        'task_claims_history_immutable',
        d.execute(
          sql`update task_claims set released_at = now() - interval '1 day' where id = ${claim}`,
        ),
      );

      /**
       * And un-releasing it, with the slot standing empty so that nothing else
       * can be what refuses. `task_claims_guard_reclaim` passes here — the cap
       * has room and the collector still qualifies — so the only thing left to
       * say no is the history trigger. Clearing `released_at` cannot reopen the
       * claim, because `claimed_at` is frozen: it would leave a row that reads
       * as held continuously since the original claim, which is the interval a
       * disputed payment is argued from.
       */
      await violates(
        'task_claims_history_immutable',
        d.execute(sql`update task_claims set released_at = null where id = ${claim}`),
      );

      const [row] = await rows<{ task_id: string; released_at: string | null }>(
        sql`select task_id, released_at from task_claims where id = ${claim}`,
      );
      expect(row!.task_id).toBe(ids.taskA);
      expect(row!.released_at).not.toBeNull();
    });

    it('will not report a released claim as one the collector still holds', async () => {
      /**
       * A replay is "you already have this". After a release the collector does
       * not: the slot went back to the task and somebody else may be in it. The
       * route used to answer 200 on the id and the pairing alone, which is the
       * one answer that decides who is allowed to record and be paid.
       */
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      const c = await client();
      const claim = uid();
      const body = { id: claim, collector_id: ids.collector1 };
      expect((await c.post(`/api/tasks/${ids.taskA}/claims`, body)).statusCode).toBe(201);

      const replay = await c.post(`/api/tasks/${ids.taskA}/claims`, body);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);

      await c.post(`/api/task-claims/${claim}/release`);
      const afterRelease = await c.post(`/api/tasks/${ids.taskA}/claims`, body);
      expect(afterRelease.statusCode).toBe(409);
      expect(afterRelease.json().constraint).toBe('task_claims_released');

      const [live] = await rows<{ n: number }>(
        sql`select count(*)::int as n from task_claims where id = ${claim} and released_at is null`,
      );
      expect(live!.n).toBe(0);
    });

    it('answers a repeated release with the moment it was released', async () => {
      // The second click of a release that already landed is the same request
      // arriving twice. A 404 there tells an operator whose first click worked
      // that the claim is gone, and the next thing they do is go looking for it.
      const ids = await seed();
      await examined(ids.collector1, 'pass');
      const c = await client();
      const claim = uid();
      await c.post(`/api/tasks/${ids.taskA}/claims`, { id: claim, collector_id: ids.collector1 });

      const first = await c.post(`/api/task-claims/${claim}/release`);
      expect(first.statusCode).toBe(200);
      expect(first.json().replayed).toBe(false);

      const again = await c.post(`/api/task-claims/${claim}/release`);
      expect(again.statusCode).toBe(200);
      expect(again.json().replayed).toBe(true);
      expect(again.json().released_at).toBe(first.json().released_at);

      // A claim id that never existed is still a 404.
      expect((await c.post(`/api/task-claims/${uid()}/release`)).statusCode).toBe(404);

      // One release, one audit row: the replay must not write a second.
      const [events] = await rows<{ n: number }>(
        sql`select count(*)::int as n from audit_events
             where action = 'task.release' and target_id = ${claim}`,
      );
      expect(events!.n).toBe(1);
    });
  });

  describe('the answer to a request that was simply malformed', () => {
    it('is 400 for an id that is not one, rather than a cast error from Postgres', async () => {
      const ids = await seed();
      const c = await client();
      for (const [method, url] of [
        ['PATCH', '/api/tasks/not-a-uuid'],
        ['PATCH', '/api/collectors/not-a-uuid'],
        ['PATCH', '/api/devices/not-a-uuid'],
        ['POST', '/api/tasks/not-a-uuid/claims'],
        ['POST', '/api/task-claims/not-a-uuid/release'],
        ['POST', '/api/devices/not-a-uuid/bind'],
        ['POST', '/api/devices/not-a-uuid/unbind'],
      ] as const) {
        const res =
          method === 'PATCH'
            ? await c.patch(url, { status: 'draft' })
            : await c.post(url, { id: uid(), collector_id: ids.collector1 });
        expect(res.statusCode, url).toBe(400);
      }
    });

    it('is 400 for an agreement version that is only whitespace', async () => {
      // `min(1)` accepts a space; `collector_agreements_version_check` does not,
      // and it fires below the route, where nothing turns it into a sentence.
      const ids = await seed();
      const c = await client();
      const res = await c.patch(`/api/collectors/${ids.collector3}`, {
        agreements: [{ agreement: 'user', version: '   ', accepted_at: new Date().toISOString() }],
      });
      expect(res.statusCode, res.body).toBe(400);
    });

    it('is 400 for a claimant cap the column cannot hold', async () => {
      // 2^31 is a positive whole number and an integer overflow.
      await seed();
      const c = await client();
      const res = await c.post('/api/tasks', {
        id: uid(),
        name: 'kitchen work',
        type: 'home',
        unit_price: '1200.0000',
        max_concurrent_claimants: 2147483648,
      });
      expect(res.statusCode, res.body).toBe(400);
    });

    it('names the row that vanished, rather than 500ing on its foreign key', async () => {
      /**
       * Every id here came off a list the operator was shown, and a list goes
       * stale. Claiming a task another operator has just removed is a person
       * asking for something that is not there any more — a sentence on the
       * screen, not a 500 with a constraint name in the server log.
       */
      const ids = await seed();
      const c = await client();
      const gone = await c.post(`/api/tasks/${uid()}/claims`, {
        id: uid(),
        collector_id: ids.collector1,
      });
      expect(gone.statusCode, gone.body).toBe(409);
      expect(gone.json().constraint).toBe('task_claims_task_id_tasks_id_fk');

      const noSuchCollector = await c.post(`/api/tasks/${ids.taskA}/claims`, {
        id: uid(),
        collector_id: uid(),
      });
      expect(noSuchCollector.statusCode).toBe(409);
      expect(noSuchCollector.json().constraint).toBe('task_claims_collector_id_collectors_id_fk');

      const bind = await c.post(`/api/devices/${ids.device1}/bind`, { collector_id: uid() });
      expect(bind.statusCode).toBe(409);
      expect(bind.json().constraint).toBe('devices_bound_collector_id_collectors_id_fk');

      const device = await c.post('/api/devices', {
        id: uid(),
        device_type_id: uid(),
        hardware_serial: 'AZER00000AA',
      });
      expect(device.statusCode).toBe(409);
      expect(device.json().constraint).toBe('devices_device_type_id_device_types_id_fk');
    });
  });

  // -- BO-03 / APP-02 / PRV-01: collectors ----------------------------------

  it('records all six agreements with the version and the moment accepted', async () => {
    await seed();
    const c = await client();
    const id = uid();
    const six = [
      'user',
      'privacy',
      'data_collection',
      'commercial_use',
      'manual_review',
      'offline_settlement',
    ];
    const created = await c.post('/api/collectors', {
      id,
      external_ref: 'c-3',
      agreements: six.map((agreement, i) => ({
        agreement,
        version: `2026-08-v${i + 1}`,
        accepted_at: '2026-08-20T03:00:00.000Z',
      })),
    });
    expect(created.statusCode, created.body).toBe(201);

    const accepted = await rows<{ agreement: string; version: string; accepted_at: string }>(
      sql`select agreement, version, accepted_at from collector_agreements
           where collector_id = ${id} order by agreement`,
    );
    expect(accepted.map((a) => a.agreement).sort()).toEqual([...six].sort());
    // PRV-01 wants a version AND a moment on every one of the six.
    expect(accepted.map((a) => a.version).filter((v) => v.length > 0)).toHaveLength(6);
    expect(accepted.map((a) => new Date(a.accepted_at).toISOString())).toEqual(
      Array<string>(6).fill('2026-08-20T03:00:00.000Z'),
    );

    const listed = await c.get('/api/collectors');
    expect(listed.json().required_agreements).toHaveLength(6);
    const mine = (listed.json().collectors as { id: string; agreements: unknown[] }[]).find(
      (x) => x.id === id,
    );
    expect(mine!.agreements).toHaveLength(6);
  });

  it('refuses an agreement name that is not one of the six', async () => {
    const ids = await seed();
    const d = await db();
    await violates(
      'collector_agreements_name_check',
      d.execute(sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
                    values (${ids.collector1}, 'marketing', 'v1', now())`),
    );
  });

  it('never rewrites an acceptance already on record', async () => {
    await seed();
    const c = await client();
    const id = uid();
    const one = (version: string) => ({
      id,
      external_ref: 'c-3',
      agreements: [{ agreement: 'privacy', version, accepted_at: '2026-08-20T03:00:00.000Z' }],
    });
    await c.post('/api/collectors', one('v1'));
    await c.patch(`/api/collectors/${id}`, {
      agreements: [{ agreement: 'privacy', version: 'v2', accepted_at: '2026-08-21T03:00:00.000Z' }],
    });
    // Both survive. Consent is evidence of what somebody agreed to on a day, and
    // the question a regulator asks needs the old row as much as the new one —
    // so this asserts the whole history, not that some row still says v1.
    const kept = await rows<{ version: string; accepted_at: Date }>(
      sql`select version, accepted_at from collector_agreements
           where collector_id = ${id} and agreement = 'privacy' order by version`,
    );
    expect(kept.map((r) => r.version)).toEqual(['v1', 'v2']);
    expect(kept.map((r) => new Date(r.accepted_at).toISOString())).toEqual([
      '2026-08-20T03:00:00.000Z',
      '2026-08-21T03:00:00.000Z',
    ]);
  });

  it('will not call a create a replay when its acceptances are not on record', async () => {
    /**
     * A create that conflicts on the id returns before the acceptances are
     * written, so `replayed: true` on the id and the reference alone reports
     * six consents as landed while the table holds none. The status is
     * deliberately NOT part of this comparison — it is what has happened to
     * the collector since, and comparing it would refuse the honest retry this
     * id exists to allow — but consent is evidence, and evidence has to exist.
     */
    await seed();
    const c = await client();
    const id = uid();
    expect((await c.post('/api/collectors', { id, external_ref: 'c-5' })).statusCode).toBe(201);

    const withConsent = await c.post('/api/collectors', {
      id,
      external_ref: 'c-5',
      agreements: [{ agreement: 'privacy', version: 'v1', accepted_at: '2026-08-20T03:00:00.000Z' }],
    });
    expect(withConsent.statusCode, withConsent.body).toBe(409);
    expect(withConsent.json().constraint).toBe('collectors_id_reused');
    expect(await count('collector_agreements')).toBe(12); // the fixture's two, unchanged

    // The same request once the acceptance really is on record replays cleanly,
    // and a status that moved underneath it does not make it a different one.
    await c.patch(`/api/collectors/${id}`, {
      agreements: [{ agreement: 'privacy', version: 'v1', accepted_at: '2026-08-20T03:00:00.000Z' }],
      status: 'qualified',
    });
    const again = await c.post('/api/collectors', {
      id,
      external_ref: 'c-5',
      status: 'pending',
      agreements: [{ agreement: 'privacy', version: 'v1', accepted_at: '2026-08-20T03:00:00.000Z' }],
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().replayed).toBe(true);
  });

  it('audits the acceptance that landed, not the one the form asked for', async () => {
    /**
     * `(collector, agreement, version)` is the key and the table is append-only,
     * so reposting a version already on record writes nothing and keeps the
     * original moment. The route used to audit the request body, which recorded
     * an `accepted_at` the consent table never held — and consent evidence that
     * disagrees with the consent table is the one kind of audit row worth less
     * than no row at all.
     */
    await seed();
    const c = await client();
    const id = uid();
    const at = (t: string) => ({
      agreements: [{ agreement: 'privacy', version: 'v1', accepted_at: t }],
    });
    await c.post('/api/collectors', { id, external_ref: 'c-4', ...at('2026-08-20T03:00:00.000Z') });
    // The same version again, claiming a different day.
    expect(
      (await c.patch(`/api/collectors/${id}`, at('2026-08-22T03:00:00.000Z'))).statusCode,
    ).toBe(200);

    const [stored] = await rows<{ accepted_at: Date }>(
      sql`select accepted_at from collector_agreements
           where collector_id = ${id} and agreement = 'privacy'`,
    );
    expect(new Date(stored!.accepted_at).toISOString()).toBe('2026-08-20T03:00:00.000Z');

    const [update] = await rows<{ after: { agreements: unknown[] } }>(
      sql`select after from audit_events
           where action = 'collector.update' and target_id = ${id}`,
    );
    // Nothing landed, so the trail claims nothing.
    expect(update!.after.agreements).toEqual([]);

    const [create] = await rows<{ after: { agreements: { accepted_at: string }[] } }>(
      sql`select after from audit_events
           where action = 'collector.create' and target_id = ${id}`,
    );
    expect(create!.after.agreements.map((a) => a.accepted_at)).toEqual([
      '2026-08-20T03:00:00.000Z',
    ]);
  });

  it('lets nothing rewrite or remove an acceptance, API or not', async () => {
    // Append-only was the intent; the trigger is what makes it true for a
    // writer that is not this API.
    const ids = await seed();
    const d = await db();
    await violates(
      'collector_agreements_append_only',
      d.execute(sql`update collector_agreements set version = 'tampered'
                     where collector_id = ${ids.collector1} and agreement = 'privacy'`),
    );
    await violates(
      'collector_agreements_append_only',
      d.execute(sql`delete from collector_agreements
                     where collector_id = ${ids.collector1} and agreement = 'privacy'`),
    );
  });

  it('records an exam result and its date together, or not at all', async () => {
    const ids = await seed();
    const c = await client();
    const res = await c.patch(`/api/collectors/${ids.collector1}`, {
      exam: { result: 'pass', decided_at: '2026-08-20T03:00:00.000Z' },
      status: 'qualified',
    });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await rows<{ exam_result: string; exam_decided_at: Date | null }>(
      sql`select exam_result, exam_decided_at from collectors where id = ${ids.collector1}`,
    );
    expect(row!.exam_result).toBe('pass');
    expect(row!.exam_decided_at).not.toBeNull();

    const d = await db();
    await violates(
      'collectors_exam_decided_check',
      d.execute(sql`update collectors set exam_decided_at = null where id = ${ids.collector1}`),
    );
  });

  // -- BO-04 / SEC-04: devices ----------------------------------------------

  describe('BO-04: binding, and the trail SEC-04 asks for', () => {
    it('binds and unbinds, and both land in audit_events', async () => {
      const ids = await seed();
      const c = await client();

      expect((await c.post(`/api/devices/${ids.device1}/bind`, { collector_id: ids.collector1 })).statusCode).toBe(200);
      const [bound] = await rows<{ bound_collector_id: string; bound_at: Date }>(
        sql`select bound_collector_id, bound_at from devices where id = ${ids.device1}`,
      );
      expect(bound!.bound_collector_id).toBe(ids.collector1);
      expect(bound!.bound_at).not.toBeNull();

      expect((await c.post(`/api/devices/${ids.device1}/unbind`)).statusCode).toBe(200);
      const [after] = await rows<{ bound_collector_id: string | null; bound_at: Date | null }>(
        sql`select bound_collector_id, bound_at from devices where id = ${ids.device1}`,
      );
      expect(after!.bound_collector_id).toBeNull();
      expect(after!.bound_at).toBeNull();

      const trail = await rows<Record<string, unknown>>(
        sql`select action, target_id, operator_id, upload_device_id, before, after
              from audit_events where action in ('device.bind', 'device.unbind') order by id`,
      );
      expect(trail.map((r) => r['action'])).toEqual(['device.bind', 'device.unbind']);
      for (const row of trail) {
        expect(row['target_id']).toBe(ids.device1);
        // From the tokens, never the body: PLT-08 wants who and where.
        expect(row['operator_id']).toBe(ids.operatorA);
        expect(row['upload_device_id']).toBe(ids.machineA);
      }
      expect(trail[0]!['after']).toMatchObject({ bound_collector_id: ids.collector1 });
      expect(trail[1]!['before']).toMatchObject({ bound_collector_id: ids.collector1 });
      expect(trail[1]!['after']).toMatchObject({ bound_collector_id: null });
    });

    it('does not write an unbind row for a device that was not bound', async () => {
      const ids = await seed();
      const c = await client();
      expect((await c.post(`/api/devices/${ids.device2}/unbind`)).statusCode).toBe(200);
      const trail = await rows<{ n: number }>(
        sql`select count(*)::int as n from audit_events where action = 'device.unbind'`,
      );
      expect(trail[0]!.n).toBe(0);
    });

    it('refuses to move a bound device to another collector behind the first one’s back', async () => {
      const ids = await seed();
      const c = await client();
      await c.post(`/api/devices/${ids.device1}/bind`, { collector_id: ids.collector1 });
      const res = await c.post(`/api/devices/${ids.device1}/bind`, { collector_id: ids.collector2 });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('device_already_bound');
      const [row] = await rows<{ bound_collector_id: string }>(
        sql`select bound_collector_id from devices where id = ${ids.device1}`,
      );
      expect(row!.bound_collector_id).toBe(ids.collector1);
    });

    /**
     * The one that proves the write decides, not a read before it.
     *
     * A second connection binds device1 to collector2 and holds the transaction
     * open. The route is then asked to bind the same device to collector1: its
     * own `select` sees an unbound device, because the other transaction has
     * not committed, and its `update` blocks on the row lock. When the other
     * side commits, READ COMMITTED re-checks the `where` against the new row
     * version, `bound_collector_id is null` no longer holds, and nothing is
     * written.
     *
     * A route that decided from the read would report success and name
     * collector1, while collector2 physically has the headset. So the assertion
     * is the pair: 409, AND the device still in collector2's hands.
     */
    it('refuses a bind that lost the race, rather than reporting the loser as the holder', async () => {
      const ids = await seed();
      const c = await client();

      const other = await open(dbUrl(), { max: 1 });
      try {
        let bound: () => void = () => {};
        let commit: () => void = () => {};
        const isBound = new Promise<void>((resolve) => (bound = resolve));
        const held = new Promise<void>((resolve) => (commit = resolve));

        const winner = other.transaction(async (tx) => {
          await tx.execute(
            sql`update devices set bound_collector_id = ${ids.collector2}, bound_at = now()
                 where id = ${ids.device1}`,
          );
          bound();
          await held;
        });
        await isBound;

        let settled = false;
        const loser = c.post(`/api/devices/${ids.device1}/bind`, { collector_id: ids.collector1 });
        void loser.then(() => (settled = true));

        // Long enough that a route which never took the row lock would be done.
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(settled, 'the bind did not wait on the row lock').toBe(false);

        commit();
        await winner;

        const res = await loser;
        expect(res.statusCode).toBe(409);
        expect(res.json().constraint).toBe('device_already_bound');
      } finally {
        await other.close();
      }

      const [row] = await rows<{ bound_collector_id: string }>(
        sql`select bound_collector_id from devices where id = ${ids.device1}`,
      );
      expect(row!.bound_collector_id).toBe(ids.collector2);
      // Nothing happened, so nothing is claimed to have happened.
      const [trail] = await rows<{ n: number }>(
        sql`select count(*)::int as n from audit_events where action = 'device.bind'`,
      );
      expect(trail!.n).toBe(0);
    });

    it('reports the fault state and the holder, each against the right device', async () => {
      const ids = await seed();
      const c = await client();
      await c.post(`/api/devices/${ids.device1}/bind`, { collector_id: ids.collector1 });
      await c.post(`/api/devices/${ids.device2}/bind`, { collector_id: ids.collector2 });
      await c.patch(`/api/devices/${ids.device2}`, {
        status: 'faulty',
        fault_note: 'left camera dead',
        firmware_version: '1.3.0',
      });

      const listed = (await c.get('/api/devices')).json() as {
        devices: Record<string, unknown>[];
        device_types: unknown[];
      };
      const byId = new Map(listed.devices.map((row) => [row['id'] as string, row]));
      expect(byId.get(ids.device1)).toMatchObject({
        bound_collector_ref: 'c-1',
        status: 'active',
        firmware_version: '1.2.0',
      });
      expect(byId.get(ids.device2)).toMatchObject({
        bound_collector_ref: 'c-2',
        status: 'faulty',
        fault_note: 'left camera dead',
        firmware_version: '1.3.0',
      });
      expect(listed.device_types).toHaveLength(1);
    });

    it('will not retire a device that is still in somebody’s hands', async () => {
      const ids = await seed();
      const c = await client();
      await c.post(`/api/devices/${ids.device1}/bind`, { collector_id: ids.collector1 });
      const res = await c.patch(`/api/devices/${ids.device1}`, { status: 'retired' });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('devices_retired_unbound_check');

      // Faulty is different on purpose: hardware fails while it is being worn,
      // and a constraint that unbound it would erase who had it.
      expect((await c.patch(`/api/devices/${ids.device1}`, { status: 'faulty' })).statusCode).toBe(200);
    });

    it('keeps the serial unique', async () => {
      const ids = await seed();
      const c = await client();
      const res = await c.post('/api/devices', {
        id: uid(),
        device_type_id: ids.deviceType,
        hardware_serial: 'AZER76400FE',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('devices_hardware_serial_key');
    });
  });

  /**
   * Daniel, from PaXini, 2026-08-25: one collector holds a given headset for an
   * allotted period of about three months, and at the end of it the credentials
   * swap to the next collector.
   *
   * Two collectors and two devices throughout, from the fixture: an assignment
   * is a statement about which of two people a device belonged to, and a
   * one-collector fixture cannot tell a correct answer from a constant.
   */
  describe('device assignment over time', () => {
    const MAY = '2026-05-01T00:00:00.000Z';
    const AUG = '2026-08-01T00:00:00.000Z';
    const NOV = '2026-11-01T00:00:00.000Z';

    it('closes the open period and opens the next one, in one request', async () => {
      const ids = await seed();
      const c = await client();
      const first = uid();
      const second = uid();

      expect(
        (await c.post(`/api/devices/${ids.device1}/assignments`, {
          id: first,
          collector_id: ids.collector1,
          valid_from: MAY,
        })).statusCode,
      ).toBe(201);

      const swap = await c.post(`/api/devices/${ids.device1}/assignments`, {
        id: second,
        collector_id: ids.collector2,
        valid_from: AUG,
      });
      expect(swap.statusCode, swap.body).toBe(201);
      // The swap says what it ended, so the audit row and the reply agree.
      expect(swap.json().closed_assignment_id).toBe(first);

      const listed = (await c.get(`/api/devices/${ids.device1}/assignments`)).json()
        .assignments as Record<string, string | null>[];
      expect(listed.map((a) => [a['collector_external_ref'], a['valid_to']])).toEqual([
        ['c-2', null],
        ['c-1', AUG],
      ]);
    });

    it('refuses a period that overlaps one already on record', async () => {
      const ids = await seed();
      const c = await client();
      await c.post(`/api/devices/${ids.device1}/assignments`, {
        id: uid(),
        collector_id: ids.collector1,
        valid_from: AUG,
      });
      // Back-dating behind an open period is a correction, not a swap: the open
      // one is not closed, and the database refuses the overlap.
      const res = await c.post(`/api/devices/${ids.device1}/assignments`, {
        id: uid(),
        collector_id: ids.collector2,
        valid_from: MAY,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('device_assignments_no_overlap');
    });

    it('is idempotent on the id, and changes nothing when it replays', async () => {
      const ids = await seed();
      const c = await client();
      const first = uid();
      const second = uid();
      const body = { id: second, collector_id: ids.collector2, valid_from: AUG };

      await c.post(`/api/devices/${ids.device1}/assignments`, {
        id: first,
        collector_id: ids.collector1,
        valid_from: MAY,
      });
      await c.post(`/api/devices/${ids.device1}/assignments`, body);

      const again = await c.post(`/api/devices/${ids.device1}/assignments`, body);
      expect(again.statusCode).toBe(200);
      expect(again.json().replayed).toBe(true);

      // The replay must not have closed the period it opened the first time.
      // That would leave the device assigned to nobody and quarantine every
      // later episode, while telling the caller nothing had happened.
      const listed = (await c.get(`/api/devices/${ids.device1}/assignments`)).json()
        .assignments as Record<string, string | null>[];
      expect(listed).toHaveLength(2);
      expect(listed[0]!['valid_to']).toBeNull();
    });

    it('refuses an id already used for a different device or collector', async () => {
      const ids = await seed();
      const c = await client();
      const id = uid();
      await c.post(`/api/devices/${ids.device1}/assignments`, {
        id,
        collector_id: ids.collector1,
        valid_from: MAY,
      });
      const res = await c.post(`/api/devices/${ids.device2}/assignments`, {
        id,
        collector_id: ids.collector2,
        valid_from: MAY,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('device_assignments_id_reused');
      // And device2 still has nothing, rather than an unexplained closed period.
      expect((await c.get(`/api/devices/${ids.device2}/assignments`)).json().assignments).toEqual([]);
    });

    it('refuses a replay that asks for a different period under the same id', async () => {
      // Bridge F-3. A replay is the same submission; a different `valid_from`
      // under a reused id is a second, different custody claim answered 200
      // "already recorded" — on the path that decides who is paid.
      const ids = await seed();
      const c = await client();
      const id = uid();
      const first = await c.post(`/api/devices/${ids.device1}/assignments`, {
        id,
        collector_id: ids.collector1,
        valid_from: MAY,
      });
      expect(first.statusCode, first.body).toBe(201);
      const later = new Date(Date.parse(MAY) + 86_400_000).toISOString();
      const res = await c.post(`/api/devices/${ids.device1}/assignments`, {
        id,
        collector_id: ids.collector1,
        valid_from: later,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('device_assignments_id_reused');
    });

    it('opens a custody period on bind and closes it on unbind', async () => {
      // Bridge F-1 / F-20. The counter's bind is a custody event: it is what
      // the payment crosscheck reads, so it has to land in `device_assignments`
      // in the same transaction, not only in `devices.bound_collector_id`.
      const ids = await seed();
      const c = await client();
      const bound = await c.post(`/api/devices/${ids.device1}/bind`, { collector_id: ids.collector2 });
      expect(bound.statusCode, bound.body).toBe(200);
      let listed = (await c.get(`/api/devices/${ids.device1}/assignments`)).json()
        .assignments as Record<string, string | null>[];
      // Newest first: the bind's period is open and names the bound collector.
      expect(listed[0]!['collector_id']).toBe(ids.collector2);
      expect(listed[0]!['valid_to']).toBeNull();
      // Any earlier open period was closed at the bind instant, not left overlapping.
      expect(listed.slice(1).every((a) => a['valid_to'] !== null)).toBe(true);

      const unbound = await c.post(`/api/devices/${ids.device1}/unbind`);
      expect(unbound.statusCode, unbound.body).toBe(200);
      listed = (await c.get(`/api/devices/${ids.device1}/assignments`)).json()
        .assignments as Record<string, string | null>[];
      expect(listed[0]!['collector_id']).toBe(ids.collector2);
      expect(listed[0]!['valid_to']).not.toBeNull();
    });

    it('answers the same chain from the collector side, with the serial on it', async () => {
      const ids = await seed();
      const c = await client();
      await c.post(`/api/devices/${ids.device1}/assignments`, {
        id: uid(),
        collector_id: ids.collector1,
        valid_from: MAY,
      });
      await c.post(`/api/devices/${ids.device2}/assignments`, {
        id: uid(),
        collector_id: ids.collector1,
        valid_from: NOV,
      });
      const listed = (await c.get(`/api/collectors/${ids.collector1}/assignments`)).json()
        .assignments as Record<string, string>[];
      // Newest first, and the serial is there because an episode names its
      // device by serial and never by uuid.
      expect(listed.map((a) => a['hardware_serial'])).toEqual(['AZER76400FF', 'AZER76400FE']);
    });

    it('leaves a named audit row for the swap, on both halves of it', async () => {
      const ids = await seed();
      const c = await client();
      const first = uid();
      await c.post(`/api/devices/${ids.device1}/assignments`, {
        id: first,
        collector_id: ids.collector1,
        valid_from: MAY,
      });
      await c.post(`/api/devices/${ids.device1}/assignments`, {
        id: uid(),
        collector_id: ids.collector2,
        valid_from: AUG,
      });

      const events = await rows<{ before: Record<string, string | null>; after: Record<string, string> }>(
        sql`select before, after from audit_events where action = 'device.assign' order by id`,
      );
      expect(events).toHaveLength(2);
      expect(events[0]!.before['closed_assignment_id']).toBeNull();
      expect(events[1]!.before).toMatchObject({
        closed_assignment_id: first,
        closed_collector_id: ids.collector1,
      });
      expect(events[1]!.after).toMatchObject({ collector_id: ids.collector2 });
    });

    it('answers 404 for a device that does not exist', async () => {
      await seed();
      const c = await client();
      const res = await c.post(`/api/devices/${uid()}/assignments`, {
        id: uid(),
        collector_id: uid(),
        valid_from: MAY,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  it('freezes the price of a published task, and says so rather than throwing', async () => {
    // Settlement reads the task's price when the verdict lands, not when the
    // claim was made, so editing a published price re-prices footage already
    // recorded and still in the queue. Publish at 1200, edit to 1, and every
    // pending episode pays 1.
    const ids = await seed();
    const c = await client();
    const res = await c.patch(`/api/tasks/${ids.taskA}`, { unit_price: '1.0000' });
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('tasks_price_frozen');
    const [task] = await rows<{ unit_price: string }>(
      sql`select unit_price from tasks where id = ${ids.taskA}`,
    );
    expect(task!.unit_price).toBe('1200.0000');

    // A draft has no claimants and no recorded footage, so its price is still an
    // ordinary edit.
    const draft = uid();
    await c.post('/api/tasks', {
      id: draft,
      name: 'draft',
      type: 'home',
      unit_price: '900.0000',
      max_concurrent_claimants: 1,
    });
    expect((await c.patch(`/api/tasks/${draft}`, { unit_price: '950.0000' })).statusCode).toBe(200);
  });

  it('says in both languages why every refusal it can raise happened', async () => {
    // A name in either set with no sentence behind it shows the reader a blank.
    for (const constraint of [...REFUSALS, ...API_REFUSALS]) {
      const key = `bo.refused.${constraint}` as keyof typeof MESSAGES.en;
      expect(MESSAGES.en[key], `no English sentence for ${constraint}`).toBeTruthy();
      expect(MESSAGES.zh[key], `no Chinese sentence for ${constraint}`).toBeTruthy();
    }
  });

  it('classifies every constraint the schema carries, discovered rather than listed', async () => {
    /**
     * The test this replaces walked `REFUSALS` and asked whether each name had
     * a sentence. That can only find a missing sentence — it cannot find the
     * mistake that actually happens, which is a constraint added to migration
     * 0006 and to nothing else: it still refuses, but it arrives as a 500 and
     * the console shows the generic failure.
     *
     * So the names come from the schema, in the two places a refusal can live:
     * the catalogue of the running database (CHECKs, foreign keys, primary
     * keys, unique indexes — Postgres reports whichever one rejected the
     * statement) and the `CONSTRAINT = '...'` literals the migration's own
     * triggers raise. Every one of them must be classified, and there are only
     * two boxes: something a person can trip by asking for what the rules
     * refuse, or something that means this code is wrong.
     */
    const TABLES = ['tasks', 'task_claims', 'collectors', 'collector_agreements', 'devices', 'device_assignments', 'review_disputes'];
    const list = TABLES.map((t) => `'${t}'`).join(', ');

    const declared = await rows<{ name: string }>(sql`
      select conname as name
        from pg_constraint
       where conrelid::regclass::text in (${sql.raw(list)})
         and contype in ('c', 'f', 'p', 'u', 'x')
      union
      select ci.relname as name
        from pg_index i
        join pg_class ci on ci.oid = i.indexrelid
        join pg_class ct on ct.oid = i.indrelid
       where ct.relname in (${sql.raw(list)}) and i.indisunique
    `);
    expect(declared.length, 'the five back-office tables should carry constraints').toBeGreaterThan(15);

    /**
     * Every migration, not the one this slice happens to have written. The
     * back-office guards live in two files now — 0006 could not absorb them,
     * because it is already applied wherever 4f1ef2e ran — and naming a file
     * here is how the next split silently drops half the coverage.
     */
    const drizzle = join(import.meta.dirname, '..', '..', 'store', 'drizzle');
    const migrations = readdirSync(drizzle)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(drizzle, f), 'utf8'))
      .join(' ');
    const raised = [...migrations.matchAll(/CONSTRAINT = '([a-z0-9_]+)'/g)].map((m) => m[1]!);
    expect(raised.length, 'the migrations raise named refusals').toBeGreaterThan(8);

    /**
     * The other box: a statement that trips one of these was built by this
     * file, not asked for by a person, so it should read like the bug it is.
     * Each of them is unreachable from a route for a stated reason.
     */
    const INTERNAL = new Set([
      // Guarded by zod before the column ever sees the value.
      'tasks_status_check',
      'tasks_claimants_check',
      'collectors_status_check',
      'collectors_exam_result_check',
      'devices_status_check',
      'collector_agreements_name_check',
      'collector_agreements_version_check',
      /**
       * The collector's own sign-in columns (0018). No route writes any of
       * them: `POST /api/collectors` and `PATCH /api/collectors/:id` set a
       * reference, a status, an exam result and agreements, and a phone number
       * arrives by fixture the way an upload centre does (ADR 0003). The two
       * routes that read them — `/auth/collector/request-code` and
       * `/auth/collector/verify` — write the hash and its expiry as a pair,
       * increment the attempt count from itself, and never touch the phone or
       * the epoch. Raw SQL is the only caller; collector-auth.test.ts proves
       * each one fires.
       *
       * `collectors_phone_key` is the one that moves. The moment the back
       * office can set a collector's phone number, "another collector already
       * uses that number" becomes a sentence a person reads, and it belongs in
       * REFUSALS beside `collectors_external_ref_key` — not here.
       */
      'collectors_phone_key',
      'collectors_sign_in_code_check',
      'collectors_sign_in_code_attempts_check',
      'collectors_token_epoch_check',
      // Written as a pair by the route, or not at all.
      'collectors_exam_decided_check',
      'devices_bound_at_check',
      'task_claims_released_after_check',
      'device_assignments_period_check',
      // Every create is `onConflictDoNothing` on the primary key, so a repeat
      // is a replay rather than an error.
      'tasks_pkey',
      'collectors_pkey',
      'devices_pkey',
      'task_claims_pkey',
      // Targets of the composite claim FKs (0016); `id` alone is already unique.
      'task_claims_task_key',
      'task_claims_pairing_key',
      'device_assignments_pkey',
      'collector_agreements_collector_id_agreement_version_pk',
      // The collector is written in the same transaction as its acceptances.
      'collector_agreements_collector_id_collectors_id_fk',
      // Raised by the settlement lane (0005, 0011) and the upload leg (0007,
      // 0009). The back office never writes settlements, bills or upload
      // batches; those routes have their own refusals and their own tests.
      'settlements_transition_check',
      'settlements_amount_immutable_check',
      // 0016: the verdict refuses a claimless session by name before the row
      // is written, and nothing updates a settlement's claim.
      'settlements_claim_required',
      'settlements_claim_matches_session',
      'settlements_claim_immutable',
      'bill_lines_payable_check',
      'bills_issued_immutable',
      'bill_lines_owner_guard',
      'bills_total_matches_lines',
      'bill_lines_immutable',
      // 0016: the settle routes write `exception_from_state` from the row they
      // read, and the generator never bills a parked row; only raw SQL can
      // trip either, and spine.test.ts proves both.
      'settlements_exception_from_check',
      'bill_lines_exception_check',
      'upload_batches_verify_needs_episodes',
      'upload_batches_verify_needs_verified_episodes',
      // Raised by the payout lane's tamper guards (0012/0013): append-only,
      // write-once evidence, computed identity, sealed exports. No route can
      // reach them; raw SQL is the only caller, and schema.test.ts proves each.
      'payout_attempts_append_only',
      'payout_attempts_evidence_immutable',
      'payout_attempts_identity_computed',
      'payout_attempts_identity_immutable',
      'payout_attempts_initial_status',
      'payout_export_rows_sealed',
      'payout_exports_complete',
      // Raised by 0016's append-only guard on episode_clearings. No route
      // updates or deletes a clearing; raw SQL is the only caller, and
      // clearing.test.ts proves it fires.
      'episode_clearings_append_only',
      // Raised by the reconciliation tables' guards (0015): runs and lines are
      // append-only evidence, a run is sealed when finished, a line is born
      // open, and only a finance operator with an audited reason resolves
      // one. No route writes these tables yet — `resolveLine` is called from
      // tests only — so raw SQL is the only caller, and recon.test.ts proves
      // each. When the exceptions screen lands, `recon_lines_resolved_by_operator`
      // becomes a person's refusal and moves to a refusal set with a sentence.
      'recon_runs_append_only',
      'recon_runs_sealed',
      'recon_lines_append_only',
      'recon_lines_resolved_by_operator',
      'recon_lines_born_open',
      // Raised by the risk engine's guards (0014): append-only evidence, a
      // supersede-only catalogue, and the hold chain. The back office never
      // writes risk tables. The risk routes read the open hold first and
      // answer 409 through NoOpenHold before the chain guard can fire; the
      // guard is the second lock, for raw SQL, and test/risk/schema.test.ts
      // proves each name.
      'risk_signals_supersede_only',
      'risk_flags_append_only',
      'risk_holds_append_only',
      'risk_holds_already_open',
      'risk_holds_clear_requires_open',
      'risk_holds_clear_signals_check',
      // Raised by the dispute path's tamper guards (0016). The four a person
      // can trip through `POST /api/review/dispute` are in REFUSALS; these are
      // reachable only from raw SQL, and dispute.test.ts proves each.
      'review_disputes_append_only',
      // The dispute row's own shape: the route mints the id, copies the
      // operator from the verified token, and zod refuses a blank reason;
      // outcome and resolved_at are written as a pair by the verdict.
      'review_disputes_pkey',
      'review_disputes_raised_by_operators_id_fk',
      'review_disputes_reason_check',
      'review_disputes_outcome_check',
      'review_disputes_resolved_check',
      // A review id that names nothing: the route answers 404 on this one.
      'review_disputes_review_id_episode_reviews_id_fk',
      'episode_reviews_dispute_immutable',
      'episode_reviews_dispute_open_check',
      'episode_reviews_dispute_delivery_check',
      'episode_reviews_second_reviewer_check',
      'settlements_superseded_immutable',
      'settlements_superseded_state_check',
      'bill_lines_superseded_check',
      'bill_lines_disputed_check',
    ]);

    for (const name of [...declared.map((d) => d.name), ...raised]) {
      expect(
        // The payout lane keeps its own refusal list; its sentences are the
        // payout console's keys (bo.refused.*), added with that screen.
        REFUSALS.has(name) || PAYOUT_REFUSALS.has(name) || PAYOUT_API_REFUSALS.has(name) || INTERNAL.has(name),
        `${name} is neither a mapped refusal nor declared unreachable — a 500 with no sentence`,
      ).toBe(true);
    }

    // And nothing in the map that the schema does not actually carry, which is
    // how a renamed constraint leaves a dead entry behind.
    const real = new Set([...declared.map((d) => d.name), ...raised]);
    for (const name of REFUSALS) {
      expect(real.has(name), `${name} is mapped but no constraint by that name exists`).toBe(true);
    }
    for (const name of INTERNAL) {
      expect(real.has(name), `${name} is declared unreachable but no constraint by that name exists`).toBe(true);
    }

    // The ones the API raises itself, which are not database constraints.
    // `SETTLE_API_REFUSALS` is the settle lane's own list, spread in rather
    // than copied, so a refusal added there without a sentence fails here.
    for (const constraint of [
      ...SETTLE_API_REFUSALS,
      'device_already_bound',
      'tasks_id_reused',
      'collectors_id_reused',
      'devices_id_reused',
      'task_claims_id_reused',
      'task_claims_released',
      'device_assignments_id_reused',
      // The counter's own (0016): a session needs a live claim.
      ...COUNTER_REFUSALS,
    ]) {
      const key = `bo.refused.${constraint}` as keyof typeof MESSAGES.en;
      expect(MESSAGES.en[key], `no English sentence for ${constraint}`).toBeTruthy();
      expect(MESSAGES.zh[key], `no Chinese sentence for ${constraint}`).toBeTruthy();
    }
  });

  it('needs both tokens for every back-office route', async () => {
    const ids = await seed();
    const app = buildApi({ db: await db(), tokenSecret: SECRET });
    for (const [method, url] of [
      ['GET', '/api/tasks'],
      ['GET', '/api/collectors'],
      ['GET', '/api/devices'],
      ['POST', `/api/devices/${ids.device1}/unbind`],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, url).toBe(401);
    }
  });
});
