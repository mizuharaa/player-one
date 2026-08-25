import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { EpisodeRecord } from '@playerone/contracts';
import { schema, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { Actor } from './actor.ts';
import { safeJoin } from './media.ts';

/**
 * Path C's cloud leg: UPL-03/04/05/06, UPL-15/16.
 *
 * The storage target is GreenNode (VNG's cloud, Vietnam — PLT-01), spoken to
 * over the S3 API. The contract is not signed, so endpoint and credentials come
 * from the environment and nothing in this file names a region or a provider
 * SDK beyond `@aws-sdk/client-s3`.
 *
 * Three rules govern everything here, and each is stated where it is enforced:
 *
 *   - **The verdict comes from byte read-back, never from ETag or metadata.**
 *     `docs/playerone-ingest-engine-spec.md` (ING-29): a multipart ETag is not
 *     a content digest. The per-file sha256 the engine recorded at import is
 *     the reference; the cloud copy is downloaded and re-hashed against it.
 *     The sha256 IS stored as object metadata — but for operators browsing the
 *     bucket, never as evidence. Metadata travels with the object, so a write
 *     that corrupted the bytes can still carry a clean-looking sha256.
 *   - **The cache-cleanup gate is schema state.** `upload_batches` already
 *     carries `cloud_verified_at`, `local_cache_cleaned_at` and
 *     `upload_batches_cache_after_verify_check`; migration 0007 extends that
 *     gate with a trigger so `cloud_verified_at` cannot be set while any
 *     episode on the batch is unverified. This file only tries the update and
 *     reports; it cannot bypass either.
 *   - **No code path here deletes anything.** Not TF-card source media (PRD
 *     §11.3.1 rule 6, not deviable) and not even the local cache: the
 *     cache-clean route *records* that an operator cleaned it, once the schema
 *     allows the fact to exist. ponytail: recording-only cleanup; an actual
 *     rm belongs in an operator tool once someone asks for one.
 */

// ---------------------------------------------------------------------------
// The seam

export type PutResult = 'uploaded' | 'kept';

/**
 * The two calls the cloud leg makes, and no more.
 *
 * ponytail: two implementations (GreenNode over S3, the fs-backed test stub)
 * justify a 2-method interface. Everything S3-specific — multipart, resume,
 * metadata — lives inside `put` so the stub does not have to fake a protocol.
 */
export interface ObjectStore {
  /**
   * Uploads a local file to `key`, recording `sha256` as object metadata.
   *
   * Idempotent (UPL-15/16): when the key already holds an object whose recorded
   * sha256 and size match, no bytes move and the answer is 'kept'. `force`
   * skips that check — it exists because the skip trusts metadata, and after a
   * failed read-back the metadata is exactly what cannot be trusted; a re-run
   * over a failed episode must overwrite, not keep.
   */
  put(key: string, localPath: string, sha256: string, force?: boolean): Promise<PutResult>;
  /** The object's bytes, for read-back verification. Null when the key is absent. */
  read(key: string): Promise<AsyncIterable<Uint8Array> | null>;
}

/**
 * One episode, one prefix, forever. The episode id derives from the directory
 * basename (docs/episode-identity.md), so the same session delivered twice —
 * or an upload resumed after an interrupt — lands on the same keys and the
 * bucket holds one object set per episode, not one per attempt (UPL-15).
 */
export const objectKey = (episodeId: string, relativePath: string): string =>
  `episodes/${episodeId}/${relativePath}`;

// ---------------------------------------------------------------------------
// S3 mechanics

/**
 * Fixed, because resume depends on it: parts are planned from size alone, so a
 * re-run plans the same boundaries and a part the cloud already holds is
 * recognisable by number and size. ponytail: 64 MiB × S3's 10,000-part limit
 * caps a single file at 640 GiB; raise the constant if a file ever approaches
 * that, nothing else changes.
 */
export const PART_SIZE = 64 * 1024 * 1024;

export type PlannedPart = { partNumber: number; start: number; end: number };

/** `end` exclusive. A file below PART_SIZE is not multiparted at all. */
export function planParts(bytes: number): PlannedPart[] {
  const parts: PlannedPart[] = [];
  for (let start = 0, n = 1; start < bytes; start += PART_SIZE, n += 1) {
    parts.push({ partNumber: n, start, end: Math.min(start + PART_SIZE, bytes) });
  }
  return parts;
}

const notFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
};

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: { endpoint: string; bucket: string; key: string; secret: string }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      // S3-compatible stores generally ignore the region but the SDK insists
      // on one, and path-style is the safe default off AWS proper. Revisit both
      // when the GreenNode contract names its dialect.
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: config.key, secretAccessKey: config.secret },
    });
  }

  private async head(key: string): Promise<{ bytes: number; sha256: string | null } | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { bytes: r.ContentLength ?? -1, sha256: r.Metadata?.['sha256'] ?? null };
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }

  async put(key: string, localPath: string, sha256: string, force = false): Promise<PutResult> {
    const size = (await stat(localPath)).size;
    if (!force) {
      const existing = await this.head(key);
      if (existing !== null && existing.sha256 === sha256 && existing.bytes === size) {
        return 'kept';
      }
    }

    if (size < PART_SIZE) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: size === 0 ? new Uint8Array(0) : createReadStream(localPath),
          ContentLength: size,
          Metadata: { sha256 },
        }),
      );
      return 'uploaded';
    }

    // Multipart with resume (UPL-16): adopt an upload already in flight for
    // this key rather than starting a second, and re-send only the parts the
    // cloud does not already hold at the planned size.
    const done = new Map<number, { etag: string; size: number }>();
    let uploadId = await this.findOpenUpload(key);
    if (uploadId !== null) {
      for (const p of await this.listParts(key, uploadId)) done.set(p.partNumber, p);
    } else {
      const created = await this.client.send(
        new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, Metadata: { sha256 } }),
      );
      uploadId = created.UploadId!;
    }

    const completed: { PartNumber: number; ETag: string }[] = [];
    for (const part of planParts(size)) {
      const have = done.get(part.partNumber);
      if (have !== undefined && have.size === part.end - part.start) {
        completed.push({ PartNumber: part.partNumber, ETag: have.etag });
        continue;
      }
      const r = await this.client.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: part.partNumber,
          Body: createReadStream(localPath, { start: part.start, end: part.end - 1 }),
          ContentLength: part.end - part.start,
        }),
      );
      completed.push({ PartNumber: part.partNumber, ETag: r.ETag! });
    }
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: completed.sort((a, b) => a.PartNumber - b.PartNumber) },
      }),
    );
    return 'uploaded';
  }

  async read(key: string): Promise<AsyncIterable<Uint8Array> | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return (r.Body ?? null) as AsyncIterable<Uint8Array> | null;
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }

  private async findOpenUpload(key: string): Promise<string | null> {
    const r = await this.client.send(
      new ListMultipartUploadsCommand({ Bucket: this.bucket, Prefix: key }),
    );
    const mine = (r.Uploads ?? []).filter((u) => u.Key === key);
    // Newest wins; older abandoned attempts are left for the bucket's own
    // lifecycle rule to reap — aborting them here would turn one machine's
    // clock skew into another machine's lost resume.
    mine.sort((a, b) => (a.Initiated?.getTime() ?? 0) - (b.Initiated?.getTime() ?? 0));
    return mine.at(-1)?.UploadId ?? null;
  }

  private async listParts(
    key: string,
    uploadId: string,
  ): Promise<{ partNumber: number; etag: string; size: number }[]> {
    const parts: { partNumber: number; etag: string; size: number }[] = [];
    let marker: string | undefined;
    do {
      const r = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const p of r.Parts ?? []) {
        if (p.PartNumber !== undefined && p.ETag !== undefined && p.Size !== undefined) {
          parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size });
        }
      }
      marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
    } while (marker !== undefined);
    return parts;
  }
}

