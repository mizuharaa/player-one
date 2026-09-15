// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
/**
 * The gradient, recorded rather than rendered.
 *
 * `expo-linear-gradient` is a native module. The test needs to know which
 * colours the header asked for — the point of the assertion is that they are
 * the three token stops and not a fourth invented ramp — so the stub keeps
 * them where a query can find them.
 */
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ colors }: { colors: readonly string[] }) => (
    <span data-colors={colors.join(',')} />
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

it('About draws the header from the three token stops, not a fourth ramp', async () => {
  await mount(<About />);
  // SPEC.md: the gradient lives on three surfaces and is three stops in one
  // hue family. A screen that wrote its own hexes would be the fourth.
  const gradient = document.body.querySelector('[data-colors]');
  expect(gradient?.getAttribute('data-colors')).toBe(collector.gradient.join(','));
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

it('Privacy indexes its sections and restates the two declarations', async () => {
  await mount(<Privacy />);

  expect(page()).toContain(m['privacy.index']);
  for (const key of ['privacy.s1', 'privacy.s2', 'privacy.s3', 'privacy.s4'] as const) {
    // Once in the index, once as the section heading.
    expect(named(m[key])).toBeDefined();
    expect(page()).toContain(m[key]);
  }
  // The two APP-17b declarations are the whole of what a collector declares,
  // and this page says so rather than adding a third.
  expect(page()).toContain(m['privacy.s4Body']);
});

it('Privacy acknowledges the helpful answer without implying a ticket', async () => {
  await mount(<Privacy />);

  expect(page()).toContain(m['privacy.helpful']);
  await act(async () => named(m['privacy.yes'])!.click());
  expect(page()).toContain(m['privacy.thanks']);
  expect(named(m['privacy.yes'])).toBeUndefined();
});
