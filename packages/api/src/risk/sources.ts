import { sql } from 'drizzle-orm';
import { EpisodeRecord as EpisodeRecordSchema, type EpisodeRecord } from '@playerone/contracts';
import type { Db } from '@playerone/store';
import type { IdentInput, PayoutAccount, Peer } from './detectors/ident.ts';
import type { Baseline, DuplicatePeer, EpisodeFacts } from './detectors/content.ts';
import type { DeliveryFacts } from './detectors/delivery.ts';
import type { HistoryInput } from './detectors/history.ts';
import type { AuditFact, ReviewFact, ReviewerRate } from './detectors/ops.ts';
import type { EpisodeSlice } from './detectors/volume.ts';

/**
 * Every read the engine makes, in one file, so "what does the risk engine
 * look at" is answerable by reading it top to bottom. All of it is SELECT;
 * the engine's role has nothing else on these tables.
 *
 * Agent B's `payout_accounts` and `payout_events` are read by the column
 * names in the brief's §2.1 contract and through raw SQL rather than the
 * drizzle schema, because they are B's tables and this branch does not own
 * their declaration. Both are optional: without them the identity signals
 * are not evaluated, and nothing here throws for their absence.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Reader = Pick<Db, 'execute'> | Pick<Tx, 'execute'>;
type Row = Record<string, unknown>;

const rows = async (db: Reader, q: ReturnType<typeof sql>): Promise<Row[]> =>
  (await (db as Db).execute(q)) as unknown as Row[];

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export async function tableExists(db: Reader, name: string): Promise<boolean> {
  const [r] = await rows(db, sql`select to_regclass(${'public.' + name}) as t`);
  return r?.['t'] !== null && r?.['t'] !== undefined;
}

// ---------------------------------------------------------------------------
// Identity

function account(r: Row): PayoutAccount {
  return {
    id: String(r['id']),
    collectorId: String(r['collector_id']),
    method: String(r['method']) as PayoutAccount['method'],
    phone: str(r['phone']),
    bankCode: str(r['bank_code']),
    accountNoLast4: str(r['account_no_last4']),
    declaredName: String(r['declared_name'] ?? ''),
    verifiedName: str(r['verified_name']),
    mUId: str(r['m_u_id']),
    verifyStatus: String(r['verify_status'] ?? 'unverified'),
    verifiedAt: date(r['verified_at']),
    isCurrent: Boolean(r['is_current']),
    createdAt: date(r['created_at']) ?? new Date(0),
  };
}

export async function payoutAccountsOf(db: Reader, collectorId: string): Promise<PayoutAccount[]> {
  if (!(await tableExists(db, 'payout_accounts'))) return [];
  const r = await rows(
    db,
    sql`select id, collector_id, method, phone, bank_code, account_no_last4, declared_name, verified_name,
               m_u_id, verify_status, verified_at, is_current, created_at
          from payout_accounts where collector_id = ${collectorId}::uuid
         order by created_at asc, id asc`,
  );
  return r.map(account);
}

/** Collector-level identity input. Null when B's table is not there yet. */
export async function identInputFor(db: Reader, collectorId: string): Promise<IdentInput | null> {
  if (!(await tableExists(db, 'payout_accounts'))) return null;
  const accounts = await payoutAccountsOf(db, collectorId);
  const current = accounts.find((a) => a.isCurrent) ?? null;
  const peer = (r: Row): Peer => ({ collectorId: String(r['collector_id']), collectorRef: String(r['external_ref']) });
  const peersBy = async (where: ReturnType<typeof sql>): Promise<Peer[]> =>
    (
      await rows(
        db,
        sql`select p.collector_id, c.external_ref
              from payout_accounts p join collectors c on c.id = p.collector_id
             where p.is_current and p.collector_id <> ${collectorId}::uuid and ${where}
             order by c.external_ref`,
      )
    ).map(peer);
  const peers = {
    phone: current?.phone ? await peersBy(sql`p.phone = ${current.phone}`) : [],
    bank:
      current?.bankCode && current.accountNoLast4
        ? await peersBy(sql`p.bank_code = ${current.bankCode} and p.account_no_last4 = ${current.accountNoLast4}`)
        : [],
    muid: current?.mUId ? await peersBy(sql`p.m_u_id = ${current.mUId}`) : [],
  };
  let kyc = accounts.filter((a) => a.verifyStatus === 'kyc_limit').length;
  if (await tableExists(db, 'payout_events')) {
    // Agent B's table (0012, packages/api/src/payout/domain/events.ts): a
    // `kind` per event and an `evidence` jsonb. -406 is 'IDENT.KYC_LIMIT';
    // the sub code is also read from the evidence in case a kind is renamed.
    const [r] = await rows(
      db,
      sql`select count(*)::int as n from payout_events
           where collector_id = ${collectorId}::uuid
             and (kind = 'IDENT.KYC_LIMIT' or evidence->>'sub_return_code' = '-406')`,
    );
    kyc += Number(r?.['n'] ?? 0);
  }
  return { collectorId, accounts, peers, kycLimitOccurrences: kyc };
}

