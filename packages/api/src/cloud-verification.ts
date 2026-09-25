import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';
import type { AuditActor } from './actor.ts';
import { mutate } from './audit.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Policy B: park the affected debt, preserve every payment and its amount. */
export async function parkCloudFailure(tx: Tx, actor: AuditActor, episodeId: string, ingestId?: string): Promise<string[]> {
  const settlements = await tx
    .select({ id: schema.settlements.id, state: schema.settlements.settlementState })
    .from(schema.settlements)
    .innerJoin(schema.episodeReviews, eq(schema.episodeReviews.id, schema.settlements.episodeReviewId))
    .where(and(
      eq(schema.episodeReviews.episodeId, episodeId),
      ...(ingestId === undefined ? [] : [eq(schema.episodeReviews.ingestId, ingestId)]),
      inArray(schema.settlements.settlementState, ['pending_settlement', 'bill_generated', 'manually_paid']),
    ))
    .orderBy(schema.settlements.id)
    .for('update', { of: schema.settlements });
  for (const settlement of settlements) {
    await mutate(tx, actor, {
      action: 'settlement.exception', targetTable: 'settlements', targetId: settlement.id,
      before: { settlement_state: settlement.state },
      after: { settlement_state: 'exception', exception_from_state: settlement.state,
        exception_reason: 'cloud_verification_failed', exception_note: null },
      reason: 'cloud_verification_failed',
    }, async (settlementTx) => {
      const [parked] = await settlementTx.update(schema.settlements).set({
        settlementState: 'exception', exceptionFromState: settlement.state,
        exceptionReason: 'cloud_verification_failed', exceptionNote: null, updatedAt: new Date(),
      }).where(and(eq(schema.settlements.id, settlement.id), eq(schema.settlements.settlementState, settlement.state)))
        .returning({ id: schema.settlements.id });
      return parked;
    });
  }
  return settlements.map((s) => s.id);
}
