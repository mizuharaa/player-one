// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { HttpCollectorApi } from '../src/api/http.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { DemoSkip } from '../src/ui/DemoSkip.tsx';
import { MESSAGES } from '../src/i18n.ts';

vi.mock('react-native', async () => ({ ...(await import('react-native-web')) }));
const config = vi.hoisted(() => ({ profile: 'demo' }));
vi.mock('../src/api/config.ts', () => ({ get BUILD_PROFILE() { return config.profile; } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, client: QueryClient;
let request: ReturnType<typeof vi.fn<typeof fetch>>, advanced: ReturnType<typeof vi.fn>;
const runId = '987d68ae-bd64-42ec-9305-f1216ee79dba';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  config.profile = 'demo';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  request = vi.fn<typeof fetch>(); advanced = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
async function mount() {
  const api = new HttpCollectorApi('https://demo.test', { get: async () => 'signed-demo-token', set: async () => {}, clear: async () => {} }, () => {}, request);
  request.mockResolvedValueOnce(json({})); await api.restoreSession();
  await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale="en">
    <DemoSkip from="agreements" to="exam" onSkipped={advanced} />
  </LocaleProvider></ApiProvider></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  return api;
}
const button = () => container.querySelector<HTMLElement>('[role="button"]')!;

it('renders no Skip for ordinary sessions or Play builds', async () => {
  request.mockImplementation(async () => json({ runId: null }));
  await mount(); expect(button()).toBeNull(); expect(advanced).not.toHaveBeenCalled();
  config.profile = 'play'; request.mockClear();
  await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={{ demoContext: () => Promise.resolve({ runId }) } as never}><DemoSkip from="agreements" to="exam" onSkipped={advanced} /></ApiProvider></QueryClientProvider>));
  expect(button()).toBeNull(); expect(request).not.toHaveBeenCalled();
});

it('blocks navigation until a successful audited receipt, rejects failure, and locks repeated taps', async () => {
  let finish!: (response: Response) => void;
  request.mockImplementation(async (url) => String(url).endsWith('/skip') ? new Promise<Response>(resolve => { finish = resolve; }) : json({ runId }));
  await mount(); expect(button()).not.toBeNull();
  await act(async () => { button().click(); button().click(); });
  expect(request.mock.calls.filter(([url]) => String(url).endsWith('/skip'))).toHaveLength(1);
  expect(advanced).not.toHaveBeenCalled();
  await act(async () => finish(json({ error: 'audit unavailable' }, 500)));
  expect(advanced).not.toHaveBeenCalled(); expect(container.textContent).toContain(MESSAGES.en['common.actionFailed']);
  await act(async () => button().click());
  await act(async () => finish(json({ runId, from: 'agreements', to: 'exam', outcome: 'preview_only' })));
  expect(advanced).toHaveBeenCalledTimes(1);
  const [, options] = request.mock.calls.filter(([url]) => String(url).endsWith('/skip')).at(-1)!;
  expect(JSON.parse(String(options?.body))).toEqual({ from: 'agreements', to: 'exam' });
});

it('rejects a success response that does not confirm the requested audit', async () => {
  request.mockImplementation(async url => json(String(url).endsWith('/skip') ? { runId, from: 'exam', to: 'home', outcome: 'preview_only' } : { runId }));
  const api = await mount();
  await expect(api.skipDemoStep('agreements', 'exam')).rejects.toThrow('server_error');
  await act(async () => button().click());
  expect(advanced).not.toHaveBeenCalled();
});

it('does not navigate from a response that arrives after unmount', async () => {
  let finish!: (response: Response) => void;
  request.mockImplementation(async url => String(url).endsWith('/skip') ? new Promise<Response>(resolve => { finish = resolve; }) : json({ runId }));
  await mount(); await act(async () => button().click());
  await act(async () => root.render(null));
  await act(async () => finish(json({ runId, from: 'agreements', to: 'exam', outcome: 'preview_only' })));
  expect(advanced).not.toHaveBeenCalled();
});

it('does not navigate if a real submission disables Skip while its audit is pending', async () => {
  let finish!: (response: Response) => void;
  request.mockImplementation(async url => String(url).endsWith('/skip') ? new Promise<Response>(resolve => { finish = resolve; }) : json({ runId }));
  const api = await mount(); await act(async () => button().click());
  await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale="en">
    <DemoSkip from="agreements" to="exam" disabled onSkipped={advanced} />
  </LocaleProvider></ApiProvider></QueryClientProvider>));
  await act(async () => finish(json({ runId, from: 'agreements', to: 'exam', outcome: 'preview_only' })));
  expect(advanced).not.toHaveBeenCalled();
});
