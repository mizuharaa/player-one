// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { Income } from '../src/screens/Income.tsx';
import { t } from '../src/i18n.ts';

vi.mock('react-native', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span>, View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../src/guide/Guide.tsx', () => ({ useGuideTarget: () => undefined }));
vi.mock('../src/ui.tsx', () => ({ Tag: ({ label }: { label: string }) => <span>{label}</span>, Timeline: () => null }));
vi.mock('../src/v2.tsx', () => ({
  textStyle: () => ({}), ScreenTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  WarmList: ({ header }: { header: ReactNode }) => <main>{header}</main>,
  EmptyState: () => null, LoadFailed: () => null, Skeleton: () => null, StaleStrip: () => null, WarmCard: () => null,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('Income renders the declared unverified destination from its payout read', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'payout').mockResolvedValue({ channel: 'zalopay', status: 'awaiting', masked: '•••• 5678' });
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
      expect(node.textContent).toContain(t('vi', 'payout.awaiting'));
    });
  } finally { await act(async () => root.unmount()); client.clear(); }
});
