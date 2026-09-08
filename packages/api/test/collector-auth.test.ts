import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildApi,
  hashCredential,
  signToken,
  verifyToken,
  CODE_ATTEMPTS,
  ZnsDeliveryError,
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

  /**
   * A clock these tests move, so the one-minute send cooldown costs no wall
   * time. A sign-in code is a paid ZNS message and the cooldown does not refund
   * on success, so any test that asks for a second code for the same number has
   * to wait a minute — and waiting it for real would put a minute of sleep in
   * the suite for every one of them.
   */
  let clockMs = 1_700_000_000_000;
  const advance = (ms: number) => (clockMs += ms);
  /** Past the send cooldown, for a test that legitimately needs a second code. */
  const nextCode = () => advance(60_000);

  // `...arg` rather than a default: passing `undefined` explicitly has to mean
  // "no delivery configured", which a default parameter would quietly override.
  const api = async (...arg: [SendSignInCode | undefined] | []) =>
    buildApi({
      db: await appDb(),
      tokenSecret: SECRET,
      sendSignInCode: arg.length === 0 ? send : arg[0],
      now: () => clockMs,
    });

  type Api = Awaited<ReturnType<typeof api>>;

  const request = (app: Api, phone: string) =>
    app.inject({ method: 'POST', url: '/auth/collector/request-code', payload: { phone } });

  const verify = (app: Api, phone: string, code: string) =>
    app.inject({ method: 'POST', url: '/auth/collector/verify', payload: { phone, code } });

  /** Sign a collector in the way the app does, and hand back the token. */
  const signIn = async (app: Api, phone: string): Promise<string> => {
    // A second sign-in for one number is a second paid message, so it happens a
    // minute later. Real time, compressed: see `clockMs`.
    nextCode();
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

  /**
   * The demonstration echo. One number, named in `PLAYERONE_DEMO_PHONE` and
   * compared byte for byte, so nothing about any other number changes.
   */
  it('echoes the code for the one configured number and for nothing else', async () => {
    await seed();
    // The outbox is shared across this file and only `signIn` clears it, so a
    // test that sends without signing in has to clean up after itself.
    outbox.length = 0;
    const app = buildApi({
      db: await appDb(),
      tokenSecret: SECRET,
      sendSignInCode: send,
      demoPhone: PHONE_A,
      now: () => clockMs,
    });

    const demo = await request(app, PHONE_A);
    expect(demo.statusCode, demo.body).toBe(200);
    expect(demo.json().demo_code).toMatch(/^\d{6}$/);
    // Echoed, not minted differently: the code in the body is the code that was
    // stored, so it signs in.
    const signedIn = await verify(app, PHONE_A, demo.json().demo_code);
    expect(signedIn.statusCode, signedIn.body).toBe(200);

    // Another enrolled number in the same process is untouched.
    nextCode();
    const other = await request(app, PHONE_B);
    expect(other.statusCode, other.body).toBe(204);
    expect(other.body).toBe('');

    // A number nobody owns is 204 even when it IS the demo number, so the route
    // never becomes a way to ask whether some other number is enrolled.
    const app2 = buildApi({
      db: await appDb(),
      tokenSecret: SECRET,
      sendSignInCode: send,
      demoPhone: '+84900000999',
      now: () => clockMs,
    });
    nextCode();
    const unknown = await request(app2, '+84900000999');
    expect(unknown.statusCode, unknown.body).toBe(204);
    expect(unknown.body).toBe('');
    outbox.length = 0;
  });

  it('answers 503 for every number when it was handed no way to send a code', async () => {
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

  // -- a delivery that fails ------------------------------------------------

  /**
   * Zalo, not SMS (`src/zns.ts`). The failure that has no equivalent on SMS is
   * a number with no Zalo account: it exists, it rings, and it can never
   * receive a code. These are the criteria that follow from that.
   *
   * A run of `audit_events` for one collector, newest last.
   */
  const codeEvents = async (collectorId: string) => {
    const d = await db();
    const rows = await d.execute(sql`
      select action, actor_role, collector_id, operator_id, upload_device_id, upload_centre_id, after
        from audit_events
       where action = 'collector.sign_in_code'
         and target_id = ${collectorId}
       order by occurred_at`);
    return [...rows] as {
      action: string;
      actor_role: string;
      collector_id: string;
      operator_id: string | null;
      after: { channel: string; outcome: string };
    }[];
  };

  /** Wait for the delivery that runs after the reply to have been recorded. */
  const recorded = (collectorId: string, n = 1) =>
    vi.waitFor(
      async () => {
        const rows = await codeEvents(collectorId);
        expect(rows).toHaveLength(n);
        return rows;
      },
      { timeout: 10_000, interval: 25 },
    );

  it('answers the same, in the same time, when the number has no Zalo account', async () => {
    const ids = await seed();
    /**
     * The refusal that matters, and the one a timing attack would love: only
     * an enrolled number ever reaches the sender, so if a refusal were slower
     * than a success, the 204 would stop hiding which numbers are enrolled.
     */
    const noZalo = await api(async () => {
      throw new ZnsDeliveryError('zns_no_zalo_account', -118, 'User is not existed');
    });
    /**
     * Worse: a provider that never answers until this test lets it. A three
     * second sleep proved the same point against a clock, and the clock is
     * exactly what a loaded suite moves around; a delivery that cannot resolve
     * proves it by construction instead, because a reply that waited on the
     * delivery would never arrive at all.
     */
    let release!: () => void;
    const delivered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hangs = await api(() => delivered);
    const works = await api();

    const at = async (app: Api, phone: string) => {
      const started = Date.now();
      const res = await request(app, phone);
      return { ms: Date.now() - started, statusCode: res.statusCode, body: res.body };
    };

    const refused = await at(noZalo, PHONE_A);
    const hung = await at(hangs, PHONE_A);
    const sent = await at(works, PHONE_A);
    const unknown = await at(works, '+84900000999');

    // Same status, same body — including against a number nobody owns.
    for (const r of [refused, hung, sent, unknown]) {
      expect(r.statusCode).toBe(204);
      expect(r.body).toBe('');
    }
    /**
     * And the same time — as bounds, never as a spread. A spread is the
     * difference of two samples, so under a full parallel suite it measures
     * whichever request met a scheduler stall rather than measuring the route:
     * this line asserted a 150 ms spread and was red at 199–1038 ms across five
     * runs, green in isolation every time. Do not put a window back.
     *
     * What removes the systematic difference is the floor, and the floor has to
     * cover every path — the number nobody owns, which does strictly less work,
     * and the number whose delivery has not answered at all. A lower bound is
     * the half of that a loaded machine cannot break: load only ever makes a
     * request slower. That the delivery is off the reply's clock is no longer
     * timed at all — `hangs` above cannot have resolved yet, so `hung` having
     * come back with the rest of them is the whole proof.
     */
    const times = [refused.ms, hung.ms, sent.ms, unknown.ms];
    expect(Math.min(...times), JSON.stringify(times)).toBeGreaterThanOrEqual(380);
    // One generous ceiling, five times the 400 ms floor, as a smoke bound only.
    expect(Math.max(...times), JSON.stringify(times)).toBeLessThan(2_000);

    // The gated delivery has served its purpose; let it finish so its row lands
    // with the other two rather than after the next test has truncated.
    release();

    /**
     * Three requests for this collector, so three rows. The refusal is recorded
     * by name, so somebody can act on it.
     */
    const rows = await recorded(ids.collectorA, 3);
    expect(rows.map((r) => r.after.outcome).sort()).toEqual(['sent', 'sent', 'zns_no_zalo_account']);
  });

  it('records the attempt and its outcome against the collector, as a collector', async () => {
    const ids = await seed();
    const app = await api();
    await request(app, PHONE_A);

    const [row] = await recorded(ids.collectorA);
    expect(row!.after).toEqual({ channel: 'zns', outcome: 'sent' });
    // 0019's third attribution shape, with no exemption and no new migration:
    // a collector names themselves and nobody else.
    expect(row!.actor_role).toBe('collector');
    expect(row!.collector_id).toBe(ids.collectorA);
    expect(row!.operator_id).toBeNull();
  });

  it('records a sender that fails in a way nobody mapped as temporary, not permanent', async () => {
    const ids = await seed();
    const app = await api(async () => {
      throw new TypeError('a bug in a sender');
    });
    await request(app, PHONE_A);
    const [row] = await recorded(ids.collectorA);
    // Never `zns_no_zalo_account`: guessing "permanent" on an unknown failure
    // would strand a collector who is perfectly reachable.
    expect(row!.after.outcome).toBe('zns_unreachable');
  });

  it('writes no row at all for a number nobody owns', async () => {
    const d = await db();
    const ids = await seed();
    const app = await api();
    await request(app, '+84900000999');
    await request(app, PHONE_A);
    // Waiting for the enrolled one to land is what makes this a real
    // assertion rather than a race the unenrolled path always wins.
    await recorded(ids.collectorA);

    /**
     * Which numbers are NOT collectors is the question the 204 refuses to
     * answer, and it must not be answerable from this table either. Scoped to
     * the three collectors this test seeded — their ids are fresh per test, so
     * a delivery still finishing from an earlier one cannot be counted here.
     */
    const rows = await d.execute(sql`
      select target_id from audit_events
       where action = 'collector.sign_in_code'
         and target_id in (${ids.collectorA}, ${ids.collectorB}, ${ids.collectorNoPhone})`);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { target_id: string }).target_id).toBe(ids.collectorA);
  });

  it('never writes the code into audit_events', async () => {
    const d = await db();
    const ids = await seed();
    const app = await api();
    outbox.length = 0;
    await request(app, PHONE_A);
    await recorded(ids.collectorA);
    const code = outbox.at(-1)!.code;

    // Sign in as well, so the `collector.login` row is in the table too, and
    // read the whole table as text rather than the columns we expect.
    const res = await verify(app, PHONE_A, code);
    expect(res.statusCode, res.body).toBe(200);
    const rows = await d.execute(sql`select * from audit_events`);
    expect(rows.length).toBeGreaterThan(1);
    expect(JSON.stringify(rows)).not.toContain(code);
    // And the hash is not there either — it is a scrypt hash of the live code.
    const [collector] = await d.execute(
      sql`select sign_in_code_hash from collectors where id = ${ids.collectorA}`,
    );
    expect((collector as { sign_in_code_hash: string | null }).sign_in_code_hash).toBeNull();
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
    // A minute later, because a code costs money and the cooldown does not
    // refund on a correct sign-in.
    nextCode();
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

    /**
     * Asking twice inside a minute is refused, and it is the send cooldown that
     * refuses it rather than the failure limiter.
     *
     * This burst used to run against `request-code` and expect the eleventh to
     * be refused after ten went out. It cannot any more, and the reason is
     * worth stating: one send a minute is strictly tighter than ten per five
     * minutes, so a number can never accumulate ten requests inside one window
     * and the per-number failure counter is now unreachable from this route.
     * Guessing is still counted and still audited, and that is asserted below
     * on `verify`, which is the route where a credential is actually checked.
     */
    const first = await request(app, PHONE_A);
    expect(first.statusCode, first.body).toBe(204);
    const refused = await request(app, PHONE_A);
    expect(refused.statusCode, refused.body).toBe(429);
    expect(refused.json().constraint).toBe('sign_in_rate_limited');
    expect(refused.json().retry_after).toBeGreaterThan(0);
    expect(refused.headers['retry-after']).toBeDefined();

    // Eleven wrong codes: the limiter refuses and writes the one row that says
    // this number was under a limit, from here, then.
    for (let i = 0; i < 11; i += 1) await verify(app, PHONE_A, '999999');

    /**
     * The sign-in rows only. A delivery records its own outcome after the reply
     * (`collector.sign_in_code`) — a different action, asserted where it is
     * written rather than raced for here.
     */
    const loginRows = async () =>
      (await d.execute(sql`
        select action, target_table, target_id, actor_role, after->>'outcome' as outcome
          from audit_events where action like 'collector.login%'`)) as unknown as Record<
        string,
        string
      >[];

    const after = await loginRows();
    // Exactly one of them says the limiter refused, and it names the number.
    const limited = after.filter((r) => r['outcome'] === 'rate_limited');
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({
      action: 'collector.login_failed',
      target_table: 'collectors',
      target_id: PHONE_A,
      actor_role: 'collector',
      outcome: 'rate_limited',
    });

    /**
     * And it stays one however long the burst goes on. That is the property
     * worth pinning: three hundred refusals once wrote three hundred permanent
     * rows into a table an append-only trigger will not let anybody prune. Past
     * the limit nothing checks a credential, so nothing new is recorded.
     */
    for (let i = 0; i < 10; i += 1) await verify(app, PHONE_A, '999999');
    const later = await loginRows();
    expect(later).toHaveLength(after.length);
  });

  it('audits a sign-in as a collector, not as an operator', async () => {
    const d = await db();
    const ids = await seed();
    const app = await api();
    await signIn(app, PHONE_A);
    await verify(app, PHONE_A, '000000');

    // `collector.login%`, not `collector.%`: the delivery row this sign-in also
    // writes lands after the reply, so including it here would be a race.
    const rows = (await d.execute(sql`
      select action, target_table, target_id, actor_role, operator_id
        from audit_events where action like 'collector.login%' order by id`)) as unknown as Record<
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
