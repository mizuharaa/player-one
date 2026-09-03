import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential, SIGN_IN_RATE_LIMITED, signInLimiter } from '../src/index.ts';
import { MESSAGES } from '../src/i18n.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('ratelimit');

/**
 * SEC-03. What the four sign-in routes do to somebody guessing, and what they
 * must not do to somebody who is not.
 *
 * Measured before this existed, on this branch: sixty concurrent wrong
 * passwords against `POST /auth/operator` all answered 401 in 1,239 ms — 48 a
 * second — the correct password immediately after answered 200, and
 * `audit_events` grew by one row across sixty-two calls. Both halves are
 * covered here, because a limit nobody can see in the trail afterwards is a
 * limit nobody can check.
 */

const SECRET = 'test-signing-key';
const PASSWORD = 'correct horse';
/** Never in an audit row. Asserted, not assumed. */
const GUESS = 'battery-staple-guess';
const uid = () => randomUUID();

/** A person's own reference, and the one every person at a counter shares. */
const op = (id: string) => ({ id, kind: 'operator' }) as const;
const mach = (id: string) => ({ id, kind: 'machine' }) as const;

/** The counting, with no database and no HTTP in the way. */
describe('the sign-in limiter', () => {
  /** A clock the test moves, so a five-minute window costs no wall time. */
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('stops one credential after ten failures and leaves the others alone', () => {
    const limiter = signInLimiter();
    for (let i = 0; i < 10; i += 1) limiter.attempted('10.0.0.9', [op('op-HCM')]);

    expect(limiter.refusedFor('10.0.0.9', [op('op-HCM')])).toBeGreaterThan(0);
    // Same machine, different person. The counter PC is shared and the person
    // beside them has done nothing wrong.
    expect(limiter.refusedFor('10.0.0.9', [op('op-HAN')])).toBeNull();
    // Same person, different machine. They walk to the next counter.
    expect(limiter.refusedFor('10.0.0.8', [op('op-HCM')])).toBeGreaterThan(0);
  });

  it('stops one address after thirty failures however many references it sprays', () => {
    const limiter = signInLimiter();
    // Three each across ten references: no credential is anywhere near its ten,
    // which is exactly the shape a sprayer uses to stay under a per-account
    // limit.
    for (let i = 0; i < 10; i += 1) {
      for (let n = 0; n < 3; n += 1) limiter.attempted('10.0.0.9', [op(`op-${i}`)]);
    }
    expect(limiter.refusedFor('10.0.0.9', [op('op-fresh')])).toBeGreaterThan(0);
    expect(limiter.refusedFor('10.0.0.8', [op('op-fresh')])).toBeNull();
  });

  it('lets the window expire on its own, with nobody to unlock it', () => {
    const c = clock();
    const limiter = signInLimiter(c.now);
    for (let i = 0; i < 10; i += 1) limiter.attempted('10.0.0.9', [op('op-HCM')]);

    const wait = limiter.refusedFor('10.0.0.9', [op('op-HCM')]);
    expect(wait).toBe(300);
    // Fixed, not sliding: attempts inside a window do not push its end out, so
    // one lock lasts five minutes. A guesser who keeps going opens the next
    // window and holds the reference down for as long as they keep going —
    // ratelimit.ts says so, and says why nothing here softens it.
    c.advance(4 * 60_000);
    for (let i = 0; i < 10; i += 1) limiter.attempted('10.0.0.9', [op('op-HCM')]);
    expect(limiter.refusedFor('10.0.0.9', [op('op-HCM')])).toBe(60);

    c.advance(60_001);
    expect(limiter.refusedFor('10.0.0.9', [op('op-HCM')])).toBeNull();
  });

  it('gives back a right password and keeps counting the wrong ones', () => {
    const limiter = signInLimiter();
    // Nine wrong, then one right — the shape of somebody who has forgotten
    // which of their passwords it is and then remembers.
    for (let i = 0; i < 9; i += 1) limiter.attempted('10.0.0.9', [op('op-HCM')]);
    limiter.attempted('10.0.0.9', [op('op-HCM')]);
    limiter.succeeded('10.0.0.9', [op('op-HCM')]);

    // A shift of near misses does not accumulate into a lockout at 16:00.
    for (let i = 0; i < 9; i += 1) limiter.attempted('10.0.0.9', [op('op-HCM')]);
    expect(limiter.refusedFor('10.0.0.9', [op('op-HCM')])).toBeNull();

    // Eighteen wrong from that address are eighteen; the right one is not one
    // of them, or a busy counter would lock itself out by working.
    for (let i = 0; i < 11; i += 1) limiter.attempted('10.0.0.9', [op('op-other')]);
    expect(limiter.refusedFor('10.0.0.9', [op('op-fresh')])).toBeNull();
    limiter.attempted('10.0.0.9', [op('op-other')]);
    expect(limiter.refusedFor('10.0.0.9', [op('op-fresh')])).toBeGreaterThan(0);
  });

  it('does not count a blank field as a reference', () => {
    const limiter = signInLimiter();
    // Ten empty forms are ten failures from one address and no failures for any
    // person. Bucketing them together would lock out the next empty form and
    // nothing else, which is a counter that measures nothing.
    for (let i = 0; i < 10; i += 1) limiter.attempted('10.0.0.9', [op(''), mach('')]);
    expect(limiter.refusedFor('10.0.0.9', [op(''), mach('')])).toBeNull();
  });

  it('gives a shared machine reference the shared budget, not a person’s ten', () => {
    const limiter = signInLimiter();
    // Ten different people at one counter PC, each mistyping their own password
    // once, each naming the same machine. On a personal budget this locked the
    // counter and the eleventh person was refused with correct credentials.
    for (let i = 0; i < 10; i += 1) {
      limiter.attempted('10.0.0.9', [op(`op-staff-${i}`), mach('HCM-IMPORT-01')]);
    }
    expect(limiter.refusedFor('10.0.0.9', [op('op-staff-10'), mach('HCM-IMPORT-01')])).toBeNull();

    // It is a budget and not an exemption: the machine is still counted, and at
    // thirty it stops, the same as the address it sits behind.
    for (let i = 0; i < 20; i += 1) {
      limiter.attempted('10.0.0.8', [op(`op-night-${i}`), mach('HCM-IMPORT-01')]);
    }
    expect(limiter.refusedFor('10.0.0.7', [op('op-staff-11'), mach('HCM-IMPORT-01')])).toBeGreaterThan(0);
  });

  it('reports a refusal once per window, however long it is repeated', () => {
    const c = clock();
    const limiter = signInLimiter(c.now);
    for (let i = 0; i < 10; i += 1) limiter.attempted('10.0.0.9', [op('op-HCM')]);

    // One audit row for the lock, not one per refused repeat: a repeat costs the
    // attacker nothing and the table it would grow cannot be pruned.
    expect(limiter.noteRefusal('10.0.0.9', [op('op-HCM')])).toBe(true);
    for (let i = 0; i < 100; i += 1) {
      expect(limiter.noteRefusal('10.0.0.9', [op('op-HCM')])).toBe(false);
    }

    // The next window is a new event and is reported again.
    c.advance(5 * 60_001);
    for (let i = 0; i < 10; i += 1) limiter.attempted('10.0.0.9', [op('op-HCM')]);
    expect(limiter.noteRefusal('10.0.0.9', [op('op-HCM')])).toBe(true);
  });
});

