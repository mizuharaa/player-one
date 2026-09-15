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
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});

const { Profile } = await import('../src/screens/Profile.tsx');

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

/**
 * A settings row by its title.
 *
 * `NavRow` announces itself as "<title>. <subtitle>" so the reader gets the
 * explanation with the name, which is why this matches on the prefix.
 */
const rowNamed = (title: string): HTMLElement | undefined =>
  controls().find((node) => (node.getAttribute('aria-label') ?? '').startsWith(title));

async function mount() {
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <ApiProvider value={new MockCollectorApi()}>
            <QueryClientProvider client={client}>
              <SignOutProvider signOut={signOut}>
                <NavProvider initial={{ name: 'home' }}>
                  <Profile />
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

it('lists the seven rows the owner asked for, and answers the ones with no screen', async () => {
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
  expect(page()).not.toContain(m['profile.notInBuild']);
  await act(async () => rowNamed(m['profile.about'])!.click());
  expect(page()).toContain(m['profile.notInBuild']);
});

it('switches language in the app and shows the current one on the row', async () => {
  await mount();

  // The row's value is the locale's own name, so it is the same word in every
  // catalogue and the picker lists endonyms.
  expect(page()).toContain('Tiếng Việt');
  await act(async () => rowNamed(m['profile.language'])!.click());
  await act(async () => named('English')!.click());
  // English is now what the screen prints, whatever the default was.
  expect(page()).toContain(MESSAGES.en['profile.logOut']);
});

it('prints the version that was built', async () => {
  await mount();
  const { default: app } = await import('../app.json');
  expect(page()).toContain(`${m['profile.version']} ${app.expo.version}`);
});

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));
