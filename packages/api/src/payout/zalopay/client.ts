import { encryptReceiverInfo } from './crypto.ts';
import {
  balanceMacParts,
  bankCodesMacParts,
  hmac,
  queryTxnMacParts,
  transferFundMacParts,
  verifyAccountMacParts,
} from './signing.ts';
import {
  BASE_URLS,
  DEFAULT_TIMEOUTS,
  EMPTY_JSON,
  ENDPOINTS,
  SUB_RETURN_CODES,
  WIRE_DISBURSEMENT_TYPE,
  ZaloPayError,
  ZaloPayTransportError,
  type BalanceData,
  type BalanceRequest,
  type BankCode,
  type BankCodesData,
  type BankCodesRequest,
  type Endpoint,
  type QueryTxnData,
  type QueryTxnRequest,
  type QueryTxnResult,
  type ReceiverInfoPayload,
  type Timeouts,
  type TransferFundData,
  type TransferFundInput,
  type TransferFundRequest,
  type TransferFundResult,
  type TransferReceiver,
  type TransportCause,
  type VerifyAccountData,
  type VerifyAccountInput,
  type VerifyAccountRequest,
  type VerifyAccountResult,
  type VerifyReceiver,
  type ZaloPayClient,
  type ZaloPayConfig,
  type ZaloPayEnvelope,
  type ZaloPayWarning,
  type ZlpStatus,
} from './types.ts';

/**
 * The ZaloPay Disbursement HTTP client. A pure adapter: it signs, encrypts,
 * POSTs, and maps what comes back onto the §2.2 result unions. No database, no
 * retry, no knowledge of bills or collectors. Retry policy is Agent B's;
 * amount limits (§0.2 F5) are Agent B's; this file only refuses input that
 * cannot be put on the wire at all.
 *
 * Three things it is careful about, each stated where it is done:
 *
 *   - `receiver_info` is encrypted ONCE and the same string goes into the body
 *     and the mac (`crypto.ts`).
 *   - On transfer-fund, a lost answer is `{kind:'unknown'}`, never a failure:
 *     a timeout after the request left this process may still be a payment
 *     that went through. B polls; nobody retries.
 *   - Nothing here logs a key, a private key, or a receiver (§2.5 rule 1). The
 *     one thing it logs — an unknown sub code — carries endpoint, codes and
 *     `partner_order_id` only.
 */
export class ZaloPayHttpClient implements ZaloPayClient {
  // No parameter properties anywhere in this module: `bin/` runs .ts under
  // Node's strip-only type stripping, which refuses them (RUNNING.md).
  private readonly config: ZaloPayConfig;
  private readonly baseUrl: string;
  private readonly timeouts: Timeouts;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly warn: (event: ZaloPayWarning) => void;

  constructor(config: ZaloPayConfig) {
    this.config = config;
    const signing = config.signing ?? 'hmac';
    if (signing !== 'hmac') {
      // Escalation §0.7 item 1. The legacy scheme is built (`signing.ts`) but
      // its request shape is not in Part 0, so it cannot be wired without
      // guessing. Fail at construction, not on the first payout.
      throw new Error(
        `signing scheme '${signing}' is built but not wired: which contract we hold (All-in-One ` +
          'Disbursement = hmac, legacy topup = hmac-rsa) is an open escalation',
      );
    }
    for (const k of ['key1', 'zaloPayPublicKeyPem', 'paymentId'] as const) {
      if (!config[k]) throw new Error(`ZaloPayConfig.${k} is required`);
    }
    if (!Number.isSafeInteger(config.appId)) throw new Error('ZaloPayConfig.appId must be an integer');
    this.baseUrl = (config.baseUrl ?? BASE_URLS[config.env]).replace(/\/+$/, '');
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
    this.fetchFn = config.fetch ?? fetch;
    this.now = config.now ?? Date.now;
    this.warn = config.warn ?? defaultWarn;
  }

  // -------------------------------------------------------------------------

