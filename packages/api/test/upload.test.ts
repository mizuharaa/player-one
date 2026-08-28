import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { contentFingerprint, deriveEpisodeId, type EpisodeRecord } from '@playerone/contracts';
import { buildApi, hashCredential, objectKey, planOpenUploads, planParts, PART_SIZE, READBACK_STALLS, s3StoreFromEnv, transportInventory, uploadEpisode, type Mismatch, type ObjectStore, type PutResult } from '../src/index.ts';
import { closeDb, db, hasDb, liveClaim, truncate, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('upload');

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/**
 * Path C's cloud leg: upload, read-back verification, the UPL-06 cache gate,
 * and idempotent redelivery (UPL-15/16).
 *
 * No real S3 exists until the GreenNode contract is signed, so the cloud here
 * is `FsObjectStore` below — an fs-backed stub of the two-method `ObjectStore`
 * seam. What these tests prove is everything on OUR side of that seam: which
 * bytes move, what the verdict is based on (read-back, never metadata), what
 * the schema refuses, and that re-delivery never creates a second object set.
 */

// ---------------------------------------------------------------------------
// The parts of the S3 implementation that are pure, tested with no cloud and
// no database — these keep running in the `env -u DATABASE_URL` configuration.

describe('multipart part planning', () => {
  it('plans nothing for an empty file (it is a simple put)', () => {
    expect(planParts(0)).toEqual([]);
  });

  it('plans one part for anything up to the part size', () => {
    expect(planParts(1)).toEqual([{ partNumber: 1, start: 0, end: 1 }]);
    expect(planParts(PART_SIZE)).toEqual([{ partNumber: 1, start: 0, end: PART_SIZE }]);
  });

  it('plans a short tail part rather than losing the remainder', () => {
    const parts = planParts(PART_SIZE + 1);
    expect(parts).toEqual([
      { partNumber: 1, start: 0, end: PART_SIZE },
      { partNumber: 2, start: PART_SIZE, end: PART_SIZE + 1 },
    ]);
  });

  it('is a function of size alone, so a re-run plans identical boundaries', () => {
    // This is what makes resume line up: a part the cloud already holds is
    // recognisable by number and size on the next attempt.
    expect(planParts(3 * PART_SIZE + 7)).toEqual(planParts(3 * PART_SIZE + 7));
    expect(planParts(3 * PART_SIZE).length).toBe(3);
  });
});

describe('open multipart uploads', () => {
  const at = (ms: number) => new Date(ms);

  it('adopts nothing and abandons nothing when the key has no open upload', () => {
    expect(planOpenUploads([])).toEqual({ adopt: null, abandon: [] });
  });

  it('resumes the newest and abandons the attempts no later run could adopt', () => {
    // The measured leak: an interrupted 200 MB upload leaves 128 MB of parts
    // that no object listing shows. `put` only ever resumes the newest open
    // upload on the key, so every older one is billed storage nobody reaches.
    expect(
      planOpenUploads([
        { uploadId: 'old', initiated: at(1000) },
        { uploadId: 'newest', initiated: at(3000) },
        { uploadId: 'middle', initiated: at(2000) },
      ]),
    ).toEqual({ adopt: 'newest', abandon: ['old', 'middle'] });
  });

  it('keeps the only open upload, which is the one a resume needs', () => {
    expect(planOpenUploads([{ uploadId: 'only', initiated: at(1000) }])).toEqual({
      adopt: 'only',
      abandon: [],
    });
  });

  it('abandons nothing on the key when a provider omits Initiated', () => {
    // Sorting on `getTime() ?? 0` makes every timestamp-less candidate equal, so
    // "older" is a guess. Guessing wrong costs a re-sent part on adoption and a
    // destroyed upload on an abort, so only adoption may guess.
    expect(
      planOpenUploads([
        { uploadId: 'a', initiated: null },
        { uploadId: 'b', initiated: at(3000) },
      ]),
    ).toEqual({ adopt: 'b', abandon: [] });
  });

  it('abandons nothing when the newest timestamp is shared', () => {
    const plan = planOpenUploads([
      { uploadId: 'a', initiated: at(3000) },
      { uploadId: 'b', initiated: at(3000) },
    ]);
    expect(plan.abandon).toEqual([]);
    expect(plan.adopt).not.toBeNull();
  });
});

describe('object keys', () => {
  it('name the exact delivery, so a re-run lands on the same keys and a redelivery does not', () => {
    expect(objectKey('abc', 'ing-1', 'left_part0001.mp4')).toBe('episodes/abc/ing-1/left_part0001.mp4');
    expect(objectKey('abc', 'ing-1', 'x.mp4')).toBe(objectKey('abc', 'ing-1', 'x.mp4'));
    expect(objectKey('abc', 'ing-2', 'x.mp4')).not.toBe(objectKey('abc', 'ing-1', 'x.mp4'));
  });
});

describe('the transport inventory', () => {
  it('carries the rest of the delivery, hashed here, without touching the fingerprint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'po-transport-'));
    const media = randomBytes(64);
    const manifest = Buffer.from('{"duration_sec": 41.3}');
    await writeFile(join(dir, 'ego_X_20260813_072310_camera_left.mp4'), media);
    await writeFile(join(dir, 'meta_ego_X_20260813_072310.json'), manifest);

    // source_files is what the engine fingerprinted — the manifest is not in it
    // (ING-02), which is right for identity and wrong for transport.
    const fingerprinted = [
      { relative_path: 'ego_X_20260813_072310_camera_left.mp4', sha256: sha(media) },
    ];
    const inventory = await transportInventory(dir, fingerprinted);
    expect(inventory).toEqual([
      ...fingerprinted,
      { relative_path: 'meta_ego_X_20260813_072310.json', sha256: sha(manifest) },
    ]);
    // The engine's settled digests are copied through untouched, never recomputed.
    expect(inventory[0]).toBe(fingerprinted[0]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('s3StoreFromEnv', () => {
  it('answers null with no endpoint (no contract, no cloud)', () => {
    expect(s3StoreFromEnv({})).toBeNull();
  });

  it('fails closed on a partial configuration, naming what is missing', () => {
    expect(() => s3StoreFromEnv({ STORAGE_ENDPOINT: 'https://s3.example', STORAGE_BUCKET: 'b' })).toThrow(
      /STORAGE_KEY, STORAGE_SECRET/,
    );
  });

  it('builds a store from a complete configuration', () => {
    const store = s3StoreFromEnv({
      STORAGE_ENDPOINT: 'https://s3.example',
      STORAGE_BUCKET: 'b',
      STORAGE_KEY: 'k',
      STORAGE_SECRET: 's',
    });
    expect(store).not.toBeNull();
  });
});

/**
 * The read-back over a link that drops, with no database and no cloud.
 *
 * Measured against a real S3 endpoint (MinIO) before this existed: the GET
 * carried no Range at all, a download cut at 4 MB of an 8 MB object threw
 * `Error: aborted`, and the next attempt pulled all 8 MB again from byte 0.
 * An hourly camera part is 6.4 GB — about 65 minutes at the brief's 13 Mbps —
 * so a link that drops hourly never verified that episode, and an unverified
 * episode is never paid.
 */
describe('a read-back that resumes', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  /** One episode of one file on disk, and the run that transports and verifies it. */
  async function one(bytes: Buffer): Promise<{ store: FlakyStore; run: () => Promise<Mismatch[]> }> {
    const root = await mkdtemp(join(tmpdir(), 'po-resume-'));
    dirs.push(root);
    await mkdir(join(root, 'ego_r'), { recursive: true });
    await writeFile(join(root, 'ego_r', 'camera.mp4'), bytes);
    const store = new FlakyStore();
    const args = {
      episodeId: 'ego_r',
      ingestId: 'ing-1',
      mediaRoot: root,
      sourceBasename: 'ego_r',
      sourceFiles: [{ relative_path: 'camera.mp4', sha256: sha(bytes) }],
      force: false,
    };
    return { store, run: async () => (await uploadEpisode(store, args)).mismatches };
  }

  it('continues from the byte the hash reached, and ends at the whole object\'s digest', async () => {
    // Awkward boundaries on purpose: one byte in, on a chunk edge, and one byte
    // short of the end. A digest is a function of the byte sequence and not of
    // how it was cut up, so all three must produce the same answer.
    const bytes = randomBytes(200_000);
    for (const cut of [1, 4096, 199_999]) {
      const { store, run } = await one(bytes);
      store.cuts = [cut];
      expect(await run(), `cut at ${cut}`).toEqual([]);
      // Two reads, the second starting exactly where the first stopped, and
      // every byte of the object crossing the wire exactly once.
      expect(store.reads).toEqual([
        { from: 0, delivered: cut },
        { from: cut, delivered: bytes.length - cut },
      ]);
    }
  });

  it('survives more drops than its attempt budget, because progress resets it', async () => {
    // The budget has to be consecutive stalls, not total attempts: a 6.4 GB
    // part is over an hour of link, and a link that drops three times in an
    // hour is normal. With a fixed budget this is the file that never verifies.
    const bytes = randomBytes(100_000);
    const { store, run } = await one(bytes);
    store.cuts = Array.from({ length: 12 }, () => 7_000);
    expect(await run()).toEqual([]);
    expect(store.reads.length).toBe(13);
    expect(store.reads.at(-1)?.from).toBe(12 * 7_000);
  });

  it('gives up when a read makes no progress at all, rather than looping forever', async () => {
    const { store, run } = await one(randomBytes(50_000));
    store.cuts = [10_000, 0, 0, 0, 0];
    await expect(run()).rejects.toThrow(/aborted/);
    // One good read, then READBACK_STALLS empty ones and no more.
    expect(store.reads.length).toBe(1 + READBACK_STALLS);
  });

  it('never lets a resume mask a corrupt object', async () => {
    // Upload and verify, then rot the second half of the stored object and read
    // it back over a link that drops in the FIRST half. The resume happens in
    // the clean part, so if resuming could paper over anything, this is the
    // shape where it would: it must still fail, because the digest is still the
    // whole object's, compared against the one the engine settled at import.
    const bytes = randomBytes(120_000);
    const { store, run } = await one(bytes);
    expect(await run()).toEqual([]);
    const key = objectKey('ego_r', 'ing-1', 'camera.mp4');
    store.objects.set(key, Buffer.concat([bytes.subarray(0, 60_000), randomBytes(60_000)]));
    store.reads.length = 0;
    store.cuts = [30_000];
    expect(await run()).toEqual([
      expect.objectContaining({ relative_path: 'camera.mp4', expected_sha256: sha(bytes) }),
    ]);
    expect(store.reads.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The stub cloud

/**
 * The second implementation of the two-method seam. Fs-backed and deliberately
 * able to misbehave in the two ways the real cloud can:
 *
 *   - `corruptOnPut` damages the stored bytes of a key while still recording
 *     the claimed sha256 as metadata and reporting success — in-transit
 *     corruption, the case ING-29 exists for. Metadata then looks clean and
 *     only read-back can tell.
 *   - `failAfterWrites` interrupts an upload run partway, for UPL-16.
 */
class FsObjectStore implements ObjectStore {
  readonly meta = new Map<string, { sha256: string }>();
  readonly writes = new Map<string, number>();
  /** Every key this store was asked to read back, in order. */
  readonly reads: string[] = [];
  corruptOnPut = new Set<string>();
  failAfterWrites: number | null = null;
  private written = 0;

  constructor(private readonly root: string) {}

  private pathOf(key: string): string {
    return join(this.root, key.replaceAll('/', '__'));
  }

  async put(key: string, localPath: string, sha256: string, force = false): Promise<PutResult> {
    const size = (await stat(localPath)).size;
    if (!force) {
      const m = this.meta.get(key);
      const stored = m === undefined ? null : await stat(this.pathOf(key)).catch(() => null);
      if (m !== undefined && m.sha256 === sha256 && stored !== null && stored.size === size) {
        return 'kept';
      }
    }
    if (this.failAfterWrites !== null && this.written >= this.failAfterWrites) {
      throw new Error('injected interrupt');
    }
    const bytes = await readFile(localPath);
    const body = this.corruptOnPut.has(key) ? randomBytes(bytes.length) : bytes;
    await mkdir(this.root, { recursive: true });
    await writeFile(this.pathOf(key), body);
    this.meta.set(key, { sha256 });
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
    this.written += 1;
    return 'uploaded';
  }

  async read(key: string, from = 0): Promise<AsyncIterable<Uint8Array> | null> {
    if (!this.meta.has(key)) return null;
    this.reads.push(key);
    return createReadStream(this.pathOf(key), { start: from });
  }
}

/**
 * A cloud whose downloads die mid-body, which is what a real link does.
 *
 * Nothing else about it is interesting: the objects are buffers and every put
 * succeeds. What it can do that `FsObjectStore` cannot is deliver part of an
 * object and then throw the way a destroyed socket does, once per queued cut,
 * and record which byte each read was asked to start at.
 */
class FlakyStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();
  /** Bytes to hand over before the socket dies, one entry per read; then whole reads. */
  cuts: number[] = [];
  readonly reads: { from: number; delivered: number }[] = [];

  async put(key: string, localPath: string, _sha256: string): Promise<PutResult> {
    if (this.objects.has(key)) return 'kept';
    this.objects.set(key, await readFile(localPath));
    return 'uploaded';
  }

  async read(key: string, from = 0): Promise<AsyncIterable<Uint8Array> | null> {
    const body = this.objects.get(key);
    if (body === undefined) return null;
    const cut = this.cuts.shift();
    const slice = body.subarray(from, cut === undefined ? undefined : from + cut);
    this.reads.push({ from, delivered: slice.length });
    return (async function* () {
      // Real chunks, so the consumer's hash advances before the failure lands.
      for (let i = 0; i < slice.length; i += 4096) yield slice.subarray(i, i + 4096);
      // No HTTP status: the socket died before one arrived, which is the shape
      // `retryableTransport` reads as "ask again".
      if (cut !== undefined) throw new Error('aborted');
    })();
  }
}

// ---------------------------------------------------------------------------

const SECRET = 'k';
const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

describe.skipIf(!hasDb())('the cloud leg', () => {
  beforeEach(truncate);

  const tempDirs: string[] = [];
  afterAll(async () => {
    await closeDb();
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /**
   * Two of everything, per the resolver lesson: a second centre, a second
   * collector, a second card, each with its own machine, operator, handover and
   * batch. Single-handover fixtures are the shape that hid a real payment bug.
   */
  async function harness(options: { verificationGate?: 'local' | 'cloud' } = {}) {
    const d = await db();
    const ids = {
      centreA: uid(),
      centreB: uid(),
      machineA: uid(),
      machineB: uid(),
      operatorA: uid(),
      operatorB: uid(),
      collectorA: uid(),
      collectorB: uid(),
      deviceType: uid(),
      deviceA: uid(),
      deviceB: uid(),
      task: uid(),
      scenario: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values
      (${ids.centreA}, 'HCM', 'A', 'active'), (${ids.centreB}, 'HN', 'B', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values
      (${ids.machineA}, ${ids.centreA}, 'M1', 'active', ${hash}),
      (${ids.machineB}, ${ids.centreB}, 'M2', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
      (${ids.operatorA}, ${ids.centreA}, 'opA', 'centre_operator', ${hash}),
      (${ids.operatorB}, ${ids.centreB}, 'opB', 'centre_operator', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values
      (${ids.collectorA}, 'c1', 'qualified'), (${ids.collectorB}, 'c2', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values
      (${ids.deviceA}, ${ids.deviceType}, 'AZER76400FE', 'active'),
      (${ids.deviceB}, ${ids.deviceType}, 'BZAR12345CD', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 'housework', 1200, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
    await liveClaim(d, ids.task, ids.collectorA);
    await liveClaim(d, ids.task, ids.collectorB);

    const mediaRoot = await mkdtemp(join(tmpdir(), 'po-upload-media-'));
    const cloudRoot = await mkdtemp(join(tmpdir(), 'po-upload-cloud-'));
    tempDirs.push(mediaRoot, cloudRoot);
    const store = new FsObjectStore(cloudRoot);

    const app = buildApi({
      db: d,
      tokenSecret: SECRET,
      mediaRoot,
      objectStore: store,
      verificationGate: options.verificationGate,
    });
    await app.ready();

    const login = async (machine: string, operator: string) => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
      return {
        'x-machine-token': `Bearer ${m.json().token}`,
        authorization: `Bearer ${o.json().token}`,
      };
    };
    const headersA = await login('M1', 'opA');
    const headersB = await login('M2', 'opB');

    const send = async (
      method: 'POST' | 'GET',
      url: string,
      payload?: unknown,
      who: Record<string, string> = headersA,
    ): Promise<LightMyRequestResponse> =>
      (await app.inject({ method, url, payload: payload as never, headers: who })) as unknown as LightMyRequestResponse;

    /** A card at each counter, with one declared session each. */
    const centre = async (
      who: Record<string, string>,
      { collector, device, card }: { collector: string; device: string; card: string },
    ) => {
      const handover = uid();
      await send('POST', '/handovers', {
        id: handover,
        collector_id: collector,
        device_id: device,
        tf_card_id: card,
        handover_time: new Date(T).toISOString(),
      }, who);
      const batch = uid();
      await send('POST', '/upload-batches', {
        id: batch,
        handover_id: handover,
        import_started_at: new Date(T).toISOString(),
      }, who);
      const session = uid();
      await send('POST', `/handovers/${handover}/sessions`, {
        id: session,
        task_id: ids.task,
        scenario_id: ids.scenario,
        others_in_frame: false,
        sensitive_info_present: false,
        prepare_time: new Date(T - 60_000).toISOString(),
      }, who);
      return { handover, batch, session };
    };
    const A = await centre(headersA, { collector: ids.collectorA, device: ids.deviceA, card: 'CARD-1' });
    const B = await centre(headersB, { collector: ids.collectorB, device: ids.deviceB, card: 'CARD-2' });

    /**
     * Writes a session directory into the machine's local store and submits its
     * episode — real bytes, real sha256s, so read-back verification has
     * something true to check against.
     */
    let sessionSeq = 0;
    const submitEpisode = async (
      which: 'A' | 'B',
      files: Record<string, Buffer> = { 'left_part0001.mp4': randomBytes(4096) },
      /** A second delivery of an episode already submitted: same directory, so same id. */
      again?: { basename: string },
    ) => {
      const serial = which === 'A' ? 'AZER76400FE' : 'BZAR12345CD';
      const basename =
        again?.basename ?? `ego_${serial}_20260813_${String(72310 + sessionSeq++).padStart(6, '0')}`;
      const dir = join(mediaRoot, basename);
      await mkdir(dir, { recursive: true });
      const sourceFiles = [];
      for (const [name, bytes] of Object.entries(files)) {
        await writeFile(join(dir, name), bytes);
        sourceFiles.push({ relative_path: name, bytes: bytes.length, sha256: sha(bytes) });
      }
      sourceFiles.sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));

      const first = sourceFiles[0]!;
      // Exactly as the engine derives it; the submit route re-derives and checks.
      const episodeId = deriveEpisodeId(basename);
      const record: EpisodeRecord = {
        schema_version: '1.1.0',
        episode_id: episodeId,
        content_fingerprint: contentFingerprint(sourceFiles),
        state: 'ok',
        source: { path: basename, ingest_tool_version: '0.3.1', ingested_at: new Date().toISOString(), ingest_host: 'test' },
        device: { serial, firmware_declared: '1.0.3', calibration_serial: null },
        declared: null,
        streams: [
          {
            role: 'camera_left',
            parts: [{ file: first.relative_path, bytes: first.bytes, sha256: first.sha256 }],
            pts_source: 'sidecar',
            first_pts_us: String(T * 1000),
            last_pts_us: String((T + 100_000) * 1000),
            sample_count: 300,
            span_s: 100,
            nominal_rate_hz: 30,
          },
        ],
        timing: {
          method: 'pts_sidecar',
          confidence: 'exact',
          usable_start_us: String(T * 1000),
          usable_end_us: String((T + 100_000) * 1000),
          raw_duration_s: 100,
          max_stream_skew_ms: 0,
        },
        calibration: { present: true, files: [] },
        source_files: sourceFiles,
        discrepancies: [],
        unclassified_files: [],
      };

      const batch = which === 'A' ? A.batch : B.batch;
      const who = which === 'A' ? headersA : headersB;
      const submitted = await send('POST', `/upload-batches/${batch}/episodes`, { episodes: [record] }, who);
      expect(submitted.statusCode, submitted.body).toBe(200);
      expect(submitted.json().episodes[0].resolution_state).toBe('resolved');
      const ingestId = await latestIngestOf(episodeId);
      const keys = sourceFiles.map((f) => objectKey(episodeId, ingestId, f.relative_path));
      return { episodeId, ingestId, basename, record, keys, sourceFiles };
    };

    const upload = (batch: string, who: Record<string, string> = headersA) =>
      send('POST', `/upload-batches/${batch}/upload`, undefined, who);
    const cacheClean = (batch: string, who: Record<string, string> = headersA) =>
      send('POST', `/upload-batches/${batch}/cache-clean`, undefined, who);
    const claim = (who: Record<string, string> = headersA) => send('POST', '/api/review/claim', undefined, who);

    const batchRow = async (batch: string) => {
      const rows = (await d.execute(
        sql`select cloud_verified_at, local_cache_cleaned_at, batch_status from upload_batches where id = ${batch}`,
      )) as unknown as Record<string, unknown>[];
      return rows[0]!;
    };
    const latestIngestOf = async (episodeId: string) => {
      const rows = (await d.execute(
        sql`select latest_ingest_id from episodes where episode_id = ${episodeId}`,
      )) as unknown as { latest_ingest_id: string }[];
      return rows[0]!.latest_ingest_id;
    };
    const verificationOf = async (episodeId: string) => {
      const rows = (await d.execute(
        sql`select verification_state from episodes where episode_id = ${episodeId}`,
      )) as unknown as { verification_state: string }[];
      return rows[0]!.verification_state;
    };

    return { d, app, ids, headersA, headersB, send, A, B, store, mediaRoot,
             submitEpisode, upload, cacheClean, claim, batchRow, verificationOf, latestIngestOf };
  }

  // -------------------------------------------------------------------------

  it('UPL-04/05: uploads both centres\' batches, stores sha256 as metadata, and verifies by read-back', async () => {
    const h = await harness();
    const a = await h.submitEpisode('A', {
      'left_part0001.mp4': randomBytes(8192),
      'imu.csv': Buffer.from('timestamp_us\t,x\t,y\t,z\t,type\n'),
    });
    const b = await h.submitEpisode('B');

    // The batch belongs to its machine: centre A's tokens cannot upload centre B's card.
    expect((await h.upload(h.B.batch, h.headersA)).statusCode).toBe(404);

    const resA = await h.upload(h.A.batch);
    expect(resA.statusCode, resA.body).toBe(200);
    expect(resA.json().episodes).toEqual([
      { episode_id: a.episodeId, uploaded: 2, kept: 0, verification_state: 'verified' },
    ]);
    expect(resA.json().cloud_verified).toBe(true);

    const resB = await h.upload(h.B.batch, h.headersB);
    expect(resB.json().episodes[0].verification_state).toBe('verified');

    // One object per source file, under the episode's own prefix, with the
    // recorded sha256 as metadata — for operators browsing the bucket, not as
    // evidence (the verdict above came from read-back).
    for (const [i, key] of a.keys.entries()) {
      expect(h.store.meta.get(key)?.sha256).toBe(a.sourceFiles[i]!.sha256);
    }
    expect(h.store.meta.size).toBe(a.keys.length + b.keys.length);

    expect(await h.verificationOf(a.episodeId)).toBe('verified');
    const row = await h.batchRow(h.A.batch);
    expect(row['cloud_verified_at']).not.toBeNull();
    expect(row['batch_status']).toBe('verified');

    // The verdicts and the flip are audited mutations like every other write.
    const audits = (await h.d.execute(
      sql`select action, count(*) as n from audit_events
           where action in ('episode.cloud_verify', 'batch.cloud_verified') group by action`,
    )) as unknown as { action: string; n: string }[];
    expect(Number(audits.find((x) => x.action === 'episode.cloud_verify')?.n)).toBe(2);
    expect(Number(audits.find((x) => x.action === 'batch.cloud_verified')?.n)).toBe(2);
  });

  it('a corrupted upload is caught by read-back despite clean metadata, blocks review, and heals on re-upload', async () => {
    const h = await harness();
    const bad = await h.submitEpisode('A', { 'left_part0001.mp4': randomBytes(8192) });
    const good = await h.submitEpisode('A', { 'left_part0001.mp4': randomBytes(4096) });

    // The cloud damages the bytes in transit but records the claimed sha256 as
    // metadata — the exact case where trusting ETag/metadata reports success.
    h.store.corruptOnPut.add(bad.keys[0]!);
    const res = await h.upload(h.A.batch);
    expect(res.statusCode, res.body).toBe(200);
    const byId = Object.fromEntries(res.json().episodes.map((e: { episode_id: string }) => [e.episode_id, e]));
    expect(byId[bad.episodeId].verification_state).toBe('failed');
    expect(byId[bad.episodeId].mismatches).toEqual([
      expect.objectContaining({ relative_path: 'left_part0001.mp4', expected_sha256: bad.sourceFiles[0]!.sha256 }),
    ]);
    expect(byId[good.episodeId].verification_state).toBe('verified');
    expect(res.json().cloud_verified).toBe(false);
    expect((await h.batchRow(h.A.batch))['cloud_verified_at']).toBeNull();

    // QR-02: the failed episode does not enter review, under the default local
    // gate included — a copy known to be bad is not a pending one.
    const first = await h.claim();
    expect(first.statusCode).toBe(200);
    expect(first.json().episode_id).toBe(good.episodeId);
    expect((await h.claim()).statusCode).toBe(204);

    // UPL-06: and the cache cannot be recorded clean while the cloud holds bad bytes.
    expect((await h.cacheClean(h.A.batch)).statusCode).toBe(409);
    expect((await h.batchRow(h.A.batch))['local_cache_cleaned_at']).toBeNull();

    // The transfer fault clears; re-running the upload force-overwrites the
    // failed episode from the local cache (its metadata already lied once) and
    // read-back now passes.
    h.store.corruptOnPut.clear();
    const retry = await h.upload(h.A.batch);
    const retried = Object.fromEntries(retry.json().episodes.map((e: { episode_id: string; uploaded: number }) => [e.episode_id, e]));
    expect(retried[bad.episodeId].uploaded).toBe(1);
    expect(retried[bad.episodeId].verification_state).toBe('verified');
    expect(retried[good.episodeId].kept).toBe(1);
    expect(retry.json().cloud_verified).toBe(true);

    // Unblocked: the healed episode is claimable, the cache is closeable — once.
    const second = await h.claim(h.headersB);
    expect(second.statusCode).toBe(200);
    expect(second.json().episode_id).toBe(bad.episodeId);
    expect((await h.cacheClean(h.A.batch)).json()).toEqual({ id: h.A.batch, replayed: false });
    expect((await h.batchRow(h.A.batch))['batch_status']).toBe('closed');
    expect((await h.cacheClean(h.A.batch)).json()).toEqual({ id: h.A.batch, replayed: true });
  });

  it('UPL-15: a second delivery of the same episode moves no bytes and creates no second object set', async () => {
    const h = await harness();
    const e = await h.submitEpisode('A', {
      'left_part0001.mp4': randomBytes(8192),
      'left_part0002.mp4': randomBytes(8192),
    });
    await h.upload(h.A.batch);

    const res = await h.upload(h.A.batch);
    expect(res.json().episodes).toEqual([
      { episode_id: e.episodeId, uploaded: 0, kept: 2, verification_state: 'verified' },
    ]);
    // Same keys, each written exactly once across both runs.
    expect([...h.store.writes.keys()].sort()).toEqual([...e.keys].sort());
    for (const key of e.keys) expect(h.store.writes.get(key)).toBe(1);
  });

  it('a second run of a verified batch reads nothing back, and says so in receipts', async () => {
    // Measured against MinIO before this: run 2 of a clean 16 MB episode moved
    // 0.00 MB up and 16.00 MB down — the read-back loop iterated every file
    // unconditionally. The only thing that can license a skip is a read-back
    // that already happened, which is what a receipt records; an ETag or a
    // metadata field cannot (ING-29).
    const h = await harness();
    const e = await h.submitEpisode('A', {
      'left_part0001.mp4': randomBytes(8192),
      'imu.csv': Buffer.from('timestamp_us\t,x\t,y\t,z\t,type\n'),
    });
    await h.upload(h.A.batch);
    expect(h.store.reads.sort()).toEqual([...e.keys].sort());

    const receipts = (await h.d.execute(
      sql`select object_key, ingest_id, sha256 from cloud_verifications order by object_key`,
    )) as unknown as { object_key: string; ingest_id: string; sha256: string }[];
    expect(receipts.map((r) => r.object_key)).toEqual([...e.keys].sort());
    for (const r of receipts) expect(r.ingest_id).toBe(e.ingestId);

    h.store.reads.length = 0;
    const again = await h.upload(h.A.batch);
    expect(again.json().episodes).toEqual([
      { episode_id: e.episodeId, uploaded: 0, kept: 2, verification_state: 'verified' },
    ]);
    // Nothing sent, nothing pulled back: the whole run is two database reads.
    expect(h.store.reads).toEqual([]);
    expect([...h.store.writes.values()]).toEqual([1, 1]);
  });

  it('repairs one damaged file without re-sending or re-reading the rest of the episode', async () => {
    // Measured against MinIO before this: 512 corrupt bytes on a 16 MB episode
    // cost 16.00 MB up and 16.00 MB down, because a failed episode set `force`
    // for the whole episode and there was no per-file fact to narrow it.
    const h = await harness();
    const e = await h.submitEpisode('A', {
      'left_part0001.mp4': randomBytes(8192),
      'left_part0002.mp4': randomBytes(8192),
      'calibration.yaml': randomBytes(512),
    });
    // The damaged file is read back LAST on purpose: the two receipts written
    // earlier in the same run are the ones a whole-episode forget would throw
    // away, and throwing them away is what made a repair cost an episode.
    const bad = objectKey(e.episodeId, e.ingestId, 'left_part0002.mp4');
    h.store.corruptOnPut.add(bad);

    const first = await h.upload(h.A.batch);
    expect(first.json().episodes[0]).toMatchObject({ verification_state: 'failed' });
    // The two good files keep their receipts; the damaged one has none.
    const kept = (await h.d.execute(
      sql`select object_key from cloud_verifications order by object_key`,
    )) as unknown as { object_key: string }[];
    expect(kept.map((r) => r.object_key)).toEqual(e.keys.filter((k) => k !== bad).sort());

    h.store.corruptOnPut.clear();
    h.store.reads.length = 0;
    const heal = await h.upload(h.A.batch);
    expect(heal.json().episodes[0]).toMatchObject({
      uploaded: 1,
      kept: 2,
      verification_state: 'verified',
    });
    // One file up, one file back down, on an episode of three.
    expect(h.store.reads).toEqual([bad]);
    expect(h.store.writes.get(bad)).toBe(2);
    for (const key of e.keys) if (key !== bad) expect(h.store.writes.get(key)).toBe(1);
  });

  it('UPL-16: an interrupted upload resumes where it stopped, duplicating nothing', async () => {
    const h = await harness();
    const e = await h.submitEpisode('A', {
      'left_part0001.mp4': randomBytes(8192),
      'left_part0002.mp4': randomBytes(8192),
      'left_part0003.mp4': randomBytes(8192),
    });

    h.store.failAfterWrites = 1;
    const interrupted = await h.upload(h.A.batch);
    expect(interrupted.json().episodes[0].error).toMatch(/injected interrupt/);
    expect(await h.verificationOf(e.episodeId)).toBe('pending');
    expect(interrupted.json().cloud_verified).toBe(false);

    h.store.failAfterWrites = null;
    const resumed = await h.upload(h.A.batch);
    expect(resumed.json().episodes[0]).toMatchObject({ uploaded: 2, kept: 1, verification_state: 'verified' });
    for (const key of e.keys) expect(h.store.writes.get(key)).toBe(1);
  });

  it('an episode whose verification fails after its review row exists cannot be claimed either', async () => {
    const h = await harness();
    const e = await h.submitEpisode('A');

    // Materialise and claim the pending row, then let the lease lapse — the
    // takeover path is now the one that would hand it out.
    expect((await h.claim()).statusCode).toBe(200);
    await h.d.execute(sql`update episode_reviews set lease_expires_at = now() - interval '1 minute'`);
    await h.d.execute(sql`update episodes set verification_state = 'failed' where episode_id = ${e.episodeId}`);

    expect((await h.claim(h.headersB)).statusCode).toBe(204);
  });

  it('a verdict is refused when the copy fails DURING a live lease, and pays nothing', async () => {
    const h = await harness();
    const e = await h.submitEpisode('A');

    // The reviewer holds a valid, unexpired lease. A lease lasts minutes and
    // the cloud leg runs in that window, so the read-back verdict can land
    // between the claim and the verdict.
    const claimed = await h.claim();
    expect(claimed.statusCode).toBe(200);
    await h.d.execute(sql`update episodes set verification_state = 'failed' where episode_id = ${e.episodeId}`);

    const res = await h.send('POST', '/api/review/verdict', {
      verdict_id: uid(),
      episode_id: e.episodeId,
      decision: 'good',
      spans: [],
      reject_reasons: [],
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toBe('not reviewable');

    // Nothing was recorded: no verdict, no settlement, and the review is still
    // pending so it can be decided once the copy is healed.
    const rows = (await h.d.execute(sql`
      select (select count(*) from settlements) as settlements,
             (select review_state from episode_reviews where episode_id = ${e.episodeId}) as state
    `)) as unknown as { settlements: string; state: string }[];
    expect(Number(rows[0]!.settlements)).toBe(0);
    expect(rows[0]!.state).toBe('pending');
  });

  it('the cloud gate (QR-02 as written) admits only cloud-verified episodes', async () => {
    const h = await harness({ verificationGate: 'cloud' });
    await h.submitEpisode('A');

    // Local verification passed at import, but under the cloud gate that is
    // not the question QR-02 asks.
    expect((await h.claim()).statusCode).toBe(204);

    await h.upload(h.A.batch);
    expect((await h.claim()).statusCode).toBe(200);
  });

  it('a changed redelivery is unverified again, keeps the reviewed bytes, and blocks the cache', async () => {
    const h = await harness({ verificationGate: 'cloud' });
    const first = await h.submitEpisode('A', { 'left_part0001.mp4': randomBytes(4096) });
    await h.upload(h.A.batch);
    expect(await h.verificationOf(first.episodeId)).toBe('verified');
    expect((await h.cacheClean(h.A.batch)).json()).toEqual({ id: h.A.batch, replayed: false });

    // The card comes back with different bytes for the same session: a second
    // ingest, CHECKSUM-MISMATCH, and nothing of it uploaded anywhere.
    const second = await h.submitEpisode(
      'A',
      { 'left_part0001.mp4': randomBytes(4096) },
      { basename: first.basename },
    );
    expect(second.ingestId).not.toBe(first.ingestId);

    // The verdict does not carry over onto bytes nobody transported...
    expect(await h.verificationOf(first.episodeId)).toBe('pending');
    // ...so under QR-02 as written the new delivery is not reviewable yet.
    expect((await h.claim()).statusCode).toBe(204);

    // ...and the batch, already cloud_verified_at once, cannot be cleaned
    // again on the strength of that historical timestamp.
    await h.d.execute(sql`update upload_batches set local_cache_cleaned_at = null, batch_status = 'verified' where id = ${h.A.batch}`);
    expect((await h.cacheClean(h.A.batch)).statusCode).toBe(409);

    const before = new Set(h.store.meta.keys());
    await h.upload(h.A.batch);
    expect(await h.verificationOf(first.episodeId)).toBe('verified');

    // Verified, and still not reviewable: CHECKSUM-MISMATCH blocks review, so
    // the cloud saying "these bytes arrived intact" does not answer "which of
    // two deliveries of this session is the real one".
    expect((await h.claim()).statusCode).toBe(204);
    await h.d.execute(sql`update defect_codes set blocks_review = false where code = 'CHECKSUM-MISMATCH'`);
    expect((await h.claim()).statusCode).toBe(200);

    // The first delivery's objects are still there, untouched: a review, a
    // verdict and a settlement all name an ingest, and the bytes they named
    // must still be readable.
    for (const key of first.keys) {
      expect(before.has(key)).toBe(true);
      expect(h.store.meta.has(key)).toBe(true);
      expect(h.store.writes.get(key)).toBe(1);
    }
    for (const key of second.keys) expect(before.has(key)).toBe(false);
  });

  it('transports the manifest too, and verifies it, without it joining the fingerprint', async () => {
    const h = await harness();
    const manifest = Buffer.from('{"duration_sec": 41.3, "files": []}');
    const e = await h.submitEpisode('A', { 'left_part0001.mp4': randomBytes(4096) });
    // The manifest is beside the media on the card and out of source_files by
    // design (ING-02). Out of the cloud copy too would mean the delivered
    // directory cannot be reproduced from the bucket.
    await writeFile(join(h.mediaRoot, e.basename, `meta_${e.basename}.json`), manifest);

    // Verified by read-back like every other object: damage it in transit and
    // the episode fails, naming the manifest.
    const manifestKey = objectKey(e.episodeId, e.ingestId, `meta_${e.basename}.json`);
    h.store.corruptOnPut.add(manifestKey);
    const bad = await h.upload(h.A.batch);
    expect(bad.json().episodes[0]).toMatchObject({ uploaded: 2, verification_state: 'failed' });
    expect(bad.json().episodes[0].mismatches).toEqual([
      expect.objectContaining({ relative_path: `meta_${e.basename}.json` }),
    ]);

    // And it heals on its own, without the media beside it moving again.
    h.store.corruptOnPut.clear();
    const res = await h.upload(h.A.batch);
    expect(res.json().episodes[0]).toMatchObject({
      uploaded: 1,
      kept: 1,
      verification_state: 'verified',
    });
    expect(h.store.meta.get(manifestKey)?.sha256).toBe(sha(manifest));
  });

  it('answers 503, not silence, on a machine with no object store configured', async () => {
    const h = await harness();
    const bare = buildApi({ db: h.d, tokenSecret: SECRET });
    await bare.ready();
    const res = await bare.inject({
      method: 'POST',
      url: `/upload-batches/${h.A.batch}/upload`,
      headers: h.headersA,
    });
    expect(res.statusCode).toBe(503);
    await bare.close();
  });
});
