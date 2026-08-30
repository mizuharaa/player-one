import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { open, type Db } from '@playerone/store';
import type { Actor } from '../../../src/actor.ts';
import { buildApi } from '../../../src/index.ts';
import type { PayoutOptions } from '../../../src/payout/domain/config.ts';
import { ZaloPayHttpClient } from '../../../src/payout/zalopay/client.ts';
import type { ZlpStatus } from '../../../src/payout/zalopay/types.ts';
import { appDb, db, dbUrl } from '../../../../store/test/db.ts';
import { insertAttemptAs, rows, seedPayout, type Ids } from '../domain/fixture.ts';
import { startFakeZaloPay, type FakeOrder, type FakeZaloPay, type Received } from '../zalopay/fake-server.ts';

/**
 * The integration harness: Agent A's REAL HTTP client, pointed at Agent A's
 * fake ZaloPay on 127.0.0.1, handed to Agent B's routes and workers through
 * `buildApi`. Nothing is stubbed at the §2.2 seam — the bytes go over a
 * socket, get signed, get encrypted, and come back as JSON — which is the
 * difference between this suite and `test/payout/domain/`, where B drives
 * its domain with a hand-written stub. The seam between A and B is what
 * nobody else's tests cover.
 *
 * Every test asserts on two things: the database, and the fake server's
 * received-request log. `transfers(h)` is the count the payout system rests
 * on; a test that does not read it is not finished.
 *
 * Timeouts are short (1.5 s) so a `hang` scenario resolves inside a test
 * rather than the client's production 20 s budget. The fake's own hang timer
 * is longer than that and is cleared on close.
 */

export const PRODUCTION = { appId: true, paymentId: true, key1: true, publicKey: true } as const;
export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;
export const TRANSFER_TIMEOUT_MS = 1_500;

/** More weekly periods beside the fixture's P0/P1, for corpora that need a bill per (collector, period). */
export const P2 = { start: new Date('2026-08-24T00:00:00Z'), end: new Date('2026-08-31T00:00:00Z') };
export const P3 = { start: new Date('2026-08-31T00:00:00Z'), end: new Date('2026-09-07T00:00:00Z') };
export const P4 = { start: new Date('2026-09-07T00:00:00Z'), end: new Date('2026-09-14T00:00:00Z') };
export const P5 = { start: new Date('2026-09-14T00:00:00Z'), end: new Date('2026-09-21T00:00:00Z') };
export const P6 = { start: new Date('2026-09-21T00:00:00Z'), end: new Date('2026-09-28T00:00:00Z') };

export type Headers = Record<string, string>;

export type Harness = {
  fake: FakeZaloPay;
  client: ZaloPayHttpClient;
  d: Db;
  ids: Ids;
  app: ReturnType<typeof buildApi>;
  /** Signed-in sessions: a plain operator, and the two finance operators (one per centre). */
  opA: Headers;
  finA: Headers;
  finB: Headers;
  send: (method: 'POST' | 'GET', url: string, who: Headers, payload?: unknown) => Promise<LightMyRequestResponse>;
  /** The same people as `Actor`s, for calling B's workers directly. */
  actor: (who: 'opA' | 'finA' | 'finB') => Actor;
  close: () => Promise<void>;
};

export type HarnessOptions = {
  /** `api` (default): production naming with every credential present, the client is the fake. `manual`: the pilot. */
  mode?: 'api' | 'manual';
  /** A pool of this size on the file's database instead of the shared single connection; for concurrency. */
  pool?: number;
  transferFundMs?: number;
  otherMs?: number;
};

