/**
 * The five destinations, as pills.
 *
 * Two of them — Counter and Episodes — have no screen yet, and one — Settle —
 * has only a settlement row behind it. They appear anyway, marked, rather than
 * being hidden until they exist. A back office that shows only what is finished
 * teaches an operator a false map of the product and then moves the furniture
 * later; showing the whole shape with honest states is how the demo tells a
 * story and how nobody clicks into a dead link.
 *
 * `aria-current="page"` rather than styling alone, so the active destination is
 * announced and not merely coloured.
 */
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn.ts';
import {
  IconCounter,
  IconEpisodes,
  IconHome,
  IconPipeline,
  IconReview,
  IconSettle,
} from '../icons.tsx';

type Destination = {
  to: string;
  key: string;
  Icon: typeof IconHome;
  /** Built screens route; the rest land on an honest "next" page. */
  built: boolean;
};

const DESTINATIONS: Destination[] = [
  { to: '/', key: 'nav.home', Icon: IconHome, built: true },
  { to: '/counter', key: 'nav.counter', Icon: IconCounter, built: false },
  { to: '/review', key: 'nav.review', Icon: IconReview, built: true },
  { to: '/episodes', key: 'nav.episodes', Icon: IconEpisodes, built: false },
  { to: '/settle', key: 'nav.settle', Icon: IconSettle, built: false },
  { to: '/pipeline', key: 'nav.pipeline', Icon: IconPipeline, built: true },
];

export function PillNav({ current }: { current: string }) {
  const { t } = useTranslation();

  return (
    <nav
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label={t('nav.sections')}
    >
      {DESTINATIONS.map(({ to, key, Icon, built }) => {
        const active = to === '/' ? current === '/' : current.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              /*
                `min-h-11 min-w-11`, not more padding: these pills were about
                33px tall and WCAG 2.2 AA asks 44 for a target. Padding that
                large would push six pills past the width of a 390px phone,
                where the row already scrolls; a minimum box grows the hit area
                without moving the text, and the row keeps its own scroll.
              */
              'group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[0.875rem] font-semibold no-underline',
              'transition-colors duration-150 ease-[var(--ease)]',
              /*
                `sun-700` is a light-theme ink. On the dark tint it measures
                3.32:1 and this is the label of the screen you are on, so the
                dark scheme steps up the ramp instead: 9.45:1.
              */
              active
                ? 'bg-[var(--sun-50)] text-[var(--sun-700)] dark:text-[var(--sun-300)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            <Icon size={17} className={active ? 'text-[var(--sun-600)]' : ''} />
            {/*
              `sr-only` rather than `hidden` below `lg`: the label is the only
              accessible name these links have — the icons are `aria-hidden`
              decoration — so hiding it left five pills announced as nothing at
              all on every viewport under 1024px, which is the counter machine.
            */}
            <span className="sr-only lg:not-sr-only">{t(key)}</span>
            {/* A destination that exists but has no screen says so before the click. */}
            {!built ? (
              <>
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--border-strong)]"
                  aria-hidden="true"
                />
                {/* The dot is the whole message. Said in words for anyone who cannot see it. */}
                <span className="sr-only">{t('nav.notBuilt')}</span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
