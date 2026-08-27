import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { z } from 'zod';
import { mutate } from './audit.ts';
import type { CounterActor } from './actor.ts';

/**
 * The counter workflow: a collector arrives with a TF card, the operator records
 * the handover and the sessions the collector performed, then opens a batch for
 * the import.
 *
 * Two rules run through every endpoint here.
 *
 * Ids are client-generated, because the counter has to keep working with the
 * link down (NFR-06, PRD §11.3.2 rule 9). So every write is idempotent on that
 * id — `onConflictDoNothing`, which makes a replayed queue a no-op at the
 * database rather than a de-duplication problem in the application.
 *
 * Anything the tokens already prove is taken from the tokens and ignored in the
 * body: centre, operator, upload device. A console that asks to write somebody
 * else's centre is not refused a field, it is simply not consulted.
 */

const uuid = z.string().uuid();

const HandoverBody = z.object({
  id: uuid,
  collector_id: uuid,
  device_id: uuid,
  tf_card_id: z.string().min(1),
  handover_time: z.string().datetime(),
});

const SessionBody = z.object({
  id: uuid,
  task_id: uuid,
  scenario_id: uuid,
  collection_point_id: uuid.optional(),
  /**
   * APP-17b. `z.boolean()` and not `.default(false)`: "no" is a real answer and
   * "nobody asked" is not, so a missing field must be a 400 rather than quietly
   * becoming the safe-looking option. The database says NOT NULL, this says
   * present-and-boolean, and the UI makes it a required choice — §10.10 wants
   * all three.
   */
  others_in_frame: z.boolean(),
  sensitive_info_present: z.boolean(),
  /**
   * Required. The console orders a multi-session handover by time so the
   * operator has something to confirm, and it cannot order what it cannot see.
   */
  prepare_time: z.string().datetime(),
  client_version: z.string().optional(),
});

const BatchBody = z.object({
  id: uuid,
  handover_id: uuid,
  import_started_at: z.string().datetime(),
});

const BatchPatch = z.object({
  import_completed_at: z.string().datetime().optional(),
  file_count: z.number().int().nonnegative().optional(),
  total_size_bytes: z.number().int().nonnegative().optional(),
  batch_status: z
    .enum(['importing', 'imported', 'uploading', 'verifying', 'verified', 'closed', 'failed'])
    .optional(),
});

type Reply = {
  code: (n: number) => { send: (b: unknown) => unknown };
};

/**
 * Registers the counter endpoints. `requireActor` is passed in rather than
 * re-derived so there is exactly one implementation of the both-tokens rule.
 */
