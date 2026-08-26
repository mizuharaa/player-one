import { sql } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';
import { mutate } from '../audit.ts';
import type { Actor } from '../actor.ts';

/**
 * Reversible holds on bills, as the chain of rows 0014 describes. Raising is
 * the engine's; clearing is an operator's, with a typed reason and a verdict,
 * through `mutate` so the audit row and the clear row commit together.
 *
 * Nothing here touches `bills`. Agent B's payout domain reads
 * `risk_current_holds` (or `billHold`) and refuses to create an attempt for a
 * bill that appears there; this module only ever adds rows to `risk_holds`.
 */

export type HoldRow = {
  id: string;
  billId: string;
  raisedByFlag: string;
  raisedAt: Date;
  signalIds: string[];
  clearedAt: Date | null;
  clearedBy: string | null;
  clearReason: string | null;
  clearVerdict: string | null;
};

export type ClearVerdict = 'false_positive' | 'accepted' | 'resolved';
export const CLEAR_VERDICTS: readonly ClearVerdict[] = ['false_positive', 'accepted', 'resolved'];

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'execute'> | Pick<Tx, 'execute'>;
type Row = Record<string, unknown>;

const toHold = (r: Row): HoldRow => ({
  id: String(r['id']),
  billId: String(r['bill_id']),
  raisedByFlag: String(r['raised_by_flag']),
  raisedAt: new Date(String(r['raised_at'])),
  signalIds: (r['signal_ids'] as string[]) ?? [],
  clearedAt: r['cleared_at'] ? new Date(String(r['cleared_at'])) : null,
  clearedBy: r['cleared_by'] ? String(r['cleared_by']) : null,
  clearReason: r['clear_reason'] ? String(r['clear_reason']) : null,
  clearVerdict: r['clear_verdict'] ? String(r['clear_verdict']) : null,
});

/** The bill's open hold, or null. Reads the same view the payout side reads. */
export async function billHold(db: Reader, billId: string): Promise<HoldRow | null> {
  const rows = (await (db as Db).execute(
    sql`select h.* from risk_holds h
         join risk_current_holds c on c.hold_id = h.id
        where h.bill_id = ${billId}::uuid`,
  )) as unknown as Row[];
  return rows[0] ? toHold(rows[0]) : null;
}

/** Every hold row for a bill, oldest first: the full history an audit reads. */
export async function holdHistory(db: Reader, billId: string): Promise<HoldRow[]> {
  const rows = (await (db as Db).execute(
    sql`select * from risk_holds where bill_id = ${billId}::uuid order by raised_at asc, cleared_at asc nulls first`,
  )) as unknown as Row[];
  return rows.map(toHold);
}

/** All bills held right now. */
export async function currentHolds(db: Reader): Promise<{ holdId: string; billId: string; raisedByFlag: string; raisedAt: Date; signalIds: string[] }[]> {
  const rows = (await (db as Db).execute(
    sql`select hold_id, bill_id, raised_by_flag, raised_at, signal_ids from risk_current_holds order by raised_at asc`,
  )) as unknown as Row[];
  return rows.map((r) => ({
    holdId: String(r['hold_id']),
    billId: String(r['bill_id']),
    raisedByFlag: String(r['raised_by_flag']),
    raisedAt: new Date(String(r['raised_at'])),
    signalIds: (r['signal_ids'] as string[]) ?? [],
  }));
}

/**
 * Raises a hold unless one is open, or unless the last clearance already
 * covered every signal now present. An operator's clear is a statement about
 * the evidence they saw; the engine re-holds only on evidence they did not.
 * Returns the new hold, or null when nothing was raised and why.
 */
export async function raiseHold(
  tx: Reader,
  input: { billId: string; flagId: string; signalIds: readonly string[]; now: Date },
): Promise<{ hold: HoldRow | null; reason: 'raised' | 'already_open' | 'cleared_covers_signals' }> {
  const latest = (await (tx as Db).execute(
    sql`select * from risk_holds where bill_id = ${input.billId}::uuid
         order by coalesce(cleared_at, raised_at) desc, cleared_at desc nulls last limit 1`,
  )) as unknown as Row[];
  const last = latest[0] ? toHold(latest[0]) : null;
  if (last !== null && last.clearedAt === null) return { hold: null, reason: 'already_open' };
  if (last !== null && last.clearedAt !== null) {
    const seen = new Set(last.signalIds);
    if (input.signalIds.every((s) => seen.has(s))) return { hold: null, reason: 'cleared_covers_signals' };
  }
  const [row] = (await (tx as Db).execute(
    // The array goes in as JSON: the raw-SQL path hands parameters to the
    // driver untouched, and a JS array is not a Postgres array literal.
    sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids)
         values (${input.billId}::uuid, ${input.flagId}::uuid, ${input.now.toISOString()}::timestamptz,
                 (select coalesce(array_agg(x order by x), '{}'::text[]) from jsonb_array_elements_text(${JSON.stringify([...input.signalIds])}::jsonb) x))
         returning *`,
  )) as unknown as Row[];
  return { hold: toHold(row!), reason: 'raised' };
}

/**
 * Clears the open hold on a bill by inserting the clear row. The audit row
 * carries the reason too, so both the risk trail and the operator trail
 * answer "who cleared it and why".
 */
export async function clearHold(
  db: Db,
  actor: Actor,
  input: { billId: string; operatorId: string; reason: string; verdict: ClearVerdict; now?: Date },
): Promise<HoldRow> {
  if (input.reason.trim().length < 10) throw new Error('a hold is cleared with a reason of at least ten characters');
  if (!CLEAR_VERDICTS.includes(input.verdict)) throw new Error(`unknown clear verdict ${input.verdict}`);
  const now = input.now ?? new Date();
  const cleared = await mutate(
    db,
    actor,
    (row: HoldRow) => ({
      action: 'risk.hold_clear',
      targetTable: 'bills',
      targetId: input.billId,
      before: { hold_id: row.id, raised_by_flag: row.raisedByFlag, signal_ids: row.signalIds },
      after: { cleared_at: now.toISOString(), clear_verdict: input.verdict },
      reason: input.reason,
    }),
    async (tx) => {
      const open = await billHold(tx, input.billId);
      if (open === null) throw new NoOpenHold(input.billId);
      await tx.insert(schema.riskHolds).values({
        billId: open.billId,
        raisedByFlag: open.raisedByFlag,
        raisedAt: open.raisedAt,
        signalIds: open.signalIds,
        clearedAt: now,
        clearedBy: input.operatorId,
        clearReason: input.reason,
        clearVerdict: input.verdict,
      });
      return open;
    },
  );
  if (cleared === undefined) throw new NoOpenHold(input.billId);
  return cleared;
}

export class NoOpenHold extends Error {
  constructor(billId: string) {
    super(`bill ${billId} has no open hold`);
  }
}
