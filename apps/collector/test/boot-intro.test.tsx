// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { addLowPowerModeListener } from 'expo-battery';
import { withDelay, withTiming, withSpring } from 'react-native-reanimated';
vi.mock('react-native-reanimated', async importOriginal => ({ ...await importOriginal<object>(), withSpring: vi.fn(value => value), withDelay: vi.fn((_delay, value) => value), withTiming: vi.fn(value => value) }));
import { AccessibilityInfo, Platform } from 'react-native';
vi.mock('react-native', async () => ({ ...await import('react-native-web'),
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false), addEventListener: () => ({ remove() {} }) },
}));
vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: vi.fn(() => ({ remove: vi.fn() })) }));
vi.mock('react-native-svg', () => ({ default: 'svg', Circle: 'circle', Path: 'path' }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); vi.resetModules(); });
it.each([false, true])('finishes exactly once by the deadline; reduced=%s', async reduced => {
  vi.useFakeTimers();
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(reduced);
  const { BootIntro } = await import('../src/shell/BootIntro.tsx');
  const host = document.createElement('div'); const root = createRoot(host); const done = vi.fn();
  await act(async () => root.render(<BootIntro onDone={done} />));
  expect(done).toHaveBeenCalledTimes(reduced ? 1 : 0);
  if (!reduced) {
    expect(vi.mocked(withDelay).mock.calls.map(call => call[0])).toEqual([850, 1050, 1950, 2500, 2500]);
    expect(withSpring).not.toHaveBeenCalled();
    expect(vi.mocked(withTiming).mock.calls.every(call => call[1]?.easing !== undefined)).toBe(true);
    expect(vi.mocked(withTiming).mock.calls).toContainEqual([1, expect.objectContaining({ duration: 500 })]);
    await act(async () => vi.advanceTimersByTime(2600));
    expect(done).not.toHaveBeenCalled();
  }
  await act(async () => vi.advanceTimersByTime(reduced ? 3300 : 700));
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it('reveals chrome by the deadline even when the accessibility gate stalls', async () => {
  vi.useFakeTimers();
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise(() => {}));
  const { BootChrome } = await import('../src/shell/BootIntro.tsx');
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<BootChrome>Header</BootChrome>));
  expect((host.firstChild as HTMLElement).style.opacity).toBe('0');
  await act(async () => vi.advanceTimersByTime(3300));
  expect((host.firstChild as HTMLElement).style.opacity).toBe('1');
  await act(async () => root.unmount());
});

it('reveals BootChrome immediately when low power begins before the deadline', async () => {
  vi.useFakeTimers();
  const platform = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  vi.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise(() => {}));
  const { BootChrome } = await import('../src/shell/BootIntro.tsx');
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<BootChrome>Header</BootChrome>));
    expect((host.firstChild as HTMLElement).style.opacity).toBe('0');
    const listener = vi.mocked(addLowPowerModeListener).mock.calls.at(-1)![0];
    await act(async () => listener({ lowPowerMode: true }));
    expect((host.firstChild as HTMLElement).style.opacity).toBe('1');
  } finally {
    await act(async () => root.unmount());
    expect(vi.mocked(addLowPowerModeListener).mock.results.at(-1)!.value.remove).toHaveBeenCalledTimes(1);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
  }
});
