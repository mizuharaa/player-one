import { ApiError } from './errors.ts';

/**
 * Path A, the phone half: what happens between a collector picking a recorded
 * session off their phone and the platform saying what it made of the bytes.
 *
 * Everything in this file is pure. It talks to three injected seams — the
 * platform's routes (`DeliveryApi`), the phone's filesystem
 * (`DeliveryTransport`), and the keystore the resume record lives in
 * (`DeliveryStore`) — and nothing in it imports a native module, which is why
 * `test/delivery.test.ts` can drive the whole state machine under Node against
 * a mocked fetch and a fake disk.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SENDS, AND WHAT IT REFUSES TO SEND
 *
 * A directory name, a file list with sizes and digests, and bytes. No
 * duration, no stream count, no "estimated minutes", no amount — the engine
 * needs Node's fs and ffprobe to measure a session and an Android phone has
 * neither, so the server measures (`L2-server-phone-ingest.md`). A phone that
 * sent a measurement would be sending a number that decides what somebody is
 * paid, computed on a device its owner controls.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RESUME RECORD IS WRITTEN BEFORE THE FIRST BYTE
 *
 * The expensive thing on this path is not the transfer, it is the hashing: a
 * JS sha256 over a session is minutes of phone CPU (`sha256.ts`). If the app
 * is killed mid-upload and the inventory is gone, that work is done again. So
 * `{ upload id, directory URI, inventory }` is persisted the moment it exists
 * and cleared only when the server says `ingested`.
 *
 * The upload id is persisted with it and that is the load-bearing part: the
 * server's registration is keyed on the id the phone chose, so the SAME id has
 * to come back after a kill. A fresh one would be a second delivery of one
 * recording.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO PROGRESS ARITHMETIC HERE
 *
 * Which parts the cloud already holds comes from the cloud, through the
 * server's plan (`done`, `held_parts`), recomputed on every register and every
 * resume. This file keeps no byte counters across runs and trusts none: the
 * store is the one record that cannot disagree with the store.
 */

/** The seven states `collector_uploads.state` can be in. The server's words. */
export const DELIVERY_STATES = [
  'registered',
  'transferring',
  'verified',
  'ingesting',
  'ingested',
  'held',
  'failed',
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

/**
 * A session directory name, as the engine's own naming knowledge reads it.
 *
 * Duplicated from `parseSessionBasename` in `packages/contracts/src/identity.ts`,
 * which is the source of truth and is NOT importable here — it reaches for
 * `node:crypto`, which React Native does not have. Same reason `AGREEMENTS` in
 * `api/types.ts` duplicates the server's CHECK constraint: the list is pinned
 * on both sides of a repository boundary rather than hoped at.
 *
 * The server refuses an unrecognised name with 400 `session_basename_unrecognised`
 * and that refusal is the real gate. This copy exists so a collector who picks
 * the wrong folder is told so BEFORE the phone spends minutes hashing it.
 */
const BASENAME = /^(?:Orbbec_Ego|[A-Za-z0-9]+)_[^_]+_\d{8}_\d{6}$/;

export const looksLikeSessionDirectory = (basename: string): boolean => BASENAME.test(basename);

/**
 * The last path segment of a URI, decoded.
 *
 * Needed because `File.name` and `Directory.name` are
 * `Paths.basename(this.uri)`, and a Storage Access Framework URI's last
 * segment is percent-encoded and carries the whole tree:
 *
 *   content://com.android.externalstorage.documents/tree/primary%3AEgo%2Fego_AZER76400FE_20260813_072310
 *
 * whose basename is `primary%3AEgo%2Fego_AZER76400FE_20260813_072310`. Handing
 * that to the server as `session_basename` would be refused as unrecognised —
 * or worse, accepted as a directory name with a colon in it. So: decode, then
 * take what follows the last `/` or `:`.
 *
 * Exported for `test/delivery.test.ts`, which pins it against a `file://` path
 * and against a real SAF tree URI.
 */
export function nameFromUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, '');
  const segment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed escape is not a reason to lose the name; the server has the
    // final say on whether it is a session directory at all.
  }
  return decoded.slice(Math.max(decoded.lastIndexOf('/'), decoded.lastIndexOf(':')) + 1);
}

