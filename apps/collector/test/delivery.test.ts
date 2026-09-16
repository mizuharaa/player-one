import { runPhoneDelivery } from '../src/upload/run-phone-delivery.ts';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HttpCollectorApi } from '../src/api/http.ts';
import type { TokenStore } from '../src/api/token-store.ts';
import { ApiError } from '../src/api/types.ts';
import {
  Sha256,
  looksLikeSessionDirectory,
  nameFromUri,
  runDelivery,
  type DeclaredFile,
  type DeliveryRecord,
  type DeliveryStore,
  type DeliveryTransport,
} from '@playerone/delivery';

/**
 * Path A from the phone's side, with no phone.
 *
 * The state machine in `upload/delivery.ts` is driven here through the REAL
 * HTTP client against a mocked fetch, so what is pinned is not only the
 * sequence of steps but the wire: the unmeasured registration body, the two
 * routes resume and completion use, and the mapping of `FilePlan` onto what
 * the transfer loop reads. A test that stubbed `CollectorApi` would pass with
 * the body shaped wrongly, and the body is the half of this lane that another
 * agent built against the same frozen contract.
 *
 * `test/delivery.test.ts` and not an addition to `api.test.ts`, despite that
 * file's note about test-file count and `collector-auth.test.ts`'s wall-clock
 * spread: the repository is 111 test files now, well past the seventy-four
 * that measurement was taken at, and the delivery machine is a different
 * subject from the API seam.
 *
 * What is NOT here, and cannot be: the picker, the filesystem, the native
 * uploader, and any claim about them. Everything in `delivery-native.ts` needs
 * a handset; the two rules it depends on that do not — the SAF name decoding and
 * the session-directory naming rule — live in `delivery.ts` and are pinned here.
 */

const BASENAME = 'ego_AZER76400FE_20260813_072310';
const UPLOAD_ID = '11111111-2222-4333-8444-555555555555';
const SESSION_ID = '99999999-8888-4777-8666-555555555555';
const BASE = 'http://api.test';

function fakeStore(initial: string | null = 'tok-good'): TokenStore {
  let value = initial;
  return {
    async get() {
      return value;
    },
    async set(token: string) {
      value = token;
    },
    async clear() {
      value = null;
    },
  };
}

type Answer = { status: number; body?: unknown };

/**
 * A fetch that answers from a table of `METHOD /path` and records every call.
 *
 * An entry may be an array, which is consumed one answer per call: that is how
 * a delivery that registers, is refused a stale signature, and registers again
 * gets two different plans out of one route.
 */
