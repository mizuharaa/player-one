/**
 * The seven destinations, as pills on the ink bar.
 *
 * One of them does not have a finished screen behind it, and it appears
 * anyway, marked, rather than being hidden until it exists. A back office that
 * shows only what is finished teaches an operator a false map of the product
 * and then moves the furniture later; showing the whole shape with honest
 * states is how nobody clicks into a dead link.
 *
 * **The marks say which state a destination is in.** `/episodes` is partly
 * built — the attention scopes exist, BO-05's full browse does not — and
 * carries `IconPartialBuilt`, a half-filled square. It is emphatically **not**
 * `IconPartial`, which is a verdict glyph: a payment symbol in the navigation
 * is one glance from meaning something about money. `/counter` carried a plain
 * dot while it was a stub; the intake wizard is built against BO-10's two
 * endpoints, so the dot is gone. The `false` case stays in the type because
 * the next honest stub will want it.
 *
 * `aria-current="page"` rather than styling alone, so the active destination is
 * announced and not merely coloured. The label is `aria-label` as well as
 * visible text, because below `lg` the text is `display: none` and an icon has
 * no accessible name — every link in the row announced as "link" on a phone.
 *
 * The bar is ink in both themes, so the pills are written against near-black
 * and not against the scheme: the active one is a sun fill with ink type
 * (7.19:1, measured in `contrast.test.ts`), and the rest are white held back to
 * 72% (9.96:1 composited) which comes up to full white on hover.
 */
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn.ts';
import {
  IconCounter,
  IconEpisodes,
  IconHome,
  IconBackOffice,
  IconPartialBuilt,
  IconPipeline,
  IconReview,
  IconSettle,
} from '../icons.tsx';

type Destination = {
  to: string;
  key: string;
  Icon: typeof IconHome;
  /** `true` routes to a screen; `partial` to a screen that is honest about its scope. */
  built: true | 'partial' | false;
};

const DESTINATIONS: Destination[] = [
  { to: '/', key: 'nav.home', Icon: IconHome, built: true },
  { to: '/counter', key: 'nav.counter', Icon: IconCounter, built: true },
  { to: '/review', key: 'nav.review', Icon: IconReview, built: true },
  { to: '/episodes', key: 'nav.episodes', Icon: IconEpisodes, built: 'partial' },
  { to: '/settle', key: 'nav.settle', Icon: IconSettle, built: true },
  { to: '/backoffice', key: 'nav.backoffice', Icon: IconBackOffice, built: true },
  { to: '/pipeline', key: 'nav.pipeline', Icon: IconPipeline, built: true },
];

export function PillNav({ current }: { current: string }) {
  const { t } = useTranslation();
  const active = useRef<HTMLAnchorElement>(null);

  /*
   * The row scrolls horizontally on a narrow screen and does not scroll itself:
   * an operator on `/pipeline` at 390px saw Home and Counter and had no way of
   * knowing where they were. `nearest` so the page itself never jumps.
   */
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  return (
    <nav
      data-guide="shell.nav"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Sections"
    >
      {DESTINATIONS.map(({ to, key, Icon, built }) => {
        const here = to === '/' ? current === '/' : current.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            ref={here ? active : undefined}
            aria-current={here ? 'page' : undefined}
            aria-label={t(key)}
            title={t(key)}
            className={cn(
              'group inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.875rem] font-semibold no-underline',
              'transition-colors duration-150 ease-[var(--ease)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              here
                ? 'bg-[var(--action)] text-[var(--action-ink)] hover:opacity-90 active:opacity-95'
                : 'text-white/72 hover:bg-white/10 hover:text-white active:bg-white/16',
            )}
          >
            <Icon size={17} />
            <span className="hidden lg:inline">{t(key)}</span>
            {built === 'partial' ? (
              <IconPartialBuilt size={13} aria-hidden="true" className="opacity-80" />
            ) : built === false ? (
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
