import { describe, expect, it } from 'vitest';
import type { EpisodeRecord } from '@playerone/contracts';
import {
  DEFAULT_EARLIEST_PLAUSIBLE_START_MS,
  DEFAULT_RESOLVER_CONFIG,
  resolveEpisode,
  resolverDefects,
  type DeviceAssignment,
  type SessionRow,
} from '../src/resolve.ts';

/**
 * The decision table, with no database in the way.
 *
 * This function decides what a collector is paid for, so every row of the table
 * gets a case — including the ones that refuse to decide. Quarantine is the
 * correct answer more often than it looks: an explicit gap a human closes beats
 * a plausible guess that silently becomes a payment.
 */

const T = Date.parse('2026-08-21T09:00:00.000Z');
const min = (n: number) => n * 60_000;

/** A stream carrying nothing but its role and its first absolute timestamp. */
const stream = (role: string, firstPtsUs: string | null) => ({
  role,
  parts: [],
  pts_source: 'sidecar' as const,
  first_pts_us: firstPtsUs,
  last_pts_us: null,
  sample_count: 0,
  span_s: 0,
  nominal_rate_hz: null,
});

/** Microseconds, as the record spells them. */
const us = (ms: number) => String(ms * 1000);

/** Only the fields the resolver reads. */
function episode(opts: {
  startMs?: number | null;
  serial?: string;
  declaredSession?: string | null;
  streams?: ReturnType<typeof stream>[];
}): EpisodeRecord {
  const start = opts.startMs === undefined ? T : opts.startMs;
  return {
    schema_version: '1.1.0',
    episode_id: '3ed23c87-463e-8c3d-9a21-aca46c823f5c',
    content_fingerprint: 'a'.repeat(64),
    state: 'ok',
    source: { path: 'ego_AZER76400FE_20260813_072310', ingest_tool_version: '0.3.1', ingested_at: '', ingest_host: '' },
    device: { serial: opts.serial ?? 'AZER76400FE', firmware_declared: null, calibration_serial: null },
    declared:
      opts.declaredSession === undefined
        ? null
        : {
            session_id: opts.declaredSession,
            status: null,
            duration_sec: null,
            start_time: null,
            end_time: null,
            video_left_frame_count: null,
            video_right_frame_count: null,
            imu_accel_count: null,
            imu_gyro_count: null,
            audio_frame_count: null,
          },
    streams: opts.streams ?? [],
    timing: {
      method: 'pts_sidecar',
      confidence: 'exact',
      usable_start_us: start === null ? null : String(start * 1000),
      usable_end_us: null,
      raw_duration_s: 8.5,
      max_stream_skew_ms: 0,
    },
    calibration: { present: true, files: [] },
    source_files: [],
    discrepancies: [],
    unclassified_files: [],
  };
}

const session = (id: string, offsetMin: number | null, origin = 'app'): SessionRow => ({
  id,
  prepareTime: offsetMin === null ? null : new Date(T + min(offsetMin)),
  sessionOrigin: origin,
});

