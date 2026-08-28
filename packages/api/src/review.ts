import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { EpisodeRecord } from '@playerone/contracts';
import { schema, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import type { Actor } from './actor.ts';
import { REFUSALS, constraintOf } from './backoffice.ts';
import {
  REVIEW_STATE,
  SpanError,
  cmp,
  fromDecimal,
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
/**
 * Concurrent claimers all pick the same head of the queue and `on conflict do
 * nothing` lets one of them win each round, so N claimers arriving together
 * need N rounds in the worst case. Eight is well above the number of reviewers
 * a pilot has, and a spare attempt costs one cheap statement.
 */
const CLAIM_ATTEMPTS = 8;

/**
 * QR-08. The second verdict differed, and the settlement it was going to
 * supersede is no longer waiting to be billed.
 *
 * It should be unreachable: the dispute guard proved `pending_settlement` under
 * a row lock when the dispute was raised, `bill_lines_dispute_guard` has
 * refused it a line ever since, and the bill generator takes the same lock
 * before it writes one. It has a name anyway because the alternative is a 500
 * on the one path that decides what a collector is paid, and a 500 tells the
 * reviewer nothing and the operator less. The transaction rolls back either
 * way — no verdict, no settlement, no audit row — and the second review stays
 * pending, so the answer is a refusal that says what is wrong and not an
 * "unexpected error".
 */
class BilledWhileDisputed extends Error {}

/**
 * QR-07. Two lanes, and an episode is in exactly one of them.
 *
 * The privacy lane holds everything whose collection session carries either
 * APP-17b declaration, plus whatever a reviewer or the back office has flagged
 * since. It is not a filter on the normal queue — it is a queue nothing reaches
 * unless it asks for it by name, which is what "route to a separate queue"
 * means when the alternative is a checkbox somebody forgets to tick.
 *
 * ponytail: a routing guarantee, not an access boundary. The lane guarantees
 * privacy footage never reaches a reviewer who did not ask for it — QR-07 — and
 * it cannot decide who is allowed to ask, because there is no role to ask
 * about: `Actor` is `{machine, operator}` and every operator is equal. Until the
 * reviewer-auth slice lands, both lanes are open to any authenticated operator,
 * which is the exposure the standard lane already had. The upgrade is one
 * `preHandler` on the privacy lane and on `/api/review/route`, not a change
 * here.
 */
/**
 * `second_review` is QR-08's lane. Nothing is ever *materialised* into it —
 * `derivedLane` never names it — so the only rows there are the pending
 * second reviews `POST /api/review/dispute` writes, and the takeover below is
 * the only statement that hands them out.
 */
export const LANES = ['standard', 'privacy', 'second_review'] as const;
export type Lane = (typeof LANES)[number];

/**
 * PRV-04's reason, fixed rather than passed.
 *
 * §6.9 lists exactly one compliance code and `review_reason_codes` carries it.
 * A parameter here would let a caller record a privacy quarantine under a
 * visual-quality code, which is a wrong audit row that nobody would ever catch.
 *
 * ponytail: one code because the taxonomy has one. If PaXini's rewrite adds a
 * second compliance reason, this becomes a validated body field like the
 * verdict's `reject_reasons`.
 */
const PRIVACY_REASON = 'CO-PRIVACY';

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
  /**
   * Whether a reviewer session may fetch raw footage. Mirrors the API option of
   * the same name and defaults to off — see `index.ts` for D11 and Part 7.3.
   *
   * It reaches this file so the queue does not *advertise* media it will then
   * refuse. A payload carrying urls that 403 puts the console's `<video>` into
   * its error state, whose only action re-claims — draining the queue one
   * unwatched lease at a time.
   */
  reviewerMediaEnabled?: boolean;
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
});

/**
 * QR-05, QR-07, PRV-04 and BO-15, in one body.
 *
 * They are one endpoint because they are one UPDATE of three columns on one
 * row: a reviewer quarantining what they are watching, an operator flagging an
 * episode from a browse screen, a supervisor raising a priority or handing a
 * card to a named reviewer. Three routes would be three copies of the same
 * upsert with a different subject line.
 *
 * Every field is optional and an absent one is left alone, so a caller changing
 * a priority cannot silently move an episode out of the privacy lane.
 */
const DisputeBody = z.object({
  review_id: z.string().uuid(),
  /** What the collector said, in the operator's words. The database refuses a blank. */
  reason: z.string().min(1).max(2000),
});

const RouteBody = z
  .object({
    queue: z.enum(LANES).optional(),
    /** Higher first. Bounded so a typo cannot bury the rest of the queue forever. */
    priority: z.number().int().min(-1000).max(1000).optional(),
    /**
     * `null` clears an assignment; absent leaves it. A uuid because the column
     * is a foreign key onto `operators` — a caller who mistypes gets a 400 here
     * rather than a 500 out of the database.
     */
    assignee_ref: z.string().uuid().nullish(),
    /** Free text for the human. The reason *code* is not a parameter — see PRIVACY_REASON. */
    reason: z.string().min(1).max(500).optional(),
  })
  .refine(
    (b) => b.queue !== undefined || b.priority !== undefined || b.assignee_ref !== undefined,
    { message: 'nothing to change: name a queue, a priority or an assignee' },
  );

/**
 * Does this reviewer hold — or did they decide — a review of this episode?
 *
 * One definition, used by the metadata route here and by the media route in
 * `media.ts`. Two copies of an authorization rule is two rules as soon as one
 * of them is edited, and this is the rule that decides what a person outside
 * Vietnam can see.
 *
 * Not restricted to a live lease on purpose: a reviewer looking back at their
 * own recent verdicts is reading their own work, and a lease that lapsed
 * mid-review must not make the screen they are looking at go blank.
 */
export async function holdsReview(db: Db, reviewerId: string, episodeId: string): Promise<boolean> {
  const [held] = await db
    .select({ id: schema.episodeReviews.id })
    .from(schema.episodeReviews)
    .where(
      and(
        eq(schema.episodeReviews.episodeId, episodeId),
        eq(schema.episodeReviews.reviewerRef, reviewerId),
      ),
    );
  return held !== undefined;
}

