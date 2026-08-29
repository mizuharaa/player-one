import { describe, expect, it } from 'vitest';
import { deliverySignals, type DeliveryFacts, type MismatchFacts } from '../../src/risk/detectors/delivery.ts';
import { historySignals, type HistoryInput } from '../../src/risk/detectors/history.ts';
import { identChangedLate, identSignals, namesMatch, type PayoutAccount } from '../../src/risk/detectors/ident.ts';
import { approvalOutliers, concentration, reviewTooFast, selfDealing } from '../../src/risk/detectors/ops.ts';
import { dayKey, percentile, volumeSignals, type EpisodeSlice } from '../../src/risk/detectors/volume.ts';
import { riskConfigFromEnv } from '../../src/risk/config.ts';
import { bands, signalIds, tuningFromCatalogue } from './helpers.ts';

/**
 * The detectors that need no media, tested as the pure functions they are.
 * Each planted case must fire its own signal and no other — the brief's
 * verify rule — so every test asserts the whole list, not membership.
 */

const T = tuningFromCatalogue();
const D = (s: string): Date => new Date(s);

const account = (over: Partial<PayoutAccount> = {}): PayoutAccount => ({
  id: 'acc-1',
  collectorId: 'c1',
  method: 'WALLET',
  phone: '0901234512',
  bankCode: null,
  accountNoLast4: null,
  declaredName: 'Nguyễn Văn A',
  verifiedName: 'NGUYEN VAN A',
  mUId: 'muid-1',
  verifyStatus: 'verified',
  verifiedAt: D('2026-08-01T00:00:00Z'),
  isCurrent: true,
  createdAt: D('2026-08-01T00:00:00Z'),
  ...over,
});

const noPeers = { phone: [], bank: [], muid: [] };

describe('Vietnamese name comparison', () => {
  it('compares token sets after folding diacritics, case and order', () => {
    expect(namesMatch('Nguyễn Văn A', 'NGUYEN VAN A')).toBe(true);
    expect(namesMatch('Văn A Nguyễn', 'Nguyen Van A')).toBe(true);
    expect(namesMatch('Đặng  Thị   Bích', 'dang thi bich')).toBe(true);
    expect(namesMatch('Nguyễn Văn A', 'Nguyễn Văn B')).toBe(false);
    expect(namesMatch('Nguyễn Văn A', 'Nguyễn A')).toBe(false);
    expect(namesMatch('', '')).toBe(false);
  });
});

