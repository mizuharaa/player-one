// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RouteTransition } from '../src/shell/RouteTransition.tsx';
vi.mock('react-native', async () => ({ ...await import('react-native-web') }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('../src/ui/motion.ts', () => ({ useReducedMotion: () => motion.reduced }));
const seen = vi.hoisted(() => [] as { entering: unknown; exiting: unknown; initialX: number | undefined }[]);
vi.mock('react-native-reanimated', async () => ({ ...await vi.importActual('../test/reanimated.tsx'), default: { View: ({ entering, exiting, children }: { entering: unknown; exiting: unknown; children: React.ReactNode }) => { seen.push({ entering, exiting, initialX: typeof entering !== 'function' ? undefined : (entering as (v: { windowWidth: number }) => { initialValues: { transform: { translateX?: number }[] } })({ windowWidth: 390 }).initialValues.transform[0]?.translateX }); return <div>{children}</div>; } } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('mounts the new route with an entering animation and preserves back direction', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<RouteTransition isTabRoot route={{ name: 'home' }}>Home</RouteTransition>));
  const firstDetail = seen.length;
  await act(async () => root.render(<RouteTransition isTabRoot={false} route={{ name: 'taskDetail', taskId: 'one' }}>Detail</RouteTransition>));
  expect(host.textContent).toBe('Detail');
  expect(seen[firstDetail]?.initialX).toBe(390);
  expect(seen.at(-1)?.entering).toBeTypeOf('function');
  const enter = seen.at(-1)!.entering as (v: { windowWidth: number }) => { initialValues: { transform: { translateX?: number }[] } };
  expect(enter({ windowWidth: 390 }).initialValues.transform[0]?.translateX).toBe(390);
  await act(async () => root.render(<RouteTransition isTabRoot route={{ name: 'home' }}>Home</RouteTransition>));
  const back = seen.at(-1)!.entering as typeof enter;
  expect(back({ windowWidth: 390 }).initialValues.transform[0]?.translateX).toBe(-97.5);
  await act(async () => root.render(<RouteTransition isTabRoot={false} route={{ name: 'sessionCreate' }}>Prepare</RouteTransition>));
  await act(async () => root.render(<RouteTransition isTabRoot={false} route={{ name: 'uploads', openDelivery: true }}>Upload</RouteTransition>));
  await act(async () => root.render(<RouteTransition isTabRoot={false} route={{ name: 'sessionCreate' }}>Prepare</RouteTransition>));
  expect((seen.at(-1)!.entering as typeof enter)({ windowWidth: 390 }).initialValues.transform[0]?.translateX).toBe(-97.5);
  await act(async () => root.unmount());
});

it('does not schedule route animations when Reduce Motion is enabled', async () => {
  motion.reduced = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<RouteTransition isTabRoot={false} route={{ name: 'taskDetail', taskId: 'reduced' }}>Detail</RouteTransition>));
    expect(host.textContent).toBe('Detail');
    expect(seen.at(-1)?.entering).toBeUndefined();
    expect(seen.at(-1)?.exiting).toBeUndefined();
  } finally { await act(async () => root.unmount()); motion.reduced = false; }
});
