import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { z } from 'zod';
import type { CollectorActor } from './actor.ts';
import { mutate } from './audit.ts';
import { bindCustody, constraintOf, writeAgreements } from './backoffice.ts';
import { claimForSession } from './counter.ts';

/**
 * The fourteen routes the collector app has and the platform did not.
 *
 * `me.ts` is the collector's money, read-only. This file is everything the
 * phone WRITES plus the lists those writes need: registration, the six
 * agreements, training, the exam, the task hall, claiming, device binding and
 * session creation — APP-01 through APP-18. Before it, thirteen of the app's
 * sixteen calls fell back to the phone's own store, which is why every screen
 * showed invented work at invented prices.
 *
 * ---------------------------------------------------------------------------
 * THE COLLECTOR ID IS IN THE TOKEN AND NOWHERE ELSE
 *
 * Every route here is under `/api/me/` and none of them takes a collector id —
 * not in the path, not in the query, not in the body. `requireActor` in
 * `index.ts` enforces both halves of that scope, including the half people
 * forget: an operator or a reviewer token is refused here too, because "me"
 * has to mean one thing. There is no id in a request for collector A to swap
 * for collector B's, so the class of bug that needs a test per route has no
 * route to occur on.
 *
 * A task id, a device serial and a scenario code do appear. None of them names
 * a person, and each is checked against something this collector holds before
 * it decides anything.
 *
 * ---------------------------------------------------------------------------
 * NOTHING INTERNAL REACHES A COLLECTOR, INCLUDING A CONSTRAINT NAME
 *
 * `me.ts` states the rule and this file inherits it: no reason codes, no
 * signal ids, no operator notes, no reviewer names, no constraint names. The
 * last one is the one this file could have leaked, because the gates it depends
 * on are database triggers and the counter and the back office answer with the
 * trigger's own name — `task_claims_capacity`, `task_claims_consent_gate`.
 * Those names are for a console an operator reads.
 *
 * So `CLAIM_REFUSALS` below maps each constraint onto a collector-facing name,
 * and a constraint with no entry is re-thrown as a 500 rather than guessed at.
 * That is the same rule `guarded()` follows in backoffice.ts: a foreign key
 * failing on a column this file filled in itself is a bug and should read like
 * one, not like a polite refusal.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AUDITED, AND WHAT IT IS IDEMPOTENT ON
 *
 * Every write goes through `mutate`, so the audit row and the change commit
 * together; 0019 gave `audit_events` the collector attribution shape these rows
 * use. Two of the writes carry a client-generated id and follow the counter's
 * replay contract exactly — a claim and a session, the two that create a row of
 * their own, `onConflictDoNothing` on that id, and a read-back that tells a
 * replay from an id reused for something else.
 *
 * The other four have no id to carry because they have no row of their own:
 * registration and training are columns on the collector, the exam is two more,
 * and an acceptance is keyed `(collector, agreement, version)` by
 * `collector_agreements`'s own primary key. Each of those writes is idempotent
 * on the fact itself — re-posting sets the same value or writes nothing — which
 * is what the id is for on the other two. Inventing an id column so that all six
 * could look alike would add a table and a write path to make a comment tidier.
 */

/** Same structural reply shape the other route files use for a preHandler. */
type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

const uuid = z.string().uuid();
const text = z.string().trim().min(1);

/**
 * APP-02 / PRV-01: the six agreements and the version of each that is current.
 *
 * The names are the closed set `collector_agreements_name_check` already
 * carries — the database is what refuses a seventh — and the versions are the
 * server's to state, which is the whole reason this list is here and not in the
 * app. An acceptance names the version the collector was SHOWN, so if the phone
 * could choose that string it could record consent to terms nobody presented.
 * `POST /api/me/agreements` refuses any pair that is not on this list.
 *
 * ponytail: a constant, not a table. Legal has published one version of each and
 * a reissue is a code change on the day it happens — the same day somebody has
 * to write the re-consent flow that is P2 and unspecified. A table would be
 * configuration nobody sets and a second place for the six names to disagree
 * with the CHECK.
 */
export const CURRENT_AGREEMENTS: readonly { agreement: string; version: string }[] = [
  { agreement: 'user', version: '1.0' },
  { agreement: 'privacy', version: '1.0' },
  { agreement: 'data_collection', version: '1.0' },
  { agreement: 'commercial_use', version: '1.0' },
  { agreement: 'manual_review', version: '1.0' },
  { agreement: 'offline_settlement', version: '1.0' },
];

