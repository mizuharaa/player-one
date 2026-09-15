// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider } from '../src/nav.tsx';
import { MESSAGES } from '../src/i18n.ts';
import { SessionCreate } from '../src/screens/SessionCreate.tsx';
import { getBatteryLevelAsync, isLowPowerModeEnabledAsync } from 'expo-battery';
import { freeDiskBytes } from '../src/upload/delivery-native.ts';

/**
 * APP-19: the Prepare screen's phone precheck.
 *
 * It is a warning and never a gate, so the assertions are in two halves —
 * the facts are printed, and the warning appears only under the threshold
 * while the step's own control stays usable either way. The three readings are
 * mocked per test because the real ones are a handset's.
 */
vi.mock('react-native', async () => ({ ...await import('react-native-web') }));
vi.mock('expo-battery', () => ({ getBatteryLevelAsync: vi.fn(), isLowPowerModeEnabledAsync: vi.fn() }));
vi.mock('../src/upload/delivery-native.ts', () => ({ freeDiskBytes: vi.fn() }));
// Prepare reaches the how-to illustrations through `SessionReminder`; both of
// these want the native runtime at module load and neither draws a fact.
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});
vi.mock('../src/ui.tsx', () => ({
  // `ui/Toast.tsx` imports these two off `ui.tsx`, so the mock has to carry them.
  face: () => 'sans-serif',
  useInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  Screen: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) =>
    <section><h1>{title}</h1>{children}{footer}</section>,
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Row: ({ label, value }: { label: string; value: string }) => <p>{label}: {value}</p>,
  Note: ({ text }: { text: string }) => <p role="status">{text}</p>,
  Loading: () => <p>Loading</p>,
  Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) =>
    <button disabled={disabled} onClick={onPress}>{label}</button>,
  Choice: ({ label, onPress }: { label: string; onPress: () => void }) => <button onClick={onPress}>{label}</button>,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const en = MESSAGES.en;

const SERIAL = 'EGO-TEST-1';

/**
 * Walk Prepare to the device step, which is the one before the declarations.
 *
 * The claim and the bound device are spied rather than seeded: `claimTask`
 * runs the mock's whole eligibility gate (onboarded, agreements, training,
 * exam) and none of that is what this file is about.
 */
async function atDeviceStep(host: HTMLElement) {
  const api = new MockCollectorApi();
  vi.spyOn(api, 'myClaims').mockResolvedValue([{ id: 'claim-1', taskId: 'task-cook', claimedAt: '2026-09-15T02:00:00Z' }]);
  vi.spyOn(api, 'boundDevices').mockResolvedValue([{ serial: SERIAL, boundAt: '2026-09-15T02:00:00Z', status: 'active' }]);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
  await act(async () => root.render(<QueryClientProvider client={client}><ApiProvider value={api}>
    <LocaleProvider initialLocale="en"><NavProvider initial={{ name: 'sessionCreate' }}><SessionCreate /></NavProvider></LocaleProvider>
  </ApiProvider></QueryClientProvider>));
  await act(async () => { await vi.waitFor(() => expect(button("Nấu ăn tại nhà")).toBeDefined()); });
  await act(async () => button('Nấu ăn tại nhà').click());
  await act(async () => button(en['common.next']).click());
  await act(async () => button(en['scenario.home']).click());
  await act(async () => button(en['common.next']).click());
  return { root, client, button };
}

it('prints the phone battery and free space as facts, and warns under neither threshold', async () => {
  vi.mocked(getBatteryLevelAsync).mockResolvedValue(0.82);
  vi.mocked(isLowPowerModeEnabledAsync).mockResolvedValue(false);
  vi.mocked(freeDiskBytes).mockReturnValue(Math.round(12.4 * 1024 ** 3));
  const host = document.createElement('div'); document.body.append(host);
  const { root, client, button } = await atDeviceStep(host);
  try {
    await act(async () => { await vi.waitFor(() => expect(host.textContent).toContain(`${en['prechecks.phoneBattery']}: 82%`)); });
    expect(host.textContent).toContain(`${en['prechecks.phoneFree']}: 12.4 GB`);
    // The camera is not this screen's to read, and the copy says so.
    expect(host.textContent).toContain(en['prechecks.camera']);
    expect(Array.from(host.querySelectorAll('[role="status"]')).map(n => n.textContent)).toEqual([]);
    // Not a gate: the step's own control is the only thing that decides Next.
    expect(button(en['common.next']).disabled).toBe(true);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});

it('warns inline on a low battery, battery saver and low space, and still lets the session be created', async () => {
  vi.mocked(getBatteryLevelAsync).mockResolvedValue(0.11);
  vi.mocked(isLowPowerModeEnabledAsync).mockResolvedValue(true);
  vi.mocked(freeDiskBytes).mockReturnValue(1.5 * 1024 ** 3);
  const host = document.createElement('div'); document.body.append(host);
  const { root, client, button } = await atDeviceStep(host);
  try {
    await act(async () => { await vi.waitFor(() => expect(host.textContent).toContain(en['prechecks.lowBattery'])); });
    const warning = host.querySelector('[role="status"]')!.textContent;
    expect(warning).toContain(en['prechecks.lowPower']);
    expect(warning).toContain(en['prechecks.lowSpace']);
    expect(host.textContent).toContain(`${en['prechecks.phoneBattery']}: 11% · ${en['prechecks.saverOn']}`);
    expect(host.textContent).toContain(`${en['prechecks.phoneFree']}: 1.5 GB`);
    // Picking the device is still all it takes to move on past a warning.
    await act(async () => button(SERIAL).click());
    expect(button(en['common.next']).disabled).toBe(false);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});

it('says the reading is unavailable rather than printing a zero', async () => {
  vi.mocked(getBatteryLevelAsync).mockResolvedValue(-1);
  vi.mocked(isLowPowerModeEnabledAsync).mockResolvedValue(false);
  vi.mocked(freeDiskBytes).mockReturnValue(null);
  const host = document.createElement('div'); document.body.append(host);
  const { root, client } = await atDeviceStep(host);
  try {
    await act(async () => { await vi.waitFor(() => expect(host.textContent).toContain(`${en['prechecks.phoneBattery']}: ${en['prechecks.unknown']}`)); });
    expect(host.textContent).toContain(`${en['prechecks.phoneFree']}: ${en['prechecks.unknown']}`);
    expect(host.textContent).not.toContain('0.0 GB');
    expect(Array.from(host.querySelectorAll('[role="status"]')).map(n => n.textContent)).toEqual([]);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
