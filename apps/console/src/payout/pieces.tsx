/**
 * The small shared pieces of the settle screens: the frame with the period
 * bar and the sub-navigation, the pills for risk band and attempt state, the
 * issue list, the table bits, and the read-only line.
 *
 * Two rules from DESIGN.md are load-bearing here and worth stating once:
 *
 * The three verdict hues are reserved for verdicts. A risk band is not a
 * verdict, so it is never green, violet or red. The bands climb in *weight*
 * instead — muted, then the data blue, then the action orange, then inverted
 * — and each carries its word and a filled-dot glyph, so the axis reads
 * without colour at all. Nobody is paid or not paid on a colour here.
 *
 * Every action is rendered for everybody. A session without the finance role
 * sees the button disabled and the reason beside it, never a blank space.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button } from '../components/ui/button.tsx';
import { Problem, Skeleton } from '../components/ui/primitives.tsx';
import { IconAlert } from '../components/icons.tsx';
import { cn } from '../lib/cn.ts';
import { ApiError, type AttemptStatus, type PayoutIssue, type PayoutMode, type RiskBand, type VerifyStatus } from '../lib/api.ts';
import { bandLabel } from '../risk/sentences.ts';
import { isPeriod } from './period.ts';
import { refusalKey } from './refusals.ts';
import { readOnlyReason, useFinanceRole } from './role.ts';

export type SettleTab = 'bills' | 'preflight' | 'flags' | 'exceptions';

/** Where each tab lives; the bill screen sits under `bills`. */
const TAB_TO: Record<SettleTab, '/settle' | '/settle/preflight' | '/risk' | '/settle/exceptions'> = {
  bills: '/settle',
  preflight: '/settle/preflight',
  flags: '/risk',
  exceptions: '/settle/exceptions',
};
const TABS: SettleTab[] = ['bills', 'preflight', 'flags', 'exceptions'];

export function SettleShell({
  period,
  tab,
  mode,
  children,
}: {
  period: string;
  tab: SettleTab;
  mode?: PayoutMode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(period);
  const { role, isPending } = useFinanceRole();
  const reason = readOnlyReason(role);

  return (
    <AppShell>
      <header className="border-b border-[var(--foreground)] pb-5">
        <h1 className="text-[2.0625rem] font-extrabold leading-[1.12] tracking-[-0.03em]">
          {t('settle.title')}
        </h1>
        <p className="mt-3 max-w-[62ch] text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
          {t('settle.intro')}
        </p>
      </header>

      <form
        data-guide="settle.period"
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPeriod(draft)) return;
          void navigate({ to: TAB_TO[tab], search: { period: draft } });
        }}
      >
        <label className="block">
          {/* Block, so the label sits above its field. As an inline span it ran
              straight into the date input's left edge — "Kỳ bắt đầu từ" had its
              last letter behind the box — and it was the only label on these
              screens not stacked over its value. */}
          <span className={cn(LABEL, 'block')}>{t('settle.period')}</span>
          <input
            type="date"
            name="period"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={cn(INPUT, 'w-[12rem]')}
            required
          />
        </label>
        <Button type="submit" variant="outline" disabled={!isPeriod(draft) || draft === period}>
          {t('settle.period.apply')}
        </Button>
        <p className="basis-full text-[0.8125rem] leading-snug text-[var(--muted-foreground)] sm:basis-auto sm:self-center">
          {t('settle.period.hint')}
        </p>
      </form>

      <nav className="mt-5 flex flex-wrap items-center gap-1" aria-label={t('settle.title')}>
        {TABS.map((name) => (
          <Link
            key={name}
            to={TAB_TO[name]}
            search={{ period }}
            aria-current={tab === name ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 text-[0.9375rem] font-semibold no-underline',
              'transition-colors duration-150 ease-[var(--ease)]',
              tab === name
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            {t(`settle.tab.${name}`)}
          </Link>
        ))}
      </nav>

      <div className="mt-4 space-y-2">
        {mode ? (
          <p className="text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
            {t(`settle.mode.${mode}`)}
          </p>
        ) : null}
        {!isPending && reason ? (
          <p
            className="flex items-start gap-2 rounded-[var(--radius-base)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[0.8125rem] leading-snug"
            role="status"
          >
            <IconAlert size={16} className="mt-0.5 shrink-0 text-[var(--sun-600)]" />
            <span>
              <strong className="font-semibold">{t('settle.readonly')}.</strong> {t(reason)}
            </span>
          </p>
        ) : null}
      </div>

      <div className="mt-6">{children}</div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------
   Pills. Word and glyph always; colour is the third channel.
   ---------------------------------------------------------------------- */

const BAND_STYLE: Record<RiskBand, { pill: string; dots: number }> = {
  clear: { pill: 'bg-[var(--muted)] text-[var(--muted-foreground)]', dots: 0 },
  notice: { pill: 'bg-[var(--tech-50)] text-[var(--tech-700)]', dots: 1 },
  review: { pill: 'bg-[var(--sun-50)] text-[var(--sun-700)]', dots: 2 },
  hold: { pill: 'bg-[var(--foreground)] text-[var(--background)]', dots: 3 },
};

export function BandPill({ band, size = 'md' }: { band: RiskBand; size?: 'sm' | 'md' }) {
  const { i18n } = useTranslation();
  const style = BAND_STYLE[band];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-[0.75rem]' : 'px-2.5 py-1 text-[0.8125rem]',
        style.pill,
      )}
    >
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 w-1.5 rounded-full border border-current',
              i < style.dots ? 'bg-current' : 'bg-transparent',
            )}
          />
        ))}
      </span>
      {bandLabel(band, i18n.language)}
    </span>
  );
}

