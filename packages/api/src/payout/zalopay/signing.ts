import { createHmac, sign as rsaSignBytes } from 'node:crypto';

/**
 * Request signing for ZaloPay Disbursement (§0.3 of the payout brief).
 *
 * One builder per endpoint, each returning the mac parts IN THE ORDER THE SPEC
 * LISTS THEM, and nothing generic. The orderings genuinely differ — verify puts
 * `disbursement_type` second, transfer puts `payment_id` second — and a
 * builder that takes a field list makes a wrong order look like a right one.
 * Here a wrong order is a wrong function, and the pinned vectors in
 * `test/payout/zalopay/fixtures.ts` catch a swap.
 *
 * Two schemes exist because two contracts exist (escalation §0.7 item 1):
 *
 *   All-in-One Disbursement   mac = HMAC_SHA256(key1, parts.join('|'))
 *   Legacy topup              sig = RSA_sign(privateKey, HMAC_SHA256(key1, ...))
 *
 * Both are here. Only the first is wired into `client.ts`.
 */

/** The separator every mac input uses. Exported so the fake server can rebuild inputs. */
export const MAC_SEPARATOR = '|';

/** `parts.join('|')`, HMAC-SHA256 with `key1`, lowercase hex. */
export function hmac(macKey: string, parts: readonly string[]): string {
  return createHmac('sha256', macKey).update(macInput(parts), 'utf8').digest('hex');
}

/** The exact string that gets signed. Pinned in fixtures beside its mac. */
export function macInput(parts: readonly string[]): string {
  return parts.join(MAC_SEPARATOR);
}

/**
 * Legacy topup only. ZaloPay's sample uses `node-rsa` with a pkcs8 private key,
 * signing the hex mac string AS UTF-8 TEXT (not the digest bytes), output
 * base64. `node-rsa`'s default signing scheme is `pkcs1-sha256`, which is what
 * `node:crypto`'s `sign('sha256', …)` produces for an RSA key — deterministic,
 * so a vector can be pinned.
 *
 * Exported, tested, NOT wired: see `SigningScheme` in `types.ts`.
 */
export function rsaSign(privateKeyPkcs8Pem: string, macHex: string): string {
  return rsaSignBytes('sha256', Buffer.from(macHex, 'utf8'), privateKeyPkcs8Pem).toString('base64');
}

/** The legacy scheme end to end: HMAC first, then RSA over the hex. Unwired. */
export function legacySignature(
  macKey: string,
  privateKeyPkcs8Pem: string,
  parts: readonly string[],
): string {
  return rsaSign(privateKeyPkcs8Pem, hmac(macKey, parts));
}

// ---------------------------------------------------------------------------
// Per-endpoint mac inputs. One function each. The argument names are the wire
// field names so the order in the object literal at the call site reads the
// same as the spec line quoted above each builder.

/** The decimal text of a number, the only rendering the mac accepts. */
const dec = (n: number): string => {
  if (!Number.isSafeInteger(n)) throw new TypeError(`mac field must be a safe integer, got ${n}`);
  return String(n);
};

/**
 * transfer-fund (§0.3):
 *   app_id|payment_id|partner_order_id|disbursement_type|receiver_info(encrypted)|
 *   amount|description|partner_embed_data|extra_info|time
 */
export function transferFundMacParts(f: {
  app_id: number;
  payment_id: string;
  partner_order_id: string;
  disbursement_type: string;
  /** Already encrypted and base64'd — the same string the body carries. */
  receiver_info: string;
  amount: number;
  description: string;
  partner_embed_data: string;
  extra_info: string;
  time: number;
}): string[] {
  return [
    dec(f.app_id),
    f.payment_id,
    f.partner_order_id,
    f.disbursement_type,
    f.receiver_info,
    dec(f.amount),
    f.description,
    f.partner_embed_data,
    f.extra_info,
    dec(f.time),
  ];
}

/** verify-account (§0.3): app_id|disbursement_type|receiver_info|amount|time */
export function verifyAccountMacParts(f: {
  app_id: number;
  disbursement_type: string;
  receiver_info: string;
  amount: number;
  time: number;
}): string[] {
  return [dec(f.app_id), f.disbursement_type, f.receiver_info, dec(f.amount), dec(f.time)];
}

/** query-txn (§0.3): app_id|partner_order_id|time */
export function queryTxnMacParts(f: { app_id: number; partner_order_id: string; time: number }): string[] {
  return [dec(f.app_id), f.partner_order_id, dec(f.time)];
}

/** balance (§0.3): app_id|payment_id|time */
export function balanceMacParts(f: { app_id: number; payment_id: string; time: number }): string[] {
  return [dec(f.app_id), f.payment_id, dec(f.time)];
}

/** get-bank-code (§0.3): app_id|time */
export function bankCodesMacParts(f: { app_id: number; time: number }): string[] {
  return [dec(f.app_id), dec(f.time)];
}

/**
 * query-user (§0.3, older topup flow): app_id|phone|time. Not one of the five
 * disbursement endpoints and not in the client; here so the legacy scheme is
 * complete if the contract turns out to be that one.
 */
export function queryUserMacParts(f: { app_id: number; phone: string; time: number }): string[] {
  return [dec(f.app_id), f.phone, dec(f.time)];
}
