import { describe, expect, it } from 'vitest';
import type { EpisodeRecord } from '@playerone/contracts';
import {
  DEFAULT_EARLIEST_PLAUSIBLE_START_MS,
  DEFAULT_RESOLVER_CONFIG,
  resolveEpisode,
  resolverDefects,
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
