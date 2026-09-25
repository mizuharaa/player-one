// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { OriginalityReview } from './OriginalityReview.tsx';
import type { OriginalityState } from '../lib/api.ts';

const mock = vi.hoisted(() => ({ role: 'finance', decide: vi.fn(async () => ({ id: 'decision' })) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }) }));
vi.mock('./role.ts', () => ({ useFinanceRole: () => ({ role: mock.role }), canReadFinance: () => true }));
vi.mock('../lib/api.ts', () => ({ originality: { ingest: async () => null, decide: mock.decide } }));
vi.mock('./pieces.tsx', () => ({ Section: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  LoadFailed: () => <p role="alert">Request refused</p> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('originality decision controls', () => {
  async function render(role: string, status: string, reason: string, mediaVerified: boolean) {
    mock.role = role; mock.decide.mockClear();
    const data: OriginalityState = { ingest_id: 'ingest', payable: false, disposition: 'pending', identity_verified: true,
      assessments: [{ id: 'assessment-1', status, decision: null, reason: null, evidence: { reason, media_verified: mediaVerified } }] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['originality', 'ingest'], data);
    const node = document.createElement('div'), root = createRoot(node);
    await act(async () => root.render(<QueryClientProvider client={client}><OriginalityReview ingestId="ingest" billId="bill" period="2026-09-21" /></QueryClientProvider>));
    return { node, client, data, close: async () => { await act(async () => root.unmount()); client.clear(); } };
  }

  it.each([
    ['finance', 'failed', 'low_information', true],
    ['administrator', 'failed', 'low_information', false],
    ['administrator', 'unavailable', 'candidate_or_match_budget', true],
  ])('keeps payment review blocked for %s / %s / %s / verified=%s', async (role, status, reason, verified) => {
    const h = await render(String(role), String(status), String(reason), Boolean(verified));
    try { expect(h.node.querySelector('form')).toBeNull(); expect(mock.decide).not.toHaveBeenCalled(); }
    finally { await h.close(); }
  });

  it('offers administrator acceptance distinctly and never selects it automatically', async () => {
    const h = await render('administrator', 'failed', 'low_information', true);
    try {
      const select = h.node.querySelector('select')!;
      expect(select.value).toBe('');
      expect([...select.options].map(o => o.value)).toEqual(['', 'accepted_unassessable']);
      expect(h.node.textContent).toContain('algorithm could not assess originality');
      expect(h.node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    } finally { await h.close(); }
  });

  it('requires notes, submits the reviewed assessment ID, and refreshes payment data', async () => {
    const h = await render('finance', 'complete', 'suspected_reuse', true);
    try {
      const invalidate = vi.spyOn(h.client, 'invalidateQueries');
      const select = h.node.querySelector('select')!, textarea = h.node.querySelector('textarea')!;
      await act(async () => { select.value = 'cleared'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(h.node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Compared the full matching recordings.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => h.node.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(mock.decide).toHaveBeenCalledWith('assessment-1', 'cleared', 'Compared the full matching recordings.');
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settle', 'bill', 'bill'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payout', 'preflight', '2026-09-21'] });
    } finally { await h.close(); }
  });

  it('does not carry a selected clearance over to a different assessment', async () => {
    const h = await render('finance', 'complete', 'suspected_reuse', true);
    try {
      const select = h.node.querySelector('select')!;
      await act(async () => { select.value = 'cleared'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      await act(async () => h.client.setQueryData(['originality', 'ingest'], {
        ...h.data, assessments: [{ ...h.data.assessments[0], id: 'assessment-2' }],
      }));
      await vi.waitFor(() => expect(h.node.querySelector('select')!.value).toBe(''));
      expect(h.node.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
      expect(mock.decide).not.toHaveBeenCalled();
    } finally { await h.close(); }
  });
});
