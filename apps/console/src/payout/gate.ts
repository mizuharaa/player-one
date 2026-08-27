/**
 * The preflight gate: whether the payment controls may be live.
 *
 * A preflight is a snapshot — balance, holds, limits, anomalies — and a
 * snapshot ages. The gate carries two things from the moment the preflight
 * ran: when, and a fingerprint of the batch it described. It opens only while
 * the snapshot is younger than the window AND the batch still looks the way
 * the preflight saw it; a bill paid in between, an account declared, a hold
 * raised or cleared, all change the fingerprint and close the gate with a
 * visible reason. Time closes it too, live, while the operator is looking.
 *
 * This is presentation friction on purpose and it says so: the server decides
 * whether a payment may exist (the triggers of 0012/0013, and `payBill`'s own
 * checks). What the gate guarantees is narrower — nobody reaches "pay" with
 * a balance, a hold list or an anomaly list in front of them that is older
 * than five minutes or describes a different batch. A server-side preflight
 * token would make it an invariant rather than a courtesy; that is a seam
 * request for Agent B, recorded in the handoff.
 *
 * Pure, so the boundary is a unit test.
 */
import type { PayoutBill, PayoutPreflight } from '../lib/api.ts';

/** How long a preflight stays valid as authorisation material. */
export const PREFLIGHT_WINDOW_MS = 5 * 60_000;

/** What the preflight query holds: the server's answer plus what the batch looked like at that moment. */
export type PreflightSnapshot = PayoutPreflight & { fingerprint: string };

/**
 * A string that changes when anything the preflight judged changes. Ids and
 * states only — never a sum. Sorted, so two reads of the same batch agree
 * whatever order the rows arrived in.
 */
export function batchFingerprint(bills: readonly PayoutBill[]): string {
  return bills
    .map(
      (b) =>
        `${b.id}|${b.amount_vnd ?? 'x'}|${b.paid ? 1 : 0}|${[...b.issues].sort().join(',')}|${b.attempt?.status ?? '-'}|${b.attempt?.id ?? '-'}|${b.risk.band}|${b.risk.score}|${b.account?.id ?? '-'}|${b.account?.verify_status ?? '-'}`,
    )
    .sort()
    .join('\n');
}

export type GateState =
  | { open: true; ageMs: number }
  | { open: false; reason: 'missing' | 'expired' | 'changed'; ageMs: number | null };

export function preflightGate(input: {
  snapshot: PreflightSnapshot | null | undefined;
  /** When the snapshot was fetched, epoch ms. `dataUpdatedAt` from the query. */
  fetchedAt: number;
  /** The batch as it reads now. */
  batchFingerprint: string;
  now: number;
  windowMs?: number;
}): GateState {
  const window = input.windowMs ?? PREFLIGHT_WINDOW_MS;
  if (input.snapshot === null || input.snapshot === undefined || !Number.isFinite(input.fetchedAt) || input.fetchedAt <= 0) {
    return { open: false, reason: 'missing', ageMs: null };
  }
  const ageMs = input.now - input.fetchedAt;
  // Fails closed at the boundary: a snapshot exactly one window old is not
  // "younger than the window", so it is not authorisation material either.
  // `>=` was decided in the handoff (CLAUDE.md, unfinished branches item 4);
  // it is not an open question.
  if (ageMs < 0 || ageMs >= window) return { open: false, reason: 'expired', ageMs };
  if (input.snapshot.fingerprint !== input.batchFingerprint) return { open: false, reason: 'changed', ageMs };
  return { open: true, ageMs };
}

/** The catalogue key that explains a closed gate. */
export const gateReasonKey = (gate: GateState): string | null =>
  gate.open ? null : gate.reason === 'expired' ? 'settle.preflight.expired' : gate.reason === 'changed' ? 'settle.preflight.changed' : 'settle.preflight.stale';