describe('the resolver decision table', () => {
  it('row 1 — no sessions on the handover quarantines', () => {
    const r = resolveEpisode(episode({}), []);
    expect(r).toMatchObject({ state: 'quarantined', sessionId: null, reason: 'no_sessions' });
  });

  it('row 2 — exactly one session resolves without a human', () => {
    const r = resolveEpisode(episode({}), [session('s1', -60, 'handover')]);
    expect(r).toMatchObject({
      state: 'resolved',
      sessionId: 's1',
      method: 'automatic_single',
      needsConfirmation: false,
    });
  });

  it('row 3 — no episode start, more than one session, quarantines', () => {
    const r = resolveEpisode(episode({ startMs: null }), [session('s1', -60), session('s2', 60)]);
    expect(r).toMatchObject({ state: 'quarantined', reason: 'no_episode_start' });
  });

  it('row 4 — app-origin sessions resolve by window, and still want a human', () => {
    const r = resolveEpisode(episode({}), [session('morning', -120), session('afternoon', 120)]);
    expect(r).toMatchObject({
      state: 'resolved',
      sessionId: 'morning',
      method: 'automatic_time_window',
      needsConfirmation: true,
    });
  });

  it('row 4 — picks the latest session that had already started', () => {
    const r = resolveEpisode(episode({}), [
      session('first', -300),
      session('second', -120),
      session('third', 120),
    ]);
    expect(r.sessionId).toBe('second');
  });

  it('row 5 — two sessions inside the tolerance quarantines rather than guessing', () => {
    const r = resolveEpisode(episode({}), [session('a', -1), session('b', 2)]);
    expect(r).toMatchObject({ state: 'quarantined', reason: 'ambiguous_within_tolerance' });
    // The ordering is still offered, so the operator has a starting point.
    expect(r.proposedSessionId).toBe('a');
  });

  it('row 6 — an episode before every session quarantines', () => {
    const r = resolveEpisode(episode({}), [session('a', 60), session('b', 120)]);
    expect(r).toMatchObject({
      state: 'quarantined',
      reason: 'episode_precedes_all_sessions',
      proposedSessionId: null,
    });
  });

  it('row 7 — a session with no prepare time quarantines', () => {
    const r = resolveEpisode(episode({}), [session('a', -120), session('b', null)]);
    expect(r).toMatchObject({ state: 'quarantined', reason: 'session_missing_prepare_time' });
  });

  /**
   * The pilot's normal path. Every session is reconstructed at the counter, so
   * matching a microsecond PTS start against an operator's typed estimate would
   * be precision on one side only.
   */
  it('handover-origin sessions are never matched by time, they go to the operator', () => {
    const r = resolveEpisode(episode({}), [
      session('morning', -120, 'handover'),
      session('afternoon', 120, 'handover'),
    ]);
    expect(r).toMatchObject({
      state: 'quarantined',
      method: null,
      reason: 'operator_confirmation_required',
    });
    // With a proposal, so the console can order the work rather than present a list.
    expect(r.proposedSessionId).toBe('morning');
  });

  it('a mix of origins goes to the operator too, and says so', () => {
    const r = resolveEpisode(episode({}), [session('a', -120, 'app'), session('b', 120, 'handover')]);
    expect(r).toMatchObject({ state: 'quarantined', reason: 'mixed_session_origin' });
  });

  it('uses the tolerance it was given, not a constant', () => {
    // Two sessions two hours either side of the episode. Narrow tolerance: the
    // earlier one wins cleanly. Widen it past both and the same input becomes
    // ambiguous — which is what proves the parameter is actually consulted.
    const sessions = [session('a', -120), session('b', 120)];
    const narrow = resolveEpisode(episode({}), sessions, min(1));
    expect(narrow).toMatchObject({ state: 'resolved', sessionId: 'a' });

    const wide = resolveEpisode(episode({}), sessions, min(180));
    expect(wide).toMatchObject({ state: 'quarantined', reason: 'ambiguous_within_tolerance' });
  });

  it('never resolves and quarantines at the same time', () => {
    // PLT-05 in the pure layer: the two fields cannot disagree, so the database
    // CHECK never has to catch this function.
    const cases: SessionRow[][] = [
      [],
      [session('s', -10, 'handover')],
      [session('a', -120), session('b', 120)],
      [session('a', -1), session('b', 1)],
      [session('a', 60), session('b', 120)],
      [session('a', -120, 'handover'), session('b', 120, 'handover')],
    ];
    for (const sessions of cases) {
      for (const start of [T, null]) {
        const r = resolveEpisode(episode({ startMs: start }), sessions);
        if (r.state === 'resolved') expect(r.sessionId).not.toBeNull();
        else expect(r.sessionId).toBeNull();
      }
    }
  });
});

describe('the advisory cross-checks', () => {
  const handover = { id: 'ffffffff-0000-0000-0000-000000000000', deviceSerial: 'AZER76400FE' };

  it('raises SERIAL-CONFLICT when the card came off a different device', () => {
    const d = resolverDefects(episode({ serial: 'BZER99900AA' }), handover, 's1');
    expect(d.map((x) => x.code)).toEqual(['SERIAL-CONFLICT']);
    expect(d[0]!.detail).toContain('BZER99900AA');
  });

  it('ignores case, because a serial is a serial', () => {
    expect(resolverDefects(episode({ serial: 'azer76400fe' }), handover, 's1')).toEqual([]);
  });

  it('raises SESSION-CONFLICT when the manifest disagrees with the counter', () => {
    const d = resolverDefects(episode({ declaredSession: 'device-said-this' }), handover, 's1');
    expect(d.map((x) => x.code)).toEqual(['SESSION-CONFLICT']);
  });

  it('says nothing when the manifest carries no session id — which is every real sample', () => {
    // Firmware 1.0.3 writes none of task_id, worker_id, device_id or
    // collection_session_id, so this branch is defensive until D4 lands.
    expect(resolverDefects(episode({ declaredSession: null }), handover, 's1')).toEqual([]);
    expect(resolverDefects(episode({}), handover, 's1')).toEqual([]);
  });

  it('says nothing about a session id when nothing resolved', () => {
    const d = resolverDefects(episode({ declaredSession: 'x' }), handover, null);
    expect(d).toEqual([]);
  });
});