// ---------------------------------------------------------------------------
// Volume

const START_US = sql`(i.record_json->'timing'->>'usable_start_us')::numeric`;
const END_US = sql`(i.record_json->'timing'->>'usable_end_us')::numeric`;

export async function episodeSlicesOf(db: Reader, collectorId: string, from: Date, to: Date): Promise<EpisodeSlice[]> {
  const fromUs = BigInt(from.getTime()) * 1000n;
  const toUs = BigInt(to.getTime()) * 1000n;
  const r = await rows(
    db,
    sql`select e.episode_id, e.device_serial, i.measured_duration_s, ${START_US} as start_us, ${END_US} as end_us, t.type as task_type
          from episodes e
          join episode_ingests i on i.ingest_id = e.latest_ingest_id
          join collection_sessions s on s.id = e.collection_session_id
          left join tasks t on t.id = s.task_id
         where s.collector_id = ${collectorId}::uuid
           and e.resolution_state = 'resolved'
           and ${START_US} is not null and ${END_US} is not null
           and ${START_US} >= ${fromUs.toString()}::numeric and ${START_US} < ${toUs.toString()}::numeric
         order by ${START_US} asc, e.episode_id asc`,
  );
  return r.map((x) => ({
    episodeId: String(x['episode_id']),
    startMs: Number(BigInt(String(x['start_us']).split('.')[0]!) / 1000n),
    endMs: Number(BigInt(String(x['end_us']).split('.')[0]!) / 1000n),
    measuredS: Number(x['measured_duration_s']),
    deviceSerial: String(x['device_serial']),
    taskType: str(x['task_type']),
  }));
}

/** Episodes per (collector, local day) for every collector in the window. */
export async function cohortDayCounts(db: Reader, from: Date, to: Date, utcOffsetMinutes: number): Promise<number[]> {
  const fromUs = BigInt(from.getTime()) * 1000n;
  const toUs = BigInt(to.getTime()) * 1000n;
  const r = await rows(
    db,
    sql`select count(*)::int as n
          from episodes e
          join episode_ingests i on i.ingest_id = e.latest_ingest_id
          join collection_sessions s on s.id = e.collection_session_id
         where e.resolution_state = 'resolved'
           and ${START_US} is not null
           and ${START_US} >= ${fromUs.toString()}::numeric and ${START_US} < ${toUs.toString()}::numeric
         group by s.collector_id, floor((${START_US} / 1000000 + ${utcOffsetMinutes} * 60) / 86400)`,
  );
  return r.map((x) => Number(x['n']));
}

// ---------------------------------------------------------------------------
// Content

export type EpisodeSource = EpisodeFacts & {
  ingestId: string;
  sourceBasename: string;
  record: EpisodeRecord | null;
};

