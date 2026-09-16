import { createHash, randomBytes } from 'node:crypto';

/**
 * Signing a collector in with the Zalo account they already have. APP-01, SEC-01.
 *
 * ## Why this exists at all, when `zns.ts` was the decision
 *
 * 2026-08-29 decided the sign-in code is delivered over ZNS and that a second
 * channel must not be built. **Owner's decision of 2026-09-16 overrides that**:
 * VNG's ZNS Official Account is not available, so there is no channel at all —
 * a collector cannot receive a code, and "sign-in works for anybody with an
 * ordinary Zalo account" is the requirement that replaces it.
 *
 * Zalo *Login* is not Zalo *Notification Service* and shares none of its
 * blockers. ZNS needs a verified Official Account, an approved message template
 * and a paid per-message quota; Zalo Login needs a developer app and a
 * registered callback URL, and the credential is the Zalo session the person is
 * already signed in to on that phone. It is also the only route that works for
 * a number ZNS would refuse — `zns_no_zalo_account` was the named cost of the
 * old decision and this is what removes it.
 *
 * The phone-code route is untouched and stays the fallback: see
 * `PLAYERONE_SIGN_IN_CHANNEL` in `zns.ts`.
 *
 * ## Shape
 *
 * The same shape as `zns.ts` and `payout/zalopay/client.ts`, for the same
 * reasons: one adapter, every failure mapped onto a named refusal, an
 * unrecognised answer logged loudly rather than swallowed, and `fetch` taken as
 * configuration so the test suite drives it against a fake server on 127.0.0.1
 * and never the network.
 *
 * It knows nothing about collectors, tokens or the audit trail — `collector.ts`
 * decides what a refusal means; this file decides only what Zalo said.
 *
 * ## The endpoints, and what is verified about them
 *
 * Verified against developers.zalo.me on 2026-09-16 and written up in
 * `docs/sign-in-channels.md`, which is also where anything that could NOT be
 * verified without a live app is listed. Three calls:
 *
 *   1. `GET  https://oauth.zaloapp.com/v4/permission` — the browser goes here.
 *   2. `POST https://oauth.zaloapp.com/v4/access_token` — the code, the
 *      verifier and the app secret in a `secret_key` header.
 *   3. `GET  https://graph.zalo.me/v2.0/me` — the access token in an
 *      `access_token` header, NOT an `Authorization: Bearer`.
 *
 * ## PKCE is not optional here, and the reason is the callback
 *
 * The callback URL is an HTTPS URL on this service, so the `code` travels
 * through a browser we do not control and lands on a route with no session on
 * it. PKCE is what makes an intercepted code useless: the verifier never
 * leaves this process, and the exchange fails without it.
 */

/** What a successful sign-in learns about the person. The whole of it. */
export type ZaloIdentity = {
  /** Zalo's `id`, stable per (app, user). Stored as `collectors.zalo_id`. */
  zaloId: string;
  /** Their Zalo display name, when Zalo returned one. For an operator to read. */
  name: string | null;
};

/**
 * Every way a Zalo sign-in can fail, by name.
 *
 * Named rather than a code number for the reason `ZnsRefusal` gives: these are
 * read by a person, they each carry an en/zh/vi sentence in `i18n.ts`, and each
 * one has a different answer.
 *
 *   - `zalo_not_configured` — this deployment holds no Zalo app credentials, so
 *     the route is not available. A configuration answer, not a collector's.
 *   - `zalo_denied` — the person pressed "no" on Zalo's permission screen, or
 *     closed it. Nothing is wrong; they can start again or use a code.
 *   - `zalo_state_unknown` — the callback named a `state` this server did not
 *     write, or one already spent. A replay, a bookmark, or a forgery.
 *   - `zalo_state_expired` — the attempt is older than `SIGN_IN_TTL_MS`. Start
 *     again.
 *   - `zalo_code_refused` — Zalo refused the code-for-token exchange. An
 *     expired code, a re-used code, a `redirect_uri` that is not the one
 *     registered in the app's settings, or a wrong app secret.
 *   - `zalo_profile_refused` — the token was issued and `graph.zalo.me`
 *     refused to describe its owner, or described them without an `id`.
 *   - `zalo_unreachable` — no answer, a timeout, or something that is not a
 *     Zalo envelope. Clears by itself, usually.
 *   - `zalo_ticket_spent` — the one-time ticket has already been exchanged, or
 *     never existed. Every replay of a ticket lands here.
 */
