// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { Income } from '../src/screens/Income.tsx';
import { t } from '../src/i18n.ts';
const language = vi.hoisted(() => ({ value: 'vi' as 'vi' | 'en' | 'zh' }));
vi.mock('../src/locale.tsx', () => ({ useT: () => (key: Parameters<typeof t>[1]) => t(language.value, key) }));

vi.mock('react-native', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span>, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../src/guide/Guide.tsx', () => ({ useGuideTarget: () => undefined }));
vi.mock('../src/ui.tsx', () => ({ Tag: ({ label }: { label: string }) => <span>{label}</span>, Timeline: () => null }));
vi.mock('../src/v2.tsx', () => ({
  textStyle: () => ({}), ScreenTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  WarmList: ({ header, refresh }: { header: ReactNode; refresh: { onRefresh: () => void } }) => <main>{header}<button onClick={refresh.onRefresh}>Refresh</button></main>,
  EmptyState: () => null, LoadFailed: () => null, Skeleton: () => null, StaleStrip: () => null, WarmCard: () => null,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it.each(['vi', 'en', 'zh'] as const)('Income renders awaiting and paid sentences in %s after fresh reads', async (locale) => {
  language.value = locale;
  for (const paid of [false, true]) {
    const api = new MockCollectorApi();
    vi.spyOn(api, 'payout').mockResolvedValue({ channel: 'zalopay', status: paid ? 'verified' : 'awaiting', masked: '•••• 5678', ...(paid ? { simulation: true, payment: { reference: 'SIMULATION-REF-X', amount_vnd: 679 } } : {}) });
    vi.spyOn(api, 'income').mockResolvedValue([]);
    vi.spyOn(api, 'incomeCycle').mockResolvedValue(null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const node = document.createElement('div');
    const root = createRoot(node);
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><Income /></ApiProvider></QueryClientProvider>));
      await vi.waitFor(async () => {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        expect(node.textContent).toContain('•••• 5678');
        expect(node.textContent).toContain(t(locale, paid ? 'payout.verified' : 'payout.awaiting'));
        if (paid) {
          expect(node.textContent).toContain(t(locale, 'payout.paidReference').replace('{reference}', 'SIMULATION-REF-X'));
          expect(node.textContent).toContain(t(locale, 'payout.simulation'));
        } else expect(node.textContent).toContain({ en: 'Awaiting payment — destination unverified', vi: 'Chờ thanh toán. Nơi nhận tiền chưa xác minh.', zh: '待付款，收款账户尚未验证。' }[locale]);
      });
      if (!paid) {
        vi.mocked(api.payout).mockResolvedValue({ channel: 'zalopay', status: 'verified', masked: '•••• 5678', simulation: true, payment: { reference: 'SIMULATION-REF-X', amount_vnd: 679 } });
        await act(async () => node.querySelector('button')!.click());
        await vi.waitFor(async () => {
          await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
          expect(node.textContent).toContain('SIMULATION-REF-X');
          expect(node.textContent).toContain(t(locale, 'payout.simulation'));
        });
      }
    } finally { await act(async () => root.unmount()); client.clear(); }
  }
});
