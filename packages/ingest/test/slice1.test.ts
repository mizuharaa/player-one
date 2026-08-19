import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { discover } from '../src/discover.ts';
import { reduceImuTimestamps, reduceTimestamps, spanS } from '../src/csv.ts';
import { PAXINI_ROOT, hasPaxini, hasSession, session } from './sessions.ts';

const dir = session('072310');
const f = (name: string) => join(dir, `ego_AZER76400FE_20260813_072310_${name}`);

describe.skipIf(!hasSession('072310'))('072310 — discovery (ING-01..05)', () => {
  it('classifies every file, nothing unclassified', async () => {
    const d = await discover(dir);
    expect(d.layout).toBe('session');
    expect(d.unclassified).toEqual([]);
    expect(d.deviceName).toBe('ego');
    expect(d.deviceSerial).toBe('AZER76400FE');
    expect(d.sessionTimestamp).toBe('20260813_072310');
    expect(d.entries).toHaveLength(10);
    expect(d.entries.filter((e) => e.kind === 'manifest')).toHaveLength(1);
    expect(d.entries.filter((e) => e.kind === 'calibration')).toHaveLength(2);
    expect(d.entries.filter((e) => e.kind === 'media')).toHaveLength(4);
    expect(d.entries.filter((e) => e.kind === 'pts')).toHaveLength(3);
  });

  it('parses role and part number off the filename', async () => {
    const d = await discover(dir);
    const left = d.entries.find((e) => e.kind === 'media' && e.role === 'camera_left');
    expect(left?.partNumber).toBe(1);
    const audio = d.entries.find((e) => e.kind === 'media' && e.role === 'audio');
    expect(audio?.partNumber).toBeNull();
  });
});

describe.skipIf(!hasSession('072310'))('072310 — timestamp reduce', () => {
  it('left camera PTS: 256 samples, 8.500015 s', async () => {
    const r = (await reduceTimestamps(f('camera_left_part0001_pts.csv')))!;
    expect(r.count).toBe(256); // header is not data; manifest declares 260
    expect(r.first).toBe(1786605795008991n);
    expect(r.last).toBe(1786605803509006n);
    expect(spanS(r)).toBeCloseTo(8.500015, 6);
    expect(r.medianDeltaUs).toBe(33334n); // 30 Hz
  });

  it('IMU: 18480 rows resolve to 9240 accel + 9240 gyro (ING-27)', async () => {
    const r = await reduceImuTimestamps(f('imu_part0001.csv'));
    expect(r.rows).toBe(18480);
    expect(r.accel?.count).toBe(9240);
    expect(r.gyro?.count).toBe(9240);
    expect(r.accel?.first).toBe(1786605794504771n);
    expect(spanS(r.accel!)).toBeCloseTo(9.252233, 6);
    expect(r.accel?.medianDeltaUs).toBe(1001n); // ~1 kHz
  });

  it('a zero-byte PTS sidecar reduces to null, it does not throw (ING-11)', async () => {
    if (!hasSession('072538')) return;
    const empty = join(
      session('072538'),
      'ego_AZER76400FE_20260813_072538_camera_left_part0001_pts.csv',
    );
    expect(await reduceTimestamps(empty)).toBeNull();
  });

  it('072538 audio PTS is cut mid-digit at 8192 bytes: partial line dropped, span stays sane', async () => {
    if (!hasSession('072538')) return;
    const r = (await reduceTimestamps(
      join(session('072538'), 'ego_AZER76400FE_20260813_072538_audio_pts.csv'),
    ))!;
    expect(r.truncatedTail).toBe(true);
    expect(r.count).toBe(481);
    expect(r.last).toBe(1786605962707147n);
    expect(spanS(r)).toBeCloseTo(20.479542, 6);
  });
});

describe.skipIf(!hasPaxini())('the other PaXini format is named, not mistaken for a broken session', () => {
  it('a DF-2 episode batch reports layout paxini_episode', async () => {
    const d = await discover(join(PAXINI_ROOT, 'data', 'part_01'));
    expect(d.layout).toBe('paxini_episode');
    expect(d.entries).toEqual([]);
    expect(d.unclassified).toHaveLength(100);
  });

  it('a batch root reports layout nested rather than looking empty', async () => {
    const d = await discover(join(PAXINI_ROOT, 'data'));
    expect(d.layout).toBe('nested');
    expect(d.subdirs).toHaveLength(10);
  });
});

describe('any PaXini device emitting this layout, not just the ego', () => {
  it('reads a different device name, serial and a third camera', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'px-'));
    const stem = 'torso_QWER1234567_20260901_101500';
    await mkdir(join(dir, stem));
    for (const suffix of [
      'camera_left_part0001.mp4',
      'camera_left_part0001_pts.csv',
      'camera_right_part0001.mp4',
      'camera_right_part0001_pts.csv',
      'camera_center_part0001.mp4',
      'camera_center_part0001_pts.csv',
      'imu_part0001.csv',
      'audio.wav',
      'audio_pts.csv',
      'calibration_camera.yaml',
      'calibration_imu.yaml',
    ]) {
      await writeFile(join(dir, stem, `${stem}_${suffix}`), '');
    }
    await writeFile(join(dir, stem, `meta_${stem}.json`), '{}');

    const d = await discover(join(dir, stem));
    expect(d.layout).toBe('session');
    expect(d.deviceName).toBe('torso');
    expect(d.deviceSerial).toBe('QWER1234567');
    expect(d.unclassified).toEqual([]);
    // the third camera becomes a stream, not an unclassified file the timing engine ignores
    expect(d.entries.filter((e) => e.kind === 'media' && e.role?.startsWith('camera_'))).toHaveLength(3);
    expect(d.entries.find((e) => e.kind === 'media' && e.role === 'camera_center')?.partNumber).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });
});
