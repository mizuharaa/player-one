import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { EpisodeRecord } from '@playerone/contracts';
import { schema, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { Actor } from './actor.ts';
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
  const batchOf = async (batchId: string, actor: Actor) => {
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
   * by read-back and record the verdict. Safe to re-run at any point — an
   * object already up and matching is kept, an interrupted run resumes, and a
   * failed episode is force-overwritten from the local cache (its metadata has
   * already proved unreliable).
   *
   * ponytail: one synchronous request per batch, sized for the pilot's card
   * loads; a background queue with progress is the upgrade path when a batch
   * stops fitting in a request timeout.
   */
  app.post('/upload-batches/:id/upload', opts, async (req, reply) => {
    const actor = req.actor as Actor;
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
            force: row.verificationState === 'failed',
          },
          options.uploadProgress,
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
    const actor = req.actor as Actor;
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
