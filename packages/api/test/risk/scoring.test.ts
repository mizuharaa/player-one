import { describe, expect, it } from 'vitest';
import { RISK_CATALOGUE, SIGNAL_IDS, SYNTHETIC_SIGNAL, EVALUATED_SIGNAL, bandsFrom } from '../../src/risk/catalogue.ts';
import { bandFor, bandOf, isFinding, rollup, scoreOf, severityOf, summarise } from '../../src/risk/scoring.ts';
import { bands, flagOf, tuningFromCatalogue } from './helpers.ts';

/**
 * Scoring is pure and these tests need no database: the same flags under
 * the same bands must always summarise the same way, which is the
 * determinism the brief asks for and the property an operator relies on
 * when they add the points up by hand.
 */

describe('the catalogue', () => {
  it('has unique, well-formed signal ids', () => {
    expect(new Set(SIGNAL_IDS).size).toBe(SIGNAL_IDS.length);
    for (const id of SIGNAL_IDS) expect(id).toMatch(/^[A-Z]+\.[A-Z0-9_]+$/);
  });

  it('names every signal the brief lists', () => {
    const wanted = [
      'IDENT.NAME_MISMATCH', 'IDENT.PHONE_SHARED', 'IDENT.ACCOUNT_SHARED', 'IDENT.MUID_SHARED', 'IDENT.ACCOUNT_CHANGED_LATE',
      'IDENT.UNVERIFIED_KYC', 'IDENT.KYC_LIMIT_REPEATED', 'IDENT.WALLET_LOCKED',
      'VOL.HOURS_PER_DAY', 'VOL.ABOVE_COHORT_P95', 'VOL.STEP_CHANGE', 'VOL.NO_GAP', 'VOL.NOCTURNAL',
      'CONT.MOOV_DAMAGED', 'CONT.TIMING_TRUNCATED', 'CONT.TIMING_PACKET_DELTA', 'CONT.IMU_CLOCK_DRIFT', 'CONT.PTS_MANIFEST_DELTA',
      'CONT.NEAR_DUPLICATE', 'CONT.STATIC_SCENE', 'CONT.LOW_LUMA_VARIANCE', 'CONT.AUDIO_ABSENT',
      'PROV.PRNU_MISMATCH', 'PROV.IMU_VIDEO_DECORR', 'PROV.ENCODER_MISMATCH', 'PROV.SCREEN_RECAPTURE', 'PROV.SYNTHETIC_HEURISTIC',
      'OPS.REVIEW_TOO_FAST', 'OPS.APPROVAL_OUTLIER', 'OPS.SELF_DEALING', 'OPS.CONCENTRATION',
    ];
    for (const id of wanted) expect(SIGNAL_IDS, id).toContain(id);
  });

  it('gives every signal a severity that agrees with its points under the bands', () => {
    // A 35-point flag labelled 'notice' would show one word and score another.
    const b = bands();
    for (const r of RISK_CATALOGUE) {
      if (r.family === 'BAND' || r.family === 'META') continue;
      expect(severityOf(r.points, b), `${r.signalId} has ${r.points} points`).toBe(r.severity);
    }
  });

  it('keeps the synthetic heuristic below the review band', () => {
    const synth = RISK_CATALOGUE.find((r) => r.signalId === SYNTHETIC_SIGNAL)!;
    expect(synth.points).toBeLessThan(bands().review);
    expect(['info', 'notice']).toContain(synth.severity);
  });

  it('reads the bands from the BAND rows and refuses a disordered set', () => {
    expect(bands()).toEqual({ notice: 15, review: 35, hold: 60 });
    expect(() => bandsFrom(tuningFromCatalogue({ 'BAND.REVIEW': { points: 10 } }))).toThrow(/not ordered/);
    const missing = tuningFromCatalogue();
    (missing as Map<string, unknown>).delete('BAND.HOLD');
    expect(() => bandsFrom(missing)).toThrow(/BAND.HOLD/);
  });
});

