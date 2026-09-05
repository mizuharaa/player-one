import type { EpisodeRecord } from '@playerone/contracts';
import { EARLIEST_PLAUSIBLE_START_MS } from '@playerone/contracts';

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
 *
 * ## Why the candidate set is a handover, and not a device or a time window
 *
 * The caller supplies the sessions declared against ONE handover — one physical
 * card, handed across one counter, once. That scope is load-bearing and it was
 * bought with a bug: candidates were once scoped by collector, so every session
 * a collector had ever declared was a candidate for every later card. One card
 * per collector hides it completely; the second card quarantines the whole
 * batch, and under time matching it could attach this week's footage to last
 * week's task at last week's unit price (SET-08). Time is a filter INSIDE the
 * handover's set, never the outer bound.
 *
 * ## The device-assignment crosscheck
 *
 * Daniel, from PaXini, 2026-08-25: one collector holds a given headset for an
 * allotted period of about three months, and at the end of it the credentials
 * swap to the next collector. So the device serial plus the recording start
 * instant names a collector.
 *
 * That is a CROSSCHECK and not a second scoping rule. It runs INSIDE the
 * handover's candidate set, exactly as time matching does, and the paragraph
 * above still holds: the handover is the outer bound and nothing here widens
 * it. What the crosscheck can do is drop a candidate the handover admitted —
 * a session declared by a collector who was not holding this device when the
 * recording started.
 *
 * The assignments themselves are looked up by the adapter and arrive as data,
 * because this file may not read a database.
 *
 * Which upload path each case belongs to, because the next reader will ask why
 * a resolver needs a handover at all:
 *
 *   Path A  device -> phone -> cloud.   The app already holds the collection
 *                                       session (APP-16). Nothing to resolve.
 *   Path C  TF card -> upload centre.   The resolution problem, and the reason
 *                                       this file exists. The handover is the
 *                                       physical event that bounds which
 *                                       sessions could possibly be on the card.
 *   Path B  device -> cloud direct.     No handover and no app, so no scoping
 *                                       mechanism exists. Out of scope. UPL-02
 *                                       is P1 and blocked on D2 anyway.
 */

export type SessionRow = {
  id: string;
  prepareTime: Date | null;
  sessionOrigin: string;
  /**
   * Who declared the session. Read only by the device-assignment crosscheck,
   * and optional for the same reason the claim fields below are: a caller that
   * does not supply it cannot have a candidate dropped for it.
   */
  collectorId?: string | null;
  /**
   * Eligibility inputs. Optional because NO COLUMN CARRIES THEM YET —
   * `collection_sessions` has no claim status and `tasks` has no expiry. The
   * filter below is built and tested against the shapes the spec describes, so
   * that wiring it up later is a query change and not a design change. An
   * undefined field means "not supplied", which can never drop a candidate:
   * inventing an ineligibility out of missing data is the same class of mistake
   * as inventing a match.
   */
  claimStatus?: string | null;
  claimExpiresAt?: Date | null;
};

export type HandoverRow = {
  id: string;
  deviceSerial: string | null;
};

/**
 * One collector's allotted period with one device, as the adapter read it out
 * of `device_assignments`.
 *
 * Half-open — `[validFrom, validTo)` — matching the exclusion constraint that
 * stops two of them overlapping, so the instant one period ends is the instant
 * the next begins and a boundary belongs to the incoming collector alone. A
 * null `validTo` is the open period: this collector holds the device now.
 */
