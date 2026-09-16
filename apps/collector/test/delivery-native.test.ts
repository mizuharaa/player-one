import { expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { pickSessionDirectory, nativeTransport } from '../src/upload/delivery-native.ts';
const native = vi.hoisted(() => ({ signals: [] as AbortSignal[], deleted: [] as string[], size: 4, failCopy: false }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-image-picker', () => ({ UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' }, VideoExportPreset: { Passthrough: 0 }, requestMediaLibraryPermissionsAsync: vi.fn(), launchImageLibraryAsync: vi.fn(), requestCameraPermissionsAsync: vi.fn(), launchCameraAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-file-system', () => ({
  Directory: class { uri: string; constructor(...parts: string[]) { this.uri = parts.join('/'); } create() {} delete() { native.deleted.push(this.uri); } static pickDirectoryAsync = vi.fn(async () => ({ uri: 'content://ego_TEST_20260916_120000', list: () => [] })); }, Paths: { cache: 'cache://', document: 'documents://' }, FileMode: { ReadOnly: 'r', Truncate: 'w' }, UploadType: { BINARY_CONTENT: 0 },
  File: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join('/'); }
    get size() { return native.size; }
    copy() { if (native.failCopy) throw new Error('disk full'); }
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

it('uses iOS Photos with multiple images and videos and declares only unmeasured media', async () => {
  vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
  vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [
    { uri: 'file:///cache/clip.mov', type: 'video', fileName: 'clip.mov' },
    { uri: 'file:///cache/photo.jpg', type: 'image', fileName: 'photo.jpg' },
  ] } as never);
  const result = await pickSessionDirectory();
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, allowsEditing: false }));
  expect(result?.source).toBe('library');
  expect(result?.files.map(file => file.relativePath)).toEqual(['1-clip.mov', '2-photo.jpg']);
  expect(result?.sessionBasename).toMatch(/^library_[^_]+_\d{8}_\d{6}$/);
  expect(result?.directoryUri).toContain('documents://');
  expect(result).not.toHaveProperty('episode');
});
it('refuses denied Photos permission before opening the library', async () => {
  vi.mocked(ImagePicker.launchImageLibraryAsync).mockClear();
  vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: false } as never);
  await expect(pickSessionDirectory()).rejects.toMatchObject({ code: 'upload_photos_denied' });
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
});
it.each([{ canceled: true, assets: null }, { canceled: false, assets: [] }])('does not create a batch for an empty Photos selection: %j', async result => {
  vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
  vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(result as never);
  expect(await pickSessionDirectory()).toBeNull();
});
it('keeps Android on the directory picker', async () => {
  const { Directory } = await import('expo-file-system');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try { expect((await pickSessionDirectory())?.sessionBasename).toBe('ego_TEST_20260916_120000'); expect(Directory.pickDirectoryAsync).toHaveBeenCalled(); }
  finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' }); }
});

it('refuses library media above the unchanged 200 MiB unmeasured limit', async () => {
  native.size = 200 * 1024 * 1024 + 1;
  vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
  vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///large.mov', type: 'video' }] } as never);
  try { await expect(pickSessionDirectory()).rejects.toMatchObject({ code: 'upload_payload_too_large' }); }
  finally { native.size = 4; }
});

it('ignores a Photos result after its upload panel was cancelled', async () => {
  vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
  let resolve!: (result: ImagePicker.ImagePickerResult) => void;
  vi.mocked(ImagePicker.launchImageLibraryAsync).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const controller = new AbortController();
  const pending = pickSessionDirectory('library', controller.signal);
  await vi.waitFor(() => expect(resolve).toBeDefined());
  controller.abort(); resolve({ canceled: false, assets: [{ uri: 'file:///clip.mov' }] } as never);
  expect(await pending).toBeNull();
});
it('removes only the new app-owned batch when copying fails', async () => {
  native.deleted.length = 0; native.failCopy = true;
  vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
  vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///clip.mov' }] } as never);
  try { await expect(pickSessionDirectory()).rejects.toThrow('disk full'); expect(native.deleted).toHaveLength(1); expect(native.deleted[0]).toMatch(/^documents:\/\/\/library_/); }
  finally { native.failCopy = false; }
});
