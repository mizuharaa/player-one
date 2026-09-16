import { uuid } from '../api/http.ts';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, FileMode, Paths, UploadType } from 'expo-file-system';
import { ApiError } from '../api/types.ts';
import {
  Sha256,
  looksLikeSessionDirectory,
  nameFromUri,
  type DeclaredFile,
  type DeliveryRecord,
  type DeliveryStore,
} from '@playerone/delivery';

/**
 * The phone's half of Path A that only exists on a phone.
 *
 * `expo-file-system` is the ONE native module this lane adds, and everything it
 * is used for is here so that nothing else in the app imports it: the state
 * machine in `delivery.ts` is pure and testable under Node, and this file is
 * the part that cannot be. `web/vite.config.ts` aliases the module to a stub
 * for the browser harness, the same way it already does for
 * `expo-secure-store`.
 *
 * Cancellation is covered with a native-module fake. Device I/O still needs
 * a real Android handset with a recorded session directory — see `docs/agents/lanes/` and the
 * "what a real phone would still need to prove" list in the commit message.
 */

/** One file the picker found, before anything has hashed it. */
export type PickedFile = { relativePath: string; uri: string; bytes: number };

export type PickedSession = {
  directoryUri: string;
  sessionBasename: string;
  files: PickedFile[];
};

/**
 * APP-26 step one: the collector points at a session directory.
 *
 * `Directory.pickDirectoryAsync` is the Storage Access Framework document-tree
 * picker on Android, which is the only way an app reads a directory the user
 * chose without holding broad storage permission. It resolves a directory that
 * this app may read and, deliberately, NOTHING it may delete: no code path in
 * this repository deletes source media (PRD §11.3.1 rule 6), and on Path A the
 * phone's copy is the source media until somebody outside this system says
 * otherwise.
 *
 * Subdirectories are ignored rather than walked. The engine's input contract is
 * a flat session directory and the server refuses a relative path with a
 * separator in it, so a nested file could not be delivered even if it were
 * collected here.
 */
export async function pickSessionDirectory(): Promise<PickedSession> {
  const directory = await Directory.pickDirectoryAsync();
  const sessionBasename = nameFromUri(directory.uri);
  /**
   * The same refusal name the server raises for the same reason, so the screen
   * can print `uploads.reasonBadName` — "that folder is not a recorded session,
   * pick the right one" — instead of the generic "no folder was chosen". A bare
   * `Error` here was indistinguishable from the collector cancelling the picker.
   */
  if (!looksLikeSessionDirectory(sessionBasename)) {
    throw new ApiError('session_basename_unrecognised');
  }
  const files: PickedFile[] = [];
  for (const entry of directory.list()) {
    if (entry instanceof Directory) continue;
    files.push({ relativePath: nameFromUri(entry.uri), uri: entry.uri, bytes: entry.size });
  }
  return { directoryUri: directory.uri, sessionBasename, files };
}

/**
 * How much of a file is held in memory at once while hashing, and while
 * copying one part out to be sent.
 *
 * 1 MiB. The point of the whole exercise is that a 1.5 GB camera file is never
 * resident: `FileHandle.readBytes` hands back exactly this much at a time and
 * `Sha256` keeps 64 bytes of state between chunks.
 */
const CHUNK = 1024 * 1024;

/**
 * Hand the JS thread back for one macrotask.
 *
 * `readBytes`, `Sha256.update` and `writeBytes` are all synchronous, so a hash
 * or a part copy written as a plain loop never yields: React renders nothing,
 * the progress the screen is being handed is invisible, and Android counts the
 * whole file as an unresponsive main thread. `setTimeout(0)` and not
 * `queueMicrotask` — a microtask runs before the renderer gets a turn, which is
 * the bug rather than the fix.
 *
 * Per chunk, not per file. QA asked for one yield per progress report, which is
 * per file here, and that is where the fix would have gone if a file were
 * small; one 1.5 GB camera file is the case that produces the ANR and it is one
 * report. A megabyte of hashing is tens of milliseconds, so a yield between
 * chunks costs nothing measurable and bounds the block by one chunk.
 */
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Every file's sha256, read a megabyte at a time.
 *
 * ponytail: JS chunked sha256, fine for demo clips; native hashing when
 * sessions reach GB scale. The alternative today is `expo-crypto`, and a third
 * native module is a third reason the APK has to be rebuilt.
 *
 * The digests are a claim, not a verdict: the server reads every object back
 * out of the cloud and re-hashes it (`verifyReadBack`), and UPL-04's answer is
 * that read-back's.
 */
export async function hashSession(
  files: readonly PickedFile[],
  report: (hashedFiles: number, totalFiles: number) => void = () => {},
  signal?: AbortSignal,
): Promise<DeclaredFile[]> {
  const declared: DeclaredFile[] = [];
  for (const file of files) {
    if (signal?.aborted) throw new ApiError('upload_cancelled');
    const handle = new File(file.uri).open(FileMode.ReadOnly);
    try {
      const hash = new Sha256();
      for (;;) {
        if (signal?.aborted) throw new ApiError('upload_cancelled');
        const chunk = handle.readBytes(CHUNK);
        if (chunk.length === 0) break;
        hash.update(chunk);
        await yieldToUi();
      }
      declared.push({ ...file, sha256: hash.digest() });
    } finally {
      handle.close();
    }
    report(declared.length, files.length);
    await yieldToUi();
  }
  return declared;
}

