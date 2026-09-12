import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveEpisodeId, type EpisodeRecord } from '@playerone/contracts';
import {
  buildApi,
  hashCredential,
  objectKey,
  signToken,
  s3StoreFromEnv,
  PART_SIZE,
  UPLOAD_API_REFUSALS,
  type DirectUploadStore,
  type ObjectStore,
  type PutResult,
} from '../src/index.ts';
import { MESSAGES, LOCALES } from '../src/i18n.ts';
import { appDb, closeDb, db, hasDb, liveClaim, truncate, useDatabase, violates } from '../../store/test/db.ts';
/**
 * The engine itself, and the real corpus. An unmeasured delivery is measured by
 * this service, so the proofs for it have to run the same engine the route
 * runs, over real recordings — a synthetic fixture proves the plumbing and says
 * nothing about whether ffprobe can read what a phone actually sends.
 */
import { ingest } from '../../ingest/src/ingest.ts';
import { hasSession, session as corpusSession } from '../../ingest/test/sessions.ts';
import { episodeRecord } from './fixtures.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('collector_upload');

/**
 * Path A: the route a collector's phone uploads a recorded session by.
 *
 * Three layers, deliberately:
 *
 *   1. The refusals and the schema, which need a database and no cloud.
 *   2. The route's own bookkeeping — planning, resume, the verdict, the audit
 *      trail — against an in-memory store that implements the same two seams
 *      the real one does. This is what runs everywhere.
 *   3. The whole thing against a real S3 endpoint, with bytes actually moving
 *      over signed URLs. Gated on `STORAGE_ENDPOINT`, because most machines do
 *      not have one — and it is the layer that matters most, because the two
 *      above it can agree with each other and both be wrong about the protocol.
 */

const SECRET = 'k';
const uid = () => randomUUID();
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const hasStore = (): boolean => (process.env['STORAGE_ENDPOINT'] ?? '') !== '';

// ---------------------------------------------------------------------------
// The stub cloud

/**
 * An in-memory implementation of both seams Path A uses.
 *
 * It does NOT fake HTTP. A "signed URL" here is an opaque token the test hands
 * straight back to `putDirect` / `putPart`, which is exactly the amount of
 * pretending a stub should do: what it proves is that this service plans the
 * right parts, notices the right ones are already there, and reaches the right
 * verdict. Whether a real store accepts the signature is layer 3's job, and no
 * stub can answer it.
 */
class MemoryStore implements ObjectStore, DirectUploadStore {
  readonly tags = new Map<string, Record<string, string>>();

  async tag(key: string, tags: Record<string, string>): Promise<void> {
    this.tags.set(key, tags);
  }

  readonly objects = new Map<string, Buffer>();
  /** The sha256 the presign or the multipart create carried, as S3 metadata would. */
  private readonly meta = new Map<string, string>();
  private readonly open = new Map<string, { id: string; parts: Map<number, Buffer> }>();
  /** Every presign issued, so a test can assert resume asked for exactly the missing parts. */
  readonly signed: string[] = [];

  async put(key: string, _localPath: string, sha256: string): Promise<PutResult> {
    this.meta.set(key, sha256);
    return 'uploaded';
  }

  async read(key: string): Promise<AsyncIterable<Uint8Array> | null> {
    const body = this.objects.get(key);
    if (body === undefined) return null;
    return (async function* () {
      yield body;
    })();
  }

  async head(key: string): Promise<{ bytes: number; sha256: string | null } | null> {
    const body = this.objects.get(key);
    if (body === undefined) return null;
    return { bytes: body.length, sha256: this.meta.get(key) ?? null };
  }

  async presignPut(key: string, sha256: string): Promise<string> {
    this.meta.set(key, sha256);
    this.signed.push(`put ${key}`);
    return `mem://put/${key}`;
  }

  async beginMultipart(key: string, sha256: string): Promise<string> {
    this.meta.set(key, sha256);
    const held = this.open.get(key);
    if (held !== undefined) return held.id;
    const id = uid();
    this.open.set(key, { id, parts: new Map() });
    return id;
  }

  async openMultipart(key: string): Promise<string | null> {
    return this.open.get(key)?.id ?? null;
  }

  async heldParts(key: string): Promise<{ partNumber: number; size: number }[]> {
    const held = this.open.get(key);
    if (held === undefined) return [];
    return [...held.parts].map(([partNumber, b]) => ({ partNumber, size: b.length }));
  }

  async presignPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    this.signed.push(`part ${key} ${partNumber}`);
    return `mem://part/${key}/${uploadId}/${partNumber}`;
  }

  async finishMultipart(key: string): Promise<void> {
    const held = this.open.get(key);
    if (held === undefined) return;
    const ordered = [...held.parts].sort(([a], [b]) => a - b).map(([, b]) => b);
    this.objects.set(key, Buffer.concat(ordered));
    this.open.delete(key);
  }

  // -- what the "phone" does with a signed URL --------------------------------

  putDirect(url: string, body: Buffer): void {
    const key = url.slice('mem://put/'.length);
    this.objects.set(key, body);
  }

  putPart(url: string, body: Buffer): void {
    const rest = url.slice('mem://part/'.length);
    const at = rest.lastIndexOf('/');
    const partNumber = Number(rest.slice(at + 1));
    const key = rest.slice(0, rest.lastIndexOf('/', at - 1));
    this.open.get(key)!.parts.set(partNumber, body);
  }

  /** A store that wrote the object but got the bytes wrong. Metadata still reads clean. */
  corrupt(key: string): void {
    const body = this.objects.get(key)!;
    const damaged = Buffer.from(body);
    damaged[0] = damaged[0]! ^ 0xff;
    this.objects.set(key, damaged);
  }
}

// ---------------------------------------------------------------------------
// A recorded session, as a phone would present it

type Delivery = {
  record: EpisodeRecord;
  /** Every file, with its bytes — what the "phone" holds. */
  blobs: Map<string, Buffer>;
  extras: { relative_path: string; bytes: number; sha256: string }[];
};

/**
 * A session directory shaped like the corpus: two camera parts, a PTS sidecar,
 * a calibration YAML, and the manifest — which is deliberately NOT in
 * `source_files`, exactly as the engine leaves it out of the fingerprint.
 */
