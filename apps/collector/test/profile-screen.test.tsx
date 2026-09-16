// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../src/api/config.ts';
import { getApiOrigin, hostOf, loadApiOrigin } from '../src/api/origin.ts';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider, useNav } from '../src/nav.tsx';
import { SignOutProvider } from '../src/session.tsx';
import { ThemeProvider } from '../src/theme.tsx';

vi.mock('react-native', async () => ({ ...(await import('react-native-web')) }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  FileMode: {},
  Paths: {},
  UploadType: {},
}));
// Profile reaches `expo-image` through the preferences sheet, which lives with
// Explore. It wants a React Native `__DEV__` at module load; no photograph is
// read on this screen.
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});
/** Mutable so a test can flip the build profile; must be `mock`-prefixed for vi.mock's hoisting. */
let mockBuildProfile = 'demo';
vi.mock('../src/api/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/config.ts')>();
  return { ...actual, get BUILD_PROFILE() { return mockBuildProfile; } };
});

const { LOCALE_NAME, Profile } = await import('../src/screens/Profile.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The catalogue this screen will actually print; see onboarding-cards.test.tsx. */
const m = MESSAGES[DEFAULT_LOCALE];

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let signOut: ReturnType<typeof vi.fn>;

/**
 * Queries run against `document.body`, not the mount host.
 *
 * The sheets are core `Modal`, and `react-native-web` renders a modal into its
 * own portal appended to the body rather than into the tree that opened it —
 * so a sheet is invisible to `host.querySelector` even while it is on screen.
 */
const page = (): string => document.body.textContent ?? '';

const controls = (): HTMLElement[] => [
  ...document.body.querySelectorAll<HTMLElement>('[role="button"], [role="radio"]'),
];

const named = (name: string): HTMLElement | undefined =>
  controls().find((node) => (node.getAttribute('aria-label') ?? '').trim() === name);

const field = (label: string): HTMLInputElement | null =>
  document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

/** The native value setter, so React's own change tracking sees the edit. */
async function type(label: string, value: string) {
  const input = field(label)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })); });
}

/** `expo-secure-store` cannot load under Node; see `test/origin.test.ts`. */
function fakeOriginStore(initial: string | null = null) {
  let held = initial;
  return { get: async () => held, set: async (v: string) => { held = v; }, clear: async () => { held = null; } };
}

/**
 * A settings row by its title.
 *
 * `NavRow` announces itself as "<title>. <subtitle>" so the reader gets the
 * explanation with the name, which is why this matches on the prefix.
 */
const rowNamed = (title: string): HTMLElement | undefined =>
  controls().find((node) => (node.getAttribute('aria-label') ?? '').startsWith(title));

function RouteProbe() { return <output data-route>{useNav().route.name}</output>; }

async function mount() {
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <ApiProvider value={new MockCollectorApi()}>
            <QueryClientProvider client={client}>
              <SignOutProvider signOut={signOut}>
                <NavProvider initial={{ name: 'home' }}>
                  <Profile /><RouteProbe />
                </NavProvider>
              </SignOutProvider>
            </QueryClientProvider>
          </ApiProvider>
        </LocaleProvider>
      </ThemeProvider>,
    ),
  );
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  signOut = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
  mockBuildProfile = 'demo';
});

it('never signs out on the first tap', async () => {
  await mount();

  // The red fill opens the question; it must not end the session.
  await act(async () => named(m['profile.logOut'])!.click());
  expect(signOut).not.toHaveBeenCalled();
  expect(page()).toContain(m['profile.logOutSure']);
  expect(page()).toContain(m['profile.logOutBody']);

  // Cancel leaves the session alone and closes the sheet.
  await act(async () => named(m['common.cancel'])!.click());
  expect(signOut).not.toHaveBeenCalled();
  expect(page()).not.toContain(m['profile.logOutSure']);

  // Only the confirmation in the sheet does it.
  await act(async () => named(m['profile.logOut'])!.click());
  await act(async () => named(m['profile.logOutConfirm'])!.click());
  expect(signOut).toHaveBeenCalledTimes(1);
});

