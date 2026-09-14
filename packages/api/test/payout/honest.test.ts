import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../../src/index.ts';
import { signToken } from '../../src/credentials.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../../store/test/db.ts';
import { P1, seedPayout, seedBill, seedAccount, auditRow, uid } from './domain/fixture.ts';

useDatabase('honest');
describe.skipIf(!hasDb())('honest payout demo (SIMULATION, test database only)', () => {
  let app: FastifyInstance;
  beforeEach(truncate);
  afterEach(async () => { await app?.close(); });
  afterAll(closeDb);
  async function setup() {
    const d = await db();
    const ids = await seedPayout(d);
    app = buildApi({ db: await appDb(), tokenSecret: 'k', payout: { zaloPayEnv: 'sandbox' } });
    await app.ready();
    const login = async (operator: string) => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'HCM-01', secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
      return { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
    };
    const finance = await login('fin-hcm');
    const operator = await login('op-hcm');
    const collector = (id = ids.collector1) => ({ authorization: `Bearer ${signToken('k', { kind: 'collector', collectorId: id, epoch: 1 })}` });
    const bill = await seedBill(d, ids, 1, P1, ['679.9992'], '679.9992');
    const mark = (headers = finance, amount = 679) => app.inject({ method: 'POST', url: `/api/payout/bills/${bill}/mark-paid`, headers, payload: { amount_vnd: amount, manual_reference: 'SIMULATION-REF-X' } });
    const snapshot = async () => JSON.stringify(await d.execute(sql`
      select 'bill' as kind, row_to_json(b)::text as row from bills b
      union all select 'settlement', row_to_json(s)::text from settlements s
      union all select 'attempt', row_to_json(a)::text from payout_attempts a order by kind, row
    `));
    return { d, ids, finance, operator, collector, bill, mark, snapshot };
  }

  it('finance declares a destination that collector and finance read as unverified', async () => {
    const h = await setup();
    const declared = await app.inject({ method: 'POST', url: '/api/payout/accounts', headers: h.finance,
      payload: { id: uid(), collector_id: h.ids.collector1, method: 'WALLET', declared_name: 'Nguyen Van A', phone: '0912345678' } });
    expect(declared.statusCode, declared.body).toBe(201);
    const phone = await app.inject({ url: '/api/me/payout', headers: h.collector() });
    expect(phone.json()).toMatchObject({ status: 'awaiting', masked: '•••• 5678' });
    const console = await app.inject({ url: `/api/payout/batches/${P1.start.toISOString()}`, headers: h.finance });
    expect(console.statusCode, console.body).toBe(200);
    expect(console.json().bills[0].account).toMatchObject({ verify_status: 'unverified', declared_name: 'Nguyen Van A' });
    expect(console.json().bills[0].account.phone_masked).toContain('5678');
    expect(phone.body).not.toContain('0912345678');
  });
});
