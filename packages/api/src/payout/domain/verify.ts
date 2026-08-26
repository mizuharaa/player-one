import type { VerifyAccountResult, VerifyReceiver, ZaloPayClient } from './client-contract.ts';
import type { EventKind } from './events.ts';
import { namesMatch } from './names.ts';

/**
 * Verification-on-declare (Agent B brief, BUILD 5).
 *
 * Verify Account is read-only, so it is worth running months before a payout
 * contract is live: a wrong name, a missing wallet or a typo'd account number
 * is caught at registration for free. On the wallet route it is also a hard
 * precondition of paying at all — the transfer needs the `m_u_id` only a verify
 * returns (Part 0, §0.4).
 *
 * The outcome is a verify_status for `payout_accounts`, optionally a risk
 * event for `payout_events`, and optionally a ZaloPay page for the collector.
 * The declared name is NEVER replaced by ZaloPay's. The discrepancy is the
 * signal; erasing it destroys the evidence.
 */

export type VerifyStatus =
  | 'unverified'
  | 'verified'
  | 'name_mismatch'
  | 'no_wallet'
  | 'locked'
  | 'kyc_limit'
  | 'error';

export type VerifyOutcome = {
  status: VerifyStatus;
  /** What ZaloPay said the holder is called, when it said anything. */
  verifiedName: string | null;
  /** Wallet route only. */
  mUId: string | null;
  /** The sub code that decided it, for the evidence. */
  subCode: number | null;
  /** -101 → onboarding, -406 → reform. Surfaced to the collector, never a dead end. */
  redirectUrl: string | null;
  /** The event Agent C should see, or null when there is nothing to flag. */
  event: EventKind | null;
};

/**
 * Pure: the mapping from an answer to an outcome, given the declared name.
 * Kept apart from the call so every branch is a unit test with no client.
 */
export function outcomeOf(declaredName: string, result: VerifyAccountResult): VerifyOutcome {
  const none = { verifiedName: null, mUId: null, redirectUrl: null };
  switch (result.kind) {
    case 'verified': {
      if (result.verifiedName === null) {
        /**
         * The account exists (a wallet with an m_u_id, typically) and ZaloPay
         * returned no holder name to compare against. The name check is the
         * point of verification, so this is recorded as verified-but-unnamed
         * and flagged for the engine rather than treated as a match. Whether
         * such a wallet may be paid without a name check is an escalation.
         */
        return {
          status: 'verified',
          verifiedName: null,
          mUId: result.mUId,
          subCode: null,
          redirectUrl: null,
          event: 'IDENT.NAME_UNCONFIRMED',
        };
      }
      const match = namesMatch(declaredName, result.verifiedName);
      return {
        status: match ? 'verified' : 'name_mismatch',
        verifiedName: result.verifiedName,
        mUId: result.mUId,
        subCode: null,
        redirectUrl: null,
        event: match ? null : 'IDENT.NAME_MISMATCH',
      };
    }
    case 'rejected':
      switch (result.subCode) {
        case -101:
          return { ...none, status: 'no_wallet', subCode: -101, redirectUrl: result.onboardingUrl ?? null, event: 'IDENT.NO_WALLET' };
        case -406:
          return { ...none, status: 'kyc_limit', subCode: -406, redirectUrl: result.reformUrl ?? null, event: 'IDENT.KYC_LIMIT' };
        case -1011:
          return { ...none, status: 'locked', subCode: -1011, event: 'IDENT.WALLET_LOCKED' };
        case -1103:
          return { ...none, status: 'unverified', subCode: -1103, event: 'IDENT.UNVERIFIED_KYC' };
        case -1104:
          return { ...none, status: 'name_mismatch', subCode: -1104, event: 'IDENT.NAME_MISMATCH' };
        default:
          // -104/-105/-106/-1102 and the rest: our data was bad. Not a risk
          // signal about the collector; a form to fix.
          return { ...none, status: 'error', subCode: result.subCode, event: 'IDENT.VERIFY_ERROR' };
      }
    case 'system':
      return { ...none, status: 'error', subCode: result.subCode, event: null };
  }
}

/**
 * Calls the client and maps the answer. With no client (manual pilot, no
 * credentials) the account is stored `unverified` and nothing is flagged —
 * that is honest, and the batch view counts it.
 *
 * A transport failure is an `error` outcome, not a throw: the declaration is
 * still recorded, with the evidence that ZaloPay could not be asked, and the
 * collector can be re-verified by declaring again.
 */
export async function verifyDeclaration(
  client: ZaloPayClient | undefined,
  declaredName: string,
  receiver: VerifyReceiver,
): Promise<VerifyOutcome> {
  if (client === undefined) {
    return { status: 'unverified', verifiedName: null, mUId: null, subCode: null, redirectUrl: null, event: null };
  }
  let result: VerifyAccountResult;
  try {
    /**
     * The verify-account mac covers an amount (§0.3). 1 VND is the wallet
     * minimum (F5) and is a probe, not a payment: verify moves no money.
     */
    result = await client.verifyAccount({ receiver, amountVnd: 1 });
  } catch {
    return { status: 'error', verifiedName: null, mUId: null, subCode: null, redirectUrl: null, event: null };
  }
  return outcomeOf(declaredName, result);
}