function delivery(opts: { serial?: string; basename?: string; big?: number } = {}): Delivery {
  const serial = opts.serial ?? 'AZER76400FE';
  const basename = opts.basename ?? `ego_${serial}_20260813_${String(Math.random()).slice(2, 8)}`;
  const record = episodeRecord({ basename, serial });

  const blobs = new Map<string, Buffer>();
  const put = (name: string, bytes: number): void => {
    blobs.set(name, randomBytes(bytes));
  };
  put(`${basename}_camera_left_part0001.mp4`, opts.big ?? 4096);
  put(`${basename}_camera_left_part0001_pts.csv`, 512);
  put(`${basename}_calibration_camera.yaml`, 256);
  const manifest = Buffer.from(`{"session_id": null, "device": "${serial}"}`);

  const sourceFiles = [...blobs]
    .map(([relative_path, b]) => ({ relative_path, bytes: b.length, sha256: sha(b) }))
    .sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));

  const manifestName = `meta_${basename}.json`;
  blobs.set(manifestName, manifest);

  return {
    record: { ...record, source_files: sourceFiles },
    blobs,
    extras: [
      { relative_path: manifestName, bytes: manifest.length, sha256: sha(manifest) },
    ],
  };
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasDb())('Path A, the collector upload', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  type Harness = Awaited<ReturnType<typeof harness>>;

  /**
   * Two collectors, each with a session of their own — the second is not
   * decoration. Every fixture in this repo once used a single owner, and a
   * query scoped to the wrong parent passed the whole suite; "not your session"
   * cannot be tested with one collector in the database.
   */
  /**
   * `mediaRoot` and `reviewerMedia` are for the unmeasured half of the route
   * only: the server measures the delivery on its own disk, so that half needs
   * somewhere to put it, and proving a reviewer can then play it needs the
   * PLT-10 flag — which `buildApi` refuses without TLS, so it brings
   * `secureCookies` with it exactly as a deployment must.
   */
  async function harness(
    store: MemoryStore = new MemoryStore(),
    options: { mediaRoot?: string; reviewerMedia?: boolean } = {},
  ) {
    const d = await db();
    const ids = {
      centre: uid(),
      machine: uid(),
      operator: uid(),
      reviewer: uid(),
      collector: uid(),
      collector2: uid(),
      deviceType: uid(),
      device: uid(),
      task: uid(),
      scenario: uid(),
      session: uid(),
      session2: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centre}, 'HCM', 'c', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values (${ids.machine}, ${ids.centre}, 'M1', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.operator}, ${ids.centre}, 'op', 'centre_operator', ${hash})`);
    // The PaXini reviewer: no centre at all, which `operators_centre_check`
    // allows only because the role says reviewer.
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.reviewer}, null, 'pax-01', 'reviewer', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector2}, 'c2', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 'housework', 1200, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);

    for (const [session, collector] of [
      [ids.session, ids.collector],
      [ids.session2, ids.collector2],
    ] as const) {
      const claim = await liveClaim(d, ids.task, collector);
      // APP-16: the app binds a session BEFORE recording, so it carries no
      // handover and its origin is 'app'. That is the shape Path A uploads for.
      await d.execute(sql`
        insert into collection_sessions
          (id, task_id, collector_id, scenario_id, task_claim_id, unit_price, currency,
           others_in_frame, sensitive_info_present, session_origin)
        values (${session}, ${ids.task}, ${collector}, ${ids.scenario}, ${claim}, 1200, 'VND',
                false, false, 'app')`);
    }

    const app = buildApi({
      db: await appDb(),
      tokenSecret: SECRET,
      objectStore: store,
      mediaRoot: options.mediaRoot,
      reviewerMediaEnabled: options.reviewerMedia,
      secureCookies: options.reviewerMedia === true,
    });
    await app.ready();

    /**
     * The collector's bearer token, signed here rather than obtained from a
     * sign-in route — there is no collector sign-in on this branch and this
     * file does not invent one. `feat/collector-auth` owns the credential and
     * the route that issues this claim; what is tested here is every rule that
     * applies once such a token exists.
     *
     * `epoch` is `collectors.token_epoch`, which starts at 1 and is re-read on
     * every request. It became required when feat/collector-auth merged, and a
     * token that names the wrong one is refused 401 — that is the revocation
     * story, and these tests are not about it. The end-to-end proof that a
     * token minted by the real sign-in route reaches this route is in
     * packages/api/test/collector-token.test.ts.
     */
    const tokenFor = (collectorId: string, epoch = 1): Record<string, string> => ({
      authorization: `Bearer ${signToken(SECRET, { kind: 'collector', collectorId, epoch })}`,
    });

    const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'M1', secret: 'pw' } });
    const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: 'op', secret: 'pw' } });
    const staffHeaders: Record<string, string> = {
      'x-machine-token': `Bearer ${m.json().token}`,
      authorization: `Bearer ${o.json().token}`,
    };

    /**
     * The reviewer's own token, read back out of the cookie the console's
     * sign-in route set — the same value a browser would carry. Nothing here
     * mints one by hand, so the test fails if sign-in stops issuing it.
     */
    const session = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { external_ref: 'pax-01', operator_secret: 'pw' } as never,
    });
    const reviewerCookie = [session.headers['set-cookie'] ?? []].flat().join(' | ');
    const reviewerHeaders: Record<string, string> = {
      authorization: `Bearer ${decodeURIComponent(/po_operator=([^;]+)/.exec(reviewerCookie)?.[1] ?? '')}`,
    };

    const headers = tokenFor(ids.collector);
    const otherHeaders = tokenFor(ids.collector2);
    const post = async (url: string, payload?: unknown, who = headers) =>
      (await app.inject({ method: 'POST', url, payload: payload as never, headers: who })) as unknown as LightMyRequestResponse;
    const get = async (url: string, who = headers, extra: Record<string, string> = {}) =>
      (await app.inject({ method: 'GET', url, headers: { ...who, ...extra } })) as unknown as LightMyRequestResponse;

    return { app, store, ids, headers, otherHeaders, staffHeaders, reviewerHeaders, post, get };
  }

  const register = (h: Harness, d: Delivery, session: string, id = uid()) =>
    h.post('/api/me/uploads', {
      id,
      collection_session_id: session,
      episode: d.record,
      extra_files: d.extras,
    });

  /** Send every file the plan still wants, through the "signed" URLs it named. */
  function sendPlan(h: Harness, d: { blobs: Map<string, Buffer> }, files: { relative_path: string; put_url?: string; parts?: { part_number: number; start: number; end: number; url: string }[] }[]): void {
    for (const f of files) {
      const body = d.blobs.get(f.relative_path)!;
      if (f.put_url !== undefined) h.store.putDirect(f.put_url, body);
      for (const p of f.parts ?? []) h.store.putPart(p.url, body.subarray(p.start, p.end));
    }
  }

  // -------------------------------------------------------------------------

  it('registers a delivery and plans it onto Path C’s own object keys', async () => {
    const h = await harness();
    const d = delivery();
    const res = await register(h, d, h.ids.session);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.upload_path).toBe('A');
    expect(body.outcome).toBe('new');
    expect(body.attributed).toBe(true);
    expect(body.episode_id).toBe(deriveEpisodeId(d.record.source.path));

    // Every file of the DELIVERY, not only the fingerprinted ones: the manifest
    // has to reach the cloud even though ING-02 keeps it out of the digest.
    expect(body.files.map((f: { relative_path: string }) => f.relative_path).sort()).toEqual(
      [...d.blobs.keys()].sort(),
    );
    // The same key function Path C uses, so a session that arrives twice by two
    // routes lands on one object set.
    for (const f of body.files) {
      expect(f.key).toBe(objectKey(body.episode_id, body.ingest_id, f.relative_path));
      expect(f.done).toBe(false);
      expect(f.put_url).toBeTruthy();
    }
  });

  it('puts the episode on the session the collector named, as its own kind of attribution', async () => {
    const h = await harness();
    const res = await register(h, delivery(), h.ids.session);
    const d = await db();
    const rows = (await d.execute(sql`
      select collection_session_id, resolution_state, resolution_method, upload_path
        from episodes where episode_id = ${res.json().episode_id}
    `)) as unknown as Record<string, string>[];
    expect(rows[0]).toMatchObject({
      collection_session_id: h.ids.session,
      resolution_state: 'resolved',
      // Not 'manual': an operator's override at a counter and a collector's
      // declaration before recording are different evidence, and this column is
      // the only place that difference is recorded.
      resolution_method: 'app_declared',
      upload_path: 'A',
    });
  });

  it('traces the delivery to the collector, the session and the device (UPL-07)', async () => {
    const h = await harness();
    const id = uid();
    const res = await register(h, delivery(), h.ids.session, id);
    const d = await db();
    const rows = (await d.execute(sql`
      select collector_id, collection_session_id, device_id, device_serial, episode_id, ingest_id, state, file_count
        from collector_uploads where id = ${id}
    `)) as unknown as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      collector_id: h.ids.collector,
      collection_session_id: h.ids.session,
      device_id: h.ids.device,
      device_serial: 'AZER76400FE',
      episode_id: res.json().episode_id,
      ingest_id: res.json().ingest_id,
      state: 'registered',
      file_count: 4,
    });
  });

  it('records the registration as a collector’s own act in the audit trail', async () => {
    const h = await harness();
    const id = uid();
    await register(h, delivery(), h.ids.session, id);
    const d = await db();
    const rows = (await d.execute(sql`
      select actor_role, collector_id, operator_id, upload_device_id, upload_centre_id
        from audit_events where action = 'upload.register' and target_id = ${id}
    `)) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      actor_role: 'collector',
      collector_id: h.ids.collector,
      // A collector has no operator row, no machine and no centre, and a row
      // claiming otherwise would be evidence of something that did not happen.
      operator_id: null,
      upload_device_id: null,
      upload_centre_id: null,
    });
  });

  // -- the refusals ---------------------------------------------------------

  it('refuses a session that does not exist, by name', async () => {
    const h = await harness();
    const res = await register(h, delivery(), uid());
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('upload_unknown_session');
  });

  it('refuses another collector’s session, by name', async () => {
    const h = await harness();
    // The second collector's session exists and is perfectly valid — it is just
    // not this token's. The only comparison possible is against the token,
    // because the request never carried a collector id.
    const res = await register(h, delivery(), h.ids.session2);
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('upload_foreign_session');

    const d = await db();
    const rows = (await d.execute(sql`select count(*)::int as n from collector_uploads`)) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses a delivery bigger than one upload may declare, by name', async () => {
    const h = await harness();
    const d = delivery();
    // 70 GiB declared. Part 8 puts a recorded hour at ~16 GB and a collector-day
    // at ~23 GB, so this is not a session — it is a client that is wrong about
    // itself, and the refusal happens before anything is stored.
    d.record.source_files[0]!.bytes = 70 * 1024 * 1024 * 1024;
    const res = await register(h, d, h.ids.session);
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('upload_payload_too_large');

    const store = await db();
    const rows = (await store.execute(sql`select count(*)::int as n from episodes`)) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses to take an upload that is already complete, by name', async () => {
    const h = await harness();
    const d = delivery();
    const id = uid();
    const plan = (await register(h, d, h.ids.session, id)).json();
    sendPlan(h, d, plan.files);
    expect((await h.post(`/api/me/uploads/${id}/complete`)).statusCode).toBe(200);

    const again = await h.post(`/api/me/uploads/${id}/complete`);
    expect(again.statusCode).toBe(409);
    expect(again.json().constraint).toBe('upload_already_complete');

    const reRegister = await register(h, d, h.ids.session, id);
    expect(reRegister.statusCode).toBe(409);
    expect(reRegister.json().constraint).toBe('upload_already_complete');
  });

  it('refuses a checksum mismatch by name, and blocks the episode from review (UPL-04)', async () => {
    const h = await harness();
    const d = delivery();
    const id = uid();
    const plan = (await register(h, d, h.ids.session, id)).json();
    sendPlan(h, d, plan.files);
    // A store that wrote the object and got the bytes wrong. Its recorded
    // sha256 still reads clean, which is exactly why the verdict is a read-back
    // and never metadata.
    h.store.corrupt(plan.files[0].key);

    const res = await h.post(`/api/me/uploads/${id}/complete`);
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('upload_checksum_mismatch');
    expect(res.json().mismatches).toHaveLength(1);
    expect(res.json().mismatches[0].relative_path).toBe(plan.files[0].relative_path);

    const d2 = await db();
    const rows = (await d2.execute(sql`
      select verification_state from episodes where episode_id = ${plan.episode_id}
    `)) as unknown as { verification_state: string }[];
    expect(rows[0]!.verification_state).toBe('failed');

    // The whole point of the refusal: no reviewer is ever handed this episode.
    const claimed = await h.post('/api/review/claim', undefined, h.staffHeaders);
    expect(claimed.statusCode).toBe(204);
  });

  it('lets a failed delivery be sent again and verify (the normal retry)', async () => {
    const h = await harness();
    const d = delivery();
    const id = uid();
    const plan = (await register(h, d, h.ids.session, id)).json();
    sendPlan(h, d, plan.files);
    h.store.corrupt(plan.files[0].key);
    expect((await h.post(`/api/me/uploads/${id}/complete`)).statusCode).toBe(409);

    /**
     * The phone is told which file did not match and sends that one again. This
     * is the path a bad connection actually takes, and the upload row is
     * sitting at 'failed' when it does — so the verdict update must accept a
     * failed row, not only a registered one.
     */
    const resumed = (await h.get(`/api/me/uploads/${id}`)).json();
    sendPlan(h, d, resumed.files);
    const done = await h.post(`/api/me/uploads/${id}/complete`);
    expect(done.statusCode).toBe(200);
    expect(done.json().verification_state).toBe('verified');

    const store = await db();
    const rows = (await store.execute(sql`
      select verification_state from episodes where episode_id = ${plan.episode_id}
    `)) as unknown as { verification_state: string }[];
    expect(rows[0]!.verification_state).toBe('verified');
  });

  it('has an English, a Chinese and a Vietnamese sentence for every refusal it raises', () => {
    for (const constraint of UPLOAD_API_REFUSALS) {
      for (const locale of LOCALES) {
        const key = `bo.refused.${constraint}` as keyof typeof MESSAGES.en;
        expect(MESSAGES[locale][key], `no ${locale} sentence for ${constraint}`).toBeTruthy();
      }
    }
  });

  // -- resume, which is the point -------------------------------------------

  it('plans a multipart for a file at or above the part size, and a put below it', async () => {
    const h = await harness();
    // Declared, not held: the planner never reads the bytes, and a 130 MiB
    // buffer in a unit test buys nothing. What arrives is checked in layer 3.
    const d = delivery();
    d.record.source_files[0]!.bytes = 2 * PART_SIZE + 7;

    const plan = (await register(h, d, h.ids.session)).json();
    const big = plan.files.find((f: { bytes: number }) => f.bytes > PART_SIZE);
    expect(big.upload_id).toBeTruthy();
    expect(big.parts.map((p: { part_number: number; bytes: number }) => [p.part_number, p.bytes])).toEqual([
      [1, PART_SIZE],
      [2, PART_SIZE],
      [3, 7],
    ]);
    expect(big.held_parts).toEqual([]);
    for (const f of plan.files) {
      if (f.bytes < PART_SIZE) expect(f.put_url).toBeTruthy();
    }
  });

  it('resumes: what already arrived is not asked for again', async () => {
    const h = await harness();
    const d = delivery({ big: 2 * PART_SIZE + 7 });
    // The record has to agree with the bytes, because the read-back at the end
    // hashes what actually arrived.
    const bigName = [...d.blobs.keys()].find((n) => d.blobs.get(n)!.length > PART_SIZE)!;
    const id = uid();
    const plan = (await register(h, d, h.ids.session, id)).json();
    const big = plan.files.find((f: { relative_path: string }) => f.relative_path === bigName);
    expect(big.parts).toHaveLength(3);

    // The phone sends the first part and the link drops. Nothing else arrives,
    // and nothing on the phone survives.
    const body = d.blobs.get(bigName)!;
    h.store.putPart(big.parts[0].url, body.subarray(big.parts[0].start, big.parts[0].end));

    const resumed = (await h.get(`/api/me/uploads/${id}`)).json();
    const again = resumed.files.find((f: { relative_path: string }) => f.relative_path === bigName);
    expect(again.held_parts).toEqual([1]);
    expect(again.parts.map((p: { part_number: number }) => p.part_number)).toEqual([2, 3]);
    // The same multipart, not a second one: parts already in the cloud stay.
    expect(again.upload_id).toBe(big.upload_id);

    // Finish, and the delivery verifies from parts sent in two separate attempts.
    sendPlan(h, d, resumed.files);
    const done = await h.post(`/api/me/uploads/${id}/complete`);
    expect(done.statusCode).toBe(200);
    expect(done.json().verification_state).toBe('verified');
  });

  it('asks for nothing when the objects are already up (UPL-15/16)', async () => {
    const h = await harness();
    const d = delivery();
    const id = uid();
    const first = (await register(h, d, h.ids.session, id)).json();
    sendPlan(h, d, first.files);
    expect((await h.post(`/api/me/uploads/${id}/complete`)).statusCode).toBe(200);

    // A second delivery of the same session, under a new upload id. It resolves
    // to the same episode and the same ingest, so it lands on the same keys —
    // and every one of them is already there.
    const second = (await register(h, d, h.ids.session, uid())).json();
    expect(second.outcome).toBe('duplicate');
    expect(second.ingest_id).toBe(first.ingest_id);
    expect(second.files.every((f: { done: boolean }) => f.done)).toBe(true);
    expect(second.files.every((f: { put_url?: string }) => f.put_url === undefined)).toBe(true);
  });

  it('replays a registration rather than writing a second one', async () => {
    const h = await harness();
    const d = delivery();
    const id = uid();
    const first = (await register(h, d, h.ids.session, id)).json();
    const replay = (await register(h, d, h.ids.session, id)).json();

    expect(replay.replayed).toBe(true);
    expect(replay.episode_id).toBe(first.episode_id);
    expect(replay.ingest_id).toBe(first.ingest_id);
    expect(replay.files.map((f: { key: string }) => f.key)).toEqual(
      first.files.map((f: { key: string }) => f.key),
    );

    const store = await db();
    const rows = (await store.execute(sql`select count(*)::int as n from collector_uploads`)) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(1);
  });

  it('will not move an attribution a counter already made', async () => {
    const h = await harness();
    const d = delivery();
    const store = await db();
    // The card reached an upload centre first and an operator resolved it.
    await register(h, d, h.ids.session);
    const episodeId = deriveEpisodeId(d.record.source.path);
    await store.execute(sql`update episodes set upload_path = 'C' where episode_id = ${episodeId}`);

    const second = (await register(h, d, h.ids.session, uid())).json();
    expect(second.attributed).toBe(false);
    const rows = (await store.execute(sql`
      select upload_path from episodes where episode_id = ${episodeId}
    `)) as unknown as { upload_path: string }[];
    expect(rows[0]!.upload_path).toBe('C');
  });

  // -- the review gate -------------------------------------------------------

  it('keeps a Path A episode out of review until its bytes are checked', async () => {
    const h = await harness();
    const d = delivery();
    const id = uid();
    const plan = (await register(h, d, h.ids.session, id)).json();

    /**
     * Registered, nothing sent. Under the default 'local' gate a Path C
     * episode at `pending` is reviewable, because ADR 0001 reads the check the
     * engine ran over the copy on the centre's disk. There is no such copy
     * here — the engine ran on a phone — so a pending Path A episode is footage
     * the platform may not hold at all.
     */
    expect((await h.post('/api/review/claim', undefined, h.staffHeaders)).statusCode).toBe(204);

    sendPlan(h, d, plan.files);
    expect((await h.post(`/api/me/uploads/${id}/complete`)).statusCode).toBe(200);

    const claimed = await h.post('/api/review/claim', undefined, h.staffHeaders);
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().episode_id).toBe(plan.episode_id);
  });

  // -------------------------------------------------------------------------
  // The UNMEASURED delivery: the one a phone can actually make.
  //
  // Everything above sends a finished `EpisodeRecord`, which no Android device
  // can produce — the engine needs Node's fs and ffprobe. These send the
  // directory's name and every file's size and digest, and the SERVER measures.

  /** Somewhere for the server to put a delivery it is about to measure. */
  const mediaRoots: string[] = [];
  const newMediaRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'playerone-l2-'));
    mediaRoots.push(root);
    return root;
  };
  afterAll(async () => {
    for (const root of mediaRoots) await rm(root, { recursive: true, force: true });
  });

  /**
   * A real session directory read off disk, exactly as a phone reads a card:
   * every file, its length, and its sha256. No measurement of any kind.
   */
  async function declaredFrom(dir: string) {
    const blobs = new Map<string, Buffer>();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile()) blobs.set(entry.name, await readFile(join(dir, entry.name)));
    }
    return {
      dir,
      basename: basename(dir),
      blobs,
      files: [...blobs]
        .map(([relative_path, b]) => ({ relative_path, bytes: b.length, sha256: sha(b) }))
        .sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1)),
    };
  }

  /** The committed synthetic session: engine-measurable, and on every machine. */
  const SYNTH = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'fixtures',
    'sessions',
    'delivery-a',
    'ego_SYNTH0000001_20260813_090800',
  );

  type Declared = Awaited<ReturnType<typeof declaredFrom>>;

  const registerUnmeasured = (h: Harness, c: Declared, sessionId: string, id = uid()) =>
    h.post('/api/me/uploads', {
      id,
      collection_session_id: sessionId,
      session_basename: c.basename,
      files: c.files,
      client_version: 'phone-test/0.1',
    });

  /** Register, send every byte through the plan, and ask for the verdict. */
  async function deliver(h: Harness, c: Declared, sessionId: string, id = uid()) {
    const registered = await registerUnmeasured(h, c, sessionId, id);
    expect(registered.statusCode, registered.body).toBe(200);
    sendPlan(h, c, registered.json().files);
    const completed = await h.post(`/api/me/uploads/${id}/complete`);
    return { id, registered, completed };
  }

  it('refuses a session directory name the engine does not recognise, by name', async () => {
    const h = await harness(new MemoryStore(), { mediaRoot: await newMediaRoot() });
    const c = await declaredFrom(SYNTH);
    const res = await h.post('/api/me/uploads', {
      id: uid(),
      collection_session_id: h.ids.session,
      session_basename: 'my documents',
      files: c.files,
    });
    // 400 as the contract froze it, and the NAME in `constraint` — which is the
    // field every client in this repo reads a refusal name out of. Under
    // `error` the phone flattened it to a generic invalid-request.
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'refused',
      constraint: 'session_basename_unrecognised',
      session_basename: 'my documents',
    });
    const d = await db();
    const [n] = (await d.execute(sql`select count(*)::int as n from collector_uploads`)) as unknown as { n: number }[];
    expect(n!.n).toBe(0);
  });

  it('answers 503 rather than choosing a directory when no media root is configured', async () => {
    const h = await harness();
    const c = await declaredFrom(SYNTH);
    const id = uid();
    const plan = await registerUnmeasured(h, c, h.ids.session, id);
    expect(plan.statusCode, plan.body).toBe(200);
    sendPlan(h, c, plan.json().files);
    const res = await h.post(`/api/me/uploads/${id}/complete`);
    expect(res.statusCode, res.body).toBe(503);
  });

  /**
   * Proof A. The whole route over a real recording: nothing measured by the
   * client, the server measures, and a reviewer plays the result.
   */
  it.skipIf(!hasSession('072310'))(
    'A: measures a real phone delivery on the server and serves its footage to a reviewer',
    async () => {
      const root = await newMediaRoot();
      const h = await harness(new MemoryStore(), { mediaRoot: root, reviewerMedia: true });
      const c = await declaredFrom(corpusSession('072310'));
      const id = uid();

      const registered = await registerUnmeasured(h, c, h.ids.session, id);
      expect(registered.statusCode, registered.body).toBe(200);
      const plan = registered.json();
      const episodeId = deriveEpisodeId(c.basename);

      expect(plan.measured).toBe(false);
      expect(plan.state).toBe('registered');
      expect(plan.episode_id).toBe(episodeId);
      // No ingest yet, because an ingest is a measurement and none has happened.
      expect(plan.ingest_id).toBeNull();
      expect(plan.part_size).toBe(PART_SIZE);
      expect(plan.files).toHaveLength(c.files.length);
      for (const f of plan.files) {
        expect(f.key).toBe(objectKey(episodeId, id, f.relative_path));
        expect(f.done).toBe(false);
      }
      // Nothing measured is stored, and nothing is on this machine's disk yet.
      const d = await db();
      const [before] = (await d.execute(sql`select count(*)::int as n from episodes`)) as unknown as { n: number }[];
      expect(before!.n).toBe(0);
      expect(await readdir(root)).toEqual([]);

      sendPlan(h, c, plan.files);

      // The one moment the server can observe that bytes are moving.
      const moving = await h.get(`/api/me/uploads/${id}`);
      expect(moving.json().state).toBe('transferring');

      const done = await h.post(`/api/me/uploads/${id}/complete`);
      expect(done.statusCode, done.body).toBe(200);
      const body = done.json();
      expect(body.state).toBe('ingested');
      expect(body.verification_state).toBe('verified');
      expect(body.attributed).toBe(true);
      expect(body.outcome).toBe('new');
      expect(body.reused).toBe(false);
      expect(body.transported).toBe(c.files.length);
      expect(body.ingest_id).not.toBeNull();

      // The engine measured it, and the measurement is the engine's, not the phone's.
      const [ing] = (await d.execute(sql`
        select i.ingest_id, i.measured_duration_s::float8 as duration, i.state, i.source_basename,
               e.verification_state, e.upload_path, e.collection_session_id,
               (select count(*)::int from episode_streams s where s.ingest_id = i.ingest_id) as streams,
               (select count(*)::int from episode_files f where f.ingest_id = i.ingest_id) as files
          from episode_ingests i join episodes e on e.episode_id = i.episode_id
         where i.episode_id = ${episodeId}
      `)) as unknown as Record<string, unknown>[];
      expect(ing).toMatchObject({
        source_basename: c.basename,
        verification_state: 'verified',
        upload_path: 'A',
        collection_session_id: h.ids.session,
      });
      expect(ing!['duration'] as number).toBeGreaterThan(0);
      expect(ing!['streams'] as number).toBeGreaterThan(0);
      expect(body.ingest_id).toBe(ing!['ingest_id']);

      // One delivery, one episode, and the row names both.
      const [row] = (await d.execute(sql`
        select measured, state, episode_id, ingest_id, held_reason, failed_reason,
               jsonb_array_length(declared_files) as declared, file_count
          from collector_uploads where id = ${id}
      `)) as unknown as Record<string, unknown>[];
      expect(row).toMatchObject({
        measured: false,
        state: 'ingested',
        episode_id: episodeId,
        ingest_id: body.ingest_id,
        held_reason: null,
        failed_reason: null,
        file_count: c.files.length,
      });

      // The cloud verification is recorded the way Path C records it.
      const [receipts] = (await d.execute(sql`
        select count(*)::int as n from cloud_verifications where episode_id = ${episodeId}
      `)) as unknown as { n: number }[];
      expect(receipts!.n).toBe(c.files.length);

      // Every declared byte is on this machine's disk, unchanged.
      const onDisk = await declaredFrom(join(root, c.basename));
      expect(onDisk.files).toEqual(c.files);

      /**
       * And a reviewer can play it. This is what the lane is for: a
       * phone-delivered session that the review lane can watch and settle,
       * reached through the audited claim and nothing else.
       */
      const claim = await h.post('/api/review/claim', undefined, h.reviewerHeaders);
      expect(claim.statusCode, claim.body).toBe(200);
      expect(claim.json().episode_id).toBe(episodeId);
      const part = claim.json().media.parts[0].url as string;
      expect(part).toBe(`/media/episode/${episodeId}/part/0`);

      const ranged = await h.get(part, h.reviewerHeaders, { range: 'bytes=0-4095' });
      expect(ranged.statusCode, ranged.body).toBe(206);
      expect(ranged.headers['content-range']).toMatch(/^bytes 0-4095\/\d+$/);
      expect(ranged.rawPayload).toHaveLength(4096);
      // Actual bytes: the first 4 KiB of the real file the phone sent.
      const served = ranged.headers['content-range']!.toString();
      const total = Number(served.slice(served.indexOf('/') + 1));
      const name = [...c.blobs.keys()].find((k) => c.blobs.get(k)!.length === total);
      expect(name, 'the served part is one of the delivered files').toBeDefined();
      expect(Buffer.from(ranged.rawPayload).equals(c.blobs.get(name!)!.subarray(0, 4096))).toBe(true);
    },
    180_000,
  );

  /**
   * Proof B, phone first. The card follows it to a counter and the counter
   * reports the reuse: one episode, one ingest, so one bill is possible.
   */
  it.skipIf(!hasSession('072310'))(
    'B: the same session imported at a counter afterwards is one episode and reports the reuse',
    async () => {
      const root = await newMediaRoot();
      const h = await harness(new MemoryStore(), { mediaRoot: root });
      const c = await declaredFrom(corpusSession('072310'));
      const { completed } = await deliver(h, c, h.ids.session);
      expect(completed.statusCode, completed.body).toBe(200);
      const episodeId = completed.json().episode_id as string;

      // Path C, over the very same directory: a card at a counter, on a batch.
      const handover = uid();
      const batch = uid();
      const post = (url: string, payload: unknown) => h.post(url, payload, h.staffHeaders);
      expect((await post('/handovers', {
        id: handover,
        collector_id: h.ids.collector,
        device_id: h.ids.device,
        tf_card_id: 'CARD-L2',
        handover_time: new Date().toISOString(),
      })).statusCode).toBeLessThan(300);
      expect((await post('/upload-batches', {
        id: batch,
        handover_id: handover,
        import_started_at: new Date().toISOString(),
      })).statusCode).toBeLessThan(300);

      const record = await ingest(join(root, c.basename));
      const submitted = await post(`/upload-batches/${batch}/episodes`, { episodes: [record] });
      expect(submitted.statusCode, submitted.body).toBe(200);
      // The counter's own answer names the reuse: no second ingest row.
      expect(submitted.json().episodes[0]).toMatchObject({
        episode_id: episodeId,
        outcome: 'duplicate',
      });

      const d = await db();
      const [counts] = (await d.execute(sql`
        select (select count(*)::int from episodes) as episodes,
               (select count(*)::int from episode_ingests) as ingests,
               (select ingest_count from episodes where episode_id = ${episodeId}) as ingest_count
      `)) as unknown as Record<string, number>[];
      // One episode and one ingest is what makes one bill the only possibility:
      // review, settlement and bill all hang off the ingest.
      expect(counts).toMatchObject({ episodes: 1, ingests: 1, ingest_count: 1 });
    },
    180_000,
  );

  /**
   * Proof B, card first. The directory is already on this machine and its bytes
   * are the delivery's bytes, so the phone's copy is recognised rather than
   * written over, and still only one episode exists.
   */
  it.skipIf(!hasSession('072516'))(
    'B: a session already on this machine is reused, not overwritten, and stays one episode',
    async () => {
      const root = await newMediaRoot();
      const h = await harness(new MemoryStore(), { mediaRoot: root });
      const c = await declaredFrom(corpusSession('072516'));
      const d = await db();

      // What a counter import leaves behind: the session folder under the media
      // root, and the measurement on a batch.
      await cp(c.dir, join(root, c.basename), { recursive: true });
      const handover = uid();
      const batch = uid();
      const post = (url: string, payload: unknown) => h.post(url, payload, h.staffHeaders);
      await post('/handovers', {
        id: handover,
        collector_id: h.ids.collector,
        device_id: h.ids.device,
        tf_card_id: 'CARD-L2-FIRST',
        handover_time: new Date().toISOString(),
      });
      await post('/upload-batches', {
        id: batch,
        handover_id: handover,
        import_started_at: new Date().toISOString(),
      });
      const imported = await post(`/upload-batches/${batch}/episodes`, {
        episodes: [await ingest(join(root, c.basename))],
      });
      expect(imported.statusCode, imported.body).toBe(200);
      expect(imported.json().episodes[0].outcome).toBe('new');
      const [counter] = (await d.execute(sql`
        select episode_id, ingest_id, collection_session_id, resolution_state, upload_path
          from episodes join episode_ingests using (episode_id)
      `)) as unknown as Record<string, unknown>[];

      const { completed } = await deliver(h, c, h.ids.session);
      expect(completed.statusCode, completed.body).toBe(200);
      const body = completed.json();
      expect(body.state).toBe('ingested');
      expect(body.outcome).toBe('duplicate');
      expect(body.reused).toBe(true);
      expect(body.ingest_id).toBe(counter!['ingest_id']);
      /**
       * And the counter's attribution is not moved. The operator's answer was
       * made against the card with a handover behind it, and settlement may
       * already have read it.
       */
      expect(body.episode_upload_path).toBe('C');
      expect(body.attributed).toBe(false);

      const [counts] = (await d.execute(sql`
        select (select count(*)::int from episodes) as episodes,
               (select count(*)::int from episode_ingests) as ingests
      `)) as unknown as Record<string, number>[];
      expect(counts).toMatchObject({ episodes: 1, ingests: 1 });
      const [after] = (await d.execute(sql`
        select collection_session_id, resolution_state, upload_path, verification_state
          from episodes where episode_id = ${counter!['episode_id'] as string}
      `)) as unknown as Record<string, unknown>[];
      expect(after).toMatchObject({
        collection_session_id: counter!['collection_session_id'],
        resolution_state: counter!['resolution_state'],
        upload_path: 'C',
        // What the phone delivery DID add: a cloud copy that has been read back.
        verification_state: 'verified',
      });
      // Byte for byte what the counter left there.
      expect((await declaredFrom(join(root, c.basename))).files).toEqual(c.files);
      // And no staging directory left behind.
      expect((await readdir(root)).sort()).toEqual([c.basename]);
    },
    180_000,
  );

  /** Proof C. The phone's connection died before the answer arrived, so it asks again. */
  it('C: completing twice is idempotent — no second ingest and no second episode', async () => {
    const h = await harness(new MemoryStore(), { mediaRoot: await newMediaRoot() });
    const c = await declaredFrom(SYNTH);
    const { id, completed } = await deliver(h, c, h.ids.session);
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json().replayed).toBe(false);

    const again = await h.post(`/api/me/uploads/${id}/complete`);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().replayed).toBe(true);
    // The same sentence, read back from the database both times.
    const { replayed: _a, ...first } = completed.json();
    const { replayed: _b, ...second } = again.json();
    expect(second).toEqual(first);

    const d = await db();
    const [counts] = (await d.execute(sql`
      select (select count(*)::int from episodes) as episodes,
             (select count(*)::int from episode_ingests) as ingests,
             (select count(*)::int from audit_events where action = 'upload.ingest') as ingested_rows
    `)) as unknown as Record<string, number>[];
    expect(counts).toMatchObject({ episodes: 1, ingests: 1, ingested_rows: 1 });
  }, 60_000);

  /** Proof D. One byte wrong in the cloud, and nothing reaches this machine. */
  it('D: a tampered byte fails read-back, and nothing is written under the media root', async () => {
    const root = await newMediaRoot();
    const h = await harness(new MemoryStore(), { mediaRoot: root });
    const c = await declaredFrom(SYNTH);
    const id = uid();
    const plan = await registerUnmeasured(h, c, h.ids.session, id);
    sendPlan(h, c, plan.json().files);
    // A store that wrote the object and got the bytes wrong. Its metadata still
    // reads clean, which is why the verdict has to be a read-back.
    const damaged = plan.json().files.find((f: { bytes: number }) => f.bytes > 0);
    h.store.corrupt(damaged.key);

    const res = await h.post(`/api/me/uploads/${id}/complete`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().constraint).toBe('upload_checksum_mismatch');
    expect(res.json().mismatches[0].relative_path).toBe(damaged.relative_path);

    const d = await db();
    const [row] = (await d.execute(sql`
      select state, failed_reason, episode_id, ingest_id, completed_at is not null as completed
        from collector_uploads where id = ${id}
    `)) as unknown as Record<string, unknown>[];
    expect(row).toMatchObject({
      state: 'failed',
      failed_reason: 'checksum_mismatch',
      episode_id: null,
      ingest_id: null,
      completed: true,
    });
    // No episode was invented for bytes that were never proven, and the media
    // root is exactly as it was found.
    const [n] = (await d.execute(sql`select count(*)::int as n from episodes`)) as unknown as { n: number }[];
    expect(n!.n).toBe(0);
    expect(await readdir(root)).toEqual([]);
  }, 60_000);

  /** Proof E. A directory of that name is already here and it is not this recording. */
  it('E: a basename collision holds the delivery and leaves the original untouched', async () => {
    const root = await newMediaRoot();
    const h = await harness(new MemoryStore(), { mediaRoot: root });
    const c = await declaredFrom(SYNTH);

    // The same names and the same sizes, different bytes — a re-recorded session
    // at the same basename is exactly the case that must not silently pass.
    const there = join(root, c.basename);
    await mkdir(there, { recursive: true });
    const original = new Map<string, Buffer>();
    for (const [name, body] of c.blobs) {
      const other = Buffer.alloc(body.length, 0x5a);
      original.set(name, other);
      await writeFile(join(there, name), other);
    }

    const { id, completed } = await deliver(h, c, h.ids.session);
    expect(completed.statusCode, completed.body).toBe(409);
    expect(completed.json().constraint).toBe('upload_basename_collision');

    const d = await db();
    const [row] = (await d.execute(sql`
      select state, held_reason, episode_id, ingest_id from collector_uploads where id = ${id}
    `)) as unknown as Record<string, unknown>[];
    expect(row).toMatchObject({ state: 'held', held_reason: 'basename_collision', episode_id: null, ingest_id: null });
    // Nothing measured, nothing overwritten, nothing left lying about.
    const [n] = (await d.execute(sql`select count(*)::int as n from episodes`)) as unknown as { n: number }[];
    expect(n!.n).toBe(0);
    for (const [name, body] of original) {
      expect(Buffer.from(await readFile(join(there, name))).equals(body), name).toBe(true);
    }
    expect((await readdir(root)).sort()).toEqual([c.basename]);

    // And asking again says the same thing rather than trying again.
    const again = await h.post(`/api/me/uploads/${id}/complete`);
    expect(again.statusCode).toBe(409);
    expect(again.json().constraint).toBe('upload_basename_collision');
  }, 60_000);

  it('finishes a delivery whose read-back passed before the process died', async () => {
    /**
     * `verified` is resumable, not terminal. The bytes are proven and the only
     * route that ingests is this one, so refusing would leave the delivery
     * unfinishable — which is what it used to do.
     */
    const h = await harness(new MemoryStore(), { mediaRoot: await newMediaRoot() });
    const c = await declaredFrom(SYNTH);
    const id = uid();
    const plan = await registerUnmeasured(h, c, h.ids.session, id);
    sendPlan(h, c, plan.json().files);
    const d = await db();
    await d.execute(sql`
      update collector_uploads set state = 'verified', completed_at = now() where id = ${id}`);

    const res = await h.post(`/api/me/uploads/${id}/complete`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().state).toBe('ingested');
  }, 60_000);

  it('refuses a delivery that declares no files at all', async () => {
    const h = await harness(new MemoryStore(), { mediaRoot: await newMediaRoot() });
    const res = await h.post('/api/me/uploads', {
      id: uid(),
      collection_session_id: h.ids.session,
      session_basename: 'ego_AZER76400FE_20260813_072310',
      files: [],
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('will not let an unmeasured delivery reuse a measured delivery’s id, or the reverse', async () => {
    const h = await harness(new MemoryStore(), { mediaRoot: await newMediaRoot() });
    const id = uid();
    await register(h, delivery(), h.ids.session, id);
    const crossed = await registerUnmeasured(h, await declaredFrom(SYNTH), h.ids.session, id);
    expect(crossed.statusCode, crossed.body).toBe(400);
    expect(crossed.json().error).toMatch(/measured delivery/);
  });

  // -- who may call it -------------------------------------------------------

  it('scopes a collector token to /api/me and nothing else', async () => {
    const h = await harness();
    for (const url of ['/api/tasks', '/api/collectors', '/upload-batches']) {
      const res = await h.get(url);
      expect(res.statusCode, url).toBe(403);
    }
    /**
     * `/whoami` is the exception, and it is feat/collector-auth's call. That
     * branch admits the identity route to every kind of session — the app has
     * to be able to ask "who am I?" with the only token it holds — and it
     * answers `{ role: 'collector', collector_id }` and nothing else. This
     * branch asserted 403 here, written before that route existed. Its own
     * test in collector-auth.test.ts asserts the 200, and the merge kept
     * collector-auth's shape.
     */
    const me = await h.get('/whoami');
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().role).toBe('collector');
  });

  it('refuses a staff session on the collector’s own scope', async () => {
    const h = await harness();
    const res = await register(h, delivery(), h.ids.session, uid());
    expect(res.statusCode).toBe(200);
    const staff = await h.post('/api/me/uploads', { id: uid(), collection_session_id: h.ids.session, episode: delivery().record }, h.staffHeaders);
    expect(staff.statusCode).toBe(403);
  });

  it('does not hand one collector another’s upload', async () => {
    const h = await harness();
    const id = uid();
    await register(h, delivery(), h.ids.session, id);
    expect((await h.get(`/api/me/uploads/${id}`, h.otherHeaders)).statusCode).toBe(404);
    expect((await h.post(`/api/me/uploads/${id}/complete`, undefined, h.otherHeaders)).statusCode).toBe(404);
  });

  it('refuses an episode id that does not derive from its own basename', async () => {
    const h = await harness();
    const d = delivery();
    const res = await h.post('/api/me/uploads', {
      id: uid(),
      collection_session_id: h.ids.session,
      episode: { ...d.record, episode_id: deriveEpisodeId('ego_X_20260101_000000') },
      extra_files: d.extras,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().expected_episode_id).toBe(deriveEpisodeId(d.record.source.path));
  });

  it('refuses a file name that would sign a URL outside the delivery', async () => {
    const h = await harness();
    /**
     * `objectKey` interpolates the path, so without this check the answer would
     * be a signed URL for `episodes/<other>/…` — a collector able to overwrite
     * footage somebody else has already had reviewed and paid for.
     */
    for (const name of ['../../escape.mp4', 'sub/dir.mp4', 'back\\slash.mp4', '..']) {
      const d = delivery();
      d.record.source_files[0]!.relative_path = name;
      const res = await register(h, d, h.ids.session);
      expect(res.statusCode, name).toBe(400);
      expect(res.json().relative_path, name).toBe(name);
    }
    // And the same rule on the declared remainder, which has its own schema.
    const d = delivery();
    d.extras[0]!.relative_path = '../meta.json';
    expect((await register(h, d, h.ids.session)).statusCode).toBe(400);
  });

  it('answers 404 for an upload id that is not a uuid, rather than 500', async () => {
    const h = await harness();
    expect((await h.get('/api/me/uploads/not-a-uuid')).statusCode).toBe(404);
    expect((await h.post('/api/me/uploads/not-a-uuid/complete')).statusCode).toBe(404);
  });

  it('refuses to complete a second attempt at a delivery another attempt already verified', async () => {
    const h = await harness();
    const d = delivery();
    const first = uid();
    const plan = (await register(h, d, h.ids.session, first)).json();
    sendPlan(h, d, plan.files);
    expect((await h.post(`/api/me/uploads/${first}/complete`)).statusCode).toBe(200);

    // A second registration of the same delivery is legal — it resolves to the
    // same ingest and asks for nothing. Completing it is not: one delivery has
    // one verified upload, or one recording could be delivered twice and read
    // as two. Refused by name before a byte is downloaded, and by
    // `collector_uploads_verified_key` if it ever got past that.
    const second = uid();
    expect((await register(h, d, h.ids.session, second)).statusCode).toBe(200);
    const done = await h.post(`/api/me/uploads/${second}/complete`);
    expect(done.statusCode).toBe(409);
    expect(done.json().constraint).toBe('upload_already_complete');
    expect(done.json().upload_id).toBe(first);
  });

  it('answers 503 when no object store is configured', async () => {
    const d = await db();
    /**
     * A REAL collector row, because the token is now checked against one.
     * feat/collector-auth re-reads `collectors.token_epoch` on every request
     * and answers 401 when there is no row — a deleted collector and a revoked
     * one get the same answer. This test was written when a signed token with
     * any uuid in it reached the handler, and used a uuid belonging to nobody;
     * it now asserts what the route body does, which is what it was for.
     */
    const collector = uid();
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${collector}, 'col-503', 'qualified')`);
    const app = buildApi({ db: await appDb(), tokenSecret: SECRET });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/uploads',
      payload: { id: uid(), collection_session_id: uid(), episode: delivery().record } as never,
      headers: { authorization: `Bearer ${signToken(SECRET, { kind: 'collector', collectorId: collector, epoch: 1 })}` },
    });
    expect(res.statusCode, res.body).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// The schema, with no application in the path

