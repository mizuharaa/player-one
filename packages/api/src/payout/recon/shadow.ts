import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import type { ZaloPayClient } from '../domain/client-contract.ts';
import { preflight, type BatchOptions } from '../worker/batch.ts';
import { finishRun, startRun, writeLine, type Finding, type Period } from './lines.ts';

/**
 * Shadow mode (payout brief, AGENT F, BUILD 6; Part 4, gate G7). While
 * PLAYERONE_PAYOUT_MODE=manual, compute what an API run WOULD have done and
 * keep it. After the operator has paid the cycle by hand, diff intention
 * against what was actually recorded. Two shadow cycles diffed clean is the
 * gate before `api` becomes discussable.
 *
 * `shadowRun` reads through Agent B's own `preflight` — the same code path
 * the API rail takes, up to and not including `payBill` — so the intention it
 * records is the rail's, not a re-implementation of it. It writes no attempt
 * and sends no transfer: the only ZaloPay call is the balance read that the
 * preflight makes, and the tests assert the fake server saw nothing else.
 */

export type Intended = {
  bill_id: string;
  collector_id: string;
  collector_ref: string;
  amount_vnd: number | null;
  /**
   * Whether the API rail would have sent this bill: no issue on the bill and
   * a whole-dong amount. The batch-level preflight (wallet balance, or no
   * client at all) is NOT folded in here: shadow mode runs in the manual
   * pilot, where there is no ZaloPay client, and a refusal that is about the
   * wallet says nothing about the bill. Folding it in marked every manual
   * payment the operator correctly made as SHADOW_UNINTENDED (bridge finding
   * 297). The batch refusal lives on the run summary and on `ShadowRun`.
   */
  would_send: boolean;
  issues: string[];
  risk_band: string;
};

export type ShadowRun = {
  runId: string;
  preflight_ok: boolean;
  refusal: string | null;
  balance_vnd: number | null;
  intended: Intended[];
};

export async function shadowRun(
  db: Db,
  client: ZaloPayClient | undefined,
  period: Period,
  options: BatchOptions & { now?: Date } = {},
): Promise<ShadowRun> {
  const now = options.now ?? new Date();
  const { billsDetail, ...pre } = await preflight(db, client, period, options);
  const intended: Intended[] = billsDetail.map((b) => ({
    bill_id: b.id,
    collector_id: b.collectorId,
    collector_ref: b.collectorRef,
    amount_vnd: b.amountVnd,
    would_send: b.issues.length === 0 && b.amountVnd !== null,
    issues: b.issues,
    risk_band: b.risk.band,
  }));
  const runId = await startRun(db, 'shadow', period, now);
  await finishRun(db, runId, now, {
    mode: 'manual',
    preflight: pre,
    intended,
    would_send: intended.filter((i) => i.would_send).length,
    would_send_total_vnd: intended.filter((i) => i.would_send).reduce((s, i) => s + (i.amount_vnd ?? 0), 0),
  });
  return { runId, preflight_ok: pre.ok, refusal: pre.refusal, balance_vnd: pre.balance_vnd, intended };
}

/** A bill's actual outcome after the manual cycle. */
export type ActualPayment = {
  billId: string;
  /** The newest attempt's mode and status; null when the bill has none. */
  mode: 'manual' | 'api' | null;
  status: string | null;
  amountVnd: number | null;
  manualReference: string | null;
};

/**
 * Intention against outcome, per bill. Pure.
 *
 *   SHADOW_UNPAID       the rail would have sent it; nothing succeeded
 *   SHADOW_UNINTENDED   something succeeded; the rail would not have sent it
 *                       (the issues that would have stopped it are the detail)
 *   AMOUNT_MISMATCH     both agree it was paid, and not on how much
 */