/**
 * The audit trail. One proposal and one reason is not enough for an operator to
 * overturn a decision, nor to defend one in a payment dispute months later.
 */
describe('evaluated[]', () => {
  const outcomes: { name: string; sessions: SessionRow[]; startMs?: number | null }[] = [
    { name: 'no sessions', sessions: [] },
    { name: 'single session', sessions: [session('s1', -60, 'handover')] },
    { name: 'time window', sessions: [session('a', -120), session('b', 120)] },
    { name: 'ambiguous', sessions: [session('a', -1), session('b', 2)] },
    {
      name: 'operator confirmation',
      sessions: [session('a', -120, 'handover'), session('b', 120, 'handover')],
    },
    { name: 'precedes all', sessions: [session('a', 60), session('b', 120)] },
    { name: 'no start', sessions: [session('a', -60), session('b', 60)], startMs: null },
  ];

  it('records every candidate supplied, on every outcome', () => {
    for (const { name, sessions, startMs } of outcomes) {
      const r = resolveEpisode(episode({ startMs }), sessions);
      expect(r.evaluated.length, `${name}: nothing may be dropped without a record`).toBe(
        sessions.length,
      );
      expect(new Set(r.evaluated.map((e) => e.collectionSessionId))).toEqual(
        new Set(sessions.map((s) => s.id)),
      );
    }
  });

  it('populates the audit trail on a successful resolution too, not just a refusal', () => {
    const r = resolveEpisode(episode({}), [session('a', -120), session('b', 120)]);
    expect(r.state).toBe('resolved');
    expect(r.evaluated).toHaveLength(2);
    expect(r.evaluated.every((e) => e.survived)).toBe(true);
    expect(r.candidateCount).toBe(2);
  });

  it('keeps the sign of the delta, because recording early is legitimate', () => {
    // The session was registered an hour AFTER the recording started.
    const r = resolveEpisode(episode({}), [
      session('early', 60, 'handover'),
      session('b', 120, 'handover'),
    ]);
    const early = r.evaluated.find((e) => e.collectionSessionId === 'early')!;
    expect(early.timeDeltaUs).toBe(String(-min(60) * 1000));
  });

  /**
   * If a shuffle changes the answer, an implicit tie-break has crept in — which
   * is the single failure this component exists to prevent.
   */
  it('reordering the candidates never changes the decision', () => {
    const base = [session('a', -300), session('b', -120), session('c', 120), session('d', -240)];
    const decision = (xs: SessionRow[]) => {
      const r = resolveEpisode(episode({}), xs);
      return { state: r.state, sessionId: r.sessionId, reason: r.reason, count: r.candidateCount };
    };
    const first = decision(base);
    // Every rotation, plus a reversal. Deterministic, so no randomness enters.
    for (let i = 0; i < base.length; i++) {
      expect(decision([...base.slice(i), ...base.slice(0, i)])).toEqual(first);
    }
    expect(decision([...base].reverse())).toEqual(first);
  });
});