/** One file of the delivery, as the phone read it off the card. */
export type DeclaredFile = {
  /** The file name inside the session directory. Flat: never a path. */
  relativePath: string;
  /** Whatever handle the phone's filesystem needs to read it again. */
  uri: string;
  bytes: number;
  sha256: string;
};

/**
 * What survives the app being killed. Only what cannot be recomputed cheaply.
 *
 * ponytail: kept in `expo-secure-store`, whose Android backing store warns
 * above 2048 bytes per value — about fourteen files at these field widths.
 * A pilot session directory holds far fewer. The upgrade path is a JSON file
 * in the app's own document directory, which `expo-file-system` already gives
 * us and which has no size ceiling; it is not built now because this record is
 * the only thing the app persists besides the token and one place is enough.
 */
export type DeliveryRecord = {
  uploadId: string;
  collectionSessionId: string;
  sessionBasename: string;
  directoryUri: string;
  files: DeclaredFile[];
};

/** One part of a file at or above the server's PART_SIZE. `end` exclusive. */
export type PartPlan = { partNumber: number; start: number; end: number; url: string };

/**
 * What the server says to do about one file. Mapped straight off `FilePlan`.
 *
 * `done` and the absence of a part from `parts` are the same instruction —
 * send nothing — and both are the server reading the object store, not the
 * phone remembering what it sent.
 */
export type FilePlan = {
  relativePath: string;
  done: boolean;
  /** Below PART_SIZE: one signed PUT of the whole object. */
  putUrl: string | null;
  /** At or above PART_SIZE: the parts still missing, with their byte ranges. */
  parts: PartPlan[];
};

/** Everything the server will say about one delivery, in the app's shapes. */
export type DeliveryPlan = {
  uploadId: string;
  state: DeliveryState;
  episodeId: string | null;
  /** The server's reason, as the server wrote it. Never rephrased here. */
  heldReason: string | null;
  failedReason: string | null;
  files: FilePlan[];
};

export type DeliveryOutcome = {
  state: DeliveryState;
  episodeId: string | null;
  heldReason: string | null;
  failedReason: string | null;
};

export interface DeliveryApi {
  /**
   * Registration, and re-registration. The same id twice is a replay, and the
   * answer is the plan re-signed against what the store holds now — which is
   * also how an expired signed URL is refreshed.
   */
  registerDelivery(record: DeliveryRecord): Promise<DeliveryPlan>;
  /** Resume and progress: the plan, and the state, read off the server. */
  deliveryPlan(uploadId: string): Promise<DeliveryPlan>;
  /** Read-back verification, then the ingest. Idempotent on the server. */
  completeDelivery(uploadId: string): Promise<DeliveryOutcome>;
}

export interface DeliveryTransport {
  /**
   * Streams a whole file from disk to a signed URL and resolves the HTTP
   * status — including a non-2xx one. A 403 from the object store is an
   * expired signature and is this state machine's business, not an exception.
   */
  putFile(uri: string, url: string, progress?: (bytesSent: number) => void): Promise<number>;
  /** The same, for one byte range of a file. `end` exclusive. */
  putRange(uri: string, url: string, start: number, end: number, progress?: (bytesSent: number) => void): Promise<number>;
}

export interface DeliveryStore {
  get(): Promise<DeliveryRecord | null>;
  set(record: DeliveryRecord): Promise<void>;
  clear(): Promise<void>;
}

export type DeliveryDeps = {
  api: DeliveryApi;
  transport: DeliveryTransport;
  store: DeliveryStore;
  /** Injected so the ingest poll does not make a test wait. */
  wait?: (ms: number) => Promise<void>;
};

/** What the screen renders while this runs. Counts of files, never of money. */
export type DeliveryStep = {
  phase?: 'registering' | 'sending' | 'verifying' | 'ingesting' | 'done';
  currentFile?: string;
  sentBytes?: number;
  totalBytes?: number;
  sentFiles: number;
  totalFiles: number;
  /** Null until the server has said something about the delivery. */
  state: DeliveryState | null;
};

/**
 * A signed URL that has expired, as the object store answers it.
 *
 * S3 and every S3-compatible store answer a stale signature 403, and an
 * unsigned request 401. Both mean the same thing to this code: ask the server
 * for the plan again. Nothing else is retried here — a 500 from storage is not
 * something a phone can fix by sending the same bytes a second time.
 */
