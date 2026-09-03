import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '@playerone/store';
import {
  MINUTES_SCALE,
  MONEY_SCALE,
  ZERO,
  add,
  div,
  fromDecimal,
  quantise,
  rational,
} from './money.ts';
import { loadBill, type BatchBill, type BatchOptions, type Issue } from './payout/worker/batch.ts';

/**
 * What a collector is told about their own money.
 *
 * Everything here is a READ. Nothing in this file writes, so nothing here goes
 * through `mutate` — there is no mutation to audit.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * `GET /api/payout/collectors/:id/income` is the operator's view of a
 * collector's money, and an audit measured it lying to the collector in four
 * distinct ways. Reproduced on this branch before any of this was written:
 *
 *   1. A bill for a collector with NO payout account reports `approved`, which
 *      the app prints as "Đã duyệt, chờ chi trả" — approved, awaiting payment.
 *      The payout worker would refuse that bill outright (`no_account`). The
 *      collector is told money is coming while the one thing they could fix
 *      goes unmentioned.
 *   2. A rejected episode's settlement is worth 0.0000 and sits in
 *      `pending_settlement` for ever by `settle.ts`'s own deliberate design.
 *      The endpoint reports it as `pending_review` — "awaiting review" — for a
 *      verdict that was reached and was a refusal.
 *   3. Reviewed money not yet billed is `pending_settlement`, and is reported
 *      as `pending_review` too. Same bucket, same wrong word.
 *   4. A settlement parked in `exception` and not on a bill returns nothing at
 *      all: `periods: []`. The episode vanishes and the collector sees no
 *      trace of work they did.
 *
 * The root cause of 1 is that the endpoint recomputes payability from two
 * columns (`all_paid`, `parked`) while the payout worker computes it from ten
 * (`issuesOf`). Two answers to one question, and the collector reads the wrong
 * one. So this file does not recompute: it calls `loadBill`, the same function
 * the batch runner and the preflight call, and maps its `Issue[]` onto what a
 * collector is allowed to see. A blocking condition added to the worker next
 * year reaches this endpoint on the day it is added.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NEVER REACH A COLLECTOR, AND WHY IT IS STRUCTURAL HERE
 *
 * A collector must never be shown:
 *
 *   - `settlements.exception_reason`. `wrong_collector` accuses a second,
 *     unnamed person; `duplicate` accuses this one of fraud before any verdict.
 *   - `settlements.exception_note`. Free text an operator typed. It is
 *     evidence, and it is about a person.
 *   - risk signal ids and their evidence. The `OPS.*` family — `SELF_DEALING`,
 *     `REVIEW_TOO_FAST` — are findings about VNG's OWN STAFF, and a hold on a
 *     bill can be raised by one of them. `IDENT.*_SHARED` and
 *     `CONT.NEAR_DUPLICATE` name another collector by implication.
 *   - `review_disputes.reason`, the text of a challenge.
 *   - who reviewed the footage.
 *   - internal constraint names.
 *
 * Being careful is not a guarantee, so none of that is enforced by care:
 *
 *   - `CollectorState` is a closed union and `STATE_SENTENCES` is a
 *     `Record<CollectorState, …>`. A state with no sentence does not compile.
 *   - `ISSUE_STATE` is a `Record<Issue, CollectorState>`. A NEW blocking
 *     condition added to `issuesOf` does not compile until somebody chooses
 *     which of the ten collector-facing states it becomes. It cannot default
 *     to silence, and it cannot invent a sentence of its own.
 *   - `IncomeRow` and `EpisodeRow` have NO field that can hold a reason code,
 *     a note, a signal id or a person's name. There is nowhere to put one.
 *   - The failure reasons on `/api/me/episodes` are INNER JOINed to
 *     `review_reason_codes`. The exception reasons (`wrong_collector`,
 *     `duplicate`, `disputed`, `manual_hold`, `superseded`) are not rows in
 *     that table and never will be, so the join cannot produce a label for one.
 *     The database is the guard, which is where this repository puts its
 *     invariants.
 *   - The SQL below selects `exists(…)` booleans where the underlying column is
 *     free text. A boolean cannot carry a sentence somebody typed.
 *
 * Same argument as `quantise` being the only rounding site: put the guarantee
 * where it cannot be worked around, not in a reviewer's memory.
 */

