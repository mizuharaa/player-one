// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider } from '../src/nav.tsx';
import { ThemeProvider } from '../src/theme.tsx';
import { collector } from '@playerone/design/tokens';

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));
vi.mock('react-native', async () => ({ ...(await import('react-native-web')) }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});

const { Devices } = await import('../src/screens/Devices.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const m = MESSAGES[DEFAULT_LOCALE];

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let api: MockCollectorApi;

const page = (): string => document.body.textContent ?? '';

async function mount() {
  await api.register('Nguyễn Thị Mai', '0901234567');
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <ApiProvider value={api}>
            <QueryClientProvider client={client}>
              <NavProvider initial={{ name: 'devices' }}>
                <Devices />
              </NavProvider>
            </QueryClientProvider>
          </ApiProvider>
        </LocaleProvider>
      </ThemeProvider>,
    ),
  );
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api = new MockCollectorApi();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});

it('teaches the four steps, and says the app never starts a recording', async () => {
  await mount();

  expect(page()).toContain(m['devices.howTitle']);
  for (const key of ['devices.step1', 'devices.step2', 'devices.step3', 'devices.step4'] as const) {
    expect(page()).toContain(m[key]);
  }
  // CLAUDE.md's hardest rule, on the screen a collector reads before their
  // first session: only the camera's own buttons start and stop it.
  expect(page()).toContain(m['devices.step3Body']);
});

it('offers no control that could start or stop a recording', async () => {
  await mount();

  const labels = [...document.body.querySelectorAll<HTMLElement>('[role="button"]')].map(
    (node) => (node.getAttribute('aria-label') ?? '').toLocaleLowerCase(),
  );
  for (const forbidden of ['record', 'ghi hình', 'bắt đầu ghi', 'stop', 'dừng']) {
    expect(labels.some((label) => label.includes(forbidden))).toBe(false);
  }
});

it('prints a bound serial in the tech ink and says which readings it lacks', async () => {
  await api.register('Nguyễn Thị Mai', '0901234567');
  await api.bindDevice('EGO1-PILOT-0007');
  await mount();

  expect(page()).toContain('EGO1-PILOT-0007');
  // §2 reserves tech blue for a serial and a session id. `techInk` is the
  // shade that passes on paper, which `contrast.test.ts` holds.
  const serial = [...document.body.querySelectorAll<HTMLElement>('*')].find(
    (node) => node.textContent === 'EGO1-PILOT-0007',
  );
  expect(serial?.style.color.replace(/\s/g, '')).toBe(hexToRgb(collector.techInk));

  // Unavailable telemetry is explained once, without empty property rows.
  expect(page()).not.toContain(m['devices.notReported']);
  expect(page()).toContain(m['devices.noReadings']);
  // Nothing on the card is a number this app made up: the only figures are the
  // serial and the bound-at timestamp the server sent.
  expect(page()).not.toMatch(/\d+\s*%/);
});

/** `style.color` comes back as `rgb(r, g, b)` in jsdom. */
function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}

it('shows a failed device scan and an illustrated empty result after retry', async () => {
  const { Provisioning } = await import('../src/screens/Provisioning.tsx');
  const { MockDeviceTransport } = await import('../src/device/transport.ts');
  const { TransportProvider } = await import('../src/device/transport-context.tsx');
  const transport = new MockDeviceTransport();
  vi.spyOn(transport, 'scan').mockRejectedValueOnce(new Error('Bluetooth unavailable')).mockResolvedValueOnce([]);
  await act(async () => root.render(<ThemeProvider><LocaleProvider><TransportProvider value={transport}><NavProvider initial={{ name: 'provisioning' }}><Provisioning /></NavProvider></TransportProvider></LocaleProvider></ThemeProvider>));
  const press = async (label: string) => { await act(async () => (document.querySelector(`[aria-label="${label}"]`) as HTMLElement).click()); };
  await press(m['prov.scan']);
  expect(page()).toContain(m['prov.failed']);
  expect(page()).not.toContain('Bluetooth unavailable');
  await press(m['common.retry']);
  expect(page()).toContain(m['state.empty']);
  expect(page()).not.toContain('Bluetooth unavailable');
});

