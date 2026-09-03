import { createHash, randomUUID } from 'node:crypto';
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
 * no value is rounded twice and `quantise(unit_price × effective_minutes, 4)`
 * still reproduces `amount` line by line on the export. Note the `quantise`:
 * the raw product is not the amount and never was — 1 second at 1 a minute is
 * `0.016667` minutes and `0.0167`. `settlements_amount_formula_check` is that
 * rule as a CHECK, so a writer that never loads `money.ts` gets it too.
 *
 * **Regenerating a cycle changes nothing, and the database is what says so.**
 * Not a "have we already run this?" query, which races against a second
 * operator, a retried request and a cron that fired twice.
 * `bills_collector_period_key` has nowhere to put a second bill for the same
 * collector and period, and `bill_lines`' primary key has nowhere to put a
 * settlement that is already billed. The generator inserts and lets the index
 * decide; when it decides against, `mutate` sees `undefined`, writes no audit
 * row, and the second run is a read. A settlement that becomes visible only
 * after the bill was issued is not lost by that: see `settleable`.
 *
 * **The gap this file still has is who is allowed to call it.** Every route
 * below is guarded by the same both-token upload-centre operator session as the
 * counter and the review lane, which means any centre operator can export or
 * mark paid every collector's bill. There is no `finance` value in
 * `operators.role` and no non-centre principal to hang one on: `audit_events`
 * itself requires a machine and an operator from a centre for every non-login
 * event, so a finance identity is not a column this branch can add — it is the
 * shared principal model that `feat/reviewer-role` and `feat/backoffice-crud`
 * need too, and inventing a fourth private version of it here would make the
 * merge worse and the audit trail false. Recorded, not fixed.
 *
 * ponytail: centre-operator authorisation is the ceiling. Upgrade path is the
 * shared principal/capability model, then a finance capability on these five
 * routes and a centre or collector scope on the queries.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

export type SettleOptions = {
  /**
   * SET-07's cycle, in days.
   *
   * Weekly is `[ASSUMED]` in the brief's §13.2 — nobody has decided it — so it
   * is the default of a parameter and not a constant anywhere in the code. Days
   * rather than milliseconds because that is the unit the assumption is written
   * in, and a day here is a local Vietnamese day: see `CYCLE_ANCHOR`.
   *
   * It is validated at registration rather than per request. A service started
   * with `PLAYERONE_SETTLEMENT_CYCLE_DAYS=weekly` should refuse to start, not
   * answer every billing request with a period of `NaN` days.
   */
  cycleDays?: number;
};

/**
 * A cycle is a whole number of Vietnamese days beginning at local midnight, and
 * it starts on a Monday.
 *
 * Accepting an arbitrary instant was wrong in two ways that cost money. First,
 * `2026-08-24` parsed as an instant is UTC midnight, which is 07:00 in Ho Chi
 * Minh City — the cycle would start mid-morning and a day's work would land on
 * the wrong side of it. Second, and worse, nothing made two cycles disjoint:
 * `[17 Aug, 24 Aug)` and `[18 Aug, 25 Aug)` are different keys on
 * `bills_collector_period_key`, both insertable, and whichever generator ran
 * first would decide which cycle a settlement was paid in. Overlap is not a
 * validation error you can catch one request at a time; it has to be impossible
 * to express.
 *
 * So the contract is: the caller names a local date, the cycle length is the
 * parameter, and the start must sit on the lattice this anchor defines. There
 * is no `period_end` input any more — a caller cannot name a window, only pick
 * one. 1970-01-05 is the anchor because it was a Monday, so a 7-day cycle always
 * begins on a Monday and a 14-day cycle on alternate Mondays.
 *
 * The arithmetic below is plain milliseconds, which is exact only because
 * Vietnam has kept a fixed +07:00 with no daylight saving since 1975. If that
 * ever changes, this code drifts and `bills_period_local_midnight_check` — which
 * asks the tz database rather than assuming — refuses the insert. Fail closed.
 */
