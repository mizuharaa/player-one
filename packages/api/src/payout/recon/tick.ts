import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import type { QueryTxnResult, ZaloPayClient } from '../domain/client-contract.ts';
import { shapeAttempt, type AttemptRow } from '../domain/attempts.ts';
import { finishRun, startRun, writeLine, type Finding, type Tx } from './lines.ts';

/**
 * The daily reconciliation (payout brief, AGENT F, BUILD 2). For every
 * non-terminal API attempt, and every API attempt that reached a terminal
 * state in the last seven days, ask ZaloPay what it thinks (query-txn) and
 * compare. Then probe, for every bill in scope, the NEXT partner_order_id we
 * would generate: an order there is one our ledger never wrote.
 *
 * A pure `tick(db, client, now)` like Agent B's poller (Part R3), meant for a
 * `setInterval` or a cron in `bin/`. It differs from the poller in what it may
 * do, which is nothing:
 *
 *   - It never updates `payout_attempts`. Not on a status it disagrees with,
 *     not on an amount, not on a stuck pending. It writes its own tables and
 *     one ticket per finding, and stops.
 *   - It never resolves a line — its own or an older run's. The only writer
 *     of `resolved_at` is an operator through `resolve.ts`, and 0015 refuses
 *     any other at commit (`recon_lines_resolved_by_operator`).
 *   - It never sends anything. There is no call to `transferFund` in this
 *     file; the tests assert on the fake server's transfer count after every
 *     run.
 *
 * Scope is `mode = 'api'` only. A manual attempt records a transfer a person
 * made outside ZaloPay's API; it has no order for query-txn to find, and
 * asking would report every one of them as "we say paid, they don't". Manual
 * attempts are reconciled against a statement instead (`statement.ts`).
 *
 * Idempotency across instances is an advisory transaction lock per attempt
 * (and per bill for the orphan probe) rather than `FOR UPDATE` on the row:
 * this tick reads the row and does not write it, and a row lock held across
 * a query-txn round trip would make the poller skip the attempt and make a
 * transfer answer being recorded wait out our timeout. The advisory lock
 * keeps two reconciliations off the same attempt and touches nothing else.
 */

export const RECON_WINDOW = {
  /** Terminal attempts this old are still compared; older ones are history. */
  terminalLookbackMs: 7 * 24 * 60 * 60_000,
  /** STALE_PROCESSING: status 3, or no order found, for longer than this. */
  staleProcessingMs: 24 * 60 * 60_000,
  /** STUCK_PENDING: status 4 for longer than this. */
  stuckPendingMs: 72 * 60 * 60_000,
  /** Bills with no attempt at all are probed for an orphan when they start inside this window. */
  orphanProbeBillsMs: 30 * 24 * 60 * 60_000,
} as const;

/** A query-txn outcome, or the absence of one. */
export type Answer = QueryTxnResult | { kind: 'error'; message: string };

export type Compared = Pick<AttemptRow, 'id' | 'billId' | 'partnerOrderId' | 'status' | 'amountVnd' | 'createdAt' | 'zlpOrderId'> & {
  /** When the attempt entered `pending_zlp`, from the event trail; `createdAt` when unknown. */
  pendingSince: Date | null;
};

const theirStatusOf = (a: Answer): string | null => {
  switch (a.kind) {
    case 'found':
      return String(a.status);
    case 'not_found':
      return 'not_found';
    default:
      return null;
  }
};

