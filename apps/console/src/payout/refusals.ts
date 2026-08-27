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

export function refusalKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'settle.failed';
  if (error.status === 403) return 'settle.readonly.refused';
  if (error.status === 400) return 'settle.invalid';
  if (error.status === 404) return 'settle.gone';
  const detail = error.detail;
  const key = `bo.refused.${String(detail)}`;
  return typeof detail === 'string' && key in MESSAGES.en ? key : 'bo.refused.unknown';
}

/** Whether a failure means the risk engine's routes are not on this server. */
export const isNotOnServer = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;
