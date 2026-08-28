/**
 * A flag on the screen: the sentence first, the numbers under it, the
 * recordings it names beside it. Never the raw media — there is no proxy
 * route on this server, and the screen says so rather than embedding a
 * player somebody could mistake for one.
 */
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { IconAlert } from '../components/icons.tsx';
import { cn } from '../lib/cn.ts';
import type { RiskFlag, RiskSummary } from '../lib/api.ts';
import { when } from '../payout/format.ts';
import { BandPill } from '../payout/pieces.tsx';
import { episodeReferences, flagSentence, severityLabel } from './sentences.ts';

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map(fmt).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export function FlagCard({ flag, compact = false }: { flag: RiskFlag; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const refs = episodeReferences(flag.evidence);
  const strong = flag.severity === 'hold' || flag.severity === 'review';

  return (
    <article className={cn('flex gap-2.5', compact ? 'py-1.5' : 'py-3')}>
      <IconAlert
        size={16}
        className={cn('mt-0.5 shrink-0', strong ? 'text-[var(--sun-600)]' : 'text-[var(--faint-foreground)]')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] leading-snug">{flagSentence(flag, locale)}</p>
        <p className="num mt-1 text-[0.75rem] text-[var(--muted-foreground)]">
          {flag.signalId} · {severityLabel(flag.severity, locale)} · {t('risk.points', { n: flag.points })}
          {compact ? null : <> · {t('risk.threshold', { v: flag.thresholdVersion, at: when(flag.computedAt, locale) })}</>}
        </p>
        {compact ? null : (
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.8125rem] sm:grid-cols-[max-content_minmax(0,1fr)]">
            {Object.entries(flag.evidence).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="num text-[var(--faint-foreground)]">{key}</dt>
                <dd className="num min-w-0 break-words">{fmt(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {!compact && refs.length > 0 ? (
          <p className="mt-2 text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
            {t('risk.references')}: <span className="num text-[var(--foreground)]">{refs.join(', ')}</span>. {t('risk.proxy.none')}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** A bill's summary in brief: band, score, and every sentence. */
export function RiskBlock({
  summary,
  period,
  billId,
  compact = true,
}: {
  summary: RiskSummary;
  period: string;
  billId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <BandPill band={summary.band} />
        <span className="num text-[0.8125rem] text-[var(--muted-foreground)]">
          {t('risk.score')} {summary.score} · {t('risk.flags', { n: summary.flags.length })}
        </span>
        <Link
          to="/risk"
          search={{ period, bill: billId }}
          className="text-[0.8125rem] font-semibold text-[var(--tech-600)]"
        >
          {t('settle.bill.risk.open')}
        </Link>
      </div>
      {summary.flags.length > 0 ? (
        <div className="mt-1 divide-y divide-[var(--border)]">
          {summary.flags.map((f, i) => (
            <FlagCard key={`${f.signalId}-${i}`} flag={f} compact={compact} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
