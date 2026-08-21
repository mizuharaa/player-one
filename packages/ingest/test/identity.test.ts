import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { ingestSession } from '../src/ingest.ts';
import {
  contentFingerprint,
  deriveEpisodeId,
  identityString,
  parseSessionBasename,
} from '@playerone/contracts';

/**
 * Episode identity. The highest-value test here is path independence: a card
 * handed in at the upload centre and a cloud re-download of the same session
 * must be one episode, or the collector is paid twice for one recording.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'sessions');
const SHA256_OF_NOTHING = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function fixture(label: string): Promise<string> {
  const dir = join(FIXTURES, label);
  const [only] = await readdir(dir);
  return join(dir, only!);
}

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

/** A copy of a fixture session under a parent directory of our choosing. */
async function deliveredTo(label: string, prefix: string, as?: string) {
  const src = await fixture(label);
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dir = join(root, as ?? src.split(/[\\/]/).pop()!);
  await cp(src, dir, { recursive: true });
  return { root, dir };
}

const codes = (r: { discrepancies: { code: string }[] }) => r.discrepancies.map((x) => x.code);

describe('the derivation itself (pure, no I/O)', () => {
  it('is a well-formed UUID v8 with the RFC 9562 variant', () => {
    expect(deriveEpisodeId('ego_AZER76400FE_20260813_072310')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('uppercases the serial and versions the identity string', () => {
    expect(identityString('ego_azer76400fe_20260813_072310')).toBe(
      'playerone:episode:v1:AZER76400FE:20260813T072310',
    );
    expect(deriveEpisodeId('ego_azer76400fe_20260813_072310')).toBe(
      deriveEpisodeId('ego_AZER76400FE_20260813_072310'),
    );
  });

  it('is stable across runs and distinct across sessions', () => {
    const a = deriveEpisodeId('ego_AZER76400FE_20260813_072310');
    expect(deriveEpisodeId('ego_AZER76400FE_20260813_072310')).toBe(a);
    expect(deriveEpisodeId('ego_AZER76400FE_20260813_072516')).not.toBe(a);
    expect(deriveEpisodeId('ego_OTHERSERIAL_20260813_072310')).not.toBe(a);
  });

  it('takes the basename only, so a mount point cannot change identity', () => {
    // The function is given a basename by contract; this is the guarantee that
    // makes /media/tf/... and /tmp/dl/... the same episode.
    expect(deriveEpisodeId('ego_AZER76400FE_20260813_072310')).not.toBe(
      deriveEpisodeId('/media/tf/ego_AZER76400FE_20260813_072310'),
    );
    expect(parseSessionBasename('/media/tf/ego_AZER76400FE_20260813_072310')).toBeNull();
  });

  it('falls back deterministically on a name that does not parse', () => {
    expect(identityString('not a session')).toBe('playerone:episode:v1:raw:not a session');
    expect(deriveEpisodeId('not a session')).toBe(deriveEpisodeId('not a session'));
    expect(deriveEpisodeId('not a session')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8/);
  });

  it('fingerprints an empty set as the sha256 of the empty string', () => {
    expect(contentFingerprint([])).toBe(SHA256_OF_NOTHING);
  });

  it('sorts by path in byte order and covers nothing but path and digest', () => {
    const files = [
      { relative_path: 'b.mp4', sha256: 'b'.repeat(64) },
      { relative_path: 'a.mp4', sha256: 'a'.repeat(64) },
    ];
    const byHand = createHash('sha256')
      .update(`a.mp4\n${'a'.repeat(64)}\nb.mp4\n${'b'.repeat(64)}\n`, 'utf8')
      .digest('hex');
    expect(contentFingerprint(files)).toBe(byHand);
    expect(contentFingerprint([...files].reverse())).toBe(byHand);
  });
});

describe('path independence (ING-30) — the same session by two routes is one episode', () => {
  it('two parent directories give one id, one fingerprint, and one record', async () => {
    const a = await deliveredTo('delivery-a', 'px-card-');
    const b = await deliveredTo('delivery-a', 'px-cloud-');

    const ra = await withCache(() => ingestSession(a.dir));
    const rb = await withCache(() => ingestSession(b.dir));

    expect(rb.record.episode_id).toBe(ra.record.episode_id);
    expect(rb.record.content_fingerprint).toBe(ra.record.content_fingerprint);

    // Everything except the two fields that are properties of the *run*.
    const strip = (r: typeof ra.record) =>
      JSON.stringify({ ...r, source: { ...r.source, ingested_at: '', ingest_host: '' } });
    expect(strip(rb.record)).toBe(strip(ra.record));

    await rm(a.root, { recursive: true, force: true });
    await rm(b.root, { recursive: true, force: true });
  });

  it('the fingerprint recomputes from the stored file list alone', async () => {
    // The invariant that makes episode_files auditable: no engine version, no
    // hostname and no run timestamp can be hiding in the fingerprint, because
    // the same digest falls out of the paths and hashes on their own.
    const { record, files } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    expect(contentFingerprint(files)).toBe(record.content_fingerprint);
  });

  it('the id is not the fingerprint, so corruption cannot rename the episode', async () => {
    const clean = await deliveredTo('delivery-a', 'px-clean-');
    const dirty = await deliveredTo('delivery-a', 'px-dirty-');
    const victim = 'ego_SYNTH0000001_20260813_090800_camera_left_part0001.mp4';

    const bytes = await readFile(join(dirty.dir, victim));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff; // one byte
    await writeFile(join(dirty.dir, victim), bytes);

    const a = await withCache(() => ingestSession(clean.dir));
    const b = await withCache(() => ingestSession(dirty.dir));

    expect(b.record.content_fingerprint).not.toBe(a.record.content_fingerprint);
    expect(b.record.episode_id).toBe(a.record.episode_id); // same episode, now with a difference to explain

    await rm(clean.root, { recursive: true, force: true });
    await rm(dirty.root, { recursive: true, force: true });
  });
});

describe('a directory name the engine cannot parse', () => {
  it('still ingests, with a deterministic fallback id and EPISODE-ID-FALLBACK', async () => {
    const { root, dir } = await deliveredTo('delivery-a', 'px-oddname-', 'session backup (2)');
    const r = await withCache(() => ingestSession(dir));

    expect(r.record.episode_id).toBe(deriveEpisodeId('session backup (2)'));
    expect(codes(r.record)).toContain('EPISODE-ID-FALLBACK');
    expect(r.record.discrepancies.find((d) => d.code === 'EPISODE-ID-FALLBACK')?.severity).toBe('flag');
    expect(r.record.streams.length).toBeGreaterThan(0); // ING-17: never discarded

    await rm(root, { recursive: true, force: true });
  });
});

describe('a serial the manifest disagrees with', () => {
  it('flags SERIAL-CONFLICT and leaves the id alone — the directory decides', async () => {
    const { root, dir } = await deliveredTo('delivery-a', 'px-serial-');
    const before = await withCache(() => ingestSession(dir));

    const manifestPath = join(dir, 'meta_ego_SYNTH0000001_20260813_090800.json');
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    parsed.device.serial_number = 'SOMEOTHERDEVICE';
    await writeFile(manifestPath, JSON.stringify(parsed, null, 2));

    const after = await withCache(() => ingestSession(dir));
    expect(codes(after.record)).toContain('SERIAL-CONFLICT');
    expect(after.record.discrepancies.find((d) => d.code === 'SERIAL-CONFLICT')?.detail).toContain(
      'SOMEOTHERDEVICE',
    );
    expect(after.record.episode_id).toBe(before.record.episode_id);
    // The manifest is a hint (ING-02): it did not touch the fingerprint either.
    expect(after.record.content_fingerprint).toBe(before.record.content_fingerprint);

    await rm(root, { recursive: true, force: true });
  });
});

describe('an empty session directory', () => {
  it('fingerprints as the sha256 of the empty string and keeps its identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'px-empty-'));
    const dir = join(root, 'ego_AZER76400FE_20260813_072415');
    await mkdir(dir);

    const { record, files } = await withCache(() => ingestSession(dir));
    expect(files).toHaveLength(0);
    expect(record.content_fingerprint).toBe(SHA256_OF_NOTHING);
    expect(record.episode_id).toBe(deriveEpisodeId('ego_AZER76400FE_20260813_072415'));
    expect(record.state).toBe('quarantined'); // kept, with reasons — never discarded
    expect(codes(record)).toContain('MEDIA-MISSING');

    await rm(root, { recursive: true, force: true });
  });
});