export type DeviceAssignment = {
  collectorId: string;
  validFrom: Date;
  validTo: Date | null;
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
  | 'session_missing_prepare_time'
  | 'all_candidates_ineligible'
  | 'device_assignment_unknown';

/** Why a candidate was dropped before any strategy ran. */
export type RejectionReason =
  | 'claim_status_ineligible'
  | 'claim_expired'
  | 'already_taken'
  | 'device_not_assigned_to_collector';

/** Which pass a candidate was looked at in. */
export type ResolverStrategy =
  | 'eligibility'
  | 'single_session'
  | 'time_window'
  | 'operator_confirmation';

/**
 * Every candidate considered, with why it survived or was dropped.
 *
 * Audit output, not debug output: populated on every outcome, successful ones
 * included. One proposal and one reason is not enough for an operator to
 * overturn a decision, and not enough to defend one in a payment dispute six
 * months later.
 */
export type EvaluatedCandidate = {
  collectionSessionId: string;
  strategy: ResolverStrategy;
  /**
   * Signed, microseconds, decimal string — the engine's own unit, so nothing is
   * lost crossing into this file. Computed as `episode start - prepare_time`, so
   * a negative value means the collector began recording before the registered
   * start. That is legitimate, and it must keep its direction.
   */
  timeDeltaUs: string | null;
  survived: boolean;
  rejectionReason: RejectionReason | null;
};

/** Where the episode's start instant came from. See `pickStart`. */
export type StartSource = 'camera_pts' | 'audio_pts' | 'imu';

export type StartFlag = 'START-FROM-AUDIO-PTS' | 'START-FROM-IMU';

export type ResolverConfig = {
  /** Only ever consulted for app-origin sessions — see below. */
  toleranceMs: number;
  /**
   * Claim statuses a candidate may hold and still be matched. Empty disables
   * the check, which is today's state: nothing writes a claim status yet.
   */
  eligibleClaimStatuses: readonly string[];
  /**
   * The plausibility gate for `pickStart`. An instant outside this window is a
   * clock fault, not a recording. 072516's IMU carries the epoch twice and
   * reads as 1970; without a floor the fallback chain would resolve confidently
   * into the wrong decade, which is worse than the `no_episode_start` it
   * replaced.
   *
   * 2026-01-01T00:00:00Z. The Ego fleet did not exist before this — the first
   * samples are firmware 1.0.3, dated 13 August 2026.
   */
  earliestPlausibleStartMs: number;
  /**
   * A recording cannot come from the future. The default is deliberately far
   * out (2100-01-01T00:00:00Z) because this function may not read a clock. The
   * adapter narrows it to `now + slack`, which is where a clock is allowed.
   */
  latestPlausibleStartMs: number;
};

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

  /** Every candidate supplied, in the order supplied. Never shorter. */
  evaluated: EvaluatedCandidate[];
  /** Survivors of the eligibility filter, not the number considered. */
  candidateCount: number;
  /**
   * What the decision was made under. A match at a 2-minute tolerance and one
   * at 15 minutes are different claims about the world, and the tolerance WILL
   * move once device clock discipline is known (D4). Persist this alongside the
   * decision, or a re-run silently produces a different answer with no record
   * of why.
   */
  configSnapshot: ResolverConfig;
  /**
   * Which clock the episode's start was read from, and how far to trust it. A
   * resolution anchored on the IMU is weaker evidence than one anchored on
   * camera PTS, and settlement should be able to see the difference.
   */
  startSource: StartSource | null;
  startConfidence: 'exact' | 'derived' | null;
  startFlag: StartFlag | null;
};

/** Advisory cross-checks. Neither changes the resolution; both are recorded. */
export type ResolverDefect = { code: 'SERIAL-CONFLICT' | 'SESSION-CONFLICT'; detail: string };

/** 5 minutes. Only ever consulted for app-origin sessions — see below. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * 2026-01-01T00:00:00Z, as epoch milliseconds.
 *
 * Re-exported from `@playerone/contracts` rather than restated, because the
 * ingest engine raises `DEVICE-CLOCK-UNSET` against the same floor and two
 * copies of the number would drift. The value is unchanged.
 */
export const DEFAULT_EARLIEST_PLAUSIBLE_START_MS = EARLIEST_PLAUSIBLE_START_MS;
/** 2100-01-01T00:00:00Z. The adapter should narrow this to `now + slack`. */
export const DEFAULT_LATEST_PLAUSIBLE_START_MS = 4_102_444_800_000;

export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = {
  toleranceMs: DEFAULT_TOLERANCE_MS,
  eligibleClaimStatuses: [],
  earliestPlausibleStartMs: DEFAULT_EARLIEST_PLAUSIBLE_START_MS,
  latestPlausibleStartMs: DEFAULT_LATEST_PLAUSIBLE_START_MS,
};

