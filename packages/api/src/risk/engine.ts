import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import type { PrnuEnrolmentSource } from '../../../../tools/analysers/prnu.ts';
import { EVALUATED_SIGNAL, bandsFrom, loadTuning, seedRiskSignals } from './catalogue.ts';
import { contentSignals, type MediaFacts } from './detectors/content.ts';
import { identChangedLate, identSignals } from './detectors/ident.ts';
import { approvalOutliers, concentration, reviewTooFast, selfDealing } from './detectors/ops.ts';
import { provenanceSignals } from './detectors/provenance.ts';
import { volumeSignals } from './detectors/volume.ts';
import { holdDecision, raiseHold } from './holds.ts';
import { measureEpisodeMedia, type MediaTools } from './media.ts';
import { byWeight, isFinding, rollup, summarise } from './scoring.ts';
import {
  auditOn,
  baselineFor,
  billFactsFor,
  cohortDayCounts,
  concentrationInputFor,
  duplicatePeersFor,
  episodeFactsFor,
  episodeSlicesOf,
  identInputFor,
  payoutAccountsOf,
  reviewFactFor,
  reviewerRatesIn,
  type Reader,
} from './sources.ts';
import { numParam, strListParam, type Bands, type Finding, type Flag, type RiskSummary, type SubjectType, type TuningMap } from './types.ts';

/**
 * The engine: load the tuning, load the facts, run the detectors, write one
 * run of flags, compose the summary, and — for a bill in the hold band with
 * holds switched on — raise a reversible hold.
 *
 * Every write happens in one transaction under `SET LOCAL ROLE playerone_risk`
 * (0014), so this process cannot write a bill, a settlement, a payout attempt
 * or a collector even by mistake: Postgres refuses, and a test proves it.
 * Reads happen before the transaction, because the media analysers take
 * seconds and a transaction that long would hold nothing useful. The price is
 * that two evaluations of one subject can read, read, write, write — so the
 * write refuses, under the subject's lock, when a run newer than the one it
 * read from has been committed meanwhile. The later commit never carries the
 * older facts; the caller gets `RiskBusy` and the worker counts it as skipped.
 *
 * Nothing here rejects, suspends or voids anything. The worst outcome of an
 * evaluation is a row in `risk_holds` that an operator with a reason removes.
 */

export type RiskEngineOptions = {
  /** Where the `ego_*` session folders are. Without it the media signals are not evaluated. */
  mediaRoot?: string;
  /** PLAYERONE_RISK_HOLD. Off by default: advisory only until the thresholds are tuned. */
  holdsEnabled?: boolean;
  /** The database role the evaluation transaction runs under. Null runs as the caller (tests of the role itself). */
  dbRole?: string | null;
  prnu?: PrnuEnrolmentSource;
  tools?: MediaTools;
  /** How far back the volume and operator signals look. */
  windowDays?: number;
  now?: () => Date;
};

export class RiskBusy extends Error {
  constructor(subjectType: SubjectType, subjectId: string, why: 'in_progress' | 'superseded' = 'in_progress') {
    super(
      why === 'in_progress'
        ? `another evaluation of ${subjectType} ${subjectId} is in progress`
        : `another evaluation of ${subjectType} ${subjectId} committed after this one read its facts; not written`,
    );
  }
}

export type Evaluation = RiskSummary & {
  runId: string;
  evaluatedAt: string;
  hold: { raised: boolean; reason: string; holdId: string | null } | null;
  /** Which analysers ran, or why one did not. */
  tools: Record<string, string>;
};

type Written = Flag & { id: string };

export class RiskEngine {
  private readonly db: Db;
  private readonly o: Required<Pick<RiskEngineOptions, 'holdsEnabled' | 'windowDays' | 'now'>> & RiskEngineOptions;

  constructor(db: Db, options: RiskEngineOptions = {}) {
    this.db = db;
    const role = options.dbRole === undefined ? 'playerone_risk' : options.dbRole;
    if (role !== null && !/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`unsafe role name ${role}`);
    this.o = { holdsEnabled: false, windowDays: 90, now: () => new Date(), ...options, dbRole: role };
  }

