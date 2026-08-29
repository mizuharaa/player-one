import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { schema, seedCatalogues, type Db } from '@playerone/store';
import { registerAlerts } from './alerts.ts';
import { auditLogin } from './audit.ts';
import { registerBackOffice } from './backoffice.ts';

export { readAlerts, type Alert, type AlertState } from './alerts.ts';
export { API_REFUSALS, REFUSALS } from './backoffice.ts';
export { COUNTER_REFUSALS } from './counter.ts';
import { registerCollectorAuth, type SendSignInCode } from './collector.ts';
export {
  MAX_DELIVERY_BYTES,
  UPLOAD_API_REFUSALS,
  type CollectorUploadOptions,
  type FilePlan,
} from './collector-upload.ts';
import { registerCollectorUpload } from './collector-upload.ts';
import { MACHINE_COOKIE, OPERATOR_COOKIE, parseCookies } from './cookies.ts';
import { registerConsole } from './console.ts';
import { registerCounter } from './counter.ts';
import { registerEpisodes } from './episodes.ts';
import { registerMedia } from './media.ts';
import { registerMe } from './me.ts';
import { assertPayoutBootInvariants, payoutOptionsFromEnv, type PayoutOptions } from './payout/domain/config.ts';
import { registerPayout } from './payout/routes/payout.ts';
import { seedRiskSignals } from './risk/catalogue.ts';
import { riskConfigFromEnv, type RiskConfig } from './risk/config.ts';
import { RiskEngine } from './risk/engine.ts';
import { registerRisk } from './risk/routes.ts';
import { rateLimited, signInAttempt, signInLimiter } from './ratelimit.ts';
import { DEFAULT_TOLERANCE_MS } from './resolve.ts';
import { registerReview } from './review.ts';
import { registerSessionRoutes } from './session.ts';
import { registerSettle } from './settle.ts';
import { registerUpload } from './upload.ts';
import type { DirectUploadStore, ObjectStore, UploadProgress } from './upload-worker.ts';
import { authenticateMachine, authenticateOperator } from './session.ts';
import type { Actor, CounterActor } from './actor.ts';
import { signToken, verifyToken, type CollectorClaims } from './credentials.ts';

export * from './credentials.ts';
export * from './audit.ts';
export type { Actor, CollectorActor, CounterActor, ReviewerActor } from './actor.ts';
export * from './resolve.ts';
export * from './money.ts';
export { LEASE_MS, REVIEW_API_REFUSALS } from './review.ts';
export { REVIEW_HOLDABLE_REFUSALS } from './i18n.ts';
export { parseRange, safeJoin } from './media.ts';
export {
  noProgress,
  objectKey,
  planOpenUploads,
  planParts,
  verifyReadBack,
  PART_SIZE,
  PRESIGN_TTL_S,
  READBACK_STALLS,
  S3ObjectStore,
  s3StoreFromEnv,
  transportInventory,
  uploadEpisode,
  type DirectUploadStore,
  type EpisodeUploadResult,
  type Mismatch,
  type ObjectStore,
  type OpenUpload,
  type PutResult,
  type TransportFile,
  type UploadProgress,
} from './upload-worker.ts';
export { MACHINE_COOKIE, OPERATOR_COOKIE, parseCookies } from './cookies.ts';
export { SIGN_IN_RATE_LIMITED, signInLimiter, type SignInLimiter } from './ratelimit.ts';
export { CODE_ATTEMPTS, CODE_TTL_MS, type SendSignInCode } from './collector.ts';
export { PAYOUT_API_REFUSALS, PAYOUT_REFUSALS } from './payout/routes/payout.ts';
export { SETTLE_API_REFUSALS } from './settle.ts';
export { assertPayoutBootInvariants, payoutOptionsFromEnv, type PayoutOptions } from './payout/domain/config.ts';
export type { ZaloPayClient } from './payout/domain/client-contract.ts';
export type { RiskReader, RiskSummary, Flag } from './payout/domain/risk.ts';

