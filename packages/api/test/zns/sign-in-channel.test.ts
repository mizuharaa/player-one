import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../src/i18n.ts';
import {
  DEFAULT_SMS_TEMPLATE,
  OA_REFRESH_SKEW_MS,
  OA_TOKEN_URL,
  SIGN_IN_CHANNELS,
  SMS_ACCEPTED,
  SMS_CODE_RESULTS,
  SMS_REFUSALS,
  SMS_SEND_PATH,
  SmsDeliveryError,
  ZNS_SEND_PATH,
  ZnsDeliveryError,
  devLogSender,
  fileTokenStore,
  oaToken,
  signInCodeSenderFromEnv,
  smsSender,
  znsSender,
  type SmsRefusal,
} from '../../src/index.ts';

/**
 * The second channel, and the token that keeps the first one alive. APP-01.
 *
 * Owner's decision, 2026-09-16, which overrides "do not build SMS as well":
 * ZNS needs a verified Official Account (`-135`) and VNG has not issued one, so
 * the ZNS-only sign-in delivers nothing to anybody.
 *
 * Every fixture here is a recorded `fetch`, for the reason
 * `test/zalo-login.test.ts` gives: what these can get wrong is which field goes
 * where and whether a single-use token is spent twice, and a function proves
 * both with none of a server. `zns/fake-server.ts` still owns the socket-level
 * cases, which are unchanged.
 */

const PHONE = '+84900000001';
const CODE = '123456';

type Answer = { status?: number; body: unknown } | { throws: true } | { text: string; status: number };

function recorder(answers: Answer[]) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const queue = [...answers];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const answer = queue.shift() ?? { body: {} };
    if ('throws' in answer) throw Object.assign(new Error('socket hang up'), { name: 'TypeError' });
    if ('text' in answer) return new Response(answer.text, { status: answer.status });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetch: fetchFn };
}

const refusalOf = async <T extends Error>(run: () => Promise<unknown>): Promise<T> => {
  try {
    await run();
  } catch (err) {
    return err as T;
  }
  throw new Error('expected a refusal');
};

// ---------------------------------------------------------------------------

