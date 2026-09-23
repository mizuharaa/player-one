import { z } from 'zod';
import { objectKey, planParts, PART_SIZE, PRESIGN_TTL_S, type DirectUploadStore, type TransportFile } from './upload-worker.ts';

/**
 * A delivered file is one file in one directory, and its name is all it is.
 *
 * The engine's input contract (spec §3) is a flat session directory and
 * `transportInventory` is a flat scan of one, so a relative path carrying a
 * separator is not a layout the platform accepts from anybody.
 *
 * It is also the one field on this route that a client could use to reach
 * outside its own delivery. `objectKey` interpolates the path, so `../..` in
 * one would be a signed URL for another episode's object — a collector able to
 * overwrite footage that has already been reviewed and paid for. On Path C
 * these names come from a directory listing on a machine at an upload centre;
 * here they come off the network, and this is the difference.
 */
export const RelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.includes('/') && !p.includes('\\') && !p.includes('\0'), {
    message: 'a delivered file name may not contain a path separator',
  })
  .refine((p) => p !== '.' && p !== '..', { message: 'not a file name' });

export const DeclaredFile = z.object({
  relative_path: RelativePath,
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

/** One file of the delivery, and what the phone has to do about it. */
export type FilePlan = {
  relative_path: string;
  key: string;
  bytes: number;
  sha256: string;
  /** The store already holds this object at the declared size and digest. Send nothing. */
  done: boolean;
  /** Below `PART_SIZE`: one signed PUT of the whole object. */
  put_url?: string;
  /** At or above `PART_SIZE`: the multipart this delivery's parts belong to. */
  upload_id?: string;
  /** Part numbers the store already holds at the planned size. Nothing to re-send. */
  held_parts?: number[];
  /** A signed URL per part that is still missing, with the byte range it covers. */
  parts?: { part_number: number; start: number; end: number; bytes: number; url: string }[];
};

/** The same signed transfer plan for a collector phone and an operator PC. */
export async function signedPlan(
  s: DirectUploadStore,
  episodeId: string,
  ingestId: string,
  files: readonly TransportFile[],
  sizes: ReadonlyMap<string, number>,
  force = false,
): Promise<FilePlan[]> {
  const plan: FilePlan[] = [];
  for (const f of files) {
    const key = objectKey(episodeId, ingestId, f.relative_path);
    const bytes = sizes.get(f.relative_path) ?? 0;
    const base = { relative_path: f.relative_path, key, bytes, sha256: f.sha256 };

    const existing = force ? null : await s.head(key);
    if (existing !== null && existing.bytes === bytes && existing.sha256 === f.sha256) {
      plan.push({ ...base, done: true });
      continue;
    }

    if (bytes < PART_SIZE) {
      plan.push({ ...base, done: false, put_url: await s.presignPut(key, f.sha256, PRESIGN_TTL_S) });
      continue;
    }

    const uploadId = await s.beginMultipart(key, f.sha256);
    const held = new Map((await s.heldParts(key, uploadId)).map((p) => [p.partNumber, p.size]));
    const heldNumbers: number[] = [];
    const parts: NonNullable<FilePlan['parts']> = [];
    for (const p of planParts(bytes)) {
      const size = p.end - p.start;
      // Number AND size: a part the cloud holds at a different size is a part
      // from an attempt that planned differently, and re-sending it is the
      // only safe answer.
      if (held.get(p.partNumber) === size) {
        heldNumbers.push(p.partNumber);
        continue;
      }
      parts.push({
        part_number: p.partNumber,
        start: p.start,
        end: p.end,
        bytes: size,
        url: await s.presignPart(key, uploadId, p.partNumber, PRESIGN_TTL_S),
      });
    }
    plan.push({ ...base, done: false, upload_id: uploadId, held_parts: heldNumbers, parts });
  }
  return plan;
}

/**
 * Assembly, for the files that were sent in parts. Shared by both delivery
 * shapes: how a multipart is finished has nothing to do with who measured it.
 *
 * `openMultipart` rather than `beginMultipart`: this step must never start an
 * upload. A file with nothing in flight is a file the phone has not sent, or
 * one already assembled by an earlier attempt at this delivery, and neither
 * wants an empty multipart left in the bucket.
 *
 * There is deliberately no "the object is already there, skip it" check. An
 * object being there is not a reason not to assemble: after a failed
 * read-back the object that is there is the wrong one, and the phone has just
 * re-sent every part into a new multipart precisely to replace it.
 *
 * The part count is checked against the plan before assembling. Completing a
 * short upload would produce a truncated object that then fails read-back,
 * which is the correct verdict reached the expensive way; not assembling it
 * at all reaches the same verdict without writing anything.
 */
export async function assemble(
  s: DirectUploadStore,
  files: readonly TransportFile[],
  sizes: ReadonlyMap<string, number>,
  keyOf: (relativePath: string) => string,
): Promise<void> {
  for (const f of files) {
    const bytes = sizes.get(f.relative_path) ?? 0;
    if (bytes < PART_SIZE) continue;
    const key = keyOf(f.relative_path);
    const uploadId = await s.openMultipart(key);
    if (uploadId === null) continue;
    const held = await s.heldParts(key, uploadId);
    if (held.length < planParts(bytes).length) continue;
    await s.finishMultipart(key, uploadId);
  }
}

