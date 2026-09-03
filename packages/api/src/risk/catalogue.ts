import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';
import { mutate } from '../audit.ts';
import type { Actor } from '../actor.ts';
import type { Bands, Severity, Tuning, TuningMap } from './types.ts';

/**
 * The signal catalogue, version v1, and the only place its defaults are
 * written down in code.
 *
 * It is seeded into `risk_signals` by `seedRiskSignals`, which inserts a row
 * for any signal that has none and touches nothing else. The database is the
 * authority after that: a retune supersedes a row and inserts a new
 * `threshold_version` (see `retuneSignal`), and a later deploy of this file
 * cannot undo it, because the seed never overwrites. Points decide the
 * severity band of a single flag; the bands are the last three rows.
 *
 * The points were chosen so that one identity-sharing signal alone reaches
 * 'hold' — multi-accounting is the most common and most profitable abuse of a
 * paid collection programme, and it is one SQL query to detect — one content
 * or volume signal alone reaches at most 'review', and the device faults the
 * hardware checkout documents as normal for this firmware stay at 'info'.
 */

export const CATALOGUE_VERSION = 'v1';

export type CatalogueRow = {
  signalId: string;
  family: 'IDENT' | 'VOL' | 'CONT' | 'PROV' | 'OPS' | 'HIST' | 'BAND' | 'META';
  description: string;
  points: number;
  severity: Severity;
  params: Record<string, unknown>;
};

/** The one signal that is capped at the catalogue, the flags and the band function. */
export const SYNTHETIC_SIGNAL = 'PROV.SYNTHETIC_HEURISTIC';
/** Written once per evaluation run. Not a finding. */
export const EVALUATED_SIGNAL = 'META.EVALUATED';

const row = (
  signalId: string,
  family: CatalogueRow['family'],
  points: number,
  severity: Severity,
  description: string,
  params: Record<string, unknown> = {},
): CatalogueRow => ({ signalId, family, description, points, severity, params });

