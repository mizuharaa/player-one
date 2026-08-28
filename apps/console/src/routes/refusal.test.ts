import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { ApiError } from '../lib/api.ts';
import { commitFailure } from './refusal.ts';

/**
 * What the review screen shows when a verdict is refused.
 *
 * The defect this pins: `ApiError.isReassigned` was `status === 409`, so every
 * refusal on the verdict path reached the screen as an expired lease. The
 * reviewer read "this episode was reassigned, claim the next one" — which had
 * not happened — the translated sentence for what really happened never
 * rendered, and the episode went back into the queue to refuse the next
 * reviewer the same way. Both halves are asserted here: the classification,
 * and that a sentence exists for every name that can arrive.
 */

/** The shape `call()` builds: message is the body's `error`, then the constraint. */
const refusal = (constraint: string) => new ApiError(409, 'refused', constraint, constraint);
const reassigned = (detail: string) => new ApiError(409, 'reassigned', detail, undefined);

describe('a refused verdict is not a lost lease', () => {
  /**
   * The named refusals the verdict route can raise, and the counter's one that
   * reaches it. Every one of these was reported to the reviewer as an expired
   * lease before this change.
   */
  const NAMED = [
    'session_claim_missing',
    'review_already_decided',
    'review_no_task',
    'review_no_longer_reviewable',
    'review_billed_while_disputed',
    'review_verdict_id_taken',
    /**
     * Not on this branch: `feat/upload-restriction` adds it at review.ts's
     * billable-duration guard. Listed so the classification is proved for a
     * name this file does not own — the rule is the body's name, not a list.
     */
    'review_duration_implausible',
  ];

  for (const constraint of NAMED) {
    it(`${constraint} shows its own sentence, not the lease banner`, () => {
      const failure = commitFailure(refusal(constraint));
      expect(failure.kind).toBe('refused');
      expect(failure).toMatchObject({ constraint });
    });
  }

  it('only a genuine reassignment says the lease was lost', () => {
    expect(commitFailure(reassigned('the lease on this episode expired'))).toEqual({ kind: 'lease' });
    expect(commitFailure(reassigned('this episode is claimed by someone else'))).toEqual({ kind: 'lease' });
    expect(commitFailure(reassigned('this review was decided elsewhere'))).toEqual({ kind: 'lease' });
  });

  /**
   * A `reassigned` 409 carries an English sentence in `detail`, and `detail` is
   * where the back office puts a constraint name. Looking one up from the other
   * would print "The server refused that change." over a real lease loss.
   */
  it('does not read a reassignment detail as a refusal name', () => {
    const err = reassigned('the lease on this episode expired');
    expect(err.constraint).toBeUndefined();
    expect(commitFailure(err).kind).toBe('lease');
  });

  it('a 409 that names nothing is still not a lease loss', () => {
    const failure = commitFailure(new ApiError(409, 'not reviewable', 'something new', undefined));
    expect(failure).toEqual({
      kind: 'refused',
      key: 'bo.refused.unknown',
      constraint: undefined,
      holdable: false,
    });
  });

  it('a name with no sentence falls through to the generic one', () => {
    const failure = commitFailure(refusal('review_something_invented'));
    expect(failure).toMatchObject({ key: 'bo.refused.unknown', holdable: false });
  });

  it('anything that is not a 409 is still a failed write', () => {
    expect(commitFailure(new ApiError(500, 'boom'))).toEqual({ kind: 'failed', message: 'boom' });
    expect(commitFailure(new Error('offline'))).toEqual({ kind: 'failed', message: 'offline' });
  });
});

describe('the sentence the reviewer actually sees', () => {
  /**
   * The point of the whole change: the reviewer reads this in their own
   * language. Chinese is checked explicitly because the reviewer is in
   * Shenzhen and a missing `zh` string renders as the English one.
   */
  it('is a real sentence in all three languages for every named refusal', () => {
    for (const constraint of [
      'session_claim_missing',
      'review_already_decided',
      'review_no_task',
      'review_no_longer_reviewable',
      'review_billed_while_disputed',
      'review_verdict_id_taken',
    ]) {
      const { key } = commitFailure(refusal(constraint)) as { key: string };
      expect(key, `${constraint} has no sentence`).toBe(`bo.refused.${constraint}`);
      for (const locale of ['en', 'zh', 'vi'] as const) {
        const sentence = MESSAGES[locale][key as keyof typeof MESSAGES.en];
        expect(sentence, `${constraint} has no ${locale} sentence`).toBeTruthy();
      }
    }
  });

  it('is different in Chinese from English, so nothing is an untranslated copy', () => {
    const key = 'bo.refused.session_claim_missing' as const;
    expect(MESSAGES.zh[key]).not.toBe(MESSAGES.en[key]);
    expect(MESSAGES.vi[key]).not.toBe(MESSAGES.en[key]);
  });
});

/**
 * Which refusals get the park button. The set is the server's own
 * (`REVIEW_HOLDABLE_REFUSALS`), so this asserts the console reads it rather
 * than keeping a second copy.
 */
describe('the way out of a refused episode', () => {
  it('is offered where the review row is left pending and eligible', () => {
    for (const constraint of [
      'session_claim_missing',
      'review_no_task',
      'review_no_longer_reviewable',
      'review_billed_while_disputed',
    ]) {
      expect(commitFailure(refusal(constraint)), constraint).toMatchObject({ holdable: true });
    }
  });

  it('is not offered where there is nothing left to park', () => {
    // Already decided, and a verdict id that belongs to somebody else: in both
    // the row is not a pending one this reviewer can send anywhere.
    expect(commitFailure(refusal('review_already_decided'))).toMatchObject({ holdable: false });
    expect(commitFailure(refusal('review_verdict_id_taken'))).toMatchObject({ holdable: false });
    expect(commitFailure(reassigned('the lease on this episode expired'))).toEqual({ kind: 'lease' });
  });
});
