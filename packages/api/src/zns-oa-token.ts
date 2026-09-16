import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Keeping the ZNS Official Account access token alive.
 *
 * ## The bug this fixes, which was never going to be found by a test
 *
 * `zns.ts` read `PLAYERONE_ZNS_ACCESS_TOKEN` once, at boot, and used it as the
 * `access_token` header for the life of the process. Zalo's own documentation
 * says, in three places, that this cannot work:
 *
 *   - the OA access token is valid for **25 hours** (`expires_in: "90000"`);
 *   - the OA refresh token is valid for **3 months**;
 *   - the refresh token is **single-use and rotates** — "Refresh Token chỉ được
 *     sử dụng một lần", the presented one is invalidated and a new one comes
 *     back in the response;
 *   - and the **old access token dies the instant a new one is minted**.
 *
 * So a deployment set up on Monday stops sending sign-in codes on Tuesday, with
 * `{"error":-124,"message":"Access token invalid"}` and nothing else to read.
 * Verified against the live endpoint; written up in `docs/sign-in-channels.md`.
 *
 * ## Why the refresh token has to be persisted, and not in the environment
 *
 * Because it rotates. `PLAYERONE_ZNS_REFRESH_TOKEN` can only ever be the SEED:
 * the moment the first refresh succeeds, the value in the environment is dead,
 * and a process that restarts and re-reads it presents a spent token. There is
 * no code path back from that — a human OA administrator has to re-authorize
 * through `oauth.zaloapp.com/v4/oa/permission` or the developer console's API
 * Explorer. Losing the rotated token is therefore an outage that needs a
 * person, which is exactly why it is written down.
 *
 * ## ponytail: a JSON file, not a table
 *
 * One rotating credential for one deployment is a file, and this deployment is
 * one VM running one API container (`deploy/cloud/docker-compose.yml`). A table
 * would be a migration, a grant, a repository and a test for a single row.
 *
 * THE CEILING, named so the upgrade is a decision and not a discovery: **this
 * is safe for exactly one process.** Two API instances sharing one Zalo app
 * would race the refresh, and the loser would present a refresh token the
 * winner had already spent — which invalidates the chain for both. The upgrade
 * path when a second instance appears is a single row in Postgres written under
 * `select … for update`, and `TokenStore` below is the seam it slots into: the
 * refresher does not know where the token lives.
 *
 * The file must be on a volume that outlives the container, and it holds a live
 * credential, so it is written `0600`. `deploy/cloud/cloud.env.example` puts it
 * under the media volume for that reason.
 */

/** Where the rotating pair lives. The seam the ceiling above names. */
export type TokenStore = {
  read(): StoredTokens | null;
  write(tokens: StoredTokens): void;
};

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. When the access token stops being usable. */
  expiresAtMs: number;
};

/** The two calls `zns.ts` makes. See the `-124` retry there. */
export type OaToken = {
  /** The current access token, refreshed first if it is at or past its edge. */
  get(): Promise<string>;
  /** Refresh now, because a send was told the token is invalid. */
  refresh(): Promise<string>;
};

export const OA_TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
export const DEFAULT_OA_TIMEOUT_MS = 10_000;

/**
 * How early a token is treated as stale.
 *
 * Zalo gives 25 hours and a send that starts inside the last few minutes of one
 * can still be answered `-124`, because the expiry is Zalo's clock and not
 * ours. An hour of slack costs one extra refresh a day and removes every
 * borderline case; there is no documented rate limit on refreshing.
 */
export const OA_REFRESH_SKEW_MS = 60 * 60_000;

export class OaTokenError extends Error {
  /** Zalo's `error` field, or null when nothing came back to read one from. */
  readonly errorCode: number | null;

  constructor(errorCode: number | null, detail: string) {
    super(`zns oa token: refresh failed${errorCode === null ? '' : ` (error ${errorCode})`} — ${detail}`);
    this.name = 'OaTokenError';
    this.errorCode = errorCode;
  }
}

export type OaTokenConfig = {
  appId: string;
  /** Sent as the `secret_key` header, exactly as the user-login exchange does. */
  appSecret: string;
  /**
   * The seed. Used only when the store holds nothing — after that the store's
   * token is the live one and this value is dead. See the header.
   */
  seedRefreshToken?: string;
  store: TokenStore;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  warn?: (line: string) => void;
};

/**
 * A refresher over one store.
 *
 * Concurrent callers share one in-flight refresh, and that is not an
 * optimisation: the refresh token is single-use, so two simultaneous refreshes
 * would have the second present a token the first had already spent and break
 * the chain for good.
 */
