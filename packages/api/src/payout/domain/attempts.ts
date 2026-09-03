import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { fromDecimal, quantise } from '../../money.ts';
import { emitEvent } from './events.ts';
import { next, type AttemptEvent, type AttemptStatus, IllegalTransition } from './state.ts';

/**
 * Reading and writing `payout_attempts`, in the shape the triggers expect.
 *
 * Nothing here decides an amount, an id or an edge. The amount is the bill's
 * total rounded down to whole dong by `wholeVnd`, and the database applies the
 * same floor and compares it to the bill again. The id and the sequence are
 * computed by `payout_attempts_guard`, which is why the INSERT below names
 * neither: drizzle's insert type would demand them, so the statement is raw
 * SQL that says exactly what the application supplies and nothing more. The
 * edge is `state.ts`'s answer, applied by `applyEvent` and refused a second
 * time by the trigger if the two ever disagree.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type AttemptRow = {
  id: string;
  billId: string;
  payoutAccountId: string;
  partnerOrderId: string;
  attemptSeq: number;
  amountVnd: number;
  mode: 'manual' | 'api';
  status: AttemptStatus;
  zlpOrderId: string | null;
  zpTransId: string | null;
  subReturnCode: number | null;
  manualReference: string | null;
  lastPolledAt: Date | null;
  pollCount: number;
  createdAt: Date;
  settledAt: Date | null;
};

type RawRow = {
  id: string;
  bill_id: string;
  payout_account_id: string;
  partner_order_id: string;
  attempt_seq: number;
  amount_vnd: string | number;
  mode: 'manual' | 'api';
  status: AttemptStatus;
  zlp_order_id: string | null;
  zp_trans_id: string | null;
  sub_return_code: number | null;
  manual_reference: string | null;
  last_polled_at: Date | string | null;
  poll_count: number;
  created_at: Date | string;
  settled_at: Date | string | null;
};

const at = (v: Date | string | null): Date | null =>
  v === null ? null : v instanceof Date ? v : new Date(v);

export const shapeAttempt = (r: RawRow): AttemptRow => ({
  id: r.id,
  billId: r.bill_id,
  payoutAccountId: r.payout_account_id,
  partnerOrderId: r.partner_order_id,
  attemptSeq: r.attempt_seq,
  amountVnd: Number(r.amount_vnd),
  mode: r.mode,
  status: r.status,
  zlpOrderId: r.zlp_order_id,
  zpTransId: r.zp_trans_id,
  subReturnCode: r.sub_return_code,
  manualReference: r.manual_reference,
  lastPolledAt: at(r.last_polled_at),
  pollCount: r.poll_count,
  createdAt: at(r.created_at)!,
  settledAt: at(r.settled_at),
});

/**
 * A bill total as the whole dong an attempt is for. Rounded DOWN.
 *
 * `bills.total` is numeric(14,4) and an attempt is a bigint of whole dong, so
 * a total of `640.0008` — which is what two sixteen-second reviews at 1,200 a
 * minute come to — has to lose its fraction somewhere. Daniel decided on
 * 2026-08-27 that it rounds down (Part R5): the platform never pays a
 * collector more than the reviewed footage was worth, and the collector loses
 * at most 0.9999 dong on a bill however many lines it has.
 *
 * The floor is taken here and nowhere else. The bill keeps its exact total,
 * the total still equals the sum of its lines, and each line still reproduces
 * its own `unit_price × effective_minutes`. `payout_attempts_guard` applies the
 * same floor in SQL and refuses any other figure by
 * `payout_attempts_amount_check`, so this function is the same answer earlier
 * rather than the authority.
 *
 * The arithmetic is `quantise`, which is still the only place this module
 * rounds. It throws on a total no attempt could ever carry — negative, or past
 * the safe integer range. `bills_total_nonneg_check` and numeric(14,4) make
 * both impossible, so reaching the throw means a corrupt bill row, and stopping
 * on it is better than sending a number derived from one.
 */
export function wholeVnd(total: string): number {
  const dong = BigInt(quantise(fromDecimal(total), 0, 'floor'));
  if (dong < 0n || dong > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`bill total ${total} is not an amount an attempt can carry`);
  }
  return Number(dong);
}

/**
 * Inserts an attempt. The application supplies the bill, the account, the
 * amount, the mode, the initial status and (for manual) the reference —
 * and NOT the sequence or the partner order id. Every refusal is a named
 * constraint from `payout_attempts_guard`.
 */