async function upload(file: File, url: string, signal?: AbortSignal): Promise<number> {
  const deadline = AbortSignal.timeout(60_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  if (combined.aborted) throw new ApiError(signal?.aborted ? 'upload_cancelled' : 'server_unreachable');
  try {
    const result = await file.upload(url, {
      httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, signal: combined,
    });
    if (combined.aborted) throw new ApiError(signal?.aborted ? 'upload_cancelled' : 'server_unreachable');
    return result.status;
  } catch (error) {
    if (signal?.aborted) throw new ApiError('upload_cancelled');
    if (deadline.aborted) throw new ApiError('server_unreachable');
    throw error;
  }
}

export const nativeTransport = {
  /**
   * One signed PUT of a whole file, streamed off disk by the native module.
   *
   * The signed URL carries its own `x-amz-meta-sha256` in the query string —
   * the SDK hoists every `x-amz-*` header there when it presigns — so this
   * request adds no headers of its own and must not: an unexpected signed
   * header is a 403 and looks exactly like an expired URL.
   */
  async putFile(uri: string, url: string, signal?: AbortSignal) {
    return upload(new File(uri), url, signal);
  },

  /**
   * One part of a large file: copied out to a cache file, then sent by the same
   * native uploader as a whole file.
   *
   * `File.upload` cannot express a byte range, so the range has to become a
   * file. It is NOT handed to `fetch` instead, and that was measured rather
   * than assumed: React Native's `fetch` clones a typed-array body and then
   * base64-encodes it to cross the bridge, so a 64 MiB part peaked at roughly
   * 210 MiB of JS heap — the part, its clone, and an 85 MiB string. On the
   * pilot's phones that is an out-of-memory kill, not a slow upload.
   *
   * ponytail: the real ceiling is now one PART_SIZE of temporary CACHE DISK —
   * 64 MiB under `Paths.cache`, deleted as soon as the PUT answers — and one
   * CHUNK of memory, because the copy is streamed a megabyte at a time. The
   * upgrade path is unchanged and is the Kotlin foreground-service uploader
   * that Path A always owed (`App.tsx`), which can seek the source directly.
   */
  async putRange(uri: string, url: string, start: number, end: number, signal?: AbortSignal) {
    if (signal?.aborted) throw new ApiError('upload_cancelled');
    const part = new File(Paths.cache, `playerone-part-${uuid()}`);
    part.create({ overwrite: true, intermediates: true });
    try {
      const source = new File(uri).open(FileMode.ReadOnly);
      try {
        const sink = part.open(FileMode.Truncate);
        try {
          source.offset = start;
          for (let copied = 0; copied < end - start; ) {
            if (signal?.aborted) throw new ApiError('upload_cancelled');
            const chunk = source.readBytes(Math.min(CHUNK, end - start - copied));
            if (chunk.length === 0) break;
            sink.writeBytes(chunk);
            copied += chunk.length;
            await yieldToUi();
          }
        } finally { sink.close(); }
      } finally { source.close(); }
      return await upload(part, url, signal);
    } finally {
      try {
        part.delete();
      } catch {
        // A cache file the system will reclaim anyway. Losing the PUT's status
        // to a failed cleanup would turn a successful part into a retry.
      }
    }
  },
};

const KEY = 'playerone.collector.delivery';

/**
 * The resume record, in the keystore beside the token.
 *
 * A parse failure clears the record rather than throwing. The only thing this
 * data is for is saving the collector from re-hashing a session; a version of
 * the app that cannot read what an older one wrote should ask them to pick the
 * directory again, not refuse to open the uploads screen.
 */
export const nativeDeliveryStore: DeliveryStore = {
  async get() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as DeliveryRecord;
    } catch {
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
  },
  set: (record) => SecureStore.setItemAsync(KEY, JSON.stringify(record)),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

/**
 * How many bytes are free on this phone's internal storage, or `null`.
 *
 * APP-19's storage half. It sits here rather than beside the Prepare screen
 * that reads it because `expo-file-system` has exactly one importer in this app
 * on purpose (see the file header): the browser harness aliases the module to a
 * stub and every test file that reaches a screen mocks it, and a second
 * importer doubles both.
 *
 * `Paths.availableDiskSpace`, and NOT the `getFreeDiskStorageAsync` the task
 * asked for. Measured against the installed `expo-file-system@57.0.7`: the
 * package's main entry re-exports `legacyWarnings.ts`, where that function's
 * whole body is `throw errorOnLegacyMethodUse('getFreeDiskStorageAsync')` —
 * its own doc comment says "This method will throw in runtime". The spellings
 * that work are `expo-file-system/legacy`, which is a second entry point and a
 * deprecated surface, or this getter, which reads the same figure off the
 * module this file already holds. Same number, no new import.
 *
 * `null`, never 0, when the platform cannot answer — the harness stub, a test
 * mock, a future SDK that drops the getter. No free bytes at all is a fact
 * worth warning about and "we could not look" is not, and the screen prints
 * different words for the two.
 */
export function freeDiskBytes(): number | null {
  try {
    const bytes = Paths.availableDiskSpace;
    return typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}