describe.skipIf(!hasDb())('what the schema refuses about a Path A upload', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  /** Two collectors, two sessions, one episode with one ingest. Raw SQL only. */
  async function seed() {
    const d = await db();
    const ids = {
      collector: uid(),
      collector2: uid(),
      task: uid(),
      scenario: uid(),
      session: uid(),
      session2: uid(),
      episode: uid(),
      ingest: uid(),
      centre: uid(),
      machine: uid(),
      operator: uid(),
    };
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector2}, 'c2', 'qualified')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 't', 1200, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centre}, 'HCM', 'c', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status) values (${ids.machine}, ${ids.centre}, 'M1', 'active')`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role) values (${ids.operator}, ${ids.centre}, 'op', 'centre_operator')`);
    for (const [session, collector] of [
      [ids.session, ids.collector],
      [ids.session2, ids.collector2],
    ] as const) {
      const claim = await liveClaim(d, ids.task, collector);
      await d.execute(sql`
        insert into collection_sessions
          (id, task_id, collector_id, scenario_id, task_claim_id, unit_price, currency,
           others_in_frame, sensitive_info_present, session_origin)
        values (${session}, ${ids.task}, ${collector}, ${ids.scenario}, ${claim}, 1200, 'VND', false, false, 'app')`);
    }
    await d.execute(sql`
      insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at, ingest_count)
      values (${ids.episode}, 'AZER76400FE', '20260813_072310', now(), now(), 1)`);
    await d.execute(sql`
      insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename,
        measured_duration_s, timing_source, timing_confidence, manifest_present, engine_version, host, ingested_at, record_json)
      values (${ids.ingest}, ${ids.episode}, ${'a'.repeat(64)}, 'ok', 'ego_AZER76400FE_20260813_072310',
        100, 'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb)`);
    await d.execute(sql`update episodes set latest_ingest_id = ${ids.ingest} where episode_id = ${ids.episode}`);
    return { d, ids };
  }

  const insertUpload = (
    d: Awaited<ReturnType<typeof db>>,
    ids: Record<string, string>,
    over: Partial<{ id: string; collector: string; session: string; state: string; completedAt: string | null }> = {},
  ) =>
    d.execute(sql`
      insert into collector_uploads
        (id, collector_id, collection_session_id, device_serial, episode_id, ingest_id,
         source_basename, file_count, total_bytes, state, completed_at)
      values (${over.id ?? uid()}, ${over.collector ?? ids.collector}, ${over.session ?? ids.session},
              'AZER76400FE', ${ids.episode}, ${ids.ingest}, 'ego_AZER76400FE_20260813_072310', 4, 4096,
              ${over.state ?? 'registered'},
              ${over.completedAt === undefined ? (over.state === undefined || over.state === 'registered' ? null : new Date().toISOString()) : over.completedAt})`);

  it('cannot record an upload against a session that is not the collector’s', async () => {
    const { d, ids } = await seed();
    await violates(
      'collector_uploads_session_fk',
      insertUpload(d, ids, { collector: ids.collector, session: ids.session2 }),
    );
    // The same row with the matching owner is accepted, so the refusal is the
    // pairing and not the shape.
    await insertUpload(d, ids, { collector: ids.collector2, session: ids.session2 });
  });

  it('cannot record two verified uploads of one delivery', async () => {
    const { d, ids } = await seed();
    await insertUpload(d, ids, { state: 'verified' });
    await violates('collector_uploads_verified_key', insertUpload(d, ids, { state: 'verified' }));
    // A retry that has not succeeded is not the same claim, and is allowed.
    await insertUpload(d, ids, { state: 'failed' });
    await insertUpload(d, ids, { state: 'registered' });
  });

  it('cannot say an upload finished without saying when, or the reverse', async () => {
    const { d, ids } = await seed();
    await violates(
      'collector_uploads_completed_check',
      insertUpload(d, ids, { state: 'verified', completedAt: null }),
    );
    await violates(
      'collector_uploads_completed_check',
      insertUpload(d, ids, { state: 'registered', completedAt: new Date().toISOString() }),
    );
  });

  // -- what 0029 made unrepresentable ---------------------------------------

  /** An unmeasured row: no episode, no ingest, and its own inventory. */
  const insertUnmeasured = (
    d: Awaited<ReturnType<typeof db>>,
    ids: Record<string, string>,
    over: Partial<{
      state: string;
      completedAt: string | null;
      episode: string | null;
      ingest: string | null;
      held: string | null;
      failed: string | null;
      declared: string;
      fileCount: number;
    }> = {},
  ) =>
    d.execute(sql`
      insert into collector_uploads
        (id, collector_id, collection_session_id, device_serial, measured, episode_id, ingest_id,
         source_basename, file_count, total_bytes, declared_files, state, held_reason, failed_reason, completed_at)
      values (${uid()}, ${ids.collector}, ${ids.session}, 'AZER76400FE', false,
              ${over.episode === undefined ? null : over.episode},
              ${over.ingest === undefined ? null : over.ingest},
              'ego_AZER76400FE_20260813_072310', ${over.fileCount ?? 1}, 4096,
              ${sql.raw(`'${over.declared ?? '[{"relative_path":"a","bytes":1,"sha256":"x"}]'}'::jsonb`)},
              ${over.state ?? 'registered'},
              ${over.held ?? null}, ${over.failed ?? null},
              ${
                over.completedAt === undefined
                  ? ['registered', 'transferring'].includes(over.state ?? 'registered')
                    ? null
                    : new Date().toISOString()
                  : over.completedAt
              })`);

  it('cannot let a MEASURED delivery enter a state only the server-side ingest reaches', async () => {
    const { d, ids } = await seed();
    /**
     * `transferring` carries no completion and the other two carry one, so each
     * row is legal in every respect but the one being tested. `held` is left
     * out because it also needs a reason, and a row refused by two constraints
     * does not say which one is doing the work.
     */
    const states: [string, string | null][] = [
      ['transferring', null],
      ['ingesting', new Date().toISOString()],
      ['ingested', new Date().toISOString()],
    ];
    for (const [state, completedAt] of states) {
      await violates(
        'collector_uploads_measured_state_check',
        insertUpload(d, ids, { state, completedAt }),
      );
    }
    // The unmeasured shape reaches them, which is what the constraint is for.
    await insertUnmeasured(d, ids, { state: 'transferring' });
  });

  it('cannot record a measured delivery with no episode, nor half a delivery reference', async () => {
    const { d, ids } = await seed();
    await violates(
      'collector_uploads_measured_delivery_check',
      d.execute(sql`
        insert into collector_uploads
          (id, collector_id, collection_session_id, device_serial, source_basename, file_count, total_bytes)
        values (${uid()}, ${ids.collector}, ${ids.session}, 'AZER76400FE', 'ego_AZER76400FE_20260813_072310', 4, 4096)`),
    );
    await violates(
      'collector_uploads_delivery_pair_check',
      insertUnmeasured(d, ids, { episode: ids.episode, ingest: null }),
    );
  });

  it('cannot call a delivery ingested without naming the episode it became', async () => {
    const { d, ids } = await seed();
    await violates('collector_uploads_ingested_check', insertUnmeasured(d, ids, { state: 'ingested' }));
    await insertUnmeasured(d, ids, { state: 'ingested', episode: ids.episode, ingest: ids.ingest });
    // And not twice: one recording delivered twice and read as two is the shape
    // that pays twice.
    await violates(
      'collector_uploads_ingested_key',
      insertUnmeasured(d, ids, { state: 'ingested', episode: ids.episode, ingest: ids.ingest }),
    );
  });

  it('cannot hold a delivery without saying why, or say why without holding it', async () => {
    const { d, ids } = await seed();
    await violates('collector_uploads_held_reason_check', insertUnmeasured(d, ids, { state: 'held' }));
    await violates(
      'collector_uploads_held_reason_check',
      insertUnmeasured(d, ids, { state: 'verified', held: 'basename_collision' }),
    );
    await violates(
      'collector_uploads_failed_reason_check',
      insertUnmeasured(d, ids, { state: 'verified', failed: 'checksum_mismatch' }),
    );
    await insertUnmeasured(d, ids, { state: 'held', held: 'basename_collision' });
  });

  it('cannot let the declared inventory disagree with the count of it', async () => {
    const { d, ids } = await seed();
    await violates(
      'collector_uploads_declared_files_check',
      insertUnmeasured(d, ids, { fileCount: 3 }),
    );
    await violates(
      'collector_uploads_declared_files_check',
      insertUnmeasured(d, ids, { declared: '{"relative_path":"a"}' }),
    );
    // A measured row is exempt: its inventory is `episode_files`.
    await insertUpload(d, ids, {});
  });

  it('cannot write an audit row that gives a collector a machine or an operator row', async () => {
    const { d, ids } = await seed();
    const row = (role: string, extra: string) =>
      d.execute(sql.raw(`
        insert into audit_events (action, target_table, target_id, actor_role, ${extra})
        values ('upload.register', 'collector_uploads', '${uid()}', '${role}', ${
          role === 'collector' ? `'${ids.collector}'` : `'${ids.operator}'`
        })`));
    // The shape the route writes is accepted.
    await row('collector', 'collector_id');
    // A collector carrying an operator row, or a machine, is not.
    await violates(
      'audit_events_attributed_check',
      d.execute(sql`insert into audit_events (action, target_table, target_id, actor_role, collector_id, operator_id)
        values ('upload.register', 'collector_uploads', ${uid()}, 'collector', ${ids.collector}, ${ids.operator})`),
    );
    await violates(
      'audit_events_attributed_check',
      d.execute(sql`insert into audit_events (action, target_table, target_id, actor_role, collector_id, upload_device_id)
        values ('upload.register', 'collector_uploads', ${uid()}, 'collector', ${ids.collector}, ${ids.machine})`),
    );
    // And an operator carrying a collector id is not either.
    await violates(
      'audit_events_attributed_check',
      d.execute(sql`insert into audit_events (action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id, collector_id)
        values ('episode.submit', 'episodes', ${uid()}, 'operator', ${ids.operator}, ${ids.machine}, ${ids.centre}, ${ids.collector})`),
    );
    await violates(
      'audit_events_actor_role_check',
      d.execute(sql`insert into audit_events (action, target_table, target_id, actor_role, collector_id)
        values ('upload.register', 'collector_uploads', ${uid()}, 'phone', ${ids.collector})`),
    );
  });
});