export type ZaloLoginRefusal =
  | 'zalo_not_configured'
  | 'zalo_denied'
  | 'zalo_state_unknown'
  | 'zalo_state_expired'
  | 'zalo_code_refused'
  | 'zalo_profile_refused'
  | 'zalo_unreachable'
  | 'zalo_ticket_spent';

/** For the i18n completeness test: every name here needs three sentences. */
export const ZALO_LOGIN_REFUSALS: ReadonlySet<ZaloLoginRefusal> = new Set<ZaloLoginRefusal>([
  'zalo_not_configured',
  'zalo_denied',
  'zalo_state_unknown',
  'zalo_state_expired',
  'zalo_code_refused',
  'zalo_profile_refused',
  'zalo_unreachable',
  'zalo_ticket_spent',
]);

export class ZaloLoginError extends Error {
  readonly refusal: ZaloLoginRefusal;
  /** Zalo's `error` field, or null when nothing came back to read one from. */
  readonly errorCode: number | null;

  constructor(refusal: ZaloLoginRefusal, errorCode: number | null, detail: string) {
    super(`zalo: ${refusal}${errorCode === null ? '' : ` (error ${errorCode})`} — ${detail}`);
    this.name = 'ZaloLoginError';
    this.refusal = refusal;
    this.errorCode = errorCode;
  }
}

export const ZALO_OAUTH_BASE_URL = 'https://oauth.zaloapp.com';
export const ZALO_AUTHORIZE_PATH = '/v4/permission';
export const ZALO_TOKEN_PATH = '/v4/access_token';
export const ZALO_GRAPH_BASE_URL = 'https://graph.zalo.me';
export const ZALO_PROFILE_PATH = '/v2.0/me';
export const DEFAULT_ZALO_TIMEOUT_MS = 10_000;

/**
 * How long one sign-in attempt lives, and it covers both halves of it.
 *
 * Ten minutes rather than the five a sign-in code gets, because this clock
 * starts before a person has typed their Zalo password and may include an app
 * install. It is one deadline for the state AND the ticket: the hop from the
 * callback to the app's deep link is immediate, so a second, shorter expiry
 * would guard nothing and be a second thing to get wrong.
 */
export const SIGN_IN_TTL_MS = 10 * 60_000;

/** The path the app is redirected back to. One string, so nothing can disagree. */
export const ZALO_CALLBACK_PATH = '/auth/collector/zalo/callback';

/**
 * Where the browser is sent once this server has a ticket for the app.
 *
 * A custom scheme and not an https link: the collector app is not a website,
 * and `apps/collector/app.json` claims this scheme. It carries the ticket and
 * nothing else — never the session token. See `POST /auth/collector/ticket`.
 */
export const APP_DEEP_LINK = 'playerone://signed-in';

export type ZaloLoginConfig = {
  /** `PLAYERONE_ZALO_APP_ID`. The app id from developers.zalo.me. */
  appId: string;
  /** `PLAYERONE_ZALO_APP_SECRET`. Sent as the `secret_key` header, never logged. */
  appSecret: string;
  /**
   * The scheme and host this service answers on, with no path —
   * `https://demo.203-0-113-4.sslip.io`. The redirect URI is built from it, and
   * it has to match the callback URL registered in the Zalo app's settings
   * byte for byte or the exchange is refused.
   */
  publicOrigin: string;
  oauthBaseUrl?: string;
  graphBaseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  warn?: (event: ZaloWarning) => void;
};

export type ZaloWarning = {
  event: 'unexpected_zalo_response';
  where: 'access_token' | 'me';
  detail: string;
};

export type ZaloLogin = {
  /** The registered callback URL, built once. */
  readonly redirectUri: string;
  /** Where the browser goes. `state` and `codeChallenge` come from the caller. */
  authorizeUrl(params: { state: string; codeChallenge: string }): string;
  /** Code → token → identity. Throws `ZaloLoginError`. */
  identify(params: { code: string; codeVerifier: string }): Promise<ZaloIdentity>;
};

/**
 * A PKCE verifier: 32 random bytes, base64url, which is 43 characters.
 *
 * The low end of RFC 7636 §4.1's 43–128, and the whole of its entropy
 * requirement — 256 bits. `zalo_sign_ins_verifier_check` pins the range in the
 * database so a shorter one cannot be stored by a later caller.
 */
export const newCodeVerifier = (): string => randomBytes(32).toString('base64url');

