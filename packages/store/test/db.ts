import { sql } from 'drizzle-orm';
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
 * Vitest runs test files in parallel, and every database file truncates between
 * tests, so two of them sharing one database delete each other's rows. That
 * surfaces as a second delivery reported `new` instead of `duplicate` — a
 * failure that reads exactly like a bug in the code under test.
 *
 * A session-level advisory lock, taken before the migration and held until the
 * file closes its connection, serialises database files against each other
 * while leaving every other file parallel. Separate schemas would be tidier but
 * drizzle writes `REFERENCES "public"."…"` into the generated SQL, so the
 * migration does not relocate.
 */
const FILE_LOCK = 918_273_645;

/** One connection for the whole file, migrated once, truncated per test. */
let shared: Promise<Db> | null = null;

export function db(): Promise<Db> {
  shared ??= (async () => {
    const d = await open(DB_URL);
    // Before migrateTo: two files migrating the same database at once race on
    // CREATE TABLE as readily as they race on rows.
    await d.execute(sql`select pg_advisory_lock(${FILE_LOCK})`);
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
  if (shared) {
    const d = await shared;
    // Closing would drop the lock anyway; releasing first keeps the intent
    // visible and hands over promptly.
    await d.execute(sql`select pg_advisory_unlock(${FILE_LOCK})`);
    await d.close();
  }
  shared = null;
}
