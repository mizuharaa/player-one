import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { mutate } from '../../audit.ts';
import type { Actor } from '../../actor.ts';
import type { TransferReceiver, ZaloPayClient } from '../domain/client-contract.ts';
import {
  applyEvent,
  attemptById,
  insertAttempt,
  latestAttemptOf,
  wholeVnd,
  type AttemptRow,
} from '../domain/attempts.ts';
import { emitEvent } from '../domain/events.ts';
import { maskPhone } from '../domain/names.ts';
import { clearSummary, noRisk, type RiskReader, type RiskSummary } from '../domain/risk.ts';
import type { AttemptEvent } from '../domain/state.ts';

/**
 * A batch is a loop in our code (Part 0, F1: there is no batch endpoint), and
 * therefore a batch is not atomic. Everything here is written for partial
 * completion as the normal case:
 *
 *   - Preflight before any transfer: the wallet balance is read and the WHOLE
 *     batch is refused if it is below the total plus a margin. Not "pay the
 *     first N and stop" — a batch that pays some collectors and not others,
 *     for a reason known before it started, is an outcome nobody chose.
 *   - Sequential, never parallel, with a pause between calls. Throughput is
 *     irrelevant at pilot scale; a stampede against an unfamiliar payment API
 *     is not.
 *   - One failure stops the batch and reports. What is already sent is sent;
 *     the poller finishes those.
 *
 * `payBill` is the single path from "pay this bill" to "a transfer was sent",
 * used by the route and by the batch alike. Its shape is three transactions
 * on purpose:
 *
 *   1. insert the attempt as `created`, audited, all the triggers of 0012 and
 *      0013 deciding whether it may exist at all;
 *   2. move it to `submitted` — committed BEFORE the request goes out, so a
 *      crash during the request leaves a row the poller will pick up;
 *   3. apply ZaloPay's answer.
 *
 * A crash between 1 and 2 leaves a `created` attempt that was never sent; it
 * is listed by the batch view and an operator voids it with a reason. Nothing
 * automatic resends, because "never sent" is only known to be true if nothing
 * ever sends on a guess.
 */

/** Part 0, F5. ZaloPay's limits, not policy. */
export const BANK_CEILING_VND = 10_000_000;
export const BANK_MINIMUM_VND = 2_000;
/** The balance must cover the batch with 5% to spare. */
export const BALANCE_MARGIN = 1.05;

export type Issue =
  | 'no_account'
  | 'account_unverified'
  | 'total_fractional'
  | 'over_bank_ceiling'
  | 'under_bank_minimum'
  | 'over_cap'
  | 'risk_hold'
  | 'attempt_open'
  | 'already_paid'
  /** A line parked in `exception` (0016). The bill waits until it is released. */
  | 'line_in_exception';

export type BatchBill = {
  id: string;
  collectorId: string;
  collectorRef: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  /** As stored: numeric(14,4) text. */
  total: string;
  /** Whole dong, or null when the total is fractional. */
  amountVnd: number | null;
  lineCount: number;
  /** All settlements manually_paid (SET-03), or a succeeded attempt exists. */
  paid: boolean;
  /** Any settlement on the bill is in `exception`. */
  inException: boolean;
  account: {
    id: string;
    method: 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD';
    verifyStatus: string;
    declaredName: string;
    verifiedName: string | null;
    phoneMasked: string;
    hasMUId: boolean;
  } | null;
  latestAttempt: AttemptRow | null;
  risk: RiskSummary;
  issues: Issue[];
};

export type BatchOptions = {
  capVnd?: number;
  holdsEnabled?: boolean;
  risk?: RiskReader;
};