/**
 * APP-04's exam: the mechanism, and deliberately not the content.
 *
 * PaXini owes the questions (a D-item in the brief), so what exists here is the
 * shell the app already talks to — three true/false checks that a collector
 * confirms — and the grading, which is server-side because APP-05 is P0 and a
 * pass decides whether somebody may take paid work. The key never leaves this
 * process: the route takes answers and returns a verdict.
 *
 * When PaXini delivers the real paper this becomes a catalogue and a route that
 * serves it. The gate it feeds does not change: a pass is
 * `collectors.exam_result`, which `task_claims_guard` has read since 0006.
 */
export const EXAM_ANSWERS: readonly boolean[] = [true, true, true];

/**
 * The refusals this file raises, in the words a collector reads.
 *
 * Same shape and same purpose as `UPLOAD_API_REFUSALS` in collector-upload.ts:
 * each is a thing a person can ask for that the rules say no to, each gets a
 * sentence in `i18n.ts` in all three languages, and none of them is a database
 * constraint name. `CLAIM_REFUSALS` below is the map from the constraint that
 * actually fired to the name that is sent.
 */
export const COLLECTOR_API_REFUSALS = new Set([
  /** No task by that id, or none this collector may look at. */
  'task_not_found',
  /** The task exists but is not published, so it cannot be claimed or recorded against. */
  'task_not_claimable',
  /** Every slot on the task is taken (APP-10). */
  'task_at_capacity',
  /** This collector already holds a live claim on it. */
  'already_claimed',
  /** APP-05, the P0 gate: no exam pass, no claiming. */
  'exam_not_passed',
  /** The collector is `pending` or `suspended`, so no claim is allowed. */
  'not_qualified',
  /** Fewer than the six agreements are on record (APP-02 / PRV-01). */
  'agreements_incomplete',
  /** The claim id sent already names a different claim. */
  'claim_id_reused',
  /** The claim id sent names a claim this collector has since released. */
  'claim_released',
  /** An acceptance named an agreement or a version that is not current. */
  'agreement_version_unknown',
  /** No device on the fleet carries that serial. */
  'device_not_found',
  /** The device is retired, so nobody may hold it. */
  'device_not_available',
  /** Another collector holds that device. */
  'already_bound',
  /** The session names a device this collector has not bound (APP-15). */
  'device_not_bound',
  /** The session names a task this collector holds no live claim on. */
  'task_not_claimed',
  /** No scenario by that code. */
  'scenario_not_found',
  /** The session id sent already names a different session. */
  'session_id_reused',
]);

/**
 * Which named constraint refused a claim, and what the collector is told.
 *
 * `task_claims_guard` (migration 0006) is where APP-05, the qualification gate,
 * the consent gate and the capacity cap actually live, and reusing it is the
 * point: a gate that lives in one route is a gate one route can forget, and
 * this route is the second one. So nothing here re-checks anything. It inserts,
 * and it translates what the database said.
 *
 * A `Record`, not a lookup with a default: a constraint that is not on this list
 * is re-thrown and becomes a 500. A foreign key failing on a column this file
 * filled in itself is a bug, and a bug that answers 409 with a soothing sentence
 * is a bug nobody finds.
 */
const CLAIM_REFUSALS: Record<string, string> = {
  task_claims_published_gate: 'task_not_claimable',
  task_claims_exam_gate: 'exam_not_passed',
  task_claims_qualified_gate: 'not_qualified',
  task_claims_consent_gate: 'agreements_incomplete',
  task_claims_capacity: 'task_at_capacity',
  task_claims_live_key: 'already_claimed',
  task_claims_task_id_tasks_id_fk: 'task_not_found',
  devices_retired_unbound_check: 'device_not_available',
};

/** What a collector is told about themselves. No status, no operator note. */
type Profile = {
  id: string;
  /** Null until they have registered. The app reads that as "not registered yet". */
  name: string | null;
  phone: string | null;
  agreements: { agreement: string; version: string; accepted_at: string }[];
  training_done: boolean;
  exam_passed: boolean;
};

type TaskRow = {
  id: string;
  name: string;
  type: string | null;
  unit_price: string;
  target_effective_duration_s: string | null;
  /** Reviewed effective time already recorded against this task, in seconds. */
  collected_effective_s: string;
  max_concurrent_claimants: number;
  claimants: number;
  claimed_by_me: boolean;
  published: boolean;
};

export type CollectorAppOptions = {
  /** What `tasks.unit_price` is denominated in. Same option the counter takes. */
  currency?: string;
};

