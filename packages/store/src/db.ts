import { join } from 'node:path';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = PostgresJsDatabase<typeof schema> & { close: () => Promise<void> };

export class StoreUnreachableError extends Error {}

/** The connection string convention for this repo. Nothing else reads it. */
export const DATABASE_URL = (): string => process.env['DATABASE_URL'] ?? '';

export type OpenOptions = {
  /**
   * Pool size. One by default, which is right for the CLI and wrong for a
   * server.
   *
   * The default exists because ingest is one session at a time and a pool would
   * only add ways for a partially-applied transaction to become somebody else's
   * problem. The API is the opposite case: several reviewers claim from the
   * queue at once, and on a single connection they queue behind each other —
   * `for update skip locked` cannot skip a row when there is no second
   * transaction to skip it. A caller that serves more than one person at a time
   * has to say so.
   */
  max?: number;
};

/**
 * Opens a connection. Called only when --store, --list or --show is passed:
 * the core measurement path runs at upload centres with the link down and must
 * never need a database (spec §"Two callers, one engine").
 */
export async function open(url = DATABASE_URL(), { max = 1 }: OpenOptions = {}): Promise<Db> {
  if (url === '') {
    throw new StoreUnreachableError('DATABASE_URL is not set; --store needs a Postgres to write to');
  }
  const sql = postgres(url, { max, onnotice: () => {} });
  const db: Db = Object.assign(drizzle(sql, { schema }), {
    close: () => sql.end({ timeout: 5 }),
  });
  try {
    await sql`select 1`;
  } catch (err) {
    await db.close();
    throw new StoreUnreachableError(`cannot reach ${redact(url)}: ${(err as Error).message}`);
  }
  return db;
}

/** Applies `packages/store/drizzle`. Idempotent; safe to call on every open. */
export async function migrateTo(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, '..', 'drizzle') });
}

/** A connection string carries a password. It does not belong in an error message. */
export function redact(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@');
}
