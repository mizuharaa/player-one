/**
 * ZaloPay Disbursement — the wire shapes and the result seam.
 *
 * Everything on the wire is transcribed from Part 0 of the payout brief
 * (docs.zalopay.vn + the *Disbursement Technical Specifications* PDF). The PDF
 * itself is not on this machine, so the request field names come from the
 * mac-input orderings in §0.3 and §0.4 — every field a mac covers is a field
 * the request carries — and the response field names come from what §0.2 and
 * §0.5 say each answer contains. The names that Part 0 does not spell out are
 * listed once, in `WIRE_NAMES_TO_CONFIRM` at the bottom, so confirming them
 * against the PDF is one edit here and one in the fake server.
 *
 * This file has no dependencies and no behaviour. `client.ts` speaks it,
 * `fake-server.ts` (test) answers in it, and Agent B consumes only the result
 * unions — never the wire types.
 */

// ---------------------------------------------------------------------------
// Configuration

export type ZaloPayEnv = 'sandbox' | 'production';

/** §0.1 — HTTPS only, POST only. */
export const BASE_URLS: Readonly<Record<ZaloPayEnv, string>> = {
  sandbox: 'https://sb-openapi.zalopay.vn',
  production: 'https://openapi.zalopay.vn',
};

/** §0.1 — the five endpoints, and there are no others (no batch, no webhook). */
export const ENDPOINTS = {
  verifyAccount: '/v2/disbursement/verify-account',
  transferFund: '/v2/disbursement/transfer-fund',
  queryTxn: '/v2/disbursement/query-txn',
  balance: '/v2/disbursement/balance',
  bankCodes: '/v2/disbursement/get-bank-code',
} as const;

export type Endpoint = keyof typeof ENDPOINTS;

/**
 * §0.3 — two signing schemes exist, for two contracts. Which one we hold is
 * escalation §0.7 item 1. `'hmac'` (All-in-One Disbursement) is the only one
 * the client wires; `'hmac-rsa'` (legacy topup) is built in `signing.ts`,
 * exported, and refused at construction until the contract answers.
 */
export type SigningScheme = 'hmac' | 'hmac-rsa';

/** §0.4 — the padding ZaloPay's public key is used with. See `crypto.ts`. */
export type RsaPadding = 'pkcs1' | 'oaep';

export interface ZaloPayConfig {
  env: ZaloPayEnv;
  /** ZaloPay's integer app id. Goes on every request and into every mac. */
  appId: number;
  /** The business wallet the money leaves from. transfer-fund and balance. */
  paymentId: string;
  /**
   * `key1` — signs OUR outbound requests. Never `key2`: that verifies inbound
   * callbacks, and disbursement has none (§0.3, "if a subagent finds itself
   * reaching for key2, something is wrong").
   */
  key1: string;
  /** ZaloPay's RSA public key, PEM. Encrypts `receiver_info` (§0.4). */
  zaloPayPublicKeyPem: string;
  /** Default `'hmac'`. See `SigningScheme`. */
  signing?: SigningScheme;
  /** Only meaningful under `'hmac-rsa'`, which is not wired. Kept so the config shape is complete. */
  rsaPrivateKeyPkcs8Pem?: string;
  /** Default `'pkcs1'`. See `encryptReceiverInfo`. */
  receiverInfoPadding?: RsaPadding;
  /**
   * Overrides the URL `env` implies. For the fake server in tests, or a proxy.
   * `env` still names which credential set this is and is what the boot
   * invariants check.
   */
  baseUrl?: string;
  /** Default 20 000 ms on transfer-fund, 10 000 ms on the rest (Agent A brief, BUILD 3). */
  timeouts?: Partial<Timeouts>;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Injectable clock, ms since epoch. The `time` field and the mac both read it. */
  now?: () => number;
  /**
   * Where "log loudly" goes. Receives structured events that carry no secret
   * and no receiver data (§2.5 rule 1). Default `console.warn`.
   */
  warn?: (event: ZaloPayWarning) => void;
}

