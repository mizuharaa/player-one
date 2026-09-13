// @vitest-environment jsdom
/**
 * The browser half of Path A, measured against the real `Sha256` and a real
 * `File`.
 *
 * These are the four things that are this file's own and are not covered by
 * `apps/collector/test/delivery.test.ts`, which drives the SHARED state machine
 * and knows nothing about a browser: the directory pick, the digests, what
 * `putFile`/`putRange` actually send, and the `localStorage` record.
 *
 * The digests are checked against `node:crypto` rather than against constants.
 * A constant would pass if both this test and `hashSession` were wrong in the
 * same way, and what these bytes are claimed to be decides whether the server
 * accepts a delivery.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@playerone/delivery';
import {
  browserTransport,
  hashSession,
  localDeliveryStore,
  pickedSession,
  resumable,
  type PickedFile,
} from './transport.ts';

const BASENAME = 'ego_AZER76400FE_20260813_072310';

/** A `File` whose `webkitRelativePath` is set, which the constructor cannot do. */
function pickedFile(relativePath: string, bytes: Uint8Array<ArrayBuffer>): File {
  const file = new File([bytes], relativePath.split('/').at(-1)!);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

/**
 * Allocated and filled, not `Uint8Array.from`: that infers
 * `Uint8Array<ArrayBufferLike>`, which TypeScript 5.7+ refuses as a `BlobPart`
 * because a `SharedArrayBuffer` cannot back one.
 */
function filler(n: number, seed = 7): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) bytes[i] = (i * seed + 13) % 256;
  return bytes;
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the directory pick', () => {
  it('takes the folder name as session_basename and the file names flat', () => {
    const session = pickedSession([
      pickedFile(`${BASENAME}/${BASENAME}_camera_left_part0001.mp4`, filler(16)),
      pickedFile(`${BASENAME}/meta_${BASENAME}.json`, filler(8)),
    ]);
    expect(session.sessionBasename).toBe(BASENAME);
    // Sorted, and never a path: `POST /api/me/uploads` refuses a
    // `relative_path` containing a separator, and `objectKey` interpolates it.
    expect(session.files.map((f) => f.relativePath)).toEqual([
      `${BASENAME}_camera_left_part0001.mp4`,
      `meta_${BASENAME}.json`,
    ]);
    expect(session.files.map((f) => f.bytes)).toEqual([16, 8]);
  });

  it('refuses an empty pick, two folders, a subfolder, and a name that is not a session', () => {
    const refusal = (files: File[]): string => {
      try {
        pickedSession(files);
      } catch (err) {
        return (err as ApiError).code;
      }
      return 'no refusal';
    };

    expect(refusal([])).toBe('debug_pick_empty');
    expect(
      refusal([
        pickedFile(`${BASENAME}/a.mp4`, filler(4)),
        pickedFile('ego_AZER76400FE_20260813_072415/b.mp4', filler(4)),
      ]),
    ).toBe('debug_pick_many_roots');
    /**
     * The engine reads a FLAT session directory and nothing else — `discover.ts`
     * calls a directory of directories `nested` — so a pick one level too high
     * has to be refused here, before minutes of hashing, rather than by the
     * server after them.
     */
    expect(refusal([pickedFile(`${BASENAME}/deeper/a.mp4`, filler(4))])).toBe('debug_pick_nested');
    /**
     * The same refusal name the server answers 400 with, from the SHARED
     * `looksLikeSessionDirectory`. Picking the corpus root instead of a session
     * is the mistake this catches.
     */
    expect(refusal([pickedFile('EgoCamera Sample Data/a.mp4', filler(4))])).toBe(
      'session_basename_unrecognised',
    );
  });
});

describe('hashing in the browser', () => {
  it('is sha256 of the bytes, across and beyond one 1 MiB chunk', async () => {
    const small = filler(1024);
    // Past CHUNK, so the yield/report path and a multi-read stream both run.
    const large = filler(1024 * 1024 + 4096, 31);
    const files: PickedFile[] = [
      { relativePath: 'small.bin', bytes: small.length, file: pickedFile(`${BASENAME}/small.bin`, small) },
      { relativePath: 'large.bin', bytes: large.length, file: pickedFile(`${BASENAME}/large.bin`, large) },
    ];

    const seen: number[] = [];
    const declared = await hashSession(files, (done) => seen.push(done));

    expect(declared.map((f) => f.sha256)).toEqual([sha(small), sha(large)]);
    expect(declared.map((f) => f.bytes)).toEqual([small.length, large.length]);
    /**
     * The `uri` is the relative path, because a browser has no reopenable
     * handle on a picked file. `browserTransport` resolves it back through the
     * map the page holds, and a resumed delivery needs the folder picked again.
     */
    expect(declared.map((f) => f.uri)).toEqual(['small.bin', 'large.bin']);
    // Progress was reported, so an operator watching a 39 MB session sees it move.
    expect(seen.length).toBeGreaterThan(0);
  });

  it('hashes an empty file to sha256 of nothing rather than refusing it', async () => {
    const declared = await hashSession([
      { relativePath: 'empty.csv', bytes: 0, file: pickedFile(`${BASENAME}/empty.csv`, filler(0)) },
    ]);
    // `e3b0c442…`, and sample 072415 is a real session that hashes to it.
    expect(declared[0]!.sha256).toBe(sha(new Uint8Array(0)));
  });
});

