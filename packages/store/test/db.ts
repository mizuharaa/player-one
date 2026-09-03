import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { migrateTo, open, type Db } from '../src/index.ts';

/**
 * The test database. Same convention as the real sample sessions (test/sessions.ts):
 * point an environment variable at it, and the tests skip cleanly without one so
 * that `pnpm test` still works at an upload centre with nothing installed.
 *
 *   docker run -d --name playerone-pg -e POSTGRES_PASSWORD=playerone -p 5432:5432 postgres:16
 *   set DATABASE_URL=postgres://postgres:playerone@localhost:5432/postgres
 */
export const DB_URL = process.env['DATABASE_URL'] ?? '';
export const hasDb = (): boolean => DB_URL !== '';

/**
 * One database per test file, created on demand from `DATABASE_URL`'s server.
 *
 * Vitest runs files in parallel and every database file truncates between tests,
 * so sharing one database means they delete each other's rows — which surfaces
 * as a second delivery reported `new` instead of `duplicate`, a failure that
 * reads exactly like a bug in the code under test.
 *
 * Separate schemas do not work: drizzle writes `REFERENCES "public"."…"` into
 * the generated SQL, so the migration does not relocate. A shared advisory lock
 * does work but holds for the whole file, so the third file waits out the first
 * two and blows the hook timeout. A database each has neither problem and needs
 * no coordination.
 *
 * Call `useDatabase` at module scope, before any `db()`.
 */
let suffix = '';
export function useDatabase(name: string): void {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe database suffix: ${name}`);
  suffix = name;
}

const urlFor = (name: string): string => {
  const u = new URL(DB_URL);
  u.pathname = `/${name}`;
  return u.toString();
};

const dbName = (): string => {
  const base = new URL(DB_URL).pathname.replace(/^\//, '') || 'postgres';
  return suffix === '' ? base : `${base}_${suffix}`;
};

/**
 * This file's own database, as a URL.
 *
 * Exported because a test that has to prove a *concurrency* design needs two
 * genuinely separate connections: `db()` hands back one pool, and two
 * transactions on one pooled connection serialise before they ever reach
 * Postgres, which would make a broken lock look correct.
 */
export const dbUrl = (): string => urlFor(dbName());

/**
 * The Postgres role the APPLICATION connects as when it is named
 * (`PLAYERONE_DB_ROLE=playerone_app`, migration 0021). Unset by default, and
 * then `appDb()` is `db()` and nothing about a run changes.
 *
 * Set, `appDb()` is a second connection to the same database whose session role
 * is that one, and it is what `buildApi` is handed. Every route, every audited
 * write and every worker then runs under exactly the grants a real deployment
 * gives the API, so a missing grant fails a test instead of being argued about.
 * Postgres drops a superuser's bypass for the duration of a role change, which
 * is what makes that a real check even though `DATABASE_URL` names a superuser.
 *
 * `db()` deliberately stays unrestricted, and the split is the point rather
 * than a convenience: creating a database, migrating it, truncating between
 * tests and disabling a trigger to prove that the trigger is what refuses a
 * write are all things the schema OWNER does. The application does none of
 * them and `playerone_app` cannot do any of them. A test that asserts
 * `bill_lines_immutable` by attempting a DELETE has to reach the trigger to be
 * testing anything at all; run under a role with no DELETE grant it would pass
 * for the wrong reason, which is the failure `violates()` exists to prevent.
 *
 * `?role=` is a Postgres startup parameter; postgres.js passes query parameters
 * it does not recognise through as connection parameters.
 */
const APP_ROLE = process.env['PLAYERONE_DB_ROLE'] ?? '';

/** One connection for the whole file, migrated once, truncated per test. */
let shared: Promise<Db> | null = null;
/** The same database as `shared`, restricted, when `APP_ROLE` names a role. */
let restricted: Promise<Db> | null = null;

export function db(): Promise<Db> {
  shared ??= (async () => {
    const target = dbName();
    if (suffix !== '') {
      // CREATE DATABASE cannot run inside a transaction, so it goes through a
      // throwaway connection to the server's default database.
      const admin = postgres(DB_URL, { max: 1, onnotice: () => {} });
      try {
        const [row] = await admin`select 1 from pg_database where datname = ${target}`;
        if (row === undefined) await admin.unsafe(`create database "${target}"`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    }
    const d = await open(urlFor(target));
    await migrateTo(d);
    return d;
  })();
  return shared;
}

/** The connection to hand `buildApi`. See `APP_ROLE`. */
export function appDb(): Promise<Db> {
  if (APP_ROLE === '') return db();
  restricted ??= (async () => {
    // The database has to exist and be migrated first, and only `db()` can do that.
    await db();
    const url = new URL(dbUrl());
    url.searchParams.set('role', APP_ROLE);
    return open(url.toString());
  })();
  return restricted;
}

/**
 * Every table except drizzle's migration ledger, discovered rather than listed:
 * a new table nobody remembered to add here would otherwise leak rows between
 * tests and fail somewhere unrelated.
 */
export async function truncate(): Promise<void> {
  const d = await db();
  await d.execute(sql`
    do $$
    declare stmt text;
    begin
      select 'truncate table ' || string_agg(format('%I.%I', schemaname, tablename), ', ')
             || ' restart identity cascade'
        into stmt
        from pg_tables
       where schemaname = 'public' and tablename <> '__drizzle_migrations';
      if stmt is not null then execute stmt; end if;
    end $$;
  `);
}

export async function closeDb(): Promise<void> {
  if (shared) await (await shared).close();
  if (restricted) await (await restricted).close();
  shared = null;
  restricted = null;
}

/**
 * A live claim by `collectorId` on `taskId`, with the collector made eligible
 * on the way: exam pass and all six agreements, which `task_claims_guard`
 * (0006) demands of every insert. Since migration 0016 a counter session and a
 * settlement both have to name a claim, so every fixture that declares a
 * session needs one of these first. Returns the claim id.
 */
export async function liveClaim(d: Db, taskId: string, collectorId: string): Promise<string> {
  const id = randomUUID();
  await d.execute(sql`update collectors set exam_result = 'pass', exam_decided_at = now()
    where id = ${collectorId} and exam_result is null`);
  await d.execute(sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
    select ${collectorId}, a, 'v1', now()
      from unnest(array['user', 'privacy', 'data_collection', 'commercial_use', 'manual_review', 'offline_settlement']) as a
    on conflict do nothing`);
  await d.execute(sql`insert into task_claims (id, task_id, collector_id) values (${id}, ${taskId}, ${collectorId})`);
  return id;
}

/**
 * Asserts a specific constraint rejected the statement.
 *
 * Drizzle wraps the driver error as "Failed query: ..." and keeps the useful
 * part — postgres.js's `constraint_name` — on the cause. Matching the wrapper's
 * message would pass for ANY failure, including a typo in the test's own SQL,
 * so the chain is walked and the constraint named.
 */
export async function violates(constraint: string, run: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await run;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${constraint} to reject the statement`).toBeDefined();

  const seen: string[] = [];
  for (let e: unknown = caught; e !== undefined && e !== null; e = (e as { cause?: unknown }).cause) {
    const x = e as { message?: string; constraint_name?: string };
    if (x.constraint_name) seen.push(x.constraint_name);
    if (x.message) seen.push(x.message);
  }
  expect(seen.join(' | '), `rejected, but not by ${constraint}`).toContain(constraint);
}
