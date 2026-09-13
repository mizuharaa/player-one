/**
 * The browser's half of Path A: the seams `runDelivery` needs, filled with
 * `fetch`, `File` and `localStorage`.
 *
 * This is the console's answer to `apps/collector/src/upload/delivery-native.ts`.
 * The two files are the same size and do the same four jobs — hash, PUT a whole
 * object, PUT one byte range, keep the resume record — because the state
 * machine above them is the same code (`@playerone/delivery`). Nothing about
 * registration, re-signing, the `failed` retry or the verdict is repeated here;
 * if it were, the console and the phone could disagree about what the platform
 * did with a collector's footage, and only one of them would be under test.
 */
import {
  ApiError,
  Sha256,
  looksLikeSessionDirectory,
  type DeclaredFile,
  type DeliveryRecord,
  type DeliveryStore,
  type DeliveryTransport,
} from '@playerone/delivery';

/** One file the operator picked, with the browser's handle on its bytes. */
export type PickedFile = { relativePath: string; bytes: number; file: File };
export type PickedSession = { sessionBasename: string; files: PickedFile[] };

/**
 * A megabyte at a time, read with `Blob.slice(...).arrayBuffer()`.
 *
 * Never the whole file: a 39 MB session and a 1.5 GB camera part cost one
 * megabyte of heap each here, which is the same property the phone's
 * `readBytes` loop has. Between chunks the loop yields, so the main thread
 * paints and the operator sees the byte count move — on the phone that is
 * `yieldToUi` for exactly the same reason.
 *
 * **`file.stream()` was the first implementation and is not usable here.**
 * jsdom does not implement `Blob.prototype.stream` (measured: `typeof
 * file.stream === 'undefined'` under jsdom 30.0.1, while `slice` and
 * `arrayBuffer` are both functions), so a streamed read cannot be tested at
 * all — and an untested hash is the one thing in this file that must not be
 * untested, because a wrong digest is a delivery the server refuses or, worse,
 * accepts. Slicing reads no more of the file than streaming does; the only
 * thing given up is letting the browser choose the chunk size, and the chunk
 * size here is a deliberate 1 MiB.
 */
const CHUNK = 1024 * 1024;

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * What `<input type="file" webkitdirectory>` handed us, as a session.
 *
 * `webkitRelativePath` is `<top-level directory>/<…>/<name>` with forward
 * slashes on every platform, so the first segment is the directory name the
 * operator chose and that is `session_basename`. The server derives the episode
 * id from it and from nothing else.
 *
 * Three refusals, all before a byte is hashed:
 *
 *   - nothing picked, which is what a cancelled dialog looks like;
 *   - a file below a subdirectory. The engine's input contract is a FLAT
 *     session directory (`discover.ts` reports `nested` for anything else) and
 *     `POST /api/me/uploads` refuses a `relative_path` containing a separator
 *     outright, so a nested pick would be refused after minutes of hashing —
 *     or, worse, accepted as a directory root somebody meant to pick one level
 *     down;
 *   - a directory name the engine's naming rule does not recognise, by the
 *     SHARED `looksLikeSessionDirectory`. The server's 400
 *     `session_basename_unrecognised` is the real gate; this copy exists so an
 *     operator who picked the batch root is told so immediately.
 */