function fakeFetch(routes: Record<string, Answer | Answer[]>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).replace(BASE, '');
    calls.push({
      path,
      method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const entry = routes[`${method} ${path}`];
    const answer = Array.isArray(entry)
      ? (entry.length > 1 ? entry.shift()! : entry[0]!)
      : (entry ?? { status: 404 });
    return {
      status: answer.status,
      text: async () => (answer.body === undefined ? '' : JSON.stringify(answer.body)),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** A resume record store in memory, as `expo-secure-store` would hold one. */
function memoryStore(initial: DeliveryRecord | null = null) {
  let held = initial;
  const store: DeliveryStore = {
    async get() {
      return held;
    },
    async set(record) {
      held = record;
    },
    async clear() {
      held = null;
    },
  };
  return { store, peek: () => held };
}

/**
 * A phone's disk, as the state machine sees it: every PUT is recorded and
 * answered from a table keyed by the URL, defaulting to 200.
 */
function fakeTransport(statuses: Record<string, number[]> = {}) {
  const sent: { url: string; start: number; end: number }[] = [];
  const next = (url: string): number => {
    const queue = statuses[url];
    if (queue === undefined) return 200;
    return queue.length > 1 ? queue.shift()! : queue[0]!;
  };
  const transport: DeliveryTransport = {
    async putFile(_uri, url) {
      sent.push({ url, start: 0, end: -1 });
      return next(url);
    },
    async putRange(_uri, url, start, end) {
      sent.push({ url, start, end });
      return next(url);
    },
  };
  return { transport, sent };
}

const PART = 64 * 1024 * 1024;

const file = (relativePath: string, bytes: number): DeclaredFile => ({
  relativePath,
  uri: `content://tree/${BASENAME}/${relativePath}`,
  bytes,
  sha256: createHash('sha256').update(relativePath).digest('hex'),
});

const record = (files: DeclaredFile[]): DeliveryRecord => ({
  uploadId: UPLOAD_ID,
  collectionSessionId: SESSION_ID,
  sessionBasename: BASENAME,
  directoryUri: `content://com.android.externalstorage.documents/tree/primary%3AEgo%2F${BASENAME}`,
  files,
});

/** `FilePlan` as the server sends it: one signed PUT for a small file. */
const wholeFile = (relativePath: string) => ({
  relative_path: relativePath,
  key: `episodes/e/${UPLOAD_ID}/${relativePath}`,
  done: false,
  put_url: `https://store.test/${relativePath}?sig=1`,
});

/** `FilePlan` for a file at or above PART_SIZE, with `held` parts left out. */
const inParts = (relativePath: string, parts: number[], signature = 1) => ({
  relative_path: relativePath,
  key: `episodes/e/${UPLOAD_ID}/${relativePath}`,
  done: false,
  upload_id: 'mpu-1',
  held_parts: [1, 2, 3, 4, 5].filter((n) => !parts.includes(n)),
  parts: parts.map((n) => ({
    part_number: n,
    start: (n - 1) * PART,
    end: n * PART,
    bytes: PART,
    url: `https://store.test/${relativePath}/part-${n}?sig=${signature}`,
  })),
});

const api = (fn: typeof fetch) => new HttpCollectorApi(BASE, fakeStore(), () => {}, fn);

describe('the session basename the phone derives from a picked directory', () => {
  it('reads a name out of a SAF tree URI rather than out of its percent-encoding', () => {
    // `Directory.name` is `Paths.basename(uri)`, and a document-tree URI's last
    // segment is the whole tree, encoded. Sending that as `session_basename`
    // would be refused as unrecognised, and the collector would be told their
    // recording was not a recording.
    expect(
      nameFromUri(
        'content://com.android.externalstorage.documents/tree/primary%3AEgo%2Fego_AZER76400FE_20260813_072310',
      ),
    ).toBe(BASENAME);
    expect(nameFromUri(`file:///storage/emulated/0/Ego/${BASENAME}/`)).toBe(BASENAME);
    expect(nameFromUri('content://x/document/primary%3AEgo%2Fs%2Fcamera_01.mp4')).toBe(
      'camera_01.mp4',
    );
  });

  it('holds the engine naming rule, so a wrong folder costs no hashing', () => {
    expect(looksLikeSessionDirectory(BASENAME)).toBe(true);
    expect(looksLikeSessionDirectory('Orbbec_Ego_AZER76400FE_20260813_072310')).toBe(true);
    expect(looksLikeSessionDirectory('DCIM')).toBe(false);
    expect(looksLikeSessionDirectory('ego_AZER76400FE_20260813')).toBe(false);
  });
});

describe('the incremental sha256 the phone hashes a session with', () => {
  it('agrees with node for the empty input, a known vector, and across chunks', () => {
    // e3b0c442… is the empty session's fingerprint and a real value in this
    // platform (sample 072415 is one), so it is not a sentinel to skip.
    expect(new Sha256().digest()).toBe(createHash('sha256').update('').digest('hex'));
    expect(new Sha256().update(Buffer.from('abc')).digest()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    // The point of the class: the answer must not depend on how the file was
    // cut up. 1000 bytes fed as one block, as 64-byte blocks (the compression
    // block size) and as 7-byte blocks that straddle every boundary.
    const bytes = Buffer.alloc(1000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) & 0xff;
    const expected = createHash('sha256').update(bytes).digest('hex');
    for (const size of [1000, 64, 7, 1]) {
      const hash = new Sha256();
      for (let i = 0; i < bytes.length; i += size) hash.update(bytes.subarray(i, i + size));
      expect(hash.digest()).toBe(expected);
    }
  });
});

describe('a fresh delivery', () => {
  it('registers the unmeasured shape, sends what is missing, and reports the server state', async () => {
    const files = [file('camera_01.mp4', 3 * PART), file('manifest.json', 4_096)];
    const { fn, calls } = fakeFetch({
      'POST /api/me/uploads': {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'registered',
          episode_id: 'ep-1',
          held_reason: null,
          failed_reason: null,
          part_size: PART,
          files: [inParts('camera_01.mp4', [1, 2, 3]), wholeFile('manifest.json')],
        },
      },
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'ingested', episode_id: 'ep-1' },
      },
    });
    const { transport, sent } = fakeTransport();
    const { store, peek } = memoryStore();

    const outcome = await runDelivery({ api: api(fn), transport, store }, record(files));

    // The registration body: a directory name and a file list, and nothing
    // that could carry a measurement. `episode` absent is the discriminator.
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/me/uploads' });
    expect(calls[0]?.body).toEqual({
      id: UPLOAD_ID,
      collection_session_id: SESSION_ID,
      session_basename: BASENAME,
      files: [
        { relative_path: 'camera_01.mp4', bytes: 3 * PART, sha256: files[0]!.sha256 },
        { relative_path: 'manifest.json', bytes: 4_096, sha256: files[1]!.sha256 },
      ],
    });
    const body = calls[0]?.body as Record<string, unknown>;
    for (const forbidden of ['episode', 'duration_s', 'effective_minutes', 'amount']) {
      expect(body[forbidden]).toBeUndefined();
    }

    // Three ranged parts at the planned boundaries, then the one small file.
    expect(sent).toEqual([
      { url: 'https://store.test/camera_01.mp4/part-1?sig=1', start: 0, end: PART },
      { url: 'https://store.test/camera_01.mp4/part-2?sig=1', start: PART, end: 2 * PART },
      { url: 'https://store.test/camera_01.mp4/part-3?sig=1', start: 2 * PART, end: 3 * PART },
      { url: 'https://store.test/manifest.json?sig=1', start: 0, end: -1 },
    ]);

    expect(outcome).toEqual({
      state: 'ingested',
      episodeId: 'ep-1',
      heldReason: null,
      failedReason: null,
    });
    // Nothing left to resume, so nothing is kept.
    expect(peek()).toBeNull();
  });

  it('refuses a directory the engine would not recognise, before it hashes or sends anything', async () => {
    const { fn, calls } = fakeFetch({});
    const { transport, sent } = fakeTransport();
    const { store } = memoryStore();
    await expect(
      runDelivery(
        { api: api(fn), transport, store },
        { ...record([file('a.mp4', 1)]), sessionBasename: 'DCIM' },
      ),
    ).rejects.toThrow(new ApiError('session_basename_unrecognised'));
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('a delivery resumed after the app was killed', () => {
  it('asks the server what the cloud holds and sends only the three parts it does not', async () => {
    const files = [file('camera_01.mp4', 5 * PART)];
    const held = record(files);
    const { fn, calls } = fakeFetch({
      // Two of five parts are up. The server recomputes that from the store on
      // every resume; the phone contributes nothing to the answer.
      [`GET /api/me/uploads/${UPLOAD_ID}`]: {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'transferring',
          episode_id: 'ep-1',
          files: [inParts('camera_01.mp4', [3, 4, 5])],
        },
      },
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'ingested', episode_id: 'ep-1' },
      },
    });
    const { transport, sent } = fakeTransport();
    const { store, peek } = memoryStore(held);

    const outcome = await runDelivery({ api: api(fn), transport, store }, held, { resume: true });

    // No second registration: the same upload id, resumed, is one delivery.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /api/me/uploads/${UPLOAD_ID}`,
      `POST /api/me/uploads/${UPLOAD_ID}/complete`,
    ]);
    expect(sent.map((s) => s.start / PART)).toEqual([2, 3, 4]);
    expect(outcome.state).toBe('ingested');
    expect(peek()).toBeNull();
  });

  it('sends nothing at all for a delivery the server has already ingested', async () => {
    const held = record([file('camera_01.mp4', PART)]);
    const { fn } = fakeFetch({
      [`GET /api/me/uploads/${UPLOAD_ID}`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'ingested', episode_id: 'ep-1', files: [] },
      },
    });
    const { transport, sent } = fakeTransport();
    const { store, peek } = memoryStore(held);
    const outcome = await runDelivery({ api: api(fn), transport, store }, held, { resume: true });
    expect(sent).toEqual([]);
    expect(outcome.state).toBe('ingested');
    // No second `/complete`: a delivery with a verdict does not get another.
    expect(peek()).toBeNull();
  });
});

