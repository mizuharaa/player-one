import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fingerprintIndexKeys, informativeFrameHash, matchFrameSegments, mirrorFrameHash, validateFingerprint } from '../../src/risk/frame-segments.ts';
import { decodeFrames, decodeParts, frameStats, runTool } from '../../../../tools/analysers/frames.ts';
import { renderClip, encodeClip } from '../../../../tools/analysers/synth.ts';

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

const hashes = (count: number, seed = 'original') => Array.from({ length: count }, (_, i) => createHash('sha256').update(`${seed}:${i}`).digest('hex').slice(0, 16));
const original = hashes(240);

describe('bounded segment reuse matching', () => {
  it.each([
    ['copy', original],
    ['trim', original.slice(35)],
    ['middle split', original.slice(70, 120)],
    ['2x speed', original.filter((_, i) => i % 2 === 0)],
    ['slow playback', original.flatMap((h) => [h, h])],
    ['dropped frames', original.filter((_, i) => i % 3 !== 0)],
    ['reverse', [...original].reverse()],
    ['mirror', original.map(mirrorFrameHash)],
    ['partial reuse', [...hashes(100, 'new-a'), ...original.slice(70, 110), ...hashes(100, 'new-b')]],
    ['reordered pieces', [...original.slice(140, 180), ...original.slice(30, 70)]],
  ])('finds %s as evidence', (_name, query) => {
    const result = matchFrameSegments(query, original);
    expect(result.complete).toBe(true);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments[0]!.matchingFrames).toBeGreaterThanOrEqual(20);
    expect(result.segments[0]!.distinctFrames).toBeGreaterThanOrEqual(8);
  });

  it('reports sample intervals and transformations instead of invented duration', () => {
    expect(matchFrameSegments(original.slice(70, 110), original).segments[0]).toMatchObject({ qStart: 0, qEnd: 40, cStart: 70, cEnd: 110 });
    expect(matchFrameSegments([...original].reverse(), original).segments[0]).toMatchObject({ reversed: true, mirrored: false });
    expect(matchFrameSegments(original.map(mirrorFrameHash), original).segments[0]).toMatchObject({ mirrored: true });
    expect(matchFrameSegments(original.filter((_, i) => i % 2 === 0), original).segments[0]!.scale).toBeGreaterThan(1.9);
  });

  it('does not confuse independent changing fingerprints with reuse', () => {
    expect(matchFrameSegments(hashes(240, 'independent'), original)).toEqual({ complete: true, segments: [] });
  });

  it('cannot declare inadequate, low-information, malformed or over-budget work clear', () => {
    expect(validateFingerprint(original.slice(0, 19))).toMatchObject({ complete: false, reason: 'insufficient_samples' });
    expect(validateFingerprint(Array(120).fill(original[0]))).toMatchObject({ complete: false, reason: 'low_information' });
    expect(validateFingerprint([...original, 'NaN'])).toMatchObject({ complete: false, reason: 'invalid_fingerprint' });
    expect(validateFingerprint(Array(14_401).fill(original[0]))).toMatchObject({ complete: false, reason: 'budget_exceeded' });
    expect(matchFrameSegments(original, original, { maxComparisons: 1 })).toMatchObject({ complete: false, reason: 'budget_exceeded' });
    expect(matchFrameSegments(original, original, { maxPairs: 1 })).toMatchObject({ complete: false, reason: 'budget_exceeded' });
    expect(matchFrameSegments(original, original, { maxHamming: 7 })).toMatchObject({ complete: false, reason: 'invalid_fingerprint' });
  });

  it('retrieval preserves six-bit-near and mirrored matches with deterministic bounded tokens', () => {
    const hash = original[0]!;
    const keys = new Set(fingerprintIndexKeys([hash]));
    for (let start = 0; start < 64; start++) {
      let changed = BigInt(`0x${hash}`);
      for (let k = 0; k < 6; k++) changed ^= 1n << BigInt((start + k * 9) % 64);
      const near = changed.toString(16).padStart(16, '0');
      expect(fingerprintIndexKeys([near]).some((k) => keys.has(k))).toBe(true);
    }
    expect(fingerprintIndexKeys([hash, hash.toUpperCase()])).toEqual([...keys]);
    expect(keys.size).toBe(28);
    expect(fingerprintIndexKeys([mirrorFrameHash(hash)], { mirrored: true })).toEqual([...keys]);
    expect(() => fingerprintIndexKeys(['?'])).toThrow('invalid frame fingerprint');
  });

  it('excludes flat anchors consistently from retrieval, validation and matching', () => {
    const flat = ['0000000000000000', 'ffffffffffffffff', 'aa55aa55aa55aa55', '0102040800000000', 'fefdfbf7ffffffff'];
    for (const hash of flat) {
      expect(informativeFrameHash(hash)).toBe(false);
      expect(informativeFrameHash(mirrorFrameHash(hash))).toBe(false);
      expect(fingerprintIndexKeys([hash])).toEqual([]);
    }
    const padding = Array(120).fill(flat[2]);
    expect(validateFingerprint([...padding, ...original.slice(0, 19)])).toMatchObject({ complete: false, reason: 'low_information' });
    const result = matchFrameSegments([...padding, ...original.slice(0, 20)], [...padding, ...original]);
    expect(result.complete).toBe(true);
    expect(result.segments[0]).toMatchObject({ qStart: 120, qEnd: 140, cStart: 120, cEnd: 140, matchingFrames: 20 });
  });
});

