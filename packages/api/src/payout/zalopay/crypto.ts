import { constants, privateDecrypt, publicEncrypt } from 'node:crypto';
import type { RsaPadding } from './types.ts';

/**
 * `receiver_info` (§0.4): the recipient JSON, RSA-encrypted with ZaloPay's
 * public key, base64'd, and then placed in the request body AND in the mac
 * input — the mac covers the ciphertext, not the plaintext.
 *
 * RSA encryption is randomised under every padding in use: encrypting the same
 * payload twice yields two different ciphertexts, both valid. So the one rule
 * of this file is ENCRYPT ONCE and carry the same string to both places. A
 * client that encrypts for the body and again for the mac produces a request
 * ZaloPay decrypts fine and then rejects with -402, and nothing in the
 * response says why. `client.ts` calls this once per request;
 * `test/payout/zalopay/crypto.test.ts` proves that the string in the body is
 * byte-identical to the string that was signed.
 *
 * Padding: the brief says "RSA encrypt" and the PDF was not on this machine to
 * say which. ZaloPay's Java and PHP samples use PKCS#1 v1.5
 * (`RSA/ECB/PKCS1Padding`, `openssl_public_encrypt` default), so that is the
 * default; OAEP (node-rsa's default) is a config flip away. Wrong padding is a
 * -402 on the first sandbox call, not a silent failure. Listed in
 * `WIRE_NAMES_TO_CONFIRM`.
 *
 * `node:crypto` does this natively — no `node-rsa` dependency.
 */

const PADDING: Readonly<Record<RsaPadding, number>> = {
  pkcs1: constants.RSA_PKCS1_PADDING,
  oaep: constants.RSA_PKCS1_OAEP_PADDING,
};

export function encryptReceiverInfo(
  publicKeyPem: string,
  payload: object,
  padding: RsaPadding = 'pkcs1',
): string {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  return publicEncrypt({ key: publicKeyPem, padding: PADDING[padding] }, plaintext).toString('base64');
}

/**
 * The inverse, for the fake server (which holds the matching private key) and
 * for tests. Production code never has ZaloPay's private key and never calls
 * this.
 */
export function decryptReceiverInfo<T = unknown>(
  privateKeyPem: string,
  ciphertextBase64: string,
  padding: RsaPadding = 'pkcs1',
): T {
  const plaintext = privateDecrypt(
    { key: privateKeyPem, padding: PADDING[padding] },
    Buffer.from(ciphertextBase64, 'base64'),
  );
  return JSON.parse(plaintext.toString('utf8')) as T;
}