describe('identity signals', () => {
  it('fires nothing on a verified account with no peers', () => {
    expect(identSignals({ collectorId: 'c1', accounts: [account()], peers: noPeers, kycLimitOccurrences: 0 }, T)).toEqual([]);
  });

  it('fires only PHONE_SHARED when the wallet phone is on another collector', () => {
    const f = identSignals(
      { collectorId: 'c1', accounts: [account()], peers: { ...noPeers, phone: [{ collectorId: 'c2', collectorRef: 'c-0002' }] }, kycLimitOccurrences: 0 },
      T,
    );
    expect(signalIds(f)).toEqual(['IDENT.PHONE_SHARED']);
    expect(f[0]!.evidence).toMatchObject({ phone_masked: '090•••••12', count: 1, other_collector_refs: ['c-0002'] });
  });

  it('fires only ACCOUNT_SHARED for a shared bank account, and only MUID_SHARED for a shared wallet id', () => {
    const bank = account({ method: 'BANK_ACCOUNT', phone: null, mUId: null, bankCode: 'VCB', accountNoLast4: '1234' });
    const a = identSignals({ collectorId: 'c1', accounts: [bank], peers: { ...noPeers, bank: [{ collectorId: 'c2', collectorRef: 'c-0002' }] }, kycLimitOccurrences: 0 }, T);
    expect(signalIds(a)).toEqual(['IDENT.ACCOUNT_SHARED']);
    const m = identSignals({ collectorId: 'c1', accounts: [account()], peers: { ...noPeers, muid: [{ collectorId: 'c2', collectorRef: 'c-0002' }, { collectorId: 'c3', collectorRef: 'c-0003' }] }, kycLimitOccurrences: 0 }, T);
    expect(signalIds(m)).toEqual(['IDENT.MUID_SHARED']);
    expect(m[0]!.evidence['count']).toBe(2);
  });

  it('fires only NAME_MISMATCH on the status B writes, and on a stale status when the names disagree', () => {
    const byStatus = identSignals({ collectorId: 'c1', accounts: [account({ verifyStatus: 'name_mismatch', verifiedName: 'NGUYEN VAN B' })], peers: noPeers, kycLimitOccurrences: 0 }, T);
    expect(signalIds(byStatus)).toEqual(['IDENT.NAME_MISMATCH']);
    expect(byStatus[0]!.evidence).toMatchObject({ declared_name: 'Nguyễn Văn A', verified_name: 'NGUYEN VAN B' });
    const stale = identSignals({ collectorId: 'c1', accounts: [account({ verifyStatus: 'verified', verifiedName: 'NGUYEN VAN B' })], peers: noPeers, kycLimitOccurrences: 0 }, T);
    expect(signalIds(stale)).toEqual(['IDENT.NAME_MISMATCH']);
  });

  it('reads -1103 only after a verification attempt, and -1011 from the locked status', () => {
    const never = identSignals({ collectorId: 'c1', accounts: [account({ verifyStatus: 'unverified', verifiedName: null, verifiedAt: null })], peers: noPeers, kycLimitOccurrences: 0 }, T);
    expect(never).toEqual([]);
    const kyc = identSignals({ collectorId: 'c1', accounts: [account({ verifyStatus: 'unverified', verifiedName: null })], peers: noPeers, kycLimitOccurrences: 0 }, T);
    expect(signalIds(kyc)).toEqual(['IDENT.UNVERIFIED_KYC']);
    const locked = identSignals({ collectorId: 'c1', accounts: [account({ verifyStatus: 'locked', verifiedName: null })], peers: noPeers, kycLimitOccurrences: 0 }, T);
    expect(signalIds(locked)).toEqual(['IDENT.WALLET_LOCKED']);
  });

  it('counts -406 and fires only past the second occurrence', () => {
    expect(identSignals({ collectorId: 'c1', accounts: [account()], peers: noPeers, kycLimitOccurrences: 2 }, T)).toEqual([]);
    const f = identSignals({ collectorId: 'c1', accounts: [account()], peers: noPeers, kycLimitOccurrences: 3 }, T);
    expect(signalIds(f)).toEqual(['IDENT.KYC_LIMIT_REPEATED']);
    expect(f[0]!.evidence).toMatchObject({ occurrences: 3, max_occurrences: 2 });
  });

  it('flags an account changed inside the last week of the period, but not the first declaration', () => {
    const periodEnd = D('2026-08-21T00:00:00Z');
    const now = D('2026-08-25T00:00:00Z');
    // A first declaration inside the window is not a change.
    const declaredLate = account({ id: 'a1', createdAt: D('2026-08-19T00:00:00Z') });
    expect(identChangedLate({ accounts: [declaredLate], periodEnd, now }, T)).toEqual([]);
    const first = account({ id: 'a1', createdAt: D('2026-08-01T00:00:00Z'), isCurrent: false });
    const late = account({ id: 'a2', createdAt: D('2026-08-19T12:00:00Z') });
    const f = identChangedLate({ accounts: [first, late], periodEnd, now }, T);
    expect(signalIds(f)).toEqual(['IDENT.ACCOUNT_CHANGED_LATE']);
    expect(f[0]!.evidence['days_before_end']).toBe(1.5);
    // A change well before the window is not late.
    const early = account({ id: 'a2', createdAt: D('2026-08-05T00:00:00Z') });
    expect(identChangedLate({ accounts: [first, early], periodEnd, now }, T)).toEqual([]);
  });

  it('honours a disabled signal', () => {
    const off = tuningFromCatalogue({ 'IDENT.PHONE_SHARED': { enabled: false } });
    expect(identSignals({ collectorId: 'c1', accounts: [account()], peers: { ...noPeers, phone: [{ collectorId: 'c2', collectorRef: 'c-0002' }] }, kycLimitOccurrences: 0 }, off)).toEqual([]);
  });
});

