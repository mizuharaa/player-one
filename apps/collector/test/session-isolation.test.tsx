// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectorSession } from '../src/App.tsx';
import { useApi } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { AGREEMENTS, type IncomeEntry } from '../src/api/types.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { MESSAGES } from '../src/i18n.ts';

// The shell now renders the real tab bar, guide and landing, so the handful of
// hand-written stubs this test used to carry no longer covers what `ui.tsx`
// reaches. `react-native-web` is already a devDependency of this app and is a
// complete DOM implementation of the same surface; use it rather than growing
// a shim one missing export at a time.
vi.mock('react-native', async () => ({ ...await import('react-native-web') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('../src/api/token-store.ts', () => ({ secureTokenStore: {} }));
// Only the two primitives this test reads are replaced; the rest of `ui.tsx`
// stays real, because the shell now renders the tab bar and the guide through it.
vi.mock('../src/ui.tsx', async (original) => ({
  ...await original<Record<string, unknown>>(),
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) =>
    <button disabled={disabled} onClick={onPress}>{label}</button>,
}));
vi.mock('../src/screens/SignIn.tsx', () => ({
  SignIn: ({ onSignedIn }: { onSignedIn: () => void }) => <button onClick={onSignedIn}>Sign in test</button>,
}));
const observed = vi.hoisted(() => ({ clients: [] as QueryClient[] }));
vi.mock('../src/screens/Home.tsx', () => ({
  Home: () => {
    const api = useApi();
    const client = useQueryClient();
    if (!observed.clients.includes(client)) observed.clients.push(client);
    const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
    const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
    return <p>Private: {profile.data?.name} {income.data?.[0]?.amountVnd}</p>;
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  observed.clients = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function user(name: string) {
  const api = new MockCollectorApi();
  await api.register(name, '0903000001');
  await api.acceptAgreements(AGREEMENTS.map(({ id, version }) => ({ agreementId: id, version })));
  await api.completeTraining();
  await api.submitExam([true, true, true]);
  return api;
}
async function tap(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((done) => setTimeout(done, 10)); });
    check();
  });
}

it('switches clients and private caches, rejects late data and ignores the old unauthorized callback', async () => {
  const first = await user('First collector');
  const second = await user('Second collector');
  let finish!: (data: IncomeEntry[]) => void;
  vi.spyOn(first, 'income').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const dispose = vi.spyOn(first, 'dispose');
  const callbacks: (() => void)[] = [];
  const clients = [first, second];
  await act(async () => root.render(<LocaleProvider><CollectorSession factory={(callback) => {
    callbacks.push(callback);
    return clients[callbacks.length - 1]!;
  }} /></LocaleProvider>));
  await settle(() => expect(host.textContent).toContain('First collector'));
  const oldCache = observed.clients[0]!;
  await tap(MESSAGES.vi['signIn.signOut']);
  await settle(() => expect(host.textContent).toContain('Sign in test'));
  expect(dispose).toHaveBeenCalled();
  expect(oldCache.getQueryCache().getAll()).toHaveLength(0);
  await tap('Sign in test');
  await settle(() => expect(host.textContent).toContain('Second collector'));
  await act(async () => {
    finish([{ episodeId: 'old', amountVnd: '987654321', effectiveMinutes: '1', kind: 'confirmed', settlementState: 'pending_settlement' }]);
    callbacks[0]!();
  });
  expect(host.textContent).toContain('Second collector');
  expect(host.textContent).not.toContain('First collector');
  expect(host.textContent).not.toContain('987654321');
  expect(observed.clients[1]).not.toBe(oldCache);
});

it('keeps private screens hidden and asks to retry when local sign-out fails', async () => {
  const first = await user('First collector');
  const clear = vi.spyOn(first, 'signOut').mockRejectedValueOnce(new Error('keystore'));
  await act(async () => root.render(<LocaleProvider><CollectorSession factory={() => first} /></LocaleProvider>));
  await settle(() => expect(host.textContent).toContain('First collector'));
  await tap(MESSAGES.vi['signIn.signOut']);
  await settle(() => expect(host.textContent).toContain(MESSAGES.vi['signIn.clearFailed']));
  expect(host.textContent).not.toContain('First collector');
  expect(host.textContent).not.toContain('Sign in test');
  await tap(MESSAGES.vi['common.retry']);
  await settle(() => expect(host.textContent).toContain('Sign in test'));
  expect(clear).toHaveBeenCalledTimes(2);
});

it('offers retry instead of registration after a failed restoration', async () => {
  const api = await user('Restored collector');
  vi.spyOn(api, 'restoreSession').mockRejectedValueOnce(new Error('offline'));
  await act(async () => root.render(<LocaleProvider><CollectorSession factory={() => api} /></LocaleProvider>));
  await settle(() => expect(host.textContent).toContain(MESSAGES.vi['common.loadFailed']));
  expect(host.textContent).not.toContain('Private:');
  await tap(MESSAGES.vi['common.retry']);
  await settle(() => expect(host.textContent).toContain('Restored collector'));
});