describe('the eligibility filter', () => {
  const claim = (id: string, offsetMin: number, extra: Partial<SessionRow>): SessionRow => ({
    ...session(id, offsetMin, 'handover'),
    ...extra,
  });

  it('keeps a recording that began inside a claim and ran past its expiry', () => {
    // Expiry one minute after the episode start. The collector began legitimately.
    const s = claim('s1', -60, { claimExpiresAt: new Date(T + min(1)) });
    const r = resolveEpisode(episode({}), [s]);
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's1' });
    expect(r.evaluated[0]).toMatchObject({ survived: true, rejectionReason: null });
  });

  it('drops a claim that had already expired when recording began', () => {
    const s = claim('s1', -60, { claimExpiresAt: new Date(T - min(1)) });
    const r = resolveEpisode(episode({}), [s]);
    expect(r).toMatchObject({ state: 'quarantined', reason: 'all_candidates_ineligible' });
    expect(r.evaluated[0]).toMatchObject({ survived: false, rejectionReason: 'claim_expired' });
  });

  it('drops a session already resolved to another episode', () => {
    const r = resolveEpisode(episode({}), [session('s1', -60, 'handover')], undefined, ['s1']);
    expect(r).toMatchObject({ state: 'quarantined', reason: 'all_candidates_ineligible' });
    expect(r.evaluated[0]).toMatchObject({ survived: false, rejectionReason: 'already_taken' });
  });

  it('drops a claim whose status is not eligible', () => {
    const s = claim('s1', -60, { claimStatus: 'CANCELLED' });
    const r = resolveEpisode(episode({}), [s], { eligibleClaimStatuses: ['CLAIMED', 'COLLECTING'] });
    expect(r.evaluated[0]).toMatchObject({
      survived: false,
      rejectionReason: 'claim_status_ineligible',
    });
  });

  it('cannot drop a candidate on a field nobody supplied', () => {
    // No column carries a claim status yet. Absent data must not invent an
    // ineligibility, which is the same class of mistake as inventing a match.
    const r = resolveEpisode(episode({}), [session('s1', -60, 'handover')], {
      eligibleClaimStatuses: ['CLAIMED'],
    });
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's1' });
  });

  it('records every reason when the whole set is dropped', () => {
    const sessions = [
      claim('expired', -60, { claimExpiresAt: new Date(T - min(1)) }),
      claim('taken', -60, {}),
      claim('cancelled', -60, { claimStatus: 'CANCELLED' }),
    ];
    const r = resolveEpisode(episode({}), sessions, { eligibleClaimStatuses: ['CLAIMED'] }, [
      'taken',
    ]);
    expect(r).toMatchObject({ state: 'quarantined', reason: 'all_candidates_ineligible' });
    expect(r.candidateCount).toBe(0);
    expect(r.evaluated.map((e) => e.rejectionReason)).toEqual([
      'claim_expired',
      'already_taken',
      'claim_status_ineligible',
    ]);
  });

  it('tells an empty handover apart from a fully rejected one', () => {
    expect(resolveEpisode(episode({}), []).reason).toBe('no_sessions');
    expect(
      resolveEpisode(episode({}), [session('s1', -60, 'handover')], undefined, ['s1']).reason,
    ).toBe('all_candidates_ineligible');
  });
});

/**
 * The device-assignment crosscheck (Daniel, from PaXini, 2026-08-25).
 *
 * One collector holds a headset for an allotted period, so device serial plus
 * recording start names a collector. Two collectors here throughout, never one:
 * the last payment bug in this repo survived a green suite because every
 * fixture had a single collector, and a crosscheck between two parties is
 * exactly the shape a one-party fixture cannot test.
 */
