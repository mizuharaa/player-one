// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { Scrubber, markInSpan, markOutSpan, clearSpanAt } from './ReviewTimeline.tsx';
import { RecordingPreview } from './ReviewCatalog.tsx';
import type { ReviewCatalogItem } from '../lib/api.ts';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key }) }));

it('shares mark-in/out/clear semantics without closing backwards ranges or stacking open marks', () => {
  const open = markInSpan([], 3);
  expect(markInSpan(open, 4)).toEqual([{ start: 4, end: null }]);
  expect(markOutSpan(open, 2)).toEqual(open);
  expect(markOutSpan([], 6)).toEqual([]);
  const closed = markOutSpan(open, 8);
  expect(closed).toEqual([{ start: 3, end: 8 }]);
  expect(clearSpanAt(closed, 5)).toEqual([]);
  expect(clearSpanAt(closed, 9)).toEqual(closed);
});

it('seeks with keyboard, clamps to real bounds and zooms the real timeline', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const seek = vi.fn();
  try {
    await act(async () => root.render(<Scrubber position={19.8} measured={20} spans={[{ start: 3, end: 8 }]} onSeek={seek} />));
    const slider = host.querySelector<HTMLInputElement>('input[type=range]')!;
    await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(seek).toHaveBeenLastCalledWith(20);
    await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(seek).toHaveBeenLastCalledWith(0);
    const zoom = host.querySelector<HTMLButtonElement>('[aria-label="Zoom in timeline"]')!;
    await act(async () => zoom.click());
    expect(host.querySelector<HTMLElement>('.review-timeline-canvas')!.style.width).toBe('200%');
    expect(host.querySelector<HTMLElement>('.review-timeline-span')!.style.width).toBe('25%');
    await act(async () => root.render(<Scrubber position={0} measured={0} spans={[]} onSeek={seek} />));
    expect(slider.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it('provides working preview transport, speed, mute, fullscreen and local-only marked ranges', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const item: ReviewCatalogItem = { episode_id: 'phone-editor', session_folder: 'Phone', collector_label: 'Mai', collector_ref: 'col-1', recorded_at: null, uploaded_at: null,
    duration_seconds: 20, source: 'phone', state: 'quarantined', queue: 'standard', claimable: false, preview_url: '/phone.mp4', blocker: null };
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('Interrupted', 'AbortError'));
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const fullscreen = vi.fn().mockResolvedValue(undefined);
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
  try {
    await act(async () => root.render(<RecordingPreview item={item} actions={<button>Admin decision</button>} />));
    const video = host.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    await act(async () => video.dispatchEvent(new Event('loadedmetadata')));
    expect(host.querySelector('aside')?.firstElementChild?.textContent).toBe('Admin decision');
    await act(async () => button('+5s').click()); expect(video.currentTime).toBe(5);
    await act(async () => button(MESSAGES.en['shortcuts.markIn']).click());
    await act(async () => button('+5s').click()); expect(video.currentTime).toBe(10);
    await act(async () => button(MESSAGES.en['shortcuts.markOut']).click());
    expect(host.querySelectorAll('.review-preview-ranges li')).toHaveLength(1);
    expect(host.querySelector('.review-local-note')?.textContent).toContain('Not saved or payable');
    expect(host.querySelector('.review-local-note strong')?.textContent).toBe('0:05.000');
    const select = host.querySelector('select')!;
    await act(async () => { select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })); }); expect(video.playbackRate).toBe(2);
    await act(async () => button('Mute').click()); expect(video.muted).toBe(true);
    await act(async () => button('Unmute').click()); expect(video.muted).toBe(false);
    Object.defineProperty(host.querySelector('.review-preview-stage'), 'requestFullscreen', { configurable: true, value: fullscreen });
    await act(async () => button('Fullscreen').click()); expect(fullscreen).toHaveBeenCalledOnce();
    await act(async () => button('Play').click()); expect(play).toHaveBeenCalled(); expect(host.querySelector('video')).toBe(video);
    await act(async () => video.dispatchEvent(new Event('error')));
    await act(async () => button(MESSAGES.en['queue.refresh']).click());
    const retriedVideo = host.querySelector('video')!;
    expect(retriedVideo).not.toBe(video);
    Object.defineProperty(retriedVideo, 'duration', { configurable: true, value: 20 });
    expect(retriedVideo.currentTime).toBe(0);
    await act(async () => retriedVideo.dispatchEvent(new Event('loadedmetadata')));
    await act(async () => button('+5s').click());
    expect(retriedVideo.currentTime).toBe(5);
    await act(async () => button('Clear all ranges').click()); expect(host.querySelectorAll('.review-preview-ranges li')).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); play.mockRestore(); vi.unstubAllGlobals(); }
});
