import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { deriveEpisodeId, EpisodeRecord, parseSessionBasename } from '@playerone/contracts';
import { schema, storeEpisode, type Db } from '@playerone/store';
/**
 * The engine, reached exactly the way Path C's counter import reaches it
 * (`packages/api/bin/counter.ts`): the same relative import of the same
 * function. Not a fork and not a second entry point — `ingest(dir)` is what
 * measures a session directory, and the whole point of this lane is that a
 * phone-delivered session becomes an ordinary episode measured by that code.
 *
 * The dependency only ever points this way. The engine still never needs a
 * database (`env -u DATABASE_URL` keeps passing), because nothing here is
 * imported by it.
 */
import { ingest } from '../../ingest/src/ingest.ts';
import { sha256File } from '../../ingest/src/hash.ts';
import { mutate } from './audit.ts';
import { notify } from './notifications.ts';
import type { CollectorActor } from './actor.ts';
import { safeJoin } from './media.ts';
import {
  objectBudget,
  objectKey,
  planParts,
  verifyReadBack,
  PART_SIZE,
  PRESIGN_TTL_S,
  type DirectUploadStore,
  type Mismatch,
  type ObjectStore,
  type TransportFile,
} from './upload-worker.ts';

/**
 * Path A: the route a collector's phone uploads a recorded session by.
 *
 * UPL-01 and APP-26. Until this file existed the only way bytes reached the
 * platform was Path C — a TF card carried to an upload centre, imported by an
 * operator on a machine with both tokens. A phone has none of that, so none of
 * Path C's scoping applies to it.
 *
 * ---------------------------------------------------------------------------
 * Why the phone talks to storage and not to this service
 *
 * Part 8 of the brief measures a recorded hour at ~16 GB and a collector-day at
 * ~23 GB, over links that drop; the pilot is 20 devices and the target is 500
 * collectors. Fastify streaming those bytes would put the whole fleet's video
 * through one Node process, on its way to an object store the process then has
 * to write to anyway — twice the traffic, a request that cannot be resumed
 * without inventing a second resume protocol, and a service whose memory
 * profile is decided by how many phones are uploading.
 *
 * So the API never carries media on this path. It plans the upload, signs one
 * URL per part, and the phone PUTs to the store directly. Everything this
 * service handles on Path A is small JSON.
 *
 * ---------------------------------------------------------------------------
 * Why there is no second uploader
 *
 * Resume is `planParts` and the object store's own multipart state, which is
 * exactly what Path C already uses and for the reason `upload-worker.ts`
 * gives: the store is the one record that cannot disagree with the store. The
 * parts are planned from size alone, so a phone that is killed, reinstalled,
 * or offline for a day re-asks this service, gets the same boundaries, is told
 * which part numbers the cloud already holds, and sends only the rest.
 *
 * `objectKey` is shared too, so a session that arrives by phone and later by
 * card lands on the same keys and resolves to one episode (UPL-15).
 *
 * ---------------------------------------------------------------------------
 * Why the verdict is the same verdict
 *
 * UPL-04 says a checksum mismatch blocks review, and it must mean the same
 * thing on both paths. The digests are computed on the phone at source and
 * verified here by reading every object back and re-hashing it — `verifyReadBack`,
 * the same function Path C's worker calls. A mismatch writes
 * `episodes.verification_state = 'failed'`, which the review queue refuses
 * under either gate.
 *
 * ponytail: a signed URL stays usable for its hour even after the delivery has
 * verified, so a collector holding one could overwrite their own object inside
 * that window and leave `verification_state = 'verified'` standing over bytes
 * nobody checked. No URL is ever issued for a verified delivery again — the
 * resume route answers with an empty plan and a re-registration answers `done`
 * — so the window is one hour, once, and it belongs to the person whose own
 * footage it is. Closing it properly is a bucket that refuses to overwrite an
 * existing key, or object lock; both are storage configuration and neither is
 * something this service can assert on its own. Revisit when the storage
 * contract names what the bucket can be configured to do.
 *
 * Two things this file deliberately does NOT do:
 *
 *   - It does not derive an episode's state. `storeEpisode` owns that rule and
 *     is the only place it lives; this route hands it the record and takes
 *     what it decides.
 *   - It does not delete anything, anywhere, ever — and in particular it never
 *     tells a phone its copy is safe to remove. PRD §11.3.1 rule 6 is not
 *     deviable, and on Path A the phone IS the source media until somebody
 *     outside this system says otherwise.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };
/** A reply a handler answers 200 on directly, as Fastify hands it to one. */
type FullReply = Reply & { send: (b: unknown) => unknown };

/**
 * The refusals this file raises. Same shape and same purpose as `API_REFUSALS`
 * in backoffice.ts: they are things a person can ask for that the rules say no
 * to, each of them gets a sentence in `i18n.ts` in all three languages, and
 * none of them is a database constraint name — the two schema constraints
 * behind them (`collector_uploads_session_fk`, `collector_uploads_verified_key`)
 * exist so the refused state is unrepresentable, not so a route can catch it.
 */
export const UPLOAD_API_REFUSALS = new Set([
  'upload_unknown_session',
  'upload_foreign_session',
  'upload_already_complete',
  'upload_checksum_mismatch',
  'upload_payload_too_large',
  /** A redelivery landed while these bytes were moving; this verdict names an ingest that is no longer current. */
  'upload_superseded',
  /**
   * A session directory of that name is already on this machine holding
   * different bytes. Nothing was overwritten and nothing was ingested — the two
   * deliveries disagree about what the recording is, and only a person can say
   * which is real.
   */
  'upload_basename_collision',
  /**
   * Every byte verified against the phone's own digests, and then the engine
   * could not measure the directory they make. The objects stay, the
   * materialised copy stays, and nothing is deleted.
   */
  'upload_ingest_failed',
  /**
   * The directory the phone offered is not a session directory: the engine's
   * own naming rule (`parseSessionBasename`) does not recognise the name.
   *
   * The only refusal in this set that answers 400 rather than 409: the
   * contract froze it that way, because it is a malformed request and not a
   * rule refusing a well-formed one. It is in the set all the same, because
   * the name reaches the phone in `constraint` like every other refusal here
   * and a collector reads the sentence it maps to — so it needs one in all
   * three languages, which is what the i18n test over this set asserts.
   */
  'session_basename_unrecognised',
]);

/**
 * The most one registration may declare.
 *
 * Part 8: ~16 GB per recorded hour, ~23 GB per collector-day, and the device
 * segments video hourly. 64 GiB is therefore about four recorded hours in one
 * delivery — comfortably past anything the pilot produces and far short of a
 * number that could only come from a client that is wrong about itself.
 */
export const MAX_DELIVERY_BYTES = 64 * 1024 * 1024 * 1024;

/**
 * And the much smaller ceiling on a delivery this service has to MEASURE.
 *
 * A measured delivery costs this process one read-back: the bytes are hashed
 * as they stream and nothing is kept, so 64 GiB is a long request and not a
 * large one. An unmeasured delivery is read back, written to this machine's
 * disk, and then decoded by ffprobe inside the same request — the ceiling the
 * lane declared for synchronous ingest is ~200 MB, and declaring a ceiling
 * without enforcing it is how a demo discovers it at the worst moment.
 *
 * 200 MiB is about three minutes of Ego footage and about five times the
 * largest sample session, which is what the pilot's phone deliveries look
 * like. Past it the registration refuses by name before a byte moves, rather
 * than accepting a delivery whose `/complete` cannot finish inside a request.
 * The number goes up with the job table, not before it.
 */
export const MAX_UNMEASURED_DELIVERY_BYTES = 200 * 1024 * 1024;

export type CollectorUploadOptions = {
  /** Absent until a storage endpoint exists; the routes answer 503 saying so. */
  objectStore?: (ObjectStore & DirectUploadStore) | undefined;
  /**
   * Where this machine keeps the imported `ego_*` session folders — the same
   * directory Path C's cloud leg reads from and the review console streams
   * from. An unmeasured delivery is materialised into it and measured there,
   * so without it that half of this file answers 503 rather than inventing a
   * location. The measured path never touches it.
   */
  mediaRoot?: string | undefined;
};

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * A delivered file is one file in one directory, and its name is all it is.
 *
 * The engine's input contract (spec §3) is a flat session directory and
 * `transportInventory` is a flat scan of one, so a relative path carrying a
 * separator is not a layout the platform accepts from anybody.
 *
 * It is also the one field on this route that a client could use to reach
 * outside its own delivery. `objectKey` interpolates the path, so `../..` in
 * one would be a signed URL for another episode's object — a collector able to
 * overwrite footage that has already been reviewed and paid for. On Path C
 * these names come from a directory listing on a machine at an upload centre;
 * here they come off the network, and this is the difference.
 */
const RelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.includes('/') && !p.includes('\\') && !p.includes('\0'), {
    message: 'a delivered file name may not contain a path separator',
  })
  .refine((p) => p !== '.' && p !== '..', { message: 'not a file name' });

const DeclaredFile = z.object({
  relative_path: RelativePath,
  bytes: z.number().int().nonnegative(),
  sha256: Sha256,
});

