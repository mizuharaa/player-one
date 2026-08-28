/**
 * What the review screen does with a failed verdict.
 *
 * This is a function and not a branch inside `Review.tsx` because it is the
 * whole of the defect it fixes and it has to be testable without a browser.
 * The screen used to read every 409 as a lost lease: `ApiError.isReassigned`
 * was `status === 409`, the screen turned that into the "this episode was
 * reassigned, claim the next one" banner, and it also suppressed the error box
 * for 409s. So a reviewer who tripped `session_claim_missing` was told
 * something that had not happened, the translated sentence for what had
 * happened never rendered, and the episode went back into the queue to refuse
 * the next reviewer the same way.
 *
 * The rule now, and it reads off the BODY rather than the status code:
 *
 * - `{"error":"reassigned"}` — and only that — is a lost lease.
 * - a 409 naming a `constraint` is a refusal, shown as its own sentence.
 * - a 409 naming a constraint the catalogue has no sentence for is still a
 *   refusal, shown as the generic one. It is not a lease loss.
 * - anything else is the write failing, which is what the retry box is for.
 */
import { MESSAGES, REVIEW_HOLDABLE_REFUSALS } from '@playerone/api/i18n';
import { ApiError } from '../lib/api.ts';

export type CommitFailure =
  /** Somebody else holds this episode. The marks are gone; take the next one. */
  | { kind: 'lease' }
  /**
   * The server will not take a verdict on this episode, and said why.
   *
   * `key` is a `bo.refused.*` message key. `holdable` says whether the park is
   * offered alongside it: the refusals in `REVIEW_HOLDABLE_REFUSALS` are the
   * ones where the review row stays pending and eligible, so without an exit
   * the queue hands the same episode to the next reviewer for ever.
   */
  | { kind: 'refused'; key: string; constraint: string | undefined; holdable: boolean }
  /** The commit did not land. Retry or release — the existing behaviour. */
  | { kind: 'failed'; message: string };

/** The catalogue is the list of refusals the console can name, as elsewhere. */
const sentenceFor = (constraint: string | undefined): string => {
  const key = `bo.refused.${String(constraint)}`;
  return constraint !== undefined && key in MESSAGES.en ? key : 'bo.refused.unknown';
};

export function commitFailure(error: unknown): CommitFailure {
  if (!(error instanceof ApiError)) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
  if (error.isReassigned) return { kind: 'lease' };
  if (error.status === 409) {
    return {
      kind: 'refused',
      key: sentenceFor(error.constraint),
      constraint: error.constraint,
      holdable: error.constraint !== undefined && REVIEW_HOLDABLE_REFUSALS.has(error.constraint),
    };
  }
  return { kind: 'failed', message: error.message };
}
