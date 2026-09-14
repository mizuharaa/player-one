// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { BillScreen } from './BillScreen.tsx';
import { keys } from './period.ts';

vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({ period: '2026-08-17' }), useParams: () => ({ billId: 'demo' }), useNavigate: () => () => {}, Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key }) }));
vi.mock('./role.ts', () => ({ useFinanceRole: () => ({ role: 'finance' }), readOnlyReason: () => null }));
vi.mock('./PreflightScreen.tsx', () => ({ useGate: () => ({ gate: { open: false }, snapshot: null, fetchedAt: 0 }) }));
vi.mock('../components/shell/AppShell.tsx', () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../components/ui/ResponsiveSheet.tsx', () => ({ useCompactSheet: () => false, ResponsiveSheet: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('finance bill shows the declared destination and unverified status', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(keys.batch('2026-08-17'), { mode: 'manual', bills: [{ id: 'demo', collector_ref: 'SIMULATION', period_start: '2026-08-17', period_end: '2026-08-24', currency: 'VND', total: '679.9992', amount_vnd: 679, lines: 1, paid: false, account: { method: 'WALLET', declared_name: 'Nguyen Van A', verified_name: null, phone_masked: 'â€¢â€¢â€¢â€¢ 5678', verify_status: 'unverified' }, attempt: null, issues: ['account_unverified'], risk: { band: 'clear', flags: [] } }] });
  client.setQueryData(keys.bill('demo'), { lines: [] });
  const node = document.createElement('div');
  const root = createRoot(node);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><BillScreen /></QueryClientProvider>));
    expect(node.textContent).toContain('Nguyen Van A');
    expect(node.textContent).toContain('â€¢â€¢â€¢â€¢ 5678');
    expect(node.textContent?.toLowerCase()).toContain('not verified');
  } finally { await act(async () => root.unmount()); client.clear(); }
});

