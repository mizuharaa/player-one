import { schema, type Db } from '@playerone/store';
import type { AuditActor } from './actor.ts';

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
 * Who a row names, as one complete shape per kind of actor.
 *
 * `audit_events_attributed_check` lists three complete shapes and no overlap
 * between them rather than three "at least this much" predicates, so every
 * column a kind does not have is written null here on purpose. A half-filled
 * row is evidence of something that did not happen, which is the one failure
 * that table exists to prevent.
 */
const attribution = (
  actor: AuditActor,
): {
  actorRole: string;
  operatorId: string | null;
  collectorId: string | null;
  uploadDeviceId: string | null;
  uploadCentreId: string | null;
} => {
  if (actor.reviewer !== undefined) {
    return {
      actorRole: 'reviewer',
      operatorId: actor.reviewer.reviewerId,
      collectorId: null,
      uploadDeviceId: null,
      uploadCentreId: null,
    };
  }
  if (actor.collector !== undefined) {
    return {
      actorRole: 'collector',
      operatorId: null,
      collectorId: actor.collector.collectorId,
      uploadDeviceId: null,
      uploadCentreId: null,
    };
  }
  return {
    actorRole: 'operator',
    operatorId: actor.operator.operatorId,
    collectorId: null,
    uploadDeviceId: actor.machine.uploadDeviceId,
    uploadCentreId: actor.operator.uploadCentreId,
  };
};

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
  actor: AuditActor,
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
      /**
       * A collector is recorded as a collector, in a column of its own (0019).
       * PLT-07 and PLT-08 want every mutation attributed, and Path A is the
       * first route a person who is not staff can mutate anything through.
       * Reusing `operator_id` would have been one fewer column and would have
       * made "did a member of staff touch this episode" unanswerable, because
       * that column carries a foreign key into the table of people who sign in
       * to VNG systems.
       */
      ...attribution(actor),
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
 * exempts `%.login` for exactly this, and `%.login_failed` alongside it.
 *
 * A *failed* sign-in has no actor at all, and the reference it named may match
 * no row anywhere, so it is recorded through the same function with none of the
 * ids filled in: `source` says where the attempt came from, `outcome` says how
 * it was refused, and `target_id` carries the reference that was typed. The
 * secret is never a parameter here and must never become one.
 */
export async function auditLogin(
  db: Db,
  action: `${string}.login` | `${string}.login_failed`,
  targetTable: string,
  targetId: string,
  who: {
    operatorId?: string;
    uploadDeviceId?: string;
    uploadCentreId?: string;
    /**
     * A collector, and deliberately not a column. `operator_id` has a foreign
     * key into `operators` and a collector is not one; putting the id there
     * would either fail the key or, worse, match an unrelated operator. The id
     * is the row's `target_id` — the table it is filed against is `collectors` —
     * and this repeats it in `after` so the row reads the same as every other.
     */
    collectorId?: string;
    source?: string;
    outcome?: 'credentials' | 'rate_limited';
  },
): Promise<void> {
  await db.insert(schema.auditEvents).values({
    action,
    targetTable,
    targetId,
    // From the action, not a fourth argument: `reviewer.login` is the only
    // login a reviewer can perform, so a caller cannot get the pair wrong. The
    // same holds for `collector.login` — 0018 added that role for exactly these
    // two rows and `audit_events_attributed_check` refuses every other shape
    // carrying it.
    actorRole: action.startsWith('reviewer.')
      ? 'reviewer'
      : action.startsWith('collector.')
        ? 'collector'
        : 'operator',
    operatorId: who.operatorId ?? null,
    uploadDeviceId: who.uploadDeviceId ?? null,
    // Null for a reviewer: PaXini staff belong to no upload centre.
    uploadCentreId: who.uploadCentreId ?? null,
    after: who,
  });
}
