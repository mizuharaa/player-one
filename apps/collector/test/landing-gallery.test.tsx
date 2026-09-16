// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Landing } from '../src/screens/Landing.tsx';
import { MESSAGES } from '../src/i18n.ts';
const flow = vi.hoisted(() => ({ scroll: vi.fn(), onScroll: undefined as undefined | ((event: { nativeEvent: { contentOffset: { y: number } } }) => void) }));
vi.mock('react-native', async () => {
 const native = await import('react-native-web');
 return { ...native, ScrollView: forwardRef(({ children, onScroll }: any, ref) => { flow.onScroll = onScroll; useImperativeHandle(ref, () => ({ scrollTo: flow.scroll })); return <div>{children}</div>; }), useWindowDimensions: () => ({ width: 390, height: 932, scale: 1, fontScale: 1 }) };
});
vi.mock('../src/zalo.tsx', () => ({ useZaloSignIn: () => ({}), ZaloSignIn: () => null }));
vi.mock('../src/ui.tsx', () => ({ useReducedMotion: () => true, useInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }), face: () => 'sans-serif', Film: ({ active }: { active: boolean }) => <output data-testid="film-active">{String(active)}</output>, LegalLine: () => null, Scrim: () => null, Button: ({ label, onPress }: any) => <button aria-label={label} onClick={onPress}>{label}</button>, Screen: ({ onBack }: any) => <main><button onClick={onBack}>Back</button></main>, Body: () => null, Title: () => null, Card: () => null }));
vi.mock('../src/ui/illustrations/index.tsx', () => ({ HowHandOver: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('reveals the existing film and sign-in with the gallery arrow or scrolling, without signing in', async () => {
 const host = document.createElement('div'), root = createRoot(host), signIn = vi.fn();
 document.body.append(host);
 try {
  await act(async () => root.render(<Landing onSignIn={signIn} onSignedIn={() => {}} />));
  expect(host.querySelector('[data-testid="landing-gallery"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="film-active"]')?.textContent).toBe('false');
  const next = host.querySelector<HTMLElement>(`[aria-label="${MESSAGES.en['common.next']}"]`);
  expect(next).not.toBeNull();
  await act(async () => next!.click());
  expect(flow.scroll).toHaveBeenCalledWith({ y: 932, animated: false });
  expect(signIn).not.toHaveBeenCalled();
  await act(async () => flow.onScroll!({ nativeEvent: { contentOffset: { y: 932 } } }));
  expect(host.querySelector('[data-testid="film-active"]')?.textContent).toBe('true');
  expect(host.textContent).toContain(MESSAGES.en['landing.signIn']);
  const gallery = host.querySelector('[data-testid="landing-gallery"]');
  await act(async () => host.querySelector<HTMLElement>(`[aria-label="${MESSAGES.en['landing.register']}"]`)!.click());
  expect(host.querySelector('[data-testid="film-active"]')?.textContent).toBe('false');
  await act(async () => document.body.querySelector<HTMLButtonElement>('main button')!.click());
  expect(host.querySelector('[data-testid="landing-gallery"]')).toBe(gallery);
  expect(host.querySelector('[data-testid="film-active"]')?.textContent).toBe('true');
 } finally { await act(async () => root.unmount()); host.remove(); }
});
