/**
 * The risk engine's public surface. Advisory, explainable, append-only,
 * versioned; see the module comments and packages/store/drizzle/0014_risk.sql.
 *
 *   RiskSummary / Flag      the frozen seam (brief §2.3)
 *   RiskEngine              evaluate a collector, episode, bill or batch
 *   tick                    one worker pass, for bin/
 *   registerRisk            the HTTP routes, for buildApi
 *   billHold / currentHolds what Agent B reads before creating a payout attempt
 *   sentence / RISK_MESSAGES the plain sentences, en / zh / vi
 */

export type { Band, Evidence, Flag, RiskSummary, Severity, SubjectType, Tuning } from './types.ts';
export { RISK_CATALOGUE, CATALOGUE_VERSION, SIGNAL_IDS, SYNTHETIC_SIGNAL, EVALUATED_SIGNAL, seedRiskSignals, loadTuning, bandsFrom, retuneSignal, tuningHistory } from './catalogue.ts';
export { bandFor, bandOf, isFinding, rollup, scoreOf, severityOf, summarise, SCORE_CAP } from './scoring.ts';
export { RISK_LOCALES, RISK_MESSAGES, bandLabel, missingRiskKeys, placeholdersOf, render, sentence, type RiskLocale, type RiskMessageKey } from './sentences.ts';
export { RiskEngine, RiskBusy, batchId, currentFlags, lastEvaluatedAt, type Evaluation, type RiskEngineOptions } from './engine.ts';
export { tick, type TickOptions, type TickResult } from './worker.ts';
export { registerRisk, shapeFlag, shapeSummary } from './routes.ts';
export { billHold, currentHolds, holdHistory, clearHold, raiseHold, NoOpenHold, CLEAR_VERDICTS, type ClearVerdict, type HoldRow } from './holds.ts';
export { falsePositiveReport, FALSE_POSITIVE_BUDGET, type FalsePositiveReport } from './report.ts';
export { riskConfigFromEnv, type RiskConfig } from './config.ts';
export { namesMatch, nameTokens } from './detectors/ident.ts';
export { measureEpisodeMedia, streamFiles, type MediaOptions, type MediaTools } from './media.ts';
