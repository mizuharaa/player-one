// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { NavProvider } from '../src/nav.tsx';
import { LocaleProvider } from '../src/locale.tsx';
import { Uploads } from '../src/screens/Uploads.tsx';
import { Income } from '../src/screens/Income.tsx';
import { dong, shortId } from '../src/money.ts';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';

vi.mock('react-native', async () => ({ ...await import('react-native-web'), Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? <div data-testid="modal">{children}</div> : null }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));
vi.mock('../src/ui/HeaderGradient.tsx', () => ({ HeaderGradient: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/guide/Guide.tsx', () => ({ useGuideTarget: () => undefined }));
// The timeline's data model is the behavior under test; native drawing is covered by screenshots.
vi.mock('../src/ui.tsx', async original => ({ ...await original<typeof import('../src/ui.tsx')>(),
  Timeline: ({ steps }: { steps: { key: string; done: boolean; current?: boolean }[] }) => <ol>{steps.map(step => <li key={step.key} data-step={step.key} data-done={step.done} data-current={step.current} />)}</ol>,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it.each(['on_a_bill', null])('preserves server money and timeline evidence for %s', async settlementState => {
  const kind = settlementState === null ? 'estimated' : 'confirmed';
  const api = new MockCollectorApi();
  vi.spyOn(api, 'incomeCycle').mockResolvedValue({ label: 'Current cycle', confirmedVnd: '9001', estimatedVnd: '801', totalVnd: '9802' });
  vi.spyOn(api, 'income').mockResolvedValue([{ episodeId: 'episode-confirmed', kind, amountVnd: '1234', effectiveMinutes: '1.25', settlementState }]);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'income' }}><Income /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(host.textContent).toContain(dong('9001'));
    expect(host.textContent).toContain(dong('9802'));
    expect(host.textContent).toContain(dong('1234'));
    const entry = Array.from(host.querySelectorAll<HTMLElement>('[role="button"]')).find(node => node.getAttribute('aria-label') === `${shortId('episode-confirmed')}. ${MESSAGES[DEFAULT_LOCALE][kind === 'confirmed' ? 'income.confirmed' : 'income.estimated']}`)!;
    await act(async () => entry.click());
    expect(host.querySelector('[data-step="reviewed"]')?.getAttribute('data-done')).toBe(String(kind === 'confirmed'));
    expect(host.querySelector('[data-step="uploaded"]')?.getAttribute('data-done')).toBe(String(settlementState !== null));
    expect(host.querySelector(`[data-step="${settlementState === null ? 'uploaded' : 'paid'}"]`)?.getAttribute('data-current')).toBe('true');
    expect(host.querySelector('[data-step="paid"]')?.getAttribute('data-done')).toBe('false');
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); }
});

it('shows skeletons instead of a zero while server money is pending', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'incomeCycle').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'income').mockResolvedValue([]);
  const host = document.createElement('div'); const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'income' }}><Income /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    expect(host.querySelector('[data-testid="skeleton"]')).not.toBeNull();
    expect(host.textContent).not.toContain(dong('0'));
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});

// Native illustration rendering is covered by the web captures.
vi.mock('../src/ui/illustrations/index.tsx', () => ({ EmptyTasks: () => null, ErrorMark: () => null }));


it('shows one recovery panel when every Income query fails', async () => {
  const api = new MockCollectorApi();
  for (const method of ['income', 'incomeCycle', 'payout'] as const) vi.spyOn(api, method).mockRejectedValue(new Error('offline'));
  const host = document.createElement('div'), root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: 'income' }}><Income /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(host.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(host.textContent?.split(MESSAGES[DEFAULT_LOCALE]['common.loadFailed'])).toHaveLength(2);
    expect(host.textContent).not.toContain(MESSAGES[DEFAULT_LOCALE]['common.actionFailed']);
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});


it.each(['vi', 'en', 'zh'] as const)('labels simulated paid rows, details and cycle in %s', async locale => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'incomeCycle').mockResolvedValue({ label: 'Sandbox cycle', confirmedVnd: '1200', estimatedVnd: '0', totalVnd: '1200', simulation: true });
  vi.spyOn(api, 'income').mockResolvedValue([{ episodeId: 'sandbox-paid', kind: 'confirmed', amountVnd: '1200', effectiveMinutes: '1', settlementState: 'paid', simulation: true }]);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale={locale}><NavProvider initial={{ name: 'income' }}><Income /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const notice = MESSAGES[locale]['payout.simulation'];
    const row = Array.from(host.querySelectorAll<HTMLElement>('[role="button"]')).find(node => node.getAttribute('aria-label')?.startsWith(shortId('sandbox-paid') + '.'))!;
    expect(row.textContent).toContain(notice);
    expect(host.textContent?.split(notice)).toHaveLength(3);
    await act(async () => row.click());
    expect(host.textContent?.split(notice)).toHaveLength(4);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); }
});

