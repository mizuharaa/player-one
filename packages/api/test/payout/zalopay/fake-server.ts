import { generateKeyPairSync, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { decryptReceiverInfo } from '../../../src/payout/zalopay/crypto.ts';
import {
  balanceMacParts,
  bankCodesMacParts,
  hmac,
  queryTxnMacParts,
  transferFundMacParts,
  verifyAccountMacParts,
} from '../../../src/payout/zalopay/signing.ts';
import {
  ENDPOINTS,
  SUB_RETURN_CODES,
  type BalanceRequest,
  type BankCodesRequest,
  type Endpoint,
  type QueryTxnRequest,
  type ReceiverInfoPayload,
  type RsaPadding,
  type TransferFundRequest,
  type VerifyAccountRequest,
  type ZaloPayConfig,
  type ZlpStatus,
} from '../../../src/payout/zalopay/types.ts';

/**
 * A ZaloPay Disbursement that runs on 127.0.0.1 and can be told how to
 * misbehave. Test-only. Agents B and F drive their payout tests against it
 * with no network and no credentials.
 *
 * It answers all five endpoints, verifies every mac with the same `key1` the
 * client was given (a bad signature is a real -402, exactly as ZaloPay would
 * answer), decrypts `receiver_info` with the private half of the keypair it
 * hands the client, and remembers orders — so a second transfer-fund with the
 * same `partner_order_id` gets -68 without anyone scripting it (§0.2 F3) and a
 * query-txn for an order it never saw gets -101.
 *
 * Behaviour is a SCENARIO TABLE: a queue per endpoint, consumed one entry per
 * request, falling back to `defaults` when empty. The queue can hold every sub
 * code in §0.5, all four statuses, a hang past the client's budget, a socket
 * reset mid-body, a 200 with a truncated JSON body, and an arbitrary HTTP
 * status — the chaos the Agent A brief asks for.
 *
 * Every request is logged in `received` with the endpoint, the parsed body,
 * the decrypted receiver, and whether the mac verified. The request COUNT is
 * the assertion the whole payout system rests on ("no second transfer is ever
 * sent"), so it is a method, `requests(endpoint)`, not something to derive.
 */

export type Scenario =
  /** Answer normally. Fields override the defaults for the endpoint. */
  | {
      kind: 'ok';
      /** verify-account: the name ZaloPay has on file. Default derived from the receiver. */
      name?: string;
      /** verify-account wallet route: the m_u_id. Default derived from the phone. */
      mUId?: string;
      /** transfer-fund / query-txn: the order's status. Default 3 on transfer, current on query. */
      status?: ZlpStatus;
      /** balance: the float. Default `defaultBalance`. */
      balance?: number;
      /** get-bank-code: the list. Default two banks. */
      banks?: { bank_code: string; name: string }[];
    }
  /** return_code 2 with this sub code. `extra` lands in `data` (reform_url, onboarding_url). */
  | { kind: 'sub'; subCode: number; message?: string; extra?: Record<string, unknown> }
  /** Hold the response open. Default 20 000 ms — the client's transfer budget. */
  | { kind: 'hang'; ms?: number }
  /** Send headers and half the body, then destroy the socket. */
  | { kind: 'reset' }
  /** A complete 200 whose JSON body stops halfway. */
  | { kind: 'truncated' }
  /** Something in front of ZaloPay answered instead. */
  | { kind: 'http'; status: number; body?: string; contentType?: string };

export type Received = {
  seq: number;
  endpoint: Endpoint;
  at: number;
  body: Record<string, unknown>;
  /** Decrypted `receiver_info`, when the request carried one and it decrypted. */
  receiver: ReceiverInfoPayload | null;
  macValid: boolean;
  scenario: Scenario;
};

export type FakeOrder = {
  partnerOrderId: string;
  orderId: string;
  zpTransId: string | null;
  status: ZlpStatus;
  amount: number;
  receiver: ReceiverInfoPayload | null;
};

export interface FakeZaloPayOptions {
  appId?: number;
  paymentId?: string;
  key1?: string;
  receiverInfoPadding?: RsaPadding;
  /** Whether a bad mac is refused with -402 (default) or merely recorded. */
  strictMac?: boolean;
  defaultBalance?: number;
}

const DEFAULT_BANKS = [
  { bank_code: 'VCB', name: 'Vietcombank' },
  { bank_code: 'TCB', name: 'Techcombank' },
];

/** One RSA keypair per process: generation is the slow part and the key is not the subject under test. */
let cachedKeys: { publicKeyPem: string; privateKeyPem: string } | null = null;
function testKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  if (cachedKeys === null) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    cachedKeys = {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    };
  }
  return cachedKeys;
}