describe('volume signals', () => {
  const HCM = 420;
  const at = (iso: string, seconds: number, over: Partial<EpisodeSlice> = {}): EpisodeSlice => ({
    episodeId: `ep-${iso}`,
    startMs: Date.parse(iso),
    endMs: Date.parse(iso) + seconds * 1000,
    measuredS: seconds,
    deviceSerial: 'AZER76400FE',
    taskType: 'kitchen',
    ...over,
  });
  /** A plausible week: two hours a day, mornings, one device, no overlaps. */
  const cleanWeek = (): EpisodeSlice[] => {
    const out: EpisodeSlice[] = [];
    for (let d = 10; d < 17; d++) {
      out.push(at(`2026-08-${d}T02:00:00Z`, 3600, { episodeId: `d${d}a` }));
      out.push(at(`2026-08-${d}T04:00:00Z`, 3600, { episodeId: `d${d}b` }));
    }
    return out;
  };
  const cohort = Array.from({ length: 60 }, (_, i) => 1 + (i % 4)); // 1..4 a day, p95 = 4

  it('keys days to Asia/Ho_Chi_Minh', () => {
    // 20:00 UTC on the 12th is 03:00 on the 13th in Ho Chi Minh City.
    expect(dayKey(Date.parse('2026-08-12T20:00:00Z'), HCM)).toBe('2026-08-13');
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile(cohort, 95)).toBe(4);
  });

  it('fires nothing on a plausible week', () => {
    expect(volumeSignals({ collectorId: 'c', episodes: cleanWeek(), cohortDayCounts: cohort }, T)).toEqual([]);
  });

  it('fires only HOURS_PER_DAY past twelve measured hours in one local day', () => {
    const eps = cleanWeek();
    // Three more 4-hour episodes on the 12th (local), non-overlapping: 2 + 12 = 14 h.
    eps.push(at('2026-08-12T06:00:00Z', 4 * 3600, { episodeId: 'x1' }), at('2026-08-12T10:30:00Z', 4 * 3600, { episodeId: 'x2' }), at('2026-08-12T15:00:00Z', 4 * 3600, { episodeId: 'x3' }));
    const big = Array.from({ length: 60 }, (_, i) => 5 + (i % 3)); // so five episodes is not a cohort outlier
    const f = volumeSignals({ collectorId: 'c', episodes: eps, cohortDayCounts: big }, tuningFromCatalogue({ 'VOL.STEP_CHANGE': { enabled: false } }));
    expect(signalIds(f)).toEqual(['VOL.HOURS_PER_DAY']);
    expect(f[0]!.evidence).toMatchObject({ day: '2026-08-12', hours: 14, max_hours: 12, episodes: 5 });
  });

  it('fires only ABOVE_COHORT_P95 when a day beats the 95th percentile of collector-days', () => {
    const eps = cleanWeek();
    for (let i = 0; i < 6; i++) eps.push(at(`2026-08-12T${String(6 + i).padStart(2, '0')}:00:00Z`, 300, { episodeId: `s${i}` }));
    const f = volumeSignals({ collectorId: 'c', episodes: eps, cohortDayCounts: cohort }, T);
    expect(signalIds(f)).toEqual(['VOL.ABOVE_COHORT_P95']);
    expect(f[0]!.evidence).toMatchObject({ day: '2026-08-12', episodes: 8, p95: 4, cohort_days: 60 });
  });

  it('needs a cohort before it judges against one', () => {
    const eps = cleanWeek();
    for (let i = 0; i < 6; i++) eps.push(at(`2026-08-12T${String(6 + i).padStart(2, '0')}:00:00Z`, 300, { episodeId: `s${i}` }));
    expect(volumeSignals({ collectorId: 'c', episodes: eps, cohortDayCounts: [1, 2, 3] }, T)).toEqual([]);
  });

  it('fires only STEP_CHANGE when a day is 2.5× the collector’s own trailing median', () => {
    const eps = cleanWeek(); // 120 minutes a day for a week
    eps.push(at('2026-08-17T02:00:00Z', 5 * 3600, { episodeId: 'big1' }), at('2026-08-17T08:00:00Z', 2 * 3600, { episodeId: 'big2' })); // 420 minutes
    const f = volumeSignals({ collectorId: 'c', episodes: eps, cohortDayCounts: cohort }, T);
    expect(signalIds(f)).toEqual(['VOL.STEP_CHANGE']);
    expect(f[0]!.evidence).toMatchObject({ day: '2026-08-17', minutes: 420, median_minutes: 120, ratio: 3.5, history_days: 7 });
  });

  it('fires only NO_GAP when two episodes overlap', () => {
    const eps = cleanWeek();
    eps.push(at('2026-08-12T02:30:00Z', 1800, { episodeId: 'over' })); // inside d12a
    const f = volumeSignals({ collectorId: 'c', episodes: eps, cohortDayCounts: cohort }, T);
    expect(signalIds(f)).toEqual(['VOL.NO_GAP']);
    expect(f[0]!.evidence).toMatchObject({ episode_a: 'd12a', episode_b: 'over', overlap_s: 1800, gap_s: -1800 });
  });

  it('notes sustained night recording for a day task, and not for a night task type', () => {
    // 23:30–02:30 local = 16:30–19:30 UTC, five nights.
    const nights = Array.from({ length: 5 }, (_, i) => at(`2026-08-${10 + i}T16:30:00Z`, 3 * 3600, { episodeId: `n${i}` }));
    const f = volumeSignals({ collectorId: 'c', episodes: nights, cohortDayCounts: cohort }, T);
    expect(signalIds(f)).toEqual(['VOL.NOCTURNAL']);
    expect(f[0]!.evidence).toMatchObject({ night_minutes: 900, total_minutes: 900, share: 1, task_type: 'kitchen' });
    const nightJob = tuningFromCatalogue({ 'VOL.NOCTURNAL': { params: { night_task_types: ['kitchen'], utc_offset_minutes: 420 } } });
    expect(volumeSignals({ collectorId: 'c', episodes: nights, cohortDayCounts: cohort }, nightJob)).toEqual([]);
  });
});