  async verifyAccount(input: VerifyAccountInput): Promise<VerifyAccountResult> {
    const amount = wholeVnd(input.amountVnd);
    const time = this.now();
    // Encrypted once; `receiver_info` below is the same string in both places.
    const receiver_info = this.encrypt(verifyPayload(input.receiver));
    const unsigned = {
      app_id: this.config.appId,
      disbursement_type: WIRE_DISBURSEMENT_TYPE[input.receiver.method],
      receiver_info,
      amount,
      time,
    };
    const body: VerifyAccountRequest = { ...unsigned, mac: this.sign(verifyAccountMacParts(unsigned)) };

    const r = await this.post<VerifyAccountData>('verifyAccount', body, this.timeouts.otherMs);
    if (r.return_code === 1) {
      // Parsed BY ROUTE, because the official response is route-shaped
      // (see `VerifyAccountData`): a wallet answers only `m_u_id`, an account
      // only `account_holder_name`, a card only `card_holder_name`. Each route
      // requires the one field it is documented to return and nothing else.
      const d = r.data ?? {};
      switch (input.receiver.method) {
        case 'WALLET': {
          if (!nonEmpty(d.m_u_id)) {
            throw new ZaloPayTransportError('verifyAccount', 'malformed', 'wallet success without m_u_id');
          }
          return { kind: 'verified', verifiedName: null, mUId: d.m_u_id };
        }
        case 'BANK_ACCOUNT': {
          if (!nonEmpty(d.account_holder_name)) {
            throw new ZaloPayTransportError('verifyAccount', 'malformed', 'bank-account success without account_holder_name');
          }
          return { kind: 'verified', verifiedName: d.account_holder_name, mUId: null };
        }
        case 'BANK_CARD': {
          if (!nonEmpty(d.card_holder_name)) {
            throw new ZaloPayTransportError('verifyAccount', 'malformed', 'card success without card_holder_name');
          }
          return { kind: 'verified', verifiedName: d.card_holder_name, mUId: null };
        }
      }
    }
    const sub = this.subCode('verifyAccount', r, null);
    if (sub.kind === 'system') return sub;
    // -68 cannot happen on a read; if it does it is a refusal we do not understand as success.
    const rejected: VerifyAccountResult = { kind: 'rejected', subCode: sub.subCode, retryable: false };
    if (typeof r.data?.onboarding_url === 'string') rejected.onboardingUrl = r.data.onboarding_url;
    if (typeof r.data?.reform_url === 'string') rejected.reformUrl = r.data.reform_url;
    return rejected;
  }

  async transferFund(input: TransferFundInput): Promise<TransferFundResult> {
    const amount = wholeVnd(input.amountVnd);
    if (!input.partnerOrderId) throw new TypeError('partnerOrderId is required');
    const time = this.now();
    const receiver_info = this.encrypt(transferPayload(input.receiver));
    const unsigned = {
      app_id: this.config.appId,
      payment_id: this.config.paymentId,
      partner_order_id: input.partnerOrderId,
      disbursement_type: WIRE_DISBURSEMENT_TYPE[input.receiver.method],
      receiver_info,
      amount,
      description: input.description,
      // The spec is explicit: empty is "{}", not "" and not omitted (types.ts).
      partner_embed_data: input.partnerEmbedData || EMPTY_JSON,
      extra_info: input.extraInfo || EMPTY_JSON,
      time,
    };
    const body: TransferFundRequest = { ...unsigned, mac: this.sign(transferFundMacParts(unsigned)) };

    let r: ZaloPayEnvelope<TransferFundData>;
    try {
      r = await this.post<TransferFundData>('transferFund', body, this.timeouts.transferFundMs);
    } catch (err) {
      // §2.2: "kind:'unknown' is the whole point of this interface." The
      // request may have reached ZaloPay. Never a failure; B polls.
      if (err instanceof ZaloPayTransportError) return { kind: 'unknown', cause: err.cause };
      throw err;
    }

    if (r.return_code === 1 || r.return_code === 3) {
      const orderId = r.data?.order_id;
      const status = zlpStatus(r.data?.status ?? (r.return_code === 3 ? 3 : undefined));
      if (typeof orderId !== 'string' || orderId === '' || status === null) {
        // Accepted, but we cannot name the order or its state. Same rule as
        // a lost socket: something may have moved, only a query can tell.
        return { kind: 'unknown', cause: 'malformed' };
      }
      return { kind: 'accepted', zlpOrderId: orderId, status };
    }
    if (r.return_code !== 2 || typeof r.sub_return_code !== 'number') {
      return { kind: 'unknown', cause: 'malformed' };
    }
    const sub = this.subCode('transferFund', r, input.partnerOrderId);
    if (sub.kind === 'idempotent') return { kind: 'duplicate' };
    return sub;
  }