/** What stands between a bill and a transfer. Pure, and listed rather than decided. */
export function issuesOf(
  bill: Omit<BatchBill, 'issues'>,
  options: Pick<BatchOptions, 'capVnd' | 'holdsEnabled'>,
): Issue[] {
  const issues: Issue[] = [];
  if (bill.paid) issues.push('already_paid');
  if (bill.inException) issues.push('line_in_exception');
  if (bill.latestAttempt !== null && !['succeeded', 'failed'].includes(bill.latestAttempt.status)) {
    issues.push('attempt_open');
  }
  if (bill.account === null) issues.push('no_account');
  else if (bill.account.verifyStatus !== 'verified') issues.push('account_unverified');
  if (bill.amountVnd === null) issues.push('total_fractional');
  else {
    const bank = bill.account !== null && bill.account.method !== 'WALLET';
    if (bank && bill.amountVnd > BANK_CEILING_VND) issues.push('over_bank_ceiling');
    if (bank && bill.amountVnd < BANK_MINIMUM_VND) issues.push('under_bank_minimum');
    if (options.capVnd !== undefined && bill.amountVnd > options.capVnd) issues.push('over_cap');
  }
  if (options.holdsEnabled === true && bill.risk.band === 'hold') issues.push('risk_hold');
  return issues;
}

type BillRow = {
  id: string;
  collector_id: string;
  collector_ref: string;
  period_start: Date | string;
  period_end: Date | string;
  currency: string;
  total: string;
  line_count: number;
  all_paid: boolean | null;
  any_exception: boolean | null;
  account_id: string | null;
  method: 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD' | null;
  verify_status: string | null;
  declared_name: string | null;
  verified_name: string | null;
  phone: string | null;
  m_u_id: string | null;
};

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** The bills of a period with everything a preflight, a pay and an export read. */
export async function loadBatch(
  db: Db,
  period: { start: Date; end: Date },
  options: BatchOptions = {},
): Promise<BatchBill[]> {
  const rows = (await db.execute(sql`
    select b.id, b.collector_id, c.external_ref as collector_ref, b.period_start, b.period_end,
           b.currency, b.total::text as total,
           (select count(*)::int from bill_lines l where l.bill_id = b.id) as line_count,
           (select bool_and(s.settlement_state = 'manually_paid')
              from bill_lines l join settlements s on s.id = l.settlement_id
             where l.bill_id = b.id) as all_paid,
           (select bool_or(s.settlement_state = 'exception')
              from bill_lines l join settlements s on s.id = l.settlement_id
             where l.bill_id = b.id) as any_exception,
           a.id as account_id, a.method, a.verify_status, a.declared_name, a.verified_name, a.phone, a.m_u_id
      from bills b
      join collectors c on c.id = b.collector_id
      left join payout_accounts a on a.collector_id = b.collector_id and a.is_current
     where b.period_start >= ${period.start.toISOString()}::timestamptz and b.period_start < ${period.end.toISOString()}::timestamptz
     order by c.external_ref asc, b.id asc
  `)) as unknown as BillRow[];

  const risk = options.risk ?? noRisk;
  const bills: BatchBill[] = [];
  for (const r of rows) {
    const latestAttempt = await latestAttemptOf(db, r.id);
    const summary = (await risk.billSummary(r.id)) ?? clearSummary(r.id);
    const partial: Omit<BatchBill, 'issues'> = {
      id: r.id,
      collectorId: r.collector_id,
      collectorRef: r.collector_ref,
      periodStart: asDate(r.period_start),
      periodEnd: asDate(r.period_end),
      currency: r.currency,
      total: r.total,
      amountVnd: wholeVnd(r.total),
      lineCount: r.line_count,
      paid: (r.all_paid ?? false) || latestAttempt?.status === 'succeeded',
      inException: r.any_exception ?? false,
      account:
        r.account_id === null
          ? null
          : {
              id: r.account_id,
              method: r.method!,
              verifyStatus: r.verify_status!,
              declaredName: r.declared_name!,
              verifiedName: r.verified_name,
              phoneMasked: maskPhone(r.phone),
              hasMUId: r.m_u_id !== null,
            },
      latestAttempt,
      risk: summary,
    };
    bills.push({ ...partial, issues: issuesOf(partial, options) });
  }
  return bills;
}

