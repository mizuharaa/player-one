import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import type {
  CollectorClaims,
  MachineClaims,
  OperatorClaims,
  ReviewerClaims,
} from './credentials.ts';

/**
 * Who made a change, and from where.
 *
 * The counter case is both halves, always present: the machine token proves the
 * counter, the operator token proves the person, and PRD §11.3.1 rule 2 records
 * both on the handover.
 *
 * PLT-10 adds a second case that is deliberately *not* the first one with
 * fields missing. A PaXini reviewer in Shenzhen signs in from a browser with one
 * credential; there is no counter behind them and no centre to scope to, and
 * every route that reads `machine` or `operator.uploadCentreId` is one the route
 * guard refuses them. Modelling that as a union rather than as optional fields
 * means the compiler refuses it too — `episodes.ts` cannot accidentally start
 * reading `actor.machine` off a reviewer, because a reviewer is not that type.
 *
 * Its own module so `audit.ts` and `index.ts` can both name it without either
 * importing the other.
 */
export type CounterActor = {
  machine: MachineClaims;
  operator: OperatorClaims;
  reviewer?: undefined;
  /** Never set. Present so `AuditActor` below discriminates on one absent key. */
  collector?: undefined;
};

export type ReviewerActor = {
  reviewer: ReviewerClaims;
  machine?: undefined;
  operator?: undefined;
  collector?: undefined;
};

export type Actor = CounterActor | ReviewerActor;

/**
 * Who a collector is, for the audit trail and for nothing else.
 *
 * `Actor` above stays staff-only on purpose (feat/collector-auth's rule): a
 * route handler that reads `actor.operator.uploadCentreId` must not be
 * handed a collector even by a guard mistake, and requireActor never sets
 * `req.actor` for a collector — it sets `req.collector` and returns.
 *
 * What changed when feat/path-a-upload merged is narrower than that. A
 * collector now DOES make an audited change: `POST /api/me/uploads` and its
 * completion write rows, and 0019 gives `audit_events` a `collector_id`
 * column and a third attribution shape to hold them. So the audit writer, and
 * only the audit writer, accepts one. Everything else still takes `Actor`.
 */
export type CollectorActor = {
  collector: CollectorClaims;
  machine?: undefined;
  operator?: undefined;
  reviewer?: undefined;
};

/** What `mutate` may attribute a row to. Staff, or a collector on Path A. */
export type AuditActor = Actor | CollectorActor;

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

/**
 * The actor's role, read from the row and not from the token. A token is
 * signed once at login; a role granted or revoked this morning must bite this
 * afternoon, so it costs one primary-key lookup per request that asks.
 *
 * Null for a reviewer: PLT-10 scopes them to review and they hold no
 * back-office role at all.
 *
 * It ASKS FOR THE OPERATOR HALF rather than excluding the reviewer. The two
 * are the same test today and stop being the same the moment a fourth kind of
 * session exists: "not a reviewer, therefore an operator" would let that one
 * fall through into the role lookup and read `actor.operator.operatorId` off
 * a token that has no operator. feat/collector-money-api's report raised this
 * against the shape fix/money-and-access lifted here, and it is fixed on the
 * merge. Nothing changes for the two kinds that exist — requireActor never
 * sets `req.actor` for a collector — but a guard that is right for the wrong
 * reason breaks the day somebody adds the fourth kind.
 */
export async function roleOf(db: Db, actor: Actor | undefined): Promise<string | null> {
  if (actor?.operator === undefined) return null;
  const [row] = await db
    .select({ role: schema.operators.role })
    .from(schema.operators)
    .where(eq(schema.operators.id, actor.operator.operatorId));
  return row?.role ?? null;
}

/**
 * The finance gate, for the payout lane and the settle lane alike.
 *
 * It lived in `payout.ts` and the settle routes had none, which is how a
 * counter operator at an unrelated centre read every collector's bill totals
 * and the settlement CSV. One guard, both files.
 */
export const financeGuard =
  (db: Db) =>
  async (req: FastifyRequest, reply: Reply): Promise<unknown> => {
    if ((await roleOf(db, req.actor)) !== 'finance') {
      return reply.code(403).send({ error: 'finance role required' });
    }
    return undefined;
  };

/**
 * The name a refusal for the wrong role carries, on the route and in the
 * database alike (migration 0020). One name, because the operator's question
 * is the same either way — "why not?" — and the answer is the same sentence.
 */
export const ADMIN_REFUSAL = 'backoffice_admin_required';

/**
 * The role that shapes the back office. What it is, what it deliberately is
 * not, and what happens to the operators already in the database, are all in
 * the header of `packages/store/drizzle/0020_backoffice_admin_role.sql`.
 */
export const ADMIN_ROLE = 'administrator';

/**
 * BO-11 / SEC-02. The administrator gate, for the shaping half of the back
 * office: tasks and their prices, collector qualification, device inventory
 * and bindings.
 *
 * Same shape as the finance gate this tree already carries twice — `payout.ts`
 * and `risk/routes.ts` each have a `requireFinance` preHandler that reads the
 * role from the row — and `roleOf` above is the lookup both of them repeat.
 * `fix/money-and-access` lifted that lookup and a `financeGuard` into this file
 * first; the two `roleOf` implementations were byte-identical and one was kept
 * at the merge.
 *
 * It exists because the daily counter job and the shaping job are different
 * people in §4.1, and until this guard every authenticated operator at every
 * centre could publish a task, price it, and qualify a collector to record
 * against it.
 *
 * The reply names the role, because "403" on a screen with a Save button on it
 * tells an operator nothing they can act on. `role_required` is the machine
 * half; `constraint` is what the console turns into a sentence.
 */
export const adminGuard =
  (db: Db) =>
  async (req: FastifyRequest, reply: Reply): Promise<unknown> => {
    if ((await roleOf(db, req.actor)) !== ADMIN_ROLE) {
      return reply
        .code(403)
        .send({ error: 'refused', constraint: ADMIN_REFUSAL, role_required: ADMIN_ROLE });
    }
    return undefined;
  };