describe('a delivery the server already failed', () => {
  it('re-sends it rather than reporting the old verdict, on the resume path', async () => {
    // UPL-04's retry. A read-back that did not match leaves the objects in the
    // bucket with metadata that cannot be trusted, so the server answers a plan
    // forced past its own "already there" shortcut — every file missing — and
    // the phone is expected to send them again. Short-circuiting on `failed`
    // made that unreachable: the delivery came back, said `failed` a second
    // time without moving a byte, and no retry could ever change it.
    const files = [file('camera_01.mp4', 4_096)];
    const held = record(files);
    const { fn, calls } = fakeFetch({
      [`GET /api/me/uploads/${UPLOAD_ID}`]: {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'failed',
          episode_id: 'ep-1',
          failed_reason: 'checksum_mismatch',
          files: [wholeFile('camera_01.mp4')],
        },
      },
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'ingested', episode_id: 'ep-1' },
      },
    });
    const { transport, sent } = fakeTransport();
    const { store, peek } = memoryStore(held);

    const outcome = await runDelivery({ api: api(fn), transport, store }, held, { resume: true });

    expect(sent.map((s) => s.url)).toEqual(['https://store.test/camera_01.mp4?sig=1']);
    expect(outcome.state).toBe('ingested');
    // Still one delivery: the retry never mints a second upload id.
    expect(calls.every((c) => c.path.includes(UPLOAD_ID) || c.path === '/api/me/uploads')).toBe(true);
    expect(peek()).toBeNull();
  });

  it('re-sends it on the registration path too, under the same upload id', async () => {
    // The other way in: the app was killed and reopened, the collector taps the
    // upload again rather than the resume, and registration replays onto the
    // failed row. The server answers `replayed` with the same forced plan, and
    // the id in the body is the persisted one — which is what makes it a replay
    // and not a second delivery of one recording.
    const files = [file('camera_01.mp4', 4_096)];
    const { fn, calls } = fakeFetch({
      'POST /api/me/uploads': {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          replayed: true,
          state: 'failed',
          episode_id: 'ep-1',
          failed_reason: 'checksum_mismatch',
          files: [wholeFile('camera_01.mp4')],
        },
      },
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'ingested', episode_id: 'ep-1' },
      },
    });
    const { transport, sent } = fakeTransport();
    const { store } = memoryStore();

    const outcome = await runDelivery({ api: api(fn), transport, store }, record(files));

    expect((calls[0]?.body as { id: string }).id).toBe(UPLOAD_ID);
    expect(sent).toHaveLength(1);
    expect(outcome.state).toBe('ingested');
  });

  it('still reports held without sending anything, because held is not a retry', async () => {
    // `held` is a basename collision: another session of the same name is
    // already on the server and a person has to look at it. Re-sending cannot
    // resolve that, and the server answers an empty plan.
    const held = record([file('camera_01.mp4', 4_096)]);
    const { fn, calls } = fakeFetch({
      [`GET /api/me/uploads/${UPLOAD_ID}`]: {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'held',
          episode_id: 'ep-1',
          held_reason: 'basename_collision',
          files: [],
        },
      },
    });
    const { transport, sent } = fakeTransport();
    const { store, peek } = memoryStore(held);
    const outcome = await runDelivery({ api: api(fn), transport, store }, held, { resume: true });
    expect(sent).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(outcome).toEqual({
      state: 'held',
      episodeId: 'ep-1',
      heldReason: 'basename_collision',
      failedReason: null,
    });
    expect(peek()).not.toBeNull();
  });
});