export type Preflight = {
  period_start: string;
  period_end: string;
  bills: number;
  /** Bills with no issue at all: what a run would send. */
  payable: number;
  /** Whole dong over the payable bills. */
  total_vnd: number;
  /** total × the margin, rounded up to whole dong. */
  required_vnd: number;
  /** null when there is no client to ask (manual pilot without credentials). */
  balance_vnd: number | null;
  shortfall_vnd: number;
  ok: boolean;
  refusal: string | null;
  counts: Record<Issue, number>;
  risk_bands: Record<RiskSummary['band'], number>;
  cap_vnd: number | null;
  bank_ceiling_vnd: number;
};

export async function preflight(
  db: Db,
  client: ZaloPayClient | undefined,
  period: { start: Date; end: Date },
  options: BatchOptions = {},
): Promise<Preflight & { billsDetail: BatchBill[] }> {
  const bills = await loadBatch(db, period, options);
  const counts = Object.fromEntries(
    (['no_account', 'account_unverified', 'total_fractional', 'over_bank_ceiling', 'under_bank_minimum', 'over_cap', 'risk_hold', 'attempt_open', 'already_paid', 'line_in_exception'] as Issue[]).map((i) => [i, 0]),
  ) as Record<Issue, number>;
  const bands: Record<RiskSummary['band'], number> = { clear: 0, notice: 0, review: 0, hold: 0 };
  let payable = 0;
  let total = 0;
  for (const b of bills) {
    bands[b.risk.band] += 1;
    for (const i of b.issues) counts[i] += 1;
    if (b.issues.length === 0 && b.amountVnd !== null) {
      payable += 1;
      total += b.amountVnd;
    }
  }
  // Whole dong; the margin is a ceiling, never a rounding down.
  const required = Math.ceil(total * BALANCE_MARGIN);

  let balance: number | null = null;
  let refusal: string | null = null;
  if (client === undefined) {
    refusal = 'no ZaloPay client is configured, so the wallet balance cannot be read';
  } else {
    try {
      balance = (await client.balance()).balanceVnd;
    } catch (err) {
      refusal = `the wallet balance could not be read: ${(err as Error).message}`;
    }
  }
  if (refusal === null && balance !== null && balance < required) {
    refusal = `wallet balance ${balance} VND is below the ${required} VND this batch needs (${total} VND × ${BALANCE_MARGIN}); the whole batch is refused`;
  }
  if (refusal === null && payable === 0) refusal = 'nothing in this period is payable';

  return {
    period_start: period.start.toISOString(),
    period_end: period.end.toISOString(),
    bills: bills.length,
    payable,
    total_vnd: total,
    required_vnd: required,
    balance_vnd: balance,
    shortfall_vnd: balance === null ? required : Math.max(0, required - balance),
    ok: refusal === null,
    refusal,
    counts,
    risk_bands: bands,
    cap_vnd: options.capVnd ?? null,
    bank_ceiling_vnd: BANK_CEILING_VND,
    billsDetail: bills,
  };
}

/**
 * Why a pay did not happen, in the vocabulary the console maps to sentences.
 * The names that a trigger raises are reused for the same condition so one
 * constraint has one sentence wherever it is refused.
 */
export type PayRefusal =
  | 'payout_mode_manual'
  | 'payout_no_client'
  | 'payout_account_missing'
  | 'payout_account_unverified'
  | 'payout_bank_details_unavailable'
  | 'payout_attempts_total_fractional'
  | 'payout_attempts_bank_ceiling'
  | 'payout_attempts_bank_minimum'
  | 'payout_cap_exceeded'
  | 'payout_risk_hold'
  | 'payout_already_paid'
  | 'payout_settlement_exception';

export type PayOutcome =
  | { kind: 'sent'; attempt: AttemptRow; result: AttemptEvent['type'] }
  | { kind: 'refused'; constraint: PayRefusal | string; attempt?: AttemptRow };

export class PayRefused extends Error {
  // A declared field, not a parameter property: bin/ runs .ts under Node's
  // strip-only type stripping, which refuses those (RUNNING.md).
  readonly constraint: string;
  constructor(constraint: string) {
    super(constraint);
    this.name = 'PayRefused';
    this.constraint = constraint;
  }
}