const US_PER_MS = 1000n;

type StartPick = {
  us: bigint;
  source: StartSource;
  confidence: 'exact' | 'derived';
  flag: StartFlag | null;
};

/**
 * The episode's start instant, tried in order of how far the clock behind it
 * can be trusted. Stops at the first rung that yields a plausible instant.
 *
 *   1  camera PTS   the engine's usable window start. exact, no flag
 *   2  audio PTS    exact, flagged — 072538 has zero-byte camera sidecars
 *   3  IMU          derived, flagged
 *   4  nothing      the human queue, and nothing is invented
 *
 * Container duration is deliberately absent from this chain: it yields a
 * length, not an absolute instant, so it cannot anchor anything.
 *
 * Every rung passes the same plausibility gate, and a source that fails it
 * falls through rather than winning. That gate is the whole reason the chain is
 * an improvement: 072516's IMU would otherwise anchor a payment in 1970.
 */
function pickStart(record: EpisodeRecord, cfg: ResolverConfig): StartPick | null {
  const floor = BigInt(cfg.earliestPlausibleStartMs) * US_PER_MS;
  const ceiling = BigInt(cfg.latestPlausibleStartMs) * US_PER_MS;
  const plausible = (us: bigint) => us >= floor && us <= ceiling;

  const fromStream = (role: string): bigint | null => {
    const s = record.streams.find((x) => x.role === role);
    if (s === undefined || s.first_pts_us === null) return null;
    return BigInt(s.first_pts_us);
  };

  if (record.timing.usable_start_us !== null) {
    const us = BigInt(record.timing.usable_start_us);
    if (plausible(us)) return { us, source: 'camera_pts', confidence: 'exact', flag: null };
  }

  const audio = fromStream('audio');
  if (audio !== null && plausible(audio)) {
    return { us: audio, source: 'audio_pts', confidence: 'exact', flag: 'START-FROM-AUDIO-PTS' };
  }

  // Accelerometer first, gyroscope second. They share a clock, so this order is
  // only about which file survived, never about which is more accurate.
  for (const role of ['imu_accel', 'imu_gyro']) {
    const imu = fromStream(role);
    if (imu !== null && plausible(imu)) {
      return { us: imu, source: 'imu', confidence: 'derived', flag: 'START-FROM-IMU' };
    }
  }
  return null;
}

/**
 * Which collector held the device at the episode's start instant.
 *
 * Three answers, and the difference between the last two is the whole design:
 *
 *   undefined  not checkable — no assignments were supplied, the episode has
 *              no start instant to check one against, or it started before the
 *              earliest period on record (custody was not being tracked yet;
 *              bridge F-33). The crosscheck does not run and nothing is dropped.
 *   null       assignments were supplied and none covers the instant. Nobody is
 *              on record as holding the device then, which is a different fact
 *              from "this collector did not", so it routes to a human instead
 *              of dropping anybody.
 *   a uuid     the device's assignee at that instant.
 *
 * An episode with no start instant is deliberately in the first case rather than
 * the second: what is missing there is the clock, not the assignment, and the
 * resolution already carries `startSource: null` to say so. Naming it
 * `device_assignment_unknown` would put the blame on the wrong record.
 */
function assigneeAt(
  assignments: readonly DeviceAssignment[] | undefined,
  startUs: bigint | null,
): string | null | undefined {
  if (assignments === undefined || startUs === null) return undefined;
  const earliest = assignments.reduce(
    (min, a) => (a.validFrom.getTime() < min ? a.validFrom.getTime() : min),
    Number.POSITIVE_INFINITY,
  );
  if (startUs < BigInt(earliest) * US_PER_MS) return undefined;
  const covering = assignments.find(
    (a) =>
      BigInt(a.validFrom.getTime()) * US_PER_MS <= startUs &&
      (a.validTo === null || startUs < BigInt(a.validTo.getTime()) * US_PER_MS),
  );
  return covering?.collectorId ?? null;
}

