import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { z } from 'zod';
import { mutate } from './audit.ts';
import { decimal, guarded, refused, type Reply } from './backoffice.ts';
import { cmp, fromDecimal } from './money.ts';
import type { Actor } from './actor.ts';

/**
 * The device deposit ledger.
 *
 * A deposit is held against a device the way a hotel holds one against a room
 * key: locked when the device is assigned, returned when the device comes back
 * healthy, at risk when it is damaged or lost. PaXini's reference figure is
 * 5,000 CNY; the collectors are Vietnamese; which currency binds is undecided,
 * so `deposits` carries the amount and the currency per row and this file
 * carries only a configurable default.
 *
 * Three rules, and none of them is negotiable.
 *
 * **No money moves here, ever.** Every route below MARKS a decision somebody
 * already made — money received, deposit returned, deposit kept — the same way
 * SET-03 marks a settlement. Nothing in this file transfers, schedules or
 * triggers a payment, and nothing in it reaches the settlement formula: a
 * settlement is `quantise(unit_price x effective_minutes)` and a deposit is a
 * separate obligation that never adds to or subtracts from it.
 *
 * **A forfeiture is a human decision with a written reason.** A device fault
 * makes a forfeiture possible; it does not make one happen. There is
 * deliberately no code path from `devices.status = 'faulty'` to this table —
 * the fault is something a forfeiture may *cite*, through
 * `fault_audit_event_id`, and the citation points at the audit row that
 * recorded the fault because that row cannot be edited afterwards.
 *
 * **The refusals come from the database.** The state machine, the
 * forfeit-cannot-exceed-the-deposit rule, one-open-deposit-per-device and the
 * reason requirement are all in migration 0012. This file turns a constraint
 * name into a 409 with a machine-readable reason; it does not re-implement any
 * of them.
 *
 * Two notes for whoever picks this up next.
 *
 * *Device assignment.* `feat/device-assignment` is building exclusive
 * assignment windows on this same base. A deposit points at a collector and a
 * device directly, which is what an assignment resolves to anyway; adding an
 * `assignment_id` when that lands is an integration item, not a rewrite.
 *
 * *Reputation.* Returning a device healthy and damaging one are the two clearest
 * device-care signals the platform will ever have, so the deposit transitions
 * here are an event source for a reputation score. They are NOT consumed by
 * anything today, and the shape that consumes them has to be a durable event
 * log rather than a re-read of current state — a score derived by re-reading
 * `deposits.state` silently changes every time a row is corrected.
 */

const uuid = z.string().uuid();

/** Same precision as the column, and as `settlements.amount`. */
const money = decimal(14, 4);

/** Nothing is deposited or kept in a currency the column will not hold. */
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'expected a three-letter ISO 4217 code');

const CreateBody = z.object({
  id: uuid,
  collector_id: uuid,
  device_id: uuid,
  /**
   * Optional, falling back to the deployment default. Absent with no default
   * configured is a 400 rather than a number invented here: 5,000 is PaXini's
   * *reference* figure in *CNY*, and a service that quietly defaulted to 5,000
   * of whatever the deployment pays in would be off by a factor of about 3,000.
   */
  amount: money.optional(),
  currency: currencyCode.optional(),
});

const ReceiptBody = z
  .object({
    /** When the money actually arrived, if that is not now. */
    received_at: z.string().datetime().optional(),
    /** A slip number, a transfer reference — whatever finance can look up. */
    reference: z.string().trim().min(1).optional(),
  })
  .default({});

const ForfeitBody = z.object({
  amount: money.refine((a) => fromDecimal(a).n > 0n, 'a forfeiture of nothing is not a forfeiture'),
  /** Trimmed, because `deposits_forfeit_reason_check` refuses whitespace too. */
  reason: z.string().trim().min(1).max(2000),
  /**
   * The `audit_events` row that recorded the fault this decision was made on,
   * when there is one. A lost device has no fault report and this stays null.
   */
  fault_audit_event_id: z.number().int().positive().optional(),
});

