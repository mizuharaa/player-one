// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { ReviewScreen } from './Review.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key }),
}));
vi.mock('../components/shell/AppShell.tsx', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

it('browses without claiming, claims only the selection, releases before switching, and previews phones without a verdict', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const rows = [
    { episode_id: 'ego-1', session_folder: 'Ego recording', collector_label: 'Mai', collector_ref: 'col-1', recorded_at: '20260916_142300', uploaded_at: '2026-09-16T08:00:00Z', duration_seconds: 20, source: 'ego', state: 'pending', queue: 'standard', claimable: true, preview_url: null, blocker: null },
    { episode_id: 'phone-1', session_folder: 'Phone recording', collector_label: 'Linh', collector_ref: 'col-2', recorded_at: null, uploaded_at: '2026-09-16T08:00:00Z', duration_seconds: 8, source: 'phone', state: 'quarantined', queue: 'privacy', claimable: false, preview_url: '/phone.mp4', blocker: 'requires_camera_metadata' },
  ];
  const episode = { episode_id: 'ego-1', session_folder: 'Ego recording', measured_duration_seconds: '20', claimed_duration_seconds: null,
    task: null, collector: null, declared: null, device: { serial: 'Ego' }, flags: [{ code: 'TEST', detail: 'Diagnostic', blocks_review: false }],
    media: { parts: [{ url: '/test.mp4', index: 0 }] }, queue_depth: 1 };
  const calls: { path: string; body?: string }[] = [];
  let releaseFails = true;
  let claimTaken = false;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body as string | undefined });
    if (path.endsWith('/reasons')) return response({ reasons: [] });
    if (path.includes('/catalog?')) return response({ items: rows, counts: { total: 2, claimable: 1, phone: 1, blocked: 1 } });
    if (path.includes('/claim?')) return claimTaken ? response(null, 204) : response(episode);
    if (path.includes('/release/')) {
      if (releaseFails) { releaseFails = false; return response({ error: 'Release failed' }, 503); }
      return response({ released: true });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: vi.fn(() => true) });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('Playback interrupted', 'AbortError'));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const cards = () => host.querySelectorAll<HTMLButtonElement>('.review-recording');
  try {
    await act(async () => root.render(<StrictMode><QueryClientProvider client={client}><ReviewScreen /></QueryClientProvider></StrictMode>));
    await vi.waitFor(async () => { await flush(); expect(cards().length).toBe(2); });
    expect(calls.some(c => c.path.includes('/claim'))).toBe(false);
    expect(host.textContent).toContain('Mai'); expect(host.textContent).toContain('2026-09-16 14:23:00');
    await act(async () => cards()[0]!.click());
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('[data-guide="review.player"]')).not.toBeNull(); });
    expect(calls.filter(c => c.path.includes('/claim'))).toEqual([{ path: '/api/review/claim?queue=standard', body: JSON.stringify({ episode_id: 'ego-1' }) }]);
    expect(host.querySelector('details')?.open).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[role=radio]')!.click());
    expect(host.querySelector('[aria-checked=true]')).not.toBeNull();
    const playButton = [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Play'))!;
    await act(async () => playButton.click()); await flush();
    expect(play).toHaveBeenCalled(); expect(host.querySelector('[data-guide="review.player"]')).not.toBeNull();
    await act(async () => cards()[1]!.click());
    await vi.waitFor(async () => { await flush(); expect(host.textContent).toContain('Release failed'); });
    expect(calls.filter(c => c.path.includes('/claim'))).toHaveLength(1);
    await act(async () => cards()[1]!.click());
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('.review-preview-only video')).not.toBeNull(); });
    expect(host.querySelector('[role=radio]')).toBeNull(); expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('.review-preview-only select')).toBeNull();
    expect(host.querySelector('.review-preview-only video')?.getAttribute('src')).toBe('/phone.mp4');
    expect(calls.filter(c => c.path.includes('/release/'))).toHaveLength(2);
    expect(calls.filter(c => c.path.includes('/claim'))).toHaveLength(1);
    expect(host.textContent).toContain(MESSAGES.en['review.catalog.viewOnlyHint']);
    claimTaken = true;
    await act(async () => cards()[0]!.click());
    await vi.waitFor(async () => { await flush(); expect(calls.filter(c => c.path.includes('/claim'))).toHaveLength(2); });
    expect(host.querySelector('.review-preview-only')).toBeNull();
    expect(host.textContent).toContain(MESSAGES.en['state.leaseExpired.title']);
    expect(host.textContent).not.toContain(MESSAGES.en['review.catalog.viewOnlyHint']);
    const retry = [...host.querySelectorAll('button')].filter(button => button.textContent === MESSAGES.en['queue.refresh']).at(-1)!;
    await act(async () => retry.click()); await flush();
    expect(host.textContent).not.toContain(MESSAGES.en['state.leaseExpired.title']);
    expect(calls.filter(c => c.path.includes('/claim'))).toHaveLength(2);
  } finally {
    await act(async () => root.unmount()); client.clear(); host.remove(); play.mockRestore(); vi.unstubAllGlobals();
  }
});
