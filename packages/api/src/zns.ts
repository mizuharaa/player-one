import { smsSenderFromEnv } from './sms.ts';
import { fileTokenStore, oaToken, type OaToken } from './zns-oa-token.ts';

/**
 * How a collector's one-time sign-in code reaches their phone. APP-01, SEC-01.
 *
 * ## Why Zalo and not SMS
 *
 * Decided 2026-08-29. The brief never says how a login code is delivered — it
 * only ever considered a Zalo *Mini App* as an app platform (C10, resolved on
 * 14 Aug as native Android first) — so this is a new decision and not a
 * re-litigation of one.
 *
 *   - VNG owns Zalo. The counterparty for this channel is the company building
 *     the platform, not a third-party aggregator nobody in the JV can ring.
 *   - Zalo is the messaging app Vietnamese collectors already have open. A
 *     code that lands in the app they use is read faster than one that lands
 *     in an SMS inbox behind two carrier promotions.
 *   - ZaloPay is already integrated for payouts (`payout/zalopay/`), so the
 *     corporate relationship, the contracts and the sandbox already exist.
 *   - ZNS (Zalo Notification Service) is the standard Vietnamese channel for a
 *     one-time code. It is what a Vietnamese bank or e-wallet uses.
 *
 * What that costs, stated so nobody discovers it during the pilot: a collector
 * whose number has no Zalo account cannot receive a code and therefore cannot
 * sign in at all. That is `zns_no_zalo_account` below — a named, actionable
 * refusal, recorded against the collector, so an operator can find those people
 * and act rather than watch a sign-in fail silently.
 *
 * ## Overridden 2026-09-16, and this is the file that says how
 *
 * The reasoning above still holds for *a code that is delivered*. What it got
 * wrong is that ZNS would be available: sending needs a **verified** Official
 * Account — `-135` refuses an unverified or free-plan one by name, and only a
 * verified OA can be linked to a ZBS billing account at all — and VNG has not
 * issued one. A channel that delivers nothing is not a channel, so the owner's
 * decision of 2026-09-16 makes Zalo Login (`zalo-login.ts`) the first-class way
 * in and requires a third-party SMS code as the fallback.
 *
 * "Do not build SMS as well; if a second channel is ever needed it is a second
 * `SendSignInCode`, not a change to the route" — that is exactly what `sms.ts`
 * is, and the route is untouched. `PLAYERONE_SIGN_IN_CHANNEL` picks between the
 * three at the bottom of this file.
 *
 * ## Shape
 *
 * The same shape as `payout/zalopay/client.ts`, for the same reasons: one
 * adapter that signs nothing it did not build, maps every failure it is told
 * about onto a named refusal, logs an error code it has never seen loudly
 * rather than swallowing it, and takes `fetch` as configuration so the test
 * suite drives it against a fake server on 127.0.0.1 and never the network.
 *
 * It knows nothing about collectors, tokens or the audit trail. The route
 * decides what a refusal means; this file decides only what ZNS said.
 */

/** The seam. One method: put this code on this phone. Throws `ZnsDeliveryError`. */
export type CodeSender = (phone: string, code: string) => Promise<void>;

/**
 * Every way delivery can fail, by name.
 *
 * Named rather than a code number because these are read by a person: they
 * carry an en/zh/vi sentence in `i18n.ts` and they are what an operator sees
 * when they ask why a collector never got a code. Each one has a different
 * answer, which is the test for whether it deserves its own name:
 *
 *   - `zns_no_zalo_account` — install Zalo on that number, or sign the
 *     collector in another way. It is permanent for that number; every other
 *     refusal here clears on its own or with a configuration change. It was
 *     "the one that matters" while ZNS was the only channel; since
 *     2026-09-16 the answer is Zalo Login or `PLAYERONE_SIGN_IN_CHANNEL=sms`.
 *   - `zns_phone_not_vietnamese` — the number on file is not a Vietnamese
 *     mobile number. Fix the collector record. Refused before the request
 *     leaves this process.
 *   - `zns_oa_not_verified` — **the one that matters now.** The Official
 *     Account is not verified, or is on the free plan, so it may not send at
 *     all. Nobody receives a code until VNG verifies it; this is the refusal
 *     the owner's 2026-09-16 decision exists to route around.
 *   - `zns_user_refused` — this person has refused Zalo's message channel.
 *     Their own choice, permanent until they change it, and not something an
 *     operator can fix: they need SMS or Zalo Login.
 *   - `zns_development_only` — the account is sending in development mode,
 *     which only reaches administrators of the app or the OA. A demo
 *     configuration met a number that is not one of them.
 *   - `zns_template_rejected` — the message template is not approved, not
 *     active, or its parameters do not match. Zalo's approval queue, not a
 *     collector's problem.
 *   - `zns_quota_exhausted` — the Official Account's ZNS quota is spent. Buy
 *     more; nobody signs in until then.
 *   - `zns_rate_limited` — too many messages too fast. Clears by itself.
 *   - `zns_credentials_rejected` — the access token is wrong or expired.
 *     ZNS access tokens expire and are refreshed out of band; this is what
 *     that looks like from in here.
 *   - `zns_unreachable` — no answer, a timeout, or something that is not a
 *     ZNS envelope. Clears by itself, usually.
 *   - `zns_refused` — an error code this table has never seen. Logged with the
 *     code and the message so it can be added; treated as temporary, because
 *     assuming a permanent failure on an unknown code strands a collector.
 */
