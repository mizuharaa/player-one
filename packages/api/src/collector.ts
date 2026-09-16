import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { auditLogin, mutate } from './audit.ts';
import { hashCredential, signToken, verifyCredential, type CollectorClaims } from './credentials.ts';
import type { EngineeringCapabilities } from './engineering.ts';
import { rateLimited, signInAttempt, type SignInLimiter } from './ratelimit.ts';
import { SmsDeliveryError, type SmsRefusal } from './sms.ts';
import {
  APP_DEEP_LINK,
  codeChallengeFor,
  newCodeVerifier,
  newOpaqueToken,
  SIGN_IN_TTL_MS,
  ticketDigest,
  ZaloLoginError,
  type ZaloIdentity,
  type ZaloLogin,
  type ZaloLoginRefusal,
} from './zalo-login.ts';
import { ZnsDeliveryError, type ZnsRefusal } from './zns.ts';

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
 * How long a code lives. Short because it arrives as a notification on a phone
 * the person is holding, and every second of it is a second somebody else could
 * read it off a locked screen.
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
 * How many of the shared address budget one Zalo sign-in spends, and therefore
 * how many a successful one gives back.
 *
 * The hop is three requests — start, callback, ticket — and each one charges
 * the limiter, because leaving any of them unmetered would leave a credential
 * unmetered with it. But it is ONE sign-in, and before this only one charge
 * was refunded on success: a completed sign-in cost two, so a shared carrier
 * address ran out of the thirty-per-five-minutes at about the fifteenth
 * collector and blocked everyone behind it for 300 seconds. Both audits of
 * `4a32929` reproduced that.
 *
 * So a success refunds exactly what the flow spent, and no more. The rule
 * `succeeded` states — a shared counter gives back this one attempt, never a
 * clear, so one valid account cannot wipe the count for every guess sprayed
 * from the same address — is about not giving back more than was taken. Three
 * requests took three.
 *
 * A FAILED hop still costs one to three, which is the point: it is the failures
 * the budget exists to cap, and `ratelimit.ts` names the shared-address ceiling
 * behind carrier NAT as a known one.
 */
export const ZALO_HOP_REQUESTS = 3;

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
 * The implementation is `zns.ts` — Zalo Notification Service, decided on
 * 2026-08-29 and argued there — or `devLogSender`, which writes the code to
 * the server log so a pilot can run before VNG has issued a ZNS account. It is
 * an injected function rather than a client because this route does not care
 * which of them it holds.
 *
 * **It is never awaited on the request's clock.** A gateway call takes
 * hundreds of milliseconds on the enrolled path and zero on the unenrolled
 * one, and a ZNS timeout takes ten seconds on the enrolled path only — which
 * is exactly the signal `constantLatency` exists to remove, and which no floor
 * can hide, because a floor can only make a fast answer slower. So the route
 * starts the delivery and answers; `deliverAndRecord` below finishes it.
 *
 * A failure is a throw, and `ZnsDeliveryError` carries the named refusal.
 * Returning a result instead would have been the same information with a wider
 * blast radius: every existing caller and test would have had to change shape.
 */
export type SendSignInCode = (phone: string, code: string) => Promise<void>;

/**
 * Which channel a deployment is actually sending on, for the audit row.
 *
 * The same union `engineering.ts` reports as `signInDeliveryMode`, reused
 * rather than declared a second time: `bin/serve.ts` already computes it from
 * `PLAYERONE_SIGN_IN_CHANNEL`, and two values for one fact would be two values
 * to disagree. `unknown` is what an embedded caller that injects a sender
 * without naming it gets, and writing that down is more honest than guessing.
 */
export type SignInDeliveryChannel = EngineeringCapabilities['signInDeliveryMode'];

/** What `collector.sign_in_code` records: sent, or the named refusal from either adapter. */
export type DeliveryOutcome = 'sent' | ZnsRefusal | SmsRefusal;

/**
 * Deliver the code, then record what happened. Runs after the reply.
 *
 * ## Why this is audited at all
 *
 * PLT-07 wants every mutation attributed, and sending somebody a login code is
 * an act on their account whether or not a row changed. It is also the only
 * place the answer to "why can this collector never sign in" exists: the route
 * answers 204 to the phone either way, deliberately, so the refusal has to be
 * written down somewhere an operator can read it. `zns_no_zalo_account` is
 * that case and it is permanent for that number.
 *
 * ## Why it can be audited now, when the request route says it cannot
 *
 * The comment on the rate-limit branch below is still right about what it
 * describes: a row for a number nobody owns would put "which numbers are not
 * collectors" in a table, from an unauthenticated request, and there is nobody
 * to attribute it to. This row is the other case — the number IS a collector's,
 * so the row names them, and 0019's third attribution shape (`actor_role =
 * 'collector'` with `collector_id` set) holds it with no exemption and no new
 * migration. An unenrolled number still writes nothing, which is what keeps
 * the table from answering the question the 204 refuses to.
 *
 * ## What is never written
 *
 * The code. It is not a parameter of the event and must never become one: an
 * audit trail that an operator can read a live sign-in code out of is a way in,
 * not a control. `after` carries the channel and the outcome and nothing else —
 * the phone number is already on the collector row this is filed against.
 *
 * Nothing here can reject: the caller has already replied.
 */
