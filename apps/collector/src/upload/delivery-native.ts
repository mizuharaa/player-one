import * as SecureStore from 'expo-secure-store';
import { Directory, File, FileMode, UploadType } from 'expo-file-system';
import { Sha256 } from './sha256.ts';
import {
  looksLikeSessionDirectory,
  nameFromUri,
  type DeclaredFile,
  type DeliveryRecord,
  type DeliveryStore,
  type DeliveryTransport,
} from './delivery.ts';

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
 * Not tested here. Every function below needs a real Android handset with a
 * real recorded session directory on it — see `docs/agents/lanes/` and the
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
  if (!looksLikeSessionDirectory(sessionBasename)) {
    throw new Error(`session_basename_unrecognised:${sessionBasename}`);
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
 * sending one part.
 *
 * 1 MiB. The point of the whole exercise is that a 1.5 GB camera file is never
 * resident: `FileHandle.readBytes` hands back exactly this much at a time and
 * `Sha256` keeps 64 bytes of state between chunks.
 */
const CHUNK = 1024 * 1024;

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
): Promise<DeclaredFile[]> {
  const declared: DeclaredFile[] = [];
  for (const file of files) {
    const handle = new File(file.uri).open(FileMode.ReadOnly);
    try {
      const hash = new Sha256();
      for (;;) {
        const chunk = handle.readBytes(CHUNK);
        if (chunk.length === 0) break;
        hash.update(chunk);
      }
      declared.push({ ...file, sha256: hash.digest() });
    } finally {
      handle.close();
    }
    report(declared.length, files.length);
  }
  return declared;
}

export const nativeTransport: DeliveryTransport = {
  /**
   * One signed PUT of a whole file, streamed off disk by the native module.
   *
   * The signed URL carries its own `x-amz-meta-sha256` in the query string —
   * the SDK hoists every `x-amz-*` header there when it presigns — so this
   * request adds no headers of its own and must not: an unexpected signed
   * header is a 403 and looks exactly like an expired URL.
   */
  async putFile(uri, url) {
    const result = await new File(uri).upload(url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
    });
    return result.status;
  },

  /**
   * One part of a large file.
   *
   * ponytail: the part is read into memory and handed to `fetch`, so the peak
   * is one PART_SIZE — 64 MiB — per part. `File.upload` cannot express a byte
   * range, and the upgrade path is the Kotlin foreground-service uploader that
   * Path A always owed (`App.tsx`); until then this is the only way a file over
   * 64 MiB moves at all, and it is bounded rather than proportional to the
   * session.
   */
  async putRange(uri, url, start, end) {
    const handle = new File(uri).open(FileMode.ReadOnly);
    let body: Uint8Array;
    try {
      handle.offset = start;
      body = handle.readBytes(end - start);
    } finally {
      handle.close();
    }
    const response = await fetch(url, { method: 'PUT', body });
    return response.status;
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