/**
 * The operator API. The upload-centre console never touches Postgres — PRD
 * §11.3.2 rule 4 scopes those machines to controlled upload paths, and a
 * regional machine holding database credentials would make the PLT-08 audit
 * trail unenforceable. Console → here → DB, including for reads.
 */

/** Both tokens on every mutation: the machine proves where, the operator proves who. */
declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
    /**
     * The signed-in collector, and deliberately NOT a third case of `Actor`.
     *
     * `Actor` is who made an audited change. `mutate` reads it, `roleOf` reads
     * it, and every mutating route in this service reaches into
     * `actor.operator` or `actor.reviewer`. A collector makes no audited change
     * — there is no collector route that writes anything — so putting them in
     * that union would add a third case to every one of those readers today in
     * exchange for nothing, and each of those cases would be a guess about what
     * a collector's audit row looks like, written before anybody has decided.
     *
     * Keeping them out is also the stronger guarantee, and it is the one the
     * scoping rule wants: a collector never becomes an `Actor` at all, so no
     * route reading `actor.operator.uploadCentreId` can be handed one under any
     * circumstances, including a mistake in the route guard. Every existing
     * route sees `req.actor` unset and refuses.
     *
     * When collector mutations land — filing a dispute is the first — `Actor`
     * grows a third case, `mutate` grows the branch that says what that row
     * records, and the compiler names every reader that has to be told.
     */
    collector?: CollectorClaims;
  }
}

export type ApiOptions = {
  db: Db;
  /** Token signing key. Fails closed at construction rather than defaulting. */
  tokenSecret: string;
  /**
   * How close two app-origin sessions may start before an episode between them
   * is called ambiguous. Config because the pilot should tune it from observed
   * quarantine rates, not from a number chosen on paper — and it only ever bites
   * on app-origin sessions, which do not exist yet.
   */
  toleranceMs?: number;
  /**
   * Where the imported `ego_*` session folders live on this machine. The review
   * console streams footage from here; without it the metadata routes still
   * work and the stream route says so.
   */
  mediaRoot?: string;
  /**
   * What `tasks.unit_price` is denominated in. Configuration, because there is
   * no currency column on `tasks` — see `ReviewOptions`.
   */
  currency?: string;
  /**
   * Whether session cookies are marked `Secure`. Off by default: the pilot's
   * upload centres are a LAN over plain HTTP, where a `Secure` cookie is never
   * sent and the symptom is a login that appears to do nothing.
   */
  secureCookies?: boolean;
  /**
   * SET-07's settlement cycle, in days. Weekly is `[ASSUMED]` in the brief's
   * §13.2 rather than decided, so it is a parameter with a default and not a
   * constant somewhere in `settle.ts`.
   */
  settlementCycleDays?: number;
  /**
   * Where episodes are uploaded to and verified against (UPL-04/05). Absent
   * until the GreenNode contract yields an endpoint; the upload routes answer
   * 503 saying so. See `s3StoreFromEnv`.
   */
  objectStore?: ObjectStore;
  /**
   * Which integrity check QR-02's review gate reads. 'local' (default) is the
   * ADR 0001 deviation; 'cloud' requires `verification_state = 'verified'` and
   * retires that ADR. See `ReviewOptions.verificationGate`.
   */
  verificationGate?: 'local' | 'cloud';
  /**
   * Where the upload centre remembers what it has already transported
   * (PRODUCT.md:34). Defaults to `verificationReceipts`, this database's own
   * table: remembering nothing is still correct, but it costs a full re-read of
   * every object on every re-run — see `UploadProgress` and migration 0020.
   */
  uploadProgress?: UploadProgress;
  /**
   * Whether a reviewer session may reach `/media/*` — raw footage, streamed.
   *
   * **Default off, and it stays off until Legal signs the playback
   * architecture.** Brief D11 — *"whether background review requires online
   * playback of raw video"* — is recorded as unresolved and marked *"Escalate —
   * this is not a minor detail"*, precisely because it *"decides whether
   * reviewers stream video, and therefore whether video leaves Vietnam in
   * practice"*. Part 7.3 is the reason it matters: the Phase 1 arrangement is
   * *"remote access, not data transfer"*, and that distinction *"must hold in
   * the implementation, not just in the description"*.
   *
   * PLT-10 reviewers are PaXini staff in Shenzhen. Serving them a video byte
   * range is a cross-border transfer of raw Vietnamese-collected footage, so it
   * is refused by default rather than enabled by default and audited
   * afterwards. Review metadata, spans, reasons and verdicts carry no footage
   * and are open to a reviewer with this flag off — the lane still works, the
   * screen just has no picture until the question is answered.
   *
   * Counter operators are unaffected: they are inside Vietnam, on the machine
   * holding the files.
   */
  reviewerMediaEnabled?: boolean;
  /**
   * How a collector's one-time sign-in code reaches their phone (APP-01).
   *
   * Absent by default, and then `POST /auth/collector/request-code` answers 503
   * for every caller — there is no SMS gateway in this repository and no
   * contract behind one yet. Defaulting to a no-op would be worse: the route
   * would answer 204, which is what it answers on success, and a deployment
   * with no delivery would look exactly like a working one until a collector
   * said nobody ever sent them anything.
   *
   * It must return quickly. See `SendSignInCode`.
   */
  sendSignInCode?: SendSignInCode;
  /**
   * The payout rail (payout brief, §2.4). Defaults to what the environment
   * says, which defaults to `manual` on `sandbox`: the pilot shape, where an
   * operator moves the money and records the reference, and nothing here can
   * send a transfer. `PLAYERONE_PAYOUT_MODE=api` needs a production ZaloPay
   * environment with every credential present, or `buildApi` throws — see
   * `assertPayoutBootInvariants`.
   */
  payout?: PayoutOptions;
  /** Advisory risk evaluation and the reversible payout-hold switch. */
  risk?: RiskConfig;
};

