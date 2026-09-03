import { describe, expect, it } from 'vitest';
import { RISK_CATALOGUE } from '../../src/risk/catalogue.ts';
import {
  RISK_LOCALES,
  RISK_MESSAGES,
  bandLabel,
  missingRiskKeys,
  placeholdersOf,
  render,
  sentence,
  type RiskMessageKey,
} from '../../src/risk/sentences.ts';

/**
 * Every flag renders as one plain sentence with the number that caused it,
 * in English, Chinese and Vietnamese. The catalogue tests mirror the console
 * catalogue's (console.test.ts): every locale holds every key, nothing is a
 * pasted copy, and every locale uses the same placeholders so a number in
 * the English sentence cannot be missing from the Vietnamese one.
 */

/** One evidence object per signal, in the shape its detector produces. */
const SAMPLE: Record<string, Record<string, unknown>> = {
  'META.EVALUATED': { findings: 2 },
  'IDENT.NAME_MISMATCH': { declared_name: 'NGUYEN VAN A', verified_name: 'NGUYEN VAN B' },
  'IDENT.PHONE_SHARED': { phone_masked: '090•••••12', count: 2, other_collector_refs: ['c-0002', 'c-0003'] },
  'IDENT.ACCOUNT_SHARED': { bank_code: 'VCB', account_no_last4: '1234', count: 1, other_collector_refs: ['c-0002'] },
  'IDENT.MUID_SHARED': { m_u_id_masked: '123…789', count: 1, other_collector_refs: ['c-0002'] },
  'IDENT.ACCOUNT_CHANGED_LATE': { changed_at: '2026-08-20', period_end: '2026-08-21', days_before_end: 1.5 },
  'IDENT.UNVERIFIED_KYC': { verified_at: '2026-08-20', sub_return_code: -1103 },
  'IDENT.KYC_LIMIT_REPEATED': { occurrences: 3, max_occurrences: 2, sub_return_code: -406 },
  'IDENT.WALLET_LOCKED': { verified_at: '2026-08-20', sub_return_code: -1011 },
  'VOL.HOURS_PER_DAY': { day: '2026-08-12', hours: 13.4, max_hours: 12, episodes: 9 },
  'VOL.ABOVE_COHORT_P95': { day: '2026-08-12', episodes: 43, p95: 11, cohort_days: 312 },
  'VOL.STEP_CHANGE': { day: '2026-08-12', minutes: 410, median_minutes: 95, ratio: 4.3 },
  'VOL.NO_GAP': { episode_a: 'a', episode_b: 'b', overlap_s: 121 },
  'VOL.NOCTURNAL': { night_minutes: 90, total_minutes: 120, share: 0.75, night_hours: '23:00–05:00', task_type: 'kitchen' },
  'CONT.MOOV_DAMAGED': { file: 'x.mp4', verdict: 'DAMAGED — moov is at the front, but the boxes do not tile the file' },
  'CONT.TIMING_TRUNCATED': { stream: 'camera_left', pts_rows: 3854, media_packets: 3990 },
  'CONT.TIMING_PACKET_DELTA': { stream: 'camera_left', pts_rows: 310, media_packets: 300 },
  'CONT.IMU_CLOCK_DRIFT': { clock_outlier_rows: 916, detail: 'warm-up measured from the first sane row' },
  'CONT.PTS_MANIFEST_DELTA': { declared_s: 200, measured_s: 100, ratio: 2.0, baseline_ratio: 1.34, baseline_episodes: 12 },
  'CONT.NEAR_DUPLICATE': { other_episode_id: 'e2', other_collector_ref: 'c-0002', method: 'frame_fingerprint', match_share: 0.97 },
  'CONT.STATIC_SCENE': { frames: 120, motion_energy: 0.4, max_motion_energy: 2 },
  'CONT.LOW_LUMA_VARIANCE': { dark_share: 0.95, flat_share: 0.9, mean_luma: 6.1 },
  'CONT.AUDIO_ABSENT': { reason: 'silent', task_type: 'kitchen' },
  'CONT.FINGERPRINT': { frames: 120 },
  'CONT.REDELIVERY_CHURN': { deliveries: 4, mismatch_deliveries: 3, max_deliveries: 2, hours_between: 6.2 },
  'CONT.MEDIA_SUBSTITUTED': { changed_media_count: 1, changed_media: ['left_part0001.mp4'], measured_s: 140, prior_measured_s: 100 },
  'PROV.PRNU_MISMATCH': { correlation: 0.01, device_serial: 'AZER76400FE', min_correlation: 0.05 },
  'PROV.IMU_VIDEO_DECORR': { seconds: 118, correlation: -0.02, min_correlation: 0.1 },
  'PROV.ENCODER_MISMATCH': { firmware: '1.0.3', mismatches: ['not a fragmented MP4', 'box order ftyp free mdat moov instead of ftyp moov…'] },
  'PROV.SCREEN_RECAPTURE': { cues: ['a fixed dark border on 100% of frames', 'a fine periodic grid (energy 1.1)'], frames: 60 },
  'PROV.SYNTHETIC_HEURISTIC': { noise_floor: 0.2, max_noise_floor: 0.75 },
  'PROV.STALE_RECORDING': { recorded_at: '2026-06-01', first_delivered_at: '2026-08-20', age_days: 80, max_age_days: 30 },
  'HIST.REPEAT_CONTENT_FINDINGS': { episodes: 3, episodes_evaluated: 10, share: 0.3, signals: ['CONT.NEAR_DUPLICATE'], max_episodes: 2 },
  'HIST.PRIOR_ACCEPTED_HOLDS': { accepted_holds: 2, max_accepted: 1, signal_ids: ['CONT.NEAR_DUPLICATE'], last_cleared_at: '2026-08-01' },
  'OPS.REVIEW_TOO_FAST': { reviewer_ref: 'pax-01', verdict: 'pass', time_to_verdict_s: 12, measured_duration_s: 133 },
  'OPS.APPROVAL_OUTLIER': { reviewer_ref: 'pax-01', approval_rate: 0.99, decided: 40, reviewers: 4, cohort_median: 0.7 },
  'OPS.SELF_DEALING': { operator_ref: 'op-hcm', created_at: '2026-08-01', paid_action: 'bill.pay', paid_at: '2026-08-21' },
  'OPS.CONCENTRATION': { operator_ref: 'op-hcm', share: 0.92, events: 12, operators: 3 },
};