export async function insertAttempt(
  tx: Tx,
  input: {
    id: string;
    billId: string;
    payoutAccountId: string;
    amountVnd: number;
    mode: 'manual' | 'api';
    manualReference?: string;
    settledAt?: Date;
  },
): Promise<AttemptRow> {
  const status = input.mode === 'manual' ? 'succeeded' : 'created';
  const rows = (await tx.execute(sql`
    insert into payout_attempts
      (id, bill_id, payout_account_id, amount_vnd, mode, status, manual_reference, settled_at)
    values
      (${input.id}, ${input.billId}, ${input.payoutAccountId}, ${input.amountVnd}::bigint, ${input.mode},
       ${status}, ${input.manualReference ?? null}::text, ${input.settledAt?.toISOString() ?? null}::timestamptz)
    returning *
  `)) as unknown as RawRow[];
  return shapeAttempt(rows[0]!);
}

export async function attemptById(db: Db | Tx, id: string): Promise<AttemptRow | null> {
  const rows = (await db.execute(sql`select * from payout_attempts where id = ${id}`)) as unknown as RawRow[];
  return rows[0] === undefined ? null : shapeAttempt(rows[0]);
}

/** The newest attempt of a bill, which is the one that says whether it is paid. */
export async function latestAttemptOf(db: Db | Tx, billId: string): Promise<AttemptRow | null> {
  const rows = (await db.execute(sql`
    select * from payout_attempts where bill_id = ${billId} order by attempt_seq desc limit 1
  `)) as unknown as RawRow[];
  return rows[0] === undefined ? null : shapeAttempt(rows[0]);
}

export type Transition = {
  from: AttemptStatus;
  to: AttemptStatus;
  event: AttemptEvent;
  attempt: AttemptRow;
};

/**
 * Applies one event to one attempt, inside the caller's transaction.
 *
 * The WHERE names the status the caller saw, so a second writer that moved the
 * row in between matches nothing and this returns `null` rather than applying
 * an edge to a state that no longer exists — the same shape the settlement
 * pay route uses. An illegal edge is returned, not thrown, because "the
 * machine has no such edge" is an answer and not a bug in the caller.
 */
export async function applyEvent(
  tx: Tx,
  attempt: AttemptRow,
  event: AttemptEvent,
  patch: {
    zlpOrderId?: string | null;
    zpTransId?: string | null;
    subReturnCode?: number | null;
    polledAt?: Date;
  } = {},
): Promise<Transition | IllegalTransition | null> {
  const to = next(attempt.status, event);
  if (to instanceof IllegalTransition) return to;

  const polled = patch.polledAt !== undefined;
  const rows = (await tx.execute(sql`
    update payout_attempts
       set status = ${to},
           zlp_order_id = coalesce(${patch.zlpOrderId ?? null}::text, zlp_order_id),
           zp_trans_id = coalesce(${patch.zpTransId ?? null}::text, zp_trans_id),
           sub_return_code = coalesce(${patch.subReturnCode ?? null}::integer, sub_return_code),
           last_polled_at = case when ${polled}::boolean then ${patch.polledAt?.toISOString() ?? null}::timestamptz else last_polled_at end,
           poll_count = poll_count + case when ${polled}::boolean then 1 else 0 end
     where id = ${attempt.id} and status = ${attempt.status}
    returning *
  `)) as unknown as RawRow[];
  if (rows[0] === undefined) return null;

  const after = shapeAttempt(rows[0]);
  await emitEvent(tx, {
    kind: event.type === 'POLL' ? 'ATTEMPT.POLLED' : event.type === 'SUBMIT' ? 'ATTEMPT.SUBMITTED' : 'ATTEMPT.TRANSITION',
    billId: after.billId,
    payoutAttemptId: after.id,
    evidence: {
      partner_order_id: after.partnerOrderId,
      event: event.type,
      ...('status' in event ? { zlp_status: event.status } : {}),
      ...('sub' in event ? { sub_return_code: event.sub } : {}),
      ...('reason' in event ? { reason: event.reason, outcome: event.outcome } : {}),
      from: attempt.status,
      to: after.status,
      poll_count: after.pollCount,
      zlp_order_id: after.zlpOrderId,
    },
  });
  return { from: attempt.status, to: after.status, event, attempt: after };
}

/**
 * A poll that learned nothing (the order is still processing, or is not found
 * yet) still records that it happened: `poll_count` and `last_polled_at` are
 * the backoff's own memory.
 */
export async function recordPoll(tx: Tx, attempt: AttemptRow, polledAt: Date): Promise<AttemptRow> {
  const rows = (await tx.execute(sql`
    update payout_attempts
       set last_polled_at = ${polledAt.toISOString()}::timestamptz, poll_count = poll_count + 1
     where id = ${attempt.id}
    returning *
  `)) as unknown as RawRow[];
  return shapeAttempt(rows[0]!);
}