describe('reviewer and operator signals', () => {
  it('flags a pass recorded faster than the footage runs, and never a fail', () => {
    const base = { episodeId: 'e', reviewerId: 'r1', reviewerRef: 'pax-01', measuredS: 133 };
    expect(signalIds(reviewTooFast({ ...base, state: 'pass', timeToVerdictS: 12 }, T))).toEqual(['OPS.REVIEW_TOO_FAST']);
    expect(reviewTooFast({ ...base, state: 'pass', timeToVerdictS: 140 }, T)).toEqual([]);
    expect(reviewTooFast({ ...base, state: 'fail', timeToVerdictS: 2 }, T)).toEqual([]);
    expect(reviewTooFast({ ...base, state: 'partial_pass', timeToVerdictS: null }, T)).toEqual([]);
  });

  it('flags one reviewer whose approval rate is far from the others, once the cohort is big enough', () => {
    const r = (id: string, decided: number, approved: number) => ({ reviewerId: id, reviewerRef: id, decided, approved });
    const cohort = [r('a', 40, 28), r('b', 40, 30), r('c', 40, 26), r('d', 40, 40)];
    const f = approvalOutliers(cohort, T);
    expect(signalIds(f)).toEqual(['OPS.APPROVAL_OUTLIER']);
    expect(f[0]!.evidence).toMatchObject({ reviewer_ref: 'd', approval_rate: 1, cohort_median: 0.7, decided: 40, reviewers: 3 });
    expect(approvalOutliers(cohort.slice(0, 2), T)).toEqual([]);
    expect(approvalOutliers([...cohort.slice(0, 3), r('d', 5, 5)], T)).toEqual([]);
  });

  it('flags the operator who created the collector paying its bill', () => {
    const creates = [{ operatorId: 'o1', operatorRef: 'op-hcm', action: 'collector.create', at: D('2026-08-01T00:00:00Z'), targetId: 'c1' }];
    const paid = [{ operatorId: 'o1', operatorRef: 'op-hcm', action: 'bill.pay', at: D('2026-08-21T00:00:00Z'), targetId: 'b1' }];
    const other = [{ operatorId: 'o2', operatorRef: 'op-han', action: 'bill.pay', at: D('2026-08-21T00:00:00Z'), targetId: 'b1' }];
    const f = selfDealing({ collectorCreates: creates, billActions: paid }, T);
    expect(signalIds(f)).toEqual(['OPS.SELF_DEALING']);
    expect(f[0]!.evidence).toMatchObject({ operator_ref: 'op-hcm', paid_action: 'bill.pay' });
    expect(selfDealing({ collectorCreates: creates, billActions: other }, T)).toEqual([]);
  });

  it('flags one operator handling most of a collector’s bills only when others are active', () => {
    const ev = (op: string, n: number) => Array.from({ length: n }, (_, i) => ({ operatorId: op, operatorRef: op, action: 'bill.pay', at: D('2026-08-21T00:00:00Z'), targetId: `b${i}` }));
    const events = [...ev('o1', 9), ...ev('o2', 1)];
    const f = concentration({ events, activeOperators: 3 }, T);
    expect(signalIds(f)).toEqual(['OPS.CONCENTRATION']);
    expect(f[0]!.evidence).toMatchObject({ operator_ref: 'o1', share: 0.9, events: 10, operators: 3 });
    // One finance operator at pilot is 100% of everything and is not a finding.
    expect(concentration({ events, activeOperators: 1 }, T)).toEqual([]);
    expect(concentration({ events: ev('o1', 3), activeOperators: 3 }, T)).toEqual([]);
  });
});