  get holdsEnabled(): boolean {
    return this.o.holdsEnabled;
  }

  /** The engine's clock. The routes clear holds on it too, so a clear is never dated before its raise. */
  clock(): Date {
    return this.o.now();
  }

  private async tuning(): Promise<{ tuning: TuningMap; bands: Bands }> {
    await seedRiskSignals(this.db);
    const tuning = await loadTuning(this.db);
    return { tuning, bands: bandsFrom(tuning) };
  }

  /**
   * The first thing every evaluation does. `SET LOCAL ROLE` needs the
   * connected user to be a member of the role; 0016 grants that to whoever
   * ran the migration, and any other application user needs it granted by
   * hand. Without it every evaluation would fail on the same `permission
   * denied to set role`, so it is said once, plainly, with the statement.
   */
  private roleChecked = false;
  private async assertRole(): Promise<void> {
    const role = this.o.dbRole;
    if (!role || this.roleChecked) return;
    const [r] = (await this.db.execute(
      sql`select current_user as who, coalesce((select pg_has_role(current_user, oid, 'member') from pg_roles where rolname = ${role}), false) as ok`,
    )) as unknown as { who: string; ok: boolean }[];
    if (!r?.ok) {
      throw new Error(
        `the risk engine runs its writes as role ${role}, and user ${r?.who} cannot become it. ` +
          `0014_risk.sql creates the role and 0016 grants it to the migrating user; for another user run: GRANT ${role} TO ${r?.who}`,
      );
    }
    this.roleChecked = true;
  }

  /** The seq of the subject's latest run, taken before the facts are read; the write refuses if it moves. */
  private async latestRun(subjectType: SubjectType, subjectId: string): Promise<number> {
    await this.assertRole();
    const rows = (await this.db.execute(
      sql`select coalesce(max(seq), 0)::bigint as seq from risk_flags where signal_id = ${EVALUATED_SIGNAL} and subject_type = ${subjectType} and subject_id = ${subjectId}`,
    )) as unknown as { seq: string | number }[];
    return Number(rows[0]?.seq ?? 0);
  }

  private window(): { from: Date; to: Date } {
    const to = this.o.now();
    return { from: new Date(to.getTime() - this.o.windowDays * 86_400_000), to };
  }

  // -------------------------------------------------------------------------

  async evaluateCollector(collectorId: string): Promise<Evaluation> {
    const since = await this.latestRun('collector', collectorId);
    const { tuning, bands } = await this.tuning();
    const { from, to } = this.window();
    const findings: Finding[] = [];
    const tools: Record<string, string> = {};

    const ident = await identInputFor(this.db, collectorId);
    if (ident === null) tools['payout_accounts'] = 'absent: identity signals not evaluated';
    else findings.push(...identSignals(ident, tuning));

    const p95 = tuning.get('VOL.ABOVE_COHORT_P95');
    const offset = p95 ? numParam(p95, 'utc_offset_minutes', 420) : 420;
    const episodes = await episodeSlicesOf(this.db, collectorId, from, to);
    const cohort = await cohortDayCounts(this.db, from, to, offset);
    findings.push(...volumeSignals({ collectorId, episodes, cohortDayCounts: cohort }, tuning));

    const conc = tuning.get('OPS.CONCENTRATION');
    if (conc?.enabled) {
      const input = await concentrationInputFor(this.db, collectorId, from, to, strListParam(conc, 'actions'));
      findings.push(...concentration(input, tuning));
    }

    return this.write('collector', collectorId, since, findings, tuning, bands, tools, null);
  }

