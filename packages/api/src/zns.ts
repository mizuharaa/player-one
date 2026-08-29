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
 *     collector in another way. **The one that matters.** It is permanent for
 *     that number; every other refusal here clears on its own or with a
 *     configuration change.
 *   - `zns_phone_not_vietnamese` — the number on file is not a Vietnamese
 *     mobile number. Fix the collector record. Refused before the request
 *     leaves this process.
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
 * **This table is provisional and the numbers are the part to confirm.** We do
 * not hold a ZNS account yet, so the codes below are transcribed from Zalo's
 * published error list and have never been seen from a live account. The
 * *classes* are settled — those are the seven things that can go wrong and
 * they each need a different answer — and the fallback is what makes a wrong
 * number here safe: an unmapped code is logged with its message and treated as
 * temporary, so nobody is stranded by a transcription error. Confirm the
 * numbers against VNG's ZNS documentation when the account exists, and correct
 * this map; nothing else has to change.
 *
 * Same discipline as `SUB_RETURN_CODES` in the ZaloPay client, and the same
 * reason for it: a code we do not understand must be loud, not silent.
 */
export const ZNS_ERROR_CODES: ReadonlyMap<number, ZnsRefusal> = new Map<number, ZnsRefusal>([
  [-108, 'zns_phone_not_vietnamese'],
  [-118, 'zns_no_zalo_account'],
  [-124, 'zns_credentials_rejected'],
  [-125, 'zns_credentials_rejected'],
  [-133, 'zns_credentials_rejected'],
  [-134, 'zns_template_rejected'],
  [-139, 'zns_template_rejected'],
  [-140, 'zns_template_rejected'],
  [-141, 'zns_quota_exhausted'],
  [-146, 'zns_quota_exhausted'],
  [-114, 'zns_rate_limited'],
  [-115, 'zns_unreachable'],
]);

export type ZnsConfig = {
  /** OA access token. Expires; refreshed out of band and re-read from the environment. */
  accessToken: string;
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

  return async (phone, code) => {
    const to = toZnsPhone(phone);
    if (to === null) {
      throw new ZnsDeliveryError('zns_phone_not_vietnamese', null, 'not a Vietnamese mobile number');
    }

    let response: Response;
    try {
      response = await fetchFn(baseUrl + ZNS_SEND_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', access_token: config.accessToken },
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
    if (envelope.error === 0) return;

    const message = typeof envelope.message === 'string' ? envelope.message : null;
    const refusal = ZNS_ERROR_CODES.get(envelope.error);
    if (refusal === undefined) {
      warn({ event: 'unknown_zns_error_code', errorCode: envelope.error, message });
      throw new ZnsDeliveryError('zns_refused', envelope.error, message ?? 'unmapped error code');
    }
    throw new ZnsDeliveryError(refusal, envelope.error, message ?? 'refused');
  };
}

/**
 * Local development: the code goes to the server log and nowhere else.
 *
 * Loud on purpose. A quiet no-op sender is the failure mode the 503 was
 * protecting against — a deployment that answers 204 and delivers nothing
 * looks exactly like a working one until a collector says nobody ever sent
 * them anything. This one says, in every line, that the code was not sent.
 */
export function devLogSender(log: (line: string) => void = console.warn): CodeSender {
  return async (phone, code) => {
    log(`[zns:dev] NOT SENT — sign-in code for ${phone} is ${code}. No ZNS credentials are configured.`);
  };
}

/**
 * The sender the environment describes.
 *
 * Absent credentials mean the development sender, never a crash: the pilot has
 * to be able to run before VNG has issued a ZNS account, and a collector who
 * cannot sign in at all is worse than one whose code is read off a log by the
 * operator sitting next to them.
 *
 * A *partial* configuration is still a mistake and fails closed naming what is
 * missing — the same rule as `zaloPayClientFromEnv` and `s3StoreFromEnv` — and
 * so is `PLAYERONE_ZNS_ENV=production` with nothing set, because production
 * with no ZNS account is not a development mode, it is a misconfiguration that
 * would print sign-in codes into a production log.
 */
export function signInCodeSenderFromEnv(env: Record<string, string | undefined> = process.env): CodeSender {
  const zenv = env['PLAYERONE_ZNS_ENV'] ?? 'sandbox';
  if (zenv !== 'sandbox' && zenv !== 'production') {
    throw new Error(`PLAYERONE_ZNS_ENV must be sandbox or production, got '${zenv}'`);
  }
  const names = ['PLAYERONE_ZNS_ACCESS_TOKEN', 'PLAYERONE_ZNS_TEMPLATE_ID'] as const;
  const missing = names.filter((k) => !env[k]);
  if (missing.length === names.length && zenv === 'sandbox') return devLogSender();
  if (missing.length > 0) {
    throw new Error(
      `PLAYERONE_ZNS_ENV=${zenv} but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`,
    );
  }
  return znsSender({
    accessToken: env['PLAYERONE_ZNS_ACCESS_TOKEN']!,
    templateId: env['PLAYERONE_ZNS_TEMPLATE_ID']!,
    codeParam: env['PLAYERONE_ZNS_CODE_PARAM'],
    baseUrl: env['PLAYERONE_ZNS_BASE_URL'],
  });
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