/** What a reviewer session may reach. Everything else answers 403. */
const REVIEW_SCOPE = '/api/review/';
/** Raw footage. In scope for a reviewer only behind `reviewerMediaEnabled`. */
const MEDIA_SCOPE = '/media/';
/**
 * What a collector session may reach, and the whole of it.
 *
 * The prefix is the guard, exactly as `REVIEW_SCOPE` is for a reviewer: a
 * `/api/me/` route added next month is in scope by its path, and a route added
 * anywhere else is out of it without anybody remembering to say so. It cuts
 * both ways — an operator or reviewer token gets 403 here, because the routes
 * under it read the collector id off the token and there is no collector id on
 * either of those.
 */
const ME_SCOPE = '/api/me/';
/**
 * The one route outside the review lane a reviewer may call, named exactly and
 * not by prefix.
 *
 * The console's cookies are `HttpOnly`, so the browser cannot tell a signed-in
 * reviewer from a signed-out one without asking — and a 403 here would put the
 * SPA in a loop, bounced from the review screen to sign-in and straight back.
 * It answers with the caller's own identity and nothing else: no centre, no
 * fleet, no data.
 */
const IDENTITY_ROUTE = '/whoami';
/**
 * What a collector session may reach, and what nobody else may.
 *
 * APP-01. Every collector route lives under this prefix and **takes no
 * collector id** — not in the path, not in the query, not in the body. The id
 * comes off the token. That is not a convenience: it is why collector A cannot
 * read collector B's income. There is no id in the request to substitute,
 * so there is no comparison to forget to make and no route that can be added
 * next month with the comparison missing.
 *
 * Both halves are enforced below, and the second half is the one people forget:
 * an operator or reviewer token is refused here too. If a counter operator's
 * token also worked on `/api/me/income`, then "me" would mean the collector for
 * one caller and nobody in particular for another, and the routes would need
 * the collector id back in the request to say which — which is the whole design
 * undone.
 *
 * `/api/me` itself is the collector's identity route, so the check admits the
 * exact string as well as the prefix. It is spelled out rather than made a
 * `startsWith('/api/me')`, which would also admit `/api/method`.
 */
const COLLECTOR_SCOPE = '/api/me';
const inCollectorScope = (route: string): boolean =>
  route === COLLECTOR_SCOPE || route.startsWith(`${COLLECTOR_SCOPE}/`);

