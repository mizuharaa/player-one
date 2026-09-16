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

it('keeps queue selection available and releases before switching without duplicate claims or stale decisions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const response = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const episode = (id: string) => ({
    episode_id: id, session_folder: id, measured_duration_seconds: '20', claimed_duration_seconds: null,
    task: null, collector: null, declared: null, device: { serial: 'Ego' }, flags: [],
    media: { parts: [{ url: '/test.mp4', index: 0 }] }, queue_depth: 1,
  });
  let finishInitial!: (value: Response) => void;
  let finishRelease!: (value: Response) => void;
  let releaseFails = true;
  let withheld = false;
  const calls: string[] = [];
  const fetcher = vi.fn(async (path: string) => {
    calls.push(path);
    if (path.endsWith('/reasons')) return response({ reasons: [] });
    if (path.includes('/release/')) {
      if (releaseFails) { releaseFails = false; return response({ error: 'Release failed' }, 503); }
      return new Promise<Response>(resolve => { finishRelease = resolve; });
    }
    if (path.includes('/claim?queue=standard')) return new Promise<Response>(resolve => { finishInitial = resolve; });
    if (path.includes('/claim?queue=')) {
      if (withheld) return response({ error: 'withheld' }, 451);
      return response(episode(path.endsWith('privacy') ? 'privacy-episode' : 'second-episode'));
    }
    if (path.includes('/next?queue=')) return response(null, 204);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const select = () => host.querySelector<HTMLSelectElement>('#review-queue')!;
  const change = async (queue: string) => act(async () => {
    select().value = queue;
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
  const settled = async () => {
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(select().disabled).toBe(false);
    });
  };
  try {
    await act(async () => root.render(<StrictMode><QueryClientProvider client={client}><ReviewScreen /></QueryClientProvider></StrictMode>));
    expect(select().disabled).toBe(true);
    expect(calls.filter(path => path.includes('/claim'))).toEqual(['/api/review/claim?queue=standard']);
    await act(async () => finishInitial(response(null, 204)));
    await settled();
    expect(host.textContent).toContain(MESSAGES.en['queue.empty.title']);
    expect(select().labels?.[0]?.textContent).toBe(MESSAGES.en['queue.select']);

    await change('privacy');
    await settled();
    expect(host.textContent).toContain('privacy-episode');
    await act(async () => host.querySelector<HTMLButtonElement>('[role=radio]')!.click());
    expect(host.querySelector('[aria-checked=true]')).not.toBeNull();
    await act(async () => {
      const note = host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Old episode note');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('textarea')?.value).toBe('Old episode note');
    await act(async () => select().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(calls.some(path => path.includes('/verdict'))).toBe(false);

    await change('second_review');
    await settled();
    expect(host.textContent).toContain('Release failed');
    expect(select().value).toBe('second_review');
    expect(calls.some(path => path.endsWith('/claim?queue=second_review'))).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(select().disabled).toBe(true);
    expect(calls.filter(path => path.includes('/release/'))).toEqual([
      '/api/review/release/privacy-episode', '/api/review/release/privacy-episode',
    ]);
    await act(async () => finishRelease(response({ released: true })));
    await settled();
    expect(host.textContent).toContain('second-episode');
    expect(host.querySelector('[aria-checked=true]')).toBeNull();
    expect(host.querySelector('textarea')?.value).toBe('');
    expect(calls.filter(path => path.includes('/claim'))).toEqual([
      '/api/review/claim?queue=standard', '/api/review/claim?queue=privacy', '/api/review/claim?queue=second_review',
    ]);

    withheld = true;
    await change('privacy');
    await act(async () => finishRelease(response({ released: true })));
    await settled();
    await vi.waitFor(() => expect(calls).toContain('/api/review/next?queue=privacy'));
    expect(host.textContent).toContain(MESSAGES.en['state.playbackWithheld.title']);
    expect(select().value).toBe('privacy');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});