describe('the device-assignment crosscheck', () => {
  const C1 = 'collector-1';
  const C2 = 'collector-2';

  /** A candidate that names who declared it. */
  const declaredBy = (id: string, collectorId: string, offsetMin = -60): SessionRow => ({
    ...session(id, offsetMin, 'handover'),
    collectorId,
  });

  const period = (
    collectorId: string,
    fromMin: number | null,
    toMin: number | null,
  ): DeviceAssignment => ({
    collectorId,
    validFrom: new Date(fromMin === null ? T - min(60 * 24 * 365) : T + min(fromMin)),
    validTo: toMin === null ? null : new Date(T + min(toMin)),
  });

  it('resolves when the declaring collector held the device at the episode start', () => {
    const r = resolveEpisode(episode({}), [declaredBy('s1', C1)], undefined, [], [
      period(C1, -60 * 24 * 30, null),
    ]);
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's1', reason: 'single_session' });
    expect(r.evaluated[0]).toMatchObject({ survived: true, rejectionReason: null });
  });

  it('drops a candidate whose collector was not the assignee at that instant', () => {
    // The allotment swapped to the second collector a week before this
    // recording, so a session the first one declared cannot be its owner.
    const r = resolveEpisode(episode({}), [declaredBy('s1', C1)], undefined, [], [
      period(C1, -60 * 24 * 100, -60 * 24 * 7),
      period(C2, -60 * 24 * 7, null),
    ]);
    expect(r.evaluated[0]).toMatchObject({
      survived: false,
      rejectionReason: 'device_not_assigned_to_collector',
    });
    expect(r).toMatchObject({ state: 'quarantined', reason: 'all_candidates_ineligible' });
    expect(r.candidateCount).toBe(0);
  });

  it('keeps the assignee and drops the other, out of two candidates on one card', () => {
    const r = resolveEpisode(
      episode({}),
      [declaredBy('theirs', C1, -120), declaredBy('ours', C2, -60)],
      undefined,
      [],
      [period(C1, -60 * 24 * 100, -60 * 24 * 7), period(C2, -60 * 24 * 7, null)],
    );
    // Two candidates would have gone to an operator. The crosscheck leaves one,
    // which is the whole reason it earns its place on the money path.
    expect(r).toMatchObject({ state: 'resolved', sessionId: 'ours', reason: 'single_session' });
    expect(r.evaluated.map((e) => e.rejectionReason)).toEqual([
      'device_not_assigned_to_collector',
      null,
    ]);
  });

  it('does not judge footage from before the record begins', () => {
    // Bridge F-33. Custody tracking starts with the earliest period on record;
    // a recording from before it was made while nobody was keeping the record,
    // and the bind that came later must not quarantine it retroactively.
    const r = resolveEpisode(episode({}), [declaredBy('s1', C1)], undefined, [], [
      period(C1, 60 * 24, null),
    ]);
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's1' });
    expect(r.evaluated[0]).toMatchObject({ survived: true, rejectionReason: null });
  });

  it('routes to a human when no period covers the start, and drops nobody', () => {
    // The device has a record and this instant is not in it: one allotment
    // ended two hours ago and the next starts tomorrow. Nobody is known to have
    // held it then, which is not the same fact as "this collector did not".
    const r = resolveEpisode(episode({}), [declaredBy('s1', C1)], undefined, [], [
      period(C1, -60 * 24 * 30, -120),
      period(C1, 60 * 24, null),
    ]);
    expect(r).toMatchObject({
      state: 'quarantined',
      reason: 'device_assignment_unknown',
      sessionId: null,
    });
    expect(r.evaluated[0]).toMatchObject({ survived: true, rejectionReason: null });
    expect(r.candidateCount).toBe(1);
  });

  it('gives a boundary instant to the incoming collector, and to one only', () => {
    // Half-open, [from, to), the same rule device_assignments_no_overlap uses.
    // Closed on both ends would make the swap instant belong to two people.
    const swap = [period(C1, -60 * 24 * 30, 0), period(C2, 0, null)];
    const r = resolveEpisode(episode({}), [declaredBy('s2', C2)], undefined, [], swap);
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's2' });

    const outgoing = resolveEpisode(episode({}), [declaredBy('s1', C1)], undefined, [], swap);
    expect(outgoing.evaluated[0]!.rejectionReason).toBe('device_not_assigned_to_collector');
  });

  it('does not run at all when no assignments are supplied', () => {
    // Every caller that does not know about devices, including the CLI and the
    // resolver's own older tests. Not supplied can never drop a candidate.
    const r = resolveEpisode(episode({}), [declaredBy('s1', C1)]);
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's1' });
  });

  it('does not run when the episode has no start instant to check against', () => {
    // What is missing is the clock, not the assignment record, and the
    // resolution already carries startSource: null to say so. Calling this
    // device_assignment_unknown would blame the wrong record.
    const r = resolveEpisode(episode({ startMs: null }), [declaredBy('s1', C1)], undefined, [], [
      period(C2, -60 * 24 * 30, null),
    ]);
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's1', startSource: null });
    expect(r.evaluated[0]!.rejectionReason).toBeNull();
  });

  it('cannot drop a candidate whose collector nobody supplied', () => {
    // The same rule the claim fields follow: a comparison that was never made
    // is not a comparison that failed.
    const r = resolveEpisode(episode({}), [session('s1', -60, 'handover')], undefined, [], [
      period(C2, -60 * 24 * 30, null),
    ]);
    expect(r).toMatchObject({ state: 'resolved', sessionId: 's1' });
  });
});

/**
 * The episode start, tried in order of how far its clock can be trusted. Camera
 * PTS is not the only absolute clock in the folder, and refusing on its absence
 * alone sent two of the five real sessions to a human unnecessarily.
 */