describe('the risk sentence catalogue', () => {
  it('holds every key in every locale', () => {
    for (const locale of RISK_LOCALES) expect(missingRiskKeys(locale), locale).toEqual([]);
  });

  it('has a sentence for every signal in the catalogue', () => {
    for (const r of RISK_CATALOGUE) {
      if (r.family === 'BAND') continue;
      const key = `risk.signal.${r.signalId}` as RiskMessageKey;
      for (const locale of RISK_LOCALES) expect(RISK_MESSAGES[locale][key], `${locale} ${key}`).toBeTruthy();
    }
    for (const band of ['clear', 'notice', 'review', 'hold'] as const) {
      for (const locale of RISK_LOCALES) expect(bandLabel(band, locale)).toBeTruthy();
    }
  });

  it('has actually been translated, not copied', () => {
    const keys = Object.keys(RISK_MESSAGES.en) as RiskMessageKey[];
    for (const locale of ['zh', 'vi'] as const) {
      const copied = keys.filter((k) => RISK_MESSAGES[locale][k] === RISK_MESSAGES.en[k]);
      expect(copied, locale).toEqual([]);
    }
    // Vietnamese carries its diacritics; a transliterated catalogue is not Vietnamese.
    const vi = Object.values(RISK_MESSAGES.vi).join(' ');
    expect(vi).toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i);
    const zh = Object.values(RISK_MESSAGES.zh).join(' ');
    expect(zh).toMatch(/[一-鿿]/);
  });

  it('uses the same placeholders in every language, so no number is lost in translation', () => {
    const keys = Object.keys(RISK_MESSAGES.en) as RiskMessageKey[];
    for (const key of keys) {
      const en = placeholdersOf(RISK_MESSAGES.en[key]);
      for (const locale of ['zh', 'vi'] as const) {
        expect(placeholdersOf(RISK_MESSAGES[locale][key]), `${locale} ${key}`).toEqual(en);
      }
    }
  });

  it('renders every signal with its evidence and leaves no gap', () => {
    for (const r of RISK_CATALOGUE) {
      if (r.family === 'BAND') continue;
      const evidence = SAMPLE[r.signalId];
      expect(evidence, `no sample evidence for ${r.signalId}`).toBeDefined();
      for (const locale of RISK_LOCALES) {
        const s = sentence({ signalId: r.signalId, evidence: evidence! }, locale);
        expect(s, `${locale} ${r.signalId}`).not.toMatch(/[{}]/);
        expect(s, `${locale} ${r.signalId}`).not.toContain('?');
      }
    }
  });

  it('says the number, in the brief’s own examples', () => {
    expect(sentence({ signalId: 'IDENT.NAME_MISMATCH', evidence: SAMPLE['IDENT.NAME_MISMATCH']! }, 'en')).toBe(
      'Name on ZaloPay is NGUYEN VAN B; the agreement says NGUYEN VAN A.',
    );
    const vol = sentence({ signalId: 'VOL.ABOVE_COHORT_P95', evidence: SAMPLE['VOL.ABOVE_COHORT_P95']! }, 'en');
    expect(vol).toContain('43 episodes on 2026-08-12');
    expect(vol).toContain('11 or fewer');
    const vi = sentence({ signalId: 'VOL.ABOVE_COHORT_P95', evidence: SAMPLE['VOL.ABOVE_COHORT_P95']! }, 'vi');
    expect(vi).toContain('43 phiên');
    const zh = sentence({ signalId: 'IDENT.NAME_MISMATCH', evidence: SAMPLE['IDENT.NAME_MISMATCH']! }, 'zh');
    expect(zh).toContain('NGUYEN VAN B');
    expect(zh).toContain('NGUYEN VAN A');
  });

  it('never states a conclusion about the person', () => {
    const all = RISK_LOCALES.flatMap((l) => Object.values(RISK_MESSAGES[l]));
    for (const s of all) {
      expect(s.toLowerCase()).not.toMatch(/fraud|cheat|fake|gian lận|lừa đảo|欺诈|作弊|造假/);
    }
  });

  it('formats fractions as percentages, lists as lists, and a missing value as a question mark', () => {
    expect(render('{share_pct} of {list}', { share: 0.753, list: ['a', 'b'] })).toBe('75% of a, b');
    expect(render('{gone}', {})).toBe('?');
    expect(render('{n}', { n: 1.23456 })).toBe('1.23');
    expect(render('{n}', { n: 12 })).toBe('12');
    expect(sentence({ signalId: 'NOT.A_SIGNAL', evidence: { x: 1 } }, 'en')).toContain('NOT.A_SIGNAL');
  });
});