const RegisterBody = z.object({
  /**
   * Client-generated, like every other mutation a disconnected client makes.
   * The phone registers, the link drops before the answer arrives, the queue
   * replays — and the same delivery has to land once. `collector_uploads.id`
   * is the primary key, which is what makes that true.
   */
  id: z.string().uuid(),
  collection_session_id: z.string().uuid(),
  /**
   * The finished measurement, exactly as Path C's console posts it. The phone
   * ran the engine over the session it pulled off the device; nothing here
   * re-measures it, and nothing here reads the state it asserts.
   */
  episode: EpisodeRecord,
  /**
   * The rest of the delivered directory — in practice the manifest, which
   * ING-02 keeps out of `source_files` and out of the fingerprint.
   *
   * Path C's `transportInventory` finds these by scanning the centre's disk.
   * There is no disk to scan here, so the phone declares them. The distinction
   * `transportInventory` draws holds on this path too: these digests are not
   * settled facts about the delivery's identity, they are what was transported.
   */
  extra_files: z.array(DeclaredFile).default([]),
  client_version: z.string().max(64).optional(),
});

/**
 * The second shape, and the one a phone can actually produce.
 *
 * There is no `episode` on it, and that absence is the discriminator. The
 * engine needs Node's fs and ffprobe to measure a session; an Android device
 * has neither, so everything the measured body asserts — duration, streams,
 * timing, state, fingerprint — is absent here by design and is measured by this
 * service after the bytes have been proven. Nothing in this schema could carry
 * a measurement even if a client wanted to send one.
 *
 * `session_basename` is the on-card directory name and the only identity in the
 * request. The episode id derives from it and from nothing else, exactly as it
 * does on every other path.
 */
const UnmeasuredBody = z.object({
  /** Client-generated, same as the measured shape and for the same reason. */
  id: z.string().uuid(),
  collection_session_id: z.string().uuid(),
  /**
   * Length-bounded because it becomes a directory name on this machine's disk
   * and a path segment in every object key. The *shape* is checked separately,
   * against the engine's own naming knowledge, so the refusal can be named.
   */
  session_basename: z.string().min(1).max(200),
  /**
   * EVERY file in the directory. Not `source_files`: the manifest is in here too.
   *
   * At least one. A delivery of nothing would verify — there is nothing to read
   * back — and then have the server create an empty session directory under the
   * media root for the engine to fail on, leaving a folder named after a
   * recording that was never delivered.
   */
  files: z.array(DeclaredFile).min(1),
  client_version: z.string().max(64).optional(),
});

/** What a phone declares about one file, before anything has measured it. */
type DeclaredFileRow = { relative_path: string; bytes: number; sha256: string };

/** One file of the delivery, and what the phone has to do about it. */
export type FilePlan = {
  relative_path: string;
  key: string;
  bytes: number;
  sha256: string;
  /** The store already holds this object at the declared size and digest. Send nothing. */
  done: boolean;
  /** Below `PART_SIZE`: one signed PUT of the whole object. */
  put_url?: string;
  /** At or above `PART_SIZE`: the multipart this delivery's parts belong to. */
  upload_id?: string;
  /** Part numbers the store already holds at the planned size. Nothing to re-send. */
  held_parts?: number[];
  /** A signed URL per part that is still missing, with the byte range it covers. */
  parts?: { part_number: number; start: number; end: number; bytes: number; url: string }[];
};