  async evaluateEpisode(episodeId: string): Promise<Evaluation> {
    const since = await this.latestRun('episode', episodeId);
    const { tuning, bands } = await this.tuning();
    const findings: Finding[] = [];
    const ep = await episodeFactsFor(this.db, episodeId);
    if (ep === null) throw new Error(`no such episode ${episodeId}`);

    let media: MediaFacts | null = null;
    const tools: Record<string, string> = {};
    if (this.o.mediaRoot !== undefined) {
      media = await measureEpisodeMedia(ep, { mediaRoot: this.o.mediaRoot, prnu: this.o.prnu, tools: this.o.tools });
      if (media === null) tools['media'] = 'absent: session folder not under mediaRoot';
      else Object.assign(tools, media.tools);
    } else {
      tools['media'] = 'not configured: media signals not evaluated';
    }

    const delta = tuning.get('CONT.PTS_MANIFEST_DELTA');
    const baseline = await baselineFor(this.db, ep, {
      minEpisodes: delta ? numParam(delta, 'min_baseline_episodes', 5) : 5,
      fleetFallback: delta ? delta.params['fleet_fallback'] !== false : true,
    });
    const peers = await duplicatePeersFor(this.db, ep, { frames: media?.frames?.count ?? null });
    findings.push(...contentSignals(ep, peers, baseline, media, tuning));
    findings.push(...provenanceSignals(ep, media, tuning));

    const review = await reviewFactFor(this.db, episodeId);
    if (review !== null) findings.push(...reviewTooFast(review, tuning));

    return this.write('episode', episodeId, since, findings, tuning, bands, tools, null);
  }

  async evaluateBill(billId: string): Promise<Evaluation> {
    const since = await this.latestRun('bill', billId);
    const { tuning, bands } = await this.tuning();
    const bill = await billFactsFor(this.db, billId);
    if (bill === null) throw new Error(`no such bill ${billId}`);
    const findings: Finding[] = [];
    const tools: Record<string, string> = {};

    const accounts = await payoutAccountsOf(this.db, bill.collectorId);
    findings.push(...identChangedLate({ accounts, periodEnd: bill.periodEnd, now: this.o.now() }, tuning));

    const creates = await auditOn(this.db, 'collectors', bill.collectorId);
    const actions = await auditOn(this.db, 'bills', bill.billId);
    findings.push(...selfDealing({ collectorCreates: creates, billActions: actions }, tuning));

    // The roll-up (the collector's and the episodes' current flags) is read
    // inside write()'s transaction, after the advisory lock, so the hold
    // decision is on the flags committed at that moment and not on a snapshot
    // taken before another instance re-evaluated the collector.
    return this.write('bill', billId, since, findings, tuning, bands, tools, { billId, collectorId: bill.collectorId, episodeIds: bill.episodeIds });
  }

  async evaluateBatch(periodStart: Date, periodEnd: Date): Promise<Evaluation> {
    const id = batchId(periodStart, periodEnd);
    const since = await this.latestRun('batch', id);
    const { tuning, bands } = await this.tuning();
    const rates = await reviewerRatesIn(this.db, periodStart, periodEnd);
    const findings = approvalOutliers(rates, tuning);
    return this.write('batch', id, since, findings, tuning, bands, {}, null);
  }

  // -------------------------------------------------------------------------
  // Read side

  /** The current summary of a subject from stored flags. A bill rolls up its collector and episodes. */
  async summary(subjectType: SubjectType, subjectId: string): Promise<RiskSummary & { evaluatedAt: string | null }> {
    const { bands } = await this.tuning();
    const own = await currentFlags(this.db, subjectType, subjectId);
    const evaluatedAt = await lastEvaluatedAt(this.db, subjectType, subjectId);
    if (subjectType !== 'bill') return { ...summarise(subjectType, subjectId, own.map(strip), bands), evaluatedAt };
    const bill = await billFactsFor(this.db, subjectId);
    if (bill === null) return { ...summarise(subjectType, subjectId, own.map(strip), bands), evaluatedAt };
    const carried = await this.carriedFlags(this.db, bill.collectorId, bill.episodeIds);
    const flags = rollup([{ subjectType: 'bill', subjectId, flags: own.map(strip) }, ...carried]);
    return { ...summarise('bill', subjectId, flags, bands), evaluatedAt };
  }

