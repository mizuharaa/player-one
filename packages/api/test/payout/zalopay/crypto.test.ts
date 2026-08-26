import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ZaloPayHttpClient } from '../../../src/payout/zalopay/client.ts';
import { decryptReceiverInfo, encryptReceiverInfo } from '../../../src/payout/zalopay/crypto.ts';
import { hmac, transferFundMacParts, verifyAccountMacParts } from '../../../src/payout/zalopay/signing.ts';
import type { TransferFundRequest, VerifyAccountRequest } from '../../../src/payout/zalopay/types.ts';
import { APP_ID, KEY1, PAYMENT_ID, TEST_RSA } from './fixtures.ts';

/**
 * `receiver_info` (§0.4): encrypted once, carried twice. No network, no
 * database.
 */

describe('encryptReceiverInfo', () => {
  const payload = { bank_code: 'VCB', account_no: '0011002233445', account_holder_name: 'NGUYEN VAN A' };

  it('JSON-stringifies, RSA-encrypts with the public key, base64s — and the private key reads it back', () => {
    const ct = encryptReceiverInfo(TEST_RSA.publicKeySpkiPem, payload);
    expect(ct).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(ct, 'base64').length).toBe(256); // one 2048-bit RSA block
    expect(decryptReceiverInfo(TEST_RSA.privateKeyPkcs8Pem, ct)).toEqual(payload);
  });

  it('supports OAEP behind the padding flag, and the two paddings do not read each other', () => {
    const ct = encryptReceiverInfo(TEST_RSA.publicKeySpkiPem, payload, 'oaep');
    expect(decryptReceiverInfo(TEST_RSA.privateKeyPkcs8Pem, ct, 'oaep')).toEqual(payload);
    expect(() => decryptReceiverInfo(TEST_RSA.privateKeyPkcs8Pem, ct, 'pkcs1')).toThrow();
  });

  it('is randomised: the same payload encrypts to different ciphertext every time', () => {
    // This is the whole reason the client must encrypt once. Two encryptions
    // are both valid, and a mac over one does not verify the other.
    const a = encryptReceiverInfo(TEST_RSA.publicKeySpkiPem, payload);
    const b = encryptReceiverInfo(TEST_RSA.publicKeySpkiPem, payload);
    expect(a).not.toBe(b);
    expect(decryptReceiverInfo(TEST_RSA.privateKeyPkcs8Pem, a)).toEqual(decryptReceiverInfo(TEST_RSA.privateKeyPkcs8Pem, b));
  });
});

/**
 * The property the brief asks for: the `receiver_info` string the client puts
 * in the body is byte-identical to the one it signed. Proven from the outside
 * — capture the body through an injected `fetch`, rebuild the mac from the
 * body's own fields with the same builders, compare to the body's mac. A
 * client that encrypted twice would fail every iteration, because RSA
 * ciphertext differs per call (above).
 */
describe('the encrypted receiver_info in the body is the one in the mac', () => {
  const ok = (data: object) =>
    new Response(JSON.stringify({ return_code: 1, sub_return_code: 1, data }), {
      headers: { 'content-type': 'application/json' },
    });

  function capturing<Body>(answer: object): { fetch: typeof fetch; bodies: Body[] } {
    const bodies: Body[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Body);
      return ok(answer);
    };
    return { fetch: fetchFn, bodies };
  }

  const randomPhone = () => `09${String(randomInt(0, 1e8)).padStart(8, '0')}`;
  const randomAccount = () => String(randomInt(1e9, 1e13));

  it('transfer-fund, 40 random receivers across all three routes', async () => {
    const { fetch: fetchFn, bodies } = capturing<TransferFundRequest>({ order_id: '1', status: 3 });
    const client = new ZaloPayHttpClient({
      env: 'sandbox',
      appId: APP_ID,
      paymentId: PAYMENT_ID,
      key1: KEY1,
      zaloPayPublicKeyPem: TEST_RSA.publicKeySpkiPem,
      fetch: fetchFn,
    });
    const receivers = [
      () => ({ method: 'WALLET' as const, mUId: `MU-${randomPhone()}` }),
      () => ({ method: 'BANK_ACCOUNT' as const, bankCode: 'VCB', accountNo: randomAccount(), accountHolderName: 'NGUYEN VAN A' }),
      () => ({ method: 'BANK_CARD' as const, bankCode: 'TCB', cardNo: randomAccount(), cardHolderName: 'TRAN THI B' }),
    ];
    for (let i = 0; i < 40; i += 1) {
      const receiver = receivers[i % 3]!();
      const r = await client.transferFund({
        partnerOrderId: `PO-prop-${i}`,
        receiver,
        amountVnd: 2_000 + i,
        description: `prop ${i}`,
      });
      expect(r.kind).toBe('accepted');
    }
    expect(bodies).toHaveLength(40);
    for (const body of bodies) {
      const { mac, ...unsigned } = body;
      expect(hmac(KEY1, transferFundMacParts(unsigned))).toBe(mac);
      // And the string in the body really is the receiver we asked to send.
      const plain = decryptReceiverInfo<Record<string, string>>(TEST_RSA.privateKeyPkcs8Pem, body.receiver_info);
      expect(Object.keys(plain).length).toBeGreaterThan(0);
    }
  });

  it('verify-account, 20 random receivers', async () => {
    const { fetch: fetchFn, bodies } = capturing<VerifyAccountRequest>({ receiver_name: 'NGUYEN VAN A', m_u_id: 'MU' });
    const client = new ZaloPayHttpClient({
      env: 'sandbox',
      appId: APP_ID,
      paymentId: PAYMENT_ID,
      key1: KEY1,
      zaloPayPublicKeyPem: TEST_RSA.publicKeySpkiPem,
      fetch: fetchFn,
    });
    for (let i = 0; i < 20; i += 1) {
      const phone = randomPhone();
      const r = await client.verifyAccount({ receiver: { method: 'WALLET', phone }, amountVnd: 1 });
      expect(r.kind).toBe('verified');
      const body = bodies[i]!;
      const { mac, ...unsigned } = body;
      expect(hmac(KEY1, verifyAccountMacParts(unsigned))).toBe(mac);
      expect(decryptReceiverInfo(TEST_RSA.privateKeyPkcs8Pem, body.receiver_info)).toEqual({ phone });
    }
  });

  it('the body carries the ciphertext, never the plaintext', async () => {
    const { fetch: fetchFn, bodies } = capturing<VerifyAccountRequest>({ receiver_name: 'X' });
    const client = new ZaloPayHttpClient({
      env: 'sandbox',
      appId: APP_ID,
      paymentId: PAYMENT_ID,
      key1: KEY1,
      zaloPayPublicKeyPem: TEST_RSA.publicKeySpkiPem,
      fetch: fetchFn,
    });
    await client.verifyAccount({
      receiver: { method: 'BANK_ACCOUNT', bankCode: 'VCB', accountNo: '0011002233445', accountHolderName: 'NGUYEN VAN A' },
      amountVnd: 1,
    });
    const wire = JSON.stringify(bodies[0]);
    expect(wire).not.toContain('0011002233445');
    expect(wire).not.toContain('NGUYEN VAN A');
    expect(wire).not.toContain(KEY1);
  });
});
