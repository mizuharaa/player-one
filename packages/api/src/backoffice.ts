import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { z } from 'zod';
import { mutate } from './audit.ts';
import type { Actor } from './actor.ts';

/**
 * The back office: tasks, collectors and devices (BO-01 → BO-04).
 *
 * Three rules run through every endpoint here, and two of them are the same
 * rules the counter follows.
 *
 * **Ids are client-generated and every create is idempotent** on that id, the
 * same `onConflictDoNothing` shape `counter.ts` uses. A back office is online
 * where a counter is not, but a double-submitted form is the same problem as a
 * replayed queue and it already has an answer here.
 *
 * **Every mutation goes through `mutate`**, so the audit row and the change
 * commit together. SEC-04 names device unbinding explicitly, which is why bind
 * and unbind are two routes with two action names rather than one PATCH that
 * sets a column: "who took this device off this collector, and when" has to be
 * greppable in `audit_events`, not inferable from a diff of two `after` blobs.
 *
 * **The refusals come from the database, not from here.** Task capacity, the
 * APP-05 exam gate and the legal task transitions are a trigger in migration
 * 0006 (`task_claims_guard`, `tasks_status_transition`). This file turns the
 * constraint name into a 409 with a machine-readable reason; it does not
 * re-implement the check, because a second copy is a second thing to get wrong
 * and would still not protect a writer that is not this file.
 */

const uuid = z.string().uuid();

/**
 * A name, a reference, a serial: trimmed, and then non-empty.
 *
 * `min(1)` alone accepts a single space, which is not a refusal the operator
 * ever meant to make and, for an agreement version, is a 500 —
 * `collector_agreements_version_check` tests `length(trim(version)) > 0` and
 * fires below the route, where nothing maps it to a sentence. Trimming first
 * makes the field mean what the column means.
 */
const text = z.string().trim().min(1);

/**
 * Postgres `integer`, said out loud.
 *
 * `z.number().int().positive()` stops at "a positive whole number", which
 * includes 2^31 — accepted by the form, accepted by the validator, and then an
 * out-of-range error from the column that reaches the operator as a 500.
 */
const int4 = z.number().int().positive().max(2147483647);

/**
 * A decimal as the client sends it: a string, never a number.
 *
 * `unit_price` is multiplied into a payment. Parsing it to a float here and
 * formatting it back would be a rounding site, and money rounds in exactly one
 * place (`money.ts`). So it travels as text from the form to the `numeric`
 * column and nothing in between looks at it as a number.
 *
 * The bounds are the column's own, and are written the way the column
 * declares them - `numeric(precision, scale)` - because getting that pair
 * wrong is silent. `numeric(12, 4)` is EIGHT digits before the point and four
 * after, not twelve and four; a validator that allowed twelve let
 * `123456789.0000` through the form and into a Postgres overflow, which
 * reaches the operator as a 500 on a figure nothing had told them was too
 * large.
 */
const decimal = (precision: number, scale: number) =>
  z
    .string()
    .regex(
      new RegExp(`^\\d{1,${precision - scale}}(\\.\\d{1,${scale}})?$`),
      `expected up to ${precision - scale} digits and ${scale} decimals`,
    );

const TaskBody = z.object({
  id: uuid,
  name: text,
  /** APP-08 lists it in the task hall; no closed set, the taxonomy is PaXini's. */
  type: text,
  unit_price: decimal(12, 4),
  target_effective_duration_s: decimal(20, 6).optional(),
  max_concurrent_claimants: int4,
});

