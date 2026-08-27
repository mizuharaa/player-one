import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
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
import { safeJoin } from './media.ts';

/**
 * The centre side of Path C's cloud leg: everything that touches the local card
 * cache and the object store, and nothing that touches Postgres, Fastify or an
 * actor.
 *
 * It is a separate module because of where it has to run. PRODUCT.md:34 puts
 * Path C's upload in an Electron client **at the upload centre**, with
 * better-sqlite3 batch state and resumable multipart upload: the local cache is
 * on the centre's disk, so the process that reads it is the centre's, not the
 * server's. `upload.ts` keeps the server half — batch scope, the verification
 * verdict written to `episodes`, the UPL-06 batch flip — and calls in here for
 * the transport. Today both halves run in one Node process at the centre; when
 * the Electron client lands it imports this module and talks to those routes
 * instead, and nothing in here has to change.
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
 *   - **One ingest, one object prefix, never overwritten.** See `objectKey`.
 *   - **No code path here deletes anything.** Not TF-card source media (PRD
 *     §11.3.1 rule 6, not deviable) and not the local cache either.
 */

// ---------------------------------------------------------------------------
// The seams

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
 * Where a centre remembers what it has already transported.
 *
 * This is the persistence seam PRODUCT.md:34 names — the better-sqlite3 batch
 * state of the Electron client. What it is NOT is how resume works. The
 * multipart upload id and the parts the cloud already holds are recovered from
 * the object store itself (`ListMultipartUploads` / `ListParts` inside
 * `S3ObjectStore.put`), because that is the one record which cannot disagree
 * with the cloud; a local copy of an upload id can, and then resume writes
 * parts into an upload nobody will complete. A centre that loses this state
 * entirely still resumes correctly — it just re-HEADs objects it need not have.
 *
 * ponytail: `noProgress` is the only implementation in the repo, and it is
 * correct, only slower. The better-sqlite3 one lands with the Electron client
 * that has a disk to put it on; this interface is the shape it fills.
 */
export interface UploadProgress {
  /** Object keys this centre has already transported AND verified for `episodeId`. */
  done(episodeId: string): Promise<ReadonlySet<string>>;
  /** Called once per object that has been read back and matched. */
  record(episodeId: string, key: string, sha256: string): Promise<void>;
  /** Called when the episode fails verification: what was remembered is now suspect. */
  forget(episodeId: string): Promise<void>;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Remembers nothing. Correct, and the default until a centre has a disk of its own. */
export const noProgress: UploadProgress = {
  done: async () => EMPTY,
  record: async () => {},
  forget: async () => {},
};

/**
 * One ingest, one prefix, forever.
 *
 * The episode id derives from the directory basename (docs/episode-identity.md)
 * and the ingest id names one delivery of it, so a re-run — or an upload
 * resumed after an interrupt — lands on exactly the same keys and the bucket
 * holds one object set per delivery, not one per attempt (UPL-15). A duplicate
 * delivery keeps its ingest id and so keeps its keys; only a delivery whose
 * bytes actually differ gets a new prefix.
 *
 * The ingest is in the key rather than the episode alone because a review, a
 * verdict and a settlement all bind to an exact ingest. Keying on the episode
 * alone means a changed redelivery overwrites the bytes that were reviewed and
 * paid for, which is the one copy a dispute needs to read.
 */
export const objectKey = (episodeId: string, ingestId: string, relativePath: string): string =>
  `episodes/${episodeId}/${ingestId}/${relativePath}`;

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
export function s3StoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3ObjectStore | null {
  if (!env['STORAGE_ENDPOINT']) return null;
  const missing = ['STORAGE_BUCKET', 'STORAGE_KEY', 'STORAGE_SECRET'].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `STORAGE_ENDPOINT is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not`,
    );
  }
  return new S3ObjectStore({
    endpoint: env['STORAGE_ENDPOINT'],
    bucket: env['STORAGE_BUCKET']!,
    key: env['STORAGE_KEY']!,
    secret: env['STORAGE_SECRET']!,
  });
}

// ---------------------------------------------------------------------------
// The transport inventory

export type TransportFile = { relative_path: string; sha256: string };

async function sha256OfFile(path: string): Promise<string> {
  return sha256Of(createReadStream(path) as AsyncIterable<Uint8Array>);
}

async function sha256Of(bytes: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of bytes) h.update(chunk);
  return h.digest('hex');
}

