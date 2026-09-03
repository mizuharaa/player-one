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
import { useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';
import { Mark } from '../identity/Mark.tsx';
import { IconClock, IconPace, IconSignOut } from '../icons.tsx';
import { PillNav } from './PillNav.tsx';
import { LocaleSwitch } from './LocaleSwitch.tsx';
import { ThemeSwitch } from './ThemeSwitch.tsx';
import { pace } from '../../lib/format.ts';
import { api, releaseHeld } from '../../lib/api.ts';

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
              /*
                `tech-50` inverts between schemes and `tech-700` does not, so in
                the dark the operator's own initials were 1.80:1 on their own
                chip. The dark scheme takes `tech-200`, which is 10.08:1.
              */
              <span
                className="num ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--tech-50)] text-[0.75rem] font-bold text-[var(--tech-700)] dark:text-[var(--tech-200)]"
                title={operator}
              >
                {operator.slice(0, 2).toUpperCase()}
              </span>
            ) : null}

            <SignOut />
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
 * Leaving the machine.
 *
 * A counter machine is shared and a remote reviewer's workstation may not be,
 * and the session is two `HttpOnly` cookies that script cannot clear — so
 * without a control here the only ways out are waiting for expiry or clearing
 * browser data, and the next person at the desk inherits the session. It is on
 * every screen because the moment somebody wants it is the moment they are
 * standing up.
 *
 * A full reload rather than a router navigation: the point is to leave nothing
 * of the previous operator in memory, and `requireSession` sends the fresh page
 * to sign-in on its own.
 */
function SignOut() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  /**
   * Only leave once the server says the cookies are gone.
   *
   * Redirecting on failure is the dangerous shape: the cookies are `HttpOnly`,
   * so a failed `DELETE` leaves the session valid while the reviewer walks away
   * from a login screen that looks like proof they signed out. On a shared
   * counter machine that is the next person holding their session.
   */
  const leave = async () => {
    setFailed(false);
    /**
     * The lease goes back before the cookies do.
     *
     * Signing out from the review screen used to clear both `HttpOnly` cookies
     * first and let the `pagehide` beacon fire during the navigation that
     * followed — so the release arrived at an authenticated endpoint carrying
     * credentials the server had just invalidated, and the episode stayed
     * leased for the rest of its ten-minute window with nobody watching it.
     * Awaited, and before, is the whole fix.
     */
    await releaseHeld();
    try {
      await api.signOut();
    } catch {
      setFailed(true);
      return;
    }
    window.location.href = '/login';
  };

  return (
    <>
      <button
        type="button"
        title={failed ? t('app.signOutFailed') : t('app.signOut')}
        onClick={leave}
        className={cn(
          /*
            44x44, which is the target size WCAG 2.2 AA asks for and this row
            did not have: the icon controls in this bar were 32px. The glyph is
            unchanged — only the box around it grew — so the bar still reads as
            a bar and a finger still lands on the control it aimed at.
          */
          'ml-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full',
          'transition-colors duration-150 ease-[var(--ease)]',
          failed
            ? 'bg-[var(--reject-bg)] text-[var(--reject-ink)]'
            : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
        )}
      >
        <IconSignOut size={17} />
        <span className="sr-only">{failed ? t('app.signOutFailed') : t('app.signOut')}</span>
      </button>
      {failed ? (
        <p role="alert" className="sr-only">
          {t('app.signOutFailed')}
        </p>
      ) : null}
    </>
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