/** S256: `base64url(sha256(verifier))`, over the verifier's ASCII bytes. */
export const codeChallengeFor = (verifier: string): string =>
  createHash('sha256').update(verifier, 'ascii').digest('base64url');

/**
 * The `state`, and the one-time ticket, are the same kind of thing: a value an
 * attacker must not be able to guess, travelling through a browser.
 */
export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');

/** How the ticket is stored. See `zalo_sign_ins.ticket_hash` for why not scrypt. */
export const ticketDigest = (ticket: string): string =>
  createHash('sha256').update(ticket, 'ascii').digest('hex');

/** The real thing. Nothing here logs the secret, the code or the token. */
export function zaloLogin(config: ZaloLoginConfig): ZaloLogin {
  if (!config.appId) throw new Error('ZaloLoginConfig.appId is required');
  if (!config.appSecret) throw new Error('ZaloLoginConfig.appSecret is required');
  const origin = config.publicOrigin.replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
    throw new Error(`ZaloLoginConfig.publicOrigin must be a scheme and host, got '${config.publicOrigin}'`);
  }
  const oauth = (config.oauthBaseUrl ?? ZALO_OAUTH_BASE_URL).replace(/\/+$/, '');
  const graph = (config.graphBaseUrl ?? ZALO_GRAPH_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_ZALO_TIMEOUT_MS;
  const fetchFn = config.fetch ?? fetch;
  const warn = config.warn ?? defaultWarn;
  const redirectUri = origin + ZALO_CALLBACK_PATH;

  /** Everything that is not a 2xx JSON body with the field we asked for. */
  const readJson = async (
    where: ZaloWarning['where'],
    run: () => Promise<Response>,
  ): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await run();
    } catch (err) {
      throw new ZaloLoginError('zalo_unreachable', null, describe(err));
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw new ZaloLoginError('zalo_unreachable', null, describe(err));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      /**
       * An HTML error page from something in front of Zalo, or a truncated
       * body. `zalo_unreachable` is the honest name and it is temporary, so
       * nobody is stranded by a bad gateway.
       */
      throw new ZaloLoginError('zalo_unreachable', null, `http ${response.status}, body is not JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ZaloLoginError('zalo_unreachable', null, `http ${response.status}, body is not an object`);
    }
    const body = parsed as Record<string, unknown>;
    /**
     * A refusal Zalo explained is a refusal that belongs in a log, whatever
     * this file goes on to do about it. Same discipline as
     * `unknown_zns_error_code`: an answer we did not expect must be loud, and
     * the status is the only part of it that is never a secret.
     */
    if (!response.ok) {
      warn({
        event: 'unexpected_zalo_response',
        where,
        detail: `http ${response.status}, error=${String(errorCodeOf(body))}`,
      });
    }
    return body;
  };

  return {
    redirectUri,

    authorizeUrl({ state, codeChallenge }) {
      const url = new URL(oauth + ZALO_AUTHORIZE_PATH);
      url.searchParams.set('app_id', config.appId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('code_challenge', codeChallenge);
      /**
       * `state` last, and there is deliberately NO `code_challenge_method`.
       *
       * Zalo Login v4 documents four parameters — `app_id`, `redirect_uri`,
       * `code_challenge`, `state` — and its own PHP SDK builds exactly those.
       * S256 is implicit and there is no `plain` to be downgraded to. An
       * earlier version of this file sent `code_challenge_method=S256` on the
       * OAuth habit; it is accepted and echoed through the redirect, but
       * nothing documents that it is read, so sending it was a parameter whose
       * meaning we were inventing. `docs/sign-in-channels.md` records where
       * that was verified.
       */
      url.searchParams.set('state', state);
      return url.toString();
    },

    async identify({ code, codeVerifier }) {
      /**
       * The exchange. `application/x-www-form-urlencoded` and the app secret
       * in a `secret_key` HEADER, which is Zalo's own shape and not OAuth's
       * `client_secret` body field — sending it in the body authenticates
       * nothing and the exchange is refused.
       */
      const token = await readJson('access_token', () =>
        fetchFn(oauth + ZALO_TOKEN_PATH, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            secret_key: config.appSecret,
          },
          body: new URLSearchParams({
            app_id: config.appId,
            code,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier,
          }).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      const accessToken = token['access_token'];
      if (typeof accessToken !== 'string' || accessToken === '') {
        throw new ZaloLoginError('zalo_code_refused', errorCodeOf(token), messageOf(token) ?? 'no access_token');
      }

      /**
       * Who that token belongs to. `access_token` as a header — Zalo's Graph
       * API does not read `Authorization: Bearer`, and a request that sends
       * one is answered as an anonymous request.
       *
       * `fields=id,name` and not `id,name,picture`: nothing stores an avatar,
       * and asking for a field we discard is a field that can fail.
       */
      const me = await readJson('me', () =>
        fetchFn(`${graph}${ZALO_PROFILE_PATH}?fields=id,name`, {
          headers: { access_token: accessToken },
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      const zaloId = me['id'];
      if (typeof zaloId !== 'string' || zaloId === '') {
        throw new ZaloLoginError('zalo_profile_refused', errorCodeOf(me), messageOf(me) ?? 'no id');
      }
      const name = me['name'];
      return { zaloId, name: typeof name === 'string' && name !== '' ? name : null };
    },
  };
}

/**
 * The client the environment describes, or null.
 *
 * Null when none of the three variables is set, and then the two Zalo routes
 * answer 503 naming `zalo_not_configured` — the same answer, and for the same
 * reason, that `request-code` gives a deployment with no code sender: a route
 * that pretends to work is worse than one that says it is not configured.
 *
 * A *partial* configuration throws, naming what is missing. Same rule as
 * `zaloPayClientFromEnv`, `s3StoreFromEnv` and `signInCodeSenderFromEnv`, and
 * the same reason: an app id with no secret is somebody halfway through
 * configuring a deployment, and the failure belongs at boot rather than at the
 * first collector who taps the button.
 *
 * `PLAYERONE_PUBLIC_ORIGIN` falls back to `PLAYERONE_PUBLIC_URL`, which every
 * cloud deployment already sets to exactly this value (`deploy/cloud/
 * cloud.env.example`). A second variable holding the same string is a second
 * variable to get wrong, so the fallback is deliberate and the override exists
 * for a deployment whose public origin is not its console's.
 */
export function zaloLoginFromEnv(
  env: Record<string, string | undefined> = process.env,
): ZaloLogin | null {
  const appId = env['PLAYERONE_ZALO_APP_ID'];
  const appSecret = env['PLAYERONE_ZALO_APP_SECRET'];
  /**
   * `||` and not `??`, and the difference is a live bug rather than a style
   * point: `deploy/cloud/cloud.env.example` writes `PLAYERONE_PUBLIC_ORIGIN=`
   * with no value, so every cloud deployment hands this an EMPTY STRING rather
   * than `undefined`. `??` would take the empty string, skip the fallback, and
   * refuse to start naming a variable the operator had never been asked to set.
   */
  const publicOrigin = env['PLAYERONE_PUBLIC_ORIGIN'] || env['PLAYERONE_PUBLIC_URL'];
  if (!appId && !appSecret) return null;
  const missing = (
    [
      ['PLAYERONE_ZALO_APP_ID', appId],
      ['PLAYERONE_ZALO_APP_SECRET', appSecret],
      ['PLAYERONE_PUBLIC_ORIGIN', publicOrigin],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `Zalo Login is partly configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`,
    );
  }
  return zaloLogin({
    appId: appId!,
    appSecret: appSecret!,
    publicOrigin: publicOrigin!,
    oauthBaseUrl: env['PLAYERONE_ZALO_OAUTH_URL'],
    graphBaseUrl: env['PLAYERONE_ZALO_GRAPH_URL'],
  });
}

/** Zalo's `error` field, when there is a numeric one. */
function errorCodeOf(body: Record<string, unknown>): number | null {
  const code = body['error'];
  if (typeof code === 'number') return code;
  // `graph.zalo.me` nests it, and the OAuth endpoints do not.
  const nested = (body['error'] as { code?: unknown } | undefined)?.code;
  return typeof nested === 'number' ? nested : null;
}

/** Whatever sentence Zalo supplied, under whichever of its three names. */
function messageOf(body: Record<string, unknown>): string | null {
  for (const key of ['error_name', 'error_description', 'error_reason', 'message']) {
    const value = body[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/** For an error message only: never the secret, never the code, never the token. */
function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}${e?.cause?.code ? ` [${e.cause.code}]` : ''}`;
}

function defaultWarn(event: ZaloWarning): void {
  console.warn(`[zalo] ${event.event}: where=${event.where} ${event.detail}`);
}
