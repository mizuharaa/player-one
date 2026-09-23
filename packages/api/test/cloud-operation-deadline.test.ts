import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, expect, it, vi } from 'vitest';
import { OBJECT_DEADLINE_MS, PART_SIZE, S3ObjectStore, storageUnreachable } from '../src/upload-worker.ts';

const store = () => new S3ObjectStore({ endpoint: 'http://unused.invalid', bucket: 'test', key: 'test', secret: 'test' });
let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

// The SDK fake deliberately ignores cancellation, like its retry back-off.
// The wrapper must return, pass an aborted signal, and stop further work.
it.each([
  ['head', 'HeadObjectCommand'],
  ['beginMultipart', 'CreateMultipartUploadCommand'],
  ['openMultipart', 'ListMultipartUploadsCommand'],
  ['heldParts', 'ListPartsCommand'],
  ['finishMultipart', 'CompleteMultipartUploadCommand'],
] as const)('bounds %s even when the SDK ignores cancellation', async (method, stalled) => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  let options: { abortSignal: AbortSignal } | undefined;
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((command: any, supplied: any) => {
    if (command.constructor.name === stalled) {
      options = supplied;
      return new Promise(() => {});
    }
    return Promise.resolve({ Uploads: [], Parts: [] });
  });
  const instance = store();
  const result = (method === 'head' ? instance.head('key') : instance[method]('key', 'upload-or-hash'))
    .catch((err: unknown) => err);
  await vi.waitFor(() => expect(options).toBeDefined());
  const calls = send.mock.calls.length;
  controller.abort();
  const error = await result;
  expect(storageUnreachable(error)).toBe(true);
  expect(options!.abortSignal.aborted).toBe(true);
  expect(send).toHaveBeenCalledTimes(calls);
});

it.each([false, true])('bounds streaming put (multipart=%s) and closes the file without retrying', async (multipart) => {
  root = await mkdtemp(join(tmpdir(), 'po-operation-deadline-'));
  const path = join(root, 'recording.mp4');
  await writeFile(path, 'recorded bytes');
  if (multipart) {
    const file = await open(path, 'r+');
    try { await file.truncate(PART_SIZE + 1); } finally { await file.close(); }
  }
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
    ms === OBJECT_DEADLINE_MS ? controller.signal : new AbortController().signal);
  let body: any;
  let options: { abortSignal: AbortSignal } | undefined;
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((command: any, supplied: any) => {
    if (command.constructor.name === (multipart ? 'UploadPartCommand' : 'PutObjectCommand')) {
      body = command.input.Body;
      options = supplied;
      return new Promise(() => {});
    }
    return Promise.resolve({ Uploads: [], UploadId: 'upload-1' });
  });
  const result = store().put('key', path, 'hash', true).catch((err: unknown) => err);
  await vi.waitFor(() => expect(body).toBeDefined());
  const calls = send.mock.calls.length;
  controller.abort();
  expect(storageUnreachable(await result)).toBe(true);
  expect(options!.abortSignal.aborted).toBe(true);
  expect(body.destroyed).toBe(true);
  expect(send).toHaveBeenCalledTimes(calls);
  expect(timeout).toHaveBeenCalledWith(OBJECT_DEADLINE_MS);
});

it('shares the control deadline across multipart discovery and creation', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(() => {
    controller.abort();
    return Promise.resolve({ Uploads: [] });
  });
  await expect(store().beginMultipart('key', 'hash')).rejects.toThrow('deadline');
  expect(send).toHaveBeenCalledTimes(1);
});

it('expires a hung SDK request using a real short timeout', async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(20));
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(() => new Promise(() => {}));
  const error = await store().head('key').catch((err: unknown) => err);
  expect(storageUnreachable(error)).toBe(true);
});

it('does not apply the short control deadline to multipart completion', async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => timeout(ms === OBJECT_DEADLINE_MS ? 1000 : 10));
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((command: any) =>
    command.constructor.name === 'CompleteMultipartUploadCommand'
      ? new Promise((resolve) => setTimeout(() => resolve({}), 30))
      : Promise.resolve({ Parts: [] }));
  await expect(store().finishMultipart('key', 'upload')).resolves.toBeUndefined();
});

it('aborts retry back-off without opening another file stream', async () => {
  root = await mkdtemp(join(tmpdir(), 'po-operation-deadline-'));
  const path = join(root, 'recording.mp4');
  await writeFile(path, 'recorded bytes');
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  let body: any;
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((command: any) => {
    body = command.input.Body;
    return Promise.reject(new Error('connection reset'));
  });
  const result = store().put('key', path, 'hash', true).catch((err: unknown) => err);
  await vi.waitFor(() => expect(body?.destroyed).toBe(true));
  controller.abort();
  expect(await result).toBeInstanceOf(Error);
  expect(send).toHaveBeenCalledTimes(1);
});

it('keeps the discovered upload when best-effort stale cleanup spends the deadline', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation((command: any) => {
    if (command.constructor.name === 'ListMultipartUploadsCommand') {
      return Promise.resolve({ Uploads: [1, 2, 3].map((n) => ({
        Key: 'key', UploadId: `upload-${n}`, Initiated: new Date(n * 1000),
      })) });
    }
    controller.abort();
    return new Promise(() => {});
  });
  await expect(store().openMultipart('key')).resolves.toBe('upload-3');
  expect(send).toHaveBeenCalledTimes(2); // List, then one stale abort; no second cleanup request.
});
