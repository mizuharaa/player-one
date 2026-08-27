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
  IconBackOffice,
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
  { to: '/settle', key: 'nav.settle', Icon: IconSettle, built: true },
  { to: '/backoffice', key: 'nav.backoffice', Icon: IconBackOffice, built: true },
  { to: '/pipeline', key: 'nav.pipeline', Icon: IconPipeline, built: true },
];

export function PillNav({ current }: { current: string }) {
  const { t } = useTranslation();

  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Sections">
      {DESTINATIONS.map(({ to, key, Icon, built }) => {
        const active = to === '/' ? current === '/' : current.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.875rem] font-semibold no-underline',
              'transition-colors duration-150 ease-[var(--ease)]',
              active
                ? 'bg-[var(--sun-50)] text-[var(--sun-700)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            <Icon size={17} className={active ? 'text-[var(--sun-600)]' : ''} />
            <span className="hidden lg:inline">{t(key)}</span>
            {/* A destination that exists but has no screen says so before the click. */}
            {!built ? (
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--border-strong)]"
                aria-hidden="true"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