export function registerReview(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: ReviewOptions = {},
): void {
  const opts = { preHandler: requireActor };
  const currency = options.currency ?? 'VND';
  /**
   * Whether this caller is allowed to watch the footage — and therefore whether
   * they are allowed to work at all.
   *
   * One predicate, three uses: it decides whether the payload carries media
   * urls, whether a reviewer may claim, and whether a reviewer may decide. That
   * is deliberate. A reviewer who cannot watch an episode can still measure
   * nothing about it, so letting them claim it takes it off somebody else's
   * queue for the lease window, and letting them submit `good` pays a collector
   * on a judgement nobody made. Withholding the video while leaving the verdict
   * button live is worse than either denying or allowing outright, because the
   * money looks ordinary afterwards.
   *
   * A VNG counter operator is never affected: `req.actor.reviewer` is undefined
   * for the both-token session, and they are inside Vietnam at the machine
   * holding the files.
   */
  const mayWatch = (req: FastifyRequest): boolean =>
    req.actor?.reviewer === undefined || options.reviewerMediaEnabled === true;

  /**
   * 451, not 403.
   *
   * 403 on this service means "your session does not reach this route", and the
   * console treats it as a session problem. This is not one: the credential is
   * good, the route is in scope, and the refusal is D11 and Part 7.3 — remote
   * playback of raw video is not authorised yet, so there is nothing here a
   * reviewer could honestly do. RFC 7725 is exactly that answer, and it flips
   * with `reviewerMediaEnabled` the day Legal signs the playback architecture.
   */
  const withheld = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }): unknown =>
    reply.code(451).send({ error: 'playback_unauthorised', detail: 'D11 / Part 7.3' });

  /**
   * Who is reviewing.
   *
   * Two kinds of session reach this lane and both name a person by an
   * `operators.id`: a PaXini reviewer signed in under PLT-10, and a VNG
   * upload-centre operator on the both-token session this lane was built on.
   * One column holds either, so `reviewer_ref` stays one kind of value and the
   * queue's lease predicates did not have to learn about roles.
   *
   * The counter operator is still allowed on purpose — the pilot has VNG staff
   * reviewing alongside PaXini, and §7.2's end state is review moving to
   * Vietnam entirely. What changed is that a reviewer no longer *has* to
   * borrow one of those credentials to work.
   */
  const reviewerOf = (actor: Actor): string => {
    if (actor.reviewer !== undefined) return actor.reviewer.reviewerId;
    if (actor.operator !== undefined) return actor.operator.operatorId;
    /**
     * A collector session. `requireActor` scopes it to `/api/me/` and it never
     * reaches the review lane, so this is unreachable — but `reviewer_ref` is a
     * foreign key into `operators` and a collector id is not one, so the
     * alternative to throwing is writing a value that names nobody into the
     * only column recording who decided a payment.
     */
    throw new Error('a collector session cannot act as a reviewer');
  };

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
   *
   * The session must also carry its claim (0016). A session with none — a row
   * from before that migration, or one written past the counter — has no
   * price, and the verdict refuses it with `session_claim_missing` for every
   * decision, because even a rejection writes the 0.0000 settlement that is
   * the review's score and `settlements_claim_required` refuses that row. So
   * such footage is not served at all: it sits with the counter until the
   * back office attaches the claim the collector held (the UPDATE in
   * 0016_claim_join.sql), and then enters review with a price.
   */
  const cloudGate = (options.verificationGate ?? 'local') === 'cloud';
  const eligible = sql`
    ${schema.episodes.resolutionState} = 'resolved'
    and exists (
      select 1
        from collection_sessions cs
       where cs.id = ${schema.episodes.collectionSessionId}
         and cs.task_claim_id is not null
    )
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
         -- CHECKSUM-MISMATCH is the one blocking defect a person can answer:
         -- an operator who has looked at both deliveries names the real one
         -- (POST /episodes/:id/clear, episode_clearings), and a delivery so
         -- named is judged on its own defects. Naming the earlier delivery
         -- instead moves latest_ingest_id back to it, and that one never
         -- carried the defect. Every other blocking code stays blocking.
         and not (
           d.code = 'CHECKSUM-MISMATCH'
           and exists (select 1 from episode_clearings k where k.ingest_id = d.ingest_id)
         )
    )
  `;

  /**
   * Which lane an episode nobody has claimed yet belongs to.
   *
   * QR-07 routes on the two APP-17b declarations, which live on the collection
   * session and not on the review — and the review row does not exist until
   * somebody claims. So the lane is derived here for an unclaimed episode and
   * stamped onto `episode_reviews.queue` the moment a row is materialised.
   * After that the column is authoritative, because a reviewer's PRV-04 flag
   * must not be undone by a session that never declared anything.
   *
   * Written against `episodes` rather than a bound alias so the same fragment
   * serves the claim, the peek and the depth.
   */
  const declaredPrivacy = sql`exists (
      select 1
        from collection_sessions s
       where s.id = ${schema.episodes.collectionSessionId}
         and (s.others_in_frame or s.sensitive_info_present)
    )`;

  /**
   * A reviewer's PRV-04 flag on an earlier delivery of the same episode.
   *
   * A redelivery is a different ingest and gets a different review row, so
   * without this the second delivery of footage somebody quarantined arrives
   * back in the ordinary queue with the flag left behind on a row nobody reads.
   * The bytes changed; the bank card in shot did not.
   */
  const quarantinedBefore = sql`exists (
      select 1
        from episode_reviews q
       where q.episode_id = ${schema.episodes.episodeId}
         and q.queue = 'privacy'
    )`;

  /** The lane a review row is born in: the declaration, or an earlier flag. */
  const derivedLane = sql`case when ${declaredPrivacy} or ${quarantinedBefore}
      then 'privacy' else 'standard' end`;

  /**
   * `?queue=privacy` opts in; no `queue` at all is the normal lane.
   *
   * Anything else is `null`, and the caller answers 400. Treating an
   * unrecognised value as "standard" is the failure that reads like success: a
   * client asking for `?queue=privicy` would be handed ordinary footage and
   * would have no way to tell, and the misspelling would live in a UI for a
   * whole pilot. The closed set is the same `LANES` the body parser uses.
   */
  const laneOf = (req: FastifyRequest): Lane | null => {
    const asked = (req.query as { queue?: string } | undefined)?.queue;
    if (asked === undefined) return 'standard';
    return (LANES as readonly string[]).includes(asked) ? (asked as Lane) : null;
  };

  const badLane = (reply: Reply): unknown =>
    reply.code(400).send({ error: `queue must be one of ${LANES.join(', ')}` });

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
   * QR-08: a second review is never offered to the reviewer whose verdict it
   * re-examines. The database refuses the write too
   * (`episode_reviews_second_reviewer_check`); this is what keeps the refusal
   * out of the claim's own error path.
   *
   * Written once and asked by all three, because a peek, a depth and a claim
   * that disagree about what is claimable are three numbers a reviewer cannot
   * reconcile: the queue said one waiting, the prefetch warmed an episode, and
   * the claim answered 204.
   */
  const notOwnSecondReview = (disputeId: SQL | string, reviewer: string) => sql`
    not exists (
      select 1 from review_disputes d
        join episode_reviews o on o.id = d.review_id
       where d.id = ${disputeId} and o.reviewer_ref = ${reviewer}
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
   *
   * Both statements are scoped to one lane and skip rows assigned to somebody
   * else, so a reviewer is only ever offered work that is theirs to take.
   */
  async function claimNext(
    reviewer: string,
    lane: Lane,
    tx: Pick<Db, 'execute'>,
  ): Promise<{ reviewId: string; episodeId: string } | null> {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      const takeover = (await tx.execute(sql`
        update episode_reviews
           set reviewer_ref = ${reviewer},
               claimed_at = now(),
               lease_expires_at = now() + ${`${LEASE_MS} milliseconds`}::interval,
               updated_at = now()
         where id = (
           select r.id
             from episode_reviews r
            where r.review_state = 'pending'
              and r.queue = ${lane}
              and (r.assignee_ref is null or r.assignee_ref = ${reviewer})
              and (r.reviewer_ref is null or r.lease_expires_at < now())
              and ${stillEligible(sql`r.episode_id`, sql`r.ingest_id`)}
              and ${notOwnSecondReview(sql`r.dispute_id`, reviewer)}
            order by r.priority desc, r.created_at
              for update skip locked
            limit 1
         )
        returning id, episode_id
      `)) as unknown as { id: string; episode_id: string }[];
      const resumed = takeover[0];
      if (resumed !== undefined) return { reviewId: resumed.id, episodeId: resumed.episode_id };

      const created = (await tx.execute(sql`
        insert into episode_reviews
          (id, episode_id, ingest_id, measured_duration_s, review_state, queue,
           reviewer_ref, claimed_at, lease_expires_at)
        select ${randomUUID()}, episodes.episode_id, episode_ingests.ingest_id, episode_ingests.measured_duration_s, 'pending', ${lane},
               ${reviewer}, now(), now() + ${`${LEASE_MS} milliseconds`}::interval
          from episodes
          join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
         where ${eligible}
           and ${derivedLane} = ${lane}
           and not exists (
             select 1 from episode_reviews r
              where r.episode_id = episodes.episode_id and r.ingest_id = episode_ingests.ingest_id
           )
         order by episodes.first_seen_at
         limit 1
        on conflict (episode_id, ingest_id) where dispute_id is null do nothing
        returning id, episode_id
      `)) as unknown as { id: string; episode_id: string }[];
      const fresh = created[0];
      if (fresh !== undefined) return { reviewId: fresh.id, episodeId: fresh.episode_id };

      // Nothing to take over and nothing new. Either the queue is genuinely
      // empty or another reviewer won the insert; one more pass tells them
      // apart, because a lost race leaves a pending row the takeover will find.
      const remaining = (await tx.execute(sql`
        select 1 as n
          from episodes
          join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
         where ${eligible}
           and ${derivedLane} = ${lane}
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
   *
   * Which is also why it is per lane and per reviewer: an episode in the
   * privacy queue, or assigned to somebody else, is not work this reviewer can
   * pick up either.
   */
  async function queueDepth(reviewer: string, lane: Lane): Promise<number> {
    const rows = (await db.execute(sql`
      select
        (select count(*) from episode_reviews pr
          where pr.review_state = 'pending'
            and pr.queue = ${lane}
            and (pr.assignee_ref is null or pr.assignee_ref = ${reviewer})
            and (pr.reviewer_ref is null or pr.lease_expires_at < now())
            -- Same re-check as the takeover: a pending row whose episode has
            -- since failed cloud verification is not claimable, so it is not depth.
            and ${stillEligible(sql`pr.episode_id`, sql`pr.ingest_id`)}
            -- And the same QR-08 exclusion as the takeover. Without it the
            -- depth counted the second review of this reviewer's own verdict,
            -- which the claim will never hand them: the number never reached
            -- zero and the lane looked like it had work in it that it had not.
            and ${notOwnSecondReview(sql`pr.dispute_id`, reviewer)})
      + (select count(*)
           from episodes
           join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
          where ${eligible}
            and ${derivedLane} = ${lane}
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
  async function payload(
    episodeId: string,
    /** False for a reviewer while `reviewerMediaEnabled` is off. */
    withMedia = true,
  ): Promise<Record<string, unknown> | null> {
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
            /** What the verdict will pay: the session's snapshot. The task's price is only shown for a claimless legacy session. */
            unitPrice: sql<string>`coalesce(${schema.collectionSessions.unitPrice}, ${schema.tasks.unitPrice})`,
            currency: sql<string>`coalesce(${schema.collectionSessions.currency}, ${currency})`,
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
              currency: session.currency,
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
        role: withMedia ? (video?.role ?? null) : null,
        parts: withMedia
          ? (video?.parts ?? []).map((p, index) => ({
              index,
              url: `/media/episode/${row.episodeId}/part/${index}`,
              bytes: p.bytes,
              file: p.file,
            }))
          : [],
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

  /**
   * Claims and returns the next episode. 204 when there is nothing to review.
   *
   * Through `mutate`, so taking an episode is a logged act and not just a
   * column that quietly changed owner. PLT-10 asks for remote reviewer access
   * that is *fully logged*, and until now only the login and the verdict were:
   * `reviewer_ref` is overwritten by the next claimant and cleared by a
   * release, so a reviewer who claimed an episode, watched it and gave it back
   * left the store in exactly the state it was in before they saw it. For a
   * China-based reviewer under Part 7 that is the question that has to be
   * answerable — which footage did they open — and only an append-only row can
   * answer it.
   */
  app.post('/api/review/claim', opts, async (req, reply) => {
    if (!mayWatch(req)) return withheld(reply);
    const reviewer = reviewerOf(req.actor!);
    const lane = laneOf(req);
    if (lane === null) return badLane(reply);
    const claim = await mutate(
      db,
      req.actor!,
      // The target is discovered by the write: a claim is "whatever is next".
      (c: { reviewId: string; episodeId: string }) => ({
        action: 'review.claim',
        targetTable: 'episode_reviews',
        targetId: c.reviewId,
        after: { episode_id: c.episodeId, reviewer_ref: reviewer, queue: lane },
      }),
      async (tx) => (await claimNext(reviewer, lane, tx)) ?? undefined,
    );
    if (claim === undefined) {
      return reply.code(204).send();
    }
    const body = await payload(claim.episodeId, mayWatch(req));
    if (body === null) return reply.code(500).send({ error: 'claimed an episode that has no ingest' });
    const lease = await withLease(claim.episodeId);
    return reply.send({
      ...body,
      review_id: claim.reviewId,
      queue: lane,
      lease_expires_at: lease?.leaseExpiresAt?.toISOString() ?? null,
      queue_depth: await queueDepth(reviewer, lane),
      session_average_seconds: await sessionAverage(reviewer),
    });
  });

  /**
   * Metadata for one episode, without claiming it. This is what the client
   * prefetches: knowing the next episode's media urls is what lets it warm a
   * hidden video element while the current one is still being watched.
   *
   * A reviewer reaches only episodes they hold a review row for. Unrestricted,
   * this route hands any signed-in reviewer the collector, the task, the device
   * serial, the APP-17b privacy declarations and the resolver's working for any
   * episode id they can name — the whole corpus, one id at a time. `/next`
   * deliberately reveals one unclaimed episode because that is the queue; this
   * one revealed all of them. Same 404 as an id that does not exist, so it is
   * not an oracle for which ones do.
   *
   * A VNG counter operator is unrestricted, as before: they are inside Vietnam
   * on the machine holding the files and BO-09 has no episode browser yet.
   */
  app.get('/api/review/episode/:id', opts, async (req, reply) => {
    const episodeId = (req.params as { id: string }).id;
    const reviewer = req.actor!.reviewer;
    if (reviewer !== undefined && !(await holdsReview(db, reviewer.reviewerId, episodeId))) {
      return reply.code(404).send({ error: 'no such episode' });
    }
    const body = await payload(episodeId, mayWatch(req));
    if (body === null) return reply.code(404).send({ error: 'no such episode' });
    return reply.send(body);
  });

  /**
   * A peek at what would be claimed next, so the client can prefetch it without
   * taking it off somebody else's queue. Returns 204 when nothing is waiting.
   *
   * The ORDER BY reproduces `claimNext`'s two statements in one: rows that
   * already exist come first (`r.id is null` sorts false before true), because
   * the claim drains the takeover before it materialises anything; then
   * priority, then how long the thing has waited. A peek that predicted a
   * different episode from the one the claim hands over would warm the wrong
   * video, which is the whole reason this route exists.
   *
   * QR-07: a privacy-declared episode is not merely ranked lower here. It is
   * not in this result at all unless the caller asked for that lane.
   */
  app.get('/api/review/next', opts, async (req, reply) => {
    const reviewer = reviewerOf(req.actor!);
    const lane = laneOf(req);
    if (lane === null) return badLane(reply);
    const rows = (await db.execute(sql`
      select episodes.episode_id
        from episodes
        join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
        left join episode_reviews r
          on r.episode_id = episodes.episode_id and r.ingest_id = episode_ingests.ingest_id
       where ${eligible}
         and coalesce(r.queue, ${derivedLane}) = ${lane}
         and coalesce(r.assignee_ref, ${reviewer}) = ${reviewer}
         and (r.id is null
              or (r.review_state = 'pending'
                  and (r.reviewer_ref is null or r.lease_expires_at < now())
                  -- The claim's QR-08 exclusion, so the peek names the episode
                  -- the claim will actually hand over and not this reviewer's
                  -- own verdict coming back at them.
                  and ${notOwnSecondReview(sql`r.dispute_id`, reviewer)}))
       order by (r.id is null), coalesce(r.priority, 0) desc,
                coalesce(r.created_at, episodes.first_seen_at)
       limit 1
    `)) as unknown as { episode_id: string }[];
    const next = rows[0];
    if (next === undefined) return reply.code(204).send();
    const body = await payload(next.episode_id, mayWatch(req));
    if (body === null) return reply.code(204).send();
    return reply.send({ ...body, queue: lane });
  });

  /**
   * QR-05, QR-07, PRV-04, BO-15: move an episode within the queue, or out of it
   * into the privacy lane.
   *
   * One upsert. A lazy queue means the row a caller wants to prioritise may not
   * exist yet — an episode nobody has claimed has no review — so this
   * materialises it rather than refusing, which is also what makes flagging an
   * episode from a browse screen (BO-15) work on footage no reviewer has opened.
   *
   * Routing to `privacy` releases the lease. The reviewer who flagged it is
   * handing the episode to somebody cleared to watch it, and leaving their own
   * claim on it would park it for the rest of the lease in a queue they are
   * done with. The assignment goes with it, for the same reason.
   *
   * The two APP-17b booleans are never written here. They are what the collector
   * declared before recording and a reviewer's later judgement is a different
   * fact; overwriting them would erase the only evidence of what was declared.
   * They are also a **floor**: an episode whose session declares either one
   * cannot be routed to the standard lane at all, whoever asks. A reviewer's
   * PRV-04 flag sits above that floor and could be lifted; a collector's
   * declaration is not a reviewer's to overrule, and QR-07 is the requirement
   * that says so.
   *
   * ponytail: any authenticated operator may call this. "Specialist review"
   * (BO-15) needs a reviewer role to be a real gate, and roles are the
   * reviewer-auth slice - this endpoint is the queue half and stays that way.
   */
  app.post('/api/review/route/:id', opts, async (req, reply) => {
    const parsed = RouteBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', detail: parsed.error.issues.slice(0, 5) });
    }
    const body = parsed.data;
    const actor = req.actor!;
    const episodeId = (req.params as { id: string }).id;
    /**
     * A PaXini reviewer raises the PRV-04 flag and nothing else. Lowering one
     * puts footage in front of more people, and moving priority or assignee is
     * queue management — both are the upload centre's call, not the reviewer's
     * (BO-15). The scope check in `buildApi` is by route prefix, so this is the
     * only place the distinction can be made.
     */
    if (
      actor.reviewer !== undefined &&
      (body.queue !== 'privacy' || body.priority !== undefined || body.assignee_ref !== undefined)
    ) {
      return reply
        .code(403)
        .send({ error: 'a reviewer may quarantine an episode; routing it is an operator decision' });
    }

    /**
     * The audit event is filled in from inside the transaction.
     *
     * `mutate` reads `targetId`, `before` and `after` *after* the write callback
     * resolves, so the callback can replace them with what the locked row
     * actually held and with what was actually written. Neither is knowable
     * before the row is located: an episode can carry more than one review -
     * one per delivery - and whether the lease is released depends on the lane
     * the row was already in.
     */
    const event = {
      action: 'review.route',
      targetTable: 'episode_reviews',
      targetId: episodeId,
      before: null as unknown,
      after: {} as Record<string, unknown>,
      reason: body.reason ?? (body.queue === 'privacy' ? PRIVACY_REASON : undefined),
    };

    let refusal: string | null = null;
    const written = await mutate(db, actor, event, async (tx) => {
      /**
       * The delivery this episode is currently waiting on, and the review row
       * for it if there is one, in one locked read.
       *
       * Scoped to `latest_ingest_id` and not to the episode. A second delivery
       * of the same session is a second ingest and gets its own review row, so
       * "the review for this episode" is not a thing that exists: an episode
       * whose first delivery was decided and then redelivered has a decided row
       * and a pending one. Reading either at random would refuse the pending
       * review because an older one is decided, and would audit the move
       * against a row nobody touched.
       *
       * `for update of episodes` locks the episode itself and not just the
       * review. `latest_ingest_id` is read here and written by a redelivery,
       * and the ingest id is carried into the upsert rather than read a second
       * time - so a delivery landing mid-request either waits for this
       * transaction or is seen whole by it. The same lock serialises two
       * routers racing to materialise the same missing row: the loser waits,
       * then sees the winner's.
       */
      const episode = (await tx.execute(sql`
        select episodes.latest_ingest_id as ingest_id,
               episode_ingests.measured_duration_s as measured,
               ${declaredPrivacy} as declared_privacy,
               ${derivedLane} as derived_lane
          from episodes
          join episode_ingests on episode_ingests.ingest_id = episodes.latest_ingest_id
         where episodes.episode_id = ${episodeId}
           and ${eligible}
           for update of episodes
      `)) as unknown as {
        ingest_id: string;
        measured: string;
        declared_privacy: boolean;
        derived_lane: Lane;
      }[];
      const ep = episode[0];
      if (ep === undefined) {
        // Not reviewable at all: no owner, a quarantined ingest, a blocking
        // defect, or no such episode. Materialising a row here would put
        // unjudgeable footage in a queue.
        refusal = 'no reviewable episode to route';
        return undefined;
      }

      /**
       * A second statement, and that is the whole point of it.
       *
       * Under READ COMMITTED every statement takes its own snapshot, so this
       * one sees whatever another router committed while the statement above
       * was waiting for the episode lock. A single joined read cannot: the row
       * it locks is re-checked, but the outer-joined review is still the one
       * from the snapshot taken before the wait — which is how a second router
       * ends up writing over a row it believes does not exist, and auditing the
       * change against `before: null`.
       */
      const prior = (await tx.execute(sql`
        select id, queue, priority, assignee_ref, reviewer_ref, review_state
          from episode_reviews
         where episode_id = ${episodeId}
           and ingest_id = ${ep.ingest_id}
           -- The first review. A second review (QR-08) is in its own lane and
           -- is not routed from here; a disputed episode answers "already
           -- reviewed" below, which is true of the row this route addresses.
           and dispute_id is null
           for update
      `)) as unknown as {
        id: string;
        queue: Lane;
        priority: number;
        assignee_ref: string | null;
        reviewer_ref: string | null;
        review_state: string;
      }[];
      const held = prior[0];
      if (held !== undefined && held.review_state !== 'pending') {
        // A decided review is a payment. Re-queueing one is the dispute path,
        // which is P2 and is a supersedes column, not an UPDATE.
        refusal = 'this episode has already been reviewed';
        return undefined;
      }
      if (body.queue === 'standard' && ep.declared_privacy) {
        // QR-07's floor. The collector declared others in frame or sensitive
        // information; no request moves that footage into the lane every
        // reviewer sees.
        refusal = 'this episode was declared a privacy risk by the collector';
        return undefined;
      }
      const quarantined = held?.queue === 'privacy' || ep.derived_lane === 'privacy';
      if (body.queue === 'standard' && quarantined && body.reason === undefined) {
        /**
         * Lifting a reviewer's PRV-04 flag is a compliance decision, and the
         * audit row for it has to say why in words. Raising one does not need a
         * typed reason because the code is fixed and the direction is safe;
         * lowering one is the direction that puts footage in front of more
         * people.
         */
        refusal = 'declassifying a quarantined episode needs a reason';
        return undefined;
      }

      const lane = body.queue ?? held?.queue ?? ep.derived_lane;
      /**
       * The lease and the assignment go only when the lane actually changes. A
       * retried privacy flag - a lost response, a double tap - would otherwise
       * take the episode away from the specialist who has since picked it up,
       * every time it arrived.
       */
      const quarantining = lane === 'privacy' && held?.queue !== 'privacy';
      const assignee =
        body.assignee_ref !== undefined
          ? body.assignee_ref
          : quarantining
            ? null
            : (held?.assignee_ref ?? null);

      const sets: SQL[] = [sql`queue = ${lane}`, sql`assignee_ref = ${assignee}`];
      if (body.priority !== undefined) sets.push(sql`priority = ${body.priority}`);
      if (quarantining) {
        sets.push(sql`reviewer_ref = null, claimed_at = null, lease_expires_at = null`);
      }
      sets.push(sql`updated_at = now()`);

      const rows = (await tx.execute(sql`
        insert into episode_reviews
          (id, episode_id, ingest_id, measured_duration_s, review_state, queue, priority, assignee_ref)
        values (${randomUUID()}, ${episodeId}, ${ep.ingest_id}, ${ep.measured}, 'pending',
                ${lane}, ${body.priority ?? 0}, ${assignee})
        on conflict (episode_id, ingest_id) where dispute_id is null do update
           set ${sql.join(sets, sql`, `)}
         where episode_reviews.review_state = 'pending'
        returning id, queue, priority, assignee_ref
      `)) as unknown as {
        id: string;
        queue: Lane;
        priority: number;
        assignee_ref: string | null;
      }[];
      const row = rows[0];
      if (row === undefined) {
        refusal = 'this episode has already been reviewed';
        return undefined;
      }

      event.targetId = row.id;
      event.before =
        held === undefined
          ? null
          : {
              queue: held.queue,
              priority: held.priority,
              assignee_ref: held.assignee_ref,
              /** Who lost the episode, when a flag takes it off them. */
              reviewer_ref: held.reviewer_ref,
            };
      event.after = {
        episode_id: episodeId,
        ingest_id: ep.ingest_id,
        queue: row.queue,
        priority: row.priority,
        assignee_ref: row.assignee_ref,
        ...(quarantining
          ? { reviewer_ref: null, lease_released: true, reason_code: PRIVACY_REASON }
          : {}),
      };
      return row;
    });

    if (written === undefined) {
      const error: string = refusal ?? 'no reviewable episode to route';
      // A missing reason is the caller's to fix; everything else here is a
      // conflict with the state of the row.
      const status = error === 'declassifying a quarantined episode needs a reason' ? 400 : 409;
      return reply.code(status).send({ error, episode_id: episodeId });
    }
    return reply.send({
      episode_id: episodeId,
      review_id: written.id,
      queue: written.queue,
      priority: written.priority,
      assignee_ref: written.assignee_ref,
    });
  });

  /**
   * Extends a lease while the tab is open. A reviewer who leaves stops sending these.
   *
   * ponytail: deliberately not audited, where the claim and the release are.
   * A heartbeat says nothing a claim did not already say and arrives every few
   * seconds, so auditing it would add hundreds of rows per episode and bury the
   * two events that carry information. If lease *duration* ever has to be
   * proven rather than inferred from claim-to-verdict, extend the claim row
   * rather than logging each beat.
   */
  app.post('/api/review/heartbeat/:id', opts, async (req, reply) => {
    /**
     * The same gate as the claim and the verdict, because a lease outlives the
     * policy that granted it. A reviewer holding an episode when the process
     * restarts with playback withdrawn could otherwise extend it forever from a
     * page they left open, keeping footage they cannot watch off everybody
     * else's queue. Refused here, the lease simply lapses and the episode goes
     * back — which is what withdrawal should mean.
     */
    if (!mayWatch(req)) return withheld(reply);
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
    /**
     * Audited for the same reason the claim is: this statement erases the only
     * column that said who was holding the episode. `before` carries the name
     * it is erasing, so claim and release read as a pair and the time between
     * them is how long that reviewer had the footage open.
     */
    const released = await mutate(
      db,
      req.actor!,
      (r: { id: string }) => ({
        action: 'review.release',
        targetTable: 'episode_reviews',
        targetId: r.id,
        before: { episode_id: episodeId, reviewer_ref: reviewer },
      }),
      async (tx) => {
        const rows = (await tx.execute(sql`
          update episode_reviews
             set reviewer_ref = null, claimed_at = null, lease_expires_at = null, updated_at = now()
           where episode_id = ${episodeId}
             and review_state = 'pending'
             and reviewer_ref = ${reviewer}
          returning id
        `)) as unknown as { id: string }[];
        // Releasing something already gone is not a failure worth reporting to
        // a page that is in the middle of closing — and it writes no audit row,
        // because nothing was released.
        return rows[0];
      },
    );
    return reply.send({ released: released !== undefined });
  });

  /**
   * The verdict. Everything else in this file exists to get here safely.
   */
  app.post('/api/review/verdict', opts, async (req, reply) => {
    const parsed = VerdictBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', detail: parsed.error.issues.slice(0, 5) });
    }
    if (!mayWatch(req)) return withheld(reply);
    const body = parsed.data;
    const actor = req.actor!;
    const reviewer = reviewerOf(actor);

    /**
     * The replay check, first and outside any transaction. A retry after a
     * timeout is the common case, not the exceptional one — the original write
     * usually succeeded and only the response was lost — so it is answered
     * before anything is locked.
     */
    const scope = { reviewer, episodeId: body.episode_id };
    const replayed = await resultOf(db, body.verdict_id, scope);
    if (replayed !== null) return reply.send({ ...replayed, replayed: true });

    /**
     * The pending row first. A disputed episode (QR-08) carries its decided
     * first review and a pending second one, and the verdict is for the row
     * still waiting; with nothing pending, the decided row answers "already
     * reviewed" below as before.
     *
     * **This reviewer's** pending row before any other pending row. An episode
     * can have two: a redelivery opens a pending first review on the new
     * ingest while the second review of a dispute on the old one is still
     * open, and they are usually held by different people. Picking whichever
     * Postgres returned first would answer one of the two reviewers with
     * "claimed by someone else" at random. Oldest first breaks the remaining
     * tie, so the same request always resolves to the same row.
     */
    const rows = await db
      .select()
      .from(schema.episodeReviews)
      .where(eq(schema.episodeReviews.episodeId, body.episode_id))
      /**
       * The current delivery first. An episode can carry one review per
       * delivery, and only the row bound to `latest_ingest_id` can pass
       * `stillEligible` below, so a stale pending row from a superseded
       * delivery must not be the one picked up and refused. A dispute's second
       * review sits on the same ingest as its first, so this key never
       * reorders the two rows the paragraph above is about; it only demotes
       * rows from deliveries that have been replaced. Oldest first, then id,
       * breaks the rest, so the same request always resolves to the same row.
       */
      .orderBy(
        sql`${schema.episodeReviews.ingestId} = (select latest_ingest_id from episodes where episode_id = ${body.episode_id}) desc`,
        asc(schema.episodeReviews.createdAt),
        asc(schema.episodeReviews.id),
      );
    const pending = rows.filter((r) => r.reviewState === 'pending');
    const review = pending.find((r) => r.reviewerRef === reviewer) ?? pending[0] ?? rows[0];
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

    /**
     * The price comes from the SESSION's snapshot and the claim it names, never
     * from `tasks`: what a recording earns was fixed when it was declared under
     * a live claim (counter.ts), and a task edited or repriced since must not
     * reach a verdict on footage that already exists.
     */
    const [ownership] = await db
      .select({
        taskId: schema.collectionSessions.taskId,
        taskClaimId: schema.collectionSessions.taskClaimId,
        unitPrice: schema.collectionSessions.unitPrice,
        currency: schema.collectionSessions.currency,
      })
      .from(schema.episodes)
      .innerJoin(
        schema.collectionSessions,
        eq(schema.collectionSessions.id, schema.episodes.collectionSessionId),
      )
      .where(eq(schema.episodes.episodeId, body.episode_id));
    if (ownership === undefined) {
      // The eligibility filter should have kept this out of the queue. If it is
      // here anyway, refusing is the only safe answer: a verdict with no task
      // has no price, and guessing one is exactly the class of mistake the
      // resolver refuses to make.
      return reply.code(409).send({ error: 'this episode has no task to be paid against' });
    }
    if (ownership.taskClaimId === null || ownership.unitPrice === null || ownership.currency === null) {
      /**
       * A session from before migration 0016, or one written past the counter.
       * Nobody was recorded as entitled to this footage and it has no price;
       * `settlements_claim_guard` would refuse the row anyway, and this is the
       * sentence instead of the 500. The migration names the path out.
       */
      return reply.code(409).send({ error: 'refused', constraint: 'session_claim_missing' });
    }
    // Plain consts: the narrowing above does not reach into the transaction closure.
    const taskClaimId = ownership.taskClaimId;
    const unitPrice = ownership.unitPrice;
    const currency = ownership.currency;
    const bill = settlementFor(unitPrice, effectiveSeconds);

    const decidedAt = new Date();
    /**
     * How long the verdict took, measured from the claim this server recorded.
     *
     * The client used to send this and no longer may. It is the input to
     * `/api/review/throughput`, which is a number about a person's pace, and a
     * caller-supplied duration on that path is the same mistake as a
     * caller-supplied duration on the money path: a client sending 0.1 for
     * every verdict would report a reviewer as ten times faster than anybody
     * and nothing would look wrong. The lease already knows when the episode
     * was handed over, so the server does not need to be told.
     *
     * Null only where there is no claim to measure from. On this path there is
     * always one — the lease check above refuses a verdict without a live
     * claim — but the column stays nullable for rows written any other way.
     */
    const elapsedSeconds =
      review.claimedAt === null
        ? null
        : Math.max(0, (decidedAt.getTime() - review.claimedAt.getTime()) / 1000);

    /**
     * What the second verdict did to the dispute, filled in by the write. The
     * event is built after the callback resolves (the function form), so the
     * audit row for a verdict that closed a dispute says which one and how.
     */
    const dispute: Record<string, unknown> = {};
    let written: { id: string } | undefined;
    try {
      written = await mutate(
        db,
        actor,
        () => ({
          action: 'episode.review',
          targetTable: 'episode_reviews',
          targetId: review.id,
          before: { review_state: 'pending', reviewer_ref: review.reviewerRef },
          after: {
            verdict_id: body.verdict_id,
            ...dispute,
            episode_id: body.episode_id,
            ingest_id: review.ingestId,
            decision,
            review_state: REVIEW_STATE[decision],
            measured_duration_s: review.measuredDurationS,
            effective_duration_s: effectiveSeconds,
            spans,
            reject_reasons: body.reject_reasons,
            unit_price: unitPrice,
            currency,
            effective_minutes: bill.effectiveMinutes,
            amount: bill.amount,
          },
        }),
        async (tx) => {
          /**
           * The WHERE is not belt and braces. It is what makes the transaction
           * the arbiter rather than the checks twenty lines above: between that
           * read and this write another request may have decided this review,
           * or the lease may have run out and somebody else may have claimed
           * it. Either way this update matches nothing and the whole
           * transaction — audit row and settlement included — does not happen.
           *
           * The lease half matters as much as the state half. A reviewer whose
           * lease expired while they were deciding is a reviewer whose episode
           * belongs to somebody else now, and a verdict written under an
           * expired claim writes a payment against footage the row says another
           * person holds.
           * The episode row is locked before the eligibility clause below reads
           * it. Under READ COMMITTED an `exists` subquery answers from a
           * statement snapshot, so a read-back verdict or a redelivery
           * committing microseconds later would slip past it and this
           * transaction would still write a settlement. The upload leg's own
           * verdict write updates this row, so taking the lock here is what
           * makes the two serialise: whichever arrives second waits and then
           * sees the other's decision.
           */
          await tx.execute(
            sql`select 1 from episodes where episode_id = ${body.episode_id} for update`,
          );
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
                eq(schema.episodeReviews.reviewerRef, reviewer),
                sql`${schema.episodeReviews.leaseExpiresAt} >= now()`,
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
          const settlementId = randomUUID();
          if (review.disputeId !== null) {
            /**
             * QR-08. This is the second verdict, and what it means for money
             * is decided here, inside the same transaction as the verdict.
             *
             * "Agrees" is the same outcome and the same effective seconds —
             * the two inputs the settlement is computed from. Same money is
             * the same answer, however the spans were drawn. Then the dispute
             * closes `upheld`, the original settlement stands and this row
             * writes no settlement of its own: one payment per delivery.
             *
             * Differs: the original settlement is parked in `exception`,
             * named as superseded by the one written from this verdict, and
             * that one is billed in its place. The original's `WHERE` carries
             * `pending_settlement`, which the dispute guard proved at raise
             * time and the bill guard has held since; matching nothing here
             * would mean it was billed anyway, and the transaction stops.
             */
            const [first] = await tx
              .select({
                reviewState: schema.episodeReviews.reviewState,
                effective: schema.episodeReviews.effectiveDurationS,
              })
              .from(schema.reviewDisputes)
              .innerJoin(
                schema.episodeReviews,
                eq(schema.episodeReviews.id, schema.reviewDisputes.reviewId),
              )
              .where(eq(schema.reviewDisputes.id, review.disputeId));
            const agrees =
              first !== undefined &&
              first.reviewState === REVIEW_STATE[decision] &&
              first.effective !== null &&
              cmp(fromDecimal(first.effective), fromDecimal(effectiveSeconds)) === 0;
            if (!agrees) {
              await tx.insert(schema.settlements).values({
                id: settlementId,
                episodeReviewId: review.id,
                taskId: ownership.taskId,
                taskClaimId: taskClaimId,
                unitPrice: unitPrice,
                effectiveMinutes: bill.effectiveMinutes,
                amount: bill.amount,
                settlementState: 'pending_settlement',
              });
              const parked = (await tx.execute(sql`
                update settlements s
                   set settlement_state = 'exception',
                       exception_from_state = s.settlement_state,
                       exception_reason = 'superseded',
                       superseded_by = ${settlementId},
                       updated_at = now()
                  from review_disputes d
                 where d.id = ${review.disputeId}
                   and s.episode_review_id = d.review_id
                   and s.settlement_state = 'pending_settlement'
                returning s.id
              `)) as unknown as { id: string }[];
              if (parked.length !== 1) {
                throw new BilledWhileDisputed('the disputed settlement was billed while the dispute was open');
              }
              dispute.superseded_settlement_id = parked[0]!.id;
            }
            await tx
              .update(schema.reviewDisputes)
              .set({ resolvedAt: decidedAt, outcome: agrees ? 'upheld' : 'overturned' })
              .where(eq(schema.reviewDisputes.id, review.disputeId));
            dispute.dispute_id = review.disputeId;
            dispute.outcome = agrees ? 'upheld' : 'overturned';
            return row;
          }
          await tx.insert(schema.settlements).values({
            id: settlementId,
            episodeReviewId: review.id,
            taskId: ownership.taskId,
            taskClaimId: taskClaimId,
            unitPrice: unitPrice,
            effectiveMinutes: bill.effectiveMinutes,
            amount: bill.amount,
            settlementState: 'pending_settlement',
          });
          return row;
        },
      );
    } catch (err) {
      if (err instanceof BilledWhileDisputed) {
        return reply.code(409).send({
          error: 'not reviewable',
          detail:
            'the settlement under dispute was billed while the dispute was open, so this verdict cannot replace it; nothing was recorded',
        });
      }
      /**
       * Two requests carrying the same `verdict_id` reached the transaction
       * together. One committed; this one lost on the unique index. The correct
       * answer is the winner's, not an error — from the reviewer's side the
       * verdict was recorded exactly once, which is what was promised.
       */
      if (isUniqueViolation(err, 'episode_reviews_verdict_key')) {
        const settled = await resultOf(db, body.verdict_id, scope);
        if (settled !== null) return reply.send({ ...settled, replayed: true });
        // The id is taken, but not by this reviewer on this episode. Say that
        // rather than returning a stranger's result or a 500.
        return reply.code(409).send({ error: 'that verdict id belongs to another review' });
      }
      throw err;
    }

    if (written === undefined) {
      /**
       * The update matched nothing: between the read above and the write this
       * review was decided, or the lease on it ran out and it went to somebody
       * else. If it was decided by the *same* verdict id — two copies of one
       * request racing, the ordinary double-tap — then from the reviewer's side
       * the verdict was recorded exactly once and the honest answer is the one
       * that won. Anything else means the episode is no longer theirs.
       */
      const raced = await resultOf(db, body.verdict_id, scope);
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
      unit_price: unitPrice,
      currency,
      effective_minutes: bill.effectiveMinutes,
      amount: bill.amount,
      replayed: false,
      /** The lane the reviewer is working, read off the row rather than asked for. */
      queue_depth: await queueDepth(reviewer, review.queue as Lane),
      session_average_seconds: await sessionAverage(reviewer),
    });
  });

  /**
   * QR-08. A collector challenges a verdict; an operator raises it for them,
   * because the pilot has no collector login.
   *
   * One transaction writes two rows and moves nothing in money: the dispute,
   * and a pending second review of the same delivery in the `second_review`
   * lane, which the claim hands to any reviewer except the one under
   * challenge. The settlement stays exactly where it was — the bill generator
   * and `bill_lines_dispute_guard` both hold it back until the second verdict
   * lands and decides, in the verdict's own transaction, whether it stands.
   *
   * What may be disputed is the database's rule (`review_disputes_guard`),
   * and its refusals come back as the back office's do: a 409 naming the
   * constraint, with a sentence for it in the catalogue.
   *
   * ponytail: an operator, not a reviewer. A PaXini reviewer re-queueing a
   * colleague's verdict is a supervision decision the brief has not assigned
   * to them; when it is, this is one more `actor.reviewer` branch.
   */
  app.post('/api/review/dispute', opts, async (req, reply) => {
    const parsed = DisputeBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', detail: parsed.error.issues.slice(0, 5) });
    }
    const actor = req.actor!;
    // `raised_by` is an operator. Ask for the operator half rather than
    // excluding the reviewer, so a collector session is refused here too — QR-08
    // says a dispute is raised at the upload centre on the collector's behalf,
    // and a collector-raised dispute is a different route nobody has built.
    if (actor.operator === undefined) {
      return reply.code(403).send({ error: 'a dispute is raised at the upload centre, on the collector\'s behalf' });
    }
    const body = parsed.data;

    /**
     * SEC-02, the same rule and the same answer as `/handovers/:id/sessions`
     * and `/episodes/:id/resolve`: a row that belongs to another centre is not
     * refused, it does not exist. Without this an operator at any centre could
     * reopen a verdict on a collector who never handed a card in to them, and
     * hold that collector's bill back, from a screen that shows them nothing
     * about the delivery.
     *
     * The centre comes from the delivery — `episodes.upload_batch_id` to the
     * handover the card arrived on — because that is where a collector's
     * relationship with a centre is written. It is deliberately not the
     * reviewer's centre: a PaXini reviewer has none, and this route is closed
     * to them anyway.
     *
     * An episode stored by the CLI has no batch and therefore no centre, so it
     * cannot be disputed through this route. That is the same 404 and not a
     * separate refusal: nothing in the pilot reaches review that way.
     */
    const [own] = await db
      .select({ id: schema.episodeReviews.id })
      .from(schema.episodeReviews)
      .innerJoin(schema.episodes, eq(schema.episodes.episodeId, schema.episodeReviews.episodeId))
      .innerJoin(schema.uploadBatches, eq(schema.uploadBatches.id, schema.episodes.uploadBatchId))
      .innerJoin(schema.handovers, eq(schema.handovers.id, schema.uploadBatches.handoverId))
      .where(
        and(
          eq(schema.episodeReviews.id, body.review_id),
          eq(schema.handovers.uploadCentreId, actor.operator.uploadCentreId),
        ),
      );
    if (own === undefined) return reply.code(404).send({ error: 'no such review' });

    const disputeId = randomUUID();
    const secondReviewId = randomUUID();
    const event = {
      action: 'review.dispute',
      targetTable: 'review_disputes',
      targetId: disputeId,
      after: { review_id: body.review_id, second_review_id: secondReviewId } as Record<string, unknown>,
      reason: body.reason,
    };
    try {
      const written = await mutate(db, actor, event, async (tx) => {
        await tx.insert(schema.reviewDisputes).values({
          id: disputeId,
          reviewId: body.review_id,
          raisedBy: actor.operator.operatorId,
          reason: body.reason,
        });
        /**
         * The same delivery, copied from the row under dispute rather than
         * from `episodes.latest_ingest_id`: a redelivery since the verdict is
         * a different ingest and a different review, and the outcome being
         * challenged is the one on the bytes the first reviewer saw.
         */
        const rows = (await tx.execute(sql`
          insert into episode_reviews
            (id, episode_id, ingest_id, measured_duration_s, review_state, queue, dispute_id)
          select ${secondReviewId}, episode_id, ingest_id, measured_duration_s, 'pending', 'second_review', ${disputeId}
            from episode_reviews
           where id = ${body.review_id}
          returning episode_id
        `)) as unknown as { episode_id: string }[];
        event.after['episode_id'] = rows[0]?.episode_id ?? null;
        return rows[0];
      });
      if (written === undefined) return reply.code(404).send({ error: 'no such review' });
      return reply.send({
        dispute_id: disputeId,
        review_id: body.review_id,
        episode_id: written.episode_id,
        second_review_id: secondReviewId,
        queue: 'second_review',
      });
    } catch (err) {
      const name = constraintOf(err);
      if (name !== undefined && REFUSALS.has(name)) {
        return reply.code(409).send({ error: 'refused', constraint: name });
      }
      // A review id that names nothing fails the FK before the guard runs.
      if (name === 'review_disputes_review_id_episode_reviews_id_fk') {
        return reply.code(404).send({ error: 'no such review' });
      }
      throw err;
    }
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
      queue_depth: await queueDepth(reviewer, 'standard'),
      /** QR-07, on the one screen everybody opens: work nobody normal will see. */
      privacy_queue_depth: await queueDepth(reviewer, 'privacy'),
      session_average_seconds: await sessionAverage(reviewer),
      needs_human: stuck?.count ?? 0,
    });
  });

  /**
   * QR-06. Reviewer throughput, per reviewer, from columns the verdict already
   * writes — nothing here is stored, incremented or sampled.
   *
   * **`reviews_per_hour` is per hour of measured review time**, not per hour on
   * shift: `3600 × verdicts ÷ Σ time_to_verdict_s`. A wall-clock denominator
   * would need a shift table nobody has, and would report a reviewer who spent
   * half the day on something else as half as fast as they are. The inputs are
   * returned alongside so anybody who wants a different denominator can compute
   * it rather than argue with this one.
   *
   * Every input is server-measured: `time_to_verdict_s` is stamped from the
   * claim this service recorded, never from a number the reviewer's browser
   * sent, because this is the one endpoint where a reviewer would have a reason
   * to send a flattering one.
   *
   * Reviews with no `time_to_verdict_s` — a row decided with no claim time to
   * measure from — are counted in `decided` and left out of the rate and the
   * median. `timed` is the difference, so a deployment where that number is
   * climbing can see it.
   *
   * `since` is optional and there is no default window. A default would be an
   * operational decision, and this endpoint does not get to make it.
   *
   * ponytail: aggregates over the whole table, with no index on `reviewer_ref`.
   * At pilot volume that is a millisecond; add
   * `(reviewer_ref, reviewed_at)` when the plan says so.
   */
  app.get('/api/review/throughput', opts, async (req, reply) => {
    const raw = (req.query as { since?: string } | undefined)?.since;
    const since = raw === undefined ? null : new Date(raw);
    if (since !== null && Number.isNaN(since.getTime())) {
      return reply.code(400).send({ error: 'since must be an ISO timestamp' });
    }
    /**
     * The bound `since` is an ISO string and not the `Date`. `db.execute` hands
     * parameters to postgres.js's `unsafe`, which does not serialise a `Date` —
     * it throws ERR_INVALID_ARG_TYPE inside the driver, surfaced by drizzle as
     * "Failed query" with the date printed in the params line, which reads like
     * a SQL fault and is not one.
     */
    const rows = (await db.execute(sql`
      select reviewer_ref as reviewer,
             count(*)::int as decided,
             count(*) filter (where review_state in ('pass', 'partial_pass'))::int as approved,
             count(time_to_verdict_s)::int as timed,
             coalesce(sum(time_to_verdict_s), 0)::text as review_seconds,
             (3600 * count(time_to_verdict_s) / nullif(sum(time_to_verdict_s), 0))::float8
               as reviews_per_hour,
             percentile_cont(0.5) within group (order by time_to_verdict_s)::text
               as median_seconds_to_verdict,
             max(reviewed_at) as last_verdict_at
        from episode_reviews
       where review_state <> 'pending'
         and reviewer_ref is not null
         ${since === null ? sql`` : sql`and reviewed_at >= ${since.toISOString()}::timestamptz`}
       group by reviewer_ref
       order by count(*) desc, reviewer_ref
    `)) as unknown as Record<string, unknown>[];
    return reply.send({ since: since?.toISOString() ?? null, reviewers: rows });
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
async function resultOf(
  db: Db,
  verdictId: string,
  scope: { reviewer: string; episodeId: string },
): Promise<Record<string, unknown> | null> {
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
    .where(
      and(
        eq(schema.episodeReviews.verdictId, verdictId),
        /**
         * Scoped, and this is not tidiness. A verdict id is the *client's* own
         * idempotency key and nothing stops a second reviewer sending one they
         * were told about; unscoped, this route hands back somebody else's
         * episode id, durations, marked spans, unit price and amount for any
         * verdict uuid that is guessed or leaked. A genuine retry carries the
         * same three values it sent the first time, so narrowing costs the
         * replay path nothing.
         */
        eq(schema.episodeReviews.reviewerRef, scope.reviewer),
        eq(schema.episodeReviews.episodeId, scope.episodeId),
      ),
    );
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
