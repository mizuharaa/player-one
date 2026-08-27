import { createHmac, verify as rsaVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  balanceMacParts,
  bankCodesMacParts,
  hmac,
  legacySignature,
  macInput,
  queryTxnMacParts,
  queryUserMacParts,
  rsaSign,
  transferFundMacParts,
  verifyAccountMacParts,
} from '../../../src/payout/zalopay/signing.ts';
import { KEY1, LEGACY_SIGNATURE, TEST_RSA, VECTORS } from './fixtures.ts';

/**
 * Signing (§0.3). Pure functions, no network, no database — these run in the
 * `env -u DATABASE_URL` configuration.
 *
 * The vectors are pinned in `fixtures.ts`; read its header for what they do
 * and do not prove.
 */

describe('hmac', () => {
  it('joins with "|", HMAC-SHA256s with key1, and answers lowercase hex', () => {
    const parts = ['2553', 'x', '1756200000000'];
    const expected = createHmac('sha256', KEY1).update('2553|x|1756200000000').digest('hex');
    expect(hmac(KEY1, parts)).toBe(expected);
    expect(hmac(KEY1, parts)).toMatch(/^[0-9a-f]{64}$/);
    expect(macInput(parts)).toBe('2553|x|1756200000000');
  });

  it('is keyed: a different key1 is a different mac over the same input', () => {
    expect(hmac('key1-A', ['a', 'b'])).not.toBe(hmac('key1-B', ['a', 'b']));
  });
});

describe('the per-endpoint mac inputs reproduce the pinned vectors', () => {
  it('transfer-fund, wallet', () => {
    const v = VECTORS.transferFundWallet;
    expect(macInput(transferFundMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, transferFundMacParts(v.fields))).toBe(v.mac);
  });

  it('transfer-fund, bank account', () => {
    const v = VECTORS.transferFundBankAccount;
    expect(macInput(transferFundMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, transferFundMacParts(v.fields))).toBe(v.mac);
  });

  it('transfer-fund, bank card (with non-empty partner_embed_data)', () => {
    const v = VECTORS.transferFundBankCard;
    expect(macInput(transferFundMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, transferFundMacParts(v.fields))).toBe(v.mac);
  });

  it('verify-account', () => {
    const v = VECTORS.verifyAccountWallet;
    expect(macInput(verifyAccountMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, verifyAccountMacParts(v.fields))).toBe(v.mac);
  });

  it('query-txn', () => {
    const v = VECTORS.queryTxn;
    expect(macInput(queryTxnMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, queryTxnMacParts(v.fields))).toBe(v.mac);
  });

  it('balance', () => {
    const v = VECTORS.balance;
    expect(macInput(balanceMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, balanceMacParts(v.fields))).toBe(v.mac);
  });

  it('get-bank-code', () => {
    const v = VECTORS.bankCodes;
    expect(macInput(bankCodesMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, bankCodesMacParts(v.fields))).toBe(v.mac);
  });

  it('query-user (legacy topup, unwired)', () => {
    const v = VECTORS.queryUser;
    expect(macInput(queryUserMacParts(v.fields))).toBe(v.macInput);
    expect(hmac(KEY1, queryUserMacParts(v.fields))).toBe(v.mac);
  });
});

describe('the orderings are the spec orderings, field by field', () => {
  // The reason there is one builder per endpoint: a swap must be a different
  // mac, and these spell out where each field sits so a reader can check them
  // against §0.3 without running anything.
  it('transfer-fund: app_id|payment_id|partner_order_id|disbursement_type|receiver_info|amount|description|partner_embed_data|extra_info|time', () => {
    const parts = transferFundMacParts(VECTORS.transferFundWallet.fields);
    expect(parts).toEqual([
      '2553',
      'PM-001',
      'PO-6f1c2d3e-0001',
      'WALLET',
      VECTORS.transferFundWallet.fields.receiver_info,
      '1500000',
      'Player One 2026-08 payout',
      '{}',
      '{}',
      '1756200000000',
    ]);
  });

  it('verify-account: app_id|disbursement_type|receiver_info|amount|time (disbursement_type second, not payment_id)', () => {
    expect(verifyAccountMacParts(VECTORS.verifyAccountWallet.fields)).toEqual([
      '2553',
      'WALLET',
      VECTORS.verifyAccountWallet.fields.receiver_info,
      '1',
      '1756200000003',
    ]);
  });

  it('query-txn: app_id|partner_order_id|time', () => {
    expect(queryTxnMacParts(VECTORS.queryTxn.fields)).toEqual(['2553', 'PO-6f1c2d3e-0001', '1756200000004']);
  });

  it('balance: app_id|payment_id|time', () => {
    expect(balanceMacParts(VECTORS.balance.fields)).toEqual(['2553', 'PM-001', '1756200000005']);
  });

  it('get-bank-code: app_id|time', () => {
    expect(bankCodesMacParts(VECTORS.bankCodes.fields)).toEqual(['2553', '1756200000006']);
  });

  it('the mac covers the ENCRYPTED receiver_info: a different ciphertext is a different mac', () => {
    const a = transferFundMacParts(VECTORS.transferFundWallet.fields);
    const b = transferFundMacParts({ ...VECTORS.transferFundWallet.fields, receiver_info: 'Zm9v' });
    expect(hmac(KEY1, a)).not.toBe(hmac(KEY1, b));
  });

  it('"{}" and "" are different inputs, which is why the default is "{}" and not omission', () => {
    const withBraces = transferFundMacParts(VECTORS.transferFundWallet.fields);
    const empty = transferFundMacParts({ ...VECTORS.transferFundWallet.fields, extra_info: '' });
    expect(hmac(KEY1, withBraces)).not.toBe(hmac(KEY1, empty));
    expect(macInput(empty)).toMatch(/\|\{\}\|\|1756200000000$/);
  });

  it('refuses a non-integer where the spec wants a decimal integer', () => {
    expect(() => balanceMacParts({ app_id: 2553.5, payment_id: 'x', time: 1 })).toThrow(/safe integer/);
    expect(() =>
      transferFundMacParts({ ...VECTORS.transferFundWallet.fields, amount: 1500000.4 }),
    ).toThrow(/safe integer/);
  });
});

describe('rsaSign (legacy topup, built and exported, not wired)', () => {
  it('reproduces the pinned signature: UTF-8 of the hex mac, PKCS#1 v1.5 / SHA-256, base64', () => {
    expect(rsaSign(TEST_RSA.privateKeyPkcs8Pem, LEGACY_SIGNATURE.macHex)).toBe(LEGACY_SIGNATURE.signatureBase64);
  });

  it('verifies with the public half over the UTF-8 bytes of the hex string, not the digest bytes', () => {
    const sig = Buffer.from(LEGACY_SIGNATURE.signatureBase64, 'base64');
    const asText = Buffer.from(LEGACY_SIGNATURE.macHex, 'utf8');
    const asBytes = Buffer.from(LEGACY_SIGNATURE.macHex, 'hex');
    expect(rsaVerify('sha256', asText, TEST_RSA.publicKeySpkiPem, sig)).toBe(true);
    expect(rsaVerify('sha256', asBytes, TEST_RSA.publicKeySpkiPem, sig)).toBe(false);
  });

  it('composes: legacySignature = rsaSign(priv, hmac(key1, parts))', () => {
    const parts = queryUserMacParts(VECTORS.queryUser.fields);
    expect(legacySignature(KEY1, TEST_RSA.privateKeyPkcs8Pem, parts)).toBe(LEGACY_SIGNATURE.signatureBase64);
  });
});
