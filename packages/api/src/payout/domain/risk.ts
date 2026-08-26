/**
 * The risk seam (payout brief, §2.3): what Agent C exposes and what this
 * domain reads. Frozen. The types are transcribed verbatim; the reader is the
 * shape this side consumes them through, so the engine can land after the
 * payout domain and be plugged in without a change here.
 *
 * `band = 'hold'` sets a REVERSIBLE hold on the bill. This domain honours it by
 * refusing to create a payout attempt (behind `PLAYERONE_RISK_HOLD`); an
 * operator with the finance role clears it on Agent C's side with a typed
 * reason. No band ever rejects a bill or a collector — flags advise, humans
 * decide.
 */

export interface RiskSummary {
  subjectType: 'collector' | 'episode' | 'bill' | 'batch';
  subjectId: string;
  score: number; // 0-100, sum of visible components
  band: 'clear' | 'notice' | 'review' | 'hold';
  flags: Flag[];
}

export interface Flag {
  signalId: string; // stable, e.g. 'IDENT.NAME_MISMATCH'
  severity: 'info' | 'notice' | 'review' | 'hold';
  points: number;
  evidence: Record<string, unknown>; // must be human-readable in the console
  thresholdVersion: string;
  computedAt: string;
}

/**
 * The read this domain makes. Agent C implements it over its own tables; the
 * tests here use a stub. `null` means the engine has nothing to say about
 * this bill, which reads as `clear`.
 */
export interface RiskReader {
  billSummary(billId: string): Promise<RiskSummary | null>;
}

export const clearSummary = (billId: string): RiskSummary => ({
  subjectType: 'bill',
  subjectId: billId,
  score: 0,
  band: 'clear',
  flags: [],
});

/** Every bill reads `clear` until the engine is plugged in. */
export const noRisk: RiskReader = {
  billSummary: async () => null,
};
