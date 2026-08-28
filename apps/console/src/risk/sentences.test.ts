import { describe, expect, it } from 'vitest';
import { LOCALES, MESSAGES, type MessageKey } from '@playerone/api/i18n';
import type { RiskFlag, RiskSummary } from '../lib/api.ts';
import { bandLabel, episodeReferences, flagSentence, hasTemplate, render, severityLabel } from './sentences.ts';

/**
 * Every flag renders as one sentence in every language, from a mocked §2.3
 * summary — the risk engine's routes are not merged, so this is the contract
 * the console holds against the brief rather than against a server.
 */

const flag = (signalId: string, evidence: Record<string, unknown>, over: Partial<RiskFlag> = {}): RiskFlag => ({
  signalId,
  severity: 'review',
  points: 20,
  evidence,
  thresholdVersion: 'v1',
  computedAt: '2026-08-26T09:00:00Z',
  ...over,
});

/** One flag per signal the brief names, with the evidence its detector writes. */
const MOCK: RiskSummary = {
  subjectType: 'bill',
  subjectId: 'b1',
  score: 100,
  band: 'hold',
  flags: [
    flag('IDENT.NAME_MISMATCH', { declared_name: 'NGUYEN VAN A', verified_name: 'NGUYEN VAN B', method: 'WALLET' }),
    flag('IDENT.PHONE_SHARED', { phone_masked: '09••••5678', count: 2, other_collector_refs: ['c-0002', 'c-0003'] }),
    flag('IDENT.ACCOUNT_SHARED', { bank_code: 'VCB', account_no_last4: '1234', count: 1, other_collector_refs: ['c-0002'] }),
    flag('IDENT.MUID_SHARED', { m_u_id_masked: 'mu••••77', count: 1, other_collector_refs: ['c-0004'] }),
    flag('IDENT.ACCOUNT_CHANGED_LATE', { changed_at: '2026-08-22', period_end: '2026-08-24', days_before_end: 1.5 }),
    flag('IDENT.UNVERIFIED_KYC', { verified_at: '2026-08-20', sub_return_code: -1103 }),
    flag('IDENT.KYC_LIMIT_REPEATED', { occurrences: 3, max_occurrences: 2, sub_return_code: -406 }),
    flag('IDENT.WALLET_LOCKED', { verified_at: '2026-08-20', sub_return_code: -1011 }),
    flag('VOL.HOURS_PER_DAY', { day: '2026-08-12', hours: 13.5, max_hours: 12, episodes: 43 }),
    flag('VOL.ABOVE_COHORT_P95', { day: '2026-08-12', episodes: 43, p95: 11, cohort_days: 240 }),
    flag('VOL.STEP_CHANGE', { day: '2026-08-12', minutes: 410, median_minutes: 120, ratio: 3.4 }),
    flag('VOL.NO_GAP', { episode_a: 'ego_AZER76400FE_20260813_072310', episode_b: 'ego_AZER76400FE_20260813_072415', overlap_s: 12.5 }),
    flag('VOL.NOCTURNAL', { night_minutes: 300, total_minutes: 400, share: 0.75, night_hours: '23:00–05:00', task_type: 'housework' }),
    flag('CONT.MOOV_DAMAGED', { file: 'left_part0001.mp4', verdict: 'moov at the back' }),
    flag('CONT.TIMING_TRUNCATED', { stream: 'camera_left', pts_rows: 2048, media_packets: 3000 }),
    flag('CONT.TIMING_PACKET_DELTA', { stream: 'camera_left', pts_rows: 3000, media_packets: 2048 }),
    flag('CONT.IMU_CLOCK_DRIFT', { clock_outlier_rows: 17, detail: 'warm-up 2 s' }),
    flag('CONT.PTS_MANIFEST_DELTA', { declared_s: 180, measured_s: 100, ratio: 1.8, baseline_ratio: 1.34, baseline_episodes: 12 }),
    flag('CONT.NEAR_DUPLICATE', { other_episode_id: 'ego_AZER76400FF_20260813_073055', other_collector_ref: 'c-0002', method: 'ahash', match_share: 0.97 }),
    flag('CONT.STATIC_SCENE', { frames: 60, motion_energy: 0.01, max_motion_energy: 0.05 }),
    flag('CONT.LOW_LUMA_VARIANCE', { dark_share: 0.9, flat_share: 0.8, mean_luma: 12 }),
    flag('CONT.AUDIO_ABSENT', { reason: 'no audio track', task_type: 'conversation' }),
    flag('CONT.FINGERPRINT', { frames: 60 }, { severity: 'info', points: 0 }),
    flag('PROV.PRNU_MISMATCH', { correlation: 0.02, device_serial: 'AZER76400FE', min_correlation: 0.2 }),
    flag('PROV.IMU_VIDEO_DECORR', { seconds: 100, correlation: 0.05, min_correlation: 0.3 }),
    flag('PROV.ENCODER_MISMATCH', { firmware: '1.0.3', mismatches: ['gop', 'atom order'] }),
    flag('PROV.SCREEN_RECAPTURE', { cues: ['moiré', 'banding'], frames: 60 }),
    flag('PROV.SYNTHETIC_HEURISTIC', { noise_floor: 0.001, max_noise_floor: 0.01 }, { severity: 'notice', points: 5 }),
    flag('OPS.REVIEW_TOO_FAST', { reviewer_ref: 'rv-1', verdict: 'good', time_to_verdict_s: 8, measured_duration_s: 100 }),
    flag('OPS.APPROVAL_OUTLIER', { reviewer_ref: 'rv-1', approval_rate: 0.99, decided: 200, reviewers: 5, cohort_median: 0.8 }),
    flag('OPS.SELF_DEALING', { operator_ref: 'op-1', created_at: '2026-08-01', paid_action: 'bill.mark_paid', paid_at: '2026-08-25' }),
    flag('OPS.CONCENTRATION', { operator_ref: 'op-1', share: 0.9, events: 20, operators: 3 }),
  ],
};