const CYCLE_ANCHOR = Date.parse('1970-01-05T00:00:00+07:00');
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The Vietnamese calendar date an instant falls on. */
const localDate = (ms: number): string =>
  new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * `.strict()`, so a caller that still sends the old `period_end` is refused
 * rather than silently given a whole configured cycle. Dropping an unknown key
 * on a money request is how a caller bills a period it did not ask for and
 * cannot see that it did.
 */
const PeriodQuery = z
  .object({
    period_start: z.string().regex(LOCAL_DATE, 'period_start must be a local date, YYYY-MM-DD'),
  })
  .strict();

/** Bills and settlements are identified by UUID; a path segment is not. */
const Uuid = z.string().uuid();

/**
 * RFC 4180, quoting everything, and defusing everything.
 *
 * Deciding per field which ones need quotes is a rule with edge cases — a task
 * named `Housework, kitchen`, a collector reference with a newline pasted into
 * it — and quoting unconditionally has none. Excel reads it identically.
 *
 * Quoting is not enough on its own, though, because a spreadsheet does not treat
 * a quoted cell as inert: a task named `=1+1`, or `@SUM(A:A)`, is still a live
 * formula when finance opens the export, and a task name is something an
 * operator types. Two of these columns carry operator text — the task name and
 * the collector reference — and the rest are UUIDs, ISO timestamps and numerics
 * that cannot begin with one of these characters, so applying the guard to every
 * cell costs nothing and needs no per-column reasoning. The leading apostrophe
 * is the standard neutraliser; the cell reads as text with a visible `'`, which
 * is the honest signal that the value looked like a formula.
 */
const csvCell = (cell: string): string => {
  const safe = /^[=+\-@\t\r\n]/.test(cell) ? `'${cell}` : cell;
  return `"${safe.replaceAll('"', '""')}"`;
};

const csvRow = (cells: readonly string[]): string => cells.map(csvCell).join(',');