it('lists the account rows and opens each available information screen', async () => {
  await mount();

  for (const key of [
    'explore.prefsTitle',
    'devices.title',
    'profile.language',
    'profile.notifications',
    'agreements.title',
    'profile.about',
    'profile.privacy',
    'profile.help',
  ] as const) {
    expect(page()).toContain(m[key]);
  }

  // A Tier B row has no route. It answers in words rather than doing nothing,
  // and the sentence names the desk.
  for (const route of ['about', 'privacy', 'notifications'] as const) {
    await act(async () => rowNamed(m[`profile.${route}`])!.click());
    expect(host.querySelector('[data-route]')?.textContent).toBe(route);
    expect(page()).not.toContain(m['profile.notInBuild']);
  }

});

/**
 * The Server row, work order §4.10 plus the runtime origin: one TestFlight
 * build has to be pointed at a laptop today and the Vietnam cloud later, and
 * this row is the only way to point it.
 *
 * The rule the sheet is held to is the work order's: a blocking error is
 * printed with the control that caused it, not as a toast and not as a route
 * change. So a refused address leaves the sheet open, leaves the session
 * alone, and prints the reason under the field.
 */
it('shows the current server, refuses an address that is not an origin, and signs out on a change', async () => {
  await loadApiOrigin(fakeOriginStore());
  await mount();

  // The row prints host and port, not the whole URL with its scheme.
  expect(rowNamed(m['server.title'])).toBeDefined();
  expect(page()).toContain(hostOf(API_BASE_URL));

  await act(async () => rowNamed(m['server.title'])!.click());
  expect(page()).toContain(m['server.signsOut']);
  // The field opens on the origin in force, so it is edited rather than retyped.
  expect(field(m['server.address'])!.value).toBe(API_BASE_URL);

  // A path is the mistake this refuses: it would double the `/api` on every
  // route in `http.ts`.
  await type(m['server.address'], 'http://192.168.1.10:8080/api');
  await act(async () => named(m['server.save'])!.click());
  expect(page()).toContain(m['server.invalid']);
  expect(signOut).not.toHaveBeenCalled();
  expect(getApiOrigin()).toBe(API_BASE_URL);

  await type(m['server.address'], 'http://192.168.1.10:8080');
  await act(async () => named(m['server.save'])!.click());
  expect(getApiOrigin()).toBe('http://192.168.1.10:8080');
  // A token from the old server is meaningless on the new one, and the app
  // comes back to the landing door rather than the form.
  expect(signOut).toHaveBeenCalledWith({ landing: true });
});

/**
 * The Server row is a runtime-origin override, and the platform blocks what
 * it accepts on the public Play build (`usesCleartextTraffic`/
 * `NSAllowsArbitraryLoads` both false there). So the row itself must not
 * ship on that build — there is nothing recoverable behind it once the OS
 * refuses the request.
 */
it('hides the Server row on a Play build', async () => {
  mockBuildProfile = 'play';
  await mount();
  expect(rowNamed(m['server.title'])).toBeUndefined();
});

it('resets only the draft and preserves the session until Save', async () => {
  await loadApiOrigin(fakeOriginStore('http://192.168.1.10:8080'));
  await mount();
  expect(page()).toContain('192.168.1.10:8080');

  await act(async () => rowNamed(m['server.title'])!.click());
  await act(async () => named(m['server.reset'])!.click());
  expect(field(m['server.address'])!.value).toBe(API_BASE_URL);
  expect(getApiOrigin()).toBe('http://192.168.1.10:8080');
  expect(signOut).not.toHaveBeenCalled();
  await act(async () => named(m['server.save'])!.click());
  expect(getApiOrigin()).toBe(API_BASE_URL);
  expect(signOut).toHaveBeenCalledWith({ landing: true });
});

it('names the build on the version line', async () => {
  await mount();
  const { default: app } = await import('../app.json');
  // Version and platform, so a screenshot says which build it came from.
  expect(page()).toContain(`${m['profile.version']} ${app.expo.version} ·`);
});

it('switches language in the app and shows the current one on the row', async () => {
  await mount();

  // The row's value is the current locale's own name. Read from the screen's
  // own table rather than written out: the default is English now and a
  // literal 'Tiếng Việt' would assert yesterday's default.
  expect(page()).toContain(LOCALE_NAME[DEFAULT_LOCALE]);
  await act(async () => rowNamed(m['profile.language'])!.click());
  await act(async () => named('Tiếng Việt')!.click());
  // Switching updates the real screen catalogue.
  expect(page()).toContain(MESSAGES.vi['profile.logOut']);
});

it('prints the version that was built', async () => {
  await mount();
  const { default: app } = await import('../app.json');
  expect(page()).toContain(`${m['profile.version']} ${app.expo.version}`);
});

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));
