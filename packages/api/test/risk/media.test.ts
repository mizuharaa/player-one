import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { corpusCheck } from '../../../../tools/analysers/corpus-check.ts';
import { encoderMismatches, probeEncoder } from '../../../../tools/analysers/encoder.ts';
import { decodeFrames, frameStats, runTool, ToolMissing } from '../../../../tools/analysers/frames.ts';
import { imuVideoCorrelation, readImuCsv } from '../../../../tools/analysers/imu.ts';
import { moovGate, parseMoovLine } from '../../../../tools/analysers/moov.ts';
import { InMemoryEnrolment, enrol, prnuCorrelation } from '../../../../tools/analysers/prnu.ts';
import { measureRecapture } from '../../../../tools/analysers/recapture.ts';
import { devicePattern, writeSession, type WrittenSession } from '../../../../tools/analysers/synth.ts';
import { contentSignals, type EpisodeFacts, type MediaFacts } from '../../src/risk/detectors/content.ts';
import { provenanceSignals } from '../../src/risk/detectors/provenance.ts';
import { measureEpisodeMedia } from '../../src/risk/media.ts';
import { signalIds, tuningFromCatalogue } from './helpers.ts';
import { episodeRecord } from '../fixtures.ts';

/**
 * The media signals, on synthetic sessions with known-planted abuse. Every
 * clip is rendered from a seed and encoded with the ffmpeg on PATH; nothing
 * here needs docs/sample_data or a database. Each planted case fires its own
 * signal and no other; a clean clip fires nothing.
 *
 * Skipped cleanly when ffmpeg is missing, the way the ingest tests skip
 * without the corpus.
 */

const T = tuningFromCatalogue();
const FIRST_US = 1_786_611_600_000_000n; // 2026-08-13 09:00:00 device epoch

async function hasFfmpeg(): Promise<boolean> {
  try {
    const { code } = await runTool('ffmpeg', ['-version']);
    return code === 0;
  } catch (err) {
    if (err instanceof ToolMissing) return false;
    throw err;
  }
}

async function hasPython(): Promise<boolean> {
  for (const cmd of ['python', 'python3']) {
    try {
      const { code } = await runTool(cmd, ['--version']);
      if (code === 0) return true;
    } catch (err) {
      if (!(err instanceof ToolMissing)) throw err;
    }
  }
  return false;
}

const ffmpeg = await hasFfmpeg();
const python = await hasPython();

/** The store-side facts of a synthetic episode, as `episodeFactsFor` would return them. */
const facts = (s: WrittenSession, over: Partial<EpisodeFacts> = {}): EpisodeFacts => ({
  episodeId: 'e1',
  collectorId: 'c1',
  collectorRef: 'c-0001',
  deviceSerial: 'SYNTHA000001',
  firmware: '1.0.3',
  taskType: 'kitchen',
  declaredS: 20 * 1.34,
  measuredS: 20,
  contentFingerprint: 'a'.repeat(64),
  hasAudioStream: s.audio !== null,
  audioSampleCount: s.audio !== null ? 16000 * 20 : 0,
  imuClockFault: null,
  ...over,
});

const noBaseline = { ratio: null, episodes: 0, source: 'none' as const };

