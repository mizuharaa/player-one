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
import { SignIn } from '../src/screens/SignIn.tsx';
import { resetLaunchLink } from '../src/zalo.tsx';

/**
 * "Tiếp tục với Zalo" on the sign-in screen, end to end through the real HTTP
 * client. Owner's decision, 2026-09-16.
 *
 * One test, and it is the whole hop: the control renders, pressing it asks the
 * server where to go and opens that URL, the `playerone://signed-in` link
 * comes back, the ticket is exchanged for a token and the screen signs in. A
 * render-only test would have proved the button exists and nothing about the
 * part that can actually be wrong, which is the link.
 *
 * The phone-code path is asserted to be still there, because it is the
 * fallback: `test/signin-recovery.test.tsx` owns its six recovery cases and
 * this file must not duplicate them, but a change here that removed the number
 * field would pass every one of them and still break sign-in for a collector
 * whose Zalo sign-in fails.
 */

/**
 * `vi.hoisted`, because a `vi.mock` factory is hoisted above every `const` in
 * this file and would otherwise read these in their temporal dead zone. The
 * mock and the assertions need one shared object, so it is declared where the
 * mock can see it.
 */
const link = vi.hoisted(() => ({
  opened: [] as string[],
  launchUrl: null as string | null,
  /** Replaced by whatever handler `addEventListener` was given. */
  deliver: (_url: string): void => {},
}));

vi.mock('react-native', async () => {
  const web = await import('react-native-web');
  return {
    ...web,
    /**
     * `react-native-web`'s `Linking.openURL` navigates the jsdom window and
     * its `url` event never fires, so it is replaced rather than spied on:
     * what the app does with that event is exactly this test's subject.
     */
    Linking: {
      openURL: async (url: string) => {
        link.opened.push(url);
      },
      getInitialURL: async () => link.launchUrl,
      addEventListener: (_event: string, handler: (e: { url: string }) => void) => {
        link.deliver = (url) => handler({ url });
        return { remove: () => { link.deliver = () => {}; } };
      },
    },
  };
});
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

