// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Animated } from 'react-native';
import { expect, it, vi } from 'vitest';
import { CardScrollContext, CardSheen } from '../src/ui/CardSheen.tsx';
vi.mock('react-native', async () => ({ ...await import('react-native-web') }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('../src/ui/motion.ts', () => ({ useReducedMotion: () => motion.reduced }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it.each([false, true])('moves the sheen with scroll unless motion is reduced=%s', async reduced => {
  motion.reduced = reduced;
  const scroll = new Animated.Value(0), host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<CardScrollContext.Provider value={{ scroll, onScroll: () => {} }}><CardSheen /></CardScrollContext.Provider>));
  const sheen = host.querySelector<HTMLElement>('[data-testid="card-sheen"]')!;
  const start = sheen.style.transform;
  await act(async () => { scroll.setValue(500); await new Promise(resolve => setTimeout(resolve, 30)); });
  if (reduced) expect(sheen.style.transform).toBe(start);
  else expect(sheen.style.transform).not.toBe(start);
  await act(async () => root.unmount());
});
