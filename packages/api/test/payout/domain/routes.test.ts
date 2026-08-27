import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { open, type Db } from '@playerone/store';
import { buildApi } from '../../../src/index.ts';
import type { PayoutOptions } from '../../../src/payout/domain/config.ts';
import { verifyExport } from '../../../src/payout/domain/export.ts';
import type { RiskReader } from '../../../src/payout/domain/risk.ts';
import { clearHold } from '../../../src/risk/holds.ts';
import { tick } from '../../../src/payout/worker/poll.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase } from '../../../../store/test/db.ts';
import {
  attemptRow,
  auditRow,
  countOf,
  insertAttemptAs,
  P0,
  P1,
  rows,
  seedAccount,
  seedBill,
  seedBills,
  seedFractionalBill,
  seedPayout,
  uid,
  type Ids,
} from './fixture.ts';
import { StubZaloPay } from './stub-client.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('payout_routes');

const SECRET = 'k';
const PRODUCTION = { appId: true, paymentId: true, key1: true, publicKey: true } as const;

/** `mode: 'api'` in a test means production naming with every credential present; the client is the stub. */
const apiMode = (client: StubZaloPay, over: Partial<PayoutOptions> = {}): PayoutOptions => ({
  mode: 'api',
  zaloPayEnv: 'production',
  credentialsPresent: PRODUCTION,
  client,
  ...over,
});