describe('the environment flags', () => {
  it('defaults the engine on and holds off, and refuses a value that is neither 1 nor 0', () => {
    expect(riskConfigFromEnv({})).toEqual({ engineEnabled: true, holdsEnabled: false, mediaRoot: undefined });
    expect(riskConfigFromEnv({ PLAYERONE_RISK_ENGINE: '0', PLAYERONE_RISK_HOLD: '1', PLAYERONE_MEDIA_ROOT: '/m' })).toEqual({ engineEnabled: false, holdsEnabled: true, mediaRoot: '/m' });
    expect(() => riskConfigFromEnv({ PLAYERONE_RISK_HOLD: 'yes' })).toThrow(/PLAYERONE_RISK_HOLD/);
  });
});

/**
 * The delivery detectors. Every case here is built from rows the store writes
 * on its own: one `episode_ingests` row per delivery whose bytes differed, and
 * the CHECKSUM-MISMATCH payload naming what changed. Nothing needs media.
 */
describe('the delivery detectors', () => {
  const facts = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({
    episodeId: 'e1',
    deliveries: 1,
    mismatchDeliveries: 0,
    firstDeliveredAt: D('2026-08-20T00:00:00Z'),
    lastDeliveredAt: D('2026-08-20T00:00:00Z'),
    latest: null,
    recordedAtMs: D('2026-08-19T00:00:00Z').getTime(),
    ...over,
  });
  const mismatch = (over: Partial<MismatchFacts> = {}): MismatchFacts => ({
    priorIngestId: 'i0',
    changed: [],
    added: [],
    removed: [],
    measuredS: 100,
    priorMeasuredS: 100,
    ...over,
  });
  const NOW = D('2026-08-21T00:00:00Z');

  it('says nothing about one clean delivery', () => {
    expect(deliverySignals(facts(), NOW, T)).toEqual([]);
  });

  it('flags an episode delivered past the threshold with changing bytes, and not one delivered twice', () => {
    const churn = facts({
      deliveries: 4,
      mismatchDeliveries: 3,
      lastDeliveredAt: D('2026-08-20T06:00:00Z'),
      latest: mismatch({ added: ['tail.pts'] }),
    });
    const f = deliverySignals(churn, NOW, T);
    expect(signalIds(f)).toEqual(['CONT.REDELIVERY_CHURN']);
    expect(f[0]!.evidence).toMatchObject({ deliveries: 4, mismatch_deliveries: 3, max_deliveries: 2, hours_between: 6 });
    // Two deliveries is the threshold, not past it.
    expect(deliverySignals({ ...churn, deliveries: 2, mismatchDeliveries: 1 }, NOW, T)).toEqual([]);
    // Deliveries whose bytes never differed are not churn; nothing changed.
    expect(deliverySignals({ ...churn, mismatchDeliveries: 0, latest: null }, NOW, T)).toEqual([]);
  });

  it('separates a lost transfer from a substitution', () => {
    // An interrupted upload: the tail file never arrived and the episode
    // measures SHORTER than the delivery it replaced. Nothing was exchanged.
    const lost = facts({
      deliveries: 2,
      mismatchDeliveries: 1,
      latest: mismatch({ removed: ['left_part0002.mp4'], measuredS: 60, priorMeasuredS: 100 }),
    });
    expect(deliverySignals(lost, NOW, T)).toEqual([]);

    // A substitution: a file that had already arrived whole comes back with
    // different bytes.
    const swapped = facts({
      deliveries: 2,
      mismatchDeliveries: 1,
      latest: mismatch({ changed: ['left_part0001.mp4', 'session.pts'] }),
    });
    const f = deliverySignals(swapped, NOW, T);
    expect(signalIds(f)).toEqual(['CONT.MEDIA_SUBSTITUTED']);
    expect(f[0]!.evidence).toMatchObject({ changed_media: ['left_part0001.mp4'], changed_media_count: 1, grew_by_s: 0 });

    // A timestamp sidecar rewritten on its own is not media and not this signal.
    expect(deliverySignals(facts({ deliveries: 2, mismatchDeliveries: 1, latest: mismatch({ changed: ['session.pts'] }) }), NOW, T)).toEqual([]);

    // Growth is the other half: a redelivery cannot hold MORE footage than the
    // recording that arrived first.
    const grew = deliverySignals(facts({ deliveries: 2, mismatchDeliveries: 1, latest: mismatch({ measuredS: 140, priorMeasuredS: 100 }) }), NOW, T);
    expect(signalIds(grew)).toEqual(['CONT.MEDIA_SUBSTITUTED']);
    expect(grew[0]!.evidence).toMatchObject({ grew_by_s: 40, changed_media_count: 0 });
  });

  it('flags footage delivered long after it was recorded, and reads the device clock to do it', () => {
    const f = deliverySignals(facts({ recordedAtMs: D('2026-06-01T00:00:00Z').getTime() }), NOW, T);
    expect(signalIds(f)).toEqual(['PROV.STALE_RECORDING']);
    expect(f[0]!.evidence).toMatchObject({ age_days: 80, max_age_days: 30 });
    // Inside the window, and with no clock at all, nothing is claimed.
    expect(deliverySignals(facts({ recordedAtMs: D('2026-08-01T00:00:00Z').getTime() }), NOW, T)).toEqual([]);
    expect(deliverySignals(facts({ recordedAtMs: null }), NOW, T)).toEqual([]);
  });
});