// ---------------------------------------------------------------------------
// The state vocabulary

/**
 * The ten things a collector may be told about one episode, plus `unknown`.
 *
 * A closed set on purpose. The internal vocabulary is much larger — five
 * settlement states, four review states, ten blocking conditions, an exception
 * lane, a dispute lane — and most of those distinctions are either meaningless
 * to a collector or actively harmful to show them. Everything internal maps
 * onto one of these or onto `unknown`; nothing invents a sentence.
 *
 * `unknown` is not a failure mode, it is the safety property. An internal state
 * added next year that nobody has mapped renders as "we are checking" rather
 * than as a leak or a crash.
 */
export type CollectorState =
  /** Footage is in. No verdict yet. */
  | 'uploaded'
  /** Reviewed, worth money, not yet on a bill. */
  | 'approved'
  /** Reviewed and refused. Worth nothing, and it never will be. */
  | 'not_paid'
  /** On a bill, nothing blocking it. */
  | 'on_a_bill'
  /** The collector can fix this themselves, and the sentence says how. */
  | 'action_needed'
  /** Blocked on something VNG must do. Not the collector's problem. */
  | 'waiting_on_us'
  /** Held. Deliberately carries no reason: see the note above. */
  | 'on_hold'
  /** A second review is running. */
  | 'being_rechecked'
  /** The money left. */
  | 'paid'
  /** This row will never be paid, and no action changes that. */
  | 'cannot_be_paid'
  /** An internal state nobody has mapped. Never a leak, never a crash. */
  | 'unknown';

/**
 * One fixed sentence per state, in the two languages the app renders.
 *
 * Vietnamese and English only. LOC-01 puts Vietnamese on the collector app;
 * LOC-02 puts Chinese on the back office, for PaXini's reviewers, who never
 * see this endpoint. Adding `zh` here would put a third of the catalogue in
 * front of nobody.
 *
 * These are NOT in `i18n.ts`. That catalogue's completeness test requires every
 * key in all three locales, and these keys have no Chinese by design. They are
 * also the only strings in the service whose whole purpose is that they cannot
 * be composed from data — a template with a slot is a slot something leaks
 * through.
 *
 * `action_needed` names the fix in the same breath as the problem, because it
 * is the one state where the collector can do anything at all. It covers both
 * a missing account and an unverified one with one sentence rather than two
 * states: the collector opens the same screen either way, and which of the two
 * it is is visible to them there.
 */
export const STATE_SENTENCES: Record<CollectorState, { en: string; vi: string }> = {
  uploaded: {
    en: 'Uploaded. Waiting to be reviewed.',
    vi: 'Đã tải lên. Đang chờ duyệt.',
  },
  approved: {
    en: 'Reviewed and approved. It will go on your next bill.',
    vi: 'Đã duyệt. Khoản này sẽ vào hóa đơn kỳ tới của bạn.',
  },
  not_paid: {
    en: 'Reviewed, and this recording was not accepted. It will not be paid.',
    vi: 'Đã duyệt, và bản ghi này không được chấp nhận. Khoản này sẽ không được trả.',
  },
  on_a_bill: {
    en: 'On a bill and waiting to be paid.',
    vi: 'Đã lên hóa đơn và đang chờ chi trả.',
  },
  action_needed: {
    en: 'We cannot pay this yet. Your ZaloPay payout account is missing or not verified. Add or verify it in your profile and this will pay on the next run.',
    vi: 'Chúng tôi chưa thể chi trả khoản này. Tài khoản nhận tiền ZaloPay của bạn chưa có hoặc chưa được xác minh. Hãy thêm hoặc xác minh trong hồ sơ của bạn; khoản này sẽ được trả ở lần chạy kế tiếp.',
  },
  waiting_on_us: {
    en: 'On a bill. Something on our side has to be finished before it can pay. You do not need to do anything.',
    vi: 'Đã lên hóa đơn. Chúng tôi cần hoàn tất một việc phía mình trước khi chi trả. Bạn không cần làm gì.',
  },
  on_hold: {
    en: 'On hold while we check it. You do not need to do anything.',
    vi: 'Đang tạm giữ để chúng tôi kiểm tra. Bạn không cần làm gì.',
  },
  being_rechecked: {
    en: 'Being reviewed a second time. The result may change.',
    vi: 'Đang được duyệt lại lần hai. Kết quả có thể thay đổi.',
  },
  paid: {
    en: 'Paid.',
    vi: 'Đã chi trả.',
  },
  cannot_be_paid: {
    en: 'This entry has been replaced and will not be paid. The replacement is listed separately.',
    vi: 'Mục này đã được thay thế và sẽ không được chi trả. Mục thay thế được liệt kê riêng.',
  },
  unknown: {
    en: 'We are checking this one. Contact support if it does not change.',
    vi: 'Chúng tôi đang kiểm tra mục này. Hãy liên hệ hỗ trợ nếu nó không thay đổi.',
  },
};