describe('a signed URL that expired while the phone was sending', () => {
  it('re-registers under the same id for a fresh signature and does not re-send what is up', async () => {
    const files = [file('camera_01.mp4', 5 * PART)];
    const { fn, calls } = fakeFetch({
      'POST /api/me/uploads': [
        {
          status: 200,
          body: {
            upload_id: UPLOAD_ID,
            state: 'registered',
            episode_id: 'ep-1',
            files: [inParts('camera_01.mp4', [1, 2, 3, 4, 5], 1)],
          },
        },
        {
          // The replay. Two parts made it before the signature went stale, and
          // the server says so because it read the store, not because the
          // phone told it.
          status: 200,
          body: {
            upload_id: UPLOAD_ID,
            state: 'transferring',
            episode_id: 'ep-1',
            files: [inParts('camera_01.mp4', [3, 4, 5], 2)],
          },
        },
      ],
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'ingested', episode_id: 'ep-1' },
      },
    });
    const { transport, sent } = fakeTransport({
      'https://store.test/camera_01.mp4/part-3?sig=1': [403],
    });
    const { store } = memoryStore();

    const outcome = await runDelivery({ api: api(fn), transport, store }, record(files));

    // Both registrations carry the SAME client-generated id, which is what
    // makes the second one a replay rather than a second delivery.
    const registrations = calls.filter((c) => c.path === '/api/me/uploads');
    expect(registrations).toHaveLength(2);
    for (const call of registrations) {
      expect((call.body as { id: string }).id).toBe(UPLOAD_ID);
    }

    expect(sent.map((s) => s.url)).toEqual([
      'https://store.test/camera_01.mp4/part-1?sig=1',
      'https://store.test/camera_01.mp4/part-2?sig=1',
      // The 403. Nothing after it is attempted on the stale signature.
      'https://store.test/camera_01.mp4/part-3?sig=1',
      'https://store.test/camera_01.mp4/part-3?sig=2',
      'https://store.test/camera_01.mp4/part-4?sig=2',
      'https://store.test/camera_01.mp4/part-5?sig=2',
    ]);
    expect(outcome.state).toBe('ingested');
  });

  it('gives up rather than looping when every fresh signature is refused too', async () => {
    const files = [file('camera_01.mp4', PART)];
    const { fn } = fakeFetch({
      'POST /api/me/uploads': {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'registered',
          episode_id: 'ep-1',
          files: [inParts('camera_01.mp4', [1])],
        },
      },
    });
    const { transport, sent } = fakeTransport({
      'https://store.test/camera_01.mp4/part-1?sig=1': [403],
    });
    const { store, peek } = memoryStore();
    await expect(
      runDelivery({ api: api(fn), transport, store }, record(files)),
    ).rejects.toThrow(new ApiError('upload_urls_expired'));
    expect(sent).toHaveLength(3);
    // The inventory survives, because re-hashing the session is the expensive
    // thing and nothing about it has been invalidated.
    expect(peek()).not.toBeNull();
  });
});

