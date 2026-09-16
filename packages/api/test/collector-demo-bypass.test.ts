import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApi,
  DEMO_BYPASS_COLLECTOR_REF,
  DEMO_BYPASS_MIN_KEY,
  verifyToken,
} from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('bypass');

/**
 * The demo bypass. Owner's request, 2026-09-16, for debugging and the Thursday
 * demonstration only — argued at `DEMO_BYPASS_COLLECTOR_REF` in
 * `packages/api/src/collector.ts`.
 *
 * What is worth testing here is not that a correct key returns 200. It is the
 * four things that would each turn this door into a hole, and that a reviewer
 * would try first:
 *
 *   - a deployment that was never given a key must not have the route at all,
 *     and its answer must be indistinguishable from a build without the code;
 *   - a wrong key must not be told it was close, and must not be told the
 *     feature exists;
 *   - a short key must stop the SERVER, not degrade it;
 *   - the token it issues must be the ordinary collector token for the
 *     collector the demonstration already uses, whose onboarding state is what
 *     makes an upload possible — not a new kind of session and not a new
 *     collector.
 *
 * Two collectors in the fixture, per this repository's standing rule: a lookup
 * bug that picked "the first collector" would pass against one row.
 */

const SECRET = 'test-signing-key';
/** 64 characters, the shape `openssl rand -base64 48` gives. */
const KEY = 'a'.repeat(32) + 'b'.repeat(32);

const root = join(import.meta.dirname, '..', '..', '..');

describe('the key floor is a service invariant, not an entrypoint check', () => {
  it('refuses to build with a key shorter than the floor', async () => {
    expect(DEMO_BYPASS_MIN_KEY).toBe(32);
    expect(() =>
      buildApi({
        db: undefined as never,
        tokenSecret: SECRET,
        demoBypassKey: 'x'.repeat(DEMO_BYPASS_MIN_KEY - 1),
      }),
    ).toThrow(/PLAYERONE_DEMO_BYPASS_KEY/);
  });

  /**
   * The key is generated at deploy time and must exist nowhere in the tree.
   * `cloud.env.example` is a template and carries the name with no value; a
   * value there would be a secret in git, which is what rule 4 forbids.
   */
  it('ships no key in the repository', () => {
    const template = readFileSync(join(root, 'deploy', 'cloud', 'cloud.env.example'), 'utf8');
    expect(template).toContain('PLAYERONE_DEMO_BYPASS_KEY=');
    expect(template).toMatch(/^PLAYERONE_DEMO_BYPASS_KEY=\s*$/m);
  });
});