/**
 * Every blocking condition the payout worker computes, and what a collector is
 * told about it.
 *
 * `Record<Issue, …>`, not a lookup with a fallback, and that is the whole
 * point. `issuesOf` in `batch.ts` owns the list of what stands between a bill
 * and a transfer. When somebody adds an eleventh, this file stops compiling
 * until they decide whether the collector should act, wait, or be told nothing
 * — which is a decision a person makes once, in a diff, rather than a default
 * nobody notices.
 *
 * Note what is deliberately flattened. `risk_hold` becomes `on_hold` and
 * carries no signal id: a hold can be raised by an `OPS.*` finding about VNG's
 * own reviewer, and `IDENT.*_SHARED` implicates a second collector. Neither is
 * the collector's business and neither is safe to name.
 * `line_in_exception` becomes `on_hold` for the same reason — its
 * `exception_reason` is `wrong_collector` or `duplicate`, which accuse.
 */
const ISSUE_STATE: Record<Issue, CollectorState> = {
  no_account: 'action_needed',
  account_unverified: 'action_needed',
  already_paid: 'paid',
  line_in_exception: 'on_hold',
  risk_hold: 'on_hold',
  // A bill worth less than one dong floors to nothing, so no transfer can
  // carry it. There is nothing the collector can do about that and nothing
  // they did wrong, and what the platform does with such a bill — carry it or
  // write it off — is not decided yet. So: our backlog, and say nothing more.
  // (This slot held `total_fractional` until migration 0018 retired it.)
  under_one_dong: 'waiting_on_us',
  over_bank_ceiling: 'waiting_on_us',
  under_bank_minimum: 'waiting_on_us',
  over_cap: 'waiting_on_us',
  attempt_open: 'waiting_on_us',
};

/**
 * Which state wins when a bill trips several conditions at once.
 *
 * `paid` first: if the money left, nothing else about the bill matters.
 * `action_needed` next, ahead of both holds and our own backlog, because it is
 * the only one the collector can act on — a bill that is BOTH risk-held and
 * missing an account should still say "add your account", since that is true,
 * useful, and reveals nothing about the hold.
 */
const PRECEDENCE: readonly CollectorState[] = ['paid', 'action_needed', 'on_hold', 'waiting_on_us'];

/**
 * The internal world, as one row, reduced to the ten words a collector reads.
 *
 * Pure and exported so it can be tested without a database. Note the argument
 * type: settlement and review states arrive as plain strings because that is
 * what Postgres holds, but nothing here passes one OUT. The only thing that
 * leaves is a `CollectorState`.
 */
