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
  Screen: ({ title, children, footer, onBack, right }: { title: string; children: ReactNode; footer: ReactNode; onBack?: () => void; right?: ReactNode }) => <section><h1>{title}</h1><button onClick={onBack}>Back</button>{right}{children}{footer}</section>,
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Row: ({ label, value }: { label: string; value: string }) => <p>{label}: {value}</p>,
  Note: ({ text }: { text: string }) => <p>{text}</p>,
  Hatch: ({ text }: { text: string }) => <p>{text}</p>,
  Loading: () => <p>Loading</p>,
  Progress: () => null, Tag: () => null, Chip: () => null, Field: () => null,
  Button: ({ label, disabled, busy, onPress }: { label: string; disabled?: boolean; busy?: boolean; onPress: () => void }) => <button disabled={disabled || busy} onClick={onPress}>{label}</button>,
  Choice: ({ label, onPress }: { label: string; onPress: () => void }) => <button onClick={onPress}>{label}</button>,
}));
vi.mock('@playerone/delivery', async original => ({ ...await original<typeof import('@playerone/delivery')>(), runDelivery: vi.fn() }));
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
    await vi.waitFor(() => expect(button(MESSAGES.vi['common.cancel'])).toBeDefined());
    await tap(MESSAGES.vi['common.cancel']);
    await vi.waitFor(() => expect(button(MESSAGES.vi['common.close']).disabled).toBe(false));
    await vi.waitFor(() => expect(button(MESSAGES.vi['common.retry'])).toBeDefined());
    await tap(MESSAGES.vi['common.retry']);
    await vi.waitFor(() => expect(runDelivery).toHaveBeenCalledTimes(2));
    expect(vi.mocked(runDelivery).mock.calls[1]?.[1]).toEqual(vi.mocked(runDelivery).mock.calls[0]?.[1]);
    expect(vi.mocked(runDelivery).mock.calls[1]?.[2]?.resume).toBeUndefined();
    await vi.waitFor(() => expect(button(MESSAGES.vi['common.cancel'])).toBeDefined());
    await tap(MESSAGES.vi['common.cancel']);
    await vi.waitFor(() => expect(button(MESSAGES.vi['common.close']).disabled).toBe(false));
    await tap('Back');
    expect(host.querySelector('section')).toBeNull();
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

/**
 * The confirm step's own precheck: the collector reads what is about to leave
 * the phone before they confirm it.
 *
 * The total is summed from the picker's own inventory, so this asserts on
 * arithmetic over three real file sizes and not on a figure any one of them
 * carries. The connection sentence is static and carries that same total,
 * because this app cannot tell Wi-Fi from mobile data — see the screen.
 */
it('prints the session total size and the connection sentence before the delivery is confirmed', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'sessions').mockResolvedValue([{ id: 'session-a', collectorId: 'collector-a', taskId: 'task-a', deviceSerial: 'EGO', scenario: 'home', othersInFrame: false, sensitiveInfo: false, createdAt: '2026-09-14T12:00:00Z' }]);
  vi.mocked(nativeDeliveryStore.get).mockResolvedValue(null);
  vi.mocked(pickSessionDirectory).mockResolvedValue({
    directoryUri: 'content://session', sessionBasename: 'ego_A_20260914_120000',
    // 2.5 + 1 + 0.75 = 4.25 GiB, which prints as 4.3 GB. No single file does.
    files: [
      { relativePath: 'left.mp4', uri: 'content://session/left.mp4', bytes: 2.5 * 1024 ** 3 },
      { relativePath: 'right.mp4', uri: 'content://session/right.mp4', bytes: 1024 ** 3 },
      { relativePath: 'imu.bin', uri: 'content://session/imu.bin', bytes: 0.75 * 1024 ** 3 },
    ],
  });
  vi.mocked(runDelivery).mockImplementation(() => new Promise(() => {}));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
  const tap = async (label: string) => { await act(async () => button(label).click()); };
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale="en"><NavProvider initial={{ name: 'uploads', openDelivery: true }}><Uploads /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await tap(MESSAGES.en['uploads.byPhone']);
    await tap(MESSAGES.en['common.next']);
    await vi.waitFor(() => expect(button(MESSAGES.en['uploads.pick']).disabled).toBe(false));
    await tap(MESSAGES.en['uploads.pick']);
    await vi.waitFor(() => expect(button(MESSAGES.en['common.next'])).toBeDefined());
    await tap(`${MESSAGES.en['scenario.home']} · 2026-09-14`);
    await tap(MESSAGES.en['common.next']);
    expect(host.textContent).toContain(`${MESSAGES.en['uploads.files']}: 3`);
    expect(host.textContent).toContain(`${MESSAGES.en['prechecks.totalSize']}: 4.3 GB`);
    expect(host.textContent).toContain(MESSAGES.en['prechecks.connection'].replace('{size}', '4.3 GB'));
    // Reading the size is not confirming it: the delivery still waits for Start.
    expect(runDelivery).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); }
});

// Native illustration rendering is covered by the web captures.
vi.mock('../src/ui/illustrations/index.tsx', () => ({ EmptyTasks: () => null, ErrorMark: () => null }));


it('shows one failure sentence when both upload list queries fail', async () => {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'episodes').mockRejectedValue(new Error('offline'));
  vi.spyOn(api, 'income').mockRejectedValue(new Error('offline'));
  const host = document.createElement('div'), root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale="en"><NavProvider initial={{ name: 'uploads' }}><Uploads /></NavProvider></LocaleProvider></ApiProvider></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(host.textContent?.split(MESSAGES.en['common.loadFailed'])).toHaveLength(2);
  } finally { await act(async () => root.unmount()); client.clear(); vi.restoreAllMocks(); }
});
