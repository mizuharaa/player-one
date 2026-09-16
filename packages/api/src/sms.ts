import { randomUUID } from 'node:crypto';
import { toZnsPhone, type CodeSender } from './zns.ts';

/**
 * The sign-in code over SMS, when Zalo cannot carry it. APP-01, SEC-01.
 *
 * ## Why this exists, when 2026-08-29 said "do not build SMS as well"
 *
 * Owner's decision, 2026-09-16. That rule assumed ZNS worked; it does not.
 * Sending a ZNS message needs a **verified** Official Account — the send API
 * refuses an unverified or free-plan OA by name, `-135`, and only a verified OA
 * can be linked to a ZBS billing account at all — and VNG has not issued one.
 * So the ZNS-only sign-in delivers nothing to anybody, and this is the second
 * `SendSignInCode` the old rule said a second channel would have to be.
 *
 * It stays a fallback and not the default. Even with ZNS working, two classes
 * of collector are unreachable by it: a number with no Zalo account (`-118`,
 * which was the stated cost of the 2026-08-29 decision) and a person who has
 * refused Zalo's message channel (`-139`, `-141`). SMS is what covers those.
 *
 * ## Why eSMS.vn and not Twilio
 *
 * Measured in `docs/sign-in-channels.md`, and it is not close:
 *
 *   - Price. eSMS brandname CSKH is **520 VND**; Twilio is **$0.2852 per
 *     segment**, about 7,400 VND — fourteen times, and ZNS is 300.
 *   - Deliverability. Vietnam has blocked unregistered sender IDs outright
 *     since 2025-08-25. Twilio supports an alphanumeric sender ID for Vietnam
 *     but requires it pre-registered with **five weeks** of provisioning, and
 *     offers no Vietnamese numbers, no short codes, no two-way and delivery
 *     receipts that are SMSC-acknowledgement only. eSMS is a Vietnamese
 *     provider registering a Vietnamese brandname with the carriers directly.
 *
 * The cost of choosing it, stated up front: **a brandname needs a business
 * registration licence, a sealed công văn and five to ten business days.** The
 * owner steps are in the doc. `Sandbox: "1"` exercises this whole adapter for
 * free before the brandname exists and delivers to no handset, which is why
 * `PLAYERONE_SMS_SANDBOX` is here.
 *
 * ## Shape
 *
 * The same shape as `zns.ts`, deliberately, because they are interchangeable
 * behind `CodeSender`: one adapter, every failure mapped onto a named refusal,
 * an unrecognised answer logged loudly, and `fetch` taken as configuration so
 * the test suite never touches the network.
 */

/**
 * Every way an SMS delivery can fail, by name. Each needs an en/zh/vi sentence
 * in `i18n.ts`, for the reason `ZnsRefusal` gives: an operator reads these when
 * a collector says no code ever arrived.
 *
 *   - `sms_phone_not_vietnamese` — the number on file is not a Vietnamese
 *     mobile number. Refused before the request leaves this process.
 *   - `sms_credentials_rejected` — eSMS refused the API key or secret key
 *     (`101`). A configuration answer.
 *   - `sms_brandname_rejected` — the brandname is unknown or not active
 *     (`104`). Either it is misspelled here or its registration has lapsed.
 *   - `sms_template_rejected` — the message template is not registered on the
 *     customer-care track (`146`). eSMS's approval queue.
 *   - `sms_unreachable` — no answer, a timeout, a connection error from eSMS
 *     (`99`), or something that is not an eSMS envelope. Usually temporary.
 *   - `sms_refused` — a `CodeResult` this table has never seen. Logged with the
 *     code and treated as temporary, because assuming permanence on an unknown
 *     code strands a collector.
 */
export type SmsRefusal =
  | 'sms_phone_not_vietnamese'
  | 'sms_credentials_rejected'
  | 'sms_brandname_rejected'
  | 'sms_template_rejected'
  | 'sms_unreachable'
  | 'sms_refused';

/** For the i18n completeness test: every name here needs three sentences. */
export const SMS_REFUSALS: ReadonlySet<SmsRefusal> = new Set<SmsRefusal>([
  'sms_phone_not_vietnamese',
  'sms_credentials_rejected',
  'sms_brandname_rejected',
  'sms_template_rejected',
  'sms_unreachable',
  'sms_refused',
]);