/**
 * What the cloud must hold is the delivered directory, and `source_files` is
 * deliberately not that.
 *
 * The engine leaves the manifest out of the content fingerprint on purpose
 * (ING-02, packages/ingest/src/ingest.ts): it is a hint that decides nothing,
 * and a device rewriting its own metadata must not read as CHECKSUM-MISMATCH.
 * That is right for identity and wrong for transport — the manifest is the
 * advisory evidence a payment dispute reads, and a cloud copy that cannot
 * reproduce the directory which arrived is not a copy of the delivery.
 *
 * So the transport inventory is `source_files` plus every other file sitting in
 * the session directory, hashed HERE rather than at import. That difference is
 * the point: these digests are not settled facts about the delivery, they are
 * what was transported at this moment, and nothing in this function touches
 * `content_fingerprint`.
 *
 * ponytail: a flat scan of the one directory, which is the layout
 * packages/ingest/src/discover.ts reads; a nested delivery is a different
 * layout the engine does not accept in the first place.
 */
export async function transportInventory(
  dir: string,
  fingerprinted: readonly TransportFile[],
): Promise<TransportFile[]> {
  const known = new Set(fingerprinted.map((f) => f.relative_path));
  const extras: TransportFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || known.has(entry.name)) continue;
    extras.push({ relative_path: entry.name, sha256: await sha256OfFile(join(dir, entry.name)) });
  }
  extras.sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));
  return [...fingerprinted, ...extras];
}

// ---------------------------------------------------------------------------
// The worker

export type Mismatch = {
  relative_path: string;
  expected_sha256: string;
  cloud_sha256: string | null;
};

export type EpisodeUploadResult = {
  uploaded: number;
  kept: number;
  /** How many objects the verdict below covers — source files plus the delivery's remainder. */
  transported: number;
  mismatches: Mismatch[];
};

/**
 * Transport one delivery to the object store and verify it by reading every
 * byte back (UPL-04/05).
 *
 * Safe to re-run at any point: an object already up and matching is kept, an
 * interrupted run resumes, and `force` overwrites an episode whose last
 * read-back failed — its metadata has already proved unreliable, so the
 * "already there" shortcut must not be taken. Throws when transport fails,
 * which leaves the episode unverified and nothing downstream able to act on a
 * partial upload.
 */
export async function uploadEpisode(
  store: ObjectStore,
  args: {
    episodeId: string;
    ingestId: string;
    /** The machine's local cache root; the session directory sits under it. */
    mediaRoot: string;
    sourceBasename: string;
    /** `source_files` from the stored record — the digests the engine settled at import. */
    sourceFiles: readonly TransportFile[];
    force: boolean;
  },
  progress: UploadProgress = noProgress,
): Promise<EpisodeUploadResult> {
  const dir = safeJoin(args.mediaRoot, args.sourceBasename, '.');
  if (dir === null) throw new Error(`unsafe source path: ${args.sourceBasename}`);

  const files = await transportInventory(dir, args.sourceFiles);
  const already = args.force ? EMPTY : await progress.done(args.episodeId);

  let uploaded = 0;
  let kept = 0;
  for (const f of files) {
    const key = objectKey(args.episodeId, args.ingestId, f.relative_path);
    if (already.has(key)) {
      kept += 1;
      continue;
    }
    const local = safeJoin(args.mediaRoot, args.sourceBasename, f.relative_path);
    if (local === null) throw new Error(`unsafe path in record: ${f.relative_path}`);
    if ((await store.put(key, local, f.sha256, args.force)) === 'uploaded') uploaded += 1;
    else kept += 1;
  }

  /**
   * UPL-05: every transported object is downloaded and re-hashed against its
   * reference digest. Reading every byte back is the price of ING-29's "an
   * ETag is not a content digest"; a provider checksum feature can replace it
   * the day the contract names one.
   */
  const mismatches: Mismatch[] = [];
  for (const f of files) {
    const key = objectKey(args.episodeId, args.ingestId, f.relative_path);
    const body = await store.read(key);
    const cloud = body === null ? null : await sha256Of(body);
    if (cloud !== f.sha256) {
      mismatches.push({
        relative_path: f.relative_path,
        expected_sha256: f.sha256,
        cloud_sha256: cloud,
      });
    } else {
      await progress.record(args.episodeId, key, f.sha256);
    }
  }
  if (mismatches.length > 0) await progress.forget(args.episodeId);

  return { uploaded, kept, transported: files.length, mismatches };
}