/** Attempt states as words. `succeeded` is not green: the verdict hues are reserved. */
const ATTEMPT_STYLE: Record<AttemptStatus | 'none', string> = {
  none: 'bg-[var(--muted)] text-[var(--faint-foreground)]',
  created: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  submitted: 'bg-[var(--tech-50)] text-[var(--tech-700)]',
  processing: 'bg-[var(--tech-50)] text-[var(--tech-700)]',
  unknown: 'bg-[var(--sun-50)] text-[var(--sun-700)]',
  pending_zlp: 'bg-[var(--sun-50)] text-[var(--sun-700)]',
  succeeded: 'bg-[var(--foreground)] text-[var(--background)]',
  failed: 'border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)]',
};

export function AttemptPill({ status }: { status: AttemptStatus | null | undefined }) {
  const { t } = useTranslation();
  const key = status ?? 'none';
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[0.8125rem] font-semibold',
        ATTEMPT_STYLE[key],
      )}
    >
      {t(`settle.attempt.${key}`)}
    </span>
  );
}

export function VerifyPill({ status }: { status: VerifyStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[0.8125rem] font-semibold',
        status === 'verified'
          ? 'bg-[var(--foreground)] text-[var(--background)]'
          : 'border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)]',
      )}
    >
      {t(`settle.verify.${status}`)}
    </span>
  );
}

