import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { schema, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
import { MONEY_SCALE, ZERO, add, fromDecimal, quantise } from './money.ts';

/**
 * The rest of the money chain: SET-03, SET-05, SET-06, SET-07 and BO-08.
 *
 * The review lane stops at one settlement row per verdict. Everything after it
 * — grouping those rows into a bill, handing the bill to finance, and recording
 * that finance paid it — is here, and the shape of it is set by two facts.
 *
 * **No arithmetic is written in this file.** Every figure on a bill already
 * exists on a settlement, computed once by `settlementFor`. The bill total is a
 * sum taken with `money.ts`'s exact rationals and quantised by the same
 * `quantise` everything else uses, at the scale of the column it lands in, so
 * no value is rounded twice and `unit_price × effective_minutes = amount` still
 * holds line by line on the export.
 *
 * **Regenerating a cycle changes nothing, and the database is what says so.**
 * Not a "have we already run this?" query, which races against a second
 * operator, a retried request and a cron that fired twice.
 * `bills_collector_period_key` has nowhere to put a second bill for the same
 * collector and period, and `bill_lines`' primary key has nowhere to put a
 * settlement that is already billed. The generator inserts and lets the index
 * decide; when it decides against, `mutate` sees `undefined`, writes no audit
 * row, and the second run is a read.
 *
 * Who may call these is the same both-token operator session as everything else
 * on this service. Finance is not a role yet — there is no `finance` value in
 * `operators.role` — so this is honest rather than complete, exactly as the
 * review lane is about reviewer accounts.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

export type SettleOptions = {
  /** What `tasks.unit_price` is denominated in. Same configuration as the review lane. */
  currency?: string;
  /**
   * SET-07's cycle, in days.
   *
   * Weekly is `[ASSUMED]` in the brief's §13.2 — nobody has decided it — so it
   * is the default of a parameter and not a constant anywhere in the code. It
   * only ever supplies the *end* of a period whose start the caller gave; a
   * caller that names both dates never touches it. Days rather than
   * milliseconds because that is the unit the assumption is written in, and
   * days are counted as 24 hours: the periods are `timestamptz`, so a cycle
   * spanning a DST change is 168 hours and not 167.
   */
  cycleDays?: number;
};

const PeriodQuery = z.object({
  period_start: z.coerce.date(),
  period_end: z.coerce.date().optional(),
});

/**
 * RFC 4180, quoting everything.
 *
 * Deciding per field which ones need quotes is a rule with edge cases — a task
 * named `Housework, kitchen`, a collector reference with a newline pasted into
 * it — and quoting unconditionally has none. Excel reads it identically.
 */
const csvRow = (cells: readonly string[]): string =>
  cells.map((c) => `"${c.replaceAll('"', '""')}"`).join(',');

