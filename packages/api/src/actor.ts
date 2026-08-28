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
 * A collector, signed in from the app. The third case, and the narrowest: it
 * reaches `/api/me/` and nothing else.
 *
 * `machine`, `operator` and `reviewer` are all `undefined` here, which is the
 * point. `me.ts` cannot read an operator's centre off a collector token
 * because the compiler will not let it, and no `/api/me/` query has a centre
 * or a reviewer to scope by in the first place.
 */
export type CollectorActor = {
  collector: CollectorClaims;
  machine?: undefined;
  operator?: undefined;
  reviewer?: undefined;
};

export type Actor = CounterActor | ReviewerActor | CollectorActor;