export function diffShadow(intended: Intended[], actual: ActualPayment[]): Finding[] {
  const byBill = new Map(actual.map((a) => [a.billId, a]));
  const findings: Finding[] = [];
  for (const i of intended) {
    const a = byBill.get(i.bill_id) ?? null;
    const paid = a !== null && a.status === 'succeeded';
    const base = {
      billId: i.bill_id,
      payoutAttemptId: null,
      partnerOrderId: null,
      reference: a?.manualReference ?? null,
      ourStatus: i.would_send ? 'would_send' : 'would_not_send',
      theirStatus: a === null || (a.mode === null && a.status === null) ? 'no_attempt' : `${a.mode}:${a.status}`,
      ourAmount: i.amount_vnd,
      theirAmount: paid ? a.amountVnd : null,
    };
    if (i.would_send && !paid) {
      findings.push({ ...base, kind: 'SHADOW_UNPAID', detail: { collector_ref: i.collector_ref, risk_band: i.risk_band } });
    } else if (!i.would_send && paid) {
      findings.push({ ...base, kind: 'SHADOW_UNINTENDED', detail: { collector_ref: i.collector_ref, issues: i.issues, risk_band: i.risk_band } });
    } else if (i.would_send && paid && a!.amountVnd !== i.amount_vnd) {
      findings.push({ ...base, kind: 'AMOUNT_MISMATCH', detail: { collector_ref: i.collector_ref, difference_vnd: (a!.amountVnd ?? 0) - (i.amount_vnd ?? 0) } });
    }
  }
  return findings;
}

export type ShadowDiff = {
  runId: string;
  shadowRunId: string;
  bills: number;
  agreed: number;
  raised: number;
  still_open: number;
  findings_by_kind: Record<string, number>;
};

/** Reads the intention a `shadowRun` stored, the ledger as it stands now, and writes the diff as its own run. */
export async function shadowDiff(db: Db, shadowRunId: string, options: { now?: Date } = {}): Promise<ShadowDiff> {
  const now = options.now ?? new Date();
  const [run] = (await db.execute(sql`
    select period_start, period_end, source, summary from recon_runs where id = ${shadowRunId}
  `)) as unknown as { period_start: Date | string; period_end: Date | string; source: string; summary: { intended?: Intended[] } }[];
  if (run === undefined) throw new Error(`no recon run ${shadowRunId}`);
  if (run.source !== 'shadow') throw new Error(`recon run ${shadowRunId} is a ${run.source} run, not a shadow run`);
  const intended = run.summary.intended ?? [];

  const actual: ActualPayment[] = [];
  for (const i of intended) {
    const [a] = (await db.execute(sql`
      select mode, status, amount_vnd, manual_reference from payout_attempts
       where bill_id = ${i.bill_id} order by attempt_seq desc limit 1
    `)) as unknown as { mode: 'manual' | 'api'; status: string; amount_vnd: string | number; manual_reference: string | null }[];
    actual.push(
      a === undefined
        ? { billId: i.bill_id, mode: null, status: null, amountVnd: null, manualReference: null }
        : { billId: i.bill_id, mode: a.mode, status: a.status, amountVnd: Number(a.amount_vnd), manualReference: a.manual_reference },
    );
  }
  const findings = diffShadow(intended, actual);
  const period = { start: new Date(run.period_start), end: new Date(run.period_end) };
  const runId = await startRun(db, 'shadow_diff', period, now);
  const result: ShadowDiff = { runId, shadowRunId, bills: intended.length, agreed: intended.length - findings.length, raised: 0, still_open: 0, findings_by_kind: {} };
  await db.transaction(async (tx) => {
    for (const f of findings) {
      const id = await writeLine(tx, runId, f, now);
      if (id === null) result.still_open += 1;
      else {
        result.raised += 1;
        result.findings_by_kind[f.kind] = (result.findings_by_kind[f.kind] ?? 0) + 1;
      }
    }
  });
  await finishRun(db, runId, now, { shadow_run_id: shadowRunId, bills: result.bills, agreed: result.agreed, raised: result.raised, still_open: result.still_open, findings_by_kind: result.findings_by_kind });
  return result;
}
