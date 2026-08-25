import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { schema, seedCatalogues, type Db } from '@playerone/store';
import { auditLogin } from './audit.ts';
import { MACHINE_COOKIE, OPERATOR_COOKIE, parseCookies } from './cookies.ts';
import { registerConsole } from './console.ts';
import { registerCounter } from './counter.ts';
import { registerEpisodes } from './episodes.ts';
import { registerMedia } from './media.ts';
import { DEFAULT_TOLERANCE_MS } from './resolve.ts';
import { registerReview } from './review.ts';
import { registerSessionRoutes } from './session.ts';
import { registerUpload } from './upload.ts';
import type { ObjectStore, UploadProgress } from './upload-worker.ts';
import { authenticateMachine, authenticateOperator } from './session.ts';
import type { Actor } from './actor.ts';
import { signToken, verifyToken } from './credentials.ts';

export * from './credentials.ts';
export * from './audit.ts';
export type { Actor } from './actor.ts';
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
};

export function buildApi({
  db,
  tokenSecret,
  toleranceMs = DEFAULT_TOLERANCE_MS,
  mediaRoot,
  currency,
  secureCookies = false,
  objectStore,
  verificationGate,
  uploadProgress,
}: ApiOptions): FastifyInstance {
  if (!tokenSecret) throw new Error('tokenSecret is required');
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
    const machine = verifyToken(tokenSecret, bearer(req, 'x-machine-token', MACHINE_COOKIE));
    const operator = verifyToken(tokenSecret, bearer(req, 'authorization', OPERATOR_COOKIE));
    if (machine?.kind !== 'machine') return reply.code(401).send({ error: 'machine token required' });
    if (operator?.kind !== 'operator') return reply.code(401).send({ error: 'operator token required' });
    if (machine.uploadCentreId !== operator.uploadCentreId) {
      return reply.code(403).send({ error: 'operator and machine belong to different centres' });
    }
    req.actor = { machine, operator };
  };

  app.post('/auth/machine', async (req, reply) => {
    const { machine_identifier, secret } = (req.body ?? {}) as Record<string, string>;
    if (!machine_identifier || !secret) return reply.code(400).send({ error: 'missing credentials' });

    const claims = await authenticateMachine(db, machine_identifier, secret);
    if (claims === null) return reply.code(401).send({ error: 'invalid credentials' });
    return { token: signToken(tokenSecret, claims), upload_centre_id: claims.uploadCentreId };
  });

  app.post('/auth/operator', async (req, reply) => {
    const { external_ref, secret } = (req.body ?? {}) as Record<string, string>;
    if (!external_ref || !secret) return reply.code(400).send({ error: 'missing credentials' });

    const claims = await authenticateOperator(db, external_ref, secret);
    if (claims === null) return reply.code(401).send({ error: 'invalid credentials' });
    return { token: signToken(tokenSecret, claims), upload_centre_id: claims.uploadCentreId };
  });

  /**
   * Reference data for the offline cache. Scoped to the token's own centre —
   * the query parameter is checked against it, not trusted.
   */
  app.get('/reference/sync', { preHandler: requireActor }, async (req, reply) => {
    // BO-11 / SEC-02: the centre comes from the token, never from the request,
    // so an operator at centre A cannot address centre B by asking nicely.
    const centreId = (req.query as Record<string, string>)['centre_id'];
    if (centreId && centreId !== req.actor!.operator.uploadCentreId) {
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
      upload_centre_id: req.actor!.operator.uploadCentreId,
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
  app.addHook('onReady', () => seedCatalogues(db));

  registerCounter(app, db, requireActor);
  registerEpisodes(app, db, requireActor, toleranceMs);
  registerUpload(app, db, requireActor, { objectStore, mediaRoot, uploadProgress });
  registerReview(app, db, requireActor, { mediaRoot, currency, verificationGate });
  registerMedia(app, db, requireActor, mediaRoot);
  registerConsole(app, db, { tokenSecret, secureCookies });
  /** The JSON sign-in the React console uses. Same credentials, same cookies. */
  registerSessionRoutes(app, db, { tokenSecret, secureCookies });

  /** Proves both-tokens and centre scope on its own, with no counter state needed. */
  app.get('/whoami', { preHandler: requireActor }, async (req) => ({
    operator_id: req.actor!.operator.operatorId,
    upload_device_id: req.actor!.machine.uploadDeviceId,
    upload_centre_id: req.actor!.operator.uploadCentreId,
  }));

  return app;
}

