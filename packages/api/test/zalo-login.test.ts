import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_DEEP_LINK,
  buildApi,
  codeChallengeFor,
  SIGN_IN_TTL_MS,
  verifyToken,
  ZALO_AUTHORIZE_PATH,
  ZALO_CALLBACK_PATH,
  ZALO_LOGIN_REFUSALS,
  ZALO_PROFILE_PATH,
  ZALO_TOKEN_PATH,
  zaloLogin,
  zaloLoginFromEnv,
  type ZaloLogin,
} from '../src/index.ts';
import { MESSAGES } from '../src/i18n.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('zalo_login');

/**
 * Signing in with an ordinary Zalo account. APP-01, SEC-01, migration 0035.
 *
 * Owner's decision of 2026-09-16, which overrides the ZNS-only rule: VNG's ZNS
 * Official Account is not available, so a sign-in that waits for a code to
 * arrive in Zalo delivers nothing to anybody.
 *
 * ## Why the fixture is a `fetch` and not a server on 127.0.0.1
 *
 * `test/zns/fake-server.ts` is a real Fastify server because the ZNS client's
 * failure modes are socket-level: a hang past the client's budget, a reset
 * mid-body, a truncated JSON body. None of those is what this flow can get
 * wrong. What it can get wrong is which parameter is sent where, whether the
 * verifier ever leaves the process, and whether a state or a ticket can be
 * spent twice — and a recorded `fetch` proves all of those with none of the
 * server. The three transport failures are `zalo_unreachable` on one line each
 * and are covered here by a stub that throws and one that answers HTML.
 */

const SECRET = 'test-signing-key';
const APP_ID = '3849367142822243338';
const APP_SECRET = 'zalo-app-secret-never-logged';
const ORIGIN = 'https://demo.203-0-113-4.sslip.io';
const ZALO_ID = '9876543210123456789';

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** What the fake Zalo answers next, one entry per call, then `rest`. */
type Answer =
  | { kind: 'json'; status?: number; body: unknown }
  | { kind: 'text'; status: number; body: string }
  | { kind: 'throw' };

function fakeZalo(answers: Answer[] = []) {
  const calls: Call[] = [];
  const queue = [...answers];
  /**
   * What each endpoint answers once `answers` is spent, and it does not run
   * out: a test that signs the same person in twice makes four calls, and a
   * queue of two would make the second attempt look like a Zalo outage.
   * Keyed by endpoint rather than by call number for the same reason.
   */
  const standing: Record<'token' | 'me', Answer> = {
    token: { kind: 'json', body: { access_token: 'ZALO-USER-ACCESS-TOKEN', expires_in: '3600' } },
    me: { kind: 'json', body: { id: ZALO_ID, name: 'Nguyễn Văn A' } },
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const answer =
      queue.shift() ?? (url.includes(ZALO_TOKEN_PATH) ? standing.token : standing.me);
    if (answer.kind === 'throw') throw Object.assign(new Error('socket hang up'), { name: 'TypeError' });
    if (answer.kind === 'text') {
      return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/html' } });
    }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    calls,
    fetch: fetchFn,
    /** For a test that wants only one of the two endpoints to misbehave. */
    answersWith(where: 'token' | 'me', answer: Answer) {
      standing[where] = answer;
    },
  };
}

const client = (fetchFn: typeof fetch): ZaloLogin =>
  zaloLogin({
    appId: APP_ID,
    appSecret: APP_SECRET,
    publicOrigin: ORIGIN,
    fetch: fetchFn,
    // Silent: an expected refusal must not print a warning per test.
    warn: () => {},
  });

