/**
 * The one place a payout refusal becomes a sentence in the reader's language.
 *
 * Same rule as the back office: the catalogue is the list of refusals the
 * console can name, and a 409 whose constraint has no sentence falls through
 * to the generic line. Two statuses are not constraints and get their own
 * sentence — 403, which is "this session does not hold the finance role", and
 * 400, which is a body the server would not read.
 */
import { MESSAGES } from '@playerone/api/i18n';
import { ApiError } from '../lib/api.ts';

/** The catalogue key for a refusal the server named, or the unknown line. */
export function constraintKey(constraint: string): string {
  const key = `bo.refused.${constraint}`;
  return key in MESSAGES.en ? key : 'bo.refused.unknown';
}

/** A settlement state as a sentence, or null when the server grew a new one. */
export function settlementStateKey(state: string): string | null {
  const key = `settle.state.${state}`;
  return key in MESSAGES.en ? key : null;
}

export function refusalKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'settle.failed';
  if (error.status === 403) return 'settle.readonly.refused';
  if (error.status === 400) return 'settle.invalid';
  if (error.status === 404) return 'settle.gone';
  const detail = error.detail;
  return typeof detail === 'string' ? constraintKey(detail) : 'bo.refused.unknown';
}

/** Whether a failure means the risk engine's routes are not on this server. */
export const isNotOnServer = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;