export type ZnsRefusal =
  | 'zns_no_zalo_account'
  | 'zns_phone_not_vietnamese'
  | 'zns_oa_not_verified'
  | 'zns_user_refused'
  | 'zns_development_only'
  | 'zns_template_rejected'
  | 'zns_quota_exhausted'
  | 'zns_rate_limited'
  | 'zns_credentials_rejected'
  | 'zns_unreachable'
  | 'zns_refused';

/** For the i18n completeness test: every name here needs three sentences. */
export const ZNS_REFUSALS: ReadonlySet<ZnsRefusal> = new Set<ZnsRefusal>([
  'zns_no_zalo_account',
  'zns_phone_not_vietnamese',
  'zns_oa_not_verified',
  'zns_user_refused',
  'zns_development_only',
  'zns_template_rejected',
  'zns_quota_exhausted',
  'zns_rate_limited',
  'zns_credentials_rejected',
  'zns_unreachable',
  'zns_refused',
]);

export class ZnsDeliveryError extends Error {
  readonly refusal: ZnsRefusal;
  /** The ZNS `error` field, or null when nothing came back to read one from. */
  readonly errorCode: number | null;

  constructor(refusal: ZnsRefusal, errorCode: number | null, detail: string) {
    super(`zns: ${refusal}${errorCode === null ? '' : ` (error ${errorCode})`} — ${detail}`);
    this.name = 'ZnsDeliveryError';
    this.refusal = refusal;
    this.errorCode = errorCode;
  }
}

/**
 * ZNS error code → refusal.
 *
 * **Re-transcribed 2026-09-16 from Zalo's current published table**, which is
 * now the ZBS Template Message error list — ZNS was merged into ZBS on
 * 2026-01-01 with the same endpoint and the same fields under a new name. The
 * previous version of this map said it was provisional and asked to be
 * confirmed; it was wrong in five places, and each of those would have shown an
 * operator a sentence telling them to do the wrong thing:
 *
 *   - `-139` and `-141` were mapped to a rejected template and an exhausted
 *     quota. They actually mean **the person refused this message type**, which
 *     nobody can fix from the back office.
 *   - `-115` was mapped to "Zalo could not be reached" — a temporary refusal
 *     that clears by itself. It is **out of quota**, which does not.
 *   - `-114` (rate limit) and `-146` (quota) are not in the current table at
 *     all; the real rate-limit code is `-32`, and it is documented as not
 *     applying to the send API.
 *   - `-133` (the 22:00–06:00 blackout) is gone from the table. Whether the
 *     blackout still applies is unverified, so it is not mapped to anything
 *     rather than guessed at — the fallback treats it as temporary.
 *
 * The three new codes are the ones this deployment will actually meet first:
 * `-135` (the OA is not verified) is the wall the whole 2026-09-16 decision is
 * about, and `-126`/`-127` are what development mode answers.
 *
 * Still never seen from a live account, because there is no account. The
 * fallback is what keeps a remaining error safe: an unmapped code is logged
 * with its message and treated as temporary, so nobody is stranded by a
 * transcription error. Same discipline as `SUB_RETURN_CODES` in the ZaloPay
 * client, and the same reason: a code we do not understand must be loud.
 *
 * `docs/sign-in-channels.md` records where each of these was read.
 */