  /**
   * What the payout side reads (`RiskReader.billSummary`). Its `band` answers
   * "must this payment wait", which is the hold chain's answer and not the
   * score's: 'hold' when a hold is open, or when the engine would raise one on
   * the signals showing now; otherwise the score band, capped at 'review',
   * because a score in the hold band whose hold an operator cleared is a bill
   * that person decided to pay. The flags and the score are the summary's.
   */
  async payoutSummary(billId: string): Promise<RiskSummary & { evaluatedAt: string | null }> {
    const s = await this.summary('bill', billId);
    const decision = await holdDecision(this.db, billId, s.flags.map((f) => f.signalId));
    if (decision === 'already_open') return { ...s, band: 'hold' };
    if (s.band !== 'hold') return s;
    return { ...s, band: decision === 'raise' ? 'hold' : 'review' };
  }

  private async carriedFlags(db: Reader, collectorId: string, episodeIds: readonly string[]) {
    const groups: { subjectType: SubjectType; subjectId: string; flags: Flag[] }[] = [
      { subjectType: 'collector', subjectId: collectorId, flags: (await currentFlags(db, 'collector', collectorId)).map(strip) },
    ];
    for (const id of episodeIds) {
      groups.push({ subjectType: 'episode', subjectId: id, flags: (await currentFlags(db, 'episode', id)).map(strip) });
    }
    return groups;
  }

  // -------------------------------------------------------------------------
  // The one write

  private async write(
    subjectType: SubjectType,
    subjectId: string,
    since: number,
    findings: readonly Finding[],
    tuning: TuningMap,
    bands: Bands,
    tools: Record<string, string>,
    bill: { billId: string; collectorId: string; episodeIds: readonly string[] } | null,
  ): Promise<Evaluation> {
    const now = this.o.now();
    const runId = randomUUID();
    const meta = tuning.get(EVALUATED_SIGNAL);
    if (meta === undefined) throw new Error('META.EVALUATED is missing from the catalogue');

    // One row per signal per run: a detector that fired twice is one finding with the heavier evidence first.
    const seen = new Set<string>();
    const toWrite: { signalId: string; evidence: Record<string, unknown> }[] = [];
    for (const f of findings) {
      const t = tuning.get(f.signalId);
      if (t === undefined || !t.enabled || seen.has(f.signalId)) continue;
      seen.add(f.signalId);
      toWrite.push(f);
    }
    const findingCount = toWrite.filter((f) => {
      const t = tuning.get(f.signalId)!;
      return isFinding({ signalId: f.signalId, points: t.points, severity: t.severity });
    }).length;
    toWrite.push({ signalId: EVALUATED_SIGNAL, evidence: { findings: findingCount, tools, holds_enabled: this.o.holdsEnabled } });

    return this.db.transaction(async (tx) => {
      if (this.o.dbRole) await tx.execute(sql.raw(`set local role ${this.o.dbRole}`));
      const [lock] = (await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtext(${`risk:${subjectType}:${subjectId}`})) as ok`,
      )) as unknown as { ok: boolean }[];
      if (!lock?.ok) throw new RiskBusy(subjectType, subjectId);
      // Under the lock: a run newer than the one the facts were read against
      // means those facts are older than the table, and this run must not win.
      const [newer] = (await tx.execute(
        sql`select 1 as x from risk_flags where signal_id = ${EVALUATED_SIGNAL} and subject_type = ${subjectType} and subject_id = ${subjectId} and seq > ${since} limit 1`,
      )) as unknown as { x: number }[];
      if (newer !== undefined) throw new RiskBusy(subjectType, subjectId, 'superseded');

      const written: Written[] = [];
      for (const f of toWrite) {
        const t = tuning.get(f.signalId)!;
        const [row] = (await tx.execute(
          sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence, computed_at)
               values (${runId}::uuid, ${subjectType}, ${subjectId}, ${f.signalId}, ${t.thresholdVersion}, ${t.points}, ${t.severity},
                       ${JSON.stringify(f.evidence)}::jsonb, ${now.toISOString()}::timestamptz)
               returning id`,
        )) as unknown as { id: string }[];
        written.push({
          id: row!.id,
          signalId: f.signalId,
          severity: t.severity,
          points: t.points,
          evidence: f.evidence,
          thresholdVersion: t.thresholdVersion,
          computedAt: now.toISOString(),
        });
      }