  async queryTransaction(partnerOrderId: string): Promise<QueryTxnResult> {
    if (!partnerOrderId) throw new TypeError('partnerOrderId is required');
    const unsigned = { app_id: this.config.appId, partner_order_id: partnerOrderId, time: this.now() };
    const body: QueryTxnRequest = { ...unsigned, mac: this.sign(queryTxnMacParts(unsigned)) };

    const r = await this.post<QueryTxnData>('queryTxn', body, this.timeouts.otherMs);
    if (r.return_code === 1 || r.return_code === 3) {
      const d = r.data ?? {};
      const status = zlpStatus(d.status);
      if (typeof d.order_id !== 'string' || status === null) {
        throw new ZaloPayTransportError('queryTxn', 'malformed', 'answer without order_id/status');
      }
      return {
        kind: 'found',
        status,
        zlpOrderId: d.order_id,
        zpTransId: typeof d.zp_trans_id === 'string' && d.zp_trans_id !== '' ? d.zp_trans_id : null,
        amountVnd: typeof d.amount === 'number' ? d.amount : null,
        resultUrl: typeof d.result_url === 'string' ? d.result_url : null,
      };
    }
    const sub = this.subCode('queryTxn', r, partnerOrderId);
    if (sub.kind === 'system') return sub;
    if (sub.subCode === -101) return { kind: 'not_found' };
    return { kind: 'rejected', subCode: sub.subCode, retryable: false };
  }

  async balance(): Promise<{ balanceVnd: number }> {
    const unsigned = { app_id: this.config.appId, payment_id: this.config.paymentId, time: this.now() };
    const body: BalanceRequest = { ...unsigned, mac: this.sign(balanceMacParts(unsigned)) };

    const r = await this.post<BalanceData>('balance', body, this.timeouts.otherMs);
    if (r.return_code !== 1) throw this.businessError('balance', r);
    const balance = r.data?.balance;
    if (typeof balance !== 'number' || !Number.isFinite(balance)) {
      throw new ZaloPayTransportError('balance', 'malformed', 'success without a numeric balance');
    }
    return { balanceVnd: balance };
  }

  async bankCodes(): Promise<BankCode[]> {
    const unsigned = { app_id: this.config.appId, time: this.now() };
    const body: BankCodesRequest = { ...unsigned, mac: this.sign(bankCodesMacParts(unsigned)) };

    const r = await this.post<BankCodesData>('bankCodes', body, this.timeouts.otherMs);
    if (r.return_code !== 1) throw this.businessError('bankCodes', r);
    const banks = r.data?.banks;
    if (!Array.isArray(banks)) {
      throw new ZaloPayTransportError('bankCodes', 'malformed', 'success without a banks array');
    }
    return banks.map((b) => {
      if (typeof b?.bank_code !== 'string' || typeof b.name !== 'string') {
        throw new ZaloPayTransportError('bankCodes', 'malformed', 'bank entry without bank_code/name');
      }
      return { bankCode: b.bank_code, name: b.name };
    });
  }

  // -------------------------------------------------------------------------

  private encrypt(payload: ReceiverInfoPayload): string {
    return encryptReceiverInfo(this.config.zaloPayPublicKeyPem, payload, this.config.receiverInfoPadding);
  }

  private sign(parts: string[]): string {
    return hmac(this.config.key1, parts);
  }