/**
 * What one attempt and one answer say about each other. Pure, and listed
 * rather than decided: a finding is a fact for an operator, never an action.
 *
 *   WE_SAY_PAID_THEY_DONT  ours succeeded; theirs is not status 1 (or no order)
 *   THEY_SAY_PAID_WE_DONT  theirs status 1; ours is anything but succeeded —
 *                          including `failed`, which is the worst case: a new
 *                          attempt would pay a second time
 *   ORPHAN_AT_ZLP          an order exists under an id our ledger says was
 *                          never sent (`created`) or is closed (`failed`), and
 *                          it is not a completed one (that is THEY_SAY_PAID
 *                          above). Status 3 or 4 here is money that may still
 *                          move behind a ledger that would admit a new
 *                          attempt; it is never clean (bridge finding F-48).
 *                          A `failed` attempt whose order reads 2 is agreement:
 *                          a polled 2 is how it failed.
 *   AMOUNT_MISMATCH        both name an amount and they differ
 *   STALE_PROCESSING       ours still submitted/processing/unknown after 24 h
 *                          and theirs is still 3, or not found
 *   STUCK_PENDING          ours pending_zlp for more than 72 h
 *
 * An answer that is not an answer (a refusal, a system error, a dead socket)
 * teaches nothing and produces nothing; the run counts it as `unanswered`.
 */
export function compare(attempt: Compared, answer: Answer, now: Date): Finding[] {
  if (answer.kind === 'rejected' || answer.kind === 'system' || answer.kind === 'error') return [];
  const found = answer.kind === 'found' ? answer : null;
  const base = {
    billId: attempt.billId,
    payoutAttemptId: attempt.id,
    partnerOrderId: attempt.partnerOrderId,
    reference: found?.zlpOrderId ?? attempt.zlpOrderId,
    ourStatus: attempt.status,
    theirStatus: theirStatusOf(answer),
    ourAmount: attempt.amountVnd,
    theirAmount: found?.amountVnd ?? null,
  };
  const findings: Finding[] = [];
  const ourPaid = attempt.status === 'succeeded';
  const theirPaid = found !== null && found.status === 1;
  const ageMs = now.getTime() - attempt.createdAt.getTime();

  if (ourPaid && !theirPaid) {
    findings.push({ ...base, kind: 'WE_SAY_PAID_THEY_DONT', detail: { zp_trans_id_at_zlp: found?.zpTransId ?? null } });
  }
  if (!ourPaid && theirPaid) {
    findings.push({ ...base, kind: 'THEY_SAY_PAID_WE_DONT', detail: { zp_trans_id_at_zlp: found?.zpTransId ?? null } });
  }
  if (
    found !== null &&
    found.status !== 1 &&
    (attempt.status === 'created' || (attempt.status === 'failed' && found.status !== 2))
  ) {
    findings.push({
      ...base,
      kind: 'ORPHAN_AT_ZLP',
      detail: {
        provider_status: found.status,
        zp_trans_id_at_zlp: found.zpTransId,
        why:
          attempt.status === 'created'
            ? 'our ledger says this attempt was never sent, and ZaloPay holds an order for it'
            : 'our ledger closed this attempt as failed, and ZaloPay still holds its order in flight',
      },
    });
  }
  if (found !== null && found.amountVnd !== null && found.amountVnd !== attempt.amountVnd) {
    findings.push({ ...base, kind: 'AMOUNT_MISMATCH', detail: { difference_vnd: found.amountVnd - attempt.amountVnd } });
  }
  if (
    (attempt.status === 'submitted' || attempt.status === 'processing' || attempt.status === 'unknown') &&
    ageMs > RECON_WINDOW.staleProcessingMs &&
    (found === null || found.status === 3)
  ) {
    findings.push({ ...base, kind: 'STALE_PROCESSING', detail: { age_hours: Math.floor(ageMs / 3_600_000) } });
  }
  if (attempt.status === 'pending_zlp') {
    const since = attempt.pendingSince ?? attempt.createdAt;
    const pendingMs = now.getTime() - since.getTime();
    if (pendingMs > RECON_WINDOW.stuckPendingMs) {
      findings.push({ ...base, kind: 'STUCK_PENDING', detail: { pending_since: since.toISOString(), pending_hours: Math.floor(pendingMs / 3_600_000) } });
    }
  }
  return findings;
}

export type ReconOutcome = 'clean' | 'raised' | 'still_open' | 'unanswered' | 'locked';

