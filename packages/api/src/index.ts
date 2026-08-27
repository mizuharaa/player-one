import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { schema, seedCatalogues, type Db } from '@playerone/store';
import { auditLogin } from './audit.ts';
import { registerBackOffice } from './backoffice.ts';

export { API_REFUSALS, REFUSALS } from './backoffice.ts';
export { COUNTER_REFUSALS } from './counter.ts';
import { MACHINE_COOKIE, OPERATOR_COOKIE, parseCookies } from './cookies.ts';
import { registerConsole } from './console.ts';
import { registerCounter } from './counter.ts';
import { registerEpisodes } from './episodes.ts';
import { registerMedia } from './media.ts';
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
import type { ObjectStore, UploadProgress } from './upload-worker.ts';
import { authenticateMachine, authenticateOperator } from './session.ts';
import type { Actor, CounterActor } from './actor.ts';
import { signToken, verifyToken } from './credentials.ts';

export * from './credentials.ts';
export * from './audit.ts';
export type { Actor, CounterActor, ReviewerActor } from './actor.ts';
export * from './resolve.ts';
export * from './money.ts';
export { LEASE_MS } from './review.ts';
export { parseRange, safeJoin } from './media.ts';
export {
  noProgress,
  objectKey,
  planParts,
  PART_SIZE,
  S3ObjectStore,
  s3StoreFromEnv,
  transportInventory,
  uploadEpisode,
  type EpisodeUploadResult,
  type Mismatch,
  type ObjectStore,
  type PutResult,
  type TransportFile,
  type UploadProgress,
} from './upload-worker.ts';
export { MACHINE_COOKIE, OPERATOR_COOKIE, parseCookies } from './cookies.ts';
export { SIGN_IN_RATE_LIMITED, signInLimiter, type SignInLimiter } from './ratelimit.ts';
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
   * (PRODUCT.md:34). Defaults to `noProgress`, which remembers nothing and is
   * correct — see `UploadProgress`.
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
  const requireActor = async (req: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const person = verifyToken(tokenSecret, bearer(req, 'authorization', OPERATOR_COOKIE));

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
      const route = req.routeOptions.url ?? '';
      const inScope =
        route.startsWith(REVIEW_SCOPE) ||
        route === IDENTITY_ROUTE ||
        (reviewerMediaEnabled && route.startsWith(MEDIA_SCOPE));
      if (!inScope) return reply.code(403).send({ error: 'reviewer session is scoped to review' });
      req.actor = { reviewer: person };
      return;
    }

    const machine = verifyToken(tokenSecret, bearer(req, 'x-machine-token', MACHINE_COOKIE));
    if (machine?.kind !== 'machine') return reply.code(401).send({ error: 'machine token required' });
    if (person?.kind !== 'operator') return reply.code(401).send({ error: 'operator token required' });
    if (machine.uploadCentreId !== person.uploadCentreId) {
      return reply.code(403).send({ error: 'operator and machine belong to different centres' });
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

    const attempt = signInAttempt(db, limiter, req.ip, 'machine.login_failed', [machine_identifier]);
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

    const attempt = signInAttempt(db, limiter, req.ip, 'operator.login_failed', [external_ref]);
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

  registerBackOffice(app, db, requireActor);
  registerCounter(app, db, requireActor, currency);
  registerEpisodes(app, db, requireActor, toleranceMs);
  registerUpload(app, db, requireActor, { objectStore, mediaRoot, uploadProgress });
  registerReview(app, db, requireActor, { mediaRoot, currency, verificationGate, reviewerMediaEnabled });
  registerSettle(app, db, requireActor, { currency, cycleDays: settlementCycleDays });
  registerPayout(app, db, requireActor, {
    cycleDays: settlementCycleDays,
    ...payout,
    risk: payout.risk ?? riskReader,
    holdsEnabled: payout.holdsEnabled ?? risk.holdsEnabled,
  });
  registerRisk(app, db, requireActor, riskEngine);
  registerMedia(app, db, requireActor, mediaRoot);
  // One limiter for all four sign-in routes, so a guesser cannot get a fresh
  // budget by moving from the form to the JSON route.
  registerConsole(app, db, { tokenSecret, secureCookies, limiter });
  /** The JSON sign-in the React console uses. Same credentials, same cookies. */
  registerSessionRoutes(app, db, { tokenSecret, secureCookies, limiter });

  /**
   * Who the caller is. Proves both-tokens and centre scope on its own, with no
   * counter state needed — and, for a reviewer, is the only thing the console
   * can ask to find out it is signed in.
   */
  app.get(IDENTITY_ROUTE, { preHandler: requireActor }, async (req) => {
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
  });

  return app;
}

