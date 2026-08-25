import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Passwords and tokens, on `node:crypto` alone.
 *
 * scrypt rather than argon2: argon2 is a native dependency to build on every
 * upload-centre machine, and scrypt is memory-hard, in the standard library,
 * and enough. HMAC-signed tokens rather than a JWT library: the payload is
 * three fields and a expiry, so a library buys parsing of a spec we do not use.
 *
 * ponytail: scrypt at N=2^15. Raise N if a password audit asks for it — the
 * cost parameter is stored in the hash, so old hashes keep verifying.
 */

const scrypt = promisify(scryptCb) as (
  pw: string | Buffer,
  salt: string | Buffer,
  len: number,
) => Promise<Buffer>;

const KEYLEN = 32;

/** `scrypt$<saltHex>$<hashHex>`. */
export async function hashCredential(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(secret, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** False for a malformed or absent hash, never a throw: a bad row must not be a 500. */
export async function verifyCredential(secret: string, stored: string | null): Promise<boolean> {
  if (stored === null) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  const actual = await scrypt(secret, Buffer.from(saltHex, 'hex'), KEYLEN);
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Tokens

export type MachineClaims = { kind: 'machine'; uploadDeviceId: string; uploadCentreId: string };
export type OperatorClaims = { kind: 'operator'; operatorId: string; uploadCentreId: string };
/**
 * PLT-10. A third kind rather than a flag on `OperatorClaims`, for one reason:
 * a reviewer has no upload centre, and every counter route in this service
 * reads `uploadCentreId` off the operator token to scope its query. Making that
 * field optional would turn eight scoping expressions into `string | undefined`
 * and the compiler would ask each of them what to do about a missing centre —
 * which is exactly the wrong question, because those routes are unreachable
 * with this token. A separate kind makes them unreachable to the *type* too.
 *
 * `reviewerId` is an `operators.id`, so `audit_events.operator_id` keeps its
 * foreign key and `episode_reviews.reviewer_ref` keeps holding one kind of value.
 */
export type ReviewerClaims = { kind: 'reviewer'; reviewerId: string };
export type Claims = MachineClaims | OperatorClaims | ReviewerClaims;

/**
 * The centre is baked into both tokens at issue time and is never taken from the
 * request. That is what makes BO-11 / SEC-02 server-side rather than advisory:
 * a caller cannot name a centre it was not issued for.
 */
const TOKEN_TTL_S = 12 * 60 * 60; // one shift

export function signToken(secret: string, claims: Claims, nowS = Math.floor(Date.now() / 1e3)): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: nowS + TOKEN_TTL_S })).toString(
    'base64url',
  );
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** Null on any failure — bad shape, bad signature, expired. The caller gets 401, not a reason. */
export function verifyToken(
  secret: string,
  token: string | undefined,
  nowS = Math.floor(Date.now() / 1e3),
): Claims | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  // Compare as bytes and only when lengths match: timingSafeEqual throws otherwise.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  const c = parsed as Claims & { exp?: number };
  if (typeof c?.exp !== 'number' || c.exp < nowS) return null;
  if (c.kind === 'machine' && c.uploadDeviceId && c.uploadCentreId) return c;
  if (c.kind === 'operator' && c.operatorId && c.uploadCentreId) return c;
  if (c.kind === 'reviewer' && c.reviewerId) return c;
  return null;
}
