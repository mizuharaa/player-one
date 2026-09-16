// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { HttpCollectorApi } from '../src/api/http.ts';
import type { TokenStore } from '../src/api/token-store.ts';
import { MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';

/**
 * The demo bypass entry and its sheet. Owner's request, 2026-09-16, for
 * debugging and the Thursday demonstration only.
 *
 * Two things are worth measuring and the second one is the reason this file
 * exists at all:
 *
 *   1. it works — the key goes to `POST /auth/collector/demo`, the token comes
 *      back, it is persisted, and the screen signs in through the same
 *      `onSignedIn` the Zalo and code paths use;
 *   2. **it is not there on a Play build.** A control that skips sign-in must
 *      be absent from a shipped app, not merely hidden or disabled, and the
 *      only proof of that is rendering the screen with the Play profile and
 *      finding neither the entry nor a way to open the sheet.
 *
 * Modelled on `zalo-signin.test.tsx`, including its mock set: the same three
 * native modules `ui.tsx` reaches that jsdom cannot supply.
 */

vi.mock('react-native', async () => ({ ...(await import('react-native-web')) }));
vi.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ addListener: () => ({ remove: () => {} }), status: 'idle' }),
}));
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Path: Stub, Circle: Stub, Rect: Stub, Line: Stub, G: Stub };
});
vi.mock('../src/ui.tsx', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Note: ({ text }: { text: string }) => <p role="status">{text}</p>,
  Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) => (
    <button disabled={disabled} onClick={onPress}>{label}</button>
  ),
  Field: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (t: string) => void }) => (
    <label>{label}<input aria-label={label} value={value} onChange={(e) => onChangeText(e.target.value)} /></label>
  ),
  CodeBoxes: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (t: string) => void }) => (
    <label>{label}<input aria-label={label} value={value} onChange={(e) => onChangeText(e.target.value)} /></label>
  ),
}));
vi.mock('react-native-safe-area-context', async () => ({
  initialWindowMetrics: null,
  SafeAreaInsetsContext: (await import('react')).createContext(null),
}));
vi.mock('../src/ui/HeaderGradient.tsx', () => ({
  HeaderGradient: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('expo-battery', () => ({
  isLowPowerModeEnabledAsync: async () => false,
  addLowPowerModeListener: () => ({ remove() {} }),
}));
/** Mutable so a test can flip the build profile; must be `mock`-prefixed for vi.mock's hoisting. */
let mockBuildProfile = 'demo';
vi.mock('../src/api/config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/config.ts')>();
  return { ...actual, get BUILD_PROFILE() { return mockBuildProfile; } };
});

const { SignIn } = await import('../src/screens/SignIn.tsx');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const copy = MESSAGES.vi;
const KEY = 'a'.repeat(32) + 'b'.repeat(32);

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let fetchFn: ReturnType<typeof vi.fn<typeof fetch>>;
let signedIn: ReturnType<typeof vi.fn>;
let tokens: TokenStore & { value: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  mockBuildProfile = 'demo';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  signedIn = vi.fn();
  tokens = {
    value: null,
    async get() { return this.value; },
    async set(token: string) { this.value = token; },
    async clear() { this.value = null; },
  };
  fetchFn = vi.fn<typeof fetch>();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
});

const mount = async () => {
  const api = new HttpCollectorApi('https://collector.test', tokens, () => {}, fetchFn);
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <ApiProvider value={api}>
        <LocaleProvider initialLocale="vi">
          <SignIn onSignedIn={signedIn} />
        </LocaleProvider>
      </ApiProvider>
    </QueryClientProvider>,
  ));
};

/**
 * The sheet is a core `Modal`, and `react-native-web` renders one into its own
 * portal on `document.body` rather than into the tree that opened it — so it is
 * invisible to `container.querySelector` even while it is on screen. Same note
 * as `profile-screen.test.tsx`.
 */
const page = (): string => document.body.textContent ?? '';

const control = (label: string): HTMLElement | undefined =>
  [...document.body.querySelectorAll('[aria-label],button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent === label,
  ) as HTMLElement | undefined;

const press = async (label: string) => {
  const found = control(label);
  if (found === undefined) throw new Error(`no control labelled ${label}`);
  await act(async () => found.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

const type = async (label: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`no field labelled ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

it('trades the admin key for a collector session and signs in', async () => {
  fetchFn.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/collector/demo')) {
      expect(JSON.parse(String(init?.body))).toEqual({ key: KEY });
      return json({ token: 'demo-collector-token' });
    }
    if (url.endsWith('/auth/collector/zalo/start')) return json({ error: 'zalo' }, 503);
    throw new Error(`unexpected request to ${url}`);
  });

  await mount();
  // The entry is on the screen, and nothing has been asked of the server yet.
  expect(page()).toContain(copy['demo.entry']);
  expect(fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/demo'))).toHaveLength(0);

  await press(copy['demo.entry']);
  expect(page()).toContain(copy['demo.title']);

  await type(copy['demo.key'], KEY);
  await press(copy['demo.enter']);

  expect(tokens.value).toBe('demo-collector-token');
  expect(signedIn).toHaveBeenCalledTimes(1);
  // The phone-code path is untouched and still behind the sheet.
  expect(page()).toContain(copy['signIn.sendCode']);
});

it('names a wrong key and a server with no bypass, and keeps the sheet open', async () => {
  let status = 401;
  fetchFn.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/collector/demo')) return json({ error: 'credentials' }, status);
    if (url.endsWith('/auth/collector/zalo/start')) return json({ error: 'zalo' }, 503);
    throw new Error(`unexpected request to ${url}`);
  });

  await mount();
  await press(copy['demo.entry']);
  await type(copy['demo.key'], KEY);
  await press(copy['demo.enter']);
  expect(page()).toContain(copy['demo.badKey']);
  expect(signedIn).not.toHaveBeenCalled();
  expect(tokens.value).toBeNull();

  // 404 is what a deployment with no key answers, and what a build without the
  // route at all answers. One sentence, and it does not invite another try.
  status = 404;
  await press(copy['demo.enter']);
  expect(page()).toContain(copy['demo.unavailable']);
  expect(signedIn).not.toHaveBeenCalled();
});

/**
 * The one that matters. On the Play profile the entry is ABSENT — not disabled,
 * not hidden behind a gesture — so a shipped app has no control that skips
 * sign-in, and the route is never called from it.
 */
it('is invisible and unreachable on the Play profile', async () => {
  mockBuildProfile = 'play';
  fetchFn.mockImplementation(async (input) => {
    if (String(input).endsWith('/auth/collector/zalo/start')) return json({ error: 'zalo' }, 503);
    throw new Error(`unexpected request to ${String(input)}`);
  });

  await mount();
  expect(page()).not.toContain(copy['demo.entry']);
  expect(page()).not.toContain(copy['demo.title']);
  expect(control(copy['demo.entry'])).toBeUndefined();
  expect(document.body.querySelector(`input[aria-label="${copy['demo.key']}"]`)).toBeNull();
  expect(fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/demo'))).toHaveLength(0);

  // The ordinary ways in are all still there, which is what makes the absence
  // a gate rather than a broken screen.
  expect(page()).toContain(copy['signIn.sendCode']);
  expect(control(copy['signIn.phone'])).toBeTruthy();
});