export type Timeouts = { transferFundMs: number; otherMs: number };

export const DEFAULT_TIMEOUTS: Readonly<Timeouts> = { transferFundMs: 20_000, otherMs: 10_000 };

export type ZaloPayWarning = {
  event: 'unknown_sub_return_code';
  endpoint: Endpoint;
  returnCode: number;
  subReturnCode: number;
  subReturnMessage: string | null;
  partnerOrderId: string | null;
};

// ---------------------------------------------------------------------------
// Inputs — what Agent B hands us. Plaintext; the client encrypts.

/**
 * The §2.1 vocabulary, so B passes its own `payout_accounts.method` straight
 * through. The wire value is looked up in `WIRE_DISBURSEMENT_TYPE`.
 */
export type PayoutMethod = 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD';

/**
 * §0.4 — verify by PHONE on the wallet route; the transfer route needs the
 * `m_u_id` that only a verify answers with. Two receiver unions, on purpose:
 * the type system will not let a phone be sent to transfer-fund.
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
  /** The mac input for verify-account carries an amount (§0.3), so the request does too. Whole VND. */
  amountVnd: number;
}

export interface TransferFundInput {
  /**
   * §2.1 — `'PO-{bill_id}-{attempt_seq}'`, computed by B's trigger. This client
   * passes it through untouched; ZaloPay rejects a repeat with -68 (F3), which
   * is the double-payment guard at THEIR end.
   */
  partnerOrderId: string;
  receiver: TransferReceiver;
  /** Whole VND. Limits (§0.2 F5) are B's to enforce; this client only refuses a non-integer. */
  amountVnd: number;
  description: string;
  /** Default `"{}"`. The spec is explicit: empty is `"{}"`, not `""` and not omitted. */
  partnerEmbedData?: string;
  /** Default `"{}"`. Same rule. */
  extraInfo?: string;
}

/** The literal the spec wants for "nothing here". */
export const EMPTY_JSON = '{}';

// ---------------------------------------------------------------------------
// Results — the §2.2 seam. Discriminated unions, never a thrown business error.

export type TransportCause = 'timeout' | 'network' | 'malformed';

/** ZaloPay's four transaction states (§0.2 F4). 4 is the trap: only an operator moves it. */
export type ZlpStatus = 1 | 2 | 3 | 4;

export type ZLP_STATUS_NAME = 'SUCCESS' | 'FAIL' | 'PROCESSING' | 'PENDING';
export const ZLP_STATUS: Readonly<Record<ZlpStatus, ZLP_STATUS_NAME>> = {
  1: 'SUCCESS',
  2: 'FAIL',
  3: 'PROCESSING',
  4: 'PENDING',
};

/** Verbatim from §2.2. */
export type TransferFundResult =
  | { kind: 'accepted'; zlpOrderId: string; status: ZlpStatus }
  | { kind: 'duplicate' }
  | { kind: 'rejected'; subCode: number; retryable: false }
  | { kind: 'system'; subCode: number; retryable: true }
  | { kind: 'unknown'; cause: TransportCause };

/**
 * verify-account. `-101` and `-406` carry a ZaloPay page the collector must be
 * sent to (§0.5) — surfaced as fields on the rejection, never swallowed.
 * Transport failure THROWS `ZaloPayTransportError`: the call is read-only and
 * B may simply ask again.
 */