export async function harness(over: Partial<PayoutOptions> = {}, opts: HarnessOptions = {}): Promise<Harness> {
  const fake = await startFakeZaloPay();
  const client = new ZaloPayHttpClient({
    ...fake.clientConfig(),
    timeouts: { transferFundMs: opts.transferFundMs ?? TRANSFER_TIMEOUT_MS, otherMs: opts.otherMs ?? TRANSFER_TIMEOUT_MS },
  });
  const pooled = opts.pool === undefined ? null : await open(dbUrl(), { max: opts.pool });
  const d = pooled ?? (await db());
  const ids = await seedPayout(d);
  const mode = opts.mode ?? 'api';
  const payout: PayoutOptions =
    mode === 'api'
      ? { mode: 'api', zaloPayEnv: 'production', credentialsPresent: PRODUCTION, client, ...over }
      : { mode: 'manual', zaloPayEnv: 'sandbox', client, ...over };
  const app = buildApi({ db: await appDb(), tokenSecret: 'k', payout });
  await app.ready();

  const login = async (machine: string, operator: string): Promise<Headers> => {
    const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
    const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
    expect(m.statusCode, m.body).toBe(200);
    expect(o.statusCode, o.body).toBe(200);
    return { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
  };
  const opA = await login('HCM-01', 'op-hcm');
  const finA = await login('HCM-01', 'fin-hcm');
  const finB = await login('HAN-01', 'fin-han');

  const send = async (method: 'POST' | 'GET', url: string, who: Headers, payload?: unknown): Promise<LightMyRequestResponse> =>
    (await app.inject({ method, url, payload: payload as never, headers: who })) as unknown as LightMyRequestResponse;

  const actor = (who: 'opA' | 'finA' | 'finB'): Actor =>
    who === 'finB'
      ? {
          machine: { kind: 'machine', uploadDeviceId: ids.machineB, uploadCentreId: ids.centreB },
          operator: { kind: 'operator', operatorId: ids.finB, uploadCentreId: ids.centreB },
        }
      : {
          machine: { kind: 'machine', uploadDeviceId: ids.machineA, uploadCentreId: ids.centreA },
          operator: { kind: 'operator', operatorId: who === 'finA' ? ids.finA : ids.opA, uploadCentreId: ids.centreA },
        };

  const close = async () => {
    await app.close();
    await fake.close();
    if (pooled !== null) await pooled.close();
  };
  return { fake, client, d, ids, app, opA, finA, finB, send, actor, close };
}

// ---------------------------------------------------------------------------
// The two things every test reads.

/** transfer-fund requests the fake received. THE count. */
export const transfers = (h: Pick<Harness, 'fake'>): Received[] => h.fake.requests('transferFund');
export const queries = (h: Pick<Harness, 'fake'>): Received[] => h.fake.requests('queryTxn');

export const attempt = async (d: Db, id: string): Promise<Record<string, unknown>> =>
  (await rows<Record<string, unknown>>(d, sql`select * from payout_attempts where id = ${id}`))[0]!;

export const attemptsOf = async (d: Db, billId: string): Promise<Record<string, unknown>[]> =>
  rows<Record<string, unknown>>(d, sql`select * from payout_attempts where bill_id = ${billId} order by attempt_seq`);

export const count = async (d: Db, q: ReturnType<typeof sql>): Promise<number> =>
  Number((await rows<{ n: number | string }>(d, q))[0]!.n);

export const attemptCount = (d: Db): Promise<number> => count(d, sql`select count(*) as n from payout_attempts`);

export const ticketKinds = async (d: Db): Promise<string[]> =>
  (await rows<{ kind: string }>(d, sql`select kind from payout_events where kind like 'TICKET.%' order by id`)).map((r) => r.kind);

export const settlementStates = async (d: Db, billId: string): Promise<string[]> =>
  (await rows<{ s: string }>(d, sql`
    select s.settlement_state as s from bill_lines l join settlements s on s.id = l.settlement_id
     where l.bill_id = ${billId} order by s.id
  `)).map((r) => r.s);

export const billTotal = async (d: Db, billId: string): Promise<number> =>
  Number((await rows<{ total: string }>(d, sql`select total::text as total from bills where id = ${billId}`))[0]!.total);

// ---------------------------------------------------------------------------
// Scripting the other side.

/**
 * An order ZaloPay holds that our ledger did not put there through this
 * harness: what a lost answer looks like from their end, or a transfer sent
 * outside the ledger. `orders` is the fake's own map.
 */
export function plantOrder(
  fake: FakeZaloPay,
  partnerOrderId: string,
  status: ZlpStatus,
  amount: number,
  over: Partial<FakeOrder> = {},
): FakeOrder {
  const order: FakeOrder = {
    partnerOrderId,
    orderId: `planted-${partnerOrderId.slice(-8)}`,
    zpTransId: status === 1 ? `ZP-planted-${partnerOrderId.slice(-8)}` : null,
    status,
    amount,
    receiver: { m_u_id: 'mu-0001' },
    ...over,
  };
  fake.orders.set(partnerOrderId, order);
  return order;
}

/**
 * An API attempt walked to `status` along legal edges in raw SQL, the way B's
 * own worker tests do it: inserted `created` by a finance operator (audited),
 * then `submitted`, then the target. `settledAt` backdates a terminal one.
 */
export async function walkTo(
  d: Db,
  ids: Ids,
  input: {
    billId: string;
    accountId: string;
    amountVnd: number;
    status: 'created' | 'submitted' | 'processing' | 'unknown' | 'pending_zlp' | 'succeeded' | 'failed';
    createdAt?: Date;
    settledAt?: Date;
    operator?: string;
    zlpOrderId?: string;
    zpTransId?: string;
  },
): Promise<{ id: string; partnerOrderId: string }> {
  const id = await insertAttemptAs(d, ids, input.operator ?? ids.finA, {
    billId: input.billId,
    accountId: input.accountId,
    amountVnd: input.amountVnd,
    createdAt: input.createdAt,
  });
  if (input.status !== 'created') {
    await d.execute(sql`update payout_attempts set status = 'submitted' where id = ${id}`);
    if (input.status !== 'submitted') {
      await d.execute(sql`
        update payout_attempts
           set status = ${input.status},
               zlp_order_id = ${input.zlpOrderId ?? null}::text,
               zp_trans_id = ${input.zpTransId ?? null}::text,
               settled_at = ${input.settledAt?.toISOString() ?? null}::timestamptz
         where id = ${id}
      `);
    }
  }
  const [row] = await rows<{ partner_order_id: string }>(d, sql`select partner_order_id from payout_attempts where id = ${id}`);
  return { id, partnerOrderId: row!.partner_order_id };
}

export const later = (ms: number): Date => new Date(Date.now() + ms);