export function registerSettle(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: SettleOptions = {},
): void {
  const opts = { preHandler: requireActor };
  // There is deliberately no `currency` option here. The review lane records
  // one on every settlement, so a bill reads its unit off the work it is
  // billing rather than off configuration that may have changed since.
  const cycleDays = options.cycleDays ?? 7;
  if (!Number.isInteger(cycleDays) || cycleDays < 1) {
    // Configuration, so this is a startup failure and not a 500 per request.
    throw new Error(`settlement cycle must be a whole number of days, not ${String(cycleDays)}`);
  }
  const cycleMs = cycleDays * DAY_MS;

  /** The cycle the caller named, or why that date is not the start of one. */
  const periodOf = (input: unknown): { start: Date; end: Date } | string => {
    const parsed = PeriodQuery.safeParse(input ?? {});
    if (!parsed.success) return parsed.error.issues[0]!.message;
    const startMs = Date.parse(`${parsed.data.period_start}T00:00:00+07:00`);
    /**
     * The round trip is the validation. `Date.parse` is not strict about a date
     * that does not exist — V8 rolls `2026-02-30` forward to 2 March rather than
     * returning NaN — so the only reliable check is to print the instant back as
     * a local date and see whether it is still the one that was asked for.
     */
    if (Number.isNaN(startMs) || localDate(startMs) !== parsed.data.period_start) {
      return `${parsed.data.period_start} is not a date`;
    }
    if ((startMs - CYCLE_ANCHOR) % cycleMs !== 0) {
      const aligned = startMs - (((startMs - CYCLE_ANCHOR) % cycleMs) + cycleMs) % cycleMs;
      return `a ${cycleDays}-day cycle does not start on ${parsed.data.period_start}; the one containing it starts ${new Date(aligned).toISOString()}`;
    }
    return { start: new Date(startMs), end: new Date(startMs + cycleMs) };
  };

  /**
   * Everything owed as of the cutoff and not yet on a bill.
   *
   * The cutoff is on `settlements.created_at`, which is when the verdict was
   * committed — the moment the money became owed. Not the episode's recording
   * time, which is when the work was done but says nothing about whether it has
   * been reviewed yet, and would put footage reviewed in November onto an
   * August bill.
   *
   * **There is no lower bound, and that is the fix for a real hole.** With
   * `created_at >= start` as well, a settlement could be stranded for ever: a
   * review transaction that begins before the cutoff gets a `created_at` inside
   * the cycle, but if it commits after this SELECT has run it is invisible to
   * the generator. The bill is then issued without it; re-running the cycle hits
   * `bills_collector_period_key` and changes nothing; and every later cycle
   * filters it out for being too old. Dropping the lower bound makes that row
   * simply appear on the next cycle's bill, which is what a payroll run does
   * with a late timesheet. The cycle dates stay the bill's label, and each line
   * carries its own `reviewed_at`, so a line that predates its bill says so.
   *
   * The collector and the currency come off the settlement itself rather than
   * from a join back through the session: they were snapshot when the verdict
   * was committed, so reassigning a session afterwards cannot move the money.
   * `collectors` is joined only for the human-readable reference.
   *
   * Every row this returns is payable. A settlement worth 0.0000 — a rejected
   * episode, or a partial pass whose every span was cut — is born `not_payable`
   * and terminal, so it is not in `pending_settlement` to be scanned, filtered
   * and re-counted every cycle for ever. `settlements_zero_not_payable_check`
   * is what makes that true of rows this query never saw.
   */
  const settleable = (end: Date) =>
    db
      .select({
        settlementId: schema.settlements.id,
        amount: schema.settlements.amount,
        currency: schema.settlements.currency,
        collectorId: schema.settlements.collectorId,
        collectorRef: schema.collectors.externalRef,
      })
      .from(schema.settlements)
      .innerJoin(schema.collectors, eq(schema.collectors.id, schema.settlements.collectorId))
      .where(
        and(
          eq(schema.settlements.settlementState, 'pending_settlement'),
          lt(schema.settlements.createdAt, end),
        ),
      )
      .orderBy(asc(schema.collectors.externalRef), asc(schema.settlements.createdAt));

  /**
   * The bills of one cycle, with what a screen needs to show their state.
   *
   * An exact match on both ends rather than a range: since `periodOf` accepts
   * only a cycle boundary, "the bills whose period starts inside this window"
   * and "the bills for this cycle" are now the same set, and the equality says
   * which one was meant.
   */
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
      .where(and(eq(schema.bills.periodStart, start), eq(schema.bills.periodEnd, end)))
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
    /**
     * The server owns the cutoff, and this is it: a cycle that has not begun
     * cannot be billed.
     *
     * `settleable` deliberately has no lower bound — see the note on it — so
     * naming a future cycle would sweep every settlement owed *today* onto a
     * bill labelled a week nobody has worked yet, and the run for the current
     * cycle would then find nothing and issue no bill at all. The collector's
     * pay would exist, on a document that lies about when it was earned. The
     * label has to be a period the work could have happened in.
     *
     * The current cycle is allowed while it is still running: a mid-cycle run
     * bills what is owed so far, and anything reviewed afterwards is picked up
     * by the next cycle, the way a payroll run treats a late timesheet.
     */
    if (start.getTime() > Date.now()) {
      return reply
        .code(422)
        .send({ error: `the cycle beginning ${localDate(start.getTime())} has not started` });
    }

    const rows = await settleable(end);

    /**
     * Two units for one collector in one cycle is not two bills. It is a cycle
     * nobody can issue, and it has to be said before anything is written.
     *
     * `bills_no_overlap` refuses a second bill for the same collector over the
     * same period whatever its currency, so the two-bills answer is not
     * representable; and `ON CONFLICT DO NOTHING` targets
     * `bills_collector_period_key`, so the second one would not even raise —
     * whichever currency came first would be issued, the other silently skipped
     * with no audit row and no error, and its settlements left pending for ever
     * because the next cycle's run hits the same conflict.
     *
     * Reachable only by changing `PLAYERONE_CURRENCY` between two verdicts for
     * one collector, which is a deployment mistake rather than a request the
     * caller can fix — so it is a 422 naming the collector, refused before any
     * bill is issued rather than half way through the loop.
     */
    const units = new Map<string, string>();
    for (const row of rows) {
      const seen = units.get(row.collectorId);
      if (seen === undefined) units.set(row.collectorId, row.currency);
      else if (seen !== row.currency) {
        return reply.code(422).send({
          error: `${row.collectorRef} is owed in both ${seen} and ${row.currency} in this cycle, and one bill carries one unit`,
        });
      }
    }

    const byPayee = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byPayee.get(row.collectorId);
      if (bucket === undefined) byPayee.set(row.collectorId, [row]);
      else bucket.push(row);
    }

    let created = 0;
    for (const found of byPayee.values()) {
      const collectorId = found[0]!.collectorId;
      const billId = randomUUID();
      /**
       * Filled from inside the transaction, because until the rows are locked
       * this run does not know which of them are still its own to bill. See the
       * note on `AuditEvent`: `after` is read after `write` resolves.
       */
      const after: {
        collector_id: string;
        collector_ref: string;
        period_start: string;
        period_end: string;
        currency: string;
        total: string;
        settlement_ids: string[];
      } = {
        collector_id: collectorId,
        collector_ref: found[0]!.collectorRef,
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        currency: '',
        total: '',
        settlement_ids: [],
      };

      const written = await mutate(
        db,
        req.actor!,
        { action: 'bill.generate', targetTable: 'bills', targetId: billId, after },
        async (tx) => {
          /**
           * The backlog again, this time locked, and this is what decides which
           * cycle a settlement is paid in.
           *
           * `settleable` has no lower bound on purpose, so two runs for
           * *adjacent* cycles both see the same unbilled rows: their periods
           * differ, `bills_collector_period_key` does not collide, and both
           * would write a line for the same settlement. The loser used to find
           * out at `bill_lines_settlement_key` and 500.
           *
           * `for update` makes the second run wait rather than race. Under READ
           * COMMITTED the locked read takes a fresh snapshot after the lock is
           * granted, so once the first run commits, its rows come back
           * `bill_generated`, fail this predicate, and are simply not on the
           * second bill. First run wins the settlement; the second issues a
           * bill without it, or no bill at all. No exception, and no cycle
           * decided by which transaction reached the index first.
           *
           * Ordered by `created_at, id` so every run takes the locks in the
           * same order, and one transaction only ever holds one payee's rows.
           */
          const locked = (await tx.execute(sql`
            select s.id, s.amount, s.currency
              from settlements s
             where s.collector_id = ${collectorId}
               and s.settlement_state = 'pending_settlement'
               and s.created_at < ${end.toISOString()}::timestamptz
             order by s.created_at, s.id
               for update
          `)) as unknown as { id: string; amount: string; currency: string }[];
          if (locked.length === 0) return undefined;
          /**
           * The same rule as the 422 above, on the authoritative read. Only a
           * verdict committed in the window between the two would land here, so
           * this throws rather than answering — it is a run that must not
           * half-issue, and the alternative is `bill_lines_owner_check` saying
           * the same thing less clearly.
           */
          if (locked.some((l) => l.currency !== locked[0]!.currency)) {
            throw new Error(`collector ${collectorId} is owed in more than one currency this cycle`);
          }

          /**
           * Exact: every amount is a scale-4 decimal string, `add` is rational
           * arithmetic on BigInts, and `quantise` at the scale of the column it
           * is going into cannot move a value that is already at that scale.
           * The quantise call is what turns the rational back into the string
           * Postgres wants — it is not a second rounding site.
           */
          const total = quantise(
            locked.reduce((acc, line) => add(acc, fromDecimal(line.amount)), ZERO),
            MONEY_SCALE,
          );
          /** The unit the work was scored in, never the one configuration says today. */
          after.currency = locked[0]!.currency;
          after.total = total;
          after.settlement_ids = locked.map((l) => l.id);

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
              currency: after.currency,
              total,
            })
            .onConflictDoNothing({
              target: [schema.bills.collectorId, schema.bills.periodStart, schema.bills.periodEnd],
            })
            .returning({ id: schema.bills.id });
          if (bill === undefined) return undefined;

          await tx
            .insert(schema.billLines)
            .values(locked.map((l) => ({ billId, settlementId: l.id })));
          /**
           * `pending_settlement` in the WHERE as well as in the locked read: the
           * lock is what makes this true rather than hopeful, and the count is
           * what proves it.
           */
          const moved = await tx
            .update(schema.settlements)
            .set({ settlementState: 'bill_generated', updatedAt: new Date() })
            .where(
              and(
                inArray(
                  schema.settlements.id,
                  locked.map((l) => l.id),
                ),
                eq(schema.settlements.settlementState, 'pending_settlement'),
              ),
            )
            .returning({ id: schema.settlements.id });
          if (moved.length !== locked.length) {
            throw new Error('a settlement on this bill was billed by someone else');
          }
          return bill;
        },
      );
      if (written !== undefined) created += 1;
    }

    /**
     * Refused work in *this* cycle, and only this cycle.
     *
     * An unscoped `count(*) where settlement_state = 'not_payable'` answers a
     * question nobody asked: regenerating an August cycle would report every
     * refusal recorded since, including collectors and centres this request has
     * nothing to do with. The window is the same one the bills use, so the
     * number sits beside them and means what a reader assumes it means.
     */
    const notPayable = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.settlements)
      .where(
        and(
          eq(schema.settlements.settlementState, 'not_payable'),
          gte(schema.settlements.createdAt, start),
          lt(schema.settlements.createdAt, end),
        ),
      )) as { n: number }[];

    return reply.send({
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      cycle_days: cycleDays,
      created,
      /**
       * Work refused *in this cycle* and therefore never billed — a rejected
       * episode, or a partial pass whose every span was cut. Reported because a
       * number nobody can see is how a surprise starts, and scoped to the
       * period because a count of every refusal ever recorded is a different
       * report with a different audience.
       */
      not_payable: notPayable[0]?.n ?? 0,
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
    const id = Uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(404).send({ error: 'no such bill' });
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
      .where(eq(schema.bills.id, id.data));
    if (bill === undefined) return reply.code(404).send({ error: 'no such bill' });

    const lines = await linesOf(id.data);
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
      const lines = await linesOf(bill.id);
      /**
       * The bill's own block of the file, built before the event so the event
       * can name it. Without a digest the audit row says a bill was exported
       * and nothing about *what* — and every column in it is live state that
       * can move afterwards, so a file finance produces later cannot be checked
       * against anything. The hash is over the exact cells that were sent.
       */
      const block = lines.map((line) =>
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
      /**
       * PLT-07 / SEC-04. Taking a collector's pay out of the system in a form
       * that can be mailed on is a material act, so it is recorded like one —
       * per bill, because "who exported this collector's figures" is the
       * question an audit actually asks, and the period alone cannot answer it.
       *
       * The payload names the scope and nothing else: no amounts, no CSV. What
       * was exported is reconstructable from the bill id and the line count.
       *
       * ponytail: one transaction per bill. A weekly export of the 500-collector
       * target is 500 short transactions, which nobody has measured as a
       * problem; if it becomes one, `mutate` needs a batch form rather than this
       * loop needing a clever one.
       */
      await mutate(
        db,
        req.actor!,
        {
          action: 'bill.export',
          targetTable: 'bills',
          targetId: bill.id,
          after: {
            period_start: period.start.toISOString(),
            period_end: period.end.toISOString(),
            collector_ref: bill.collectorRef,
            lines: lines.length,
            /**
             * The exact rows that left, so the event can be checked against a
             * file somebody produces later. Amounts are deliberately not here:
             * they are already immutable on the settlements these name, and an
             * audit payload is not a second copy of the ledger.
             */
            settlement_ids: lines.map((l) => l.settlementId),
            /**
             * What each of those settlements said at the moment it left, and a
             * digest of the exact bytes. `total` and `settlement_states` are
             * the mutable parts of the artifact; the digest covers the whole
             * block, so an event and a file either agree or visibly do not.
             */
            settlement_states: lines.map((l) => [l.settlementId, l.state]),
            total: bill.total,
            sha256: createHash('sha256').update(block.join('\r\n'), 'utf8').digest('hex'),
            format: 'csv',
          },
        },
        async () => ({ exported: true }),
      );
      rows.push(...block);
    }

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        // The cycle's own local date. `toISOString().slice(0,10)` on a
        // local-midnight instant prints the *previous* day, so an Aug 17 cycle
        // downloaded as `...-2026-08-16.csv`.
        `attachment; filename="playerone-settlement-${localDate(period.start.getTime())}.csv"`,
      )
      /**
       * A byte-order mark, because finance opens this in Excel and Excel reads a
       * BOM-less UTF-8 CSV as the local code page. Task names are Chinese.
       */
      .send(`﻿${rows.join('\r\n')}\r\n`);
  });

  // -------------------------------------------------------------------------
  // SET-03: finance marks manual payment

  app.post('/api/settle/bills/:id/pay', opts, async (req, reply) => {
    const parsed = Uuid.safeParse((req.params as { id: string }).id);
    if (!parsed.success) return reply.code(404).send({ error: 'no such bill' });
    const id = parsed.data;
    const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
    if (bill === undefined) return reply.code(404).send({ error: 'no such bill' });

    const before = await linesOf(id);
    const payable = before.filter((l) => l.state === 'bill_generated').map((l) => l.settlementId);

    /**
     * Filled inside the transaction, from the rows the UPDATE actually returned.
     *
     * The obvious version records `payable` — the ids read *before* the
     * transaction — and that is an audit row asserting something the database
     * never confirmed. `mutate` reads `after` only after `write` resolves, which
     * is what makes this legal; see the note on `AuditEvent`.
     */
    const after: { settlement_state: string; settlement_ids: string[]; total: string } = {
      settlement_state: 'manually_paid',
      settlement_ids: [],
      total: bill.total,
    };
    let marked = 0;

    if (payable.length > 0) {
      await mutate(
        db,
        req.actor!,
        {
          action: 'bill.pay',
          targetTable: 'bills',
          targetId: id,
          before: { settlement_states: before.map((l) => [l.settlementId, l.state]) },
          after,
        },
        async (tx) => {
          /**
           * `bill_generated` in the WHERE and `manually_paid` as the target, so
           * the transition guard is the arbiter and this never has to enumerate
           * which states may be paid.
           */
          const paid = await tx
            .update(schema.settlements)
            .set({ settlementState: 'manually_paid', updatedAt: new Date() })
            .where(
              and(
                inArray(schema.settlements.id, payable),
                eq(schema.settlements.settlementState, 'bill_generated'),
              ),
            )
            .returning({ id: schema.settlements.id });
          after.settlement_ids = paid.map((p) => p.id);
          marked = paid.length;
          return paid.length === 0 ? undefined : paid;
        },
      );
    }

    const lines = await linesOf(id);
    return reply.send({
      id,
      total: bill.total,
      currency: bill.currency,
      paid: lines.length > 0 && lines.every((l) => l.state === 'manually_paid'),
      /**
       * What was paid, not what was intended: zero on a bill that was already
       * paid, which is not an error, and never a count the database did not
       * return.
       */
      marked,
      settlements: lines.map((l) => ({ settlement_id: l.settlementId, settlement_state: l.state })),
    });
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