function deliverAndRecord(
  db: Db,
  send: SendSignInCode,
  channel: SignInDeliveryChannel,
  collector: { id: string; epoch: number },
  phone: string,
  code: string,
): void {
  void (async () => {
    let outcome: DeliveryOutcome = 'sent';
    try {
      await send(phone, code);
    } catch (err) {
      /**
       * Both adapters, because there are two now.
       *
       * `SmsDeliveryError` is a different class from `ZnsDeliveryError`, so
       * before this branch existed every SMS failure fell through to
       * `zns_unreachable`: all six named SMS refusals collapsed into one ZNS
       * name, and into a *temporary* one. The three that need a human —
       * credentials, brandname, template — read to an operator as "ask them to
       * try again", and the `bo.refused.sms_*` sentences were unreachable from
       * any code path. The completeness test did not catch it because it
       * compares the refusal set against the catalogue and never a route.
       *
       * A sender that throws anything else is a sender we cannot ask what went
       * wrong, and the honest name for that depends on which channel is
       * configured: both are temporary, so a bug in a sender strands nobody
       * permanently either way.
       */
      outcome =
        err instanceof ZnsDeliveryError
          ? err.refusal
          : err instanceof SmsDeliveryError
            ? err.refusal
            : channel === 'sms'
              ? 'sms_unreachable'
              : 'zns_unreachable';
    }
    try {
      await mutate(
        db,
        { collector: { kind: 'collector', collectorId: collector.id, epoch: collector.epoch } },
        {
          action: 'collector.sign_in_code',
          targetTable: 'collectors',
          targetId: collector.id,
          /**
           * The channel that was actually configured, not the literal `'zns'`
           * this used to write. An operator reading "channel: zns, outcome:
           * zns_unreachable" for a deployment that has been sending SMS all
           * week is being told about a system that does not exist.
           */
          after: { channel, outcome },
        },
        async () => outcome,
      );
    } catch (err) {
      // The reply went out minutes of wall clock ago and the pool may be
      // closing under a shutting-down server. Losing the row is bad; throwing
      // into an empty stack and taking the process with it is worse.
      console.warn(`[collector.sign_in_code] outcome ${outcome} not recorded: ${String(err)}`);
    }
  })();
}

/**
 * Open sign-up. Owner's decision, 2026-09-15, and migration 0034.
 *
 * Anybody may sign in with their own number and browse the task board, so the
 * app can advertise the service; taking work still costs a visit to a
 * collection centre. Before this a number no `collectors` row carried got a
 * silent 204 and nothing happened, and the only way to become a collector was
 * an operator typing an `external_ref` (BO-03).
 *
 * ## Why the row is created on `verify` and not on `request-code`
 *
 * `request-code` is unauthenticated, and a route that inserts into `collectors`
 * for every number somebody types is a route that lets a stranger fill an
 * operator's collector list with numbers nobody answers. So nothing is created
 * until a code comes back — possession of the number is the credential, and
 * until it is proved there is no person. The code waits in `sign_up_codes`,
 * which nothing references and whose rows are dead in five minutes.
 *
 * ## What the routes may still say, which is nothing
 *
 * Neither answer changes. `request-code` is 204 for every number that parses,
 * enrolled or not, because it now does the same amount of work either way —
 * generate, hash, store — and `constantLatency` still covers the difference.
 * `verify` is one 401 for a wrong code, an expired code, a spent code and a
 * code nobody asked for. The demo echo deliberately does NOT widen to a
 * sign-up: it is scoped to a number a collector already holds, which is the
 * property `collector-auth.test.ts` pins.
 */
async function holdSignUpCode(db: Db, phone: string, hash: string): Promise<void> {
  const at = new Date();
  const expiresAt = new Date(at.getTime() + CODE_TTL_MS);
  await db
    .insert(schema.signUpCodes)
    .values({ phone, codeHash: hash, expiresAt })
    // A new code replaces whatever was there and resets the count, exactly as
    // it does on a collector's own row: asking again is how a person recovers
    // from five wrong tries, and here there is not even an operator to ask.
    .onConflictDoUpdate({
      target: schema.signUpCodes.phone,
      set: { codeHash: hash, expiresAt, attempts: 0, consumedAt: null, updatedAt: at },
    });
}

/**
 * The code came back from a number no collector holds. Make the collector.
 *
 * Same checks in the same order as the enrolled path, and for the same reasons:
 * the attempt is counted by the statement that reads the code so a burst cannot
 * lose attempts, the cap is read off what the UPDATE returned, and the code is
 * spent by an UPDATE whose `where` carries the condition — only the winner of
 * `consumed_at is null` signs in, so two requests carrying the same six digits
 * do not both create a collector.
 *
 * `status = 'prospect'` (0034): signed up, not enrolled. `external_ref` is NOT
 * NULL and unique and no operator has issued one, so it is `app:<id>` — a
 * reference that says where this person came from rather than a number invented
 * to fill the column. It is deliberately not the phone: that is the credential,
 * and `collectors_phone_key` already holds it.
 *
 * If the insert loses — an operator enrolled this very number in the moment
 * between the lookup above and this statement — the code is spent and the
 * answer is the same 401 as any other failure. The person asks for another
 * code and takes the enrolled path, which by then is the true one.
 */
