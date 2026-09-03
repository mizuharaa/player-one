import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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
export const decimal = (precision: number, scale: number) =>
  z
    .string()
    .regex(
      new RegExp(`^\\d{1,${precision - scale}}(\\.\\d{1,${scale}})?$`),
      `expected up to ${precision - scale} digits and ${scale} decimals`,
    );

const TaskBody = z.object({
  id: uuid,
  name: z.string().min(1),
  /** APP-08 lists it in the task hall; no closed set, the taxonomy is PaXini's. */
  type: z.string().min(1),
  unit_price: decimal(12, 4),
  target_effective_duration_s: decimal(20, 6).optional(),
  max_concurrent_claimants: z.number().int().positive(),
});

const TaskPatch = z
  .object({
    name: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    unit_price: decimal(12, 4).optional(),
    target_effective_duration_s: decimal(20, 6).nullable().optional(),
    max_concurrent_claimants: z.number().int().positive().optional(),
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
  version: z.string().min(1),
  accepted_at: z.string().datetime(),
});

const CollectorBody = z.object({
  id: uuid,
  external_ref: z.string().min(1),
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
  hardware_serial: z.string().min(1),
  firmware_version: z.string().min(1).optional(),
});

const DevicePatch = z
  .object({
    firmware_version: z.string().min(1).nullable().optional(),
    status: z.enum(['active', 'faulty', 'retired']).optional(),
    fault_note: z.string().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

export type Reply = {
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
  'tasks_status_transition',
  'tasks_price_frozen',
  'collector_agreements_append_only',
  'devices_retired_unbound_check',
  'collectors_external_ref_key',
  'devices_hardware_serial_key',
  /** The deposit ledger's five, from migration 0012. See `deposits.ts`. */
  'deposits_state_transition',
  'deposits_forfeit_bounds_check',
  'deposits_forfeit_requires_receipt_check',
  'deposits_open_device_key',
  'deposits_fault_event_matches_device',
]);

/**
 * The list above has to hold every constraint that exists to refuse a person,
 * and adding one to migration 0006 without adding it here is the easy mistake:
 * the refusal still works, but it arrives as a 500 and the console shows the
 * generic failure instead of the sentence that says why. `the console is told
 * why every deliberate refusal happened` in the test file walks each of these
 * and is what catches the omission.
 */

/**
 * Runs a write and separates "the rules said no" from "this code is wrong".
 *
 * A result rather than a reply, so the caller decides the status code and the
 * value stays typed. Anything not in `REFUSALS` is re-thrown and becomes a
 * 500, which is what a foreign key failing on a column the route filled in
 * itself should look like.
 *
 * Module scope and exported, because `deposits.ts` needs exactly this and a
 * second copy of it is a second thing to get wrong.
 */
export async function guarded<T>(
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

export const refused = (reply: Reply, constraint: string) =>
  reply.code(409).send({ error: 'refused', constraint });

export function registerBackOffice(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
): void {
  const opts = { preHandler: requireActor };
  const actorOf = (req: FastifyRequest): Actor => req.actor!;

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
    return reply
      .code(attempt.value === undefined ? 200 : 201)
      .send({ id: b.id, replayed: attempt.value === undefined });
  });

  app.patch('/api/tasks/:id', opts, async (req, reply) => {
    const body = TaskPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const id = (req.params as { id: string }).id;
    const b = body.data;

    const [before] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    if (before === undefined) return reply.code(404).send({ error: 'no such task' });

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: b.status === undefined ? 'task.edit' : `task.${b.status}`,
          targetTable: 'tasks',
          targetId: id,
          before: { status: before.status, unit_price: before.unitPrice, max_concurrent_claimants: before.maxConcurrentClaimants },
          after: b,
        },
        async (tx) => {
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
    return reply.send({ id, status: attempt.value?.status ?? before.status });
  });

  /**
   * APP-10. The two things that can refuse this — capacity and the exam — are
   * both in `task_claims_guard`, so this route inserts and reports what the
   * database said. There is deliberately no pre-flight count here: a count read
   * before an insert is exactly the check that overshoots under load.
   */
  app.post('/api/tasks/:id/claims', opts, async (req, reply) => {
    const body = z.object({ id: uuid, collector_id: uuid }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const taskId = (req.params as { id: string }).id;
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
    return reply.code(200).send({ id: b.id, replayed: true });
  });

  /** Releasing is what makes a slot reusable; without it a cap is a one-way door. */
  app.post('/api/task-claims/:id/release', opts, async (req, reply) => {
    const id = (req.params as { id: string }).id;
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
    if (written === undefined) return reply.code(404).send({ error: 'no live claim with that id' });
    return reply.send({ id, released_at: written.releasedAt });
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

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        { action: 'collector.create', targetTable: 'collectors', targetId: b.id, after: b },
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
          await writeAgreements(tx, b.id, b.agreements ?? []);
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    return reply
      .code(attempt.value === undefined ? 200 : 201)
      .send({ id: b.id, replayed: attempt.value === undefined });
  });

  app.patch('/api/collectors/:id', opts, async (req, reply) => {
    const body = CollectorPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const id = (req.params as { id: string }).id;
    const b = body.data;

    const [before] = await db.select().from(schema.collectors).where(eq(schema.collectors.id, id));
    if (before === undefined) return reply.code(404).send({ error: 'no such collector' });

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'collector.update',
          targetTable: 'collectors',
          targetId: id,
          before: { status: before.status, exam_result: before.examResult },
          after: b,
        },
        async (tx) => {
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
          await writeAgreements(tx, id, b.agreements ?? []);
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    return reply.send({
      id,
      status: attempt.value?.status ?? before.status,
      exam_result: attempt.value?.examResult ?? null,
    });
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
    return reply
      .code(attempt.value === undefined ? 200 : 201)
      .send({ id: b.id, replayed: attempt.value === undefined });
  });

  app.patch('/api/devices/:id', opts, async (req, reply) => {
    const body = DevicePatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const id = (req.params as { id: string }).id;
    const b = body.data;

    const [before] = await db.select().from(schema.devices).where(eq(schema.devices.id, id));
    if (before === undefined) return reply.code(404).send({ error: 'no such device' });

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'device.update',
          targetTable: 'devices',
          targetId: id,
          before: { status: before.status, firmware_version: before.firmwareVersion },
          after: b,
        },
        async (tx) => {
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
    return reply.send({ id, status: attempt.value?.status ?? before.status });
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
    const body = z.object({ collector_id: uuid }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const id = (req.params as { id: string }).id;
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
    const id = (req.params as { id: string }).id;

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
async function writeAgreements(
  tx: Tx,
  collectorId: string,
  list: { agreement: string; version: string; accepted_at: string }[],
): Promise<void> {
  if (list.length === 0) return;
  await tx
    .insert(schema.collectorAgreements)
    .values(
      list.map((a) => ({
        collectorId,
        agreement: a.agreement,
        version: a.version,
        acceptedAt: new Date(a.accepted_at),
      })),
    )
    .onConflictDoNothing();
}
