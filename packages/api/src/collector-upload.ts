import { basename } from 'node:path';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { deriveEpisodeId, EpisodeRecord } from '@playerone/contracts';
import { schema, storeEpisode, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { CollectorActor } from './actor.ts';
import {
  objectKey,
  planParts,
  verifyReadBack,
  PART_SIZE,
  PRESIGN_TTL_S,
  type DirectUploadStore,
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
]);

/**
 * The most one registration may declare.
 *
 * Part 8: ~16 GB per recorded hour, ~23 GB per collector-day, and the device
 * segments video hourly. 64 GiB is therefore about four recorded hours in one
 * delivery — comfortably past anything the pilot produces and far short of a
 * number that could only come from a client that is wrong about itself. It is
 * an option and not a constant because storage cost is a real operational
 * knob and the projections in Part 8 are projections.
 */
export const MAX_DELIVERY_BYTES = 64 * 1024 * 1024 * 1024;

export type CollectorUploadOptions = {
  /** Absent until a storage endpoint exists; the routes answer 503 saying so. */
  objectStore?: (ObjectStore & DirectUploadStore) | undefined;
  /** How long a signed URL a phone is handed stays valid. */
  presignTtlS?: number;
  /** The ceiling one registration may declare. */
  maxDeliveryBytes?: number;
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
  const ttl = options.presignTtlS ?? PRESIGN_TTL_S;
  const ceiling = options.maxDeliveryBytes ?? MAX_DELIVERY_BYTES;

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
   * The inventory of a registered upload, rebuilt from what was stored: the
   * fingerprinted files from `episode_files` — the same rows the fingerprint
   * is recomputable from — plus the declared remainder off the upload row.
   */
  const storedInventory = async (row: {
    ingestId: string;
    extraFiles: unknown;
  }): Promise<{ files: TransportFile[]; sizes: Map<string, number> }> => {
    const rows = await db
      .select({
        relativePath: schema.episodeFiles.relativePath,
        sizeBytes: schema.episodeFiles.sizeBytes,
        sha256: schema.episodeFiles.sha256,
      })
      .from(schema.episodeFiles)
      .where(eq(schema.episodeFiles.ingestId, row.ingestId));
    const extras = DeclaredFile.array().parse(row.extraFiles ?? []);
    const sizes = new Map<string, number>();
    for (const r of rows) sizes.set(r.relativePath, r.sizeBytes);
    for (const e of extras) sizes.set(e.relative_path, e.bytes);
    const files = inventoryOf(
      rows.map((r) => ({ relative_path: r.relativePath, sha256: r.sha256 })),
      extras.map((e) => ({ relative_path: e.relative_path, sha256: e.sha256 })),
    );
    return { files, sizes };
  };

  // -------------------------------------------------------------------------

  /**
   * UPL-01, the registration. What a phone sends before it sends any bytes.
   *
   * The answer is everything it needs and nothing it could have chosen: the
   * object keys, the part boundaries, one signed URL per part still missing,
   * and which parts the store already holds.
   */
  app.post('/api/me/uploads', opts, async (req, reply) => {
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
      if (existing.state === 'verified') {
        return refused(reply, 'upload_already_complete', {
          upload_id: existing.id,
          episode_id: existing.episodeId,
        });
      }
      const { files, sizes } = await storedInventory(existing);
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
          existing.episodeId,
          existing.ingestId,
          files,
          sizes,
          existing.state === 'failed',
        ),
      });
    }

    const [session] = await db
      .select({
        id: schema.collectionSessions.id,
        collectorId: schema.collectionSessions.collectorId,
      })
      .from(schema.collectionSessions)
      .where(eq(schema.collectionSessions.id, body.collection_session_id));
    if (session === undefined) {
      return refused(reply, 'upload_unknown_session', {
        collection_session_id: body.collection_session_id,
      });
    }
    /**
     * The token's collector against the session's, and no other comparison is
     * possible: the caller never supplied a collector id. The composite
     * `collector_uploads_session_fk` says the same thing to Postgres, so the
     * refused state cannot be written by any other writer either.
     */
    if (session.collectorId !== collectorId) {
      return refused(reply, 'upload_foreign_session', {
        collection_session_id: body.collection_session_id,
      });
    }

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
   */
  app.get('/api/me/uploads/:id', opts, async (req, reply) => {
    const s = store(reply);
    if (s === null) return reply;
    const row = await uploadOf((req.params as { id: string }).id, collectorOf(req));
    if (row === undefined) return reply.code(404).send({ error: 'no such upload' });

    const { files, sizes } = await storedInventory(row);
    return reply.send({
      upload_id: row.id,
      state: row.state,
      episode_id: row.episodeId,
      ingest_id: row.ingestId,
      collection_session_id: row.collectionSessionId,
      upload_path: 'A',
      part_size: PART_SIZE,
      expires_in_s: ttl,
      files:
        row.state === 'verified'
          ? []
          : await planFor(s, row.episodeId, row.ingestId, files, sizes, row.state === 'failed'),
    });
  });

  /**
   * UPL-04/05: assemble what arrived, read every byte of it back, and record
   * the verdict.
   *
   * ponytail: one synchronous request per delivery, which is the same shape
   * and the same ceiling as Path C's batch upload — a 16 GB delivery is 16 GB
   * of download and hashing inside one request. The upgrade path is the same
   * too: a queue and a progress endpoint, the day a delivery stops fitting in
   * a request timeout. It is deliberately not built now, because a phone that
   * has to poll is a second protocol and nothing in the pilot needs it.
   */
  app.post('/api/me/uploads/:id/complete', opts, async (req, reply) => {
    const s = store(reply);
    if (s === null) return reply;
    const row = await uploadOf((req.params as { id: string }).id, collectorOf(req));
    if (row === undefined) return reply.code(404).send({ error: 'no such upload' });
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
          eq(schema.collectorUploads.episodeId, row.episodeId),
          eq(schema.collectorUploads.ingestId, row.ingestId),
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
    const keyOf = (relativePath: string) => objectKey(row.episodeId, row.ingestId, relativePath);

    /**
     * Assembly, for the files that were sent in parts.
     *
     * `openMultipart` rather than `beginMultipart`: this step must never start
     * an upload. A file with nothing in flight is a file the phone has not
     * sent, or one already assembled by an earlier attempt at this delivery,
     * and neither wants an empty multipart left in the bucket.
     *
     * There is deliberately no "the object is already there, skip it" check.
     * An object being there is not a reason not to assemble: after a failed
     * read-back the object that is there is the wrong one, and the phone has
     * just re-sent every part into a new multipart precisely to replace it.
     *
     * The part count is checked against the plan before assembling. Completing
     * a short upload would produce a truncated object that then fails
     * read-back, which is the correct verdict reached the expensive way; not
     * assembling it at all reaches the same verdict without writing anything.
     */
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
              eq(schema.episodes.episodeId, row.episodeId),
              eq(schema.episodes.latestIngestId, row.ingestId),
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
