import { ThemeProvider, polish, useTheme } from '../src/theme.tsx';
import { MotionProvider } from '../src/ui/motion.ts';
// @vitest-environment jsdom
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { NavProvider } from '../src/nav.tsx';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';
import { ToastProvider, useToast } from '../src/ui/Toast.tsx';
import { Splash } from '../src/screens/Splash.tsx';
import { Button, Film, Header, LegalLine, Note, Progress, Screen, ListScreen, useTabBarReserve } from '../src/ui.tsx';
import { VideoView, useVideoPlayer } from 'expo-video';
import { isLowPowerModeEnabledAsync } from 'expo-battery';

vi.mock('react-native', async () => ({ ...await import('react-native-web'),
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false), addEventListener: () => ({ remove() {} }) },
}));
vi.mock('expo-video', () => ({ VideoView: vi.fn(() => null), useVideoPlayer: vi.fn(() => ({ status: 'idle', addListener: () => ({ remove() {} }) })) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('shows activity and a visible track while the first file is still sending', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<Progress label="Sending" value="0/1 files" fraction={0} busy />));
    const bars = host.querySelectorAll<HTMLElement>('[role="progressbar"]');
    expect(bars.length).toBe(2); // Activity indicator plus the measured-file track.
    const progress = bars[1]!;
    expect(progress.style.backgroundColor).toBe('rgb(184, 194, 185)');
    expect((progress.firstElementChild as HTMLElement).style.backgroundColor).toBe('rgb(32, 40, 39)');
    expect((progress.firstElementChild as HTMLElement).style.width).toBe('0%');
    expect(host.textContent).toContain('0/1 files');
  } finally { await act(async () => root.unmount()); }
});

it('blocks repeat presses while busy and keeps a blocking error visible until retry', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const submit = vi.fn();
  const retry = vi.fn();
  try {
    await act(async () => root.render(<>
      <Button label="Accept" variant="affirmative" busy onPress={submit} />
      <Note text="Delivery failed" tone="error" onRetry={retry} />
    </>));
    const buttons = host.querySelectorAll<HTMLElement>('[role="button"]');
    expect(buttons[0]?.getAttribute('aria-busy')).toBe('true');
    await act(async () => buttons[0]!.click());
    expect(submit).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Delivery failed');
    await act(async () => buttons[1]!.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Delivery failed');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

// Native inset measurements are supplied by the device, not jsdom.
vi.mock('react-native-safe-area-context', async () => ({
  initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null),
}));

vi.mock('../src/ui/HeaderGradient.tsx', () => ({ HeaderGradient: ({ children }: { children: import('react').ReactNode }) => children }));

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: vi.fn(async () => false), addLowPowerModeListener: () => ({ remove() {} }) }));

it('keeps the poster until power is known and never starts a decoder in low-power mode', async () => {
  for (const lowPower of [true, false]) {
    vi.mocked(useVideoPlayer).mockClear();
    let resolvePower!: (value: boolean) => void;
    vi.mocked(isLowPowerModeEnabledAsync).mockReturnValueOnce(new Promise(resolve => { resolvePower = resolve; }));
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<MotionProvider><Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Login film" fade={0} /></MotionProvider>));
      expect(useVideoPlayer).not.toHaveBeenCalled();
      expect(host.querySelector('[role="img"]')).not.toBeNull();
      await act(async () => resolvePower(lowPower));
      if (lowPower) expect(useVideoPlayer).not.toHaveBeenCalled();
      else expect(useVideoPlayer).toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount()); host.remove();
    }
  }
});

it('dismisses the splash immediately with reduced motion and removes its timer on unmount', async () => {
  vi.useFakeTimers();
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const done = vi.fn();
  try {
    await act(async () => root.render(<Splash onDone={done} />));
    expect(done).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    await act(async () => vi.runAllTimers());
    expect(done).toHaveBeenCalledTimes(1);
  } finally { host.remove(); vi.useRealTimers(); }
});