export const ZNS_ERROR_CODES: ReadonlyMap<number, ZnsRefusal> = new Map<number, ZnsRefusal>([
  [-108, 'zns_phone_not_vietnamese'],
  [-118, 'zns_no_zalo_account'],
  // The OA itself may not send. -1351 is the same wall after a violation.
  [-135, 'zns_oa_not_verified'],
  [-1351, 'zns_oa_not_verified'],
  // The person's own choice about the channel.
  [-139, 'zns_user_refused'],
  [-141, 'zns_user_refused'],
  // Development mode reaches app/OA administrators and nobody else.
  [-127, 'zns_development_only'],
  [-124, 'zns_credentials_rejected'],
  // "ZBS Account association required": the billing account is not linked to
  // this app. A configuration answer, which is what this refusal's sentence
  // gives, and the same class as a token this server cannot use.
  [-136, 'zns_credentials_rejected'],
  [-131, 'zns_template_rejected'],
  [-117, 'zns_template_rejected'],
  [-145, 'zns_template_rejected'],
  // Money and allowance, which share one answer: nobody signs in until
  // somebody tops the account up or the day rolls over. -137 is a failed
  // charge, the rest are exhausted quota of one kind or another.
  [-137, 'zns_quota_exhausted'],
  [-115, 'zns_quota_exhausted'],
  [-160, 'zns_quota_exhausted'],
  [-144, 'zns_quota_exhausted'],
  [-147, 'zns_quota_exhausted'],
  [-126, 'zns_quota_exhausted'],
  [-32, 'zns_rate_limited'],
]);

export type ZnsConfig = {
  /**
   * The OA access token, or the thing that keeps one alive.
   *
   * A bare string was the whole of this until 2026-09-16 and it was wrong:
   * Zalo's OA access token lasts **25 hours**, so a static value stops working
   * inside a day with `-124`, and its refresh token is single-use and rotates,
   * so the refreshed value cannot live in the environment either. See
   * `zns-oa-token.ts`. A string is still accepted, because a test that wants to
   * assert what was sent should not have to build a refresher to do it.
   */
  accessToken: string | OaToken;
  /** The approved one-time-code template. */
  templateId: string;
  /** The `template_data` key the six digits go in. Whatever the approved template names. */
  codeParam?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  warn?: (event: ZnsWarning) => void;
};

export type ZnsWarning = {
  event: 'unknown_zns_error_code';
  errorCode: number;
  message: string | null;
};

export const ZNS_BASE_URL = 'https://business.openapi.zalo.me';
export const ZNS_SEND_PATH = '/message/template';
export const DEFAULT_ZNS_TIMEOUT_MS = 10_000;

/**
 * A Vietnamese mobile number as ZNS wants it: `84` and nine digits, no plus.
 *
 * Collector rows hold both spellings — `+84900000001` in the auth fixtures,
 * `0900000001` in a payout declaration — so both are accepted and normalised
 * here rather than at five call sites. Null for anything else, and the caller
 * refuses it before a request leaves this process: sending a Vietnamese OTP
 * template to a foreign number is a request we know the answer to.
 */
export function toZnsPhone(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  const national = digits.startsWith('84') ? digits.slice(2) : digits.startsWith('0') ? digits.slice(1) : null;
  // Nine digits after the trunk prefix, first one 3/5/7/8/9 — every Vietnamese
  // mobile prefix since the 2018 renumbering.
  return national !== null && /^[35789]\d{8}$/.test(national) ? `84${national}` : null;
}

