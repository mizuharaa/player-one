import { EVALUATED_SIGNAL, SYNTHETIC_SIGNAL } from './catalogue.ts';
import type { Band, Bands, Flag, RiskSummary, Severity, SubjectType } from './types.ts';

/**
 * Scoring and bands. Pure: no I/O, no clock, no randomness, so the same flags
 * under the same bands always summarise the same way — which is the
 * determinism the brief asks a test to prove.
 *
 * A score is a visible SUM OF NAMED COMPONENTS: the points of the flags that
 * are findings, capped at 100. Nothing here weights, decays or combines
 * flags in a way an operator could not redo with a pencil.
 */

export const SCORE_CAP = 100;

/**
 * A finding is a flag that means something. A zero-point 'info' row is a
 * record — the evaluation marker, the frame fingerprint — and is kept in the
 * table for the engine's own use, but it is not shown as a finding and it does
 * not score.
 */
export const isFinding = (f: Pick<Flag, 'signalId' | 'points' | 'severity'>): boolean =>
  f.signalId !== EVALUATED_SIGNAL && (f.points > 0 || f.severity !== 'info');

export const scoreOf = (flags: readonly Flag[]): number =>
  Math.min(
    SCORE_CAP,
    flags.filter(isFinding).reduce((acc, f) => acc + f.points, 0),
  );

export const bandOf = (score: number, bands: Bands): Band =>
  score >= bands.hold ? 'hold' : score >= bands.review ? 'review' : score >= bands.notice ? 'notice' : 'clear';

/** The severity a number of points lands in. What a single flag's severity should agree with. */
export const severityOf = (points: number, bands: Bands): Severity => {
  const band = bandOf(points, bands);
  return band === 'clear' ? 'info' : band;
};

const BAND_ORDER: Record<Band, number> = { clear: 0, notice: 1, review: 2, hold: 3 };
export const worseBand = (a: Band, b: Band): Band => (BAND_ORDER[a] >= BAND_ORDER[b] ? a : b);

/**
 * The band of a set of flags, with the one rule the brief says must be code
 * and not a comment: PROV.SYNTHETIC_HEURISTIC may never be the sole cause of
 * a hold. If the score reaches the hold band only because that signal is in
 * the sum, the band is 'review'. The signal still shows, still scores, and
 * still counts towards a hold that other evidence reaches on its own.
 */
export function bandFor(flags: readonly Flag[], bands: Bands): Band {
  const score = scoreOf(flags);
  const band = bandOf(score, bands);
  if (band !== 'hold') return band;
  const withoutSynthetic = scoreOf(flags.filter((f) => f.signalId !== SYNTHETIC_SIGNAL));
  return bandOf(withoutSynthetic, bands) === 'hold' ? 'hold' : 'review';
}

export function summarise(
  subjectType: SubjectType,
  subjectId: string,
  flags: readonly Flag[],
  bands: Bands,
): RiskSummary {
  const findings = flags.filter(isFinding);
  return {
    subjectType,
    subjectId,
    score: scoreOf(findings),
    band: bandFor(findings, bands),
    flags: [...findings].sort(byWeight),
  };
}

/** Heaviest first, then by id, so two renders of one summary list the same order. */
export const byWeight = (a: Flag, b: Flag): number =>
  b.points - a.points || (a.signalId < b.signalId ? -1 : a.signalId > b.signalId ? 1 : 0);

/**
 * Rolls several subjects' flags into one list for a bill: the bill's own
 * flags, its collector's, and those of every episode on it.
 *
 * Each signal counts ONCE, at its heaviest instance. Forty episodes each with
 * a 10-point device-fault flag are one fact about the device, not four hundred
 * points against the collector; summing them would put every productive
 * collector on an old firmware into 'hold'. The evidence of the kept instance
 * says how many others there were and which subjects carried it, so the
 * console can still open every one.
 */
export function rollup(groups: readonly { subjectType: SubjectType; subjectId: string; flags: readonly Flag[] }[]): Flag[] {
  const best = new Map<string, { flag: Flag; carriers: { subjectType: SubjectType; subjectId: string }[] }>();
  for (const g of groups) {
    for (const f of g.flags) {
      if (!isFinding(f)) continue;
      const seen = best.get(f.signalId);
      const carrier = { subjectType: g.subjectType, subjectId: g.subjectId };
      if (seen === undefined) best.set(f.signalId, { flag: f, carriers: [carrier] });
      else {
        seen.carriers.push(carrier);
        if (f.points > seen.flag.points || (f.points === seen.flag.points && f.computedAt > seen.flag.computedAt)) {
          seen.flag = f;
        }
      }
    }
  }
  return [...best.values()]
    .map(({ flag, carriers }) =>
      carriers.length === 1
        ? { ...flag, evidence: { ...flag.evidence, subject: carriers[0] } }
        : {
            ...flag,
            evidence: {
              ...flag.evidence,
              subject: carriers.find((c) => true),
              also_on: carriers.length - 1,
              carriers,
            },
          },
    )
    .sort(byWeight);
}
