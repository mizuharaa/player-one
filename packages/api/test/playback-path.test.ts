import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { matchingPlaybackTimeline, playbackPath } from '../src/media.ts';

it('uses a complete optional preview only when requested, leaving originals and missing previews unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'playerone-preview-'));
  try {
    const original = join(root, 'session', 'left.mp4');
    expect(await playbackPath(root, 'session', 'left.mp4', true)).toBe(original);
    const folder = join(root, '.previews', 'session');
    await mkdir(folder, { recursive: true });
    const preview = join(folder, 'left.mp4.mp4');
    await writeFile(preview, '');
    expect(await playbackPath(root, 'session', 'left.mp4', true)).toBe(original);
    await writeFile(preview, 'encoded display copy');
    expect(await playbackPath(root, 'session', 'left.mp4', true)).toBe(original);
    expect(await playbackPath(root, 'session', 'left.mp4', false)).toBe(original);
    expect(await playbackPath(root, '..', 'outside.mp4', true)).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('requires matching start, decoded frame count and rate; bounds end rounding to one source frame', () => {
  const source = {start_time:'0.000000',duration:'8.515344',nb_read_frames:'256',r_frame_rate:'30/1'};
  const copy = {...source,duration:'8.533333'};
  expect(matchingPlaybackTimeline(source,copy)).toBe(true);
  expect(matchingPlaybackTimeline(source,{...copy,start_time:'0.1'})).toBe(false);
  expect(matchingPlaybackTimeline(source,{...copy,duration:'8.56'})).toBe(false);
  expect(matchingPlaybackTimeline(source,{...copy,nb_read_frames:'255'})).toBe(false);
  expect(matchingPlaybackTimeline(source,{...copy,r_frame_rate:'24/1'})).toBe(false);
  expect(matchingPlaybackTimeline(source,{...copy,nb_read_frames:undefined})).toBe(false);
  expect(matchingPlaybackTimeline(source,{...copy,duration:'N/A'})).toBe(false);
});
