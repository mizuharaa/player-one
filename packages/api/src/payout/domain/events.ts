import { sql } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';

/**
 * The rows this side writes to `payout_events`, which Agent C's risk engine
 * reads and which is the only trail a worker leaves. Append-only; the kinds
 * are stable strings because a flag raised today has to be explainable in an
 * audit eighteen months from now.
 *
 * Three families:
 *
 *   IDENT.*   a signal about who is being paid. Emitted at declaration from
 *             ZaloPay's answer (Agent B brief, BUILD 5). The engine turns these
 *             into flags; this side never scores anything.
 *   ATTEMPT.* what a worker did to an attempt, with before and after. A poll
 *             has no operator and cannot write `audit_events`
 *             (audit_events_attributed_check), so this is its record.
 *   TICKET.*  something a person has to look at: polling exhausted, a bill over
 *             the cap, a query that cannot find the order.
 */
export const EVENT_KINDS = [
  'IDENT.NAME_MISMATCH',
  'IDENT.NAME_UNCONFIRMED',
  'IDENT.UNVERIFIED_KYC',
  'IDENT.WALLET_LOCKED',
  'IDENT.KYC_LIMIT',
  'IDENT.NO_WALLET',
  'IDENT.VERIFY_ERROR',
  'ATTEMPT.SUBMITTED',
  'ATTEMPT.TRANSITION',
  'ATTEMPT.POLLED',
  'TICKET.POLL_EXHAUSTED',
  'TICKET.ORDER_NOT_FOUND',
  'TICKET.CAP_EXCEEDED',
  'TICKET.BATCH_REFUSED',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type PayoutEventInput = {
  kind: EventKind;
  collectorId?: string | null;
  payoutAccountId?: string | null;
  billId?: string | null;
  payoutAttemptId?: string | null;
  /** Human-readable in the console. Never a secret, never a full identifier. */
  evidence: Record<string, unknown>;
};

export async function emitEvent(tx: Tx | Db, event: PayoutEventInput): Promise<void> {
  await tx.insert(schema.payoutEvents).values({
    kind: event.kind,
    collectorId: event.collectorId ?? null,
    payoutAccountId: event.payoutAccountId ?? null,
    billId: event.billId ?? null,
    payoutAttemptId: event.payoutAttemptId ?? null,
    evidence: event.evidence,
  });
}

/** Whether a ticket of this kind is already open for the attempt, so a worker raises it once. */
export async function hasEvent(
  tx: Tx | Db,
  kind: EventKind,
  payoutAttemptId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    select 1 from payout_events
     where kind = ${kind} and payout_attempt_id = ${payoutAttemptId}
     limit 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}
