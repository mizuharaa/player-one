// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider, useNav } from '../src/nav.tsx';
import { ThemeProvider, polish } from '../src/theme.tsx';
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
/**
 * The gradient, recorded rather than rendered.
 *
 * `expo-linear-gradient` is a native module. The test needs to know which
 * colours the header asked for — the point of the assertion is that they are
 * the three token stops and not a fourth invented ramp — so the stub keeps
 * them where a query can find them.
 */
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ colors, children }: { colors: readonly string[]; children: ReactNode }) => (
    <span data-colors={colors.join(',')}>{children}</span>
  ),
}));

const { About } = await import('../src/screens/About.tsx');
const { Privacy } = await import('../src/screens/Privacy.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const m = MESSAGES[DEFAULT_LOCALE];

let host: HTMLDivElement;
let root: Root;

const page = (): string => document.body.textContent ?? '';

const named = (name: string): HTMLElement | undefined =>
  [...document.body.querySelectorAll<HTMLElement>('[role="button"], [role="link"]')].find(
    (node) => (node.getAttribute('aria-label') ?? '').trim() === name,
  );

async function mount(node: ReactNode) {
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <NavProvider initial={{ name: 'home' }}>{node}</NavProvider>
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

it('About names both companies, what the app is for, and the build', async () => {
  await mount(<About />);

  expect(page()).toContain(m['splash.partners']);
  expect(page()).toContain(m['about.whatBody']);
  expect(page()).toContain(m['about.whoBody']);

  const { default: app } = await import('../app.json');
  expect(page()).toContain(`${m['profile.version']} ${app.expo.version}`);
  expect(page()).toContain(m['about.build']);
});

it('About keeps a paper header; the lavender wash belongs only to Home', async () => {
  await mount(<About />);
  expect(document.querySelector('[data-testid="home-header-wash"]')).toBeNull();
});

it('About only offers the document that has a screen', async () => {
  const onPrivacy = vi.fn();
  await mount(<About onPrivacy={onPrivacy} />);

  const row = [...document.body.querySelectorAll<HTMLElement>('[role="button"]')].find((node) =>
    (node.getAttribute('aria-label') ?? '').startsWith(m['legal.privacy']),
  );
  expect(row).toBeDefined();
  await act(async () => row!.click());
  expect(onPrivacy).toHaveBeenCalledTimes(1);

  // `legal.dataNotice` is a name with no screen behind it, so it is not a row.
  expect(page()).not.toContain(m['legal.dataNotice']);
});

it('Privacy authors no legal copy of its own', async () => {
  const { AGREEMENTS } = await import('../src/api/types.ts');
  await mount(<Privacy />);

  expect(page()).toContain(m['privacy.index']);
  // Every word of substance is copy the app already shipped: the intro, the
  // six agreement names with the versions the server's own constraint closes
  // over, and the two APP-17b declarations.
  expect(page()).toContain(m['agreements.intro']);
  for (const agreement of AGREEMENTS) {
    expect(page()).toContain(m[`agreement.${agreement.id}`]);
    expect(page()).toContain(`${m['agreements.version']} ${agreement.version}`);
  }
  expect(page()).toContain(m['session.othersTitle']);
  expect(page()).toContain(m['session.sensitiveTitle']);

  // Both sections are reachable from the index.
  expect(named(m['agreements.title'])).toBeDefined();
  expect(named(m['session.declare'])).toBeDefined();
});

it('Privacy offers the agreements screen when the caller can open it', async () => {
  const onAgreements = vi.fn();
  await mount(<Privacy onAgreements={onAgreements} />);

  // The full text and the record of acceptance live there, not here.
  const open = [...document.body.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (node) => (node.getAttribute('aria-label') ?? '') === m['agreements.title'],
  );
  expect(open).toBeDefined();
  await act(async () => open!.click());
  expect(onAgreements).toHaveBeenCalledTimes(1);
});

it('Privacy acknowledges the helpful answer without implying a ticket', async () => {
  await mount(<Privacy />);

  expect(page()).toContain(m['privacy.helpful']);
  await act(async () => named(m['privacy.yes'])!.click());
  expect(page()).toContain(m['privacy.thanks']);
  expect(named(m['privacy.yes'])).toBeUndefined();
});


it('Privacy provides a visible return control after opening from Profile', async () => {
  function Journey() {
    const nav = useNav();
    return nav.route.name === 'privacy' ? <Privacy /> : <button onClick={() => nav.push({ name: 'privacy' })}>Open privacy</button>;
  }
  await mount(<Journey />);
  await act(async () => host.querySelector('button')!.click());
  expect(named(m['common.back'])).toBeDefined();
  await act(async () => named(m['common.back'])!.click());
  expect(page()).toContain('Open privacy');
});

it('About opens the existing language picker and applies the selected language', async () => {
  await mount(<About />);
  const language = [...document.body.querySelectorAll<HTMLElement>('[role="button"]')].find(node => node.getAttribute('aria-label')?.startsWith(m['profile.language']));
  await act(async () => language!.click());
  await act(async () => document.body.querySelector<HTMLElement>('[role="radio"][aria-label="Tiếng Việt"]')!.click());
  expect(page()).toContain(MESSAGES.vi['profile.about']);
  expect(document.body.querySelector('[role="radio"]')).toBeNull();
});

it('shows the bundled photo authors and licenses in About', async () => {
  await mount(<About />);
  await act(async () => named(m['photos.title'])!.click());
  for (const author of ['Ann0611', 'amanderson2', 'Axisadman', 'Frank McKenna']) expect(page()).toContain(author);
  expect(page()).toContain(m['photos.edited']);
  expect(document.querySelectorAll('[role="link"]').length).toBeGreaterThanOrEqual(8);
});

it('Home draws its wash from the three design token stops', async () => {
  const { HeaderGradient } = await import('../src/ui/HeaderGradient.tsx');
  await mount(<HeaderGradient>Home</HeaderGradient>);
  expect(document.body.querySelector('[data-colors]')?.getAttribute('data-colors')).toBe(polish.homeGradient.join(','));
});
