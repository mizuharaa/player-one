import { describe, expect, it } from 'vitest';
import {
  assertPayoutBootInvariants,
  payoutOptionsFromEnv,
  PRODUCTION_CREDENTIALS,
} from '../../../src/payout/domain/config.ts';

describe('the payout switches', () => {
  it('defaults to manual on sandbox with holds off and no cap', () => {
    const o = payoutOptionsFromEnv({});
    expect(o.mode).toBe('manual');
    expect(o.zaloPayEnv).toBe('sandbox');
    expect(o.holdsEnabled).toBe(false);
    expect(o.capVnd).toBeUndefined();
    expect(() => assertPayoutBootInvariants(o)).not.toThrow();
  });

  it('refuses a live payout path on sandbox credentials', () => {
    expect(() => assertPayoutBootInvariants({ mode: 'api', zaloPayEnv: 'sandbox' })).toThrow(/sandbox/);
    expect(() => assertPayoutBootInvariants(payoutOptionsFromEnv({ PLAYERONE_PAYOUT_MODE: 'api' }))).toThrow(
      /PLAYERONE_ZALOPAY_ENV=sandbox/,
    );
  });

  it('refuses production without every credential, and names the missing ones', () => {
    expect(() => assertPayoutBootInvariants({ zaloPayEnv: 'production' })).toThrow(/appId, paymentId, key1, publicKey/);
    expect(() =>
      assertPayoutBootInvariants({
        zaloPayEnv: 'production',
        credentialsPresent: { appId: true, paymentId: true, key1: true },
      }),
    ).toThrow(/publicKey/);
    const all = Object.fromEntries(PRODUCTION_CREDENTIALS.map((c) => [c, true]));
    expect(() => assertPayoutBootInvariants({ zaloPayEnv: 'production', credentialsPresent: all })).not.toThrow();
    expect(() => assertPayoutBootInvariants({ mode: 'api', zaloPayEnv: 'production', credentialsPresent: all })).not.toThrow();
  });

  it('reads presence, never values, from the environment', () => {
    const o = payoutOptionsFromEnv({
      PLAYERONE_ZALOPAY_ENV: 'production',
      PLAYERONE_ZALOPAY_APP_ID: '2553',
      PLAYERONE_ZALOPAY_PAYMENT_ID: 'p',
      PLAYERONE_ZALOPAY_KEY1: 'k1',
    });
    expect(o.credentialsPresent).toEqual({ appId: true, paymentId: true, key1: true, publicKey: false });
    expect(JSON.stringify(o)).not.toContain('k1');
    expect(() => assertPayoutBootInvariants(o)).toThrow(/publicKey/);
  });

  it('refuses values it does not know', () => {
    expect(() => payoutOptionsFromEnv({ PLAYERONE_PAYOUT_MODE: 'auto' })).toThrow(/PLAYERONE_PAYOUT_MODE/);
    expect(() => payoutOptionsFromEnv({ PLAYERONE_ZALOPAY_ENV: 'prod' })).toThrow(/PLAYERONE_ZALOPAY_ENV/);
    expect(() => payoutOptionsFromEnv({ PLAYERONE_PAYOUT_CAP_VND: '5e6' })).toThrow(/whole number/);
    expect(() => assertPayoutBootInvariants({ capVnd: 0 })).toThrow(/cap/);
    expect(payoutOptionsFromEnv({ PLAYERONE_PAYOUT_CAP_VND: '5000000', PLAYERONE_RISK_HOLD: '1' })).toMatchObject({
      capVnd: 5_000_000,
      holdsEnabled: true,
    });
  });
});
