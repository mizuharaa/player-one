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
  { to: '/episodes', key: 'nav.episodes', Icon: IconEpisodes, built: 'partial' },
  { to: '/settle', key: 'nav.settle', Icon: IconSettle, built: true },
  { to: '/backoffice', key: 'nav.backoffice', Icon: IconBackOffice, built: true },
  { to: '/pipeline', key: 'nav.pipeline', Icon: IconPipeline, built: true },
  { to: '/engineering', key: 'workspace.engineering', Icon: IconPipeline, built: true },
];

export function PillNav({ current, onNavigate, showcase = false, administrator = false }: { current: string; onNavigate?: () => void; showcase?: boolean; administrator?: boolean }) {
  const { t } = useTranslation();
  return <nav data-guide="shell.nav" className="ops-shell-nav" aria-label={t('ops.navigation')}>
    {DESTINATIONS.filter(({to})=>(to!=='/showcase'||showcase)&&(to!=='/engineering'||administrator)).map(({ to, key, Icon, built }) => {
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