/** The real thing. Nothing here logs the code, the token or the number. */
export function znsSender(config: ZnsConfig): CodeSender {
  if (!config.accessToken) throw new Error('ZnsConfig.accessToken is required');
  if (!config.templateId) throw new Error('ZnsConfig.templateId is required');
  const baseUrl = (config.baseUrl ?? ZNS_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_ZNS_TIMEOUT_MS;
  const fetchFn = config.fetch ?? fetch;
  const codeParam = config.codeParam ?? 'otp';
  const warn = config.warn ?? defaultWarn;
  const token = config.accessToken;

  /** One attempt, with whichever token it was handed. Returns Zalo's `error`. */
  const send = async (to: string, code: string, accessToken: string): Promise<{ error: number; message: string | null }> => {
    let response: Response;
    try {
      response = await fetchFn(baseUrl + ZNS_SEND_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', access_token: accessToken },
        body: JSON.stringify({
          phone: to,
          template_id: config.templateId,
          template_data: { [codeParam]: code },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ZnsDeliveryError('zns_unreachable', null, describe(err));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch (err) {
      throw new ZnsDeliveryError('zns_unreachable', null, `body is not JSON (${describe(err)})`);
    }
    if (!response.ok) {
      throw new ZnsDeliveryError('zns_unreachable', null, `http ${response.status}`);
    }
    const envelope = parsed as { error?: unknown; message?: unknown };
    if (typeof envelope?.error !== 'number') {
      throw new ZnsDeliveryError('zns_unreachable', null, 'no numeric error field');
    }
    return {
      error: envelope.error,
      message: typeof envelope.message === 'string' ? envelope.message : null,
    };
  };

  return async (phone, code) => {
    const to = toZnsPhone(phone);
    if (to === null) {
      throw new ZnsDeliveryError('zns_phone_not_vietnamese', null, 'not a Vietnamese mobile number');
    }

    let answer = await send(to, code, typeof token === 'string' ? token : await token.get());
    /**
     * `-124` once, and only once, and only when there is something that can
     * refresh.
     *
     * The OA access token lasts 25 hours and Zalo's clock decides when it is
     * over, so a send can start on a token that was valid a millisecond ago.
     * Refreshing on the refusal rather than before every send is what keeps the
     * single-use refresh chain from being burned on every message — see
     * `zns-oa-token.ts`. One retry: a second `-124` after a fresh token is a
     * broken authorization and a person has to fix it, and retrying that in a
     * loop would spend the chain trying.
     */
    if (answer.error === -124 && typeof token !== 'string') {
      answer = await send(to, code, await token.refresh());
    }
    if (answer.error === 0) return;

    const refusal = ZNS_ERROR_CODES.get(answer.error);
    if (refusal === undefined) {
      warn({ event: 'unknown_zns_error_code', errorCode: answer.error, message: answer.message });
      throw new ZnsDeliveryError('zns_refused', answer.error, answer.message ?? 'unmapped error code');
    }
    throw new ZnsDeliveryError(refusal, answer.error, answer.message ?? 'refused');
  };
}

/**
 * Local development: the code goes to the server log and nowhere else.
 *
 * Loud on purpose. A quiet no-op sender is the failure mode the 503 was
 * protecting against — a deployment that answers 204 and delivers nothing
 * looks exactly like a working one until a collector says nobody ever sent
 * them anything. This one says, in every line, that the code was not sent.
 *
 * ## Why there is an allowlist, and why it defaults to nothing
 *
 * This sender printed EVERY number's code, and `deploy/cloud/cloud.env.example`
 * selects it — `PLAYERONE_ZNS_ENV=sandbox` with no ZNS credentials falls back
 * here, which is the shipped demo configuration. So a public deployment wrote
 * real collectors' one-time codes into its container log, where anyone with log
 * access could sign in as any of them. Both audits of `4a32929` found it; it is
 * the same class of mistake as the OAuth code in the request log, and worse,
 * because a sign-in code is the whole credential.
 *
 * So a code is written only for a number the deployment NAMED, in
 * `PLAYERONE_DEMO_PHONES`. The default is empty, which means a deployment that
 * has not thought about it discloses nothing. Every other number still gets a
 * loud line — the point of this sender is that silence is the dangerous
 * outcome — but the line carries no code and only the last three digits of the
 * number, which is enough to recognise your own handset and not enough to
 * harvest who is signing in.
 *
 * Numbers are compared NORMALISED through `toZnsPhone`, so `0900000001`,
 * `+84900000001` and `84900000001` are one entry and an operator's formatting
 * cannot silently empty the allowlist.
 */
export function devLogSender(
  log: (line: string) => void = console.warn,
  allowed: readonly string[] = [],
): CodeSender {
  /** Normalised once; a non-Vietnamese entry becomes null and matches nothing. */
  const named = new Set(allowed.map((entry) => toZnsPhone(entry.trim())).filter((e) => e !== null));
  return async (phone, code) => {
    const normalised = toZnsPhone(phone);
    if (normalised !== null && named.has(normalised)) {
      /**
       * The format is load-bearing: a smoke script reads the code off this
       * line to walk the demo sign-in without a handset. Keep `[zns:dev] NOT
       * SENT`, keep `... is <code>`.
       */
      log(`[zns:dev] NOT SENT — sign-in code for ${phone} is ${code}. No ZNS credentials are configured.`);
      return;
    }
    log(
      `[zns:dev] NOT SENT — a sign-in code for a number ending ${phone.slice(-3)} was NOT written ` +
        'to this log, because that number is not in PLAYERONE_DEMO_PHONES. Nobody received it. ' +
        'Configure a real channel (PLAYERONE_SIGN_IN_CHANNEL=zns or sms) before a collector uses this deployment.',
    );
  };
}

/** The three channels `PLAYERONE_SIGN_IN_CHANNEL` may name. */
export const SIGN_IN_CHANNELS = ['zns', 'sms', 'log'] as const;
export type SignInChannel = (typeof SIGN_IN_CHANNELS)[number];

/**
 * How the OA access token is kept alive, from the environment. Null when this
 * deployment has nothing to refresh with, and then the static
 * `PLAYERONE_ZNS_ACCESS_TOKEN` is used as it always was — which works for
 * twenty-five hours and then does not. See `zns-oa-token.ts`.
 *
 * `PLAYERONE_ZALO_APP_ID` and `PLAYERONE_ZALO_APP_SECRET` are the SAME app
 * credentials Zalo Login uses: one developer app holds both permissions, so
 * there is no third pair of variables to set.
 */
function znsTokenFromEnv(env: Record<string, string | undefined>): OaToken | null {
  const refreshToken = env['PLAYERONE_ZNS_REFRESH_TOKEN'];
  if (!refreshToken) return null;
  const appId = env['PLAYERONE_ZALO_APP_ID'];
  const appSecret = env['PLAYERONE_ZALO_APP_SECRET'];
  const path = env['PLAYERONE_ZNS_TOKEN_FILE'];
  const missing = (
    [
      ['PLAYERONE_ZALO_APP_ID', appId],
      ['PLAYERONE_ZALO_APP_SECRET', appSecret],
      ['PLAYERONE_ZNS_TOKEN_FILE', path],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `PLAYERONE_ZNS_REFRESH_TOKEN is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not`,
    );
  }
  return oaToken({
    appId: appId!,
    appSecret: appSecret!,
    seedRefreshToken: refreshToken,
    store: fileTokenStore(path!),
    baseUrl: env['PLAYERONE_ZNS_OA_TOKEN_URL'],
  });
}

/** ZNS on its own, with no development fallback. See the selector below. */
function znsSenderFromEnv(env: Record<string, string | undefined>): CodeSender {
  const token = znsTokenFromEnv(env);
  const names = token === null
    ? (['PLAYERONE_ZNS_ACCESS_TOKEN', 'PLAYERONE_ZNS_TEMPLATE_ID'] as const)
    : (['PLAYERONE_ZNS_TEMPLATE_ID'] as const);
  const missing = names.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set, so no ZNS message can be sent`,
    );
  }
  return znsSender({
    accessToken: token ?? env['PLAYERONE_ZNS_ACCESS_TOKEN']!,
    templateId: env['PLAYERONE_ZNS_TEMPLATE_ID']!,
    codeParam: env['PLAYERONE_ZNS_CODE_PARAM'],
    baseUrl: env['PLAYERONE_ZNS_BASE_URL'],
  });
}

/**
 * The sender the environment describes.
 *
 * ## The channel, named or inferred
 *
 * `PLAYERONE_SIGN_IN_CHANNEL` picks one of three explicitly, and naming one is
 * a commitment: `zns` and `sms` both fail closed if their credentials are
 * absent, because a deployment that asked for a channel and silently got a log
 * writer is the exact failure the 503 on `request-code` exists to prevent.
 * `log` is the way to ask for the log writer on purpose.
 *
 * **Unset, nothing about a deployment changes**, and that is deliberate — the
 * default is today's behaviour, not the new channel. Absent ZNS credentials on
 * `PLAYERONE_ZNS_ENV=sandbox` still mean the development sender rather than a
 * crash: the pilot has to be able to run before VNG has issued an account, and
 * a collector who cannot sign in at all is worse than one whose code is read
 * off a log by the operator sitting next to them. A *partial* configuration is
 * still a mistake and still fails closed naming what is missing — the same rule
 * as `zaloPayClientFromEnv` and `s3StoreFromEnv` — and so is
 * `PLAYERONE_ZNS_ENV=production` with nothing set, because production with no
 * ZNS account is not a development mode, it is a misconfiguration that would
 * print sign-in codes into a production log.
 */
export function signInCodeSenderFromEnv(env: Record<string, string | undefined> = process.env): CodeSender {
  /** Named by the deployment, and the only numbers a code is ever logged for. */
  const demoPhones = (env['PLAYERONE_DEMO_PHONES'] ?? '').split(',').filter((e) => e.trim() !== '');
  const channel = env['PLAYERONE_SIGN_IN_CHANNEL'];
  if (channel !== undefined && channel !== '') {
    if (!(SIGN_IN_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(
        `PLAYERONE_SIGN_IN_CHANNEL must be ${SIGN_IN_CHANNELS.join(', ')}, got '${channel}'`,
      );
    }
    if (channel === 'log') {
      assertLogChannelIsLocal(env);
      return devLogSender(console.warn, demoPhones);
    }
    if (channel === 'sms') return smsSenderFromEnv(env);
    return znsSenderFromEnv(env);
  }

  const zenv = env['PLAYERONE_ZNS_ENV'] ?? 'sandbox';
  if (zenv !== 'sandbox' && zenv !== 'production') {
    throw new Error(`PLAYERONE_ZNS_ENV must be sandbox or production, got '${zenv}'`);
  }
  const names = ['PLAYERONE_ZNS_ACCESS_TOKEN', 'PLAYERONE_ZNS_TEMPLATE_ID'] as const;
  const missing = names.filter((k) => !env[k]);
  if (missing.length === names.length && zenv === 'sandbox' && !env['PLAYERONE_ZNS_REFRESH_TOKEN']) {
    /**
     * The shipped demo configuration reaches here: sandbox, no credentials.
     * The allowlist is what makes that safe on a public hostname, and it is
     * why the gate lives on `devLogSender` rather than only on the explicit
     * `log` channel — guarding the channel alone would have left the one
     * deployment that actually logs codes unguarded.
     */
    return devLogSender(console.warn, demoPhones);
  }
  if (missing.length > 0 && !env['PLAYERONE_ZNS_REFRESH_TOKEN']) {
    throw new Error(
      `PLAYERONE_ZNS_ENV=${zenv} but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`,
    );
  }
  return znsSenderFromEnv(env);
}

/**
 * `PLAYERONE_SIGN_IN_CHANNEL=log` is a local choice, and refuses to be a remote
 * one.
 *
 * Asking for the log writer on a production ZNS environment, or on a public
 * hostname, is asking this service to print one-time codes where strangers can
 * read them. The old `PLAYERONE_ZNS_ENV=production` check already refused an
 * empty production configuration for the same reason; naming the channel must
 * not be a way around it.
 *
 * An UNSET public origin is allowed, because a pilot upload centre is a LAN
 * with no public URL at all and reading a code off the operator's own console
 * is exactly what this sender is for there.
 */
function assertLogChannelIsLocal(env: Record<string, string | undefined>): void {
  if ((env['PLAYERONE_ZNS_ENV'] ?? 'sandbox') === 'production') {
    throw new Error(
      'PLAYERONE_SIGN_IN_CHANNEL=log writes sign-in codes to the server log and cannot be used ' +
        'with PLAYERONE_ZNS_ENV=production. Configure zns or sms.',
    );
  }
  const origin = env['PLAYERONE_PUBLIC_ORIGIN'] || env['PLAYERONE_PUBLIC_URL'];
  if (!origin) return;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    throw new Error(`PLAYERONE_PUBLIC_ORIGIN must be a URL, got '${origin}'`);
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]') {
    throw new Error(
      `PLAYERONE_SIGN_IN_CHANNEL=log writes sign-in codes to the server log and cannot be used on ` +
        `a public origin (${origin}). Configure zns or sms, or name the demo numbers in ` +
        'PLAYERONE_DEMO_PHONES and leave the channel unset.',
    );
  }
}

/** For an error message only: never the token, never the number, never the code. */
function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}${e?.cause?.code ? ` [${e.cause.code}]` : ''}`;
}

function defaultWarn(event: ZnsWarning): void {
  console.warn(
    `[zns] ${event.event}: error=${event.errorCode} message=${JSON.stringify(event.message)} — ` +
      'mapped to zns_refused and treated as temporary; add the code to ZNS_ERROR_CODES once its meaning is known',
  );
}
