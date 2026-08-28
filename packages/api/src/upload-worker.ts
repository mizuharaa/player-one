import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AbortMultipartUploadCommand,
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
  /**
   * The object's bytes from `from` onward, for read-back verification. Null when
   * the key is absent; an empty stream when `from` is at or past the end.
   *
   * `from` is what makes a read-back survive a dropped link: the caller hashes
   * as the bytes arrive, and when the socket dies it asks again from the byte
   * the hash has already eaten instead of from zero. Measured against MinIO
   * before this existed: a download cut at 4 MB of an 8 MB object threw
   * `Error: aborted`, the episode failed verification, and the next attempt
   * pulled all 8 MB again. An hourly camera part is 6.4 GB, about 65 minutes at
   * the brief's 13 Mbps, so a link that drops hourly never verified that
   * episode, and an unverified episode is never paid.
   */
  read(key: string, from?: number): Promise<AsyncIterable<Uint8Array> | null>;
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
 * entirely still transports correctly — it re-HEADs objects it need not have,
 * and re-reads bytes it has already proven, which is slow and not wrong.
 *
 * What it does decide is cost. Each entry is a receipt for one object: these
 * bytes were pulled back out of the cloud and hashed to this digest. That is
 * the only evidence in the system that lets a re-run skip a read-back, because
 * it is the only one an ETag or a metadata field cannot forge (ING-29), and a
 * read-back of every object on every re-run is 1.00x the corpus per attempt.
 *
 * ponytail: two implementations, and neither is the one PRODUCT.md describes.
 * `noProgress` remembers nothing, which is correct and only slower;
 * `verificationReceipts` in upload.ts keeps the receipts in this database,
 * because the centre and the server are one process today and the wire bill is
 * paid now. The better-sqlite3 one lands with the Electron client that has a
 * disk of its own; this interface is the shape it fills.
 */
export interface UploadProgress {
  /**
   * Object key → the sha256 that was read back and matched, for `episodeId`.
   *
   * The digest is in the answer rather than a bare set of keys because the file
   * at a key can change without the key changing: a redelivery whose media
   * fingerprint is unchanged keeps its ingest, and the manifest beside it is
   * hashed at transport time, so "this key was verified once" is not "this
   * key holds these bytes". A receipt whose digest is not the one about to be
   * transported buys nothing and is ignored.
   */
  done(episodeId: string): Promise<ReadonlyMap<string, string>>;
  /** Called once per object that has been read back and matched. */
  record(episodeId: string, key: string, sha256: string): Promise<void>;
  /** Called for one object whose read-back failed: its receipt is now a lie. */
  forget(episodeId: string, key: string): Promise<void>;
}

const EMPTY: ReadonlyMap<string, string> = new Map();

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

/** One open multipart upload on a key, as `ListMultipartUploads` reports it. */
export type OpenUpload = { uploadId: string; initiated: Date | null };

/**
 * Which open upload to resume, and which ones this system has given up on.
 *
 * Parts of an incomplete multipart upload are stored and billed, and they appear
 * in NO object listing — `ListObjectsV2` on a key with 128 MB of parts under it
 * answers empty. Measured against MinIO on 2026-08-27, an interrupted 200 MB
 * upload left exactly that. So an upload nobody will ever resume is a storage
 * bill no operator can see, and something has to abort it.
 *
 * The rule here is narrow on purpose: only an upload this code would never
 * adopt again is abandoned. `put` resumes the NEWEST open upload on the key, so
 * every strictly older one is already unreachable — a later run will not pick
 * it, and nothing else in this repo starts a multipart upload. Aborting those
 * costs a resume nobody could have performed.
 *
 * Everything else is left alone, and the two cases are worth naming:
 *
 *   - **An upload with no `Initiated`.** S3 always sends it; the SDK types it
 *     optional, and an S3-compatible provider may omit it. Sorting on
 *     `getTime() ?? 0` made every such candidate equal, so adoption picked
 *     whichever the server happened to list last — tolerable, because resuming
 *     the wrong open upload only re-sends parts. Aborting on the same guess is
 *     not tolerable, so one missing timestamp abandons nothing on that key.
 *   - **A tie on the newest timestamp.** Same argument: two uploads initiated in
 *     the same millisecond cannot be ordered, so neither is abandoned.
 *
 * This replaces a comment that refused to abort anything because doing so would
 * "turn one machine's clock skew into another machine's lost resume". The
 * premise does not hold: `Initiated` is stamped by the object store, so every
 * timestamp compared here comes from one clock and no centre's clock is in it.
 * What CAN still be taken away is a second run in flight on the same key from
 * the same machine — it created the older upload, this one abandons it, and its
 * next `UploadPart` fails. Nothing is lost by that: no object is completed from
 * a half-sent upload, and the next run re-sends. A dead upload billing forever
 * is the worse of the two.
 *
 * The one thing it does not cover is an upload for a delivery nobody ever
 * retries — the card goes back, the batch is dropped, the parts stay. No code
 * can tell that from a resume that happens tomorrow. That is the bucket
 * lifecycle rule's job, and `docs/RUNNING.md` carries the command that sets it.
 */