export const RISK_CATALOGUE: readonly CatalogueRow[] = [
  row(EVALUATED_SIGNAL, 'META', 0, 'info', 'Marks one evaluation run of a subject. Not a finding; carries the count of findings and the tools used.'),

  row('IDENT.NAME_MISMATCH', 'IDENT', 35, 'review', 'The name ZaloPay returned for the payout account differs from the name the collector declared.'),
  row('IDENT.PHONE_SHARED', 'IDENT', 60, 'hold', 'One wallet phone number is on the current payout account of two or more collectors.'),
  row('IDENT.ACCOUNT_SHARED', 'IDENT', 60, 'hold', 'One bank account (bank code and last four digits) is on the current payout account of two or more collectors.'),
  row('IDENT.MUID_SHARED', 'IDENT', 60, 'hold', 'One ZaloPay wallet id (m_u_id) is on the current payout account of two or more collectors.'),
  row('IDENT.ACCOUNT_CHANGED_LATE', 'IDENT', 20, 'notice', 'The payout account was changed within the final days of the billing period, or after it ended and before payment.', { window_days: 7 }),
  row('IDENT.UNVERIFIED_KYC', 'IDENT', 20, 'notice', 'ZaloPay answered -1103: the wallet holder has not completed identity verification.'),
  row('IDENT.KYC_LIMIT_REPEATED', 'IDENT', 35, 'review', 'ZaloPay answered -406 (receiving limit reached) more than twice for this collector, which can mean several people are being paid into one wallet.', { max_occurrences: 2 }),
  row('IDENT.WALLET_LOCKED', 'IDENT', 20, 'notice', 'ZaloPay answered -1011: the wallet is locked.'),

  row('VOL.HOURS_PER_DAY', 'VOL', 35, 'review', 'More than the daily maximum of measured recording was claimed in one calendar day (Asia/Ho_Chi_Minh).', { max_hours: 12, utc_offset_minutes: 420 }),
  row('VOL.ABOVE_COHORT_P95', 'VOL', 20, 'notice', 'Episodes recorded in one day exceed the 95th percentile of every collector-day in the window.', { min_cohort_days: 20, min_episodes: 3, utc_offset_minutes: 420 }),
  row('VOL.STEP_CHANGE', 'VOL', 20, 'notice', "Recorded minutes in one day exceed a multiple of this collector's own trailing median day.", { ratio: 2.5, trailing_days: 28, min_history_days: 5, min_minutes: 30, utc_offset_minutes: 420 }),
  row('VOL.NO_GAP', 'VOL', 35, 'review', "Two of this collector's episodes overlap in time, or start closer together than a person could move between recordings.", { min_gap_s: 0 }),
  row('VOL.NOCTURNAL', 'VOL', 15, 'notice', 'A large share of recorded minutes fall in night hours for a task type that is not a night job. Context, not an accusation.', { night_start_hour: 23, night_end_hour: 5, min_share: 0.5, min_minutes: 60, night_task_types: [], utc_offset_minutes: 420 }),

  row('CONT.MOOV_DAMAGED', 'CONT', 10, 'info', 'The MP4 container fails the moov gate (packages/api/scripts/moov.ts): no index, index behind the media, or boxes that do not tile the file.'),
  row('CONT.TIMING_TRUNCATED', 'CONT', 10, 'info', 'A timestamp sidecar stopped before its media did (corpus_check.py verdict PTS-TRUNCATED): an interrupted recording, often on a 4 KiB write boundary.'),
  row('CONT.TIMING_PACKET_DELTA', 'CONT', 25, 'notice', 'A timestamp sidecar has MORE rows than the media has packets (corpus_check.py verdict MEDIA-TRUNCATED): the container was cut or rewritten after its index.'),
  row('CONT.IMU_CLOCK_DRIFT', 'CONT', 10, 'info', 'IMU rows carry a clock nowhere near the session, or the ingest engine excluded the IMU stream for a clock fault.', { max_outlier_rows: 0 }),
  row('CONT.PTS_MANIFEST_DELTA', 'CONT', 20, 'notice', "The manifest-to-measured duration ratio deviates from this device's own baseline. The ~34% overstatement is the known defect and is normal; deviation from it is the finding.", { tolerance: 0.1, min_baseline_episodes: 5, fleet_fallback: true }),
  row('CONT.NEAR_DUPLICATE', 'CONT', 60, 'hold', 'The content is the same as, or near-identical to, another episode by this or another collector: same content fingerprint, a shared media file digest, or matching frame fingerprints.', { max_hamming_per_frame: 6, min_matching_frames: 20, min_match_share: 0.9 }),
  row('CONT.STATIC_SCENE', 'CONT', 35, 'review', 'The picture barely changes across the episode: low motion energy between consecutive sampled frames. Not judged on a dark picture, which CONT.LOW_LUMA_VARIANCE covers.', { max_motion_energy: 2.0, min_frames: 20, min_mean_luma: 24 }),
  row('CONT.LOW_LUMA_VARIANCE', 'CONT', 20, 'notice', 'Most sampled frames are dark or flat: the lens was covered or the recording was made in the dark.', { max_mean_luma: 24, max_flat_std: 2.0, min_share: 0.8, min_frames: 10 }),
  row('CONT.AUDIO_ABSENT', 'CONT', 15, 'notice', 'No audio stream, an empty one, or silence where the task expects sound.', { silent_tasks: [], max_mean_volume_db: -60 }),
  row('CONT.FINGERPRINT', 'CONT', 0, 'info', 'Frame fingerprint recorded for later duplicate checks. A record, not a finding.'),
  row('CONT.REDELIVERY_CHURN', 'CONT', 20, 'notice', 'One episode was delivered more times than the threshold, and its bytes changed between deliveries. An interrupted upload retried is normal once; a pattern of it is not.', { max_deliveries: 2 }),
  row('CONT.MEDIA_SUBSTITUTED', 'CONT', 45, 'review', 'A redelivery replaced the bytes of a media file that had already arrived whole, or measured longer than the delivery it superseded. A dropped link loses bytes; it does not add or exchange them.', { media_suffixes: ['.mp4', '.wav'], min_growth_s: 1 }),

  row('PROV.PRNU_MISMATCH', 'PROV', 60, 'hold', 'Sensor pattern noise of the footage does not correlate with the fingerprint enrolled for the assigned unit. Evaluated only when an enrolment exists.', { min_correlation: 0.2, min_frames: 30 }),
  row('PROV.IMU_VIDEO_DECORR', 'PROV', 35, 'review', 'Motion seen in the picture does not follow the motion the IMU recorded.', { min_correlation: 0.1, min_seconds: 10 }),
  row('PROV.ENCODER_MISMATCH', 'PROV', 45, 'review', 'Container layout, codec or encoder tag differ from the profile recorded for the device firmware.', {
    // From docs/hardware-checkout.md test 19: fragmented MP4, moov second after
    // ftyp on all ten corpus files. The encoder tag and GOP were not recorded
    // there, so they are null (unchecked) until somebody measures them.
    profiles: { '1.0.3': { box_order: ['ftyp', 'moov'], fragmented: true, codec: 'h264', encoder_tag: null, gop: null } },
  }),
  row('PROV.SCREEN_RECAPTURE', 'PROV', 60, 'hold', 'The footage looks like a screen filmed by a camera: a persistent rectangular boundary, a fine periodic grid, or refresh flicker.', { min_border_share: 0.9, min_grid_energy: 0.3, min_flicker: 0.04, min_frames: 10 }),
  row(SYNTHETIC_SIGNAL, 'PROV', 15, 'notice', 'Weak cues that the footage was not produced by a camera sensor: no noise floor. Capped at notice and never the sole cause of a hold.', { max_noise_floor: 0.75, min_frames: 10 }),
  row('PROV.STALE_RECORDING', 'PROV', 35, 'review', 'The recording’s own clock puts it long before the day it was first delivered: old footage submitted as new work. Reads the device clock, so a device set back reads as fresh.', { max_age_days: 30 }),

  row('HIST.REPEAT_CONTENT_FINDINGS', 'HIST', 35, 'review', "Several of this collector's own past episodes carry a content or provenance finding. One bad recording is a mistake; a pattern is the finding.", { max_episodes: 2, families: ['CONT', 'PROV'] }),
  row('HIST.PRIOR_ACCEPTED_HOLDS', 'HIST', 20, 'notice', "An operator has already held a bill of this collector's and decided to pay anyway more than once. Carries that judgement forward; it does not repeat it.", { max_accepted: 1 }),

  row('OPS.REVIEW_TOO_FAST', 'OPS', 20, 'notice', 'A pass or partial verdict was recorded in less time than the episode runs.', { min_ratio: 1.0 }),
  row('OPS.APPROVAL_OUTLIER', 'OPS', 20, 'notice', "A reviewer's approval rate is far from the other reviewers' in the same period.", { min_decided: 20, max_delta: 0.25, min_reviewers: 3 }),
  row('OPS.SELF_DEALING', 'OPS', 45, 'review', 'The operator who paid or generated this bill is the operator who created the collector.', { create_actions: ['collector.create'], pay_actions: ['bill.pay', 'bill.generate', 'payout.pay', 'payout.mark_paid', 'payout.attempt'] }),
  row('OPS.CONCENTRATION', 'OPS', 20, 'notice', "One operator handled a disproportionate share of this collector's bills while other operators were paying bills too.", { max_share: 0.8, min_events: 4, min_operators: 2, actions: ['bill.pay', 'bill.generate', 'payout.pay', 'payout.mark_paid', 'payout.attempt', 'risk.hold_clear'] }),

  row('BAND.NOTICE', 'BAND', 15, 'notice', 'Lower edge of the notice band. Below it a subject is clear.'),
  row('BAND.REVIEW', 'BAND', 35, 'review', 'Lower edge of the review band.'),
  row('BAND.HOLD', 'BAND', 60, 'hold', 'Lower edge of the hold band. A bill in it is held, reversibly, when PLAYERONE_RISK_HOLD=1.'),
];