describe.skipIf(!hasDb())('POST /auth/collector/demo', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const ids = { demo: randomUUID(), other: randomUUID(), task: randomUUID(), claim: randomUUID() };

  /**
   * The collector `seed-demo.mjs` creates, in the state it creates them in:
   * qualified, exam passed, the six agreements, and one live claim on a
   * published task. That state is the reason a bypassed sign-in can upload at
   * once, so it is asserted rather than assumed below.
   *
   * Plus a second, unrelated collector whose reference is not the marker.
   */
  const AGREEMENTS = [
    'user',
    'privacy',
    'data_collection',
    'commercial_use',
    'manual_review',
    'offline_settlement',
  ];

  async function seed() {
    const d = await db();
    await d.execute(sql`
      insert into collectors (id, external_ref, name, phone, status,
                              training_completed_at, exam_result, exam_decided_at)
      values (${ids.demo}, ${DEMO_BYPASS_COLLECTOR_REF}, 'Demo Collector', '+84900000001',
              'qualified', now(), 'pass', now())`);
    await d.execute(sql`
      insert into collectors (id, external_ref, status, phone)
      values (${ids.other}, 'col-other', 'qualified', '+84900000002')`);
    await d.execute(sql`
      insert into collector_agreements (collector_id, agreement, version, accepted_at)
      select ${ids.demo}, a, '1.0', now()
        from unnest(${sql.raw(`array['${AGREEMENTS.join("','")}']`)}) as a`);
    await d.execute(sql`
      insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
      values (${ids.task}, 'Demo housework', 1200.0000, 5, 'published')`);
    await d.execute(sql`
      insert into task_claims (id, task_id, collector_id)
      values (${ids.claim}, ${ids.task}, ${ids.demo})`);
  }

  const api = async (demoBypassKey?: string) =>
    buildApi({ db: await appDb(), tokenSecret: SECRET, demoBypassKey });

  const post = (app: Awaited<ReturnType<typeof api>>, payload: unknown) =>
    app.inject({ method: 'POST', url: '/auth/collector/demo', payload: payload as never });

  it('does not exist on a deployment that was given no key', async () => {
    await seed();
    const app = await api();
    // A right-looking key, a wrong one and no body at all: one answer, and it
    // is the answer a build without this route would give.
    for (const payload of [{ key: KEY }, { key: 'nope' }, {}]) {
      const res = await post(app, payload);
      expect(res.statusCode, res.body).toBe(404);
    }
    await app.close();
  });

  it('answers one 401 for a wrong key, an absent key and a key of the wrong length', async () => {
    await seed();
    const app = await api(KEY);
    const bodies: string[] = [];
    for (const payload of [
      { key: 'nope' },
      // Right for its first 63 characters. A comparison that stopped at the
      // first difference would be a way to recover the key one character at a
      // time; this asserts the answer, `timingSafeEqual` is what makes the
      // timing say nothing either.
      { key: KEY.slice(0, -1) + 'c' },
      { key: '' },
      {},
      { key: 42 },
    ]) {
      const res = await post(app, payload);
      expect(res.statusCode, res.body).toBe(401);
      bodies.push(res.body);
    }
    // Every refusal is byte-identical, so nothing in the body narrows a guess.
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({ error: 'credentials', reason: 'credentials' });
    await app.close();
  });

  it('issues the ordinary collector token for the seeded demo collector', async () => {
    await seed();
    const app = await api(KEY);
    const res = await post(app, { key: KEY });
    expect(res.statusCode, res.body).toBe(200);

    /**
     * The same claims `verify` and the Zalo ticket mint: a collector session,
     * that collector's id, that collector's epoch. Not a wider scope and not a
     * longer life — the bypass skips the credential and nothing else.
     */
    const claims = verifyToken(SECRET, res.json().token as string);
    expect(claims).toMatchObject({ kind: 'collector', collectorId: ids.demo, epoch: 1 });

    // And it really is a session: `/api/me/profile` answers for it.
    const me = await app.inject({
      method: 'GET',
      url: '/api/me/profile',
      headers: { authorization: `Bearer ${res.json().token}` },
    });
    expect(me.statusCode, me.body).toBe(200);
    await app.close();
  });

  /**
   * The onboarding state is the whole reason this collector and not a new one.
   * Read off the row the route reached, so a seed that stopped marking the
   * collector qualified — or a route that reached the wrong row — fails here
   * rather than in front of the room.
   */
  it('reaches a collector who is past every gate that stands in front of work', async () => {
    await seed();
    const app = await api(KEY);
    const res = await post(app, { key: KEY });
    const id = (verifyToken(SECRET, res.json().token as string) as { collectorId: string })
      .collectorId;
    await app.close();

    const d = await db();
    const [state] = await d.execute(sql`
      select c.status, c.exam_result,
             (select count(*)::int from collector_agreements where collector_id = c.id) as agreements,
             (select count(*)::int from task_claims
               where collector_id = c.id and released_at is null) as claims
        from collectors c where c.id = ${id}`);
    // The four conditions `task_claims_guard` (0006, replaced by 0034) checks,
    // in the state that passes them.
    expect(state).toMatchObject({ status: 'qualified', exam_result: 'pass', agreements: 6 });
    expect(Number(state!['claims'])).toBeGreaterThan(0);
  });

  it('records the sign-in, and names the door it came through', async () => {
    await seed();
    const app = await api(KEY);
    // A refused attempt first: the audit trail must not read as a clean login.
    await post(app, { key: 'nope' });
    const ok = await post(app, { key: KEY });
    expect(ok.statusCode, ok.body).toBe(200);
    await app.close();

    const d = await db();
    const rows = await d.execute(sql`
      select action, actor_role, target_table, target_id, after
        from audit_events where target_id = ${ids.demo} order by occurred_at`);
    const login = rows.find((r) => r['action'] === 'collector.login');
    expect(login, 'PLT-07: a bypass sign-in leaves the row every sign-in leaves').toBeDefined();
    expect(login).toMatchObject({ actor_role: 'collector', target_table: 'collectors' });
    expect(login!['after']).toMatchObject({ collectorId: ids.demo, source: 'demo_bypass' });
  });

  /**
   * The key is right and nobody seeded the demo. That is an operator's problem
   * and is named as one — and it is only ever visible to a caller who already
   * presented the key, so it reveals nothing the 404 above is protecting.
   */
  it('says so when the demo collector was never seeded', async () => {
    const d = await db();
    await d.execute(sql`
      insert into collectors (id, external_ref, status, phone)
      values (${ids.other}, 'col-other', 'qualified', '+84900000002')`);
    const app = await api(KEY);
    const res = await post(app, { key: KEY });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json().constraint).toBe('demo_collector_absent');
    await app.close();
  });

  /**
   * The bypass is one door into the ordinary session, so the ordinary limiter
   * counts it. Thirty attempts per address is the source budget; what matters
   * here is that a burst of wrong keys is refused rather than checked for ever.
   */
  it('counts wrong keys against the sign-in limiter', async () => {
    await seed();
    const app = await api(KEY);
    let refused = 0;
    for (let i = 0; i < 40; i += 1) {
      const res = await post(app, { key: 'nope' });
      if (res.statusCode === 429) refused += 1;
    }
    expect(refused, 'a burst of wrong keys is eventually refused by the limiter').toBeGreaterThan(0);
    await app.close();
  });
});