describe('flag sentences', () => {
  it('has wording for every signal the brief names', () => {
    for (const f of MOCK.flags) expect(hasTemplate(f.signalId), f.signalId).toBe(true);
    // And for what the payout domain emits before the engine scores it.
    for (const id of ['IDENT.NAME_UNCONFIRMED', 'IDENT.KYC_LIMIT', 'IDENT.NO_WALLET', 'IDENT.VERIFY_ERROR']) expect(hasTemplate(id), id).toBe(true);
  });

  it('renders every flag in every locale as a sentence with no hole in it', () => {
    for (const locale of LOCALES) {
      for (const f of MOCK.flags) {
        const s = flagSentence(f, locale);
        expect(s, `${locale} ${f.signalId}`).not.toMatch(/[{}]/);
        expect(s, `${locale} ${f.signalId}`).not.toContain('?');
        expect(s.length, `${locale} ${f.signalId}`).toBeGreaterThan(10);
      }
    }
  });

  it('puts the number that caused the flag in the sentence', () => {
    const byId = (id: string) => MOCK.flags.find((f) => f.signalId === id)!;
    for (const locale of LOCALES) {
      expect(flagSentence(byId('IDENT.NAME_MISMATCH'), locale)).toContain('NGUYEN VAN B');
      expect(flagSentence(byId('IDENT.NAME_MISMATCH'), locale)).toContain('NGUYEN VAN A');
      expect(flagSentence(byId('VOL.ABOVE_COHORT_P95'), locale)).toContain('43');
      expect(flagSentence(byId('VOL.ABOVE_COHORT_P95'), locale)).toContain('11');
      expect(flagSentence(byId('VOL.NOCTURNAL'), locale)).toContain('75%');
      expect(flagSentence(byId('CONT.NEAR_DUPLICATE'), locale)).toContain('97%');
      expect(flagSentence(byId('IDENT.PHONE_SHARED'), locale)).toContain('c-0002, c-0003');
    }
  });

  it('uses the same placeholders in every locale, so no language can lose a number', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    const keys = (Object.keys(MESSAGES.en) as MessageKey[]).filter((k) => k.startsWith('risk.signal.'));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      const en = placeholders(MESSAGES.en[key]);
      for (const locale of LOCALES) expect(placeholders(MESSAGES[locale][key]), `${locale} ${key}`).toEqual(en);
    }
  });

  it('prefers a sentence the engine already rendered, when one is served', () => {
    const f = flag('IDENT.NAME_MISMATCH', { declared_name: 'A', verified_name: 'B' }, { sentence: { vi: 'Câu của máy chủ.' } });
    expect(flagSentence(f, 'vi')).toBe('Câu của máy chủ.');
    expect(flagSentence(f, 'en')).toBe('Name on ZaloPay is B; the agreement says A.');
  });

  it('renders an unknown signal as its id and evidence rather than nothing', () => {
    const f = flag('NEW.SIGNAL', { things: 3, where: 'here' });
    for (const locale of LOCALES) {
      const s = flagSentence(f, locale);
      expect(s).toContain('NEW.SIGNAL');
      expect(s).toContain('things: 3');
    }
    expect(flagSentence(flag('NEW.EMPTY', {}), 'en')).toBe('NEW.EMPTY');
  });

  it('fills templates the way the engine does', () => {
    expect(render('{a} and {b_pct} and {c}', { a: 1.5, b: 0.256, c: ['x', 'y'] })).toBe('1.50 and 26% and x, y');
    expect(render('{missing}', {})).toBe('?');
    expect(render('{b_pct}', { b_pct: '30%' })).toBe('30%');
    expect(render('{flag}', { flag: true })).toBe('yes');
  });

  it('labels bands and severities in every locale', () => {
    for (const locale of LOCALES) {
      for (const band of ['clear', 'notice', 'review', 'hold'] as const) expect(bandLabel(band, locale)).not.toBe('');
      for (const sev of ['info', 'notice', 'review', 'hold'] as const) expect(severityLabel(sev, locale)).not.toBe('');
    }
    expect(bandLabel('hold', 'vi')).toBe('Tạm giữ thanh toán');
    expect(bandLabel('hold', 'xx')).toBe('On hold');
  });

  it('lists the recordings a flag names, for the reference beside the sentence', () => {
    expect(episodeReferences({ episode_a: 'e1', episode_b: 'e2', other: 'no' })).toEqual(['e1', 'e2']);
    expect(episodeReferences({ other_episode_id: 'e3', episode_ids: ['e3', 'e4'] })).toEqual(['e3', 'e4']);
    expect(episodeReferences({ count: 3 })).toEqual([]);
  });
});