export async function episodeFactsFor(db: Reader, episodeId: string): Promise<EpisodeSource | null> {
  const [r] = await rows(
    db,
    sql`select e.episode_id, e.device_serial, s.collector_id, c.external_ref, i.ingest_id, i.source_basename,
               i.declared_duration_s, i.measured_duration_s, i.device_firmware, i.content_fingerprint, i.record_json, t.type as task_type
          from episodes e
          join episode_ingests i on i.ingest_id = e.latest_ingest_id
          left join collection_sessions s on s.id = e.collection_session_id
          left join collectors c on c.id = s.collector_id
          left join tasks t on t.id = s.task_id
         where e.episode_id = ${episodeId}::uuid`,
  );
  if (r === undefined) return null;
  const streams = await rows(
    db,
    sql`select stream_name, sample_count, excluded, exclusion_reason from episode_streams where ingest_id = ${String(r['ingest_id'])}::uuid`,
  );
  const audio = streams.find((s) => String(s['stream_name']) === 'audio');
  const imuFault = streams.find((s) => String(s['stream_name']).startsWith('imu') && Boolean(s['excluded']));
  let record: EpisodeRecord | null = null;
  const parsed = EpisodeRecordSchema.safeParse(r['record_json']);
  if (parsed.success) record = parsed.data;
  return {
    episodeId: String(r['episode_id']),
    collectorId: str(r['collector_id']) ?? '',
    collectorRef: str(r['external_ref']) ?? '(unattributed)',
    deviceSerial: String(r['device_serial']),
    firmware: str(r['device_firmware']),
    taskType: str(r['task_type']),
    declaredS: num(r['declared_duration_s']),
    measuredS: Number(r['measured_duration_s']),
    contentFingerprint: String(r['content_fingerprint']),
    hasAudioStream: audio !== undefined,
    audioSampleCount: audio ? Number(audio['sample_count']) : 0,
    imuClockFault: imuFault ? (str(imuFault['exclusion_reason']) ?? 'excluded') : null,
    ingestId: String(r['ingest_id']),
    sourceBasename: String(r['source_basename']),
    record,
  };
}

/**
 * Peers are searched across EVERY delivery of every other episode, not only
 * each episode's latest one.
 *
 * The narrower version missed the cheapest replay there is. A collector
 * delivers footage, then redelivers the same episode with different bytes; the
 * first delivery stops being `latest_ingest_id` and its fingerprint and its
 * file digests leave the search. Anyone — the same collector under a second
 * account, or another collector handed the folder — can then submit those
 * exact bytes and match nothing. Searching `episode_ingests` instead costs one
 * more join and closes it. The episode is still reported once, by id.
 */
export async function duplicatePeersFor(
  db: Reader,
  ep: Pick<EpisodeSource, 'episodeId' | 'ingestId' | 'contentFingerprint'>,
  o: { frames?: number | null } = {},
): Promise<DuplicatePeer[]> {
  const out: DuplicatePeer[] = [];
  const same = await rows(
    db,
    sql`select distinct e.episode_id, coalesce(c.external_ref, '(unattributed)') as external_ref
          from episode_ingests i
          join episodes e on e.episode_id = i.episode_id
          left join collection_sessions s on s.id = e.collection_session_id
          left join collectors c on c.id = s.collector_id
         where i.content_fingerprint = ${ep.contentFingerprint} and e.episode_id <> ${ep.episodeId}::uuid
         order by e.episode_id`,
  );
  for (const r of same) out.push({ episodeId: String(r['episode_id']), collectorRef: String(r['external_ref']), method: 'content_fingerprint' });

  const shared = await rows(
    db,
    sql`select distinct e2.episode_id, coalesce(c.external_ref, '(unattributed)') as external_ref, f2.relative_path
          from episode_files f1
          join episode_files f2 on f2.sha256 = f1.sha256 and f2.ingest_id <> f1.ingest_id
          join episode_ingests i2 on i2.ingest_id = f2.ingest_id
          join episodes e2 on e2.episode_id = i2.episode_id
          left join collection_sessions s on s.id = e2.collection_session_id
          left join collectors c on c.id = s.collector_id
         where f1.ingest_id = ${ep.ingestId}::uuid
           and e2.episode_id <> ${ep.episodeId}::uuid
           and (f1.relative_path ilike '%.mp4' or f1.relative_path ilike '%.wav')
           and f1.size_bytes > 4096
         order by e2.episode_id, f2.relative_path`,
  );
  for (const r of shared) {
    out.push({ episodeId: String(r['episode_id']), collectorRef: String(r['external_ref']), method: 'file_digest', file: String(r['relative_path']) });
  }

  if (o.frames !== null && o.frames !== undefined && o.frames > 0) {
    const lo = Math.floor(o.frames * 0.8);
    const hi = Math.ceil(o.frames * 1.2);
    const fps = await rows(
      db,
      sql`select f.subject_id, f.evidence->>'ahash' as ahash, coalesce(c.external_ref, '(unattributed)') as external_ref
            from risk_current_flags f
            left join episodes e on e.episode_id::text = f.subject_id
            left join collection_sessions s on s.id = e.collection_session_id
            left join collectors c on c.id = s.collector_id
           where f.subject_type = 'episode' and f.signal_id = 'CONT.FINGERPRINT'
             and f.subject_id <> ${ep.episodeId}
             and (f.evidence->>'frames')::int between ${lo} and ${hi}
           order by f.subject_id`,
    );
    for (const r of fps) {
      const seq = String(r['ahash'] ?? '');
      const ahash: string[] = [];
      for (let i = 0; i + 16 <= seq.length; i += 16) ahash.push(seq.slice(i, i + 16));
      out.push({ episodeId: String(r['subject_id']), collectorRef: String(r['external_ref']), method: 'frame_fingerprint', ahash });
    }
  }
  return out;
}

