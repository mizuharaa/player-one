// @vitest-environment jsdom
import { NOTIFICATION_PREVIEW } from '../web/notification-preview.ts';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider } from '../src/nav.tsx';
import { ThemeProvider } from '../src/theme.tsx';

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

const { Notifications } = await import('../src/screens/Notifications.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const m = MESSAGES[DEFAULT_LOCALE];

let host: HTMLDivElement;
let root: Root;

const page = (): string => document.body.textContent ?? '';

const named = (name: string): HTMLElement | undefined =>
  [...document.body.querySelectorAll<HTMLElement>('[role="button"], [role="switch"]')].find(
    (node) => (node.getAttribute('aria-label') ?? '').trim() === name,
  );

async function mount(preview = true) {
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <NavProvider initial={{ name: 'home' }}>
            <Notifications previewItems={preview ? NOTIFICATION_PREVIEW : undefined} />
          </NavProvider>
        </LocaleProvider>
      </ThemeProvider>,
    ),
  );
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it('groups the inbox by day and marks the unread ones', async () => {
  await mount();

  expect(page()).toContain(m['notif.today']);
  expect(page()).toContain(m['notif.earlier']);
  // Two of the four fixture rows are unread, so the control that clears them
  // is offered; the state is spoken, not only drawn as a dot.
  expect(named(m['notif.markAllRead'])).toBeDefined();
  expect(
    [...document.body.querySelectorAll('[aria-label]')].some((node) =>
      (node.getAttribute('aria-label') ?? '').startsWith(m['notif.unread']),
    ),
  ).toBe(true);

  await act(async () => named(m['notif.markAllRead'])!.click());
  expect(named(m['notif.markAllRead'])).toBeUndefined();
});

it('never claims a push channel it does not have', async () => {
  await mount();
  // The work order's "Not built" list names push transport. The screen says so
  // rather than showing settings that imply messages are on their way.
  expect(page()).toContain(m['notif.noPush']);
});

it('opens grouped Email and Push toggles, each one named', async () => {
  await mount();
  await act(async () => named(m['notif.settings'])!.click());

  expect(page()).toContain(m['notif.settingsIntro']);
  for (const group of ['notif.groupReview', 'notif.groupPayment', 'notif.groupSession'] as const) {
    expect(page()).toContain(m[group]);
    // "Push" six times on one screen names nothing, so a switch is announced
    // with the group it belongs to.
    expect(named(`${m[group]} — ${m['notif.push']}`)).toBeDefined();
    expect(named(`${m[group]} — ${m['notif.email']}`)).toBeDefined();
  }

  const push = named(`${m['notif.groupReview']} — ${m['notif.push']}`)!;
  expect(push.getAttribute('aria-checked')).toBe('false');
  await act(async () => push.click());
  expect(
    named(`${m['notif.groupReview']} — ${m['notif.push']}`)!.getAttribute('aria-checked'),
  ).toBe('true');
});

it('states no amount on a payment notification', async () => {
  await mount();
  // A figure on a payment message would be money this app invented; every
  // amount comes from the server and lives on Income.
  expect(page()).not.toMatch(/\d[\d.]*\s*₫/);
});

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));

it('keeps sample events and enabled channels out of the live screen', async () => {
  await mount(false);
  expect(page()).toContain(m['notif.emptyTitle']);
  expect(named(m['notif.markAllRead'])).toBeUndefined();
  for (const row of NOTIFICATION_PREVIEW) expect(page()).not.toContain(row.title);
  await act(async () => named(m['notif.settings'])!.click());
  const push = named(`${m['notif.groupReview']} — ${m['notif.push']}`)!;
  expect(push.getAttribute('aria-disabled')).toBe('true');
  await act(async () => push.click());
  expect(push.getAttribute('aria-checked')).toBe('false');
});

it('labels sample inbox and settings as a simulation', async () => {
  await mount();
  expect(page()).toContain(m['common.simulation']);
  await act(async () => named(m['notif.settings'])!.click());
  expect(page()).toContain(m['common.simulation']);
});
