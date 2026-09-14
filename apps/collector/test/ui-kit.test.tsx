// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Button, Note } from '../src/ui.tsx';

vi.mock('react-native', async () => ({ ...await import('react-native-web') }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
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