async function signUpAndSignIn(
  db: Db,
  phone: string,
  code: string,
): Promise<CollectorClaims | null> {
  const [pending] = await db
    .update(schema.signUpCodes)
    .set({ attempts: sql`${schema.signUpCodes.attempts} + 1`, updatedAt: new Date() })
    .where(eq(schema.signUpCodes.phone, phone))
    .returning({
      hash: schema.signUpCodes.codeHash,
      expiresAt: schema.signUpCodes.expiresAt,
      attempts: schema.signUpCodes.attempts,
      consumedAt: schema.signUpCodes.consumedAt,
    });
  if (pending === undefined) return null;
  if (pending.consumedAt !== null) return null;
  if (pending.attempts > CODE_ATTEMPTS) return null;
  if (pending.expiresAt.getTime() <= Date.now()) return null;
  if (!(await verifyCredential(code, pending.hash))) return null;

  const collectorId = randomUUID();
  const externalRef = `app:${collectorId}`;
  const claims = await mutate(
    db,
    { collector: { kind: 'collector', collectorId, epoch: 1 } },
    {
      action: 'collector.sign_up',
      targetTable: 'collectors',
      targetId: collectorId,
      after: { status: 'prospect', external_ref: externalRef },
    },
    async (tx): Promise<CollectorClaims | undefined> => {
      const at = new Date();
      const [spent] = await tx
        .update(schema.signUpCodes)
        .set({ consumedAt: at, updatedAt: at })
        .where(and(eq(schema.signUpCodes.phone, phone), isNull(schema.signUpCodes.consumedAt)))
        .returning({ phone: schema.signUpCodes.phone });
      if (spent === undefined) return undefined;
      const [row] = await tx
        .insert(schema.collectors)
        .values({ id: collectorId, externalRef, status: 'prospect', phone })
        // Targeted at the phone, which is the index that can actually clash:
        // the id and the reference were both made a line ago.
        .onConflictDoNothing({ target: schema.collectors.phone })
        .returning({ id: schema.collectors.id, epoch: schema.collectors.tokenEpoch });
      if (row === undefined) return undefined;
      return { kind: 'collector', collectorId: row.id, epoch: row.epoch };
    },
  );
  return claims ?? null;
}

/**
 * The collector Zalo says this is, signing them up if nobody has that id yet.
 *
 * Owner's decision, 2026-09-16 (`zalo-login.ts` argues it): sign-in has to work
 * for anybody holding an ordinary Zalo account, because VNG's ZNS Official
 * Account is not available and the code channel therefore delivers nothing.
 *
 * ## Why the lookup is `zalo_id` and not the phone
 *
 * Zalo Login does not give us the person's phone number — reading it needs a
 * separate approved permission we do not hold (`docs/sign-in-channels.md`) — so
 * a collector who arrives this way has NO phone on their row, and
 * `collectors_phone_key` cannot find them again. `collectors_zalo_id_key`
 * (0035) is the second unique index that can, and it has the same property the
 * sign-in depends on: one row or none, never a first row.
 *
 * The cost, stated so nobody discovers it in the pilot: **a person who signs up
 * with Zalo and a person who signs up with their number are two collectors**
 * until an operator merges them, because nothing this server holds connects
 * them. That is a counter procedure and not code: guessing the link from a
 * display name would attach somebody's earnings to a stranger.
 *
 * `status = 'prospect'` and `external_ref = 'zalo:<id>'`, the same shape open
 * sign-up (0034) uses for `app:<uuid>` and for the same reason — a reference
 * that says where this person came from rather than a number invented to fill a
 * NOT NULL unique column.
 *
 * If the insert loses a race with another tab of the same sign-in, the conflict
 * is on `zalo_id` and the winner's row is read back, so both tabs sign the same
 * person in rather than one of them failing.
 */
async function zaloCollector(db: Db, identity: ZaloIdentity): Promise<CollectorClaims | null> {
  const found = await db
    .select({ id: schema.collectors.id, epoch: schema.collectors.tokenEpoch })
    .from(schema.collectors)
    .where(eq(schema.collectors.zaloId, identity.zaloId));
  if (found[0] !== undefined) {
    return { kind: 'collector', collectorId: found[0].id, epoch: found[0].epoch };
  }

  const collectorId = randomUUID();
  const externalRef = `zalo:${identity.zaloId}`;
  const claims = await mutate(
    db,
    { collector: { kind: 'collector', collectorId, epoch: 1 } },
    {
      action: 'collector.sign_up',
      targetTable: 'collectors',
      targetId: collectorId,
      /**
       * `external_ref` carries the Zalo id, because that is what it IS:
       * `zalo:<id>`. An earlier version of this comment claimed the id was not
       * written here, directly above the line that writes it — the audit of
       * `e4bf1fb` caught it, and a comment that contradicts the line under it
       * is worse than none, because it is why a reader stops checking.
       *
       * Not a leak: the same string is on `collectors.external_ref`, which is
       * the reference an operator reads, and `collectors.zalo_id` holds the
       * bare id. This row names where the person came from, which is the one
       * thing an audit trail of a sign-up is for.
       */
      after: { status: 'prospect', external_ref: externalRef, channel: 'zalo' },
    },
    async (tx): Promise<CollectorClaims | undefined> => {
      const [row] = await tx
        .insert(schema.collectors)
        .values({
          id: collectorId,
          externalRef,
          status: 'prospect',
          zaloId: identity.zaloId,
          name: identity.name,
        })
        // Targeted at the Zalo id, which is the index that can actually clash:
        // the id and the reference were both made a line ago.
        .onConflictDoNothing({ target: schema.collectors.zaloId })
        .returning({ id: schema.collectors.id, epoch: schema.collectors.tokenEpoch });
      if (row === undefined) return undefined;
      return { kind: 'collector', collectorId: row.id, epoch: row.epoch };
    },
  );
  if (claims !== undefined) return claims;

  // The other tab won. Its row is the person; read it rather than refuse.
  const [raced] = await db
    .select({ id: schema.collectors.id, epoch: schema.collectors.tokenEpoch })
    .from(schema.collectors)
    .where(eq(schema.collectors.zaloId, identity.zaloId));
  return raced === undefined ? null : { kind: 'collector', collectorId: raced.id, epoch: raced.epoch };
}

/** One 401 body for every way `verify` can fail. */
const CREDENTIALS = { error: 'credentials', reason: 'credentials' };

/**
 * What a route answers when this deployment cannot do it at all.
 *
 * Deliberately says nothing about WHY. `POST /auth/collector/zalo/start` used
 * to answer `zalo_not_configured`, which told any anonymous caller which
 * deployments hold Zalo credentials — a configuration oracle Codex named. The
 * app decides to hide the button on the 503 STATUS, so the name costs nothing
 * to give up, and it is the same shape `request-code` already answers with.
 */
const UNAVAILABLE = { error: 'sign-in is not available on this deployment' };