describe.skipIf(!hasDb())('sign-in rate limiting', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const api = async () => buildApi({ db: await appDb(), tokenSecret: SECRET });

  /** Two centres, two operators, two machines: one attacker, one bystander. */
  async function seed() {
    const d = await db();
    const ids = { centreA: uid(), centreB: uid(), deviceA: uid(), deviceB: uid(), opA: uid(), opB: uid() };
    const hash = await hashCredential(PASSWORD);
    for (const [centre, machine, operator, region] of [
      [ids.centreA, ids.deviceA, ids.opA, 'HCM'],
      [ids.centreB, ids.deviceB, ids.opB, 'HAN'],
    ] as const) {
      await d.execute(sql`
        insert into upload_centres (id, region, name, status)
          values (${centre}, ${region}, ${'centre ' + region}, 'active')`);
      await d.execute(sql`
        insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
          values (${machine}, ${centre}, ${region + '-IMPORT-01'}, 'active', ${hash})`);
      await d.execute(sql`
        insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
          values (${operator}, ${centre}, ${'op-' + region}, 'centre_operator', ${hash})`);
    }
    return ids;
  }

  type App = Awaited<ReturnType<typeof api>>;
  // `inject` is chainable as well as awaitable, so the promise is named here or
  // every caller sees the chain type instead of the response.
  const post = (
    app: App,
    url: string,
    payload: Record<string, string>,
    from = '10.0.0.9',
  ): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url, payload, remoteAddress: from });

  it('refuses the eleventh guess at one operator reference, and says how long', async () => {
    await seed();
    const app = await api();

    for (let i = 0; i < 10; i += 1) {
      const wrong = await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: GUESS });
      expect(wrong.statusCode, `attempt ${i}`).toBe(401);
    }

    const blocked = await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: GUESS });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().constraint).toBe(SIGN_IN_RATE_LIMITED);
    expect(blocked.json().reason).toBe(SIGN_IN_RATE_LIMITED);
    // The wait is bounded and the header says it, so a screen can count down.
    expect(blocked.json().retry_after).toBeGreaterThan(0);
    expect(blocked.json().retry_after).toBeLessThanOrEqual(300);
    expect(blocked.headers['retry-after']).toBe(String(blocked.json().retry_after));

    // The measured finding, inverted: the right password no longer walks in
    // behind sixty wrong ones. The way back is the window, not an administrator.
    const right = await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: PASSWORD });
    expect(right.statusCode).toBe(429);

    // And the sentence exists to put on the screen, in all three languages.
    for (const messages of Object.values(MESSAGES)) {
      expect(messages[`bo.refused.${SIGN_IN_RATE_LIMITED}`]).toBeTruthy();
    }
  });

  it('caps a concurrent burst instead of verifying all of it', async () => {
    await seed();
    const app = await api();

    /**
     * The measured attack, exactly: sixty wrong passwords at once, not sixty in
     * a row. Before this branch all sixty were answered 401 — every one of them
     * had burnt a scrypt on the four-thread pool the review media stream shares.
     * The attempt is counted before the credential is checked, so most of the
     * burst is refused without hashing anything.
     */
    const many = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        post(app, '/auth/operator', { external_ref: 'op-HCM', secret: `${GUESS}-${i}` }),
      ),
    );
    const codes = many.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(30);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(30);
    expect(codes.filter((c) => c !== 401 && c !== 429)).toEqual([]);
  });

  it('does not lock a bystander out of the same counter', async () => {
    await seed();
    const app = await api();

    // Ten wrong guesses at op-HAN, from the machine op-HCM is standing at.
    for (let i = 0; i < 10; i += 1) {
      expect((await post(app, '/auth/operator', { external_ref: 'op-HAN', secret: GUESS })).statusCode).toBe(401);
    }
    expect((await post(app, '/auth/operator', { external_ref: 'op-HAN', secret: GUESS })).statusCode).toBe(429);

    // The person beside them signs in, on the same address, with no delay.
    const mine = await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: PASSWORD });
    expect(mine.statusCode, mine.body).toBe(200);

    // And so does the JSON sign-in the SPA uses, both credentials right.
    const session = await post(app, '/api/session', {
      external_ref: 'op-HCM',
      operator_secret: PASSWORD,
      machine_identifier: 'HCM-IMPORT-01',
      machine_secret: PASSWORD,
    });
    expect(session.statusCode, session.body).toBe(200);
  });

  it('limits every sign-in route off one budget', async () => {
    await seed();
    const app = await api();

    // Ten wrong at the JSON route; the header route is then refused for the
    // same reference, because moving between routes must not hand a guesser a
    // fresh ten.
    for (let i = 0; i < 10; i += 1) {
      const wrong = await post(app, '/api/session', {
        external_ref: 'op-HCM',
        operator_secret: GUESS,
        machine_identifier: 'HCM-IMPORT-01',
        machine_secret: GUESS,
      });
      expect(wrong.statusCode, `attempt ${i}`).toBe(401);
    }

    const blocked = await post(app, '/api/session', {
      external_ref: 'op-HCM',
      operator_secret: GUESS,
      machine_identifier: 'HCM-IMPORT-01',
      machine_secret: GUESS,
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();
    expect(blocked.json().constraint).toBe(SIGN_IN_RATE_LIMITED);

    const header = await post(app, '/auth/operator', {
      external_ref: 'op-HCM',
      secret: PASSWORD,
    });
    expect(header.statusCode).toBe(429);

    // The machine identifier was named on those ten attempts too, but it is
    // shared by everybody at that counter, so ten does not stop it: the device
    // route still answers. That success gives one attempt back, so twenty-one
    // more take the machine to its thirty, and then it does stop.
    const machine = await post(app, '/auth/machine', {
      machine_identifier: 'HCM-IMPORT-01',
      secret: PASSWORD,
    });
    expect(machine.statusCode, machine.body).toBe(200);

    for (let i = 0; i < 21; i += 1) {
      await post(app, '/auth/machine', { machine_identifier: 'HCM-IMPORT-01', secret: GUESS }, '10.0.0.8');
    }
    const locked = await post(
      app,
      '/auth/machine',
      { machine_identifier: 'HCM-IMPORT-01', secret: PASSWORD },
      '10.0.0.7',
    );
    expect(locked.statusCode).toBe(429);
  });

  it('does not lock a counter out because ten people mistyped at it', async () => {
    const d = await db();
    await seed();
    const app = await api();

    // The measured failure, before the machine identifier moved to the shared
    // budget: ten different staff, one counter PC, each with the correct machine
    // secret and their own password wrong, and the eleventh person was refused
    // with everything right.
    const staff: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const ref = `op-staff-${i}`;
      staff.push(ref);
      await d.execute(sql`
        insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
          select ${uid()}, id, ${ref}, 'centre_operator', ${await hashCredential(PASSWORD)}
            from upload_centres where region = 'HCM'`);
    }
    for (let i = 0; i < 10; i += 1) {
      const typo = await post(app, '/api/session', {
        external_ref: staff[i]!,
        operator_secret: GUESS,
        machine_identifier: 'HCM-IMPORT-01',
        machine_secret: PASSWORD,
      });
      expect(typo.statusCode, `typo ${i}`).toBe(401);
    }

    const eleventh = await post(app, '/api/session', {
      external_ref: staff[10]!,
      operator_secret: PASSWORD,
      machine_identifier: 'HCM-IMPORT-01',
      machine_secret: PASSWORD,
    });
    expect(eleventh.statusCode, eleventh.body).toBe(200);
  });

  it('records the machine when the machine is what was attacked', async () => {
    const d = await db();
    await seed();
    const app = await api();

    // A sign-in that names no person at all. Filing every row under the first
    // reference put `target_id = ''` against `operators` here — a row that says
    // an attempt happened and not what it was on.
    await post(
      app,
      '/api/session',
      { machine_identifier: 'HCM-IMPORT-01', machine_secret: GUESS },
      '10.0.0.7',
    );

    const rows = (await d.execute(sql`
      select action, target_table, target_id from audit_events
        where action like '%.login_failed'`)) as unknown as Record<string, string>[];
    expect(rows).toEqual([
      { action: 'machine.login_failed', target_table: 'upload_devices', target_id: 'HCM-IMPORT-01' },
    ]);
  });

  it('does not grow the trail once per refused repeat', async () => {
    const d = await db();
    await seed();
    const app = await api();

    const count = async () =>
      (
        (await d.execute(
          sql`select count(*)::int as n from audit_events where action like '%.login_failed'`,
        )) as unknown as { n: number }[]
      )[0]!.n;

    for (let i = 0; i < 10; i += 1) {
      await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: GUESS });
    }
    await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: GUESS });
    const afterFirstRefusal = await count();
    expect(afterFirstRefusal).toBe(11);

    /**
     * A hundred more, every one refused before a password is looked at. Measured
     * with a row per repeat: three hundred such requests wrote three hundred
     * rows in 783 ms, into a table `audit_events_append_only` will not let
     * anybody delete from. The lock is the event; the repeats are not.
     */
    for (let i = 0; i < 100; i += 1) {
      await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: GUESS });
    }
    expect(await count()).toBe(afterFirstRefusal);
  });

  it('leaves an audit row for every refused sign-in, and never the secret', async () => {
    const d = await db();
    await seed();
    const app = await api();

    for (let i = 0; i < 10; i += 1) {
      await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: GUESS });
    }
    await post(app, '/auth/operator', { external_ref: 'op-HCM', secret: GUESS });
    // A reference that names nobody is still an attempt, and still recorded.
    await post(app, '/auth/machine', { machine_identifier: 'NO-SUCH-MACHINE', secret: GUESS }, '10.0.0.8');

    const rows = (await d.execute(sql`
      select action, target_table, target_id, actor_role, operator_id,
             after ->> 'source' as source, after ->> 'outcome' as outcome
        from audit_events where action like '%.login_failed' order by id`)) as unknown as Record<
      string,
      string | null
    >[];

    // Eleven at /auth/operator — ten refused on the password, one on the limit
    // — and one at /auth/machine. Before this branch the whole run left none.
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r['outcome'] === 'credentials')).toHaveLength(11);
    expect(rows.filter((r) => r['outcome'] === 'rate_limited')).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'operator.login_failed',
      target_table: 'operators',
      target_id: 'op-HCM',
      source: '10.0.0.9',
    });
    expect(rows[11]).toMatchObject({
      action: 'machine.login_failed',
      target_table: 'upload_devices',
      target_id: 'NO-SUCH-MACHINE',
      source: '10.0.0.8',
    });
    // No actor: the attempt proved nobody, and a row naming one would be
    // evidence of something that did not happen.
    for (const row of rows) expect(row['operator_id']).toBeNull();

    // The one thing that must never reach the trail.
    const leaked = (await d.execute(sql`
      select count(*)::int as n from audit_events
        where after::text like ${'%' + GUESS + '%'} or target_id like ${'%' + GUESS + '%'}`)) as unknown as {
      n: number;
    }[];
    expect(leaked[0]!.n).toBe(0);
  });
});