export function pickedSession(files: readonly File[]): PickedSession {
  if (files.length === 0) throw new ApiError('debug_pick_empty');

  const segments = files.map((file) => (file.webkitRelativePath || file.name).split('/'));
  const roots = new Set(segments.map((s) => s[0]!));
  if (roots.size !== 1) throw new ApiError('debug_pick_many_roots');
  if (segments.some((s) => s.length > 2)) throw new ApiError('debug_pick_nested');

  const sessionBasename = [...roots][0]!;
  if (!looksLikeSessionDirectory(sessionBasename)) {
    throw new ApiError('session_basename_unrecognised');
  }

  return {
    sessionBasename,
    files: files
      .map((file, i) => ({
        // The name inside the directory, never a path. `segments[i]` has
        // exactly two parts by the check above, so this is the file name.
        relativePath: segments[i]![1] ?? file.name,
        bytes: file.size,
        file,
      }))
      // Stable, so an inventory and a re-pick of the same folder list in the
      // same order and are read by a person in the same order.
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

/**
 * Every file's sha256, a megabyte at a time.
 *
 * The digests are a CLAIM about bytes this browser read, never a verdict:
 * `/complete` makes the server read every object back out of the store and
 * re-hash it, and UPL-04's answer is that read-back's. The only thing computing
 * them here buys is that a corrupted read on this machine is caught by the
 * platform rather than ingested.
 */
export async function hashSession(
  files: readonly PickedFile[],
  report: (hashedFiles: number, totalFiles: number, hashedBytes: number) => void = () => {},
): Promise<DeclaredFile[]> {
  const declared: DeclaredFile[] = [];
  let hashedBytes = 0;
  for (const picked of files) {
    const hash = new Sha256();
    const size = picked.file.size;
    for (let at = 0; at < size; at += CHUNK) {
      const chunk = new Uint8Array(
        await picked.file.slice(at, Math.min(at + CHUNK, size)).arrayBuffer(),
      );
      // A slice that came back short would silently hash the wrong bytes and
      // the server would answer `upload_checksum_mismatch` an hour later.
      if (chunk.length === 0) throw new ApiError('debug_read_short');
      hash.update(chunk);
      hashedBytes += chunk.length;
      report(declared.length, files.length, hashedBytes);
      await yieldToUi();
    }
    declared.push({
      relativePath: picked.relativePath,
      /**
       * The browser has no stable handle on a file the user picked — a `File`
       * lives as long as the page does and cannot be reopened by name. So the
       * `uri` the state machine carries is the relative path, and
       * `browserTransport` resolves it back to a `File` through the map the
       * page holds. That is also why a resumed delivery here needs the folder
       * picked again, where the phone can reopen a `content://` URI.
       */
      uri: picked.relativePath,
      bytes: picked.bytes,
      sha256: hash.digest(),
    });
    report(declared.length, files.length, hashedBytes);
    await yieldToUi();
  }
  return declared;
}

/**
 * A signed PUT straight from the operator's browser into the object store.
 *
 * **No headers.** `getSignedUrl` hoists every `x-amz-*` header into the query
 * string when it presigns, `x-amz-meta-sha256` included, so the request has
 * nothing to add — and adding a header the signature does not cover is a 403
 * that looks exactly like an expired URL. The `File` goes in as the body, which
 * the browser streams off disk; nothing here reads it into memory.
 *
 * A non-2xx status is RESOLVED, not thrown: a 403 from the store is an expired
 * signature and is the state machine's business, which re-registers and gets
 * fresh URLs. The one case that does throw is a request the browser refused to
 * send at all.
 */
export const browserTransport = (handles: ReadonlyMap<string, File>): DeliveryTransport => {
  const fileFor = (uri: string): File => {
    const file = handles.get(uri);
    // The inventory and the picked folder have diverged — a resume against a
    // different directory, in practice. The same refusal the state machine
    // raises when the server's plan names a file the inventory does not have.
    if (file === undefined) throw new ApiError('upload_plan_mismatch');
    return file;
  };

  const put = async (body: Blob, url: string): Promise<number> => {
    try {
      const response = await fetch(url, { method: 'PUT', body, credentials: 'omit' });
      return response.status;
    } catch {
      /**
       * `fetch` rejects with `TypeError: Failed to fetch` — no status, no body
       * — for a cross-origin PUT the bucket's CORS policy does not allow, and
       * for a store that is simply not reachable. Both are indistinguishable
       * from here, and the first one is overwhelmingly the likely cause the
       * first time anybody runs this page against a new bucket. So it becomes
       * a named refusal with a sentence that says what to do, instead of an
       * unhandled TypeError over a delivery whose bytes never left.
       *
       * `packages/api/scripts/bucket-cors.mjs` is that sentence's answer.
       */
      throw new ApiError('debug_transport_blocked');
    }
  };

  return {
    // `async`, so a `fileFor` refusal is a rejected promise and not a throw
    // out of the call itself — the state machine awaits these.
    putFile: async (uri, url) => await put(fileFor(uri), url),
    // `Blob.slice` is a view, not a copy: a 64 MiB part costs no heap here.
    putRange: async (uri, url, start, end) => await put(fileFor(uri).slice(start, end), url),
  };
};

/**
 * The resume record, in this browser's `localStorage`.
 *
 * Only the inventory and the upload id, which is exactly what the phone keeps
 * and for the same reason: hashing is the expensive half, and the upload id is
 * what makes a second attempt the SAME delivery rather than a second delivery
 * of one recording.
 *
 * The collector token is deliberately NOT here and must never be. It is a
 * thirty-day credential for somebody else's account, held in memory for the
 * life of the page and gone when the tab closes; `localStorage` survives the
 * tab, survives a reboot, and is readable by any script on this origin.
 *
 * A parse failure clears the record rather than throwing. The only thing it
 * saves is a re-hash.
 */
const KEY = 'playerone.console.debugDelivery';

export const localDeliveryStore: DeliveryStore = {
  async get() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      // Private browsing, or storage denied. Not having a resume record is a
      // worse demonstration, not a broken page.
      return null;
    }
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as DeliveryRecord;
    } catch {
      await this.clear();
      return null;
    }
  },
  async set(record) {
    try {
      localStorage.setItem(KEY, JSON.stringify(record));
    } catch {
      // A quota refusal must not abort a delivery that is about to send bytes.
    }
  },
  async clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to do about it, and nothing depends on it */
    }
  },
};

/**
 * Whether a held record can be resumed against the folder just picked.
 *
 * By name and size, and not by digest: the whole point of resuming is to skip
 * the hashing, so comparing digests would defeat it. A file whose bytes changed
 * under the same name and size still fails — on the server, at `/complete`,
 * where the read-back re-hashes it and answers `upload_checksum_mismatch`. That
 * is the right place for it.
 */
export function resumable(record: DeliveryRecord, picked: PickedSession): boolean {
  if (record.sessionBasename !== picked.sessionBasename) return false;
  if (record.files.length !== picked.files.length) return false;
  const sizes = new Map(picked.files.map((f) => [f.relativePath, f.bytes]));
  return record.files.every((f) => sizes.get(f.relativePath) === f.bytes);
}
