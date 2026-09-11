/** An operator's own identity, browser preferences and recorded-action history.
 * The calendar renders the API's 84 dated counts; it invents no activity. */
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { OperatorAvatar, saveOperatorAvatar, useOperatorAvatar } from '../components/shell/OperatorAvatar.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { Skeleton } from '../components/ui/primitives.tsx';
import { useOperatorProfile, signOut, type OperatorProfile } from '../lib/profile-api.ts';
import { QueryFailure } from './Home.tsx';

type Theme = 'light' | 'dark' | 'system';
function storedTheme(): Theme {
  try { const value = localStorage.getItem('playerone.theme'); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return 'system'; }
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const profile = useOperatorProfile();
  const client = useQueryClient();
  const identity = profile.data?.operator;
  const photo = useOperatorAvatar(identity?.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const changeTheme = (value: Theme) => {
    try {
      if (value === 'system') { localStorage.removeItem('playerone.theme'); document.documentElement.removeAttribute('data-theme'); }
      else { localStorage.setItem('playerone.theme', value); document.documentElement.setAttribute('data-theme', value); }
      setTheme(value); setPreferenceError(null);
    } catch { setPreferenceError('workspace.storageError'); }
  };
  const changePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !identity) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size >= 1024 * 1024) { setPreferenceError('workspace.photoError'); return; }
    setPhotoBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      // A MIME label is not evidence the bytes decode as an image.
      await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(); image.onerror = reject; image.src = data; });
      saveOperatorAvatar(identity.id, data); setPreferenceError(null);
    } catch { setPreferenceError('workspace.storageError'); }
    finally { setPhotoBusy(false); }
  };
  const leave = async () => {
    setLeaving(true); setSignOutFailed(false);
    try { await signOut(); client.clear(); window.location.assign('/login'); }
    catch { setSignOutFailed(true); setLeaving(false); }
  };

  return <AppShell operator={identity?.external_ref}>
    <div className="workspace-page workspace-profile-page">
      <header className="workspace-page-header"><div><h1>{t('workspace.profile')}</h1><p>{t('workspace.profileNote')}</p></div>
        <button type="button" className="workspace-button" disabled={profile.isFetching} onClick={() => void profile.refetch()}>{t(profile.isFetching ? 'workspace.refreshing' : 'workspace.refresh')}</button>
      </header>
      {profile.isError ? <QueryFailure error={profile.error} cached={!!profile.data} busy={profile.isFetching} retry={() => void profile.refetch()} /> : null}

      <section className="workspace-section" aria-labelledby="account-title">
        <div className="workspace-section-heading"><div><h2 id="account-title">{t('workspace.identity')}</h2><p>{t('workspace.identityReadOnly')}</p></div></div>
        {profile.isPending ? <div className="workspace-rows-loading"><Skeleton className="h-20 w-full" /><Skeleton className="h-10 w-full" /></div> : identity ? <div className="workspace-identity">
          <OperatorAvatar id={identity.id} reference={identity.external_ref} large />
          <dl>
            <div><dt>{t('workspace.operator')}</dt><dd>{identity.external_ref}</dd></div>
            <div><dt>{t('workspace.role')}</dt><dd>{t(`workspace.${identity.role}`, { defaultValue: identity.role })}</dd></div>
            <div><dt>{t('workspace.centre')}</dt><dd>{identity.centre?.name ?? t('workspace.noCentre')}</dd></div>
            <div><dt>{t('workspace.region')}</dt><dd>{identity.centre?.region ?? '—'}</dd></div>
            <div><dt>{t('workspace.status')}</dt><dd>{t(`workspace.${identity.status}`, { defaultValue: identity.status })}</dd></div>
          </dl>
        </div> : <div className="workspace-empty"><p>{t('workspace.unknownIdentity')}</p></div>}
      </section>

      <section className="workspace-section" aria-labelledby="activity-title">
        <div className="workspace-section-heading"><div><h2 id="activity-title">{t('workspace.activity')}</h2><p>{t('workspace.activityScope')}</p></div></div>
        {profile.isPending ? <div className="workspace-rows-loading"><Skeleton className="h-40 w-full" /></div> : profile.data ? <ActivityCalendar activity={profile.data.activity} />
          : <div className="workspace-empty"><p>{t('workspace.unavailable')}</p></div>}
        {profile.isError && profile.data ? <p className="workspace-inline-notice">{t('workspace.refreshFailed')}</p> : null}
      </section>

      <section className="workspace-section" aria-labelledby="preferences-title">
        <div className="workspace-section-heading"><h2 id="preferences-title">{t('workspace.preferences')}</h2></div>
        {preferenceError ? <p role="alert" className="workspace-inline-notice">{t(preferenceError)}</p> : null}
        <div className="workspace-setting-row"><div><label htmlFor="workspace-theme">{t('workspace.appearance')}</label><p>{t('workspace.appearanceNote')}</p></div>
          <select id="workspace-theme" className="workspace-select" value={theme} onChange={(event) => changeTheme(event.target.value as Theme)}>
            {(['light', 'dark', 'system'] as const).map((value) => <option key={value} value={value}>{t(`workspace.${value}`)}</option>)}
          </select></div>
        <div className="workspace-setting-row"><div><h3>{t('workspace.language')}</h3><p>{t('workspace.languageNote')}</p></div><LocaleSwitch /></div>
        <div className="workspace-setting-row"><div><h3>{t('workspace.photo')}</h3><p>{t('workspace.photoNote')}</p></div>
          <div className="workspace-actions"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void changePhoto(event)} />
            <button type="button" className="workspace-button" disabled={!identity || photoBusy} onClick={() => fileInput.current?.click()}>{t(photoBusy ? 'workspace.loading' : 'workspace.choosePhoto')}</button>
            {photo && identity ? <button type="button" className="workspace-button" onClick={() => { try { saveOperatorAvatar(identity.id, null); setPreferenceError(null); } catch { setPreferenceError('workspace.storageError'); } }}>{t('workspace.resetPhoto')}</button> : null}
          </div></div>
      </section>
      <section className="workspace-signout"><div><h2>{t('workspace.signOut')}</h2><p>{t('workspace.signOutNote')}</p>{signOutFailed ? <p role="alert">{t('workspace.signOutError')}</p> : null}</div>
        <button type="button" className="workspace-button workspace-button-signout" disabled={leaving} onClick={() => void leave()}>{t(leaving ? 'workspace.signingOut' : 'workspace.signOut')}</button></section>
    </div>
  </AppShell>;
}

