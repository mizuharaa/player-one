// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';
import { MotionProvider, useReducedMotion } from '../src/ui/motion.ts';
import { CardScrollContext, useCardScroll } from '../src/ui/CardSheen.tsx';
import { useContext } from 'react';
vi.mock('react-native', async () => ({ ...await import('react-native-web'), AccessibilityInfo: {
  isReduceMotionEnabled: vi.fn(async () => false), addEventListener: vi.fn(() => ({ remove: vi.fn() })),
} }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('shares one accessibility subscription and a stable screen scroll handler across cards and renders', async () => {
  const handlers: unknown[] = [];
  function Card() {
    const reduced = useReducedMotion(), scroll = useContext(CardScrollContext);
    handlers.push(scroll?.onScroll);
    return <span>{String(reduced)}</span>;
  }
  function Screen({ count }: { count: number }) {
    const scroll = useCardScroll();
    return <CardScrollContext.Provider value={scroll}>{Array.from({ length: count }, (_, i) => <Card key={i} />)}</CardScrollContext.Provider>;
  }
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<MotionProvider><Screen count={20} /></MotionProvider>));
  await act(async () => root.render(<MotionProvider><Screen count={30} /></MotionProvider>));
  expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  expect(new Set(handlers).size).toBe(1);
  expect(handlers[0]).toBeTypeOf('function');
  expect(host.textContent).not.toContain('true');
  await act(async () => root.unmount());
  expect(vi.mocked(AccessibilityInfo.addEventListener).mock.results[0]!.value.remove).toHaveBeenCalledTimes(1);
});