describe('the SMS sender (eSMS.vn)', () => {
  const sms = (fetchFn: typeof fetch, over: Record<string, unknown> = {}) =>
    smsSender({
      apiKey: 'ESMS-API-KEY',
      secretKey: 'ESMS-SECRET-KEY',
      brandname: 'PLAYERONE',
      fetch: fetchFn,
      warn: () => {},
      ...over,
    });

  it('sends the code in the ZNS template wording, on the customer-care track', async () => {
    const zalo = recorder([{ body: { CodeResult: SMS_ACCEPTED, SMSID: '1' } }]);
    await sms(zalo.fetch)(PHONE, CODE);

    const call = zalo.calls[0]!;
    expect(call.url).toBe(`https://rest.esms.vn${SMS_SEND_PATH}`);
    const sent = JSON.parse(call.body) as Record<string, string>;
    /**
     * The keys and the secret travel in the BODY. eSMS has no auth header, and
     * a version of this that sent one would authenticate nothing.
     */
    expect(sent['ApiKey']).toBe('ESMS-API-KEY');
    expect(sent['SecretKey']).toBe('ESMS-SECRET-KEY');
    expect(call.headers['authorization']).toBeUndefined();
    // `84` and nine digits, which is what `toZnsPhone` produces for both channels.
    expect(sent['Phone']).toBe('84900000001');
    expect(sent['Brandname']).toBe('PLAYERONE');
    // 2 is customer care. 1 is advertising and has a twenty-recipient minimum,
    // so it cannot carry a one-time code at all.
    expect(sent['SmsType']).toBe('2');
    // GSM-7: the same sentence with diacritics is UCS-2 and bills two segments.
    expect(sent['IsUnicode']).toBe('0');
    expect(sent['Sandbox']).toBe('0');
    expect(sent['RequestId']).toMatch(/^[0-9a-f-]{36}$/);
    // The code, in the wording the approved ZNS template prints.
    expect(sent['Content']).toBe(DEFAULT_SMS_TEMPLATE.replace('{code}', CODE));
    expect(sent['Content']).toContain(CODE);
    // Vietnamese carriers refuse both in customer-care traffic.
    expect(sent['Content']).not.toMatch(/https?:|\d{9,}/);
  });

  it('gives every RequestId away once, so eSMS never sees a duplicate', async () => {
    const zalo = recorder([
      { body: { CodeResult: SMS_ACCEPTED } },
      { body: { CodeResult: SMS_ACCEPTED } },
    ]);
    const send = sms(zalo.fetch);
    await send(PHONE, '111111');
    await send(PHONE, '222222');
    const ids = zalo.calls.map((c) => (JSON.parse(c.body) as { RequestId: string }).RequestId);
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses a number that is not Vietnamese before a request leaves the process', async () => {
    const zalo = recorder([]);
    const err = await refusalOf<SmsDeliveryError>(() => sms(zalo.fetch)('+8613800138000', CODE));
    expect(err.refusal).toBe('sms_phone_not_vietnamese');
    expect(zalo.calls).toHaveLength(0);
  });

  it('maps each CodeResult in the table to its own refusal', async () => {
    for (const [result, expected] of SMS_CODE_RESULTS) {
      const zalo = recorder([{ body: { CodeResult: result, ErrorMessage: 'refused' } }]);
      const err = await refusalOf<SmsDeliveryError>(() => sms(zalo.fetch)(PHONE, CODE));
      expect(err.refusal, `CodeResult ${result}`).toBe(expected);
      expect(err.codeResult, `CodeResult ${result}`).toBe(result);
    }
  });

  it('is loud about a CodeResult no table knows, and treats it as temporary', async () => {
    const warnings: unknown[] = [];
    const zalo = recorder([{ body: { CodeResult: '777', ErrorMessage: 'something new' } }]);
    const err = await refusalOf<SmsDeliveryError>(() =>
      sms(zalo.fetch, { warn: (w: unknown) => warnings.push(w) })(PHONE, CODE),
    );
    expect(err.refusal).toBe('sms_refused');
    expect(warnings).toHaveLength(1);
  });

  it('accepts an unquoted CodeResult, so a provider change cannot fail every send', async () => {
    const zalo = recorder([{ body: { CodeResult: 100 } }]);
    await expect(sms(zalo.fetch)(PHONE, CODE)).resolves.toBeUndefined();
  });

  it('calls a transport failure temporary and never logs the code or the keys', async () => {
    for (const answer of [{ throws: true } as const, { text: '<html>502</html>', status: 502 }]) {
      const zalo = recorder([answer]);
      const err = await refusalOf<SmsDeliveryError>(() => sms(zalo.fetch)(PHONE, CODE));
      expect(err.refusal).toBe('sms_unreachable');
      expect(err.message).not.toContain(CODE);
      expect(err.message).not.toContain('ESMS-SECRET-KEY');
    }
  });

  it('sends eSMS its own sandbox flag rather than pretending to send', async () => {
    const zalo = recorder([{ body: { CodeResult: SMS_ACCEPTED } }]);
    await sms(zalo.fetch, { sandbox: true })(PHONE, CODE);
    expect((JSON.parse(zalo.calls[0]!.body) as { Sandbox: string }).Sandbox).toBe('1');
  });

  it('gives every refusal name a sentence in all three languages, and no more', () => {
    for (const name of SMS_REFUSALS) {
      for (const locale of ['en', 'zh', 'vi'] as const) {
        expect(MESSAGES[locale][`bo.refused.${name}`], `no ${locale} sentence for ${name}`).toBeTruthy();
      }
    }
    const named = Object.keys(MESSAGES.en).filter((k) => k.startsWith('bo.refused.sms_'));
    expect(new Set(named)).toEqual(new Set([...SMS_REFUSALS].map((n: SmsRefusal) => `bo.refused.${n}`)));
  });
});

// ---------------------------------------------------------------------------