export function registerCollectorUpload(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: CollectorUploadOptions = {},
): void {
  const opts = { preHandler: requireActor };
  const ttl = PRESIGN_TTL_S;
  const ceiling = MAX_DELIVERY_BYTES;
  const unmeasuredCeiling = MAX_UNMEASURED_DELIVERY_BYTES;

  /**
   * The collector, always, and from the token only.
   *
   * There is no collector id in any path, query or body on this route file.
   * A client that could name a collector could name somebody else's, and every
   * ownership check below would then be checking a value the caller chose.
   */
  /**
   * `req.collector`, not `req.actor`. feat/collector-auth's requireActor sets
   * the collector claims there and returns before `req.actor` is ever
   * assigned, precisely so no handler expecting an operator can be handed one.
   * The route guard has already refused every other kind of session under
   * `/api/me/`, so the claims are present by the time anything here runs.
   */
  const actorOf = (req: FastifyRequest): CollectorActor => ({ collector: req.collector! });
  const collectorOf = (req: FastifyRequest): string => actorOf(req).collector.collectorId;

  const refused = (reply: Reply, constraint: string, detail: Record<string, unknown> = {}) =>
    reply.code(409).send({ error: 'refused', constraint, ...detail });

  const store = (reply: Reply): (ObjectStore & DirectUploadStore) | null => {
    if (options.objectStore === undefined) {
      reply.code(503).send({ error: 'no object store is configured on this service' });
      return null;
    }
    return options.objectStore;
  };

  /**
   * Everything the delivery has to put in the cloud: the files the fingerprint
   * covers, plus the remainder the phone declared. Sorted, so two calls plan
   * the same delivery in the same order and a phone comparing two answers sees
   * one list and not two.
   */
  const inventoryOf = (
    sourceFiles: readonly TransportFile[],
    extras: readonly TransportFile[],
  ): TransportFile[] =>
    [...sourceFiles, ...extras].sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));

  /** A declared file, as the transport sees it: a name and the digest to prove. */
  const transportOf = (f: DeclaredFileRow): TransportFile => ({
    relative_path: f.relative_path,
    sha256: f.sha256,
  });

  /**
   * The plan, freshly signed, for one delivery.
   *
   * Called on registration and again on every resume, and it is the same code
   * both times — which is what makes resume free rather than a second
   * protocol. The `head` check is the same "already there, do not re-send"
   * shortcut `S3ObjectStore.put` takes on Path C, and it is not the verdict:
   * metadata travels with the object, so a write that corrupted the bytes can
   * still carry a clean-looking digest. The verdict is the read-back in
   * `/complete`, which is the only thing that decides anything.
   *
   * `force` is that distinction made load-bearing, and it is the same flag and
   * the same argument as `ObjectStore.put`'s: after a delivery has failed
   * read-back, its object metadata is exactly what cannot be trusted, so the
   * shortcut must not be taken. Without it a phone told "your file did not
   * match" would ask for the plan again, be told every file was already there,
   * send nothing, and fail again forever — the metadata that made the shortcut
   * fire is the metadata of the object that is wrong.
   */
  async function planFor(
    s: DirectUploadStore,
    episodeId: string,
    ingestId: string,
    files: readonly TransportFile[],
    sizes: ReadonlyMap<string, number>,
    force = false,
  ): Promise<FilePlan[]> {
    const plan: FilePlan[] = [];
    for (const f of files) {
      const key = objectKey(episodeId, ingestId, f.relative_path);
      const bytes = sizes.get(f.relative_path) ?? 0;
      const base = { relative_path: f.relative_path, key, bytes, sha256: f.sha256 };

      const existing = force ? null : await s.head(key);
      if (existing !== null && existing.bytes === bytes && existing.sha256 === f.sha256) {
        plan.push({ ...base, done: true });
        continue;
      }

      if (bytes < PART_SIZE) {
        plan.push({ ...base, done: false, put_url: await s.presignPut(key, f.sha256, ttl) });
        continue;
      }

      const uploadId = await s.beginMultipart(key, f.sha256);
      const held = new Map((await s.heldParts(key, uploadId)).map((p) => [p.partNumber, p.size]));
      const heldNumbers: number[] = [];
      const parts: NonNullable<FilePlan['parts']> = [];
      for (const p of planParts(bytes)) {
        const size = p.end - p.start;
        // Number AND size: a part the cloud holds at a different size is a part
        // from an attempt that planned differently, and re-sending it is the
        // only safe answer.
        if (held.get(p.partNumber) === size) {
          heldNumbers.push(p.partNumber);
          continue;
        }
        parts.push({
          part_number: p.partNumber,
          start: p.start,
          end: p.end,
          bytes: size,
          url: await s.presignPart(key, uploadId, p.partNumber, ttl),
        });
      }
      plan.push({ ...base, done: false, upload_id: uploadId, held_parts: heldNumbers, parts });
    }
    return plan;
  }

  /**
   * Assembly, for the files that were sent in parts. Shared by both delivery
   * shapes: how a multipart is finished has nothing to do with who measured it.
   *
   * `openMultipart` rather than `beginMultipart`: this step must never start an
   * upload. A file with nothing in flight is a file the phone has not sent, or
   * one already assembled by an earlier attempt at this delivery, and neither
   * wants an empty multipart left in the bucket.
   *
   * There is deliberately no "the object is already there, skip it" check. An
   * object being there is not a reason not to assemble: after a failed
   * read-back the object that is there is the wrong one, and the phone has just
   * re-sent every part into a new multipart precisely to replace it.
   *
   * The part count is checked against the plan before assembling. Completing a
   * short upload would produce a truncated object that then fails read-back,
   * which is the correct verdict reached the expensive way; not assembling it
   * at all reaches the same verdict without writing anything.
   */
  async function assemble(
    s: DirectUploadStore,
    files: readonly TransportFile[],
    sizes: ReadonlyMap<string, number>,
    keyOf: (relativePath: string) => string,
  ): Promise<void> {
    for (const f of files) {
      const bytes = sizes.get(f.relative_path) ?? 0;
      if (bytes < PART_SIZE) continue;
      const key = keyOf(f.relative_path);
      const uploadId = await s.openMultipart(key);
      if (uploadId === null) continue;
      const held = await s.heldParts(key, uploadId);
      if (held.length < planParts(bytes).length) continue;
      await s.finishMultipart(key, uploadId);
    }
  }

  /**
   * The upload row, scoped to the caller. Undefined for anyone else's id and
   * for an id that is not a uuid at all — `collector_uploads.id` is a `uuid`
   * column, so an unparseable one is a cast error raised by Postgres, which is
   * a 500 on a request that a stale link is enough to produce.
   */
  const uploadOf = async (id: string, collectorId: string) => {
    if (!z.string().uuid().safeParse(id).success) return undefined;
    const [row] = await db
      .select()
      .from(schema.collectorUploads)
      .where(
        and(
          eq(schema.collectorUploads.id, id),
          eq(schema.collectorUploads.collectorId, collectorId),
        ),
      );
    return row;
  };

  /**
   * The inventory of a registered upload, rebuilt from what was stored.
   *
   * A measured delivery's inventory is the fingerprinted files from
   * `episode_files` — the same rows the fingerprint is recomputable from — plus
   * the declared remainder off the upload row. An unmeasured one has neither
   * until the engine has run, so it is `declared_files`, which is the whole
   * delivery as the phone described it and the only record of it that exists
   * before the measurement.
   */
  const storedInventory = async (row: {
    measured: boolean;
    ingestId: string | null;
    extraFiles: unknown;
    declaredFiles: unknown;
  }): Promise<{ files: TransportFile[]; sizes: Map<string, number> }> => {
    const sizes = new Map<string, number>();
    if (!row.measured) {
      const declared = DeclaredFile.array().parse(row.declaredFiles ?? []);
      for (const f of declared) sizes.set(f.relative_path, f.bytes);
      return { files: inventoryOf(declared.map(transportOf), []), sizes };
    }
    const rows = await db
      .select({
        relativePath: schema.episodeFiles.relativePath,
        sizeBytes: schema.episodeFiles.sizeBytes,
        sha256: schema.episodeFiles.sha256,
      })
      .from(schema.episodeFiles)
      .where(eq(schema.episodeFiles.ingestId, row.ingestId!));
    const extras = DeclaredFile.array().parse(row.extraFiles ?? []);
    for (const r of rows) sizes.set(r.relativePath, r.sizeBytes);
    for (const e of extras) sizes.set(e.relative_path, e.bytes);
    const files = inventoryOf(
      rows.map((r) => ({ relative_path: r.relativePath, sha256: r.sha256 })),
      extras.map((e) => ({ relative_path: e.relative_path, sha256: e.sha256 })),
    );
    return { files, sizes };
  };

  /**
   * The two halves of an object key for one delivery, whichever shape it is.
   *
   * A measured delivery has an ingest id from the moment it registers, and
   * `objectKey`'s rule holds unchanged: one ingest, one prefix, forever, so a
   * session arriving by card and by phone lands on one object set.
   *
   * An unmeasured delivery has no ingest id — the measurement that mints one
   * has not happened — so the prefix is the UPLOAD id, which is the only thing
   * unique to this delivery before the engine has run. The guarantee that
   * matters is preserved exactly: one delivery, one prefix, and it can never
   * overwrite another delivery's objects, because no other delivery has that
   * upload id. What is NOT preserved is the second half of UPL-15, that a phone
   * delivery and a card delivery of one session share their keys. It cannot be:
   * the shared segment is the ingest id and there is no ingest id yet, and
   * guessing one by reusing an existing episode's would mean planning signed
   * PUTs over objects that have already been reviewed and paid for.
   *
   * ponytail: the consequence is that a later Path C run over the same episode
   * re-uploads from `mediaRoot` under the canonical prefix rather than
   * recognising these objects. That costs one upload of a session that is
   * already on this machine's disk, and it never destroys anything. Closing it
   * properly means a server-side copy to the canonical prefix after the ingest,
   * which is a second transfer of every byte for a bookkeeping tidiness nobody
   * has asked for yet.
   */
  const deliveryOf = (row: {
    id: string;
    measured: boolean;
    episodeId: string | null;
    ingestId: string | null;
    sourceBasename: string;
  }): { episodeId: string; deliveryId: string } => ({
    episodeId: row.episodeId ?? deriveEpisodeId(row.sourceBasename),
    deliveryId: row.measured ? row.ingestId! : row.id,
  });

  /**
   * The session the caller named, if it is theirs. Null when it is refused, and
   * the refusal has already been sent.
   *
   * Shared by both registration shapes because the rule is the same one and has
   * to stay one rule: the token's collector against the session's, and no other
   * comparison is possible because the caller never supplied a collector id.
   */
  const sessionFor = async (
    reply: Reply,
    sessionId: string,
    collectorId: string,
  ): Promise<{ id: string } | null> => {
    const [session] = await db
      .select({
        id: schema.collectionSessions.id,
        collectorId: schema.collectionSessions.collectorId,
      })
      .from(schema.collectionSessions)
      .where(eq(schema.collectionSessions.id, sessionId));
    if (session === undefined) {
      refused(reply, 'upload_unknown_session', { collection_session_id: sessionId });
      return null;
    }
    if (session.collectorId !== collectorId) {
      refused(reply, 'upload_foreign_session', { collection_session_id: sessionId });
      return null;
    }
    return { id: session.id };
  };

  /** What every answer about one upload carries, whichever shape it is. */
  const stateOf = (row: {
    state: string;
    measured: boolean;
    episodeId: string | null;
    ingestId: string | null;
    heldReason: string | null;
    failedReason: string | null;
    collectionSessionId: string;
    sourceBasename: string;
  }) => ({
    state: row.state,
    measured: row.measured,
    /**
     * Derived from the basename when the row does not carry it yet, which is
     * every unmeasured delivery before its ingest. It is the same value the
     * object keys already contain and the same value the episode will have, so
     * answering null here would hide an id the caller has been handed anyway.
     * `ingest_id` is the field that stays null, because an ingest is a
     * measurement and no measurement has happened.
     */
    episode_id: row.episodeId ?? deriveEpisodeId(row.sourceBasename),
    ingest_id: row.ingestId,
    held_reason: row.heldReason,
    failed_reason: row.failedReason,
    collection_session_id: row.collectionSessionId,
    session_basename: row.sourceBasename,
    upload_path: 'A' as const,
  });

  /**
   * An unmeasured delivery of this session that has already become an episode.
   *
   * Looked up by basename rather than by episode id because the episode id is
   * derived from the basename and the basename is what the row stores: one
   * query, one column, and no dependence on whether the episode row exists yet.
   */
  const ingestedAlready = async (sourceBasename: string, collectorId: string) => {
    const [row] = await db
      .select({
        id: schema.collectorUploads.id,
        collectorId: schema.collectorUploads.collectorId,
        episodeId: schema.collectorUploads.episodeId,
      })
      .from(schema.collectorUploads)
      .where(
        and(
          eq(schema.collectorUploads.sourceBasename, sourceBasename),
          eq(schema.collectorUploads.state, 'ingested'),
        ),
      );
    if (row === undefined) return undefined;
    /**
     * The scan is deliberately not scoped to the caller — the rule is one
     * episode per recording, whoever delivered it, and a second delivery of a
     * session somebody else already ingested has to be refused too. But the
     * ANSWER is scoped: `upload_id` is another collector's delivery id, which
     * is not this collector's to be told. The episode id is derived from the
     * basename the caller supplied, so it tells them nothing they did not
     * already have.
     */
    return {
      episodeId: row.episodeId,
      uploadId: row.collectorId === collectorId ? row.id : undefined,
    };
  };

  // -------------------------------------------------------------------------

  /**
   * The registration a phone can actually make: UNMEASURED.
   *
   * Nothing in the body is a measurement and nothing here produces one. What
   * arrives is the session directory's name, and every file in it with its size
   * and its sha256 — which is all a phone can honestly say, because the only
   * thing it can do to a file it cannot decode is hash it.
   *
   * The episode id is derived from `session_basename` here so the object keys
   * can exist, and that is the only thing derived from it. No `episodes` row is
   * written: an episode that exists before anything measured it would sit in
   * front of the review queue with no duration, and `storeEpisode` — which owns
   * the rule about what an episode's state is — has nothing to be given yet.
   */
  const registerUnmeasured = async (req: FastifyRequest, reply: FullReply) => {
    const parsed = UnmeasuredBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid body', detail: parsed.error.issues.slice(0, 5) });
    }
    const s = store(reply);
    if (s === null) return reply;
    const body = parsed.data;
    const collectorId = collectorOf(req);

    /**
     * The naming rule, and it is the engine's own — `parseSessionBasename` in
     * `@playerone/contracts`, which is the function `deriveEpisodeId` parses
     * with and which `packages/ingest` carries its knowledge of the layout in.
     * A name this does not recognise is not a session directory, and accepting
     * one would mean a `raw:` identity string, a directory of that name created
     * on this machine's disk, and an episode nobody can attribute to a device.
     */
    /**
     * Two questions about one string, and both have to be asked here.
     *
     * `parseSessionBasename` says whether this is a session directory name. It
     * does NOT say whether it is a single path segment: its serial group is
     * permissive, so `ego_a/../x_20260813_072310` parses, and that name becomes
     * a directory created wherever the traversal points and an `episode_id`
     * the engine then derives differently — an uncaught throw at the guard
     * below, which is a 500 on a request a client chose. `RelativePath` is the
     * same check the delivered file names get, for the same reason: on Path C
     * these names come off a directory listing, here they come off the network.
     *
     * One refusal for both, because from a collector's side they are one fact:
     * that is not a recording folder.
     */
    const identity = parseSessionBasename(body.session_basename);
    if (identity === null || !RelativePath.safeParse(body.session_basename).success) {
      /**
       * 400, as the contract froze it, but shaped like every other refusal in
       * this file: the name goes in `constraint`, which is the field the phone
       * reads a refusal name out of. Under `error` the name reached it as an
       * unrecognised body and was flattened to a generic "invalid request",
       * which loses the one thing this refusal has to say — that the directory
       * the collector picked is not a session directory.
       */
      return reply.code(400).send({
        error: 'refused',
        constraint: 'session_basename_unrecognised',
        session_basename: body.session_basename,
        expected: '<device>_<SERIAL>_<YYYYMMDD>_<HHMMSS>',
      });
    }

    /**
     * The delivery is a flat directory, so two files cannot share a name. Left
     * unchecked, `file_count` would count a file the directory will not hold
     * and the plan would sign two URLs for one key.
     */
    const seen = new Set<string>();
    const duplicate = body.files.find((f) => (seen.has(f.relative_path) ? true : (seen.add(f.relative_path), false)));
    if (duplicate !== undefined) {
      return reply.code(400).send({
        error: 'a file is declared twice',
        relative_path: duplicate.relative_path,
      });
    }

    /**
     * The smaller ceiling, because this service measures this one. Same
     * refusal name as the measured path — from the collector's side it is the
     * same sentence, "that is more than one upload may carry" — with the limit
     * that actually applied in the body.
     */
    const totalBytes = body.files.reduce((n, f) => n + f.bytes, 0);
    if (totalBytes > unmeasuredCeiling) {
      return refused(reply, 'upload_payload_too_large', {
        declared_bytes: totalBytes,
        limit_bytes: unmeasuredCeiling,
      });
    }

    /** A replay, or a second attempt at a delivery that is already up. */
    const [existing] = await db
      .select()
      .from(schema.collectorUploads)
      .where(eq(schema.collectorUploads.id, body.id));
    if (existing !== undefined) {
      if (existing.collectorId !== collectorId) {
        return reply.code(404).send({ error: 'no such upload' });
      }
      if (existing.measured) {
        return reply.code(400).send({
          error: 'that upload id was registered as a measured delivery',
          upload_id: existing.id,
        });
      }
      if (existing.state === 'ingested') {
        return refused(reply, 'upload_already_complete', {
          upload_id: existing.id,
          episode_id: existing.episodeId,
        });
      }
      const { files, sizes } = await storedInventory(existing);
      const at = deliveryOf(existing);
      return reply.send({
        upload_id: existing.id,
        replayed: true,
        ...stateOf(existing),
        part_size: PART_SIZE,
        expires_in_s: ttl,
        files: await planFor(
          s,
          at.episodeId,
          at.deliveryId,
          files,
          sizes,
          existing.state === 'failed',
        ),
      });
    }

    const session = await sessionFor(reply, body.collection_session_id, collectorId);
    if (session === null) return reply;

    /**
     * The same session, already measured and stored by an earlier delivery.
     *
     * The honest answer is that there is nothing to do. Planning it anyway
     * would have the phone re-send a whole session into a fresh prefix and then
     * be refused at `/complete` by `collector_uploads_ingested_key`, which is
     * the right verdict reached after the expensive part.
     */
    const already = await ingestedAlready(body.session_basename, collectorId);
    if (already !== undefined) {
      return refused(reply, 'upload_already_complete', {
        ...(already.uploadId === undefined ? {} : { upload_id: already.uploadId }),
        episode_id: already.episodeId,
      });
    }

    const episodeId = deriveEpisodeId(body.session_basename);

    /** The platform row this serial names, when the fleet has one. Evidence either way. */
    const [device] = await db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.hardwareSerial, identity.serial));

    const written = await mutate(
      db,
      actorOf(req),
      {
        action: 'upload.register',
        targetTable: 'collector_uploads',
        targetId: body.id,
        after: {
          measured: false,
          state: 'registered',
          session_basename: body.session_basename,
          episode_id: episodeId,
          collection_session_id: body.collection_session_id,
          device_serial: identity.serial,
          device_id: device?.id ?? null,
          file_count: body.files.length,
          total_bytes: totalBytes,
          client_version: body.client_version ?? null,
        },
      },
      async (tx) => {
        const [row] = await tx
          .insert(schema.collectorUploads)
          .values({
            id: body.id,
            collectorId,
            collectionSessionId: body.collection_session_id,
            deviceSerial: identity.serial,
            deviceId: device?.id ?? null,
            measured: false,
            episodeId: null,
            ingestId: null,
            sourceBasename: body.session_basename,
            fileCount: body.files.length,
            totalBytes,
            extraFiles: [],
            declaredFiles: body.files,
            clientVersion: body.client_version ?? null,
          })
          .returning();
        return row;
      },
    );
    if (written === undefined) throw new Error('the registration wrote nothing');

    const sizes = new Map(body.files.map((f) => [f.relative_path, f.bytes]));
    return reply.send({
      upload_id: body.id,
      replayed: false,
      ...stateOf(written),
      part_size: PART_SIZE,
      expires_in_s: ttl,
      files: await planFor(s, episodeId, body.id, body.files.map(transportOf), sizes),
    });
  };

  // -------------------------------------------------------------------------

  /**
   * UPL-01, the registration. What a phone sends before it sends any bytes.
   *
   * The answer is everything it needs and nothing it could have chosen: the
   * object keys, the part boundaries, one signed URL per part still missing,
   * and which parts the store already holds.
   *
   * Two body shapes, discriminated on the presence of `episode` — measured, the
   * original, where the phone ran the engine and posted a finished record; and
   * unmeasured, where it could not and this service measures instead. The
   * discriminator is a field's presence rather than a `kind` tag because the
   * measured shape is already deployed and a tag would have had to be optional,
   * which is the same test written less directly.
   */
  app.post('/api/me/uploads', opts, async (req, reply) => {
    const raw = req.body;
    if (typeof raw === 'object' && raw !== null && !('episode' in raw)) {
      return registerUnmeasured(req, reply);
    }
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid body', detail: parsed.error.issues.slice(0, 5) });
    }
    const s = store(reply);
    if (s === null) return reply;

    const collectorId = collectorOf(req);
    const body = parsed.data;
    const record = body.episode;

    /**
     * The same re-derivation Path C does, for the same reason: `episode_id` is
     * global, so a caller who could choose it could name somebody else's
     * episode and, one transaction later, attach it to their own session. The
     * id is a pure function of the basename and the engine computes it with
     * this function, so a record that disagrees with itself is refused rather
     * than reconciled.
     */
    const expected = deriveEpisodeId(basename(record.source.path));
    if (record.episode_id !== expected) {
      return reply.code(400).send({
        error: 'episode_id does not derive from the source basename',
        expected_episode_id: expected,
      });
    }

    const fingerprinted = new Set(record.source_files.map((f) => f.relative_path));
    const clash = body.extra_files.find((f) => fingerprinted.has(f.relative_path));
    if (clash !== undefined) {
      return reply.code(400).send({
        error: 'a file is declared both in source_files and in extra_files',
        relative_path: clash.relative_path,
      });
    }

    const declared = [...record.source_files, ...body.extra_files];
    /**
     * `extra_files` is checked by its own schema; `source_files` comes through
     * `EpisodeRecord`, whose `relative_path` is a plain string because on every
     * other path it was produced by a directory scan. Here it was not.
     */
    const unsafe = declared.find((f) => !RelativePath.safeParse(f.relative_path).success);
    if (unsafe !== undefined) {
      return reply.code(400).send({
        error: 'a delivered file name may not contain a path separator',
        relative_path: unsafe.relative_path,
      });
    }
    const totalBytes = declared.reduce((n, f) => n + f.bytes, 0);
    if (totalBytes > ceiling) {
      return refused(reply, 'upload_payload_too_large', {
        declared_bytes: totalBytes,
        limit_bytes: ceiling,
      });
    }

    /**
     * A replay, or a second attempt at a delivery that is already up.
     *
     * Looked up by id alone and then checked against the caller, so an id that
     * belongs to somebody else answers 404 rather than colliding on the
     * primary key two statements later.
     */
    const [existing] = await db
      .select()
      .from(schema.collectorUploads)
      .where(eq(schema.collectorUploads.id, body.id));
    if (existing !== undefined) {
      if (existing.collectorId !== collectorId) {
        return reply.code(404).send({ error: 'no such upload' });
      }
      if (!existing.measured) {
        return reply.code(400).send({
          error: 'that upload id was registered as an unmeasured delivery',
          upload_id: existing.id,
        });
      }
      if (existing.state === 'verified') {
        return refused(reply, 'upload_already_complete', {
          upload_id: existing.id,
          episode_id: existing.episodeId,
        });
      }
      const { files, sizes } = await storedInventory(existing);
      const at = deliveryOf(existing);
      return reply.send({
        upload_id: existing.id,
        replayed: true,
        episode_id: existing.episodeId,
        ingest_id: existing.ingestId,
        collection_session_id: existing.collectionSessionId,
        upload_path: 'A',
        part_size: PART_SIZE,
        expires_in_s: ttl,
        files: await planFor(
          s,
          at.episodeId,
          at.deliveryId,
          files,
          sizes,
          existing.state === 'failed',
        ),
      });
    }

    /**
     * The token's collector against the session's, and no other comparison is
     * possible: the caller never supplied a collector id. The composite
     * `collector_uploads_session_fk` says the same thing to Postgres, so the
     * refused state cannot be written by any other writer either. One copy of
     * that rule, shared with the unmeasured registration.
     */
    if ((await sessionFor(reply, body.collection_session_id, collectorId)) === null) return reply;

    /**
     * The measurement is stored by the code that owns that job, exactly as
     * Path C does. It runs its own transaction, handles the three redelivery
     * cases, and decides the stored state — this route does not, and must not
     * start: a second place that reads a record's asserted state is a second
     * place a client can carry a defect and deny the consequence.
     *
     * A duplicate delivery returns the EXISTING ingest id, so the object keys
     * are the keys the first delivery already used and a session that arrives
     * by phone and by card is one episode and one object set (UPL-15).
     */
    const stored = await storeEpisode(db, record);
    if (stored.ingestId === null) {
      throw new Error(`storeEpisode returned no ingest for ${stored.episodeId}`);
    }
    const ingestId = stored.ingestId;

    /** The platform row this serial names, when the fleet has one. Evidence either way. */
    const [device] = await db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.hardwareSerial, record.device.serial));

    const written = await mutate(
      db,
      actorOf(req),
      {
        action: 'upload.register',
        targetTable: 'collector_uploads',
        targetId: body.id,
        after: {
          episode_id: stored.episodeId,
          ingest_id: ingestId,
          collection_session_id: body.collection_session_id,
          outcome: stored.outcome,
          source_basename: record.source.path,
          device_serial: record.device.serial,
          device_id: device?.id ?? null,
          file_count: declared.length,
          total_bytes: totalBytes,
          client_version: body.client_version ?? null,
        },
      },
      async (tx) => {
        /**
         * `upload_path is null` is the whole guard, and it is doing real work.
         *
         * An episode already imported at a counter carries `upload_path = 'C'`
         * and a session an operator resolved it to. A phone uploading the same
         * session afterwards must not move that attribution: the counter's
         * answer was made against the card, with a handover behind it, and
         * settlement has possibly already read it. So the bytes are still
         * accepted — the keys are the same and the transport is idempotent —
         * and the attribution is left exactly where it was.
         */
        const [attributed] = await tx
          .update(schema.episodes)
          .set({
            collectionSessionId: body.collection_session_id,
            resolutionState: 'resolved',
            resolutionMethod: 'app_declared',
            uploadPath: 'A',
          })
          .where(
            and(
              eq(schema.episodes.episodeId, stored.episodeId),
              isNull(schema.episodes.uploadPath),
            ),
          )
          .returning();

        const [row] = await tx
          .insert(schema.collectorUploads)
          .values({
            id: body.id,
            collectorId,
            collectionSessionId: body.collection_session_id,
            deviceSerial: record.device.serial,
            deviceId: device?.id ?? null,
            episodeId: stored.episodeId,
            ingestId,
            sourceBasename: record.source.path,
            fileCount: declared.length,
            totalBytes,
            extraFiles: body.extra_files,
            clientVersion: body.client_version ?? null,
          })
          .returning();
        return { row, attributed };
      },
    );
    if (written === undefined) throw new Error('the registration wrote nothing');

    const sizes = new Map(declared.map((f) => [f.relative_path, f.bytes]));
    const files = inventoryOf(record.source_files, body.extra_files);
    return reply.send({
      upload_id: body.id,
      replayed: false,
      episode_id: stored.episodeId,
      ingest_id: ingestId,
      outcome: stored.outcome,
      collection_session_id: body.collection_session_id,
      upload_path: 'A',
      /**
       * Whether THIS upload is what put the episode on that session, or whether
       * it was already attributed — by a counter, or by an earlier attempt. The
       * phone shows the collector the session the platform actually holds, not
       * the one it asked for.
       */
      attributed: written.attributed !== undefined,
      part_size: PART_SIZE,
      expires_in_s: ttl,
      files: await planFor(s, stored.episodeId, ingestId, files, sizes),
    });
  });

  /**
   * APP-26: what a phone asks after it was killed, reinstalled, or offline for
   * a day.
   *
   * The same plan, freshly signed, with `done` and `held_parts` recomputed from
   * the store. No state is kept on the phone's behalf and none is needed: the
   * boundaries come from `planParts`, which is a function of size alone, and
   * what the cloud holds comes from the cloud.
   *
   * It is also the progress endpoint for an unmeasured delivery, which is why
   * `state`, `held_reason`, `failed_reason` and `episode_id` are on the answer:
   * the phone asks this after `/complete` to see what the server made of its
   * bytes.
   */
  app.get('/api/me/uploads/:id', opts, async (req, reply) => {
    const s = store(reply);
    if (s === null) return reply;
    const row = await uploadOf((req.params as { id: string }).id, collectorOf(req));
    if (row === undefined) return reply.code(404).send({ error: 'no such upload' });

    const { files, sizes } = await storedInventory(row);
    const at = deliveryOf(row);
    /**
     * Nothing left to ask for, once the bytes have had their verdict. `failed`
     * is the exception and is the retry: the plan is re-issued, forced past the
     * "already there" shortcut, because the objects that are there are the ones
     * that did not match.
     */
    const settled = ['verified', 'ingesting', 'ingested', 'held'].includes(row.state);
    const plan = settled
      ? []
      : await planFor(s, at.episodeId, at.deliveryId, files, sizes, row.state === 'failed');

    /**
     * `transferring`, recorded where it can be observed and nowhere else.
     *
     * The server never sees a byte of a Path A delivery — the phone PUTs to the
     * store directly — so the only moment it can tell that bytes are moving is
     * when it asks the store what it holds, which is this route. A plan that
     * comes back with something already up is that observation, and the row is
     * moved once, forwards, from `registered`. It is deliberately not an
     * audited mutation: it records what the cloud says, not something a
     * collector did.
     */
    let state = row.state;
    /**
     * And only for an UNMEASURED delivery. `collector_uploads_measured_state_check`
     * holds a measured row to the three states it had before 0029, so writing
     * `transferring` on one is a constraint violation and a 500 on the resume
     * route — which is what it was, measured by the existing resume test.
     * Nothing reads a measured delivery's progress: the phone that sends one
     * has already measured it and `/complete` is the only thing that changes
     * anything. So the observation is made where it is asked for.
     */
    if (
      !row.measured &&
      state === 'registered' &&
      plan.some((f) => f.done || (f.held_parts?.length ?? 0) > 0)
    ) {
      const [moved] = await db
        .update(schema.collectorUploads)
        .set({ state: 'transferring' })
        .where(
          and(
            eq(schema.collectorUploads.id, row.id),
            eq(schema.collectorUploads.state, 'registered'),
          ),
        )
        .returning({ state: schema.collectorUploads.state });
      state = moved?.state ?? state;
    }

    return reply.send({
      upload_id: row.id,
      ...stateOf(row),
      state,
      part_size: PART_SIZE,
      expires_in_s: ttl,
      files: plan,
    });
  });

  // -------------------------------------------------------------------------
  // The ingest stage: what happens to an unmeasured delivery once its bytes
  // have been proven.

  /** One upload row, as every helper below reads it. */
  type UploadRow = NonNullable<Awaited<ReturnType<typeof uploadOf>>>;

  /**
   * Move the row without auditing it, for the two states that describe work in
   * progress rather than a decision.
   *
   * `transferring` and `ingesting` are both observations this service makes of
   * itself — one of the object store, one of its own engine run — and neither
   * is something a collector did. The decisions on either side of them
   * (`upload.complete` and `upload.ingest`) are audited, and they are what a
   * dispute reads.
   */
  const note = (id: string, state: string, from: string[]) =>
    db
      .update(schema.collectorUploads)
      .set({ state })
      .where(
        and(
          eq(schema.collectorUploads.id, id),
          inArray(schema.collectorUploads.state, from),
        ),
      );

  /**
   * The terminal answer about an unmeasured delivery that became an episode.
   *
   * Every field is read back from the database rather than carried out of the
   * work that just ran, so the replay of a `/complete` whose answer was lost on
   * the way to the phone is the same sentence as the original — which is what
   * "idempotent" has to mean for a client that retries.
   */
  const ingestedBody = async (row: UploadRow, replayed: boolean) => {
    const [ing] = await db
      .select({ state: schema.episodeIngests.state })
      .from(schema.episodeIngests)
      .where(eq(schema.episodeIngests.ingestId, row.ingestId!));
    const [ep] = await db
      .select({
        sessionId: schema.episodes.collectionSessionId,
        verificationState: schema.episodes.verificationState,
        uploadPath: schema.episodes.uploadPath,
      })
      .from(schema.episodes)
      .where(eq(schema.episodes.episodeId, row.episodeId!));
    /**
     * `storeEpisode`'s own word on what this delivery turned out to be —
     * `new`, `duplicate` or `mismatch` — read back out of the audit row that
     * recorded the ingest rather than carried out of the work that just ran, so
     * a replay says the same thing. It is the same vocabulary Path C's import
     * route answers in, on purpose: one word for one fact.
     */
    const [audited] = await db
      .select({ after: schema.auditEvents.after })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, 'upload.ingest'),
          eq(schema.auditEvents.targetId, row.id),
        ),
      );
    const outcome = (audited?.after as { outcome?: string } | null)?.outcome ?? null;
    return {
      upload_id: row.id,
      replayed,
      ...stateOf(row),
      /** The engine's verdict on the recording: `ok`, `flagged` or `quarantined`. */
      episode_state: ing?.state ?? null,
      /** The read-back this service performed on these exact objects. */
      verification_state: ep?.verificationState ?? null,
      /** Whether the episode ended up on the session this delivery named. */
      attributed: ep?.sessionId === row.collectionSessionId,
      /** `new`, `duplicate` or `mismatch`: what the store made of this delivery. */
      outcome,
      /**
       * The same recording had already reached the platform by another route —
       * a card at a counter, or an earlier delivery — so this one added no
       * second episode and can add no second bill. UPL-15 as the phone sees it.
       */
      reused: outcome !== null && outcome !== 'new',
      /** Which route the episode's attribution belongs to: `A` here, `C` if a counter got there first. */
      episode_upload_path: ep?.uploadPath ?? null,
      transported: row.fileCount,
    };
  };

  /**
   * Put the delivered directory on this machine's disk, or refuse to.
   *
   * Three outcomes and no fourth:
   *
   *   `downloaded` there was no such directory, so every verified object was
   *                pulled out of the store and written into a directory of its
   *                own name. Written into a temporary directory first and
   *                renamed into place, so a transfer that dies halfway never
   *                leaves a session directory holding half a recording — the
   *                engine would measure that and produce a shorter episode
   *                than the collector actually recorded.
   *   `reused`     the directory is already here and every file in it has
   *                exactly the digest the phone declared. That is the same
   *                session arriving twice, by card and by phone, and the right
   *                answer is to ingest what is already on disk.
   *   `collision`  the directory is already here and its contents are not this
   *                delivery. Nothing is written, nothing is overwritten and
   *                nothing is ingested. Two deliveries disagree about what a
   *                recording is, and no rule in this system can decide that.
   *
   * The comparison is over sha256 and the whole file set, not sizes or names:
   * a re-recorded session at the same basename with the same file names and
   * the same sizes is exactly the case that must not silently pass.
   */
  const materialise = async (
    s: ObjectStore,
    root: string,
    dir: string,
    declared: readonly DeclaredFileRow[],
    keyOf: (relativePath: string) => string,
  ): Promise<'downloaded' | 'reused' | 'collision'> => {
    /**
     * What is already at that name, judged by digest over the whole file set.
     * Asked twice: once before downloading anything, and again when the rename
     * loses — the two are the same question and have to give the same answer.
     */
    const already = async (): Promise<'reused' | 'collision' | null> => {
      const onDisk = await readdir(dir, { withFileTypes: true }).catch(
        (err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
          throw err;
        },
      );
      if (onDisk === null) return null;
      const want = new Map(declared.map((f) => [f.relative_path, f.sha256]));
      const names = onDisk.filter((e) => e.isFile()).map((e) => e.name);
      if (names.length !== want.size) return 'collision';
      for (const name of names) {
        const expected = want.get(name);
        if (expected === undefined) return 'collision';
        const path = safeJoin(dir, name);
        if (path === null) return 'collision';
        if ((await sha256File(path)) !== expected) return 'collision';
      }
      return 'reused';
    };

    const there = await already();
    if (there !== null) return there;

    /**
     * A sibling of the session directory rather than a system temp directory:
     * `rename` has to be a rename and not a copy, which it only is inside one
     * filesystem, and the media root is where the bytes have to end up.
     *
     * One staging directory per ATTEMPT, not per delivery, and nothing is
     * deleted before writing. A fixed name plus a pre-emptive `rm` was a
     * corruption: `/complete` is designed to re-run from `verified` or
     * `ingesting`, so a retry landing while the first attempt was still
     * downloading deleted the files that attempt had already written, and the
     * first attempt then renamed a SHORT directory into place for the engine
     * to measure. A partial session can measure longer than the real one —
     * payable time is the intersection of stream coverage, so losing the
     * shortest stream's files widens it — which is the one way this route
     * could have overpaid.
     */
    const staging = join(root, `.incoming-${basename(dir)}-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      for (const f of declared) {
        const path = safeJoin(staging, f.relative_path);
        if (path === null) throw new Error(`unsafe path in delivery: ${f.relative_path}`);
        const body = await s.read(keyOf(f.relative_path), undefined, objectBudget());
        if (body === null) throw new Error(`the store no longer holds ${f.relative_path}`);
        /**
         * Hashed and counted as it is written, and checked before anything is
         * renamed into place. The read-back above proved the cloud copy minutes
         * ago; this proves the copy that actually landed on this disk, and they
         * are not the same claim. A body that ends early with no error is a
         * clean truncation the HTTP layer never reports, and an object rewritten
         * between the two steps carries no error at all — both arrive here as a
         * digest that is not the declared one, and neither may be published.
         */
        const h = createHash('sha256');
        let bytes = 0;
        await pipeline(
          Readable.from(body),
          async function* (source: AsyncIterable<Uint8Array>) {
            for await (const chunk of source) {
              h.update(chunk);
              bytes += chunk.length;
              yield chunk;
            }
          },
          createWriteStream(path),
        );
        const got = h.digest('hex');
        if (bytes !== f.bytes || got !== f.sha256) {
          throw new Error(
            `materialised ${f.relative_path} is not the declared file: ` +
              `${bytes} bytes sha256 ${got}, declared ${f.bytes} bytes sha256 ${f.sha256}`,
          );
        }
      }
      await rename(staging, dir);
    } catch (err) {
      await rm(staging, { recursive: true, force: true });
      /**
       * A directory appeared under this name while the bytes were coming down,
       * and nothing of ours is on disk any more. Whose directory it is has to
       * be decided the same way as before the download: if it holds this
       * delivery's digests it is our own other attempt and this one reuses it,
       * and only different bytes are a collision. Answering `collision` on the
       * rename alone held a delivery that had just succeeded.
       */
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM') {
        return (await already()) ?? 'collision';
      }
      throw err;
    }
    return 'downloaded';
  };

  /**
   * UPL-04/05 and then the measurement: read every byte back, and if it is what
   * the phone said it was, materialise the delivery and run the engine over it.
   *
   * The order is the whole safety argument. Nothing reaches this machine's disk
   * until the cloud copy has been proved byte for byte against digests computed
   * on the phone at source, so a delivery that fails read-back leaves the media
   * root exactly as it found it. And nothing is measured except what is on
   * disk: the phone asserts no duration, no stream, no state and no amount, and
   * this route would have nowhere to put one if it did.
   *
   * ponytail: synchronous ingest, ceiling ~200 MB per delivery; job table +
   * worker for production sessions. The ceiling is enforced and not just
   * declared — `MAX_UNMEASURED_DELIVERY_BYTES` refuses a larger delivery at
   * registration, before a byte moves, because a ceiling nobody checks is
   * discovered by the first request that exceeds it.
   */
  const completeUnmeasured = async (req: FastifyRequest, reply: FullReply, row: UploadRow) => {
    const s = options.objectStore!;
    const actor = actorOf(req);

    /**
     * The replay. A phone whose connection died between this service finishing
     * and the answer arriving asks again, and gets the same sentence — not a
     * refusal, because nothing it did was wrong and there is nothing for it to
     * fix. No second ingest and no second episode: this returns before any
     * work starts.
     */
    if (row.state === 'ingested') return reply.send(await ingestedBody(row, true));
    if (row.state === 'held') {
      return refused(reply, 'upload_basename_collision', {
        upload_id: row.id,
        session_basename: row.sourceBasename,
        held_reason: row.heldReason,
      });
    }
    /**
     * Another delivery of the same session already became an episode. Refused
     * before a byte is downloaded, the same way the measured path refuses a
     * second attempt at a delivery another attempt verified — and by
     * `collector_uploads_ingested_key` if it ever got past this.
     */
    const already = await ingestedAlready(row.sourceBasename, row.collectorId);
    if (already !== undefined) {
      return refused(reply, 'upload_already_complete', {
        ...(already.uploadId === undefined ? {} : { upload_id: already.uploadId }),
        episode_id: already.episodeId,
      });
    }

    if (options.mediaRoot === undefined || options.mediaRoot === '') {
      return reply
        .code(503)
        .send({ error: 'no media root is configured on this machine' });
    }
    const mediaRoot = options.mediaRoot;
    const dir = safeJoin(mediaRoot, row.sourceBasename, '.');
    if (dir === null) return reply.code(400).send({ error: 'bad session basename' });

    const episodeId = deriveEpisodeId(row.sourceBasename);
    const declared = DeclaredFile.array().parse(row.declaredFiles ?? []);
    const { files, sizes } = await storedInventory(row);
    const keyOf = (relativePath: string) => objectKey(episodeId, row.id, relativePath);

    await assemble(s, files, sizes, keyOf);
    const mismatches: Mismatch[] = await verifyReadBack(s, files, keyOf);

    if (mismatches.length > 0) {
      /**
       * UPL-04. The bytes in the cloud are not the bytes the phone measured, so
       * there is nothing here worth measuring. No episode is created, nothing
       * is written under the media root, and the objects stay exactly where
       * they are because what is in the bucket is the evidence.
       */
      const failed = await mutate(
        db,
        actor,
        {
          action: 'upload.complete',
          targetTable: 'collector_uploads',
          targetId: row.id,
          before: { state: row.state },
          after: {
            state: 'failed',
            failed_reason: 'checksum_mismatch',
            session_basename: row.sourceBasename,
            transported: files.length,
            mismatches,
          },
        },
        async (tx) => {
          const [updated] = await tx
            .update(schema.collectorUploads)
            .set({ state: 'failed', failedReason: 'checksum_mismatch', completedAt: new Date() })
            .where(
              and(
                eq(schema.collectorUploads.id, row.id),
                inArray(schema.collectorUploads.state, ['registered', 'transferring', 'failed']),
              ),
            )
            .returning();
          /**
           * Inside the transaction that failed the delivery, and only when the
           * update actually moved the row. No `failed_reason` in the payload:
           * the phone already has the refusal code from this request's own
           * reply, and the inbox is the record that it happened.
           */
          if (updated !== undefined) {
            await notify(tx, row.collectorId, 'upload_failed', { upload_id: row.id }, {
              table: 'collector_uploads',
              id: row.id,
            });
          }
          return updated;
        },
      );
      if (failed === undefined) return refused(reply, 'upload_superseded', { upload_id: row.id });
      return refused(reply, 'upload_checksum_mismatch', {
        upload_id: row.id,
        episode_id: episodeId,
        mismatches,
      });
    }

    /** The verdict on the bytes, recorded before anything is done with them. */
    const verified = await mutate(
      db,
      actor,
      {
        action: 'upload.complete',
        targetTable: 'collector_uploads',
        targetId: row.id,
        before: { state: row.state },
        after: {
          state: 'verified',
          session_basename: row.sourceBasename,
          episode_id: episodeId,
          transported: files.length,
          mismatches: [],
        },
      },
      async (tx) => {
        const [updated] = await tx
          .update(schema.collectorUploads)
          .set({ state: 'verified', failedReason: null, completedAt: new Date() })
          .where(
            and(
              eq(schema.collectorUploads.id, row.id),
              inArray(schema.collectorUploads.state, ['registered', 'transferring', 'failed']),
            ),
          )
          .returning();
        if (updated !== undefined) {
          await notify(tx, row.collectorId, 'upload_verified', { upload_id: row.id }, {
            table: 'collector_uploads',
            id: row.id,
          });
        }
        return updated;
      },
    );
    /**
     * `verified` and `ingesting` are resumable, not terminal.
     *
     * The read-back passed and then this process died, or the phone's request
     * timed out, before the episode existed. The WHERE above cannot move such a
     * row, and refusing on that would leave a delivery whose bytes are proven
     * answering `upload_superseded` for ever — the phone can neither finish it
     * nor start again, because `/complete` is the only route that ingests. So
     * those two states fall through and the work below re-runs, which is safe
     * because every step after the read-back is idempotent on the delivery:
     * `materialise` recognises its own directory by digest, and `storeEpisode`
     * answers `duplicate` for a measurement already stored.
     *
     * ponytail: no lock, so two `/complete` calls racing on one delivery both
     * download and both measure, and the state column is not the thing that
     * keeps them apart — it is read before either writes. What keeps them
     * apart is that every step after the read-back is safe to repeat: each
     * attempt downloads into a staging directory of its own, the rename is the
     * one atomic step, the attempt that loses it recognises the winner's
     * directory by digest and reuses it, `storeEpisode` answers `duplicate`
     * for a measurement already stored, and `collector_uploads_ingested_key`
     * refuses a second `ingested` row. So the honest ceiling is cost, not
     * correctness: two racing attempts pay for two downloads and two engine
     * runs of the same session. `SELECT … FOR UPDATE` on the delivery row is
     * the upgrade path and it is what the job table would bring anyway, the
     * day completion stops being synchronous.
     */
    if (verified === undefined && !['verified', 'ingesting'].includes(row.state)) {
      return refused(reply, 'upload_superseded', { upload_id: row.id });
    }

    await note(row.id, 'ingesting', ['verified']);

    /**
     * The delivery could not be turned into a measurement on this machine.
     *
     * Two ways in, one answer, because a phone can do nothing different about
     * either: the copy that landed on this disk was not the declared file
     * (`materialise` checked every byte it wrote), or the engine could not
     * read the directory. Neither deletes the objects and neither publishes a
     * directory — a `materialise` refusal never renamed one into place, and an
     * engine refusal keeps the one it measured because those bytes are proven
     * evidence of something this engine cannot read.
     */
    const failDelivery = async (err: unknown) => {
      const failed = await mutate(
        db,
        actor,
        {
          action: 'upload.complete',
          targetTable: 'collector_uploads',
          targetId: row.id,
          before: { state: 'ingesting' },
          after: {
            state: 'failed',
            failed_reason: 'ingest_failed',
            session_basename: row.sourceBasename,
            detail: (err as Error).message,
          },
        },
        async (tx) => {
          const [updated] = await tx
            .update(schema.collectorUploads)
            .set({ state: 'failed', failedReason: 'ingest_failed' })
            /**
             * Same predicate and same reason as the hold below: a retry whose
             * engine run threw must not fail a row another attempt has already
             * measured and ingested.
             */
            .where(
              and(
                eq(schema.collectorUploads.id, row.id),
                inArray(schema.collectorUploads.state, ['ingesting', 'verified']),
              ),
            )
            .returning();
          /**
           * The same kind as the read-back failure above, and deliberately so:
           * from a collector's side the recording could not be turned into
           * work, and which of the two ways it failed is a detail only this
           * service can act on. `upload_failed` is emitted at most once per
           * delivery whichever path reaches it — the unique key sees to that —
           * so a row that failed read-back, was retried and then failed
           * ingestion does not say so twice.
           */
          if (updated !== undefined) {
            await notify(tx, row.collectorId, 'upload_failed', { upload_id: row.id }, {
              table: 'collector_uploads',
              id: row.id,
            });
          }
          return updated;
        },
      );
      if (failed === undefined) return refused(reply, 'upload_superseded', { upload_id: row.id });
      return refused(reply, 'upload_ingest_failed', {
        upload_id: row.id,
        session_basename: row.sourceBasename,
        detail: (err as Error).message,
      });
    };

    let placed;
    try {
      placed = await materialise(s, mediaRoot, dir, declared, keyOf);
    } catch (err) {
      /**
       * A size or digest that did not match what the phone declared, or a read
       * that ran out of its budget part way down. The staging directory is
       * already gone (`materialise` removes it on any failure) and the session
       * directory was never created, so the media root is as it was found.
       */
      return await failDelivery(err);
    }
    if (placed === 'collision') {
      const held = await mutate(
        db,
        actor,
        {
          action: 'upload.held',
          targetTable: 'collector_uploads',
          targetId: row.id,
          before: { state: 'ingesting' },
          after: {
            state: 'held',
            held_reason: 'basename_collision',
            session_basename: row.sourceBasename,
          },
          reason: 'basename_collision',
        },
        async (tx) => {
          const [updated] = await tx
            .update(schema.collectorUploads)
            .set({ state: 'held', heldReason: 'basename_collision' })
            /**
             * Only from a delivery that is still being worked on. Without the
             * predicate a retry that lost the rename could hold a row another
             * attempt had already ingested — turning a delivery that succeeded
             * into one an operator has to adjudicate.
             */
            .where(
              and(
                eq(schema.collectorUploads.id, row.id),
                inArray(schema.collectorUploads.state, ['ingesting', 'verified']),
              ),
            )
            .returning();
          /**
           * A held delivery is the one upload state a collector can do nothing
           * about and an operator has to adjudicate, so it is its own kind
           * rather than a failure. `held_reason` stays out for the same reason
           * `failed_reason` does.
           */
          if (updated !== undefined) {
            await notify(tx, row.collectorId, 'upload_held', { upload_id: row.id }, {
              table: 'collector_uploads',
              id: row.id,
            });
          }
          return updated;
        },
      );
      if (held === undefined) return refused(reply, 'upload_superseded', { upload_id: row.id });
      return refused(reply, 'upload_basename_collision', {
        upload_id: row.id,
        session_basename: row.sourceBasename,
        held_reason: 'basename_collision',
      });
    }

    /**
     * The engine, on this machine, over the directory that is now on this
     * machine's disk. The same call Path C's counter import makes, so the same
     * rules decide the same things: the episode id from the basename, the
     * fingerprint from the source files, the duration from the PTS sidecars,
     * and the state from the discrepancies. Nothing in this file re-derives any
     * of them.
     */
    let record;
    try {
      record = await ingest(dir);
    } catch (err) {
      /**
       * The directory stays. Its bytes have been proved against the phone's own
       * digests, so it is a good copy of something this engine cannot read —
       * which is evidence, and nothing in this system deletes evidence.
       */
      return await failDelivery(err);
    }

    /** The basename decides the id on both sides; a disagreement is this file being wrong. */
    if (record.episode_id !== episodeId) {
      throw new Error(
        `the engine derived ${record.episode_id} for ${row.sourceBasename}, planned ${episodeId}`,
      );
    }

    /**
     * The measurement is stored by the code that owns that job, exactly as Path
     * C does: its own transaction, the three redelivery cases, and the stored
     * state. A duplicate delivery returns the EXISTING ingest id, so a session
     * that arrived by card and then by phone is one episode and one delivery.
     */
    const stored = await storeEpisode(db, record);
    if (stored.ingestId === null) {
      throw new Error(`storeEpisode returned no ingest for ${stored.episodeId}`);
    }
    const ingestId = stored.ingestId;

    const written = await mutate(
      db,
      actor,
      {
        action: 'upload.ingest',
        targetTable: 'collector_uploads',
        targetId: row.id,
        before: { state: 'ingesting' },
        after: {
          state: 'ingested',
          episode_id: stored.episodeId,
          ingest_id: ingestId,
          outcome: stored.outcome,
          episode_state: record.state,
          materialised: placed,
          collection_session_id: row.collectionSessionId,
          verification_state: 'verified',
          engine_version: record.source.ingest_tool_version,
          files: files.length,
        },
      },
      async (tx) => {
        /**
         * APP-16, and the same rule the measured path applies: the collector
         * bound this session before recording, so the attribution is a
         * declaration made before the fact by the person who made the
         * recording. `upload_path is null` is the guard — an episode a counter
         * already imported carries `upload_path = 'C'` and a session an
         * operator resolved it to, and settlement has possibly already read it.
         * The bytes are still accepted; the attribution is left where it was.
         */
        await tx
          .update(schema.episodes)
          .set({
            collectionSessionId: row.collectionSessionId,
            resolutionState: 'resolved',
            resolutionMethod: 'app_declared',
            uploadPath: 'A',
          })
          .where(
            and(
              eq(schema.episodes.episodeId, stored.episodeId),
              isNull(schema.episodes.uploadPath),
            ),
          );

        /**
         * The cloud verification, recorded the way Path C records it — and it
         * is the same fact, reached by the same evidence. Every object was read
         * back out of the store and re-hashed against the digest computed at
         * source minutes ago; that is what `verifyReadBack` did above, and it
         * is the only thing in this system that can say a cloud copy is good.
         * Under `REVIEW_VERIFICATION_GATE=cloud` this is what lets the episode
         * into the review queue.
         *
         * `latest_ingest_id` is in the WHERE for the reason Path C gives: the
         * verdict belongs to the ingest whose bytes were checked.
         */
        const [episode] = await tx
          .update(schema.episodes)
          .set({ verificationState: 'verified' })
          .where(
            and(
              eq(schema.episodes.episodeId, stored.episodeId),
              eq(schema.episodes.latestIngestId, ingestId),
            ),
          )
          .returning();
        if (episode === undefined) return undefined;

        /** The per-object receipts, the same rows and the same shape as `verificationReceipts`. */
        for (const f of declared) {
          await tx
            .insert(schema.cloudVerifications)
            .values({
              objectKey: keyOf(f.relative_path),
              episodeId: stored.episodeId,
              ingestId,
              sha256: f.sha256,
            })
            .onConflictDoUpdate({
              target: schema.cloudVerifications.objectKey,
              set: { ingestId, sha256: f.sha256, verifiedAt: new Date() },
            });
        }

        const [updated] = await tx
          .update(schema.collectorUploads)
          .set({
            state: 'ingested',
            episodeId: stored.episodeId,
            ingestId,
            heldReason: null,
            failedReason: null,
          })
          .where(
            and(
              eq(schema.collectorUploads.id, row.id),
              inArray(schema.collectorUploads.state, ['ingesting', 'verified']),
            ),
          )
          .returning();
        /**
         * The recording is now an episode, which is the first moment there is
         * something a reviewer can look at and therefore something that can be
         * paid. The episode id goes in the payload so the inbox row can tap
         * through to it; no figure does, because nothing has been measured into
         * money yet.
         */
        if (updated !== undefined) {
          await notify(
            tx,
            row.collectorId,
            'upload_ingested',
            { upload_id: row.id, episode_id: stored.episodeId },
            { table: 'collector_uploads', id: row.id },
          );
        }
        return updated;
      },
    );
    if (written === undefined) return refused(reply, 'upload_superseded', { upload_id: row.id });
    return reply.send(await ingestedBody(written, false));
  };

  /**
   * UPL-04/05: assemble what arrived, read every byte of it back, and record
   * the verdict.
   *
   * ponytail: one synchronous request per delivery, which is the same shape
   * and the same ceiling as Path C's batch upload — a 16 GB delivery is 16 GB
   * of download and hashing inside one request, up to
   * `MAX_DELIVERY_BYTES`. That is this route, the MEASURED one, where the
   * bytes are hashed as they stream and nothing is kept; the unmeasured half
   * of this file also writes them to disk and decodes them, so it carries the
   * much lower `MAX_UNMEASURED_DELIVERY_BYTES` instead. Two ceilings because
   * the two shapes cost different things, and both are refused by name at
   * registration. The upgrade path is the same for both: a queue and a
   * progress endpoint, the day a delivery stops fitting in a request timeout.
   * Deliberately not built now, because a phone that has to poll is a second
   * protocol and nothing in the pilot needs it.
   */
  app.post('/api/me/uploads/:id/complete', opts, async (req, reply) => {
    const s = store(reply);
    if (s === null) return reply;
    const row = await uploadOf((req.params as { id: string }).id, collectorOf(req));
    if (row === undefined) return reply.code(404).send({ error: 'no such upload' });
    if (!row.measured) return completeUnmeasured(req, reply, row);
    /**
     * This attempt, or any other attempt at the same delivery.
     *
     * `collector_uploads_verified_key` allows one verified row per delivery,
     * which is what stops one recording being delivered twice and read as two.
     * Without this read the second attempt would download every byte, hash it,
     * and then trip the index — a 500 at the end of a gigabyte of work, where
     * the honest answer is that there is nothing left to do.
     */
    const [alreadyVerified] = await db
      .select({ id: schema.collectorUploads.id })
      .from(schema.collectorUploads)
      .where(
        and(
          eq(schema.collectorUploads.episodeId, row.episodeId!),
          eq(schema.collectorUploads.ingestId, row.ingestId!),
          eq(schema.collectorUploads.state, 'verified'),
        ),
      );
    if (alreadyVerified !== undefined) {
      return refused(reply, 'upload_already_complete', {
        upload_id: alreadyVerified.id,
        episode_id: row.episodeId,
      });
    }

    const { files, sizes } = await storedInventory(row);
    const at = deliveryOf(row);
    const keyOf = (relativePath: string) => objectKey(at.episodeId, at.deliveryId, relativePath);

    await assemble(s, files, sizes, keyOf);
    const mismatches = await verifyReadBack(s, files, keyOf);
    const ok = mismatches.length === 0;
    const state = ok ? 'verified' : 'failed';

    const written = await mutate(
      db,
      actorOf(req),
      {
        action: 'upload.complete',
        targetTable: 'collector_uploads',
        targetId: row.id,
        before: { state: row.state },
        after: {
          state,
          episode_id: row.episodeId,
          ingest_id: row.ingestId,
          verification_state: ok ? 'verified' : 'failed',
          transported: files.length,
          mismatches,
        },
      },
      async (tx) => {
        /**
         * `latest_ingest_id` is in the WHERE for the reason Path C states: the
         * verdict belongs to the ingest whose bytes were checked. If a
         * redelivery landed while these bytes were moving, the episode's
         * latest ingest is no longer this one, and stamping a verdict on it
         * would certify bytes nobody uploaded.
         */
        const [episode] = await tx
          .update(schema.episodes)
          .set({ verificationState: ok ? 'verified' : 'failed' })
          .where(
            and(
              eq(schema.episodes.episodeId, row.episodeId!),
              eq(schema.episodes.latestIngestId, row.ingestId!),
            ),
          )
          .returning();
        if (episode === undefined) return undefined;

        /**
         * `<> 'verified'` and not `= 'registered'`.
         *
         * A delivery that failed read-back is the normal retry: the phone is
         * told which file did not match, sends it again, and asks for the
         * verdict again. Scoping this to `registered` made that second attempt
         * update nothing, which `mutate` reads as "the row moved" and this
         * route reported as `upload_superseded` — a wrong sentence on the one
         * path a collector with a bad connection actually takes. A verified
         * delivery never reaches here; it is refused above.
         */
        const [updated] = await tx
          .update(schema.collectorUploads)
          .set({ state, completedAt: new Date() })
          .where(
            and(
              eq(schema.collectorUploads.id, row.id),
              ne(schema.collectorUploads.state, 'verified'),
            ),
          )
          .returning();
        /**
         * The measured path's verdict on the bytes, notified from inside the
         * same transaction that recorded it. A delivery that fails read-back
         * and is then retried successfully writes both kinds against one
         * upload id, which is correct: they are two different facts, and the
         * per-kind unique key is what keeps each of them to one row.
         */
        if (updated !== undefined) {
          await notify(
            tx,
            row.collectorId,
            ok ? 'upload_verified' : 'upload_failed',
            { upload_id: row.id },
            { table: 'collector_uploads', id: row.id },
          );
        }
        return updated;
      },
    );
    if (written === undefined) return refused(reply, 'upload_superseded', { upload_id: row.id });

    if (!ok) {
      /**
       * UPL-04, and the whole point of this route. The episode now reads
       * `verification_state = 'failed'`, which the review queue refuses under
       * either gate — the same block, from the same column, as a Path C
       * delivery that failed read-back. Nothing is deleted; the objects and
       * the record stay, because what is in the bucket is the evidence.
       */
      return refused(reply, 'upload_checksum_mismatch', {
        upload_id: row.id,
        episode_id: row.episodeId,
        mismatches,
      });
    }
    return reply.send({
      upload_id: row.id,
      episode_id: row.episodeId,
      ingest_id: row.ingestId,
      state,
      verification_state: 'verified',
      transported: files.length,
    });
  });
}
