import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential, signToken, verifyToken } from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, violates, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('api');

/**
 * Auth, against a real Postgres and a real Fastify instance.
 *
 * The two criteria that matter here are the ones an attacker would try first:
 * a machine token on its own (§10.8), and an operator reaching into somebody
 * else's centre (§10.7). Both must be refused server-side — the console is
 * software on a machine at a regional counter, so nothing it sends is trusted.
 */

const SECRET = 'test-signing-key';
const uid = () => randomUUID();

/** Two centres, so cross-centre access is a real query and not a mocked one. */
async function seedTwoCentres() {
  const d = await db();
  const ids = {
    centreA: uid(),
    centreB: uid(),
    deviceA: uid(),
    deviceB: uid(),
    operatorA: uid(),
    operatorB: uid(),
  };
  const hash = await hashCredential('correct horse');

  for (const [centre, machine, operator, region] of [
    [ids.centreA, ids.deviceA, ids.operatorA, 'HCM'],
    [ids.centreB, ids.deviceB, ids.operatorB, 'HAN'],
  ] as const) {
    await d.execute(sql`
      insert into upload_centres (id, region, name, status)
        values (${centre}, ${region}, ${'centre ' + region}, 'active')`);
    await d.execute(sql`
      insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
        values (${machine}, ${centre}, ${region + '-IMPORT-01'}, 'active', ${hash})`);
    await d.execute(sql`
      insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${operator}, ${centre}, ${'op-' + region}, 'centre_operator', ${hash})`);
  }
  return ids;
}

