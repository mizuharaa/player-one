import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EpisodeRecord } from '@playerone/contracts';
import { schema, storeEpisode, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { Actor } from './actor.ts';
import { resolveEpisode, resolverDefects, type Resolution } from './resolve.ts';

/**
 * How far past the machine's own clock an episode may claim to have started
 * before the resolver treats the instant as a fault rather than a recording.
 *
 * The resolver may not read a clock — it is pure, and a payment decision has to
 * replay identically six months later — so its default ceiling is the year
 * 2100. Narrowing it is the adapter's job, and this is the adapter. The slack
 * absorbs ordinary device drift and the upload machine's own skew; anything
 * beyond it is a clock that cannot be trusted to attribute a payment.
 */
const FUTURE_START_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Episode submission and resolution: the point at which a measurement acquires
 * an owner.
 *
 * The console has already run the engine locally, so what arrives here is a
 * finished EpisodeRecord. Nothing re-measures it — PLT-09's durations and the
 * content fingerprint are final at import, so a payment dispute stays answerable
 * from Postgres without the card.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

const SubmitBody = z.object({ episodes: z.array(EpisodeRecord).min(1) });
const ResolveBody = z.object({
  collection_session_id: z.string().uuid(),
  reason: z.string().min(1),
});

export function registerEpisodes(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  toleranceMs: number,
): void {
  const opts = { preHandler: requireActor };

  /** The batch, its handover, and the sessions declared against that handover. */
  const context = async (batchId: string, actor: Actor) => {
    const [batch] = await db
      .select()
      .from(schema.uploadBatches)
      .where(
        and(
          eq(schema.uploadBatches.id, batchId),
          eq(schema.uploadBatches.uploadDeviceId, actor.machine.uploadDeviceId),
        ),
      );
    if (batch === undefined) return null;

    const [handover] = await db
      .select({
        id: schema.handovers.id,
        deviceId: schema.handovers.deviceId,
        deviceSerial: schema.devices.hardwareSerial,
      })
      .from(schema.handovers)
      .innerJoin(schema.devices, eq(schema.devices.id, schema.handovers.deviceId))
      .where(eq(schema.handovers.id, batch.handoverId));
    if (handover === undefined) return null;

    /**
     * The sessions declared against THIS card, and nothing else.
     *
     * Scoping by collector instead — which this did — makes every session a
     * collector ever declared a candidate for every later card, so the second
     * card quarantines wholesale and time-window matching could pay this week's
     * footage against last week's task.
     *
     * ponytail: app-origin sessions carry no handover (APP-16 creates them
     * before the card exists), so they are not candidates here and their
     * episodes quarantine as `no_sessions`. Safe, and the right default until
     * the app path is built — linking them is the upload slice's problem, and
     * D1/D5 block the app anyway.
     */
    const sessions = await db
      .select({
        id: schema.collectionSessions.id,
        prepareTime: schema.collectionSessions.prepareTime,
        sessionOrigin: schema.collectionSessions.sessionOrigin,
      })
      .from(schema.collectionSessions)
      .where(eq(schema.collectionSessions.handoverId, batch.handoverId));

    return { batch, handover, sessions };
  };

  app.post('/upload-batches/:id/episodes', opts, async (req, reply) => {
    const body = SubmitBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const actor = req.actor!;
    const batchId = (req.params as { id: string }).id;
    const ctx = await context(batchId, actor);
    if (ctx === null) return reply.code(404).send({ error: 'no such batch on this machine' });

    const results = [];
    for (const record of body.data.episodes) {
      /**
       * The measurement is stored first, by the code that already owns that job.
       * `storeEpisode` runs its own transaction and handles the re-delivery cases
       * (new / duplicate / mismatch), which is also what makes submission
       * idempotent on the episode id.
       *
       * Resolution is a second transaction. A crash between the two leaves the
       * episode at its column default — quarantined, with no session — which is
       * a legal state that asks for a human. The alternative, folding resolution
       * into storeEpisode, would mean editing code that is done and tested to
       * buy atomicity between a safe state and a safer one.
       */
      const stored = await storeEpisode(db, record);
      const resolution = resolveEpisode(record, ctx.sessions, {
        toleranceMs,
        latestPlausibleStartMs: Date.now() + FUTURE_START_SLACK_MS,
      });
      const defects = resolverDefects(record, ctx.handover, resolution.sessionId);

      await mutate(
        db,
        actor,
        {
          action: 'episode.submit',
          targetTable: 'episodes',
          targetId: stored.episodeId,
          before: { outcome: stored.outcome },
          after: {
            collection_session_id: resolution.sessionId,
            resolution_state: resolution.state,
            resolution_method: resolution.method,
            reason: resolution.reason,
            proposed_session_id: resolution.proposedSessionId,
            defects: defects.map((d) => d.code),
            /**
             * The audit trail proper. `audit_events.after` is jsonb, so this
             * needs no migration and no new table: every candidate the resolver
             * considered, the config it decided under, and which clock the
             * episode's start came from.
             *
             * An operator overturning a decision, or finance defending one in a
             * dispute, reads these three. Without the snapshot in particular, a
             * re-run under a later tolerance answers differently with nothing on
             * record to explain the change.
             */
            evaluated: resolution.evaluated,
            candidate_count: resolution.candidateCount,
            config_snapshot: resolution.configSnapshot,
            start_source: resolution.startSource,
            start_confidence: resolution.startConfidence,
            start_flag: resolution.startFlag,
          },
        },
        async (tx) => {
          const [row] = await tx
            .update(schema.episodes)
            .set({
              collectionSessionId: resolution.sessionId,
              resolutionState: resolution.state,
              resolutionMethod: resolution.method,
              uploadBatchId: batchId,
              // Path C: this arrived on a card at a counter, by definition.
              uploadPath: 'C',
            })
            .where(eq(schema.episodes.episodeId, stored.episodeId))
            .returning();

          // Store-time defects hang off the ingest, exactly as CHECKSUM-MISMATCH
          // does. A duplicate delivery has no new ingest, so there is nothing to
          // attach them to and nothing new to say.
          if (defects.length > 0 && stored.ingestId !== null && stored.outcome !== 'duplicate') {
            await tx
              .insert(schema.episodeDefects)
              .values(
                defects.map((d) => ({
                  ingestId: stored.ingestId!,
                  code: d.code,
                  severity: 'flag',
                  payload: { detail: d.detail },
                })),
              );
          }
          return row;
        },
      );

      results.push({
        episode_id: stored.episodeId,
        outcome: stored.outcome,
        resolution_state: resolution.state,
        resolution_method: resolution.method,
        reason: resolution.reason,
        proposed_session_id: resolution.proposedSessionId,
        needs_confirmation: resolution.needsConfirmation,
        defects: defects.map((d) => d.code),
        /**
         * Additive. The console shows the operator which clock the start came
         * from, because a resolution anchored on the IMU is weaker evidence
         * than one anchored on camera PTS and it should not look identical.
         */
        start_source: resolution.startSource,
        start_flag: resolution.startFlag,
      });
    }

    return reply.send({ batch_id: batchId, episodes: results });
  });

  /**
   * What still needs a human before the batch can close. The summary is the
   * counter's own sanity check: seven episodes against one declared session is
   * not an error, but an operator should see it rather than discover it in a
   * settlement report.
   */
  app.get('/upload-batches/:id/exceptions', opts, async (req, reply) => {
    const actor = req.actor!;
    const batchId = (req.params as { id: string }).id;
    const ctx = await context(batchId, actor);
    if (ctx === null) return reply.code(404).send({ error: 'no such batch on this machine' });

    const episodes = await db
      .select({
        episodeId: schema.episodes.episodeId,
        resolutionState: schema.episodes.resolutionState,
        resolutionMethod: schema.episodes.resolutionMethod,
        confirmedAt: schema.episodes.resolutionConfirmedAt,
        collectionSessionId: schema.episodes.collectionSessionId,
        sessionStartedAt: schema.episodes.sessionStartedAt,
      })
      .from(schema.episodes)
      .where(eq(schema.episodes.uploadBatchId, batchId));

    const quarantined = episodes.filter((e) => e.resolutionState === 'quarantined');
    const unconfirmed = episodes.filter(
      (e) => e.resolutionMethod === 'automatic_time_window' && e.confirmedAt === null,
    );

    return reply.send({
      batch_id: batchId,
      summary: {
        episodes: episodes.length,
        sessions: ctx.sessions.length,
        quarantined: quarantined.length,
        awaiting_confirmation: unconfirmed.length,
        // The one an operator should look at even when nothing is wrong.
        episodes_per_session:
          ctx.sessions.length === 0 ? null : +(episodes.length / ctx.sessions.length).toFixed(2),
      },
      /** Batch close is blocked while this is non-empty, or deferred with a reason. */
      blocking: [...quarantined, ...unconfirmed].map((e) => ({
        episode_id: e.episodeId,
        session_started_at: e.sessionStartedAt,
        resolution_state: e.resolutionState,
        needs: e.resolutionState === 'quarantined' ? 'assignment' : 'confirmation',
      })),
      sessions: ctx.sessions,
    });
  });

  /** PLT-05's human resolution path. The reason is not optional — the database refuses without it. */
  app.post('/episodes/:id/resolve', opts, async (req, reply) => {
    const body = ResolveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = req.actor!;
    const episodeId = (req.params as { id: string }).id;

    const [episode] = await db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.episodeId, episodeId));
    if (episode === undefined) return reply.code(404).send({ error: 'no such episode' });
    if (episode.uploadBatchId === null) {
      // Stored by the CLI rather than submitted through a batch, so there is no
      // delivery to check a session against. `?? ''` here used to reach Postgres
      // as an empty uuid and answer with a 500.
      return reply.code(409).send({ error: 'this episode did not arrive through a batch' });
    }

    // The session must belong to this delivery.
    const [session] = await db
      .select({ id: schema.collectionSessions.id })
      .from(schema.collectionSessions)
      .innerJoin(schema.handovers, eq(schema.handovers.collectorId, schema.collectionSessions.collectorId))
      .innerJoin(schema.uploadBatches, eq(schema.uploadBatches.handoverId, schema.handovers.id))
      .where(
        and(
          eq(schema.collectionSessions.id, body.data.collection_session_id),
          eq(schema.uploadBatches.id, episode.uploadBatchId),
          eq(schema.handovers.uploadCentreId, actor.operator.uploadCentreId),
        ),
      );
    if (session === undefined) {
      return reply.code(409).send({ error: 'that session does not belong to this delivery' });
    }

    /**
     * `mutate` reads the event after the write callback resolves, so the
     * callback can add what only the write knows: which reviews this
     * re-attribution moved, and who lost them. A privacy handoff that says only
     * "the session changed" is not reconstructable afterwards.
     */
    const event = {
      action: 'episode.resolve_manual',
      targetTable: 'episodes',
      targetId: episodeId,
      // What the machine suggested and what the human picked, so a dispute can
      // see the difference without another column on episodes.
      before: {
        resolution_state: episode.resolutionState,
        proposed_session_id: episode.collectionSessionId,
      },
      after: { collection_session_id: body.data.collection_session_id } as Record<string, unknown>,
      reason: body.data.reason,
    };
    await mutate(
      db,
      actor,
      event,
      async (tx) => {
        const [row] = await tx
          .update(schema.episodes)
          .set({
            collectionSessionId: body.data.collection_session_id,
            resolutionState: 'resolved',
            resolutionMethod: 'manual',
          })
          .where(eq(schema.episodes.episodeId, episodeId))
          .returning();
        /**
         * QR-07. The review lane is derived from the session's two APP-17b
         * declarations, and this endpoint is the one place a resolved episode
         * can be pointed at a *different* session. A pending review keeps the
         * lane it was materialised with, so without this an episode re-resolved
         * onto a session that declares others in frame stays in the queue every
         * reviewer sees.
         *
         * Upgrades only. A reviewer's own PRV-04 flag lives in the same column
         * and is not this endpoint's to lift; the declaration is a floor, not
         * the whole value.
         */
        const moved = (await tx.execute(sql`
          update episode_reviews r
             set queue = 'privacy', reviewer_ref = null, claimed_at = null,
                 lease_expires_at = null, assignee_ref = null, updated_at = now()
            from collection_sessions s
           where r.episode_id = ${episodeId}
             and r.review_state = 'pending'
             and r.queue <> 'privacy'
             and s.id = ${body.data.collection_session_id}
             and (s.others_in_frame or s.sensitive_info_present)
          returning r.id, r.reviewer_ref as displaced_reviewer_ref
        `)) as unknown as { id: string; displaced_reviewer_ref: string | null }[];
        if (moved.length > 0) {
          event.after['quarantined_reviews'] = moved;
          event.after['reason_code'] = 'CO-PRIVACY';
        }
        return row;
      },
    );
    return reply.send({ episode_id: episodeId, resolution_state: 'resolved', resolution_method: 'manual' });
  });

  /**
   * A human agreeing with the machine, which is a different fact from a human
   * choosing — a settlement dispute will ask which happened, so it is a
   * different endpoint and a different audit action.
   */
  app.post('/episodes/:id/confirm', opts, async (req, reply) => {
    const actor = req.actor!;
    const episodeId = (req.params as { id: string }).id;

    const [episode] = await db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.episodeId, episodeId));
    if (episode === undefined) return reply.code(404).send({ error: 'no such episode' });
    if (episode.resolutionMethod === null || episode.resolutionState !== 'resolved') {
      return reply.code(409).send({ error: 'nothing to confirm: this episode has no machine proposal' });
    }
    if (episode.resolutionConfirmedAt !== null) {
      return reply.send({ episode_id: episodeId, already_confirmed: true });
    }

    await mutate(
      db,
      actor,
      {
        action: 'episode.resolve_confirm',
        targetTable: 'episodes',
        targetId: episodeId,
        after: {
          collection_session_id: episode.collectionSessionId,
          resolution_method: episode.resolutionMethod,
        },
      },
      async (tx) => {
        const [row] = await tx
          .update(schema.episodes)
          .set({ resolutionConfirmedAt: new Date() })
          .where(eq(schema.episodes.episodeId, episodeId))
          .returning();
        return row;
      },
    );
    return reply.send({ episode_id: episodeId, already_confirmed: false });
  });

  /** The status view: batches on this machine, newest first. */
  app.get('/upload-batches', opts, async (req, reply) => {
    const actor = req.actor!;
    const status = (req.query as Record<string, string>)['status'];
    const rows = await db
      .select({
        id: schema.uploadBatches.id,
        handoverId: schema.uploadBatches.handoverId,
        batchStatus: schema.uploadBatches.batchStatus,
        importStartedAt: schema.uploadBatches.importStartedAt,
        importCompletedAt: schema.uploadBatches.importCompletedAt,
      })
      .from(schema.uploadBatches)
      .where(
        status
          ? and(
              eq(schema.uploadBatches.uploadDeviceId, actor.machine.uploadDeviceId),
              eq(schema.uploadBatches.batchStatus, status),
            )
          : eq(schema.uploadBatches.uploadDeviceId, actor.machine.uploadDeviceId),
      );

    const ids = rows.map((r) => r.id);
    const counts =
      ids.length === 0
        ? []
        : await db
            .select({
              uploadBatchId: schema.episodes.uploadBatchId,
              state: schema.episodes.resolutionState,
              n: sql<number>`count(*)::int`,
            })
            .from(schema.episodes)
            .where(inArray(schema.episodes.uploadBatchId, ids))
            .groupBy(schema.episodes.uploadBatchId, schema.episodes.resolutionState);

    return reply.send({
      batches: rows.map((r) => ({
        ...r,
        resolved: counts.find((c) => c.uploadBatchId === r.id && c.state === 'resolved')?.n ?? 0,
        quarantined: counts.find((c) => c.uploadBatchId === r.id && c.state === 'quarantined')?.n ?? 0,
      })),
    });
  });
}
