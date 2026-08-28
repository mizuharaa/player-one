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
  /**
   * Either the event, or a function of what `write` returned.
   *
   * The function form exists because the review queue picks its own target: a
   * claim is "whatever is next", so the row being audited is not known until
   * the statement that takes it has run. Building the event afterwards is the
   * only way that write can stay inside `mutate` — and a claim that logged an
   * episode id chosen before the claim would name the wrong row on every lost
   * race, which is worse than not logging it.
   */
  event: AuditEvent | ((result: T) => AuditEvent),
  write: (tx: Tx) => Promise<T | undefined>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const result = await write(tx);
    if (result === undefined) return undefined;
    const recorded = typeof event === 'function' ? event(result) : event;
    /**
     * A reviewer is recorded as a reviewer. PLT-10 asks for remote review that
     * is *fully logged*, and a row that named a PaXini reviewer in the same
     * column and the same shape as a VNG counter operator would be logged
     * without being answerable: "did anyone in Shenzhen touch this episode" is
     * the question the trail has to answer, and `actor_role` is what answers it.
     * There is no upload device and no upload centre behind that person, so
     * neither is invented here.
     */
    await tx.insert(schema.auditEvents).values({
      action: recorded.action,
      targetTable: recorded.targetTable,
      targetId: recorded.targetId,
      ...(actor.operator !== undefined
        ? {
            actorRole: 'operator',
            operatorId: actor.operator.operatorId,
            uploadDeviceId: actor.machine.uploadDeviceId,
            uploadCentreId: actor.operator.uploadCentreId,
          }
        : actor.reviewer !== undefined
          ? {
              actorRole: 'reviewer',
              operatorId: actor.reviewer.reviewerId,
              uploadDeviceId: null,
              uploadCentreId: null,
            }
          : /**
             * A collector session. It reaches no mutating route today — every
             * `/api/me/` route is a read — and it must not reach one by
             * accident, because there is no honest row to write for it:
             * `audit_events_actor_role_check` allows `operator` and `reviewer`
             * and nothing else, and `operator_id` is a foreign key into
             * `operators`, which a collector is not a row in.
             *
             * So this throws inside the transaction and the whole mutation
             * rolls back. A write nobody can attribute is worse than a refused
             * write, and this is the audit trail: the one place where failing
             * loudly is the requirement. Whoever gives a collector something to
             * write — raising a dispute is the obvious one — adds the role to
             * that CHECK and the identity column to this table in the same
             * migration, and deletes this branch.
             */
            ((): never => {
              throw new Error(
                'a collector session cannot write an audited mutation: audit_events has no actor_role for one',
              );
            })()),
      before: recorded.before ?? null,
      after: recorded.after ?? null,
      reason: recorded.reason ?? null,
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
  who: { operatorId?: string; uploadDeviceId?: string; uploadCentreId?: string },
): Promise<void> {
  await db.insert(schema.auditEvents).values({
    action,
    targetTable,
    targetId,
    // From the action, not a fourth argument: `reviewer.login` is the only
    // login a reviewer can perform, so a caller cannot get the pair wrong.
    actorRole: action.startsWith('reviewer.') ? 'reviewer' : 'operator',
    operatorId: who.operatorId ?? null,
    uploadDeviceId: who.uploadDeviceId ?? null,
    // Null for a reviewer: PaXini staff belong to no upload centre.
    uploadCentreId: who.uploadCentreId ?? null,
    after: who,
  });
}