describe.skipIf(!hasDb())('signing in with Zalo', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const api = async (zalo?: ZaloLogin) =>
    buildApi({ db: await appDb(), tokenSecret: SECRET, zaloLogin: zalo });

  type Api = Awaited<ReturnType<typeof api>>;

  const start = (app: Api) => app.inject({ method: 'POST', url: '/auth/collector/zalo/start' });
  const callback = (app: Api, query: Record<string, string>) =>
    app.inject({
      method: 'GET',
      url: `${ZALO_CALLBACK_PATH}?${new URLSearchParams(query).toString()}`,
    });
  const exchange = (app: Api, ticket: string) =>
    app.inject({ method: 'POST', url: '/auth/collector/ticket', payload: { ticket } });

  /** The deep link's parameters, so a test reads `ticket` or `error` by name. */
  const landed = (location: string): URLSearchParams => {
    expect(location.startsWith(`${APP_DEEP_LINK}?`), location).toBe(true);
    return new URL(location).searchParams;
  };

  // -- the happy path ------------------------------------------------------

  it('takes a stranger from the first tap to a session, and enrols them as a prospect', async () => {
    const zalo = fakeZalo();
    const app = await api(client(zalo.fetch));

    const opened = await start(app);
    expect(opened.statusCode, opened.body).toBe(200);
    const { url, state } = opened.json() as { url: string; state: string };
    const authorize = new URL(url);

    // Every parameter Zalo Login v4 reads, and the redirect URI it must match.
    expect(authorize.origin + authorize.pathname).toBe(`https://oauth.zaloapp.com${ZALO_AUTHORIZE_PATH}`);
    expect(authorize.searchParams.get('app_id')).toBe(APP_ID);
    expect(authorize.searchParams.get('redirect_uri')).toBe(ORIGIN + ZALO_CALLBACK_PATH);
    expect(authorize.searchParams.get('state')).toBe(state);
    /**
     * And nothing else. Zalo Login v4 documents four parameters and its own
     * SDK sends four; `code_challenge_method` is not one of them, and this is
     * what stops it being added back on OAuth habit.
     */
    expect([...authorize.searchParams.keys()].sort()).toEqual([
      'app_id',
      'code_challenge',
      'redirect_uri',
      'state',
    ]);

    /**
     * The verifier is in the database and the challenge is in the URL, and the
     * verifier is NOT. That asymmetry is the whole of PKCE: if the browser
     * carried the verifier, an intercepted code could be exchanged by whoever
     * intercepted it.
     */
    const d = await db();
    const [row] = await d.execute<{ code_verifier: string }>(
      sql`select code_verifier from zalo_sign_ins where state = ${state}`,
    );
    expect(row?.code_verifier).toBeTruthy();
    expect(url).not.toContain(row!.code_verifier);
    expect(authorize.searchParams.get('code_challenge')).toBe(codeChallengeFor(row!.code_verifier));

    const back = await callback(app, { code: 'zalo-auth-code', state });
    expect(back.statusCode, back.body).toBe(302);
    const ticket = landed(back.headers.location as string).get('ticket');
    expect(ticket).toBeTruthy();

    // The exchange sent the code, the verifier and the secret in its header.
    const token = zalo.calls[0]!;
    expect(token.url).toBe(`https://oauth.zaloapp.com${ZALO_TOKEN_PATH}`);
    expect(token.method).toBe('POST');
    expect(token.headers['secret_key']).toBe(APP_SECRET);
    const sent = new URLSearchParams(token.body);
    expect(sent.get('code')).toBe('zalo-auth-code');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code_verifier')).toBe(row!.code_verifier);

    // The profile call carries the user token as a header, not a bearer.
    const me = zalo.calls[1]!;
    expect(me.url).toBe(`https://graph.zalo.me${ZALO_PROFILE_PATH}?fields=id,name`);
    expect(me.headers['access_token']).toBe('ZALO-USER-ACCESS-TOKEN');
    expect(me.headers['authorization']).toBeUndefined();

    // The ticket, and only the ticket, is what the app trades for a session.
    const signedIn = await exchange(app, ticket!);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const claims = verifyToken(SECRET, signedIn.json().token as string);
    expect(claims?.kind).toBe('collector');

    /**
     * 0034's status, and no phone: Zalo Login does not hand us one, which is
     * why `collectors_zalo_id_key` exists at all.
     */
    const [collector] = await d.execute<{ status: string; phone: string | null; external_ref: string; name: string }>(
      sql`select status, phone, external_ref, name from collectors where zalo_id = ${ZALO_ID}`,
    );
    expect(collector?.status).toBe('prospect');
    expect(collector?.phone).toBeNull();
    expect(collector?.external_ref).toBe(`zalo:${ZALO_ID}`);
    expect(collector?.name).toBe('Nguyễn Văn A');

    // PLT-07: the sign-up and the sign-in are both attributed to the collector.
    const audit = await d.execute<{ action: string }>(
      sql`select action from audit_events where target_id = ${(claims as { collectorId: string }).collectorId} order by action`,
    );
    expect(audit.map((r) => r.action)).toEqual(['collector.login', 'collector.sign_up']);
  });

  it('signs a returning collector into the same row, and makes no second one', async () => {
    const app = await api(client(fakeZalo().fetch));
    const d = await db();

    const once = async (): Promise<string> => {
      const { state } = (await start(app)).json() as { state: string };
      const back = await callback(app, { code: `code-${state.slice(0, 6)}`, state });
      const ticket = landed(back.headers.location as string).get('ticket')!;
      const signedIn = await exchange(app, ticket);
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      return (verifyToken(SECRET, signedIn.json().token as string) as { collectorId: string }).collectorId;
    };

    expect(await once()).toBe(await once());
    const [count] = await d.execute<{ n: number }>(sql`select count(*)::int as n from collectors`);
    expect(count?.n).toBe(1);
  });

  // -- the ways it is refused ---------------------------------------------

  it('refuses a callback naming a state it never wrote, and never calls Zalo', async () => {
    const zalo = fakeZalo();
    const app = await api(client(zalo.fetch));

    const forged = await callback(app, { code: 'zalo-auth-code', state: 'not-a-state-this-server-wrote' });
    expect(forged.statusCode).toBe(302);
    expect(landed(forged.headers.location as string).get('error')).toBe('zalo_state_unknown');
    // The refusal is decided before a code is exchanged: a forged state must
    // not be able to make this server talk to Zalo at all.
    expect(zalo.calls).toHaveLength(0);
  });

  it('refuses a replayed callback, because the state is spent by the statement that reads it', async () => {
    const app = await api(client(fakeZalo().fetch));
    const { state } = (await start(app)).json() as { state: string };

    const first = await callback(app, { code: 'zalo-auth-code', state });
    expect(landed(first.headers.location as string).get('ticket')).toBeTruthy();

    const again = await callback(app, { code: 'zalo-auth-code', state });
    expect(landed(again.headers.location as string).get('error')).toBe('zalo_state_unknown');
  });

  it('refuses a state older than its ten minutes', async () => {
    const app = await api(client(fakeZalo().fetch));
    const { state } = (await start(app)).json() as { state: string };

    // Expired in the database rather than by waiting: the TTL is a column, and
    // the route reads that column.
    const d = await db();
    await d.execute(
      sql`update zalo_sign_ins set expires_at = now() - interval '1 second' where state = ${state}`,
    );

    const late = await callback(app, { code: 'zalo-auth-code', state });
    expect(landed(late.headers.location as string).get('error')).toBe('zalo_state_expired');
    // And the attempt is spent, so it cannot be retried into a session either.
    const retry = await callback(app, { code: 'zalo-auth-code', state });
    expect(landed(retry.headers.location as string).get('error')).toBe('zalo_state_unknown');
  });

  it('names what Zalo refused, and enrols nobody', async () => {
    const d = await db();
    // Zalo's own shape for a refused exchange: a 200 with an error envelope and
    // no `access_token`. SIGN_IN_TTL_MS is asserted so a change to it is not
    // silently a change to the refusal.
    expect(SIGN_IN_TTL_MS).toBe(600_000);

    for (const [answers, expected] of [
      [[{ kind: 'json', body: { error: -201, error_name: 'invalid_code' } }], 'zalo_code_refused'],
      [[{ kind: 'text', status: 502, body: '<html>bad gateway</html>' }], 'zalo_unreachable'],
      [[{ kind: 'throw' }], 'zalo_unreachable'],
    ] as const) {
      const zalo = fakeZalo([...answers]);
      const app = await api(client(zalo.fetch));
      const { state } = (await start(app)).json() as { state: string };
      const refused = await callback(app, { code: 'zalo-auth-code', state });
      expect(landed(refused.headers.location as string).get('error'), expected).toBe(expected);
    }

    // And a token that was issued to somebody `graph.zalo.me` will not describe.
    const zalo = fakeZalo();
    zalo.answersWith('me', {
      kind: 'json',
      status: 400,
      body: { error: { code: -205, message: 'invalid token' } },
    });
    const app = await api(client(zalo.fetch));
    const { state } = (await start(app)).json() as { state: string };
    const refused = await callback(app, { code: 'zalo-auth-code', state });
    expect(landed(refused.headers.location as string).get('error')).toBe('zalo_profile_refused');

    const [count] = await d.execute<{ n: number }>(sql`select count(*)::int as n from collectors`);
    expect(count?.n).toBe(0);
  });

  it('refuses a replayed ticket, and a ticket nobody was issued', async () => {
    const app = await api(client(fakeZalo().fetch));
    const { state } = (await start(app)).json() as { state: string };
    const back = await callback(app, { code: 'zalo-auth-code', state });
    const ticket = landed(back.headers.location as string).get('ticket')!;

    const first = await exchange(app, ticket);
    expect(first.statusCode, first.body).toBe(200);

    /**
     * The same 401, and the same name, for a ticket that has been used and one
     * that never existed: telling them apart tells whoever holds a stolen
     * ticket which of their guesses was worth repeating.
     */
    for (const attempt of [ticket, 'a-ticket-that-was-never-issued']) {
      const replayed = await exchange(app, attempt);
      expect(replayed.statusCode, replayed.body).toBe(401);
      expect(replayed.json().constraint).toBe('zalo_ticket_spent');
    }

    // One session was issued, so one login was recorded and no more.
    const d = await db();
    const [logins] = await d.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_events where action = 'collector.login'`,
    );
    expect(logins?.n).toBe(1);
  });

  it('says it is not configured on the two routes that need a Zalo app', async () => {
    const app = await api(undefined);
    for (const res of [await start(app), await callback(app, { code: 'x', state: 'y' })]) {
      expect(res.statusCode, res.body).toBe(503);
      expect(res.json().constraint).toBe('zalo_not_configured');
    }
    /**
     * The ticket route is deliberately NOT in that list. It never talks to
     * Zalo, and on a deployment with no Zalo app nobody was ever issued a
     * ticket — so the ordinary 401 is both true and the answer that says less.
     * A 503 here would be a configuration oracle on an unauthenticated route.
     */
    const spent = await exchange(app, 'a-ticket-nobody-was-issued');
    expect(spent.statusCode, spent.body).toBe(401);
    expect(spent.json().constraint).toBe('zalo_ticket_spent');
  });

  it('never puts the app secret, the code or the session token in the redirect', async () => {
    const zalo = fakeZalo();
    const app = await api(client(zalo.fetch));
    const { state } = (await start(app)).json() as { state: string };
    const back = await callback(app, { code: 'zalo-auth-code', state });
    const location = back.headers.location as string;
    expect(location).not.toContain(APP_SECRET);
    expect(location).not.toContain('zalo-auth-code');
    expect(location).not.toContain('ZALO-USER-ACCESS-TOKEN');
    // The ticket is in the URL; its digest is what the database holds.
    const ticket = landed(location).get('ticket')!;
    const d = await db();
    const [row] = await d.execute<{ ticket_hash: string }>(
      sql`select ticket_hash from zalo_sign_ins where state = ${state}`,
    );
    expect(row?.ticket_hash).not.toBe(ticket);
  });
});

// ---------------------------------------------------------------------------

describe('the environment reader', () => {
  it('is absent when nothing is set, and throws by name when half of it is', () => {
    expect(zaloLoginFromEnv({})).toBeNull();
    expect(() => zaloLoginFromEnv({ PLAYERONE_ZALO_APP_ID: APP_ID })).toThrow(
      /PLAYERONE_ZALO_APP_SECRET/,
    );
    expect(() =>
      zaloLoginFromEnv({ PLAYERONE_ZALO_APP_ID: APP_ID, PLAYERONE_ZALO_APP_SECRET: APP_SECRET }),
    ).toThrow(/PLAYERONE_PUBLIC_ORIGIN/);
  });

  it('takes the public origin from PLAYERONE_PUBLIC_URL, which every cloud deployment already sets', () => {
    const zalo = zaloLoginFromEnv({
      PLAYERONE_ZALO_APP_ID: APP_ID,
      PLAYERONE_ZALO_APP_SECRET: APP_SECRET,
      PLAYERONE_PUBLIC_URL: ORIGIN,
    });
    expect(zalo?.redirectUri).toBe(ORIGIN + ZALO_CALLBACK_PATH);
  });

  it('refuses a public origin that carries a path, because the redirect URI is built from it', () => {
    expect(() =>
      zaloLogin({ appId: APP_ID, appSecret: APP_SECRET, publicOrigin: `${ORIGIN}/console` }),
    ).toThrow(/publicOrigin/);
  });
});

describe('the Zalo refusal names', () => {
  it('has a sentence for every one, in all three languages', () => {
    for (const name of ZALO_LOGIN_REFUSALS) {
      for (const locale of ['en', 'zh', 'vi'] as const) {
        expect(MESSAGES[locale][`bo.refused.${name}`], `no ${locale} sentence for ${name}`).toBeTruthy();
      }
    }
  });

  it('has no sentence for a refusal that no longer exists', () => {
    const named = Object.keys(MESSAGES.en).filter((k) => k.startsWith('bo.refused.zalo_'));
    expect(new Set(named)).toEqual(new Set([...ZALO_LOGIN_REFUSALS].map((n) => `bo.refused.${n}`)));
  });
});
