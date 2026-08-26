/**
 * The seam between this domain and Agent A's ZaloPay client (payout brief,
 * §2.2). Frozen: an agent that needs it changed stops and asks.
 *
 * This file declares the interface and nothing else, so the domain can be
 * built and tested against a hand-written stub (test/payout/domain/stub-client.ts)
 * before the client lands, and so the domain never imports from
 * `payout/zalopay/**` — the client is handed in, the way `ObjectStore` is
 * handed to the upload routes. When the client lands, its `ZaloPayClient`
 * satisfies this one structurally; the result shapes below are written to
 * match the client's own `types.ts` field for field.
 *
 * Every result is a discriminated union — never a thrown error for a business
 * outcome. Transport failure throws; business failure returns. The exception
 * is transfer-fund, where a lost answer may still be a moved payment, so
 * transport failure RETURNS `{ kind: 'unknown' }` — and this domain handles
 * `unknown` by polling, never by retrying. That is the whole point of the
 * interface.
 */

export interface ZaloPayClient {
  verifyAccount(input: VerifyAccountInput): Promise<VerifyAccountResult>;
  transferFund(input: TransferFundInput): Promise<TransferFundResult>;
  queryTransaction(partnerOrderId: string): Promise<QueryTxnResult>;
  balance(): Promise<{ balanceVnd: number }>;
  bankCodes(): Promise<BankCode[]>;
}

/** Verbatim from §2.2. */
export type TransferFundResult =
  | { kind: 'accepted'; zlpOrderId: string; status: 1 | 2 | 3 | 4 }
  | { kind: 'duplicate' } // -68: already exists, go query
  | { kind: 'rejected'; subCode: number; retryable: false }
  | { kind: 'system'; subCode: number; retryable: true }
  | { kind: 'unknown'; cause: 'timeout' | 'network' | 'malformed' };

/** ZaloPay's four transaction states (Part 0, F4). 4 is the trap. */
export type ZlpStatus = 1 | 2 | 3 | 4;

/** The §2.1 vocabulary; the client maps it to ZaloPay's `disbursement_type`. */
export type PayoutMethod = 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD';

/**
 * Part 0, §0.4: verify by PHONE on the wallet route; transfer by the `m_u_id`
 * that only a verify answers with. Two unions, so a phone cannot be sent to
 * transfer-fund by construction.
 */
export type VerifyReceiver =
  | { method: 'WALLET'; phone: string }
  | { method: 'BANK_ACCOUNT'; bankCode: string; accountNo: string; accountHolderName: string }
  | { method: 'BANK_CARD'; bankCode: string; cardNo: string; cardHolderName: string };

export type TransferReceiver =
  | { method: 'WALLET'; mUId: string }
  | { method: 'BANK_ACCOUNT'; bankCode: string; accountNo: string; accountHolderName: string }
  | { method: 'BANK_CARD'; bankCode: string; cardNo: string; cardHolderName: string };

export interface VerifyAccountInput {
  receiver: VerifyReceiver;
  /** The verify-account mac covers an amount (§0.3), so the request carries one. Whole VND. */
  amountVnd: number;
}

export interface TransferFundInput {
  /** `'PO-{bill_id}-{attempt_seq}'`, computed by the database. Passed through untouched. */
  partnerOrderId: string;
  receiver: TransferReceiver;
  /** Whole VND. */
  amountVnd: number;
  description: string;
}

/**
 * verify-account. `-101` and `-406` carry a ZaloPay page the collector must be
 * sent to (§0.5), surfaced as fields on the rejection. Transport failure
 * throws: the call is read-only and may simply be asked again.
 */
export type VerifyAccountResult =
  | {
      kind: 'verified';
      /**
       * ZaloPay's real name for the holder. Compared, never copied over the
       * declared name. Nullable: the official verify-account response carries
       * `account_holder_name` / `card_holder_name` on the bank routes and, on
       * the wallet route, may carry only `m_u_id` and no name at all (bridge
       * review F-35). A wallet that exists but whose holder ZaloPay does not
       * name is a case this domain records rather than guesses about.
       */
      verifiedName: string | null;
      /** Wallet route only; the id the transfer must use. Null on the bank routes. */
      mUId: string | null;
    }
  | {
      kind: 'rejected';
      subCode: number;
      retryable: false;
      /** -101 on the wallet route: where the collector creates a wallet. */
      onboardingUrl?: string;
      /** -406: where the collector raises their KYC limit. */
      reformUrl?: string;
    }
  | { kind: 'system'; subCode: number; retryable: true };

/** query-txn. Transport failure throws — polling again is the only response anyway. */
export type QueryTxnResult =
  | {
      kind: 'found';
      status: ZlpStatus;
      zlpOrderId: string;
      /** Present once SUCCESS; the terminal reference this domain records. */
      zpTransId: string | null;
      amountVnd: number | null;
      /** A display page for humans (F2). Never a callback. */
      resultUrl: string | null;
    }
  | { kind: 'not_found' }
  | { kind: 'rejected'; subCode: number; retryable: false }
  | { kind: 'system'; subCode: number; retryable: true };

export interface BankCode {
  bankCode: string;
  name: string;
}