it('replaces acknowledgments and expires only the toast, keeping a blocking error', async () => {
  vi.useFakeTimers();
  function Trigger() {
    const show = useToast();
    return <><button onClick={() => show('Accepted')}>First</button><button onClick={() => show('Received')}>Second</button><Note text="Still blocked" tone="error" /></>;
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ToastProvider><Trigger /></ToastProvider>));
    await act(async () => host.querySelectorAll('button')[0]!.click());
    expect(host.textContent).toContain('Accepted');
    await act(async () => vi.advanceTimersByTime(2000));
    await act(async () => host.querySelectorAll('button')[1]!.click());
    expect(host.textContent).not.toContain('Accepted');
    await act(async () => vi.advanceTimersByTime(2000));
    expect(host.textContent).toContain('Received');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.textContent).not.toContain('Received');
    expect(host.textContent).toContain('Still blocked');
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});


it('keeps a slow decoder mounted over the poster and removes it on an actual error', async () => {
  vi.useFakeTimers();
  let statusChanged!: (event: { status: string }) => void;
  const remove = vi.fn();
  vi.mocked(useVideoPlayer).mockReturnValue({ status: 'loading', addListener: (name: string, listener: typeof statusChanged) => { if (name === 'statusChange') statusChanged = listener; return { remove }; } } as never);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MotionProvider><Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Login film" fade={0} /></MotionProvider>));
    await act(async () => vi.advanceTimersByTime(500));
    expect(host.querySelector('[role="img"]')).not.toBeNull();
    expect(remove).not.toHaveBeenCalled();
    await act(async () => statusChanged({ status: 'readyToPlay' }));
    await act(async () => statusChanged({ status: 'error' }));
    expect(remove).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});

