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

vi.mock('../src/ui/illustrations/index.tsx', () => ({ AvatarMark: () => null, EmptyTasks: () => null, ErrorMark: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it.each([false, true])('preserves cached identity and earnings while reporting a read failure: cached=%s', async cached => {
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
    expect(host.textContent).toContain(message);
    expect(header).not.toContain(MESSAGES[DEFAULT_LOCALE][cached ? 'common.loadFailed' : 'common.refreshFailed']);
    if (cached) {
      expect(header).toContain('Cached collector'); expect(host.textContent).toContain(dong('9001'));
      const earnings = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.textContent?.includes(dong('9001')))!;
      expect(earnings.getAttribute('aria-label')).toBeNull();
      expect(earnings.textContent).toContain(MESSAGES[DEFAULT_LOCALE]['income.confirmed']);
      expect(earnings.textContent).toContain(message);
    }
  } finally { await act(async () => root.unmount()); client.clear(); }
});

it('offers the language switch in Home utilities and cycles every locale', async () => {
  const api = new MockCollectorApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    for (const locale of ['en', 'zh', 'vi'] as const) {
      const header = host;
      const toggle = [...header.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.getAttribute('aria-label') === `${MESSAGES[locale]['profile.language']} / ${locale.toUpperCase()}`);
      expect(toggle, `language switch visible in ${locale} header`).toBeDefined();
      await act(async () => toggle!.click());
    }
    expect(host.textContent).toContain(MESSAGES.en['home.cycleTitle']);
  } finally { await act(async () => root.unmount()); client.clear(); }
});


it.each([false, true])('keeps confirmed cycle and awaiting money neutral and discloses entry simulation=%s independently', async simulation => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'incomeCycle').mockResolvedValue({ label: 'Cycle', confirmedVnd: '9001', estimatedVnd: '801', totalVnd: '9802', simulation: false });
  vi.spyOn(api, 'income').mockResolvedValue([{ episodeId: 'pending', kind: 'confirmed', amountVnd: '1234', effectiveMinutes: '1', settlementState: 'pending_settlement', simulation }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    for (const value of ['9001', '1234']) {
      const amount = [...host.querySelectorAll<HTMLElement>('*')].find(node => !node.children.length && node.textContent === dong(value))!;
      expect(amount.style.color).toBe('rgb(43, 33, 48)');
    }
    expect(host.textContent?.includes(MESSAGES[DEFAULT_LOCALE]['payout.simulation'])).toBe(simulation);
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});

it('does not report empty devices, sessions or payments when their reads fail', async () => {
  const api = new MockCollectorApi();
  for (const method of ['boundDevices', 'sessions', 'income'] as const) vi.spyOn(api, method).mockRejectedValue(new Error('offline'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    for (const key of ['session.needDevice', 'home.noSessionToday', 'home.noAwaiting'] as const) expect(host.textContent).not.toContain(MESSAGES[DEFAULT_LOCALE][key]);
    expect(host.textContent).toContain(MESSAGES[DEFAULT_LOCALE]['common.loadFailed']);
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});

it.each([false, true])('guides collection-centre onboarding before training: onboarded=%s', async onboarded => {
  const api = new MockCollectorApi({ onboarded });
  await api.register('New collector', '0903000001');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(host.textContent?.includes(MESSAGES[DEFAULT_LOCALE]['detail.needOnboarding'])).toBe(!onboarded);
    expect(host.textContent?.includes(MESSAGES[DEFAULT_LOCALE]['home.readinessBody'])).toBe(onboarded);
    if (onboarded) {
      const card = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.textContent?.includes(MESSAGES[DEFAULT_LOCALE]['home.readinessBody']))!;
      expect(card.getAttribute('aria-label')).toBeNull();
    }
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});

it('does not attach a profile read failure to successfully loaded earnings', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'profile').mockRejectedValue(new Error('offline'));
  vi.spyOn(api, 'incomeCycle').mockResolvedValue({ label: 'Current cycle', confirmedVnd: '9001', estimatedVnd: '0', totalVnd: '9001' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    const earnings = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.textContent?.includes(dong('9001')))!;
    expect(earnings.textContent).not.toContain(MESSAGES[DEFAULT_LOCALE]['common.loadFailed']);
    expect(host.textContent).toContain(MESSAGES[DEFAULT_LOCALE]['common.loadFailed']);
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});


it('uses actual claims and only submitted or under-review recordings for the two status tiles', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'myClaims').mockResolvedValue([{ id: 'claim-one', taskId: 'task-cook', claimedAt: '2026-09-26' }, { id: 'claim-two', taskId: 'task-warehouse', claimedAt: '2026-09-26' }]);
  vi.spyOn(api, 'episodes').mockResolvedValue([
    { episodeId: 'submitted', sessionId: 's1', sizeBytes: 10, state: 'uploaded' },
    { episodeId: 'reviewed', sessionId: 's2', sizeBytes: 10, state: 'review_passed' },
    { episodeId: 'draft', sessionId: 's3', sizeBytes: 10, state: 'pending_upload' },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const tiles = [...host.querySelectorAll<HTMLElement>('[data-testid="home-header-wash"] [role="button"]')];
    const tasks = tiles.find(node => node.textContent?.includes(MESSAGES[DEFAULT_LOCALE]['home.myTasks']))!;
    const review = tiles.find(node => node.textContent?.includes(MESSAGES[DEFAULT_LOCALE]['home.awaitingReview']))!;
    expect(tasks.textContent).toContain('2');
    expect(review.textContent).toContain('1');
    expect(review.textContent).not.toContain('3');
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});

it.each([
  { state: 'success', viaTask: true },
  { state: 'success', viaTask: false },
  { state: 'pending', viaTask: true },
  { state: 'error', viaTask: true },
])('keeps claimed tasks first and never guesses Open: %j', async ({ state, viaTask }) => {
  const api = new MockCollectorApi();
  const seed = (await api.tasks())[0]!;
  vi.spyOn(api, 'tasks').mockResolvedValue([
    { ...seed, id: 'unclaimed', title: 'Unclaimed row', claimable: true, claimedByMe: false },
    { ...seed, id: 'claimed', title: 'Claimed row', claimable: false, claimedByMe: viaTask },
  ]);
  const claims = vi.spyOn(api, 'myClaims');
  if (state === 'pending') claims.mockImplementation(() => new Promise(() => {}));
  else if (state === 'error') claims.mockRejectedValue(new Error('offline'));
  else claims.mockResolvedValue(viaTask ? [] : [{ id: 'claim-one', taskId: 'claimed', claimedAt: '2026-09-26' }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'home' }}><Home /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await vi.waitFor(() => expect(host.textContent).toContain('Claimed row'));
    const rows = [...host.querySelectorAll<HTMLElement>('[role="button"]')].filter(node => /^(Claimed|Unclaimed) row\./.test(node.getAttribute('aria-label') ?? ''));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Claimed row');
    expect(rows[0]!.textContent).toContain(MESSAGES[DEFAULT_LOCALE]['detail.claimed']);
    expect(rows[0]!.textContent).not.toContain(MESSAGES[DEFAULT_LOCALE]['hall.open']);
    expect(rows[1]!.textContent?.includes(MESSAGES[DEFAULT_LOCALE]['hall.open'])).toBe(state === 'success');
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});
