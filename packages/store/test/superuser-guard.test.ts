import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { open } from '../src/index.ts';
import { closeDb, db, dbUrl, hasDb, useDatabase } from './db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('superuser_guard');

/**
 * The application may not connect as a superuser, and `open()` is where that is
 * decided.
 *
 * Migration 0021 creates `playerone_app` because a superuser owns every table
 * and bypasses every grant, which makes the append-only audit trail a courtesy
 * rather than a rule. Nothing checked that the process actually connected as
 * that role, so a deployment that left `postgres` in `DATABASE_URL` kept every
 * audit guarantee in name only.
 *
 * These tests undo the harness's own exemption for the length of one call. The
 * harness sets `PLAYERONE_ALLOW_SUPERUSER=1` at module load because it creates
 * databases, migrates them and disables triggers — the schema owner's jobs.
 */
const withoutExemption = async <T>(work: () => Promise<T>): Promise<T> => {
  const had = process.env['PLAYERONE_ALLOW_SUPERUSER'];
  delete process.env['PLAYERONE_ALLOW_SUPERUSER'];
  try {
    return await work();
  } finally {
    if (had !== undefined) process.env['PLAYERONE_ALLOW_SUPERUSER'] = had;
  }
};

/** A real login role with no privileges: what a deployment is supposed to use. */
const LOGIN = `po_guard_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const PASSWORD = 'guard-pw';

describe.skipIf(!hasDb())('open() and the connected role', () => {
  beforeAll(async () => {
    const d = await db();
    await d.execute(sql.raw(`create role "${LOGIN}" login password '${PASSWORD}'`));
    await d.execute(sql.raw(`grant playerone_app to "${LOGIN}"`));
  });

  afterAll(async () => {
    const d = await db();
    await d.execute(sql.raw(`drop role "${LOGIN}"`));
    await closeDb();
  });

  it('refuses a superuser login by name', async () => {
    // `DATABASE_URL` names `postgres` on every machine in this repo, which is
    // the connection the API actually had.
    await expect(withoutExemption(() => open(dbUrl()))).rejects.toThrow(/db_superuser_refused/);
  });

  it('refuses a superuser login that asks for the application role', async () => {
    /**
     * The bypass `current_user` alone would accept, and the exact shape
     * `appDb()` uses: the effective role is `playerone_app` and the session
     * role is still the superuser it logged in as, so `SET ROLE` takes the
     * privileges straight back. Checking both roles is what closes it.
     */
    const url = new URL(dbUrl());
    url.searchParams.set('role', 'playerone_app');
    await expect(withoutExemption(() => open(url.toString()))).rejects.toThrow(
      /db_superuser_refused/,
    );
  });

  it('opens for an unprivileged login', async () => {
    const url = new URL(dbUrl());
    url.username = LOGIN;
    url.password = PASSWORD;
    const connection = await withoutExemption(() => open(url.toString()));
    try {
      const [row] = (await connection.execute(
        sql`select session_user::text as who, current_setting('is_superuser') as super`,
      )) as unknown as { who: string; super: string }[];
      expect(row).toMatchObject({ who: LOGIN, super: 'off' });
    } finally {
      await connection.close();
    }
  });

  it('lets the schema owner through when it says so, which is how this file ran', async () => {
    // Not a formality: without the exemption the harness cannot create a
    // database or migrate one, so every database test in the repo depends on it.
    expect(process.env['PLAYERONE_ALLOW_SUPERUSER']).toBe('1');
    const connection = await open(dbUrl());
    await connection.close();
  });
});