/**
 * The demo bypass. Owner's request, 2026-09-16, and it is a debugging door
 * rather than a product feature.
 *
 * The Thursday demonstration has to show the four pipelines — claim, session,
 * ingestion, upload — and none of the three sign-in channels can be relied on
 * to deliver on the day: VNG's ZNS Official Account does not exist, the eSMS
 * brandname is still in approval, and Zalo Login has never been exercised
 * against a live app. So there is one more way in, it is gated on a key the
 * owner generates at deploy time, and it signs in as **the collector the
 * demonstration already uses** rather than as a new kind of session.
 *
 * ## What it deliberately is NOT
 *
 * It is not a second upload path and it loosens no limit. The token it issues
 * is the ordinary thirty-day collector token, so `/api/me/uploads` applies the
 * same size, format and basename rules it applies to everybody, and
 * `task_claims_guard` still decides whether that collector may hold work. The
 * bypass skips the *credential*, and nothing else: an unqualified collector
 * reached this way would still be refused work by name.
 *
 * It is also not a mode. There is no `PLAYERONE_DEMO_MODE`; there is one
 * variable holding one secret, and a deployment that does not set it does not
 * have this route at all — the 404 below is indistinguishable from a build
 * without the code in it.
 *
 * ## Which collector, and why it is looked up rather than named
 *
 * `scripts/seed-demo.mjs` already creates exactly the collector this needs and
 * marks it with this reference: qualified, exam passed, six agreements
 * accepted, a device bound, one live claim, and `seed-demo-work.mjs` hangs a
 * collection session and episodes off it. So the route reads that row instead
 * of a second seeded identity — a `demo-bypass` collector would be a second
 * thing to keep onboarded, and the first demonstration where the two drifted
 * would be the one in front of the room.
 *
 * `collectors_external_ref_key` is unique, so this is one row or none. None is
 * a 503 and not a 404: by then the key has already been checked, so saying
 * "the feature is on and nobody seeded the demo" tells the operator the one
 * thing they can act on and tells a stranger nothing.
 */
export const DEMO_BYPASS_COLLECTOR_REF = 'demo-collector';

/**
 * How short a bypass key may not be. 32 characters, because this key is the
 * *only* thing between an unauthenticated caller and a signed-in collector —
 * there is no second factor, no code and no rate-limited six digits behind it.
 * `openssl rand -base64 48` gives 64; the floor is what stops a deployment
 * being gated on a word somebody typed.
 *
 * Enforced in `buildApi`, so an embedded caller cannot assemble the weak
 * combination either, and a server handed a short one refuses to start.
 */
export const DEMO_BYPASS_MIN_KEY = 32;

/**
 * A named refusal, in the shape the app's HTTP client already reads.
 *
 * `reason` as well as `error` because that is what `CREDENTIALS` does and the
 * console reads; `constraint` because `apps/collector/src/api/http.ts` turns
 * that field into an `ApiError` code, which is how a Vietnamese sentence gets
 * chosen for it.
 */
const refusal = (name: ZaloLoginRefusal) => ({ error: name, reason: name, constraint: name });

