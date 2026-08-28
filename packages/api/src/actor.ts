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