export class SmsDeliveryError extends Error {
  readonly refusal: SmsRefusal;
  /** eSMS's `CodeResult`, or null when nothing came back to read one from. */
  readonly codeResult: string | null;

  constructor(refusal: SmsRefusal, codeResult: string | null, detail: string) {
    super(`sms: ${refusal}${codeResult === null ? '' : ` (CodeResult ${codeResult})`} — ${detail}`);
    this.name = 'SmsDeliveryError';
    this.refusal = refusal;
    this.codeResult = codeResult;
  }
}

/**
 * eSMS `CodeResult` → refusal. Verified against developers.esms.vn, and `101`
 * was seen live from the real endpoint with deliberately wrong credentials.
 *
 * Strings and not numbers: eSMS returns `"100"`, quoted, and comparing a
 * quoted code against a number is the bug that would make every send look
 * refused.
 */
export const SMS_CODE_RESULTS: ReadonlyMap<string, SmsRefusal> = new Map<string, SmsRefusal>([
  ['101', 'sms_credentials_rejected'],
  ['104', 'sms_brandname_rejected'],
  ['146', 'sms_template_rejected'],
  ['99', 'sms_unreachable'],
]);

/** Accepted. Anything else, mapped or not, is a refusal. */
export const SMS_ACCEPTED = '100';

export const SMS_BASE_URL = 'https://rest.esms.vn';
export const SMS_SEND_PATH = '/MainService.svc/json/SendMultipleMessage_V4_post_json/';
export const DEFAULT_SMS_TIMEOUT_MS = 10_000;

/**
 * The body, and it mirrors the approved ZNS template rather than inventing a
 * second wording.
 *
 * ZNS's `Mẫu Xác thực` prints a fixed "Mã xác thực của bạn là" followed by the
 * code, and nothing about that line is ours to change. This says the same
 * sentence so that a collector who gets a code by SMS one week and by Zalo the
 * next is reading the same message.
 *
 * Unaccented on purpose. `IsUnicode: "0"` is GSM-7, which is one billed segment;
 * the same sentence with diacritics is UCS-2 and costs two. Vietnamese OTP SMS
 * is written this way by every bank and wallet in the country for exactly that
 * reason. No URL and no phone number in the body either — Vietnamese carriers
 * refuse both in customer-care traffic.
 *
 * `PLAYERONE_SMS_TEMPLATE` overrides it, because the text that actually ships is
 * whatever eSMS's reviewers approved and not whatever was guessed here. `{code}`
 * is where the digits go.
 */
export const DEFAULT_SMS_TEMPLATE = 'Ma xac thuc cua ban la {code}. Ma het han sau 5 phut.';

export type SmsConfig = {
  /** `PLAYERONE_SMS_API_KEY`. A body field, not a header. Never logged. */
  apiKey: string;
  /** `PLAYERONE_SMS_SECRET_KEY`. Likewise. */
  secretKey: string;
  /** The registered brandname, at most 11 characters. */
  brandname: string;
  /** `{code}` is replaced with the six digits. */
  template?: string;
  /** eSMS's own test mode: charged nothing, delivered nowhere. */
  sandbox?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  warn?: (event: SmsWarning) => void;
};

export type SmsWarning = {
  event: 'unknown_sms_code_result';
  codeResult: string;
  message: string | null;
};

