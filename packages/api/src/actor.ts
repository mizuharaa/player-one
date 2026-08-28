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
  collector?: undefined;
};

export type ReviewerActor = {
  reviewer: ReviewerClaims;
  machine?: undefined;
  operator?: undefined;
  collector?: undefined;
};

/**
 * Path A's actor: a collector's phone, and nothing else. The same union
 * argument as above — a collector has no machine, no operator row and no
 * upload centre, and the route guard refuses them every path that reads one,
 * so the type refuses it too.
 */
export type CollectorActor = {
  collector: CollectorClaims;
  machine?: undefined;
  operator?: undefined;
  reviewer?: undefined;
};

export type Actor = CounterActor | ReviewerActor | CollectorActor;

/**
 * The counter half of an actor, on a route only staff can reach.
 *
 * Every caller of this is registered outside `/api/me/`, which is the only
 * scope a collector token reaches, so the collector case is unreachable rather
 * than unhandled — the route guard in `index.ts` has already refused it. It
 * throws rather than returning a partial actor, because the value is on its way
 * into an audit row and a row that invented an operator id would be evidence of
 * something that did not happen.
 */
export function counterActor(actor: Actor): CounterActor {
  if (actor.machine === undefined || actor.operator === undefined) {
    throw new Error('this route is not reachable with a collector session');
  }
  return { machine: actor.machine, operator: actor.operator };
}