describe('a tampered byte', () => {
  it('ends failed, carrying the reason the server recorded and not a paraphrase of the refusal', async () => {
    const files = [file('camera_01.mp4', 4_096)];
    const { fn, calls } = fakeFetch({
      'POST /api/me/uploads': {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'registered',
          episode_id: 'ep-1',
          files: [wholeFile('camera_01.mp4')],
        },
      },
      // UPL-04: the read-back does not match what the phone declared, so the
      // route refuses. `refused()` is a 409 carrying a constraint name.
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 409,
        body: {
          error: 'refused',
          constraint: 'upload_checksum_mismatch',
          mismatches: [{ relative_path: 'camera_01.mp4' }],
        },
      },
      // …and has already written the verdict on the row, in its own words.
      [`GET /api/me/uploads/${UPLOAD_ID}`]: {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'failed',
          episode_id: 'ep-1',
          failed_reason: 'checksum_mismatch',
          files: [wholeFile('camera_01.mp4')],
        },
      },
    });
    const { transport } = fakeTransport();
    const { store, peek } = memoryStore();

    const outcome = await runDelivery({ api: api(fn), transport, store }, record(files));

    expect(outcome).toEqual({
      state: 'failed',
      episodeId: 'ep-1',
      // The server's column, verbatim. Not 'upload_checksum_mismatch', which
      // is the refusal name, and not a sentence this app composed.
      failedReason: 'checksum_mismatch',
      heldReason: null,
    });
    // The refusal is followed by a read of the row, which is where the reason
    // comes from. Nothing is re-sent and nothing is completed twice.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/me/uploads',
      `POST /api/me/uploads/${UPLOAD_ID}/complete`,
      `GET /api/me/uploads/${UPLOAD_ID}`,
    ]);
    // A failed delivery keeps its record: it is the thing a retry resumes from.
    expect(peek()).not.toBeNull();
  });

  it('lets a refusal that is not about the bytes surface as itself', async () => {
    const files = [file('camera_01.mp4', 4_096)];
    const { fn } = fakeFetch({
      'POST /api/me/uploads': {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'registered',
          episode_id: 'ep-1',
          files: [wholeFile('camera_01.mp4')],
        },
      },
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 409,
        body: { error: 'refused', constraint: 'upload_superseded' },
      },
      // The row did not move: another delivery of the same session is in
      // flight, and this attempt's verdict is not recorded anywhere.
      [`GET /api/me/uploads/${UPLOAD_ID}`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'transferring', episode_id: 'ep-1', files: [] },
      },
    });
    const { transport } = fakeTransport();
    const { store } = memoryStore();
    await expect(runDelivery({ api: api(fn), transport, store }, record(files))).rejects.toThrow(
      new ApiError('upload_superseded'),
    );
  });
});

