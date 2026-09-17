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

it('moves an admin phone preview into a persistent demo lane and only uses audited demo decisions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  let row = { episode_id: 'phone-demo', session_folder: 'Demo phone', collector_label: 'Alois', collector_ref: 'col-demo', recorded_at: null, uploaded_at: null, duration_seconds: 8,
    source: 'phone', state: 'quarantined', queue: 'privacy', claimable: false, preview_url: '/phone.mp4?queue=privacy', blocker: 'requires_camera_metadata', demo_override_allowed: true,
    demo_override: null as null | { decision: string | null; original_queue: string } };
  const calls: { path: string; body?: string }[] = [];
  let fail = true;
  let resumeCatalog = () => {};
  let catalogGate = Promise.resolve();
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body as string | undefined });
    if (path.endsWith('/reasons')) return response({ reasons: [] });
    if (path.includes('/catalog?')) {
      if (row.queue === 'standard') await catalogGate;
      const items = path.endsWith(`queue=${row.queue}`) ? [row] : [];
      return response({ items, counts: { total: items.length, claimable: 0, phone: items.length, blocked: items.length } });
    }
    if (path === '/api/review/demo/phone-demo') {
      if (fail) { fail = false; return response({ error: 'Demo permission denied' }, 403); }
      const body = JSON.parse(String(init?.body)) as { action: string };
      const decision = body.action === 'accept' ? 'accepted' : body.action === 'deny' ? 'denied' : body.action === 'flag' ? 'flagged' : null;
      row = { ...row, queue: 'standard', preview_url: '/phone.mp4?queue=standard', demo_override: { decision, original_queue: 'privacy' } };
      return response({ demo_only: true, queue: row.queue, ...row.demo_override });
    }
    throw new Error(`Forbidden live request: ${path}`);
  }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
  const mount = () => act(async () => root.render(<QueryClientProvider client={client}><ReviewScreen /></QueryClientProvider>));
  try {
    await mount(); await flush();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.startsWith('Privacy review'))!.click());
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('.review-recording')).not.toBeNull(); });
    await act(async () => host.querySelector<HTMLButtonElement>('.review-recording')!.click()); await flush();
    expect(host.textContent).toContain(MESSAGES.en['review.demo.hint']);
    await act(async () => button(MESSAGES.en['review.demo.move']).click());
    await vi.waitFor(async () => { await flush(); expect(host.textContent).toContain('Demo permission denied'); });
    catalogGate = new Promise<void>(resolve => { resumeCatalog = resolve; });
    await act(async () => button(MESSAGES.en['review.demo.move']).click());
    await vi.waitFor(async () => { await flush(); expect(button('Accept')).toBeDefined(); });
    // The old Privacy URL can fail after the move but before Standard metadata returns.
    await act(async () => host.querySelector<HTMLVideoElement>('.review-preview-only video')!.dispatchEvent(new Event('error')));
    expect(host.textContent).toContain(MESSAGES.en['state.mediaFailed.title']);
    resumeCatalog();
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('.review-preview-only video')?.getAttribute('src')).toBe('/phone.mp4?queue=standard'); });
    expect(host.querySelector('.review-preview-only video')?.getAttribute('src')).toBe('/phone.mp4?queue=standard');
    expect([...host.querySelectorAll('button[aria-pressed=true]')].some(node => node.textContent?.startsWith('Standard'))).toBe(true);
    const field = host.querySelector<HTMLInputElement>('.review-demo input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Training example');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const [label, state] of [['Accept', 'accepted'], ['Deny', 'denied'], ['Flag', 'flagged']] as const) {
      await act(async () => button(label).click());
      await vi.waitFor(async () => { await flush(); expect(host.querySelector('.review-demo [role=status]')?.textContent).toContain(MESSAGES.en[`review.demo.${state}`]); });
    }
    expect(calls.filter(call => call.path.includes('/demo/')).at(-1)?.body).toBe(JSON.stringify({ action: 'flag', reason: 'Training example' }));
    expect(calls.some(call => /\/(claim|verdict|hold|release)\b/.test(call.path))).toBe(false);
    await act(async () => root.render(null)); client.clear(); await mount();
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('.review-recording')?.textContent).toContain('Flagged'); });
    await act(async () => host.querySelector<HTMLButtonElement>('.review-recording')!.click()); await flush();
    expect(host.querySelector('.review-demo [role=status]')?.textContent).toContain('Flagged');
    expect(host.querySelector('[role=radio]')).toBeNull();
  } finally {
    resumeCatalog(); await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals();
  }
});

it('releases an owned Ego lease before moving to demo and stops if release fails', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  let moved = false, releaseFails = true;
  const calls: string[] = [];
  const row = () => ({ episode_id: 'ego-demo', session_folder: 'Ego', collector_label: 'Mai', source: 'ego', queue: moved ? 'standard' : 'privacy', state: 'pending', claimable: !moved,
    preview_url: moved ? '/ego-demo.mp4' : null, duration_seconds: 20, demo_override_allowed: true, demo_override: moved ? { decision: null, original_queue: 'privacy' } : null });
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    calls.push(path);
    if (path.endsWith('/reasons')) return response({ reasons: [] });
    if (path.includes('/catalog?')) return response({ items: [row()], counts: { total: 1, claimable: moved ? 0 : 1, phone: 0, blocked: 0 } });
    if (path.includes('/claim?')) return response({ episode_id: 'ego-demo', session_folder: 'Ego', measured_duration_seconds: '20', claimed_duration_seconds: null,
      task: null, collector: null, declared: null, device: { serial: 'Ego' }, flags: [], media: { parts: [{ url: '/ego.mp4', index: 0 }] }, queue_depth: 1 });
    if (path.includes('/release/')) { if (releaseFails) { releaseFails = false; return response({ error: 'Release failed' }, 503); } return response({ released: true }); }
    if (path === '/api/review/demo/ego-demo') { moved = true; return response({ demo_only: true, queue: 'standard', decision: null, original_queue: 'privacy' }); }
    throw new Error(`Forbidden live decision: ${path}`);
  }));
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: vi.fn(() => true) });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const move = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === MESSAGES.en['review.demo.move'])!;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ReviewScreen /></QueryClientProvider>));
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('.review-recording')).not.toBeNull(); });
    await act(async () => host.querySelector<HTMLButtonElement>('.review-recording')!.click());
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('[data-guide="review.player"]')).not.toBeNull(); });
    await act(async () => move().click());
    await vi.waitFor(async () => { await flush(); expect(host.textContent).toContain('Release failed'); });
    expect(calls.some(path => path.includes('/demo/'))).toBe(false);
    expect(host.querySelector('[data-guide="review.player"]')).not.toBeNull();
    await act(async () => move().click());
    await vi.waitFor(async () => { await flush(); expect(host.querySelector('.review-preview-only video')?.getAttribute('src')).toBe('/ego-demo.mp4'); });
    expect(calls.indexOf('/api/review/demo/ego-demo')).toBeGreaterThan(calls.findLastIndex(path => path.includes('/release/')));
    expect(host.querySelector('[role=radio]')).toBeNull();
    expect(calls.filter(path => path.includes('/claim?'))).toHaveLength(1);
  } finally {
    await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals();
  }
});