it('does not let a failed bind retry bypass serial validation', async () => {
  vi.spyOn(api, 'boundDevices').mockResolvedValue([{ serial: 'EGO-BOUND', boundAt: '2026-09-15T00:00:00Z' }]);
  const bind = vi.spyOn(api, 'bindDevice').mockRejectedValue(new Error('offline'));
  await mount();
  const field = host.querySelector<HTMLInputElement>(`input[aria-label="${m['devices.typed']}"]`)!;
  const edit = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = (label: string) => [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(n => n.getAttribute('aria-label') === label)!;
  await edit('EGO-NEW'); await act(async () => button(m['devices.bind']).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  await edit(''); await act(async () => button(m['common.retry']).click());
  expect(bind).toHaveBeenCalledTimes(1);
});


it('keeps provisioning results with their device and submitted Wi-Fi settings', async () => {
  const { Provisioning } = await import('../src/screens/Provisioning.tsx');
  const { MockDeviceTransport } = await import('../src/device/transport.ts');
  const { TransportProvider } = await import('../src/device/transport-context.tsx');
  const transport = new MockDeviceTransport();
  const scan = vi.spyOn(transport, 'scan');
  await act(async () => root.render(<ThemeProvider><LocaleProvider><TransportProvider value={transport}><NavProvider initial={{ name: 'provisioning' }}><Provisioning /></NavProvider></TransportProvider></LocaleProvider></ThemeProvider>));
  const button = (label: string) => [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(n => n.getAttribute('aria-label') === label)!;
  const press = async (label: string) => act(async () => button(label).click());
  const edit = async (label: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await press(m['prov.scan']);
  await press('Ego-A1B2C3');
  await edit(m['prov.ssid'], 'Collector Wi-Fi');
  let release!: (result: { ok: boolean }) => void;
  const configure = vi.spyOn(transport, 'configureWifi').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { button(m['prov.send']).click(); button(m['prov.send']).click(); });
  expect(configure).toHaveBeenCalledTimes(1);
  expect(button(m['prov.scan']).getAttribute('aria-disabled')).toBe('true');
  expect(button('Ego-9F8E7D').getAttribute('aria-disabled')).toBe('true');
  expect(button(m['prov.readIp']).getAttribute('aria-disabled')).toBe('true');
  await act(async () => release({ ok: true }));
  expect(configure).toHaveBeenCalledWith('Collector Wi-Fi', '');
  const readIp = vi.spyOn(transport, 'requestIp').mockResolvedValue({ result: 'success', ip: '192.168.1.83' });
  await press(m['prov.readIp']);
  expect(page()).toContain('192.168.1.83');
  await edit(m['prov.password'], 'changed-password');
  expect(page()).not.toContain('192.168.1.83');
  expect(button(m['prov.readIp']).getAttribute('aria-disabled')).toBe('true');
  await press(m['prov.send']);
  await press(m['prov.readIp']);
  expect(page()).toContain('192.168.1.83');
  await press('Ego-9F8E7D');
  expect(page()).not.toContain('192.168.1.83');
  expect(button(m['prov.readIp']).getAttribute('aria-disabled')).toBe('true');

  const scansBeforeRetry = scan.mock.calls.length;
  const sendsBeforeRetry = configure.mock.calls.length;
  configure.mockResolvedValueOnce({ ok: false, reason: 'PRIVATE_SDK_CONFIG_REASON' }).mockResolvedValueOnce({ ok: true });
  await press(m['prov.send']);
  expect(page()).toContain(m['prov.failed']);
  expect(page()).not.toContain('PRIVATE_SDK_CONFIG_REASON');
  await press(m['common.retry']);
  expect(configure).toHaveBeenCalledTimes(sendsBeforeRetry + 2);
  expect(scan).toHaveBeenCalledTimes(scansBeforeRetry);
  expect(page()).not.toContain(m['prov.failed']);

  const readsBeforeRetry = readIp.mock.calls.length;
  readIp.mockResolvedValueOnce({ result: 'configure_failed', reason: 'PRIVATE_SDK_IP_REASON' });
  await press(m['prov.readIp']);
  expect(page()).toContain(m['prov.failed']);
  expect(page()).not.toContain('PRIVATE_SDK_IP_REASON');
  await press(m['common.retry']);
  expect(readIp).toHaveBeenCalledTimes(readsBeforeRetry + 2);
  expect(configure).toHaveBeenCalledTimes(sendsBeforeRetry + 2);
  expect(scan).toHaveBeenCalledTimes(scansBeforeRetry);
  expect(page()).toContain('192.168.1.83');

  const connect = vi.spyOn(transport, 'connect').mockRejectedValueOnce(new Error('PRIVATE_CONNECT_ERROR'));
  await press('Ego-A1B2C3');
  expect(page()).not.toContain('192.168.1.83');
  expect(page()).not.toContain('PRIVATE_CONNECT_ERROR');
  expect(host.querySelector(`input[aria-label="${m['prov.ssid']}"]`)).toBeNull();
  await press(m['common.retry']);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(connect).toHaveBeenLastCalledWith('DC:0D:30:A1:B2:C3');
  expect(button(m['prov.readIp']).getAttribute('aria-disabled')).toBe('true');
});