export type ReconReport = {
  runId: string;
  now: string;
  attempts: { attemptId: string; partnerOrderId: string; outcome: ReconOutcome; kinds: string[] }[];
  orphans: { billId: string; partnerOrderId: string; outcome: ReconOutcome }[];
  summary: {
    attempts_considered: number;
    queried: number;
    unanswered: number;
    locked: number;
    raised: number;
    still_open: number;
    findings_by_kind: Record<string, number>;
    orphan_probes: number;
    never_sent: number;
  };
};

export type ReconTickOptions = {
  /** Sequential, and conservative: the wait between two calls. Zero in tests. */
  pauseMs?: number;
  /** At most this many attempts, and this many probes, per run. */
  limit?: number;
  /** Skip the orphan probe (it is one query-txn per bill in scope). */
  probeOrphans?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type RawRow = Parameters<typeof shapeAttempt>[0];

async function ask(client: ZaloPayClient, partnerOrderId: string): Promise<Answer> {
  try {
    return await client.queryTransaction(partnerOrderId);
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}

/** The advisory lock name for one row, so two runs never both write about it. */
const lockOn = (tx: Tx, key: string) =>
  tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${'payout_recon:' + key})) as held`) as unknown as Promise<{ held: boolean }[]>;

export async function tick(db: Db, client: ZaloPayClient, now: Date = new Date(), options: ReconTickOptions = {}): Promise<ReconReport> {
  const pauseMs = options.pauseMs ?? 250;
  const limit = options.limit ?? 500;
  const probeOrphans = options.probeOrphans ?? true;
  const since = new Date(now.getTime() - RECON_WINDOW.terminalLookbackMs);
  const runId = await startRun(db, 'zalopay', { start: since, end: now }, now);

  const report: ReconReport = {
    runId,
    now: now.toISOString(),
    attempts: [],
    orphans: [],
    summary: {
      attempts_considered: 0,
      queried: 0,
      unanswered: 0,
      locked: 0,
      raised: 0,
      still_open: 0,
      findings_by_kind: {},
      orphan_probes: 0,
      never_sent: 0,
    },
  };
  const count = (kind: string) => {
    report.summary.findings_by_kind[kind] = (report.summary.findings_by_kind[kind] ?? 0) + 1;
  };

  /**
   * The candidates, by id only; the row is read again under the lock.
   * `created` is non-terminal and is listed — an attempt that was never sent
   * is exactly the one whose order ZaloPay must NOT hold.
   */
  const candidates = (await db.execute(sql`
    select id from payout_attempts
     where mode = 'api'
       and (status not in ('succeeded', 'failed')
            or coalesce(settled_at, created_at) >= ${since.toISOString()}::timestamptz)
     order by created_at asc, attempt_seq asc
     limit ${limit}
  `)) as unknown as { id: string }[];
  report.summary.attempts_considered = candidates.length;

  let calls = 0;
  for (const { id } of candidates) {
    if (calls > 0 && pauseMs > 0) await sleep(pauseMs);
    const entry = await db.transaction(async (tx) => {
      const [lock] = await lockOn(tx, `attempt:${id}`);
      if (lock?.held !== true) return { attemptId: id, partnerOrderId: '', outcome: 'locked' as const, kinds: [] };
      const rows = (await tx.execute(sql`select * from payout_attempts where id = ${id}`)) as unknown as RawRow[];
      if (rows[0] === undefined) return { attemptId: id, partnerOrderId: '', outcome: 'locked' as const, kinds: [] };
      const attempt = shapeAttempt(rows[0]);
      if (attempt.status === 'created') report.summary.never_sent += 1;

      const pending = (await tx.execute(sql`
        select occurred_at from payout_events
         where payout_attempt_id = ${id} and kind like 'ATTEMPT.%' and evidence->>'to' = 'pending_zlp'
         order by id asc limit 1
      `)) as unknown as { occurred_at: Date | string }[];
      const pendingSince = pending[0] === undefined ? null : new Date(pending[0].occurred_at);

      calls += 1;
      const answer = await ask(client, attempt.partnerOrderId);
      report.summary.queried += 1;
      if (answer.kind === 'rejected' || answer.kind === 'system' || answer.kind === 'error') {
        report.summary.unanswered += 1;
        return { attemptId: id, partnerOrderId: attempt.partnerOrderId, outcome: 'unanswered' as const, kinds: [] };
      }
      const findings = compare({ ...attempt, pendingSince }, answer, now);
      if (findings.length === 0) return { attemptId: id, partnerOrderId: attempt.partnerOrderId, outcome: 'clean' as const, kinds: [] };
      let raised = 0;
      for (const f of findings) {
        const lineId = await writeLine(tx, runId, f, now);
        if (lineId === null) report.summary.still_open += 1;
        else {
          raised += 1;
          report.summary.raised += 1;
          count(f.kind);
        }
      }
      return {
        attemptId: id,
        partnerOrderId: attempt.partnerOrderId,
        outcome: raised > 0 ? ('raised' as const) : ('still_open' as const),
        kinds: findings.map((f) => f.kind),
      };
    });
    if (entry.outcome === 'locked') report.summary.locked += 1;
    report.attempts.push(entry);
  }

  if (probeOrphans) {
    /**
     * Every bill an attempt in scope belongs to, and every recent bill with
     * no attempt at all. For each, the id the NEXT attempt would carry — the
     * database computes them as 'PO-{bill}-{seq}', so the id space is ours to
     * enumerate — is asked about. ZaloPay having an order there means a
     * transfer was sent under our name that our ledger never recorded.
     */
    const bills = (await db.execute(sql`
      select b.id, coalesce(max(a.attempt_seq), 0) + 1 as next_seq
        from bills b
        left join payout_attempts a on a.bill_id = b.id
       where exists (select 1 from payout_attempts s
                      where s.bill_id = b.id and s.mode = 'api'
                        and (s.status not in ('succeeded', 'failed')
                             or coalesce(s.settled_at, s.created_at) >= ${since.toISOString()}::timestamptz))
          or (b.period_start >= ${new Date(now.getTime() - RECON_WINDOW.orphanProbeBillsMs).toISOString()}::timestamptz
              and not exists (select 1 from payout_attempts x where x.bill_id = b.id))
       group by b.id
       order by b.id
       limit ${limit}
    `)) as unknown as { id: string; next_seq: number | string }[];

    for (const b of bills) {
      if (calls > 0 && pauseMs > 0) await sleep(pauseMs);
      const partnerOrderId = `PO-${b.id}-${Number(b.next_seq)}`;
      const entry = await db.transaction(async (tx) => {
        const [lock] = await lockOn(tx, `bill:${b.id}`);
        if (lock?.held !== true) return { billId: b.id, partnerOrderId, outcome: 'locked' as const };
        calls += 1;
        report.summary.orphan_probes += 1;
        const answer = await ask(client, partnerOrderId);
        if (answer.kind !== 'found') {
          if (answer.kind !== 'not_found') report.summary.unanswered += 1;
          return { billId: b.id, partnerOrderId, outcome: answer.kind === 'not_found' ? ('clean' as const) : ('unanswered' as const) };
        }
        const f: Finding = {
          kind: 'ORPHAN_AT_ZLP',
          billId: b.id,
          payoutAttemptId: null,
          partnerOrderId,
          reference: answer.zlpOrderId,
          ourStatus: null,
          theirStatus: String(answer.status),
          ourAmount: null,
          theirAmount: answer.amountVnd,
          detail: { zp_trans_id_at_zlp: answer.zpTransId, probed_seq: Number(b.next_seq) },
        };
        const lineId = await writeLine(tx, runId, f, now);
        if (lineId === null) {
          report.summary.still_open += 1;
          return { billId: b.id, partnerOrderId, outcome: 'still_open' as const };
        }
        report.summary.raised += 1;
        count(f.kind);
        return { billId: b.id, partnerOrderId, outcome: 'raised' as const };
      });
      if (entry.outcome === 'locked') report.summary.locked += 1;
      report.orphans.push(entry);
    }
  }

  await finishRun(db, runId, now, report.summary);
  return report;
}