function ActivityCalendar({ activity }: { activity: OperatorProfile['activity'] }) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState<string | null>(null);
  const selected = activity.days.find((day) => day.date === selection) ?? activity.days.at(-1);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const firstDay = activity.days[0];
  const padding = firstDay ? new Date(`${firstDay.date}T12:00:00Z`).getUTCDay() : 0;
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = ({ ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 } as Record<string, number>)[event.key];
    let next = delta === undefined ? undefined : index + delta;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = activity.days.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    next = Math.max(0, Math.min(activity.days.length - 1, next));
    const day = activity.days[next];
    if (day) { setSelection(day.date); buttons.current[next]?.focus(); }
  };
  return <div className="workspace-activity-body">
    <div className="workspace-activity-summary"><strong>{t('workspace.activitySummary', { count: activity.total_actions, days: activity.active_days })}</strong>
      <p>{t('workspace.activityRange', { from: date(activity.from), to: date(activity.to), timezone: activity.timezone })}</p></div>
    <p id="calendar-help" className="workspace-calendar-help">{t('workspace.calendarHelp')}</p>
    <div className="workspace-calendar-scroll" role="region" aria-label={t('workspace.activity')} tabIndex={0}><div className="workspace-calendar" aria-describedby="calendar-help" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil((padding + activity.days.length) / 7))}, minmax(0, 1fr))` }}>
      {Array.from({ length: padding }, (_, index) => <span key={`pad-${index}`} aria-hidden="true" />)}
      {activity.days.map((day, index) => <button type="button" key={day.date} ref={(element) => { buttons.current[index] = element; }}
        className="workspace-calendar-day" data-level={day.count === 0 ? 0 : day.count < 3 ? 1 : day.count < 6 ? 2 : day.count < 10 ? 3 : 4}
        aria-label={t('workspace.dayActions', { date: date(day.date), count: day.count })} aria-pressed={day.date === selected?.date}
        title={t('workspace.dayActions', { date: date(day.date), count: day.count })} tabIndex={day.date === selected?.date ? 0 : -1}
        onClick={() => setSelection(day.date)} onKeyDown={(event) => move(event, index)} />)}
    </div></div>
    <div className="workspace-calendar-footer"><p aria-live="polite">{selected ? <><span>{date(selected.date)}</span><strong>{t('workspace.actionsCount', { count: selected.count })}</strong></> : t('workspace.activityEmpty')}</p>
      <div className="workspace-calendar-legend" aria-hidden="true"><span>{t('workspace.fewer')}</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>{t('workspace.more')}</span></div>
    </div>
    {activity.total_actions === 0 ? <p className="workspace-activity-empty">{t('workspace.activityEmpty')} {t('workspace.activityEmptyNote')}</p> : null}
  </div>;
}