export function registerSettle(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: SettleOptions = {},
): void {
  const opts = { preHandler: requireActor };
  const currency = options.currency ?? 'VND';
  const cycleDays = options.cycleDays ?? 7;

  /** The caller's period, or the caller's start plus one cycle. */
  const periodOf = (query: unknown): { start: Date; end: Date } | string => {
    const parsed = PeriodQuery.safeParse(query ?? {});
    if (!parsed.success) return 'period_start must be a date, and period_end a date if given';
    const start = parsed.data.period_start;
    const end =
      parsed.data.period_end ?? new Date(start.getTime() + cycleDays * 24 * 60 * 60 * 1000);
    if (end.getTime() <= start.getTime()) return 'the period ends before it starts';
    return { start, end };
  };

  /**
   * Every settlement in the window that is waiting to be billed, with the
   * collector it belongs to.
   *
   * The window is on `settlements.created_at`, which is when the verdict was
   * committed — the moment the money became owed. Not the episode's recording
   * time, which is when the work was done but says nothing about whether it has
   * been reviewed yet, and would put footage reviewed in November onto an
   * August bill.
   *
   * The joins are how SET-04 is answered: a settlement reaches its collector
   * only through its review, its episode and its session, which is the same
   * single path the review lane established and the reason `settlements` has no
   * foreign key of its own to an episode.
   *
   * Zero-amount rows are returned rather than filtered out, and split by the
   * caller. SET-01 generates payable settlements from pass and partial-pass
   * reviews only, but the review lane writes a settlement for a *rejected*
   * episode too, worth 0.0000, because that row is the score of the review and
   * what a dispute over a refused episode points at. It is not billable —
   * `bill_lines_payable_guard` refuses it outright — and counting it here is
   * what keeps it a reported number instead of a silent backlog.
   */
  const settleable = (start: Date, end: Date) =>
    db
      .select({
        settlementId: schema.settlements.id,
        amount: schema.settlements.amount,
        collectorId: schema.collectors.id,
        collectorRef: schema.collectors.externalRef,
      })
      .from(schema.settlements)
      .innerJoin(
        schema.episodeReviews,
        eq(schema.episodeReviews.id, schema.settlements.episodeReviewId),
      )
      .innerJoin(schema.episodes, eq(schema.episodes.episodeId, schema.episodeReviews.episodeId))
      .innerJoin(
        schema.collectionSessions,
        eq(schema.collectionSessions.id, schema.episodes.collectionSessionId),
      )
      .innerJoin(schema.collectors, eq(schema.collectors.id, schema.collectionSessions.collectorId))
      .where(
        and(
          eq(schema.settlements.settlementState, 'pending_settlement'),
          gte(schema.settlements.createdAt, start),
          lt(schema.settlements.createdAt, end),
          /**
           * QR-08: a settlement whose review is under dispute waits for the
           * second verdict. `bill_lines_dispute_guard` (0016) refuses it a
           * line anyway; filtering here is what keeps the generator from
           * throwing on it.
           */
          sql`not exists (
            select 1 from review_disputes d
             where d.review_id = ${schema.settlements.episodeReviewId}
               and d.resolved_at is null
          )`,
        ),
      )
      .orderBy(asc(schema.collectors.externalRef), asc(schema.settlements.createdAt));

  /** The bills of a period, with what a screen needs to show their state. */
  const billsIn = (start: Date, end: Date) =>
    db
      .select({
        id: schema.bills.id,
        collectorRef: schema.collectors.externalRef,
        periodStart: schema.bills.periodStart,
        periodEnd: schema.bills.periodEnd,
        currency: schema.bills.currency,
        total: schema.bills.total,
        generatedAt: schema.bills.generatedAt,
        lines: sql<number>`count(${schema.billLines.settlementId})::int`,
        /**
         * SET-03's visible state, derived rather than stored. A `paid_at` column
         * on `bills` would be a second place the answer lives and a second place
         * it can be wrong; the settlements are the record of payment and this
         * reads them.
         */
        paid: sql<boolean>`bool_and(${schema.settlements.settlementState} = 'manually_paid')`,
      })
      .from(schema.bills)
      .innerJoin(schema.collectors, eq(schema.collectors.id, schema.bills.collectorId))
      .leftJoin(schema.billLines, eq(schema.billLines.billId, schema.bills.id))
      .leftJoin(schema.settlements, eq(schema.settlements.id, schema.billLines.settlementId))
      .where(and(gte(schema.bills.periodStart, start), lt(schema.bills.periodStart, end)))
      .groupBy(
        schema.bills.id,
        schema.collectors.externalRef,
        schema.bills.periodStart,
        schema.bills.periodEnd,
        schema.bills.currency,
        schema.bills.total,
        schema.bills.generatedAt,
      )
      .orderBy(asc(schema.collectors.externalRef));

  /** One bill's lines, with everything a dispute is checked against. */
  const linesOf = (billId: string) =>
    db
      .select({
        settlementId: schema.settlements.id,
        episodeId: schema.episodeReviews.episodeId,
        reviewId: schema.episodeReviews.id,
        taskName: schema.tasks.name,
        unitPrice: schema.settlements.unitPrice,
        effectiveMinutes: schema.settlements.effectiveMinutes,
        amount: schema.settlements.amount,
        state: schema.settlements.settlementState,
        reviewedAt: schema.episodeReviews.reviewedAt,
      })
      .from(schema.billLines)
      .innerJoin(schema.settlements, eq(schema.settlements.id, schema.billLines.settlementId))
      .innerJoin(
        schema.episodeReviews,
        eq(schema.episodeReviews.id, schema.settlements.episodeReviewId),
      )
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.settlements.taskId))
      .where(eq(schema.billLines.billId, billId))
      .orderBy(asc(schema.episodeReviews.reviewedAt), asc(schema.settlements.id));

  // -------------------------------------------------------------------------
  // SET-07: generate the cycle

  app.post('/api/settle/bills', opts, async (req, reply) => {
    const period = periodOf(req.body ?? {});
    if (typeof period === 'string') return reply.code(422).send({ error: period });
    const { start, end } = period;

    const rows = await settleable(start, end);

    const byCollector = new Map<string, typeof rows>();
    let notPayable = 0;
    for (const row of rows) {
      // A rejected episode's settlement. Never on a bill; see `settleable`.
      if (fromDecimal(row.amount).n <= 0n) {
        notPayable += 1;
        continue;
      }
      const bucket = byCollector.get(row.collectorId);
      if (bucket === undefined) byCollector.set(row.collectorId, [row]);
      else bucket.push(row);
    }

    let created = 0;
    for (const [collectorId, lines] of byCollector) {
      /**
       * Exact: every amount is a scale-4 decimal string, `add` is rational
       * arithmetic on BigInts, and `quantise` at the scale of the column it is
       * going into cannot move a value that is already at that scale. The
       * quantise call is what turns the rational back into the string Postgres
       * wants — it is not a second rounding site.
       */
      const total = quantise(
        lines.reduce((acc, line) => add(acc, fromDecimal(line.amount)), ZERO),
        MONEY_SCALE,
      );
      const billId = randomUUID();

      const written = await mutate(
        db,
        req.actor!,
        {
          action: 'bill.generate',
          targetTable: 'bills',
          targetId: billId,
          after: {
            collector_id: collectorId,
            collector_ref: lines[0]!.collectorRef,
            period_start: start.toISOString(),
            period_end: end.toISOString(),
            currency,
            total,
            settlement_ids: lines.map((l) => l.settlementId),
          },
        },
        async (tx) => {
          /**
           * The idempotency, in one clause. A second run for the same collector
           * and period returns no row, so the lines are not written, the
           * settlements are not moved, `mutate` writes no audit row, and this
           * whole transaction is a read that changed nothing.
           */
          const [bill] = await tx
            .insert(schema.bills)
            .values({
              id: billId,
              collectorId,
              periodStart: start,
              periodEnd: end,
              currency,
              total,
            })
            .onConflictDoNothing({
              target: [schema.bills.collectorId, schema.bills.periodStart, schema.bills.periodEnd],
            })
            .returning({ id: schema.bills.id });
          if (bill === undefined) return undefined;

          await tx
            .insert(schema.billLines)
            .values(lines.map((l) => ({ billId, settlementId: l.settlementId })));
          /**
           * `pending_settlement` in the WHERE, not just in the SELECT that found
           * these rows: another generator may have billed them in between, and
           * then this update matches nothing, the count below disagrees, and the
           * transaction is rolled back rather than issuing a bill for lines
           * somebody else also issued.
           */
          const moved = await tx
            .update(schema.settlements)
            .set({ settlementState: 'bill_generated', updatedAt: new Date() })
            .where(
              and(
                inArray(
                  schema.settlements.id,
                  lines.map((l) => l.settlementId),
                ),
                eq(schema.settlements.settlementState, 'pending_settlement'),
              ),
            )
            .returning({ id: schema.settlements.id });
          if (moved.length !== lines.length) {
            throw new Error('a settlement on this bill was billed by someone else');
          }
          return bill;
        },
      );
      if (written !== undefined) created += 1;
    }

    return reply.send({
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      cycle_days: cycleDays,
      created,
      /**
       * Settlements in this cycle that are worth nothing and were therefore not
       * billed — rejected episodes. Reported rather than dropped: they stay
       * `pending_settlement` for ever, and a number nobody can see is how a
       * backlog becomes a surprise. See the known gaps in docs/review.md.
       */
      not_payable: notPayable,
      bills: (await billsIn(start, end)).map(shapeBill),
    });
  });

  // -------------------------------------------------------------------------
  // BO-08: view

  app.get('/api/settle/bills', opts, async (req, reply) => {
    const period = periodOf(req.query ?? {});
    if (typeof period === 'string') return reply.code(422).send({ error: period });
    return reply.send({
      period_start: period.start.toISOString(),
      period_end: period.end.toISOString(),
      bills: (await billsIn(period.start, period.end)).map(shapeBill),
    });
  });

  app.get('/api/settle/bills/:id', opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [bill] = await db
      .select({
        id: schema.bills.id,
        collectorRef: schema.collectors.externalRef,
        periodStart: schema.bills.periodStart,
        periodEnd: schema.bills.periodEnd,
        currency: schema.bills.currency,
        total: schema.bills.total,
        generatedAt: schema.bills.generatedAt,
      })
      .from(schema.bills)
      .innerJoin(schema.collectors, eq(schema.collectors.id, schema.bills.collectorId))
      .where(eq(schema.bills.id, id));
    if (bill === undefined) return reply.code(404).send({ error: 'no such bill' });

    const lines = await linesOf(id);
    return reply.send({
      id: bill.id,
      collector_ref: bill.collectorRef,
      period_start: bill.periodStart.toISOString(),
      period_end: bill.periodEnd.toISOString(),
      currency: bill.currency,
      total: bill.total,
      generated_at: bill.generatedAt.toISOString(),
      paid: lines.length > 0 && lines.every((l) => l.state === 'manually_paid'),
      lines: lines.map((l) => ({
        settlement_id: l.settlementId,
        /** SET-04: the line names the episode it was paid for. */
        episode_id: l.episodeId,
        review_id: l.reviewId,
        task: l.taskName,
        unit_price: l.unitPrice,
        effective_minutes: l.effectiveMinutes,
        amount: l.amount,
        settlement_state: l.state,
        reviewed_at: l.reviewedAt?.toISOString() ?? null,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // SET-06: export

  app.get('/api/settle/export.csv', opts, async (req, reply) => {
    const period = periodOf(req.query ?? {});
    if (typeof period === 'string') return reply.code(422).send({ error: period });

    const bills = await billsIn(period.start, period.end);
    const rows: string[] = [
      csvRow([
        'bill_id',
        'collector',
        'period_start',
        'period_end',
        'currency',
        'settlement_id',
        'episode_id',
        'task',
        'unit_price',
        'effective_minutes',
        'amount',
        'settlement_state',
        'reviewed_at',
      ]),
    ];
    for (const bill of bills) {
      for (const line of await linesOf(bill.id)) {
        rows.push(
          csvRow([
            bill.id,
            bill.collectorRef,
            bill.periodStart.toISOString(),
            bill.periodEnd.toISOString(),
            bill.currency,
            line.settlementId,
            line.episodeId,
            line.taskName,
            /**
             * The three columns a disputed invoice is checked against, in the
             * order somebody would multiply them. They are copied from the
             * settlement verbatim; nothing here recomputes them, which is why
             * `unit_price × effective_minutes = amount` reads the same on the
             * export as it does in Postgres.
             */
            line.unitPrice,
            line.effectiveMinutes,
            line.amount,
            line.state,
            line.reviewedAt?.toISOString() ?? '',
          ]),
        );
      }
    }

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="playerone-settlement-${period.start.toISOString().slice(0, 10)}.csv"`,
      )
      /**
       * A byte-order mark, because finance opens this in Excel and Excel reads a
       * BOM-less UTF-8 CSV as the local code page. Task names are Chinese.
       */
      .send(`﻿${rows.join('\r\n')}\r\n`);
  });

}

type BillRow = {
  id: string;
  collectorRef: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  total: string;
  generatedAt: Date;
  lines: number;
  paid: boolean | null;
};

const shapeBill = (b: BillRow) => ({
  id: b.id,
  collector_ref: b.collectorRef,
  period_start: b.periodStart.toISOString(),
  period_end: b.periodEnd.toISOString(),
  currency: b.currency,
  total: b.total,
  generated_at: b.generatedAt.toISOString(),
  lines: b.lines,
  /** `bool_and` over no rows is null; an empty bill is not a paid one. */
  paid: b.paid ?? false,
});