/**
 * Every delivery of one episode, and what the latest one changed.
 *
 * `episode_ingests` already holds one row per delivery whose bytes differed
 * (an identical redelivery touches `last_seen_at` and writes nothing), and
 * `episode_defects` holds the CHECKSUM-MISMATCH payload naming each file that
 * changed, was added or was removed. Nothing new is recorded to answer this;
 * it was all written at store time and never read until now.
 */
export async function deliveryFactsFor(db: Reader, episodeId: string): Promise<DeliveryFacts | null> {
  const r = await rows(
    db,
    sql`select i.ingest_id, i.ingested_at, i.measured_duration_s,
               (i.record_json->'timing'->>'usable_start_us')::numeric as start_us,
               (select d.payload from episode_defects d
                 where d.ingest_id = i.ingest_id and d.code = 'CHECKSUM-MISMATCH' limit 1) as mismatch
          from episode_ingests i
         where i.episode_id = ${episodeId}::uuid
         order by i.ingested_at asc, i.ingest_id asc`,
  );
  if (r.length === 0) return null;
  const measuredBy = new Map(r.map((x) => [String(x['ingest_id']), Number(x['measured_duration_s'])]));
  const last = r[r.length - 1]!;
  const payload = last['mismatch'] as
    | { prior_ingest_id?: string; changed?: { relative_path: string }[]; added?: { relative_path: string }[]; removed?: { relative_path: string }[] }
    | null;
  const names = (xs: { relative_path: string }[] | undefined): string[] => (xs ?? []).map((x) => x.relative_path);
  const priorId = payload?.prior_ingest_id ?? '';
  const startUs = last['start_us'];
  return {
    episodeId,
    deliveries: r.length,
    mismatchDeliveries: r.filter((x) => x['mismatch'] !== null && x['mismatch'] !== undefined).length,
    firstDeliveredAt: date(r[0]!['ingested_at']),
    lastDeliveredAt: date(last['ingested_at']),
    latest:
      payload === null || payload === undefined
        ? null
        : {
            priorIngestId: priorId,
            changed: names(payload.changed),
            added: names(payload.added),
            removed: names(payload.removed),
            measuredS: Number(last['measured_duration_s']),
            priorMeasuredS: measuredBy.get(priorId) ?? null,
          },
    // usable_start_us is the recording's own wall clock in microseconds, the
    // same field the volume signals slice days on. It comes from the device,
    // so a device whose clock is wrong reads wrong here too, and the signal
    // that uses it says so.
    recordedAtMs:
      startUs === null || startUs === undefined ? null : Number(BigInt(String(startUs).split('.')[0]!) / 1000n),
  };
}

/**
 * A collector's own past, as the engine itself recorded it: the findings on
 * their episodes, and the holds an operator already ruled on.
 *
 * Both reads are of `risk_current_flags` and `risk_holds` — this engine's
 * output — and never of a private tally. That is the point. The history a
 * score is built from is the history a person can open, flag by flag, with the
 * evidence that produced each one.
 *
 * It follows that a collector whose episodes have not been evaluated yet has
 * no history, and reads clear. The worker converges over passes; a first pass
 * that evaluates a collector before their episodes is not wrong, only early.
 */
