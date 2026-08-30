import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { EpisodeRecord } from '@playerone/contracts';
import { schema, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { CounterActor } from './actor.ts';
import { uploadEpisode, type ObjectStore, type UploadProgress } from './upload-worker.ts';

/**
 * Path C's cloud leg, server half: UPL-03/04/05/06, UPL-15/16.
 *
 * The transport itself is `upload-worker.ts` — the part that has to run at the
 * upload centre, next to the local cache (PRODUCT.md:34). What is left here is
 * what only the server can do: scope a batch to the machine that holds its
 * card, write the verification verdict against the exact ingest that was
 * transported, and flip the UPL-06 batch gate.
 *
 * Two rules govern this file, and each is stated where it is enforced:
 *
 *   - **The cache-cleanup gate is schema state.** `upload_batches` already
 *     carries `cloud_verified_at`, `local_cache_cleaned_at` and
 *     `upload_batches_cache_after_verify_check`; migrations 0007 and 0009
 *     extend that gate with a trigger, so neither timestamp can be set while
 *     any episode on
 *     the batch is unverified *at that moment*. This file only tries the update
 *     and reports; it cannot bypass either.
 *   - **No code path here deletes anything.** Not TF-card source media (PRD
 *     §11.3.1 rule 6, not deviable) and not even the local cache: the
 *     cache-clean route *records* that an operator cleaned it, once the schema
 *     allows the fact to exist. ponytail: recording-only cleanup; an actual
 *     rm belongs in an operator tool once someone asks for one.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

/**
 * The centre's memory of what it has already proven, in the only durable store
 * this half of the leg has today.
 *
 * `UploadProgress` is described in upload-worker.ts as the better-sqlite3 state
 * of the Electron client, and that is still where it belongs the day that
 * client exists. Until then it is nowhere, and "nowhere" has a measured price:
 * a re-run of a batch re-downloaded every byte it had already verified (0.00 MB
 * up and 16.00 MB down on a clean 16 MB episode), and one damaged object forced
 * a re-send and a re-read of its whole episode. Both loops in `uploadEpisode`
 * now skip a file with a matching receipt, so the receipts have to survive
 * between two HTTP requests, and the database is what does that here.
 *
 * Bound to the ingest being transported: a receipt names one delivery's bytes,
 * and the composite foreign key refuses one that names another episode's.
 *
 * ponytail: three one-line statements, no transaction. Each row is independent
 * and self-describing, a lost write costs one re-read, and a duplicate write is
 * an upsert. Nothing downstream reads this table.
 */
function verificationReceipts(db: Db, ingestId: string): UploadProgress {
  return {
    done: async (episodeId) =>
      new Map(
        (
          await db
            .select({
              key: schema.cloudVerifications.objectKey,
              sha256: schema.cloudVerifications.sha256,
            })
            .from(schema.cloudVerifications)
            .where(eq(schema.cloudVerifications.episodeId, episodeId))
        ).map((r) => [r.key, r.sha256]),
      ),
    record: async (episodeId, key, sha256) => {
      await db
        .insert(schema.cloudVerifications)
        .values({ objectKey: key, episodeId, ingestId, sha256 })
        .onConflictDoUpdate({
          target: schema.cloudVerifications.objectKey,
          set: { ingestId, sha256, verifiedAt: new Date() },
        });
    },
    forget: async (_episodeId, key) => {
      await db.delete(schema.cloudVerifications).where(eq(schema.cloudVerifications.objectKey, key));
    },
  };
}

export type UploadOptions = {
  /** Absent until the GreenNode contract yields an endpoint; the routes answer 503 saying so. */
  objectStore?: ObjectStore;
  /** Same directory the review console streams from: the imported `ego_*` folders. */
  mediaRoot?: string;
  /** The centre's memory of what it has transported. Defaults to remembering nothing. */
  uploadProgress?: UploadProgress;
};

/**
 * Every episode on the batch that is not currently cloud-verified. The UPL-06
 * gate reads this twice — once before the batch may be called verified, once
 * before its local cache may be called cleaned — because "verified once" and
 * "verified now" stop being the same sentence as soon as a delivery is
 * redelivered or a re-verification fails. Migration 0009's trigger is the
 * guarantee; these clauses only turn the refusal into an answer rather than a
 * 500.
 */
/**
 * Takes a row lock on every episode of the batch, before either gate reads
 * their verification state.
 *
 * The trigger and the WHERE clauses both ask a question about rows in another
 * table, and under READ COMMITTED each of them answers from a snapshot. Locking
 * the batch row alone does not help: a redelivery, or the verdict write of a
 * concurrent upload run, touches an EPISODE row. Both transactions could
 * therefore pass their own snapshot and both commit, leaving a batch recorded
 * cache-cleaned with a pending or failed episode on it — which is the one
 * outcome UPL-06 exists to make unrepresentable. Locking the episodes first
 * serialises the two: whichever gets there second waits and then re-reads.
 *
 * ponytail: a whole-batch lock, held for the length of one small transaction.
 * A card load is tens of episodes, so there is nothing to gain from finer
 * grain, and the alternative — SERIALIZABLE plus retry — is a bigger promise
 * to keep everywhere else in this file.
 */
const lockEpisodes = (tx: { execute: (q: SQL) => Promise<unknown> }, batchId: string) =>
  tx.execute(
    sql`select 1 from episodes where upload_batch_id = ${batchId} order by episode_id for update`,
  );

const noneUnverified = (batchId: string) =>
  sql`not exists (select 1 from episodes
                    where episodes.upload_batch_id = ${batchId}
                      and episodes.verification_state <> 'verified')`;

export function registerUpload(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: UploadOptions = {},
): void {
  const opts = { preHandler: requireActor };

  /** Same machine scope as the counter's batch routes: the uploader is the machine holding the cache. */
  const batchOf = async (batchId: string, actor: CounterActor) => {
    const [batch] = await db
      .select()
      .from(schema.uploadBatches)
      .where(
        and(
          eq(schema.uploadBatches.id, batchId),
          eq(schema.uploadBatches.uploadDeviceId, actor.machine.uploadDeviceId),
        ),
      );
    return batch;
  };

  /**
   * UPL-04/05: push every episode of the batch to the cloud, then verify each
   * by read-back and record the verdict. Safe to re-run at any point, and a
   * re-run costs only what it has not already proved: an object already up and
   * matching is kept, an object already read back and matched is left alone
   * entirely, an interrupted run resumes, and the files of a failed episode
   * that have no receipt are force-overwritten from the local cache (their
   * metadata has already proved unreliable).
   *
   * ponytail: one synchronous request per batch, sized for the pilot's card
   * loads; a background queue with progress is the upgrade path when a batch
   * stops fitting in a request timeout.
   */
  app.post('/upload-batches/:id/upload', opts, async (req, reply) => {
    const actor = req.actor as CounterActor;
    const batchId = (req.params as { id: string }).id;
    if (options.objectStore === undefined) {
      return reply.code(503).send({ error: 'no object store is configured on this machine' });
    }
    if (options.mediaRoot === undefined || options.mediaRoot === '') {
      return reply.code(503).send({ error: 'no media root is configured on this machine' });
    }
    const store = options.objectStore;
    const mediaRoot = options.mediaRoot;

    const batch = await batchOf(batchId, actor);
    if (batch === undefined) return reply.code(404).send({ error: 'no such batch on this machine' });

    /**
     * `?reverify=1` — the operator's lever for making the cloud prove itself
     * again on ONE batch.
     *
     * A receipt says these bytes were read back and matched once, and that is
     * what licenses skipping them on every later run. It is the right default
     * and it removed the only thing that would ever have noticed the cloud
     * damaging a file *after* we verified it: with a receipt in place the object
     * is never read again, and before this parameter the only way to drop one
     * was a DELETE typed against the database by hand.
     *
     * Narrow on purpose. The general rule does not move — widening "forget"
     * would put the whole measured re-download bill back (1.00x the raw size
     * of every verified episode, on every run) and turn the two receipt tests
     * red. This clears the receipts of one named batch, on the machine that
     * holds it, at the moment an operator asks. Whatever fails on the way back
     * out is then reported the way any other read-back failure is: the episode
     * goes to `failed`, review will not serve it, and the cache gate refuses.
     *
     * It clears the rows in `cloud_verifications`, which is what
     * `verificationReceipts` reads. A caller that injected its own
     * `uploadProgress` keeps its own memory and is not touched — there is one
     * such caller and it is the test suite.
     */
    if ((req.query as Record<string, string>)['reverify'] === '1') {
      await mutate(
        db,
        actor,
        (cleared: number) => ({
          action: 'batch.reverify',
          targetTable: 'upload_batches',
          targetId: batchId,
          after: { receipts_cleared: cleared },
        }),
        async (tx) => {
          const dropped = (await tx.execute(
            sql`delete from cloud_verifications
                 where episode_id in (select episode_id from episodes
                                       where upload_batch_id = ${batchId})
                returning object_key`,
          )) as unknown as unknown[];
          // Audited whether or not it found a receipt to drop: "I asked for this
          // batch to be checked again" is the fact, and a batch that had none is
          // still the answer to why the next run re-read everything.
          return dropped.length;
        },
      );
    }

    /**
     * Every episode on the batch, quarantined ones included: ING-17, nothing is
     * discarded, and the batch cannot flip verified while any of its episodes
     * is not. The join pins the ingest whose bytes are about to move, and the
     * verdict below is written against that same ingest.
     */
    const rows = await db
      .select({
        episodeId: schema.episodes.episodeId,
        ingestId: schema.episodeIngests.ingestId,
        verificationState: schema.episodes.verificationState,
        sourceBasename: schema.episodeIngests.sourceBasename,
        recordJson: schema.episodeIngests.recordJson,
      })
      .from(schema.episodes)
      .innerJoin(
        schema.episodeIngests,
        eq(schema.episodeIngests.ingestId, schema.episodes.latestIngestId),
      )
      .where(eq(schema.episodes.uploadBatchId, batchId));

    const results: Record<string, unknown>[] = [];
    for (const row of rows) {
      const parsed = EpisodeRecord.safeParse(row.recordJson);
      if (!parsed.success) {
        results.push({ episode_id: row.episodeId, error: 'stored record does not parse' });
        continue;
      }

      let outcome;
      try {
        outcome = await uploadEpisode(
          store,
          {
            episodeId: row.episodeId,
            ingestId: row.ingestId,
            mediaRoot,
            sourceBasename: row.sourceBasename,
            sourceFiles: parsed.data.source_files,
            /**
             * The episode's last read-back failed, so the "already there"
             * metadata check cannot be trusted for the files this run has to
             * send. It reaches only those files: anything with a receipt was
             * proven by read-back, which is the evidence force stands in for,
             * and the failing file's receipt was dropped when it failed. One
             * damaged object used to cost a whole episode in both directions.
             */
            force: row.verificationState === 'failed',
          },
          options.uploadProgress ?? verificationReceipts(db, row.ingestId),
        );
      } catch (err) {
        // A later re-run resumes: completed objects answer 'kept', the one in
        // flight is re-sent. Nothing is verified for this episode yet, so
        // nothing downstream can act on the partial upload.
        results.push({ episode_id: row.episodeId, error: (err as Error).message });
        continue;
      }

      const state = outcome.mismatches.length === 0 ? 'verified' : 'failed';
      const written = await mutate(
        db,
        actor,
        {
          action: 'episode.cloud_verify',
          targetTable: 'episodes',
          targetId: row.episodeId,
          before: { verification_state: row.verificationState },
          after: {
            verification_state: state,
            ingest_id: row.ingestId,
            files: outcome.transported,
            mismatches: outcome.mismatches,
          },
        },
        async (tx) => {
          /**
           * `latest_ingest_id` is in the WHERE because the verdict belongs to
           * the ingest that was transported. If a redelivery landed while these
           * bytes were moving, the episode's latest ingest is no longer the one
           * this loop read, and stamping 'verified' on it would certify bytes
           * nobody uploaded. No row back means no audit row either, which is
           * what `mutate` wants.
           */
          const [updated] = await tx
            .update(schema.episodes)
            .set({ verificationState: state })
            .where(
              and(
                eq(schema.episodes.episodeId, row.episodeId),
                eq(schema.episodes.latestIngestId, row.ingestId),
              ),
            )
            .returning();
          return updated;
        },
      );
      if (written === undefined) {
        // The WHERE above found nothing, so a redelivery landed while these
        // bytes were moving. Reporting the verdict anyway would name a state
        // that was never stored. The next run picks up the new ingest.
        results.push({
          episode_id: row.episodeId,
          uploaded: outcome.uploaded,
          kept: outcome.kept,
          error: 'a newer delivery of this episode landed while it was uploading',
        });
        continue;
      }
      results.push({
        episode_id: row.episodeId,
        uploaded: outcome.uploaded,
        kept: outcome.kept,
        verification_state: state,
        ...(outcome.mismatches.length > 0 ? { mismatches: outcome.mismatches } : {}),
      });
    }

    /**
     * The batch flips only when every episode on it is verified, and the WHERE
     * clause is not the guarantee — the migration-0009 trigger is. Returning no
     * row means no flip and no audit entry, which is what `mutate` wants.
     */
    const flipped = await mutate(
      db,
      actor,
      {
        action: 'batch.cloud_verified',
        targetTable: 'upload_batches',
        targetId: batchId,
        before: { batch_status: batch.batchStatus },
        after: { batch_status: 'verified' },
      },
      async (tx) => {
        await lockEpisodes(tx, batchId);
        const [updated] = await tx
          .update(schema.uploadBatches)
          .set({ cloudVerifiedAt: new Date(), batchStatus: 'verified', updatedAt: new Date() })
          .where(
            and(
              eq(schema.uploadBatches.id, batchId),
              isNull(schema.uploadBatches.cloudVerifiedAt),
              noneUnverified(batchId),
              sql`exists (select 1 from episodes where episodes.upload_batch_id = ${batchId})`,
            ),
          )
          .returning();
        return updated;
      },
    );

    /**
     * What this run found, not what some earlier run found. Reading
     * `batch.cloudVerifiedAt` here made the response say `cloud_verified: true`
     * for a batch whose episode had since been redelivered and was sitting at
     * `pending` — the timestamp is a fact about the past and the caller is
     * asking about the present. Every episode on the batch is in `results`,
     * so the current answer is already in hand and costs no query.
     */
    return reply.send({
      batch_id: batchId,
      episodes: results,
      cloud_verified:
        results.length > 0 && results.every((r) => r['verification_state'] === 'verified'),
    });
  });

  /**
   * UPL-06: records that the operator cleaned this machine's local cache for a
   * batch. Recording is all it does — nothing is deleted here, and the schema
   * (CHECK + trigger, migrations 0007 and 0009) is what makes "cleaned before the cloud
   * verified" unrepresentable rather than merely unimplemented. TF-card source
   * media is not touched by any code path; the card is never cleared.
   *
   * `cloud_verified_at` alone is not the question. It records that a full
   * verification passed once, and deleting the only local copy is a decision
   * about now: a redelivered episode is back to `pending` (migration 0009's
   * other trigger) and a re-verification can fail, either of which leaves that
   * historical timestamp standing over bytes the cloud no longer holds intact.
   * So the current state of every episode is re-read here.
   */
  app.post('/upload-batches/:id/cache-clean', opts, async (req, reply) => {
    const actor = req.actor as CounterActor;
    const batchId = (req.params as { id: string }).id;
    const batch = await batchOf(batchId, actor);
    if (batch === undefined) return reply.code(404).send({ error: 'no such batch on this machine' });
    if (batch.localCacheCleanedAt !== null) {
      return reply.send({ id: batchId, replayed: true });
    }

    const written = await mutate(
      db,
      actor,
      {
        action: 'batch.cache_clean',
        targetTable: 'upload_batches',
        targetId: batchId,
        before: { batch_status: batch.batchStatus, cloud_verified_at: batch.cloudVerifiedAt },
        after: { batch_status: 'closed' },
      },
      async (tx) => {
        await lockEpisodes(tx, batchId);
        const [updated] = await tx
          .update(schema.uploadBatches)
          .set({ localCacheCleanedAt: new Date(), batchStatus: 'closed', updatedAt: new Date() })
          .where(
            and(
              eq(schema.uploadBatches.id, batchId),
              sql`${schema.uploadBatches.cloudVerifiedAt} is not null`,
              noneUnverified(batchId),
            ),
          )
          .returning();
        return updated;
      },
    );
    if (written === undefined) {
      return reply
        .code(409)
        .send({ error: 'the cloud has not verified this batch; the local cache stays' });
    }
    return reply.send({ id: batchId, replayed: false });
  });
}
