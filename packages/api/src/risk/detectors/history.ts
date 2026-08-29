import { numParam, strListParam, type Finding, type TuningMap } from '../types.ts';

/**
 * HIST signals: what this collector's own past says.
 *
 * Every other family answers "what is wrong with this thing". These answer
 * "has this happened before to this person", which is the question a per-
 * episode judgement structurally cannot ask. One near-duplicate is a mistake.
 * The fourth one is a method.
 *
 * Two rules govern the weights, and both are deliberate:
 *
 *   History never holds on its own. The two signals sum to 55, and the hold
 *   edge is 60. A collector with a past reaches 'review' — an operator looks —
 *   and reaches 'hold' only when something is also wrong with the work in
 *   front of them. A score that held on history alone would be a score that
 *   punished, and this engine does not punish; it routes to a person.
 *
 *   History never changes pay. docs/reputation.md settles that: a score
 *   changes what is reviewed and what is held, never the rate. Nothing here
 *   is read by `money.ts` and nothing here can be.
 *
 * The inputs are the engine's own flags and its own holds. That is circular on
 * purpose: the past this scores is the past an operator already saw, on the
 * record, with evidence, and not a private tally.
 */

export type HistoryInput = {
  collectorId: string;
  /** Episodes of this collector evaluated in the window, and what was found on them. */
  episodesEvaluated: number;
  /** One row per (episode, signal) at severity review or worse, from `risk_current_flags`. */
  findings: readonly { episodeId: string; signalId: string; family: string }[];
  /** Holds on this collector's bills that an operator cleared with each verdict. */
  clears: readonly { verdict: string; clearedAt: Date; signalIds: readonly string[] }[];
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function historySignals(input: HistoryInput, tuning: TuningMap): Finding[] {
  const out: Finding[] = [];
  const t = (id: string) => {
    const x = tuning.get(id);
    return x?.enabled ? x : null;
  };

  const repeat = t('HIST.REPEAT_CONTENT_FINDINGS');
  if (repeat) {
    const families = new Set(strListParam(repeat, 'families', ['CONT', 'PROV']));
    const max = numParam(repeat, 'max_episodes', 2);
    const hits = input.findings.filter((f) => families.has(f.family));
    const episodes = new Set(hits.map((f) => f.episodeId));
    if (episodes.size > max) {
      // Which signal, how many times: "eleven episodes, all NEAR_DUPLICATE" and
      // "eleven episodes, eleven different faults" are different stories.
      const bySignal: Record<string, number> = {};
      for (const h of hits) bySignal[h.signalId] = (bySignal[h.signalId] ?? 0) + 1;
      out.push({
        signalId: 'HIST.REPEAT_CONTENT_FINDINGS',
        evidence: {
          episodes: episodes.size,
          max_episodes: max,
          episodes_evaluated: input.episodesEvaluated,
          share: input.episodesEvaluated > 0 ? r2(episodes.size / input.episodesEvaluated) : null,
          signals: Object.keys(bySignal).sort(),
          signal_counts: bySignal,
          // Enough for an operator to open a few, not the whole history.
          episode_ids: [...episodes].sort().slice(0, 10),
        },
      });
    }
  }

  const prior = t('HIST.PRIOR_ACCEPTED_HOLDS');
  if (prior) {
    const max = numParam(prior, 'max_accepted', 1);
    const accepted = input.clears.filter((c) => c.verdict === 'accepted');
    if (accepted.length > max) {
      const signals = new Set<string>();
      for (const c of accepted) for (const s of c.signalIds) signals.add(s);
      const last = accepted.reduce((a, b) => (a.clearedAt >= b.clearedAt ? a : b));
      out.push({
        signalId: 'HIST.PRIOR_ACCEPTED_HOLDS',
        evidence: {
          accepted_holds: accepted.length,
          max_accepted: max,
          // For contrast: a collector cleared as a false positive four times is
          // evidence about the thresholds, not about the collector.
          false_positive_clears: input.clears.filter((c) => c.verdict === 'false_positive').length,
          signal_ids: [...signals].sort(),
          last_cleared_at: last.clearedAt.toISOString(),
        },
      });
    }
  }

  return out;
}
