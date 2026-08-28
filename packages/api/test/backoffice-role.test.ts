import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { buildApi, hashCredential } from '../src/index.ts';
import { MESSAGES } from '../src/i18n.ts';
import { closeDb, db, hasDb, truncate, useDatabase, violates } from '../../store/test/db.ts';

useDatabase('backoffice_role');

/**
 * BO-11 and SEC-02: the back-office administrator role.
 *
 * Before this, every mutation in `backoffice.ts` was open to any authenticated
 * operator at any centre — publish a task, price it, qualify a collector, bind
 * a device. That was not a missing centre scope (docs/adr/0003: the back office
 * is national by design, and `tasks`, `collectors` and `devices` carry no centre
 * column). It was a missing role.
 *
 * Four things are pinned here:
 *
 *   - a clerk is refused every administrator action, BY NAME, with the role the
 *     action needs in the reply and a sentence in all three languages;
 *   - the same clerk still does the daily job — reading, and APP-10's claim and
 *     release, which are the collector's act taken on their behalf;
 *   - an administrator is allowed every one of them;
 *   - 0020's two constraint triggers refuse the same write below the routes,
 *     in raw SQL with no application in the path, which is what makes the role
 *     survive a route that forgets its guard.
 *
 * The fixture carries two centres and four roles, because a single-centre
 * fixture is the shape that hid a payment bug in this repo before.
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
    /** The counter clerk: handovers, imports, queues, and nothing that shapes. */
    clerk: uid(),
    /** The administrator, at the SAME centre — the difference is role, not place. */
    admin: uid(),
    /** A clerk at the other centre, so "refused" cannot be a centre accident. */
    clerkB: uid(),
    /** 0013's finance operator. Pays, and does not shape. */
    finance: uid(),
    collector: uid(),
    deviceType: uid(),
    device: uid(),
    /** Never bound, so the allotment below is not an overlap with bind's own period. */
    deviceSpare: uid(),
    task: uid(),
  };
  const hash = await hashCredential('pw');

  await d.execute(sql`insert into upload_centres (id, region, name, status) values
    (${ids.centreA}, 'HCM', 'centre-a', 'active'),
    (${ids.centreB}, 'HAN', 'centre-b', 'active')`);
  await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values
    (${ids.machineA}, ${ids.centreA}, 'HCM-01', 'active', ${hash}),
    (${ids.machineB}, ${ids.centreB}, 'HAN-01', 'active', ${hash})`);
  await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
    (${ids.clerk}, ${ids.centreA}, 'clerk-a', 'centre_operator', ${hash}),
    (${ids.admin}, ${ids.centreA}, 'admin-a', 'administrator', ${hash}),
    (${ids.clerkB}, ${ids.centreB}, 'clerk-b', 'centre_operator', ${hash}),
    (${ids.finance}, ${ids.centreA}, 'fin-a', 'finance', ${hash})`);
  await d.execute(sql`insert into collectors (id, external_ref, status, exam_result, exam_decided_at)
    values (${ids.collector}, 'c-1', 'qualified', 'pass', now())`);
  for (const agreement of [
    'user',
    'privacy',
    'data_collection',
    'commercial_use',
    'manual_review',
    'offline_settlement',
  ]) {
    await d.execute(sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
      values (${ids.collector}, ${agreement}, '2026-08-v1', now())`);
  }
  await d.execute(sql`insert into device_types (id, code, generation)
    values (${ids.deviceType}, 'ego_headset', 'gen1')`);
  await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, firmware_version, status)
    values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', '1.2.0', 'active'),
           (${ids.deviceSpare}, ${ids.deviceType}, 'AZER76400FF', '1.2.0', 'active')`);
  await d.execute(sql`insert into tasks (id, name, type, unit_price, max_concurrent_claimants, status)
    values (${ids.task}, 'housework', 'home', 1200.0000, 2, 'published')`);
  return ids;
}