describe.skipIf(!hasDb())('the payout routes', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  type Headers = Record<string, string>;

  async function harness(payout: PayoutOptions = {}, pooled?: Db) {
    const d = await db();
    const ids = await seedPayout(d);
    const app = buildApi({ db: pooled ?? d, tokenSecret: SECRET, payout });
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
    return { d, ids, app, opA, finA, finB, send };
  }

  const wallet = (ids: Ids, over: Record<string, unknown> = {}) => ({
    id: uid(),
    collector_id: ids.collector1,
    method: 'WALLET',
    declared_name: 'Nguyễn Văn A',
    phone: '0912345678',
    ...over,
  });

  // -------------------------------------------------------------------------

  describe('the finance role', () => {
    it('answers 403 on every mutating route for an operator who is not finance', async () => {
      const h = await harness();
      const { bill1 } = await seedBills(h.d, h.ids);
      const attempt = uid();
      for (const [url, payload] of [
        ['/api/payout/accounts', wallet(h.ids)],
        [`/api/payout/bills/${bill1}/pay`, undefined],
        [`/api/payout/bills/${bill1}/mark-paid`, { manual_reference: 'VCB-1', amount_vnd: 2400 }],
        [`/api/payout/attempts/${attempt}/resolve`, { outcome: 'failed', reason: 'x' }],
      ] as const) {
        const res = await h.send('POST', url, h.opA, payload);
        expect(res.statusCode, `${url}: ${res.body}`).toBe(403);
      }
      expect((await h.send('GET', `/api/payout/export/${P1.start.toISOString()}`, h.opA)).statusCode).toBe(403);
      // And nothing happened.
      expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(0);
      expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      // The read routes are open to any operator session, read-only.
      expect((await h.send('GET', `/api/payout/batches/${P1.start.toISOString()}`, h.opA)).statusCode).toBe(200);
      expect((await h.send('POST', `/api/payout/batches/${P1.start.toISOString()}/preflight`, h.opA)).statusCode).toBe(200);
    });

    it('needs both tokens, like every other mutation on this service', async () => {
      const h = await harness();
      const res = await h.app.inject({ method: 'POST', url: '/api/payout/accounts', payload: wallet(h.ids) });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------

  describe('declaring an account verifies it', () => {
    it('stores verified when ZaloPay agrees on the name, whatever the diacritics and order', async () => {
      const stub = new StubZaloPay();
      stub.verify = { kind: 'verified', verifiedName: 'A VAN NGUYEN', mUId: 'mu-77' };
      const h = await harness({ client: stub });
      const body = wallet(h.ids);
      const res = await h.send('POST', '/api/payout/accounts', h.finA, body);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({
        verify_status: 'verified',
        declared_name: 'Nguyễn Văn A',
        verified_name: 'A VAN NGUYEN',
        phone_masked: '******5678',
        onboarding_url: null,
        reform_url: null,
      });
      const [row] = await rows<Record<string, unknown>>(h.d, sql`select * from payout_accounts where id = ${body.id}`);
      expect(row).toMatchObject({ verify_status: 'verified', m_u_id: 'mu-77', declared_name: 'Nguyễn Văn A', is_current: true });
      expect(row!['verified_at']).not.toBeNull();
      expect(await countOf(h.d, sql`select count(*) as n from payout_events`)).toBe(0);
      expect(stub.calls.verifyAccount).toBe(1);
      expect(stub.calls.transferFund).toBe(0);
    });

    it('stores name_mismatch, keeps BOTH names, and tells the risk engine', async () => {
      const stub = new StubZaloPay();
      stub.verify = { kind: 'verified', verifiedName: 'NGUYEN VAN B', mUId: 'mu-77' };
      const h = await harness({ client: stub });
      const body = wallet(h.ids);
      const res = await h.send('POST', '/api/payout/accounts', h.finA, body);
      expect(res.json()).toMatchObject({ verify_status: 'name_mismatch', declared_name: 'Nguyễn Văn A', verified_name: 'NGUYEN VAN B' });
      const [row] = await rows<Record<string, unknown>>(h.d, sql`select declared_name, verified_name from payout_accounts where id = ${body.id}`);
      // The declared name is not "corrected". The discrepancy is the signal.
      expect(row).toEqual({ declared_name: 'Nguyễn Văn A', verified_name: 'NGUYEN VAN B' });
      const events = await rows<{ kind: string; evidence: Record<string, unknown>; collector_id: string }>(h.d, sql`select kind, evidence, collector_id from payout_events`);
      expect(events).toHaveLength(1);
      expect(events[0]!.kind).toBe('IDENT.NAME_MISMATCH');
      expect(events[0]!.collector_id).toBe(h.ids.collector1);
      expect(events[0]!.evidence).toMatchObject({ declared_name: 'Nguyễn Văn A', verified_name: 'NGUYEN VAN B', phone_masked: '******5678' });
      expect(JSON.stringify(events[0]!.evidence)).not.toContain('0912345678');
    });

    it('maps every ZaloPay refusal in the brief, and surfaces the page the collector needs', async () => {
      const cases: [number, Record<string, string>, string, string | null, string | null, string | null][] = [
        [-101, { onboardingUrl: 'https://zalopay.vn/onboard' }, 'no_wallet', 'https://zalopay.vn/onboard', null, 'IDENT.NO_WALLET'],
        [-406, { reformUrl: 'https://zalopay.vn/reform' }, 'kyc_limit', null, 'https://zalopay.vn/reform', 'IDENT.KYC_LIMIT'],
        [-1011, {}, 'locked', null, null, 'IDENT.WALLET_LOCKED'],
        [-1103, {}, 'unverified', null, null, 'IDENT.UNVERIFIED_KYC'],
        [-1104, {}, 'name_mismatch', null, null, 'IDENT.NAME_MISMATCH'],
      ];
      for (const [sub, extra, status, onboarding, reform, event] of cases) {
        await truncate();
        const stub = new StubZaloPay();
        stub.verify = { kind: 'rejected', subCode: sub, retryable: false, ...extra };
        const h = await harness({ client: stub });
        const body = wallet(h.ids);
        const res = await h.send('POST', '/api/payout/accounts', h.finA, body);
        expect(res.statusCode, res.body).toBe(201);
        expect(res.json(), `sub ${sub}`).toMatchObject({ verify_status: status, onboarding_url: onboarding, reform_url: reform, sub_return_code: sub });
        const events = await rows<{ kind: string }>(h.d, sql`select kind from payout_events`);
        expect(events.map((e) => e.kind), `sub ${sub}`).toEqual(event === null ? [] : [event]);
        // The list route hands the page back too, for an app that reloads.
        const list = await h.send('GET', `/api/payout/collectors/${h.ids.collector1}/accounts`, h.opA);
        expect(list.json().accounts[0]).toMatchObject({ verify_status: status, onboarding_url: onboarding, reform_url: reform });
        await h.app.close();
      }
    });

    it('stores only the last four digits of a bank account, and audits no more than that', async () => {
      const stub = new StubZaloPay();
      stub.verify = { kind: 'verified', verifiedName: 'NGUYEN VAN A', mUId: null };
      const h = await harness({ client: stub });
      const body = { id: uid(), collector_id: h.ids.collector2, method: 'BANK_ACCOUNT', declared_name: 'Nguyen Van A', bank_code: 'VCB', account_no: '0071000123456' };
      const res = await h.send('POST', '/api/payout/accounts', h.finB, body);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({ account_no_last4: '3456', verify_status: 'verified' });
      const dump = await rows<{ t: string }>(h.d, sql`select row_to_json(a)::text as t from payout_accounts a`);
      expect(dump[0]!.t).not.toContain('0071000123456');
      const audits = await rows<{ t: string }>(h.d, sql`select after::text as t from audit_events where action = 'payout_account.declare'`);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.t).not.toContain('0071000123456');
      expect(audits[0]!.t).toContain('3456');
      // ZaloPay was asked with the full number, once.
      expect(stub.calls.verifyAccount).toBe(1);
    });

    it('replaces the current account with the new one and keeps the old row', async () => {
      const h = await harness({ client: new StubZaloPay() });
      const first = wallet(h.ids);
      const second = wallet(h.ids, { phone: '0987654321' });
      expect((await h.send('POST', '/api/payout/accounts', h.finA, first)).statusCode).toBe(201);
      expect((await h.send('POST', '/api/payout/accounts', h.finA, second)).statusCode).toBe(201);
      const list = await rows<{ id: string; is_current: boolean }>(h.d, sql`select id, is_current from payout_accounts order by created_at`);
      expect(list).toEqual([
        { id: first.id, is_current: false },
        { id: second.id, is_current: true },
      ]);
      // A replay of the first declaration writes nothing and says so.
      const again = await h.send('POST', '/api/payout/accounts', h.finA, first);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ replayed: true, is_current: false });
      expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(2);
    });

    it('refuses a used id under a different destination, before ZaloPay is asked (F-40)', async () => {
      const stub = new StubZaloPay();
      const h = await harness({ client: stub });
      const original = wallet(h.ids);
      expect((await h.send('POST', '/api/payout/accounts', h.finA, original)).statusCode).toBe(201);
      const bank = { id: uid(), collector_id: h.ids.collector2, method: 'BANK_ACCOUNT', declared_name: 'Nguyen Van A', bank_code: 'VCB', account_no: '0071000123456' };
      expect((await h.send('POST', '/api/payout/accounts', h.finB, bank)).statusCode).toBe(201);
      const asked = stub.calls.verifyAccount;
      expect(asked).toBe(2);

      const different: [string, Record<string, unknown>][] = [
        ['phone', { ...original, phone: '0987654321' }],
        ['declared name', { ...original, declared_name: 'Nguyễn Văn B' }],
        ['collector', { ...original, collector_id: h.ids.collector2 }],
        ['method', { ...bank, id: original.id, collector_id: h.ids.collector1 }],
        ['bank code', { ...bank, bank_code: 'TCB' }],
        ['account number', { ...bank, account_no: '0071000129999' }],
        ['holder name', { ...bank, declared_name: 'Nguyen Van B' }],
      ];
      for (const [what, body] of different) {
        const res = await h.send('POST', '/api/payout/accounts', h.finA, body);
        expect(res.statusCode, what).toBe(409);
        expect(res.json().constraint, what).toBe('payout_accounts_id_reused');
      }
      // ZaloPay was not asked about any of them, and nothing was written.
      expect(stub.calls.verifyAccount).toBe(asked);
      expect(await countOf(h.d, sql`select count(*) as n from payout_accounts`)).toBe(2);
      const [held] = await rows<{ phone: string; declared_name: string }>(h.d, sql`select phone, declared_name from payout_accounts where id = ${original.id}`);
      expect(held).toEqual({ phone: '0912345678', declared_name: 'Nguyễn Văn A' });
      // The same declaration, same last four digits, is still a replay, and still not a vendor call.
      const again = await h.send('POST', '/api/payout/accounts', h.finB, { ...bank, account_no: '0071000123456' });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ replayed: true, account_no_last4: '3456' });
      expect(stub.calls.verifyAccount).toBe(asked);
    });

    it('stores unverified with no client, which the batch view then counts', async () => {
      const h = await harness();
      const res = await h.send('POST', '/api/payout/accounts', h.finA, wallet(h.ids));
      expect(res.json()).toMatchObject({ verify_status: 'unverified', verified_name: null });
      await seedBills(h.d, h.ids);
      const batch = await h.send('GET', `/api/payout/batches/${P1.start.toISOString()}`, h.opA);
      const bills = batch.json().bills as { collector_ref: string; issues: string[] }[];
      expect(bills.find((b) => b.collector_ref === 'c-0001')!.issues).toEqual(['account_unverified']);
      expect(bills.find((b) => b.collector_ref === 'c-0002')!.issues).toEqual(['no_account']);
    });
  });

  // -------------------------------------------------------------------------

  describe('the manual rail: mark-paid', () => {
    it('records a manual attempt with its reference and moves the settlements, audited together', async () => {
      const h = await harness();
      const { bill1, bill2 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const res = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-2026-0824-0001', amount_vnd: 2400 });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({ status: 'succeeded', amount_vnd: 2400, manual_reference: 'VCB-2026-0824-0001', partner_order_id: `PO-${bill1}-1` });
      const states = await rows<{ settlement_state: string }>(h.d, sql`select s.settlement_state from bill_lines l join settlements s on s.id = l.settlement_id where l.bill_id = ${bill1}`);
      expect(states.map((s) => s.settlement_state)).toEqual(['manually_paid', 'manually_paid']);
      // The other collector's bill is untouched.
      const other = await rows<{ settlement_state: string }>(h.d, sql`select s.settlement_state from bill_lines l join settlements s on s.id = l.settlement_id where l.bill_id = ${bill2}`);
      expect(other.map((s) => s.settlement_state)).toEqual(['bill_generated']);
      const audits = await rows<{ operator_id: string; target_id: string }>(h.d, sql`select operator_id, target_id from audit_events where action = 'bill.mark_paid'`);
      expect(audits).toEqual([{ operator_id: h.ids.finA, target_id: res.json().attempt_id }]);
      const batch = await h.send('GET', `/api/payout/batches/${P1.start.toISOString()}`, h.opA);
      expect((batch.json().bills as { id: string; paid: boolean }[]).find((b) => b.id === bill1)!.paid).toBe(true);
    });

    it('requires the amount retyped to be the bill, and the total to be whole dong', async () => {
      const h = await harness();
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const wrong = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2000 });
      expect(wrong.statusCode).toBe(409);
      expect(wrong.json().constraint).toBe('payout_attempts_amount_check');
      const frac = await seedFractionalBill(h.d, h.ids);
      const refused = await h.send('POST', `/api/payout/bills/${frac}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 170 });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().constraint).toBe('payout_attempts_total_fractional');
      expect((await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { amount_vnd: 2400 })).statusCode).toBe(400);
      expect((await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: '  ', amount_vnd: 2400 })).statusCode).toBe(400);
      // Nothing moved.
      expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      expect(await countOf(h.d, sql`select count(*) as n from settlements where settlement_state = 'manually_paid'`)).toBe(0);
    });

    it('will not let the operator who issued the bill pay it', async () => {
      const h = await harness();
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      await auditRow(h.d, h.ids, { action: 'bill.generate', targetTable: 'bills', targetId: bill1, operatorId: h.ids.finA });
      const res = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2400 });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('payout_separation_of_duty');
      expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      const other = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finB, { manual_reference: 'VCB-1', amount_vnd: 2400 });
      expect(other.statusCode, other.body).toBe(201);
    });

    it('pays a bill once', async () => {
      const h = await harness();
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      expect((await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2400 })).statusCode).toBe(201);
      const again = await h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-2', amount_vnd: 2400 });
      expect(again.statusCode).toBe(409);
      // The gate says so before the trigger has to (`payout_attempts_previous_not_failed` is the SQL answer, proved in schema.test.ts).
      expect(again.json().constraint).toBe('payout_already_paid');
      expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(1);
    });

    it('through the real risk reader, a live hold refuses the payment and a cleared hold lets it through', async () => {
      // No `risk` option: the reader is the one `buildApi` wires to the engine.
      const h = await harness({ holdsEnabled: true });
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      // A hold-band run for the bill, in the shape the engine writes, and the hold it raised.
      const run = uid();
      const [t] = await rows<{ v: string }>(h.d, sql`select threshold_version as v from risk_signals where signal_id = 'IDENT.PHONE_SHARED' and superseded_at is null`);
      await h.d.execute(
        sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence)
             values (${run}::uuid, 'bill', ${bill1}, 'META.EVALUATED', ${t!.v}, 0, 'info', '{"findings":1}')`,
      );
      const [flag] = await rows<{ id: string }>(
        h.d,
        sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence)
             values (${run}::uuid, 'bill', ${bill1}, 'IDENT.PHONE_SHARED', ${t!.v}, 60, 'hold', '{}') returning id`,
      );
      // raised_at at millisecond precision, as the engine writes it: the clear
      // row copies it back through a JS Date, and the chain guard compares exactly.
      await h.d.execute(
        sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids) values (${bill1}, ${flag!.id}::uuid, ${new Date().toISOString()}::timestamptz, '{IDENT.PHONE_SHARED}')`,
      );
      const pay = () => h.send('POST', `/api/payout/bills/${bill1}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: 2400 });

      const held = await pay();
      expect(held.statusCode).toBe(409);
      expect(held.json().constraint).toBe('payout_risk_hold');

      const actor = {
        machine: { kind: 'machine' as const, uploadDeviceId: h.ids.machineA, uploadCentreId: h.ids.centreA },
        operator: { kind: 'operator' as const, operatorId: h.ids.finA, uploadCentreId: h.ids.centreA },
      };
      await clearHold(h.d, actor, { billId: bill1, operatorId: h.ids.finA, reason: 'The risk is real and finance pays anyway.', verdict: 'accepted' });
      // The flags have not changed; the hold has. The payment goes.
      const sent = await pay();
      expect(sent.statusCode, sent.body).toBe(201);
      expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(1);
    });

    it('asks the same questions as the API rail: verification, hold and cap (F-41)', async () => {
      const held: RiskReader = {
        billSummary: async (billId) => ({ subjectType: 'bill', subjectId: billId, score: 70, band: 'hold', flags: [] }),
      };
      const settlements = (d: Db, billId: string) =>
        rows<{ settlement_state: string }>(d, sql`select s.settlement_state from bill_lines l join settlements s on s.id = l.settlement_id where l.bill_id = ${billId}`);
      const pay = (h: Awaited<ReturnType<typeof harness>>, billId: string, amount: number) =>
        h.send('POST', `/api/payout/bills/${billId}/mark-paid`, h.finA, { manual_reference: 'VCB-1', amount_vnd: amount });

      // An account ZaloPay did not confirm — every status but verified.
      const h1 = await harness();
      const { bill1 } = await seedBills(h1.d, h1.ids);
      for (const status of ['unverified', 'name_mismatch', 'no_wallet', 'locked', 'kyc_limit', 'error']) {
        await h1.d.execute(sql`update payout_accounts set is_current = false where collector_id = ${h1.ids.collector1}`);
        await seedAccount(h1.d, h1.ids, 1, { verifyStatus: status });
        const res = await pay(h1, bill1, 2400);
        expect(res.statusCode, status).toBe(409);
        expect(res.json().constraint, status).toBe('payout_account_unverified');
      }
      expect(await countOf(h1.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      expect((await settlements(h1.d, bill1)).map((s) => s.settlement_state)).toEqual(['bill_generated', 'bill_generated']);
      await h1.app.close();
      await truncate();

      // A risk hold, while holds are on.
      const h2 = await harness({ risk: held, holdsEnabled: true });
      const b2 = await seedBills(h2.d, h2.ids);
      await seedAccount(h2.d, h2.ids, 1);
      const hold = await pay(h2, b2.bill1, 2400);
      expect(hold.statusCode).toBe(409);
      expect(hold.json().constraint).toBe('payout_risk_hold');
      expect(await countOf(h2.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      await h2.app.close();
      await truncate();

      // Holds off (the pilot default): advisory, and the manual rail pays.
      const h3 = await harness({ risk: held, holdsEnabled: false });
      const b3 = await seedBills(h3.d, h3.ids);
      await seedAccount(h3.d, h3.ids, 1);
      expect((await pay(h3, b3.bill1, 2400)).statusCode).toBe(201);
      await h3.app.close();
      await truncate();

      // Over a configured cap: refused, and the ticket is raised — never silently the cap.
      const h4 = await harness({ capVnd: 2_000 });
      const b4 = await seedBills(h4.d, h4.ids);
      await seedAccount(h4.d, h4.ids, 1);
      await seedAccount(h4.d, h4.ids, 2);
      const capped = await pay(h4, b4.bill1, 2400);
      expect(capped.statusCode).toBe(409);
      expect(capped.json().constraint).toBe('payout_cap_exceeded');
      expect(await countOf(h4.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      const tickets = await rows<{ kind: string; evidence: Record<string, unknown> }>(h4.d, sql`select kind, evidence from payout_events where kind like 'TICKET.%'`);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]!.evidence).toMatchObject({ amount_vnd: 2400, cap_vnd: 2_000 });
      // Under the cap, the other bill pays.
      expect((await pay(h4, b4.bill2, 1200)).statusCode).toBe(201);
    });

    it('refuses the API rail in manual mode', async () => {
      const h = await harness();
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const res = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('payout_mode_manual');
    });
  });

  // -------------------------------------------------------------------------

  describe('the API rail: pay', () => {
    it('sends one transfer and the poller finishes it', async () => {
      const stub = new StubZaloPay();
      const h = await harness(apiMode(stub));
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const res = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({ status: 'processing', partner_order_id: `PO-${bill1}-1`, result: 'ACCEPTED' });
      expect(stub.transfers).toHaveLength(1);
      expect(stub.transfers[0]).toMatchObject({ partnerOrderId: `PO-${bill1}-1`, amountVnd: 2400, receiver: { method: 'WALLET', mUId: 'mu-0001' } });

      const report = await tick(h.d, stub, new Date(Date.now() + 60_000), { pauseMs: 0 });
      expect(report.outcomes.map((o) => o.outcome)).toEqual(['moved']);
      const row = await attemptRow(h.d, res.json().attempt_id);
      expect(row).toMatchObject({ status: 'succeeded', zp_trans_id: `zp-PO-${bill1}-1`, poll_count: 1 });
      expect(stub.calls.transferFund).toBe(1);
    });

    it('THE TEST: a timeout lands in unknown, the poll resolves it, and no second transfer is ever sent', async () => {
      const stub = new StubZaloPay();
      stub.transfer = { kind: 'unknown', cause: 'timeout' };
      const h = await harness(apiMode(stub));
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);

      const res = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({ status: 'unknown', result: 'UNKNOWN' });
      expect(stub.transfers).toHaveLength(1);

      // Paying again is refused by the database, not by the client's count.
      const again = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(again.statusCode).toBe(409);
      expect(again.json().constraint).toBe('payout_attempts_previous_not_failed');
      expect(stub.transfers).toHaveLength(1);

      // The poller resolves it: processing once, then success.
      stub.query = (id, nth) =>
        nth === 1
          ? { kind: 'found', status: 3, zlpOrderId: `zlp-${id}`, zpTransId: null, amountVnd: null, resultUrl: null }
          : { kind: 'found', status: 1, zlpOrderId: `zlp-${id}`, zpTransId: `zp-${id}`, amountVnd: 2400, resultUrl: null };
      const t0 = Date.now() + 60_000;
      expect((await tick(h.d, stub, new Date(t0), { pauseMs: 0 })).outcomes.map((o) => o.to)).toEqual(['processing']);
      expect((await tick(h.d, stub, new Date(t0 + 120_000), { pauseMs: 0 })).outcomes.map((o) => o.to)).toEqual(['succeeded']);
      expect(await attemptRow(h.d, res.json().attempt_id)).toMatchObject({ status: 'succeeded', zlp_order_id: `zlp-PO-${bill1}-1`, poll_count: 2 });
      // The whole point.
      expect(stub.calls.transferFund).toBe(1);
      expect(stub.transfers).toHaveLength(1);
    });

    it('treats -68 as the idempotency working: polls, resolves, no error to the operator', async () => {
      const stub = new StubZaloPay();
      stub.transfer = { kind: 'duplicate' };
      const h = await harness(apiMode(stub));
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const res = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json()).toMatchObject({ status: 'processing', result: 'DUPLICATE' });
      await tick(h.d, stub, new Date(Date.now() + 60_000), { pauseMs: 0 });
      expect((await attemptRow(h.d, res.json().attempt_id))['status']).toBe('succeeded');
      expect(stub.calls.transferFund).toBe(1);
    });

    it('parks status 4 in pending_zlp, which no worker, timeout or count moves — only the operator route', async () => {
      const stub = new StubZaloPay();
      stub.transfer = (i) => ({ kind: 'accepted', zlpOrderId: `zlp-${i.partnerOrderId}`, status: 4 });
      const h = await harness(apiMode(stub));
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const res = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(res.json()).toMatchObject({ status: 'pending_zlp' });
      const id = res.json().attempt_id as string;

      // A worker, a week later, with ZaloPay now claiming success: nothing moves.
      const week = new Date(Date.now() + 8 * 24 * 60 * 60_000);
      const report = await tick(h.d, stub, week, { pauseMs: 0 });
      expect(report.candidates).toBe(0);
      expect(stub.calls.queryTransaction).toBe(0);
      expect((await attemptRow(h.d, id))['status']).toBe('pending_zlp');

      // Neither does raw SQL from a worker, whatever the counters say.
      await expect(h.d.execute(sql`update payout_attempts set status = 'succeeded', poll_count = 99999, last_polled_at = now() - interval '1 year' where id = ${id}`)).rejects.toThrow();
      expect((await attemptRow(h.d, id))['status']).toBe('pending_zlp');

      // The operator route needs a reason.
      expect((await h.send('POST', `/api/payout/attempts/${id}/resolve`, h.finA, { outcome: 'succeeded' })).statusCode).toBe(400);
      expect((await h.send('POST', `/api/payout/attempts/${id}/resolve`, h.opA, { outcome: 'succeeded', reason: 'x' })).statusCode).toBe(403);
      const resolved = await h.send('POST', `/api/payout/attempts/${id}/resolve`, h.finA, {
        outcome: 'succeeded',
        reason: 'ZaloPay ops ticket 4711 confirmed settlement on 2026-08-20',
        zp_trans_id: 'zp-manual-4711',
      });
      expect(resolved.statusCode, resolved.body).toBe(200);
      expect(await attemptRow(h.d, id)).toMatchObject({ status: 'succeeded', zp_trans_id: 'zp-manual-4711' });
      const audit = await rows<{ reason: string }>(h.d, sql`select reason from audit_events where action = 'payout_attempt.resolve'`);
      expect(audit[0]!.reason).toContain('4711');
      // And it is now terminal for the route too.
      expect((await h.send('POST', `/api/payout/attempts/${id}/resolve`, h.finA, { outcome: 'failed', reason: 'again' })).statusCode).toBe(409);
      expect(stub.calls.transferFund).toBe(1);
    });

    it('fails only on a rejection, and lets a new attempt follow it', async () => {
      const stub = new StubZaloPay();
      stub.transfer = { kind: 'rejected', subCode: -1104, retryable: false };
      const h = await harness(apiMode(stub));
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const first = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(first.json()).toMatchObject({ status: 'failed', sub_return_code: -1104, partner_order_id: `PO-${bill1}-1` });
      stub.transfer = (i) => ({ kind: 'accepted', zlpOrderId: `zlp-${i.partnerOrderId}`, status: 1 });
      const second = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(second.statusCode, second.body).toBe(201);
      // A NEW partner_order_id: the failed one is never reused.
      expect(second.json()).toMatchObject({ status: 'succeeded', partner_order_id: `PO-${bill1}-2` });
      expect(stub.transfers.map((t) => t.partnerOrderId)).toEqual([`PO-${bill1}-1`, `PO-${bill1}-2`]);
    });

    it('polls, never fails, on a system error', async () => {
      const stub = new StubZaloPay();
      stub.transfer = { kind: 'system', subCode: -500, retryable: true };
      const h = await harness(apiMode(stub));
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const res = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(res.json()).toMatchObject({ status: 'unknown', sub_return_code: -500 });
    });

    it('fires POST /pay twice at once and writes exactly one attempt — 100 times, under real contention', async () => {
      const stub = new StubZaloPay();
      // Every transfer is accepted as processing, so the winner is never terminal
      // and the loser is refused by the row lock, not by a coincidence of timing.
      stub.transfer = (i) => ({ kind: 'accepted', zlpOrderId: `zlp-${i.partnerOrderId}`, status: 3 });
      const pooled = await open(dbUrl(), { max: 12 });
      try {
        const h = await harness(apiMode(stub), pooled);
        const { bill1 } = await seedBills(h.d, h.ids);
        await seedAccount(h.d, h.ids, 1);

        // Round 0: a burst of a hundred.
        const burst = await Promise.all(Array.from({ length: 100 }, () => h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA)));
        const codes = burst.map((r) => r.statusCode).sort();
        expect(codes.filter((c) => c === 201)).toHaveLength(1);
        expect(codes.filter((c) => c === 409)).toHaveLength(99);
        for (const r of burst.filter((r) => r.statusCode === 409)) {
          expect(r.json().constraint).toBe('payout_attempts_previous_not_failed');
        }
        expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(1);
        expect(stub.transfers).toHaveLength(1);

        // Rounds 1..100: fail the last attempt (a polled status 2, in raw SQL),
        // then two at once. Each round admits exactly one more.
        for (let round = 1; round <= 100; round += 1) {
          await h.d.execute(sql`
            update payout_attempts set status = 'failed'
             where bill_id = ${bill1} and attempt_seq = (select max(attempt_seq) from payout_attempts where bill_id = ${bill1})
          `);
          const pair = await Promise.all([
            h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA),
            h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finB),
          ]);
          expect(pair.map((r) => r.statusCode).sort(), `round ${round}`).toEqual([201, 409]);
          expect(await countOf(h.d, sql`select count(*) as n from payout_attempts where bill_id = ${bill1}`), `round ${round}`).toBe(round + 1);
        }
        expect(stub.transfers).toHaveLength(101);
        const seqs = await rows<{ partner_order_id: string }>(h.d, sql`select partner_order_id from payout_attempts order by attempt_seq`);
        expect(seqs.map((s) => s.partner_order_id)).toEqual(Array.from({ length: 101 }, (_, i) => `PO-${bill1}-${i + 1}`));
        await h.app.close();
      } finally {
        await pooled.close();
      }
    }, 120_000);

    it('refuses a bank bill above 10,000,000 VND by name, sends nothing, and does not split it', async () => {
      const stub = new StubZaloPay();
      const h = await harness(apiMode(stub));
      await seedAccount(h.d, h.ids, 2, { method: 'BANK_ACCOUNT' });
      const big = await seedBill(h.d, h.ids, 2, P1, ['10000001.0000'], '10000001.0000');
      const res = await h.send('POST', `/api/payout/bills/${big}/pay`, h.finA);
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('payout_attempts_bank_ceiling');
      expect(stub.calls.transferFund).toBe(0);
      expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      const batch = await h.send('GET', `/api/payout/batches/${P1.start.toISOString()}`, h.opA);
      expect((batch.json().bills as { issues: string[] }[])[0]!.issues).toContain('over_bank_ceiling');
    });

    it('refuses an unverified or missing account, and a bank account whose full number nobody holds', async () => {
      const stub = new StubZaloPay();
      const h = await harness(apiMode(stub));
      const { bill1, bill2 } = await seedBills(h.d, h.ids);
      const missing = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(missing.json().constraint).toBe('payout_account_missing');
      await seedAccount(h.d, h.ids, 1, { verifyStatus: 'name_mismatch' });
      const mismatch = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(mismatch.json().constraint).toBe('payout_account_unverified');
      await seedAccount(h.d, h.ids, 2, { method: 'BANK_ACCOUNT' });
      // bill2 is 1,200 VND, under the bank minimum, so that is what refuses it first.
      const small = await h.send('POST', `/api/payout/bills/${bill2}/pay`, h.finA);
      expect(small.json().constraint).toBe('payout_attempts_bank_minimum');
      // Over the minimum, the only thing in the way is the number nobody holds.
      const bankBill = await seedBill(h.d, h.ids, 2, P0, ['2400.0000'], '2400.0000');
      const bank = await h.send('POST', `/api/payout/bills/${bankBill}/pay`, h.finA);
      expect(bank.json().constraint).toBe('payout_bank_details_unavailable');
      expect(stub.calls.transferFund).toBe(0);
    });

    it('honours a risk hold only while holds are on, and a cap only when one is set — loudly', async () => {
      const held: RiskReader = {
        billSummary: async (billId) => ({
          subjectType: 'bill',
          subjectId: billId,
          score: 65,
          band: 'hold',
          flags: [{ signalId: 'IDENT.PHONE_SHARED', severity: 'hold', points: 65, evidence: { phones: 1 }, thresholdVersion: 'v1', computedAt: new Date().toISOString() }],
        }),
      };
      const stub = new StubZaloPay();
      const h = await harness(apiMode(stub, { risk: held, holdsEnabled: true, capVnd: 2_000 }));
      const { bill1, bill2 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      await seedAccount(h.d, h.ids, 2);
      const hold = await h.send('POST', `/api/payout/bills/${bill2}/pay`, h.finA);
      expect(hold.json().constraint).toBe('payout_risk_hold');
      const batch = await h.send('GET', `/api/payout/batches/${P1.start.toISOString()}`, h.opA);
      const bills = batch.json().bills as { id: string; issues: string[]; risk: { band: string } }[];
      expect(bills.find((b) => b.id === bill2)!).toMatchObject({ issues: ['risk_hold'], risk: { band: 'hold' } });
      // 2,400 is over a 2,000 cap: refused, and a ticket says so. The cap is never silently paid.
      expect(bills.find((b) => b.id === bill1)!.issues).toEqual(['over_cap', 'risk_hold']);
      // The cap is checked before the hold, and it is loud: a ticket, no attempt.
      const capped = await h.send('POST', `/api/payout/bills/${bill1}/pay`, h.finA);
      expect(capped.json().constraint).toBe('payout_cap_exceeded');
      expect(stub.calls.transferFund).toBe(0);
      expect(await countOf(h.d, sql`select count(*) as n from payout_events where kind = 'TICKET.CAP_EXCEEDED'`)).toBe(1);
      await h.app.close();
      await truncate();

      // Holds off (the pilot default): advisory only. The cap still bites.
      const h2 = await harness(apiMode(stub, { risk: held, holdsEnabled: false, capVnd: 2_000 }));
      const again = await seedBills(h2.d, h2.ids);
      await seedAccount(h2.d, h2.ids, 1);
      await seedAccount(h2.d, h2.ids, 2);
      const capOnly = await h2.send('POST', `/api/payout/bills/${again.bill1}/pay`, h2.finA);
      expect(capOnly.json().constraint).toBe('payout_cap_exceeded');
      const tickets = await rows<{ kind: string }>(h2.d, sql`select kind from payout_events where kind like 'TICKET.%'`);
      expect(tickets.map((t) => t.kind)).toEqual(['TICKET.CAP_EXCEEDED']);
      const ok = await h2.send('POST', `/api/payout/bills/${again.bill2}/pay`, h2.finA);
      expect(ok.statusCode, ok.body).toBe(201);
      expect(stub.calls.transferFund).toBe(1);
    });
  });

  // -------------------------------------------------------------------------

  describe('the preflight', () => {
    it('refuses the whole batch when the balance is short, with the shortfall in VND, and sends nothing', async () => {
      const stub = new StubZaloPay();
      stub.balanceVnd = 3_000;
      const h = await harness(apiMode(stub));
      await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      await seedAccount(h.d, h.ids, 2);
      const res = await h.send('POST', `/api/payout/batches/${P1.start.toISOString()}/preflight`, h.finA);
      expect(res.statusCode, res.body).toBe(200);
      // 3,600 × 1.05 = 3,780 needed; 3,000 held.
      expect(res.json()).toMatchObject({ ok: false, bills: 2, payable: 2, total_vnd: 3_600, required_vnd: 3_780, balance_vnd: 3_000, shortfall_vnd: 780 });
      expect(res.json().refusal).toContain('3780');
      expect(stub.calls.transferFund).toBe(0);
      stub.balanceVnd = 3_780;
      const enough = await h.send('POST', `/api/payout/batches/${P1.start.toISOString()}/preflight`, h.finA);
      expect(enough.json()).toMatchObject({ ok: true, shortfall_vnd: 0 });
    });

    it('counts what an operator has to look at', async () => {
      const h = await harness();
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1, { verifyStatus: 'name_mismatch' });
      await seedAccount(h.d, h.ids, 2, { method: 'BANK_CARD' });
      await seedBill(h.d, h.ids, 2, P0, ['10000001.0000'], '10000001.0000');
      const res = await h.send('POST', `/api/payout/batches/${P0.start.toISOString()}/preflight?period_end=${P1.end.toISOString()}`, h.finA);
      expect(res.json()).toMatchObject({
        ok: false,
        mode: 'manual',
        balance_vnd: null,
        counts: { account_unverified: 1, over_bank_ceiling: 1, no_account: 0 },
        bank_ceiling_vnd: 10_000_000,
        cap_vnd: null,
      });
      expect(res.json().refusal).toContain('no ZaloPay client');
      const exceptions = res.json().exceptions as { id: string; issues: string[] }[];
      expect(exceptions.find((e) => e.id === bill1)!.issues).toEqual(['account_unverified']);
    });
  });

  // -------------------------------------------------------------------------

  describe('the export', () => {
    it('is byte-identical on re-export, records both hashes, and does not move when a verdict flips', async () => {
      const h = await harness();
      const { bill1, bill2 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const url = `/api/payout/export/${P1.start.toISOString()}`;
      const first = await h.send('GET', url, h.finA);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.headers['content-type']).toContain('text/csv');
      const second = await h.send('GET', url, h.finA);
      expect(second.body).toBe(first.body);
      expect(verifyExport(first.body).ok).toBe(true);
      expect(first.headers['x-playerone-file-hash']).toBe(verifyExport(first.body).claimed);

      const exports = await rows<{ file_hash: string; row_count: number }>(h.d, sql`select file_hash, row_count from payout_exports order by exported_at`);
      expect(exports).toHaveLength(2);
      expect(exports[0]!.file_hash).toBe(exports[1]!.file_hash);
      expect(exports[0]!.row_count).toBe(2);
      const stored = await rows<{ bill_id: string; row_hash: string }>(h.d, sql`select bill_id, row_hash from payout_export_rows where export_id = (select id from payout_exports order by exported_at limit 1)`);
      expect(new Set(stored.map((r) => r.bill_id))).toEqual(new Set([bill1, bill2]));
      for (const r of stored) expect(first.body).toContain(`"${r.row_hash}"`);

      // The header says what tax_withheld_vnd is and why; the rows carry stored figures.
      expect(first.body).toContain('tax_withheld_vnd is 0');
      const lines = first.body.split('\r\n').filter((l) => l.startsWith('"'));
      const header = lines[0]!.slice(1, -1).split('","');
      const col = (row: string, name: string) => row.slice(1, -1).split('","')[header.indexOf(name)];
      const r1 = lines.find((l) => l.includes(bill1))!;
      expect(col(r1, 'gross_vnd')).toBe('2400.0000');
      expect(col(r1, 'net_vnd')).toBe('2400.0000');
      expect(col(r1, 'tax_withheld_vnd')).toBe('0');
      expect(col(r1, 'valid_minutes')).toBe('2.000000');
      expect(col(r1, 'rate_vnd')).toBe('1200.0000');
      expect(col(r1, 'episode_count')).toBe('2');
      expect(col(r1, 'collector_name')).toBe('Nguyen Van A');
      expect(col(r1, 'verified_name')).toBe('NGUYEN VAN A');
      expect(col(r1, 'phone_masked')).toBe('******5678');
      expect(col(r1, 'method')).toBe('WALLET');
      expect(col(r1, 'risk_band')).toBe('clear');

      // Flip a verdict upstream (pass -> partial_pass; `fail` would need a zero
      // duration). The amounts were snapshotted; the file is the same bytes.
      await h.d.execute(sql`update episode_reviews set review_state = 'partial_pass' where id in (select episode_review_id from settlements s join bill_lines l on l.settlement_id = s.id where l.bill_id = ${bill1})`);
      const third = await h.send('GET', url, h.finA);
      expect(third.body).toBe(first.body);
    });
  });

  // -------------------------------------------------------------------------

  describe('the income screen', () => {
    it('reports each period with the status vocabulary the app expects', async () => {
      const h = await harness();
      const { bill1 } = await seedBills(h.d, h.ids);
      await seedAccount(h.d, h.ids, 1);
      const older = await seedBill(h.d, h.ids, 1, P0, ['1200.0000'], '1200.0000');
      await insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: older, accountId: (await rows<{ id: string }>(h.d, sql`select id from payout_accounts where collector_id = ${h.ids.collector1}`))[0]!.id, amountVnd: 1200, mode: 'manual', manualReference: 'VCB-0', settledAt: new Date() });
      const res = await h.send('GET', `/api/payout/collectors/${h.ids.collector1}/income`, h.opA);
      expect(res.statusCode, res.body).toBe(200);
      const periods = res.json().periods as { bill_id: string | null; status: string; gross: string; net: string; withheld: string; valid_minutes: string }[];
      expect(periods.find((p) => p.bill_id === bill1)).toMatchObject({ status: 'approved', gross: '2400.0000', net: '2400.0000', withheld: '0', valid_minutes: '2.000000' });
      expect(periods.find((p) => p.bill_id === older)).toMatchObject({ status: 'paid', gross: '1200.0000' });
      expect(res.json().currency).toBe('VND');
      expect((await h.send('GET', `/api/payout/collectors/${uid()}/income`, h.opA)).statusCode).toBe(404);
    });
  });
});
