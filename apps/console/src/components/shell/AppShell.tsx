/**
 * The frame every screen renders into.
 *
 * The composition is deliberate and is the one thing an admin console usually
 * gets wrong: there is **no left sidebar**. A sidebar spends 220px of every
 * screen on navigation that a reviewer uses twice a shift, and the object under
 * review here is a wide video. So navigation is a pill row in the top bar, the
 * live counters sit beside it, and the whole width below belongs to the task.
 *
 * **The bar is ink.** `--stage`, the same near-black as the region around the
 * footage — the console has one dark and reuses it rather than owning two that
 * nearly match. That does three things at once: it puts a hard horizontal edge
 * at the top of a white paper page, so the page reads as paper rather than as a
 * browser default; it gives the sun pill somewhere to be the brightest thing on
 * the screen without competing with a primary button below it; and it holds
 * still when the operator flips the theme, so the one piece of furniture that
 * is on every screen is the one piece that never moves.
 *
 * The counters in the bar — queue depth and pace — are there because reviewer
 * throughput is the programme's ceiling. At 40,000 hours every second per
 * episode multiplies by tens of thousands, so the two numbers that describe
 * that are never more than a glance away, on every screen.
 *
 * The shell also owns the guided tour: the trigger sits in the bar, the dialog
 * is mounted here so it exists on every route, and the one-time offer appears
 * on Home and on Home only.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { Mark } from '../identity/Mark.tsx';
import { IconClock, IconGuide, IconPace } from '../icons.tsx';
import { Guide } from '../guide/Guide.tsx';
import { guideOffered, markGuideOffered, useGuide } from '../guide/useGuide.ts';
import { PillNav } from './PillNav.tsx';
import { LocaleSwitch } from './LocaleSwitch.tsx';
import { ThemeSwitch } from './ThemeSwitch.tsx';
import { Button } from '../ui/button.tsx';
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
  const { start, available } = useGuide();
  const [offer, setOffer] = useState(() => !guideOffered());

  const tourHere = available(path);
  const showOffer = offer && path === '/' && tourHere;

  const dismissOffer = () => {
    markGuideOffered();
    setOffer(false);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--surface)]">
      <header className="on-stage sticky top-0 z-30 border-b border-[var(--stage-line)]">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 text-white no-underline hover:text-white"
            aria-label="PlayerOne"
          >
            <Mark size={26} />
            <span className="hidden text-[1.0625rem] font-extrabold tracking-[-0.02em] sm:inline">
              PlayerOne
            </span>
          </Link>

          <PillNav current={path} />

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <span data-guide="shell.counters" className="flex items-center gap-1.5">
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
            </span>

            <span className="mx-1 hidden h-6 w-px bg-white/20 sm:block" />

            {/*
              While the one-time offer is on screen the bar trigger is hidden:
              two controls saying "Show me around" in one viewport is one of
              them being ignored. The trigger takes over the moment the strip
              is dismissed, and stays for good.
            */}
            {tourHere && !showOffer ? (
              <button
                type="button"
                data-guide="shell.guide"
                onClick={() => {
                  dismissOffer();
                  start(path);
                }}
                title={t('guide.start')}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-semibold',
                  'text-white/72 transition-colors duration-150 ease-[var(--ease)]',
                  'hover:bg-white/10 hover:text-white active:bg-white/16',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sun-400)]',
                  'disabled:pointer-events-none disabled:opacity-45',
                )}
              >
                <IconGuide size={17} />
                <span className="hidden xl:inline">{t('guide.start')}</span>
              </button>
            ) : null}

            <LocaleSwitch />
            <ThemeSwitch />

            {operator ? (
              <span
                className="num ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/12 text-[0.75rem] font-bold text-white"
                title={operator}
              >
                {operator.slice(0, 2).toUpperCase()}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/*
        The offer. Home only, once per browser, and it is a strip rather than a
        modal: an operator who came here to work should not have to dismiss a
        dialog before they can. Both buttons say what they do; "Not now" is the
        recovery and it never comes back.
      */}
      {showOffer ? (
        <div className="border-b border-[var(--border)] bg-[var(--bamboo-50)]">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
            <p className="min-w-0 flex-1 text-[0.875rem] text-[var(--bamboo-ink)]">
              {t('guide.offer')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                dismissOffer();
                start(path);
              }}
            >
              {t('guide.offer.accept')}
            </Button>
            <Button variant="ghost" size="sm" onClick={dismissOffer}>
              {t('guide.offer.decline')}
            </Button>
          </div>
        </div>
      ) : null}

      <main className={cn('flex-1', bleed ? '' : 'mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6')}>
        {children}
      </main>

      <Guide pathname={path} />
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
      className="hidden items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-white/72 md:inline-flex"
      title={label}
    >
      {icon}
      <span className="num text-[0.8125rem] font-semibold text-white">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