it('opens and dismisses the honest unavailable-document state from a login legal link', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LegalLine />));
    await act(async () => host.querySelector<HTMLElement>('[role="link"]')!.click());
    const dialog = document.body.querySelector('[aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(MESSAGES[DEFAULT_LOCALE]['legal.notPublished']);
    await act(async () => dialog!.querySelector<HTMLElement>('[role="button"]')!.click());
    expect(document.body.querySelector('[aria-modal="true"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('updates the header and dock reserve when native safe-area measurements change', async () => {
  function Probe() { return <><Header title="Measured header" /><output>{useTabBarReserve()}</output></>; }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = (top: number, bottom: number) => <SafeAreaInsetsContext.Provider value={{ top, bottom, left: 0, right: 0 }}><NavProvider initial={{ name: 'home' }}><Probe /></NavProvider></SafeAreaInsetsContext.Provider>;
  try {
    await act(async () => root.render(render(59, 34)));
    const header = host.querySelector<HTMLElement>('[role="heading"]')!.parentElement!.parentElement!;
    expect(header.style.paddingTop).toBe('67px');
    const firstReserve = Number(host.querySelector('output')!.textContent);
    expect(firstReserve).toBeGreaterThan(98);
    await act(async () => root.render(render(24, 8)));
    expect(header.style.paddingTop).toBe('32px');
    expect(firstReserve - Number(host.querySelector('output')!.textContent)).toBe(26);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('recovers a rejected reduced-motion query without leaving the film permanently disabled', async () => {
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValueOnce(new Error('Unavailable'));
  vi.mocked(useVideoPlayer).mockClear();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MotionProvider><Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Login" fade={0} /></MotionProvider>));
    expect(useVideoPlayer).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

vi.mock('../src/ui/illustrations/index.tsx', () => ({ EmptyTasks: () => null }));

it.each(['screen', 'list'])('reserves safe areas outside the %s scrolling viewport', async kind => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Probe() { return <output>{useTabBarReserve()}</output>; }
  try {
    await act(async () => root.render(<SafeAreaInsetsContext.Provider value={{ top: 59, bottom: 34, left: 0, right: 0 }}><NavProvider initial={{ name: 'home' }}>
      {kind === 'screen' ? <Screen title="Home"><Probe /></Screen> : <ListScreen title="Rows" data={['row']} keyOf={item => item} renderItem={() => <Probe />} />}
    </NavProvider></SafeAreaInsetsContext.Provider>));
    const viewport = [...host.querySelectorAll('div')].find(node => getComputedStyle(node).overflowY === 'auto')!;
    const reserve = Number(host.querySelector('output')!.textContent);
    expect(reserve).toBeGreaterThan(98);
    expect(viewport.parentElement!.style.paddingBottom).toBe(`${reserve}px`);
    expect(viewport.parentElement!.style.paddingTop).toBe('59px');
    const header = host.querySelector<HTMLElement>('[role="heading"]')!.parentElement!.parentElement!;
    expect(header.style.paddingTop).toBe('8px');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('keeps secondary text readable on paper, white cards and every Home gradient stop', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  let theme!: ReturnType<typeof useTheme>;
  function Probe() { theme = useTheme(); return null; }
  const luminance = (hex: string) => [0, 2, 4].map((offset, index) => {
    const channel = parseInt(hex.slice(offset + 1, offset + 3), 16) / 255;
    return (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!;
  }).reduce((a, b) => a + b);
  const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  try {
    await act(async () => root.render(<ThemeProvider><Probe /></ThemeProvider>));
    expect(polish.card).toBe(theme.collector.surface);
    for (const ground of [theme.collector.paper, polish.card, ...polish.homeGradient]) {
      for (const ink of [theme.collector.muted, theme.color.mutedForeground]) expect(ratio(ink, ground), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(polish.hairline, theme.collector.paper)).toBeGreaterThanOrEqual(1.5);
    expect(ratio(polish.homeBorder, theme.collector.paper)).toBeGreaterThanOrEqual(3);
  } finally { await act(async () => root.unmount()); }
});


it.each(['power', 'motion', 'pending'] as const)('offers explicit playback when %s prevents autoplay', async gate => {
  vi.mocked(useVideoPlayer).mockClear();
  vi.mocked(isLowPowerModeEnabledAsync).mockImplementationOnce(() => gate === 'pending' ? new Promise(() => {}) : Promise.resolve(gate === 'power'));
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(gate === 'motion');
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<MotionProvider><Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Film" fade={0} /></MotionProvider>));
    expect(useVideoPlayer).not.toHaveBeenCalled();
    const play = host.querySelector<HTMLElement>('[role="button"]');
    expect(play).not.toBeNull();
    await act(async () => play!.click());
    expect(useVideoPlayer).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it('keeps the video hidden until the first rendered frame and offers retry after failure', async () => {
  let statusChanged!: (event: { status: string }) => void;
  vi.mocked(useVideoPlayer).mockReturnValue({ status: 'readyToPlay', addListener: (name: string, listener: typeof statusChanged) => { if (name === 'statusChange') statusChanged = listener; return { remove() {} }; } } as never);
  vi.mocked(VideoView).mockImplementation(() => <div data-testid="native-video" />);
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<MotionProvider><Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Film" fade={0} /></MotionProvider>));
    expect(host.querySelector('[data-testid="native-video"]')?.parentElement?.style.opacity).toBe('0');
    await act(async () => vi.mocked(VideoView).mock.calls.at(-1)![0].onFirstFrameRender!());
    expect(host.querySelector('[data-testid="native-video"]')?.parentElement?.style.opacity).toBe('1');
    await act(async () => statusChanged({ status: 'error' }));
    expect(host.querySelector('[data-testid="native-video"]')).toBeNull();
    const retry = host.querySelector<HTMLElement>('[role="button"]');
    expect(retry).not.toBeNull();
    await act(async () => retry!.click());
    expect(host.querySelector('[data-testid="native-video"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); vi.mocked(VideoView).mockImplementation(() => null); }
});


it('offers retry when decoding never produces a first frame', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<MotionProvider><Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Film" fade={0} /></MotionProvider>));
    expect(host.querySelector('[role="button"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(8000));
    expect(host.querySelector('[role="button"]')).not.toBeNull();
    expect(host.querySelector('[role="img"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});


it('offers retry after playback stops advancing, even after the first frame', async () => {
  vi.useFakeTimers();
  const listeners = new Map<string, (event: { currentTime: number }) => void>();
  vi.mocked(useVideoPlayer).mockReturnValue({ status: 'readyToPlay', currentTime: 0, addListener: (name: string, listener: (event: { currentTime: number }) => void) => { listeners.set(name, listener); return { remove: () => listeners.delete(name) }; } } as never);
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<MotionProvider><Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Film" fade={0} /></MotionProvider>));
    await act(async () => vi.mocked(VideoView).mock.calls.at(-1)![0].onFirstFrameRender!());
    await act(async () => vi.advanceTimersByTime(7000));
    await act(async () => listeners.get('timeUpdate')?.({ currentTime: 1 }));
    await act(async () => vi.advanceTimersByTime(7000));
    expect(host.querySelector('[role="button"]')).toBeNull();
    await act(async () => listeners.get('timeUpdate')?.({ currentTime: 1 }));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector('[role="button"]')).not.toBeNull();
    expect(listeners.size).toBe(0);
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});