export function collectorStateOf(row: {
  reviewState: string | null;
  settlementState: string | null;
  superseded: boolean;
  disputeOpen: boolean;
  amount: string | null;
  billIssues: readonly Issue[] | null;
  billPaid: boolean;
}): CollectorState {
  // No verdict yet, in either of the two ways that happens: no review row at
  // all, or one claimed and not yet decided.
  if (row.reviewState === null || row.reviewState === 'pending') return 'uploaded';

  // A second review is running. It outranks whatever the first verdict said,
  // because the first verdict is the thing being reconsidered.
  if (row.disputeOpen) return 'being_rechecked';

  // Replaced by a second verdict. `bill_lines_dispute_guard` refuses it a line
  // for ever, so "cannot be paid" is the literal truth, not a euphemism.
  if (row.superseded) return 'cannot_be_paid';

  if (row.settlementState === null) return 'unknown';

  switch (row.settlementState) {
    case 'pending_review':
      return 'uploaded';
    case 'exception':
      // The reason is never read, never selected and never rendered.
      return 'on_hold';
    case 'manually_paid':
      return 'paid';
    case 'pending_settlement':
      /**
       * Reviewed. Two very different outcomes share one internal state, and
       * conflating them is defect 2 above: a rejected episode's settlement is
       * worth 0.0000 and stays here for ever, on purpose (`settle.ts` — it is
       * the score of the review and what a dispute points at), while approved
       * money sits here only until the next billing cycle. The amount is what
       * separates them, and the collector is owed the difference.
       */
      return row.amount !== null && fromDecimal(row.amount).n === 0n ? 'not_paid' : 'approved';
    case 'bill_generated': {
      if (row.billPaid) return 'paid';
      // Not on a bill we could load: the line exists but the bill does not.
      // Nothing to say beyond "we are checking".
      if (row.billIssues === null) return 'unknown';
      const states = row.billIssues.map((i) => ISSUE_STATE[i]);
      return PRECEDENCE.find((s) => states.includes(s)) ?? 'on_a_bill';
    }
    default:
      // A settlement state added after this file was written. It renders as
      // "we are checking this one" rather than as a leak or a 500.
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// The rows, and what they may hold

/**
 * One episode's money, as the collector reads it (APP-33, P0).
 *
 * Per episode and not per period: APP-33 says a collector sees what each
 * recording earned. A weekly total cannot answer "why was that one worth less
 * than the other one", which is the question that produces a dispute.
 *
 * There is no field here for a reason code, a note, a signal or a name, and
 * that absence is the guarantee. Adding one is a visible act in a diff.
 *
 * `effective_minutes`, `unit_price` and `amount` are null together, exactly
 * when there is no verdict. THE SERVER NEVER SENDS AN ESTIMATE IT DID NOT
 * COMPUTE: an un-reviewed episode has no effective minutes, because effective
 * minutes are a human's judgement of which seconds were useful, and no formula
 * predicts one. `raw_minutes` carries the measured duration in that case,
 * which is a fact the ingest engine did measure. The app must render the null
 * as "not yet decided" and must not multiply anything.
 */
export type IncomeRow = {
  episode_id: string;
  task_name: string;
  /**
   * `YYYYMMDD_HHMMSS` from the recording's own directory name, verbatim.
   *
   * Deliberately not an ISO instant. The device stamps its local clock with no
   * zone, so converting it to UTC would invent an offset nobody measured. The
   * app renders it as local time, which is what it is.
   */
  recorded_at: string;
  /** The measured duration, in minutes. Never a payable figure on its own. */
  raw_minutes: string;
  /** Null until a reviewer has decided. Never estimated. */
  effective_minutes: string | null;
  unit_price: string | null;
  amount: string | null;
  /** True when a reviewer has decided, so the figures above are final. */
  confirmed: boolean;
  state: CollectorState;
  state_text: { en: string; vi: string };
  paid_at: string | null;
};

/**
 * One episode's status and, when it failed, why (QR-04 and APP-27, both P0).
 *
 * `reasons` is the only place a code reaches a collector, and every code in it
 * resolves to a `review_reason_codes` row — a footage-quality finding about
 * their own recording, which is precisely what QR-04 requires them to be told
 * "in a form they can act on". The exception reasons live in a different
 * column of a different table and are not rows here, so the join that builds
 * this list cannot produce one.
 */
export type EpisodeRow = {
  episode_id: string;
  recorded_at: string;
  state: CollectorState;
  state_text: { en: string; vi: string };
  /** Whole bytes of the latest delivery. */
  size_bytes: string;
  reasons: { code: string; label: string }[];
};

// ---------------------------------------------------------------------------
// The read

type RawRow = {
  episode_id: string;
  task_name: string;
  recorded_at: string;
  measured_s: string | null;
  review_state: string | null;
  review_id: string | null;
  settlement_state: string | null;
  unit_price: string | null;
  effective_minutes: string | null;
  amount: string | null;
  superseded: boolean;
  settlement_updated_at: Date | string | null;
  bill_id: string | null;
  size_bytes: string;
  dispute_open: boolean;
};

/**
 * Every episode this collector recorded, with the money on it.
 *
 * The join path is the one the whole service uses and the reason SET-04 holds:
 * a settlement reaches its collector only through its review, its episode and
 * its session. `settlements` has no foreign key to a collector and must not
 * grow one.
 *
 * Note what is NOT selected. `exception_reason`, `exception_note`,
 * `review_disputes.reason`, `episode_reviews.reviewer_ref` and every risk table
 * are absent. The dispute is read as `exists(…)` — a boolean, which cannot
 * carry the sentence somebody typed into it.
 */
async function rawRows(db: Db, collectorId: string): Promise<RawRow[]> {
  return (await db.execute(sql`
    select e.episode_id,
           t.name as task_name,
           e.session_started_at as recorded_at,
           coalesce(r.measured_duration_s, i.measured_duration_s) as measured_s,
           r.review_state,
           r.id as review_id,
           s.settlement_state,
           s.unit_price,
           s.effective_minutes,
           s.amount,
           (s.superseded_by is not null) as superseded,
           s.updated_at as settlement_updated_at,
           l.bill_id,
           coalesce((select sum(f.size_bytes) from episode_files f where f.ingest_id = i.ingest_id), 0)::text as size_bytes,
           (r.id is not null and exists (
              select 1 from review_disputes d where d.review_id = r.id and d.resolved_at is null
           )) as dispute_open
      from episodes e
      join collection_sessions cs on cs.id = e.collection_session_id
      join tasks t on t.id = cs.task_id
      left join lateral (
        select * from episode_ingests ei
         where ei.episode_id = e.episode_id
         order by ei.ingested_at desc limit 1
      ) i on true
      /**
       * The LATEST review, not the first. A disputed episode has two, and the
       * second one is the live verdict; showing the first would report a
       * result that has already been overturned.
       */
      left join lateral (
        select * from episode_reviews er
         where er.episode_id = e.episode_id
         order by er.reviewed_at desc nulls last, er.created_at desc limit 1
      ) r on true
      left join settlements s on s.episode_review_id = r.id
      left join bill_lines l on l.settlement_id = s.id
     where cs.collector_id = ${collectorId}
     order by e.session_started_at desc, e.episode_id asc
  `)) as unknown as RawRow[];
}

/**
 * The bills behind those rows, read the way the payout worker reads them.
 *
 * `loadBill` is the whole point of this function: it is what the batch runner
 * and the preflight call, so the collector is told about the same ten blocking
 * conditions that will actually decide whether the transfer goes. Recomputing
 * payability here from two columns is exactly the defect this endpoint exists
 * to remove.
 *
 * ponytail: one `loadBill` per distinct bill, memoised per request. At pilot
 * scale (~20 devices, weekly bills) a collector has a handful. If a collector
 * ever accumulates hundreds of bills, this wants one batched query rather than
 * a loop — but not before, and not on a guess.
 */
async function billsOf(db: Db, rows: RawRow[], options: BatchOptions): Promise<Map<string, BatchBill>> {
  const bills = new Map<string, BatchBill>();
  for (const id of new Set(rows.map((r) => r.bill_id).filter((b): b is string => b !== null))) {
    const bill = await loadBill(db, id, options);
    if (bill !== undefined) bills.set(id, bill);
  }
  return bills;
}

/** Minutes from seconds, through the one rounding site this service has. */
const minutesOf = (seconds: string): string =>
  quantise(div(fromDecimal(seconds), rational(60n)), MINUTES_SCALE);

const iso = (v: Date | string | null): string | null =>
  v === null ? null : new Date(v).toISOString();

/**
 * When the money actually left, or null.
 *
 * Two rails, two answers. On the ZaloPay rail it is the succeeded attempt's
 * `settled_at`. On the manual rail (SET-03) there is no attempt, and the
 * closest honest fact is when the settlement was moved to `manually_paid`,
 * which is a terminal state — nothing moves it again, so `updated_at` is that
 * moment. Null when neither applies, including on a bill that is paid but
 * whose date we cannot state: a wrong date on a payment is worse than none.
 */
function paidAt(row: RawRow, bill: BatchBill | undefined): string | null {
  if (row.settlement_state === 'manually_paid') return iso(row.settlement_updated_at);
  if (bill?.latestAttempt?.status === 'succeeded') return iso(bill.latestAttempt.settledAt);
  return null;
}

function stateOf(row: RawRow, bill: BatchBill | undefined): CollectorState {
  return collectorStateOf({
    reviewState: row.review_state,
    settlementState: row.settlement_state,
    superseded: row.superseded,
    disputeOpen: row.dispute_open,
    amount: row.amount,
    billIssues: row.bill_id === null ? null : (bill?.issues ?? null),
    billPaid: bill?.paid ?? false,
  });
}

const decided = (reviewState: string | null): boolean =>
  reviewState !== null && reviewState !== 'pending';

// ---------------------------------------------------------------------------
// Routes

export type MeOptions = BatchOptions;

/** The same structural shape the payout and settle routes use for a preHandler. */
type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

export function registerMe(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: MeOptions = {},
): void {
  const read = { preHandler: requireActor };

  /**
   * The collector id, and the only way this file can learn one.
   *
   * It comes off the token. It is in no path, no query string and no body, so
   * there is nothing for a collector to tamper with and no id for one
   * collector to substitute for another's — the class of bug that needs a test
   * per route simply has no route to occur on.
   *
   * `requireActor` has already refused an operator or reviewer token on this
   * prefix (`ME_SCOPE` in `index.ts`). This is the second half of the same
   * statement, and it is not redundant: it is what makes the guarantee local
   * to this file, so a future mounting of these routes cannot lose it.
   */
  const collectorId = (req: FastifyRequest): string | null => req.collector?.collectorId ?? null;

  /**
   * APP-33 (P0): what each recording earned.
   *
   * One row per episode, plus the period totals a collector needs to check a
   * payment against a bill. The totals come from `bills.total` as stored —
   * this endpoint adds nothing up that the settlement lane has not already
   * added up and frozen, so there is no second arithmetic to disagree with the
   * first.
   *
   * ponytail: no pagination. A collector gets every episode they ever
   * recorded. At pilot scale that is tens of rows. Add a cursor when a real
   * collector's list gets slow — and only a cursor: silently truncating a list
   * of money to keep the response small would reintroduce the exact defect
   * this endpoint exists to remove, which is work disappearing from it.
   */
  app.get('/api/me/income', read, async (req, reply) => {
    const me = collectorId(req);
    if (me === null) return reply.code(403).send({ error: 'collector session required' });

    const rows = await rawRows(db, me);
    const bills = await billsOf(db, rows, options);

    const episodes: IncomeRow[] = rows.map((row) => {
      const bill = row.bill_id === null ? undefined : bills.get(row.bill_id);
      const state = stateOf(row, bill);
      const isDecided = decided(row.review_state);
      return {
        episode_id: row.episode_id,
        task_name: row.task_name,
        recorded_at: row.recorded_at,
        raw_minutes: minutesOf(row.measured_s ?? '0'),
        // Null together, and only when no human has judged the footage.
        effective_minutes: isDecided ? row.effective_minutes : null,
        unit_price: isDecided ? row.unit_price : null,
        amount: isDecided ? row.amount : null,
        confirmed: isDecided,
        state,
        state_text: STATE_SENTENCES[state],
        paid_at: paidAt(row, bill),
      };
    });

    /**
     * The periods, from the bills themselves. `total` is the frozen sum of the
     * line amounts, guarded by `bills_total_matches_lines`, so printing it is
     * printing what finance will pay rather than a figure computed twice.
     */
    const billRows = (await db.execute(sql`
      select b.id, b.period_start, b.period_end, b.total::text as total,
             (select count(*)::int from bill_lines l where l.bill_id = b.id) as episodes
        from bills b
       where b.collector_id = ${me}
       order by b.period_start desc
    `)) as unknown as {
      id: string;
      period_start: Date | string;
      period_end: Date | string;
      total: string;
      episodes: number;
    }[];

    const periods = billRows.map((b) => {
      const bill = bills.get(b.id);
      const state: CollectorState =
        bill === undefined
          ? 'unknown'
          : bill.paid
            ? 'paid'
            : (PRECEDENCE.find((s) => bill.issues.map((i) => ISSUE_STATE[i]).includes(s)) ??
              'on_a_bill');
      return {
        period_start: iso(b.period_start),
        period_end: iso(b.period_end),
        amount: b.total,
        episodes: b.episodes,
        state,
        state_text: STATE_SENTENCES[state],
      };
    });

    /**
     * Reviewed and worth money, but no bill has been generated yet. Reported
     * separately rather than folded into a period, because it belongs to no
     * period: the settlement lane bills "everything still owed at the end of
     * this cycle", so this money lands on whichever cycle runs next.
     *
     * Counted and summed from the SAME list the collector is looking at, not
     * from a second query with its own WHERE clause. A near miss while writing
     * this: the count came from `state === 'approved'` and the sum from a
     * separate `settlement_state = 'pending_settlement'` query, which disagree
     * the moment an episode is under dispute — "2 episodes, 24,000 VND" over a
     * list showing three. One source, one answer.
     *
     * The addition is exact rational arithmetic and `quantise` is the same
     * single rounding site the rest of the service uses. Nothing rounds here:
     * every term is already at `MONEY_SCALE`, so the quantise is a formatter,
     * not a decision.
     */
    const notBilled = episodes.filter((e) => e.state === 'approved');
    const unbilled = quantise(
      notBilled.reduce((total, e) => add(total, fromDecimal(e.amount ?? '0')), ZERO),
      MONEY_SCALE,
    );

    return {
      currency: 'VND',
      episodes,
      periods,
      not_yet_billed: { episodes: notBilled.length, amount: unbilled },
    };
  });

  /**
   * QR-04 and APP-27, both P0: a collector must be told why their footage
   * failed, in words they can act on.
   *
   * `label` is the Vietnamese one (LOC-01 puts Vietnamese on the app), falling
   * back to English only where VNG has not localised a code yet — the column is
   * nullable precisely so that gap is visible rather than silently blank.
   *
   * The join to `review_reason_codes` is an INNER join and that is load-bearing.
   * It is what makes it impossible for this endpoint to render an exception
   * reason: `wrong_collector` and `duplicate` are not codes in that catalogue,
   * so there is no row to join to and no label to print. A leak would require
   * somebody to insert an accusation into the review standard's own catalogue.
   */
  app.get('/api/me/episodes', read, async (req, reply) => {
    const me = collectorId(req);
    if (me === null) return reply.code(403).send({ error: 'collector session required' });

    const rows = await rawRows(db, me);
    const bills = await billsOf(db, rows, options);

    const reviewIds = rows.map((r) => r.review_id).filter((r): r is string => r !== null);
    const reasons = new Map<string, { code: string; label: string }[]>();
    if (reviewIds.length > 0) {
      const found = (await db.execute(sql`
        select rr.review_id, rc.code, coalesce(rc.label_vi, rc.label_en) as label
          from episode_review_reasons rr
          join review_reason_codes rc on rc.code = rr.code
         where rr.review_id in (${sql.join(
           reviewIds.map((id) => sql`${id}`),
           sql`, `,
         )})
         order by rc.code asc
      `)) as unknown as { review_id: string; code: string; label: string }[];
      for (const f of found) {
        const list = reasons.get(f.review_id) ?? [];
        list.push({ code: f.code, label: f.label });
        reasons.set(f.review_id, list);
      }
    }

    const episodes: EpisodeRow[] = rows.map((row) => {
      const state = stateOf(row, row.bill_id === null ? undefined : bills.get(row.bill_id));
      return {
        episode_id: row.episode_id,
        recorded_at: row.recorded_at,
        state,
        state_text: STATE_SENTENCES[state],
        size_bytes: row.size_bytes,
        reasons: row.review_id === null ? [] : (reasons.get(row.review_id) ?? []),
      };
    });

    return { episodes };
  });
}
