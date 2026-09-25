import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@playerone/store';
import type { CounterActor } from './actor.ts';
import { mutate } from './audit.ts';
import { parkCloudFailure } from './cloud-verification.ts';
import { DeclaredFile } from './direct-upload.ts';
import { objectKey, ReadBackInterrupted, verifyReadBack, type Mismatch, type ObjectStore } from './upload-worker.ts';

const identity = { episode_id: z.string().uuid(), ingest_id: z.string().uuid() };
export const ReverifyTarget = z.discriminatedUnion('source', [
  z.object({ ...identity, source: z.literal('card') }).strict(),
  z.object({ ...identity, source: z.literal('phone'), upload_id: z.string().uuid() }).strict(),
]);
export const ReverifyAllowlist = z.array(ReverifyTarget).min(1).max(100).refine(
  (items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length,
  'duplicate target',
);
type Target = z.infer<typeof ReverifyTarget>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const Files = z.array(DeclaredFile.extend({ bytes: z.number().int().nonnegative().safe() }));

export class ReverifyRefused extends Error {}

/** Resolve keys from stored identities only. Incoming/staging objects never count. */
export async function planReverify(db: Db | Tx, target: Target) {
  target = ReverifyTarget.parse(target);
  const [ingest] = await db.select({
    latest: schema.episodes.latestIngestId, state: schema.episodes.verificationState,
    record: schema.episodeIngests.recordJson, extras: schema.episodeIngests.transportExtraFiles,
  }).from(schema.episodeIngests).innerJoin(schema.episodes, eq(schema.episodes.episodeId, schema.episodeIngests.episodeId))
    .where(and(eq(schema.episodeIngests.episodeId, target.episode_id), eq(schema.episodeIngests.ingestId, target.ingest_id)));
  if (!ingest || ingest.latest !== target.ingest_id) throw new ReverifyRefused('target is absent or no longer the current ingest');
  let files: z.infer<typeof Files>;
  let prefix = target.ingest_id;
  if (target.source === 'phone') {
    const [upload] = await db.select().from(schema.collectorUploads).where(and(
      eq(schema.collectorUploads.id, target.upload_id), eq(schema.collectorUploads.episodeId, target.episode_id),
      eq(schema.collectorUploads.ingestId, target.ingest_id),
    ));
    if (!upload || !['verified', 'ingested'].includes(upload.state)) throw new ReverifyRefused('phone delivery is not a completed upload of this exact ingest');
    if (upload.measured) {
      const sources = await db.select({ relative_path: schema.episodeFiles.relativePath,
        sha256: schema.episodeFiles.sha256, bytes: schema.episodeFiles.sizeBytes })
        .from(schema.episodeFiles).where(eq(schema.episodeFiles.ingestId, target.ingest_id));
      files = [...Files.parse(sources), ...Files.parse(upload.extraFiles)];
    } else {
      files = Files.parse(upload.declaredFiles);
      prefix = upload.id; // Legacy phone objects predate the engine's ingest ID.
    }
    if (files.length !== upload.fileCount || files.reduce((sum, f) => sum + f.bytes, 0) !== upload.totalBytes) {
      throw new ReverifyRefused('phone inventory disagrees with its declared file count or bytes');
    }
  } else {
    // Older local card imports did not persist the non-fingerprinted remainder.
    // Their normal batch reverify route can reconstruct it from the local card;
    // this read-only owner tool must not guess a complete inventory from receipts.
    if (ingest.extras === null) throw new ReverifyRefused('card transport inventory missing; use its normal batch reverify with the retained local source');
    const record = z.object({ source_files: Files }).parse(ingest.record);
    files = [...record.source_files, ...Files.parse(ingest.extras)];
  }
  files.sort((a, b) => a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0);
  if (files.length === 0 || new Set(files.map((f) => f.relative_path)).size !== files.length) {
    throw new ReverifyRefused('empty or duplicate file inventory');
  }
  const bytes = files.reduce((sum, f) => sum + f.bytes, 0);
  if (!Number.isSafeInteger(bytes)) throw new ReverifyRefused('inventory byte total is unsafe');
  const keys = files.map((f) => objectKey(target.episode_id, prefix, f.relative_path));
  return { target, files, keys, bytes, verification_state: ingest.state };
}

/** Owner connection authorizes the operation; named staff/machine provide attribution, not impersonated login. */
export async function reverifyOwner(db: Db, operatorId: string, machineId: string) {
  z.string().uuid().parse(operatorId);
  z.string().uuid().parse(machineId);
  const [owner] = await db.execute(sql`select current_user as db_actor,
    bool_and(pg_has_role(current_user, relowner, 'USAGE')) as authorized
    from pg_class where oid in ('episodes'::regclass, 'settlements'::regclass, 'cloud_verifications'::regclass)`);
  if (owner?.authorized !== true) throw new ReverifyRefused('apply requires the database owner role');
  const [operator] = await db.select().from(schema.operators).where(eq(schema.operators.id, operatorId));
  const [machine] = await db.select().from(schema.uploadDevices).where(eq(schema.uploadDevices.id, machineId));
  if (!operator || !machine || operator.status !== 'active' || machine.status !== 'active'
    || !['administrator', 'finance'].includes(operator.role) || operator.uploadCentreId !== machine.uploadCentreId) {
    throw new ReverifyRefused('apply requires active administrator/finance attribution and a matching active machine');
  }
  const actor: CounterActor = {
    machine: { kind: 'machine', uploadDeviceId: machine.id, uploadCentreId: machine.uploadCentreId },
    operator: { kind: 'operator', operatorId: operator.id, uploadCentreId: machine.uploadCentreId },
  };
  return { actor, databaseActor: String(owner.db_actor) };
}

type ReverifyResult = Target & {
  outcome: 'mismatch' | 'incomplete' | 'matched';
  verification_state: Awaited<ReturnType<typeof planReverify>>['verification_state'];
  files: number;
  matched: number;
  mismatches: Mismatch[];
  interrupted: boolean;
  parked_settlements: string[];
  database_actor: string;
};

export async function reverifyDelivery(
  db: Db, store: Pick<ObjectStore, 'read'>, target: Target,
  attribution: Awaited<ReturnType<typeof reverifyOwner>>, reason: string,
) {
  const plan = await planReverify(db, target);
  const keys = new Map(plan.files.map((f, i) => [f.relative_path, plan.keys[i]!]));
  const keyOf = (path: string) => keys.get(path)!;
  const matched = new Set<string>();
  let mismatches: Mismatch[] = [];
  let interrupted = false;
  try {
    mismatches = await verifyReadBack(store, plan.files, keyOf, async (key) => { matched.add(key); });
  } catch (error) {
    interrupted = true;
    if (error instanceof ReadBackInterrupted) mismatches = error.mismatches;
  }
  const outcome = mismatches.length ? 'mismatch' : interrupted ? 'incomplete' : 'matched';
  return mutate<ReverifyResult>(db, attribution.actor, (result) => ({
    action: 'episode.owner_reverify', targetTable: 'episodes', targetId: target.episode_id,
    before: { verification_state: plan.verification_state }, after: result, reason,
  }), async (tx) => {
    await tx.execute(sql`select originality_lock()`);
    await tx.execute(sql`select episode_id from episodes where episode_id = ${target.episode_id} for update`);
    await tx.execute(sql`select ingest_id from episode_ingests where ingest_id = ${target.ingest_id} for update`);
    if (target.source === 'phone') await tx.execute(sql`select id from collector_uploads where id = ${target.upload_id} for update`);
    const current = await planReverify(tx, target);
    if (JSON.stringify(current.files) !== JSON.stringify(plan.files) || JSON.stringify(current.keys) !== JSON.stringify(plan.keys)) {
      throw new ReverifyRefused('inventory changed during readback; no result was recorded');
    }
    // Success preserves state: checking one copy cannot clear another copy's
    // failure or release a finance exception. An interruption preserves the
    // previous verdict but reports incomplete: maintenance must remain held.
    const state = mismatches.length ? 'failed' : current.verification_state;
    await tx.update(schema.episodes).set({ verificationState: state }).where(and(
      eq(schema.episodes.episodeId, target.episode_id), eq(schema.episodes.latestIngestId, target.ingest_id),
    ));
    for (const file of plan.files) {
      const key = keyOf(file.relative_path);
      if (matched.has(key)) await tx.insert(schema.cloudVerifications).values({
        objectKey: key, episodeId: target.episode_id, ingestId: target.ingest_id, sha256: file.sha256,
      }).onConflictDoUpdate({ target: schema.cloudVerifications.objectKey,
        set: { sha256: file.sha256, verifiedAt: new Date() } });
    }
    for (const mismatch of mismatches) await tx.delete(schema.cloudVerifications).where(and(
      eq(schema.cloudVerifications.episodeId, target.episode_id), eq(schema.cloudVerifications.ingestId, target.ingest_id),
      eq(schema.cloudVerifications.objectKey, keyOf(mismatch.relative_path)),
    ));
    const parked = mismatches.length ? await parkCloudFailure(tx, attribution.actor, target.episode_id, target.ingest_id) : [];
    return { ...target, outcome, verification_state: state, files: plan.files.length,
      matched: matched.size, mismatches, interrupted, parked_settlements: parked, database_actor: attribution.databaseActor };
  });
}