describe('scoring', () => {
  const b = bands();

  it('places the edges exactly where the brief puts them', () => {
    expect(bandOf(0, b)).toBe('clear');
    expect(bandOf(14, b)).toBe('clear');
    expect(bandOf(15, b)).toBe('notice');
    expect(bandOf(34, b)).toBe('notice');
    expect(bandOf(35, b)).toBe('review');
    expect(bandOf(59, b)).toBe('review');
    expect(bandOf(60, b)).toBe('hold');
    expect(bandOf(100, b)).toBe('hold');
  });

  it('is a visible sum of named components, capped at 100', () => {
    const flags = [flagOf('IDENT.PHONE_SHARED'), flagOf('IDENT.ACCOUNT_SHARED'), flagOf('VOL.HOURS_PER_DAY')];
    expect(flags.reduce((a, f) => a + f.points, 0)).toBe(155);
    expect(scoreOf(flags)).toBe(100);
    expect(scoreOf([flagOf('IDENT.NAME_MISMATCH'), flagOf('VOL.STEP_CHANGE')])).toBe(55);
  });

  it('does not count the evaluation marker or a zero-point record as a finding', () => {
    expect(isFinding(flagOf(EVALUATED_SIGNAL))).toBe(false);
    expect(isFinding(flagOf('CONT.FINGERPRINT'))).toBe(false);
    expect(isFinding(flagOf('CONT.MOOV_DAMAGED'))).toBe(true);
    expect(scoreOf([flagOf(EVALUATED_SIGNAL), flagOf('CONT.FINGERPRINT')])).toBe(0);
    expect(summarise('episode', 'e', [flagOf(EVALUATED_SIGNAL), flagOf('CONT.FINGERPRINT')], b).flags).toEqual([]);
  });

  it('never lets the synthetic heuristic be the sole cause of a hold', () => {
    // 35 + 20 = 55 is review; +15 synthetic = 70 would be hold. It is not.
    const withSynth = [flagOf('IDENT.NAME_MISMATCH'), flagOf('IDENT.ACCOUNT_CHANGED_LATE'), flagOf(SYNTHETIC_SIGNAL)];
    expect(scoreOf(withSynth)).toBe(70);
    expect(bandFor(withSynth, b)).toBe('review');
    // The same flags with real evidence reaching hold on their own still hold.
    const real = [...withSynth, flagOf('VOL.HOURS_PER_DAY')];
    expect(bandFor(real, b)).toBe('hold');
    // Even a synthetic flag somebody managed to weight at 100 cannot hold alone.
    const heavy = { ...flagOf(SYNTHETIC_SIGNAL), points: 100 };
    expect(bandFor([heavy], b)).toBe('review');
    expect(summarise('episode', 'e', [heavy], b).band).toBe('review');
  });

  it('summarises the same flags the same way, twice', () => {
    const flags = [flagOf('VOL.NO_GAP', { a: 1 }), flagOf('CONT.STATIC_SCENE', { m: 0.5 }), flagOf('IDENT.WALLET_LOCKED')];
    const once = summarise('collector', 'c', flags, b);
    const twice = summarise('collector', 'c', [...flags].reverse(), b);
    expect(twice).toEqual(once);
    expect(once.score).toBe(90);
    expect(once.band).toBe('hold');
    expect(once.flags.map((f) => f.signalId)).toEqual(['CONT.STATIC_SCENE', 'VOL.NO_GAP', 'IDENT.WALLET_LOCKED']);
  });

  it('rolls a bill up counting each signal once, at its heaviest instance', () => {
    // Forty episodes each carrying the same 10-point device fault are one fact
    // about the device, not four hundred points against the collector.
    const episodes = Array.from({ length: 40 }, (_, i) => ({
      subjectType: 'episode' as const,
      subjectId: `e${i}`,
      flags: [flagOf('CONT.MOOV_DAMAGED', { file: `f${i}` })],
    }));
    const rolled = rollup([
      { subjectType: 'bill', subjectId: 'b', flags: [] },
      { subjectType: 'collector', subjectId: 'c', flags: [flagOf('IDENT.NAME_MISMATCH')] },
      ...episodes,
    ]);
    expect(rolled.map((f) => f.signalId)).toEqual(['IDENT.NAME_MISMATCH', 'CONT.MOOV_DAMAGED']);
    expect(scoreOf(rolled)).toBe(45);
    const fault = rolled.find((f) => f.signalId === 'CONT.MOOV_DAMAGED')!;
    expect(fault.evidence['also_on']).toBe(39);
    expect((fault.evidence['carriers'] as unknown[]).length).toBe(40);
    expect(bandFor(rolled, b)).toBe('review');
  });
});