export async function historyFor(db: Reader, collectorId: string, from: Date, to: Date): Promise<HistoryInput> {
  const [n] = await rows(
    db,
    sql`select count(distinct f.subject_id)::int as n
          from risk_flags f
          join episodes e on e.episode_id::text = f.subject_id
          join collection_sessions s on s.id = e.collection_session_id
         where f.signal_id = 'META.EVALUATED' and f.subject_type = 'episode'
           and s.collector_id = ${collectorId}::uuid`,
  );
  const findings = await rows(
    db,
    sql`select f.subject_id, f.signal_id, g.family
          from risk_current_flags f
          join risk_signals g on g.signal_id = f.signal_id and g.threshold_version = f.threshold_version
          join episodes e on e.episode_id::text = f.subject_id
          join collection_sessions s on s.id = e.collection_session_id
         where f.subject_type = 'episode' and s.collector_id = ${collectorId}::uuid
           and f.severity in ('review', 'hold')
         order by f.subject_id, f.signal_id`,
  );
  const clears = await rows(
    db,
    sql`select h.clear_verdict, h.cleared_at, h.signal_ids
          from risk_holds h
          join bills b on b.id = h.bill_id
         where b.collector_id = ${collectorId}::uuid and h.cleared_at is not null
           and h.cleared_at >= ${from.toISOString()}::timestamptz and h.cleared_at < ${to.toISOString()}::timestamptz
         order by h.cleared_at asc`,
  );
  return {
    collectorId,
    episodesEvaluated: Number(n?.['n'] ?? 0),
    findings: findings.map((x) => ({
      episodeId: String(x['subject_id']),
      signalId: String(x['signal_id']),
      family: String(x['family']),
    })),
    clears: clears.map((x) => ({
      verdict: String(x['clear_verdict']),
      clearedAt: date(x['cleared_at'])!,
      signalIds: (x['signal_ids'] as string[]) ?? [],
    })),
  };
}

export async function baselineFor(
  db: Reader,
  ep: Pick<EpisodeSource, 'episodeId' | 'deviceSerial'>,
  o: { minEpisodes: number; fleetFallback: boolean },
): Promise<Baseline> {
  const query = (serial: string | null) =>
    rows(
      db,
      sql`select percentile_cont(0.5) within group (order by i.declared_duration_s / i.measured_duration_s) as ratio, count(*)::int as n
            from episodes e join episode_ingests i on i.ingest_id = e.latest_ingest_id
           where e.episode_id <> ${ep.episodeId}::uuid
             and i.declared_duration_s > 0 and i.measured_duration_s > 0
             ${serial === null ? sql`` : sql`and e.device_serial = ${serial}`}`,
    );
  const [device] = await query(ep.deviceSerial);
  const n = Number(device?.['n'] ?? 0);
  if (n >= o.minEpisodes) return { ratio: Number(device!['ratio']), episodes: n, source: 'device' };
  if (o.fleetFallback) {
    const [fleet] = await query(null);
    const fn = Number(fleet?.['n'] ?? 0);
    if (fn >= o.minEpisodes) return { ratio: Number(fleet!['ratio']), episodes: fn, source: 'fleet' };
  }
  return { ratio: null, episodes: n, source: 'none' };
}

// ---------------------------------------------------------------------------
// Reviewers and operators

export async function reviewFactFor(db: Reader, episodeId: string): Promise<ReviewFact | null> {
  const [r] = await rows(
    db,
    sql`select r.reviewer_ref, o.external_ref, r.review_state, r.time_to_verdict_s, r.measured_duration_s
          from episode_reviews r left join operators o on o.id = r.reviewer_ref
         where r.episode_id = ${episodeId}::uuid and r.review_state <> 'pending'
         order by r.reviewed_at desc nulls last limit 1`,
  );
  if (r === undefined) return null;
  return {
    episodeId,
    reviewerId: str(r['reviewer_ref']),
    reviewerRef: str(r['external_ref']),
    state: String(r['review_state']) as ReviewFact['state'],
    timeToVerdictS: num(r['time_to_verdict_s']),
    measuredS: Number(r['measured_duration_s']),
  };
}

