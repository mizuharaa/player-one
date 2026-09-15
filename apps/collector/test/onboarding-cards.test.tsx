// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider } from '../src/nav.tsx';
import { ThemeProvider } from '../src/theme.tsx';

// The real screen, over the DOM: `react-native`'s published source is Flow and
// vitest cannot parse it, and `react-native-web` implements the same surface.
// Same substitution as `ui-kit.test.tsx` and for the same reason.
vi.mock('react-native', async () => ({ ...(await import('react-native-web')) }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
// `guide/seen.ts` is the keystore flag behind the tour offer. It is a native
// module and cannot load under node, so it answers "not offered yet" here.
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
// The drawings are `react-native-svg`, whose web build is not what the phone
// runs. They are decorative and hidden from the accessibility tree, so what
// they render here does not matter — only that they render.
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});

const { Onboarding } = await import('../src/screens/Onboarding.tsx');
const { GuideProvider } = await import('../src/guide/Guide.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/**
 * The catalogue the screen will actually print.
 *
 * Read off `DEFAULT_LOCALE` rather than pinned to `en`: the default is `vi`
 * today and the lane changes it to `en`, and a test that hard-codes one of
 * them fails on that change while proving nothing about this screen.
 */
const m = MESSAGES[DEFAULT_LOCALE];

const buttonNamed = (name: string): HTMLElement | undefined =>
  [...host.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === name,
  );

async function mount(onDone: () => void) {
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <NavProvider initial={{ name: 'home' }}>
            <GuideProvider>
              <Onboarding onDone={onDone} />
            </GuideProvider>
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

it('offers three cards and only reaches the tour from the last one', async () => {
  const done = vi.fn();
  await mount(done);

  // All three headlines exist — the pager holds them, so the third one's
  // promise about payment is present from the start and not built later.
  for (const key of ['onboarding.findTitle', 'onboarding.wearTitle', 'onboarding.paidTitle'] as const) {
    expect(host.textContent).toContain(m[key]);
  }

  // Card 1 and 2 commit with Next; the tour label appears only on card 3.
  expect(buttonNamed(m['common.next'])).toBeDefined();
  expect(buttonNamed(m['onboarding.tour'])).toBeUndefined();
  await act(async () => buttonNamed(m['common.next'])!.click());
  expect(buttonNamed(m['onboarding.tour'])).toBeUndefined();
  await act(async () => buttonNamed(m['common.next'])!.click());

  const tour = buttonNamed(m['onboarding.tour']);
  expect(tour).toBeDefined();
  expect(done).not.toHaveBeenCalled();
  await act(async () => tour!.click());
  // The handover runs, so Home is mounted before the coach marks look for the
  // targets they are about to point at.
  expect(done).toHaveBeenCalledTimes(1);
});

it('lets Skip leave without taking the tour, and asks for no consent', async () => {
  const done = vi.fn();
  await mount(done);

  await act(async () => buttonNamed(m['onboarding.skip'])!.click());
  expect(done).toHaveBeenCalledTimes(1);

  // CLAUDE.md: no collector consent beyond APP-17b, which lives on Prepare.
  // Nothing here may be a checkbox, a switch or an agreement sentence.
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  expect(host.textContent).not.toContain(m['agreements.title']);
});

it('says which card it is on through one adjustable control', async () => {
  await mount(() => {});
  // `react-native-web` maps `accessibilityRole="adjustable"` to the ARIA
  // slider role (`propsToAriaRole.js`); on the phone it is the adjustable
  // trait. Same control either way.
  const dots = host.querySelector<HTMLElement>('[role="slider"]');
  expect(dots).not.toBeNull();
  expect(dots?.getAttribute('aria-label')).toBe(m['onboarding.progress']);
  // One control, not three: nothing inside it carries a role of its own, so
  // the reader stops here once and reads the position instead of "dot, dot,
  // dot". (`importantForAccessibility="no"` is the phone's half of that and
  // `react-native-web` does not model it.)
  //
  // `accessibilityValue.text` — the card's own headline — is not asserted:
  // `react-native-web` does not forward it to `aria-valuetext`, so the harness
  // cannot see the value the phone announces. Fable's device pass is where
  // that is heard.
  expect(dots?.querySelectorAll('[role]').length).toBe(0);
});

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));
