import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/i18n.ts';
import {
  DEFAULT_ZNS_TIMEOUT_MS,
  ZNS_BASE_URL,
  ZNS_ERROR_CODES,
  ZNS_REFUSALS,
  ZnsDeliveryError,
  devLogSender,
  signInCodeSenderFromEnv,
  toZnsPhone,
  znsSender,
  type ZnsRefusal,
  type ZnsWarning,
} from '../../src/zns.ts';
import { FakeZns, startFakeZns } from './fake-server.ts';

/**
 * The ZNS sender against the fake server. Everything on 127.0.0.1, no
 * credentials, no database: these run in the `env -u DATABASE_URL`
 * configuration, and nothing here reaches the internet.
 *
 * What is asserted, in order of what would hurt most if it were wrong:
 *
 *   1. A collector whose number has no Zalo account produces
 *      `zns_no_zalo_account` — a distinct, named, actionable refusal. That
 *      person can never sign in this way and somebody has to be told.
 *   2. Every other failure ZNS can return has a name of its own, and a code
 *      this table has never seen is loud rather than silent.
 *   3. Nothing this file can throw carries the code, the token or the number.
 *   4. No credentials means the development sender, not a crash.
 */

let fake: FakeZns;
let warnings: ZnsWarning[];

const PHONE = '+84900000001';
const CODE = '123456';

const sender = (overrides: Partial<Parameters<typeof znsSender>[0]> = {}) =>
  znsSender({ ...fake.clientConfig(), warn: (e) => warnings.push(e), ...overrides });

/** The rejection, as a `ZnsDeliveryError`, or a failure if it resolved. */
async function refusalOf(send: () => Promise<void>): Promise<ZnsDeliveryError> {
  try {
    await send();
  } catch (err) {
    if (err instanceof ZnsDeliveryError) return err;
    throw err;
  }
  throw new Error('expected a ZnsDeliveryError, but delivery resolved');
}

beforeAll(async () => {
  fake = await startFakeZns();
});
afterAll(async () => {
  await fake.close();
});
beforeEach(() => {
  warnings = [];
  fake.reset();
});

// ---------------------------------------------------------------------------