describe('an ingest the server has not finished', () => {
  it('polls the state route and reports only what it finally said', async () => {
    const files = [file('camera_01.mp4', 4_096)];
    const { fn, calls } = fakeFetch({
      'POST /api/me/uploads': {
        status: 200,
        body: {
          upload_id: UPLOAD_ID,
          state: 'registered',
          episode_id: 'ep-1',
          files: [wholeFile('camera_01.mp4')],
        },
      },
      [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: {
        status: 200,
        body: { upload_id: UPLOAD_ID, state: 'ingesting', episode_id: 'ep-1' },
      },
      [`GET /api/me/uploads/${UPLOAD_ID}`]: [
        {
          status: 200,
          body: { upload_id: UPLOAD_ID, state: 'ingesting', episode_id: 'ep-1', files: [] },
        },
        {
          status: 200,
          body: {
            upload_id: UPLOAD_ID,
            state: 'held',
            episode_id: 'ep-1',
            held_reason: 'basename_collision',
            files: [],
          },
        },
      ],
    });
    const { transport } = fakeTransport();
    const { store, peek } = memoryStore();

    const outcome = await runDelivery(
      // `wait` is injected, so the poll interval does not become the runtime.
      { api: api(fn), transport, store, wait: async () => {} },
      record(files),
    );

    expect(outcome).toEqual({
      state: 'held',
      episodeId: 'ep-1',
      heldReason: 'basename_collision',
      failedReason: null,
    });
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    expect(peek()).not.toBeNull();
  });
});


it('cancels a stalled part, keeps the batch and resumes the same upload without completing early', async () => {
  const batch = record([file('camera_01.mp4', 2 * PART)]);
  const { store, peek } = memoryStore();
  const { fn, calls } = fakeFetch({
    'POST /api/me/uploads': { status: 200, body: { upload_id: UPLOAD_ID, state: 'registered', files: [inParts('camera_01.mp4', [1, 2])] } },
    [`GET /api/me/uploads/${UPLOAD_ID}`]: { status: 200, body: { upload_id: UPLOAD_ID, state: 'registered', files: [inParts('camera_01.mp4', [2])] } },
    [`POST /api/me/uploads/${UPLOAD_ID}/complete`]: { status: 200, body: { upload_id: UPLOAD_ID, state: 'ingested', episode_id: 'ep-1' } },
  });
  const controller = new AbortController();
  let finishPart!: (status: number) => void;
  const stalled = vi.fn(() => new Promise<number>(resolve => { finishPart = resolve; }));
  const pending = runPhoneDelivery({ api: api(fn), store, transport: { putFile: stalled, putRange: stalled } }, batch, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'upload_cancelled' });
  await vi.waitFor(() => expect(stalled).toHaveBeenCalledTimes(1));
  controller.abort(new ApiError('upload_cancelled'));
  await rejected;
  finishPart(200);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(stalled).toHaveBeenCalledTimes(1);
  expect(calls.some(call => call.path.endsWith('/complete'))).toBe(false);
  expect(peek()).toEqual(batch);
  const { transport, sent } = fakeTransport();
  await runPhoneDelivery({ api: api(fn), store, transport }, peek()!, new AbortController().signal, { resume: true });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.start).toBe(PART);
  expect(calls.filter(call => call.path === '/api/me/uploads')).toHaveLength(1);
  expect(peek()).toBeNull();
});
