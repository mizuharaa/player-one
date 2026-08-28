import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { auditLogin } from './audit.ts';
import { hashCredential, signToken, verifyCredential, type CollectorClaims } from './credentials.ts';
import { rateLimited, signInAttempt, type SignInLimiter } from './ratelimit.ts';

/**
 * How a collector signs in. APP-01, SEC-01, PLT-06.
 *
 * PaXini's PRD §7.1 registers a collector by **phone number with no password**,
 * so there are two routes and no third: ask for a code, present the code. The
 * credential is possession of the number, and nothing on `collectors` outlives a
 * sign-in except the phone itself.
 *
 * ## The scoping rule, which is the point of the whole design
 *
 * A collector's id comes from the token and appears in NO path, query or body.
 * Every collector route is `/api/me/...`, so there is no id in a request for
 * collector A to swap for collector B's — not because a guard compares them, but
 * because the request has nowhere to put one. The reviewer lane already works
 * this way for its own scope; `requireActor` in `index.ts` enforces both halves,
 * including the half people forget, which is that an operator or reviewer token
 * is refused on `/api/me/` too. "Me" has to mean one thing.
 *
 * ## What the two routes may say
 *
 * `request-code` always answers 204. It never says whether the number is
 * enrolled, because a route that answers differently for an enrolled number is a
 * way to ask this service which of five hundred numbers belong to collectors —
 * and the answer is worth money to somebody buying phone numbers. `verify`
 * answers one 401 for a wrong number, a wrong code and an expired code alike.
 *
 * The same care applies to *timing*, which is why both routes run through
 * `constantLatency` below.
 */

/**
 * How long a code lives. Short because it arrives by SMS on a phone the person
 * is holding, and every second of it is a second somebody else could read the
 * notification off a locked screen.
 */
export const CODE_TTL_MS = 5 * 60_000;
/**
 * How many times one code may be offered before it is dead. Six digits is a
 * million codes, and the rate limiter alone would let a determined attacker
 * work through a useful slice of that over months of five-minute windows; the
 * counter is what kills a code after a handful of tries instead of at its
 * expiry. Five, because a person reading six digits off a notification does not
 * get it wrong five times.
 */
export const CODE_ATTEMPTS = 5;

/**
 * The floor both routes answer no faster than.
 *
 * Measured on the org PC before this was here: `hashCredential` costs 92 ms on
 * average and 153 ms cold, a `select` on `collectors` by phone costs under a
 * millisecond, and the `update` that stores a code costs about the same. So the
 * work an enrolled number causes and the work an unenrolled one causes differ by
 * a couple of milliseconds against a background of ninety — but "a couple of
 * milliseconds, always in the same direction" is exactly what an attacker
 * averages out over a thousand requests. 400 ms sits above every measurement
 * with room for a loaded thread pool, and it is short enough that the app's
 * "sending you a code" spinner is the thing the person notices, not this.
 *
 * ponytail: a floor and an unconditional hash, not a constant-time
 * reimplementation of the request path. The floor is what removes the
 * systematic difference; it does not hide a database that has stalled, and it
 * does not need to, because a stall lands on the enrolled and unenrolled paths
 * alike. Raise it if a slower machine ever measures a hash above it.
 */
export const LATENCY_FLOOR_MS = 400;

/** Runs `work`, then waits out whatever is left of the floor. */
async function constantLatency<T>(work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await work();
  await sleep(Math.max(0, LATENCY_FLOOR_MS - (Date.now() - started)));
  return result;
}

/**
 * Six digits, uniformly. `randomInt` rather than `Math.random`, and rather than
 * a modulo of random bytes: both of those are biased, and a code whose first
 * digit is not uniform is a code with fewer than a million values.
 */
const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Delivering the code. Absent by default and the routes say so.
 *
 * There is no SMS gateway in this repository and no contract behind one yet, so
 * this is an injected function rather than a client. It **must return quickly**
 * — enqueue the message, do not wait for a carrier. A gateway call awaited here
 * would take hundreds of milliseconds on the enrolled path and zero on the
 * unenrolled one, which is the timing signal `constantLatency` exists to remove,
 * and no floor can hide it.
 */
export type SendSignInCode = (phone: string, code: string) => Promise<void>;

/** One 401 body for every way `verify` can fail. */
const CREDENTIALS = { error: 'credentials', reason: 'credentials' };

