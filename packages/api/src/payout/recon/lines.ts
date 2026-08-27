import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';

/**
 * The shared shape of a reconciliation: a run row, discrepancy lines under
 * it, and one operator ticket per line in Agent B's `payout_events` ledger.
 *
 * Three reconciliations write here (`tick.ts`, `statement.ts`, `shadow.ts`)
 * and none of them ever resolves anything: the only write path to
 * `resolved_at` is `resolve.ts`, through `mutate`, by a finance operator with
 * a typed reason — and 0015 refuses every other one at commit.
 */

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type ReconSource = 'zalopay' | 'statement' | 'shadow' | 'shadow_diff';

export const DISCREPANCY_KINDS = [
  'WE_SAY_PAID_THEY_DONT',
  'THEY_SAY_PAID_WE_DONT',
  'AMOUNT_MISMATCH',
  'ORPHAN_AT_ZLP',
  'STALE_PROCESSING',
  'STUCK_PENDING',
  'SHADOW_UNPAID',
  'SHADOW_UNINTENDED',
] as const;

export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

/** The kind Agent B's console reads off `payout_events`. One per line, raised with it. */
export const RECON_TICKET_KIND = 'TICKET.RECON_DISCREPANCY';

/** One thing found. Pure data; `writeLine` turns it into a row and a ticket. */
export type Finding = {
  kind: DiscrepancyKind;
  billId: string | null;
  payoutAttemptId: string | null;
  partnerOrderId: string | null;
  reference: string | null;
  ourStatus: string | null;
  theirStatus: string | null;
  ourAmount: number | null;
  theirAmount: number | null;
  /** When the other side says it happened: a statement line's date. Absent for the ZaloPay kinds. */
  theirAt?: Date | null;
  detail: Record<string, unknown>;
};

export type Period = { start: Date; end: Date };

export const periodLabel = (p: Period): string =>
  `${p.start.toISOString().slice(0, 10)}/${p.end.toISOString().slice(0, 10)}`;

export async function startRun(db: Db | Tx, source: ReconSource, period: Period, startedAt: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.reconRuns).values({
    id,
    period: periodLabel(period),
    periodStart: period.start,
    periodEnd: period.end,
    source,
    startedAt,
  });
  return id;
}

