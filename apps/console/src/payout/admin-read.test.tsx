// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, describe, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { canReadFinance, readOnlyReason } from './role.ts';
import { BillScreen } from './BillScreen.tsx';
import { keys } from './period.ts';

/**
 * The demo's single administrator credential sees what finance sees and can
 * change nothing. Reading and acting were one expression here —
 * `role === 'finance'` gated both the queries and the buttons — so an
 * administrator got an empty screen. Two predicates now, and this file is what
 * keeps them apart: `canReadFinance` is the read, `readOnlyReason` the action.
 */
describe('the two questions', () => {
  it('lets finance and the administrator read, and nobody else', () => {
    expect(canReadFinance('finance')).toBe(true);
    expect(canReadFinance('administrator')).toBe(true);
    expect(canReadFinance('operator')).toBe(false);
    expect(canReadFinance('unknown')).toBe(false);
  });

  /**
   * The administrator's sentence used to be the operator's. It was changed
   * because the operator's sentence says only finance may VIEW bills, which is
   * exactly what `canReadFinance` above lets an administrator do — the screen
   * printed it over a bill table the administrator was reading. What has not
   * changed is the half this file exists for: every action stays disabled.
   */
  it('leaves every action disabled for the administrator, with a reason that is true of it', () => {
    expect(readOnlyReason('finance')).toBe(null);
    expect(readOnlyReason('administrator')).toBe('settle.readonly.administrator');
    expect(readOnlyReason('operator')).toBe('settle.readonly.operator');
    expect(readOnlyReason('unknown')).toBe('settle.readonly.unknown');
  });
});

vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({ period: '2026-08-17' }), useParams: () => ({ billId: 'demo' }), useNavigate: () => () => {}, Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string, values?: { reference?: string }) => (MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key).replace('{{reference}}', values?.reference ?? '') }) }));
vi.mock('./PreflightScreen.tsx', () => ({ useGate: () => ({ gate: { open: false }, snapshot: null, fetchedAt: 0 }) }));
vi.mock('../components/shell/AppShell.tsx', () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../components/ui/ResponsiveSheet.tsx', () => ({ useCompactSheet: () => false, ResponsiveSheet: () => null }));
const stored = vi.hoisted(() => ({ role: 'administrator' }));
vi.mock('../lib/profile-api.ts', () => ({
  useOperatorProfile: () => ({ data: { operator: { role: stored.role, status: 'active' } }, isPending: false, isError: false }),
}));
const BILL = { id: 'demo', collector_id: 'c1', collector_ref: 'DEMO-01', period_start: '2026-08-17', period_end: '2026-08-24', currency: 'VND', total: '679.9992', amount_vnd: 679, lines: 1, paid: false, simulation: true, account: { method: 'WALLET', declared_name: 'Nguyen Van A', verified_name: null, phone_masked: '•••• 5678', verify_status: 'unverified' }, attempt: null, issues: ['account_unverified'], risk: { band: 'clear', flags: [] } };
const calls = vi.hoisted(() => ({ batch: 0, bill: 0 }));
vi.mock('../lib/api.ts', async (original) => {
  const real = await original<typeof import('../lib/api.ts')>();
  return { ...real,
    payout: { ...real.payout, batch: async () => { calls.batch += 1; return { mode: 'manual', bills: [BILL] }; } },
    settle: { ...real.settle, bill: async () => { calls.bill += 1; return { lines: [] }; } } };
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Nothing is pre-seeded into the cache: the reads have to actually fire, which
 * is the half that was broken. `enabled: role === 'finance'` left both queries
 * idle for an administrator and the screen drew a skeleton for ever.
 */
it.each(['administrator', 'finance'] as const)('%s fetches the bill; only finance may act on it', async (role) => {
  stored.role = role;
  calls.batch = 0; calls.bill = 0;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement('div');
  const root = createRoot(node);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><BillScreen /></QueryClientProvider>));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      expect(node.textContent).toContain('DEMO-01');
    });
    // The read half: the queries ran, and the same figures finance reads are on screen.
    expect(calls.batch).toBeGreaterThan(0);
    expect(calls.bill).toBeGreaterThan(0);
    expect(client.getQueryData(keys.batch('2026-08-17'))).toBeDefined();
    expect(node.textContent).toContain('Nguyen Van A');
    expect(node.textContent).toContain('•••• 5678');
    // The action half: for the administrator the panel says why it is inert and
    // nothing is submittable; for finance it is live.
    if (role === 'administrator') {
      expect(node.textContent).toContain(MESSAGES.en['settle.readonly.administrator']);
      for (const button of node.querySelectorAll('button')) expect(button.disabled, button.textContent ?? '').toBe(true);
    } else {
      expect(node.textContent).not.toContain(MESSAGES.en['settle.readonly.administrator']);
    }
  } finally { await act(async () => root.unmount()); client.clear(); }
});