describe.skipIf(!ffmpeg)('the media analysers on synthetic sessions', () => {
  let root: string;
  const sessions = new Map<string, WrittenSession>();
  let n = 0;
  const session = async (name: string, over: Partial<Parameters<typeof writeSession>[0]> = {}): Promise<WrittenSession> => {
    n += 1;
    const s = await writeSession({
      parent: root,
      serial: over.serial ?? 'SYNTHA000001',
      date: '20260813',
      time: String(90000 + n).padStart(6, '0'),
      // A minute apart, so every session's IMU sits inside the hour that
      // corpus_check.py allows around its manifest start_time.
      firstUs: FIRST_US + BigInt(n) * 60_000_000n,
      seconds: 20,
      seed: 100 + n,
      ...over,
    });
    sessions.set(name, s);
    return s;
  };

  /** Everything the engine would measure for one session, through the same code path. */
  const measure = async (s: WrittenSession, prnu?: InMemoryEnrolment): Promise<MediaFacts> => {
    const record = episodeRecord({ basename: s.basename, measured: 20, declared: 26.8, serial: 'SYNTHA000001' });
    // The camera's own start, which is what the IMU clock is judged against.
    record.timing = { ...record.timing, usable_start_us: String(s.firstUs), usable_end_us: String(s.firstUs + 20_000_000n) };
    record.streams = [
      { role: 'camera_left', parts: [{ file: `${s.basename}_camera_left_part0001.mp4`, bytes: 1, sha256: 'b'.repeat(64) }], pts_source: 'sidecar', first_pts_us: '0', last_pts_us: '1', sample_count: s.frames, span_s: 20, nominal_rate_hz: 10 },
      ...(s.audio ? [{ role: 'audio', parts: [{ file: `${s.basename}_audio_part0001.wav`, bytes: 1, sha256: 'c'.repeat(64) }], pts_source: 'sidecar' as const, first_pts_us: '0', last_pts_us: '1', sample_count: 320000, span_s: 20, nominal_rate_hz: 16000 }] : []),
      ...(s.imu ? [{ role: 'imu_gyro', parts: [{ file: `${s.basename}_imu_part0001.csv`, bytes: 1, sha256: 'd'.repeat(64) }], pts_source: 'sidecar' as const, first_pts_us: '0', last_pts_us: '1', sample_count: 2000, span_s: 20, nominal_rate_hz: 100 }] : []),
    ];
    const m = await measureEpisodeMedia({ deviceSerial: 'SYNTHA000001', sourceBasename: s.basename, record }, { mediaRoot: root, prnu });
    expect(m, 'the session folder was not found under the media root').not.toBeNull();
    return m!;
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'risk-media-'));
  }, 120_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('decodes a clip into 64×64 grey frames at one per second', async () => {
    const s = await session('clean');
    const set = await decodeFrames(s.video, { fps: 1 });
    expect(set.width).toBe(64);
    expect(set.frames.length).toBeGreaterThanOrEqual(19);
    expect(set.frames.length).toBeLessThanOrEqual(21);
    const stats = frameStats(set);
    expect(stats.ahash.every((h) => /^[0-9a-f]{16}$/.test(h))).toBe(true);
    // A real-looking clip: moving, lit, noisy.
    expect(stats.motion.reduce((a, b) => a + b, 0) / stats.motion.length).toBeGreaterThan(2);
    expect(stats.meanLuma.every((m) => m > 24)).toBe(true);
    expect(stats.noiseFloor.reduce((a, b) => a + b, 0) / stats.noiseFloor.length).toBeGreaterThan(0.75);
  }, 60_000);

  it('a clean session fires no content or provenance signal', async () => {
    const s = sessions.get('clean')!;
    const m = await measure(s);
    expect(m.tools['frames']).toBe('ok');
    expect(m.tools['moov']).toBe('ok');
    if (python) expect(m.tools['corpus_check']).toBe('ok');
    const content = contentSignals(facts(s), [], noBaseline, m, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(content)).toEqual([]);
    expect(signalIds(provenanceSignals(facts(s), m, T))).toEqual([]);
  }, 120_000);

  it('records a frame fingerprint on a clean session, as a record and not a finding', async () => {
    const s = sessions.get('clean')!;
    const m = await measure(s);
    const fp = contentSignals(facts(s), [], noBaseline, m, T).find((f) => f.signalId === 'CONT.FINGERPRINT');
    expect(fp).toBeDefined();
    expect(String(fp!.evidence['ahash']).length).toBe(16 * (fp!.evidence['frames'] as number));
  }, 120_000);

  it('static footage fires only STATIC_SCENE', async () => {
    const s = await session('static', { content: 'static' });
    const m = await measure(s);
    const f = contentSignals(facts(s), [], noBaseline, m, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(f)).toEqual(['CONT.STATIC_SCENE']);
    expect(f[0]!.evidence['motion_energy']).toBeLessThan(2);
    // The IMU says the head moved; the picture did not. Whether that reads
    // as IMU_VIDEO_DECORR is a coin flip at twenty seconds — the picture's
    // "motion" is sensor noise, and its correlation with the gyro is whatever
    // chance gives — so the claim here is only that a still scene trips no
    // OTHER provenance signal. STATIC_SCENE is its own signal for that reason.
    const prov = signalIds(provenanceSignals(facts(s), m, T));
    expect(prov.filter((id) => id !== 'PROV.IMU_VIDEO_DECORR')).toEqual([]);
  }, 120_000);

  it('a covered lens fires only LOW_LUMA_VARIANCE', async () => {
    const s = await session('dark', { content: 'dark' });
    const m = await measure(s);
    const f = contentSignals(facts(s), [], noBaseline, m, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(f)).toEqual(['CONT.LOW_LUMA_VARIANCE']);
    expect(f[0]!.evidence['dark_share']).toBeGreaterThanOrEqual(0.8);
  }, 120_000);

  it('a filmed screen fires only SCREEN_RECAPTURE', async () => {
    const s = await session('recapture', { content: 'recapture' });
    const m = await measure(s);
    expect(m.recapture!.borderShare).toBeGreaterThanOrEqual(0.9);
    const f = provenanceSignals(facts(s), m, T);
    expect(signalIds(f)).toEqual(['PROV.SCREEN_RECAPTURE']);
    expect((f[0]!.evidence['cues'] as string[]).length).toBeGreaterThanOrEqual(2);
    expect(signalIds(contentSignals(facts(s), [], noBaseline, m, T).filter((x) => x.signalId !== 'CONT.FINGERPRINT'))).toEqual([]);
  }, 120_000);

  it('a decorrelated IMU fires only IMU_VIDEO_DECORR', async () => {
    // Sixty seconds: the Pearson correlation of two independent series of
    // twenty samples wanders ±0.25 by chance, of sixty about ±0.13. Measured
    // on five seeds at 60 s: −0.108, −0.037, −0.002, 0.012, 0.000.
    const s = await session('decorr', { imu: 'decorrelated', seconds: 60, seed: 13 });
    const m = await measure(s);
    expect(m.imuVideo).not.toBeNull();
    const f = provenanceSignals(facts(s), m, T);
    expect(signalIds(f)).toEqual(['PROV.IMU_VIDEO_DECORR']);
    expect(f[0]!.evidence['correlation']).toBeLessThan(0.1);
    // And the correlated one from the clean session is well above the edge (measured 0.51–0.66).
    const clean = await measure(sessions.get('clean')!);
    expect(clean.imuVideo!.correlation).toBeGreaterThan(0.3);
  }, 180_000);

  it('a truncated index fires only TIMING_TRUNCATED, and an over-long one only TIMING_PACKET_DELTA', async () => {
    if (!python) return;
    const short = await session('short', { pts: 'short', status: 'recording' });
    const ms = await measure(short);
    expect(ms.corpus).not.toBeNull();
    const fs = contentSignals(facts(short), [], noBaseline, ms, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(fs)).toEqual(['CONT.TIMING_TRUNCATED']);
    expect(fs[0]!.evidence).toMatchObject({ stream: 'camera_left', pts_rows: short.frames - 10, media_packets: short.frames });

    const long = await session('long', { pts: 'long' });
    const ml = await measure(long);
    const fl = contentSignals(facts(long), [], noBaseline, ml, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(fl)).toEqual(['CONT.TIMING_PACKET_DELTA']);
    expect(fl[0]!.evidence).toMatchObject({ stream: 'camera_left', delta: 10 });
  }, 180_000);

  it('a sidecar cut mid-value is TIMING_TRUNCATED too, on the partial tail', async () => {
    if (!python) return;
    const s = await session('partial', { pts: 'partial', status: 'recording' });
    const m = await measure(s);
    const f = contentSignals(facts(s), [], noBaseline, m, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(f)).toEqual(['CONT.TIMING_TRUNCATED']);
    expect(f[0]!.evidence['partial_tail']).toBe(true);
  }, 120_000);

  it('the 072516 clock defect fires only IMU_CLOCK_DRIFT', async () => {
    if (!python) return;
    const s = await session('clock', { imu: 'clock_fault' });
    const m = await measure(s);
    expect(m.corpus!.imu.clock_outlier_rows).toBe(916);
    const f = contentSignals(facts(s), [], noBaseline, m, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(f)).toEqual(['CONT.IMU_CLOCK_DRIFT']);
    expect(f[0]!.evidence['clock_outlier_rows']).toBe(916);
  }, 120_000);

  it('silence where the task expects sound fires only AUDIO_ABSENT', async () => {
    const s = await session('silent', { audio: 'silent' });
    const m = await measure(s);
    expect(m.audio!.meanVolumeDb).toBeLessThan(-60);
    const f = contentSignals(facts(s), [], noBaseline, m, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(f)).toEqual(['CONT.AUDIO_ABSENT']);
    expect(f[0]!.evidence['reason']).toBe('silent');
    const quietTask = tuningFromCatalogue({ 'CONT.AUDIO_ABSENT': { params: { silent_tasks: ['kitchen'] } } });
    expect(contentSignals(facts(s), [], noBaseline, m, quietTask).filter((f) => f.signalId !== 'CONT.FINGERPRINT')).toEqual([]);
  }, 120_000);

  it('a re-encoded, non-fragmented file fires only ENCODER_MISMATCH against the firmware profile', async () => {
    const s = await session('reencoded', { fragmented: false });
    const m = await measure(s);
    expect(m.encoder!.fragmented).toBe(false);
    const f = provenanceSignals(facts(s), m, T);
    expect(signalIds(f)).toEqual(['PROV.ENCODER_MISMATCH']);
    expect((f[0]!.evidence['mismatches'] as string[]).join(' ')).toContain('not a fragmented MP4');
    // An unknown firmware has no profile and is not judged.
    expect(provenanceSignals(facts(s, { firmware: '9.9.9' }), m, T)).toEqual([]);
    // The device-shaped clip matches the profile on everything it states.
    const clean = await measure(sessions.get('clean')!);
    expect(encoderMismatches(clean.encoder!, { box_order: ['ftyp', 'moov'], fragmented: true, codec: 'h264' })).toEqual([]);
  }, 120_000);

  it('a noiseless clip fires only SYNTHETIC_HEURISTIC, and it stays a notice', async () => {
    const s = await session('clean-render', { noise: 0 });
    const m = await measure(s);
    const f = provenanceSignals(facts(s), m, T);
    expect(signalIds(f)).toEqual(['PROV.SYNTHETIC_HEURISTIC']);
    expect(T.get('PROV.SYNTHETIC_HEURISTIC')!.severity).toBe('notice');
  }, 120_000);

  it('PRNU: footage from an enrolled unit correlates, footage from another unit does not', async () => {
    const unitA = devicePattern(0xa11ce);
    const unitB = devicePattern(0xb0b);
    const enrolment = await session('enrol-a', { pattern: unitA, seconds: 40, seed: 7 });
    const set = await decodeFrames(enrolment.video, { fps: 1 });
    const fp = enrol(set, 'SYNTHA000001', { source: 'test enrolment' });
    const store = new InMemoryEnrolment([fp]);

    const genuine = await session('genuine-a', { pattern: unitA, seconds: 40, seed: 8 });
    const cg = prnuCorrelation(await decodeFrames(genuine.video, { fps: 1 }), fp)!;
    const foreign = await session('foreign-b', { pattern: unitB, seconds: 40, seed: 9 });
    const cf = prnuCorrelation(await decodeFrames(foreign.video, { fps: 1 }), fp)!;
    // Measured: 0.994 for the enrolled unit, 0.049 for the other one.
    expect(cg).toBeGreaterThan(0.5);
    expect(cf).toBeLessThan(0.15);

    const mg = await measure(genuine, store);
    expect(mg.prnu!.correlation).toBeCloseTo(cg, 3);
    expect(provenanceSignals(facts(genuine), mg, T)).toEqual([]);
    const mf = await measure(foreign, store);
    const f = provenanceSignals(facts(foreign), mf, T);
    expect(signalIds(f)).toEqual(['PROV.PRNU_MISMATCH']);
    // No enrolment, no evaluation: the stub never fires.
    const none = await measure(foreign);
    expect(none.prnu).toBeNull();
    expect(provenanceSignals(facts(foreign), none, T)).toEqual([]);
  }, 240_000);

  it('near-duplicate: a copied clip matches by frame fingerprint, a different one does not', async () => {
    const original = sessions.get('clean')!;
    const mo = await measure(original);
    // The same seed renders the same texture, noise and scroll: a copied clip in a new session folder.
    const copy = await session('copy', { seed: 101, motion: original.motionPerSecond });
    const mc = await measure(copy);
    const peers = [{ episodeId: 'e-orig', collectorRef: 'c-0009', method: 'frame_fingerprint' as const, ahash: mo.frames!.ahash }];
    const f = contentSignals(facts(copy), peers, noBaseline, mc, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT');
    expect(signalIds(f)).toEqual(['CONT.NEAR_DUPLICATE']);
    expect(f[0]!.evidence).toMatchObject({ other_episode_id: 'e-orig', other_collector_ref: 'c-0009', method: 'frame_fingerprint' });
    const different = await measure(sessions.get('dark')!);
    expect(contentSignals(facts(copy), [{ ...peers[0]!, ahash: different.frames!.ahash }], noBaseline, mc, T).filter((f) => f.signalId !== 'CONT.FINGERPRINT')).toEqual([]);
  }, 120_000);

  it('the moov gate wrapper reads the script’s verdicts back', async () => {
    const s = sessions.get('clean')!;
    const [v] = await moovGate([s.video]);
    expect(v!.verdict).toBe('FRONT');
    expect(v!.boxes.slice(0, 2)).toEqual(['ftyp', 'moov']);
    expect(v!.boxes).toContain('moof');
    expect(parseMoovLine('x.mp4  unreadable: ENOENT', 'x.mp4').verdict).toBe('unreadable');
    expect(parseMoovLine(`${'y.mp4'.padEnd(58)} ${'123'.padStart(12)} B  ftyp mdat moov  ->  BACK — seeking needs the tail first; remux at ingest`, 'y.mp4')).toMatchObject({ verdict: 'BACK', boxes: ['ftyp', 'mdat', 'moov'], sizeBytes: 123 });
    const [gone] = await moovGate([join(root, 'absent.mp4')]);
    expect(gone!.verdict).toBe('unreadable');
  }, 60_000);

  it('the corpus_check wrapper links one session into a scratch directory and reads its JSON', async () => {
    if (!python) return;
    const s = sessions.get('clean')!;
    const report = await corpusCheck(s.dir);
    expect(report.session).toBe(s.basename);
    expect(report.streams['camera_left']!.verdict).toBe('FRAMECOUNT-MISMATCH'); // the manifest overstates, as the device's does
    expect(report.streams['camera_left']!.media_packets).toBe(s.frames);
    expect(report.imu.clock_outlier_rows).toBe(0);
  }, 120_000);

  it('probes the encoder and the IMU as the engine would', async () => {
    const s = sessions.get('clean')!;
    const enc = await probeEncoder(s.video);
    expect(enc.codec).toBe('h264');
    expect(enc.fragmented).toBe(true);
    expect(enc.gop).toBeGreaterThan(0);
    const imu = await readImuCsv(s.imu!);
    expect(imu.gyroRows).toBe(2000);
    expect(imu.gyroPerSecond.length).toBe(20);
    const set = await decodeFrames(s.video, { fps: 1 });
    const c = imuVideoCorrelation(frameStats(set), imu);
    expect(c!.seconds).toBeGreaterThanOrEqual(18);
    expect(measureRecapture(set).borderShare).toBe(0);
  }, 60_000);
});
