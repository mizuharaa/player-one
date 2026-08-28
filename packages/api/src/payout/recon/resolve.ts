import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { mutate } from '../../audit.ts';
import { counterActor, type Actor } from '../../actor.ts';
import type { ReconLineRow } from './lines.ts';

/**
 * The one way a discrepancy is closed: a finance operator, a typed reason,
 * through `mutate` so the audit row and the resolution commit together —
 * which is what `recon_lines_resolved_by_operator` (0015) checks at commit.
 * A reviewer has no place here (no centre, no money), and a worker has no
 * actor at all; both are refused before a statement runs, and the database
 * would refuse them again if they got past this file.
 *
 * The row is locked FIRST and read SECOND, inside the transaction. Under READ
 * COMMITTED a single "select ... for update" that also reads its columns can
 * hand back the snapshot from before the lock was granted, so a resolver that
 * lost a race would see — and return — the open row the winner had already
 * closed (bridge finding F-47; the same shape `review.ts` fixed in 6187a5e).
 * Two statements: the lock waits out the winner, then the read sees what the
 * winner committed. A loser therefore answers `already_resolved` WITH the
 * winner's resolution, and writes no audit row of its own.
 */
export type ResolveOutcome =
  | { kind: 'resolved'; line: ReconLineRow }
  | { kind: 'not_found' }
  | { kind: 'already_resolved'; line: ReconLineRow }
  | { kind: 'refused'; constraint: string };

function constraintOf(err: unknown): string | undefined {
  for (let e: unknown = err; e !== null && e !== undefined; e = (e as { cause?: unknown }).cause) {
    const name = (e as { constraint_name?: string }).constraint_name;
    if (name !== undefined && name !== '') return name;
  }
  return undefined;
}

export async function resolveLine(db: Db, actor: Actor, lineId: string, reason: string): Promise<ResolveOutcome> {
  if (actor.reviewer !== undefined) return { kind: 'refused', constraint: 'recon_lines_resolved_by_operator' };
  if (reason.trim() === '') return { kind: 'refused', constraint: 'recon_lines_resolution_check' };

  /** What the transaction saw once it held the row: absent, already closed, or closed by us. */
  let seen: { kind: 'not_found' } | { kind: 'already_resolved'; line: ReconLineRow } | null = null;
  try {
    const line = await mutate(
      db,
      actor,
      {
        action: 'recon_line.resolve',
        targetTable: 'recon_lines',
        targetId: lineId,
        before: { resolved_at: null },
        after: { resolved_by: counterActor(actor).operator.operatorId },
        reason,
      },
      async (tx) => {
        // 1. The lock. Waits for any resolver already holding the row.
        const locked = (await tx.execute(sql`select id from recon_lines where id = ${lineId} for update`)) as unknown as { id: string }[];
        if (locked[0] === undefined) {
          seen = { kind: 'not_found' };
          return undefined;
        }
        // 2. The read, as a second statement: what the winner committed.
        const [held] = (await tx.execute(sql`select * from recon_lines where id = ${lineId}`)) as unknown as ReconLineRow[];
        if (held === undefined || held.resolved_at !== null) {
          seen = held === undefined ? { kind: 'not_found' } : { kind: 'already_resolved', line: held };
          return undefined;
        }
        const rows = (await tx.execute(sql`
          update recon_lines
             set resolved_at = now(), resolved_by = ${counterActor(actor).operator.operatorId}, resolve_reason = ${reason}
           where id = ${lineId} and resolved_at is null
          returning *
        `)) as unknown as ReconLineRow[];
        return rows[0];
      },
    );
    if (seen !== null) return seen;
    if (line === undefined) return { kind: 'not_found' };
    return { kind: 'resolved', line };
  } catch (err) {
    const name = constraintOf(err);
    if (name !== undefined) return { kind: 'refused', constraint: name };
    throw err;
  }
}