const staleSignature = (status: number): boolean => status === 401 || status === 403;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * How many times the plan is re-signed inside one run before giving up.
 *
 * ponytail: two. A signed URL lives an hour (`PRESIGN_TTL_S`), so one refresh
 * covers a session that took longer than that to send, and a second covers the
 * refresh itself expiring under a very slow link. A run that needs a third is
 * not making progress and the collector should be told rather than looped.
 */
const RESIGN_ATTEMPTS = 2;

/**
 * How long the app waits on an ingest before it stops asking.
 *
 * The server's ingest is synchronous at the pilot's clip sizes, so `ingesting`
 * is usually never observed at all. This is the poll for when it is.
 */
const POLL_LIMIT = 20;
const POLL_INTERVAL_MS = 2_000;

const outcomeOf = (plan: DeliveryPlan): DeliveryOutcome => ({
  state: plan.state,
  episodeId: plan.episodeId,
  heldReason: plan.heldReason,
  failedReason: plan.failedReason,
});

/**
 * The server has recorded a verdict on these bytes. What `/complete` answered,
 * or refused with, is final and is what the collector is shown.
 */
const settled = (state: DeliveryState): boolean =>
  state === 'ingested' || state === 'held' || state === 'failed';

/**
 * There is nothing left for the PHONE to do, which is not the same set.
 *
 * `failed` is settled and is still work: a delivery whose read-back did not
 * match is the ordinary retry, and the server answers it with a plan forced
 * past the "already there" shortcut precisely so the phone re-sends the objects
 * whose metadata cannot be trusted (`planFor`'s `force`). Short-circuiting on
 * `settled` here made that unreachable — a failed delivery came back, reported
 * `failed` again without sending a byte, and no amount of retrying could ever
 * change it.
 */
const resolved = (state: DeliveryState): boolean => state === 'ingested' || state === 'held';

/**
 * Send everything the plan says is missing.
 *
 * Resolves `'stale'` the moment a signature is refused, without touching the
 * rest of the plan: every URL in it was signed at the same moment, so one
 * expired means they all have.
 */
async function transfer(
  deps: DeliveryDeps,
  record: DeliveryRecord,
  plan: DeliveryPlan,
  report: (step: DeliveryStep) => void,
): Promise<'sent' | 'stale'> {
  const uriOf = (relativePath: string): string => {
    const file = record.files.find((f) => f.relativePath === relativePath);
    // The plan is the server's echo of the inventory this phone declared, so a
    // name in it that the inventory does not have means the two have diverged.
    if (file === undefined) throw new ApiError('upload_plan_mismatch');
    return file.uri;
  };

  const totalBytes = record.files.reduce((sum, file) => sum + file.bytes, 0);
  // Missing multipart ranges come from the server; retained bytes count only after it confirms them.
  let sentBytes = totalBytes - plan.files.reduce((sum, file) => sum + (file.done ? 0 : file.putUrl !== null
    ? record.files.find(item => item.relativePath === file.relativePath)?.bytes ?? 0
    : file.parts.reduce((bytes, part) => bytes + part.end - part.start, 0)), 0);
  let sentFiles = record.files.length - plan.files.length;
  for (const file of plan.files) {
    const emit = (bytes = sentBytes) => report({ phase: 'sending', currentFile: file.relativePath, sentFiles, totalFiles: record.files.length, sentBytes: bytes, totalBytes, state: plan.state });
    emit();
    if (!file.done) {
      const uri = uriOf(file.relativePath);
      if (file.putUrl !== null) {
        const size = record.files.find(item => item.relativePath === file.relativePath)!.bytes;
        const status = await deps.transport.putFile(uri, file.putUrl, bytes => { if (Number.isFinite(bytes)) emit(sentBytes + Math.max(0, Math.min(size, bytes))); });
        if (staleSignature(status)) return 'stale';
        if (status < 200 || status >= 300) throw new ApiError('upload_transport_failed');
        sentBytes += size;
      } else {
        for (const part of file.parts) {
          const size = part.end - part.start;
          const status = await deps.transport.putRange(uri, part.url, part.start, part.end, bytes => { if (Number.isFinite(bytes)) emit(sentBytes + Math.max(0, Math.min(size, bytes))); });
          if (staleSignature(status)) return 'stale';
          if (status < 200 || status >= 300) throw new ApiError('upload_transport_failed');
          sentBytes += size;
        }
      }
    }
    sentFiles += 1;
    emit();
  }
  return 'sent';
}

