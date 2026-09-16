import { expect, it, vi } from 'vitest';
import { nativeTransport } from '../src/upload/delivery-native.ts';
const native = vi.hoisted(() => ({ signals: [] as AbortSignal[], deleted: [] as string[] }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({
  Directory: class {}, Paths: { cache: 'cache://' }, FileMode: { ReadOnly: 'r', Truncate: 'w' }, UploadType: { BINARY_CONTENT: 0 },
  File: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    create() {}
    open() { return { offset: 0, readBytes: (size: number) => new Uint8Array(size), writeBytes() {}, close() {} }; }
    delete() { native.deleted.push(this.uri); }
    upload(_url: string, { signal }: { signal: AbortSignal }) {
      native.signals.push(signal);
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Native task cancelled')), { once: true }));
    }
  },
}));
it.each(['whole', 'part'] as const)('cancels the native %s PUT, preserving source media', async kind => {
  native.signals.length = 0; native.deleted.length = 0;
  const controller = new AbortController();
  const pending = kind === 'whole' ? nativeTransport.putFile('source://camera.mp4', 'https://test', controller.signal)
    : nativeTransport.putRange('source://camera.mp4', 'https://test', 0, 4, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'upload_cancelled' });
  await vi.waitFor(() => expect(native.signals).toHaveLength(1));
  controller.abort();
  await rejected;
  expect(native.signals[0]!.aborted).toBe(true);
  expect(native.deleted.some(uri => uri.startsWith('source:'))).toBe(false);
  expect(native.deleted).toHaveLength(kind === 'part' ? 1 : 0);
});
it('aborts a stalled native PUT at its deadline', async () => {
  vi.useFakeTimers(); native.signals.length = 0;
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal;
  });
  try {
    const pending = nativeTransport.putFile('source://camera.mp4', 'https://test');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'server_unreachable' });
    await vi.advanceTimersByTimeAsync(60_000); await rejected;
    expect(native.signals[0]!.aborted).toBe(true);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});
