import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApi,
  hashCredential,
  signToken,
  verifyToken,
  CODE_ATTEMPTS,
  type SendSignInCode,
} from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, violates, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('collector_auth');

/**
 * A collector signing in, and the scope that sign-in opens. APP-01, SEC-01.
 *
 * The criteria that matter here are the ones somebody would try first: reading
 * another collector's identity, using a counter operator's token on a collector
 * route, keeping a token after the phone has been reported lost, and asking this
 * service which phone numbers belong to collectors.
 *
 * Two collectors and a counter operator in every fixture, on purpose. The trap
 * this repository has already paid for once is a scoping bug that every test
 * missed because every fixture had one of the thing being scoped.
 */

const SECRET = 'test-signing-key';
const uid = () => randomUUID();
const PHONE_A = '+84900000001';
const PHONE_B = '+84900000002';

/** Two collectors with numbers, one with none, and one counter operator. */
async function seed() {
  const d = await db();
  const ids = {
    collectorA: uid(),
    collectorB: uid(),
    collectorNoPhone: uid(),
    centre: uid(),
    device: uid(),
    operator: uid(),
    reviewer: uid(),
  };
  await d.execute(sql`
    insert into collectors (id, external_ref, status, phone) values
      (${ids.collectorA}, 'col-A', 'qualified', ${PHONE_A}),
      (${ids.collectorB}, 'col-B', 'qualified', ${PHONE_B}),
      (${ids.collectorNoPhone}, 'col-C', 'qualified', null)`);

  const hash = await hashCredential('correct horse');
  await d.execute(sql`
    insert into upload_centres (id, region, name, status)
      values (${ids.centre}, 'HCM', 'centre HCM', 'active')`);
  await d.execute(sql`
    insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${ids.device}, ${ids.centre}, 'HCM-IMPORT-01', 'active', ${hash})`);
  await d.execute(sql`
    insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${ids.operator}, ${ids.centre}, 'op-HCM', 'centre_operator', ${hash})`);
  await d.execute(sql`
    insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${ids.reviewer}, null, 'rev-1', 'reviewer', ${hash})`);
  return ids;
}

