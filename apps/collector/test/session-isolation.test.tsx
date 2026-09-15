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
import { useSignOut } from '../src/session.tsx';

// The shell now renders the real tab bar, guide and landing, so the handful of
// hand-written stubs this test used to carry no longer covers what `ui.tsx`
// reaches. `react-native-web` is already a devDependency of this app and is a
// complete DOM implementation of the same surface; use it rather than growing
// a shim one missing export at a time.
vi.mock('react-native', async () => ({ ...await import('react-native-web') }));
/**
 * `expo-video` reaches `expo-modules-core`, which asks the native runtime for
 * its `EventEmitter` at module load and throws in node. Same reason
 * `expo-secure-store` and `expo-file-system` are mocked in these files: this
 * suite is about behaviour, not about a decoder. `ui.tsx` imports it for
 * `Film`, and every file that reaches `ui.tsx` therefore reaches this.
 */
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({ addListener: () => ({ remove: () => {} }), status: 'idle' }) }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('../src/api/token-store.ts', () => ({ secureTokenStore: {} }));
// The uploads screen reaches `expo-file-system` through `upload/delivery-native.ts`,
// and `expo-modules-core` wants a React Native `__DEV__` the moment it loads. Same
// treatment as the keystore above: the shell mounts, the picker is never called.
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, FileMode: {}, UploadType: {}, Paths: {} }));
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
// The stub draws the sign-out control too, because that is where the real Home
// draws it: it moved off the app shell — where it sat across the foot of every
// tab, under the bar and outside the bottom inset — into the foot of Home, and
// it reaches `leave()` through `session.tsx`'s context. So this stub renders the
// same control from the same context, and the two sign-out paths below are still
// driven the way a collector drives them.
vi.mock('../src/screens/Home.tsx', () => ({
  Home: () => {
    const api = useApi();
    const client = useQueryClient();
    const signOut = useSignOut();
    if (!observed.clients.includes(client)) observed.clients.push(client);
    const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
    const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
    return <>
      <p>Private: {profile.data?.name} {income.data?.[0]?.amountVnd}</p>
      <button onClick={signOut}>{MESSAGES.vi['signIn.signOut']}</button>
    </>;
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
  await act(async () => root.render(<LocaleProvider initialLocale="vi"><CollectorSession factory={(callback) => {
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
  await act(async () => root.render(<LocaleProvider initialLocale="vi"><CollectorSession factory={() => first} /></LocaleProvider>));
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
  await act(async () => root.render(<LocaleProvider initialLocale="vi"><CollectorSession factory={() => api} /></LocaleProvider>));
  await settle(() => expect(host.textContent).toContain(MESSAGES.vi['common.loadFailed']));
  expect(host.textContent).not.toContain('Private:');
  await tap(MESSAGES.vi['common.retry']);
  await settle(() => expect(host.textContent).toContain('Restored collector'));
});

// Native inset measurements are supplied by the device, not jsdom.
vi.mock('react-native-safe-area-context', async () => ({
  initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null),
}));

vi.mock('../src/ui/HeaderGradient.tsx', () => ({ HeaderGradient: ({ children }: { children: import('react').ReactNode }) => children }));

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));

vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});

vi.mock('../src/guide/seen.ts', () => ({ guideOffered: { get: async () => true, set: async () => {} } }));