/** The real thing. Nothing here logs the code, the keys or the number. */
export function smsSender(config: SmsConfig): CodeSender {
  if (!config.apiKey) throw new Error('SmsConfig.apiKey is required');
  if (!config.secretKey) throw new Error('SmsConfig.secretKey is required');
  if (!config.brandname) throw new Error('SmsConfig.brandname is required');
  const baseUrl = (config.baseUrl ?? SMS_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_SMS_TIMEOUT_MS;
  const fetchFn = config.fetch ?? fetch;
  const template = config.template ?? DEFAULT_SMS_TEMPLATE;
  const warn = config.warn ?? defaultWarn;

  return async (phone, code) => {
    /**
     * `84` and nine digits, which is what eSMS's `Phone` field wants and what
     * `toZnsPhone` already produces — the two channels agree on the format, so
     * this reuses that function rather than keeping a second copy of every
     * Vietnamese mobile prefix. The name still says ZNS; the format does not
     * belong to ZNS.
     */
    const to = toZnsPhone(phone);
    if (to === null) {
      throw new SmsDeliveryError('sms_phone_not_vietnamese', null, 'not a Vietnamese mobile number');
    }

    let response: Response;
    try {
      response = await fetchFn(baseUrl + SMS_SEND_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ApiKey: config.apiKey,
          SecretKey: config.secretKey,
          Phone: to,
          Content: template.replaceAll('{code}', code),
          Brandname: config.brandname,
          // 2 is the customer-care / OTP track. 1 is advertising, which has a
          // twenty-recipient minimum and cannot carry a one-time code at all.
          SmsType: '2',
          // GSM-7. See DEFAULT_SMS_TEMPLATE for why the body is unaccented.
          IsUnicode: '0',
          Sandbox: config.sandbox === true ? '1' : '0',
          // Fresh per send. eSMS refuses a repeat with CodeResult 124, which is
          // its idempotency guard; a new code is a new message, never a repeat.
          RequestId: randomUUID(),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new SmsDeliveryError('sms_unreachable', null, describe(err));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch (err) {
      throw new SmsDeliveryError('sms_unreachable', null, `body is not JSON (${describe(err)})`);
    }
    if (!response.ok) {
      throw new SmsDeliveryError('sms_unreachable', null, `http ${response.status}`);
    }
    const envelope = parsed as { CodeResult?: unknown; ErrorMessage?: unknown };
    /**
     * eSMS documents `CodeResult` as a string and has been seen returning one.
     * Coerced rather than type-checked, because a provider that starts sending
     * `100` unquoted must not turn every successful send into a refusal.
     */
    const result =
      typeof envelope?.CodeResult === 'string'
        ? envelope.CodeResult
        : typeof envelope?.CodeResult === 'number'
          ? String(envelope.CodeResult)
          : null;
    if (result === null) {
      throw new SmsDeliveryError('sms_unreachable', null, 'no CodeResult field');
    }
    if (result === SMS_ACCEPTED) return;

    const message = typeof envelope.ErrorMessage === 'string' ? envelope.ErrorMessage : null;
    const refusal = SMS_CODE_RESULTS.get(result);
    if (refusal === undefined) {
      warn({ event: 'unknown_sms_code_result', codeResult: result, message });
      throw new SmsDeliveryError('sms_refused', result, message ?? 'unmapped CodeResult');
    }
    throw new SmsDeliveryError(refusal, result, message ?? 'refused');
  };
}

/**
 * The SMS sender the environment describes. Throws, naming what is missing.
 *
 * No development fallback here, and that is the difference from
 * `signInCodeSenderFromEnv`'s ZNS branch: naming `sms` is a deliberate choice
 * of channel, and handing back a sender that writes codes to a log instead
 * would be a deployment that looks configured and delivers nothing. Ask for
 * `PLAYERONE_SIGN_IN_CHANNEL=log` if that is what is wanted.
 */
export function smsSenderFromEnv(env: Record<string, string | undefined> = process.env): CodeSender {
  const names = ['PLAYERONE_SMS_API_KEY', 'PLAYERONE_SMS_SECRET_KEY', 'PLAYERONE_SMS_BRANDNAME'] as const;
  const missing = names.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `PLAYERONE_SIGN_IN_CHANNEL=sms but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`,
    );
  }
  return smsSender({
    apiKey: env['PLAYERONE_SMS_API_KEY']!,
    secretKey: env['PLAYERONE_SMS_SECRET_KEY']!,
    brandname: env['PLAYERONE_SMS_BRANDNAME']!,
    template: env['PLAYERONE_SMS_TEMPLATE'],
    sandbox: env['PLAYERONE_SMS_SANDBOX'] === '1',
    baseUrl: env['PLAYERONE_SMS_BASE_URL'],
  });
}

/** For an error message only: never the keys, never the number, never the code. */
function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}${e?.cause?.code ? ` [${e.cause.code}]` : ''}`;
}

function defaultWarn(event: SmsWarning): void {
  console.warn(
    `[sms] ${event.event}: CodeResult=${event.codeResult} message=${JSON.stringify(event.message)} — ` +
      'mapped to sms_refused and treated as temporary; add the code to SMS_CODE_RESULTS once its meaning is known',
  );
}
