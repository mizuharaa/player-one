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
const { ApiProvider } = await import('../src/api/context.tsx');
const { MockCollectorApi } = await import('../src/api/mock.ts');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { dong, quantity } = await import('../src/money.ts');
const { ApiError } = await import('../src/api/types.ts');
type Api = InstanceType<typeof MockCollectorApi>;

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

/**
 * The live screen reads through the api context, so both paths are mounted
 * inside it — the preview path too, because `useApi` is a hook and a hook does
 * not get to be conditional. Retries off: a test that asserts the unavailable
 * state must not wait out three backoffs first.
 */
async function mount(preview = true, api: Api = new MockCollectorApi()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ApiProvider value={api}>
          <ThemeProvider>
            <LocaleProvider>
              <NavProvider initial={{ name: 'home' }}>
                <Notifications previewItems={preview ? NOTIFICATION_PREVIEW : undefined} />
              </NavProvider>
            </LocaleProvider>
          </ThemeProvider>
        </ApiProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
}

/**
 * Let the first read land.
 *
 * react-query resolves through more than one microtask turn — the query
 * function, then the cache write, then the re-render — so a single
 * `await Promise.resolve()` leaves the screen on `Loading…` and a test asserting
 * about the empty state passes or fails on timing. A handful of macrotask turns
 * is what actually settles it; ten is generous and costs nothing.
 */
async function settle() {
  for (let n = 0; n < 10; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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
  // The live screen shows the SERVER's rows. None of them is a fixture row,
  // and the simulation label is not printed over real events.
  for (const row of NOTIFICATION_PREVIEW) expect(page()).not.toContain(row.title);
  expect(page()).not.toContain(m['common.simulation']);
  await act(async () => named(m['notif.settings'])!.click());
  const push = named(`${m['notif.groupReview']} — ${m['notif.push']}`)!;
  expect(push.getAttribute('aria-disabled')).toBe('true');
  await act(async () => push.click());
  expect(push.getAttribute('aria-checked')).toBe('false');
});

/* ── The live read ──────────────────────────────────────────────────────── */

it("renders the server's rows, and every figure on them is the server's own string", async () => {
  const api = new MockCollectorApi();
  const rows = await api.notifications();
  await mount(false, api);

  for (const row of rows) expect(page()).toContain(m[`notif.${row.kind}` as keyof typeof m]);

  /**
   * The two money-bearing rows in the fixture. Both figures are printed from
   * the payload string — `49800` and `32400.0000` — so a screen that had
   * started doing arithmetic would print something else here.
   */
  expect(page()).toContain(dong('49800'));
  expect(page()).toContain('ZP-772140');
  expect(page()).toContain(dong('32400.0000'));
  expect(page()).toContain(`${m['income.minutes']} ${quantity('27.000000')}`);

  // Two of the four are unread, so the control that clears them is offered,
  // and clearing them goes to the server rather than to local state.
  expect(named(m['notif.markAllRead'])).toBeDefined();
  await act(async () => named(m['notif.markAllRead'])!.click());
  await settle();
  expect((await api.notifications()).filter((n) => n.readAt === null)).toEqual([]);
  expect(named(m['notif.markAllRead'])).toBeUndefined();
});

it('says "nothing yet" only when the server answered with nothing', async () => {
  class Empty extends MockCollectorApi {
    override async notifications() {
      return [];
    }
  }
  await mount(false, new Empty());
  expect(page()).toContain(m['notif.emptyTitle']);
  expect(page()).toContain(m['notif.emptyBody']);
  expect(named(m['notif.markAllRead'])).toBeUndefined();
});

it('says it could not load rather than claiming the inbox is empty', async () => {
  class Broken extends MockCollectorApi {
    override async notifications(): Promise<never> {
      throw new ApiError('server_error');
    }
  }
  await mount(false, new Broken());
  // The distinction is the point: "nothing yet" is a claim about what the
  // server said, and the server said nothing at all.
  expect(page()).toContain(m['common.loadFailed']);
  expect(page()).not.toContain(m['notif.emptyTitle']);
  expect(named(m['common.retry'])).toBeDefined();
  // And the honest sentence about push is still there underneath.
  expect(page()).toContain(m['notif.noPush']);
});

it('labels sample inbox and settings as a simulation', async () => {
  await mount();
  expect(page()).toContain(m['common.simulation']);
  await act(async () => named(m['notif.settings'])!.click());
  expect(page()).toContain(m['common.simulation']);
});