describe('the OA access token', () => {
  const store = () => {
    const path = join(mkdtempSync(join(tmpdir(), 'po-zns-')), 'token.json');
    return { path, store: fileTokenStore(path, () => {}) };
  };

  const issued = (access: string, refresh: string) => ({
    body: { access_token: access, refresh_token: refresh, expires_in: '90000' },
  });

  it('refreshes from the seed, sends the app secret as a header, and persists the rotation', async () => {
    const { path, store: held } = store();
    const zalo = recorder([issued('ACCESS-1', 'REFRESH-2')]);
    const token = oaToken({
      appId: '3849367142822243338',
      appSecret: 'APP-SECRET',
      seedRefreshToken: 'REFRESH-1',
      store: held,
      fetch: zalo.fetch,
      warn: () => {},
    });

    expect(await token.get()).toBe('ACCESS-1');
    const call = zalo.calls[0]!;
    expect(call.url).toBe(OA_TOKEN_URL);
    expect(call.headers['secret_key']).toBe('APP-SECRET');
    const sent = new URLSearchParams(call.body);
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('refresh_token')).toBe('REFRESH-1');
    expect(sent.get('app_id')).toBe('3849367142822243338');

    /**
     * The rotated refresh token is on disk, which is the whole point: Zalo's
     * refresh token is single-use, so the seed in the environment is dead from
     * here on and a restart that re-read it would present a spent token.
     */
    const written = JSON.parse(readFileSync(path, 'utf8')) as { refreshToken: string; accessToken: string };
    expect(written.refreshToken).toBe('REFRESH-2');
    expect(written.accessToken).toBe('ACCESS-1');

    // And the second read is cached: 25 hours is not spent on every send.
    expect(await token.get()).toBe('ACCESS-1');
    expect(zalo.calls).toHaveLength(1);
  });

  it('shares one refresh between concurrent callers, because the token is single-use', async () => {
    const { store: held } = store();
    const zalo = recorder([issued('ACCESS-1', 'REFRESH-2'), issued('ACCESS-2', 'REFRESH-3')]);
    const token = oaToken({
      appId: 'app',
      appSecret: 'secret',
      seedRefreshToken: 'REFRESH-1',
      store: held,
      fetch: zalo.fetch,
      warn: () => {},
    });

    const [a, b, c] = await Promise.all([token.get(), token.get(), token.get()]);
    expect([a, b, c]).toEqual(['ACCESS-1', 'ACCESS-1', 'ACCESS-1']);
    // One refresh, not three. Three would have presented a spent token twice
    // and broken the chain for good.
    expect(zalo.calls).toHaveLength(1);
  });

  it('refreshes ahead of the expiry rather than on it', async () => {
    const { path, store: held } = store();
    const zalo = recorder([issued('ACCESS-2', 'REFRESH-3')]);
    let clock = 1_700_000_000_000;
    // Stored, valid, but inside the skew — Zalo's clock decides, not ours.
    writeFileSync(
      path,
      JSON.stringify({
        accessToken: 'ACCESS-1',
        refreshToken: 'REFRESH-2',
        expiresAtMs: clock + OA_REFRESH_SKEW_MS - 1,
      }),
    );
    const token = oaToken({
      appId: 'app',
      appSecret: 'secret',
      store: held,
      fetch: zalo.fetch,
      now: () => clock,
      warn: () => {},
    });
    expect(await token.get()).toBe('ACCESS-2');

    // Outside the skew, the stored one is used untouched.
    const fresh = store();
    writeFileSync(
      fresh.path,
      JSON.stringify({
        accessToken: 'ACCESS-9',
        refreshToken: 'REFRESH-9',
        expiresAtMs: clock + OA_REFRESH_SKEW_MS + 1,
      }),
    );
    const quiet = recorder([]);
    const calm = oaToken({
      appId: 'app',
      appSecret: 'secret',
      store: fresh.store,
      fetch: quiet.fetch,
      now: () => clock,
      warn: () => {},
    });
    expect(await calm.get()).toBe('ACCESS-9');
    expect(quiet.calls).toHaveLength(0);
  });

  /**
   * The mode on `writeFileSync` applies only when the file is CREATED, which
   * the audit of `e4bf1fb` found (F5). The first refresh token arrives by an
   * operator seeding this file by hand, so the common case is a file that
   * already exists at whatever their umask gave — usually 0644 — holding a
   * live rotating credential, and it stayed 0644 through every rotation.
   *
   * POSIX only. Windows `chmod` toggles a read-only bit and nothing else, so
   * the assertion would be meaningless there rather than failing usefully.
   */
  it.skipIf(process.platform === 'win32')(
    'tightens a pre-seeded 0644 token file to 0600 on every write, not only the first',
    async () => {
      const { path, store: held } = store();
      writeFileSync(path, JSON.stringify({ refreshToken: 'REFRESH-1' }), { mode: 0o644 });
      chmodSync(path, 0o644);
      expect(statSync(path).mode & 0o777).toBe(0o644);

      const zalo = recorder([issued('ACCESS-1', 'REFRESH-2')]);
      const token = oaToken({
        appId: 'app',
        appSecret: 'secret',
        store: held,
        fetch: zalo.fetch,
        warn: () => {},
      });
      expect(await token.get()).toBe('ACCESS-1');
      expect(statSync(path).mode & 0o777).toBe(0o600);
    },
  );

  it('is loud when the chain is broken, because only a person can mend it', async () => {
    const { store: held } = store();
    const zalo = recorder([{ body: { error: -14005, error_name: 'Invalid oauthorized code' } }]);
    const lines: string[] = [];
    const token = oaToken({
      appId: 'app',
      appSecret: 'secret',
      seedRefreshToken: 'REFRESH-1',
      store: held,
      fetch: zalo.fetch,
      warn: (line) => lines.push(line),
    });
    await expect(token.get()).rejects.toThrow(/refresh failed/);
    expect(lines.join(' ')).toContain('re-authorize');
  });

  it('says what is missing when there is nothing to refresh with', async () => {
    const { store: held } = store();
    const token = oaToken({ appId: 'app', appSecret: 'secret', store: held, fetch: recorder([]).fetch });
    await expect(token.get()).rejects.toThrow(/PLAYERONE_ZNS_REFRESH_TOKEN/);
  });
});

