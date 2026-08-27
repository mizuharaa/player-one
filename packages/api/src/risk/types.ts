/**
 * The risk seam, frozen in the payout brief (§2.3), plus the engine's own
 * internal shapes.
 *
 * `RiskSummary` and `Flag` are what Agents B and D consume and are copied from
 * the brief verbatim. Everything else here is private to the engine and may
 * change; nothing outside `packages/api/src/risk` should import it.
 */

export type SubjectType = 'collector' | 'episode' | 'bill' | 'batch';
export type Severity = 'info' | 'notice' | 'review' | 'hold';
export type Band = 'clear' | 'notice' | 'review' | 'hold';

/** Human-readable in the console: the numbers a sentence is built from. */
export type Evidence = Record<string, unknown>;

export interface Flag {
  /** Stable, e.g. 'IDENT.NAME_MISMATCH'. */
  signalId: string;
  severity: Severity;
  points: number;
  evidence: Evidence;
  thresholdVersion: string;
  computedAt: string;
}

export interface RiskSummary {
  subjectType: SubjectType;
  subjectId: string;
  /** 0-100, the sum of the visible components, capped. */
  score: number;
  band: Band;
  flags: Flag[];
}

/** One current catalogue row, as a detector reads it. */
export type Tuning = {
  signalId: string;
  family: string;
  description: string;
  points: number;
  severity: Severity;
  enabled: boolean;
  thresholdVersion: string;
  params: Record<string, unknown>;
};

export type TuningMap = ReadonlyMap<string, Tuning>;

/** The lower edge of each band, read from the BAND.* rows. */
export type Bands = { notice: number; review: number; hold: number };

/**
 * What a detector returns: which signal fired and why. Points, severity and
 * the version come from the tuning at write time, never from the detector, so
 * a detector cannot inflate its own weight.
 */
export type Finding = { signalId: string; evidence: Evidence };

// ---------------------------------------------------------------------------
// Parameter readers. Every threshold lives in `params` on the tuning row; the
// defaults here are only what a row written before a parameter existed reads.

export const numParam = (t: Tuning, key: string, fallback: number): number => {
  const v = t.params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

export const strListParam = (t: Tuning, key: string, fallback: readonly string[] = []): string[] => {
  const v = t.params[key];
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : [...fallback];
};

export const boolParam = (t: Tuning, key: string, fallback: boolean): boolean => {
  const v = t.params[key];
  return typeof v === 'boolean' ? v : fallback;
};

export const objParam = (t: Tuning, key: string): Record<string, unknown> => {
  const v = t.params[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};