describe.skipIf(!hasDb())('collector sign-in', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  /** The codes this deployment "sent", newest last. */
  const outbox: { phone: string; code: string }[] = [];
  const send: SendSignInCode = async (phone, code) => {
    outbox.push({ phone, code });
  };

  // `...arg` rather than a default: passing `undefined` explicitly has to mean
  // "no delivery configured", which a default parameter would quietly override.
  const api = async (...arg: [SendSignInCode | undefined] | []) =>
    buildApi({
      db: await appDb(),
      tokenSecret: SECRET,
      sendSignInCode: arg.length === 0 ? send : arg[0],
    });

  type Api = Awaited<ReturnType<typeof api>>;

  const request = (app: Api, phone: string) =>
    app.inject({ method: 'POST', url: '/auth/collector/request-code', payload: { phone } });

  const verify = (app: Api, phone: string, code: string) =>
    app.inject({ method: 'POST', url: '/auth/collector/verify', payload: { phone, code } });

  /** Sign a collector in the way the app does, and hand back the token. */
  const signIn = async (app: Api, phone: string): Promise<string> => {
    outbox.length = 0;
    const asked = await request(app, phone);
    expect(asked.statusCode, asked.body).toBe(204);
    const sent = outbox.at(-1);
    expect(sent?.phone).toBe(phone);
    const res = await verify(app, phone, sent!.code);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().token as string;
  };

  /** Both counter credentials, as `auth.test.ts` does it. */
  const operatorTokens = async (app: Api) => {
    const machine = await app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: 'HCM-IMPORT-01', secret: 'correct horse' },
    });
    const operator = await app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: 'op-HCM', secret: 'correct horse' },
    });
    expect(machine.statusCode, machine.body).toBe(200);
    expect(operator.statusCode, operator.body).toBe(200);
    return {
      'x-machine-token': `Bearer ${machine.json().token}`,
      authorization: `Bearer ${operator.json().token}`,
    };
  };

  // -- delivery ------------------------------------------------------------

  it('answers 503 for every number when there is no way to send an SMS', async () => {
    await seed();
    const app = await api(undefined);

    // Enrolled and unenrolled alike: the refusal is about this deployment, not
    // about the number, so it cannot be used to ask about one.
    for (const phone of [PHONE_A, '+84900000999']) {
      const res = await request(app, phone);
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain('not configured');
    }
    expect(outbox).toHaveLength(0);
  });

  // -- enumeration ---------------------------------------------------------

  it('answers a request for a code identically whether or not the number is enrolled', async () => {
    await seed();
    const app = await api();
    outbox.length = 0;

    const enrolled = await request(app, PHONE_A);
    const unknown = await request(app, '+84900000999');

    expect(enrolled.statusCode).toBe(204);
    expect(unknown.statusCode).toBe(204);
    expect(enrolled.body).toBe(unknown.body);
    expect(enrolled.body).toBe('');
    // One code went out, and it went to the number that exists.
    expect(outbox.map((m) => m.phone)).toEqual([PHONE_A]);
  });

  it('takes at least the latency floor on both paths', async () => {
    await seed();
    const app = await api();

    // A lower bound is the part of constant latency that can be asserted
    // without a timing race: an unenrolled number does strictly less work, so
    // if the floor were missing it would come back measurably sooner.
    const at = async (phone: string) => {
      const started = Date.now();
      await request(app, phone);
      return Date.now() - started;
    };
    expect(await at(PHONE_A)).toBeGreaterThanOrEqual(380);
    expect(await at('+84900000999')).toBeGreaterThanOrEqual(380);
  });

  it('gives one answer to a wrong number, a wrong code and an expired code', async () => {
    const d = await db();
    const ids = await seed();
    const app = await api();
    outbox.length = 0;
    await request(app, PHONE_A);
    const good = outbox.at(-1)!.code;

    const wrongNumber = await verify(app, '+84900000999', good);
    const wrongCode = await verify(app, PHONE_A, good === '000000' ? '000001' : '000000');

    await d.execute(
      sql`update collectors set sign_in_code_expires_at = now() - interval '1 second'
            where id = ${ids.collectorA}`,
    );
    const expired = await verify(app, PHONE_A, good);

    for (const res of [wrongNumber, wrongCode, expired]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'credentials', reason: 'credentials' });
    }
  });

  // -- the code ------------------------------------------------------------

  it('mints a token for the right code and stores only its hash', async () => {
    const d = await db();
    const ids = await seed();
    const app = await api();
    outbox.length = 0;
    await request(app, PHONE_A);
    const code = outbox.at(-1)!.code;

    const [stored] = (await d.execute(
      sql`select sign_in_code_hash from collectors where id = ${ids.collectorA}`,
    )) as unknown as { sign_in_code_hash: string }[];
    expect(stored!.sign_in_code_hash).toMatch(/^scrypt\$/);
    expect(stored!.sign_in_code_hash).not.toContain(code);

    const res = await verify(app, PHONE_A, code);
    expect(res.statusCode).toBe(200);
    // The token and nothing else: no id, no phone, no status.
    expect(Object.keys(res.json())).toEqual(['token']);
    const claims = verifyToken(SECRET, res.json().token as string);
    expect(claims).toMatchObject({ kind: 'collector', collectorId: ids.collectorA });
  });

  it('spends the code, so replaying it is refused', async () => {
    await seed();
    const app = await api();
    outbox.length = 0;
    await request(app, PHONE_A);
    const code = outbox.at(-1)!.code;

    expect((await verify(app, PHONE_A, code)).statusCode).toBe(200);
    const replay = await verify(app, PHONE_A, code);
    expect(replay.statusCode).toBe(401);
  });

  it('kills a code after too many guesses, and a new code brings it back', async () => {
    await seed();
    const app = await api();
    outbox.length = 0;
    await request(app, PHONE_A);
    const code = outbox.at(-1)!.code;
    const wrong = code === '000000' ? '000001' : '000000';

    for (let i = 0; i < CODE_ATTEMPTS; i += 1) {
      expect((await verify(app, PHONE_A, wrong)).statusCode).toBe(401);
    }
    // The correct code now, and it is refused: the code is dead, not the guess.
    expect((await verify(app, PHONE_A, code)).statusCode).toBe(401);

    // Asking again is the whole recovery path — no administrator, no restart.
    await request(app, PHONE_A);
    expect((await verify(app, PHONE_A, outbox.at(-1)!.code)).statusCode).toBe(200);
  });

  // -- the token -----------------------------------------------------------

  it('issues thirty days, not the operator’s twelve hours', async () => {
    await seed();
    const app = await api();
    const token = await signIn(app, PHONE_A);

    const { exp } = JSON.parse(
      Buffer.from(token.split('.')[0]!, 'base64url').toString(),
    ) as { exp: number };
    const days = (exp - Math.floor(Date.now() / 1e3)) / 86_400;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('revokes every device by bumping one number', async () => {
    const d = await db();
    const ids = await seed();
    const app = await api();

    // Two devices, both signed in, as a collector who changes phones has.
    const first = await signIn(app, PHONE_A);
    const second = await signIn(app, PHONE_A);
    for (const token of [first, second]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    }

    await d.execute(
      sql`update collectors set token_epoch = token_epoch + 1 where id = ${ids.collectorA}`,
    );

    for (const token of [first, second]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    }
    // And signing in again works, with no other administration.
    const fresh = await signIn(app, PHONE_A);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${fresh}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('says “sign in again”, not “forbidden”, when the token has run out', async () => {
    await seed();
    const app = await api();
    const stale = signToken(
      SECRET,
      { kind: 'collector', collectorId: uid(), epoch: 1 },
      Math.floor(Date.now() / 1e3) - 31 * 86_400,
    );

    // A thirty-day token expires in a pocket, and the app has to tell that
    // apart from a token of the wrong kind or it cannot decide what to show.
    for (const headers of [{}, { authorization: `Bearer ${stale}` }]) {
      const res = await app.inject({ method: 'GET', url: '/api/me', headers });
      expect(res.statusCode, JSON.stringify(headers)).toBe(401);
      expect(res.json().error).toBe('collector token required');
    }
  });

  it('refuses a token signed for a collector who no longer exists', async () => {
    await seed();
    const app = await api();
    const orphan = signToken(SECRET, { kind: 'collector', collectorId: uid(), epoch: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${orphan}` },
    });
    expect(res.statusCode).toBe(401);
  });

  // -- the scoping rule ----------------------------------------------------

  it('answers with the id off the token, which no request can name', async () => {
    const ids = await seed();
    const app = await api();
    const a = await signIn(app, PHONE_A);
    const b = await signIn(app, PHONE_B);

    for (const [token, id] of [
      [a, ids.collectorA],
      [b, ids.collectorB],
    ] as const) {
      for (const url of ['/whoami', '/api/me']) {
        const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode, res.body).toBe(200);
        // Exactly two fields. A route that leaked a phone or a status here
        // would be the first thing an enumerator asked for.
        expect(res.json()).toEqual({ role: 'collector', collector_id: id });
      }
    }
    // There is no path, query or body carrying a collector id, so B's id
    // offered to A's token is not a request this service can express — the
    // closest thing is asking for it, and the answer is still A.
    const res = await app.inject({
      method: 'GET',
      url: `/api/me?collector_id=${ids.collectorB}`,
      headers: { authorization: `Bearer ${a}` },
    });
    expect(res.json().collector_id).toBe(ids.collectorA);
  });

  it('refuses a collector token on every operator and reviewer route', async () => {
    await seed();
    const app = await api();
    const token = await signIn(app, PHONE_A);

    for (const url of [
      '/reference/sync',
      '/api/backoffice/collectors',
      '/api/review/queue',
      '/api/settle/bills',
      '/api/payout/accounts',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}`, 'x-machine-token': `Bearer ${token}` },
      });
      // 403 for a route that exists, 404 for one that does not — never a 200,
      // and never an answer that names anything at an upload centre.
      expect([403, 404], `${url} answered ${res.statusCode}`).toContain(res.statusCode);
      if (res.statusCode === 403) expect(res.json().error).toContain('collector session');
    }
  });

  it('refuses an operator and a reviewer on /api/me', async () => {
    await seed();
    const app = await api();

    const counter = await operatorTokens(app);
    const asOperator = await app.inject({ method: 'GET', url: '/api/me', headers: counter });
    expect(asOperator.statusCode).toBe(403);
    expect(asOperator.json().error).toBe('collector session required');

    const session = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { role: 'reviewer', external_ref: 'rev-1', operator_secret: 'correct horse' },
    });
    expect(session.statusCode, session.body).toBe(200);
    const asReviewer = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${signToken(SECRET, { kind: 'reviewer', reviewerId: session.json().reviewer_id as string })}` },
    });
    expect(asReviewer.statusCode).toBe(403);
    // The same refusal as the operator's, and by the same guard: the collector
    // scope is checked before the reviewer scope, so `/api/me` is closed to
    // everybody who is not a collector in one place rather than two.
    expect(asReviewer.json().error).toBe('collector session required');
  });

  // -- rate limit and audit ------------------------------------------------

  it('shares the sign-in limiter and leaves a failed-sign-in row', async () => {
    const d = await db();
    await seed();
    const app = await api();

    // Ten codes per number per window; the eleventh is refused. Every request
    // counts, because this route sends an SMS rather than checking a password.
    let refused: Awaited<ReturnType<typeof request>> | undefined;
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app, PHONE_A);
      if (res.statusCode === 429) {
        refused = res;
        break;
      }
    }
    expect(refused, 'the limiter never refused a burst of eleven').toBeDefined();
    expect(refused!.json().constraint).toBe('sign_in_rate_limited');
    expect(refused!.json().retry_after).toBeGreaterThan(0);
    expect(refused!.headers['retry-after']).toBeDefined();

    const rows = (await d.execute(sql`
      select action, target_table, target_id, actor_role, after->>'outcome' as outcome
        from audit_events where action like 'collector.%'`)) as unknown as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'collector.login_failed',
      target_table: 'collectors',
      target_id: PHONE_A,
      actor_role: 'collector',
      outcome: 'rate_limited',
    });
  });

  it('audits a sign-in as a collector, not as an operator', async () => {
    const d = await db();
    const ids = await seed();
    const app = await api();
    await signIn(app, PHONE_A);
    await verify(app, PHONE_A, '000000');

    const rows = (await d.execute(sql`
      select action, target_table, target_id, actor_role, operator_id
        from audit_events where action like 'collector.%' order by id`)) as unknown as Record<
      string,
      string | null
    >[];
    expect(rows.map((r) => r['action'])).toEqual(['collector.login', 'collector.login_failed']);
    for (const row of rows) {
      expect(row['actor_role']).toBe('collector');
      expect(row['target_table']).toBe('collectors');
      // A collector is not an operator and `operator_id` has a key into that
      // table. Filing one there would either fail or name a stranger.
      expect(row['operator_id']).toBeNull();
    }
    expect(rows[0]!['target_id']).toBe(ids.collectorA);
  });

  // -- the schema ----------------------------------------------------------

  it('holds the sign-in invariants in the database, not in TypeScript', async () => {
    const d = await db();
    const ids = await seed();

    await violates(
      'collectors_phone_key',
      d.execute(sql`update collectors set phone = ${PHONE_A} where id = ${ids.collectorB}`),
    );
    await violates(
      'collectors_sign_in_code_check',
      d.execute(sql`update collectors set sign_in_code_hash = 'x' where id = ${ids.collectorA}`),
    );
    await violates(
      'collectors_sign_in_code_check',
      d.execute(
        sql`update collectors set sign_in_code_expires_at = now() where id = ${ids.collectorA}`,
      ),
    );
    await violates(
      'collectors_sign_in_code_attempts_check',
      d.execute(sql`update collectors set sign_in_code_attempts = -1 where id = ${ids.collectorA}`),
    );
    await violates(
      'collectors_token_epoch_check',
      d.execute(sql`update collectors set token_epoch = 0 where id = ${ids.collectorA}`),
    );

    // Many collectors may have no number at all; exactly one may have any given
    // number. That is what makes the sign-in lookup by phone alone safe.
    await d.execute(
      sql`insert into collectors (id, external_ref, status) values (${uid()}, 'col-D', 'pending')`,
    );
  });

  it('refuses an audit row that makes a collector the actor on a change', async () => {
    const d = await db();
    const ids = await seed();
    // The role exists for sign-in rows and nothing else yet. A collector
    // mutation needs somebody to decide what that row records first.
    await violates(
      'audit_events_attributed_check',
      d.execute(sql`
        insert into audit_events (action, target_table, target_id, actor_role)
          values ('episode.submit', 'episodes', ${ids.collectorA}, 'collector')`),
    );
    await violates(
      'audit_events_actor_role_check',
      d.execute(sql`
        insert into audit_events (action, target_table, target_id, actor_role)
          values ('collector.login', 'collectors', ${ids.collectorA}, 'stranger')`),
    );
  });
});
