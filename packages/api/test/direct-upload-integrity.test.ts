import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, expect, it, vi } from 'vitest';
import { assemble, signedPlan } from '../src/direct-upload.ts';
import { objectKey, PART_SIZE, S3ObjectStore, s3StoreFromEnv, sha256OfObject, stagingKey, verifyUploadedEpisode } from '../src/upload-worker.ts';

const sha = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
afterEach(() => vi.restoreAllMocks());

// The real store and presigner, with only the SDK's transport replaced. No
// endpoint credentials, network or provider enforcement are part of this proof.
function cloud() {
  const objects = new Map<string, { body: Buffer; sha256: string }>();
  const uploads = new Map<string, { key: string; sha256: string; parts: Map<number, Buffer> }>();
  let nextId = 0;
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
    const p = command.input;
    switch (command.constructor.name) {
      case 'HeadObjectCommand': {
        const object = objects.get(p.Key);
        if (!object) throw Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return { ContentLength: object.body.length, Metadata: { sha256: object.sha256 } };
      }
      case 'GetObjectCommand': {
        const object = objects.get(p.Key);
        if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        const from = p.Range ? Number(p.Range.match(/\d+/)[0]) : 0;
        return { Body: Readable.from([object.body.subarray(from)]) };
      }
      case 'PutObjectCommand':
        objects.set(p.Key, { body: Buffer.from(p.Body), sha256: p.Metadata.sha256 });
        return {};
      case 'CreateMultipartUploadCommand': {
        const id = `private-${++nextId}`;
        uploads.set(id, { key: p.Key, sha256: p.Metadata.sha256, parts: new Map() });
        return { UploadId: id };
      }
      case 'UploadPartCommand':
        uploads.get(p.UploadId)!.parts.set(p.PartNumber, Buffer.from(p.Body));
        return { ETag: `part-${p.PartNumber}` };
      case 'CompleteMultipartUploadCommand': {
        const upload = uploads.get(p.UploadId)!;
        const bodies = p.MultipartUpload.Parts.map((part: { PartNumber: number; ETag: string }) => {
          expect(part.ETag).toBe(`part-${part.PartNumber}`);
          return upload.parts.get(part.PartNumber)!;
        });
        objects.set(p.Key, { body: Buffer.concat(bodies), sha256: upload.sha256 });
        uploads.delete(p.UploadId);
        return {};
      }
      case 'AbortMultipartUploadCommand': uploads.delete(p.UploadId); return {};
      case 'ListMultipartUploadsCommand': return { Uploads: [] };
      default: throw new Error(`Unexpected SDK command ${command.constructor.name}`);
    }
  });
  const store = new S3ObjectStore({ endpoint: 'http://unused.invalid', bucket: 'test', key: 'test', secret: 'test' });
  return { store, objects, uploads, send };
}

