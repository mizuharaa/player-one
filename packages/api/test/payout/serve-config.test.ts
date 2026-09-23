import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PayoutOptions } from '../../src/payout/domain/config.ts';

const boot = vi.hoisted(() => ({ payout: undefined as PayoutOptions | undefined }));
vi.mock('@playerone/store', () => ({ open: async () => ({ close: async () => {} }), redact: () => 'test' }));
vi.mock('../../src/index.ts', async () => {
  const { payoutOptionsFromEnv, assertPayoutBootInvariants } = await import('../../src/payout/domain/config.ts');
  return {
    payoutOptionsFromEnv,
    buildApi: (options: { payout: PayoutOptions }) => {
      assertPayoutBootInvariants(options.payout);
      boot.payout = options.payout;
      return { listen: async () => {}, close: async () => {} };
    },
    s3StoreFromEnv: () => null,
    signInCodeSenderFromEnv: () => undefined,
    zaloLoginFromEnv: () => null,
    startHeartbeat: () => () => {},
  };
});

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
beforeEach(() => {
  vi.resetModules();
  boot.payout = undefined;
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('PLAYERONE_') || name === 'REVIEW_VERIFICATION_GATE') vi.stubEnv(name, undefined);
  }
  vi.stubEnv('DATABASE_URL', 'postgres://unused@127.0.0.1:1/unused');
  vi.stubEnv('PLAYERONE_TOKEN_SECRET', 'test-only');
  vi.stubEnv('PLAYERONE_ZALOPAY_APP_ID', '1');
  vi.stubEnv('PLAYERONE_ZALOPAY_PAYMENT_ID', 'test-payment');
  vi.stubEnv('PLAYERONE_ZALOPAY_KEY1', 'test-key');
  vi.stubEnv('PLAYERONE_ZALOPAY_PUBLIC_KEY', publicKey.export({ type: 'spki', format: 'pem' }).toString());
  vi.spyOn(process, 'on').mockReturnValue(process);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ return_code: 1, data: { m_u_id: 'test-wallet' } }))));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(['sandbox', 'production'])('manual %s boots without Merchant Wallet and cannot transfer or read balance', async environment => {
  vi.stubEnv('PLAYERONE_ZALOPAY_ENV', environment);
  await import('../../bin/serve.ts');
  const client = boot.payout!.client!;
  await expect(client.balance()).rejects.toThrow(/verification-only/);
  await expect(client.transferFund({ partnerOrderId: 'test', receiver: { method: 'WALLET', mUId: 'test' }, amountVnd: 1, description: 'test' })).rejects.toThrow(/verification-only/);
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.verifyAccount({ receiver: { method: 'WALLET', phone: '0901234567' }, amountVnd: 1 })).resolves.toMatchObject({ kind: 'verified', verifiedName: null });
});

it('manual without any credentials still boots without a client', async () => {
  for (const key of ['APP_ID', 'PAYMENT_ID', 'KEY1', 'PUBLIC_KEY']) vi.stubEnv(`PLAYERONE_ZALOPAY_${key}`, undefined);
  await import('../../bin/serve.ts');
  expect(boot.payout?.client).toBeUndefined();
});

it('partial credentials still refuse startup', async () => {
  vi.stubEnv('PLAYERONE_ZALOPAY_KEY1', undefined);
  await expect(import('../../bin/serve.ts')).rejects.toThrow(/KEY1/);
});

it.each(['manual', 'api'])('%s with Merchant Wallet retains balance access', async mode => {
  vi.stubEnv('PLAYERONE_PAYOUT_MODE', mode);
  vi.stubEnv('PLAYERONE_ZALOPAY_ENV', 'production');
  vi.stubEnv('PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID', 'test-merchant');
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ return_code: 1, data: { balance: 7 } })));
  await import('../../bin/serve.ts');
  await expect(boot.payout!.client!.balance()).resolves.toEqual({ balanceVnd: 7 });
});

it.each(['sandbox', 'production'])('API %s cannot silently become verification-only', async environment => {
  vi.stubEnv('PLAYERONE_PAYOUT_MODE', 'api');
  vi.stubEnv('PLAYERONE_ZALOPAY_ENV', environment);
  await expect(import('../../bin/serve.ts')).rejects.toThrow(/MERCHANT_WALLET_ID/);
});

it('API sandbox still refuses even with Merchant Wallet', async () => {
  vi.stubEnv('PLAYERONE_PAYOUT_MODE', 'api');
  vi.stubEnv('PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID', 'test-merchant');
  await expect(import('../../bin/serve.ts')).rejects.toThrow(/sandbox/);
});
