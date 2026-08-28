import { hamming, type FrameStats } from '../../../../../tools/analysers/frames.ts';
import type { CorpusSession } from '../../../../../tools/analysers/corpus-check.ts';
import type { EncoderProbe } from '../../../../../tools/analysers/encoder.ts';
import type { MoovVerdict } from '../../../../../tools/analysers/moov.ts';
import type { RecaptureMeasure } from '../../../../../tools/analysers/recapture.ts';
import { numParam, strListParam, type Finding, type TuningMap } from '../types.ts';

/**
 * CONTENT signals. Two sources, read separately so the signals that need no
 * media still run at an upload centre where the footage has moved on:
 *
 *   EpisodeFacts   what the store already knows — the ingest record, the
 *                  streams, the defects, the fingerprint. Always available.
 *   MediaFacts     what the analysers measured from the files. Available
 *                  only when the engine has a `mediaRoot` and the session
 *                  folder is still there; null otherwise, and the media
 *                  signals are simply not evaluated (never "clear").
 *
 * The wrapped analysers are the hardware checkout's own: corpus_check.py's
 * verdicts become CONT.TIMING_*, its IMU clock count becomes
 * CONT.IMU_CLOCK_DRIFT, and moov.ts's verdict becomes CONT.MOOV_DAMAGED.
 * Nothing about their arithmetic is repeated here.
 */

export type EpisodeFacts = {
  episodeId: string;
  collectorId: string;
  collectorRef: string;
  deviceSerial: string;
  firmware: string | null;
  taskType: string | null;
  /** Manifest duration_sec, advisory. Null when the manifest had none. */
  declaredS: number | null;
  /** The engine's raw_duration_s. */
  measuredS: number;
  contentFingerprint: string;
  hasAudioStream: boolean;
  audioSampleCount: number;
  /** The ingest engine's clock-fault exclusion on the IMU stream, if any. */
  imuClockFault: string | null;
};

/** Another episode whose content matches this one, found by the loader. */
export type DuplicatePeer = {
  episodeId: string;
  collectorRef: string;
  method: 'content_fingerprint' | 'file_digest' | 'frame_fingerprint';
  /** For file_digest: the shared file. */
  file?: string;
  /** For frame_fingerprint: the other episode's hash sequence. */
  ahash?: string[];
};

/** What this device (or the fleet) usually reads for manifest ÷ measured. */
export type Baseline = { ratio: number | null; episodes: number; source: 'device' | 'fleet' | 'none' };

export type MediaFacts = {
  moov: MoovVerdict[];
  corpus: CorpusSession | null;
  frames: FrameStats | null;
  audio: { meanVolumeDb: number | null } | null;
  encoder: EncoderProbe | null;
  recapture: RecaptureMeasure | null;
  prnu: { deviceSerial: string; correlation: number; frames: number; enrolledAt: string } | null;
  imuVideo: { correlation: number; seconds: number } | null;
  /** Which tools ran, for the META.EVALUATED row. */
  tools: Record<string, string>;
};

/** sha256 of nothing. Two empty sessions share it and are not duplicates of each other. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Aligned frame-hash comparison at a few offsets, so a clip trimmed by a few
 * seconds still matches. The share is over the shorter sequence.
 */
export function frameMatch(
  a: readonly string[],
  b: readonly string[],
  maxHamming: number,
  maxOffset = 10,
): { matching: number; share: number; offset: number } {
  let best = { matching: 0, share: 0, offset: 0 };
  const shorter = Math.min(a.length, b.length);
  if (shorter === 0) return best;
  for (let off = -maxOffset; off <= maxOffset; off++) {
    let matching = 0;
    let compared = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + off;
      if (j < 0 || j >= b.length) continue;
      compared++;
      if (hamming(a[i]!, b[j]!) <= maxHamming) matching++;
    }
    if (compared === 0) continue;
    const share = matching / shorter;
    if (matching > best.matching) best = { matching, share, offset: off };
  }
  return best;
}