export type DepositOptions = {
  /**
   * The default deposit for this deployment, as a decimal string. No fallback:
   * with nothing configured, every create has to state its own amount.
   */
  depositAmount?: string;
  /**
   * What a deposit is denominated in, defaulting to the deployment's pay
   * currency. Separate from `currency` on purpose — the open question is
   * precisely whether a deposit quoted in CNY is held in CNY or in the VND the
   * collector is paid in, and one setting could not express both answers.
   */
  depositCurrency?: string;
  /** `PLAYERONE_CURRENCY`. Used only as the fallback for the above. */
  currency?: string;
};

export function registerDeposits(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: DepositOptions = {},
): void {
  const opts = { preHandler: requireActor };
  const actorOf = (req: FastifyRequest): Actor => req.actor!;
  const defaultCurrency = options.depositCurrency ?? options.currency ?? 'VND';

  // -- create on assignment ---------------------------------------------------

  /**
   * BO-04 binds a device to a collector; this locks the deposit that rides on
   * it. Two routes and not one, because a bind that failed to write a deposit
   * would otherwise leave a device in somebody's hands with no record of what
   * they put down for it, and the two are audited separately for that reason.
   *
   * `deposits_open_device_key` is what makes a second live deposit on one
   * headset impossible, so there is no pre-flight check here — the same
   * argument as the claimant cap in `backoffice.ts`.
   */
  app.post('/api/deposits', opts, async (req, reply) => {
    const body = CreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    const amount = b.amount ?? options.depositAmount;
    if (amount === undefined) {
      return reply
        .code(400)
        .send({ error: 'no amount', detail: 'this deployment has no default deposit amount configured' });
    }
    const currency = b.currency ?? defaultCurrency;
    const terms = { collector_id: b.collector_id, device_id: b.device_id, amount, currency };

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        { action: 'deposit.create', targetTable: 'deposits', targetId: b.id, after: terms },
        async (tx) => {
          const [row] = await tx
            .insert(schema.deposits)
            .values({
              id: b.id,
              collectorId: b.collector_id,
              deviceId: b.device_id,
              amount,
              currency,
              state: 'held',
            })
            /** Targeted at the primary key: a second open deposit must be refused, not swallowed. */
            .onConflictDoNothing({ target: schema.deposits.id })
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) {
      return reply.code(201).send({ id: b.id, amount, currency, replayed: false });
    }

    /**
     * Nothing was written because that id is already here. A replayed form
     * submission costs nothing; DIFFERENT terms under an id already in use are
     * a different matter, and answering 200 there would tell an operator that a
     * 5,000 deposit is on record when the row says something else. So the whole
     * immutable payload is compared, not just the id.
     */
    const [held] = await db.select().from(schema.deposits).where(eq(schema.deposits.id, b.id));
    if (
      held === undefined ||
      held.collectorId !== b.collector_id ||
      held.deviceId !== b.device_id ||
      held.currency !== currency ||
      cmp(fromDecimal(held.amount), fromDecimal(amount)) !== 0
    ) {
      return reply.code(409).send({ error: 'refused', constraint: 'deposit_id_reused' });
    }
    return reply.code(200).send({ id: b.id, amount: held.amount, currency: held.currency, replayed: true });
  });

  // -- the three marks --------------------------------------------------------

  /**
   * Finance says the money arrived. Not a state — `held` describes the
   * obligation, and whether the cash has landed is a different fact about the
   * same row — but it gates a forfeiture: `deposits_forfeit_requires_receipt_check`
   * refuses keeping money nobody recorded receiving.
   *
   * The UPDATE carries `received_at is null`, so the write decides rather than a
   * read before it, and a second POST reports the receipt already on record
   * instead of overwriting it with a later timestamp.
   */
  app.post('/api/deposits/:id/receipt', opts, async (req, reply) => {
    const body = ReceiptBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const id = (req.params as { id: string }).id;
    const receivedAt = body.data.received_at === undefined ? new Date() : new Date(body.data.received_at);

    const written = await mutate(
      db,
      actorOf(req),
      {
        action: 'deposit.receipt',
        targetTable: 'deposits',
        targetId: id,
        /** Not read, deduced: the `where` below only matches a row with no receipt. */
        before: { received_at: null },
        after: { received_at: receivedAt.toISOString(), receipt_reference: body.data.reference ?? null },
      },
      async (tx) => {
        const [row] = await tx
          .update(schema.deposits)
          .set({
            receivedAt,
            receiptReference: body.data.reference ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.deposits.id, id), sql`${schema.deposits.receivedAt} is null`))
          .returning();
        return row;
      },
    );
    if (written !== undefined) {
      return reply.send({
        id,
        received_at: written.receivedAt,
        receipt_reference: written.receiptReference,
        replayed: false,
      });
    }

    const [now] = await db.select().from(schema.deposits).where(eq(schema.deposits.id, id));
    if (now === undefined) return reply.code(404).send({ error: 'no such deposit' });
    /** The stored receipt, not the requested one: this request did not write it. */
    return reply.send({
      id,
      received_at: now.receivedAt,
      receipt_reference: now.receiptReference,
      replayed: true,
    });
  });

  /** The device came back healthy and the deposit goes back. Nothing here pays it. */
  app.post('/api/deposits/:id/release', opts, async (req, reply) => {
    const id = (req.params as { id: string }).id;

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'deposit.release',
          targetTable: 'deposits',
          targetId: id,
          before: { state: 'held' },
          after: { state: 'released' },
        },
        async (tx) => {
          const [row] = await tx
            .update(schema.deposits)
            .set({ state: 'released', releasedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(schema.deposits.id, id), eq(schema.deposits.state, 'held')))
            .returning();
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) {
      return reply.send({ id, state: 'released', released_at: attempt.value.releasedAt, replayed: false });
    }
    return settled(reply, id, 'released');
  });

  /**
   * Somebody decided to keep part or all of a deposit, and said why.
   *
   * The row is read `for update` inside the transaction rather than before it:
   * the audit `before` has to be the deposit as it stood at the moment of the
   * decision, and a read outside can name a deposit another operator has already
   * released. It also serialises two concurrent forfeitures — the second blocks
   * on the lock, then sees a settled row and is refused.
   *
   * Whether this is a partial or a full forfeiture is derived from the amount by
   * exact rational comparison (`money.ts`), never by string equality: `5000` and
   * `5000.0000` are the same deposit and a string compare would call the first
   * one partial. An amount ABOVE the deposit is deliberately not caught here —
   * it is written and `deposits_forfeit_bounds_check` refuses it, because the
   * refusal belongs to the database.
   */
  app.post('/api/deposits/:id/forfeit', opts, async (req, reply) => {
    const body = ForfeitBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const id = (req.params as { id: string }).id;
    const b = body.data;

    const before: Record<string, unknown> = {};
    let seen: (typeof schema.deposits.$inferSelect) | undefined;

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'deposit.forfeit',
          targetTable: 'deposits',
          targetId: id,
          before,
          after: {
            forfeit_amount: b.amount,
            fault_audit_event_id: b.fault_audit_event_id ?? null,
          },
          /** The database insists a forfeiture says why; so does the audit row. */
          reason: b.reason,
        },
        async (tx) => {
          const [row] = await tx
            .select()
            .from(schema.deposits)
            .where(eq(schema.deposits.id, id))
            .for('update');
          if (row === undefined) return undefined;
          seen = row;
          if (row.state !== 'held') return undefined;
          before['state'] = row.state;
          before['forfeit_amount'] = row.forfeitAmount;

          const full = cmp(fromDecimal(b.amount), fromDecimal(row.amount)) === 0;
          const [written] = await tx
            .update(schema.deposits)
            .set({
              state: full ? 'forfeited' : 'partially_forfeited',
              forfeitAmount: b.amount,
              reason: b.reason,
              faultAuditEventId: b.fault_audit_event_id ?? null,
              forfeitedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.deposits.id, id))
            .returning();
          return written;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (attempt.value !== undefined) {
      return reply.send({
        id,
        state: attempt.value.state,
        forfeit_amount: attempt.value.forfeitAmount,
        replayed: false,
      });
    }
    if (seen === undefined) return reply.code(404).send({ error: 'no such deposit' });

    /**
     * Already settled. The same forfeiture arriving twice is a replay; a
     * different one is an operator being told their decision landed when
     * somebody else's did.
     */
    const same =
      seen.state !== 'released' &&
      seen.reason === b.reason &&
      cmp(fromDecimal(seen.forfeitAmount), fromDecimal(b.amount)) === 0;
    if (!same) return reply.code(409).send({ error: 'refused', constraint: 'deposits_state_transition' });
    return reply.send({
      id,
      state: seen.state,
      forfeit_amount: seen.forfeitAmount,
      replayed: true,
    });
  });

  /** Shared tail of release: the row exists but is not `held` any more. */
  async function settled(reply: Reply, id: string, wanted: string) {
    const [now] = await db.select().from(schema.deposits).where(eq(schema.deposits.id, id));
    if (now === undefined) return reply.code(404).send({ error: 'no such deposit' });
    if (now.state === wanted) {
      return reply.code(200).send({ id, state: now.state, released_at: now.releasedAt, replayed: true });
    }
    return reply.code(409).send({ error: 'refused', constraint: 'deposits_state_transition' });
  }

  // -- history ----------------------------------------------------------------

  /**
   * Every deposit of one collector, or of one device, with the audit rows that
   * moved it.
   *
   * The audit trail IS the history: the row carries the current state and one
   * timestamp per transition, and who decided each one lives in `audit_events`.
   * Returning the two together is what makes "why is this collector 1,200
   * short" answerable from one request.
   *
   * Scoped by the column in the URL and by nothing else. The two-collector
   * fixture is what proves that — the last payment bug in this repo was a query
   * scoped by the wrong id, and every fixture at the time had only one of each.
   */
  const history = async (column: 'collector' | 'device', id: string) => {
    const rows = await db
      .select({
        id: schema.deposits.id,
        collector_id: schema.deposits.collectorId,
        collector_ref: schema.collectors.externalRef,
        device_id: schema.deposits.deviceId,
        hardware_serial: schema.devices.hardwareSerial,
        amount: schema.deposits.amount,
        currency: schema.deposits.currency,
        state: schema.deposits.state,
        forfeit_amount: schema.deposits.forfeitAmount,
        reason: schema.deposits.reason,
        fault_audit_event_id: schema.deposits.faultAuditEventId,
        held_at: schema.deposits.heldAt,
        received_at: schema.deposits.receivedAt,
        receipt_reference: schema.deposits.receiptReference,
        released_at: schema.deposits.releasedAt,
        forfeited_at: schema.deposits.forfeitedAt,
      })
      .from(schema.deposits)
      .leftJoin(schema.collectors, eq(schema.collectors.id, schema.deposits.collectorId))
      .leftJoin(schema.devices, eq(schema.devices.id, schema.deposits.deviceId))
      .where(
        column === 'collector'
          ? eq(schema.deposits.collectorId, id)
          : eq(schema.deposits.deviceId, id),
      )
      .orderBy(desc(schema.deposits.heldAt));

    if (rows.length === 0) return { deposits: [] };

    /** One round trip for the trail, not one per deposit. */
    const events = await db
      .select({
        id: schema.auditEvents.id,
        deposit_id: schema.auditEvents.targetId,
        occurred_at: schema.auditEvents.occurredAt,
        action: schema.auditEvents.action,
        operator_id: schema.auditEvents.operatorId,
        reason: schema.auditEvents.reason,
      })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.targetTable, 'deposits'),
          inArray(
            schema.auditEvents.targetId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(schema.auditEvents.occurredAt, schema.auditEvents.id);

    const byDeposit = new Map<string, typeof events>();
    for (const e of events) {
      const list = byDeposit.get(e.deposit_id) ?? [];
      list.push(e);
      byDeposit.set(e.deposit_id, list);
    }
    return { deposits: rows.map((r) => ({ ...r, events: byDeposit.get(r.id) ?? [] })) };
  };

  app.get('/api/collectors/:id/deposits', opts, async (req) =>
    history('collector', (req.params as { id: string }).id),
  );

  app.get('/api/devices/:id/deposits', opts, async (req) =>
    history('device', (req.params as { id: string }).id),
  );
}
