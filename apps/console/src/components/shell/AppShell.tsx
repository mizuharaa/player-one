/**
 * The frame every screen renders into.
 *
 * The composition is deliberate and is the one thing an admin console usually
 * gets wrong: there is **no left sidebar**. A sidebar spends 220px of every
 * screen on navigation that a reviewer uses twice a shift, and the object under
 * review here is a wide video. So navigation is a pill row in the top bar, the
 * live counters sit beside it, and the whole width below belongs to the task.
 *
 * The counters in the bar — queue depth and pace — are there because reviewer
 * throughput is the programme's ceiling. At 40,000 hours every second per
 * episode multiplies by tens of thousands, so the two numbers that describe
 * that are never more than a glance away, on every screen.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { Mark } from '../identity/Mark.tsx';
import { IconClock, IconPace } from '../icons.tsx';
import { PillNav } from './PillNav.tsx';
import { LocaleSwitch } from './LocaleSwitch.tsx';
import { ThemeSwitch } from './ThemeSwitch.tsx';
import { pace } from '../../lib/format.ts';

export function AppShell({
  children,
  queueDepth,
  averageSeconds,
  operator,
  /** Review runs edge-to-edge on the stage; everything else gets a measure. */
  bleed = false,
}: {
  children: ReactNode;
  queueDepth?: number | null;
  averageSeconds?: number | null;
  operator?: string | null;
  bleed?: boolean;
}) {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--surface)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/92 backdrop-blur-md">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 no-underline"
            aria-label="PlayerOne"
          >
            <Mark size={26} />
            <span className="hidden text-[1.0625rem] font-extrabold tracking-[-0.02em] text-[var(--foreground)] sm:inline">
              PlayerOne
            </span>
          </Link>

          <PillNav current={path} />

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {typeof queueDepth === 'number' ? (
              <Counter
                icon={<IconClock size={15} />}
                value={String(queueDepth)}
                label={t('queue.depth')}
              />
            ) : null}
            {averageSeconds !== null && averageSeconds !== undefined ? (
              <Counter
                icon={<IconPace size={15} />}
                value={pace(averageSeconds)}
                label={t('queue.average')}
              />
            ) : null}

            <span className="mx-1 hidden h-6 w-px bg-[var(--border)] sm:block" />

            <LocaleSwitch />
            <ThemeSwitch />

            {operator ? (
              <span
                className="num ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--tech-50)] text-[0.75rem] font-bold text-[var(--tech-700)]"
                title={operator}
              >
                {operator.slice(0, 2).toUpperCase()}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className={cn('flex-1', bleed ? '' : 'mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6')}>
        {children}
      </main>
    </div>
  );
}

/**
 * A live figure in the bar.
 *
 * The label is a `title` and a screen-reader string rather than visible text:
 * at 14px in a crowded bar, "In queue 42" reads as noise where "42" beside a
 * clock reads instantly, and the icon carries the meaning for anyone who has
 * seen the screen twice.
 */
function Counter({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full bg-[var(--muted)] px-2.5 py-1 text-[var(--muted-foreground)] md:inline-flex"
      title={label}
    >
      {icon}
      <span className="num text-[0.8125rem] font-semibold text-[var(--foreground)]">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