export function contentSignals(
  facts: EpisodeFacts,
  peers: readonly DuplicatePeer[],
  baseline: Baseline,
  media: MediaFacts | null,
  tuning: TuningMap,
): Finding[] {
  const out: Finding[] = [];
  const t = (id: string) => {
    const x = tuning.get(id);
    return x?.enabled ? x : null;
  };

  // --- from the store -------------------------------------------------------

  const delta = t('CONT.PTS_MANIFEST_DELTA');
  if (delta && facts.declaredS !== null && facts.declaredS > 0 && facts.measuredS > 0 && baseline.ratio !== null) {
    const tolerance = numParam(delta, 'tolerance', 0.1);
    const ratio = facts.declaredS / facts.measuredS;
    if (Math.abs(ratio - baseline.ratio) > tolerance) {
      out.push({
        signalId: 'CONT.PTS_MANIFEST_DELTA',
        evidence: {
          declared_s: r2(facts.declaredS),
          measured_s: r2(facts.measuredS),
          ratio: r3(ratio),
          baseline_ratio: r3(baseline.ratio),
          baseline_episodes: baseline.episodes,
          baseline_source: baseline.source,
          tolerance,
        },
      });
    }
  }

  const dup = t('CONT.NEAR_DUPLICATE');
  if (dup) {
    const maxHamming = numParam(dup, 'max_hamming_per_frame', 6);
    const minFrames = numParam(dup, 'min_matching_frames', 20);
    const minShare = numParam(dup, 'min_match_share', 0.9);
    let best: { peer: DuplicatePeer; share: number; matching: number } | null = null;
    for (const p of peers) {
      if (p.method === 'content_fingerprint') {
        if (facts.contentFingerprint === EMPTY_SHA256) continue;
        best = { peer: p, share: 1, matching: 0 };
        break;
      }
      if (p.method === 'file_digest') {
        if (best === null || best.share < 1) best = { peer: p, share: 1, matching: 0 };
        continue;
      }
      if (p.method === 'frame_fingerprint' && media?.frames && p.ahash) {
        const m = frameMatch(media.frames.ahash, p.ahash, maxHamming);
        if (m.matching >= minFrames && m.share >= minShare && (best === null || m.share > best.share)) {
          best = { peer: p, share: m.share, matching: m.matching };
        }
      }
    }
    if (best !== null) {
      out.push({
        signalId: 'CONT.NEAR_DUPLICATE',
        evidence: {
          other_episode_id: best.peer.episodeId,
          other_collector_ref: best.peer.collectorRef,
          method: best.peer.method,
          match_share: r2(best.share),
          matching_frames: best.matching,
          ...(best.peer.file ? { file: best.peer.file } : {}),
        },
      });
    }
  }

  const audio = t('CONT.AUDIO_ABSENT');
  if (audio) {
    const silentTasks = new Set(strListParam(audio, 'silent_tasks'));
    const type = facts.taskType ?? '(unknown)';
    if (!silentTasks.has(type)) {
      const maxDb = numParam(audio, 'max_mean_volume_db', -60);
      let reason: string | null = null;
      if (!facts.hasAudioStream) reason = 'no_stream';
      else if (facts.audioSampleCount === 0) reason = 'empty_stream';
      else if (media?.audio && media.audio.meanVolumeDb !== null && media.audio.meanVolumeDb <= maxDb) reason = 'silent';
      if (reason !== null) {
        out.push({
          signalId: 'CONT.AUDIO_ABSENT',
          evidence: {
            reason,
            task_type: type,
            mean_volume_db: media?.audio?.meanVolumeDb ?? null,
            max_mean_volume_db: maxDb,
          },
        });
      }
    }
  }

  const clock = t('CONT.IMU_CLOCK_DRIFT');
  if (clock) {
    const maxRows = numParam(clock, 'max_outlier_rows', 0);
    const rows = media?.corpus?.imu.clock_outlier_rows ?? 0;
    if (rows > maxRows) {
      out.push({
        signalId: 'CONT.IMU_CLOCK_DRIFT',
        evidence: { clock_outlier_rows: rows, max_outlier_rows: maxRows, source: 'corpus_check.py', detail: `warm-up measured from the first sane row: ${media?.corpus?.imu.warmup_sec ?? '?'} s` },
      });
    } else if (facts.imuClockFault !== null) {
      out.push({
        signalId: 'CONT.IMU_CLOCK_DRIFT',
        evidence: { clock_outlier_rows: 0, max_outlier_rows: maxRows, source: 'ingest', detail: facts.imuClockFault },
      });
    }
  }

  // --- from the media ---------------------------------------------------------

  if (media === null) return out;

  const moov = t('CONT.MOOV_DAMAGED');
  if (moov) {
    const bad = media.moov.find((m) => m.verdict !== 'FRONT');
    if (bad) {
      out.push({
        signalId: 'CONT.MOOV_DAMAGED',
        evidence: { file: bad.file, verdict: bad.detail, boxes: bad.boxes, files_checked: media.moov.length },
      });
    }
  }

  if (media.corpus) {
    const streams = Object.entries(media.corpus.streams);
    const truncated = t('CONT.TIMING_TRUNCATED');
    if (truncated) {
      const hit = streams.find(([, s]) => s.verdict === 'PTS-TRUNCATED');
      if (hit) {
        const [name, s] = hit;
        out.push({
          signalId: 'CONT.TIMING_TRUNCATED',
          evidence: {
            stream: name,
            pts_rows: s.pts_rows,
            media_packets: s.media_packets,
            partial_tail: s.pts_partial_tail,
            buffer_boundary_bytes: s.buffer_suspect.map((b) => b.bytes),
            session_status: media.corpus.status,
          },
        });
      }
    }
    const packet = t('CONT.TIMING_PACKET_DELTA');
    if (packet) {
      const hit = streams.find(([, s]) => s.verdict === 'MEDIA-TRUNCATED');
      if (hit) {
        const [name, s] = hit;
        out.push({
          signalId: 'CONT.TIMING_PACKET_DELTA',
          evidence: {
            stream: name,
            pts_rows: s.pts_rows,
            media_packets: s.media_packets,
            delta: s.pts_rows - (s.media_packets ?? 0),
          },
        });
      }
    }
  }

  if (media.frames) {
    const f = media.frames;
    const still = t('CONT.STATIC_SCENE');
    // `min_frames` counts frames; the motion series is one shorter.
    const meanLuma = f.count > 0 ? f.meanLuma.reduce((a, b) => a + b, 0) / f.count : 0;
    // A dark picture has no motion to measure; that is LOW_LUMA_VARIANCE's finding, not this one's.
    if (still && f.count >= numParam(still, 'min_frames', 20) && f.motion.length > 0 && meanLuma >= numParam(still, 'min_mean_luma', 24)) {
      const max = numParam(still, 'max_motion_energy', 2.0);
      const energy = f.motion.reduce((a, b) => a + b, 0) / f.motion.length;
      if (energy < max) {
        out.push({
          signalId: 'CONT.STATIC_SCENE',
          evidence: { motion_energy: r2(energy), max_motion_energy: max, frames: f.count },
        });
      }
    }
    const luma = t('CONT.LOW_LUMA_VARIANCE');
    if (luma && f.count >= numParam(luma, 'min_frames', 10)) {
      const maxLuma = numParam(luma, 'max_mean_luma', 24);
      const maxStd = numParam(luma, 'max_flat_std', 2.0);
      const minShare = numParam(luma, 'min_share', 0.8);
      const dark = f.meanLuma.filter((m) => m < maxLuma).length / f.count;
      const flat = f.std.filter((s) => s < maxStd).length / f.count;
      if (dark >= minShare || flat >= minShare) {
        out.push({
          signalId: 'CONT.LOW_LUMA_VARIANCE',
          evidence: {
            dark_share: r2(dark),
            flat_share: r2(flat),
            mean_luma: r2(f.meanLuma.reduce((a, b) => a + b, 0) / f.count),
            frames: f.count,
            max_mean_luma: maxLuma,
            max_flat_std: maxStd,
          },
        });
      }
    }
    if (t('CONT.FINGERPRINT') && f.count > 0) {
      out.push({ signalId: 'CONT.FINGERPRINT', evidence: { frames: f.count, ahash: f.ahash.join('') } });
    }
  }

  return out;
}