/**
 * Eligibility. Runs before any strategy, and records every drop.
 *
 * The expiry comparison uses the EPISODE'S START, never `now`. A collector who
 * began inside a valid claim and recorded past its expiry recorded
 * legitimately. Comparing against `now` would retroactively invalidate every
 * past episode as claims age — a bug that surfaces weeks later, in bulk, on the
 * money path.
 */
function eligible(
  sessions: readonly SessionRow[],
  startUs: bigint | null,
  taken: ReadonlySet<string>,
  cfg: ResolverConfig,
  assignee: string | null | undefined,
): { survivors: SessionRow[]; evaluated: EvaluatedCandidate[] } {
  const survivors: SessionRow[] = [];
  const evaluated: EvaluatedCandidate[] = [];

  for (const s of sessions) {
    const drop = (rejectionReason: RejectionReason) =>
      evaluated.push({
        collectionSessionId: s.id,
        strategy: 'eligibility',
        timeDeltaUs: null,
        survived: false,
        rejectionReason,
      });

    if (taken.has(s.id)) {
      drop('already_taken');
      continue;
    }
    /**
     * The device-assignment crosscheck. A session declared by somebody who was
     * not holding this device when the recording started cannot be the session
     * this recording belongs to: that instant was another collector's period.
     *
     * Both halves have to be known first. `typeof assignee === 'string'` is the
     * only case where the device's holder is established, and a candidate with
     * no collector supplied was never compared — neither is a drop.
     */
    if (typeof assignee === 'string' && typeof s.collectorId === 'string' && s.collectorId !== assignee) {
      drop('device_not_assigned_to_collector');
      continue;
    }
    if (
      cfg.eligibleClaimStatuses.length > 0 &&
      s.claimStatus !== undefined &&
      s.claimStatus !== null &&
      !cfg.eligibleClaimStatuses.includes(s.claimStatus)
    ) {
      drop('claim_status_ineligible');
      continue;
    }
    if (
      s.claimExpiresAt !== undefined &&
      s.claimExpiresAt !== null &&
      startUs !== null &&
      BigInt(s.claimExpiresAt.getTime()) * US_PER_MS < startUs
    ) {
      drop('claim_expired');
      continue;
    }
    survivors.push(s);
  }
  return { survivors, evaluated };
}

/** Signed, microseconds, as a decimal string. Null when either side is missing. */
function delta(startUs: bigint | null, s: SessionRow): string | null {
  if (startUs === null || s.prepareTime === null) return null;
  return String(startUs - BigInt(s.prepareTime.getTime()) * US_PER_MS);
}

/** A bare number still means the tolerance, so no existing call site changes. */
const normalise = (config: number | Partial<ResolverConfig>): ResolverConfig =>
  typeof config === 'number'
    ? { ...DEFAULT_RESOLVER_CONFIG, toleranceMs: config }
    : { ...DEFAULT_RESOLVER_CONFIG, ...config };

