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
 * ponytail: scrypt at N=2^15, and the cost is IN the hash, so raising it later
 * is a one-line change and every existing hash keeps verifying at the cost it
 * was made with.
 */

const scrypt = promisify(scryptCb) as (
  pw: string | Buffer,
  salt: string | Buffer,
  len: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const KEYLEN = 32;

/**
 * What a hash made today costs. N=2^15 — the comment above this file used to
 * claim that and the code passed no options at all, so every hash in every
 * database was made at Node's default N=2^14, at half the intended work.
 */
const COST = { N: 32768, r: 8, p: 1 } as const;

/**
 * scrypt's own memory guard, raised because `COST` exceeds the default.
 *
 * N=32768 with r=8 needs 128·N·r = 32 MiB of blocks, which is exactly Node's
 * default `maxmem` before any overhead, so the call throws without this. 128
 * MiB leaves room for a later raise and still bounds what one verification can
 * allocate — a stored hash naming parameters past it verifies false rather
 * than deciding how much memory this process takes.
 */
const MAXMEM = 128 * 1024 * 1024;

/** The cost of every hash written before the parameters were recorded. */
const LEGACY = { N: 16384, r: 8, p: 1 } as const;

/** `scrypt$N=32768,r=8,p=1$<saltHex>$<hashHex>`. */
export async function hashCredential(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(secret, salt, KEYLEN, { ...COST, maxmem: MAXMEM });
  return `scrypt$N=${COST.N},r=${COST.r},p=${COST.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * The parameters a stored hash names, bounded, or null.
 *
 * Bounded because they come out of the database and go into a memory
 * allocation: N is what multiplies the work and the memory, so an unbounded one
 * read off a row is a denial of service with a valid-looking hash in front of
 * it. N must be a power of two (scrypt requires it), at most 2^20; r at most
 * 32; p at most 16.
 */
function costOf(field: string): { N: number; r: number; p: number } | null {
  const m = /^N=([1-9]\d*),r=([1-9]\d*),p=([1-9]\d*)$/.exec(field);
  if (m === null) return null;
  const N = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  if (N < 2 || N > 2 ** 20 || (N & (N - 1)) !== 0) return null;
  if (r > 32 || p > 16) return null;
  return { N, r, p };
}

/** False for a malformed or absent hash, never a throw: a bad row must not be a 500. */
export async function verifyCredential(secret: string, stored: string | null): Promise<boolean> {
  if (stored === null) return false;
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return false;
  // Four fields is a hash that records its cost; three is one from before that
  // and is verified at the default it was made with.
  const cost = parts.length === 4 ? costOf(parts[1]!) : parts.length === 3 ? LEGACY : null;
  const saltHex = parts.length === 4 ? parts[2] : parts[1];
  const hashHex = parts.length === 4 ? parts[3] : parts[2];
  if (cost === null || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  let actual: Buffer;
  try {
    // scrypt throws on parameters it will not run — the memory guard above is
    // the second bound on `costOf`, and a row must not become a 500 either way.
    actual = await scrypt(secret, Buffer.from(saltHex, 'hex'), KEYLEN, { ...cost, maxmem: MAXMEM });
  } catch {
    return false;
  }
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
/**
 * APP-01 / SEC-01. A fourth kind, separate for the same reason the third one is.
 *
 * Every counter route scopes its query on `uploadCentreId` read off the operator
 * token, and a collector belongs to no upload centre — they belong to a phone.
 * Sharing `OperatorClaims` and leaving the centre undefined would make those
 * routes compile against a collector and refuse them only at run time, if
 * somebody remembered the guard. A separate kind makes them unreachable to the
 * type, so `episodes.ts` cannot start reading `uploadCentreId` off a collector
 * however hard it tries.
 *
 * `epoch` is `collectors.token_epoch` as it stood at sign-in, and it is checked
 * against the row on every request. It is in the claims and not looked up alone
 * because the check has to compare two values: what the token was issued under,
 * and what the row says now.
 */
export type CollectorClaims = { kind: 'collector'; collectorId: string; epoch: number; demoRunId?: string };
export type Claims = MachineClaims | OperatorClaims | ReviewerClaims | CollectorClaims;

/**
 * The centre is baked into both tokens at issue time and is never taken from the
 * request. That is what makes BO-11 / SEC-02 server-side rather than advisory:
 * a caller cannot name a centre it was not issued for.
 */
const TOKEN_TTL_S = 12 * 60 * 60; // one shift
/**
 * Thirty days for a collector, and it is not the operator's twelve hours by
 * oversight.
 *
 * An operator's session ends with a shift: they are at a counter, they sign in
 * at the start of it, and a stale token on a shared upload-centre PC is a real
 * exposure. A collector holds a phone that is theirs, they sign in from their
 * own device, and the only way back in is a code sent to that phone (Zalo, see
 * `zns.ts`) — so a twelve-hour token means a collector who opens the app on the
 * way to work waits for a notification first, every day, and every one of those
 * costs the OA's ZNS quota. Thirty days is what makes the app usable at all.
 *
 * What pays for the longer window is `token_epoch`. An operator token cannot be
 * revoked before it expires and its twelve hours are the bound; a collector
 * token can be revoked in one UPDATE, on every device at once, so the length of
 * the window is no longer the only control over a lost phone.
 */
const COLLECTOR_TOKEN_TTL_S = 30 * 24 * 60 * 60;

const ttlOf = (claims: Claims): number =>
  claims.kind === 'collector' ? COLLECTOR_TOKEN_TTL_S : TOKEN_TTL_S;

export function signToken(secret: string, claims: Claims, nowS = Math.floor(Date.now() / 1e3)): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: nowS + ttlOf(claims) })).toString(
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
  // The epoch is required, and `0` is not a stand-in for "absent": the column
  // starts at 1, so a token claiming epoch 0 matches no row and is refused a
  // moment later anyway. Checking the type here keeps that a shape failure.
  if (c.kind === 'collector' && c.collectorId && typeof c.epoch === 'number') {
    if (c.demoRunId !== undefined && (typeof c.demoRunId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.demoRunId))) return null;
    return c;
  }
  return null;
}
