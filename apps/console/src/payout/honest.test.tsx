// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { BillScreen } from './BillScreen.tsx';
import { VerifyPill } from './pieces.tsx';
import { keys } from './period.ts';
const language = vi.hoisted(() => ({ value: 'en' as 'en' | 'vi' | 'zh' }));

vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({ period: '2026-08-17' }), useParams: () => ({ billId: 'demo' }), useNavigate: () => () => {}, Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: language.value }, t: (key: string, values?: { reference?: string }) => (MESSAGES[language.value][key as keyof typeof MESSAGES.en] ?? key).replace('{{reference}}', values?.reference ?? '') }) }));
vi.mock('./role.ts', () => ({ useFinanceRole: () => ({ role: 'finance' }), readOnlyReason: () => null, canReadFinance: () => true }));
vi.mock('./PreflightScreen.tsx', () => ({ useGate: () => ({ gate: { open: false }, snapshot: null, fetchedAt: 0 }) }));
vi.mock('../components/shell/AppShell.tsx', () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../components/ui/ResponsiveSheet.tsx', () => ({ useCompactSheet: () => false, ResponsiveSheet: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The three states one bill can be in, and what each must and must not say.
 *
 * `simulation` is the server's field, derived from the bill's own latest
 * outcome (`isSimulation` in packages/api/src/payout/domain/config.ts) — the
 * audit's finding 3. A bill paid on the manual rail with a real transfer
 * reference arrives with `simulation: false`, and the screen must not print
 * "No live transfer." over it.
 */
const CASES = [
  { name: 'awaiting on the sandbox provider', paid: false, simulation: true, reference: null, shows: ['awaiting', 'simulation'] },
  { name: 'paid by a finance-recorded manual transfer', paid: true, simulation: false, reference: 'MANUAL-REF-Y', shows: ['paid'] },
  { name: 'paid by the sandbox provider', paid: true, simulation: true, reference: 'SANDBOX-REF-X', shows: ['paid', 'simulation'] },
] as const;

it.each(['en', 'vi', 'zh'] as const)('finance bill shows awaiting, paid and simulation sentences in %s', async (locale) => {
  language.value = locale;
  for (const c of CASES) {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(keys.batch('2026-08-17'), { mode: 'manual', bills: [{ id: 'demo', collector_ref: 'DEMO-01', period_start: '2026-08-17', period_end: '2026-08-24', currency: 'VND', total: '679.9992', amount_vnd: 679, lines: 1, paid: c.paid, simulation: c.simulation, account: { method: 'WALLET', declared_name: 'Nguyen Van A', verified_name: null, phone_masked: '•••• 5678', verify_status: c.paid ? 'verified' : 'unverified' }, attempt: c.reference === null ? null : { status: 'succeeded', mode: 'manual', manual_reference: c.reference, created_at: '2026-08-18', poll_count: 0 }, issues: c.paid ? [] : ['account_unverified'], risk: { band: 'clear', flags: [] } }] });
    client.setQueryData(keys.bill('demo'), { lines: [] });
    const node = document.createElement('div');
    const root = createRoot(node);
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><BillScreen /></QueryClientProvider>));
      const text = node.textContent ?? '';
      expect(text, c.name).toContain('Nguyen Van A');
      expect(text, c.name).toContain('•••• 5678');
      const awaiting = { en: 'Awaiting payment — destination unverified', vi: 'Chờ thanh toán. Nơi nhận tiền chưa xác minh.', zh: '待付款，收款账户尚未验证。' }[locale];
      const paid = MESSAGES[locale]['settle.paidReference'].replace('{{reference}}', c.reference ?? '');
      for (const [flag, sentence] of [['awaiting', awaiting], ['paid', paid], ['simulation', MESSAGES[locale]['settle.simulation']]] as const) {
        if ((c.shows as readonly string[]).includes(flag)) expect(text, `${c.name} shows ${flag}`).toContain(sentence);
        else expect(text, `${c.name} hides ${flag}`).not.toContain(sentence);
      }
    } finally { await act(async () => root.unmount()); client.clear(); }
  }
});

it.each(['en', 'vi', 'zh'] as const)('verification pill labels only verified simulation with a short token in %s', async locale => {
  language.value = locale;
  const node = document.createElement('div');
  const root = createRoot(node);
  try {
    for (const status of ['unverified', 'verified'] as const) {
      await act(async () => root.render(<VerifyPill status={status} simulation />));
      const token = { en: 'Sandbox', vi: 'M\u00f4 ph\u1ecfng', zh: '\u6a21\u62df' }[locale];
      expect(node.textContent).toBe(MESSAGES[locale][`settle.verify.${status}`] + (status === 'verified' ? ` - ${token}` : ''));
      expect(node.textContent).not.toContain(MESSAGES[locale]['settle.simulation']);
    }
  } finally { await act(async () => root.unmount()); }
});