      const own = written.map(strip);
      let summary: RiskSummary;
      let hold: Evaluation['hold'] = null;
      if (bill === null) {
        summary = summarise(subjectType, subjectId, own, bands);
      } else {
        const carried = await this.carriedFlags(tx, bill.collectorId, bill.episodeIds);
        const flags = rollup([{ subjectType: 'bill', subjectId, flags: own }, ...carried]);
        summary = summarise('bill', subjectId, flags, bands);
        if (summary.band === 'hold') {
          if (!this.o.holdsEnabled) {
            hold = { raised: false, reason: 'holds_disabled', holdId: null };
          } else {
            // The heaviest flag carries the hold. If it is one of the bill's own it
            // was written just now; otherwise it is the current row of the carrier.
            const lead = [...summary.flags].sort(byWeight)[0]!;
            const leadId =
              written.find((w) => w.signalId === lead.signalId)?.id ??
              (await currentFlagId(tx, lead.evidence['subject'] as { subjectType: SubjectType; subjectId: string }, lead.signalId));
            if (leadId === null) hold = { raised: false, reason: 'lead_flag_not_found', holdId: null };
            else {
              const r = await raiseHold(tx, { billId: bill.billId, flagId: leadId, signalIds: summary.flags.map((f) => f.signalId), now });
              hold = { raised: r.reason === 'raised', reason: r.reason, holdId: r.hold?.id ?? null };
            }
          }
        }
      }
      return { ...summary, runId, evaluatedAt: now.toISOString(), hold, tools };
    });
  }
}

export const batchId = (periodStart: Date, periodEnd: Date): string => `${periodStart.toISOString()}/${periodEnd.toISOString()}`;

const strip = (w: Flag & { id?: string }): Flag => ({
  signalId: w.signalId,
  severity: w.severity,
  points: w.points,
  evidence: w.evidence,
  thresholdVersion: w.thresholdVersion,
  computedAt: w.computedAt,
});

type FlagRow = Flag & { id: string };

/** The subject's flags from its latest run, via the view the console reads. */
export async function currentFlags(db: Reader, subjectType: SubjectType, subjectId: string): Promise<FlagRow[]> {
  const rows = (await (db as Db).execute(
    sql`select id, signal_id, severity, points, evidence, threshold_version, computed_at
          from risk_current_flags where subject_type = ${subjectType} and subject_id = ${subjectId}
         order by points desc, signal_id asc`,
  )) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r['id']),
    signalId: String(r['signal_id']),
    severity: String(r['severity']) as Flag['severity'],
    points: Number(r['points']),
    evidence: (r['evidence'] ?? {}) as Record<string, unknown>,
    thresholdVersion: String(r['threshold_version']),
    computedAt: new Date(String(r['computed_at'])).toISOString(),
  }));
}

async function currentFlagId(db: Reader, subject: { subjectType: SubjectType; subjectId: string } | undefined, signalId: string): Promise<string | null> {
  if (subject === undefined) return null;
  const rows = (await (db as Db).execute(
    sql`select id from risk_current_flags where subject_type = ${subject.subjectType} and subject_id = ${subject.subjectId} and signal_id = ${signalId} limit 1`,
  )) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

export async function lastEvaluatedAt(db: Reader, subjectType: SubjectType, subjectId: string): Promise<string | null> {
  const rows = (await (db as Db).execute(
    sql`select max(computed_at) as at from risk_flags where signal_id = ${EVALUATED_SIGNAL} and subject_type = ${subjectType} and subject_id = ${subjectId}`,
  )) as unknown as { at: unknown }[];
  const at = rows[0]?.at;
  return at ? new Date(String(at)).toISOString() : null;
}