/**
 * The receiver the transfer is addressed to. A wallet needs the `m_u_id` a
 * verify returned; a bank route needs the full account number, which this
 * repo has nowhere to keep (the brief names a secrets store it does not
 * have), so a bank transfer over the API is refused by name until it does.
 */
function receiverOf(bill: BatchBill): TransferReceiver | PayRefusal {
  if (bill.account === null) return 'payout_account_missing';
  if (bill.account.verifyStatus !== 'verified') return 'payout_account_unverified';
  if (bill.account.method === 'WALLET') {
    if (!bill.account.hasMUId) return 'payout_account_unverified';
    return { method: 'WALLET', mUId: '' };
  }
  return 'payout_bank_details_unavailable';
}

/**
 * What stands between this bill and ANY payment, manual or API, as the name
 * the console maps to a sentence — or null when nothing does. One function,
 * asked by `payBill` and by `/mark-paid` alike (bridge review F-41), so the
 * default manual rail cannot record as paid what the API rail would refuse
 * to send: an unverified or mismatched destination, a held bill while holds
 * are on, a bill over the cap. The cap raises its ticket here, so it is
 * raised the same way whichever rail asks. ZaloPay's bank limits are asked
 * too, because the trigger will refuse them anyway and a sentence beats a 500.
 */
export async function refusalFor(
  db: Db,
  bill: BatchBill,
  options: Pick<BatchOptions, 'capVnd'>,
): Promise<PayRefusal | null> {
  if (bill.paid) return 'payout_already_paid';
  // Before the arithmetic: a parked line is a question about the bill, not its total.
  if (bill.inException) return 'payout_settlement_exception';
  if (bill.amountVnd === null) return 'payout_attempts_total_fractional';
  for (const issue of bill.issues) {
    switch (issue) {
      case 'no_account':
        return 'payout_account_missing';
      case 'account_unverified':
        return 'payout_account_unverified';
      case 'over_bank_ceiling':
        return 'payout_attempts_bank_ceiling';
      case 'under_bank_minimum':
        return 'payout_attempts_bank_minimum';
      case 'risk_hold':
        return 'payout_risk_hold';
      case 'over_cap':
        // Loudly: a ticket, and no attempt. Never silently the cap.
        await emitEvent(db, {
          kind: 'TICKET.CAP_EXCEEDED',
          billId: bill.id,
          collectorId: bill.collectorId,
          evidence: {
            amount_vnd: bill.amountVnd,
            cap_vnd: options.capVnd,
            message: `Bill of ${bill.amountVnd} VND exceeds the per-collector-per-period cap of ${options.capVnd} VND and was not paid.`,
          },
        });
        return 'payout_cap_exceeded';
      default:
        break;
    }
  }
  return null;
}