describe.skipIf(!hasDb())('the back-office administrator role', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const client = async (machine: string, operator: string) => {
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
      get: (url: string) => send('GET', url),
      post: (url: string, payload?: Record<string, unknown>) => send('POST', url, payload),
      patch: (url: string, payload: Record<string, unknown>) => send('PATCH', url, payload),
    };
  };

  const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
    (await (await db()).execute(query)) as unknown as T[];

  /**
   * Every administrator action, as one list, so a route added to that half of
   * the file without its guard has one place to be missing from.
   *
   * BO-01 and BO-02 are the first two; BO-03 the collectors; BO-04 the rest.
   */
  const shaping = (ids: Awaited<ReturnType<typeof seed>>) =>
    [
      ['task.create', 'POST', '/api/tasks', {
        id: uid(),
        name: 'kitchen work',
        type: 'home',
        unit_price: '1350.5000',
        target_effective_duration_s: '7200.000000',
        max_concurrent_claimants: 3,
      }],
      ['task.price', 'PATCH', `/api/tasks/${ids.task}`, { name: 'renamed' }],
      ['task.take_down', 'PATCH', `/api/tasks/${ids.task}`, { status: 'taken_down' }],
      ['collector.create', 'POST', '/api/collectors', { id: uid(), external_ref: `c-${uid()}` }],
      ['collector.qualify', 'PATCH', `/api/collectors/${ids.collector}`, { status: 'suspended' }],
      ['collector.exam', 'PATCH', `/api/collectors/${ids.collector}`, {
        exam: { result: 'pass', decided_at: new Date().toISOString() },
      }],
      ['device.create', 'POST', '/api/devices', {
        id: uid(),
        device_type_id: ids.deviceType,
        hardware_serial: `SER-${uid()}`,
        firmware_version: '1.0.0',
      }],
      ['device.fault', 'PATCH', `/api/devices/${ids.device}`, { status: 'faulty', fault_note: 'lens' }],
      ['device.bind', 'POST', `/api/devices/${ids.device}/bind`, { collector_id: ids.collector }],
      ['device.unbind', 'POST', `/api/devices/${ids.device}/unbind`, undefined],
      ['device.allot', 'POST', `/api/devices/${ids.deviceSpare}/assignments`, {
        id: uid(),
        collector_id: ids.collector,
        valid_from: new Date().toISOString(),
      }],
    ] as const;

  it('refuses a counter clerk every administrator action, by name and with the role it needs', async () => {
    const ids = await seed();
    const clerk = await client('HCM-01', 'clerk-a');

    for (const [what, method, url, payload] of shaping(ids)) {
      const res =
        method === 'POST' ? await clerk.post(url, payload) : await clerk.patch(url, payload!);
      /**
       * 403 and not 409: the rules did not refuse what was asked, the person is
       * not allowed to ask. The console reads `constraint`; a human reads the
       * sentence it names; `role_required` is what a screen would use to decide
       * whether to show the button at all.
       */
      expect(res.statusCode, what).toBe(403);
      expect(res.json(), what).toMatchObject({
        error: 'refused',
        constraint: 'backoffice_admin_required',
        role_required: 'administrator',
      });
    }
  });

  it('refuses a clerk at the other centre the same way — it is the role, not the place', async () => {
    const ids = await seed();
    const other = await client('HAN-01', 'clerk-b');
    const res = await other.post('/api/tasks', {
      id: uid(),
      name: 'kitchen work',
      type: 'home',
      unit_price: '1350.5000',
      max_concurrent_claimants: 3,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().constraint).toBe('backoffice_admin_required');
    // And an administrator at centre A shapes a national table from centre A,
    // which is docs/adr/0003 working as designed rather than a scope hole.
    const admin = await client('HCM-01', 'admin-a');
    expect((await admin.post('/api/tasks', {
      id: uid(),
      name: 'kitchen work',
      type: 'home',
      unit_price: '1350.5000',
      max_concurrent_claimants: 3,
    })).statusCode).toBe(201);
    expect(ids.centreB).toBeDefined();
  });

  it('allows an administrator every one of them', async () => {
    const ids = await seed();
    const admin = await client('HCM-01', 'admin-a');

    for (const [what, method, url, payload] of shaping(ids)) {
      const res =
        method === 'POST' ? await admin.post(url, payload) : await admin.patch(url, payload!);
      expect([200, 201], `${what} answered ${res.statusCode}: ${res.body}`).toContain(
        res.statusCode,
      );
    }
  });

  it('leaves the counter clerk the daily job: reading, and APP-10 claim and release', async () => {
    const ids = await seed();
    const clerk = await client('HCM-01', 'clerk-a');

    for (const url of [
      '/api/tasks',
      '/api/collectors',
      '/api/devices',
      `/api/devices/${ids.device}/assignments`,
      `/api/collectors/${ids.collector}/assignments`,
    ]) {
      expect((await clerk.get(url)).statusCode, url).toBe(200);
    }

    /**
     * Claiming and releasing stay open to a clerk on purpose. They are APP-10 —
     * the collector's own act, taken by an operator on their behalf until the
     * app carries a session of its own — and not a shaping power.
     */
    const claim = uid();
    const claimed = await clerk.post(`/api/tasks/${ids.task}/claims`, {
      id: claim,
      collector_id: ids.collector,
    });
    expect(claimed.statusCode, claimed.body).toBe(201);
    expect((await clerk.post(`/api/task-claims/${claim}/release`)).statusCode).toBe(200);
  });

  /**
   * 0013's separation of duty, still holding, now that a fourth role exists.
   *
   * The two halves have to stay apart in BOTH directions, and only one of them
   * was ever enforced: finance is refused the shaping powers here, and the
   * migration deliberately does not promote a finance operator into an
   * administrator. `payout.test.ts` still proves the other direction — that a
   * non-finance operator cannot pay — through 0013's own trigger.
   */
  it('keeps finance and administrator apart in both directions', async () => {
    const ids = await seed();
    const finance = await client('HCM-01', 'fin-a');
    const res = await finance.patch(`/api/collectors/${ids.collector}`, { status: 'suspended' });
    expect(res.statusCode).toBe(403);
    expect(res.json().constraint).toBe('backoffice_admin_required');

    // The backfill in 0020 promotes `centre_operator` and nothing else, so a
    // finance or reviewer row migrated before this test still reads as it did.
    const roles = await rows<{ role: string; n: number }>(
      sql`select role, count(*)::int as n from operators group by role order by role`,
    );
    expect(roles).toEqual([
      { role: 'administrator', n: 1 },
      { role: 'centre_operator', n: 2 },
      { role: 'finance', n: 1 },
    ]);
  });

  it('says why in every language the console renders', () => {
    for (const locale of ['en', 'zh', 'vi'] as const) {
      const sentence = MESSAGES[locale]['bo.refused.backoffice_admin_required'];
      expect(sentence, locale).toBeTruthy();
      // The point of the sentence is that it names the role. A refusal that
      // says "not allowed" sends the operator to ask an engineer.
      expect(sentence.length, locale).toBeGreaterThan(40);
    }
    expect(MESSAGES.en['bo.refused.backoffice_admin_required']).toContain('administrator');
  });

  /**
   * Below the routes.
   *
   * `mutate` writes the change and the audit row in one transaction, so these
   * repeat that shape in raw SQL: the write, then the audit row that names the
   * operator. A route that forgets `admin` still writes both, and 0020's
   * DEFERRED constraint triggers still refuse it at COMMIT. Nothing in the
   * application is in the path here.
   */
  describe('0020 in the database, with no route above it', () => {
    const audited = async (
      operatorId: string,
      machineId: string,
      centreId: string,
      action: string,
      table: string,
      targetId: string,
      write: ReturnType<typeof sql>,
    ) => {
      const d = await db();
      return d.transaction(async (tx) => {
        await tx.execute(write);
        await tx.execute(sql`insert into audit_events
          (action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id)
          values (${action}, ${table}, ${targetId}, 'operator', ${operatorId}, ${machineId}, ${centreId})`);
      });
    };

    it('refuses a task written by a clerk, and accepts the same task from an administrator', async () => {
      const ids = await seed();
      const priced = (id: string) => sql`insert into tasks
        (id, name, type, unit_price, max_concurrent_claimants, status)
        values (${id}, 'smuggled', 'home', 99999.0000, 1, 'published')`;

      const refusedId = uid();
      await violates(
        'backoffice_admin_required',
        audited(ids.clerk, ids.machineA, ids.centreA, 'task.create', 'tasks', refusedId, priced(refusedId)),
      );
      expect(
        (await rows<{ n: number }>(sql`select count(*)::int as n from tasks where id = ${refusedId}`))[0]!.n,
      ).toBe(0);

      const allowedId = uid();
      await audited(ids.admin, ids.machineA, ids.centreA, 'task.create', 'tasks', allowedId, priced(allowedId));
      expect(
        (await rows<{ n: number }>(sql`select count(*)::int as n from tasks where id = ${allowedId}`))[0]!.n,
      ).toBe(1);
    });

    it('refuses a repricing by a clerk, on UPDATE and not only INSERT', async () => {
      const ids = await seed();
      const draft = uid();
      await (await db()).execute(sql`insert into tasks
        (id, name, type, unit_price, max_concurrent_claimants, status)
        values (${draft}, 'draft task', 'home', 1200.0000, 1, 'draft')`);
      await violates(
        'backoffice_admin_required',
        audited(
          ids.clerk,
          ids.machineA,
          ids.centreA,
          'task.update',
          'tasks',
          draft,
          sql`update tasks set unit_price = 1.0000, updated_at = now() where id = ${draft}`,
        ),
      );
      const [row] = await rows<{ unit_price: string }>(
        sql`select unit_price from tasks where id = ${draft}`,
      );
      expect(row!.unit_price).toBe('1200.0000');
    });

    it('refuses a qualification written by a clerk — the entry gate to being paid', async () => {
      const ids = await seed();
      const stranger = uid();
      await violates(
        'backoffice_admin_required',
        audited(
          ids.clerk,
          ids.machineA,
          ids.centreA,
          'collector.create',
          'collectors',
          stranger,
          sql`insert into collectors (id, external_ref, status, exam_result, exam_decided_at)
              values (${stranger}, 'smuggled', 'qualified', 'pass', now())`,
        ),
      );
      await violates(
        'backoffice_admin_required',
        audited(
          ids.clerk,
          ids.machineA,
          ids.centreA,
          'collector.update',
          'collectors',
          ids.collector,
          sql`update collectors set status = 'suspended', updated_at = now() where id = ${ids.collector}`,
        ),
      );
      const [held] = await rows<{ status: string }>(
        sql`select status from collectors where id = ${ids.collector}`,
      );
      expect(held!.status).toBe('qualified');
    });

    it('refuses a finance operator the same two writes, so 0013 stays a separation', async () => {
      const ids = await seed();
      const id = uid();
      await violates(
        'backoffice_admin_required',
        audited(
          ids.finance,
          ids.machineA,
          ids.centreA,
          'task.create',
          'tasks',
          id,
          sql`insert into tasks (id, name, type, unit_price, max_concurrent_claimants, status)
              values (${id}, 'priced by the payer', 'home', 9999.0000, 1, 'published')`,
        ),
      );
    });

    /**
     * The documented limit of the guarantee, written down as a test so nobody
     * reports it as a hole and nobody widens it by accident.
     *
     * A write with NO audited operator passes. 0013 refuses those, because
     * nothing legitimately writes a settlement outside a route. Here the seed
     * scripts and every test fixture insert tasks, collectors and devices as
     * raw SQL by the design docs/adr/0003 records, so a trigger that refused
     * them would refuse the fixtures rather than an attacker. The guarantee is
     * "if an operator did it, that operator is an administrator" — an engineer
     * holding the database is out of scope and could drop the trigger anyway.
     */
    it('lets an unaudited write through, which is the stated scope and not a hole', async () => {
      await seed();
      const id = uid();
      await (await db()).execute(sql`insert into tasks
        (id, name, type, unit_price, max_concurrent_claimants, status)
        values (${id}, 'seeded', 'home', 1200.0000, 1, 'draft')`);
      expect(
        (await rows<{ n: number }>(sql`select count(*)::int as n from tasks where id = ${id}`))[0]!.n,
      ).toBe(1);
    });

    it('ignores a reviewer audit row rather than looking a reviewer up in operators', async () => {
      const ids = await seed();
      const reviewer = uid();
      const d = await db();
      await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${reviewer}, null, 'pax-01', 'reviewer', null)`);
      const id = uid();
      // A reviewer cannot reach these routes (PLT-10 scope), so this is the
      // shape of the mistake rather than a reachable path: the trigger reads
      // only `actor_role = 'operator'` rows, and must not refuse on this one.
      await d.transaction(async (tx) => {
        await tx.execute(sql`insert into tasks (id, name, type, unit_price, max_concurrent_claimants, status)
          values (${id}, 'reviewed', 'home', 1200.0000, 1, 'draft')`);
        await tx.execute(sql`insert into audit_events
          (action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id)
          values ('task.create', 'tasks', ${id}, 'reviewer', ${reviewer}, null, null)`);
      });
      expect(
        (await rows<{ n: number }>(sql`select count(*)::int as n from tasks where id = ${id}`))[0]!.n,
      ).toBe(1);
      expect(ids.admin).toBeDefined();
    });
  });
});
