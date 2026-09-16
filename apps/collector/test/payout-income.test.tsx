// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { NavProvider } from '../src/nav.tsx';
import { LocaleProvider } from '../src/locale.tsx';
import { Income } from '../src/screens/Income.tsx';
import type { PayoutDestination } from '../src/api/types.ts';
import { MESSAGES, t, type Locale } from '../src/i18n.ts';

vi.mock('react-native', async () => ({ ...await import('react-native-web'), Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? children : null }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));
vi.mock('../src/ui/HeaderGradient.tsx', () => ({ HeaderGradient: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/guide/Guide.tsx', () => ({ useGuideTarget: () => undefined }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The server's verification provenance labels only a verified destination;
 * payment simulation remains its own sentence, printed once. */
const CASES: { name: string; payout: PayoutDestination; shows: ('awaiting' | 'paid' | 'simulation')[] }[] = [
  { name: 'awaiting, no payment', payout: { channel: 'zalopay', status: 'awaiting', masked: '•••• 5678' }, shows: ['awaiting'] },
  { name: 'awaiting with server simulation flags', payout: { channel: 'zalopay', status: 'awaiting', masked: '\u2022\u2022\u2022\u2022 5678', simulation: true, verification_simulation: true }, shows: ['awaiting'] },
  { name: 'sandbox-provider payment', payout: { channel: 'zalopay', status: 'verified', masked: '•••• 5678', simulation: true, payment: { reference: 'SANDBOX-REF-X', amount_vnd: 679 } }, shows: ['paid', 'simulation'] },
  { name: 'sandbox verification beside a real manual transfer', payout: { channel: 'zalopay', status: 'verified', masked: '\u2022\u2022\u2022\u2022 5678', simulation: false, verification_simulation: true, payment: { reference: 'MANUAL-REF-Y', amount_vnd: 679 } }, shows: ['paid'] },
  { name: 'manual transfer recorded by finance', payout: { channel: 'zalopay', status: 'verified', masked: '•••• 5678', simulation: false, payment: { reference: 'MANUAL-REF-Y', amount_vnd: 679 } }, shows: ['paid'] },
  { name: 'no payment, sandbox flag set', payout: { channel: 'zalopay', status: 'none', masked: '•••• 5678', simulation: true, payment: undefined }, shows: [] },
];

const openDestination = async (host: HTMLElement, locale: Locale) => {
  const button = Array.from(host.querySelectorAll<HTMLElement>('[role="button"]'))
    .find(node => node.getAttribute('aria-label') === MESSAGES[locale]['payout.title'])!;
  await act(async () => button.click());
};

it.each(['vi', 'en', 'zh'] as const)('the payout card prints only the server\'s own state, in %s', async locale => {
  for (const testCase of CASES) {
    const api = new MockCollectorApi();
    vi.spyOn(api, 'payout').mockResolvedValue(testCase.payout);
    vi.spyOn(api, 'income').mockResolvedValue([]);
    vi.spyOn(api, 'incomeCycle').mockResolvedValue(null);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale={locale}><NavProvider initial={{ name: 'income' }}><Income /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      await openDestination(host, locale);
      const text = host.textContent ?? '';
      expect(text, testCase.name).toContain('•••• 5678');
      const tagKey = testCase.payout.status === 'verified' ? 'payout.verified' : testCase.payout.status === 'none' ? 'payout.none' : 'payout.awaiting';
      expect(text, testCase.name).toContain(t(locale, tagKey));
      const statusText = t(locale, tagKey);
      const pill = Array.from(host.querySelectorAll('*')).find(node => node.children.length === 0 && node.textContent?.startsWith(statusText));
      const suffix = testCase.payout.status === 'verified' && testCase.payout.verification_simulation ? ` - ${{ vi: 'Mô phỏng', en: 'Sandbox', zh: '模拟' }[locale]}` : '';
      expect(pill?.textContent, testCase.name).toBe(statusText + suffix);
      expect(text.split(t(locale, 'payout.simulation')).length - 1, testCase.name).toBe(testCase.payout.payment && testCase.payout.simulation ? 1 : 0);
      const paid = t(locale, 'payout.paidReference').replace('{reference}', testCase.payout.payment?.reference ?? '');
      for (const [flag, sentence] of [['awaiting', t(locale, 'payout.awaitingPayment')], ['paid', paid], ['simulation', t(locale, 'payout.simulation')]] as const) {
        if (testCase.shows.includes(flag)) expect(text, `${testCase.name} shows ${flag}`).toContain(sentence);
        else expect(text, `${testCase.name} hides ${flag}`).not.toContain(sentence);
      }
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); }
  }
});

// Native illustration rendering is covered by the web captures.
vi.mock('../src/ui/illustrations/index.tsx', () => ({ EmptyTasks: () => null, ErrorMark: () => null }));
