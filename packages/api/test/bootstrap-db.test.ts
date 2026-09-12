import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/bootstrap.ts';
import { buildApi } from '../src/index.ts';
import { hashCredential, verifyCredential } from '../src/credentials.ts';
import { appDb, closeDb, db, dbUrl, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

// Database-backed: written for the Postgres track; NOT run in the deploy-kit proof.
useDatabase('bootstrap');
const create = [
  '--centre-region', 'HCM', '--centre-name', 'Upload centre HCM-01',
  '--machine', 'counter-1', '--machine-secret', 'machine-private',
  '--operator', 'op-1:administrator:operator-private',
  '--operator', 'fin-1:finance:finance-private',
  '--operator', 'clerk-1:centre_operator:clerk-private',
];
const run = (args = create) => main(args, { DATABASE_URL: dbUrl() });
const change = (flag: string, value: string) => {
  const args = [...create];
  args[args.indexOf(flag) + 1] = value;
  return args;
};
const snapshot = async () => {
  const d = await db();
  return {
    centres: [...await d.execute(sql`select * from upload_centres order by id`)],
    machines: [...await d.execute(sql`select * from upload_devices order by id`)],
    operators: [...await d.execute(sql`select * from operators order by id`)],
  };
};

describe.skipIf(!hasDb())('bootstrap (database-backed; NOT run by deploy-kit)', () => {
  beforeEach(async () => {
    await truncate();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(closeDb);

  it('creates a centre, its machine and all three operator roles, printing ids only', async () => {
    expect(await run()).toBe(0);
    const rows = await snapshot();
    expect(rows.centres).toHaveLength(1);
    expect(rows.machines).toHaveLength(1);
    expect(rows.operators).toHaveLength(3);
    expect(rows.operators.map((row) => row.role).sort()).toEqual(['administrator', 'centre_operator', 'finance']);
    for (const row of [...rows.machines, ...rows.operators]) expect(row.upload_centre_id).toBe(rows.centres[0]!.id);
    expect(console.log).toHaveBeenCalledTimes(5);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    for (const row of [...rows.centres, ...rows.machines, ...rows.operators]) expect(output).toContain(row.id);
    expect(output).not.toMatch(/-private|scrypt\$/);
  });

  it('a second identical run preserves every row, including hashes and retired statuses', async () => {
    expect(await run()).toBe(0);
    const d = await db();
    await d.execute(sql`update operators set status = 'retired' where external_ref = 'op-1' and role <> 'reviewer'`);
    await d.execute(sql`update upload_devices set status = 'retired'`);
    await d.execute(sql`update upload_centres set status = 'suspended'`);
    const before = await snapshot();
    vi.mocked(console.log).mockClear();
    expect(await run()).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(console.log).toHaveBeenCalledTimes(5);
    for (const [line] of vi.mocked(console.log).mock.calls) expect(line).toContain('exists');
  });

  it('the bootstrapped machine and operator authenticate through their real routes', async () => {
    expect(await run()).toBe(0);
    const app = buildApi({ db: await appDb(), tokenSecret: 'bootstrap-test-token' });
    try {
      const machine = await app.inject({ method: 'POST', url: '/auth/machine',
        payload: { machine_identifier: 'counter-1', secret: 'machine-private' } });
      const operator = await app.inject({ method: 'POST', url: '/auth/operator',
        payload: { external_ref: 'op-1', secret: 'operator-private' } });
      expect(machine.statusCode).toBe(200);
      expect(operator.statusCode).toBe(200);
      expect(machine.json().upload_centre_id).toBe(operator.json().upload_centre_id);
      expect(machine.json().token).toBeTruthy();
      expect(operator.json().token).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('rolls back the NEW operator inserted BEFORE the later credential conflict', async () => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    vi.mocked(console.log).mockClear();
    expect(await run([...create.slice(0, 8),
      '--operator', 'new-first:centre_operator:new-private',
      '--operator', 'op-1:administrator:different-private'])).toBe(1);
    expect(await snapshot()).toEqual(before);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--rotate-operator op-1'));
    const d = await db();
    expect(await d.execute(sql`select id from operators where external_ref = 'new-first' and role <> 'reviewer'`)).toHaveLength(0);
  });

  it.each(['machine', 'operator'])('rotating %s changes exactly one hash and no other column', async (kind) => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    const ref = kind === 'machine' ? 'counter-1' : 'op-1';
    expect(await run([`--rotate-${kind}`, ref, `--${kind}-secret`, 'new-private'])).toBe(0);
    const after = await snapshot();
    const collection = kind === 'machine' ? 'machines' : 'operators';
    const row = after[collection].find((row) => kind === 'machine' ? row.machine_identifier === ref : row.external_ref === ref)!;
    const old = before[collection].find((old) => old.id === row.id)!;
    expect(row.credential_hash).not.toBe(old.credential_hash);
    expect(await verifyCredential('new-private', row.credential_hash as string)).toBe(true);
    expect(await verifyCredential(kind === 'machine' ? 'machine-private' : 'operator-private', row.credential_hash as string)).toBe(false);
    row.credential_hash = old.credential_hash;
    expect(after).toEqual(before);
  });

  it.each(['machine', 'operator'])('rotation refuses a missing %s without changing anything', async (kind) => {
    const before = await snapshot();
    expect(await run([`--rotate-${kind}`, 'missing', `--${kind}-secret`, 'private'])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`${kind} 'missing' does not exist`));
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['--rotate-machine', 'counter-1', '--rotate-operator', 'op-1', '--machine-secret', 'private'],
    [...create, '--rotate-machine', 'counter-1'],
    [...create, '--rotate-operator', 'op-1', '--operator-secret', 'private'],
  ])('mixed rotation flags exit 2 without changing rows (%j)', async (...args) => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    expect(await run(args)).toBe(2);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses duplicate exact centre matches when creating a machine', async () => {
    const d = await db();
    for (let i = 0; i < 2; i++) {
      await d.execute(sql`insert into upload_centres (id, region, name, status)
        values (${randomUUID()}, 'HCM', 'Upload centre HCM-01', 'active')`);
    }
    const before = await snapshot();
    expect(await run()).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('multiple centres'));
    expect(await snapshot()).toEqual(before);
  });

  it('reuses the single exact centre when creating another machine', async () => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    expect(await run(change('--machine', 'counter-2'))).toBe(0);
    const after = await snapshot();
    expect(after.centres).toEqual(before.centres);
    expect(after.operators).toEqual(before.operators);
    expect(after.machines).toHaveLength(2);
    expect(after.machines.every((row) => row.upload_centre_id === before.centres[0]!.id)).toBe(true);
  });

  it('an existing machine fixes the centre even if another centre has the same name and region', async () => {
    expect(await run()).toBe(0);
    const d = await db();
    await d.execute(sql`insert into upload_centres (id, region, name, status)
      values (${randomUUID()}, 'HCM', 'Upload centre HCM-01', 'active')`);
    const before = await snapshot();
    expect(await run()).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['centre-region', 'centre-name'])('refuses --%s disagreeing with the existing machine centre', async (flag) => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    expect(await run(change(`--${flag}`, 'different'))).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('counter-1'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`--${flag}`));
    expect(await snapshot()).toEqual(before);
  });

  it('an operator on another centre refuses and rolls back the new centre and machine', async () => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    expect(await run(['--centre-region', 'HAN', '--centre-name', 'Other centre',
      '--machine', 'counter-2', '--machine-secret', 'private',
      '--operator', 'new-first:centre_operator:private',
      '--operator', 'op-1:administrator:operator-private'])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("operator 'op-1'"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('centre differs'));
    expect(await snapshot()).toEqual(before);
  });

  it('an existing operator with another role refuses without overwriting it', async () => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    expect(await run(change('--operator', 'op-1:finance:operator-private'))).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('role differs'));
    expect(await snapshot()).toEqual(before);
  });

  it.each([null, 'malformed-hash'])('absent or malformed stored hashes require rotation (%s)', async (hash) => {
    expect(await run()).toBe(0);
    const d = await db();
    await d.execute(sql`update upload_devices set credential_hash = ${hash}`);
    let before = await snapshot();
    expect(await run()).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--rotate-machine counter-1'));
    expect(await snapshot()).toEqual(before);
    expect(await run(['--rotate-machine', 'counter-1', '--machine-secret', 'machine-private'])).toBe(0);
    await d.execute(sql`update operators set credential_hash = ${hash} where external_ref = 'op-1' and role <> 'reviewer'`);
    before = await snapshot();
    expect(await run()).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--rotate-operator op-1'));
    expect(await snapshot()).toEqual(before);
  });

  it('a different machine secret refuses and names its rotation flag', async () => {
    expect(await run()).toBe(0);
    const before = await snapshot();
    expect(await run(change('--machine-secret', 'different-private'))).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--rotate-machine counter-1'));
    expect(await snapshot()).toEqual(before);
  });

  it('a reviewer reference does not collide with operator creation, reuse or rotation', async () => {
    const d = await db();
    const id = randomUUID();
    await d.execute(sql`insert into operators (id, external_ref, role, credential_hash)
      values (${id}, 'op-1', 'reviewer', ${await hashCredential('reviewer-private')})`);
    const [reviewer] = (await snapshot()).operators;
    expect(await run(['--rotate-operator', 'op-1', '--operator-secret', 'private'])).toBe(1);
    expect(await run()).toBe(0);
    expect(await run()).toBe(0);
    expect(await run(['--rotate-operator', 'op-1', '--operator-secret', 'new-private'])).toBe(0);
    expect((await snapshot()).operators.find((row) => row.id === id)).toEqual(reviewer);
  });

  it('identical machine identifiers and operator references rotate in separate namespaces', async () => {
    expect(await run(change('--machine', 'op-1'))).toBe(0);
    const before = await snapshot();
    expect(await run(['--rotate-machine', 'op-1', '--machine-secret', 'new-machine-private'])).toBe(0);
    const afterMachine = await snapshot();
    expect(afterMachine.operators).toEqual(before.operators);
    expect(afterMachine.machines[0]!.credential_hash).not.toBe(before.machines[0]!.credential_hash);
    expect(await run(['--rotate-operator', 'op-1', '--operator-secret', 'new-operator-private'])).toBe(0);
    expect((await snapshot()).machines).toEqual(afterMachine.machines);
  });
});