export async function payBill(
  db: Db,
  client: ZaloPayClient | undefined,
  actor: Actor,
  bill: BatchBill,
  options: BatchOptions & { pauseMs?: number } = {},
): Promise<PayOutcome> {
  if (client === undefined) return { kind: 'refused', constraint: 'payout_no_client' };
  const gate = await refusalFor(db, bill, options);
  if (gate !== null) return { kind: 'refused', constraint: gate };
  const receiver = receiverOf(bill);
  if (typeof receiver === 'string') return { kind: 'refused', constraint: receiver };

  const amountVnd = bill.amountVnd!;
  const attemptId = randomUUID();

  // 1. The attempt exists, or the database has said why not.
  const created = await mutate(
    db,
    actor,
    {
      action: 'payout_attempt.create',
      targetTable: 'payout_attempts',
      targetId: attemptId,
      after: { bill_id: bill.id, payout_account_id: bill.account!.id, amount_vnd: amountVnd, mode: 'api' },
    },
    (tx) =>
      insertAttempt(tx, {
        id: attemptId,
        billId: bill.id,
        payoutAccountId: bill.account!.id,
        amountVnd,
        mode: 'api',
      }),
  );
  if (created === undefined) throw new Error('the attempt insert returned nothing');

  // 2. Committed as sent before the request leaves, so a crash mid-request
  //    leaves a row the poller owns.
  const mUId = await mUIdOf(db, bill.account!.id);
  const submitted = await db.transaction((tx) => applyEvent(tx, created, { type: 'SUBMIT' }));
  if (submitted === null || !('attempt' in submitted)) throw new Error('the attempt could not be marked submitted');

  const result = await client.transferFund({
    partnerOrderId: submitted.attempt.partnerOrderId,
    receiver: bill.account!.method === 'WALLET' ? { method: 'WALLET', mUId } : receiver,
    amountVnd,
    description: `PlayerOne ${bill.periodStart.toISOString().slice(0, 10)} ${bill.collectorRef}`,
  });

  // 3. What ZaloPay said, as the state machine reads it.
  const event: AttemptEvent =
    result.kind === 'accepted'
      ? { type: 'ACCEPTED', status: result.status }
      : result.kind === 'duplicate'
        ? { type: 'DUPLICATE' }
        : result.kind === 'rejected'
          ? { type: 'REJECTED', sub: result.subCode }
          : result.kind === 'system'
            ? { type: 'SYSTEM', sub: result.subCode }
            : { type: 'UNKNOWN' };
  const applied = await db.transaction((tx) =>
    applyEvent(tx, submitted.attempt, event, {
      zlpOrderId: result.kind === 'accepted' ? result.zlpOrderId : null,
      subReturnCode: 'subCode' in result ? result.subCode : null,
    }),
  );
  if (applied === null || !('attempt' in applied)) throw new Error('the transfer answer could not be recorded');
  return { kind: 'sent', attempt: applied.attempt, result: event.type };
}

async function mUIdOf(db: Db, accountId: string): Promise<string> {
  const rows = (await db.execute(sql`select m_u_id from payout_accounts where id = ${accountId}`)) as unknown as { m_u_id: string | null }[];
  return rows[0]?.m_u_id ?? '';
}

export type BatchRun = {
  preflight: Preflight;
  sent: { billId: string; attemptId: string; status: string }[];
  stopped_at: { billId: string; constraint: string } | null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Preflight, then one transfer at a time. A preflight that says no means zero
 * transfers, recorded as a ticket so the refusal is on the record; a bill that
 * refuses mid-batch stops the batch there.
 */
export async function runBatch(
  db: Db,
  client: ZaloPayClient | undefined,
  actor: Actor,
  period: { start: Date; end: Date },
  options: BatchOptions & { pauseMs?: number } = {},
): Promise<BatchRun> {
  const { billsDetail, ...pre } = await preflight(db, client, period, options);
  if (!pre.ok) {
    await emitEvent(db, {
      kind: 'TICKET.BATCH_REFUSED',
      evidence: {
        period_start: pre.period_start,
        period_end: pre.period_end,
        refusal: pre.refusal,
        total_vnd: pre.total_vnd,
        required_vnd: pre.required_vnd,
        balance_vnd: pre.balance_vnd,
      },
    });
    return { preflight: pre, sent: [], stopped_at: null };
  }
  const run: BatchRun = { preflight: pre, sent: [], stopped_at: null };
  const pauseMs = options.pauseMs ?? 500;
  for (const bill of billsDetail) {
    if (bill.issues.length > 0) continue;
    if (run.sent.length > 0 && pauseMs > 0) await sleep(pauseMs);
    const outcome = await payBill(db, client, actor, bill, options);
    if (outcome.kind === 'refused') {
      run.stopped_at = { billId: bill.id, constraint: outcome.constraint };
      break;
    }
    run.sent.push({ billId: bill.id, attemptId: outcome.attempt.id, status: outcome.attempt.status });
    if (outcome.attempt.status === 'failed') {
      run.stopped_at = { billId: bill.id, constraint: 'payout_transfer_rejected' };
      break;
    }
  }
  return run;
}

export { attemptById };