export function registerCollectorApp(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: CollectorAppOptions = {},
): void {
  const opts = { preHandler: requireActor };
  const currency = options.currency ?? 'VND';

  /**
   * `req.collector`, not `req.actor`. `requireActor` sets the collector claims
   * there and returns before `req.actor` is ever assigned, precisely so no
   * handler expecting an operator can be handed one. The route guard has
   * already refused every other kind of session under `/api/me/`, so the claims
   * are present by the time anything here runs.
   */
  const actorOf = (req: FastifyRequest): CollectorActor => ({ collector: req.collector! });
  const meOf = (req: FastifyRequest): string => req.collector!.collectorId;

  /**
   * 409 is "the rules refuse what you asked for", which is every refusal in
   * this file but one: a task that is not there is a 404, and it still carries
   * the name so the app has a sentence rather than a bare status.
   */
  const refused = (reply: Reply, constraint: string, status = 409) =>
    reply.code(status).send({ error: 'refused', constraint });

  /**
   * Runs a write and separates "the rules said no" from "this code is wrong",
   * translating the constraint on the way out. Same shape as `guarded()` in
   * backoffice.ts, and the translation is the difference: an operator gets the
   * constraint, a collector gets a word for it.
   */
  async function guarded<T>(
    run: () => Promise<T | undefined>,
  ): Promise<{ ok: true; value: T | undefined } | { ok: false; constraint: string }> {
    try {
      return { ok: true, value: await run() };
    } catch (err) {
      const name = constraintOf(err);
      const mapped = name === undefined ? undefined : CLAIM_REFUSALS[name];
      if (mapped !== undefined) return { ok: false, constraint: mapped };
      throw err;
    }
  }

  // -- the collector themselves (APP-01 to APP-05) --------------------------

  async function profileOf(collectorId: string): Promise<Profile | undefined> {
    const [row] = await db
      .select({
        id: schema.collectors.id,
        name: schema.collectors.name,
        phone: schema.collectors.phone,
        trainingCompletedAt: schema.collectors.trainingCompletedAt,
        examResult: schema.collectors.examResult,
      })
      .from(schema.collectors)
      .where(eq(schema.collectors.id, collectorId));
    if (row === undefined) return undefined;
    const accepted = await db
      .select({
        agreement: schema.collectorAgreements.agreement,
        version: schema.collectorAgreements.version,
        acceptedAt: schema.collectorAgreements.acceptedAt,
      })
      .from(schema.collectorAgreements)
      .where(eq(schema.collectorAgreements.collectorId, collectorId))
      .orderBy(schema.collectorAgreements.agreement, schema.collectorAgreements.version);
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      agreements: accepted.map((a) => ({
        agreement: a.agreement,
        version: a.version,
        accepted_at: a.acceptedAt.toISOString(),
      })),
      training_done: row.trainingCompletedAt !== null,
      /**
       * `= 'pass'`, so a recorded fail is false and so is an exam nobody has
       * sat. The app shows the same screen for both; the difference is a
       * conversation at a counter, and `collectors.exam_result` is where an
       * operator reads it.
       */
      exam_passed: row.examResult === 'pass',
    };
  }

  /** Every route below answers from the row, so a missing row is a dead token. */
  const mustProfile = async (reply: Reply, collectorId: string): Promise<Profile | null> => {
    const profile = await profileOf(collectorId);
    if (profile === undefined) {
      reply.code(401).send({ error: 'collector token required' });
      return null;
    }
    return profile;
  };

  app.get('/api/me/profile', opts, async (req, reply) => {
    const profile = await mustProfile(reply, meOf(req));
    return profile === null ? reply : profile;
  });

  /**
   * APP-01. The name, against the number they signed in with.
   *
   * The row already exists and that is not an error — it is the normal case. A
   * collector reaches this route holding a token, and a token is issued by
   * `/auth/collector/verify` against a `collectors` row with that phone number
   * on it, so either a counter operator enrolled them (BO-03) or an earlier
   * registration did. Registration therefore records what this platform did not
   * know, which is what they are called.
   *
   * The phone is NOT read from the body even though the app sends one, for the
   * reason the counter gives about a centre: anything the token already proves
   * is taken from the token and simply not consulted. Writing a phone from a
   * body would let one collector claim another's number, which is the
   * credential this platform signs people in with.
   */
  app.post('/api/me/register', opts, async (req, reply) => {
    const body = z.object({ name: text }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const me = meOf(req);
    const before: { name: string | null } = { name: null };

    const written = await mutate(
      db,
      actorOf(req),
      {
        action: 'collector.register',
        targetTable: 'collectors',
        targetId: me,
        before,
        after: { name: body.data.name },
      },
      async (tx) => {
        const [held] = await tx
          .select({ name: schema.collectors.name })
          .from(schema.collectors)
          .where(eq(schema.collectors.id, me))
          .for('update');
        if (held === undefined) return undefined;
        // Re-posting the same name writes nothing and audits nothing: the
        // registration screen is one a phone with a bad connection retries.
        if (held.name === body.data.name) return undefined;
        before.name = held.name;
        const [row] = await tx
          .update(schema.collectors)
          .set({ name: body.data.name, updatedAt: new Date() })
          .where(eq(schema.collectors.id, me))
          .returning({ id: schema.collectors.id });
        return row;
      },
    );

    const profile = await mustProfile(reply, me);
    if (profile === null) return reply;
    return reply.code(written === undefined ? 200 : 201).send(profile);
  });

  /** APP-02 / PRV-01: the six, at the versions this server is presenting. */
  app.get('/api/me/agreements', opts, async (req, reply) => {
    const profile = await mustProfile(reply, meOf(req));
    if (profile === null) return reply;
    const onRecord = new Map(
      profile.agreements.map((a) => [`${a.agreement} ${a.version}`, a.accepted_at]),
    );
    return {
      agreements: CURRENT_AGREEMENTS.map((a) => ({
        ...a,
        accepted_at: onRecord.get(`${a.agreement} ${a.version}`) ?? null,
      })),
    };
  });

  /**
   * APP-02 / PRV-01: record what they accepted, and when.
   *
   * `accepted_at` is stamped here and never taken from the body. This is the
   * one record a regulator reads back years later, and a phone's clock is not
   * evidence of when a person agreed to anything.
   *
   * Idempotent with no id of its own: `collector_agreements` is keyed
   * `(collector, agreement, version)` and the insert is `onConflictDoNothing`,
   * so a re-post keeps the original moment. `writeAgreements` is the back
   * office's own function and returns what LANDED rather than what was asked
   * for, which is what the audit row records — a consent trail that disagrees
   * with the consent table is worse than none.
   */
  app.post('/api/me/agreements', opts, async (req, reply) => {
    const body = z
      .object({ agreements: z.array(z.object({ agreement: text, version: text })).min(1) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const me = meOf(req);
    const current = new Set(CURRENT_AGREEMENTS.map((a) => `${a.agreement} ${a.version}`));
    const unknown = body.data.agreements.find(
      (a) => !current.has(`${a.agreement} ${a.version}`),
    );
    if (unknown !== undefined) return refused(reply, 'agreement_version_unknown');

    const acceptedAt = new Date().toISOString();
    const landed: unknown[] = [];
    await mutate(
      db,
      actorOf(req),
      { action: 'collector.accept_agreements', targetTable: 'collectors', targetId: me, after: landed },
      async (tx) => {
        const written = await writeAgreements(
          tx,
          me,
          body.data.agreements.map((a) => ({ ...a, accepted_at: acceptedAt })),
        );
        landed.push(...written);
        // Nothing new on record is a replay: no row, and so no audit row.
        return written.length === 0 ? undefined : written;
      },
    );

    const profile = await mustProfile(reply, me);
    return profile === null ? reply : profile;
  });

  /**
   * APP-03. Training seen.
   *
   * The instant, written once. A second call finds it already set, writes
   * nothing and audits nothing — the same replay shape as registration.
   *
   * Nothing gates on it yet, and `0021_collector_app.sql` says why: pilot
   * training happens in a room, nothing has ever recorded it, and adding it to
   * `task_claims_guard` today would make every collector already on the
   * platform unclaimable.
   */
  app.post('/api/me/training', opts, async (req, reply) => {
    const me = meOf(req);
    await mutate(
      db,
      actorOf(req),
      { action: 'collector.training_complete', targetTable: 'collectors', targetId: me },
      async (tx) => {
        const [row] = await tx
          .update(schema.collectors)
          .set({ trainingCompletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.collectors.id, me), isNull(schema.collectors.trainingCompletedAt)))
          .returning({ id: schema.collectors.id });
        return row;
      },
    );
    const profile = await mustProfile(reply, me);
    return profile === null ? reply : profile;
  });

  /**
   * APP-04 and APP-05. Grade the exam here, record the result, and let the
   * gate that already exists do the rest.
   *
   * The answers are graded server-side and the key never leaves this process.
   * The result lands in `collectors.exam_result`, which `task_claims_guard` has
   * read since migration 0006 — so this route does not enforce APP-05, it feeds
   * the one place that does.
   *
   * A pass is never overwritten by a later fail. APP-07's retake policy is P2
   * and undecided, so the narrow rule is the safe one: somebody who has passed
   * has passed, and clearing a result recorded against the wrong person is the
   * back office's `PATCH /api/collectors/:id` with `exam: null`.
   */
  app.post('/api/me/exam', opts, async (req, reply) => {
    const body = z
      .object({ answers: z.array(z.boolean()).length(EXAM_ANSWERS.length) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const me = meOf(req);
    const passed = body.data.answers.every((a, i) => a === EXAM_ANSWERS[i]);

    await mutate(
      db,
      actorOf(req),
      {
        action: 'collector.exam',
        targetTable: 'collectors',
        targetId: me,
        // The verdict, never the answers: a stored answer sheet is the exam
        // key written down in a table anybody with a database can read.
        after: { exam_result: passed ? 'pass' : 'fail' },
      },
      async (tx) => {
        const [row] = await tx
          .update(schema.collectors)
          .set({
            examResult: passed ? 'pass' : 'fail',
            examDecidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.collectors.id, me),
              // Both halves matter. A pass stands; a repeat of the same verdict
              // is a replay and writes nothing.
              passed
                ? sql`${schema.collectors.examResult} is distinct from 'pass'`
                : sql`${schema.collectors.examResult} is null`,
            ),
          )
          .returning({ id: schema.collectors.id });
        return row;
      },
    );

    return { passed };
  });

  // -- the task hall (APP-08, APP-09) ---------------------------------------

  /**
   * The hall, and one task in it.
   *
   * `collected_effective_s` is APP-08's "current progress": the reviewed
   * effective time already recorded against this task by everybody, which is
   * the figure the target is a target for. It is summed from `settlements`,
   * which is where a human's judgement of which seconds were useful ends up,
   * and superseded rows are excluded because a second verdict replaced them.
   * Nothing is estimated: an episode nobody has reviewed contributes nothing,
   * for the reason `me.ts` gives about `effective_minutes`.
   *
   * The multiplication by 60 is exact numeric arithmetic in Postgres and is not
   * a rounding site; `quantise` stays the only one.
   *
   * A collector sees published tasks, plus any task they still hold a claim on
   * — a task taken down under a live claim is still theirs to see and still
   * theirs to record against right up until it is not, and a claim pointing at
   * a task the hall refuses to describe is a dead screen.
   */
  async function taskRows(me: string, taskId?: string): Promise<TaskRow[]> {
    return (await db.execute(sql`
      select t.id, t.name, t.type, t.unit_price, t.target_effective_duration_s,
             t.max_concurrent_claimants,
             (t.status = 'published') as published,
             (select count(*)::int from task_claims c
               where c.task_id = t.id and c.released_at is null) as claimants,
             exists (select 1 from task_claims c
                      where c.task_id = t.id and c.collector_id = ${me}
                        and c.released_at is null) as claimed_by_me,
             coalesce((select sum(s.effective_minutes) * 60
                         from settlements s
                         join episode_reviews r on r.id = s.episode_review_id
                         join episodes e on e.episode_id = r.episode_id
                         join collection_sessions cs on cs.id = e.collection_session_id
                        where cs.task_id = t.id and s.superseded_by is null), 0)::text
               as collected_effective_s
        from tasks t
       where ${taskId === undefined ? sql`true` : sql`t.id = ${taskId}`}
         and (t.status = 'published'
              or exists (select 1 from task_claims c
                          where c.task_id = t.id and c.collector_id = ${me}
                            and c.released_at is null))
       order by t.created_at desc
    `)) as unknown as TaskRow[];
  }

  const taskBody = (row: TaskRow) => ({
    ...row,
    currency,
    /** Slots left, and whether this collector may take one right now. */
    remaining_slots: Math.max(0, row.max_concurrent_claimants - row.claimants),
    claimable: row.published && !row.claimed_by_me && row.claimants < row.max_concurrent_claimants,
  });

  app.get('/api/me/tasks', opts, async (req) => {
    const rows = await taskRows(meOf(req));
    return { tasks: rows.map(taskBody) };
  });

  app.get('/api/me/tasks/:id', opts, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id?: string }).id);
    // An unparseable uuid would reach Postgres as a cast error and read as a
    // 500 on a request that was only ever malformed.
    if (!id.success) return refused(reply, 'task_not_found', 404);
    const [row] = await taskRows(meOf(req), id.data);
    if (row === undefined) return refused(reply, 'task_not_found', 404);
    return taskBody(row);
  });

  // -- claiming (APP-10, APP-11) --------------------------------------------

  /**
   * APP-10, by the collector rather than by an operator on their behalf.
   *
   * There is deliberately no pre-flight count and no eligibility check here:
   * `task_claims_guard` holds the task row under `for update` and decides all
   * five questions — published, exam, qualification, consent, capacity — and a
   * count read before an insert is exactly the check that overshoots under
   * load. This route inserts and translates what the database said.
   */
  app.post('/api/me/tasks/:id/claims', opts, async (req, reply) => {
    const taskId = uuid.safeParse((req.params as { id?: string }).id);
    if (!taskId.success) return refused(reply, 'task_not_found');
    const body = z.object({ id: uuid }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const me = meOf(req);
    const b = body.data;

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'collector.claim',
          targetTable: 'task_claims',
          targetId: b.id,
          after: { task_id: taskId.data },
        },
        async (tx) => {
          const [row] = await tx
            .insert(schema.taskClaims)
            .values({ id: b.id, taskId: taskId.data, collectorId: me })
            .onConflictDoNothing({ target: schema.taskClaims.id })
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) {
      return reply.code(201).send({ id: b.id, task_id: taskId.data, replayed: false });
    }

    /**
     * Nothing was written because that id is already here, and there are two
     * ways for that to happen. The same claim arriving twice is a replay and
     * costs nothing. A different pairing under an id already in use is not:
     * answering 200 there says this collector holds this task when somebody
     * else does, on the one path that decides who may record and be paid.
     */
    const [held] = await db
      .select()
      .from(schema.taskClaims)
      .where(eq(schema.taskClaims.id, b.id));
    if (held === undefined || held.taskId !== taskId.data || held.collectorId !== me) {
      return refused(reply, 'claim_id_reused');
    }
    // The same pairing, released since. The slot went back to the task and
    // somebody else may hold it; claiming again is a new claim and a new id,
    // which is also what keeps the release on the record.
    if (held.releasedAt !== null) return refused(reply, 'claim_released');
    return reply.code(200).send({ id: b.id, task_id: taskId.data, replayed: true });
  });

  /** APP-11. The tasks this collector holds now. A released claim is not one. */
  app.get('/api/me/claims', opts, async (req) => {
    const rows = await db
      .select({
        id: schema.taskClaims.id,
        task_id: schema.taskClaims.taskId,
        task_name: schema.tasks.name,
        claimed_at: schema.taskClaims.claimedAt,
      })
      .from(schema.taskClaims)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskClaims.taskId))
      .where(and(eq(schema.taskClaims.collectorId, meOf(req)), isNull(schema.taskClaims.releasedAt)))
      .orderBy(desc(schema.taskClaims.claimedAt));
    return { claims: rows };
  });

  // -- devices (APP-14, APP-18) ---------------------------------------------

  /**
   * APP-18. The devices this collector holds.
   *
   * `status` is here because a collector whose camera has been marked faulty
   * should be told before they wear it. `fault_note` is NOT: it is free text an
   * operator typed, which is the class of thing `me.ts` keeps off this surface.
   */
  app.get('/api/me/devices', opts, async (req) => {
    const rows = await db
      .select({
        hardware_serial: schema.devices.hardwareSerial,
        status: schema.devices.status,
        bound_at: schema.devices.boundAt,
      })
      .from(schema.devices)
      .where(eq(schema.devices.boundCollectorId, meOf(req)))
      .orderBy(schema.devices.hardwareSerial);
    return { devices: rows };
  });

  /**
   * APP-14. Bind a camera by the serial stamped on it.
   *
   * By serial and not by uuid, because the serial is what is printed on the
   * hardware in the collector's hands and the uuid is a row id they have no way
   * to read. It resolves to a device the fleet already knows: this route creates
   * no device, so a serial nobody has enrolled is refused rather than invented.
   *
   * **The UPDATE decides, not a read before it.** Between a read and a write
   * another collector can bind the same device, and both would be told they
   * hold it. The `where` carries the condition — bind only a device nobody
   * holds — and the returned row is the answer. This is the same shape, and the
   * same custody write, as `POST /api/devices/:id/bind` in the back office; the
   * period is written by `bindCustody`, which both call, because
   * `devices.bound_collector_id` and `device_assignments` are two answers to
   * "who holds it" and nothing else keeps them in step.
   *
   * ponytail: the only guard is that nobody else holds it. A collector who
   * knows an unissued serial can bind a camera that is not in their hands, and
   * what that costs is the custody period on it — not money, because payment
   * attribution runs through the session and the handover and not through this
   * column, but a wrong period is a crosscheck that quarantines the real
   * holder's footage. It is the same guard the back office's own bind route has
   * and the fleet is twenty devices issued across a counter. The upgrade is to
   * bind only a device already allotted to this collector in
   * `device_assignments`; do it when devices are issued without a counter.
   */
  app.post('/api/me/devices', opts, async (req, reply) => {
    const body = z.object({ hardware_serial: text }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const me = meOf(req);
    const serial = body.data.hardware_serial;

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        /**
         * The event is a function of what the write returned, because the
         * device's id is not known until the UPDATE that matched it has run —
         * and `target_id` has to be the id, not the serial. SEC-04's question
         * is "who took this device off this collector", and it is asked of
         * `audit_events` by (target_table, target_id); a row filed under a
         * serial would not appear next to the back office's `device.bind`.
         */
        (row: { id: string }) => ({
          action: 'collector.bind_device',
          targetTable: 'devices',
          targetId: row.id,
          /** Not read, deduced: the `where` below only matches an unbound row. */
          before: { bound_collector_id: null },
          after: { bound_collector_id: me, hardware_serial: serial },
        }),
        async (tx) => {
          const at = new Date();
          const [row] = await tx
            .update(schema.devices)
            .set({ boundCollectorId: me, boundAt: at, updatedAt: at })
            .where(
              and(
                eq(schema.devices.hardwareSerial, serial),
                isNull(schema.devices.boundCollectorId),
              ),
            )
            .returning({ id: schema.devices.id });
          if (row === undefined) return undefined;
          await bindCustody(tx, row.id, me, at);
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) {
      return reply.code(201).send({ hardware_serial: serial, replayed: false });
    }

    /**
     * The UPDATE matched nothing. Either there is no such camera, or somebody
     * holds it — and if that somebody is this collector it is a replay. A
     * retired one never reaches here: `devices_retired_unbound_check` refuses
     * the write and `guarded` above answers `device_not_available`.
     */
    const [now] = await db
      .select({ bound: schema.devices.boundCollectorId })
      .from(schema.devices)
      .where(eq(schema.devices.hardwareSerial, serial));
    if (now === undefined) return refused(reply, 'device_not_found');
    if (now.bound !== me) return refused(reply, 'already_bound');
    return reply.code(200).send({ hardware_serial: serial, replayed: true });
  });

  // -- sessions (APP-16, APP-17b) -------------------------------------------

  const SessionBody = z.object({
    id: uuid,
    task_id: uuid,
    /** As stamped on the hardware, and bound to this collector. */
    device_serial: text,
    /** `scenarios.code`: the app's `home`, `office`, `shop`, `warehouse`. */
    scenario: text,
    /**
     * APP-17b. `z.boolean()` and not `.default(false)`: "no" is a real answer
     * and "nobody asked" is not, so a missing field is a 400 rather than
     * quietly becoming the safe-looking option. The database says NOT NULL,
     * this says present-and-boolean, and the app makes it a required choice.
     */
    others_in_frame: z.boolean(),
    sensitive_info_present: z.boolean(),
  });

  /**
   * APP-16. The session, bound before recording.
   *
   * The counter creates the same row when a card arrives (`counter.ts`), and
   * the halves that have to agree are shared rather than written twice:
   * `claimForSession` decides which claim this session hangs off and what it
   * paid, so a session declared on a phone and one reconstructed at a counter
   * cannot disagree about the price of the footage.
   *
   * What differs is what the schema already says differs. `session_origin` is
   * `app`, not `handover`, and `collection_sessions_handover_required_check`
   * is why there is no card behind it: APP-16 happens before there is one. The
   * collector comes off the token rather than off a handover, and `prepare_time`
   * is stamped here — this session is being prepared now, which is the one case
   * where the server's clock is the truthful answer rather than an operator's
   * recollection.
   */
  app.post('/api/me/sessions', opts, async (req, reply) => {
    const body = SessionBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid body', detail: body.error.issues.slice(0, 5) });
    }
    const me = meOf(req);
    const b = body.data;

    /** APP-15: no device binding, no collection. And it has to be this one's. */
    const [device] = await db
      .select({ id: schema.devices.id, bound: schema.devices.boundCollectorId })
      .from(schema.devices)
      .where(eq(schema.devices.hardwareSerial, b.device_serial));
    if (device === undefined) return refused(reply, 'device_not_found');
    if (device.bound !== me) return refused(reply, 'device_not_bound');

    const [scenario] = await db
      .select({ id: schema.scenarios.id })
      .from(schema.scenarios)
      .where(eq(schema.scenarios.code, b.scenario));
    if (scenario === undefined) return refused(reply, 'scenario_not_found');

    const claim = await claimForSession(db, b.task_id, me);
    // Missing and released are one sentence to a collector: you do not hold
    // this task. They are two at a counter, where the released one is footage
    // that may be real and unpayable, and `counter.ts` keeps them apart there.
    if (claim === undefined || claim.releasedAt !== null) return refused(reply, 'task_not_claimed');
    if (claim.status !== 'published') return refused(reply, 'task_not_claimable');

    const written = await mutate(
      db,
      actorOf(req),
      {
        action: 'collector.create_session',
        targetTable: 'collection_sessions',
        targetId: b.id,
        after: { ...b, task_claim_id: claim.id, unit_price: claim.unitPrice, currency },
      },
      async (tx) => {
        const [row] = await tx
          .insert(schema.collectionSessions)
          .values({
            id: b.id,
            taskId: b.task_id,
            taskClaimId: claim.id,
            unitPrice: claim.unitPrice,
            currency,
            collectorId: me,
            scenarioId: scenario.id,
            othersInFrame: b.others_in_frame,
            sensitiveInfoPresent: b.sensitive_info_present,
            sessionOrigin: 'app',
            prepareTime: new Date(),
          })
          .onConflictDoNothing({ target: schema.collectionSessions.id })
          .returning({ id: schema.collectionSessions.id });
        if (row === undefined) return undefined;
        // P2-01: devices bind through the join table, one per session in phase 1.
        await tx
          .insert(schema.collectionSessionDevices)
          .values({ collectionSessionId: row.id, deviceId: device.id, role: 'headset' })
          .onConflictDoNothing();
        return row;
      },
    );
    if (written !== undefined) return reply.code(201).send({ id: b.id, replayed: false });

    /**
     * Nothing was written because that id is already here. The same declaration
     * arriving twice is a replay; a different one under a used id is not, and
     * the two APP-17b answers are part of what makes it different — a session
     * is the record of what the collector declared, and a replay must not be
     * able to change it.
     */
    const [held] = await db
      .select()
      .from(schema.collectionSessions)
      .where(eq(schema.collectionSessions.id, b.id));
    if (
      held === undefined ||
      held.collectorId !== me ||
      held.taskId !== b.task_id ||
      held.scenarioId !== scenario.id ||
      held.othersInFrame !== b.others_in_frame ||
      held.sensitiveInfoPresent !== b.sensitive_info_present
    ) {
      return refused(reply, 'session_id_reused');
    }
    return reply.code(200).send({ id: b.id, replayed: true });
  });

  /** The sessions this collector has declared, newest first. */
  app.get('/api/me/sessions', opts, async (req) => {
    const rows = await db
      .select({
        id: schema.collectionSessions.id,
        task_id: schema.collectionSessions.taskId,
        task_name: schema.tasks.name,
        scenario: schema.scenarios.code,
        device_serial: schema.devices.hardwareSerial,
        others_in_frame: schema.collectionSessions.othersInFrame,
        sensitive_info_present: schema.collectionSessions.sensitiveInfoPresent,
        created_at: schema.collectionSessions.createdAt,
      })
      .from(schema.collectionSessions)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.collectionSessions.taskId))
      .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.collectionSessions.scenarioId))
      /**
       * Left, not inner: phase 1 always writes one device row, and a session
       * that somehow has none must still appear on the screen it was declared
       * on rather than vanish from the collector's own list.
       */
      .leftJoin(
        schema.collectionSessionDevices,
        eq(schema.collectionSessionDevices.collectionSessionId, schema.collectionSessions.id),
      )
      .leftJoin(schema.devices, eq(schema.devices.id, schema.collectionSessionDevices.deviceId))
      .where(eq(schema.collectionSessions.collectorId, meOf(req)))
      .orderBy(desc(schema.collectionSessions.createdAt));
    return { sessions: rows };
  });
}