// ---------------------------------------------------------------------------
// Against a real S3 endpoint

/**
 * The layer the stub cannot reach.
 *
 * Everything above proves this service's own bookkeeping. None of it proves
 * that a URL signed here is a URL a store accepts, that a part PUT to it lands
 * where `ListParts` will find it, or that an object assembled from those parts
 * reads back byte-identical. Path C's cloud leg was written for a year against
 * a stub and three defects appeared the first time it met a real endpoint.
 *
 * Runs when `STORAGE_ENDPOINT` and its three companions are set — the same
 * four `s3StoreFromEnv` already reads. MinIO is what it was proved against.
 */
describe.skipIf(!hasDb() || !hasStore())('Path A against a real S3 endpoint', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const store = () => s3StoreFromEnv()!;

  async function harness() {
    const d = await db();
    const ids = { collector: uid(), task: uid(), scenario: uid(), session: uid(), deviceType: uid(), device: uid() };
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 't', 1200, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
    const claim = await liveClaim(d, ids.task, ids.collector);
    await d.execute(sql`
      insert into collection_sessions
        (id, task_id, collector_id, scenario_id, task_claim_id, unit_price, currency,
         others_in_frame, sensitive_info_present, session_origin)
      values (${ids.session}, ${ids.task}, ${ids.collector}, ${ids.scenario}, ${claim}, 1200, 'VND', false, false, 'app')`);

    const app = buildApi({ db: await appDb(), tokenSecret: SECRET, objectStore: store() });
    await app.ready();
    const headers = {
      authorization: `Bearer ${signToken(SECRET, { kind: 'collector', collectorId: ids.collector, epoch: 1 })}`,
    };
    return { app, ids, headers };
  }

  /** What a phone does with a signed URL: a plain HTTP PUT, no credentials. */
  const sendTo = async (url: string, body: Buffer): Promise<void> => {
    const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`PUT ${res.status} ${await res.text()}`);
  };

  it('moves a real delivery over signed URLs and verifies it end to end', async () => {
    const h = await harness();
    // One file over the part size, so a real multipart is created, parted,
    // listed and assembled by the store — not by anything in this repo.
    const d = delivery({ big: PART_SIZE + 1024 });
    const id = uid();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/me/uploads',
      payload: { id, collection_session_id: h.ids.session, episode: d.record, extra_files: d.extras } as never,
      headers: h.headers,
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json();

    for (const f of plan.files) {
      const body = d.blobs.get(f.relative_path)!;
      if (f.put_url !== undefined) await sendTo(f.put_url, body);
      for (const p of f.parts ?? []) await sendTo(p.url, body.subarray(p.start, p.end));
    }

    const done = await h.app.inject({
      method: 'POST',
      url: `/api/me/uploads/${id}/complete`,
      headers: h.headers,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().verification_state).toBe('verified');

    // And the bytes in the bucket are the bytes the phone held.
    for (const f of plan.files) {
      const body = store().read(f.key);
      const chunks: Uint8Array[] = [];
      for await (const c of (await body)!) chunks.push(c);
      expect(Buffer.concat(chunks).equals(d.blobs.get(f.relative_path)!)).toBe(true);
    }
  });

  it('resumes a real multipart after an interruption', async () => {
    const h = await harness();
    const d = delivery({ big: 2 * PART_SIZE + 1024 });
    const bigName = [...d.blobs.keys()].find((n) => d.blobs.get(n)!.length > PART_SIZE)!;
    const id = uid();
    const plan = (
      await h.app.inject({
        method: 'POST',
        url: '/api/me/uploads',
        payload: { id, collection_session_id: h.ids.session, episode: d.record, extra_files: d.extras } as never,
        headers: h.headers,
      })
    ).json();

    // Only the first part of the big file arrives before the link drops.
    const big = plan.files.find((f: { relative_path: string }) => f.relative_path === bigName);
    const body = d.blobs.get(bigName)!;
    await sendTo(big.parts[0].url, body.subarray(big.parts[0].start, big.parts[0].end));

    const resumed = (
      await h.app.inject({ method: 'GET', url: `/api/me/uploads/${id}`, headers: h.headers })
    ).json();
    const again = resumed.files.find((f: { relative_path: string }) => f.relative_path === bigName);
    // The store itself is what remembers, so this is the real answer and not
    // one this service wrote down.
    expect(again.held_parts).toEqual([1]);
    expect(again.parts.map((p: { part_number: number }) => p.part_number)).toEqual([2, 3]);

    for (const f of resumed.files) {
      const b = d.blobs.get(f.relative_path)!;
      if (f.put_url !== undefined) await sendTo(f.put_url, b);
      for (const p of f.parts ?? []) await sendTo(p.url, b.subarray(p.start, p.end));
    }
    const done = await h.app.inject({
      method: 'POST',
      url: `/api/me/uploads/${id}/complete`,
      headers: h.headers,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().verification_state).toBe('verified');
  });

  it('asks a real store for nothing it already holds (UPL-15/16)', async () => {
    /**
     * The "already there" shortcut reads the sha256 the store recorded as
     * object metadata, and whether that metadata survives a presigned PUT at
     * all is a question about the protocol, not about this service. It does —
     * the SDK hoists `x-amz-meta-sha256` into the signed query string, so a
     * client sending no headers still sets it — and this test is what keeps
     * that true, for a single PUT and for an assembled multipart both.
     */
    const h = await harness();
    const d = delivery({ big: PART_SIZE + 1024 });
    const register = async (id: string) =>
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/me/uploads',
          payload: { id, collection_session_id: h.ids.session, episode: d.record, extra_files: d.extras } as never,
          headers: h.headers,
        })
      ).json();

    const id = uid();
    const plan = await register(id);
    for (const f of plan.files) {
      const body = d.blobs.get(f.relative_path)!;
      if (f.put_url !== undefined) await sendTo(f.put_url, body);
      for (const p of f.parts ?? []) await sendTo(p.url, body.subarray(p.start, p.end));
    }
    expect(
      (await h.app.inject({ method: 'POST', url: `/api/me/uploads/${id}/complete`, headers: h.headers }))
        .statusCode,
    ).toBe(200);

    // The same session again, under a new upload id: one episode, one ingest,
    // the same keys, and not a byte to send.
    const second = await register(uid());
    expect(second.ingest_id).toBe(plan.ingest_id);
    expect(second.files.map((f: { done: boolean }) => f.done)).toEqual(
      second.files.map(() => true),
    );
    expect(second.files.every((f: { put_url?: string; parts?: unknown[] }) => f.put_url === undefined && f.parts === undefined)).toBe(true);
  });

  it('catches a real corruption in transit and blocks the episode', async () => {
    const h = await harness();
    const d = delivery();
    const id = uid();
    const plan = (
      await h.app.inject({
        method: 'POST',
        url: '/api/me/uploads',
        payload: { id, collection_session_id: h.ids.session, episode: d.record, extra_files: d.extras } as never,
        headers: h.headers,
      })
    ).json();

    for (const f of plan.files) {
      const body = Buffer.from(d.blobs.get(f.relative_path)!);
      // One file arrives damaged. The phone's digest for it is unchanged, which
      // is the whole shape of a transport fault.
      if (f.key === plan.files[0].key) body[0] = body[0]! ^ 0xff;
      await sendTo(f.put_url, body);
    }

    const done = await h.app.inject({
      method: 'POST',
      url: `/api/me/uploads/${id}/complete`,
      headers: h.headers,
    });
    expect(done.statusCode).toBe(409);
    expect(done.json().constraint).toBe('upload_checksum_mismatch');

    const store2 = await db();
    const rows = (await store2.execute(sql`
      select verification_state from episodes where episode_id = ${plan.episode_id}
    `)) as unknown as { verification_state: string }[];
    expect(rows[0]!.verification_state).toBe('failed');

    /**
     * And the way out of it, against the real store.
     *
     * The damaged object is in the bucket carrying the phone's own sha256 as
     * metadata, so the "already there" shortcut would say `done` and the
     * collector could never recover. The plan for a failed delivery is forced
     * past that shortcut — the same argument, and the same word, as
     * `ObjectStore.put`'s `force` on Path C.
     */
    const resumed = (
      await h.app.inject({ method: 'GET', url: `/api/me/uploads/${id}`, headers: h.headers })
    ).json();
    expect(resumed.files.every((f: { done: boolean }) => !f.done)).toBe(true);
    for (const f of resumed.files) await sendTo(f.put_url, d.blobs.get(f.relative_path)!);

    const retried = await h.app.inject({
      method: 'POST',
      url: `/api/me/uploads/${id}/complete`,
      headers: h.headers,
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().verification_state).toBe('verified');
  });
});