it.each(['vi', 'en', 'zh'] as const)('keeps nonpayable zero neutral in the income row and detail in %s', async locale => {
  for (const settlementState of ['not_paid', 'cannot_be_paid'] as const) {
    const api = new MockCollectorApi();
    vi.spyOn(api, 'incomeCycle').mockResolvedValue(null);
    vi.spyOn(api, 'income').mockResolvedValue([{ episodeId: 'rejected', kind: 'confirmed', amountVnd: '0.0000', effectiveMinutes: '0', settlementState }]);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale={locale}><NavProvider initial={{ name: 'income' }}><Income /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
      const row = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.getAttribute('aria-label')?.startsWith('rejected.'))!;
      expect(row.getAttribute('aria-label')).toContain(MESSAGES[locale][`settlement.${settlementState}`]);
      expect(row.textContent).not.toContain(MESSAGES[locale]['income.confirmed']);
      const neutralMoney = (parent: HTMLElement) => {
        const amounts = [...parent.querySelectorAll<HTMLElement>('*')].filter(node => !node.children.length && node.textContent === dong('0.0000'));
        expect(amounts.length).toBeGreaterThan(0);
        for (const amount of amounts) expect(amount.style.color).toBe('rgb(81, 75, 99)');
      };
      neutralMoney(row);
      await act(async () => row.click());
      neutralMoney(host);
      expect(host.querySelector('[data-testid="modal"]')!.textContent).not.toContain(MESSAGES[locale]['income.confirmed']);
      expect(host.querySelector('[data-step="reviewed"]')?.getAttribute('data-done')).toBe('true');
      expect(host.querySelector('[data-step="paid"]')?.getAttribute('data-done')).toBe('false');
      expect(host.querySelector('[data-step="paid"]')?.getAttribute('data-current')).toBe('false');
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); }
  }
});

vi.mock('../src/upload/delivery-native.ts', () => ({ nativeDeliveryStore: { get: async () => null }, nativeTransport: {}, pickSessionDirectory: vi.fn(), hashSession: vi.fn() }));
it.each(['vi', 'en', 'zh'] as const)('keeps the failed-review Uploads row neutral in %s', async locale => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'episodes').mockResolvedValue([{ episodeId: 'rejected', sessionId: 'session', sizeBytes: 10, state: 'review_failed' }]);
  vi.spyOn(api, 'income').mockResolvedValue([{ episodeId: 'rejected', kind: 'confirmed', amountVnd: '0.0000', effectiveMinutes: '0', settlementState: null }]);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale={locale}><NavProvider initial={{ name: 'uploads' }}><Uploads /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const row = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.getAttribute('aria-label')?.startsWith('rejected.'))!;
    expect(row.textContent).toContain(MESSAGES[locale]['settlement.not_paid']);
    expect(row.textContent).not.toContain(MESSAGES[locale]['income.confirmed']);
    const money = [...row.querySelectorAll<HTMLElement>('*')].find(node => !node.children.length && node.textContent === dong('0.0000'))!;
    expect(money.style.color).toBe('rgb(81, 75, 99)');
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); }
});


it.each(['income', 'uploads'] as const)('uses green only for a nonzero live payment in %s', async screen => {
  for (const [settlementState, amountVnd, simulation, paid] of [
    ['pending_settlement', '1234', false, false],
    ['paid', '0.0000', false, false],
    ['paid', '1234', true, false],
    ['paid', '1234', undefined, false],
    ['paid', '1234', false, true],
    ['manually_paid', '1234', false, true],
  ] as const) {
    const api = new MockCollectorApi();
    vi.spyOn(api, 'incomeCycle').mockResolvedValue(null);
    vi.spyOn(api, 'episodes').mockResolvedValue([{ episodeId: 'payment', sessionId: 'session', sizeBytes: 10, state: 'review_passed' }]);
    vi.spyOn(api, 'income').mockResolvedValue([{ episodeId: 'payment', kind: 'confirmed', amountVnd, effectiveMinutes: '1', settlementState, simulation }]);
    const host = document.createElement('div'), root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const assertMoney = (scope: HTMLElement) => {
      const amount = [...scope.querySelectorAll<HTMLElement>('*')].find(node => !node.children.length && node.textContent === dong(amountVnd))!;
      expect(amount.style.color, `${settlementState}/${amountVnd}/simulation=${simulation}`).toBe(paid ? 'rgb(8, 122, 56)' : 'rgb(81, 75, 99)');
    };
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider><NavProvider initial={{ name: screen }}>{screen === 'income' ? <Income /> : <Uploads />}</NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
      const row = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.getAttribute('aria-label')?.startsWith('payment.'))!;
      assertMoney(row);
      if (screen === 'income') {
        await act(async () => row.click());
        assertMoney(host.querySelector<HTMLElement>('[data-testid="modal"]')!);
      }
    } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
  }
});