/** Whether this store can hand a signed URL to somebody who is not this process. */
const canPresign = (s: ObjectStore): s is ObjectStore & DirectUploadStore =>
  typeof (s as Partial<DirectUploadStore>).presignPut === 'function';

export function buildApi({
  db,
  tokenSecret,
  toleranceMs = DEFAULT_TOLERANCE_MS,
  mediaRoot,
  currency,
  secureCookies = false,
  settlementCycleDays,
  objectStore,
  verificationGate,
  uploadProgress,
  reviewerMediaEnabled = false,
  sendSignInCode,
  payout = payoutOptionsFromEnv(),
  risk = riskConfigFromEnv(),
}: ApiOptions): FastifyInstance {
  if (!tokenSecret) throw new Error('tokenSecret is required');
  /**
   * Two more service invariants, same shape as the one below: a live payout
   * path never runs on sandbox credentials, and production is never named
   * with a credential missing. Thrown here so an embedded caller cannot
   * assemble either combination.
   */
  assertPayoutBootInvariants(payout);
  /**
   * A service invariant, not an entrypoint check.
   *
   * `secureCookies` defaults off and that default is right for a pilot upload
   * centre: the LAN is plain HTTP and a `Secure` cookie is never sent at all,
   * which reads as a sign-in that silently does nothing. It is not right for a
   * service streaming raw Vietnamese-collected footage to Shenzhen on a
   * twelve-hour bearer cookie. Enforcing it here rather than in `bin/serve.ts`
   * means an embedded caller cannot assemble the insecure combination either.
   *
   * The message names the environment variable although this is a library,
   * because the only thing anybody will do with the error is set it.
   */
  if (reviewerMediaEnabled && !secureCookies) {
    throw new Error(
      'reviewerMediaEnabled requires secureCookies: streaming raw footage to a remote ' +
        'reviewer must not carry the session cookie in clear (PLAYERONE_SECURE_COOKIES=1, ' +
        'with TLS terminated in front of this process)',
    );
  }
  const app = Fastify({ logger: false });

  /**
   * HSTS, and only where TLS exists (SEC-09).
   *
   * `secureCookies` is already this repo's single "there is TLS in front of
   * this process" signal — it is what the reviewer-media refusal above reads,
   * and what `bin/serve.ts` sets from `PLAYERONE_SECURE_COOKIES`. So the header
   * follows it rather than becoming a second switch that can disagree with the
   * first.
   *
   * Not sent unconditionally, for two reasons. A browser ignores this header on
   * a plain-HTTP response, so on a LAN centre it would be decoration. And if
   * that centre ever puts one hostname behind TLS, a header it had been
   * emitting all along would pin every other path on that host to HTTPS for a
   * year, which is a centre-down event with no obvious cause. No `preload`: a
   * preload list entry is a submission nobody here has made.
   */
  if (secureCookies) {
    app.addHook('onRequest', async (_req, reply) => {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    });
  }

  /**
   * The token from a header, or failing that from the session cookie.
   *
   * The header is checked first so a machine client's explicit credential
   * always wins over a stale cookie left in the same browser. The cookie exists
   * because the console's `<video>` element and its unload beacon cannot set
   * headers at all — see `cookies.ts`.
   */
  const bearer = (req: FastifyRequest, header: string, cookie: string): string | undefined => {
    const raw = req.headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const fromHeader = value?.startsWith('Bearer ') ? value.slice(7) : value;
    if (fromHeader !== undefined && fromHeader !== '') return fromHeader;
    return parseCookies(req.headers.cookie)[cookie];
  };

  /**
   * PRD §8.3.2 rule 1: "Upload center operators must log in to fixed upload
   * devices before importing data." A machine token alone can do nothing.
   *
   * Both tokens must also name the SAME centre. Two valid tokens from different
   * centres is either a misconfigured machine or someone splicing credentials;
   * either way it is not a write we can attribute.
   */
  /**
   * Whether the person behind a valid token still works here (0017).
   *
   * `verifyToken` reads a signature and an expiry and never the row, so
   * retiring somebody stopped their next sign-in and left the token already in
   * their browser answering 200 for the rest of its twelve hours — measured.
   * One primary-key lookup per request is what makes `operators.status` mean
   * *now*. Not a token epoch and not a revocation list: both are a second
   * place for the same fact to live, and this one is already the record.
   */
  const stillEmployed = async (operatorId: string): Promise<boolean> => {
    const [row] = await db
      .select({ status: schema.operators.status })
      .from(schema.operators)
      .where(eq(schema.operators.id, operatorId));
    return row?.status === 'active';
  };

  const requireActor = async (req: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const person = verifyToken(tokenSecret, bearer(req, 'authorization', OPERATOR_COOKIE));
    const route = req.routeOptions.url ?? '';

    /**
     * APP-01 / SEC-01, and the only place the collector scope is enforced.
     *
     * Same shape as the reviewer branch below and for the same reason: the
     * scope is a prefix on the matched route pattern, so it is the string this
     * service registered and not one a caller composed, and a route added next
     * month is in scope or out of it by its path with nobody having to
     * remember a guard.
     *
     * The epoch costs one primary-key lookup per collector request, and it buys
     * revocation that bites now rather than in thirty days. A token is signed
     * once; `collectors.token_epoch` is read every time, so a phone reported
     * lost this morning is locked out this morning.
     */
    if (person?.kind === 'collector') {
      if (!(inCollectorScope(route) || route === IDENTITY_ROUTE)) {
        return reply.code(403).send({ error: 'collector session is scoped to /api/me' });
      }
      const [row] = await db
        .select({ epoch: schema.collectors.tokenEpoch })
        .from(schema.collectors)
        .where(eq(schema.collectors.id, person.collectorId));
      // A deleted collector and a revoked one get the same answer, and it is
      // 401 rather than 403: the token is no longer valid, and signing in again
      // is what fixes it.
      if (row === undefined || row.epoch !== person.epoch) {
        return reply.code(401).send({ error: 'collector token required' });
      }
      req.collector = person;
      return;
    }

    /**
     * The half people forget. Nobody but a collector reaches `/api/me/`.
     *
     * Without this, an operator or reviewer token would fall through to the
     * checks below, pass them, and land in a route whose whole contract is that
     * the caller is the collector the answer is about. "Me" would then mean two
     * things, and the routes would need a collector id back in the request to
     * say which — undoing the reason the prefix exists.
     *
     * 401 when there is no valid token at all and 403 when there is one of the
     * wrong kind. The app has to tell those apart: a thirty-day token expires
     * in somebody's pocket and the answer is to sign in again, which is not
     * what a 403 says. Neither answer distinguishes anything about a collector
     * — both are about the token the caller presented.
     */
    if (inCollectorScope(route)) {
      if (person === null) return reply.code(401).send({ error: 'collector token required' });
      return reply.code(403).send({ error: 'collector session required' });
    }

    /**
     * PLT-10, and the only place it is enforced.
     *
     * *"Remote access for PaXini reviewers in China, scoped to review functions
     * only, fully logged."* Scope is decided here, once, and not by an `if` at
     * the top of each review route: a route added next month is in scope or out
     * of it by its path, and nobody has to remember to guard it. The scope is a
     * prefix on the matched route pattern rather than on `req.url`, so it is the
     * string this service registered and not one a caller composed.
     *
     * Media is deliberately not in that scope by default — see
     * `reviewerMediaEnabled`, D11 and Part 7.3.
     */
    if (person?.kind === 'reviewer') {
      const inScope =
        route.startsWith(REVIEW_SCOPE) ||
        route === IDENTITY_ROUTE ||
        (reviewerMediaEnabled && route.startsWith(MEDIA_SCOPE));
      if (!inScope) return reply.code(403).send({ error: 'reviewer session is scoped to review' });
      if (!(await stillEmployed(person.reviewerId))) {
        return reply.code(401).send({ error: 'operator is no longer active' });
      }
      req.actor = { reviewer: person };
      return;
    }

    const machine = verifyToken(tokenSecret, bearer(req, 'x-machine-token', MACHINE_COOKIE));
    if (machine?.kind !== 'machine') return reply.code(401).send({ error: 'machine token required' });
    if (person?.kind !== 'operator') return reply.code(401).send({ error: 'operator token required' });
    if (machine.uploadCentreId !== person.uploadCentreId) {
      return reply.code(403).send({ error: 'operator and machine belong to different centres' });
    }
    if (!(await stillEmployed(person.operatorId))) {
      return reply.code(401).send({ error: 'operator is no longer active' });
    }
    req.actor = { machine, operator: person };
  };

  /**
   * SEC-03, on the four routes that check a credential. The malformed-request
   * 400 stays ahead of it: it costs nothing to answer, so it is not an attempt
   * worth counting or recording.
   */
  const limiter = signInLimiter();

  app.post('/auth/machine', async (req, reply) => {
    const { machine_identifier, secret } = (req.body ?? {}) as Record<string, string>;
    if (!machine_identifier || !secret) return reply.code(400).send({ error: 'missing credentials' });

    const attempt = signInAttempt(db, limiter, req.ip, 'machine.login_failed', [
      { id: machine_identifier, kind: 'machine' },
    ]);
    const wait = await attempt.blocked();
    if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));

    const claims = await authenticateMachine(db, machine_identifier, secret);
    if (claims === null) {
      await attempt.wrong();
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    attempt.ok();
    return { token: signToken(tokenSecret, claims), upload_centre_id: claims.uploadCentreId };
  });

  app.post('/auth/operator', async (req, reply) => {
    const { external_ref, secret } = (req.body ?? {}) as Record<string, string>;
    if (!external_ref || !secret) return reply.code(400).send({ error: 'missing credentials' });

    const attempt = signInAttempt(db, limiter, req.ip, 'operator.login_failed', [
      { id: external_ref, kind: 'operator' },
    ]);
    const wait = await attempt.blocked();
    if (wait !== null) return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));

    const claims = await authenticateOperator(db, external_ref, secret);
    if (claims === null) {
      await attempt.wrong();
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    attempt.ok();
    return { token: signToken(tokenSecret, claims), upload_centre_id: claims.uploadCentreId };
  });

  /**
   * Reference data for the offline cache. Scoped to the token's own centre —
   * the query parameter is checked against it, not trusted.
   */
  app.get('/reference/sync', { preHandler: requireActor }, async (req, reply) => {
    // BO-11 / SEC-02: the centre comes from the token, never from the request,
    // so an operator at centre A cannot address centre B by asking nicely.
    const actor = req.actor as CounterActor;
    const centreId = (req.query as Record<string, string>)['centre_id'];
    if (centreId && centreId !== actor.operator.uploadCentreId) {
      return reply.code(403).send({ error: 'not your centre' });
    }
    const [collectors, devices, tasks, scenarios] = await Promise.all([
      db.select().from(schema.collectors),
      db.select().from(schema.devices),
      db.select().from(schema.tasks),
      db.select().from(schema.scenarios),
    ]);
    return {
      fetched_at: new Date().toISOString(),
      upload_centre_id: actor.operator.uploadCentreId,
      collectors,
      devices,
      tasks,
      scenarios,
    };
  });

  /**
   * The catalogues are reference data the deployed code is the authority on, so
   * they are seeded on boot rather than by a step somebody has to remember.
   * `seedCatalogues` upserts, so this is idempotent and re-tunes routing to
   * match whatever version is running. Nothing read them before this: they were
   * exported, tested, and never called outside the test suite.
   */
  app.addHook('onReady', async () => {
    await seedCatalogues(db);
    await seedRiskSignals(db);
  });

  const riskEngine = new RiskEngine(db, {
    mediaRoot: risk.mediaRoot ?? mediaRoot,
    holdsEnabled: risk.holdsEnabled,
  });
  // The band the payout side reads means "there is a live hold", not "the score is in the hold band".
  const riskReader = { billSummary: (billId: string) => riskEngine.payoutSummary(billId) };

  registerAlerts(app, db, requireActor);
  registerBackOffice(app, db, requireActor);
  registerCounter(app, db, requireActor, currency);
  registerEpisodes(app, db, requireActor, toleranceMs);
  registerUpload(app, db, requireActor, { objectStore, mediaRoot, uploadProgress });
  /**
   * Path A needs more of the store than Path C does — it has to sign URLs for
   * a client that is not this process — and the fs-backed stub Path C's tests
   * use cannot sign anything. Rather than widen `objectStore` and force every
   * implementation to fake a protocol, the capability is detected: a store
   * that can presign gets the Path A routes a working cloud, one that cannot
   * gets the same 503 an absent store gets, saying so.
   */
  registerCollectorUpload(app, db, requireActor, {
    objectStore: objectStore !== undefined && canPresign(objectStore) ? objectStore : undefined,
  });
  registerReview(app, db, requireActor, { mediaRoot, currency, verificationGate, reviewerMediaEnabled });
  registerSettle(app, db, requireActor, { currency, cycleDays: settlementCycleDays });
  registerPayout(app, db, requireActor, {
    cycleDays: settlementCycleDays,
    ...payout,
    risk: payout.risk ?? riskReader,
    holdsEnabled: payout.holdsEnabled ?? risk.holdsEnabled,
  });
  /**
   * The collector's own money, under `/api/me/`. Given the SAME risk reader
   * and hold switch as the payout lane on purpose: it calls `loadBill`, so if
   * these options differed, a collector and the batch runner would disagree
   * about whether a bill can pay.
   */
  registerMe(app, db, requireActor, {
    risk: payout.risk ?? riskReader,
    holdsEnabled: payout.holdsEnabled ?? risk.holdsEnabled,
    capVnd: payout.capVnd,
  });
  registerRisk(app, db, requireActor, riskEngine);
  registerMedia(app, db, requireActor, mediaRoot);
  // One limiter for all six sign-in routes, so a guesser cannot get a fresh
  // budget by moving from the form to the JSON route.
  registerConsole(app, db, { tokenSecret, secureCookies, limiter });
  /** The JSON sign-in the React console uses. Same credentials, same cookies. */
  registerSessionRoutes(app, db, { tokenSecret, secureCookies, limiter });
  /** The collector's phone sign-in. Same limiter, same failed-sign-in rows. */
  registerCollectorAuth(app, db, { tokenSecret, limiter, sendSignInCode });

  /**
   * Who the caller is. Proves both-tokens and centre scope on its own, with no
   * counter state needed — and, for a reviewer, is the only thing the console
   * can ask to find out it is signed in.
   */
  const whoami = async (req: FastifyRequest) => {
    /**
     * A collector's identity is the id off their own token and nothing else.
     * No phone, no name, no status: the app already knows the number it signed
     * in with, and everything else is a collector-facing route that does not
     * exist yet.
     */
    const collector = req.collector;
    if (collector !== undefined) {
      return { role: 'collector', collector_id: collector.collectorId };
    }
    const actor = req.actor!;
    if (actor.reviewer !== undefined) {
      return { role: 'reviewer', reviewer_id: actor.reviewer.reviewerId };
    }
    return {
      role: 'operator',
      operator_id: actor.operator.operatorId,
      upload_device_id: actor.machine.uploadDeviceId,
      upload_centre_id: actor.operator.uploadCentreId,
    };
  };

  app.get(IDENTITY_ROUTE, { preHandler: requireActor }, whoami);
  /**
   * The same answer at the root of the collector scope, and the reason it is a
   * second path rather than only `/whoami`: the guard that refuses an operator
   * or a reviewer under `/api/me` cannot be proved by a test unless there is a
   * route under `/api/me` to refuse them on. Nothing else lives there yet.
   *
   * It is also the route the app will actually call. `/whoami` is the console's
   * — it is exempt from every scope precisely so a browser holding an
   * `HttpOnly` cookie can ask whether it is signed in — whereas the app holds
   * its own token and has no reason to leave its scope to ask who it is.
   */
  app.get(COLLECTOR_SCOPE, { preHandler: requireActor }, whoami);

  return app;
}

