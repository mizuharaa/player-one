import { encoderMismatches, type EncoderProfile } from '../../../../../tools/analysers/encoder.ts';
import { numParam, objParam, type Finding, type TuningMap } from '../types.ts';
import type { EpisodeFacts, MediaFacts } from './content.ts';

/**
 * PROVENANCE signals: "did this come from the enrolled physical device",
 * never "does this look generated". Every one of these is a measurement
 * against something the device is known to do — its sensor's noise pattern,
 * its IMU, its firmware's file layout — and the last one, the only
 * appearance-based heuristic, is capped at 'notice' in three places and can
 * never hold a bill on its own (scoring.ts).
 *
 * All of them need the media, so all of them are silent without it.
 */

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export function provenanceSignals(facts: EpisodeFacts, media: MediaFacts | null, tuning: TuningMap): Finding[] {
  const out: Finding[] = [];
  if (media === null) return out;
  const t = (id: string) => {
    const x = tuning.get(id);
    return x?.enabled ? x : null;
  };

  const prnu = t('PROV.PRNU_MISMATCH');
  if (prnu && media.prnu && media.prnu.frames >= numParam(prnu, 'min_frames', 30)) {
    const min = numParam(prnu, 'min_correlation', 0.05);
    if (media.prnu.correlation < min) {
      out.push({
        signalId: 'PROV.PRNU_MISMATCH',
        evidence: {
          device_serial: media.prnu.deviceSerial,
          correlation: r3(media.prnu.correlation),
          min_correlation: min,
          frames: media.prnu.frames,
          enrolled_at: media.prnu.enrolledAt,
        },
      });
    }
  }

  const decorr = t('PROV.IMU_VIDEO_DECORR');
  if (decorr && media.imuVideo && media.imuVideo.seconds >= numParam(decorr, 'min_seconds', 10)) {
    const min = numParam(decorr, 'min_correlation', 0.1);
    if (media.imuVideo.correlation < min) {
      out.push({
        signalId: 'PROV.IMU_VIDEO_DECORR',
        evidence: { correlation: r3(media.imuVideo.correlation), min_correlation: min, seconds: media.imuVideo.seconds },
      });
    }
  }

  const enc = t('PROV.ENCODER_MISMATCH');
  if (enc && media.encoder && facts.firmware !== null) {
    const profiles = objParam(enc, 'profiles');
    const profile = profiles[facts.firmware] as EncoderProfile | undefined;
    if (profile !== undefined && profile !== null) {
      const mismatches = encoderMismatches(media.encoder, profile);
      if (mismatches.length > 0) {
        out.push({
          signalId: 'PROV.ENCODER_MISMATCH',
          evidence: {
            firmware: facts.firmware,
            mismatches,
            observed_box_order: media.encoder.boxOrder,
            expected_box_order: profile.box_order ?? null,
            codec: media.encoder.codec,
            encoder_tag: media.encoder.encoderTag,
            gop: media.encoder.gop,
          },
        });
      }
    }
  }

  const recap = t('PROV.SCREEN_RECAPTURE');
  if (recap && media.recapture && media.recapture.frames >= numParam(recap, 'min_frames', 10)) {
    const m = media.recapture;
    const minBorder = numParam(recap, 'min_border_share', 0.9);
    const minGrid = numParam(recap, 'min_grid_energy', 0.3);
    const minFlicker = numParam(recap, 'min_flicker', 0.04);
    const cues: string[] = [];
    if (m.borderShare >= minBorder) cues.push(`a fixed dark border on ${Math.round(m.borderShare * 100)}% of frames`);
    if (m.gridEnergy >= minGrid) cues.push(`a fine periodic grid (energy ${r3(m.gridEnergy)})`);
    if (m.flicker >= minFlicker) cues.push(`brightness flicker of ${Math.round(m.flicker * 100)}% between frames`);
    // The border is the anchor; grid or flicker alone is also what a real
    // scene with blinds or a ceiling light can produce.
    if (m.borderShare >= minBorder && cues.length >= 2) {
      out.push({
        signalId: 'PROV.SCREEN_RECAPTURE',
        evidence: {
          cues,
          border_share: r3(m.borderShare),
          grid_energy: r3(m.gridEnergy),
          flicker: r3(m.flicker),
          frames: m.frames,
        },
      });
    }
  }

  const synth = t('PROV.SYNTHETIC_HEURISTIC');
  if (synth && media.frames && media.frames.count >= numParam(synth, 'min_frames', 10)) {
    const max = numParam(synth, 'max_noise_floor', 0.75);
    const sorted = [...media.frames.noiseFloor].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1] ?? 0;
    if (med < max) {
      out.push({
        signalId: 'PROV.SYNTHETIC_HEURISTIC',
        evidence: { noise_floor: r3(med), max_noise_floor: max, frames: media.frames.count },
      });
    }
  }

  return out;
}