export async function reviewerRatesIn(db: Reader, from: Date, to: Date): Promise<ReviewerRate[]> {
  const r = await rows(
    db,
    sql`select r.reviewer_ref, coalesce(o.external_ref, r.reviewer_ref::text) as external_ref,
               count(*)::int as decided,
               count(*) filter (where r.review_state in ('pass', 'partial_pass'))::int as approved
          from episode_reviews r left join operators o on o.id = r.reviewer_ref
         where r.review_state in ('pass', 'partial_pass', 'fail')
           and r.reviewer_ref is not null
           and r.reviewed_at >= ${from.toISOString()}::timestamptz and r.reviewed_at < ${to.toISOString()}::timestamptz
         group by r.reviewer_ref, o.external_ref
         order by r.reviewer_ref`,
  );
  return r.map((x) => ({
    reviewerId: String(x['reviewer_ref']),
    reviewerRef: String(x['external_ref']),
    decided: Number(x['decided']),
    approved: Number(x['approved']),
  }));
}

const auditFact = (r: Row): AuditFact => ({
  operatorId: String(r['operator_id']),
  operatorRef: String(r['external_ref'] ?? r['operator_id']),
  action: String(r['action']),
  at: date(r['occurred_at']) ?? new Date(0),
  targetId: String(r['target_id']),
});

export async function auditOn(db: Reader, targetTable: string, targetId: string): Promise<AuditFact[]> {
  const r = await rows(
    db,
    sql`select a.operator_id, o.external_ref, a.action, a.occurred_at, a.target_id
          from audit_events a left join operators o on o.id = a.operator_id
         where a.target_table = ${targetTable} and a.target_id = ${targetId} and a.operator_id is not null
         order by a.occurred_at asc, a.id asc`,
  );
  return r.map(auditFact);
}

export type BillSource = {
  billId: string;
  collectorId: string;
  collectorRef: string;
  periodStart: Date;
  periodEnd: Date;
  episodeIds: string[];
};

export async function billFactsFor(db: Reader, billId: string): Promise<BillSource | null> {
  const [b] = await rows(
    db,
    sql`select b.id, b.collector_id, c.external_ref, b.period_start, b.period_end
          from bills b join collectors c on c.id = b.collector_id where b.id = ${billId}::uuid`,
  );
  if (b === undefined) return null;
  const eps = await rows(
    db,
    sql`select distinct r.episode_id
          from bill_lines l
          join settlements s on s.id = l.settlement_id
          join episode_reviews r on r.id = s.episode_review_id
         where l.bill_id = ${billId}::uuid
         order by r.episode_id`,
  );
  return {
    billId: String(b['id']),
    collectorId: String(b['collector_id']),
    collectorRef: String(b['external_ref']),
    periodStart: date(b['period_start'])!,
    periodEnd: date(b['period_end'])!,
    episodeIds: eps.map((e) => String(e['episode_id'])),
  };
}

export async function concentrationInputFor(
  db: Reader,
  collectorId: string,
  from: Date,
  to: Date,
  actions: readonly string[],
): Promise<{ events: AuditFact[]; activeOperators: number }> {
  if (actions.length === 0) return { events: [], activeOperators: 0 };
  const events = await rows(
    db,
    sql`select a.operator_id, o.external_ref, a.action, a.occurred_at, a.target_id
          from audit_events a
          join bills b on b.id::text = a.target_id
          left join operators o on o.id = a.operator_id
         where a.target_table = 'bills' and b.collector_id = ${collectorId}::uuid
           and a.operator_id is not null
           and a.action in ${actions}
           and a.occurred_at >= ${from.toISOString()}::timestamptz and a.occurred_at < ${to.toISOString()}::timestamptz
         order by a.occurred_at asc, a.id asc`,
  );
  const [active] = await rows(
    db,
    sql`select count(distinct a.operator_id)::int as n
          from audit_events a
         where a.target_table = 'bills' and a.operator_id is not null
           and a.action in ${actions}
           and a.occurred_at >= ${from.toISOString()}::timestamptz and a.occurred_at < ${to.toISOString()}::timestamptz`,
  );
  return { events: events.map(auditFact), activeOperators: Number(active?.['n'] ?? 0) };
}

