import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { discover } from '../src/discover.ts';
import { readManifest } from '../src/manifest.ts';
import { readCalibration } from '../src/calibration.ts';
import { computeTiming, hasClockFault, readStreams } from '../src/timing.ts';
import { hasSession, session } from './sessions.ts';

const onDisk = (d: Awaited<ReturnType<typeof discover>>) =>
  new Set(d.entries.map((e) => e.file).concat(d.unclassified));

async function timingFor(dir: string) {
  const d = await discover(dir);
  const m = await readManifest(d.entries.find((e) => e.kind === 'manifest')?.path ?? null, onDisk(d));
  const streams = await readStreams(d.entries);
  return { d, m, streams, t: computeTiming(streams, m.declared) };
}

describe.skipIf(!hasSession('072310'))('072310 — the money benchmark (ING-06..10)', () => {
  it('raw_duration_s is 8.500, not the manifest and not the IMU', async () => {
    const { t } = await timingFor(session('072310'));
    expect(t.rawDurationS).toBeCloseTo(8.5, 2);
    expect(t.rawDurationS).not.toBeCloseTo(12.852, 2); // manifest wall clock
    expect(t.rawDurationS).not.toBeCloseTo(9.252, 2); // IMU span
  });

  it('takes the intersection, and the union it rejected would have been 9.286', async () => {
    const { t } = await timingFor(session('072310'));
    expect(t.unionDurationS).toBeCloseTo(9.286, 2);
    expect(t.rawDurationS).toBeLessThan(t.unionDurationS);
  });

  it('max_stream_skew_ms is 504', async () => {
    const { t } = await timingFor(session('072310'));
    expect(t.maxStreamSkewMs).toBeGreaterThan(499);
    expect(t.maxStreamSkewMs).toBeLessThan(509);
  });

  it('timing is exact from the sidecars', async () => {
    const { t } = await timingFor(session('072310'));
    expect(t.method).toBe('pts_sidecar');
    expect(t.confidence).toBe('exact');
  });

  it('declared frame count is kept beside the measured one (ING-16)', async () => {
    const { m, streams } = await timingFor(session('072310'));
    expect(m.declared.video_left_frame_count).toBe(260);
    expect(streams.find((s) => s.role === 'camera_left')?.sampleCount).toBe(256);
  });

  it('the manifest files block does not resolve, and is recorded as such (ING-01)', async () => {
    const { m } = await timingFor(session('072310'));
    expect(m.unresolvedFiles.length).toBeGreaterThan(0);
    expect(m.unresolvedFiles).toContain('ego_AZER76400FE_20260813_072310_camera_left.mp4');
  });

  it('audio is present despite audio_frame_count 0 (ING-15)', async () => {
    const { m, streams } = await timingFor(session('072310'));
    expect(m.declared.audio_frame_count).toBe(0);
    expect(streams.find((s) => s.role === 'audio')?.sampleCount).toBe(207);
  });

  it('calibration carries its own serial and its own camera names (ING-24, ING-25)', async () => {
    const d = await discover(session('072310'));
    const cal = await readCalibration(d.entries);
    expect(cal.present).toBe(true);
    expect(cal.serial).toBe('CH5LB5400J5');
    expect(cal.serial).not.toBe(d.deviceSerial);
    expect(cal.cameraNames).toEqual(['IR_L', 'IR_R']);
    const m = await readManifest(d.entries.find((e) => e.kind === 'manifest')!.path, onDisk(d));
    expect(m.cameraNames).toEqual(['color_left', 'color_right']); // conflict recorded, not resolved
  });
});

describe.skipIf(!hasSession('072516'))('072516 — a stream whose clock base is wrong', () => {
  it('the IMU is excluded, and the episode keeps its 10.4 s instead of reading zero', async () => {
    const { streams, t } = await timingFor(session('072516'));
    const imu = streams.find((s) => s.role === 'imu_accel')!;
    expect(hasClockFault(imu)).toBe(true);
    expect(streams.filter((s) => s.role.startsWith('camera_')).every((s) => !hasClockFault(s))).toBe(true);
    expect(t.rawDurationS).toBeCloseTo(10.4, 1);
  });

  it('audio delivered out of order still reports a sane span', async () => {
    const { streams } = await timingFor(session('072516'));
    const audio = streams.find((s) => s.role === 'audio')!;
    expect(audio.backwardsSteps).toBeGreaterThan(0);
    expect(hasClockFault(audio)).toBe(false);
    expect(Number(audio.spanUs) / 1e6).toBeCloseTo(11.733, 2);
  });
});

describe.skipIf(!hasSession('072538'))('072538 — zero-byte sidecars fall back to the container (ING-11, ING-12)', () => {
  it('cameras come from the container, and the container cannot position them', async () => {
    const { streams } = await timingFor(session('072538'));
    const left = streams.find((s) => s.role === 'camera_left')!;
    expect(left.source).toBe('container');
    expect(left.firstUs).toBeNull();
    expect(Number(left.spanUs) / 1e6).toBeCloseTo(20.98, 2);
  });

  it('method is not pts_sidecar and confidence drops below exact', async () => {
    const { t } = await timingFor(session('072538'));
    expect(t.method).not.toBe('pts_sidecar');
    expect(t.confidence).not.toBe('exact');
  });

  it('every sidecar is cut, so the container length is the answer, not 21.71', async () => {
    const { streams, t } = await timingFor(session('072538'));
    expect(streams.filter((s) => s.source === 'sidecar').every((s) => s.truncatedTail)).toBe(true);
    expect(t.rawDurationS).toBeCloseTo(20.98, 2);
    expect(t.rawDurationS).not.toBeCloseTo(21.71, 1); // exceeds the video's own length
    expect(t.rawDurationS).toBeLessThanOrEqual(t.unionDurationS);
  });
});

describe.skipIf(!hasSession('072310'))('a session with no manifest still ingests (ING-03)', () => {
  it('recovers identity from the directory and times off the sidecars', async () => {
    const src = session('072310');
    const stem = 'ego_AZER76400FE_20260813_072310';
    const root = await mkdtemp(join(tmpdir(), 'px-nomanifest-'));
    const dir = join(root, stem);
    await mkdir(dir);

    // Sidecars and calibration are the real files; media are stand-ins, since
    // the sidecars mean nothing here has to open a container.
    for (const suffix of [
      'camera_left_part0001_pts.csv',
      'camera_right_part0001_pts.csv',
      'audio_pts.csv',
      'imu_part0001.csv',
      'calibration_camera.yaml',
      'calibration_imu.yaml',
    ]) {
      await copyFile(join(src, `${stem}_${suffix}`), join(dir, `${stem}_${suffix}`));
    }
    for (const suffix of [
      'camera_left_part0001.mp4',
      'camera_right_part0001.mp4',
      'audio.wav',
    ]) {
      await writeFile(join(dir, `${stem}_${suffix}`), '');
    }

    const { d, m, t } = await timingFor(dir);
    expect(d.deviceSerial).toBe('AZER76400FE');
    expect(m.present).toBe(false);
    expect(m.declared.duration_sec).toBeNull();
    expect(t.rawDurationS).toBeCloseTo(8.5, 2);
    expect(t.method).toBe('pts_sidecar');

    await rm(root, { recursive: true, force: true });
  });
});
