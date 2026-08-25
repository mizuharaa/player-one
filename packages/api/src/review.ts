import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EpisodeRecord } from '@playerone/contracts';
import { schema, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { Actor } from './actor.ts';
import {
  REVIEW_STATE,
  SpanError,
  normaliseSpans,
  settlementFor,
  usefulSeconds,
  type Decision,
  type NormalisedSpan,
} from './money.ts';

/**
 * The review lane: the only place in the system that produces the number a
 * collector is paid on.
 *
 * Everything upstream measures. The ingest engine says how many seconds of
 * footage exist, the resolver says whose they are, and neither decides whether
 * any of it is worth anything. That decision is made here, by a person, and
 * `useful minutes × unit price` is the payment — so every route in this file is
 * on the money path and is written that way.
 *
 * Three properties hold it together, and each is enforced somewhere that an
 * endpoint author cannot skip:
 *
 *   - **The server computes money.** The client sends marked spans and never a
 *     duration or an amount. `money.ts` turns spans into seconds and seconds
 *     into a bill; nothing here trusts a number the browser calculated.
 *   - **A verdict is idempotent on the client's own id.** A double-tap or a
 *     retry after a timeout returns the first answer rather than writing a
 *     second review — and, through `settlements_review_key`, a second payment.
 *     The guarantee is `episode_reviews_verdict_key`, a unique index, not a
 *     check in application code.
 *   - **A verdict and its audit row commit together**, because the write goes
 *     through `mutate` like every other mutation in this service.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

/**
 * How long a claim stays exclusive. Long enough to watch a two-minute episode
 * without being interrupted, short enough that a reviewer who closes the tab
 * does not strand the episode until somebody notices.
 *
 * A client extends it by heartbeat while the tab is open, so the timeout only
 * ever bites on a reviewer who has actually gone away.
 */
export const LEASE_MS = 10 * 60 * 1000;

/** Bounded, because the only way to lose the race twice is for the queue to be busy. */
const CLAIM_ATTEMPTS = 3;

export type ReviewOptions = {
  /**
   * The directory holding the imported `ego_*` session folders. Media is served
   * from here and from nowhere else.
   *
   * Optional: with no media root the metadata routes still work and the stream
   * route answers 503 with the reason, which is what a machine that has not
   * been configured yet should say rather than a 404 that reads like missing
   * footage.
   */
  mediaRoot?: string;
  /**
   * What `tasks.unit_price` is denominated in.
   *
   * This is configuration and not a column because there is no currency column
   * on `tasks` — the schema cannot currently say what a task pays in, which is
   * a real gap on the money path and needs a decision, not a default chosen
   * here. Until then one currency per deployment is honest and visible.
   */
  currency?: string;
  /**
   * Which integrity check QR-02's gate reads: 'local' (the ingest engine's own
   * check, the ADR 0001 deviation) or 'cloud' (`verification_state =
   * 'verified'`, written by the upload leg's read-back). Defaults to 'local'
   * because no GreenNode endpoint exists until the contract is signed —
   * flipping to 'cloud' is what retires ADR 0001. Under either setting an
   * episode whose cloud copy FAILED read-back is blocked: a known-bad copy is
   * information, whichever gate is in force.
   */
  verificationGate?: 'local' | 'cloud';
};

const VerdictBody = z.object({
  verdict_id: z.string().uuid(),
  episode_id: z.string().uuid(),
  decision: z.enum(['good', 'partial', 'bad']),
  spans: z
    .array(z.object({ start_seconds: z.number(), end_seconds: z.number() }))
    .max(500)
    .default([]),
  reject_reasons: z.array(z.string().min(1)).max(20).default([]),
  reviewer_note: z.string().max(2000).nullish(),
  /** Instrumentation. Never money — see `episode_reviews.time_to_verdict_s`. */
  time_to_verdict_seconds: z.number().nonnegative().finite().nullish(),
});

export function registerReview(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: ReviewOptions = {},
): void {
  const opts = { preHandler: requireActor };
  const currency = options.currency ?? 'VND';

  /**
   * Who is reviewing.
   *
   * The operator id from the existing both-token session, and deliberately not
   * a new identity. Reviewer accounts, roles and PaXini-side login are the
   * roles slice; inventing half of them here would leave two auth models to
   * reconcile later. The consequence is visible and worth stating: today a
   * reviewer signs in with an upload-centre operator credential.
   */
  const reviewerOf = (actor: Actor): string => actor.operator.operatorId;

  // -------------------------------------------------------------------------
  // The queue

  /**
   * An episode is reviewable when it has an owner, its bytes arrived intact,
   * and nothing about it blocks review.
   *
   * The integrity half of that depends on `verificationGate`. 'local' reads
   * **the check the ingest engine already ran** — the ADR 0001 deviation,
   * still the default while no cloud endpoint exists — plus one addition the
   * cloud leg made possible: an episode whose cloud copy failed read-back
   * (`verification_state = 'failed'`) is blocked even under the local gate,
   * because a copy known to be bad is not a pending one. 'cloud' is QR-02 as
   * written: only `verification_state = 'verified'` enters review, and setting
   * it is what retires ADR 0001. The adjacent rule is not deviable under
   * either gate and nothing in this file bends it: no TF card is cleared, and
   * no route here deletes source media.
   *
   * `resolution_state = 'resolved'` is the other half and is not negotiable —
   * an episode with no session has no collector and no task, so there is
   * nobody to pay and no price to pay them at. Those stay in the counter's
   * quarantine queue until a human attaches them.
   */
  const cloudGate = (options.verificationGate ?? 'local') === 'cloud';
  const eligible = sql`
    ${schema.episodes.resolutionState} = 'resolved'
    and ${schema.episodeIngests.state} <> 'quarantined'
    and ${schema.episodeIngests.measuredDurationS} > 0
    and ${
      cloudGate
        ? sql`${schema.episodes.verificationState} = 'verified'`
        : sql`${schema.episodes.verificationState} <> 'failed'`
    }
    and not exists (
      select 1
        from episode_defects d
        join defect_codes c on c.code = d.code
       where d.ingest_id = ${schema.episodeIngests.ingestId}
         and c.blocks_review
    )
  `;

  /**
   * The same eligibility question asked about a review row that already exists.
   *
   * Materialisation is not the last moment eligibility matters: the cloud leg's
   * read-back can find a corrupt copy, and a redelivery can move the episode
   * onto an ingest this review does not name, both AFTER a pending row was
   * created. So takeover asks it, the queue depth asks it, and the verdict
   * transaction asks it. `episode_ingests.ingest_id = <ingest>` joined against
   * `latest_ingest_id` is what pins it to the exact delivery under review.
   */
  const stillEligible = (episodeId: SQL | string, ingestId: SQL | string) => sql`
    exists (
      select 1
        from episodes
        join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
       where episodes.episode_id = ${episodeId}
         and episode_ingests.ingest_id = ${ingestId}
         and ${eligible}
    )`;

  /**
   * Claims the next episode for this reviewer, in two statements and at most
   * `CLAIM_ATTEMPTS` tries.
   *
   * The first statement takes over a review row that already exists and is
   * free — never claimed, or claimed by somebody whose lease has run out.
   * `for update skip locked` is what makes two reviewers pressing the button at
   * the same instant land on different rows instead of one of them waiting:
   * the second transaction steps over the row the first has locked rather than
   * blocking on it. Reclaiming an expired lease is the same predicate and so
   * happens on every read, with no sweeper process to forget to run.
   *
   * The second statement materialises a row for an episode nobody has looked at
   * yet. The queue is therefore lazy — there is no enqueue step at submission
   * time that a later code path could forget, and no backfill to run for the
   * episodes that already exist. Two reviewers racing for the same never-seen
   * episode is the one case both statements can miss, and
   * `episode_reviews_delivery_key` decides it: the loser's insert does nothing
   * and it tries again.
   */
  async function claimNext(reviewer: string): Promise<{ reviewId: string; episodeId: string } | null> {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      const takeover = (await db.execute(sql`
        update episode_reviews
           set reviewer_ref = ${reviewer},
               claimed_at = now(),
               lease_expires_at = now() + ${`${LEASE_MS} milliseconds`}::interval,
               updated_at = now()
         where id = (
           select r.id
             from episode_reviews r
            where r.review_state = 'pending'
              and (r.reviewer_ref is null or r.lease_expires_at < now())
              and ${stillEligible(sql`r.episode_id`, sql`r.ingest_id`)}
            order by r.created_at
              for update skip locked
            limit 1
         )
        returning id, episode_id
      `)) as unknown as { id: string; episode_id: string }[];
      const resumed = takeover[0];
      if (resumed !== undefined) return { reviewId: resumed.id, episodeId: resumed.episode_id };

      const created = (await db.execute(sql`
        insert into episode_reviews
          (id, episode_id, ingest_id, measured_duration_s, review_state,
           reviewer_ref, claimed_at, lease_expires_at)
        select ${randomUUID()}, episodes.episode_id, episode_ingests.ingest_id, episode_ingests.measured_duration_s, 'pending',
               ${reviewer}, now(), now() + ${`${LEASE_MS} milliseconds`}::interval
          from episodes
          join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
         where ${eligible}
           and not exists (
             select 1 from episode_reviews r
              where r.episode_id = episodes.episode_id and r.ingest_id = episode_ingests.ingest_id
           )
         order by episodes.first_seen_at
         limit 1
        on conflict (episode_id, ingest_id) do nothing
        returning id, episode_id
      `)) as unknown as { id: string; episode_id: string }[];
      const fresh = created[0];
      if (fresh !== undefined) return { reviewId: fresh.id, episodeId: fresh.episode_id };

      // Nothing to take over and nothing new. Either the queue is genuinely
      // empty or another reviewer won the insert; one more pass tells them
      // apart, because a lost race leaves a pending row the takeover will find.
      const remaining = (await db.execute(sql`
        select 1 as n
          from episodes
          join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
         where ${eligible}
           and not exists (
             select 1 from episode_reviews r
              where r.episode_id = episodes.episode_id and r.ingest_id = episode_ingests.ingest_id
           )
         limit 1
      `)) as unknown as { n: number }[];
      if (remaining.length === 0) return null;
    }
    return null;
  }

  /**
   * How much work is waiting for somebody.
   *
   * Pending rows that another reviewer currently holds are excluded, including
   * the one the caller has just claimed. A depth that counts episodes nobody
   * can pick up is a number that never reaches zero and stops being read.
   */
  async function queueDepth(): Promise<number> {
    const rows = (await db.execute(sql`
      select
        (select count(*) from episode_reviews pr
          where pr.review_state = 'pending'
            and (pr.reviewer_ref is null or pr.lease_expires_at < now())
            -- Same re-check as the takeover: a pending row whose episode has
            -- since failed cloud verification is not claimable, so it is not depth.
            and ${stillEligible(sql`pr.episode_id`, sql`pr.ingest_id`)})
      + (select count(*)
           from episodes
           join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
          where ${eligible}
            and not exists (
              select 1 from episode_reviews r
               where r.episode_id = episodes.episode_id and r.ingest_id = episode_ingests.ingest_id
            )) as depth
    `)) as unknown as { depth: string }[];
    return Number(rows[0]?.depth ?? 0);
  }

  /**
   * This reviewer's own pace, over their last fifty verdicts.
   *
   * Displayed and never acted on. Reviewer throughput is the programme's
   * capacity ceiling at 40,000 hours, and the point of showing it before
   * anything is optimised is to have a number that predates the optimising.
   */
  async function sessionAverage(reviewer: string): Promise<number | null> {
    const rows = (await db.execute(sql`
      select avg(t)::float8 as avg from (
        select time_to_verdict_s as t
          from episode_reviews
         where reviewer_ref = ${reviewer}
           and review_state <> 'pending'
           and time_to_verdict_s is not null
         order by reviewed_at desc
         limit 50
      ) recent
    `)) as unknown as { avg: number | null }[];
    return rows[0]?.avg ?? null;
  }

  // -------------------------------------------------------------------------
  // The payload

  /**
   * Everything the screen needs about one episode, assembled from the store
   * rather than from the card.
   *
   * Both durations travel, and both are labelled. `measured_duration_seconds`
   * is the engine's own reading and is what a verdict is scored against;
   * `claimed_duration_seconds` is what the device's manifest asserted, which
   * UPL-08 makes advisory and which overstates media by about a third. Showing
   * the gap is deliberate — it is the reviewer's only window onto whether a
   * particular device is lying, and hiding it would make a fleet-wide fault
   * invisible until settlement.
   */
  async function payload(episodeId: string): Promise<Record<string, unknown> | null> {
    const [row] = await db
      .select({
        episodeId: schema.episodes.episodeId,
        deviceSerial: schema.episodes.deviceSerial,
        sessionStartedAt: schema.episodes.sessionStartedAt,
        resolutionState: schema.episodes.resolutionState,
        resolutionMethod: schema.episodes.resolutionMethod,
        resolutionConfirmedAt: schema.episodes.resolutionConfirmedAt,
        ingestId: schema.episodeIngests.ingestId,
        sourceBasename: schema.episodeIngests.sourceBasename,
        measuredDurationS: schema.episodeIngests.measuredDurationS,
        declaredDurationS: schema.episodeIngests.declaredDurationS,
        timingSource: schema.episodeIngests.timingSource,
        timingConfidence: schema.episodeIngests.timingConfidence,
        firmware: schema.episodeIngests.deviceFirmware,
        recordJson: schema.episodeIngests.recordJson,
        collectionSessionId: schema.episodes.collectionSessionId,
      })
      .from(schema.episodes)
      .innerJoin(
        schema.episodeIngests,
        eq(schema.episodeIngests.ingestId, schema.episodes.latestIngestId),
      )
      .where(eq(schema.episodes.episodeId, episodeId));
    if (row === undefined) return null;

    const [session] = row.collectionSessionId
      ? await db
          .select({
            sessionId: schema.collectionSessions.id,
            othersInFrame: schema.collectionSessions.othersInFrame,
            sensitiveInfoPresent: schema.collectionSessions.sensitiveInfoPresent,
            sessionOrigin: schema.collectionSessions.sessionOrigin,
            taskId: schema.tasks.id,
            taskName: schema.tasks.name,
            unitPrice: schema.tasks.unitPrice,
            collectorId: schema.collectors.id,
            collectorRef: schema.collectors.externalRef,
            scenarioCode: schema.scenarios.code,
            /** Feeds the CO-PRIVACY judgment, so it belongs on screen. */
            privacyRiskLevel: schema.scenarios.privacyRiskLevel,
          })
          .from(schema.collectionSessions)
          .innerJoin(schema.tasks, eq(schema.tasks.id, schema.collectionSessions.taskId))
          .innerJoin(schema.collectors, eq(schema.collectors.id, schema.collectionSessions.collectorId))
          .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.collectionSessions.scenarioId))
          .where(eq(schema.collectionSessions.id, row.collectionSessionId))
      : [];

    const flags = await db
      .select({
        code: schema.episodeDefects.code,
        severity: schema.episodeDefects.severity,
        payload: schema.episodeDefects.payload,
        blocksReview: schema.defectCodes.blocksReview,
        suppressesSettlement: schema.defectCodes.suppressesSettlement,
        description: schema.defectCodes.description,
      })
      .from(schema.episodeDefects)
      .leftJoin(schema.defectCodes, eq(schema.defectCodes.code, schema.episodeDefects.code))
      .where(eq(schema.episodeDefects.ingestId, row.ingestId))
      .orderBy(schema.episodeDefects.id);

    /**
     * How this episode got its owner, taken from the audit trail rather than
     * recomputed. The resolver already wrote every candidate it considered, the
     * config it decided under and which clock the start came from; a reviewer
     * looking at footage that seems to belong to a different task needs to see
     * that, and re-deriving it here could disagree with what was recorded.
     */
    const [decision] = await db
      .select({ action: schema.auditEvents.action, after: schema.auditEvents.after })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.targetTable, 'episodes'),
          eq(schema.auditEvents.targetId, episodeId),
          inArray(schema.auditEvents.action, [
            'episode.submit',
            'episode.resolve_manual',
            'episode.resolve_confirm',
          ]),
        ),
      )
      .orderBy(desc(schema.auditEvents.occurredAt))
      .limit(1);

    const record = EpisodeRecord.safeParse(row.recordJson);
    const streams = record.success ? record.data.streams : [];
    const video =
      streams.find((s) => s.role === 'camera_left') ?? streams.find((s) => s.role === 'camera_right');
    const startUs = record.success ? record.data.timing.usable_start_us : null;
    const after = (decision?.after ?? {}) as Record<string, unknown>;

    return {
      episode_id: row.episodeId,
      /** The name on the card. What an operator matches against a physical label. */
      session_folder: row.sourceBasename,
      ingest_id: row.ingestId,
      task:
        session === undefined
          ? null
          : {
              id: session.taskId,
              name: session.taskName,
              price_per_minute: session.unitPrice,
              currency,
            },
      collector:
        session === undefined
          ? null
          : { id: session.collectorId, display_name: session.collectorRef },
      scenario:
        session === undefined
          ? null
          : { code: session.scenarioCode, privacy_risk_level: session.privacyRiskLevel },
      /** APP-17b, and the reason QR-07 routing exists. A reviewer should know before watching. */
      declared: session
        ? {
            others_in_frame: session.othersInFrame,
            sensitive_info_present: session.sensitiveInfoPresent,
            session_origin: session.sessionOrigin,
          }
        : null,
      device: { serial: row.deviceSerial, firmware: row.firmware },
      /** Decimal strings, not numbers. The client displays them; the server scores them. */
      measured_duration_seconds: row.measuredDurationS,
      claimed_duration_seconds: row.declaredDurationS,
      timing: { source: row.timingSource, confidence: row.timingConfidence },
      frame_rate: video?.nominal_rate_hz ?? null,
      /**
       * An absolute instant, taken from the PTS epoch and never from the folder
       * name. `20260813_072310` carries no timezone and neither does the
       * manifest's `start_time`, so parsing either would give a different moment
       * on a machine in Hanoi than on one in UTC. D4 would settle it and has not
       * arrived; until then the only honest source is the one the engine already
       * anchors payments on.
       */
      recorded_at: startUs === null ? null : new Date(Number(BigInt(startUs) / 1000n)).toISOString(),
      flags: flags.map((f) => ({
        code: f.code,
        severity: f.severity,
        detail: (f.payload as { detail?: string } | null)?.detail ?? f.description ?? null,
        blocks_review: f.blocksReview ?? false,
        suppresses_settlement: f.suppressesSettlement ?? false,
      })),
      resolver_note: {
        state: row.resolutionState,
        method: row.resolutionMethod,
        confirmed: row.resolutionConfirmedAt !== null,
        reason: after['reason'] ?? null,
        start_source: after['start_source'] ?? null,
        start_confidence: after['start_confidence'] ?? null,
        candidate_count: after['candidate_count'] ?? null,
      },
      media: {
        role: video?.role ?? null,
        parts: (video?.parts ?? []).map((p, index) => ({
          index,
          url: `/media/episode/${row.episodeId}/part/${index}`,
          bytes: p.bytes,
          file: p.file,
        })),
      },
    };
  }

  const withLease = async (
    episodeId: string,
  ): Promise<{ reviewId: string; leaseExpiresAt: Date | null } | null> => {
    const [r] = await db
      .select({ id: schema.episodeReviews.id, leaseExpiresAt: schema.episodeReviews.leaseExpiresAt })
      .from(schema.episodeReviews)
      .where(
        and(
          eq(schema.episodeReviews.episodeId, episodeId),
          eq(schema.episodeReviews.reviewState, 'pending'),
        ),
      );
    return r === undefined ? null : { reviewId: r.id, leaseExpiresAt: r.leaseExpiresAt };
  };

  // -------------------------------------------------------------------------
  // Routes

  /** Claims and returns the next episode. 204 when there is nothing to review. */
  app.post('/api/review/claim', opts, async (req, reply) => {
    const reviewer = reviewerOf(req.actor!);
    const claim = await claimNext(reviewer);
    if (claim === null) {
      return reply.code(204).send();
    }
    const body = await payload(claim.episodeId);
    if (body === null) return reply.code(500).send({ error: 'claimed an episode that has no ingest' });
    const lease = await withLease(claim.episodeId);
    return reply.send({
      ...body,
      review_id: claim.reviewId,
      lease_expires_at: lease?.leaseExpiresAt?.toISOString() ?? null,
      queue_depth: await queueDepth(),
      session_average_seconds: await sessionAverage(reviewer),
    });
  });

  /**
   * Metadata for one episode, without claiming it. This is what the client
   * prefetches: knowing the next episode's media urls is what lets it warm a
   * hidden video element while the current one is still being watched.
   */
  app.get('/api/review/episode/:id', opts, async (req, reply) => {
    const episodeId = (req.params as { id: string }).id;
    const body = await payload(episodeId);
    if (body === null) return reply.code(404).send({ error: 'no such episode' });
    return reply.send(body);
  });

  /**
   * A peek at what would be claimed next, so the client can prefetch it without
   * taking it off somebody else's queue. Returns 204 when nothing is waiting.
   */
  app.get('/api/review/next', opts, async (req, reply) => {
    const rows = (await db.execute(sql`
      select episodes.episode_id
        from episodes
        join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
        left join episode_reviews r
          on r.episode_id = episodes.episode_id and r.ingest_id = episode_ingests.ingest_id
       where ${eligible}
         and (r.id is null
              or (r.review_state = 'pending'
                  and (r.reviewer_ref is null or r.lease_expires_at < now())))
       order by episodes.first_seen_at
       limit 1
    `)) as unknown as { episode_id: string }[];
    const next = rows[0];
    if (next === undefined) return reply.code(204).send();
    const body = await payload(next.episode_id);
    if (body === null) return reply.code(204).send();
    return reply.send(body);
  });

  /** Extends a lease while the tab is open. A reviewer who leaves stops sending these. */
  app.post('/api/review/heartbeat/:id', opts, async (req, reply) => {
    const reviewer = reviewerOf(req.actor!);
    const episodeId = (req.params as { id: string }).id;
    const rows = (await db.execute(sql`
      update episode_reviews
         set lease_expires_at = now() + ${`${LEASE_MS} milliseconds`}::interval,
             updated_at = now()
       where episode_id = ${episodeId}
         and review_state = 'pending'
         and reviewer_ref = ${reviewer}
         and lease_expires_at >= now()
      returning lease_expires_at
    `)) as unknown as { lease_expires_at: Date }[];
    const extended = rows[0];
    if (extended === undefined) {
      // Not an error the client can fix by retrying: the lease is gone and the
      // episode may already belong to somebody else.
      return reply.code(409).send({ error: 'lease expired or not yours' });
    }
    return reply.send({ lease_expires_at: new Date(extended.lease_expires_at).toISOString() });
  });

  /**
   * Gives an episode back without deciding it. Called on page unload, so it has
   * to work from `sendBeacon` — which sends no custom headers and therefore
   * relies on the session cookie the console signs in with.
   */
  app.post('/api/review/release/:id', opts, async (req, reply) => {
    const reviewer = reviewerOf(req.actor!);
    const episodeId = (req.params as { id: string }).id;
    const rows = (await db.execute(sql`
      update episode_reviews
         set reviewer_ref = null, claimed_at = null, lease_expires_at = null, updated_at = now()
       where episode_id = ${episodeId}
         and review_state = 'pending'
         and reviewer_ref = ${reviewer}
      returning id
    `)) as unknown as { id: string }[];
    // Releasing something already gone is not a failure worth reporting to a
    // page that is in the middle of closing.
    return reply.send({ released: rows.length > 0 });
  });

  /**
   * The verdict. Everything else in this file exists to get here safely.
   */
  app.post('/api/review/verdict', opts, async (req, reply) => {
    const parsed = VerdictBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', detail: parsed.error.issues.slice(0, 5) });
    }
    const body = parsed.data;
    const actor = req.actor!;
    const reviewer = reviewerOf(actor);

    /**
     * The replay check, first and outside any transaction. A retry after a
     * timeout is the common case, not the exceptional one — the original write
     * usually succeeded and only the response was lost — so it is answered
     * before anything is locked.
     */
    const replayed = await resultOf(db, body.verdict_id);
    if (replayed !== null) return reply.send({ ...replayed, replayed: true });

    const [review] = await db
      .select()
      .from(schema.episodeReviews)
      .where(eq(schema.episodeReviews.episodeId, body.episode_id));
    if (review === undefined) {
      return reply.code(404).send({ error: 'this episode has not been claimed for review' });
    }
    if (review.reviewState !== 'pending') {
      return reply.code(409).send({ error: 'this episode has already been reviewed' });
    }
    if (review.reviewerRef !== reviewer) {
      return reply.code(409).send({ error: 'reassigned', detail: 'this episode is claimed by someone else' });
    }
    if (review.leaseExpiresAt === null || review.leaseExpiresAt.getTime() < Date.now()) {
      return reply.code(409).send({ error: 'reassigned', detail: 'the lease on this episode expired' });
    }

    /**
     * Shape rules, refused rather than tolerated.
     *
     * Ignoring spans on a good verdict, or reasons on one, would let a client
     * bug run for a whole pilot without a symptom: the payment would look
     * ordinary and the marks the reviewer thought they made would be nowhere.
     * A 422 the first time it happens costs one confused reviewer and finds the
     * bug the same afternoon.
     */
    if (body.decision !== 'partial' && body.spans.length > 0) {
      return reply.code(422).send({ error: `a ${body.decision} verdict cannot carry spans` });
    }
    if (body.decision === 'good' && body.reject_reasons.length > 0) {
      return reply.code(422).send({ error: 'a good verdict cannot carry reject reasons' });
    }
    /** QR-01, and QR-04: a collector who is paid nothing has to be told why. */
    if (body.decision === 'bad' && body.reject_reasons.length === 0) {
      return reply.code(422).send({ error: 'a bad verdict must name at least one reason' });
    }

    let spans: NormalisedSpan[];
    try {
      spans = body.decision === 'partial' ? normaliseSpans(body.spans, review.measuredDurationS) : [];
    } catch (err) {
      if (err instanceof SpanError) return reply.code(422).send({ error: err.message });
      throw err;
    }
    if (body.decision === 'partial' && spans.length === 0) {
      return reply.code(422).send({ error: 'a partial verdict must mark at least one usable span' });
    }

    if (body.reject_reasons.length > 0) {
      const known = await db
        .select({ code: schema.reviewReasonCodes.code })
        .from(schema.reviewReasonCodes)
        .where(
          and(
            inArray(schema.reviewReasonCodes.code, body.reject_reasons),
            eq(schema.reviewReasonCodes.active, true),
          ),
        );
      const missing = body.reject_reasons.filter((c) => !known.some((k) => k.code === c));
      if (missing.length > 0) {
        // The enumeration is the server's. A free-form code would be unusable
        // to the collector who has to act on it, and LOC-04 requires it
        // localised, which only a catalogue row can be.
        return reply.code(422).send({ error: 'unknown reject reason', detail: missing });
      }
    }

    const decision: Decision = body.decision;
    const effectiveSeconds = usefulSeconds(decision, spans, review.measuredDurationS);

    const [ownership] = await db
      .select({ taskId: schema.tasks.id, unitPrice: schema.tasks.unitPrice })
      .from(schema.episodes)
      .innerJoin(
        schema.collectionSessions,
        eq(schema.collectionSessions.id, schema.episodes.collectionSessionId),
      )
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.collectionSessions.taskId))
      .where(eq(schema.episodes.episodeId, body.episode_id));
    if (ownership === undefined) {
      // The eligibility filter should have kept this out of the queue. If it is
      // here anyway, refusing is the only safe answer: a verdict with no task
      // has no price, and guessing one is exactly the class of mistake the
      // resolver refuses to make.
      return reply.code(409).send({ error: 'this episode has no task to be paid against' });
    }
    const bill = settlementFor(ownership.unitPrice, effectiveSeconds);

    const decidedAt = new Date();
    const elapsedSeconds =
      body.time_to_verdict_seconds ??
      (review.claimedAt === null
        ? null
        : (decidedAt.getTime() - review.claimedAt.getTime()) / 1000);

    let written: { id: string } | undefined;
    try {
      written = await mutate(
        db,
        actor,
        {
          action: 'episode.review',
          targetTable: 'episode_reviews',
          targetId: review.id,
          before: { review_state: 'pending', reviewer_ref: review.reviewerRef },
          after: {
            verdict_id: body.verdict_id,
            episode_id: body.episode_id,
            ingest_id: review.ingestId,
            decision,
            review_state: REVIEW_STATE[decision],
            measured_duration_s: review.measuredDurationS,
            effective_duration_s: effectiveSeconds,
            spans,
            reject_reasons: body.reject_reasons,
            unit_price: ownership.unitPrice,
            currency,
            effective_minutes: bill.effectiveMinutes,
            amount: bill.amount,
          },
        },
        async (tx) => {
          /**
           * `review_state = 'pending'` in the WHERE is not belt and braces. It
           * is what makes the transaction the arbiter rather than the check
           * twenty lines above: another request may have decided this review
           * between that read and this write, and then this update matches
           * nothing and the whole transaction — audit row included — does not
           * happen.
           */
          const [row] = await tx
            .update(schema.episodeReviews)
            .set({
              reviewState: REVIEW_STATE[decision],
              effectiveDurationS: effectiveSeconds,
              verdictId: body.verdict_id,
              reviewerNote: body.reviewer_note ?? null,
              reviewedAt: decidedAt,
              timeToVerdictS: elapsedSeconds === null ? null : elapsedSeconds.toFixed(3),
              updatedAt: decidedAt,
            })
            .where(
              and(
                eq(schema.episodeReviews.id, review.id),
                eq(schema.episodeReviews.reviewState, 'pending'),
                /**
                 * And the episode is still reviewable NOW. A lease lasts
                 * minutes and the cloud leg runs in that window: read-back can
                 * turn the copy 'failed', or a redelivery can move the episode
                 * onto an ingest this review does not name. Either way the
                 * bytes the reviewer judged are not the bytes on record, and a
                 * settlement written here would pay for footage QR-02 says
                 * never entered review.
                 */
                stillEligible(body.episode_id, review.ingestId),
              ),
            )
            .returning({ id: schema.episodeReviews.id });
          if (row === undefined) return undefined;

          if (spans.length > 0) {
            await tx.insert(schema.episodeReviewSpans).values(
              spans.map((s, ordinal) => ({
                reviewId: review.id,
                ordinal,
                startS: s.startS,
                endS: s.endS,
              })),
            );
          }
          if (body.reject_reasons.length > 0) {
            await tx
              .insert(schema.episodeReviewReasons)
              .values(body.reject_reasons.map((code) => ({ reviewId: review.id, code })));
          }
          /**
           * SET-02. The settlement points at the review and at nothing else —
           * no episode id, no ingest id, no batch — so the only route from a
           * payment back to footage runs through a verdict. That is a shape in
           * the schema, not a rule anybody has to remember, and it is why an
           * upload event has nothing it could write against.
           */
          await tx.insert(schema.settlements).values({
            id: randomUUID(),
            episodeReviewId: review.id,
            taskId: ownership.taskId,
            unitPrice: ownership.unitPrice,
            effectiveMinutes: bill.effectiveMinutes,
            amount: bill.amount,
            settlementState: 'pending_settlement',
          });
          return row;
        },
      );
    } catch (err) {
      /**
       * Two requests carrying the same `verdict_id` reached the transaction
       * together. One committed; this one lost on the unique index. The correct
       * answer is the winner's, not an error — from the reviewer's side the
       * verdict was recorded exactly once, which is what was promised.
       */
      if (isUniqueViolation(err, 'episode_reviews_verdict_key')) {
        const settled = await resultOf(db, body.verdict_id);
        if (settled !== null) return reply.send({ ...settled, replayed: true });
      }
      throw err;
    }

    if (written === undefined) {
      /**
       * The update matched nothing, so something decided this review between
       * the read above and the write. If that something carried the *same*
       * verdict id — two copies of one request racing, which is the ordinary
       * double-tap — then from the reviewer's side the verdict was recorded
       * exactly once and the honest answer is the one that won. Only a
       * different verdict id means the episode really was reassigned.
       */
      const raced = await resultOf(db, body.verdict_id);
      if (raced !== null) return reply.send({ ...raced, replayed: true });
      /**
       * Still pending means nobody decided it — the eligibility clause is what
       * refused. Saying "decided elsewhere" there would send the reviewer
       * looking for a colleague who does not exist.
       */
      const [current] = await db
        .select({ state: schema.episodeReviews.reviewState })
        .from(schema.episodeReviews)
        .where(eq(schema.episodeReviews.id, review.id));
      if (current?.state === 'pending') {
        return reply.code(409).send({
          error: 'not reviewable',
          detail: 'this episode stopped being reviewable while it was open; nothing was recorded',
        });
      }
      return reply.code(409).send({ error: 'reassigned', detail: 'this review was decided elsewhere' });
    }

    return reply.send({
      review_id: review.id,
      episode_id: body.episode_id,
      verdict_id: body.verdict_id,
      decision,
      review_state: REVIEW_STATE[decision],
      measured_duration_seconds: review.measuredDurationS,
      /** The authoritative figure. Whatever the client displayed was an estimate. */
      effective_duration_seconds: effectiveSeconds,
      spans,
      unit_price: ownership.unitPrice,
      currency,
      effective_minutes: bill.effectiveMinutes,
      amount: bill.amount,
      replayed: false,
      queue_depth: await queueDepth(),
      session_average_seconds: await sessionAverage(reviewer),
    });
  });

  /** What one reviewer has decided recently. The screen's own history strip. */
  app.get('/api/review/recent', opts, async (req, reply) => {
    const reviewer = reviewerOf(req.actor!);
    const rows = await db
      .select({
        reviewId: schema.episodeReviews.id,
        episodeId: schema.episodeReviews.episodeId,
        reviewState: schema.episodeReviews.reviewState,
        measured: schema.episodeReviews.measuredDurationS,
        effective: schema.episodeReviews.effectiveDurationS,
        reviewedAt: schema.episodeReviews.reviewedAt,
        seconds: schema.episodeReviews.timeToVerdictS,
        amount: schema.settlements.amount,
      })
      .from(schema.episodeReviews)
      .leftJoin(schema.settlements, eq(schema.settlements.episodeReviewId, schema.episodeReviews.id))
      .where(
        and(
          eq(schema.episodeReviews.reviewerRef, reviewer),
          sql`${schema.episodeReviews.reviewState} <> 'pending'`,
        ),
      )
      .orderBy(desc(schema.episodeReviews.reviewedAt))
      .limit(20);
    return reply.send({ currency, reviews: rows });
  });

  /**
   * What this shift has done, and what it still owes.
   *
   * The one endpoint Home needed that did not already exist. Everything it
   * reports is already in Postgres; nothing here is stored, cached or
   * incremented, because a counter that is written on every verdict is a
   * counter that can disagree with the rows it counts — and the figures on this
   * screen are the ones a reviewer judges their own pace against.
   *
   * "Today" is the server's local day, not a rolling 24 hours. An upload centre
   * runs shifts against a wall clock and a reviewer asking what they have done
   * today means since they came in, not since this time yesterday.
   *
   * Three deliberate limits:
   *
   * - **Payable seconds are summed from decided reviews only.** A pending row
   *   has no effective duration and must never be counted toward a figure a
   *   person reads as money.
   * - **Approval rate counts `pass` and `partial_pass` against every decided
   *   review.** A partial pass is an approval that paid less, not a rejection;
   *   treating it as a failure would make a reviewer who marks spans carefully
   *   look worse than one who passes everything whole.
   * - **Settled value is `sum(amount)`, and it is scoped to this reviewer.** It
   *   is not the programme's spend and is not labelled as such anywhere.
   */
  app.get('/api/review/shift', opts, async (req, reply) => {
    const reviewer = reviewerOf(req.actor!);

    const [totals] = await db
      .select({
        decided: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${schema.episodeReviews.reviewState} in ('pass', 'partial_pass'))::int`,
        payableSeconds: sql<string>`coalesce(sum(${schema.episodeReviews.effectiveDurationS}), 0)::text`,
        medianSeconds: sql<string | null>`percentile_cont(0.5) within group (order by ${schema.episodeReviews.timeToVerdictS})::text`,
      })
      .from(schema.episodeReviews)
      .where(
        and(
          eq(schema.episodeReviews.reviewerRef, reviewer),
          sql`${schema.episodeReviews.reviewState} <> 'pending'`,
          sql`${schema.episodeReviews.reviewedAt} >= date_trunc('day', now())`,
        ),
      );

    const [settled] = await db
      .select({ amount: sql<string>`coalesce(sum(${schema.settlements.amount}), 0)::text` })
      .from(schema.settlements)
      .innerJoin(
        schema.episodeReviews,
        eq(schema.settlements.episodeReviewId, schema.episodeReviews.id),
      )
      .where(
        and(
          eq(schema.episodeReviews.reviewerRef, reviewer),
          sql`${schema.episodeReviews.reviewedAt} >= date_trunc('day', now())`,
        ),
      );

    /**
     * Episodes the resolver refused to guess on.
     *
     * Not a review figure at all — it is the counter's work, surfaced here
     * because Home is the only screen everybody opens and an unresolved episode
     * is somebody's unpaid recording sitting still. Principle 1: the resolver
     * has no tie-break, so these exist by design and need a human, not a fix.
     */
    const [stuck] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.episodes)
      .where(sql`${schema.episodes.resolutionState} not in ('resolved')`);

    return reply.send({
      currency,
      reviewer,
      /** Configuration, not data: no table records a per-shift target yet. */
      target: Number(process.env['PLAYERONE_SHIFT_TARGET'] ?? 60),
      decided: totals?.decided ?? 0,
      approved: totals?.approved ?? 0,
      payable_seconds: totals?.payableSeconds ?? '0',
      median_seconds_to_verdict: totals?.medianSeconds ?? null,
      settled_amount: settled?.amount ?? '0',
      queue_depth: await queueDepth(),
      session_average_seconds: await sessionAverage(reviewer),
      needs_human: stuck?.count ?? 0,
    });
  });

  /** The reject reasons, localised. LOC-02: PaXini's reviewers work in Chinese. */
  app.get('/api/review/reasons', opts, async (_req, reply) => {
    const rows = await db
      .select()
      .from(schema.reviewReasonCodes)
      .where(eq(schema.reviewReasonCodes.active, true))
      .orderBy(schema.reviewReasonCodes.category, schema.reviewReasonCodes.code);
    return reply.send({
      reasons: rows.map((r) => ({
        code: r.code,
        category: r.category,
        label_en: r.labelEn,
        label_zh: r.labelZh,
        label_vi: r.labelVi,
      })),
    });
  });
}

/**
 * What a verdict id already decided, or null if it decided nothing.
 *
 * Reads the settlement alongside, so a replay answers with the same body the
 * original did rather than a thinner one — a client that lost the first
 * response must not have to tell the two apart.
 */
async function resultOf(db: Db, verdictId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({
      reviewId: schema.episodeReviews.id,
      episodeId: schema.episodeReviews.episodeId,
      reviewState: schema.episodeReviews.reviewState,
      measured: schema.episodeReviews.measuredDurationS,
      effective: schema.episodeReviews.effectiveDurationS,
      unitPrice: schema.settlements.unitPrice,
      effectiveMinutes: schema.settlements.effectiveMinutes,
      amount: schema.settlements.amount,
    })
    .from(schema.episodeReviews)
    .leftJoin(schema.settlements, eq(schema.settlements.episodeReviewId, schema.episodeReviews.id))
    .where(eq(schema.episodeReviews.verdictId, verdictId));
  if (row === undefined) return null;

  const spans = await db
    .select({ startS: schema.episodeReviewSpans.startS, endS: schema.episodeReviewSpans.endS })
    .from(schema.episodeReviewSpans)
    .where(eq(schema.episodeReviewSpans.reviewId, row.reviewId))
    .orderBy(schema.episodeReviewSpans.ordinal);

  return {
    review_id: row.reviewId,
    episode_id: row.episodeId,
    verdict_id: verdictId,
    review_state: row.reviewState,
    measured_duration_seconds: row.measured,
    effective_duration_seconds: row.effective,
    spans,
    unit_price: row.unitPrice,
    effective_minutes: row.effectiveMinutes,
    amount: row.amount,
  };
}

/**
 * Whether a rejected write was this specific unique index.
 *
 * The constraint name is walked out of the cause chain rather than matched
 * against the message, for the same reason `violates()` in the store's tests
 * does: drizzle's wrapper says "Failed query" for every failure, so matching it
 * would treat an unrelated error as a duplicate verdict and answer a genuine
 * fault with somebody else's result.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: unknown = err; e !== undefined && e !== null; e = (e as { cause?: unknown }).cause) {
    const x = e as { code?: string; constraint_name?: string };
    if (x.code === '23505' && x.constraint_name === constraint) return true;
  }
  return false;
}