export function registerCollectorAuth(
  app: FastifyInstance,
  db: Db,
  options: { tokenSecret: string; limiter: SignInLimiter; sendSignInCode?: SendSignInCode },
): void {
  /**
   * APP-01. Ask for a code.
   *
   * Always 204 when it runs at all, whatever the number is. The only answers
   * that are not 204 say nothing about any number: 400 for a request with no
   * phone field, 429 for a caller over the limit, and 503 when this deployment
   * has no way to send an SMS — the same answer the upload routes give when
   * there is no object store, and the same for every caller.
   */
  app.post('/auth/collector/request-code', async (req, reply) => {
    const send = options.sendSignInCode;
    if (send === undefined) {
      return reply.code(503).send({ error: 'sign-in code delivery is not configured' });
    }
    const { phone } = (req.body ?? {}) as Record<string, string>;
    if (typeof phone !== 'string' || phone === '') {
      return reply.code(400).send({ error: 'missing phone' });
    }

    /**
     * SEC-03, through the one sign-in limiter this service has. Every request
     * is counted and none is ever given back: unlike the other four sign-in
     * routes this one checks no credential, so there is no "it turned out to be
     * right" to refund. What it does cost is an SMS to somebody's phone, and ten
     * per number per five minutes is the cap on using this service to send them.
     *
     * A refused request leaves an audit row and a delivered one does not.
     * `audit_events_attributed_check` exempts sign-in rows by action — `%.login`
     * and `%.login_failed`, nothing else — so a third name for "a code was
     * asked for" cannot be written without widening that check, and widening it
     * to admit a row that names nobody is not worth a convenience. The
     * successful sign-in a few seconds later is the row that says a code
     * arrived; a refused burst is the row that says somebody is sending SMS at
     * a stranger.
     *
     * A number nobody owns leaves no row either, and that is not an oversight:
     * `attempt.wrong()` means a credential was checked and was wrong, and
     * nothing here checks a credential. Writing one for an unenrolled number
     * would put "which numbers are not collectors" in a table, from an
     * unauthenticated request, which is the question the 204 exists to refuse.
     */
    const attempt = signInAttempt(db, options.limiter, req.ip, 'collector.login_failed', [
      { id: phone, kind: 'collector' },
    ]);
    const wait = await attempt.blocked();
    if (wait !== null) {
      return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));
    }

    await constantLatency(async () => {
      // Generated and hashed whether or not anybody owns this number, so the
      // expensive half of the work is identical on both paths.
      const code = newCode();
      const hash = await hashCredential(code);

      const [collector] = await db
        .select({ id: schema.collectors.id })
        .from(schema.collectors)
        .where(eq(schema.collectors.phone, phone));
      if (collector === undefined) return;

      // A new code replaces whatever was there and resets the attempt count.
      // Asking again is how a person recovers from five wrong tries, and it has
      // to be, because the only other way back in is an administrator.
      await db
        .update(schema.collectors)
        .set({
          signInCodeHash: hash,
          signInCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
          signInCodeAttempts: 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.collectors.id, collector.id));
      await send(phone, code);
    });

    return reply.code(204).send();
  });

  /**
   * APP-01. Present the code, get a thirty-day token.
   *
   * One 401 for a number nobody owns, a code that is wrong, a code that has
   * expired and a code that has been guessed at too often. Telling them apart
   * would tell an attacker which numbers are enrolled and which of their guesses
   * were close enough to be worth repeating.
   */
  app.post('/auth/collector/verify', async (req, reply) => {
    const { phone, code } = (req.body ?? {}) as Record<string, string>;
    if (typeof phone !== 'string' || phone === '' || typeof code !== 'string' || code === '') {
      return reply.code(400).send({ error: 'missing credentials' });
    }

    const attempt = signInAttempt(db, options.limiter, req.ip, 'collector.login_failed', [
      { id: phone, kind: 'collector' },
    ]);
    const wait = await attempt.blocked();
    if (wait !== null) {
      return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));
    }

    const claims = await constantLatency(async (): Promise<CollectorClaims | null> => {
      /**
       * The attempt is counted by the same statement that reads the code, and
       * the count that is checked is the one the UPDATE returned.
       *
       * Read-then-write would lose attempts to a burst: ten parallel guesses all
       * read `attempts = 0`, all decide they are under the cap, and a code that
       * should have died after five is offered ten times. `returning` hands back
       * the post-increment value, so exactly one request sees each number and
       * the sixth guess is the sixth guess however they arrive.
       */
      const [collector] = await db
        .update(schema.collectors)
        .set({ signInCodeAttempts: sql`${schema.collectors.signInCodeAttempts} + 1` })
        .where(eq(schema.collectors.phone, phone))
        .returning({
          id: schema.collectors.id,
          hash: schema.collectors.signInCodeHash,
          expiresAt: schema.collectors.signInCodeExpiresAt,
          attempts: schema.collectors.signInCodeAttempts,
          epoch: schema.collectors.tokenEpoch,
        });

      if (collector === undefined) return null;
      if (collector.attempts > CODE_ATTEMPTS) return null;
      if (collector.expiresAt === null || collector.expiresAt.getTime() <= Date.now()) return null;
      if (!(await verifyCredential(code, collector.hash))) return null;

      /**
       * The code is spent. Clearing both columns together is what
       * `collectors_sign_in_code_check` insists on, and it is what makes the
       * code single-use: a replay of the same six digits a second later finds
       * no hash and is refused like any other wrong code.
       */
      await db
        .update(schema.collectors)
        .set({
          signInCodeHash: null,
          signInCodeExpiresAt: null,
          signInCodeAttempts: 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.collectors.id, collector.id));

      await auditLogin(db, 'collector.login', 'collectors', collector.id, {
        collectorId: collector.id,
      });
      return { kind: 'collector', collectorId: collector.id, epoch: collector.epoch };
    });

    if (claims === null) {
      await attempt.wrong();
      return reply.code(401).send(CREDENTIALS);
    }
    attempt.ok();
    /**
     * The token and nothing else. No name, no status, no phone: the app asks
     * `/api/me` for who it is, with the token, and that route reads the id off
     * the token rather than off this response.
     */
    return { token: signToken(options.tokenSecret, claims) };
  });
}
