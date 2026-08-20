import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { ingest } from '../src/ingest.ts';
import { parseTimestamp } from '../src/csv.ts';

/**
 * Adversarial input. Everything here comes off a card a collector carried, so
 * none of it is trusted, and none of it may take the run down: a device that
 * writes half a line must produce a defect, not a stack trace.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'sessions');
const STEM = 'ego_SYNTH0000001_20260813_090800';

/** A copy of a healthy session, with one file replaced. */
async function damaged(suffix: string, content: string | Buffer) {
  const root = await mkdtemp(join(tmpdir(), 'px-hard-'));
  const src = join(FIXTURES, 'delivery-a', STEM);
  const dir = join(root, STEM);
  await cp(src, dir, { recursive: true });
  await writeFile(join(dir, suffix.startsWith('meta') ? suffix : `${STEM}_${suffix}`), content);

  const cacheDir = await mkdtemp(join(tmpdir(), 'px-hard-cache-'));
  const previous = process.env['PLAYERONE_CACHE'];
  process.env['PLAYERONE_CACHE'] = cacheDir;
  try {
    return await ingest(dir);
  } finally {
    if (previous === undefined) delete process.env['PLAYERONE_CACHE'];
    else process.env['PLAYERONE_CACHE'] = previous;
    await rm(root, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
}

const codes = (r: Awaited<ReturnType<typeof ingest>>) => r.discrepancies.map((x) => x.code);

describe('a timestamp that is not a timestamp', () => {
  it('accepts only non-negative integers', () => {
    expect(parseTimestamp('1786605795008991')).toBe(1786605795008991n);
    expect(parseTimestamp('0')).toBe(0n);
    for (const bad of ['', ' ', 'NOT_A_NUMBER', '-500', '1.5', '1e6', '0x10', '+7', '9'.repeat(20)]) {
      expect(parseTimestamp(bad), bad).toBeNull();
    }
  });

  it('a word in a sidecar is skipped and counted, not thrown', async () => {
    const r = await damaged(
      'camera_left_part0001_pts.csv',
      'timestamp_us\n1786611600000000\nNOT_A_NUMBER\n1786611600033334\n',
    );
    expect(codes(r)).toContain('ROWS-MALFORMED');
    expect(r.streams.find((s) => s.role === 'camera_left')?.sample_count).toBe(2);
  });

  it('a decimal is not silently truncated to an integer', async () => {
    const r = await damaged(
      'camera_left_part0001_pts.csv',
      'timestamp_us\n1786611600000000.5\n1786611600033334\n',
    );
    expect(codes(r)).toContain('ROWS-MALFORMED');
    expect(r.streams.find((s) => s.role === 'camera_left')?.sample_count).toBe(1);
  });

  it('an entirely negative sidecar leaves no stream timing and still emits a record', async () => {
    const r = await damaged('camera_left_part0001_pts.csv', 'timestamp_us\n-500\n-100\n');
    expect(r.schema_version).toBe('1.0.0');
    expect(r.timing.raw_duration_s).toBeGreaterThanOrEqual(0);
  });
});

describe('malformed IMU rows', () => {
  it('rows with too few columns are counted, not read past the end of the array', async () => {
    const r = await damaged(
      'imu_part0001.csv',
      'timestamp_us\t,x\t,y\t,z\t,type\n1786611600000000,1\n1786611600001000,1,2,3,accel\n',
    );
    expect(codes(r)).toContain('ROWS-MALFORMED');
  });

  it('a file whose rows carry no known type still reports itself', async () => {
    const r = await damaged(
      'imu_part0001.csv',
      'timestamp_us\t,x\t,y\t,z\t,type\n1786611600000000,1,2,3,\n1786611600001000,1,2,3,mystery\n',
    );
    // No accel or gyro stream exists to hang the complaint on, so the file speaks for itself.
    expect(codes(r)).toContain('ROWS-MALFORMED');
  });
});

describe('a calibration file that will not parse is not a calibration', () => {
  for (const [label, content] of [
    ['empty', ''],
    ['malformed yaml', 'sensor: [unclosed'],
    ['not a mapping', '- just\n- a\n- list\n'],
  ] as const) {
    it(`${label} quarantines`, async () => {
      const r = await damaged('calibration_camera.yaml', content);
      expect(codes(r)).toContain('CALIB-UNREADABLE');
      expect(r.state).toBe('quarantined');
      expect(r.calibration.present).toBe(false);
    });
  }
});

describe('a manifest that will not parse', () => {
  for (const [label, content] of [
    ['garbage', '{not json at all'],
    ['empty', ''],
  ] as const) {
    it(`${label} is flagged, never treated as a clean session`, async () => {
      const r = await damaged(`meta_${STEM}.json`, content);
      expect(codes(r)).toContain('MANIFEST-UNREADABLE');
      // Without this the episode reads as ok, because an unreadable manifest
      // contradicts nothing and every comparison quietly stops happening.
      expect(r.state).toBe('flagged');
      expect(r.declared).toBeNull();
    });
  }
});

describe('unrecognised files and part numbers', () => {
  it('files the engine does not know are carried, not dropped (ING-04)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'px-hard-'));
    const dir = join(root, STEM);
    await cp(join(FIXTURES, 'delivery-a', STEM), dir, { recursive: true });
    for (const junk of ['Thumbs.db', '.DS_Store', `${STEM}_camera_left_part0001.mp4.tmp`, 'notes.txt']) {
      await writeFile(join(dir, junk), '');
    }
    const cacheDir = await mkdtemp(join(tmpdir(), 'px-hard-cache-'));
    process.env['PLAYERONE_CACHE'] = cacheDir;
    try {
      const r = await ingest(dir);
      expect(r.unclassified_files).toHaveLength(4);
      expect(r.unclassified_files).toContain('Thumbs.db');
      expect(r.unclassified_files).toContain(`${STEM}_camera_left_part0001.mp4.tmp`);
    } finally {
      delete process.env['PLAYERONE_CACHE'];
      await rm(root, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('one stray high part number does not enumerate thousands of gaps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'px-hard-'));
    const dir = join(root, STEM);
    await cp(join(FIXTURES, 'delivery-a', STEM), dir, { recursive: true });
    await writeFile(join(dir, `${STEM}_camera_left_part9999.mp4`), '');
    await writeFile(join(dir, `${STEM}_camera_left_part9999_pts.csv`), 'timestamp_us\n1786611999000000\n');

    const cacheDir = await mkdtemp(join(tmpdir(), 'px-hard-cache-'));
    process.env['PLAYERONE_CACHE'] = cacheDir;
    try {
      const r = await ingest(dir);
      const gap = r.discrepancies.find((x) => x.code === 'PART-MISSING-INTERIOR')!;
      expect(gap.detail).toContain('9997 parts absent');
      expect(gap.detail.length).toBeLessThan(200);
    } finally {
      delete process.env['PLAYERONE_CACHE'];
      await rm(root, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('bad paths', () => {
  it('a directory that does not exist rejects with ENOENT rather than a partial record', async () => {
    await expect(ingest(join(tmpdir(), 'px-definitely-not-here'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('a file where a directory belongs rejects with ENOTDIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'px-hard-'));
    const file = join(root, 'a-file');
    await writeFile(file, 'hello');
    await expect(ingest(file)).rejects.toMatchObject({ code: 'ENOTDIR' });
    await rm(root, { recursive: true, force: true });
  });

  it('an empty directory is an episode with nothing in it, not an error (ING-17)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'px-hard-'));
    const dir = join(root, STEM);
    await cp(join(FIXTURES, 'delivery-a', STEM), dir, { recursive: true });
    for (const f of await readdir(dir)) await rm(join(dir, f));

    const cacheDir = await mkdtemp(join(tmpdir(), 'px-hard-cache-'));
    process.env['PLAYERONE_CACHE'] = cacheDir;
    try {
      const r = await ingest(dir);
      expect(r.state).toBe('quarantined');
      expect(codes(r)).toContain('MEDIA-MISSING');
      expect(r.streams).toEqual([]);
    } finally {
      delete process.env['PLAYERONE_CACHE'];
      await rm(root, { recursive: true, force: true });
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