// The same three `ui.tsx` reaches for that jsdom cannot supply, as
// `signin-recovery.test.tsx`: `expo-battery` asks the native runtime for
// `__DEV__` at module load, and insets come from the device.
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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const copy = MESSAGES.vi;
const AUTHORIZE = 'https://oauth.zaloapp.com/v4/permission?app_id=1&state=s1';

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let fetchFn: ReturnType<typeof vi.fn<typeof fetch>>;
let signedIn: ReturnType<typeof vi.fn>;
let tokens: TokenStore & { value: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  link.opened.length = 0;
  link.launchUrl = null;
  resetLaunchLink();
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

const control = (label: string): HTMLElement => {
  const found = [...container.querySelectorAll('[aria-label],button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent === label,
  );
  if (found === undefined) throw new Error(`no control labelled ${label}`);
  return found as HTMLElement;
};

const press = async (label: string) => {
  await act(async () => control(label).dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

it('opens Zalo, takes the ticket off the deep link, and signs in', async () => {
  fetchFn.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/collector/zalo/start')) return json({ url: AUTHORIZE, state: 's1' });
    if (url.endsWith('/auth/collector/ticket')) {
      expect(JSON.parse(String(init?.body))).toEqual({ ticket: 'TICKET-1' });
      return json({ token: 'collector-token' });
    }
    throw new Error(`unexpected request to ${url}`);
  });

  await mount();

  // The control, in Vietnamese, and the line that says the number below it is
  // still a way in.
  expect(container.textContent).toContain(copy['signIn.zalo']);
  expect(container.textContent).toContain(copy['signIn.zaloOr']);
  // The phone-code path is untouched and still on the screen.
  expect(control(copy['signIn.phone'])).toBeTruthy();
  expect(container.textContent).toContain(copy['signIn.sendCode']);

  await press(copy['signIn.zalo']);
  expect(link.opened).toEqual([AUTHORIZE]);
  // Nothing is signed in yet: the ticket has not come back.
  expect(signedIn).not.toHaveBeenCalled();

  await act(async () => link.deliver('playerone://signed-in?ticket=TICKET-1&state=s1'));
  expect(tokens.value).toBe('collector-token');
  expect(signedIn).toHaveBeenCalledTimes(1);

  /**
   * A second delivery of the same link — Android can hand the `url` event to a
   * screen that is already mounted — must not spend the ticket twice.
   */
  await act(async () => link.deliver('playerone://signed-in?ticket=TICKET-1&state=s1'));
  expect(fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/ticket'))).toHaveLength(1);
});

/**
 * Login-CSRF, found by both audits of `4a32929` and the worst thing in the
 * lane: the app used to redeem ANY `playerone://signed-in?ticket=…` the OS
 * handed it. `apps/collector/src/zalo.tsx` says the scheme is claimed by the
 * demo build as well as the Play build, and Android does not verify a custom
 * scheme — so a second app could hand the phone a ticket for an ATTACKER'S
 * account and the collector would be signed into it, recording under somebody
 * else's name and earning them the money.
 *
 * The state that comes back beside the ticket is compared against the one
 * stored before the browser opened. Both branches are here because only having
 * the first would pass with the check deleted.
 */
it('refuses a forwarded ticket whose state is not the one it started with', async () => {
  fetchFn.mockImplementation(async (input) => {
    if (String(input).endsWith('/auth/collector/zalo/start')) return json({ url: AUTHORIZE, state: 's1' });
    throw new Error(`unexpected request to ${String(input)}`);
  });
  await mount();
  await press(copy['signIn.zalo']);
  expect(link.opened).toEqual([AUTHORIZE]);

  // Another app's link: a real ticket shape, a state this phone never had.
  await act(async () => link.deliver('playerone://signed-in?ticket=ATTACKER-TICKET&state=forged'));
  // Nothing was sent, nothing was stored, nobody was signed in.
  expect(fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/ticket'))).toHaveLength(0);
  expect(tokens.value).toBeNull();
  expect(signedIn).not.toHaveBeenCalled();

  // A link with no state at all is the same refusal.
  await act(async () => link.deliver('playerone://signed-in?ticket=ATTACKER-TICKET-2'));
  expect(fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/ticket'))).toHaveLength(0);
  expect(signedIn).not.toHaveBeenCalled();

  /**
   * And the forgery must not have consumed the attempt: the real link arriving
   * a second later still works. A refusal that also broke the genuine sign-in
   * would be a denial of service anybody could trigger.
   */
  fetchFn.mockImplementation(async (input) => {
    if (String(input).endsWith('/auth/collector/zalo/start')) return json({ url: AUTHORIZE, state: 's1' });
    if (String(input).endsWith('/auth/collector/ticket')) return json({ token: 'collector-token' });
    throw new Error(`unexpected request to ${String(input)}`);
  });
  await act(async () => link.deliver('playerone://signed-in?ticket=TICKET-1&state=s1'));
  expect(tokens.value).toBe('collector-token');
  expect(signedIn).toHaveBeenCalledTimes(1);
});

it('says what Zalo refused, by name, and leaves the number field usable', async () => {
  fetchFn.mockImplementation(async (input) => {
    if (String(input).endsWith('/auth/collector/zalo/start')) return json({ url: AUTHORIZE, state: 's1' });
    throw new Error(`unexpected request to ${String(input)}`);
  });
  await mount();
  await press(copy['signIn.zalo']);

  await act(async () => link.deliver('playerone://signed-in?error=zalo_denied'));
  expect(container.textContent).toContain(copy['signIn.zaloDenied']);
  expect(signedIn).not.toHaveBeenCalled();
  expect(control(copy['signIn.phone'])).toBeTruthy();
});

it('hides the control on a deployment with no Zalo app, rather than offering it twice', async () => {
  fetchFn.mockImplementation(async (input) => {
    if (String(input).endsWith('/auth/collector/zalo/start')) return json({ error: 'zalo' }, 503);
    throw new Error(`unexpected request to ${String(input)}`);
  });
  await mount();
  expect(container.textContent).toContain(copy['signIn.zalo']);

  await press(copy['signIn.zalo']);
  expect(link.opened).toEqual([]);
  expect(container.textContent).not.toContain(copy['signIn.zalo']);
  // And the number is still there, which is the whole point of hiding it.
  expect(control(copy['signIn.phone'])).toBeTruthy();
});