/**
 * The history detectors. Their whole input is this engine's own output, which
 * is what makes a history score openable: every episode counted has a flag row
 * carrying the evidence that raised it.
 */
describe('the history detectors', () => {
  const finding = (episodeId: string, signalId: string, family = 'CONT') => ({ episodeId, signalId, family });
  const input = (over: Partial<HistoryInput> = {}): HistoryInput => ({
    collectorId: 'c1',
    episodesEvaluated: 10,
    findings: [],
    clears: [],
    ...over,
  });

  it('says nothing about a collector whose past is clean, or who has no past yet', () => {
    expect(historySignals(input(), T)).toEqual([]);
    expect(historySignals(input({ episodesEvaluated: 0 }), T)).toEqual([]);
  });

  it('flags a repeated content finding past the threshold and names what repeated', () => {
    const findings = [
      finding('e1', 'CONT.NEAR_DUPLICATE'),
      finding('e2', 'CONT.NEAR_DUPLICATE'),
      finding('e3', 'CONT.NEAR_DUPLICATE'),
      finding('e3', 'PROV.SCREEN_RECAPTURE', 'PROV'),
      // Another family's finding is not this signal's business.
      finding('e4', 'VOL.NO_GAP', 'VOL'),
    ];
    const f = historySignals(input({ findings }), T);
    expect(signalIds(f)).toEqual(['HIST.REPEAT_CONTENT_FINDINGS']);
    expect(f[0]!.evidence).toMatchObject({
      episodes: 3,
      max_episodes: 2,
      episodes_evaluated: 10,
      share: 0.3,
      signals: ['CONT.NEAR_DUPLICATE', 'PROV.SCREEN_RECAPTURE'],
      signal_counts: { 'CONT.NEAR_DUPLICATE': 3, 'PROV.SCREEN_RECAPTURE': 1 },
      episode_ids: ['e1', 'e2', 'e3'],
    });
    // Two episodes is the threshold; one episode with four faults is one episode.
    expect(historySignals(input({ findings: findings.slice(0, 2) }), T)).toEqual([]);
  });

  it('carries an operator decision to pay a held bill forward, and never a false positive', () => {
    const clear = (verdict: string, at: string, ids: string[]) => ({ verdict, clearedAt: D(at), signalIds: ids });
    const clears = [
      clear('accepted', '2026-07-01T00:00:00Z', ['CONT.NEAR_DUPLICATE']),
      clear('accepted', '2026-08-01T00:00:00Z', ['VOL.HOURS_PER_DAY']),
      clear('false_positive', '2026-08-05T00:00:00Z', ['CONT.STATIC_SCENE']),
    ];
    const f = historySignals(input({ clears }), T);
    expect(signalIds(f)).toEqual(['HIST.PRIOR_ACCEPTED_HOLDS']);
    expect(f[0]!.evidence).toMatchObject({
      accepted_holds: 2,
      max_accepted: 1,
      false_positive_clears: 1,
      signal_ids: ['CONT.NEAR_DUPLICATE', 'VOL.HOURS_PER_DAY'],
      last_cleared_at: '2026-08-01T00:00:00.000Z',
    });
    // Four false positives are evidence about the thresholds, not the person.
    expect(historySignals(input({ clears: clears.filter((c) => c.verdict === 'false_positive') }), T)).toEqual([]);
  });

  it('never holds on history alone: the two signals together stay under the hold edge', () => {
    const f = historySignals(
      input({
        findings: [finding('e1', 'CONT.NEAR_DUPLICATE'), finding('e2', 'CONT.NEAR_DUPLICATE'), finding('e3', 'CONT.NEAR_DUPLICATE')],
        clears: [
          { verdict: 'accepted', clearedAt: D('2026-07-01T00:00:00Z'), signalIds: ['CONT.NEAR_DUPLICATE'] },
          { verdict: 'accepted', clearedAt: D('2026-08-01T00:00:00Z'), signalIds: ['CONT.NEAR_DUPLICATE'] },
        ],
      }),
      T,
    );
    expect(signalIds(f)).toEqual(['HIST.PRIOR_ACCEPTED_HOLDS', 'HIST.REPEAT_CONTENT_FINDINGS']);
    const points = f.reduce((a, x) => a + T.get(x.signalId)!.points, 0);
    expect(points).toBe(55);
    expect(points).toBeLessThan(bands().hold);
  });
});
