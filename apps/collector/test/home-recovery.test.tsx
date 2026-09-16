// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { NavProvider } from '../src/nav.tsx';
import { LocaleProvider } from '../src/locale.tsx';
import { Home } from '../src/screens/Home.tsx';
import { dong, shortId } from '../src/money.ts';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';

vi.mock('react-native', async () => ({ ...await import('react-native-web'), Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? children : null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));
vi.mock('../src/ui/HeaderGradient.tsx', () => ({ HeaderGradient: ({ children }: { children: ReactNode }) => <section data-testid="home-header-wash">{children}</section> }));
vi.mock('../src/guide/Guide.tsx', () => ({ useGuideTarget: () => undefined, useGuide: () => ({ offered: false, accept() {}, decline() {} }) }));

vi.mock('../src/ui/illustrations/index.tsx', () => ({ EmptyTasks: () => null, ErrorMark: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it.each([false, true])('shows one header error and preserves the cached-data distinction: cached=%s', async cached => {
  const api = new MockCollectorApi();
  await api.register('Cached collector', '0903000001');
  const profile = await api.profile();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) {
    client.setQueryData(['profile'], profile);
    client.setQueryData(['income', 'cycle'], { label: 'Current cycle', confirmedVnd: '9001', estimatedVnd: '801', totalVnd: '9802' });
  }
  vi.spyOn(api, 'profile').mockRejectedValue(new Error('offline'));
  vi.spyOn(api, 'incomeCycle').mockRejectedValue(new Error('offline'));
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    const header = host.querySelector('[data-testid="home-header-wash"]')!.textContent!;
    const message = MESSAGES[DEFAULT_LOCALE][cached ? 'common.refreshFailed' : 'common.loadFailed'];
    expect(header.split(message)).toHaveLength(2);
    expect(header).not.toContain(MESSAGES[DEFAULT_LOCALE][cached ? 'common.loadFailed' : 'common.refreshFailed']);
    if (cached) { expect(header).toContain('Cached collector'); expect(header).toContain(dong('9001')); }
  } finally { await act(async () => root.unmount()); client.clear(); }
});

it('offers the language switch in the Home header and cycles every locale', async () => {
  const api = new MockCollectorApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    for (const locale of ['en', 'zh', 'vi'] as const) {
      const header = host.querySelector('[role="heading"]')!.parentElement!.parentElement!;
      const toggle = [...header.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.getAttribute('aria-label') === `${MESSAGES[locale]['profile.language']} / ${locale.toUpperCase()}`);
      expect(toggle, `language switch visible in ${locale} header`).toBeDefined();
      await act(async () => toggle!.click());
    }
    expect(host.textContent).toContain(MESSAGES.en['home.cycleTitle']);
  } finally { await act(async () => root.unmount()); client.clear(); }
});


it('keeps confirmed cycle and awaiting money neutral because neither proves payment', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'incomeCycle').mockResolvedValue({ label: 'Cycle', confirmedVnd: '9001', estimatedVnd: '801', totalVnd: '9802' });
  vi.spyOn(api, 'income').mockResolvedValue([{ episodeId: 'pending', kind: 'confirmed', amountVnd: '1234', effectiveMinutes: '1', settlementState: 'pending_settlement', simulation: false }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    for (const value of ['9001', '1234']) {
      const amount = [...host.querySelectorAll<HTMLElement>('*')].find(node => !node.children.length && node.textContent === dong(value))!;
      expect(amount.style.color).toBe('rgb(32, 40, 39)');
    }
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});
