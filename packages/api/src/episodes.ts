import { basename } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { deriveEpisodeId, EpisodeRecord } from '@playerone/contracts';
import { schema, storeEpisode, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { CounterActor } from './actor.ts';
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
const ClearBody = z.object({
  /**
   * Client-generated, like every other counter mutation (counter.ts): the
   * console keeps working with the link down and replays its queue, so the
   * same decision arriving twice has to land once. `episode_clearings.id` is
   * the primary key, which is the unique key that makes that true.
   */
  id: z.string().uuid(),
  /** The delivery the operator judged authoritative. */
  ingest_id: z.string().uuid(),
  reason: z.string().trim().min(1),
});
/**
 * Park and unpark carry the same two fields as a clear, minus the delivery:
 * parking is about the episode, not about which bytes are real. `id` is the
 * client's, for the same reason it is on the clear — the console queues its
 * mutations and replays them, and the same decision arriving twice has to land
 * once. `episode_parks.id` is the primary key, which is what makes that true.
 */
const ParkBody = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1),
});

export function registerEpisodes(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  toleranceMs: number,
): void {
  const opts = { preHandler: requireActor };
  /**
   * The counter, always. A reviewer session is refused by the route guard on
   * every path in this file, so both halves are present by the time anything
   * here runs.
   */
  const actorOf = (req: FastifyRequest): CounterActor => req.actor as CounterActor;

  /** The batch, its handover, and the sessions declared against that handover. */
  const context = async (batchId: string, actor: CounterActor) => {
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
        /** Read only by the device-assignment crosscheck in `resolve.ts`. */
        collectorId: schema.collectionSessions.collectorId,
      })
      .from(schema.collectionSessions)
      .where(eq(schema.collectionSessions.handoverId, batch.handoverId));

    /**
     * The device's assignment periods, for the crosscheck the resolver cannot
     * make on its own: `resolve.ts` is pure and may not read a database, so the
     * lookup happens here and the periods travel in as data.
     *
     * One query per batch rather than per episode. An allotment runs about three
     * months, so a device carries a handful of rows for its whole service life
     * and filtering them in memory beats a query for every episode on the card.
     *
     * ponytail: keyed on the HANDOVER's device, the one an operator physically
     * looked at when the card came across the counter, and not on the serial the
     * episode's own manifest claims. When those two disagree, SERIAL-CONFLICT
     * already records it against the ingest for a human. Keying on the episode's
     * serial is the upgrade path and it needs every serial the fleet has emitted
     * to exist as a `devices` row first, which at the pilot it does not.
     */
    const assignments = await db
      .select({
        collectorId: schema.deviceAssignments.collectorId,
        validFrom: schema.deviceAssignments.validFrom,
        validTo: schema.deviceAssignments.validTo,
      })
      .from(schema.deviceAssignments)
      .where(eq(schema.deviceAssignments.deviceId, handover.deviceId));

    /**
     * A device with no custody history at all is a device nobody has
     * recorded an assignment for yet — not a device with a gap in its record.
     * On the upgrade path from 0004 the `devices.bound_collector_id` column
     * 0010 seeds from is created empty, so every pilot device starts here, and
     * running the crosscheck against an empty history would send the whole
     * fleet's footage to the human queue on deploy day. `undefined` is the
     * resolver's "not supplied" and switches the crosscheck off; the first
     * bind (or a typed assignment) turns it on for that device from that
     * instant — `assigneeAt` treats footage from before the earliest period as
     * untracked too, so a backlog upload is not quarantined by the bind that
     * came after it (F-33). From then on a gap is a gap.
     */
    return { batch, handover, sessions, assignments: assignments.length === 0 ? undefined : assignments };
  };

  app.post('/upload-batches/:id/episodes', opts, async (req, reply) => {
    const body = SubmitBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const actor = actorOf(req);
    const batchId = (req.params as { id: string }).id;
    const ctx = await context(batchId, actor);
    if (ctx === null) return reply.code(404).send({ error: 'no such batch on this machine' });

    const results = [];
    for (const record of body.data.episodes) {
      /**
       * The id is re-derived here, from the record's own basename, before the
       * record is allowed to touch anything.
       *
       * `episodes.episode_id` is global — that is the point of deriving it from
       * the basename (docs/episode-identity.md): a card at the counter and a
       * cloud re-download of the same session are one episode and one payment.
       * The cost of a global key is that a caller who could choose it could
       * name somebody else's episode and, two transactions later, move it onto
       * this machine's batch. The id is a pure function of the basename and the
       * engine computes it with this same function, so a record that disagrees
       * with itself is not a delivery to reconcile — it is refused.
       */
      const expected = deriveEpisodeId(basename(record.source.path));
      if (record.episode_id !== expected) {
        results.push({
          episode_id: record.episode_id,
          error: 'episode_id does not derive from the source basename',
          expected_episode_id: expected,
        });
        continue;
      }
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
      const resolution = resolveEpisode(
        record,
        ctx.sessions,
        { toleranceMs, latestPlausibleStartMs: Date.now() + FUTURE_START_SLACK_MS },
        [],
        ctx.assignments,
      );
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
    const actor = actorOf(req);
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
        parkedParkId: schema.episodes.parkedParkId,
      })
      .from(schema.episodes)
      .where(eq(schema.episodes.uploadBatchId, batchId));

    /**
     * A parked episode blocks nothing (0018). Parking IS the operator's answer
     * — they looked at it and said it cannot be judged as delivered — so
     * leaving it in `blocking` would hold the batch open on the work that was
     * just done. It is still counted, because a card whose episodes were all
     * parked is not a clean card.
     */
    const parked = episodes.filter((e) => e.parkedParkId !== null);
    const quarantined = episodes.filter(
      (e) => e.resolutionState === 'quarantined' && e.parkedParkId === null,
    );
    const unconfirmed = episodes.filter(
      (e) =>
        e.resolutionMethod === 'automatic_time_window' &&
        e.confirmedAt === null &&
        e.parkedParkId === null,
    );

    return reply.send({
      batch_id: batchId,
      summary: {
        episodes: episodes.length,
        sessions: ctx.sessions.length,
        quarantined: quarantined.length,
        awaiting_confirmation: unconfirmed.length,
        parked: parked.length,
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
    const actor = actorOf(req);
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
    const actor = actorOf(req);
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

  /**
   * SEC-02: an operator acts on what arrived at their own centre. Same 404 as
   * an id that does not exist, so another centre's episodes cannot be
   * enumerated from here either.
   */
  const atThisCentre = async (episodeId: string, actor: CounterActor): Promise<boolean> => {
    const [episode] = await db
      .select({ episodeId: schema.episodes.episodeId })
      .from(schema.episodes)
      .innerJoin(schema.uploadBatches, eq(schema.uploadBatches.id, schema.episodes.uploadBatchId))
      .innerJoin(schema.handovers, eq(schema.handovers.id, schema.uploadBatches.handoverId))
      .where(
        and(
          eq(schema.episodes.episodeId, episodeId),
          eq(schema.handovers.uploadCentreId, actor.operator.uploadCentreId),
        ),
      );
    return episode !== undefined;
  };

  /**
   * Clearing ONE episode out of a CHECKSUM-MISMATCH quarantine.
   *
   * A redelivery whose bytes differ writes a second ingest carrying
   * CHECKSUM-MISMATCH, and the ingest spec (§6) keeps the episode out of review
   * until somebody says which delivery is real. This is where they say it. The
   * answer is a row in `episode_clearings` — who, when, why, from what — and a
   * move of `latest_ingest_id` onto the delivery named. Nothing else changes:
   * the other delivery's ingest, files and defects stay exactly as stored
   * (Rule 6), and the review lane reads the clearing rather than an edit.
   *
   * Only the delivery conflict is cleared here. An episode with no session is
   * a different quarantine with its own route (`/resolve`), and a machine
   * proposal awaiting a human is `/confirm`; both already exist and this one
   * does not repeat them. An episode can need two of these in turn.
   *
   * The counter only: the route guard refuses a reviewer session on every
   * path in this file, so `actorOf` is safe here as everywhere above.
   */
  app.post('/episodes/:id/clear', opts, async (req, reply) => {
    const body = ClearBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = actorOf(req);
    const episodeId = (req.params as { id: string }).id;
    const named = body.data.ingest_id;

    if (!(await atThisCentre(episodeId, actor))) {
      return reply.code(404).send({ error: 'no such episode' });
    }

    const event = {
      action: 'episode.clear',
      targetTable: 'episodes',
      targetId: episodeId,
      before: {} as Record<string, unknown>,
      after: {} as Record<string, unknown>,
      reason: body.data.reason,
    };
    let refusal: string | null = null;
    /** The clearing this id already names, when the request is a replay. */
    let replayed: { id: string } | undefined;
    /** A replay is the same decision: same episode, same delivery, same reason. Anything else under that id is a reused id. */
    const sameDecision = (k: { episodeId: string; ingestId: string; reason: string }) =>
      k.episodeId === episodeId && k.ingestId === named && k.reason === body.data.reason;
    const written = await mutate(db, actor, event, async (tx) => {
      /**
       * Lock the episode first, then read the delivery under the lock. A
       * redelivery landing mid-request moves `latest_ingest_id`, and the
       * decision below is about the delivery that is latest NOW.
       *
       * `uncleared`: latest carries a CHECKSUM-MISMATCH that no clearing has
       * yet answered.
       */
      const [row] = (await tx.execute(sql`
        select e.latest_ingest_id as latest, i.state as from_state,
               exists (select 1 from episode_defects d
                        where d.ingest_id = e.latest_ingest_id and d.code = 'CHECKSUM-MISMATCH'
                          and not exists (select 1 from episode_clearings k where k.ingest_id = d.ingest_id)) as uncleared
          from episodes e
          join episode_ingests i on i.ingest_id = e.latest_ingest_id
         where e.episode_id = ${episodeId}
           for update of e
      `)) as unknown as { latest: string; from_state: string; uncleared: boolean }[];
      if (row === undefined) {
        refusal = 'episode_clearing_nothing_to_clear';
        return undefined;
      }
      /**
       * The replay check comes before every gate, because the gates read
       * state the first request changed: the identical retry of a clear that
       * moved latest onto A finds nothing to clear on A. Same-episode clears
       * are serialised by the lock above, so this read is current.
       */
      const [prior] = await tx
        .select()
        .from(schema.episodeClearings)
        .where(eq(schema.episodeClearings.id, body.data.id));
      if (prior !== undefined) {
        if (sameDecision(prior)) replayed = prior;
        else refusal = 'episode_clearing_id_reused';
        return undefined;
      }
      /**
       * The named delivery must be one of this episode's. The composite FK
       * `episode_clearings_delivery_fk` refuses anything else at the database;
       * this read is what turns that into a sentence instead of a 500.
       */
      const [delivery] = await tx
        .select({ ingestId: schema.episodeIngests.ingestId })
        .from(schema.episodeIngests)
        .where(and(eq(schema.episodeIngests.episodeId, episodeId), eq(schema.episodeIngests.ingestId, named)));
      if (delivery === undefined) {
        refusal = 'episode_clearing_foreign_delivery';
        return undefined;
      }
      /**
       * Anything to clear? A clear does two things: it answers the mismatch
       * on the delivery it names, and it moves latest onto that delivery. It
       * is a no-op only when neither happens — the named delivery is already
       * latest and its mismatch (if it ever had one) is already answered.
       * Asking only whether LATEST is mismatched, which this did, refused a
       * correction in one direction: name A (never mismatched), look again,
       * name B — B still carries an unanswered CHECKSUM-MISMATCH, but A was
       * latest by then and clean.
       */
      if (named === row.latest && !row.uncleared) {
        refusal = 'episode_clearing_nothing_to_clear';
        return undefined;
      }
      /**
       * A delivery that has already been reviewed and paid is not a choice
       * that can be unmade here: naming a different one would materialise a
       * second review for the same session and, through `settlements_review_key`
       * being per review, a second payment. That is the dispute path (P2).
       */
      const [paid] = await tx
        .select({ id: schema.episodeReviews.id })
        .from(schema.episodeReviews)
        .where(
          and(
            eq(schema.episodeReviews.episodeId, episodeId),
            sql`${schema.episodeReviews.ingestId} <> ${named}`,
            inArray(schema.episodeReviews.reviewState, ['pass', 'partial_pass']),
          ),
        );
      if (paid !== undefined) {
        refusal = 'episode_clearing_paid_on_other_delivery';
        return undefined;
      }

      const [clearing] = await tx
        .insert(schema.episodeClearings)
        .values({
          id: body.data.id,
          episodeId,
          ingestId: named,
          priorLatestIngestId: row.latest,
          fromState: row.from_state,
          clearedBy: actor.operator.operatorId,
          reason: body.data.reason,
        })
        // Only a concurrent clear of ANOTHER episode under this id gets here;
        // same-episode ones queue on the lock and are caught as `prior`.
        .onConflictDoNothing({ target: schema.episodeClearings.id })
        .returning({ id: schema.episodeClearings.id });
      if (clearing === undefined) {
        refusal = 'episode_clearing_id_reused';
        return undefined;
      }
      if (row.latest !== named) {
        await tx
          .update(schema.episodes)
          .set({ latestIngestId: named })
          .where(eq(schema.episodes.episodeId, episodeId));
      }
      event.before = { latest_ingest_id: row.latest, state: row.from_state };
      event.after = { latest_ingest_id: named, clearing_id: clearing.id };
      return clearing;
    });
    if (written === undefined && replayed === undefined) {
      return reply.code(409).send({ error: 'refused', constraint: refusal ?? 'episode_clearing_nothing_to_clear' });
    }
    // A replay answers with the first clearing's id; nothing was written, no audit row either.
    return reply.send({
      episode_id: episodeId,
      clearing_id: (written ?? replayed)!.id,
      latest_ingest_id: named,
      replayed: written === undefined,
    });
  });

  /**
   * QR-04 and APP-27, the read side: why this episode's footage was refused,
   * in words the collector can read.
   *
   * Both are P0 and both were unreachable. A reviewer already picks reason
   * codes, `review_reason_codes` already carries `label_vi` and `label_zh`, and
   * until now the only thing that could read either was the operator console.
   * A collector who is not paid for a recording had no way to be told why.
   *
   * **Scoped so a collector may be admitted here later.** Nothing in the body
   * is anybody else's: no reviewer, no lease, no queue, no centre, no
   * settlement, no other episode. `collector_id` is in it precisely so the
   * collector guard is a comparison and not a rewrite — when the collector
   * token exists, the guard is one line after the 404:
   *
   *     if (actor.collector !== undefined && actor.collector.id !== row.collector_id)
   *       return reply.code(404).send({ error: 'no such episode' });
   *
   * A 404 rather than a 403, so another collector's episode ids cannot be
   * enumerated from here. Building that token is a different agent's work and
   * is deliberately not started here.
   *
   * **No centre scope, unlike every other route in this file.** SEC-02 scopes a
   * counter operator to what arrived at their own machine, and that is right
   * for importing, resolving and clearing — those act on a card somebody is
   * holding. This one answers a question a collector asks, and a collector can
   * walk into any centre; scoping it would make the answer depend on where the
   * card happened to be read. `GET /api/payout/collectors/:id/income` already
   * takes the same position for the same reason, on money rather than words.
   *
   * ponytail: `review_state` is returned as the database spells it — `pending`,
   * `pass`, `partial_pass`, `fail`, or null when nothing has been claimed yet.
   * A second collector-facing vocabulary mapped on top would be one more thing
   * to keep in step with the schema, and the console already reads these four.
   *
   * The labels are returned as stored, all three. `label_vi` and `label_zh` are
   * nullable columns (0001), so a reason added with English only answers null
   * here — making them NOT NULL is `fix/console-defects`'s change and is not
   * duplicated in this route.
   */
  app.get('/api/episodes/:id/outcome', opts, async (req, reply) => {
    const episodeId = (req.params as { id: string }).id;

    /**
     * The verdict on the delivery that currently counts, and the last one
     * anybody decided.
     *
     * `latest_ingest_id` because a redelivery is judged on its own bytes and an
     * older delivery's verdict is not an answer about the footage that stands.
     * `reviewed_at desc nulls last` because QR-08 puts a second review on the
     * same delivery: once the dispute is decided that verdict is the newest and
     * wins, and while it is still pending the original stays visible — a
     * collector under second review must not lose the reason they challenged.
     */
    const [row] = (await db.execute(sql`
      select e.episode_id,
             cs.collector_id,
             e.latest_ingest_id as ingest_id,
             r.id as review_id,
             r.review_state,
             r.reviewed_at,
             r.reviewer_note
        from episodes e
        left join collection_sessions cs on cs.id = e.collection_session_id
        left join lateral (
          select id, review_state, reviewed_at, reviewer_note
            from episode_reviews
           where episode_id = e.episode_id
             and ingest_id = e.latest_ingest_id
           order by reviewed_at desc nulls last
           limit 1
        ) r on true
       where e.episode_id = ${episodeId}
    `)) as unknown as {
      episode_id: string;
      collector_id: string | null;
      ingest_id: string | null;
      review_id: string | null;
      review_state: string | null;
      reviewed_at: Date | null;
      reviewer_note: string | null;
    }[];
    if (row === undefined) return reply.code(404).send({ error: 'no such episode' });

    const reasons =
      row.review_id === null
        ? []
        : await db
            .select({
              code: schema.reviewReasonCodes.code,
              category: schema.reviewReasonCodes.category,
              label_en: schema.reviewReasonCodes.labelEn,
              label_vi: schema.reviewReasonCodes.labelVi,
              label_zh: schema.reviewReasonCodes.labelZh,
            })
            .from(schema.episodeReviewReasons)
            .innerJoin(
              schema.reviewReasonCodes,
              eq(schema.reviewReasonCodes.code, schema.episodeReviewReasons.code),
            )
            .where(eq(schema.episodeReviewReasons.reviewId, row.review_id))
            .orderBy(schema.reviewReasonCodes.category, schema.reviewReasonCodes.code);

    return reply.send({
      episode_id: row.episode_id,
      collector_id: row.collector_id,
      ingest_id: row.ingest_id,
      review_state: row.review_state,
      reviewed_at: row.reviewed_at === null ? null : new Date(row.reviewed_at).toISOString(),
      /** QR-04's free text, written by the reviewer for the collector to read. */
      reviewer_note: row.reviewer_note,
      reasons,
    });
  });

  /**
   * Parking ONE episode out of the review queue, and taking it back out again.
   *
   * The dead end these answer: a review the queue can serve but no reviewer can
   * finish. A verdict refused `review_duration_implausible` leaves the row
   * pending, the lease runs out, and the next reviewer is refused the same way
   * for ever. An episode quarantined by the ingest engine
   * (`DUR-EXCEEDS-WINDOW`, `CALIB-MISSING`) never reaches the queue at all and
   * had no route out but a redelivery. A session with no claim is refused
   * `session_claim_missing` on every decision. Before this the only exit was a
   * bad verdict, which pays a collector nothing for footage nobody judged.
   *
   * A park is a row and a pointer, exactly as a clearing is (0018 says why):
   * `episode_parks` records who, when, from which state and why, and
   * `episodes.parked_park_id` is the single value the review queue reads. A
   * park made in error is lifted by a second row, never by an edit, so both
   * halves of the mistake stay on the record.
   *
   * What parking does NOT do: touch the review row, the delivery, the session
   * or any money. A pending review stays exactly as it was and comes back with
   * its priority and its lane when the episode is released; the queue simply
   * stops offering it. Nothing here deletes media (Rule 6).
   *
   * A parked episode cannot be paid and a paid episode cannot be parked — both
   * enforced in the schema by 0018, not here. An episode that already carries a
   * settlement is refused `episode_parks_settled`, and the exit for that one is
   * the settlement exception (0016), which parks the money instead.
   *
   * The counter only, like everything in this file: the route guard refuses a
   * reviewer session on every path here, so a reviewer shown "send this back to
   * the counter" asks an operator, who is the one who can do it.
   */
  app.post('/episodes/:id/park', opts, async (req, reply) => {
    const body = ParkBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = actorOf(req);
    const episodeId = (req.params as { id: string }).id;
    if (!(await atThisCentre(episodeId, actor))) {
      return reply.code(404).send({ error: 'no such episode' });
    }

    const event = {
      action: 'episode.park',
      targetTable: 'episodes',
      targetId: episodeId,
      before: {} as Record<string, unknown>,
      after: {} as Record<string, unknown>,
      reason: body.data.reason,
    };
    let refusal: string | null = null;
    /** The park this id already names, when the request is a replay. */
    let replayed: { id: string } | undefined;
    const written = await mutate(db, actor, event, async (tx) => {
      /**
       * Lock the episode, then read it under the lock. The verdict transaction
       * takes the same lock before it reads eligibility, so a park racing a
       * verdict is decided rather than interleaved: either the verdict sees the
       * park and writes nothing, or the park waits and is refused by the
       * settlement the verdict wrote.
       */
      const [row] = (await tx.execute(sql`
        select e.resolution_state as state, e.parked_park_id as parked,
               exists (select 1
                         from settlements s
                         join episode_reviews r on r.id = s.episode_review_id
                        where r.episode_id = e.episode_id) as settled
          from episodes e
         where e.episode_id = ${episodeId}
           for update of e
      `)) as unknown as { state: string; parked: string | null; settled: boolean }[];
      // Episodes are never deleted, so `atThisCentre` above already proved this.
      if (row === undefined) return undefined;
      /**
       * The replay check before every gate, for the same reason the clear
       * route has it there: the gates read state the first request changed,
       * so the identical retry of a park that succeeded would be refused as
       * already parked. Parks of one episode serialise on the lock above, so
       * this read is current.
       */
      const [prior] = await tx
        .select()
        .from(schema.episodeParks)
        .where(eq(schema.episodeParks.id, body.data.id));
      if (prior !== undefined) {
        const same =
          prior.episodeId === episodeId &&
          prior.releasesParkId === null &&
          prior.reason === body.data.reason;
        if (same) replayed = prior;
        else refusal = 'episode_park_id_reused';
        return undefined;
      }
      if (row.parked !== null) {
        refusal = 'episode_parks_already_parked';
        return undefined;
      }
      if (row.settled) {
        refusal = 'episode_parks_settled';
        return undefined;
      }

      const [park] = await tx
        .insert(schema.episodeParks)
        .values({
          id: body.data.id,
          episodeId,
          fromState: row.state,
          parkedBy: actor.operator.operatorId,
          reason: body.data.reason,
        })
        // Only a concurrent park of ANOTHER episode under this id gets here;
        // same-episode ones queue on the lock and are caught as `prior`.
        .onConflictDoNothing({ target: schema.episodeParks.id })
        .returning({ id: schema.episodeParks.id });
      if (park === undefined) {
        refusal = 'episode_park_id_reused';
        return undefined;
      }
      await tx
        .update(schema.episodes)
        .set({ parkedParkId: park.id })
        .where(eq(schema.episodes.episodeId, episodeId));
      event.before = { resolution_state: row.state, parked_park_id: null };
      event.after = { parked_park_id: park.id };
      return park;
    });
    if (written === undefined && replayed === undefined) {
      return reply.code(409).send({ error: 'refused', constraint: refusal ?? 'episode_parks_already_parked' });
    }
    // A replay answers with the first park's id; nothing was written, no audit row either.
    return reply.send({
      episode_id: episodeId,
      park_id: (written ?? replayed)!.id,
      parked: true,
      replayed: written === undefined,
    });
  });

  /** The way back, for the park that should not have happened. */
  app.post('/episodes/:id/unpark', opts, async (req, reply) => {
    const body = ParkBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = actorOf(req);
    const episodeId = (req.params as { id: string }).id;
    if (!(await atThisCentre(episodeId, actor))) {
      return reply.code(404).send({ error: 'no such episode' });
    }

    const event = {
      action: 'episode.unpark',
      targetTable: 'episodes',
      targetId: episodeId,
      before: {} as Record<string, unknown>,
      after: {} as Record<string, unknown>,
      reason: body.data.reason,
    };
    let refusal: string | null = null;
    let replayed: { id: string } | undefined;
    const written = await mutate(db, actor, event, async (tx) => {
      const [row] = (await tx.execute(sql`
        select e.resolution_state as state, e.parked_park_id as parked
          from episodes e
         where e.episode_id = ${episodeId}
           for update of e
      `)) as unknown as { state: string; parked: string | null }[];
      if (row === undefined) return undefined;
      const [prior] = await tx
        .select()
        .from(schema.episodeParks)
        .where(eq(schema.episodeParks.id, body.data.id));
      if (prior !== undefined) {
        /**
         * A release is identified by the episode and the reason, never by the
         * park it lifted: on the replay the pointer is already null, so
         * comparing against it would refuse the retry of the request that
         * succeeded. What the id must not do is name a different decision.
         */
        const same =
          prior.episodeId === episodeId &&
          prior.releasesParkId !== null &&
          prior.reason === body.data.reason;
        if (same) replayed = prior;
        else refusal = 'episode_park_id_reused';
        return undefined;
      }
      if (row.parked === null) {
        refusal = 'episode_parks_not_parked';
        return undefined;
      }

      const [release] = await tx
        .insert(schema.episodeParks)
        .values({
          id: body.data.id,
          episodeId,
          releasesParkId: row.parked,
          fromState: row.state,
          parkedBy: actor.operator.operatorId,
          reason: body.data.reason,
        })
        .onConflictDoNothing({ target: schema.episodeParks.id })
        .returning({ id: schema.episodeParks.id });
      if (release === undefined) {
        refusal = 'episode_park_id_reused';
        return undefined;
      }
      await tx
        .update(schema.episodes)
        .set({ parkedParkId: null })
        .where(eq(schema.episodes.episodeId, episodeId));
      event.before = { resolution_state: row.state, parked_park_id: row.parked };
      event.after = { parked_park_id: null, release_id: release.id };
      return release;
    });
    if (written === undefined && replayed === undefined) {
      return reply.code(409).send({ error: 'refused', constraint: refusal ?? 'episode_parks_not_parked' });
    }
    return reply.send({
      episode_id: episodeId,
      release_id: (written ?? replayed)!.id,
      parked: false,
      replayed: written === undefined,
    });
  });

  /**
   * Every episode at this centre that is out of the review queue on purpose,
   * and what takes it back out.
   *
   * WHY THIS ROUTE EXISTS. Two branches built an exit for a stuck episode and
   * neither built a way to find one. `fix/console-defects` added the `held`
   * lane on `episode_reviews`; `feat/quarantine-exit` added `episode_parks`
   * and `episodes.parked_park_id`. Both work, and after either one the episode
   * simply stops appearing anywhere — no list, no screen, and `?queue=held` is
   * a 400. The loop the two changes removed was replaced by a silent hole: the
   * collector is still not paid, and now nobody trips over it. Releasing an
   * episode needs its id, and nothing gave an operator an id.
   *
   * The two mechanisms are complementary, not duplicates, and this route is
   * where that is visible:
   *
   *   `held`  — a review row a reviewer already holds, refused at verdict time.
   *             It needs a review row to exist, so it cannot touch an episode
   *             nobody has claimed. Out through `POST /api/review/hold/:id`
   *             naming a claimable lane; only an operator may do that.
   *   `park`  — the episode itself, whether or not anybody ever claimed it.
   *             This is the only exit for an ingest quarantine, because the
   *             queue is lazy and there is no review row to hold. Out through
   *             `POST /episodes/:id/unpark`.
   *
   * An episode can be both — parked after a reviewer had already held it — and
   * then it appears once, with both holds named, so an operator lifting one
   * can see the other is still there. That is the whole reason this is one
   * list and not two.
   *
   * Centre-scoped like the rest of this file (SEC-02): an operator sees what
   * arrived at their own centre. Read-only, so no `mutate`.
   *
   * ponytail: no paging. A stuck episode is a thing a person fixes one at a
   * time, and a centre with enough of them to need a page has a different
   * problem. Add `limit`/`offset` when a real centre's list does not fit.
   */
  app.get('/episodes/stuck', opts, async (req, reply) => {
    const actor = actorOf(req);
    const rows = (await db.execute(sql`
      select e.episode_id,
             e.device_serial,
             e.session_started_at,
             e.resolution_state,
             p.id            as park_id,
             p.reason        as park_reason,
             p.parked_at     as parked_at,
             po.external_ref as parked_by,
             r.id            as review_id,
             r.updated_at    as held_at
        from episodes e
        join upload_batches b on b.id = e.upload_batch_id
        join handovers h on h.id = b.handover_id
        left join episode_parks p on p.id = e.parked_park_id
        left join operators po on po.id = p.parked_by
        left join episode_reviews r
               on r.episode_id = e.episode_id
              and r.review_state = 'pending'
              and r.queue = 'held'
       where h.upload_centre_id = ${actor.operator.uploadCentreId}
         and (e.parked_park_id is not null or r.id is not null)
       order by coalesce(p.parked_at, r.updated_at) desc
    `)) as unknown as {
      episode_id: string;
      device_serial: string;
      session_started_at: string;
      resolution_state: string;
      park_id: string | null;
      park_reason: string | null;
      parked_at: Date | null;
      parked_by: string | null;
      review_id: string | null;
      held_at: Date | null;
    }[];

    return reply.send({
      episodes: rows.map((r) => ({
        episode_id: r.episode_id,
        /** What a person recognises: the card and the recording on it. */
        device_serial: r.device_serial,
        session_started_at: r.session_started_at,
        resolution_state: r.resolution_state,
        /** Null when this episode is only held, not parked. */
        park:
          r.park_id === null
            ? null
            : {
                park_id: r.park_id,
                reason: r.park_reason,
                parked_at: new Date(r.parked_at!).toISOString(),
                parked_by: r.parked_by,
                /** The one route that lifts it. */
                release_with: `POST /episodes/${r.episode_id}/unpark`,
              },
        /**
         * Null when nobody had claimed this episode. The reason a reviewer
         * typed is on the audit row, not here — `mutate` wrote it under
         * `review.hold` and there is no audit read route yet.
         */
        held:
          r.review_id === null
            ? null
            : {
                review_id: r.review_id,
                held_at: new Date(r.held_at!).toISOString(),
                release_with: `POST /api/review/hold/${r.episode_id}`,
              },
      })),
    });
  });

  /** The status view: batches on this machine, newest first. */
  app.get('/upload-batches', opts, async (req, reply) => {
    const actor = actorOf(req);
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
