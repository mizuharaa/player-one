// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';
import { ToastProvider, useToast } from '../src/ui/Toast.tsx';
import { Splash } from '../src/screens/Splash.tsx';
import { Button, Film, LegalLine, Note } from '../src/ui.tsx';
import { useVideoPlayer } from 'expo-video';
import { isLowPowerModeEnabledAsync } from 'expo-battery';

vi.mock('react-native', async () => ({ ...await import('react-native-web'),
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false), addEventListener: () => ({ remove() {} }) },
}));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: vi.fn(() => ({ status: 'idle', addListener: () => ({ remove() {} }) })) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
      await act(async () => root.render(<Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Login film" fade={0} />));
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
  vi.mocked(useVideoPlayer).mockReturnValue({ status: 'loading', addListener: (_name: string, listener: typeof statusChanged) => { statusChanged = listener; return { remove }; } } as never);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Film source="login.mp4" poster={{ uri: 'poster.jpg' }} label="Login film" fade={0} />));
    await act(async () => vi.advanceTimersByTime(500));
    expect(host.querySelector('[role="img"]')).not.toBeNull();
    expect(remove).not.toHaveBeenCalled();
    await act(async () => statusChanged({ status: 'readyToPlay' }));
    await act(async () => statusChanged({ status: 'error' }));
    expect(remove).toHaveBeenCalledTimes(1);
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
    expect(dialog?.textContent).toContain('PaXini has not supplied this content yet.');
    await act(async () => dialog!.querySelector<HTMLElement>('[role="button"]')!.click());
    expect(document.body.querySelector('[aria-modal="true"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
