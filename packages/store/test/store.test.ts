import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { ingestSession } from '../../ingest/src/ingest.ts';
import {
  defectsOf,
  filesOf,
  ingestsOf,
  listEpisodes,
  showEpisode,
  storeEpisode,
  streamsOf,
  type MismatchPayload,
} from '../src/index.ts';
import { episodeIngests, episodes } from '../src/schema.ts';
import { closeDb, db, hasDb, truncate, useDatabase } from './db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('store');

/**
 * The store, against a real Postgres. Everything here is about two failures
 * that are undetectable without it: the same session paid for twice, and a
 * file whose bytes changed between deliveries with no prior state to notice.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'sessions');
const STEM = 'ego_SYNTH0000001_20260813_090800';

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

/** A writable copy of a fixture, so a delivery can be damaged between runs. */
async function copyOf(label: string) {
  const root = await mkdtemp(join(tmpdir(), 'px-store-'));
  const dir = join(root, STEM);
  await cp(await fixture(label), dir, { recursive: true });
  return { root, dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe.skipIf(!hasDb())('the episode store', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  // -- re-ingest ------------------------------------------------------------

  it('a session never seen before is inserted whole', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    const r = await storeEpisode(await db(), record);

    expect(r.outcome).toBe('new');
    const [ep] = await (await db()).select().from(episodes).where(eq(episodes.episodeId, r.episodeId));
    expect(ep!.ingestCount).toBe(1);
    expect(ep!.latestIngestId).toBe(r.ingestId);
    expect(ep!.deviceSerial).toBe('SYNTH0000001');
    expect(ep!.sessionStartedAt).toBe('20260813_090800');

    expect(await filesOf(await db(), r.ingestId!)).toHaveLength(files.length);
    expect(await streamsOf(await db(), r.ingestId!)).toHaveLength(record.streams.length);
    expect(await defectsOf(await db(), r.ingestId!)).toHaveLength(record.discrepancies.length);
  });

  it('the same session delivered twice is one episode and one ingest, not two payments', async () => {
    const a = await withCache(async () => ingestSession(await fixture('delivery-a')));
    // A different parent directory: the card at the upload centre and the cloud copy.
    const b = await withCache(async () => ingestSession(await fixture('delivery-b')));
    expect(b.record.content_fingerprint).toBe(a.record.content_fingerprint);

    const first = await storeEpisode(await db(), a.record, new Date('2026-08-20T10:00:00Z'));
    const second = await storeEpisode(await db(), b.record, new Date('2026-08-20T11:00:00Z'));

    expect(second.outcome).toBe('duplicate');
    expect(second.episodeId).toBe(first.episodeId);
    expect(await ingestsOf(await db(), first.episodeId)).toHaveLength(1);

    const [ep] = await (await db()).select().from(episodes).where(eq(episodes.episodeId, first.episodeId));
    expect(ep!.ingestCount).toBe(1);
    expect(ep!.lastSeenAt.toISOString()).toBe('2026-08-20T11:00:00.000Z'); // advanced
    expect(ep!.firstSeenAt.toISOString()).toBe('2026-08-20T10:00:00.000Z'); // not
  });

  it('one byte changed in one file raises CHECKSUM-MISMATCH and names the file', async () => {
    const c = await copyOf('delivery-a');
    const before = await withCache(() => ingestSession(c.dir));
    await storeEpisode(await db(), before.record);

    const victim = `${STEM}_camera_left_part0001.mp4`;
    const bytes = await readFile(join(c.dir, victim));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    await writeFile(join(c.dir, victim), bytes);

    const after = await withCache(() => ingestSession(c.dir));
    const r = await storeEpisode(await db(), after.record);

    expect(r.outcome).toBe('mismatch');
    expect(await ingestsOf(await db(), r.episodeId)).toHaveLength(2);
    const [ep] = await (await db()).select().from(episodes).where(eq(episodes.episodeId, r.episodeId));
    expect(ep!.ingestCount).toBe(2);
    expect(ep!.latestIngestId).toBe(r.ingestId);

    // A reviewer must be able to name the file from the record alone.
    expect(r.mismatch!.changed).toHaveLength(1);
    expect(r.mismatch!.changed[0]!.relative_path).toBe(victim);
    expect(r.mismatch!.changed[0]!.prior_sha256).toBe(
      before.files.find((f) => f.relative_path === victim)!.sha256,
    );
    expect(r.mismatch!.changed[0]!.current_sha256).toBe(
      after.files.find((f) => f.relative_path === victim)!.sha256,
    );
    expect(r.mismatch!.added).toEqual([]);
    expect(r.mismatch!.removed).toEqual([]);

    const defect = (await defectsOf(await db(), r.ingestId!)).find(
      (d) => d.code === 'CHECKSUM-MISMATCH',
    );
    expect(defect?.severity).toBe('flag');
    expect((defect?.payload as MismatchPayload).changed[0]!.relative_path).toBe(victim);
    expect(defect && (defect.payload as { detail: string }).detail).toContain(victim);

    // Attached to the returned record too — the one store-time discovery.
    expect(r.record.discrepancies.map((d) => d.code)).toContain('CHECKSUM-MISMATCH');
    expect(r.record.state).not.toBe('ok');

    await c.cleanup();
  });

  it('a file added and a file removed are reported as such, not as changes', async () => {
    const c = await copyOf('delivery-a');
    const before = await withCache(() => ingestSession(c.dir));
    await storeEpisode(await db(), before.record);

    await writeFile(join(c.dir, `${STEM}_audio_pts.csv.bak`), 'stray\n');
    await rm(join(c.dir, `${STEM}_audio.wav`));

    const after = await withCache(() => ingestSession(c.dir));
    const r = await storeEpisode(await db(), after.record);

    expect(r.outcome).toBe('mismatch');
    expect(r.mismatch!.added.map((a) => a.relative_path)).toContain(`${STEM}_audio_pts.csv.bak`);
    expect(r.mismatch!.removed.map((x) => x.relative_path)).toContain(`${STEM}_audio.wav`);
    expect(r.mismatch!.changed).toEqual([]);

    await c.cleanup();
  });

  // -- persistence ----------------------------------------------------------

  it('a BigInt microsecond timestamp round-trips through numeric(20,0) exactly', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    const doctored = {
      ...record,
      streams: record.streams.map((s, i) =>
        i === 0 ? { ...s, first_pts_us: '1786605795008991', last_pts_us: '1786605795008991' } : s,
      ),
    };
    const r = await storeEpisode(await db(), doctored);
    const stored = await streamsOf(await db(), r.ingestId!);
    const audio = stored.find((s) => s.streamName === doctored.streams[0]!.role)!;

    // A string, not a number: a numeric read into a JS number is the precision
    // loss this whole column type exists to prevent.
    expect(audio.firstTimestampUs).toBe('1786605795008991');
    expect(BigInt(audio.firstTimestampUs!)).toBe(1786605795008991n);
  });

  it('a duration round-trips to the microsecond, asserted as a string', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    const doctored = { ...record, timing: { ...record.timing, raw_duration_s: 8.500011 } };
    const r = await storeEpisode(await db(), doctored);

    const [row] = await (await db())
      .select()
      .from(episodeIngests)
      .where(eq(episodeIngests.ingestId, r.ingestId!));
    expect(row!.measuredDurationS).toBe('8.500011');
  });

  it('a stream with a broken clock stores its real span, and says it was excluded', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('clock-fault')));
    const r = await storeEpisode(await db(), record);
    const stored = await streamsOf(await db(), r.ingestId!);
    const imu = stored.find((s) => s.streamName === 'imu_accel')!;

    // 1.7 billion seconds. At the spec'd numeric(12,6) this row is rejected and
    // the session cannot be stored at all, which would break ING-17.
    expect(Number(imu.durationS)).toBeGreaterThan(1e6);
    expect(imu.excluded).toBe(true);
    expect(imu.exclusionReason).toContain('excluded from the usable window');
  });

  it('a quarantined session is stored in full, with its defects', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('no-calibration')));
    expect(record.state).toBe('quarantined');
    const r = await storeEpisode(await db(), record);

    const [row] = await (await db())
      .select()
      .from(episodeIngests)
      .where(eq(episodeIngests.ingestId, r.ingestId!));
    expect(row!.state).toBe('quarantined');
    expect(row!.manifestPresent).toBe(true);
    expect((await defectsOf(await db(), r.ingestId!)).map((d) => d.code)).toContain('CALIB-MISSING');
    expect(await filesOf(await db(), r.ingestId!)).toHaveLength(files.length);
  });

  it('a session with no manifest stores in full', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('no-manifest')));
    const r = await storeEpisode(await db(), record);

    const [row] = await (await db())
      .select()
      .from(episodeIngests)
      .where(eq(episodeIngests.ingestId, r.ingestId!));
    expect(row!.manifestPresent).toBe(false);
    expect(row!.declaredDurationS).toBeNull();
    expect(await filesOf(await db(), r.ingestId!)).toHaveLength(files.length);
  });

  it('record_json comes back byte-identical to the record that was printed', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    const printed = JSON.stringify(record, null, 2);
    const r = await storeEpisode(await db(), record);

    const detail = await showEpisode(await db(), r.episodeId);
    expect(JSON.stringify(detail.latest!.record, null, 2)).toBe(printed);
  });

  it('the stored file list still recomputes the stored fingerprint', async () => {
    const { contentFingerprint } = await import('@playerone/contracts');
    const { record, files } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    const r = await storeEpisode(await db(), record);
    expect(contentFingerprint(await filesOf(await db(), r.ingestId!))).toBe(
      record.content_fingerprint,
    );
  });

  // -- transactionality -----------------------------------------------------

  it('a failure part-way through leaves no rows at all, never a half record', async () => {
    const { record } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    // Two rows for one path violates UNIQUE (ingest_id, relative_path), and it
    // does so *after* the ingest row has been inserted.
    const poisoned = {
      ...record,
      source_files: [...record.source_files, record.source_files[0]!],
    };

    await expect(storeEpisode(await db(), poisoned)).rejects.toThrow();

    expect(await (await db()).select().from(episodes)).toHaveLength(0);
    expect(await (await db()).select().from(episodeIngests)).toHaveLength(0);
  });

  // -- read path ------------------------------------------------------------

  it('--list shows one line per episode, newest first, filterable by state', async () => {
    const a = await withCache(async () => ingestSession(await fixture('delivery-a')));
    const b = await withCache(async () => ingestSession(await fixture('no-calibration')));
    await storeEpisode(await db(), a.record, new Date('2026-08-20T10:00:00Z'));
    await storeEpisode(await db(), b.record, new Date('2026-08-20T12:00:00Z'));

    const all = await listEpisodes(await db());
    expect(all).toHaveLength(2);
    expect(all[0]!.state).toBe('quarantined'); // newest first
    expect(all[0]!.ingestCount).toBe(1);
    expect(all[0]!.measuredDurationS).toMatch(/^\d+\.\d{6}$/); // a string, still exact

    expect(await listEpisodes(await db(), { state: 'flagged' })).toHaveLength(1);
    expect(await listEpisodes(await db(), { limit: 1 })).toHaveLength(1);
  });

  it('--show accepts an unambiguous prefix and refuses an ambiguous one', async () => {
    const { record, files } = await withCache(async () => ingestSession(await fixture('delivery-a')));
    const r = await storeEpisode(await db(), record);

    const byPrefix = await showEpisode(await db(), r.episodeId.slice(0, 8));
    expect(byPrefix.episodeId).toBe(r.episodeId);
    expect(byPrefix.latest!.record.content_fingerprint).toBe(record.content_fingerprint);

    await expect(showEpisode(await db(), 'ffffffff')).rejects.toThrow(/no episode matches/);
  });

  it('--show lists every prior ingest, because history is append-only', async () => {
    const c = await copyOf('delivery-a');
    const before = await withCache(() => ingestSession(c.dir));
    await storeEpisode(await db(), before.record, new Date('2026-08-20T10:00:00Z'));

    const victim = `${STEM}_camera_left_part0001.mp4`;
    const bytes = await readFile(join(c.dir, victim));
    bytes[0] = bytes[0]! ^ 0xff;
    await writeFile(join(c.dir, victim), bytes);
    const after = await withCache(() => ingestSession(c.dir));
    const r = await storeEpisode(await db(), after.record, new Date('2026-08-20T12:00:00Z'));

    const detail = await showEpisode(await db(), r.episodeId);
    expect(detail.ingestCount).toBe(2);
    expect(detail.prior).toHaveLength(1);
    expect(detail.prior[0]!.fingerprint).toBe(before.record.content_fingerprint);
    expect(detail.prior[0]!.engineVersion).toBe(before.record.source.ingest_tool_version);

    await c.cleanup();
  });

  // -- ING-34: the card is evidence -----------------------------------------

  it('storing writes nothing to the source directory', async () => {
    const c = await copyOf('delivery-a');
    const snapshot = async () =>
      Promise.all(
        (await readdir(c.dir)).sort().map(async (n) => {
          const st = await stat(join(c.dir, n));
          return `${n}|${st.size}|${st.mtimeMs}`;
        }),
      );

    const before = await snapshot();
    const { record, files } = await withCache(() => ingestSession(c.dir));
    await storeEpisode(await db(), record);
    expect(await snapshot()).toEqual(before);

    await c.cleanup();
  });
});
