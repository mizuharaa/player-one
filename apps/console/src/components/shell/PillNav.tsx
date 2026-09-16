import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
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
  { to: '/showcase', key: 'workspace.showcase', Icon: IconEpisodes, built: true },
  { to: '/episodes', key: 'nav.episodes', Icon: IconEpisodes, built: true },
  { to: '/settle', key: 'nav.settle', Icon: IconSettle, built: true },
  { to: '/backoffice', key: 'nav.backoffice', Icon: IconBackOffice, built: true },
  { to: '/pipeline', key: 'nav.pipeline', Icon: IconPipeline, built: true },
  { to: '/engineering', key: 'workspace.engineering', Icon: IconPipeline, built: true },
];

/**
 * What a role can actually reach, and nothing else.
 *
 * The server already refuses the rest — a reviewer is scoped to the review
 * lane (`requireActor` and the router's own redirect), and finance is not an
 * administrator, so every shaping route in the back office answers 403 with
 * `operators_admin_role_required`. Showing those items anyway made the console
 * lie about what it would accept: measured 2026-09-16, finance could open
 * Counter, Review, Demo studio, Episodes and Back office, where New task,
 * Edit, Take down, qualification, exam and the device controls were all
 * enabled; a reviewer saw six items that each bounced silently back to
 * `/review`.
 *
 * A role with no entry here — `administrator`, `centre_operator` — gets the
 * whole list, and so does a session whose role has not loaded: hiding
 * navigation because a profile request was slow or failed would be a worse
 * lie than showing one item too many.
 */
const ROLE_SCOPE: Record<string, readonly string[]> = {
  reviewer: ['/review'],
  finance: ['/', '/settle'],
};

export function PillNav({ current, onNavigate, showcase = false, administrator = false, role }: { current: string; onNavigate?: () => void; showcase?: boolean; administrator?: boolean; role?: string }) {
  const { t } = useTranslation();
  const scope = role === undefined ? undefined : ROLE_SCOPE[role];
  return <nav data-guide="shell.nav" className="ops-shell-nav" aria-label={t('ops.navigation')}>
    {DESTINATIONS.filter(({to})=>(to!=='/showcase'||showcase)&&(to!=='/engineering'||administrator)&&(scope===undefined||scope.includes(to))).map(({ to, key, Icon, built }) => {
      const here = to === '/' ? current === '/' : current.startsWith(to);
      return <div className="workspace-nav-item" key={to}>
        {to === '/' || to === '/backoffice' ? <p className="workspace-nav-heading">{t(to === '/' ? 'workspace.workspace' : 'workspace.management')}</p> : null}
        <Link to={to} onClick={onNavigate} aria-current={here ? 'page' : undefined}>
        <Icon size={18} />
        <span>{t(key)}</span>
        {built === 'partial' ? <IconPartialBuilt size={13} aria-hidden="true" />
          : built === false ? <span aria-hidden="true">·</span> : null}
      </Link></div>;
    })}
  </nav>;
}