describe('the episode-start fallback chain', () => {
  const two = [session('a', -120), session('b', 120)];
  /** 1970. What 072516's IMU reads when it carries the epoch twice. */
  const EPOCH_FAULT = '1000000';

  it('uses camera PTS when it is there, and flags nothing', () => {
    const r = resolveEpisode(episode({ streams: [stream('audio', us(T))] }), two);
    expect(r).toMatchObject({
      state: 'resolved',
      startSource: 'camera_pts',
      startConfidence: 'exact',
      startFlag: null,
    });
  });

  it('072538 shape — zero-byte camera sidecars, audio intact — resolves from audio', () => {
    const r = resolveEpisode(
      episode({ startMs: null, streams: [stream('audio', us(T)), stream('imu_accel', us(T))] }),
      two,
    );
    expect(r).toMatchObject({
      state: 'resolved',
      sessionId: 'a',
      startSource: 'audio_pts',
      startConfidence: 'exact',
      startFlag: 'START-FROM-AUDIO-PTS',
    });
  });

  it('072516 shape — a faulty IMU clock never wins over intact audio', () => {
    const r = resolveEpisode(
      episode({
        startMs: null,
        streams: [stream('imu_accel', EPOCH_FAULT), stream('audio', us(T))],
      }),
      two,
    );
    expect(r).toMatchObject({ state: 'resolved', startSource: 'audio_pts' });
  });

  /**
   * The gate on its own. With audio gone the faulty IMU is the only remaining
   * source, and it must still be refused: anchoring a payment in 1970 is worse
   * than the no_episode_start this chain exists to reduce.
   */
  it('rejects an implausible instant rather than resolving confidently into 1970', () => {
    const r = resolveEpisode(
      episode({ startMs: null, streams: [stream('imu_accel', EPOCH_FAULT)] }),
      two,
    );
    expect(r).toMatchObject({ state: 'quarantined', reason: 'no_episode_start' });
    expect(r.startSource).toBeNull();
  });

  it('falls to the IMU when nothing better survives, and says the evidence is weaker', () => {
    const r = resolveEpisode(episode({ startMs: null, streams: [stream('imu_gyro', us(T))] }), two);
    expect(r).toMatchObject({
      state: 'resolved',
      startSource: 'imu',
      startConfidence: 'derived',
      startFlag: 'START-FROM-IMU',
    });
  });

  it('refuses a future instant too — the gate is a window, not a floor', () => {
    const r = resolveEpisode(episode({ startMs: null, streams: [stream('audio', us(T))] }), two, {
      latestPlausibleStartMs: T - 1,
    });
    expect(r).toMatchObject({ state: 'quarantined', reason: 'no_episode_start' });
  });

  it('invents nothing when every rung is unusable', () => {
    const r = resolveEpisode(
      episode({ startMs: null, streams: [stream('audio', null), stream('imu_accel', null)] }),
      two,
    );
    expect(r).toMatchObject({
      state: 'quarantined',
      reason: 'no_episode_start',
      sessionId: null,
      startSource: null,
      startConfidence: null,
      startFlag: null,
    });
  });

  it('does not treat the plausibility floor as a magic number', () => {
    // The same instant, refused under a floor above it and accepted under one below.
    const rec = episode({ startMs: null, streams: [stream('audio', us(T))] });
    expect(resolveEpisode(rec, two, { earliestPlausibleStartMs: T + 1 }).reason).toBe(
      'no_episode_start',
    );
    expect(resolveEpisode(rec, two, { earliestPlausibleStartMs: T }).state).toBe('resolved');
  });
});

describe('the config snapshot', () => {
  it('travels with the decision, so a re-run can be compared against it', () => {
    const r = resolveEpisode(episode({}), [session('a', -120), session('b', 120)], min(3));
    expect(r.configSnapshot.toleranceMs).toBe(min(3));
    expect(r.configSnapshot.earliestPlausibleStartMs).toBe(DEFAULT_EARLIEST_PLAUSIBLE_START_MS);
  });

  it('a bare number still means the tolerance, so no existing call site changed', () => {
    const sessions = [session('a', -120), session('b', 120)];
    expect(resolveEpisode(episode({}), sessions, min(1))).toMatchObject({
      state: 'resolved',
      sessionId: 'a',
    });
    expect(resolveEpisode(episode({}), sessions, min(180))).toMatchObject({
      state: 'quarantined',
      reason: 'ambiguous_within_tolerance',
    });
  });

  it('defaults when nothing is passed at all', () => {
    const r = resolveEpisode(episode({}), [session('s1', -60, 'handover')]);
    expect(r.configSnapshot).toEqual(DEFAULT_RESOLVER_CONFIG);
  });

  it('a partial config keeps the other defaults', () => {
    const r = resolveEpisode(episode({}), [session('s1', -60, 'handover')], { toleranceMs: 42 });
    expect(r.configSnapshot).toEqual({ ...DEFAULT_RESOLVER_CONFIG, toleranceMs: 42 });
  });
});
