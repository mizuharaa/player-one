import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cp, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { EpisodeRecord } from '@playerone/contracts';
import { ingest } from '../src/ingest.ts';
import { partDiscrepancies } from '../src/classify.ts';
import { openHashCache } from '../src/hash.ts';
import { deriveEpisodeId } from '@playerone/contracts';
import { hasSession, session } from './sessions.ts';

const SESSIONS = ['072310', '072516', '072538'] as const;
const available = SESSIONS.filter(hasSession);

/** A fresh cache directory per test, so a reuse count means what it says. */
async function withCache<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'px-cache-'));
  const previous = process.env['PLAYERONE_CACHE'];
  process.env['PLAYERONE_CACHE'] = dir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env['PLAYERONE_CACHE'];
    else process.env['PLAYERONE_CACHE'] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

describe.skipIf(available.length === 0)('every session produces a record, none discarded (ING-17)', () => {
  for (const id of available) {
    it(`${id} validates against the schema`, async () => {
      const record = await withCache(() => ingest(session(id)));
      expect(() => EpisodeRecord.parse(record)).not.toThrow();
      expect(record.streams.length).toBeGreaterThan(0);
      expect(record.calibration.present).toBe(true);
      expect(record.calibration.files).toHaveLength(2);
    });
  }

  it('072310 still measures 8.500 s through the full pipeline', async () => {
    const record = await withCache(() => ingest(session('072310')));
    expect(record.timing.raw_duration_s).toBeCloseTo(8.5, 2);
    expect(record.declared?.duration_sec).toBe(12.852);
  });

  it('the unclosed session is flagged, not failed (ING-14)', async () => {
    const record = await withCache(() => ingest(session('072538')));
    expect(record.state).toBe('flagged');
    expect(record.discrepancies.map((x) => x.code)).toContain('SESSION-UNCLOSED');
  });

  it('every hashed file has a real digest', async () => {
    const record = await withCache(() => ingest(session('072310')));
    const digests = [
      ...record.streams.flatMap((s) => s.parts.map((p) => p.sha256)),
      ...record.calibration.files.map((f) => f.sha256),
    ];
    expect(digests.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    // Four media files and two calibration files. The IMU log appears under both
    // imu_accel and imu_gyro, so the list is longer than the set.
    expect(new Set(digests).size).toBe(6);
    expect(digests).toHaveLength(7);
  });
});

describe.skipIf(!hasSession('072310'))('identity (ING-30, ING-32, ING-N2)', () => {
  it('a second run over the same directory yields the same fingerprint and id', async () => {
    const a = await withCache(() => ingest(session('072310')));
    const b = await withCache(() => ingest(session('072310')));
    expect(b.content_fingerprint).toBe(a.content_fingerprint);
    expect(b.episode_id).toBe(a.episode_id);
  });

  it('output is byte-identical apart from ingested_at and ingest_host', async () => {
    const a = await withCache(() => ingest(session('072310')));
    const b = await withCache(() => ingest(session('072310')));
    const strip = (r: typeof a) => JSON.stringify({ ...r, source: { ...r.source, ingested_at: '', ingest_host: '' } });
    expect(strip(b)).toBe(strip(a));
  });

  it('the same session delivered by a different path is one episode (ING-30)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'px-delivery-'));
    const copy = join(root, 'ego_AZER76400FE_20260813_072310');
    await cp(session('072310'), copy, { recursive: true });

    const a = await withCache(() => ingest(session('072310')));
    const b = await withCache(() => ingest(copy));
    expect(b.content_fingerprint).toBe(a.content_fingerprint);
    expect(b.episode_id).toBe(a.episode_id);
    expect(b.source.path).toBe(a.source.path);

    await rm(root, { recursive: true, force: true });
  });

  it('a different session is a different episode', async () => {
    if (!hasSession('072516')) return;
    const a = await withCache(() => ingest(session('072310')));
    const b = await withCache(() => ingest(session('072516')));
    expect(b.content_fingerprint).not.toBe(a.content_fingerprint);
  });

  /**
   * Superseded 0.3: the id used to be derived from the content fingerprint,
   * which meant a file changing between deliveries minted a second episode
   * instead of raising CHECKSUM-MISMATCH. It now comes from the basename alone.
   * See docs/episode-identity.md; the derivation itself is unit-tested in
   * test/identity.test.ts.
   */
  it('the episode id is a well-formed uuid derived from the basename, not the content', async () => {
    const id = deriveEpisodeId('ego_AZER76400FE_20260813_072310');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveEpisodeId('ego_AZER76400FE_20260813_072310')).toBe(id);

    const record = await withCache(() => ingest(session('072310')));
    expect(record.episode_id).toBe(id);
    expect(record.episode_id).not.toBe(deriveEpisodeId(record.content_fingerprint));
  });
});