export function registerCounter(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
): void {
  const opts = { preHandler: requireActor };
  /**
   * The counter, always. A reviewer session is refused by the route guard on
   * every path in this file, so both halves are present by the time anything
   * here runs — `CounterActor` is that guarantee written down rather than
   * re-checked.
   */
  const actorOf = (req: FastifyRequest): CounterActor => req.actor as CounterActor;

  app.post('/handovers', opts, async (req, reply) => {
    const body = HandoverBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = actorOf(req);
    const b = body.data;

    /**
     * §4.3: devices circulate between collectors and cards between devices, and
     * neither may be inferred from "whoever last had it". So the collector and
     * device are FKs and an unknown one is refused here rather than stored as a
     * dangling reference.
     *
     * PRD §11.3.1 rule 3 wants that to land in an exception queue. It does — the
     * console's, which is where the operator and the collector both are. A 409
     * with a machine-readable reason keeps the item queued locally for the
     * operator to correct against a fresh reference sync.
     *
     * ponytail: exception lives client-side. Give it a server-side landing table
     * when the back-office needs to see unresolvable handovers it cannot reach.
     */
    const [collector] = await db
      .select({ id: schema.collectors.id })
      .from(schema.collectors)
      .where(eq(schema.collectors.id, b.collector_id));
    const [device] = await db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.id, b.device_id));
    if (collector === undefined || device === undefined) {
      return reply.code(409).send({
        error: 'unresolved_reference',
        collector: collector === undefined ? 'unknown' : 'ok',
        device: device === undefined ? 'unknown' : 'ok',
      });
    }

    const written = await mutate(
      db,
      actor,
      { action: 'handover.create', targetTable: 'handovers', targetId: b.id, after: b },
      async (tx) => {
        const [row] = await tx
          .insert(schema.handovers)
          .values({
            id: b.id,
            collectorId: b.collector_id,
            deviceId: b.device_id,
            tfCardId: b.tf_card_id,
            // From the tokens, never the body.
            uploadCentreId: actor.operator.uploadCentreId,
            operatorId: actor.operator.operatorId,
            handoverTime: new Date(b.handover_time),
          })
          .onConflictDoNothing()
          .returning();
        return row;
      },
    );
    return reply.code(written === undefined ? 200 : 201).send({ id: b.id, replayed: written === undefined });
  });

  app.post('/handovers/:id/sessions', opts, async (req, reply) => {
    const body = SessionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = actorOf(req);
    const handoverId = (req.params as { id: string }).id;
    const b = body.data;

    // The handover must exist and belong to this centre: a session is only
    // meaningful against a card someone actually handed in here.
    const [handover] = await db
      .select()
      .from(schema.handovers)
      .where(
        and(
          eq(schema.handovers.id, handoverId),
          eq(schema.handovers.uploadCentreId, actor.operator.uploadCentreId),
        ),
      );
    if (handover === undefined) return reply.code(404).send({ error: 'no such handover here' });

    const written = await mutate(
      db,
      actor,
      {
        action: 'session.create',
        targetTable: 'collection_sessions',
        targetId: b.id,
        after: { ...b, handover_id: handoverId },
      },
      async (tx) => {
        const [row] = await tx
          .insert(schema.collectionSessions)
          .values({
            id: b.id,
            handoverId,
            taskId: b.task_id,
            // The collector comes from the handover, not the body: one card, one
            // collector, already verified at the counter (PRD §11.3.1 rule 1).
            collectorId: handover.collectorId,
            scenarioId: b.scenario_id,
            collectionPointId: b.collection_point_id ?? null,
            othersInFrame: b.others_in_frame,
            sensitiveInfoPresent: b.sensitive_info_present,
            // Reconstructed at the counter, and recorded as such so the drift is
            // measurable once APP-16 starts creating these before recording.
            sessionOrigin: 'handover',
            prepareTime: new Date(b.prepare_time),
            createdBy: actor.operator.operatorId,
            clientVersion: b.client_version ?? null,
          })
          .onConflictDoNothing()
          .returning();
        if (row === undefined) return undefined;

        // P2-01: devices bind through the join table. Phase 1 allows one, and
        // the device is the handover's — the collector wore what they handed in.
        await tx
          .insert(schema.collectionSessionDevices)
          .values({ collectionSessionId: row.id, deviceId: handover.deviceId, role: 'headset' })
          .onConflictDoNothing();
        return row;
      },
    );
    return reply
      .code(written === undefined ? 200 : 201)
      .send({ id: b.id, replayed: written === undefined });
  });

  app.post('/upload-batches', opts, async (req, reply) => {
    const body = BatchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = actorOf(req);
    const b = body.data;

    const [handover] = await db
      .select({ id: schema.handovers.id })
      .from(schema.handovers)
      .where(
        and(
          eq(schema.handovers.id, b.handover_id),
          eq(schema.handovers.uploadCentreId, actor.operator.uploadCentreId),
        ),
      );
    if (handover === undefined) return reply.code(404).send({ error: 'no such handover here' });

    const written = await mutate(
      db,
      actor,
      { action: 'batch.import_start', targetTable: 'upload_batches', targetId: b.id, after: b },
      async (tx) => {
        const [row] = await tx
          .insert(schema.uploadBatches)
          .values({
            id: b.id,
            handoverId: b.handover_id,
            // UPL-07: the machine is the one that authenticated, not one named
            // in a body.
            uploadDeviceId: actor.machine.uploadDeviceId,
            importStartedAt: new Date(b.import_started_at),
            batchStatus: 'importing',
          })
          .onConflictDoNothing()
          .returning();
        return row;
      },
    );
    return reply
      .code(written === undefined ? 200 : 201)
      .send({ id: b.id, replayed: written === undefined });
  });

  app.patch('/upload-batches/:id', opts, async (req, reply) => {
    const body = BatchPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const actor = actorOf(req);
    const batchId = (req.params as { id: string }).id;
    const b = body.data;

    const [before] = await db
      .select()
      .from(schema.uploadBatches)
      .where(
        and(
          eq(schema.uploadBatches.id, batchId),
          eq(schema.uploadBatches.uploadDeviceId, actor.machine.uploadDeviceId),
        ),
      );
    if (before === undefined) return reply.code(404).send({ error: 'no such batch on this machine' });

    /**
     * Cloud verification and cache cleanup are the next slice, so this endpoint
     * deliberately cannot set `cloud_verified_at` or `local_cache_cleaned_at`.
     * The upload_batches CHECK would refuse a cleanup before verification
     * anyway (UPL-06); not accepting the fields at all means the console has no
     * way to try.
     */
    const written = await mutate(
      db,
      actor,
      {
        action: 'batch.import_complete',
        targetTable: 'upload_batches',
        targetId: batchId,
        before: { batch_status: before.batchStatus },
        after: b,
      },
      async (tx) => {
        const [row] = await tx
          .update(schema.uploadBatches)
          .set({
            importCompletedAt: b.import_completed_at ? new Date(b.import_completed_at) : undefined,
            fileCount: b.file_count,
            totalSizeBytes: b.total_size_bytes,
            batchStatus: b.batch_status,
            updatedAt: new Date(),
          })
          .where(eq(schema.uploadBatches.id, batchId))
          .returning();
        return row;
      },
    );
    return reply.send({ id: batchId, batch_status: written?.batchStatus ?? before.batchStatus });
  });

  /** PRD §11.3.2 rule 8. Current state per machine, upserted — not audited: heartbeat cadence would bury PLT-08. */
  app.post('/upload-devices/:id/heartbeat', opts, async (req, reply) => {
    const actor = actorOf(req);
    const target = (req.params as { id: string }).id;
    if (target !== actor.machine.uploadDeviceId) {
      return reply.code(403).send({ error: 'a machine may only report its own state' });
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const row = {
      uploadDeviceId: actor.machine.uploadDeviceId,
      networkState: typeof b['network_state'] === 'string' ? b['network_state'] : null,
      diskFreeBytes: typeof b['disk_free_bytes'] === 'number' ? b['disk_free_bytes'] : null,
      cardReaderState: typeof b['card_reader_state'] === 'string' ? b['card_reader_state'] : null,
      queueDepth: typeof b['queue_depth'] === 'number' ? b['queue_depth'] : null,
      clientVersion: typeof b['client_version'] === 'string' ? b['client_version'] : null,
      lastHeartbeatAt: new Date(),
    };
    await db
      .insert(schema.uploadDeviceStatus)
      .values(row)
      .onConflictDoUpdate({ target: schema.uploadDeviceStatus.uploadDeviceId, set: { ...row, updatedAt: new Date() } });
    return reply.send({ ok: true });
  });
}