export function oaToken(config: OaTokenConfig): OaToken {
  if (!config.appId) throw new Error('OaTokenConfig.appId is required');
  if (!config.appSecret) throw new Error('OaTokenConfig.appSecret is required');
  const url = (config.baseUrl ?? OA_TOKEN_URL).replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_OA_TIMEOUT_MS;
  const fetchFn = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const warn = config.warn ?? console.warn;
  /** The one refresh in flight, shared by every caller that arrives during it. */
  let inFlight: Promise<string> | null = null;

  const stored = (): StoredTokens | null => {
    const held = config.store.read();
    if (held !== null) return held;
    if (!config.seedRefreshToken) return null;
    /**
     * First run. The seed has no access token and no expiry, so it is written
     * as already expired: the next `get()` refreshes, and from then on the
     * store is the only source.
     */
    return { accessToken: '', refreshToken: config.seedRefreshToken, expiresAtMs: 0 };
  };

  const doRefresh = async (): Promise<string> => {
    const held = stored();
    if (held === null) {
      throw new OaTokenError(null, 'no refresh token: set PLAYERONE_ZNS_REFRESH_TOKEN, or re-authorize the OA');
    }

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          secret_key: config.appSecret,
        },
        body: new URLSearchParams({
          refresh_token: held.refreshToken,
          app_id: config.appId,
          grant_type: 'refresh_token',
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new OaTokenError(null, describe(err));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch (err) {
      throw new OaTokenError(null, `http ${response.status}, body is not JSON (${describe(err)})`);
    }
    const body = (parsed ?? {}) as Record<string, unknown>;
    const accessToken = body['access_token'];
    const refreshToken = body['refresh_token'];
    if (typeof accessToken !== 'string' || accessToken === '' || typeof refreshToken !== 'string' || refreshToken === '') {
      const code = typeof body['error'] === 'number' ? body['error'] : null;
      const name = typeof body['error_name'] === 'string' ? body['error_name'] : null;
      /**
       * Loud, because this is the failure that needs a person: once the chain
       * is broken nothing here can mend it, and every sign-in stops.
       */
      warn(
        `[zns:oa] refresh refused (error=${String(code)} ${name ?? ''}) — no sign-in code can be sent. ` +
          'An OA administrator has to re-authorize the app at oauth.zaloapp.com/v4/oa/permission.',
      );
      throw new OaTokenError(code, name ?? 'no access_token in the response');
    }

    /**
     * `expires_in` is documented as a string of seconds (`"90000"`). Trusted
     * when it parses and defaulted to Zalo's documented 25 hours when it does
     * not, rather than treating a missing field as "expired" and refreshing on
     * every send — which would burn the single-use chain immediately.
     */
    const seconds = Number(body['expires_in']);
    const lifetimeMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 25 * 60 * 60_000;
    /**
     * The store is written BEFORE the token is handed out. If the process dies
     * between the two, the next start has the rotated pair; the other order
     * loses it and needs a human.
     */
    config.store.write({ accessToken, refreshToken, expiresAtMs: now() + lifetimeMs });
    return accessToken;
  };

  const refresh = (): Promise<string> => {
    inFlight ??= doRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    async get() {
      if (inFlight !== null) return inFlight;
      const held = stored();
      if (held === null || held.accessToken === '' || held.expiresAtMs - OA_REFRESH_SKEW_MS <= now()) {
        return refresh();
      }
      return held.accessToken;
    },
    refresh,
  };
}

/**
 * A JSON file, `0600`. See the ceiling in the header.
 *
 * A missing or unreadable file is "nothing stored", not a crash: on first run
 * there is no file, and the seed is what starts the chain. A file that exists
 * but does not parse is the one case worth a warning, because it means a
 * rotated token may have been lost.
 */
export function fileTokenStore(path: string, warn: (line: string) => void = console.warn): TokenStore {
  return {
    read() {
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        return null;
      }
      try {
        const held = JSON.parse(text) as Partial<StoredTokens>;
        if (typeof held.refreshToken !== 'string' || held.refreshToken === '') return null;
        return {
          accessToken: typeof held.accessToken === 'string' ? held.accessToken : '',
          refreshToken: held.refreshToken,
          expiresAtMs: typeof held.expiresAtMs === 'number' ? held.expiresAtMs : 0,
        };
      } catch {
        warn(`[zns:oa] ${path} is not readable JSON; falling back to the seed refresh token`);
        return null;
      }
    },
    write(tokens) {
      writeFileSync(path, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}${e?.cause?.code ? ` [${e.cause.code}]` : ''}`;
}
