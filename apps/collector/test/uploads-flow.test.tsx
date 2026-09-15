// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { Uploads } from '../src/screens/Uploads.tsx';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider } from '../src/nav.tsx';
import { MESSAGES } from '../src/i18n.ts';
import { runDelivery } from '@playerone/delivery';
import { nativeDeliveryStore, pickSessionDirectory } from '../src/upload/delivery-native.ts';

vi.mock('react-native', async () => ({ ...await import('react-native-web'), Modal: ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? children : null }));
vi.mock('../src/guide/Guide.tsx', () => ({ useGuideTarget: () => undefined }));
vi.mock('../src/ui.tsx', () => ({
  ListScreen: ({ title, header, empty, refresh }: { title: string; header: ReactNode; empty: ReactNode; refresh?: { onRefresh: () => void } }) => <main><h1>{title}</h1>{header}{empty}{refresh ? <button onClick={refresh.onRefresh}>Refresh</button> : null}</main>,
  Screen: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) => <section><h1>{title}</h1>{children}{footer}</section>,
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Row: ({ label, value }: { label: string; value: string }) => <p>{label}: {value}</p>,
  Note: ({ text }: { text: string }) => <p>{text}</p>,
  Hatch: ({ text }: { text: string }) => <p>{text}</p>,
  Loading: () => <p>Loading</p>,
  Progress: () => null, Tag: () => null,
  Button: ({ label, disabled, busy, onPress }: { label: string; disabled?: boolean; busy?: boolean; onPress: () => void }) => <button disabled={disabled || busy} onClick={onPress}>{label}</button>,
  Choice: ({ label, onPress }: { label: string; onPress: () => void }) => <button onClick={onPress}>{label}</button>,
}));
vi.mock('@playerone/delivery', () => ({ runDelivery: vi.fn() }));
vi.mock('../src/upload/delivery-native.ts', () => ({
  nativeDeliveryStore: { get: vi.fn(async () => null) }, nativeTransport: {},
  pickSessionDirectory: vi.fn(async () => ({ directoryUri: 'content://session', sessionBasename: 'session_20260914_120000', files: [] })),
  hashSession: vi.fn(async () => []),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('requires folder, server session and explicit confirmation; repeated presses start one delivery', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'sessions').mockResolvedValue([{ id: 'session-a', collectorId: 'collector-a', taskId: 'task-a', deviceSerial: 'EGO', scenario: 'home', othersInFrame: false, sensitiveInfo: false, createdAt: '2026-09-14T12:00:00Z' }]);
  vi.mocked(runDelivery).mockImplementation(() => new Promise(() => {}));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
  const tap = async (label: string) => { await act(async () => button(label).click()); };
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale="vi"><NavProvider initial={{ name: 'uploads' }}><Uploads /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await tap(MESSAGES.vi['uploads.deliverTitle']);
    await tap(MESSAGES.vi['uploads.byPhone']);
    await tap(MESSAGES.vi['common.next']);
    await vi.waitFor(() => expect(button(MESSAGES.vi['uploads.pick']).disabled).toBe(false));
    expect(runDelivery).not.toHaveBeenCalled();
    await tap(MESSAGES.vi['uploads.pick']);
    expect(pickSessionDirectory).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(button(MESSAGES.vi['common.next'])).toBeDefined());
    expect(button(MESSAGES.vi['common.next']).disabled).toBe(true);
    await tap(`${MESSAGES.vi['scenario.home']} · 2026-09-14`);
    await tap(MESSAGES.vi['common.next']);
    expect(runDelivery).not.toHaveBeenCalled();
    await act(async () => { button(MESSAGES.vi['uploads.start']).click(); button(MESSAGES.vi['uploads.start']).click(); });
    await vi.waitFor(() => expect(runDelivery).toHaveBeenCalledTimes(1));
    expect(vi.mocked(runDelivery).mock.calls[0]?.[1].collectionSessionId).toBe('session-a');
  } finally {
    await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks();
  }
});

it('keeps folder selection and refresh available when a saved delivery exists', async () => {
  const api = new MockCollectorApi();
  const episodes = vi.spyOn(api, 'episodes');
  vi.mocked(nativeDeliveryStore.get).mockResolvedValue({ uploadId: 'saved-upload', collectionSessionId: 'session-a', sessionBasename: 'ego_A_20260914_120000', directoryUri: 'content://session', files: [] });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale="vi"><NavProvider initial={{ name: 'uploads' }}><Uploads /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await vi.waitFor(() => expect(episodes).toHaveBeenCalledTimes(1));
    await act(async () => button('Refresh').click());
    await vi.waitFor(() => expect(episodes).toHaveBeenCalledTimes(2));
    await act(async () => button(MESSAGES.vi['uploads.deliverTitle']).click());
    await act(async () => button(MESSAGES.vi['uploads.byPhone']).click());
    await act(async () => button(MESSAGES.vi['common.next']).click());
    await vi.waitFor(() => expect(button(MESSAGES.vi['uploads.resume'])).toBeDefined());
    expect(button(MESSAGES.vi['uploads.pick']).disabled).toBe(false);
  } finally {
    await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks();
  }
});

it('shows card handover guidance without starting a phone delivery', async () => {
  vi.mocked(runDelivery).mockClear();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={new MockCollectorApi()}><LocaleProvider initialLocale="vi"><NavProvider initial={{ name: 'uploads', openDelivery: true }}><Uploads /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => button(MESSAGES.vi['uploads.byCard']).click());
    expect(button(MESSAGES.vi['common.done']).disabled).toBe(false);
    expect(button(MESSAGES.vi['uploads.pick'])).toBeUndefined();
    await act(async () => button(MESSAGES.vi['common.done']).click());
    expect(runDelivery).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