export class FakeZaloPay {
  readonly appId: number;
  readonly paymentId: string;
  readonly key1: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
  readonly padding: RsaPadding;
  strictMac: boolean;
  defaultBalance: number;

  /** The scenario table. Consumed front to back, one per request. */
  readonly queue: Record<Endpoint, Scenario[]> = {
    verifyAccount: [],
    transferFund: [],
    queryTxn: [],
    balance: [],
    bankCodes: [],
  };
  /** What answers when the queue for an endpoint is empty. */
  readonly defaults: Record<Endpoint, Scenario> = {
    verifyAccount: { kind: 'ok' },
    transferFund: { kind: 'ok' },
    queryTxn: { kind: 'ok' },
    balance: { kind: 'ok' },
    bankCodes: { kind: 'ok' },
  };

  readonly received: Received[] = [];
  readonly orders = new Map<string, FakeOrder>();

  private readonly app: FastifyInstance;
  private readonly timers = new Set<NodeJS.Timeout>();
  private seq = 0;
  private orderSeq = 0;
  baseUrl = '';

  constructor(options: FakeZaloPayOptions = {}) {
    this.appId = options.appId ?? 2553;
    this.paymentId = options.paymentId ?? 'PM-TEST';
    this.key1 = options.key1 ?? 'PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL';
    this.padding = options.receiverInfoPadding ?? 'pkcs1';
    this.strictMac = options.strictMac ?? true;
    this.defaultBalance = options.defaultBalance ?? 50_000_000;
    const keys = testKeyPair();
    this.publicKeyPem = keys.publicKeyPem;
    this.privateKeyPem = keys.privateKeyPem;

    // forceCloseConnections: a hung reply is a socket that would otherwise
    // keep `close()` waiting for the client's budget to expire.
    this.app = Fastify({ logger: false, forceCloseConnections: true });
    this.app.post(ENDPOINTS.verifyAccount, (req, reply) => this.handle('verifyAccount', req, reply));
    this.app.post(ENDPOINTS.transferFund, (req, reply) => this.handle('transferFund', req, reply));
    this.app.post(ENDPOINTS.queryTxn, (req, reply) => this.handle('queryTxn', req, reply));
    this.app.post(ENDPOINTS.balance, (req, reply) => this.handle('balance', req, reply));
    this.app.post(ENDPOINTS.bankCodes, (req, reply) => this.handle('bankCodes', req, reply));
  }

  async start(): Promise<this> {
    this.baseUrl = await this.app.listen({ port: 0, host: '127.0.0.1' });
    return this;
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await this.app.close();
  }

  /** A client configuration that talks to this fake. Spread it and override what the test needs. */
  clientConfig(): ZaloPayConfig {
    return {
      env: 'sandbox',
      appId: this.appId,
      paymentId: this.paymentId,
      key1: this.key1,
      zaloPayPublicKeyPem: this.publicKeyPem,
      receiverInfoPadding: this.padding,
      baseUrl: this.baseUrl,
    };
  }

  /** Queue scenarios for the NEXT calls to `endpoint`, in order. */
  plan(endpoint: Endpoint, ...scenarios: Scenario[]): this {
    this.queue[endpoint].push(...scenarios);
    return this;
  }

  /** Requests received for an endpoint, in order. `.length` is the assertion that matters. */
  requests(endpoint: Endpoint): Received[] {
    return this.received.filter((r) => r.endpoint === endpoint);
  }

