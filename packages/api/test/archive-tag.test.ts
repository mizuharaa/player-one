import { PutObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tagArchivedObjects } from '../src/settle.ts';
import { S3ObjectStore, type ObjectStore } from '../src/upload-worker.ts';

const receipts = ['left.mp4', 'right.mp4', 'manifest.json'].map((file) => ({
  episode_id: 'episode-1',
  object_key: `episodes/episode-1/ingest-1/${file}`,
}));

const fakeStore = (): ObjectStore => ({
  put: vi.fn(async () => 'uploaded' as const),
  read: vi.fn(async () => null),
  tag: vi.fn(async () => {}),
});

const s3Store = () => new S3ObjectStore({
  endpoint: 'http://unused.invalid', bucket: 'pilot', key: 'test', secret: 'test',
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('archive tagging without a database (PLAN 3a)', () => {
  it('tags every receipt key with tier=archive', async () => {
    const store = fakeStore();
    const log = { warn: vi.fn() };
    expect(await tagArchivedObjects(store, receipts, log)).toEqual({ attempted: 3, confirmed: 3, failed_object_keys: [] });
    expect(vi.mocked(store.tag).mock.calls).toEqual(
      receipts.map((r) => [r.object_key, { tier: 'archive' }]),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs the failed second key as unconfirmed and still tags the third', async () => {
    const store = fakeStore();
    const err = new Error('tag rejected');
    vi.mocked(store.tag).mockResolvedValueOnce().mockRejectedValueOnce(err);
    const log = { warn: vi.fn() };
    await expect(tagArchivedObjects(store, receipts, log)).resolves.toEqual({
      attempted: 3, confirmed: 2, failed_object_keys: [receipts[1]!.object_key],
    });
    expect(vi.mocked(store.tag).mock.calls).toEqual(
      receipts.map((r) => [r.object_key, { tier: 'archive' }]),
    );
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { ...receipts[1], err }, 'Archive tag unconfirmed',
    );
  });

  it('catches a never-settling tag at ten seconds and attempts the next key', async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    vi.mocked(store.tag).mockImplementationOnce(() => new Promise(() => {}));
    const log = { warn: vi.fn() };
    const pass = tagArchivedObjects(store, receipts, log);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(store.tag).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pass).resolves.toEqual({ attempted: 3, confirmed: 2, failed_object_keys: [receipts[0]!.object_key] });
    expect(store.tag).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { ...receipts[0], err: expect.objectContaining({ message: 'Object tag unconfirmed after 10 seconds' }) },
      'Archive tag unconfirmed',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends S3 tags with a ten-second abort signal and clears the deadline on success', async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    await s3Store().tag('object/key', { tier: 'archive', source: 'centre' });
    expect(timeout).toHaveBeenCalledWith(10_000);
    const [command, options] = send.mock.calls[0]!;
    expect(command).toBeInstanceOf(PutObjectTaggingCommand);
    expect((command as PutObjectTaggingCommand).input).toEqual({
      Bucket: 'pilot', Key: 'object/key',
      Tagging: { TagSet: [{ Key: 'tier', Value: 'archive' }, { Key: 'source', Value: 'centre' }] },
    });
    expect(options).toEqual({ abortSignal: signal });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the S3 deadline when send rejects', async () => {
    vi.useFakeTimers();
    const err = new Error('S3 unavailable');
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(err);
    await expect(s3Store().tag('object/key', { tier: 'archive' })).rejects.toBe(err);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds S3 send even when it never observes the abort signal', async () => {
    vi.useFakeTimers();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(() => new Promise(() => {}));
    const result = expect(s3Store().tag('object/key', { tier: 'archive' }))
      .rejects.toThrow('Object tag unconfirmed after 10 seconds');
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves S3 retry back-off at the deadline and continues before send rejects', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    let backingOff = false;
    let sendRejected = false;
    // Model the measured 503 at nine seconds followed by an abort-insensitive retry wait.
    send.mockImplementationOnce(() => new Promise((_, reject) => {
      setTimeout(() => {
        backingOff = true;
        setTimeout(() => {
          sendRejected = true;
          reject(new Error('AbortError after retry back-off'));
        }, 5_000);
      }, 9_000);
    }));
    const log = { warn: vi.fn() };
    const store = s3Store();
    const pass = tagArchivedObjects(store, receipts, log);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(backingOff).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(log.warn).not.toHaveBeenCalled();
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pass).resolves.toEqual({ attempted: 3, confirmed: 2, failed_object_keys: [receipts[0]!.object_key] });
    expect(sendRejected).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { ...receipts[0], err: expect.any(Error) }, 'Archive tag unconfirmed',
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sendRejected).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
