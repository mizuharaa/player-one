// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { ThemeProvider } from '../src/theme.tsx';
import { Landing } from '../src/screens/Landing.tsx';
import { Panda } from '../src/identity/Panda.tsx';

// Mocked React Native and expo-video prove the screen's LOGIC — which frame is
// drawn, when the player is told to play or pause, what the buttons do — not
// native rendering. The handset is the only rendering evidence.
const native = vi.hoisted(() => ({
  reduced: false,
  appState: 'active' as string,
  appListeners: [] as ((s: string) => void)[],
  player: { loop: false, muted: false, staysActiveInBackground: true, play: vi.fn(), pause: vi.fn(),
    listeners: [] as ((p: { status: string }) => void)[],
    addListener(_: string, cb: (p: { status: string }) => void) { this.listeners.push(cb); return { remove: () => {} }; } },
}));
vi.mock('react-native', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  class Value { v: number; constructor(v: number) { this.v = v; } setValue(v: number) { this.v = v; } interpolate() { return this; } }
  const done = { start: (cb?: () => void) => cb?.(), stop: () => {} };
  return {
    View: Box, ScrollView: Box,
    Text: ({ children, ...p }: { children?: ReactNode; accessibilityRole?: string }) => <span role={p.accessibilityRole === 'header' ? 'heading' : undefined}>{children}</span>,
    Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => <img alt={accessibilityLabel} />,
    Pressable: ({ children, onPress, accessibilityLabel }: { children?: ReactNode; onPress?: () => void; accessibilityLabel?: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
    StyleSheet: { absoluteFill: {}, absoluteFillObject: {} },
    Platform: { OS: 'android' },
    useColorScheme: () => 'light',
    Easing: { bezier: () => () => 0, inOut: () => () => 0, out: () => () => 0, quad: () => 0 },
    Animated: { Value, View: Box, ScrollView: Box, timing: () => done, loop: () => done, sequence: () => done, delay: () => done,
      spring: () => done, multiply: (a: unknown) => a, add: (a: unknown) => a, event: () => () => {} },
    AccessibilityInfo: { isReduceMotionEnabled: async () => native.reduced, addEventListener: () => ({ remove() {} }) },
    AppState: { get currentState() { return native.appState; },
      addEventListener: (_: string, cb: (s: string) => void) => { native.appListeners.push(cb); return { remove() {} }; } },
  };
});
vi.mock('expo-video', () => ({
  useVideoPlayer: (_: unknown, setup?: (p: typeof native.player) => void) => { setup?.(native.player); return native.player; },
  VideoView: () => <div data-testid="video" />,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  initialWindowMetrics: null,
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));
vi.mock('../src/ui.tsx', () => ({
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => <button onClick={onPress}>{label}</button>,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const onSignIn = vi.fn();
const vi_ = MESSAGES.vi;

async function mount() {
  await act(async () => root.render(<LocaleProvider><ThemeProvider><Landing onSignIn={onSignIn} /></ThemeProvider></LocaleProvider>));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
const text = () => container.textContent ?? '';
const video = () => container.querySelector('[data-testid="video"]');

beforeEach(() => {
  native.reduced = false; native.appState = 'active'; native.appListeners.length = 0; native.player.listeners.length = 0;
  native.player.play.mockReset(); native.player.pause.mockReset(); onSignIn.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('landing: film, beats, sheet', () => {
  it('plays the bundled film muted and looping, with the poster underneath and the three beats mounted', async () => {
    await mount();
    expect(native.player.loop).toBe(true);
    expect(native.player.muted).toBe(true);
    expect(native.player.staysActiveInBackground).toBe(false);
    expect(native.player.play).toHaveBeenCalled();
    expect(video()).not.toBeNull();
    expect(container.querySelector(`img[alt="${vi_['landing.videoLabel']}"]`)).not.toBeNull();
    for (const k of ['landing.slogan1', 'landing.slogan2', 'landing.slogan3'] as const) expect(text()).toContain(vi_[k]);
  });

  it('under "remove animations" shows the still frame: poster only, all three sentences, player paused', async () => {
    native.reduced = true;
    await mount();
    expect(video()).toBeNull();
    expect(native.player.pause).toHaveBeenCalled();
    expect(native.player.play).not.toHaveBeenCalled();
    for (const k of ['landing.slogan1', 'landing.slogan2', 'landing.slogan3'] as const) expect(text()).toContain(vi_[k]);
  });

  it('pauses when the app goes to the background and resumes when it returns', async () => {
    await mount();
    expect(native.player.play).toHaveBeenCalledTimes(1);
    await act(async () => native.appListeners.forEach((cb) => cb('background')));
    expect(native.player.pause).toHaveBeenCalled();
    expect(video()).toBeNull();
    await act(async () => native.appListeners.forEach((cb) => cb('active')));
    expect(native.player.play).toHaveBeenCalledTimes(2);
    expect(video()).not.toBeNull();
  });

  it('falls back to the poster for good when the player reports an error', async () => {
    await mount();
    await act(async () => native.player.listeners.forEach((cb) => cb({ status: 'error' })));
    expect(video()).toBeNull();
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('both sheet actions are stationary controls that lead to sign-in, and the legal line is a plain notice', async () => {
    await mount();
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain(vi_['landing.signIn']);
    expect(buttons).toContain(vi_['landing.register']);
    await act(async () => { for (const b of container.querySelectorAll('button')) (b as HTMLButtonElement).click(); });
    expect(onSignIn).toHaveBeenCalledTimes(2);
    expect(text()).toContain(vi_['legal.dataNotice']);
    expect(text()).toContain(vi_['legal.privacy']);
    // The legal names are text, not controls: no button carries them.
    for (const b of container.querySelectorAll('button')) {
      expect(b.textContent).not.toContain(vi_['legal.dataNotice']);
      expect(b.textContent).not.toContain(vi_['legal.privacy']);
    }
    expect(text()).toContain(vi_['landing.sheetTitle']);
    expect(text()).toContain(vi_['landing.registerNote']);
  });
});

describe('panda: hooks are unconditional', () => {
  it('survives reduce-motion resolving to false after the first render, and stops when backgrounded', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    await act(async () => root.render(<LocaleProvider><ThemeProvider><Panda size={64} /></ThemeProvider></LocaleProvider>));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await act(async () => native.appListeners.forEach((cb) => cb('background')));
    await act(async () => native.appListeners.forEach((cb) => cb('active')));
    spy.mockRestore();
    expect(errors.filter((e) => String(e).includes('Hooks'))).toEqual([]);
    expect(container.childElementCount).toBeGreaterThan(0);
  });
});
