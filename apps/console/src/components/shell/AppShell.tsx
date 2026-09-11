import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConsoleLogo } from './ConsoleLogo.tsx';
import { IconGuide } from '../icons.tsx';
import { Panda } from '../identity/Panda.tsx';
import { Guide } from '../guide/Guide.tsx';
import { useGuide } from '../guide/useGuide.ts';
import { PillNav } from './PillNav.tsx';
import { OperatorAvatar } from './OperatorAvatar.tsx';
import { LocaleSwitch } from './LocaleSwitch.tsx';
import { useOperatorProfile, signOut } from '../../lib/profile-api.ts';
import { pace } from '../../lib/format.ts';
import '../../styles/operations.css';
import '../../styles/workspace.css';

/** Anchored navigation and one work surface. The compact dialog preserves
 * native focus trapping and stops keyboard events before review shortcuts. */
export function AppShell({ children, queueDepth, averageSeconds, operator, bleed = false }: {
  children: ReactNode; queueDepth?: number | null; averageSeconds?: number | null;
  operator?: string | null; bleed?: boolean;
}) {
  const { t } = useTranslation();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { start, available } = useGuide();
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 959px)').matches);
  const [menuOpen, setMenuOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const onReview = path.startsWith('/review');
  // A PLT-10 reviewer is intentionally excluded by the new operator endpoint.
  // Review already provides its own real reference through the operator prop.
  const session = useQuery({ queryKey: ['shell-session'], enabled: onReview, retry: false, queryFn: async () => {
    const response = await fetch('/whoami', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('session_unavailable');
    return await response.json() as { role: string; reviewer_id?: string };
  } });
  const reviewer = session.data?.role === 'reviewer';
  const profile = useOperatorProfile(!onReview || session.data?.role === 'operator');
  const identity = reviewer && onReview ? undefined : profile.data?.operator;
  const name = identity?.external_ref ?? operator ?? session.data?.reviewer_id;
  const tourHere = available(path);
  const shell=useRef<HTMLDivElement>(null);const tourDock=useRef<HTMLDivElement>(null);
  const pageKey=path==='/profile'?'workspace.profile':path.startsWith('/engineering')?'workspace.engineering':path.startsWith('/showcase')?'workspace.showcase':path.startsWith('/settle/preflight')?'settle.tab.preflight':path.startsWith('/settle/exceptions')?'settle.tab.exceptions':path.startsWith('/settle/bills')?'settle.tab.bills':path.startsWith('/settle')?'nav.settle':path.startsWith('/risk')?'settle.tab.flags':path.startsWith('/backoffice')?'nav.backoffice':path.startsWith('/pipeline')?'nav.pipeline':path.startsWith('/counter')?'nav.counter':path.startsWith('/episodes')?'nav.episodes':onReview?'nav.review':'nav.home';
  useLayoutEffect(()=>{const node=tourDock.current;if(!node||!shell.current)return;const measure=()=>shell.current?.style.setProperty('--workspace-help-reserve',`${node.getBoundingClientRect().height}px`);measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[tourHere]);

  useEffect(() => {
    const media = matchMedia('(max-width: 959px)');
    const update = () => { setCompact(media.matches); setMenuOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setMenuOpen(false); }, [path]);
  useEffect(() => {
    const dialog = drawer.current;
    if (!dialog) return;
    if (menuOpen && compact && !dialog.open) dialog.showModal();
    else if (!menuOpen && dialog.open) dialog.close();
  }, [menuOpen, compact]);

  const leave = async () => {
    setLeaving(true); setSignOutFailed(false);
    try { await signOut(); client.clear(); window.location.assign('/login'); }
    catch { setLeaving(false); setSignOutFailed(true); }
  };
  const profileEntry = onReview && session.data?.role !== 'operator' ? <div className="workspace-reviewer-account">
    <div className="workspace-profile-link"><OperatorAvatar reference={name} /><span><strong>{name || t('workspace.reviewer')}</strong><span>{t('workspace.reviewer')}</span></span></div>
    <button type="button" className="workspace-button workspace-button-signout" disabled={leaving} onClick={() => void leave()}>{t(leaving ? 'workspace.signingOut' : 'workspace.signOut')}</button>
    {signOutFailed ? <p role="alert" className="workspace-inline-notice">{t('workspace.signOutError')}</p> : null}
  </div> : <Link to="/profile" className="workspace-profile-link" aria-current={path === '/profile' ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
    <OperatorAvatar id={identity?.id} reference={name} /><span><strong>{name || t('workspace.profile')}</strong><span>{t('workspace.profile')}</span></span>
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m7 4 6 6-6 6" /></svg>
  </Link>;
  const navigation = <>
    <Link to="/" className="ops-brand workspace-brand" aria-label={t('workspace.homeLink')}><ConsoleLogo /></Link>
    <div className="workspace-language"><span>{t('app.language')}</span><LocaleSwitch /></div>
    {identity?.centre ? <div className="workspace-centre"><strong>{identity.centre.name}</strong><span>{identity.centre.region}</span></div> : null}
    <PillNav current={path} showcase={Boolean(identity)} administrator={identity?.role==='administrator'&&identity.status==='active'} onNavigate={() => setMenuOpen(false)} />
    <div className="workspace-sidebar-bottom">
      {profileEntry}
    </div>
  </>;

  return <div ref={shell} className="ops-world workspace-shell">
    <a href="#workspace" className="ops-skip">{t('ops.skip')}</a>
    {compact ? <header className="workspace-mobile-bar">
      <Link to="/" className="ops-brand" aria-label={t('workspace.homeLink')}><ConsoleLogo /></Link>
      <div className="workspace-mobile-controls"><LocaleSwitch />
      <button type="button" className="workspace-button" aria-label={t('ops.menu')} aria-haspopup="dialog" aria-expanded={menuOpen}
        aria-controls="workspace-navigation" onClick={() => setMenuOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
      </button>
      </div>
    </header> : <aside className="workspace-sidebar" aria-label={t('ops.navigation')}>{navigation}</aside>}
    {compact ? <dialog id="workspace-navigation" ref={drawer} className="ops-drawer workspace-navigation-dialog" aria-label={t('ops.navigation')}
      onKeyDown={(event) => event.stopPropagation()} onClose={() => setMenuOpen(false)}>
      <button type="button" className="workspace-button workspace-close-drawer" onClick={() => setMenuOpen(false)}>{t('ops.close')}</button>
      {navigation}
    </dialog> : null}
    <div className="workspace-body">
      {(typeof queueDepth === 'number' || averageSeconds != null) ? <div className="workspace-route-counters" data-guide="shell.counters">
        {typeof queueDepth === 'number' ? <span>{t('queue.depth')} <strong className="num">{queueDepth}</strong></span> : null}
        {averageSeconds != null ? <span>{t('queue.average')} <strong className="num">{pace(averageSeconds)}</strong></span> : null}
      </div> : null}
      <main id="workspace" data-guide="workspace.page" tabIndex={-1} className={bleed ? 'ops-main ops-main-bleed' : 'ops-main'}>{children}</main>
    </div>
    {tourHere?<div ref={tourDock} className="workspace-tour-dock"><button type="button" data-guide="shell.guide" className="workspace-tour-trigger" aria-label={t('workspace.pageTourLabel',{page:t(pageKey)})} onClick={()=>start(path)}><span aria-hidden="true">{onReview?<IconGuide size={28}/>:<Panda size={40} state="dayShift"/>}</span><span><strong>{t('workspace.pageTour')}</strong><span>{t(pageKey)}</span></span><span aria-hidden="true">↗</span></button></div>:null}
    <Guide pathname={path} pageName={t(pageKey)} />
  </div>;
}