export function resolveEpisode(
  record: EpisodeRecord,
  sessions: readonly SessionRow[],
  config: number | Partial<ResolverConfig> = DEFAULT_RESOLVER_CONFIG,
  takenSessionIds: readonly string[] = [],
  /**
   * The device's assignment periods, read by the adapter. Omitted means the
   * crosscheck does not run at all, which is what every caller that does not
   * know about devices gets — see `assigneeAt`.
   */
  deviceAssignments?: readonly DeviceAssignment[],
): Resolution {
  const cfg = normalise(config);
  const start = pickStart(record, cfg);
  const startUs = start?.us ?? null;
  const assignee = assigneeAt(deviceAssignments, startUs);

  const { survivors, evaluated } = eligible(
    sessions,
    startUs,
    new Set(takenSessionIds),
    cfg,
    assignee,
  );

  /**
   * Closes over everything the caller cannot see, so that no branch below can
   * return a Resolution with an audit field missing.
   */
  const decide = (
    outcome: Pick<
      Resolution,
      'state' | 'sessionId' | 'method' | 'needsConfirmation' | 'proposedSessionId' | 'reason'
    >,
    strategy: ResolverStrategy,
  ): Resolution => ({
    ...outcome,
    evaluated: [
      ...evaluated,
      ...survivors.map((s) => ({
        collectionSessionId: s.id,
        strategy,
        timeDeltaUs: delta(startUs, s),
        survived: true,
        rejectionReason: null,
      })),
    ],
    candidateCount: survivors.length,
    configSnapshot: cfg,
    startSource: start?.source ?? null,
    startConfidence: start?.confidence ?? null,
    startFlag: start?.flag ?? null,
  });

  const quarantine = (
    reason: ResolutionReason,
    proposedSessionId: string | null,
    strategy: ResolverStrategy,
  ) =>
    decide(
      {
        state: 'quarantined',
        sessionId: null,
        method: null,
        needsConfirmation: false,
        proposedSessionId,
        reason,
      },
      strategy,
    );

  if (sessions.length === 0) {
    return quarantine('no_sessions', null, 'eligibility');
  }
  if (survivors.length === 0) {
    // Candidates arrived and every one was dropped. That is a different fact
    // from "no sessions on the handover", and the reasons are already in
    // `evaluated` for the operator to read.
    return quarantine('all_candidates_ineligible', null, 'eligibility');
  }
  if (assignee === null) {
    /**
     * The device has assignment periods and none of them covers this episode's
     * start. Nobody is on record as holding it then.
     *
     * Nothing is dropped for that: a gap in the assignment record is a gap in
     * what the back office typed, and inventing an ineligibility out of it is
     * the same class of mistake as inventing a match. The episode goes to the
     * human queue carrying the reason, and the operator either fills the gap in
     * `device_assignments` or resolves the episode by hand — both of which are
     * on the record afterwards, which a silent automatic match would not be.
     */
    return quarantine('device_assignment_unknown', null, 'eligibility');
  }

  if (survivors.length === 1) {
    // One declared task on the card, and the operator verified the card against
    // that task face to face (PRD §11.3.1 rule 1). Nothing to choose between.
    //
    // The console still shows the episode count against the session count before
    // batch close: one declared task holding seven episodes is not wrong, but it
    // is worth an operator's glance, because footage recorded outside the
    // declared task would otherwise be paid at the declared task's rate (SET-08).
    return decide(
      {
        state: 'resolved',
        sessionId: survivors[0]!.id,
        method: 'automatic_single',
        needsConfirmation: false,
        proposedSessionId: null,
        reason: 'single_session',
      },
      'single_session',
    );
  }

  const ordered = [...survivors].sort(
    (a, b) => (a.prepareTime?.getTime() ?? Infinity) - (b.prepareTime?.getTime() ?? Infinity),
  );
  const startMs = startUs === null ? null : Number(startUs) / 1000;
  const proposal = propose(ordered, startMs, cfg.toleranceMs);

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
    return quarantine(reason, proposal.sessionId, 'operator_confirmation');
  }

  if (startUs === null) {
    // Nothing positioned on any rung of pickStart, so there is nothing to match
    // against. Across the committed corpus this means no usable media at all.
    return quarantine('no_episode_start', null, 'time_window');
  }
  if (ordered.some((s) => s.prepareTime === null)) {
    return quarantine('session_missing_prepare_time', proposal.sessionId, 'time_window');
  }
  if (proposal.withinTolerance >= 2) {
    // Two sessions start close enough together that the episode could belong to
    // either. Guessing here is exactly what settlement cannot absorb.
    return quarantine('ambiguous_within_tolerance', proposal.sessionId, 'time_window');
  }
  if (proposal.sessionId === null) {
    return quarantine('episode_precedes_all_sessions', null, 'time_window');
  }
  return decide(
    {
      state: 'resolved',
      sessionId: proposal.sessionId,
      method: 'automatic_time_window',
      needsConfirmation: true,
      proposedSessionId: proposal.sessionId,
      reason: 'time_window',
    },
    'time_window',
  );
}

/**
 * The latest session that began at or before the episode, plus how many sessions
 * began close enough to the episode to be indistinguishable.
 *
 * This is NOT a tie-break. It never reduces a genuinely ambiguous set to one:
 * `withinTolerance >= 2` refuses above, and the single path that acts on this
 * ordering returns `needsConfirmation: true`, so a human endorses it before the
 * batch closes. Ordering a queue for an operator is a different act from
 * choosing who gets paid.
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
