import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { open, type Db } from '@playerone/store';
import { buildApi } from '../../../src/index.ts';
import { clearHold, raiseHold } from '../../../src/risk/holds.ts';
import { tick } from '../../../src/payout/worker/poll.ts';
import { insertAttempt } from '../../../src/payout/domain/attempts.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase, violates } from '../../../../store/test/db.ts';
import { countOf, rows, seedAccount, seedBills, seedPayout, uid } from './fixture.ts';
import { StubZaloPay } from './stub-client.ts';

useDatabase('payout_hold_admission');
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

describe.skipIf(!hasDb())('risk holds and payout admission', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function harness(holdsEnabled?: boolean) {
    const d = await db();
    const ids = await seedPayout(d);
    const { bill1 } = await seedBills(d, ids);
    const account = await seedAccount(d, ids, 1);
    const client = new StubZaloPay();
    const app = buildApi({ db: d, tokenSecret: 'hold-admission-test', payout: {
      mode: 'api', zaloPayEnv: 'production', client, holdsEnabled,
      credentialsPresent: { appId: true, paymentId: true, key1: true, publicKey: true },
    } });
    await app.ready();
    const machine = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'HCM-01', secret: 'pw' } });
    const operator = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: 'fin-hcm', secret: 'pw' } });
    expect(machine.statusCode, machine.body).toBe(200);
    expect(operator.statusCode, operator.body).toBe(200);
    const headers = { 'x-machine-token': `Bearer ${machine.json().token}`, authorization: `Bearer ${operator.json().token}` };
    const actor = {
      machine: { kind: 'machine' as const, uploadDeviceId: ids.machineA, uploadCentreId: ids.centreA },
      operator: { kind: 'operator' as const, operatorId: ids.finA, uploadCentreId: ids.centreA },
    };
    const pay = (rail: 'pay' | 'mark-paid') => app.inject({
      method: 'POST', url: `/api/payout/bills/${bill1}/${rail}`, headers,
      // The request cannot override the server's hold switch.
      payload: { manual_reference: 'offline-fixture-only', amount_vnd: 2400, holdsEnabled: false },
    }).then((response) => response);
    const other = await open(dbUrl());
    const hold = async (tx: Tx) => {
      const run = uid();
      const [signal] = await tx.execute(sql`select threshold_version as version from risk_signals
        where signal_id = 'IDENT.PHONE_SHARED' and superseded_at is null`);
      await tx.execute(sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence)
        values (${run}::uuid, 'bill', ${bill1}, 'META.EVALUATED', ${String(signal!.version)}, 0, 'info', '{"findings":1}')`);
      const [flag] = await tx.execute(sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence)
        values (${run}::uuid, 'bill', ${bill1}, 'IDENT.PHONE_SHARED', ${String(signal!.version)}, 60, 'hold', '{}') returning id`);
      await raiseHold(tx, { billId: bill1, flagId: String(flag!.id), signalIds: ['IDENT.PHONE_SHARED'], now: new Date() });
    };
    const close = async () => { await app.close(); await other.close(); };
    return { d, ids, bill1, account, client, actor, pay, other, hold, close };
  }

  for (const rail of ['pay', 'mark-paid'] as const) {
    it(`${rail} sees a hold committed while attempt admission waits, then admits after clearance`, async () => {
      const h = await harness(true);
      let pending: Promise<LightMyRequestResponse> | undefined;
      let advisoryWait = false;
      try {
        const [connection] = await rows<{ pid: number }>(h.d, sql`select pg_backend_pid() as pid`);
        await h.other.transaction(async (tx) => {
          await h.hold(tx);
          // The real eligibility reader cannot see this uncommitted hold.
          pending = h.pay(rail);
          await expect.poll(async () => {
            const [row] = await tx.execute(sql`select pg_backend_pid() = any(pg_blocking_pids(${connection!.pid})) as blocked`);
            return row!.blocked;
          }, { timeout: 5000, interval: 10 }).toBe(true);
          const [wait] = await tx.execute(sql`select exists(select 1 from pg_locks
            where pid = ${connection!.pid} and locktype = 'advisory' and not granted) as advisory`);
          advisoryWait = wait!.advisory === true;
          expect(h.client.calls.transferFund).toBe(0);
          // Commit while payout is waiting, not before its eligibility read.
        });
        const response = await pending!;
        expect(response.statusCode, response.body).toBe(409);
        expect(response.json().constraint).toBe('payout_risk_hold');
        expect(advisoryWait).toBe(true);
        expect(h.client.calls.transferFund).toBe(0);
        expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
        expect(await countOf(h.d, sql`select count(*) as n from settlements where settlement_state = 'manually_paid'`)).toBe(0);
        await clearHold(h.d, h.actor, { billId: h.bill1, operatorId: h.ids.finA,
          reason: 'Independent fixture evidence checked.', verdict: 'resolved' });
        const cleared = await h.pay(rail);
        expect(cleared.statusCode, cleared.body).toBe(201);
        expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(1);
        expect(h.client.calls.transferFund).toBe(rail === 'pay' ? 1 : 0);
      } finally {
        await pending?.catch(() => undefined);
        await h.close();
      }
    });

    for (const enabled of [false, undefined]) {
      it(`${rail} preserves the ${String(enabled)} hold setting without leaking it across transactions`, async () => {
        const h = await harness(enabled);
        try {
          await h.other.transaction(h.hold);
          const response = await h.pay(rail);
          expect(response.statusCode, response.body).toBe(201);
          expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(1);
          expect(h.client.calls.transferFund).toBe(rail === 'pay' ? 1 : 0);
          const [setting] = await h.d.execute(sql`select current_setting('app.payout_holds_enabled', true) as enabled`);
          expect([null, '']).toContain(setting!.enabled);
        } finally { await h.close(); }
      });
    }
  }

  for (const isolation of ['repeatable read', 'serializable']) {
    it(`fails closed for enabled hold admission under ${isolation}`, async () => {
      const h = await harness(true);
      try {
        await violates('payout_risk_isolation', h.d.transaction(async (tx) => {
          await tx.execute(sql.raw(`set transaction isolation level ${isolation}`));
          await insertAttempt(tx, { id: uid(), billId: h.bill1, payoutAccountId: h.account,
            amountVnd: 2400, mode: 'api', holdsEnabled: true });
        }));
        expect(await countOf(h.d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      } finally { await h.close(); }
    });
  }

  it('still reconciles an admitted transfer when a hold is raised afterward', async () => {
    const h = await harness(true);
    try {
      h.client.transfer = async (input) => {
        // The attempt has committed and been marked submitted before dispatch.
        await h.other.transaction(h.hold);
        return { kind: 'accepted', zlpOrderId: `zlp-${input.partnerOrderId}`, status: 3 };
      };
      const response = await h.pay('pay');
      expect(response.statusCode, response.body).toBe(201);
      await tick(h.d, h.client, new Date(Date.now() + 60_000), { pauseMs: 0, jitter: () => 0 });
      const [attempt] = await h.d.execute(sql`select status from payout_attempts where bill_id = ${h.bill1}`);
      expect(attempt!.status).toBe('succeeded');
      expect(h.client.calls.transferFund).toBe(1);
      expect(await countOf(h.d, sql`select count(*) as n from risk_current_holds where bill_id = ${h.bill1}`)).toBe(1);
    } finally { await h.close(); }
  });
});
