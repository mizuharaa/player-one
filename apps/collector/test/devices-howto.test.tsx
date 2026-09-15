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

  // Battery and last-used are not on `BoundDevice`. The rows exist and say
  // "not reported" — never a zero, a dash that could be read as empty, or a
  // guessed percentage.
  expect(page()).toContain(m['devices.battery']);
  expect(page()).toContain(m['devices.lastUsed']);
  expect(page()).toContain(m['devices.notReported']);
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
