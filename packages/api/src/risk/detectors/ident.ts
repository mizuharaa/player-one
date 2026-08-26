import { numParam, type Finding, type TuningMap } from '../types.ts';

/**
 * IDENTITY signals, over Agent B's `payout_accounts` (§2.1) read by the
 * column names in the contract. Pure: the loader in `../sources.ts` does the
 * SQL and hands these functions plain rows.
 *
 * PHONE_SHARED, ACCOUNT_SHARED and MUID_SHARED are the highest-value signals
 * in the engine. Multi-accounting — one person paid as several collectors —
 * is the most common and most profitable abuse of a paid collection
 * programme, and it shows up as one payout destination on two current
 * accounts. Each is one query and each alone reaches 'hold'.
 */

export type PayoutAccount = {
  id: string;
  collectorId: string;
  method: 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD';
  phone: string | null;
  bankCode: string | null;
  accountNoLast4: string | null;
  declaredName: string;
  verifiedName: string | null;
  mUId: string | null;
  verifyStatus: string;
  verifiedAt: Date | null;
  isCurrent: boolean;
  createdAt: Date;
};

export type Peer = { collectorId: string; collectorRef: string };

export type IdentInput = {
  collectorId: string;
  /** Every account this collector has declared, oldest first. */
  accounts: readonly PayoutAccount[];
  /** Other collectors whose CURRENT account shares a destination with this collector's CURRENT account. */
  peers: { phone: readonly Peer[]; bank: readonly Peer[]; muid: readonly Peer[] };
  /** How often ZaloPay answered -406 for this collector: account rows in `kyc_limit` plus any payout_events. */
  kycLimitOccurrences: number;
};

// ---------------------------------------------------------------------------
// Vietnamese name comparison, the rule Agent B applies on verify and the
// engine repeats so a stale `verify_status` cannot hide a mismatch.

/** Diacritics stripped, đ folded, case-folded, split into a token set. */
export function nameTokens(name: string): Set<string> {
  const folded = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  return new Set(folded.split(/\s+/).filter((t) => t.length > 0));
}

/** Token SETS, not sequences: Vietnamese name order varies by form. Exact set equality only. */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}

export const maskPhone = (phone: string): string =>
  phone.length <= 5 ? phone : `${phone.slice(0, 3)}${'•'.repeat(Math.max(1, phone.length - 5))}${phone.slice(-2)}`;

export const maskId = (id: string): string => (id.length <= 6 ? id : `${id.slice(0, 3)}…${id.slice(-3)}`);

const refs = (peers: readonly Peer[]): string[] => [...new Set(peers.map((p) => p.collectorRef))].sort();