export function planOpenUploads(uploads: readonly OpenUpload[]): {
  adopt: string | null;
  abandon: string[];
} {
  if (uploads.length === 0) return { adopt: null, abandon: [] };
  const sorted = [...uploads].sort(
    (a, b) => (a.initiated?.getTime() ?? 0) - (b.initiated?.getTime() ?? 0),
  );
  const adopt = sorted.at(-1)!;
  if (uploads.some((u) => u.initiated === null)) return { adopt: adopt.uploadId, abandon: [] };
  const newest = adopt.initiated!.getTime();
  return {
    adopt: adopt.uploadId,
    abandon: sorted.filter((u) => u.initiated!.getTime() < newest).map((u) => u.uploadId),
  };
}

const notFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
};

/** An empty body. A fresh iterator each time, so it can be read more than once. */
const NO_BYTES: AsyncIterable<Uint8Array> = {
  async *[Symbol.asyncIterator]() {},
};

/** A range that starts at or past the end of the object: there are no bytes left. */
const rangeSpent = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'InvalidRange' || e.$metadata?.httpStatusCode === 416;
};

/**
 * A transport failure, as opposed to an answer the server meant. No HTTP status
 * at all means the socket died before one arrived — which is what a dropped
 * link looks like from inside a response body — and 5xx and 429 are the server
 * asking to be asked again. A 403 from a bad signature is neither, and retrying
 * it just spends the link three times.
 *
 * Same predicate, same name and same body as the one `test/cloud-minio` adds
 * for the upload direction; if both land, keep one copy.
 */
const retryableTransport = (err: unknown): boolean => {
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  if (status === undefined) return true;
  return status >= 500 || status === 429;
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

  async read(key: string, from = 0): Promise<AsyncIterable<Uint8Array> | null> {
    try {
      const r = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          // An open-ended range: everything the object still has after `from`.
          // Omitted at zero so the common case stays an ordinary GET.
          ...(from > 0 ? { Range: `bytes=${from}-` } : {}),
        }),
      );
      return (r.Body ?? null) as AsyncIterable<Uint8Array> | null;
    } catch (err) {
      if (notFound(err)) return null;
      // Asked for bytes the object does not have: the caller already holds all
      // of them. Answering "no more bytes" rather than throwing keeps the
      // caller's loop from having to know S3's status codes — and it cannot
      // hide a short read, because the digest is still compared against the
      // whole file's.
      if (rangeSpent(err)) return NO_BYTES;
      throw err;
    }
  }

  private async findOpenUpload(key: string): Promise<string | null> {
    const r = await this.client.send(
      new ListMultipartUploadsCommand({ Bucket: this.bucket, Prefix: key }),
    );
    const mine = (r.Uploads ?? [])
      .filter((u) => u.Key === key && u.UploadId !== undefined)
      .map((u) => ({ uploadId: u.UploadId!, initiated: u.Initiated ?? null }));
    const plan = planOpenUploads(mine);
    for (const uploadId of plan.abandon) {
      /**
       * Hygiene, not the job. A provider that refuses the abort — no
       * permission, or the upload already gone — leaves a bill this run cannot
       * clear, and failing the transport over that would trade a storage cost
       * for a delivery that does not arrive. The lifecycle rule is the backstop.
       */
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
        );
      } catch {
        /* ignored on purpose; see above */
      }
    }
    return plan.adopt;
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
 * How many times in a row a read-back may make no progress before it gives up.
 *
 * Consecutive, not total: the budget resets the moment a byte arrives. A 6.4 GB
 * camera part is ~65 minutes of link at the brief's 13 Mbps and a real link
 * drops more than three times in 65 minutes, so a fixed total would fail the
 * exact file this exists for. Every attempt that moves at least one byte
 * shortens what is left, so the loop still terminates.
 */
