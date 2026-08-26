import { CATALOGUE_VERSION, RISK_CATALOGUE, bandsFrom } from '../../src/risk/catalogue.ts';
import type { Bands, Flag, Tuning, TuningMap } from '../../src/risk/types.ts';

/**
 * The catalogue as a tuning map, without a database. What the detectors read
 * in production comes from `risk_signals`; in the pure tests it comes from
 * the same rows before they are seeded, so a detector test and an engine
 * test judge by the same numbers.
 */
export function tuningFromCatalogue(overrides: Record<string, Partial<Tuning>> = {}): TuningMap {
  const map = new Map<string, Tuning>();
  for (const r of RISK_CATALOGUE) {
    map.set(r.signalId, {
      signalId: r.signalId,
      family: r.family,
      description: r.description,
      points: r.points,
      severity: r.severity,
      enabled: true,
      thresholdVersion: CATALOGUE_VERSION,
      params: r.params,
      ...overrides[r.signalId],
    });
  }
  return map;
}

export const bands = (): Bands => bandsFrom(tuningFromCatalogue());

/** A flag as the engine would have written it from a finding, for the pure scoring tests. */
export function flagOf(signalId: string, evidence: Record<string, unknown> = {}, tuning: TuningMap = tuningFromCatalogue()): Flag {
  const t = tuning.get(signalId);
  if (t === undefined) throw new Error(`no such signal ${signalId}`);
  return {
    signalId,
    severity: t.severity,
    points: t.points,
    evidence,
    thresholdVersion: t.thresholdVersion,
    computedAt: '2026-08-26T00:00:00.000Z',
  };
}

export const signalIds = (findings: readonly { signalId: string }[]): string[] => findings.map((f) => f.signalId).sort();