/** Collector-level identity findings. At most one per signal. */
export function identSignals(input: IdentInput, tuning: TuningMap): Finding[] {
  const out: Finding[] = [];
  const on = (id: string): boolean => tuning.get(id)?.enabled === true;
  const current = input.accounts.find((a) => a.isCurrent) ?? null;
  if (current === null) return out;

  if (on('IDENT.NAME_MISMATCH')) {
    const mismatch =
      current.verifyStatus === 'name_mismatch' ||
      (current.verifiedName !== null && current.verifiedName.trim() !== '' && !namesMatch(current.declaredName, current.verifiedName));
    if (mismatch) {
      out.push({
        signalId: 'IDENT.NAME_MISMATCH',
        evidence: {
          declared_name: current.declaredName,
          verified_name: current.verifiedName ?? '(not returned)',
          method: current.method,
          verify_status: current.verifyStatus,
          payout_account_id: current.id,
        },
      });
    }
  }

  if (on('IDENT.PHONE_SHARED') && current.phone !== null && input.peers.phone.length > 0) {
    out.push({
      signalId: 'IDENT.PHONE_SHARED',
      evidence: {
        phone_masked: maskPhone(current.phone),
        count: refs(input.peers.phone).length,
        other_collector_refs: refs(input.peers.phone),
        other_collector_ids: [...new Set(input.peers.phone.map((p) => p.collectorId))].sort(),
      },
    });
  }

  if (on('IDENT.ACCOUNT_SHARED') && current.bankCode !== null && current.accountNoLast4 !== null && input.peers.bank.length > 0) {
    out.push({
      signalId: 'IDENT.ACCOUNT_SHARED',
      evidence: {
        bank_code: current.bankCode,
        account_no_last4: current.accountNoLast4,
        method: current.method,
        count: refs(input.peers.bank).length,
        other_collector_refs: refs(input.peers.bank),
        other_collector_ids: [...new Set(input.peers.bank.map((p) => p.collectorId))].sort(),
      },
    });
  }

  if (on('IDENT.MUID_SHARED') && current.mUId !== null && input.peers.muid.length > 0) {
    out.push({
      signalId: 'IDENT.MUID_SHARED',
      evidence: {
        m_u_id_masked: maskId(current.mUId),
        count: refs(input.peers.muid).length,
        other_collector_refs: refs(input.peers.muid),
        other_collector_ids: [...new Set(input.peers.muid.map((p) => p.collectorId))].sort(),
      },
    });
  }

  // ZaloPay's -1103: 'unverified' AFTER a verification attempt. Before one, the
  // same status only means nobody has asked yet, which is not a finding.
  if (on('IDENT.UNVERIFIED_KYC') && current.verifyStatus === 'unverified' && current.verifiedAt !== null) {
    out.push({
      signalId: 'IDENT.UNVERIFIED_KYC',
      evidence: { verified_at: current.verifiedAt.toISOString(), sub_return_code: -1103, payout_account_id: current.id },
    });
  }

  if (on('IDENT.WALLET_LOCKED') && current.verifyStatus === 'locked') {
    out.push({
      signalId: 'IDENT.WALLET_LOCKED',
      evidence: {
        verified_at: current.verifiedAt?.toISOString() ?? current.createdAt.toISOString(),
        sub_return_code: -1011,
        payout_account_id: current.id,
      },
    });
  }

  const kyc = tuning.get('IDENT.KYC_LIMIT_REPEATED');
  if (kyc?.enabled) {
    const max = numParam(kyc, 'max_occurrences', 2);
    if (input.kycLimitOccurrences > max) {
      out.push({
        signalId: 'IDENT.KYC_LIMIT_REPEATED',
        evidence: { occurrences: input.kycLimitOccurrences, max_occurrences: max, sub_return_code: -406 },
      });
    }
  }
  return out;
}

/**
 * Bill-level: the payout account was changed inside the last `window_days`
 * of the period, or after it ended and before now. The first declaration is
 * not a change; a second row is.
 */
export function identChangedLate(
  input: { accounts: readonly PayoutAccount[]; periodEnd: Date; now: Date },
  tuning: TuningMap,
): Finding[] {
  const t = tuning.get('IDENT.ACCOUNT_CHANGED_LATE');
  if (!t?.enabled || input.accounts.length < 2) return [];
  const window = numParam(t, 'window_days', 7);
  const from = input.periodEnd.getTime() - window * 86_400_000;
  const changes = input.accounts.slice(1).filter((a) => a.createdAt.getTime() >= from && a.createdAt.getTime() <= input.now.getTime());
  if (changes.length === 0) return [];
  const latest = changes[changes.length - 1]!;
  const daysBefore = (input.periodEnd.getTime() - latest.createdAt.getTime()) / 86_400_000;
  return [
    {
      signalId: 'IDENT.ACCOUNT_CHANGED_LATE',
      evidence: {
        changed_at: latest.createdAt.toISOString(),
        period_end: input.periodEnd.toISOString(),
        days_before_end: Math.round(daysBefore * 10) / 10,
        window_days: window,
        changes_in_window: changes.length,
        payout_account_id: latest.id,
      },
    },
  ];
}
