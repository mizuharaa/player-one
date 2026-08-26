import { describe, expect, it } from 'vitest';
import {
  IllegalTransition,
  next,
  POLLABLE,
  TERMINAL,
  type AttemptEvent,
  type AttemptStatus,
} from '../../../src/payout/domain/state.ts';

/**
 * Every edge of the state machine, legal and illegal. No database: this is
 * the pure function, and the point of it being pure is that the whole table
 * fits in one test file and a change to any edge is visible here.
 *
 * The same edges are listed in `payout_attempts_guard` (0012). `schema.test.ts`
 * walks that list against the database; this file walks this one.
 */

const STATES: AttemptStatus[] = ['created', 'submitted', 'processing', 'pending_zlp', 'succeeded', 'failed', 'unknown'];

const resolve = (outcome: 'succeeded' | 'failed', reason = 'ZaloPay ops confirmed by ticket 4711'): AttemptEvent => ({
  type: 'OPERATOR_RESOLVE',
  reason,
  outcome,
});

const EVENTS: Record<string, AttemptEvent> = {
  SUBMIT: { type: 'SUBMIT' },
  ACCEPTED_1: { type: 'ACCEPTED', status: 1 },
  ACCEPTED_2: { type: 'ACCEPTED', status: 2 },
  ACCEPTED_3: { type: 'ACCEPTED', status: 3 },
  ACCEPTED_4: { type: 'ACCEPTED', status: 4 },
  DUPLICATE: { type: 'DUPLICATE' },
  REJECTED: { type: 'REJECTED', sub: -1104 },
  SYSTEM: { type: 'SYSTEM', sub: -500 },
  UNKNOWN: { type: 'UNKNOWN' },
  POLL_1: { type: 'POLL', status: 1 },
  POLL_2: { type: 'POLL', status: 2 },
  POLL_3: { type: 'POLL', status: 3 },
  POLL_4: { type: 'POLL', status: 4 },
  RESOLVE_OK: resolve('succeeded'),
  RESOLVE_FAIL: resolve('failed'),
};

/** The whole machine, as data. Anything not here is illegal. */
const LEGAL: Record<AttemptStatus, Partial<Record<keyof typeof EVENTS, AttemptStatus>>> = {
  created: { SUBMIT: 'submitted', RESOLVE_FAIL: 'failed' },
  submitted: {
    ACCEPTED_1: 'succeeded',
    ACCEPTED_2: 'processing',
    ACCEPTED_3: 'processing',
    ACCEPTED_4: 'pending_zlp',
    DUPLICATE: 'processing',
    REJECTED: 'failed',
    SYSTEM: 'unknown',
    UNKNOWN: 'unknown',
    POLL_1: 'succeeded',
    POLL_2: 'failed',
    POLL_3: 'processing',
    POLL_4: 'pending_zlp',
  },
  processing: { POLL_1: 'succeeded', POLL_2: 'failed', POLL_3: 'processing', POLL_4: 'pending_zlp' },
  unknown: {
    POLL_1: 'succeeded',
    POLL_2: 'failed',
    POLL_3: 'processing',
    POLL_4: 'pending_zlp',
    RESOLVE_OK: 'succeeded',
    RESOLVE_FAIL: 'failed',
  },
  pending_zlp: { RESOLVE_OK: 'succeeded', RESOLVE_FAIL: 'failed' },
  succeeded: {},
  failed: {},
};

describe('the attempt state machine', () => {
  it('has every legal edge, and only those', () => {
    for (const from of STATES) {
      for (const [name, event] of Object.entries(EVENTS)) {
        const expected = LEGAL[from][name as keyof typeof EVENTS];
        const got = next(from, event);
        if (expected === undefined) {
          expect(got, `${from} + ${name} should be illegal`).toBeInstanceOf(IllegalTransition);
        } else {
          expect(got, `${from} + ${name}`).toBe(expected);
        }
      }
    }
  });

  it('never fails on a lost answer: UNKNOWN goes to unknown and is polled', () => {
    expect(next('submitted', { type: 'UNKNOWN' })).toBe('unknown');
    expect(POLLABLE.has('unknown')).toBe(true);
    // And nothing from `unknown` reaches `failed` except a polled 2 or a person.
    expect(next('unknown', { type: 'UNKNOWN' })).toBeInstanceOf(IllegalTransition);
    expect(next('unknown', { type: 'SYSTEM', sub: -500 })).toBeInstanceOf(IllegalTransition);
  });

  it('treats a duplicate order as the idempotency working, not an error', () => {
    expect(next('submitted', { type: 'DUPLICATE' })).toBe('processing');
  });

  it('parks status 4 in pending_zlp, where no poll, no timeout and no count can move it', () => {
    expect(next('submitted', { type: 'ACCEPTED', status: 4 })).toBe('pending_zlp');
    expect(next('processing', { type: 'POLL', status: 4 })).toBe('pending_zlp');
    expect(POLLABLE.has('pending_zlp')).toBe(false);
    for (const [name, event] of Object.entries(EVENTS)) {
      if (event.type === 'OPERATOR_RESOLVE') continue;
      expect(next('pending_zlp', event), `pending_zlp + ${name}`).toBeInstanceOf(IllegalTransition);
    }
    expect(next('pending_zlp', resolve('succeeded'))).toBe('succeeded');
    expect(next('pending_zlp', resolve('failed'))).toBe('failed');
  });

  it('reaches failed only from a rejection or a polled status 2', () => {
    const reaching = new Set<string>();
    for (const from of STATES) {
      for (const [name, event] of Object.entries(EVENTS)) {
        if (next(from, event) === 'failed') reaching.add(name);
      }
    }
    // The two the rule names, plus a person with a reason.
    expect(reaching).toEqual(new Set(['REJECTED', 'POLL_2', 'RESOLVE_FAIL']));
    // A transfer-fund answer that already says 2 is not taken at its word.
    expect(next('submitted', { type: 'ACCEPTED', status: 2 })).toBe('processing');
    // A system error on transfer-fund does not say whether the order exists.
    expect(next('submitted', { type: 'SYSTEM', sub: -107 })).toBe('unknown');
  });

  it('is terminal at succeeded and failed', () => {
    for (const from of TERMINAL) {
      for (const event of Object.values(EVENTS)) {
        expect(next(from, event)).toBeInstanceOf(IllegalTransition);
      }
    }
  });

  it('needs a typed reason to resolve anything', () => {
    expect(next('pending_zlp', resolve('succeeded', '   '))).toBeInstanceOf(IllegalTransition);
    expect(next('unknown', resolve('failed', ''))).toBeInstanceOf(IllegalTransition);
    // An attempt that was never sent cannot have succeeded.
    expect(next('created', resolve('succeeded'))).toBeInstanceOf(IllegalTransition);
    expect(next('created', resolve('failed'))).toBe('failed');
  });

  it('names the edge it refused', () => {
    const err = next('succeeded', { type: 'SUBMIT' }) as IllegalTransition;
    expect(err.from).toBe('succeeded');
    expect(err.event.type).toBe('SUBMIT');
    expect(err.message).toContain('terminal');
  });
});