  /** Move an order along, as ZaloPay's back office would. What a poll then sees. */
  setOrderStatus(partnerOrderId: string, status: ZlpStatus, zpTransId?: string): void {
    const order = this.orders.get(partnerOrderId);
    if (order === undefined) throw new Error(`fake zalopay: no order ${partnerOrderId}`);
    order.status = status;
    if (status === 1) order.zpTransId = zpTransId ?? `ZP${order.orderId}`;
  }

  // -------------------------------------------------------------------------

  private async handle(endpoint: Endpoint, req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scenario = this.queue[endpoint].shift() ?? this.defaults[endpoint];
    const receiver = this.decrypt(body);
    const macValid = this.verifyMac(endpoint, body);
    this.received.push({ seq: ++this.seq, endpoint, at: Date.now(), body, receiver, macValid, scenario });

    // Transport chaos comes first: a broken wire does not care what was signed.
    switch (scenario.kind) {
      case 'hang': {
        reply.hijack();
        const t = setTimeout(() => {
          this.timers.delete(t);
          if (!reply.raw.destroyed) this.raw(reply, 200, this.envelope(2, -500, 'SYSTEM_ERROR'));
        }, scenario.ms ?? 20_000);
        this.timers.add(t);
        return;
      }
      case 'reset': {
        reply.hijack();
        const text = this.answer(endpoint, { kind: 'ok' }, body, receiver);
        reply.raw.writeHead(200, { 'content-type': 'application/json' });
        reply.raw.write(text.slice(0, Math.floor(text.length / 2)));
        reply.raw.socket?.destroy();
        return;
      }
      case 'truncated': {
        reply.hijack();
        const text = this.answer(endpoint, { kind: 'ok' }, body, receiver);
        this.raw(reply, 200, text.slice(0, Math.floor(text.length / 2)));
        return;
      }
      case 'http': {
        reply.hijack();
        this.raw(reply, scenario.status, scenario.body ?? '', scenario.contentType ?? 'text/html');
        return;
      }
      default:
        break;
    }

    if (Number(body['app_id']) !== this.appId || (this.strictMac && !macValid)) {
      return reply.code(200).send(JSON.parse(this.envelope(2, -402, 'ILLEGAL_APP_REQUEST')));
    }
    return reply.code(200).header('content-type', 'application/json').send(this.answer(endpoint, scenario, body, receiver));
  }

  /** The JSON text for a business answer. Also what the chaos cases cut in half. */
  private answer(
    endpoint: Endpoint,
    scenario: Extract<Scenario, { kind: 'ok' | 'sub' }>,
    body: Record<string, unknown>,
    receiver: ReceiverInfoPayload | null,
  ): string {
    if (scenario.kind === 'sub') {
      const entry = SUB_RETURN_CODES.get(scenario.subCode);
      return this.envelope(2, scenario.subCode, scenario.message ?? entry?.constant ?? 'UNKNOWN', scenario.extra);
    }
    switch (endpoint) {
      case 'verifyAccount': {
        const data: Record<string, unknown> = { receiver_name: scenario.name ?? nameFor(receiver) };
        if (receiver !== null && 'phone' in receiver) data['m_u_id'] = scenario.mUId ?? `MU-${receiver.phone}`;
        return this.envelope(1, 1, 'SUCCESS', data);
      }
      case 'transferFund': {
        const partnerOrderId = String(body['partner_order_id'] ?? '');
        if (this.orders.has(partnerOrderId)) {
          return this.envelope(2, -68, 'DUPLICATE_PARTNER_ORDER_ID');
        }
        const status = scenario.status ?? 3;
        const order: FakeOrder = {
          partnerOrderId,
          orderId: `${Date.now().toString().slice(-6)}${String(++this.orderSeq).padStart(6, '0')}`,
          zpTransId: status === 1 ? `ZP${this.orderSeq}` : null,
          status,
          amount: Number(body['amount']),
          receiver,
        };
        this.orders.set(partnerOrderId, order);
        // An `ok` scenario is "the order was created and this is its state",
        // whatever the state — so FAIL (2) rides a success envelope with an
        // order id, and is the §2.2 `accepted, status 2`. A refusal at submit
        // (no order, sub code) is the `sub` scenario.
        return this.envelope(status === 3 ? 3 : 1, 1, statusName(status), {
          order_id: order.orderId,
          partner_order_id: partnerOrderId,
          status,
        });
      }
      case 'queryTxn': {
        const order = this.orders.get(String(body['partner_order_id'] ?? ''));
        if (order === undefined) return this.envelope(2, -101, 'ORDER_NOT_EXISTS');
        const status = scenario.status ?? order.status;
        return this.envelope(status === 3 ? 3 : 1, 1, statusName(status), {
          order_id: order.orderId,
          partner_order_id: order.partnerOrderId,
          zp_trans_id: status === 1 ? (order.zpTransId ?? `ZP${order.orderId}`) : undefined,
          status,
          amount: order.amount,
          result_url: `https://sb-openapi.zalopay.vn/result/${order.orderId}`,
        });
      }
      case 'balance':
        return this.envelope(1, 1, 'SUCCESS', { balance: scenario.balance ?? this.defaultBalance });
      case 'bankCodes':
        return this.envelope(1, 1, 'SUCCESS', { banks: scenario.banks ?? DEFAULT_BANKS });
    }
  }