  /**
   * One POST, one budget, no retry. Anything that is not a parseable JSON
   * envelope with a numeric `return_code` is a `ZaloPayTransportError`; the
   * caller decides whether that throws (reads) or returns unknown (transfer).
   */
  private async post<Data>(endpoint: Endpoint, body: object, timeoutMs: number): Promise<ZaloPayEnvelope<Data>> {
    let response: Response;
    try {
      response = await this.fetchFn(this.baseUrl + ENDPOINTS[endpoint], {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ZaloPayTransportError(endpoint, classify(err), describe(err));
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      // Headers arrived, the body did not: a reset mid-body reads as a
      // network failure, a timeout while streaming as a timeout.
      throw new ZaloPayTransportError(endpoint, classify(err), describe(err));
    }
    if (!response.ok) {
      throw new ZaloPayTransportError(endpoint, 'malformed', `http ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ZaloPayTransportError(endpoint, 'malformed', `body is not JSON (${text.length} bytes)`);
    }
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { return_code?: unknown }).return_code !== 'number') {
      throw new ZaloPayTransportError(endpoint, 'malformed', 'no numeric return_code');
    }
    return parsed as ZaloPayEnvelope<Data>;
  }

  /**
   * §0.5 → a result kind. Every code in the table maps to exactly one; a code
   * NOT in the table is treated as a system fault (retryable, so B polls or
   * tries a new order rather than giving up) and logged loudly, because the
   * table is what we were told and reality has just disagreed with it.
   */
  private subCode(
    endpoint: Endpoint,
    r: ZaloPayEnvelope<unknown>,
    partnerOrderId: string | null,
  ): { kind: 'idempotent'; subCode: number } | { kind: 'rejected'; subCode: number; retryable: false } | { kind: 'system'; subCode: number; retryable: true } {
    const code = typeof r.sub_return_code === 'number' ? r.sub_return_code : r.return_code;
    const entry = SUB_RETURN_CODES.get(code);
    if (entry === undefined) {
      this.warn({
        event: 'unknown_sub_return_code',
        endpoint,
        returnCode: r.return_code,
        subReturnCode: code,
        subReturnMessage: r.sub_return_message ?? r.return_message ?? null,
        partnerOrderId,
      });
      return { kind: 'system', subCode: code, retryable: true };
    }
    switch (entry.class) {
      case 'idempotent':
        return { kind: 'idempotent', subCode: code };
      case 'system':
        return { kind: 'system', subCode: code, retryable: true };
      case 'ours':
      case 'user':
        return { kind: 'rejected', subCode: code, retryable: false };
    }
  }

  private businessError(endpoint: Endpoint, r: ZaloPayEnvelope<unknown>): ZaloPayError {
    const sub = this.subCode(endpoint, r, null);
    return new ZaloPayError(
      endpoint,
      r.return_code,
      sub.subCode,
      sub.kind === 'system',
      r.sub_return_message ?? r.return_message ?? null,
    );
  }
}

// ---------------------------------------------------------------------------

/**
 * Whole dong, or nothing. Converting `bills.total` (numeric(14,4)) to whole
 * VND is a rounding decision B escalates (Part R5); by the time an amount is
 * here it must already be an integer, and this is the last place that can
 * notice if it is not.
 */
function wholeVnd(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError(`amountVnd must be a positive whole number of dong, got ${amount}`);
  }
  return amount;
}

function zlpStatus(s: unknown): ZlpStatus | null {
  return s === 1 || s === 2 || s === 3 || s === 4 ? s : null;
}

function nonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s !== '';
}

/** §0.4 — verify by phone on the wallet route. */
function verifyPayload(r: VerifyReceiver): ReceiverInfoPayload {
  switch (r.method) {
    case 'WALLET':
      return { phone: r.phone };
    case 'BANK_ACCOUNT':
      return { bank_code: r.bankCode, account_no: r.accountNo, account_holder_name: r.accountHolderName };
    case 'BANK_CARD':
      return { bank_code: r.bankCode, card_no: r.cardNo, card_holder_name: r.cardHolderName };
  }
}

/** §0.4 — transfer by m_u_id on the wallet route. The phone is not accepted here. */
function transferPayload(r: TransferReceiver): ReceiverInfoPayload {
  switch (r.method) {
    case 'WALLET':
      return { m_u_id: r.mUId };
    case 'BANK_ACCOUNT':
      return { bank_code: r.bankCode, account_no: r.accountNo, account_holder_name: r.accountHolderName };
    case 'BANK_CARD':
      return { bank_code: r.bankCode, card_no: r.cardNo, card_holder_name: r.cardHolderName };
  }
}

/**
 * What kind of nothing we got. `AbortSignal.timeout` rejects with a
 * `TimeoutError`; undici reports a dead socket as `TypeError: fetch failed`
 * (connect) or `TypeError: terminated` (mid-body), both with a cause. JSON
 * failures are classified by the caller, so anything else here is network.
 */
function classify(err: unknown): TransportCause {
  const name = (err as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  return 'network';
}

/** For the error message only: never the request, never the body. */
function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code ?? e?.cause?.message;
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}${cause ? ` [${cause}]` : ''}`;
}

function defaultWarn(event: ZaloPayWarning): void {
  console.warn(
    `[zalopay] ${event.event} on ${event.endpoint}: return_code=${event.returnCode} ` +
      `sub_return_code=${event.subReturnCode} partner_order_id=${event.partnerOrderId ?? '-'} ` +
      `message=${JSON.stringify(event.subReturnMessage)} — mapped to {kind:'system', retryable:true}; ` +
      'add the code to SUB_RETURN_CODES once its class is known',
  );
}

// ---------------------------------------------------------------------------

/**
 * The client the environment describes, or null when no ZaloPay credentials
 * are set (no contract yet, manual payout). Mirrors `s3StoreFromEnv`: a
 * partial configuration is a mistake, not a mode, and fails closed naming what
 * is missing. §2.4's production invariant — all of app_id, payment_id, key1
 * and the RSA public key present — is this same check with `env=production`
 * making "nothing set" a failure too, since production without credentials is
 * not a manual-mode configuration, it is a misconfiguration.
 *
 * `PLAYERONE_ZALOPAY_PUBLIC_KEY` may carry a PEM with literal `\n` sequences,
 * as .env files tend to; they are restored.
 */
export function zaloPayClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): ZaloPayHttpClient | null {
  const zenv = env['PLAYERONE_ZALOPAY_ENV'] ?? 'sandbox';
  if (zenv !== 'sandbox' && zenv !== 'production') {
    throw new Error(`PLAYERONE_ZALOPAY_ENV must be sandbox or production, got '${zenv}'`);
  }
  const names = [
    'PLAYERONE_ZALOPAY_APP_ID',
    'PLAYERONE_ZALOPAY_PAYMENT_ID',
    'PLAYERONE_ZALOPAY_KEY1',
    'PLAYERONE_ZALOPAY_PUBLIC_KEY',
  ] as const;
  const present = names.filter((k) => !!env[k]);
  if (present.length === 0 && zenv === 'sandbox') return null;
  const missing = names.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `PLAYERONE_ZALOPAY_ENV=${zenv} but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`,
    );
  }
  const appId = Number(env['PLAYERONE_ZALOPAY_APP_ID']);
  if (!Number.isSafeInteger(appId)) throw new Error('PLAYERONE_ZALOPAY_APP_ID must be an integer');
  const signing = env['PLAYERONE_ZALOPAY_SIGNING'] ?? 'hmac';
  if (signing !== 'hmac' && signing !== 'hmac-rsa') {
    throw new Error(`PLAYERONE_ZALOPAY_SIGNING must be hmac or hmac-rsa, got '${signing}'`);
  }
  return new ZaloPayHttpClient({
    env: zenv,
    appId,
    paymentId: env['PLAYERONE_ZALOPAY_PAYMENT_ID']!,
    key1: env['PLAYERONE_ZALOPAY_KEY1']!,
    zaloPayPublicKeyPem: env['PLAYERONE_ZALOPAY_PUBLIC_KEY']!.replaceAll('\\n', '\n'),
    signing,
    receiverInfoPadding: env['PLAYERONE_ZALOPAY_RSA_PADDING'] === 'oaep' ? 'oaep' : 'pkcs1',
  });
}