/**
 * The store the environment describes, or null when STORAGE_ENDPOINT is unset
 * (no contract signed, no endpoint to talk to). A partial configuration is a
 * mistake, not a mode, and fails closed by naming what is missing.
 */
export function s3StoreFromEnv(env: Record<string, string | undefined> = process.env): S3ObjectStore | null {
  if (!env['STORAGE_ENDPOINT']) return null;
  const missing = ['STORAGE_BUCKET', 'STORAGE_KEY', 'STORAGE_SECRET'].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`STORAGE_ENDPOINT is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not`);
  }
  return new S3ObjectStore({
    endpoint: env['STORAGE_ENDPOINT'],
    bucket: env['STORAGE_BUCKET']!,
    key: env['STORAGE_KEY']!,
    secret: env['STORAGE_SECRET']!,
  });
}

// ---------------------------------------------------------------------------
// Verification

async function sha256Of(bytes: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of bytes) h.update(chunk);
  return h.digest('hex');
}

export type Mismatch = { relative_path: string; expected_sha256: string; cloud_sha256: string | null };

/**
 * UPL-05: the cloud copy of every source file is downloaded and re-hashed
 * against the sha256 the engine recorded at import (the record's
 * `source_files` — nothing is re-hashed locally, that digest is settled).
 * Reading every byte back is the price of ING-29's "ETag is never used"; a
 * provider checksum feature can replace it the day the contract names one.
 */