export function registerCollectorAuth(
  app: FastifyInstance,
  db: Db,
  options: {
    tokenSecret: string;
    limiter: SignInLimiter;
    sendSignInCode?: SendSignInCode;
    /**
     * One phone number whose sign-in code comes back in the response, compared
     * byte for byte against the string the request carried. No normalisation:
     * `zns.ts` normalises for delivery only and that must not be borrowed for
     * identity. Unset, the default everywhere, changes nothing. Scoped to one
     * number rather than a mode because production cannot be detected from in
     * here — see "Demo sign-in" in `docs/RUNNING.md`.
     */
    demoPhone?: string;
    /**
     * Which channel `sendSignInCode` actually is, for the audit row it writes.
     *
     * The same value `engineering.ts` reports, so the trail and the diagnostic
     * cannot disagree. Absent, the row says `unknown`, which is what an
     * embedded caller injecting an unnamed sender honestly is.
     */
    signInChannel?: SignInDeliveryChannel;
    /**
     * The demo bypass key. Absent, `POST /auth/collector/demo` answers 404 for
     * every caller and this deployment has no bypass. See the block above
     * `DEMO_BYPASS_COLLECTOR_REF`; `bin/serve.ts` reads
     * `PLAYERONE_DEMO_BYPASS_KEY`.
     */
    demoBypassKey?: string;
    /**
     * Zalo Login (OAuth v4), owner's decision of 2026-09-16. Absent, the two
     * routes that need it — start and callback — answer 503
     * `zalo_not_configured`, the same answer and for the same reason
     * `request-code` gives a deployment with no code sender. The ticket route
     * has no config check on purpose: it never talks to Zalo, and on a
     * deployment with no Zalo app no ticket was ever issued, so its ordinary
     * 401 is both true and the answer that says less. `bin/serve.ts` reads
     * `zaloLoginFromEnv`.
     */
    zaloLogin?: ZaloLogin;
  },
): void {
  /** Written into every `collector.sign_in_code` row. See the option above. */
  const channel: SignInDeliveryChannel = options.signInChannel ?? 'unknown';
  /**
   * A Zalo sign-in that did not happen, under the address it came from.
   *
   * `signInAttempt` cannot be used for these three routes: it files its refusal
   * against the reference the caller named, and a `state` or a ticket IS the
   * credential — putting either in `audit_events.target_id` would write a live
   * credential into an append-only table nobody can prune. So the row is filed
   * under the source address, which is the only identifier these requests carry
   * that is not a secret.
   *
   * `%.login_failed` is exempt from `audit_events_attributed_check` by action
   * (0002, widened in 0009), exactly as it is for the phone routes, so this
   * needs no migration and names no operator that may not exist.
   *
   * It is awaited before the reply, the way `attempt.wrong()` is on `verify`
   * and unlike `deliverAndRecord`: nothing here has answered the caller yet, so
   * a failure to write is a 500 rather than a silently missing row.
   */
  const auditRefusal = (source: string, outcome: ZaloLoginRefusal | 'rate_limited'): Promise<void> =>
    auditLogin(db, 'collector.login_failed', 'collectors', source, { source, outcome });

  /**
   * The sign-in budget for a route whose credential names nobody.
   *
   * Check and count in one call, for the reason `signInAttempt` gives: a route
   * that checks the limit and forgets to count against it is a limit that
   * stops nobody.
   *
   * The refusal leaves a row, and `noteRefusal` gates it to once per window
   * rather than once per repeat — the same discipline and the same measured
   * reason as `signInAttempt.blocked()`: three hundred refused requests wrote
   * three hundred permanent rows in 783 ms, into a table an append-only trigger
   * will not let anybody delete from.
   */
  const addressBudget = async (source: string): Promise<number | null> => {
    const wait = options.limiter.refusedFor(source, []);
    if (wait !== null) {
      if (options.limiter.noteRefusal(source, [])) await auditRefusal(source, 'rate_limited');
      return wait;
    }
    options.limiter.attempted(source, []);
    return null;
  };
  /**
   * APP-01. Ask for a code.
   *
   * Always 204 when it runs at all, whatever the number is. The only answers
   * that are not 204 say nothing about any number: 400 for a request with no
   * phone field, 429 for a caller over the limit, and 503 when this deployment
   * was handed no sender at all — the same answer the upload routes give when
   * there is no object store, and the same for every caller. A server started
   * through `bin/serve.ts` always has one (`signInCodeSenderFromEnv`), so the
   * 503 is now only what an embedder that passes nothing gets.
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

    const refs = [{ id: phone, kind: 'collector' }] as const;
    const attempt = signInAttempt(db, options.limiter, req.ip, 'collector.login_failed', refs);
    const sourceWait = options.limiter.refusedFor(req.ip, refs);
    if (sourceWait !== null) {
      // A blocked caller must not reserve send slots for other collectors.
      await attempt.blocked();
      return reply.code(429).header('retry-after', String(sourceWait)).send(rateLimited(sourceWait));
    }

    /**
     * One code per number per minute. Claimed for every number that parses,
     * before the lookup below: charging only real sends would answer 429 for an
     * enrolled number and 204 for an unknown one, which `constantLatency`
     * cannot hide because it equalises time and not answers. Before counting
     * an attempt so being told to wait does not also spend security budget.
     */
    const cooldown = options.limiter.reserveSend(phone);
    if (cooldown !== null) {
      return reply.code(429).header('retry-after', String(cooldown)).send(rateLimited(cooldown));
    }

    /**
     * SEC-03, through the one sign-in limiter this service has. Every request
     * is counted and none is ever given back: unlike the other four sign-in
     * routes this one checks no credential, so there is no "it turned out to be
     * right" to refund. What it does cost is a Zalo message to somebody's phone, and ten
     * per number per five minutes is the cap on using this service to send them.
     *
     * A refused request leaves an audit row saying somebody is sending
     * messages at a stranger. A request for an *enrolled* number leaves a
     * second one, `collector.sign_in_code`, written after the reply by
     * `deliverAndRecord` and naming the collector — that is where a refused
     * delivery is recorded, and it is the only place the answer to "why can
     * this collector never sign in" exists.
     *
     * Neither of those needs `audit_events_attributed_check` widened.
     * `%.login_failed` is exempt by action; the delivery row names a collector
     * and satisfies 0019's third attribution shape on its own.
     *
     * A number nobody owns leaves no row either, and that is not an oversight:
     * `attempt.wrong()` means a credential was checked and was wrong, and
     * nothing here checks a credential. Writing one for an unenrolled number
     * would put "which numbers are not collectors" in a table, from an
     * unauthenticated request, which is the question the 204 exists to refuse.
     */
    const wait = await attempt.blocked();
    if (wait !== null) {
      return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));
    }

    /**
     * Set only for the demo number, and only once a collector owns it, so an
     * unenrolled demo number still answers 204 and the route does not become a
     * way to ask whether any *other* number is enrolled.
     */
    let demoCode: string | null = null;

    await constantLatency(async () => {
      // Generated and hashed whether or not anybody owns this number, so the
      // expensive half of the work is identical on both paths.
      const code = newCode();
      const hash = await hashCredential(code);

      const [collector] = await db
        // `token_epoch` is read only so the audit row below can be attributed
        // with a complete `CollectorClaims`. It costs nothing on a row already
        // being fetched, and inventing a placeholder epoch would put a value
        // in the type that is not the collector's.
        .select({ id: schema.collectors.id, epoch: schema.collectors.tokenEpoch })
        .from(schema.collectors)
        .where(eq(schema.collectors.phone, phone));
      if (collector === undefined) {
        /**
         * Open sign-up: hold the code, create nobody. See `holdSignUpCode`.
         *
         * The delivery is started and not awaited, for the reason the enrolled
         * path gives, and its outcome is recorded nowhere — there is no
         * collector to file a row against and writing one under this number
         * would put "which numbers are not collectors" in a table, from an
         * unauthenticated request. A throw is caught and logged so a sender
         * that fails cannot take the process down from an empty stack.
         */
        await holdSignUpCode(db, phone, hash);
        void send(phone, code).catch((err: unknown) => {
          console.warn(`[collector.sign_up_code] delivery failed: ${String(err)}`);
        });
        return;
      }

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
      /**
       * Started, not awaited. See `SendSignInCode`: whether the message went
       * out, was refused, or hung until a ten-second timeout must not be
       * visible in how long this reply took, because only an enrolled number
       * ever reaches this line.
       */
      deliverAndRecord(db, send, channel, collector, phone, code);
      if (options.demoPhone !== undefined && phone === options.demoPhone) demoCode = code;
    });

    /**
     * The one place this route can answer something other than 204, and only
     * for the configured number. It is an enrolment oracle for that number and
     * that is accepted rather than papered over: we seed it ourselves and its
     * existence is not a secret. Every other number keeps the answers that say
     * nothing.
     */
    if (demoCode !== null) return reply.code(200).send({ demo_code: demoCode });
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

      /**
       * Nobody owns this number, so this is either a sign-up or a stranger
       * guessing. `signUpAndSignIn` decides, and it answers `null` for every
       * way it can fail — which is the same `null` the enrolled path answers,
       * and becomes the same 401.
       */
      if (collector === undefined) {
        const signedUp = await signUpAndSignIn(db, phone, code);
        if (signedUp === null) return null;
        await auditLogin(db, 'collector.login', 'collectors', signedUp.collectorId, {
          collectorId: signedUp.collectorId,
        });
        return signedUp;
      }
      if (collector.attempts > CODE_ATTEMPTS) return null;
      if (collector.hash === null) return null;
      if (collector.expiresAt === null || collector.expiresAt.getTime() <= Date.now()) return null;
      if (!(await verifyCredential(code, collector.hash))) return null;

      /**
       * The code is spent. Clearing both columns together is what
       * `collectors_sign_in_code_check` insists on, and it is what makes the
       * code single-use: a replay of the same six digits a second later finds
       * no hash and is refused like any other wrong code. Match the verified
       * snapshot as well: another caller may have consumed or replaced it
       * while scrypt ran, or the phone/epoch may have changed. Only the UPDATE
       * winner signs in, and an old verification cannot erase a fresh code.
       */
      const [consumed] = await db
        .update(schema.collectors)
        .set({
          signInCodeHash: null,
          signInCodeExpiresAt: null,
          signInCodeAttempts: 0,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.collectors.id, collector.id),
          eq(schema.collectors.phone, phone),
          eq(schema.collectors.tokenEpoch, collector.epoch),
          eq(schema.collectors.signInCodeHash, collector.hash),
          sql`${schema.collectors.signInCodeExpiresAt} > clock_timestamp()`,
        ))
        .returning({ id: schema.collectors.id });
      if (consumed === undefined) return null;

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

  /**
   * The demo bypass. Owner's request, 2026-09-16, for debugging and the
   * Thursday demonstration only. Argued at `DEMO_BYPASS_COLLECTOR_REF`.
   *
   * ## What each answer says, and what none of them says
   *
   * 404 when this deployment holds no key, which is every deployment that was
   * not deliberately given one. Not 503 like the Zalo routes: those are a
   * button the app hides on a named refusal, and this is a door that should
   * not be discoverable at all — a 404 is what a caller gets from a build
   * with none of this code in it.
   *
   * 401 for a wrong key, a missing key and a key of the wrong shape alike.
   * There is no 400 here on purpose: a 400 for a malformed body would answer
   * "the feature is on" to somebody who never had the key.
   *
   * ## Why there is no `constantLatency`
   *
   * A key is 32+ characters of the owner's own random bytes, so there is no
   * enrolment oracle to hide and nothing a timing difference could narrow
   * down. What the comparison still must not leak is *how much* of the key
   * was right, which is what `timingSafeEqual` over two fixed-length digests
   * is for — digests rather than the strings themselves so that a key of the
   * wrong length compares in constant time instead of throwing.
   *
   * `ticketDigest` is reused rather than reimplemented: it is sha256-to-hex of
   * a string, which is exactly this, and a second copy of that one line is a
   * second place for it to be wrong.
   */
  app.post('/auth/collector/demo', async (req, reply) => {
    const key = options.demoBypassKey;
    if (key === undefined) return reply.code(404).send({ error: 'not found' });

    const wait = await addressBudget(req.ip);
    if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));

    const offered = (req.body ?? {}) as Record<string, unknown>;
    const presented = typeof offered['key'] === 'string' ? offered['key'] : '';
    const same = timingSafeEqual(
      Buffer.from(ticketDigest(presented), 'hex'),
      Buffer.from(ticketDigest(key), 'hex'),
    );
    if (!same) return reply.code(401).send(CREDENTIALS);

    const [collector] = await db
      .select({ id: schema.collectors.id, epoch: schema.collectors.tokenEpoch })
      .from(schema.collectors)
      .where(eq(schema.collectors.externalRef, DEMO_BYPASS_COLLECTOR_REF));
    if (collector === undefined) {
      return reply.code(503).send({
        error: 'demo_collector_absent',
        reason: 'demo_collector_absent',
        constraint: 'demo_collector_absent',
      });
    }

    /**
     * PLT-07, and the same row every other sign-in writes — `collector.login`
     * against `collectors`, which is the shape `audit_events_attributed_check`
     * already holds. `source` names the door, because an auditor asking "how
     * did this collector sign in on Thursday" must be able to tell a bypass
     * from a collector who presented a credential.
     */
    await auditLogin(db, 'collector.login', 'collectors', collector.id, {
      collectorId: collector.id,
      source: 'demo_bypass',
    });
    options.limiter.succeeded(req.ip, []);
    return {
      token: signToken(options.tokenSecret, {
        kind: 'collector',
        collectorId: collector.id,
        epoch: collector.epoch,
      }),
    };
  });

  /* ------------------------------------------------------------------ *
   * Zalo Login (OAuth v4). Owner's decision, 2026-09-16.
   *
   * Three requests, because the middle one is not the app's: it arrives from
   * Zalo's servers on a browser redirect with no token on it. `zalo_sign_ins`
   * (0035) is the state between them and one row is one attempt.
   *
   *   start     the app asks where to send the browser
   *   callback  Zalo sends the browser back here with a code
   *   ticket    the app trades the callback's one-time ticket for its token
   *
   * The third request is what keeps the session token out of a URL. A redirect
   * carrying `?token=` puts a thirty-day credential in the browser's history,
   * in the Android system log and in every referrer; a ticket that is dead the
   * moment it is used, and that only the app can use, costs one more round
   * trip and none of that.
   * ------------------------------------------------------------------ */

  /**
   * Where to send the browser, and the attempt to match it against.
   *
   * Answers 503 when this deployment holds no Zalo credentials. It is the one
   * place the app can learn that, and it has to be able to: the button is
   * hidden on a deployment where it cannot work.
   */
  app.post('/auth/collector/zalo/start', async (req, reply) => {
    const zalo = options.zaloLogin;
    /**
     * The same 503 and the same name `request-code` gives a deployment with no
     * code sender, and NOT `zalo_not_configured`.
     *
     * Codex called the specific name a configuration oracle, and it was one:
     * it told any anonymous caller which deployments hold Zalo credentials.
     * `sign_in_unavailable` says the only thing a caller may act on — this way
     * in is not available here — and the app already knows that name from the
     * phone route and already has a sentence for it. The app decides to hide
     * the button on the STATUS, not on the name.
     */
    if (zalo === undefined) return reply.code(503).send(UNAVAILABLE);

    const wait = await addressBudget(req.ip);
    if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));

    /**
     * The verifier stays here and the challenge goes to Zalo. That asymmetry
     * is the whole of PKCE: the callback's `code` travels through a browser we
     * do not control, and without the verifier it cannot be exchanged.
     */
    const state = newOpaqueToken();
    const codeVerifier = newCodeVerifier();
    await db.insert(schema.zaloSignIns).values({
      state,
      codeVerifier,
      expiresAt: new Date(Date.now() + SIGN_IN_TTL_MS),
    });
    return {
      url: zalo.authorizeUrl({ state, codeChallenge: codeChallengeFor(codeVerifier) }),
      state,
    };
  });

  /**
   * Zalo's answer. Always a redirect to the app, carrying a ticket or a name.
   *
   * A redirect and not a JSON body or an HTML page, because the thing reading
   * this is a browser the collector is looking at: the app's scheme is the only
   * way back to the screen they started on. The failure case redirects too,
   * with `?error=<name>`, so a refused sign-in lands on a Vietnamese sentence
   * in the app rather than on whatever a mobile browser renders for a 400.
   *
   * ponytail: no HTML fallback for a device with the app uninstalled. The only
   * way to reach this URL is from the app's own button, so the app is
   * installed; a `playerone://` link that goes nowhere would need a page, and a
   * page is a second surface to design and translate. If a QR-code sign-in is
   * ever wanted, that is when it earns one.
   */
  app.get('/auth/collector/zalo/callback', async (req, reply) => {
    const zalo = options.zaloLogin;
    const home = (params: Record<string, string>): never =>
      reply.redirect(`${APP_DEEP_LINK}?${new URLSearchParams(params).toString()}`, 302) as never;

    /**
     * EVERY answer from this route is the deep link, including the two that
     * used to be JSON.
     *
     * Codex found that an unconfigured deployment answered a 503 body and a
     * rate-limited one a 429 body — both rendered as raw JSON in whatever
     * browser Zalo had just redirected, with no way back to the app. The
     * person who tapped a button is looking at a mobile browser: the only
     * useful answer is the scheme that returns them to the screen they
     * started on, with a name the app has a Vietnamese sentence for.
     *
     * `zalo_not_configured` is safe to send HERE, unlike on `start`: reaching
     * this route means Zalo already redirected a browser to it, so the caller
     * has been through Zalo's own screens and learns nothing from the name
     * that the redirect did not already tell them.
     */
    if (zalo === undefined) return home({ error: 'zalo_not_configured' });

    const wait = await addressBudget(req.ip);
    /**
     * `rate_limited`, which `zalo.tsx` already maps to `signIn.rateLimited` —
     * not a new `zalo_rate_limited`. A refusal name earns its own sentence
     * when its answer is different, and "wait a few minutes" is the same
     * sentence whichever route said it.
     */
    if (wait !== null) return home({ error: 'rate_limited' });
    /**
     * Every named refusal leaves a row and then goes home.
     *
     * Before this, a failed Zalo sign-in left nothing at all: only success
     * wrote `collector.login`, so the trail could not say whether the
     * thousand refused callbacks above had happened — which is what makes the
     * rate limit unverifiable after the fact, and which the phone routes have
     * done since the limiter was written. Zalo Login is the first-class
     * channel now, so PLT-07's "every outcome attributed" has to hold for it.
     */
    const refused = async (name: ZaloLoginRefusal): Promise<never> => {
      await auditRefusal(req.ip, name);
      return home({ error: name });
    };

    const { code, state } = (req.query ?? {}) as Record<string, unknown>;
    /**
     * No code is a refusal at Zalo's own screen — the person pressed no, or
     * closed it. Zalo's parameter for that is not documented (see
     * `docs/sign-in-channels.md`), so the absence of a code is what this reads,
     * which is true whatever the parameter turns out to be called.
     */
    if (typeof code !== 'string' || code === '') return refused('zalo_denied');
    if (typeof state !== 'string' || state === '') return refused('zalo_state_unknown');

    /**
     * Spend the state, and spend it BEFORE the exchange.
     *
     * Only the winner of `callback_at is null` continues, so a replayed
     * callback — the browser's back button, a forged link, a retry of the same
     * URL — is refused rather than exchanging the code a second time. It costs
     * one thing and it is the right thing to cost: a network failure at Zalo
     * burns the attempt and the collector taps the button again. The
     * alternative, spending it after a successful exchange, is a window in
     * which one `code` can be presented twice.
     */
    const [attempt] = await db
      .update(schema.zaloSignIns)
      .set({ callbackAt: new Date() })
      .where(and(eq(schema.zaloSignIns.state, state), isNull(schema.zaloSignIns.callbackAt)))
      .returning({
        codeVerifier: schema.zaloSignIns.codeVerifier,
        expiresAt: schema.zaloSignIns.expiresAt,
      });
    if (attempt === undefined) return refused('zalo_state_unknown');
    if (attempt.expiresAt.getTime() <= Date.now()) return refused('zalo_state_expired');

    let identity: ZaloIdentity;
    try {
      identity = await zalo.identify({ code, codeVerifier: attempt.codeVerifier });
    } catch (err) {
      /**
       * A client that throws something else is a client we cannot ask what
       * went wrong. `zalo_unreachable` is the honest name and it is one of the
       * temporary ones, so a bug here strands nobody permanently.
       */
      const named = err instanceof ZaloLoginError ? err.refusal : 'zalo_unreachable';
      req.log.error(err);
      return refused(named);
    }

    const claims = await zaloCollector(db, identity);
    if (claims === null) return refused('zalo_profile_refused');

    /**
     * The ticket. Hashed on the way in for the reason
     * `zalo_sign_ins.ticket_hash` gives, and handed to the browser once.
     */
    const ticket = newOpaqueToken();
    const [minted] = await db
      .update(schema.zaloSignIns)
      .set({ ticketHash: ticketDigest(ticket), collectorId: claims.collectorId })
      .where(and(eq(schema.zaloSignIns.state, state), isNull(schema.zaloSignIns.ticketHash)))
      .returning({ state: schema.zaloSignIns.state });
    if (minted === undefined) return refused('zalo_state_unknown');
    /**
     * The state travels back with the ticket, and it is what binds the ticket
     * to the attempt the app started.
     *
     * Without it the app redeemed ANY `playerone://signed-in?ticket=…` the OS
     * handed it, so a second app claiming the scheme — or anything that could
     * make the phone open one link — could sign a collector into an
     * ATTACKER'S account. That is login-CSRF, and both audits of `4a32929`
     * found it. The app now compares this against the state it stored before
     * it opened the browser and drops the link on any mismatch.
     *
     * Safe to echo: the state was spent by the UPDATE above, so it opens
     * nothing on its own, and it was minted by this server — the app is
     * recognising its own value, not trusting ours.
     *
     * It rides ONLY with a ticket. An `?error=` carries no state, because an
     * error cannot sign anybody in and requiring a match there would let a
     * forged callback suppress a real `zalo_denied` the collector needs to see.
     */
    return home({ ticket, state });
  });

  /**
   * The ticket, for the token. APP-01.
   *
   * One 401 for a ticket that was never issued, one that has expired and one
   * that has already been used, for the reason `verify` gives: telling them
   * apart tells somebody holding a stolen ticket which of their guesses was
   * worth repeating. There is no `constantLatency` here and it is not an
   * oversight — a ticket is 256 random bits, so there is no enrolment oracle
   * to hide and nothing a timing difference could narrow down.
   */
  app.post('/auth/collector/ticket', async (req, reply) => {
    const { ticket } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof ticket !== 'string' || ticket === '') {
      return reply.code(400).send({ error: 'missing ticket' });
    }

    const wait = await addressBudget(req.ip);
    if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));

    /**
     * The one 401, and the row behind it.
     *
     * A ticket is a credential, so a ticket that does not work is the same
     * event `attempt.wrong()` records on `verify` — and the strongest attack
     * signal these three routes have, because guessing tickets is the only
     * thing here worth guessing. One name for never-issued, expired, used and
     * collector-deleted, so the row says no more than the reply does.
     */
    const spent = async (): Promise<never> => {
      await auditRefusal(req.ip, 'zalo_ticket_spent');
      return reply.code(401).send(refusal('zalo_ticket_spent')) as never;
    };

    /**
     * Spent by the statement that reads it, and only the winner of
     * `ticket_used_at is null` proceeds: two requests carrying the same ticket
     * do not both get a token. Same shape as the sign-in code's single use.
     */
    const [used] = await db
      .update(schema.zaloSignIns)
      .set({ ticketUsedAt: new Date() })
      .where(
        and(
          eq(schema.zaloSignIns.ticketHash, ticketDigest(ticket)),
          isNull(schema.zaloSignIns.ticketUsedAt),
        ),
      )
      .returning({
        collectorId: schema.zaloSignIns.collectorId,
        expiresAt: schema.zaloSignIns.expiresAt,
      });
    if (used === undefined || used.collectorId === null) return spent();
    if (used.expiresAt.getTime() <= Date.now()) return spent();

    /**
     * The epoch is read now and not at the callback: a collector whose tokens
     * were revoked in the seconds between the two must not be handed a token
     * carrying the old number. It is also how a collector deleted in that
     * window becomes a refusal rather than a token naming nobody.
     */
    const [collector] = await db
      .select({ id: schema.collectors.id, epoch: schema.collectors.tokenEpoch })
      .from(schema.collectors)
      .where(eq(schema.collectors.id, used.collectorId));
    if (collector === undefined) return spent();

    await auditLogin(db, 'collector.login', 'collectors', collector.id, {
      collectorId: collector.id,
    });
    /**
     * Give back all three, not one. See `ZALO_HOP_REQUESTS`: this hop charged
     * the address once per request, and refunding a third of it made every
     * completed sign-in cost two — which is what filled a shared carrier
     * address at roughly the fifteenth collector.
     */
    for (let spent = 0; spent < ZALO_HOP_REQUESTS; spent += 1) options.limiter.succeeded(req.ip, []);
    return {
      token: signToken(options.tokenSecret, {
        kind: 'collector',
        collectorId: collector.id,
        epoch: collector.epoch,
      }),
    };
  });
}