export const READBACK_STALLS = 3;

/**
 * The sha256 of a whole object, read back in as many pieces as the link forces.
 *
 * One hash spans every piece. That is the whole trick: the digest is a function
 * of the byte sequence and not of how it was cut up, so resuming at the byte
 * the hash has already eaten produces exactly the digest an unbroken download
 * would have produced. `at` counts bytes fed into the hash, never bytes that
 * arrived, so a chunk lost between the socket and `update` is re-requested
 * rather than skipped.
 *
 * Nothing here can turn a bad object into a good one: the answer is still
 * compared against the digest the engine settled at import, and a resume that
 * silently lost or repeated bytes moves the digest away from it, never toward
 * it. A body that ends early with no error — a truncation the HTTP layer did
 * not notice — is hashed short and reported as a mismatch, which fails closed:
 * an intact object may cost a second read-back, a damaged one is never called
 * verified.
 *
 * Null when the key is absent, which is a mismatch of a different kind and the
 * caller's to report.
 */
async function sha256OfObject(store: ObjectStore, key: string): Promise<string | null> {
  const h = createHash('sha256');
  let at = 0;
  for (let stalls = 0; ; ) {
    const body = await store.read(key, at);
    if (body === null) return null;
    const before = at;
    try {
      for await (const chunk of body) {
        h.update(chunk);
        at += chunk.length;
      }
      return h.digest('hex');
    } catch (err) {
      stalls = at > before ? 0 : stalls + 1;
      if (stalls >= READBACK_STALLS || !retryableTransport(err)) throw err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** stalls));
    }
  }
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
 * Safe to re-run at any point, and a re-run costs only what it has to. Both
 * loops skip a file the centre already read back and matched at exactly these
 * bytes, so a second run over a verified episode moves nothing in either
 * direction; before that skip existed, a re-run re-downloaded every byte
 * (measured against MinIO: 0.00 MB up and 16.00 MB down on a clean 16 MB
 * episode). What remains is per file, which is the point — one damaged object
 * used to re-send and re-read the whole episode (measured: 512 corrupt bytes on
 * a 16 MB episode cost 16.00 MB up and 16.00 MB down), and now costs the one
 * file, because its receipt was the only one dropped.
 *
 * Everything the skip rests on is a read-back that happened: nothing here
 * trusts an ETag or a metadata field, and `force` still overwrites the objects
 * that are being re-sent, because after a failed read-back their metadata is
 * exactly what cannot be trusted. Throws when transport fails, which leaves the
 * episode unverified and nothing downstream able to act on a partial upload.
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
    /**
     * Distrust the "already there" metadata check on the files this run still
     * has to send. It does not reach a file with a matching receipt: that file
     * was proven by read-back, which is the evidence force exists to replace.
     */
    force: boolean;
  },
  progress: UploadProgress = noProgress,
): Promise<EpisodeUploadResult> {
  const dir = safeJoin(args.mediaRoot, args.sourceBasename, '.');
  if (dir === null) throw new Error(`unsafe source path: ${args.sourceBasename}`);

  const files = await transportInventory(dir, args.sourceFiles);
  const receipts = await progress.done(args.episodeId);
  /** Verified on an earlier run, on exactly these bytes: nothing to send, nothing to read back. */
  const proven = (key: string, sha256: string): boolean => receipts.get(key) === sha256;

  let uploaded = 0;
  let kept = 0;
  for (const f of files) {
    const key = objectKey(args.episodeId, args.ingestId, f.relative_path);
    if (proven(key, f.sha256)) {
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
    if (proven(key, f.sha256)) continue;
    const cloud = await sha256OfObject(store, key);
    if (cloud !== f.sha256) {
      mismatches.push({
        relative_path: f.relative_path,
        expected_sha256: f.sha256,
        cloud_sha256: cloud,
      });
      await progress.forget(args.episodeId, key);
    } else {
      await progress.record(args.episodeId, key, f.sha256);
    }
  }

  return { uploaded, kept, transported: files.length, mismatches };
}