// ---------------------------------------------------------------------------
// What the worker evaluates

const LATEST_EVAL = sql`(select max(f.computed_at) from risk_flags f where f.signal_id = 'META.EVALUATED' and f.subject_type = `;

export async function collectorsDue(db: Reader, staleBefore: Date): Promise<string[]> {
  const hasPayout = await tableExists(db, 'payout_accounts');
  const r = await rows(
    db,
    sql`select c.id
          from collectors c
         where (exists (select 1 from collection_sessions s join episodes e on e.collection_session_id = s.id where s.collector_id = c.id)
                ${hasPayout ? sql`or exists (select 1 from payout_accounts p where p.collector_id = c.id)` : sql``})
           and coalesce(${LATEST_EVAL} 'collector' and f.subject_id = c.id::text), '-infinity'::timestamptz) < ${staleBefore.toISOString()}::timestamptz
         order by c.id`,
  );
  return r.map((x) => String(x['id']));
}

export async function episodesDue(db: Reader): Promise<string[]> {
  const r = await rows(
    db,
    sql`select e.episode_id
          from episodes e join episode_ingests i on i.ingest_id = e.latest_ingest_id
         where e.resolution_state = 'resolved'
           and coalesce(${LATEST_EVAL} 'episode' and f.subject_id = e.episode_id::text), '-infinity'::timestamptz) < i.ingested_at
         order by i.ingested_at asc, e.episode_id asc`,
  );
  return r.map((x) => String(x['episode_id']));
}

/**
 * Bills to evaluate: those whose facts moved since the last run, and — once
 * `PLAYERONE_RISK_HOLD` is on — those last judged while it was off.
 *
 * The second arm is the whole point of the parameter. Timestamps cannot see a
 * switch: a bill evaluated with holds disabled scores in the hold band, is
 * refused by the payout rail (`payoutSummary`, and `risk_hold` in the payout
 * preflight), and yet has no `risk_holds` row for an operator to clear. Every
 * fact behind it is older than the run, so no timestamp comparison ever makes
 * it due again. The run records what it was judged under —
 * `META.EVALUATED.evidence.holds_enabled` — so ask that instead: absent (a run
 * from before the key existed) or false means the bill has not been judged
 * under enforcement and must be. The re-evaluation writes `holds_enabled: true`
 * and the bill drops out again, whether or not a hold was raised, so this
 * costs one extra evaluation per bill per off-to-on flip and does not repeat.
 *
 * ponytail: one correlated subquery per bill, served by
 * `risk_flags_subject_idx (subject_type, subject_id, seq DESC)` — one indexed
 * row each — and the backlog it opens is drained under the worker's existing
 * per-tick `limit`. If that is ever too slow, store the band on the
 * META.EVALUATED row and filter in SQL: the same upgrade `queue.ts` already
 * names for its own candidate scan.
 */
export async function billsDue(db: Reader, holdsEnabled = false): Promise<string[]> {
  const r = await rows(
    db,
    sql`select b.id
          from bills b
         where (coalesce(${LATEST_EVAL} 'bill' and f.subject_id = b.id::text), '-infinity'::timestamptz)
               < greatest(
                   b.generated_at,
                   coalesce(${LATEST_EVAL} 'collector' and f.subject_id = b.collector_id::text), '-infinity'::timestamptz),
                   coalesce((select max(f.computed_at) from risk_flags f
                              where f.signal_id = 'META.EVALUATED' and f.subject_type = 'episode'
                                and f.subject_id in (select r.episode_id::text from bill_lines l
                                                      join settlements s on s.id = l.settlement_id
                                                      join episode_reviews r on r.id = s.episode_review_id
                                                     where l.bill_id = b.id)), '-infinity'::timestamptz))
                ${
                  holdsEnabled
                    ? sql`or not coalesce((select (f.evidence->>'holds_enabled')::boolean from risk_flags f
                                            where f.signal_id = 'META.EVALUATED' and f.subject_type = 'bill' and f.subject_id = b.id::text
                                            order by f.seq desc limit 1), false)`
                    : sql``
                })
         order by b.generated_at asc, b.id asc`,
  );
  return r.map((x) => String(x['id']));
}