export const SIGNAL_IDS: readonly string[] = RISK_CATALOGUE.map((r) => r.signalId);

/**
 * Inserts any signal that has no row at all. Idempotent and never an update:
 * a signal that has been retuned in the database keeps its retune, and a
 * signal whose v1 row was superseded is left alone because the primary key
 * (signal_id, threshold_version) already holds it.
 */
export async function seedRiskSignals(db: Db): Promise<void> {
  await db
    .insert(schema.riskSignals)
    .values(
      RISK_CATALOGUE.map((r) => ({
        signalId: r.signalId,
        thresholdVersion: CATALOGUE_VERSION,
        family: r.family,
        description: r.description,
        defaultPoints: r.points,
        defaultSeverity: r.severity,
        enabled: true,
        params: r.params,
      })),
    )
    .onConflictDoNothing();
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select'> | Pick<Tx, 'select'>;

/** The current row of every signal, keyed by id. */
export async function loadTuning(db: Reader): Promise<TuningMap> {
  const rows = await (db as Db)
    .select()
    .from(schema.riskSignals)
    .where(isNull(schema.riskSignals.supersededAt));
  const map = new Map<string, Tuning>();
  for (const r of rows) {
    map.set(r.signalId, {
      signalId: r.signalId,
      family: r.family,
      description: r.description,
      points: r.defaultPoints,
      severity: r.defaultSeverity as Severity,
      enabled: r.enabled,
      thresholdVersion: r.thresholdVersion,
      params: (r.params ?? {}) as Record<string, unknown>,
    });
  }
  return map;
}

/**
 * The three band edges, from the BAND.* rows. Refuses a non-monotonic set
 * rather than scoring with one: a review edge below the notice edge would
 * make every band assignment wrong while every row stayed individually valid.
 */
export function bandsFrom(tuning: TuningMap): Bands {
  const edge = (id: string): number => {
    const t = tuning.get(id);
    if (t === undefined) throw new Error(`risk catalogue has no ${id} row; run seedRiskSignals`);
    return t.points;
  };
  const bands = { notice: edge('BAND.NOTICE'), review: edge('BAND.REVIEW'), hold: edge('BAND.HOLD') };
  if (!(bands.notice > 0 && bands.notice < bands.review && bands.review < bands.hold && bands.hold <= 100)) {
    throw new Error(
      `risk bands are not ordered: notice ${bands.notice}, review ${bands.review}, hold ${bands.hold}`,
    );
  }
  return bands;
}

export type Retune = {
  signalId: string;
  /** The new version string. Must differ from the current one; the primary key says so. */
  thresholdVersion: string;
  points?: number;
  severity?: Severity;
  enabled?: boolean;
  params?: Record<string, unknown>;
  description?: string;
  /** Why. Recorded on the audit row; a retune without one is refused. */
  reason: string;
};

/**
 * Retunes one signal by superseding its current row and inserting the next.
 *
 * Both writes and the audit row are one transaction through `mutate`, so the
 * trail answers "who changed the hold threshold, when, from what to what, and
 * why" from `audit_events` alone. The superseded row stays: every flag that
 * cited it still resolves. `risk_signals_supersede_only` refuses any other
 * kind of UPDATE, so this function is the only way a value here changes.
 */
export async function retuneSignal(db: Db, actor: Actor, change: Retune): Promise<Tuning> {
  if (change.reason.trim().length < 10) throw new Error('a retune needs a reason of at least ten characters');
  const result = await mutate(
    db,
    actor,
    (next: Tuning & { before: Record<string, unknown> }) => ({
      action: 'risk.retune',
      targetTable: 'risk_signals',
      targetId: change.signalId,
      before: next.before,
      after: {
        threshold_version: next.thresholdVersion,
        points: next.points,
        severity: next.severity,
        enabled: next.enabled,
        params: next.params,
      },
      reason: change.reason,
    }),
    async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.riskSignals)
        .where(
          and(eq(schema.riskSignals.signalId, change.signalId), isNull(schema.riskSignals.supersededAt)),
        )
        .for('update');
      if (current === undefined) throw new Error(`no current tuning row for ${change.signalId}`);
      const now = new Date();
      await tx
        .update(schema.riskSignals)
        .set({ supersededAt: now })
        .where(
          and(
            eq(schema.riskSignals.signalId, current.signalId),
            eq(schema.riskSignals.thresholdVersion, current.thresholdVersion),
          ),
        );
      const next = {
        signalId: current.signalId,
        thresholdVersion: change.thresholdVersion,
        family: current.family,
        description: change.description ?? current.description,
        defaultPoints: change.points ?? current.defaultPoints,
        defaultSeverity: change.severity ?? (current.defaultSeverity as Severity),
        enabled: change.enabled ?? current.enabled,
        params: change.params ?? ((current.params ?? {}) as Record<string, unknown>),
        createdAt: now,
      };
      await tx.insert(schema.riskSignals).values(next);
      return {
        signalId: next.signalId,
        family: next.family,
        description: next.description,
        points: next.defaultPoints,
        severity: next.defaultSeverity,
        enabled: next.enabled,
        thresholdVersion: next.thresholdVersion,
        params: next.params,
        before: {
          threshold_version: current.thresholdVersion,
          points: current.defaultPoints,
          severity: current.defaultSeverity,
          enabled: current.enabled,
          params: current.params,
        },
      };
    },
  );
  if (result === undefined) throw new Error('retune wrote nothing');
  const { before: _before, ...tuning } = result;
  return tuning;
}

/** Every version a signal has ever had, newest first. What an audit reads. */
export async function tuningHistory(db: Db, signalId: string) {
  return db
    .select()
    .from(schema.riskSignals)
    .where(eq(schema.riskSignals.signalId, signalId))
    .orderBy(sql`${schema.riskSignals.createdAt} desc`);
}