// ---------------------------------------------------------------------------

describe('a ZNS send on a refreshable token', () => {
  it('retries -124 once with a fresh token, and only once', async () => {
    const zalo = recorder([
      // The send, on a token Zalo has already retired.
      { body: { error: -124, message: 'Access token invalid' } },
      // The refresh.
      { body: { access_token: 'ACCESS-2', refresh_token: 'REFRESH-3', expires_in: '90000' } },
      // The retry.
      { body: { error: 0, message: 'Success' } },
    ]);
    const path = join(mkdtempSync(join(tmpdir(), 'po-zns-')), 'token.json');
    writeFileSync(
      path,
      JSON.stringify({ accessToken: 'ACCESS-1', refreshToken: 'REFRESH-2', expiresAtMs: Date.now() + 86_400_000 }),
    );
    const token = oaToken({
      appId: 'app',
      appSecret: 'secret',
      store: fileTokenStore(path, () => {}),
      fetch: zalo.fetch,
      warn: () => {},
    });

    await znsSender({ accessToken: token, templateId: 'tpl', fetch: zalo.fetch, warn: () => {} })(PHONE, CODE);

    expect(zalo.calls.map((c) => c.url)).toEqual([
      `https://business.openapi.zalo.me${ZNS_SEND_PATH}`,
      OA_TOKEN_URL,
      `https://business.openapi.zalo.me${ZNS_SEND_PATH}`,
    ]);
    expect(zalo.calls[0]!.headers['access_token']).toBe('ACCESS-1');
    expect(zalo.calls[2]!.headers['access_token']).toBe('ACCESS-2');
  });

  it('gives up after the second -124, rather than spending the chain in a loop', async () => {
    const zalo = recorder([
      { body: { error: -124 } },
      { body: { access_token: 'ACCESS-2', refresh_token: 'REFRESH-3', expires_in: '90000' } },
      { body: { error: -124 } },
    ]);
    const path = join(mkdtempSync(join(tmpdir(), 'po-zns-')), 'token.json');
    writeFileSync(
      path,
      JSON.stringify({ accessToken: 'ACCESS-1', refreshToken: 'REFRESH-2', expiresAtMs: Date.now() + 86_400_000 }),
    );
    const token = oaToken({
      appId: 'app',
      appSecret: 'secret',
      store: fileTokenStore(path, () => {}),
      fetch: zalo.fetch,
      warn: () => {},
    });
    const err = await refusalOf<ZnsDeliveryError>(() =>
      znsSender({ accessToken: token, templateId: 'tpl', fetch: zalo.fetch, warn: () => {} })(PHONE, CODE),
    );
    expect(err.refusal).toBe('zns_credentials_rejected');
    expect(zalo.calls).toHaveLength(3);
  });

  /**
   * `PLAYERONE_ZNS_ENV=sandbox` has to actually be a sandbox.
   *
   * Codex found that the environment was read for the boot checks and then
   * never reached the request, so a credentialed sandbox deployment ran every
   * send as PRODUCTION: real money off the ZBS balance and a real message to a
   * real collector, which is the opposite of what the word promises whoever
   * set it. Zalo documents no separate sandbox endpoint — the only sandbox is
   * `mode: "development"` on the same request.
   */
  it('sends mode=development on sandbox, and no mode at all on production', async () => {
    for (const [zenv, expected] of [
      ['sandbox', 'development'],
      ['production', undefined],
    ] as const) {
      const zalo = recorder([{ body: { error: 0, message: 'Success' } }]);
      const send = signInCodeSenderFromEnv({
        PLAYERONE_SIGN_IN_CHANNEL: 'zns',
        PLAYERONE_ZNS_ENV: zenv,
        PLAYERONE_ZNS_ACCESS_TOKEN: 'token',
        PLAYERONE_ZNS_TEMPLATE_ID: 'tpl',
        PLAYERONE_ZNS_BASE_URL: 'https://business.openapi.zalo.me',
      });
      // The env reader builds the real sender, so the fetch is swapped in only
      // to read the body it would have sent.
      const direct = znsSender({
        accessToken: 'token',
        templateId: 'tpl',
        env: zenv,
        fetch: zalo.fetch,
        warn: () => {},
      });
      expect(typeof send).toBe('function');
      await direct(PHONE, CODE);
      const body = JSON.parse(zalo.calls[0]!.body) as { mode?: string; template_data: unknown };
      expect(body.mode, zenv).toBe(expected);
      // And the rest of the request is unchanged either way.
      expect(body.template_data).toEqual({ otp: CODE });
    }
  });

  it('does not retry a static token, because there is nothing to refresh', async () => {
    const zalo = recorder([{ body: { error: -124 } }]);
    const err = await refusalOf<ZnsDeliveryError>(() =>
      znsSender({ accessToken: 'ACCESS-1', templateId: 'tpl', fetch: zalo.fetch, warn: () => {} })(PHONE, CODE),
    );
    expect(err.refusal).toBe('zns_credentials_rejected');
    expect(zalo.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('PLAYERONE_SIGN_IN_CHANNEL', () => {
  /**
   * The log sender writes one line and nothing else; this is how it is told
   * apart.
   *
   * It takes a FACTORY and not a sender, because `devLogSender`'s default
   * argument is `console.warn` evaluated when it is constructed — a spy
   * installed after the sender was built is a spy the sender never sees. That
   * is also true of a real deployment: the log sender captures whatever
   * `console.warn` was at boot.
   */
  const isDevLog = async (build: () => ReturnType<typeof devLogSender>) => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await build()(PHONE, CODE);
      return spy.mock.calls.flat().join(' ').includes('NOT SENT');
    } finally {
      spy.mockRestore();
    }
  };

  it('changes nothing when it is unset', async () => {
    // Today's behaviour, and the default stays today's behaviour: sandbox with
    // no ZNS credentials is the development sender, not a crash.
    expect(await isDevLog(() => signInCodeSenderFromEnv({}))).toBe(true);
    expect(await isDevLog(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_ENV: 'sandbox' }))).toBe(true);
    // And a partial configuration still fails closed, naming what is missing.
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_TEMPLATE_ID: 'tpl' })).toThrow(
      /PLAYERONE_ZNS_ACCESS_TOKEN/,
    );
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_ZNS_ENV: 'production' })).toThrow(/production/);
  });

  it('names the three it accepts and refuses anything else', () => {
    expect([...SIGN_IN_CHANNELS]).toEqual(['zns', 'sms', 'log']);
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_SIGN_IN_CHANNEL: 'zalo' })).toThrow(
      /must be zns, sms, log/,
    );
  });

  it('gives the log sender on `log`, whatever else is configured', async () => {
    expect(
      await isDevLog(() =>
        signInCodeSenderFromEnv({
          PLAYERONE_SIGN_IN_CHANNEL: 'log',
          PLAYERONE_ZNS_ACCESS_TOKEN: 'token',
          PLAYERONE_ZNS_TEMPLATE_ID: 'tpl',
        }),
      ),
    ).toBe(true);
  });

  it('fails closed on a named channel with no credentials, rather than logging codes', () => {
    /**
     * The difference from the unset default, and the point of naming a channel:
     * asking for `sms` and silently getting a log writer is a deployment that
     * looks configured and delivers nothing.
     */
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_SIGN_IN_CHANNEL: 'sms' })).toThrow(
      /PLAYERONE_SMS_API_KEY, PLAYERONE_SMS_SECRET_KEY, PLAYERONE_SMS_BRANDNAME/,
    );
    expect(() => signInCodeSenderFromEnv({ PLAYERONE_SIGN_IN_CHANNEL: 'zns' })).toThrow(
      /PLAYERONE_ZNS_ACCESS_TOKEN/,
    );
  });

  it('builds a real SMS sender when the channel and its credentials are both set', async () => {
    const zalo = recorder([{ body: { CodeResult: SMS_ACCEPTED } }]);
    // The base URL is the seam a test uses instead of the network; the sender
    // itself is the one `signInCodeSenderFromEnv` chose.
    const send = signInCodeSenderFromEnv({
      PLAYERONE_SIGN_IN_CHANNEL: 'sms',
      PLAYERONE_SMS_API_KEY: 'k',
      PLAYERONE_SMS_SECRET_KEY: 's',
      PLAYERONE_SMS_BRANDNAME: 'PLAYERONE',
      PLAYERONE_SMS_BASE_URL: 'http://127.0.0.1:1',
    });
    // It reaches the configured base URL, which no fixture is listening on, so
    // the refusal proves which sender was built without a network round trip.
    const err = await refusalOf<SmsDeliveryError>(() => send(PHONE, CODE));
    expect(err).toBeInstanceOf(SmsDeliveryError);
    expect(zalo.calls).toHaveLength(0);
  });

  it('demands the app credentials and a token file when a refresh token is set', () => {
    expect(() =>
      signInCodeSenderFromEnv({
        PLAYERONE_SIGN_IN_CHANNEL: 'zns',
        PLAYERONE_ZNS_TEMPLATE_ID: 'tpl',
        PLAYERONE_ZNS_REFRESH_TOKEN: 'REFRESH-1',
      }),
    ).toThrow(/PLAYERONE_ZALO_APP_ID, PLAYERONE_ZALO_APP_SECRET, PLAYERONE_ZNS_TOKEN_FILE/);
  });

  it('accepts a refresh token INSTEAD of a static access token', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'po-zns-')), 'token.json');
    expect(() =>
      signInCodeSenderFromEnv({
        PLAYERONE_SIGN_IN_CHANNEL: 'zns',
        PLAYERONE_ZNS_TEMPLATE_ID: 'tpl',
        PLAYERONE_ZNS_REFRESH_TOKEN: 'REFRESH-1',
        PLAYERONE_ZALO_APP_ID: 'app',
        PLAYERONE_ZALO_APP_SECRET: 'secret',
        PLAYERONE_ZNS_TOKEN_FILE: path,
      }),
    ).not.toThrow();
  });
});