export type VerifyAccountResult =
  | {
      kind: 'verified';
      /**
       * The holder's name as ZaloPay has it — `account_holder_name` on the
       * bank-account route, `card_holder_name` on the card route. B compares;
       * it never overwrites the declared name.
       *
       * NULL ON THE WALLET ROUTE. The official Verify Account response for a
       * wallet carries `m_u_id` and nothing else (docs.zalopay.vn
       * disbursement-query-user response table; the All-in-One guide's wallet
       * example is `"data": {"m_u_id": "..."}`). Part 0.6's "phone lookup
       * returns the account holder's real name" is not what the current spec
       * says, so a wallet payout has no name check from this call — escalated
       * in the handoff, not papered over here. Bridge finding F-35.
       */
      verifiedName: string | null;
      /** Wallet route: the id the transfer must use (§0.4). Null on bank routes. */
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
      /** Present once SUCCESS; what B records as the terminal reference. */
      zpTransId: string | null;
      amountVnd: number | null;
      /** A display page for humans (§0.2 F2). Never a callback. */
      resultUrl: string | null;
    }
  | { kind: 'not_found' }
  | { kind: 'rejected'; subCode: number; retryable: false }
  | { kind: 'system'; subCode: number; retryable: true };

export interface BankCode {
  bankCode: string;
  name: string;
}

/** The frozen §2.2 interface, verbatim. */
export interface ZaloPayClient {
  verifyAccount(input: VerifyAccountInput): Promise<VerifyAccountResult>;
  transferFund(input: TransferFundInput): Promise<TransferFundResult>;
  queryTransaction(partnerOrderId: string): Promise<QueryTxnResult>;
  balance(): Promise<{ balanceVnd: number }>;
  bankCodes(): Promise<BankCode[]>;
}

// ---------------------------------------------------------------------------
// Errors — for the endpoints whose frozen signature leaves no union to return.

/**
 * A request that produced no interpretable answer. Thrown by every endpoint
 * EXCEPT transfer-fund, which returns `{kind:'unknown'}` instead because there
 * a lost answer may still be a moved payment (§2.2).
 *
 *   timeout   no response inside the endpoint's budget
 *   network   could not connect, or the socket died before the body finished
 *   malformed a response arrived and it is not a ZaloPay answer: non-JSON,
 *             wrong shape, or a non-2xx from something in front of ZaloPay
 */
export class ZaloPayTransportError extends Error {
  readonly endpoint: Endpoint;
  override readonly cause: TransportCause;

  constructor(endpoint: Endpoint, cause: TransportCause, detail: string) {
    super(`zalopay ${endpoint}: ${cause} (${detail})`);
    this.name = 'ZaloPayTransportError';
    this.endpoint = endpoint;
    this.cause = cause;
  }
}

/**
 * A business refusal on `balance()` or `bankCodes()`, whose §2.2 signatures
 * return a bare value. The sub code rides on the error so a caller can still
 * tell a maintenance window (-503) from a bad signature (-402).
 */
export class ZaloPayError extends Error {
  readonly endpoint: Endpoint;
  readonly returnCode: number;
  readonly subCode: number;
  readonly retryable: boolean;

  constructor(endpoint: Endpoint, returnCode: number, subCode: number, retryable: boolean, message: string | null) {
    super(`zalopay ${endpoint}: return_code ${returnCode}, sub_return_code ${subCode}${message ? ` (${message})` : ''}`);
    this.name = 'ZaloPayError';
    this.endpoint = endpoint;
    this.returnCode = returnCode;
    this.subCode = subCode;
    this.retryable = retryable;
  }
}

// ---------------------------------------------------------------------------
// Sub return codes — §0.5, transcribed. `class` decides the result kind.

export type SubCodeClass = 'idempotent' | 'ours' | 'user' | 'system';

export interface SubCodeEntry {
  constant: string;
  class: SubCodeClass;
  meaning: string;
}

