import { schema, type Db } from '@playerone/store';
import type { Actor } from './actor.ts';

/**
 * PLT-07, PLT-08, SEC-04, SEC-05.
 *
 * Every mutation goes through `mutate`, and `mutate` writes the audit row inside
 * the same transaction as the change. That is the whole design, and both halves
 * matter:
 *
 *   - It is the only exported write path, so an endpoint cannot mutate without
 *     auditing. An audit trail that depends on the endpoint author remembering
 *     is not an audit trail.
 *   - One transaction, so the row and the change commit together or neither
 *     does. An audit write after the commit can be missing while the change
 *     succeeded, which is the failure that makes a trail untrustworthy — you
 *     cannot tell an unaudited change from a change that never happened.
 *
 * A Fastify hook cannot do this. It runs outside the transaction and does not
 * know the target id or the before state, so it could only record that a request
 * arrived — not what it did.
 */

export type AuditEvent = {
  action: string;
  targetTable: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  /**
   * Required by the database for `episode.resolve_manual`: overriding the
   * machine on a money path has to say why. See audit_events_manual_reason_check.
   */
  reason?: string;
};

/**
 * Note for callers: `before`, `after` and `reason` are read *after* `write`
 * resolves, so a caller may pass an object and fill it in from inside the
 * transaction. That is not a trick, it is the point — the honest `after` for an
 * UPDATE is what the UPDATE returned, which the caller does not know until it
 * has run. Recording what it intended to change instead is an audit row
 * asserting something the database never confirmed.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs `write` and records it. Returns whatever `write` returned.
 *
 * The actor is not a parameter of the event on purpose: it comes from the
 * verified tokens, never from the request body, so an endpoint cannot attribute
 * a change to somebody else.
 *
 * `write` returning `undefined` means nothing changed, and then no audit row is
 * written. That is what makes a replayed offline request cheap: an
 * `onConflictDoNothing().returning()` yields `[]` on a row that already exists,
 * so re-posting the queue neither duplicates the row nor duplicates its audit
 * entry. audit_events is a table §10.6 counts.
 */
export async function mutate<T>(
  db: Db,
  actor: Actor,
  event: AuditEvent,
  write: (tx: Tx) => Promise<T | undefined>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const result = await write(tx);
    if (result === undefined) return undefined;
    await tx.insert(schema.auditEvents).values({
      action: event.action,
      targetTable: event.targetTable,
      targetId: event.targetId,
      operatorId: actor.operator.operatorId,
      uploadDeviceId: actor.machine.uploadDeviceId,
      uploadCentreId: actor.operator.uploadCentreId,
      before: event.before ?? null,
      after: event.after ?? null,
      reason: event.reason ?? null,
    });
    return result;
  });
}

/**
 * A login has no change to wrap and only half an actor — the machine has not
 * proved an operator yet, and vice versa. `audit_events_attributed_check`
 * exempts `%.login` for exactly this, and nothing else.
 */
export async function auditLogin(
  db: Db,
  action: `${string}.login`,
  targetTable: string,
  targetId: string,
  who: { operatorId?: string; uploadDeviceId?: string; uploadCentreId: string },
): Promise<void> {
  await db.insert(schema.auditEvents).values({
    action,
    targetTable,
    targetId,
    operatorId: who.operatorId ?? null,
    uploadDeviceId: who.uploadDeviceId ?? null,
    uploadCentreId: who.uploadCentreId,
    after: who,
  });
}