async function readBack(
  store: ObjectStore,
  episodeId: string,
  files: { relative_path: string; sha256: string }[],
): Promise<Mismatch[]> {
  const mismatches: Mismatch[] = [];
  for (const f of files) {
    const body = await store.read(objectKey(episodeId, f.relative_path));
    const cloud = body === null ? null : await sha256Of(body);
    if (cloud !== f.sha256) {
      mismatches.push({ relative_path: f.relative_path, expected_sha256: f.sha256, cloud_sha256: cloud });
    }
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// Routes

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

export type UploadOptions = {
  /** Absent until the GreenNode contract yields an endpoint; the routes answer 503 saying so. */
  objectStore?: ObjectStore;
  /** Same directory the review console streams from: the imported `ego_*` folders. */
  mediaRoot?: string;
};

export function registerUpload(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: UploadOptions = {},
): void {
  const opts = { preHandler: requireActor };

  /** Same machine scope as the counter's batch routes: the uploader is the machine holding the cache. */
  const batchOf = async (batchId: string, actor: Actor) => {
    const [batch] = await db
      .select()
      .from(schema.uploadBatches)
      .where(
        and(
          eq(schema.uploadBatches.id, batchId),
          eq(schema.uploadBatches.uploadDeviceId, actor.machine.uploadDeviceId),
        ),
      );
    return batch;
  };

  /**
   * UPL-04/05: push every episode of the batch to the cloud, then verify each
   * by read-back and record the verdict. Safe to re-run at any point — an
   * object already up and matching is kept, an interrupted run resumes, and a
   * failed episode is force-overwritten from the local cache (its metadata has
   * already proved unreliable).
   *
   * ponytail: one synchronous request per batch, sized for the pilot's card
   * loads; a background queue with progress is the upgrade path when a batch
   * stops fitting in a request timeout.
   */
  app.post('/upload-batches/:id/upload', opts, async (req, reply) => {
    const actor = req.actor as Actor;
    const batchId = (req.params as { id: string }).id;
    if (options.objectStore === undefined) {
      return reply.code(503).send({ error: 'no object store is configured on this machine' });
    }
    if (options.mediaRoot === undefined || options.mediaRoot === '') {
      return reply.code(503).send({ error: 'no media root is configured on this machine' });
    }
    const store = options.objectStore;
    const mediaRoot = options.mediaRoot;

    const batch = await batchOf(batchId, actor);
    if (batch === undefined) return reply.code(404).send({ error: 'no such batch on this machine' });

    /**
     * Every episode on the batch, quarantined ones included: ING-17, nothing is
     * discarded, and the batch cannot flip verified while any of its episodes
     * is not.
     */
    const rows = await db
      .select({
        episodeId: schema.episodes.episodeId,
        verificationState: schema.episodes.verificationState,
        sourceBasename: schema.episodeIngests.sourceBasename,
        recordJson: schema.episodeIngests.recordJson,
      })
      .from(schema.episodes)
      .innerJoin(
        schema.episodeIngests,
        eq(schema.episodeIngests.ingestId, schema.episodes.latestIngestId),
      )
      .where(eq(schema.episodes.uploadBatchId, batchId));

    const results: Record<string, unknown>[] = [];
    for (const row of rows) {
      const parsed = EpisodeRecord.safeParse(row.recordJson);
      if (!parsed.success) {
        results.push({ episode_id: row.episodeId, error: 'stored record does not parse' });
        continue;
      }
      const files = parsed.data.source_files;
      const force = row.verificationState === 'failed';
      let uploaded = 0;
      let kept = 0;
      try {
        for (const f of files) {
          const local = safeJoin(mediaRoot, row.sourceBasename, f.relative_path);
          if (local === null) throw new Error(`unsafe path in record: ${f.relative_path}`);
          const r = await store.put(objectKey(row.episodeId, f.relative_path), local, f.sha256, force);
          if (r === 'uploaded') uploaded += 1;
          else kept += 1;
        }
      } catch (err) {
        // A later re-run resumes: completed objects answer 'kept', the one in
        // flight is re-sent. Nothing is verified for this episode yet, so
        // nothing downstream can act on the partial upload.
        results.push({ episode_id: row.episodeId, uploaded, kept, error: (err as Error).message });
        continue;
      }

      const mismatches = await readBack(store, row.episodeId, files);
      const state = mismatches.length === 0 ? 'verified' : 'failed';
      await mutate(
        db,
        actor,
        {
          action: 'episode.cloud_verify',
          targetTable: 'episodes',
          targetId: row.episodeId,
          before: { verification_state: row.verificationState },
          after: { verification_state: state, files: files.length, mismatches },
        },
        async (tx) => {
          const [updated] = await tx
            .update(schema.episodes)
            .set({ verificationState: state })
            .where(eq(schema.episodes.episodeId, row.episodeId))
            .returning();
          return updated;
        },
      );
      results.push({
        episode_id: row.episodeId,
        uploaded,
        kept,
        verification_state: state,
        ...(mismatches.length > 0 ? { mismatches } : {}),
      });
    }

    /**
     * The batch flips only when every episode on it is verified, and the WHERE
     * clause is not the guarantee — the migration-0007 trigger is. Returning no
     * row means no flip and no audit entry, which is what `mutate` wants.
     */
    const flipped = await mutate(
      db,
      actor,
      {
        action: 'batch.cloud_verified',
        targetTable: 'upload_batches',
        targetId: batchId,
        before: { batch_status: batch.batchStatus },
        after: { batch_status: 'verified' },
      },
      async (tx) => {
        const [updated] = await tx
          .update(schema.uploadBatches)
          .set({ cloudVerifiedAt: new Date(), batchStatus: 'verified', updatedAt: new Date() })
          .where(
            and(
              eq(schema.uploadBatches.id, batchId),
              isNull(schema.uploadBatches.cloudVerifiedAt),
              sql`not exists (select 1 from episodes
                               where episodes.upload_batch_id = ${batchId}
                                 and episodes.verification_state <> 'verified')`,
              sql`exists (select 1 from episodes where episodes.upload_batch_id = ${batchId})`,
            ),
          )
          .returning();
        return updated;
      },
    );

    return reply.send({
      batch_id: batchId,
      episodes: results,
      cloud_verified: flipped !== undefined || batch.cloudVerifiedAt !== null,
    });
  });

  /**
   * UPL-06: records that the operator cleaned this machine's local cache for a
   * batch. Recording is all it does — nothing is deleted here, and the schema
   * (CHECK + trigger, migration 0007) is what makes "cleaned before the cloud
   * verified" unrepresentable rather than merely unimplemented. TF-card source
   * media is not touched by any code path; the card is never cleared.
   */
  app.post('/upload-batches/:id/cache-clean', opts, async (req, reply) => {
    const actor = req.actor as Actor;
    const batchId = (req.params as { id: string }).id;
    const batch = await batchOf(batchId, actor);
    if (batch === undefined) return reply.code(404).send({ error: 'no such batch on this machine' });
    if (batch.localCacheCleanedAt !== null) {
      return reply.send({ id: batchId, replayed: true });
    }

    const written = await mutate(
      db,
      actor,
      {
        action: 'batch.cache_clean',
        targetTable: 'upload_batches',
        targetId: batchId,
        before: { batch_status: batch.batchStatus, cloud_verified_at: batch.cloudVerifiedAt },
        after: { batch_status: 'closed' },
      },
      async (tx) => {
        const [updated] = await tx
          .update(schema.uploadBatches)
          .set({ localCacheCleanedAt: new Date(), batchStatus: 'closed', updatedAt: new Date() })
          .where(
            and(
              eq(schema.uploadBatches.id, batchId),
              sql`${schema.uploadBatches.cloudVerifiedAt} is not null`,
            ),
          )
          .returning();
        return updated;
      },
    );
    if (written === undefined) {
      return reply
        .code(409)
        .send({ error: 'the cloud has not verified this batch; the local cache stays' });
    }
    return reply.send({ id: batchId, replayed: false });
  });
}
