import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, hasDb, truncate, useDatabase } from './db.ts';

useDatabase('app_role');

/**
 * Migration 0021: the role the application connects as, and what it cannot do.
 *
 * The hole this closes was measured on a migrated database, connected exactly
 * as the API connects (as `postgres`): `TRUNCATE audit_events` succeeded, and
 * `ALTER TABLE audit_events DISABLE TRIGGER` followed by an `UPDATE` rewrote a
 * row of the trail. Both are refused below under `playerone_app`.
 *
 * Every statement runs inside its own transaction with `SET LOCAL ROLE`, so a
 * refusal rolls back only itself and the connection is a plain one again
 * afterwards. Postgres drops a superuser's bypass for the duration of a role
 * change, which is what makes this a real check and not a description of one.
 */
describe.skipIf(!hasDb())('the application database role', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const asApp = async (statement: string): Promise<Record<string, unknown>[]> => {
    const d = await db();
    return (await d.transaction(async (tx) => {
      await tx.execute(sql`set local role playerone_app`);
      return tx.execute(sql.raw(statement));
    })) as unknown as Record<string, unknown>[];
  };

  /**
   * Asserts Postgres refused, and refused for the stated reason.
   *
   * Drizzle wraps the driver error as "Failed query: …", so `rejects.toThrow`
   * on the wrapper matches any failure at all — including a typo in this file's
   * own SQL. Same argument, and same walk, as `violates()` next door.
   */
  const refused = async (statement: string, because: RegExp): Promise<void> => {
    let caught: unknown;
    try {
      await asApp(statement);
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected Postgres to refuse: ${statement}`).toBeDefined();
    const seen: string[] = [];
    for (let e: unknown = caught; e !== undefined && e !== null; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: string }).message;
      if (message !== undefined) seen.push(message);
    }
    expect(seen.join(' | '), `refused, but not ${because}`).toMatch(because);
  };

  const loginRow = (id: string) =>
    `insert into audit_events (action, target_table, target_id, actor_role)
     values ('machine.login', 'upload_devices', '${id}', 'operator')`;

  it('exists, and the migrating user may become it', async () => {
    const [row] = await asApp('select current_user as who, rolsuper from pg_roles where rolname = current_user');
    expect(row?.['who']).toBe('playerone_app');
    // Not a superuser: everything below follows from this and from owning nothing.
    expect(row?.['rolsuper']).toBe(false);
  });

  it('can append to the audit trail, which is the whole of what mutate needs', async () => {
    await asApp(loginRow(randomUUID()));
    const [count] = await asApp('select count(*)::int as n from audit_events');
    expect(count?.['n']).toBe(1);
  });

  it('cannot truncate the audit trail', async () => {
    // Measured as succeeding before this migration.
    await refused('truncate table audit_events', /permission denied/i);
  });

  it('cannot disable the append-only trigger, so it cannot rewrite history', async () => {
    // The other measured route: DISABLE TRIGGER, then UPDATE. It fails at the
    // first step because the role does not own the table.
    await refused(
      'alter table audit_events disable trigger audit_events_append_only',
      /must be owner|permission denied/i,
    );

    await asApp(loginRow(randomUUID()));
    // And the UPDATE itself is refused by the grant, before the trigger is
    // even reached — two locks, either of which is enough.
    await refused("update audit_events set action = 'nothing happened'", /permission denied/i);
    await refused('delete from audit_events', /permission denied/i);
    const [after] = await asApp("select count(*)::int as n from audit_events where action = 'machine.login'");
    expect(after?.['n']).toBe(1);
  });

  it('reads, inserts and updates ordinary tables, and deletes from none of them', async () => {
    const id = randomUUID();
    await asApp(
      `insert into upload_centres (id, region, name, status) values ('${id}', 'HCM', 'A', 'active')`,
    );
    await asApp(`update upload_centres set name = 'B' where id = '${id}'`);
    const [row] = await asApp(`select name from upload_centres where id = '${id}'`);
    expect(row?.['name']).toBe('B');
    // DELETE is granted on `cloud_verifications` and nowhere else, because that
    // is the only table this codebase deletes a row from.
    await refused(`delete from upload_centres where id = '${id}'`, /permission denied/i);
  });

  it('is a member of playerone_risk, which the engine takes SET LOCAL ROLE to', async () => {
    // Asserted as membership rather than by doing it: `SET ROLE` is checked
    // against the SESSION user, which is a superuser here, so actually taking
    // the role would pass even with the grant missing. On a deployment the
    // session user IS playerone_app and this grant is the whole difference
    // between the engine running and every evaluation refusing (0016).
    const [row] = await asApp(
      "select pg_has_role('playerone_app', 'playerone_risk', 'member') as ok",
    );
    expect(row?.['ok']).toBe(true);
  });
});