export async function finishRun(db: Db | Tx, runId: string, finishedAt: Date, summary: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    update recon_runs set finished_at = ${finishedAt.toISOString()}::timestamptz, summary = ${JSON.stringify(summary)}::jsonb
     where id = ${runId}
  `);
}

/**
 * Whether the same discrepancy is already open, so a daily run does not
 * raise it — and ticket it — again every morning. "Same" is the kind and the
 * thing it is about: the attempt when there is one, else the bill and the
 * probed order id, else the statement line — reference, amount AND date,
 * the three the matcher matches on, so two unmatched lines under one bank
 * reference are two discrepancies (0016). An open line is never
 * touched; a resolved one does not count, so a discrepancy that returns
 * after being resolved is raised afresh, which is what "resolved" ought to
 * mean.
 */
export async function openLineExists(db: Db | Tx, f: Finding): Promise<boolean> {
  const rows = (await db.execute(sql`
    select 1 from recon_lines
     where resolved_at is null
       and discrepancy_kind = ${f.kind}
       and payout_attempt_id is not distinct from ${f.payoutAttemptId}::uuid
       and bill_id is not distinct from ${f.billId}::uuid
       and partner_order_id is not distinct from ${f.partnerOrderId}::text
       and reference is not distinct from ${f.reference}::text
       and their_amount is not distinct from ${f.theirAmount}::bigint
       and their_at is not distinct from ${f.theirAt?.toISOString() ?? null}::timestamptz
     limit 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/** The sentence an operator reads. The numbers are in it; nothing is hidden behind a code. */
export function describe(f: Finding): string {
  const ours = f.ourAmount === null ? 'no amount' : `${f.ourAmount} VND`;
  const theirs = f.theirAmount === null ? 'no amount' : `${f.theirAmount} VND`;
  switch (f.kind) {
    case 'WE_SAY_PAID_THEY_DONT':
      return `Our ledger says this attempt succeeded (${ours}); the other side reports ${f.theirStatus ?? 'nothing'}. Confirm with ZaloPay or the bank before anything else is paid on this bill.`;
    case 'THEY_SAY_PAID_WE_DONT':
      return `The other side reports a completed payment (${theirs}) that our ledger records as ${f.ourStatus ?? 'unknown to us'}. Money may have moved without a succeeded attempt behind it.`;
    case 'AMOUNT_MISMATCH':
      return `Our ledger says ${ours}; the other side says ${theirs} for the same payment.`;
    case 'ORPHAN_AT_ZLP': {
      const order = f.partnerOrderId ?? 'an id we would have generated';
      if (f.payoutAttemptId !== null) {
        return `ZaloPay holds an order under ${order} (${theirs}, status ${f.theirStatus ?? '?'}) while our ledger records its attempt as ${f.ourStatus ?? 'unknown'}. Money may still move behind a locally closed or unsent attempt.`;
      }
      return `ZaloPay holds an order under ${order} (${theirs}, status ${f.theirStatus ?? '?'}) and our ledger has no attempt for it.`;
    }
    case 'STALE_PROCESSING':
      return `This attempt has been ${f.ourStatus ?? 'processing'} for more than 24 hours and ZaloPay still reports ${f.theirStatus ?? 'processing'}.`;
    case 'STUCK_PENDING':
      return `This attempt has been pending inside ZaloPay (status 4) for more than 72 hours. It needs ZaloPay's own team; retrying cannot resolve it.`;
    case 'SHADOW_UNPAID':
      return `The API rail would have sent ${ours} for this bill; no manual payment was recorded.`;
    case 'SHADOW_UNINTENDED':
      return `A manual payment of ${ours} was recorded for this bill, which the API rail would not have sent (${(f.detail['issues'] as string[] | undefined)?.join(', ') ?? 'preflight refused'}).`;
  }
}

/**
 * Writes one line and its ticket, in the caller's transaction. Returns the
 * line id, or `null` when the same discrepancy is already open — in which
 * case nothing is written and the caller counts it as `still_open`.
 *
 * The read-then-insert is not what keeps two runs from raising the same line:
 * `recon_lines_open_key` (0015) is. The INSERT names that index as its
 * arbiter, so a concurrent writer that got there first makes this one a
 * no-op — and then no ticket is written either, because the ticket follows
 * the returned id, not the intention (F-44).
 */
export async function writeLine(tx: Tx, runId: string, f: Finding, raisedAt: Date): Promise<string | null> {
  if (await openLineExists(tx, f)) return null;
  const id = randomUUID();
  const inserted = (await tx.execute(sql`
    insert into recon_lines
      (id, run_id, bill_id, payout_attempt_id, partner_order_id, reference, our_status, their_status,
       our_amount, their_amount, their_at, discrepancy_kind, detail, raised_at)
    values
      (${id}, ${runId}, ${f.billId}::uuid, ${f.payoutAttemptId}::uuid, ${f.partnerOrderId}::text, ${f.reference}::text,
       ${f.ourStatus}::text, ${f.theirStatus}::text, ${f.ourAmount}::bigint, ${f.theirAmount}::bigint,
       ${f.theirAt?.toISOString() ?? null}::timestamptz,
       ${f.kind}, ${JSON.stringify(f.detail)}::jsonb, ${raisedAt.toISOString()}::timestamptz)
    on conflict (discrepancy_kind, payout_attempt_id, bill_id, partner_order_id, reference, their_amount, their_at) where resolved_at is null
    do nothing
    returning id
  `)) as unknown as { id: string }[];
  if (inserted[0] === undefined) return null;
  // Every discrepancy raises an operator ticket. Same ledger the poller's
  // tickets live in, so the exceptions queue is one query.
  await tx.insert(schema.payoutEvents).values({
    kind: RECON_TICKET_KIND,
    billId: f.billId,
    payoutAttemptId: f.payoutAttemptId,
    evidence: {
      run_id: runId,
      line_id: id,
      discrepancy_kind: f.kind,
      partner_order_id: f.partnerOrderId,
      reference: f.reference,
      our_status: f.ourStatus,
      their_status: f.theirStatus,
      our_amount_vnd: f.ourAmount,
      their_amount_vnd: f.theirAmount,
      message: describe(f),
    },
    occurredAt: raisedAt,
  });
  return id;
}

export type ReconLineRow = {
  id: string;
  run_id: string;
  bill_id: string | null;
  payout_attempt_id: string | null;
  partner_order_id: string | null;
  reference: string | null;
  our_status: string | null;
  their_status: string | null;
  our_amount: string | number | null;
  their_amount: string | number | null;
  their_at: Date | string | null;
  discrepancy_kind: DiscrepancyKind;
  detail: Record<string, unknown>;
  raised_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  resolve_reason: string | null;
};

export async function linesOfRun(db: Db | Tx, runId: string): Promise<ReconLineRow[]> {
  return (await db.execute(sql`select * from recon_lines where run_id = ${runId} order by raised_at, discrepancy_kind, id`)) as unknown as ReconLineRow[];
}

export async function openLines(db: Db | Tx): Promise<ReconLineRow[]> {
  return (await db.execute(sql`select * from recon_lines where resolved_at is null order by raised_at desc, id`)) as unknown as ReconLineRow[];
}
