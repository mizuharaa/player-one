// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isLowPowerModeEnabledAsync } from 'expo-battery';
import { withDelay, withTiming, withSpring } from 'react-native-reanimated';
vi.mock('react-native-reanimated', async importOriginal => ({ ...await importOriginal<object>(), withSpring: vi.fn(value => value), withDelay: vi.fn((_delay, value) => value), withTiming: vi.fn(value => value) }));
import { AccessibilityInfo, AppState } from 'react-native';
vi.mock('react-native', async () => ({ ...await import('react-native-web'),
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false), addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: vi.fn(async () => false), addLowPowerModeListener: vi.fn(() => ({ remove: vi.fn() })) }));
vi.mock('react-native-svg', () => ({ default: 'svg', Circle: 'circle', Path: 'path' }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.assign(AppState, { currentState: 'active' });
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(false);
});
afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

it('draws One, then Player, without a spring and finishes once after 3300ms', async () => {
  const { BootIntro } = await import('../src/shell/BootIntro.tsx');
  const root = createRoot(document.createElement('div')), done = vi.fn();
  await act(async () => root.render(<BootIntro onDone={done} />));
  expect(vi.mocked(withDelay).mock.calls.map(call => call[0])).toEqual([850, 1050, 1950, 2500, 2500]);
  expect(withSpring).not.toHaveBeenCalled();
  expect(vi.mocked(withTiming).mock.calls.every(call => call[1]?.easing !== undefined)).toBe(true);
  await act(async () => vi.advanceTimersByTime(3299));
  expect(done).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it.each(['inactive', null])('waits through native startup state %s and starts its deadline in the foreground', async initial => {
  Object.assign(AppState, { currentState: initial });
  const { BootIntro } = await import('../src/shell/BootIntro.tsx');
  const root = createRoot(document.createElement('div')), done = vi.fn();
  await act(async () => root.render(<BootIntro onDone={done} />));
  const listener = vi.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await act(async () => { listener('inactive'); vi.advanceTimersByTime(5000); });
  expect(done).not.toHaveBeenCalled();
  expect(withTiming).not.toHaveBeenCalled();
  Object.assign(AppState, { currentState: 'active' });
  await act(async () => listener('active'));
  expect(withTiming).toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(3299));
  expect(done).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it('does not skip the lightweight wordmark in low power mode', async () => {
  vi.mocked(isLowPowerModeEnabledAsync).mockResolvedValue(true);
  const { BootIntro } = await import('../src/shell/BootIntro.tsx');
  const root = createRoot(document.createElement('div')), done = vi.fn();
  await act(async () => root.render(<BootIntro onDone={done} />));
  expect(done).not.toHaveBeenCalled();
  expect(withTiming).toHaveBeenCalled();
  await act(async () => root.unmount());
});

it.each(['reduced', 'pending', 'rejected'])('shows a static wordmark for %s accessibility instead of skipping or blocking', async mode => {
  if (mode === 'pending') vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise(() => {}));
  else if (mode === 'rejected') vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockRejectedValue(new Error('unavailable'));
  else vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  const { BootIntro } = await import('../src/shell/BootIntro.tsx');
  const host = document.createElement('div'), root = createRoot(host), done = vi.fn();
  await act(async () => root.render(<BootIntro onDone={done} />));
  await act(async () => vi.advanceTimersByTime(250));
  expect(host.querySelector('[data-testid="boot-static-wordmark"]')?.textContent).toBe('PlayerOne');
  expect(withTiming).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it('keeps chrome visible underneath the cover even when accessibility never resolves', async () => {
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise(() => {}));
  const { BootChrome } = await import('../src/shell/BootIntro.tsx');
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<BootChrome><span>Header</span></BootChrome>));
  expect((host.firstChild as HTMLElement).style.opacity).not.toBe('0');
  expect(AccessibilityInfo.isReduceMotionEnabled).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