describe('sending', () => {
  it('puts the code in the approved template, on the number in 84 form, with the access token', async () => {
    await sender()(PHONE, CODE);
    expect(fake.received).toHaveLength(1);
    const sent = fake.received[0]!;
    expect(sent.accessToken).toBe(fake.accessToken);
    expect(sent.body['phone']).toBe('84900000001');
    expect(sent.body['template_id']).toBe(fake.templateId);
    expect(fake.lastTemplateData()).toEqual({ otp: CODE });
  });

  it('puts the code in whatever parameter the approved template names', async () => {
    await sender({ codeParam: 'ma_xac_thuc' })(PHONE, CODE);
    expect(fake.lastTemplateData()).toEqual({ ma_xac_thuc: CODE });
  });

  it('refuses to construct without an access token or a template', () => {
    expect(() => sender({ accessToken: '' })).toThrow(/accessToken/);
    expect(() => sender({ templateId: '' })).toThrow(/templateId/);
  });

  it('defaults to Zalo’s business endpoint and a ten-second budget', () => {
    expect(ZNS_BASE_URL).toBe('https://business.openapi.zalo.me');
    expect(DEFAULT_ZNS_TIMEOUT_MS).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------

describe('the number that has no Zalo account', () => {
  /**
   * The one that matters. Zalo is not SMS: a number that exists and rings is
   * not necessarily a number Zalo can deliver to, so this is a permanent
   * refusal for that collector and not a "try again". It has to arrive as its
   * own name, so an operator can list the collectors it happened to.
   */
  it('is its own named refusal, not a generic failure', async () => {
    fake.plan({ kind: 'error', error: -118, message: 'User is not existed' });
    const err = await refusalOf(() => sender()(PHONE, CODE));
    expect(err.refusal).toBe('zns_no_zalo_account');
    expect(err.errorCode).toBe(-118);
  });

  it('has a sentence an operator can act on, in all three languages', () => {
    for (const locale of ['en', 'zh', 'vi'] as const) {
      const sentence = MESSAGES[locale]['bo.refused.zns_no_zalo_account'];
      expect(sentence, locale).toBeTruthy();
      expect(sentence.length, locale).toBeGreaterThan(40);
    }
    expect(MESSAGES.en['bo.refused.zns_no_zalo_account']).toMatch(/Zalo/);
  });
});

// ---------------------------------------------------------------------------

describe('every failure ZNS can return', () => {
  it('maps each code in the table to its own refusal', async () => {
    for (const [code, expected] of ZNS_ERROR_CODES) {
      fake.plan({ kind: 'error', error: code });
      const err = await refusalOf(() => sender()(PHONE, CODE));
      expect(err.refusal, `error ${code}`).toBe(expected);
      expect(err.errorCode, `error ${code}`).toBe(code);
    }
  });

  it('covers all six classes the pilot has to be able to act on', () => {
    const mapped = new Set(ZNS_ERROR_CODES.values());
    for (const refusal of [
      'zns_no_zalo_account',
      'zns_template_rejected',
      'zns_quota_exhausted',
      'zns_rate_limited',
      'zns_credentials_rejected',
      'zns_unreachable',
    ] as const) {
      expect(mapped.has(refusal), refusal).toBe(true);
    }
  });

  it('is loud about a code no table knows, and treats it as temporary', async () => {
    fake.plan({ kind: 'error', error: -9999, message: 'something new' });
    const err = await refusalOf(() => sender()(PHONE, CODE));
    expect(err.refusal).toBe('zns_refused');
    expect(err.errorCode).toBe(-9999);
    expect(warnings).toEqual([
      { event: 'unknown_zns_error_code', errorCode: -9999, message: 'something new' },
    ]);
  });

  it('reads a wrong access token as wrong credentials, from the server’s own answer', async () => {
    const err = await refusalOf(() => sender({ accessToken: 'not-the-token' })(PHONE, CODE));
    expect(err.refusal).toBe('zns_credentials_rejected');
    expect(err.errorCode).toBe(-124);
  });

  it('reads a timeout, a reset, a truncated body and an HTTP failure all as unreachable', async () => {
    const quick = () => sender({ timeoutMs: 150 });
    fake.plan({ kind: 'hang', ms: 5_000 });
    expect((await refusalOf(() => quick()(PHONE, CODE))).refusal).toBe('zns_unreachable');
    fake.plan({ kind: 'reset' });
    expect((await refusalOf(() => sender()(PHONE, CODE))).refusal).toBe('zns_unreachable');
    fake.plan({ kind: 'truncated' });
    expect((await refusalOf(() => sender()(PHONE, CODE))).refusal).toBe('zns_unreachable');
    fake.plan({ kind: 'http', status: 502, body: '<html>bad gateway</html>' });
    expect((await refusalOf(() => sender()(PHONE, CODE))).refusal).toBe('zns_unreachable');
  });

  it('never puts the code, the number or the access token in what it throws', async () => {
    fake.plan({ kind: 'error', error: -118 }, { kind: 'http', status: 500 });
    for (let i = 0; i < 2; i++) {
      const err = await refusalOf(() => sender()(PHONE, CODE));
      const text = `${err.message} ${err.stack ?? ''}`;
      expect(text).not.toContain(CODE);
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain('84900000001');
      expect(text).not.toContain(fake.accessToken);
    }
  });

  it('gives every refusal name a sentence in all three languages', () => {
    for (const name of ZNS_REFUSALS) {
      for (const locale of ['en', 'zh', 'vi'] as const) {
        expect(MESSAGES[locale][`bo.refused.${name}`], `no ${locale} sentence for ${name}`).toBeTruthy();
      }
    }
  });

  it('has no sentence for a refusal that no longer exists', () => {
    const named = Object.keys(MESSAGES.en).filter((k) => k.startsWith('bo.refused.zns_'));
    expect(new Set(named)).toEqual(new Set([...ZNS_REFUSALS].map((n) => `bo.refused.${n}`)));
  });
});

// ---------------------------------------------------------------------------

describe('the number itself', () => {
  it('normalises the spellings collector rows actually hold', () => {
    expect(toZnsPhone('+84900000001')).toBe('84900000001');
    expect(toZnsPhone('0900000001')).toBe('84900000001');
    expect(toZnsPhone('84900000001')).toBe('84900000001');
    expect(toZnsPhone('+84 90 000 0001')).toBe('84900000001');
    expect(toZnsPhone('0388123456')).toBe('84388123456');
  });

  it('refuses anything that is not a Vietnamese mobile number', () => {
    expect(toZnsPhone('+12025550123')).toBeNull();
    expect(toZnsPhone('090000000')).toBeNull(); // one digit short
    expect(toZnsPhone('09000000012')).toBeNull(); // one too many
    expect(toZnsPhone('0212345678')).toBeNull(); // a landline prefix
    expect(toZnsPhone('')).toBeNull();
  });

  it('refuses a foreign number before any request leaves this process', async () => {
    const err = await refusalOf(() => sender()('+12025550123', CODE));
    expect(err.refusal).toBe('zns_phone_not_vietnamese');
    expect(fake.received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('configuration by environment', () => {
  const full = {
    PLAYERONE_ZNS_ACCESS_TOKEN: 'token',
    PLAYERONE_ZNS_TEMPLATE_ID: 'tpl',
  };

  it('gives the development sender when nothing is set, rather than crashing', async () => {
    const lines: string[] = [];
    expect(() => signInCodeSenderFromEnv({})).not.toThrow();
    // The development sender is what the pilot runs on before VNG issues an
    // account, and it says loudly that nothing was sent.
    await devLogSender((l) => lines.push(l))(PHONE, CODE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('NOT SENT');
    expect(lines[0]).toContain(CODE);
  });

  it('fails closed on half a configuration, naming what is missing', () => {
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_ACCESS_TOKEN: 'token' })).toThrow(
      /PLAYERONE_ZNS_TEMPLATE_ID is not set/,
    );
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_TEMPLATE_ID: 'tpl' })).toThrow(
      /PLAYERONE_ZNS_ACCESS_TOKEN is not set/,
    );
  });

  it('refuses production with no credentials: that is a misconfiguration, not a mode', () => {
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_ENV: 'production' })).toThrow(
      /PLAYERONE_ZNS_ACCESS_TOKEN, PLAYERONE_ZNS_TEMPLATE_ID are not set/,
    );
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_ENV: 'production', ...full })).not.toThrow();
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_ENV: 'staging' })).toThrow(/sandbox or production/);
  });

  it('builds a real sender that talks to the configured base URL', async () => {
    const send = signInCodeSenderFromEnv({
      PLAYERONE_ZNS_ACCESS_TOKEN: fake.accessToken,
      PLAYERONE_ZNS_TEMPLATE_ID: fake.templateId,
      PLAYERONE_ZNS_BASE_URL: fake.baseUrl,
      PLAYERONE_ZNS_CODE_PARAM: 'otp',
    });
    await send(PHONE, CODE);
    expect(fake.received).toHaveLength(1);
    expect(fake.received[0]!.body['template_id']).toBe(fake.templateId);
  });

  it('holds no credentials in the repository', async () => {
    // The names, never the values. `.gitignore` already covers `.env*`.
    for (const name of Object.keys(full)) expect(process.env[name]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('the refusal names', () => {
  it('are the eight the sender can produce, and nothing else', () => {
    const produced: ZnsRefusal[] = [
      'zns_no_zalo_account',
      'zns_phone_not_vietnamese',
      'zns_template_rejected',
      'zns_quota_exhausted',
      'zns_rate_limited',
      'zns_credentials_rejected',
      'zns_unreachable',
      'zns_refused',
    ];
    expect(new Set(produced)).toEqual(new Set(ZNS_REFUSALS));
  });
});
