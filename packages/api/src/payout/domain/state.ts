/**
 * The attempt state machine, as a pure function. No I/O, no clock, no
 * database: `next(current, event)` is the whole of it, and the same pair gives
 * the same answer on any machine, which is what lets every edge — legal and
 * illegal — be a unit test.
 *
 * The database holds the same edges in `payout_attempts_guard` (0012). Two
 * copies on purpose: this one answers "what does this ZaloPay result mean for
 * this attempt" with the vocabulary of results, and that one refuses a jump no
 * matter who writes it, in the vocabulary of rows. They must agree, and
 * `state.test.ts` lists every legal edge so a change to either is visible.
 *
 * Four rules are not negotiable, and each is stated where it is enforced:
 *
 *   - UNKNOWN never goes to `failed`. A timeout on transfer-fund does not mean
 *     the transfer failed; it goes to `unknown` and is polled.
 *   - DUPLICATE (-68) goes to `processing` and is polled. It is not an error:
 *     ZaloPay already holds an order under this id, which is the idempotency
 *     working.
 *   - ZaloPay status 4 goes to `pending_zlp`, and only OPERATOR_RESOLVE moves
 *     it. No timeout, no poll count, no worker.
 *   - Only REJECTED and a polled status 2 reach `failed`. A SYSTEM result on
 *     transfer-fund (-107, -500, -503) is retryable *as a new order* according
 *     to ZaloPay, but whether THIS order was created is exactly what a system
 *     error does not say, so it goes to `unknown` and is polled first.
 */

export type AttemptStatus =
  | 'created'
  | 'submitted'
  | 'processing'
  | 'pending_zlp'
  | 'succeeded'
  | 'failed'
  | 'unknown';

/** ZaloPay's four transaction states (Part 0, F4). */
export type ZlpStatus = 1 | 2 | 3 | 4;

export type AttemptEvent =
  /** The transfer-fund request is about to be sent. */
  | { type: 'SUBMIT' }
  /** transfer-fund answered with an order and a status. */
  | { type: 'ACCEPTED'; status: ZlpStatus }
  /** transfer-fund answered -68: an order under this partner_order_id exists. */
  | { type: 'DUPLICATE' }
  /** transfer-fund refused the order for good. */
  | { type: 'REJECTED'; sub: number }
  /** transfer-fund answered with a system error. */
  | { type: 'SYSTEM'; sub: number }
  /** transfer-fund produced no interpretable answer. */
  | { type: 'UNKNOWN' }
  /** query-txn answered with a status. */
  | { type: 'POLL'; status: ZlpStatus }
  /** A person, with a reason, says what happened. */
  | { type: 'OPERATOR_RESOLVE'; reason: string; outcome: 'succeeded' | 'failed' };

/** An edge the machine does not have. A value, not a throw: callers decide the status code. */
export class IllegalTransition extends Error {
  // Declared and assigned, not parameter properties: `bin/` runs .ts under
  // Node's strip-only type stripping, which refuses them (RUNNING.md), and
  // index.ts imports this file, so a parameter property here stops serve.ts.
  readonly from: AttemptStatus;
  readonly event: AttemptEvent;
  constructor(from: AttemptStatus, event: AttemptEvent, why: string) {
    super(`${from} + ${event.type}: ${why}`);
    this.name = 'IllegalTransition';
    this.from = from;
    this.event = event;
  }
}

export const TERMINAL: ReadonlySet<AttemptStatus> = new Set(['succeeded', 'failed']);

/** The states the poller may touch. `pending_zlp` is deliberately not one of them. */
export const POLLABLE: ReadonlySet<AttemptStatus> = new Set(['submitted', 'processing', 'unknown']);

const fromZlp = (status: ZlpStatus): AttemptStatus => {
  switch (status) {
    case 1:
      return 'succeeded';
    case 2:
      return 'failed';
    case 3:
      return 'processing';
    case 4:
      return 'pending_zlp';
  }
};

export function next(current: AttemptStatus, event: AttemptEvent): AttemptStatus | IllegalTransition {
  const illegal = (why: string) => new IllegalTransition(current, event, why);

  if (TERMINAL.has(current)) return illegal('terminal; a retry is a new attempt');

  if (current === 'pending_zlp') {
    // Nothing but a person moves this. Not a poll, not a timeout, not a count.
    if (event.type !== 'OPERATOR_RESOLVE') return illegal('pending inside ZaloPay; only an operator with a reason may move it');
    if (event.reason.trim() === '') return illegal('a resolution needs a typed reason');
    return event.outcome;
  }

  switch (event.type) {
    case 'SUBMIT':
      return current === 'created' ? 'submitted' : illegal('only an unsent attempt is submitted');

    case 'ACCEPTED': {
      if (current !== 'submitted') return illegal('a transfer answer belongs to a submitted attempt');
      /**
       * Status 2 on the transfer-fund answer itself is not taken as terminal:
       * only a *polled* status 2 reaches `failed`. The order exists, so the
       * poller asks query-txn and lets that answer decide.
       */
      return event.status === 2 ? 'processing' : fromZlp(event.status);
    }

    case 'DUPLICATE':
      return current === 'submitted' ? 'processing' : illegal('a duplicate answer belongs to a submitted attempt');

    case 'REJECTED':
      return current === 'submitted' ? 'failed' : illegal('a rejection belongs to a submitted attempt');

    case 'SYSTEM':
      // Retryable as a NEW order per ZaloPay — after the poller has confirmed
      // this one was never created. Not `failed` from here.
      return current === 'submitted' ? 'unknown' : illegal('a system error belongs to a submitted attempt');

    case 'UNKNOWN':
      return current === 'submitted' ? 'unknown' : illegal('a lost answer belongs to a submitted attempt');

    case 'POLL':
      if (!POLLABLE.has(current)) return illegal('only submitted, processing and unknown attempts are polled');
      return fromZlp(event.status);

    case 'OPERATOR_RESOLVE':
      if (event.reason.trim() === '') return illegal('a resolution needs a typed reason');
      /**
       * An operator may resolve what nobody else can: an attempt pending at
       * ZaloPay (handled above), an attempt whose answer was lost and whose
       * polling has been exhausted, and an attempt that was created and never
       * sent. A submitted or processing attempt has a poller working on it and
       * an operator overriding that is guessing.
       */
      if (current === 'unknown') return event.outcome;
      if (current === 'created') {
        return event.outcome === 'failed' ? 'failed' : illegal('an attempt that was never sent cannot have succeeded');
      }
      return illegal('the poller is still working on this attempt');
  }
}