export const SUB_RETURN_CODES: ReadonlyMap<number, SubCodeEntry> = new Map<number, SubCodeEntry>([
  [-68, { constant: 'DUPLICATE_PARTNER_ORDER_ID', class: 'idempotent', meaning: 'Idempotency hit — treat as success, go query' }],
  [-101, { constant: 'USER_NOT_EXISTS / ORDER_NOT_EXISTS', class: 'user', meaning: 'No wallet, or unknown order' }],
  [-102, { constant: 'WALLET_ID_NOT_SETUP', class: 'ours', meaning: 'Merchant wallet not configured' }],
  [-103, { constant: 'WALLET_ID_NOT_EXIST', class: 'ours', meaning: 'Bad merchant wallet id' }],
  [-104, { constant: 'INVALID_ACCOUNT_NAME', class: 'ours', meaning: 'Bad holder name' }],
  [-105, { constant: 'INVALID_BANK_CODE', class: 'ours', meaning: 'Bad bank code' }],
  [-106, { constant: 'INVALID_BANK_INFO', class: 'ours', meaning: 'Bad account/card' }],
  [-107, { constant: 'BANK_SYSTEM_DISRUPTION', class: 'system', meaning: 'Bank down — retryable as a NEW order' }],
  [-401, { constant: 'ILLEGAL_DATA_REQUEST', class: 'ours', meaning: 'Bad params' }],
  [-402, { constant: 'ILLEGAL_APP_REQUEST', class: 'ours', meaning: 'Bad signature / unauthorised' }],
  [-406, { constant: 'USER_EXCEED_KYC_LIMIT', class: 'user', meaning: 'Wallet receiving limit hit; reform_url returned' }],
  [-500, { constant: 'SYSTEM_ERROR', class: 'system', meaning: 'Retryable' }],
  [-503, { constant: 'SYSTEM_IS_MAINTENANCE', class: 'system', meaning: 'Retryable' }],
  [-1011, { constant: 'USER_HAS_BEEN_LOCKED', class: 'user', meaning: 'Wallet locked' }],
  [-1102, { constant: 'EMPTY_IDENTIFIER', class: 'ours', meaning: 'Empty account name' }],
  [-1103, { constant: 'UNIDENTIFIED_ACCOUNT', class: 'user', meaning: 'ZaloPay account not KYC-verified (risk signal)' }],
  [-1104, { constant: 'WRONG_ACCOUNT_NAME', class: 'ours', meaning: "Name did not match ZaloPay's verified name (risk signal)" }],
]);

// ---------------------------------------------------------------------------
// Wire shapes — what actually crosses the socket. `client.ts` builds them,
// `fake-server.ts` reads them. Field order here mirrors the mac input order.

/** §0.4 — the plaintext JSON that gets RSA-encrypted into `receiver_info`. */
export type ReceiverInfoPayload =
  | { phone: string }
  | { m_u_id: string }
  | { bank_code: string; account_no: string; account_holder_name: string }
  | { bank_code: string; card_no: string; card_holder_name: string };

/**
 * Our §2.1 method → ZaloPay's `disbursement_type`.
 *
 * ZaloPay has TWO wire types, not three: `WALLET` or `BANK`
 * (docs.zalopay.vn/vi/docs/specs/disbursement-query-user, request table;
 * the All-in-One guide's ATM-card transfer example is
 * `"disbursement_type": "BANK"`). A card is told from an account by the
 * encrypted payload — `card_no`/`card_holder_name` versus
 * `account_no`/`account_holder_name` — never by the type. Bridge finding F-34.
 */
export const WIRE_DISBURSEMENT_TYPE: Readonly<Record<PayoutMethod, 'WALLET' | 'BANK'>> = {
  WALLET: 'WALLET',
  BANK_ACCOUNT: 'BANK',
  BANK_CARD: 'BANK',
};

export interface VerifyAccountRequest {
  app_id: number;
  disbursement_type: string;
  /** Encrypted + base64. The SAME string as went into the mac. */
  receiver_info: string;
  amount: number;
  time: number;
  mac: string;
}

export interface TransferFundRequest {
  app_id: number;
  payment_id: string;
  partner_order_id: string;
  disbursement_type: string;
  receiver_info: string;
  amount: number;
  description: string;
  partner_embed_data: string;
  extra_info: string;
  time: number;
  mac: string;
}

