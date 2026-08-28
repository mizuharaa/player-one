import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentFingerprint, EpisodeRecord, windowDiscrepancies } from '@playerone/contracts';
import { ingest } from '../src/ingest.ts';
import { SESSIONS_ROOT, hasSession } from './sessions.ts';

/**
 * The record is the one document every downstream component reads, so anything
 * it claims must be checkable from the document alone.
 *
 * The claim under test is the expensive one: `content_fingerprint` decides
 * whether two deliveries of a session are the same delivery, and a consumer
 * that cannot recompute it has to take it on trust. Before `source_files` the
 * record named digests for media and calibration only — six files out of the
 * ten a real session fingerprints — so the PTS sidecars and any unclassified
 * file had no digest anywhere in it. Verification needed the store's
 * `episode_files` rows, which the record's own readers do not have.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'sessions');

async function everySession(): Promise<string[]> {
  const out: string[] = [];
  for (const label of await readdir(FIXTURES)) {
    const dir = join(FIXTURES, label);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) out.push(join(dir, entry.name));
    }
  }
  if (hasSession('072310')) {
    for (const entry of await readdir(SESSIONS_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory()) out.push(join(SESSIONS_ROOT, entry.name));
    }
  }
  return out;
}

describe('the record can verify itself', () => {
  it('recomputes its own fingerprint from source_files, on every session', async () => {
    const sessions = await everySession();
    expect(sessions.length).toBeGreaterThan(15);

    for (const dir of sessions) {
      const record = await ingest(dir);
      expect(
        contentFingerprint(record.source_files),
        `${basename(dir)} cannot recompute its own fingerprint`,
      ).toBe(record.content_fingerprint);
    }
  });

  it('names a digest for every file it says was delivered', async () => {
    for (const dir of await everySession()) {
      const record = await ingest(dir);
      const named = new Set(record.source_files.map((f) => f.relative_path));

      // Everything the record mentions elsewhere must appear in the inventory,
      // or the document contradicts itself.
      for (const s of record.streams) {
        for (const p of s.parts) expect(named, `${basename(dir)}: ${p.file}`).toContain(p.file);
      }
      for (const f of record.calibration.files) {
        expect(named, `${basename(dir)}: ${f.file}`).toContain(f.file);
      }
      for (const name of record.unclassified_files) {
        expect(named, `${basename(dir)}: ${name}`).toContain(name);
      }
    }
  });

  it('excludes the manifest, which is what keeps a device rewrite from reading as corruption', async () => {
    const dir = join(FIXTURES, 'delivery-a');
    const [only] = await readdir(dir);
    const record = await ingest(join(dir, only!));
    const manifests = record.source_files.filter((f) => f.relative_path.startsWith('meta_'));
    expect(manifests).toHaveLength(0);
  });

  it('is sorted by path in byte order, so the digest is reproducible', async () => {
    for (const dir of await everySession()) {
      const record = await ingest(dir);
      const paths = record.source_files.map((f) => f.relative_path);
      expect(paths, basename(dir)).toEqual([...paths].sort());
    }
  });

  /**
   * The store quarantines a record whose `raw_duration_s` is longer than the
   * window its own timestamps describe. That rule is only safe if the engine —
   * the legitimate producer of these records — never trips it, so the check
   * runs over every session there is: 22 fixtures, and the 5 real ones when the
   * corpus is present. A failure here is the check being wrong, not the session.
   */
  it('never claims more duration than its own window holds, on every session', async () => {
    for (const dir of await everySession()) {
      const record = await ingest(dir);
      expect(
        windowDiscrepancies(record).map((d) => d.detail),
        `${basename(dir)} contradicts its own timestamps`,
      ).toEqual([]);
    }
  });

  it('still parses as an EpisodeRecord at the new schema version', async () => {
    const dir = join(FIXTURES, 'delivery-a');
    const [only] = await readdir(dir);
    const record = await ingest(join(dir, only!));
    expect(record.schema_version).toBe('1.1.0');
    expect(() => EpisodeRecord.parse(record)).not.toThrow();
  });
});
