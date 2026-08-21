import type { EpisodeRecord } from '@playerone/contracts';

/**
 * Which session an episode belongs to.
 *
 * Pure on purpose: no database, no clock, no io. This decides what a collector
 * is paid for, so the decision table has to be readable in one place and
 * testable without a Postgres running.
 *
 * The one rule that shapes everything else: a plausible guess that silently
 * becomes a payment is worse than an explicit gap a human closes. So every
 * uncertain case quarantines, and quarantine is not a failure — it is the
 * human resolution path PLT-05 requires.
 */

export type SessionRow = {
  id: string;
  prepareTime: Date | null;
  sessionOrigin: string;
};

export type HandoverRow = {
  id: string;
  deviceSerial: string | null;
};

export type ResolutionReason =
  | 'single_session'
  | 'time_window'
  | 'no_sessions'
  | 'operator_confirmation_required'
  | 'mixed_session_origin'
  | 'no_episode_start'
  | 'episode_precedes_all_sessions'
  | 'ambiguous_within_tolerance'
  | 'session_missing_prepare_time';

export type Resolution = {
  state: 'resolved' | 'quarantined';
  sessionId: string | null;
  method: 'automatic_single' | 'automatic_time_window' | null;
  /** Row 4 only: the machine chose, and a human has to agree before batch close. */
  needsConfirmation: boolean;
  /**
   * What the ordering suggests, when the machine is not allowed to act on it.
   * The console shows it, the operator confirms or corrects, and the audit row
   * keeps both so a dispute can see the difference.
   */
  proposedSessionId: string | null;
  reason: ResolutionReason;
};

/** Advisory cross-checks. Neither changes the resolution; both are recorded. */
export type ResolverDefect = { code: 'SERIAL-CONFLICT' | 'SESSION-CONFLICT'; detail: string };

/** 5 minutes. Only ever consulted for app-origin sessions — see below. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

const startMs = (record: EpisodeRecord): number | null =>
  record.timing.usable_start_us === null ? null : Number(record.timing.usable_start_us) / 1000;

export function resolveEpisode(
  record: EpisodeRecord,
  sessions: readonly SessionRow[],
  toleranceMs: number = DEFAULT_TOLERANCE_MS,
): Resolution {
  if (sessions.length === 0) {
    return quarantine('no_sessions', null);
  }

  if (sessions.length === 1) {
    // One declared task on the card, and the operator verified the card against
    // that task face to face (PRD §11.3.1 rule 1). Nothing to choose between.
    //
    // The console still shows the episode count against the session count before
    // batch close: one declared task holding seven episodes is not wrong, but it
    // is worth an operator's glance, because footage recorded outside the
    // declared task would otherwise be paid at the declared task's rate (SET-08).
    return { state: 'resolved', sessionId: sessions[0]!.id, method: 'automatic_single', needsConfirmation: false, proposedSessionId: null, reason: 'single_session' };
  }

  const ordered = [...sessions].sort(
    (a, b) => (a.prepareTime?.getTime() ?? Infinity) - (b.prepareTime?.getTime() ?? Infinity),
  );
  const proposal = propose(ordered, startMs(record), toleranceMs);

  /**
   * Time matching applies to app-origin sessions only.
   *
   * A handover-origin session's `prepare_time` is what the operator typed from
   * what the collector remembered. Matching a microsecond-precise PTS start
   * against a reconstructed timestamp, and paying on the result, is false
   * precision — the number looks exact on one side of the comparison only.
   *
   * For the pilot every session is handover-origin, so this branch is the normal
   * path: propose an ordering, quarantine, let the operator confirm. The
   * collector is standing at the counter, which is a better source than any
   * heuristic.
   */
  if (!ordered.every((s) => s.sessionOrigin === 'app')) {
    const reason = ordered.some((s) => s.sessionOrigin === 'app')
      ? 'mixed_session_origin'
      : 'operator_confirmation_required';
    return quarantine(reason, proposal.sessionId);
  }

  const start = startMs(record);
  if (start === null) {
    // No positioned stream, so nothing to match against. Defensive: across the
    // whole committed corpus this only happens on the wall-clock rung, which in
    // practice means MEDIA-MISSING.
    return quarantine('no_episode_start', null);
  }
  if (ordered.some((s) => s.prepareTime === null)) {
    return quarantine('session_missing_prepare_time', proposal.sessionId);
  }
  if (proposal.withinTolerance >= 2) {
    // Two sessions start close enough together that the episode could belong to
    // either. Guessing here is exactly what settlement cannot absorb.
    return quarantine('ambiguous_within_tolerance', proposal.sessionId);
  }
  if (proposal.sessionId === null) {
    return quarantine('episode_precedes_all_sessions', null);
  }
  return {
    state: 'resolved',
    sessionId: proposal.sessionId,
    method: 'automatic_time_window',
    needsConfirmation: true,
    proposedSessionId: proposal.sessionId,
    reason: 'time_window',
  };
}

/**
 * The latest session that began at or before the episode, plus how many sessions
 * began close enough to the episode to be indistinguishable.
 *
 * No session end is involved. An operator cannot supply a truthful end, and a
 * retroactively typed end that decides payment attribution is the failure this
 * whole design avoids — so the next session's start is the implicit boundary.
 */
function propose(
  ordered: readonly SessionRow[],
  start: number | null,
  toleranceMs: number,
): { sessionId: string | null; withinTolerance: number } {
  if (start === null) return { sessionId: null, withinTolerance: 0 };
  let chosen: string | null = null;
  let withinTolerance = 0;
  for (const s of ordered) {
    const t = s.prepareTime?.getTime();
    if (t === undefined) continue;
    if (t <= start) chosen = s.id;
    if (Math.abs(t - start) <= toleranceMs) withinTolerance++;
  }
  return { sessionId: chosen, withinTolerance };
}

const quarantine = (reason: ResolutionReason, proposedSessionId: string | null): Resolution => ({
  state: 'quarantined',
  sessionId: null,
  method: null,
  needsConfirmation: false,
  proposedSessionId,
  reason,
});

/**
 * Step 1 and step 2 of the resolver: cross-checks that are recorded and never
 * block. Both compare something the device wrote about itself against what the
 * counter observed, and UPL-08's argument applies to both — the manifest is a
 * hint from firmware that overstates duration by 34% and names files that do
 * not exist.
 */
export function resolverDefects(
  record: EpisodeRecord,
  handover: HandoverRow,
  resolvedSessionId: string | null,
): ResolverDefect[] {
  const out: ResolverDefect[] = [];

  if (
    handover.deviceSerial !== null &&
    record.device.serial.toUpperCase() !== handover.deviceSerial.toUpperCase()
  ) {
    out.push({
      code: 'SERIAL-CONFLICT',
      detail: `episode says ${record.device.serial}, handover ${handover.id.slice(0, 8)} says ${handover.deviceSerial}`,
    });
  }

  const declared = record.declared?.session_id ?? null;
  if (declared !== null && resolvedSessionId !== null && declared !== resolvedSessionId) {
    out.push({
      code: 'SESSION-CONFLICT',
      detail: `manifest says session ${declared}, the handover resolves to ${resolvedSessionId}`,
    });
  }
  return out;
}