describe('the signed PUT', () => {
  it('sends the file as the body with no headers of its own, and resolves a 403', async () => {
    const bytes = filler(2048, 11);
    const file = pickedFile(`${BASENAME}/a.mp4`, bytes);
    const transport = browserTransport(new Map([['a.mp4', file]]));

    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: calls.length === 1 ? 200 : 403 });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await transport.putFile('a.mp4', 'https://store.invalid/key?X-Amz-Signature=1')).toBe(200);
    const first = calls[0]!;
    expect(first.init.method).toBe('PUT');
    expect(first.init.body).toBe(file);
    /**
     * No headers, and that is the load-bearing assertion. `getSignedUrl`
     * hoists `x-amz-meta-sha256` into the query string, so a header added here
     * is one the signature does not cover — which S3 and MinIO answer 403,
     * indistinguishable from an expired URL.
     */
    expect(first.init.headers).toBeUndefined();
    // The operator's session must not travel to the object store.
    expect(first.init.credentials).toBe('omit');

    /**
     * A 403 is RESOLVED, not thrown: it means the signature expired and it is
     * the state machine's business, which re-registers for fresh URLs. Throwing
     * here would make a slow link a dead delivery.
     */
    expect(await transport.putFile('a.mp4', 'https://store.invalid/key?X-Amz-Signature=2')).toBe(403);

    vi.unstubAllGlobals();
  });

  it('sends exactly the byte range asked for, as a slice', async () => {
    const bytes = filler(4096, 5);
    const transport = browserTransport(new Map([['a.mp4', pickedFile(`${BASENAME}/a.mp4`, bytes)]]));
    let sent: Uint8Array | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = new Uint8Array(await (init.body as Blob).arrayBuffer());
        return new Response(null, { status: 200 });
      }),
    );

    expect(await transport.putRange('a.mp4', 'https://store.invalid/part', 1000, 1600)).toBe(200);
    expect(sent!.length).toBe(600);
    expect(sha(sent!)).toBe(sha(bytes.subarray(1000, 1600)));

    vi.unstubAllGlobals();
  });

  it('turns a refused request into a named refusal, not a bare TypeError', async () => {
    const transport = browserTransport(new Map([['a.mp4', pickedFile(`${BASENAME}/a.mp4`, filler(8))]]));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    /**
     * This is what a missing bucket CORS rule looks like from a page: no
     * status, no body, nothing in the API log because the request never left.
     * The page's sentence for this code names `bucket-cors.mjs`.
     */
    await expect(transport.putFile('a.mp4', 'https://store.invalid/key')).rejects.toMatchObject({
      code: 'debug_transport_blocked',
    });
    vi.unstubAllGlobals();

    // A plan naming a file the picked folder does not have is the same refusal
    // the shared state machine raises for a diverged inventory.
    await expect(transport.putFile('gone.mp4', 'https://store.invalid/key')).rejects.toMatchObject({
      code: 'upload_plan_mismatch',
    });
  });
});

describe('the resume record', () => {
  beforeEach(() => localStorage.clear());

  const record = {
    uploadId: '8b0f6d1e-0000-4000-8000-00000000d001',
    collectionSessionId: '8b0f6d1e-0000-4000-8000-00000000d002',
    sessionBasename: BASENAME,
    directoryUri: BASENAME,
    files: [{ relativePath: 'a.mp4', uri: 'a.mp4', bytes: 16, sha256: 'a'.repeat(64) }],
  };

  it('round-trips, clears on ingest, and survives unreadable storage', async () => {
    expect(await localDeliveryStore.get()).toBeNull();
    await localDeliveryStore.set(record);
    expect(await localDeliveryStore.get()).toEqual(record);

    // The collector token must never be in here: it is a thirty-day credential
    // for somebody else's account and `localStorage` outlives the tab.
    expect(JSON.stringify(localStorage.getItem('playerone.console.debugDelivery'))).not.toContain(
      'token',
    );

    await localDeliveryStore.clear();
    expect(await localDeliveryStore.get()).toBeNull();

    // A record an older version wrote and this one cannot parse is cleared, not
    // thrown: the only thing it saves is a re-hash.
    localStorage.setItem('playerone.console.debugDelivery', '{not json');
    expect(await localDeliveryStore.get()).toBeNull();
    expect(localStorage.getItem('playerone.console.debugDelivery')).toBeNull();
  });

  it('resumes only against the same folder, by name and size', () => {
    const picked = {
      sessionBasename: BASENAME,
      files: [{ relativePath: 'a.mp4', bytes: 16, file: pickedFile(`${BASENAME}/a.mp4`, filler(16)) }],
    };
    expect(resumable(record, picked)).toBe(true);
    expect(resumable(record, { ...picked, sessionBasename: 'ego_X_20260813_072310' })).toBe(false);
    expect(
      resumable(record, { ...picked, files: [{ ...picked.files[0]!, bytes: 17 }] }),
    ).toBe(false);
    expect(resumable(record, { ...picked, files: [] })).toBe(false);
  });
});
