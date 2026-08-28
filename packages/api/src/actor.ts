import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import type { MachineClaims, OperatorClaims, ReviewerClaims } from './credentials.ts';

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
};

export type ReviewerActor = {
  reviewer: ReviewerClaims;
  machine?: undefined;
  operator?: undefined;
};

export type Actor = CounterActor | ReviewerActor;

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

/**
 * The actor's role, read from the row and not from the token. A token is
 * signed once at login; a role granted or revoked this morning must bite this
 * afternoon, so it costs one primary-key lookup per request that asks.
 *
 * Null for a reviewer: PLT-10 scopes them to review and they hold no
 * back-office role at all.
 */
export async function roleOf(db: Db, actor: Actor | undefined): Promise<string | null> {
  if (actor === undefined || actor.reviewer !== undefined) return null;
  const [row] = await db
    .select({ role: schema.operators.role })
    .from(schema.operators)
    .where(eq(schema.operators.id, actor.operator.operatorId));
  return row?.role ?? null;
}

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
 * `fix/money-and-access` lifts that lookup and a `financeGuard` into this file;
 * when it merges, its `roleOf` and this one are the same function and one of
 * them goes.
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