// Requires ffmpeg: the sandbox intentionally fails, rather than skips, missing tooling.
describe('real synthetic MP4 transform proof', () => {
  it('matches edits and rejects independently rendered similar moving scenes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reuse-proof-'));
    try {
      const base = join(dir, 'base.mp4');
      const clip = renderClip({ seconds: 120, fps: 10, seed: 101, content: 'moving' });
      await encodeClip(clip.frames, { file: base, fps: clip.fps });
      const reference = frameStats(await decodeFrames(base)).ahash;
      const variants = [
        ['reencode', 'null'],
        ['trim20', 'trim=start=20,setpts=PTS-STARTPTS'],
        ['middle40', 'trim=start=40:end=80,setpts=PTS-STARTPTS'],
        ['speed2', 'setpts=0.5*PTS'],
        ['slow2', 'setpts=2*PTS'],
        ['dropped', 'select=not(mod(n\\,3)),setpts=N/(10*TB)'],
        ['reverse', 'reverse'],
        ['mirror', 'hflip'],
      ];
      for (const [name, filter] of variants) {
        const path = join(dir, `${name}.mp4`);
        const encoded = await runTool('ffmpeg', ['-v', 'error', '-y', '-nostdin', '-threads', '1', '-filter_threads', '1', '-i', base, '-vf', filter!, '-an', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-crf', '23', path]);
        expect(encoded.code, encoded.stderr).toBe(0);
        const query = frameStats(await decodeFrames(path)).ahash;
        const result = matchFrameSegments(query, reference);
        console.log(JSON.stringify({ variant: name, samples: query.length, complete: result.complete, segments: result.segments }));
        expect(result.complete, name).toBe(true);
        expect(result.segments.length, name).toBeGreaterThan(0);
      }
      for (const seed of [102, 103, 104]) {
        const path = join(dir, `independent-${seed}.mp4`);
        const independent = renderClip({ seconds: 120, fps: 10, seed, content: 'moving' });
        await encodeClip(independent.frames, { file: path, fps: independent.fps });
        const result = matchFrameSegments(frameStats(await decodeFrames(path)).ahash, reference);
        console.log(JSON.stringify({ negativeSeed: seed, complete: result.complete, segments: result.segments }));
        expect(result).toEqual({ complete: true, segments: [] });
      }
      const fresh = renderClip({ seconds: 80, fps: 10, seed: 202, content: 'moving' });
      for (const [name, frames] of [
        ['mixed', [...fresh.frames.slice(0, 400), ...clip.frames.slice(400, 800), ...fresh.frames.slice(400)]],
        ['reordered', [...clip.frames.slice(800, 1200), ...clip.frames.slice(200, 600)]],
      ] as const) {
        const path = join(dir, `${name}.mp4`);
        await encodeClip(frames, { file: path, fps: clip.fps });
        const result = matchFrameSegments(frameStats(await decodeFrames(path)).ahash, reference);
        console.log(JSON.stringify({ variant: name, complete: result.complete, segments: result.segments }));
        expect(result.complete, name).toBe(true);
        expect(result.segments.length, name).toBeGreaterThan(0);
      }
      expect((await decodeParts([base, base], { maxFrames: 10 })).frames).toHaveLength(10);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 240_000);

  it('refuses decoder failure after partial success and a partial raw frame', async () => {
    await expect(decodeFrames('synthetic-only', { width: 0 })).rejects.toThrow('invalid frame decode options');
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args.at(-1) as Function)(Object.assign(new Error('decoder failed'), { code: 1 }), Buffer.alloc(4096), Buffer.from('decoder failed'));
      return {} as ChildProcess;
    });
    await expect(decodeFrames('synthetic-only')).rejects.toThrow('frame_decode_failed');
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args.at(-1) as Function)(null, Buffer.from('x'), Buffer.alloc(0));
      return {} as ChildProcess;
    });
    await expect(decodeFrames('synthetic-only')).rejects.toThrow('partial_decoded_frame');
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args.at(-1) as Function)(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), Buffer.alloc(4096), Buffer.from('synthetic private path'));
      return {} as ChildProcess;
    });
    await expect(decodeFrames('synthetic-only')).rejects.toThrow('frame_decode_unavailable');
  });

  it('kills a timed-out tool and shares one deadline across parts', async () => {
    const timed = await runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 25 });
    expect(timed.code).not.toBe(0);
    const timeouts: number[] = [];
    const response = (...args: unknown[]) => {
      timeouts.push((args[2] as { timeout: number }).timeout);
      setTimeout(() => (args.at(-1) as Function)(null, Buffer.alloc(4096), Buffer.alloc(0)), 15);
      return {} as ChildProcess;
    };
    vi.mocked(execFile).mockImplementationOnce(response).mockImplementationOnce(response);
    expect((await decodeParts(['part-a', 'part-b'], { timeoutMs: 1000 })).frames).toHaveLength(2);
    expect(timeouts[0]).toBeLessThanOrEqual(1000);
    expect(timeouts[1]).toBeLessThan(timeouts[0]!);
  });
});