const TaskPatch = z
  .object({
    name: text.optional(),
    type: text.optional(),
    unit_price: decimal(12, 4).optional(),
    target_effective_duration_s: decimal(20, 6).nullable().optional(),
    max_concurrent_claimants: int4.optional(),
    status: z.enum(['draft', 'published', 'taken_down']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

const AGREEMENTS = [
  'user',
  'privacy',
  'data_collection',
  'commercial_use',
  'manual_review',
  'offline_settlement',
] as const;

/** APP-02 / PRV-01: each acceptance carries the version accepted and when. */
const Agreement = z.object({
  agreement: z.enum(AGREEMENTS),
  version: text,
  accepted_at: z.string().datetime(),
});

const CollectorBody = z.object({
  id: uuid,
  external_ref: text,
  status: z.enum(['pending', 'qualified', 'suspended']).optional(),
  agreements: z.array(Agreement).optional(),
});

const CollectorPatch = z
  .object({
    status: z.enum(['pending', 'qualified', 'suspended']).optional(),
    /**
     * APP-04. `null` clears an exam result and is a real instruction — an exam
     * recorded against the wrong person has to be removable — so it is spelled
     * rather than implied by omission.
     */
    exam: z
      .object({ result: z.enum(['pass', 'fail']), decided_at: z.string().datetime() })
      .nullable()
      .optional(),
    agreements: z.array(Agreement).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

const DeviceBody = z.object({
  id: uuid,
  device_type_id: uuid,
  /**
   * As stamped on the hardware: `AZER76400FE`. Unique, and deliberately without
   * a format CHECK — the engine's own basename parser accepts any token that is
   * not an underscore, and PaXini has published no serial grammar. A pattern
   * invented here is the one thing that could refuse a real device at a counter.
   */
  hardware_serial: text,
  firmware_version: text.optional(),
});

const DevicePatch = z
  .object({
    firmware_version: text.nullable().optional(),
    status: z.enum(['active', 'faulty', 'retired']).optional(),
    fault_note: z.string().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/**
 * An allotment starts; it does not carry an end. The end of one period is the
 * start of the next, written by the next POST, so an operator is never asked to
 * type a date twice and the two can never disagree.
 */
const AssignmentBody = z.object({
  id: uuid,
  collector_id: uuid,
  valid_from: z.string().datetime(),
});

type Reply = {
  code: (n: number) => { send: (b: unknown) => unknown };
};

/**
 * Which named constraint refused a statement, walked off the error chain.
 *
 * Same walk as `violates()` in the store's test helper, and for the same
 * reason: drizzle wraps the driver error as "Failed query: …" and keeps
 * postgres.js's `constraint_name` on the cause. Matching the wrapper's message
 * would map any failure — including a bug in the query above — onto a polite
 * 409 that says the task is full.
 */
function constraintOf(err: unknown): string | undefined {
  for (let e: unknown = err; e !== null && e !== undefined; e = (e as { cause?: unknown }).cause) {
    const name = (e as { constraint_name?: string }).constraint_name;
    if (name !== undefined && name !== '') return name;
  }
  return undefined;
}

/**
 * The constraints a person can trip by asking for something the rules refuse,
 * as opposed to the ones that mean this code is wrong.
 *
 * Only these become a 409. Anything else propagates as a 500, because a
 * foreign key failing on a column the route filled in itself is a bug and
 * should read like one.
 */
export const REFUSALS = new Set([
  'task_claims_capacity',
  'task_claims_exam_gate',
  'task_claims_qualified_gate',
  'task_claims_consent_gate',
  'task_claims_published_gate',
  'task_claims_live_key',
  'task_claims_history_immutable',
  'task_claims_identity_immutable',
  'tasks_status_transition',
  'tasks_price_frozen',
  'tasks_capacity_below_live',
  'collector_agreements_append_only',
  'devices_retired_unbound_check',
  'collectors_external_ref_key',
  'devices_hardware_serial_key',
  /**
   * A foreign key is usually this code being wrong, and these four are the
   * exception: every one of them names a row the OPERATOR chose from a list
   * that can go stale between the read and the click. Claiming a task another
   * operator has just deleted, or binding to a collector who is no longer
   * there, is a person asking for something that is not available — which is a
   * sentence on the screen, not a 500.
   */
  'task_claims_task_id_tasks_id_fk',
  'task_claims_collector_id_collectors_id_fk',
  'devices_bound_collector_id_collectors_id_fk',
  'devices_device_type_id_device_types_id_fk',
  'device_assignments_no_overlap',
  'device_assignments_device_id_devices_id_fk',
  'device_assignments_collector_id_collectors_id_fk',
]);

/**
 * The refusals this file raises itself, which no constraint can express: they
 * are all "the id you sent already names something else". Kept apart from
 * `REFUSALS` because that set is checked against the database, and a name in it
 * that no constraint carries would make the check meaningless.
 */
export const API_REFUSALS = new Set([
  'device_already_bound',
  'task_claims_id_reused',
  'task_claims_released',
  'tasks_id_reused',
  'collectors_id_reused',
  'devices_id_reused',
]);

/**
 * Both lists have to hold every refusal a person can trip, and adding a
 * constraint to migration 0006 without adding it here is the easy mistake: the
 * refusal still works, but it arrives as a 500 and the console shows the
 * generic failure instead of the sentence that says why. `every refusal the
 * schema can raise reaches the console as a sentence` in the test file reads
 * the constraints out of the live database and out of the migration's own SQL,
 * rather than walking this set, so an omission here is what fails.
 */

export function registerBackOffice(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
): void {
  const opts = { preHandler: requireActor };
  const actorOf = (req: FastifyRequest): Actor => req.actor!;

  /**
   * Runs a write and separates "the rules said no" from "this code is wrong".
   *
   * A result rather than a reply, so the caller decides the status code and the
   * value stays typed. Anything not in `REFUSALS` is re-thrown and becomes a
   * 500, which is what a foreign key failing on a column this file filled in
   * itself should look like.
   */
  async function guarded<T>(
    run: () => Promise<T | undefined>,
  ): Promise<{ ok: true; value: T | undefined } | { ok: false; constraint: string }> {
    try {
      return { ok: true, value: await run() };
    } catch (err) {
      const name = constraintOf(err);
      if (name !== undefined && REFUSALS.has(name)) return { ok: false, constraint: name };
      throw err;
    }
  }

  const refused = (reply: Reply, constraint: string) =>
    reply.code(409).send({ error: 'refused', constraint });

  /**
   * The id in the path, or `null` when it is not one.
   *
   * Every id here is a `uuid` column, so an unparseable one is a cast error
   * raised by Postgres — a 500 on a request that was simply malformed, and one
   * a stale bookmark or a hand-typed URL is enough to produce.
   */
  const pathId = (req: FastifyRequest): string | null => {
    const parsed = uuid.safeParse((req.params as { id?: string }).id);
    return parsed.success ? parsed.data : null;
  };

  /**
   * A create that wrote nothing, because that id is already taken.
   *
   * `match` re-reads the row with every field the request asked for in the
   * `where`, so the comparison happens in Postgres and `unit_price` is compared
   * as a number by the column that holds it — `1200` and `1200.0000` are the
   * same figure, and nothing in this file has to parse a price to know that.
   *
   * A row back means the request is a replay and costs nothing. No row means
   * the id names something else, and answering 200 there tells the operator the
   * terms on their form are the terms in the table when they are not. That is
   * also the answer when somebody edited the row between the first submit and
   * its retry, and it is still the right one: the id already names something
   * that is not what you just described, so go and look at it.
   */
  const replayOf = async (
    reply: Reply,
    id: string,
    constraint: string,
    match: PromiseLike<unknown[]>,
  ) =>
    (await match).length === 0
      ? reply.code(409).send({ error: 'refused', constraint })
      : reply.code(200).send({ id, replayed: true });

  // -- tasks (BO-01, BO-02) -------------------------------------------------

  app.get('/api/tasks', opts, async () => {
    /**
     * The live claimant count alongside each task, because "3 of 5 claimed" is
     * the number BO-02 configures and APP-08 displays, and computing it in the
     * browser would need every claim row on the wire.
     */
    const rows = await db
      .select({
        id: schema.tasks.id,
        name: schema.tasks.name,
        type: schema.tasks.type,
        unit_price: schema.tasks.unitPrice,
        target_effective_duration_s: schema.tasks.targetEffectiveDurationS,
        max_concurrent_claimants: schema.tasks.maxConcurrentClaimants,
        status: schema.tasks.status,
        created_at: schema.tasks.createdAt,
        claimants: sql<number>`count(${schema.taskClaims.id})::int`,
      })
      .from(schema.tasks)
      .leftJoin(
        schema.taskClaims,
        and(eq(schema.taskClaims.taskId, schema.tasks.id), isNull(schema.taskClaims.releasedAt)),
      )
      .groupBy(schema.tasks.id)
      .orderBy(desc(schema.tasks.createdAt));
    return { tasks: rows };
  });

  app.post('/api/tasks', opts, async (req, reply) => {
    const body = TaskBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    /** BO-01 creates a draft. Publishing is its own decision, and its own audit row. */
    const attempt = await guarded(() =>
      mutate(db, actorOf(req), { action: 'task.create', targetTable: 'tasks', targetId: b.id, after: b }, async (tx) => {
        const [row] = await tx
          .insert(schema.tasks)
          .values({
            id: b.id,
            name: b.name,
            type: b.type,
            unitPrice: b.unit_price,
            targetEffectiveDurationS: b.target_effective_duration_s ?? null,
            maxConcurrentClaimants: b.max_concurrent_claimants,
            status: 'draft',
          })
          .onConflictDoNothing({ target: schema.tasks.id })
          .returning();
        return row;
      }),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) return reply.code(201).send({ id: b.id, replayed: false });
    return replayOf(
      reply,
      b.id,
      'tasks_id_reused',
      db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, b.id),
            eq(schema.tasks.name, b.name),
            eq(schema.tasks.type, b.type),
            eq(schema.tasks.unitPrice, b.unit_price),
            b.target_effective_duration_s === undefined
              ? isNull(schema.tasks.targetEffectiveDurationS)
              : eq(schema.tasks.targetEffectiveDurationS, b.target_effective_duration_s),
            eq(schema.tasks.maxConcurrentClaimants, b.max_concurrent_claimants),
          ),
        ),
    );
  });

  app.patch('/api/tasks/:id', opts, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const body = TaskPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    /**
     * The `before` is read inside the transaction and under `for update`, and
     * every editable field is in it.
     *
     * Read outside, it is a guess: two operators editing the same task both
     * record the state they saw, and the audit trail then shows two changes
     * from the same starting point, which is a chronology that never happened.
     * The lock also holds the row for the two triggers that have to see it
     * whole — `tasks_price_frozen` and `tasks_capacity_below_live`.
     *
     * `mutate` reads the event only after the write returns, so filling this in
     * inside the callback is in time; it is filled IN PLACE because the event
     * holds the reference.
     */
    const before: Record<string, unknown> = {};

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: b.status === undefined ? 'task.edit' : `task.${b.status}`,
          targetTable: 'tasks',
          targetId: id,
          before,
          after: b,
        },
        async (tx) => {
          const [held] = await tx
            .select()
            .from(schema.tasks)
            .where(eq(schema.tasks.id, id))
            .for('update');
          if (held === undefined) return undefined;
          Object.assign(before, {
            name: held.name,
            type: held.type,
            unit_price: held.unitPrice,
            target_effective_duration_s: held.targetEffectiveDurationS,
            max_concurrent_claimants: held.maxConcurrentClaimants,
            status: held.status,
          });
          const [row] = await tx
            .update(schema.tasks)
            .set({
              name: b.name,
              type: b.type,
              unitPrice: b.unit_price,
              targetEffectiveDurationS: b.target_effective_duration_s,
              maxConcurrentClaimants: b.max_concurrent_claimants,
              status: b.status,
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, id))
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value === undefined) return reply.code(404).send({ error: 'no such task' });
    return reply.send({ id, status: attempt.value.status });
  });

  /**
   * APP-10. The two things that can refuse this — capacity and the exam — are
   * both in `task_claims_guard`, so this route inserts and reports what the
   * database said. There is deliberately no pre-flight count here: a count read
   * before an insert is exactly the check that overshoots under load.
   */
  app.post('/api/tasks/:id/claims', opts, async (req, reply) => {
    const taskId = pathId(req);
    if (taskId === null) return reply.code(400).send({ error: 'invalid id' });
    const body = z.object({ id: uuid, collector_id: uuid }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        { action: 'task.claim', targetTable: 'task_claims', targetId: b.id, after: { ...b, task_id: taskId } },
        async (tx) => {
          const [row] = await tx
            .insert(schema.taskClaims)
            .values({ id: b.id, taskId, collectorId: b.collector_id })
            .onConflictDoNothing({ target: schema.taskClaims.id })
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) return reply.code(201).send({ id: b.id, replayed: false });

    /**
     * Nothing was written because that id is already here — and there are two
     * ways for that to happen. The same claim arriving twice is a replay and
     * costs nothing. A DIFFERENT pairing sent under an id already in use is not:
     * answering 200 there tells the caller that this collector holds this task
     * when somebody else does, on the one path where the answer decides who is
     * allowed to record and be paid. So the row is read back and compared.
     */
    const [held] = await db
      .select()
      .from(schema.taskClaims)
      .where(eq(schema.taskClaims.id, b.id));
    if (held === undefined || held.taskId !== taskId || held.collectorId !== b.collector_id) {
      return reply.code(409).send({ error: 'refused', constraint: 'task_claims_id_reused' });
    }
    /**
     * The same pairing, but that claim has been released since. A replay is
     * "you already have this", and this collector does not: the slot went back
     * to the task and somebody else may be holding it. Claiming again is a new
     * claim and needs a new id, which is also what keeps the release on the
     * record instead of overwriting it.
     */
    if (held.releasedAt !== null) {
      return reply.code(409).send({ error: 'refused', constraint: 'task_claims_released' });
    }
    return reply.code(200).send({ id: b.id, replayed: true });
  });

  /** Releasing is what makes a slot reusable; without it a cap is a one-way door. */
  app.post('/api/task-claims/:id/release', opts, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const written = await mutate(
      db,
      actorOf(req),
      { action: 'task.release', targetTable: 'task_claims', targetId: id },
      async (tx) => {
        const [row] = await tx
          .update(schema.taskClaims)
          .set({ releasedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.taskClaims.id, id), isNull(schema.taskClaims.releasedAt)))
          .returning();
        return row;
      },
    );
    if (written !== undefined) {
      return reply.send({ id, released_at: written.releasedAt, replayed: false });
    }

    /**
     * Nothing was released, which is not the same as nothing being there. A
     * release that already happened is the request arriving twice, and the
     * honest answer is the moment it was released — a 404 there tells an
     * operator whose first click did land that the claim is gone, and the next
     * thing they do is look for it.
     */
    const [held] = await db
      .select({ releasedAt: schema.taskClaims.releasedAt })
      .from(schema.taskClaims)
      .where(eq(schema.taskClaims.id, id));
    if (held === undefined) return reply.code(404).send({ error: 'no claim with that id' });
    return reply.send({ id, released_at: held.releasedAt, replayed: true });
  });

  // -- collectors (BO-03, APP-02/04/05, PRV-01) -----------------------------

  app.get('/api/collectors', opts, async () => {
    const rows = await db
      .select({
        id: schema.collectors.id,
        external_ref: schema.collectors.externalRef,
        status: schema.collectors.status,
        exam_result: schema.collectors.examResult,
        exam_decided_at: schema.collectors.examDecidedAt,
        created_at: schema.collectors.createdAt,
      })
      .from(schema.collectors)
      .orderBy(schema.collectors.externalRef);

    const accepted = await db.select().from(schema.collectorAgreements);
    const byCollector = new Map<string, typeof accepted>();
    for (const a of accepted) {
      const list = byCollector.get(a.collectorId) ?? [];
      list.push(a);
      byCollector.set(a.collectorId, list);
    }

    return {
      /** The six PRV-01 expects, so the console can name the missing ones. */
      required_agreements: AGREEMENTS,
      collectors: rows.map((c) => ({
        ...c,
        agreements: (byCollector.get(c.id) ?? []).map((a) => ({
          agreement: a.agreement,
          version: a.version,
          accepted_at: a.acceptedAt,
        })),
      })),
    };
  });

  app.post('/api/collectors', opts, async (req, reply) => {
    const body = CollectorBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    /**
     * Filled in place for the same reason `before` is on the patch routes:
     * `mutate` reads the event after the write returns, and `agreements` has to
     * be what the table accepted rather than what the form sent.
     */
    const after: Record<string, unknown> = { ...b };

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        { action: 'collector.create', targetTable: 'collectors', targetId: b.id, after },
        async (tx) => {
          const [row] = await tx
            .insert(schema.collectors)
            .values({ id: b.id, externalRef: b.external_ref, status: b.status ?? 'pending' })
            /**
             * Targeted at the primary key, not bare. A bare
             * `onConflictDoNothing()` covers every unique index on the table,
             * so a second collector sent with somebody else's `external_ref`
             * would come back 200 "replayed" having written nothing — the clash
             * silently reported as success.
             */
            .onConflictDoNothing({ target: schema.collectors.id })
            .returning();
          if (row === undefined) return undefined;
          const landed = await writeAgreements(tx, b.id, b.agreements ?? []);
          if (b.agreements !== undefined) after['agreements'] = landed;
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) return reply.code(201).send({ id: b.id, replayed: false });

    /**
     * A conflicting create returns above `writeAgreements`, so not one of the
     * acceptances on the form was written. Answering `replayed` on the id and
     * the reference alone would tell the operator their consents landed while
     * the table holds none of them — and consent is the one record here that a
     * regulator reads back years later. So a replay has to produce its own
     * evidence: every acceptance the request carried, already on record, with
     * the same version and the same moment. Anything else is a different
     * request wearing a used id, and gets the same 409 as different terms.
     */
    const wanted = b.agreements ?? [];
    if (wanted.length > 0) {
      const onRecord = new Set(
        (
          await db
            .select({
              agreement: schema.collectorAgreements.agreement,
              version: schema.collectorAgreements.version,
              acceptedAt: schema.collectorAgreements.acceptedAt,
            })
            .from(schema.collectorAgreements)
            .where(eq(schema.collectorAgreements.collectorId, b.id))
        ).map((r) => JSON.stringify([r.agreement, r.version, r.acceptedAt.toISOString()])),
      );
      const missing = wanted.some(
        (a) =>
          !onRecord.has(JSON.stringify([a.agreement, a.version, new Date(a.accepted_at).toISOString()])),
      );
      if (missing) return refused(reply, 'collectors_id_reused');
    }

    /**
     * `external_ref` and not the status: the reference is who this row is, and
     * the status is what has happened to them since. A registration replayed
     * after somebody qualified the collector is still that registration, and
     * comparing the mutable half would refuse a legitimate retry every time
     * anything moved the row in between — which is the failure an idempotency
     * key exists to prevent. Same reasoning for a device's firmware version.
     */
    return replayOf(
      reply,
      b.id,
      'collectors_id_reused',
      db
        .select({ id: schema.collectors.id })
        .from(schema.collectors)
        .where(and(eq(schema.collectors.id, b.id), eq(schema.collectors.externalRef, b.external_ref))),
    );
  });

  app.patch('/api/collectors/:id', opts, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const body = CollectorPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    /** Read under the lock, in the transaction. See the task patch above. */
    const before: Record<string, unknown> = {};
    /** And `agreements` is what landed, not what was asked. See `writeAgreements`. */
    const after: Record<string, unknown> = { ...b };

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'collector.update',
          targetTable: 'collectors',
          targetId: id,
          before,
          after,
        },
        async (tx) => {
          const [held] = await tx
            .select()
            .from(schema.collectors)
            .where(eq(schema.collectors.id, id))
            .for('update');
          if (held === undefined) return undefined;
          Object.assign(before, {
            external_ref: held.externalRef,
            status: held.status,
            exam_result: held.examResult,
            exam_decided_at: held.examDecidedAt,
          });
          const [row] = await tx
            .update(schema.collectors)
            .set({
              status: b.status,
              examResult: b.exam === undefined ? undefined : (b.exam?.result ?? null),
              examDecidedAt:
                b.exam === undefined ? undefined : b.exam === null ? null : new Date(b.exam.decided_at),
              updatedAt: new Date(),
            })
            .where(eq(schema.collectors.id, id))
            .returning();
          if (row === undefined) return undefined;
          const landed = await writeAgreements(tx, id, b.agreements ?? []);
          if (b.agreements !== undefined) after['agreements'] = landed;
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value === undefined) return reply.code(404).send({ error: 'no such collector' });
    return reply.send({ id, status: attempt.value.status, exam_result: attempt.value.examResult });
  });

  // -- devices (BO-04, SEC-04) ----------------------------------------------

  app.get('/api/devices', opts, async () => {
    const rows = await db
      .select({
        id: schema.devices.id,
        hardware_serial: schema.devices.hardwareSerial,
        firmware_version: schema.devices.firmwareVersion,
        status: schema.devices.status,
        fault_note: schema.devices.faultNote,
        bound_collector_id: schema.devices.boundCollectorId,
        bound_at: schema.devices.boundAt,
        bound_collector_ref: schema.collectors.externalRef,
        device_type_id: schema.devices.deviceTypeId,
        device_type_code: schema.deviceTypes.code,
      })
      .from(schema.devices)
      .leftJoin(schema.collectors, eq(schema.collectors.id, schema.devices.boundCollectorId))
      .leftJoin(schema.deviceTypes, eq(schema.deviceTypes.id, schema.devices.deviceTypeId))
      .orderBy(schema.devices.hardwareSerial);

    /** The console needs the types to offer them; one round trip, not two. */
    const types = await db
      .select({ id: schema.deviceTypes.id, code: schema.deviceTypes.code })
      .from(schema.deviceTypes)
      .orderBy(schema.deviceTypes.code);
    return { devices: rows, device_types: types };
  });

  app.post('/api/devices', opts, async (req, reply) => {
    const body = DeviceBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        { action: 'device.create', targetTable: 'devices', targetId: b.id, after: b },
        async (tx) => {
          const [row] = await tx
            .insert(schema.devices)
            .values({
              id: b.id,
              deviceTypeId: b.device_type_id,
              hardwareSerial: b.hardware_serial,
              firmwareVersion: b.firmware_version ?? null,
              status: 'active',
            })
            /** Targeted: a duplicate hardware serial must be refused, not swallowed. */
            .onConflictDoNothing({ target: schema.devices.id })
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) return reply.code(201).send({ id: b.id, replayed: false });
    return replayOf(
      reply,
      b.id,
      'devices_id_reused',
      db
        .select({ id: schema.devices.id })
        .from(schema.devices)
        .where(
          and(
            eq(schema.devices.id, b.id),
            eq(schema.devices.deviceTypeId, b.device_type_id),
            eq(schema.devices.hardwareSerial, b.hardware_serial),
          ),
        ),
    );
  });

  app.patch('/api/devices/:id', opts, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const body = DevicePatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    /** Read under the lock, in the transaction. See the task patch above. */
    const before: Record<string, unknown> = {};

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'device.update',
          targetTable: 'devices',
          targetId: id,
          before,
          after: b,
        },
        async (tx) => {
          const [held] = await tx
            .select()
            .from(schema.devices)
            .where(eq(schema.devices.id, id))
            .for('update');
          if (held === undefined) return undefined;
          Object.assign(before, {
            firmware_version: held.firmwareVersion,
            status: held.status,
            fault_note: held.faultNote,
            bound_collector_id: held.boundCollectorId,
          });
          const [row] = await tx
            .update(schema.devices)
            .set({
              firmwareVersion: b.firmware_version,
              status: b.status,
              faultNote: b.fault_note,
              updatedAt: new Date(),
            })
            .where(eq(schema.devices.id, id))
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value === undefined) return reply.code(404).send({ error: 'no such device' });
    return reply.send({ id, status: attempt.value.status });
  });

  /**
   * BO-04 and SEC-04, as two routes rather than one column patch.
   *
   * `devices_bound_at_check` makes a binding without a moment unrepresentable,
   * so both columns move together here. Binding a device somebody else already
   * holds is refused rather than silently reassigned: §4.3 forbids inferring a
   * holder from "whoever last had it", and a silent takeover is the same
   * mistake made faster.
   *
   * **The UPDATE decides, not a read before it.** This route used to read the
   * device, decide from what it saw, and then write; between those two
   * statements another operator can bind the same device, and both callers were
   * told they had it. So the `where` carries the condition — bind only a device
   * nobody holds — and the returned row is the answer. No row back means the
   * bind did not happen, and only then is the device read again to say why:
   * gone (404), somebody else's (409), or already this collector's, which is a
   * replayed form submission and a 200.
   */
  app.post('/api/devices/:id/bind', opts, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const body = z.object({ collector_id: uuid }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const collectorId = body.data.collector_id;

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'device.bind',
          targetTable: 'devices',
          targetId: id,
          /** Not read, deduced: the `where` below only matches an unbound row. */
          before: { bound_collector_id: null },
          after: { bound_collector_id: collectorId },
        },
        async (tx) => {
          const [row] = await tx
            .update(schema.devices)
            .set({ boundCollectorId: collectorId, boundAt: new Date(), updatedAt: new Date() })
            .where(and(eq(schema.devices.id, id), isNull(schema.devices.boundCollectorId)))
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) {
      return reply.send({ id, bound_collector_id: collectorId, replayed: false });
    }

    const [now] = await db.select().from(schema.devices).where(eq(schema.devices.id, id));
    if (now === undefined) return reply.code(404).send({ error: 'no such device' });
    if (now.boundCollectorId !== collectorId) {
      return reply.code(409).send({ error: 'refused', constraint: 'device_already_bound' });
    }
    return reply.send({ id, bound_collector_id: collectorId, replayed: true });
  });

  app.post('/api/devices/:id/unbind', opts, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });

    /**
     * SEC-04 asks who took this device off which collector. That is the holder
     * at the moment of the unbind, so it is read inside the same transaction
     * and under `for update` — a read before the transaction can name a
     * collector who had already handed the device back, and then the audit
     * trail says the wrong person lost it.
     *
     * `mutate` reads the event only after the write returns, which is why the
     * write can fill these in. `RETURNING OLD.*` would do the whole thing in
     * one statement and is Postgres 18; RUNNING.md still supports 16.
     */
    const before: { bound_collector_id: string | null; bound_at: Date | null } = {
      bound_collector_id: null,
      bound_at: null,
    };
    let exists = false;

    const written = await mutate(
      db,
      actorOf(req),
      {
        action: 'device.unbind',
        targetTable: 'devices',
        targetId: id,
        before,
        after: { bound_collector_id: null },
      },
      async (tx) => {
        const [held] = await tx
          .select({ collectorId: schema.devices.boundCollectorId, boundAt: schema.devices.boundAt })
          .from(schema.devices)
          .where(eq(schema.devices.id, id))
          .for('update');
        if (held === undefined) return undefined;
        exists = true;
        /**
         * Nothing to release means nothing to audit. An unbind of a device
         * nobody holds is a no-op, and a row for it is noise in the one table
         * SEC-04 asks somebody to read.
         */
        if (held.collectorId === null) return undefined;
        before.bound_collector_id = held.collectorId;
        before.bound_at = held.boundAt;

        const [row] = await tx
          .update(schema.devices)
          .set({ boundCollectorId: null, boundAt: null, updatedAt: new Date() })
          .where(eq(schema.devices.id, id))
          .returning();
        return row;
      },
    );
    if (!exists) return reply.code(404).send({ error: 'no such device' });
    return reply.send({ id, bound_collector_id: null, replayed: written === undefined });
  });

  // -- device assignment (Daniel, 2026-08-25) -------------------------------

  /**
   * Who holds this device for the next three months, and who stopped holding it.
   *
   * `devices/:id/bind` is the counter's answer to "who has it in their hands
   * right now". This is settlement's answer to "who had it on 13 August", and
   * the two are different questions: `device_assignments` keeps periods, the
   * column keeps one current value. Neither is derived from the other.
   *
   * One POST does both halves of a swap. The open period is closed at exactly
   * the instant the new one opens, in the same transaction, because a swap sent
   * as two requests can fail between them and leave a device belonging to
   * nobody or to two people at once. The exclusion constraint would refuse the
   * second request anyway, which is the same outage with a worse message.
   *
   * No console screen: API and fixtures is the pilot shape, the same cut BO-09
   * took for centres and machines. A screen is owed when the fleet outgrows the
   * twenty pilot devices, or when somebody other than an engineer has to record
   * a swap.
   */
  app.post('/api/devices/:id/assignments', opts, async (req, reply) => {
    const body = AssignmentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const deviceId = (req.params as { id: string }).id;
    const b = body.data;
    const from = new Date(b.valid_from);

    const [device] = await db.select().from(schema.devices).where(eq(schema.devices.id, deviceId));
    if (device === undefined) return reply.code(404).send({ error: 'no such device' });

    /** What the swap ended, filled inside the transaction. Same shape as unbind. */
    const before: { closed_assignment_id: string | null; closed_collector_id: string | null } = {
      closed_assignment_id: null,
      closed_collector_id: null,
    };

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'device.assign',
          targetTable: 'device_assignments',
          targetId: b.id,
          before,
          after: { device_id: deviceId, collector_id: b.collector_id, valid_from: b.valid_from },
        },
        async (tx) => {
          /**
           * The id decides first, and it decides inside the transaction.
           *
           * Closing the open period and then discovering the insert was a no-op
           * would leave the device assigned to nobody, every later episode
           * quarantining as `device_assignment_unknown`, and the caller told it
           * was a harmless replay. So a submission whose id is already here
           * changes nothing at all, and the route reads the row back afterwards
           * to say whether it really was the same submission.
           */
          const [taken] = await tx
            .select({ id: schema.deviceAssignments.id })
            .from(schema.deviceAssignments)
            .where(eq(schema.deviceAssignments.id, b.id));
          if (taken !== undefined) return undefined;

          /**
           * `valid_from <` and not merely "still open": an open period that
           * already starts at or after this instant is not something to close,
           * it is an overlap, and `device_assignments_no_overlap` refuses the
           * insert below with the sentence that says so. Back-dating an
           * assignment behind one already on record is a correction, not a swap.
           */
          const [closed] = await tx
            .update(schema.deviceAssignments)
            .set({ validTo: from, updatedAt: new Date() })
            .where(
              and(
                eq(schema.deviceAssignments.deviceId, deviceId),
                isNull(schema.deviceAssignments.validTo),
                lt(schema.deviceAssignments.validFrom, from),
              ),
            )
            .returning({
              id: schema.deviceAssignments.id,
              collectorId: schema.deviceAssignments.collectorId,
            });
          if (closed !== undefined) {
            before.closed_assignment_id = closed.id;
            before.closed_collector_id = closed.collectorId;
          }

          const [row] = await tx
            .insert(schema.deviceAssignments)
            .values({ id: b.id, deviceId, collectorId: b.collector_id, validFrom: from })
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) {
      return reply.code(201).send({
        id: b.id,
        replayed: false,
        closed_assignment_id: before.closed_assignment_id,
      });
    }

    /**
     * Nothing was written because that id is already here, and there are two
     * ways for that to happen. The same swap arriving twice is a replay and
     * costs nothing. A different pairing under an id already in use is not:
     * answering 200 there says this collector holds this device when somebody
     * else does, on the one path that decides who gets paid for the footage.
     */
    const [held] = await db
      .select()
      .from(schema.deviceAssignments)
      .where(eq(schema.deviceAssignments.id, b.id));
    if (
      held === undefined ||
      held.deviceId !== deviceId ||
      held.collectorId !== b.collector_id ||
      held.validFrom.getTime() !== new Date(b.valid_from).getTime()
    ) {
      return reply.code(409).send({ error: 'refused', constraint: 'device_assignments_id_reused' });
    }
    return reply.code(200).send({ id: b.id, replayed: true });
  });

  /** Who has held this device, newest period first: the custody chain in one read. */
  app.get('/api/devices/:id/assignments', opts, async (req) => {
    const rows = await db
      .select({
        id: schema.deviceAssignments.id,
        collector_id: schema.deviceAssignments.collectorId,
        collector_external_ref: schema.collectors.externalRef,
        valid_from: schema.deviceAssignments.validFrom,
        valid_to: schema.deviceAssignments.validTo,
      })
      .from(schema.deviceAssignments)
      .innerJoin(schema.collectors, eq(schema.collectors.id, schema.deviceAssignments.collectorId))
      .where(eq(schema.deviceAssignments.deviceId, (req.params as { id: string }).id))
      .orderBy(desc(schema.deviceAssignments.validFrom));
    return { assignments: rows };
  });

  /**
   * The same chain from the other end. The serial comes back because the serial
   * is what the crosscheck keys on: an episode names its device by serial and
   * never by uuid.
   */
  app.get('/api/collectors/:id/assignments', opts, async (req) => {
    const rows = await db
      .select({
        id: schema.deviceAssignments.id,
        device_id: schema.deviceAssignments.deviceId,
        hardware_serial: schema.devices.hardwareSerial,
        valid_from: schema.deviceAssignments.validFrom,
        valid_to: schema.deviceAssignments.validTo,
      })
      .from(schema.deviceAssignments)
      .innerJoin(schema.devices, eq(schema.devices.id, schema.deviceAssignments.deviceId))
      .where(eq(schema.deviceAssignments.collectorId, (req.params as { id: string }).id))
      .orderBy(desc(schema.deviceAssignments.validFrom));
    return { assignments: rows };
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Acceptances, written where they are given.
 *
 * `onConflictDoNothing` and not an upsert: an acceptance is evidence of what a
 * person agreed to on a day, and re-posting the registration form must not
 * rewrite the version or the timestamp of one already on record. A new version
 * of an agreement is a new acceptance, which needs the collector to accept it —
 * and that is a P2 re-consent flow nobody has specified.
 */
/**
 * Returns the acceptances that landed, which is not always the ones asked for.
 *
 * `(collector, agreement, version)` is the key and this insert is
 * `onConflictDoNothing`, because `collector_agreements_append_only` means a
 * repost cannot be allowed to overwrite. So reposting a version already on
 * record writes nothing and keeps the original `accepted_at` — correct, and
 * invisible to the caller. Auditing the request instead of the result would
 * then record a consent time the consent table does not hold, and a consent
 * trail that disagrees with the consent table is worse than no trail: the
 * regulator's question is when this person agreed, and the audit would answer
 * with a moment nobody ever stored.
 *
 * `.returning()` after `onConflictDoNothing` yields only the rows actually
 * written, which is exactly the evidence.
 */
async function writeAgreements(
  tx: Tx,
  collectorId: string,
  list: { agreement: string; version: string; accepted_at: string }[],
): Promise<{ agreement: string; version: string; accepted_at: string }[]> {
  if (list.length === 0) return [];
  const landed = await tx
    .insert(schema.collectorAgreements)
    .values(
      list.map((a) => ({
        collectorId,
        agreement: a.agreement,
        version: a.version,
        acceptedAt: new Date(a.accepted_at),
      })),
    )
    .onConflictDoNothing()
    .returning();
  return landed.map((r) => ({
    agreement: r.agreement,
    version: r.version,
    accepted_at: r.acceptedAt.toISOString(),
  }));
}