  private envelope(returnCode: number, subCode: number, message: string, data?: Record<string, unknown>): string {
    return JSON.stringify({
      return_code: returnCode,
      return_message: returnCode === 1 ? 'SUCCESS' : returnCode === 3 ? 'PROCESSING' : 'FAIL',
      sub_return_code: subCode,
      sub_return_message: message,
      ...(data === undefined ? {} : { data }),
    });
  }

  private raw(reply: FastifyReply, status: number, text: string, contentType = 'application/json'): void {
    reply.raw.writeHead(status, { 'content-type': contentType, 'content-length': String(Buffer.byteLength(text)) });
    reply.raw.end(text);
  }

  private decrypt(body: Record<string, unknown>): ReceiverInfoPayload | null {
    const ri = body['receiver_info'];
    if (typeof ri !== 'string') return null;
    try {
      return decryptReceiverInfo<ReceiverInfoPayload>(this.privateKeyPem, ri, this.padding);
    } catch {
      return null;
    }
  }

  /**
   * Rebuilds the mac input from the received body with the same per-endpoint
   * builders the client uses, so what this checks is that the client put the
   * right fields in the right order and signed the same `receiver_info` it
   * sent. The builders themselves are pinned against vectors in `fixtures.ts`.
   */
  private verifyMac(endpoint: Endpoint, body: Record<string, unknown>): boolean {
    const mac = body['mac'];
    if (typeof mac !== 'string') return false;
    let parts: string[];
    try {
      switch (endpoint) {
        case 'verifyAccount': {
          const b = body as unknown as VerifyAccountRequest;
          parts = verifyAccountMacParts(b);
          break;
        }
        case 'transferFund': {
          const b = body as unknown as TransferFundRequest;
          parts = transferFundMacParts(b);
          break;
        }
        case 'queryTxn':
          parts = queryTxnMacParts(body as unknown as QueryTxnRequest);
          break;
        case 'balance':
          parts = balanceMacParts(body as unknown as BalanceRequest);
          break;
        case 'bankCodes':
          parts = bankCodesMacParts(body as unknown as BankCodesRequest);
          break;
      }
    } catch {
      return false;
    }
    const expected = Buffer.from(hmac(this.key1, parts), 'utf8');
    const got = Buffer.from(mac, 'utf8');
    return expected.length === got.length && timingSafeEqual(expected, got);
  }
}

function statusName(status: ZlpStatus): string {
  return { 1: 'SUCCESS', 2: 'FAIL', 3: 'PROCESSING', 4: 'PENDING' }[status];
}

/** A plausible verified name for a receiver, so the default `ok` verify answers with something. */
function nameFor(receiver: ReceiverInfoPayload | null): string {
  if (receiver === null) return 'NGUYEN VAN A';
  if ('account_holder_name' in receiver) return receiver.account_holder_name;
  if ('card_holder_name' in receiver) return receiver.card_holder_name;
  return 'NGUYEN VAN A';
}

/** Start one and hand it back. `await fake.close()` in `afterAll`. */
export async function startFakeZaloPay(options: FakeZaloPayOptions = {}): Promise<FakeZaloPay> {
  return new FakeZaloPay(options).start();
}