/** What stands between a bill and a transfer, one sentence each. */
export function IssueList({ issues, className }: { issues: PayoutIssue[]; className?: string }) {
  const { t } = useTranslation();
  if (issues.length === 0) {
    return <p className={cn('text-[0.875rem] text-[var(--muted-foreground)]', className)}>{t('settle.issue.none')}</p>;
  }
  return (
    <ul className={cn('space-y-1.5', className)}>
      {issues.map((issue) => (
        <li key={issue} className="flex gap-2 text-[0.875rem] leading-snug">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-[var(--sun-600)]" />
          <span>{t(`settle.issue.${issue}`)}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------
   Layout bits. The table scrolls inside its own container; the page never
   scrolls sideways.
   ---------------------------------------------------------------------- */

/**
 * A label above a value.
 *
 * It was a tracked uppercase eyebrow, and it sat above every figure, every
 * field and every section on five screens. One named kicker is a system; an
 * eyebrow on everything is grammar nobody chose, and at 12px tracked caps a
 * Vietnamese label with two marks on one vowel is the hardest line on the
 * page to read. Sentence case, at the body's own size, in the muted ink.
 */
export const LABEL = 'text-[0.8125rem] font-semibold text-[var(--muted-foreground)]';
export const INPUT =
  'mt-1 h-10 w-full rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-[0.9375rem]';

/**
 * A table on paper: hairlines, no card, no shadow.
 *
 * A shadowed rounded container around a column of figures adds nothing the
 * operator scanning that column can use, and four of them stacked down a
 * settlement screen is the panel grid this console refuses. The rule under
 * the head is ink; the rules between rows are hairlines. It still scrolls
 * inside its own box so the page never scrolls sideways.
 */
export function Table({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('px-3 pb-2 text-[0.8125rem] font-semibold text-[var(--muted-foreground)]', className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ className, children }: { className?: string; children: ReactNode }) {
  return <td className={cn('px-3 py-2.5 align-top text-[0.875rem]', className)}>{children}</td>;
}

/** A label above a server figure. Mono, tabular: these are read in columns. */
export function Fig({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'warn' | 'data';
}) {
  return (
    <div className="min-w-0">
      <p className={LABEL}>{label}</p>
      <p
        className={cn(
          'num mt-0.5 text-[1.3125rem] font-medium tracking-[-0.02em]',
          tone === 'warn' ? 'text-[var(--sun-700)]' : tone === 'data' ? 'text-[var(--tech-600)]' : '',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

/**
 * The one ink block a screen is allowed.
 *
 * `.feature-block` is `stage.ground` — the same near-black as the top bar and
 * the review theatre, because the console has one dark and reuses it rather
 * than owning two that nearly match. The rule for using it is narrow and it is
 * the reason this is not a "stat card": a figure earns the ink only when it
 * carries **its sentence and its action**. A big number with a small label and
 * an accent underneath is the template this refuses, and one of these per
 * screen is the ceiling.
 */
export function FeatureBlock({
  label,
  figure,
  sentence,
  action,
  className,
  ...rest
}: {
  label: ReactNode;
  figure: ReactNode;
  sentence: ReactNode;
  action?: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'feature-block px-5 py-5 ring-1 ring-[var(--stage-line)] sm:px-6',
        className,
      )}
      {...rest}
    >
      <p className="text-[0.8125rem] font-semibold text-[var(--stage-mid)]">{label}</p>
      <p className="figure mt-1 text-[var(--stage-fg)]">{figure}</p>
      <p className="mt-2 max-w-[54ch] text-[0.875rem] leading-relaxed text-[var(--stage-mid)]">
        {sentence}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A section heading inside a panel. */
export function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="border-b border-[var(--border-strong)] pb-1 text-[0.8125rem] font-semibold text-[var(--foreground)]">
        {title}
      </h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  ...rest
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input {...rest} className={INPUT} />
      {hint ? <span className="mt-1 block text-[0.75rem] leading-snug text-[var(--muted-foreground)]">{hint}</span> : null}
    </label>
  );
}

export function Select({
  label,
  options,
  ...rest
}: { label: string; options: { value: string; label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <select {...rest} className={INPUT}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A disabled action carries its reason in the DOM, not in a tooltip nobody
 * with a keyboard reaches: the button names it through `aria-describedby`
 * and the line is printed beside it.
 */
export function Reason({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
      {children}
    </p>
  );
}

/** The shape a table is about to take: the same ink rule, five rows of it. */
export function TableSkeleton() {
  return (
    <div className="border-t border-[var(--foreground)] pt-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="mb-2 h-9 w-full last:mb-0" />
      ))}
    </div>
  );
}

export function LoadFailed({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return <Problem title={t('settle.loadFailed')} body={t('settle.loadFailed.body')} reference={error instanceof ApiError ? error.ref : undefined} />;
}

export function RefusedBanner({ error, onDismiss }: { error: unknown; onDismiss: () => void }) {
  const { t } = useTranslation();
  if (error === null) return null;
  return (
    <div className="mb-5">
      <Problem
        title={t('bo.refused')}
        body={t(refusalKey(error))}
        reference={error instanceof ApiError ? error.ref : undefined}
        action={
          <Button variant="outline" size="sm" onClick={onDismiss}>
            {t('bo.cancel')}
          </Button>
        }
      />
    </div>
  );
}
