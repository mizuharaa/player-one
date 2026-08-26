import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, type Route } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import type { MessageKey } from '../i18n.ts';
import { Button, Note, Screen } from '../ui.tsx';

/**
 * The hub. Every screen is one tap from here, and the two gates that shape
 * the collector's day (exam, device) are stated rather than discovered.
 */
export function Home() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const { locale, setLocale } = useLocale();

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });

  const links: { key: MessageKey; route: Route }[] = [
    { key: 'home.tasks', route: { name: 'taskHall' } },
    { key: 'home.myTasks', route: { name: 'myTasks' } },
    { key: 'home.devices', route: { name: 'devices' } },
    { key: 'home.session', route: { name: 'sessionCreate' } },
    { key: 'home.uploads', route: { name: 'uploads' } },
    { key: 'home.income', route: { name: 'income' } },
    { key: 'home.training', route: { name: 'training' } },
  ];

  return (
    <Screen title={tt('app.name')}>
      {profile.data !== undefined && profile.data !== null && !profile.data.examPassed ? (
        <Note text={tt('home.gateExam')} />
      ) : null}
      {devices.data !== undefined && devices.data.length === 0 ? (
        <Note text={tt('home.gateDevice')} />
      ) : null}
      {links.map((l) => (
        <Button key={l.key} kind="ghost" label={tt(l.key)} onPress={() => nav.push(l.route)} />
      ))}
      <Button
        kind="ghost"
        label={tt('common.language')}
        onPress={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
      />
    </Screen>
  );
}