export interface QueryTxnRequest {
  app_id: number;
  partner_order_id: string;
  time: number;
  mac: string;
}

export interface BalanceRequest {
  app_id: number;
  payment_id: string;
  time: number;
  mac: string;
}

export interface BankCodesRequest {
  app_id: number;
  time: number;
  mac: string;
}

/**
 * The envelope every answer shares. `return_code`: 1 success, 2 fail,
 * 3 processing. `sub_return_code` refines it (§0.5); on success it is
 * conventionally 1 and is ignored.
 */
export interface ZaloPayEnvelope<Data> {
  return_code: number;
  return_message?: string;
  sub_return_code?: number;
  sub_return_message?: string;
  data?: Data;
}

/**
 * Verify Account `data`, per route (official response table): the wallet
 * route answers `m_u_id` only; the bank-account route `account_holder_name`;
 * the card route `card_holder_name`. `reform_url` comes with -406 and -101 on
 * the wallet route; `onboarding_url` is Part 0.5's name for the -101 page and
 * is read too in case the PDF and the web page differ.
 */
export interface VerifyAccountData {
  m_u_id?: string;
  account_holder_name?: string;
  card_holder_name?: string;
  reform_url?: string;
  onboarding_url?: string;
}

/**
 * Transfer Fund and Query Transaction share one `data` shape on the official
 * pages: the order, its state, and an echo of the receiver (masked phone,
 * account/card fields). `zp_trans_id` and `result_url` are Part 0's names
 * from the PDF and are ABSENT from the current web pages — read when present,
 * never required.
 */
export interface TransferFundData {
  order_id?: string;
  disbursement_type?: string;
  status?: number;
  amount?: number;
  partner_fee?: number;
  zlp_fee?: number;
  server_time?: number;
  m_u_id?: string;
  phone?: string;
  bank_code?: string;
  account_no?: string;
  account_holder_name?: string;
  card_no?: string;
  card_holder_name?: string;
}

export interface QueryTxnData extends TransferFundData {
  zp_trans_id?: string;
  result_url?: string;
}

export interface BalanceData {
  balance?: number;
}

export interface BankCodesData {
  banks?: { bank_code?: string; name?: string }[];
}

/**
 * What the official web pages (docs.zalopay.vn, read 2026-08-26) settled, and
 * what they did not. The PDF named in Part 0 was not on this machine.
 *
 * CONFIRMED from the spec pages and the All-in-One guide's worked examples:
 * `disbursement_type` is `WALLET` | `BANK` (card = BANK); verify-account
 * `data` is `m_u_id` | `account_holder_name` | `card_holder_name` by route;
 * transfer-fund and query-txn `data.order_id`, `.status`, `.amount`; balance
 * `data.balance`; the per-endpoint hmac inputs match Part 0.3 exactly; the
 * signature field is `mac` on verify-account, query-txn, balance and in every
 * transfer-fund example in the guide.
 *
 * STILL OPEN — each is one line here and one in the fake; a wrong one is a
 * -401/-402 on the first sandbox call, not a design change:
 */
export const WIRE_NAMES_TO_CONFIRM = [
  "transfer-fund signature field: the guide's examples send `mac`; the spec page's request table has a row named `sig` (optional) with the HMAC description and no `mac` row. This client sends `mac`.",
  'endpoint URIs (/v2/disbursement/verify-account, transfer-fund, query-txn, balance, get-bank-code) come from Part 0.1; the web pages do not print them',
  'query-txn data.zp_trans_id and data.result_url (Part 0 / PDF) are absent from the current web pages; read when present, never required',
  'get-bank-code request/response shape (data.banks[].bank_code / .name) is not on any page reached',
  "partner_embed_data / extra_info when empty: spec page default is \"{}\" (as Part 0 says); the guide's examples send \"\". This client sends \"{}\".",
  'receiver_info RSA padding (default PKCS#1 v1.5, see crypto.ts)',
] as const;
