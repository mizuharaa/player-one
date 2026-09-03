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
 * The file's own database URL, for tests that need a second, genuinely
 * concurrent connection — a row lock has nothing to serialise when both
 * transactions queue behind the same connection. Callers close what they open.
 */
export function currentUrl(): string {
  return urlFor(dbName());
}

/** One connection for the whole file, migrated once, truncated per test. */
let shared: Promise<Db> | null = null;

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
  shared = null;
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