it('a retained signed PUT changes staging only, including after a receipt allows read-back to be skipped', async () => {
  const c = cloud();
  const body = Buffer.from('original recording');
  const files = [{ relative_path: 'camera.mp4', sha256: sha(body) }];
  const sizes = new Map([['camera.mp4', body.length]]);
  const key = objectKey('episode', 'ingest', 'camera.mp4');
  const plan = await signedPlan(c.store, 'episode', 'ingest', files, sizes);
  expect(plan[0]!.key).toBe(key);
  const retained = new URL(plan[0]!.put_url!);
  expect(decodeURIComponent(retained.pathname)).toBe(`/test/${stagingKey(key)}`);
  expect(retained.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  c.objects.set(stagingKey(key), { body, sha256: sha(body) });
  await assemble(c.store, files, sizes, () => key);
  const receipts = new Map<string, string>();
  const progress = {
    done: async () => receipts,
    record: async (_episode: string, object: string, digest: string) => { receipts.set(object, digest); },
    forget: async (_episode: string, object: string) => { receipts.delete(object); },
  };
  expect((await verifyUploadedEpisode(c.store, { episodeId: 'episode', ingestId: 'ingest' }, files, progress)).mismatches).toEqual([]);
  c.objects.set(stagingKey(key), { body: Buffer.alloc(body.length, 0xff), sha256: sha(body) });
  // Even a completion that raced the verified-state guard cannot publish a
  // mismatching body over the canonical object.
  await assemble(c.store, files, sizes, () => key);
  expect(c.objects.get(key)!.body).toEqual(body);
  expect((await verifyUploadedEpisode(c.store, { episodeId: 'episode', ingestId: 'ingest' }, files, progress)).mismatches).toEqual([]);
});

it.each([Buffer.alloc(0), Buffer.from('small')])('publishes matching small/empty files and rejects wrong length', async (body) => {
  const c = cloud();
  c.objects.set('incoming/file', { body, sha256: sha(body) });
  expect(await c.store.publish('incoming/file', 'final', sha(body), body.length)).toBe(true);
  expect(c.objects.get('final')!.body.equals(body)).toBe(true);
  expect(await c.store.publish('incoming/file', 'final', sha(body), body.length + 1)).toBe(false);
  expect(c.objects.get('final')!.body.equals(body)).toBe(true);
});

it('publishes only its own freshly uploaded multipart bytes and aborts a mismatching attempt', async () => {
  const c = cloud();
  const body = Buffer.alloc(PART_SIZE + 3, 0x41);
  const digest = sha(body);
  c.objects.set('incoming/large', { body, sha256: digest });
  c.uploads.set('other-publisher', { key: 'final', sha256: digest, parts: new Map() });
  expect(await c.store.publish('incoming/large', 'final', digest, body.length)).toBe(true);
  expect(c.objects.get('final')!.body.equals(body)).toBe(true);
  c.objects.set('incoming/large', { body: Buffer.alloc(body.length, 0x42), sha256: digest });
  expect(await c.store.publish('incoming/large', 'final', digest, body.length)).toBe(false);
  expect(c.objects.get('final')!.body.equals(body)).toBe(true);
  expect([...c.uploads.keys()]).toEqual(['other-publisher']);
  const commands = c.send.mock.calls.map(([command]: any) => command.constructor.name);
  expect(commands.filter((name) => name === 'CompleteMultipartUploadCommand')).toHaveLength(1);
  expect(commands.filter((name) => name === 'AbortMultipartUploadCommand')).toHaveLength(1);
  expect(commands).not.toContain('ListMultipartUploadsCommand');
  expect(commands).not.toContain('ListPartsCommand');
});

it('a source that changes between chunks cannot publish under the declared digest', async () => {
  const c = cloud();
  const body = Buffer.alloc(PART_SIZE + 1, 0x61);
  const digest = sha(body);
  vi.spyOn(c.store, 'read').mockResolvedValue((async function* () {
    yield body.subarray(0, PART_SIZE);
    yield Buffer.from('b');
  })());
  expect(await c.store.publish('incoming/racing', 'final', digest, body.length)).toBe(false);
  expect(c.objects.has('final')).toBe(false);
  expect(c.uploads.size).toBe(0);
});

it('aborts only its own private multipart on a dropped staging read', async () => {
  const c = cloud();
  const body = Buffer.alloc(PART_SIZE + 1, 0x61);
  c.uploads.set('other-publisher', { key: 'final', sha256: sha(body), parts: new Map() });
  vi.spyOn(c.store, 'read').mockResolvedValue((async function* () {
    yield body.subarray(0, PART_SIZE);
    throw new Error('connection reset');
  })());
  await expect(c.store.publish('incoming/interrupted', 'final', sha(body), body.length)).rejects.toThrow('connection reset');
  expect(c.objects.has('final')).toBe(false);
  expect([...c.uploads.keys()]).toEqual(['other-publisher']);
});

// Deliberately opt-in for the throwaway MinIO runner. This flag is never a
// claim that a configured production provider is isolated or compatible.
it.skipIf(process.env['PLAYERONE_TEST_STORAGE_ISOLATED'] !== '1')(
  'isolated S3: signed PUT replay cannot mutate canonical content; staged multipart resumes',
  async () => {
    const store = s3StoreFromEnv()!;
    const episodeId = `integrity-${randomUUID()}`;
    const ingestId = randomUUID();
    const contents = new Map([
      ['small.bin', Buffer.from('verified bytes')],
      ['empty.bin', Buffer.alloc(0)],
      ['large.bin', Buffer.alloc(PART_SIZE + 5, 0x61)],
    ]);
    const files = [...contents].map(([relative_path, body]) => ({ relative_path, sha256: sha(body) }));
    const sizes = new Map([...contents].map(([name, body]) => [name, body.length]));
    const plan = await signedPlan(store, episodeId, ingestId, files, sizes);
    const put = async (url: string, body: Buffer) => {
      const response = await fetch(url, { method: 'PUT', body: new Uint8Array(body) });
      expect(response.ok, `PUT ${response.status}: ${await response.text()}`).toBe(true);
    };
    for (const file of plan) {
      const body = contents.get(file.relative_path)!;
      if (file.put_url) await put(file.put_url, body);
      if (file.parts) {
        const first = file.parts[0]!;
        await put(first.url, body.subarray(first.start, first.end));
      }
    }
    const resumed = await signedPlan(store, episodeId, ingestId, files, sizes);
    expect(resumed.find((file) => file.relative_path === 'large.bin')!.held_parts).toEqual([1]);
    for (const file of resumed) {
      for (const part of file.parts ?? []) {
        await put(part.url, contents.get(file.relative_path)!.subarray(part.start, part.end));
      }
    }
    const keyOf = (name: string) => objectKey(episodeId, ingestId, name);
    await assemble(store, files, sizes, keyOf);
    for (const file of files) expect(await sha256OfObject(store, keyOf(file.relative_path))).toBe(file.sha256);
    const small = plan.find((file) => file.relative_path === 'small.bin')!;
    await put(small.put_url!, Buffer.alloc(small.bytes, 0xff));
    expect(await sha256OfObject(store, small.key)).toBe(small.sha256);
    expect(await store.publish(stagingKey(small.key), small.key, small.sha256, small.bytes)).toBe(false);
    expect(await sha256OfObject(store, small.key)).toBe(small.sha256);
  },
  180_000,
);
