/**
 * Every flag as one plain sentence, in the reader's language.
 *
 * The templates live in the catalogue under `risk.signal.<SIGNAL_ID>`, in
 * every locale, and are the same templates the risk engine renders
 * server-side (`packages/api/src/risk/sentences.ts`): `{key}` is filled from
 * the flag's evidence, `{key_pct}` renders a 0-1 fraction as a percentage, a
 * list is comma-separated, and a missing value renders as `?` rather than
 * throwing — a sentence with a gap is still more useful to an operator than
 * nothing. Single braces on purpose: i18next interpolates `{{ }}`, so these
 * templates pass through `t()` untouched and are filled here.
 *
 * Why render on the client at all: the payout batch route carries the raw
 * §2.3 summary, without sentences. When a summary arrives through the
 * engine's own routes it carries `sentence` per locale, and that is preferred.
 *
 * An unknown signal renders its id and evidence rather than nothing. The
 * evidence table under every sentence is always rendered too, so a flag is
 * explainable even when its wording is not in the catalogue yet.
 */
import { MESSAGES, type Locale } from '@playerone/api/i18n';
import type { RiskBand, RiskFlag, RiskSeverity } from '../lib/api.ts';

export const BAND_ORDER: Record<RiskBand, number> = { clear: 0, notice: 1, review: 2, hold: 3 };
export const SEVERITY_ORDER: Record<RiskSeverity, number> = { info: 0, notice: 1, review: 2, hold: 3 };

const catalogue = (locale: string): Record<string, string> =>
  (MESSAGES[(locale in MESSAGES ? locale : 'en') as Locale] as unknown as Record<string, string>);

const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map(formatValue).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Fills a template from evidence. Pure. */
export function render(template: string, evidence: Record<string, unknown>): string {
  return template.replace(/\{([a-z0-9_]+)\}/g, (_, key: string) => {
    if (key.endsWith('_pct')) {
      const base = evidence[key.slice(0, -4)];
      if (typeof base === 'number' && Number.isFinite(base)) return `${Math.round(base * 100)}%`;
      const direct = evidence[key];
      return direct === undefined ? '?' : formatValue(direct);
    }
    return formatValue(evidence[key]);
  });
}

/** Whether the catalogue has wording for this signal. */
export const hasTemplate = (signalId: string): boolean => `risk.signal.${signalId}` in MESSAGES.en;

/** The one sentence for a flag. */
export function flagSentence(
  flag: Pick<RiskFlag, 'signalId' | 'evidence' | 'sentence'>,
  locale: string,
): string {
  const served = flag.sentence?.[locale];
  if (typeof served === 'string' && served.trim() !== '') return served;
  const template = catalogue(locale)[`risk.signal.${flag.signalId}`];
  if (template === undefined) {
    const pairs = Object.entries(flag.evidence)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join('; ');
    return pairs === '' ? flag.signalId : `${flag.signalId}: ${pairs}`;
  }
  return render(template, flag.evidence);
}

export const bandLabel = (band: RiskBand, locale: string): string =>
  catalogue(locale)[`risk.band.${band}`] ?? band;

export const severityLabel = (severity: RiskSeverity, locale: string): string =>
  catalogue(locale)[`risk.severity.${severity}`] ?? severity;

/**
 * Evidence keys that name a recording, so a screen can show them as
 * references beside the sentence. There is no proxy-clip route on this
 * server; the reference is what an operator would look up.
 */
export function episodeReferences(evidence: Record<string, unknown>): string[] {
  const refs: string[] = [];
  for (const [key, value] of Object.entries(evidence)) {
    if (!/episode/i.test(key)) continue;
    if (typeof value === 'string' && value !== '') refs.push(value);
    if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') refs.push(v);
  }
  return [...new Set(refs)];
}
