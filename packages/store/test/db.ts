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

/** One connection for the whole file, migrated once, truncated per test. */
let shared: Promise<Db> | null = null;

export function db(): Promise<Db> {
  shared ??= (async () => {
    const d = await open(DB_URL);
    await migrateTo(d);
    return d;
  })();
  return shared;
}

export async function truncate(): Promise<void> {
  const d = await db();
  await d.execute(
    sql`truncate episode_defects, episode_streams, episode_files, episode_ingests, episodes restart identity cascade`,
  );
}

export async function closeDb(): Promise<void> {
  if (shared) await (await shared).close();
  shared = null;
}
