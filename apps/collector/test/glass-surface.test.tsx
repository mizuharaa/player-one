// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GlassSurface } from '../src/ui/GlassSurface.tsx';
const setting = vi.hoisted(() => ({ read: vi.fn<() => Promise<boolean>>(), change: (_value: boolean) => {} }));
vi.mock('react-native', async () => ({ ...await import('react-native-web'), Platform: { OS: 'ios' }, AccessibilityInfo: {
  isReduceTransparencyEnabled: () => setting.read(),
  addEventListener: (_name: string, callback: (value: boolean) => void) => { setting.change = callback; return { remove() {} }; },
} }));
vi.mock('expo-blur', () => ({ BlurView: () => <div data-testid="native-blur" /> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('starts opaque while the setting is unknown and respects live Reduce Transparency changes', async () => {
  let resolve!: (value: boolean) => void;
  setting.read.mockReturnValue(new Promise(value => { resolve = value; }));
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<GlassSurface><span>Readable content</span></GlassSurface>));
    expect(host.textContent).toBe('Readable content');
    expect(host.querySelector('[data-testid="native-blur"]')).toBeNull();
    await act(async () => resolve(false));
    expect(host.querySelector('[data-testid="native-blur"]')).not.toBeNull();
    await act(async () => setting.change(true));
    expect(host.querySelector('[data-testid="native-blur"]')).toBeNull();
    expect(host.textContent).toBe('Readable content');
  } finally { await act(async () => root.unmount()); }
});

it('keeps the opaque fallback when the platform setting cannot be read', async () => {
  setting.read.mockRejectedValue(new Error('setting unavailable'));
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<GlassSurface><span>Readable content</span></GlassSurface>));
    expect(host.querySelector('[data-testid="native-blur"]')).toBeNull();
    expect(host.textContent).toBe('Readable content');
  } finally { await act(async () => root.unmount()); }
});