describe.skipIf(!hasSession('072310'))('resume and read-only source (ING-33, ING-34)', () => {
  it('a second run reuses every cached digest instead of re-hashing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'px-cache-'));
    process.env['PLAYERONE_CACHE'] = dir;
    try {
      await ingest(session('072310'));
      const cache = await openHashCache();
      let reused = 0;
      for (const f of ['camera_left_part0001.mp4', 'camera_right_part0001.mp4', 'audio.wav']) {
        const path = join(session('072310'), `ego_AZER76400FE_20260813_072310_${f}`);
        const st = await stat(path);
        await cache.hash(path, st.size, st.mtimeMs);
      }
      reused = cache.reused;
      expect(reused).toBe(3);
      expect(cache.computed).toBe(0);
    } finally {
      delete process.env['PLAYERONE_CACHE'];
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a cache entry is dropped when the file changes underneath it', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'px-cache-'));
    const workDir = await mkdtemp(join(tmpdir(), 'px-work-'));
    process.env['PLAYERONE_CACHE'] = cacheDir;
    try {
      const file = join(workDir, 'sample.bin');
      await writeFile(file, 'one');
      const cache = await openHashCache();
      const first = await cache.hash(file, 3, 1000);
      await writeFile(file, 'two');
      const second = await cache.hash(file, 3, 2000); // different mtime, so no reuse
      expect(second).not.toBe(first);
      expect(cache.computed).toBe(2);
    } finally {
      delete process.env['PLAYERONE_CACHE'];
      await rm(cacheDir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it('ingest does not add, remove or touch anything in the source directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'px-readonly-'));
    const copy = join(root, 'ego_AZER76400FE_20260813_072310');
    await cp(session('072310'), copy, { recursive: true });

    const { readdir } = await import('node:fs/promises');
    const before = await Promise.all(
      (await readdir(copy)).sort().map(async (n) => {
        const st = await stat(join(copy, n));
        return `${n}|${st.size}|${st.mtimeMs}`;
      }),
    );

    await withCache(() => ingest(copy));

    const after = await Promise.all(
      (await readdir(copy)).sort().map(async (n) => {
        const st = await stat(join(copy, n));
        return `${n}|${st.size}|${st.mtimeMs}`;
      }),
    );
    expect(after).toEqual(before);

    await rm(root, { recursive: true, force: true });
  });
});

describe('multi-part assembly (ING-18..21)', () => {
  const part = (n: number, first: bigint, last: bigint) => ({
    partNumber: n,
    firstUs: first,
    lastUs: last,
  });
  const stream = (partTimings: ReturnType<typeof part>[]) =>
    ({
      role: 'camera_left',
      parts: partTimings.map((p) => ({ partNumber: p.partNumber }) as never),
      partTimings,
      source: 'sidecar',
      firstUs: 0n,
      lastUs: 0n,
      spanUs: 0n,
      sampleCount: 0,
      medianDeltaUs: 33334n,
      truncatedTail: false,
      backwardsSteps: 0,
    }) as never;
  const noManifest = { segmentCounts: {} } as never;
  const codes = (s: unknown) => partDiscrepancies([s as never], noManifest).map((x) => x.code);

  it('three contiguous parts raise nothing', () => {
    expect(
      codes(
        stream([
          part(1, 1_000_000n, 2_000_000n),
          part(2, 2_033_334n, 3_000_000n),
          part(3, 3_033_334n, 4_000_000n),
        ]),
      ),
    ).toEqual([]);
  });

  it('part numbers that contradict PTS order are flagged, and PTS wins', () => {
    const out = partDiscrepancies(
      [
        stream([
          part(1, 3_000_000n, 4_000_000n), // numbered first, recorded last
          part(2, 1_000_000n, 2_000_000n),
        ]),
      ],
      noManifest,
    );
    const conflict = out.find((x) => x.code === 'PART-ORDER-CONFLICT');
    expect(conflict?.severity).toBe('flag');
    expect(conflict?.detail).toContain('contradict PTS order 2,1');
  });

  it('a gap beyond one frame interval is itemised, never absorbed', () => {
    const out = partDiscrepancies(
      [stream([part(1, 1_000_000n, 2_000_000n), part(2, 5_000_000n, 6_000_000n)])],
      noManifest,
    );
    const gap = out.find((x) => x.code === 'PART-GAP');
    expect(gap?.severity).toBe('flag');
    expect(gap?.detail).toContain('3.000 s');
  });

  it('a hole in the middle of the sequence quarantines', () => {
    const out = partDiscrepancies(
      [stream([part(1, 1_000_000n, 2_000_000n), part(3, 3_000_000n, 4_000_000n)])],
      noManifest,
    );
    const missing = out.find((x) => x.code === 'PART-MISSING-INTERIOR');
    expect(missing?.severity).toBe('quarantine');
    expect(missing?.detail).toContain('1 part absent between 1 and 3');
  });

  it('a part missing off the tail only flags', () => {
    const out = partDiscrepancies([stream([part(1, 1_000_000n, 2_000_000n)])], {
      segmentCounts: { color_left: 3 },
    } as never);
    const tail = out.find((x) => x.code === 'PART-MISSING-TAIL');
    expect(tail?.severity).toBe('flag');
  });
});
