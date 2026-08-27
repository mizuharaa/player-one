/**
 * Reconciliation (Agent F of the payout brief). Three ways of asking whether
 * the other side agrees with `payout_attempts`, one table of answers, and
 * one rule: nothing here resolves anything.
 *
 *   tick.ts       the daily run over query-txn, for API attempts
 *   statement.ts  a bank or wallet statement against manual attempts
 *   shadow.ts     what the API rail would have sent, and the diff afterwards
 *   resolve.ts    the operator's way of closing a line — the only one
 *   lines.ts      the run, the line, the ticket
 */
export { tick, compare, RECON_WINDOW, type Answer, type Compared, type ReconReport, type ReconTickOptions } from './tick.ts';
export {
  parseStatement,
  matchStatement,
  ingestStatement,
  parseAmount,
  parseDate,
  normaliseReference,
  foldHeader,
  DEFAULT_DATE_TOLERANCE_MS,
  type StatementLine,
  type ManualAttempt,
  type StatementMatch,
  type StatementIngest,
} from './statement.ts';
export { shadowRun, shadowDiff, diffShadow, type Intended, type ActualPayment, type ShadowRun, type ShadowDiff } from './shadow.ts';
export { resolveLine, type ResolveOutcome } from './resolve.ts';
export {
  DISCREPANCY_KINDS,
  RECON_TICKET_KIND,
  describe,
  linesOfRun,
  openLines,
  periodLabel,
  type DiscrepancyKind,
  type Finding,
  type Period,
  type ReconLineRow,
  type ReconSource,
} from './lines.ts';