describe.skipIf(!hasDb())('operator API auth', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const api = async () => buildApi({ db: await appDb(), tokenSecret: SECRET });

  const login = async (app: Awaited<ReturnType<typeof api>>, region: string) => {
    const machine = await app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: `${region}-IMPORT-01`, secret: 'correct horse' },
    });
    const operator = await app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: `op-${region}`, secret: 'correct horse' },
    });
    expect(machine.statusCode, machine.body).toBe(200);
    expect(operator.statusCode, operator.body).toBe(200);
    return {
      machineToken: machine.json().token as string,
      operatorToken: operator.json().token as string,
      centreId: machine.json().upload_centre_id as string,
    };
  };

  // -- §10.8 ---------------------------------------------------------------

  it('refuses a mutation carrying a machine token but no operator token', async () => {
    // PRD §8.3.2 rule 1: operators log in to the fixed device before importing.
    await seedTwoCentres();
    const app = await api();
    const { machineToken } = await login(app, 'HCM');

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { 'x-machine-token': `Bearer ${machineToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('operator token');
  });

  it('refuses an operator token with no machine token', async () => {
    await seedTwoCentres();
    const app = await api();
    const { operatorToken } = await login(app, 'HCM');

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('machine token');
  });

  it('accepts both together', async () => {
    const ids = await seedTwoCentres();
    const app = await api();
    const { machineToken, operatorToken } = await login(app, 'HCM');

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: {
        'x-machine-token': `Bearer ${machineToken}`,
        authorization: `Bearer ${operatorToken}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().upload_centre_id).toBe(ids.centreA);
    expect(res.json().upload_device_id).toBe(ids.deviceA);
  });

  // -- §10.7 ---------------------------------------------------------------

  it('refuses an operator from centre A addressing centre B', async () => {
    const ids = await seedTwoCentres();
    const app = await api();
    const a = await login(app, 'HCM');

    const res = await app.inject({
      method: 'GET',
      url: `/reference/sync?centre_id=${ids.centreB}`,
      headers: {
        'x-machine-token': `Bearer ${a.machineToken}`,
        authorization: `Bearer ${a.operatorToken}`,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('not your centre');
  });

  it('refuses an operator token spliced onto another centre’s machine', async () => {
    await seedTwoCentres();
    const app = await api();
    const a = await login(app, 'HCM');
    const b = await login(app, 'HAN');

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: {
        'x-machine-token': `Bearer ${b.machineToken}`,
        authorization: `Bearer ${a.operatorToken}`,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('different centres');
  });

  it('never reads the centre from the request', async () => {
    // The token decides. Naming your own centre is allowed and changes nothing.
    const ids = await seedTwoCentres();
    const app = await api();
    const a = await login(app, 'HCM');
    const res = await app.inject({
      method: 'GET',
      url: `/reference/sync?centre_id=${ids.centreA}`,
      headers: {
        'x-machine-token': `Bearer ${a.machineToken}`,
        authorization: `Bearer ${a.operatorToken}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().upload_centre_id).toBe(ids.centreA);
  });

  // -- credentials ---------------------------------------------------------

  it('refuses a wrong secret, a retired machine and an unknown identifier alike', async () => {
    const d = await db();
    const ids = await seedTwoCentres();
    const app = await api();

    const attempts = [
      { machine_identifier: 'HCM-IMPORT-01', secret: 'wrong' },
      { machine_identifier: 'NOPE-01', secret: 'correct horse' },
    ];
    for (const payload of attempts) {
      const res = await app.inject({ method: 'POST', url: '/auth/machine', payload });
      expect(res.statusCode).toBe(401);
      // Same message every time: an unauthenticated caller learns nothing.
      expect(res.json().error).toBe('invalid credentials');
    }

    await d.execute(sql`update upload_devices set status = 'retired' where id = ${ids.deviceA}`);
    const retired = await app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: 'HCM-IMPORT-01', secret: 'correct horse' },
    });
    expect(retired.statusCode).toBe(401);
    expect(retired.json().error).toBe('invalid credentials');
  });

  it('refuses a retired operator, and the token they are already holding', async () => {
    /**
     * `upload_devices` has carried `status` since 0000 and the machine login
     * has always read it. `operators` had none, so there was no way to
     * deactivate a person at all: DELETE is refused by the audit foreign key,
     * an unknown role falls through as an ordinary operator, and blanking
     * `credential_hash` stops only the NEXT sign-in — the cookie already in
     * their browser keeps working for the rest of its twelve hours. Both
     * halves are asserted here, because only the second one is the leaver.
     */
    const d = await db();
    const ids = await seedTwoCentres();
    const app = await api();
    const { machineToken, operatorToken } = await login(app, 'HCM');
    const headers = {
      'x-machine-token': `Bearer ${machineToken}`,
      authorization: `Bearer ${operatorToken}`,
    };
    expect((await app.inject({ method: 'GET', url: '/whoami', headers })).statusCode).toBe(200);

    await d.execute(sql`update operators set status = 'retired' where id = ${ids.operatorA}`);

    const again = await app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: 'op-HCM', secret: 'correct horse' },
    });
    expect(again.statusCode).toBe(401);
    // Same sentence as a wrong secret: a sign-in page names nothing.
    expect(again.json().error).toBe('invalid credentials');

    // The one that matters: the token issued before the change stops now.
    const held = await app.inject({ method: 'GET', url: '/whoami', headers });
    expect(held.statusCode).toBe(401);

    // The machine at that counter is untouched; the person is not.
    expect((await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'HCM-IMPORT-01', secret: 'correct horse' } })).statusCode).toBe(200);
  });

  it('refuses an operator status no login knows how to read', async () => {
    const d = await db();
    const ids = await seedTwoCentres();
    await violates(
      'operators_status_check',
      d.execute(sql`update operators set status = 'on_leave' where id = ${ids.operatorA}`),
    );
  });

  it('refuses a second centre reusing a sign-in name, for a person or a machine', async () => {
    /**
     * `POST /auth/operator` takes a reference and a secret, `POST
     * /auth/machine` an identifier and a secret; neither has a centre to give,
     * so both lookups select on the name alone and take the first row Postgres
     * returns — heap order, which an unrelated UPDATE reorders. Two centres
     * both calling their clerk 'counter-1' inserted cleanly and then one of
     * them was told their password was wrong, and which one changed. 0009
     * settled the same shape for reviewers with `operators_reviewer_ref_key`:
     * make the name unique so the lookup has one row or none. The refusal now
     * lands when the second centre is set up, by name.
     */
    const d = await db();
    const ids = await seedTwoCentres();
    await violates(
      'operators_counter_ref_key',
      d.execute(sql`
        insert into operators (id, upload_centre_id, external_ref, role)
          values (${uid()}, ${ids.centreB}, 'op-HCM', 'centre_operator')`),
    );
    await violates(
      'upload_devices_identifier_key',
      d.execute(sql`
        insert into upload_devices (id, upload_centre_id, machine_identifier, status)
          values (${uid()}, ${ids.centreB}, 'HCM-IMPORT-01', 'active')`),
    );
  });

  it('rejects a tampered, unsigned or expired token', async () => {
    expect(verifyToken(SECRET, undefined)).toBeNull();
    expect(verifyToken(SECRET, 'garbage')).toBeNull();

    const good = signToken(SECRET, {
      kind: 'operator',
      operatorId: uid(),
      uploadCentreId: uid(),
    });
    expect(verifyToken(SECRET, good)).not.toBeNull();
    // A different key must not verify, and neither must a re-signed payload.
    expect(verifyToken('other-key', good)).toBeNull();
    expect(verifyToken(SECRET, `${good.split('.')[0]}.deadbeef`)).toBeNull();

    const stale = signToken(
      SECRET,
      { kind: 'machine', uploadDeviceId: uid(), uploadCentreId: uid() },
      Math.floor(Date.now() / 1e3) - 60 * 60 * 24,
    );
    expect(verifyToken(SECRET, stale)).toBeNull();
  });

  // -- audit ---------------------------------------------------------------

  it('audits every login, naming what it can', async () => {
    const d = await db();
    await seedTwoCentres();
    const app = await api();
    await login(app, 'HCM');

    const rows = (await d.execute(sql`
      select action, target_table, operator_id, upload_device_id from audit_events
      order by action`)) as unknown as Record<string, string | null>[];
    expect(rows.map((r) => r['action'])).toEqual(['machine.login', 'operator.login']);
  });

  it('cannot rewrite or delete an audit row', async () => {
    const d = await db();
    await seedTwoCentres();
    const app = await api();
    await login(app, 'HCM');

    // An audit trail the application can edit is not an audit trail. The trigger
    // holds for every role, including the superuser this suite connects as.
    await violates('append-only', d.execute(sql`update audit_events set action = 'x'`));
    await violates('append-only', d.execute(sql`delete from audit_events`));
  });

  it('cannot write an audit row that names no actor', async () => {
    const d = await db();
    await violates(
      'audit_events_attributed_check',
      d.execute(sql`
        insert into audit_events (action, target_table, target_id)
          values ('handover.create', 'handovers', ${uid()})`),
    );
  });

  it('cannot record a manual resolution without a reason', async () => {
    const d = await db();
    const ids = await seedTwoCentres();
    await violates(
      'audit_events_manual_reason_check',
      d.execute(sql`
        insert into audit_events (action, target_table, target_id, operator_id, upload_device_id, upload_centre_id)
          values ('episode.resolve_manual', 'episodes', ${uid()}, ${ids.operatorA}, ${ids.deviceA}, ${ids.centreA})`),
    );
  });
});