/**
 * One delivery, from wherever it already got to, through to the server's
 * verdict.
 *
 * `resume` decides only how the first plan is obtained: a fresh delivery
 * registers, a resumed one asks `GET /api/me/uploads/:id` — which is the same
 * plan, freshly signed, with `done` and `held_parts` recomputed from the store,
 * so a killed app sends only what the cloud does not hold.
 *
 * The record is persisted before the first byte and kept until the server says
 * `ingested`. A `held` or `failed` delivery keeps its record on purpose: those
 * are states a person has to look at, and throwing away the inventory would
 * mean re-hashing the session to find out anything more about it.
 */
export async function runDelivery(
  deps: DeliveryDeps,
  record: DeliveryRecord,
  {
    resume = false,
    report = () => {},
  }: { resume?: boolean; report?: (step: DeliveryStep) => void } = {},
): Promise<DeliveryOutcome> {
  if (!looksLikeSessionDirectory(record.sessionBasename)) {
    throw new ApiError('session_basename_unrecognised');
  }
  await deps.store.set(record);
  report({ phase: 'registering', sentFiles: 0, totalFiles: record.files.length, state: null });

  let plan = resume
    ? await deps.api.deliveryPlan(record.uploadId)
    : await deps.api.registerDelivery(record);

  /**
   * A delivery the server has already finished with. Its plan is empty, so
   * transferring would be a no-op and completing would be a second verdict
   * request on bytes that already have one. `resolved` and not `settled`: a
   * `failed` delivery arrives here with a full, forced plan and is the retry.
   */
  if (resolved(plan.state)) return await finish(deps, record, outcomeOf(plan), report);

  for (let attempt = 1; ; attempt += 1) {
    if ((await transfer(deps, record, plan, report)) === 'sent') break;
    if (attempt > RESIGN_ATTEMPTS) throw new ApiError('upload_urls_expired');
    // Re-registering with the same id re-signs every URL and re-reads what the
    // store holds, so nothing already up is sent twice.
    plan = await deps.api.registerDelivery(record);
  }

  let outcome: DeliveryOutcome;
  const totalBytes = record.files.reduce((sum, file) => sum + file.bytes, 0);
  report({ phase: 'verifying', sentFiles: record.files.length, totalFiles: record.files.length, sentBytes: totalBytes, totalBytes, state: plan.state });
  try {
    outcome = await deps.api.completeDelivery(record.uploadId);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    /**
     * A refused completion — a checksum mismatch, a basename collision — has
     * already been recorded on the row by the server, with its own reason in
     * its own words. Reading it back is how the collector gets the server's
     * sentence verbatim instead of this app's paraphrase of a refusal code.
     */
    const after = await deps.api.deliveryPlan(record.uploadId);
    if (!settled(after.state)) throw err;
    outcome = outcomeOf(after);
  }

  for (let i = 0; outcome.state === 'ingesting' && i < POLL_LIMIT; i += 1) {
    report({ phase: 'ingesting', sentFiles: record.files.length, totalFiles: record.files.length, sentBytes: totalBytes, totalBytes, state: outcome.state });
    await (deps.wait ?? sleep)(POLL_INTERVAL_MS);
    outcome = outcomeOf(await deps.api.deliveryPlan(record.uploadId));
  }

  return await finish(deps, record, outcome, report);
}

async function finish(
  deps: DeliveryDeps,
  record: DeliveryRecord,
  outcome: DeliveryOutcome,
  report: (step: DeliveryStep) => void,
): Promise<DeliveryOutcome> {
  if (outcome.state === 'ingested') await deps.store.clear();
  else await deps.store.set(record);
  report({ phase: outcome.state === 'ingesting' ? 'ingesting' : 'done', sentFiles: record.files.length, totalFiles: record.files.length, state: outcome.state });
  return outcome;
}
