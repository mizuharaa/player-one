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
  assertTransport(url);
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

/**
 * A same-box database, which is the pilot's shape and every URL in this repo.
 * An empty hostname is a unix socket, which never leaves the machine either.
 */
const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1']);

/**
 * SEC-09 — "encryption in transit on all paths" — for the one path this code
 * holds the configuration of.
 *
 * The option was always there and nothing said so: postgres.js renames
 * `?sslmode=` to its own `ssl` setting (`postgres/src/index.js:443`) and reads
 * `disable` as `false` (`:475`), so all three spellings already work. Measured
 * against the local Postgres 18: no query and `?sslmode=disable` both connect,
 * `?sslmode=require` fails `ECONNRESET` because that server has no TLS. What
 * was missing is anybody being made to answer the question. This database
 * holds every collector's masked payout account, the operator credential
 * hashes and the PLT-08 audit trail; on a link between two machines, an
 * unencrypted Postgres connection puts all of it on the wire in clear.
 *
 * The refusal is deliberately narrow, because an upload centre may genuinely
 * be a LAN and a refusal that bricks a centre would be reverted rather than
 * fixed. A loopback host needs nothing. `?sslmode=disable` is accepted, and is
 * the point: it makes "this link is trusted" a thing somebody wrote down. Only
 * the silent case is refused — a database on another machine with the question
 * never asked.
 *
 * This covers the API, both workers and the ingest CLI, which all reach
 * Postgres through this function. It does not cover `pnpm db:migrate`:
 * drizzle-kit opens its own connection from `packages/store/drizzle.config.ts`.
 */
function assertTransport(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Let `postgres()` produce the parse error. Two of them is one too many.
    return;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (LOCAL_HOSTS.has(host)) return;
  if (parsed.searchParams.has('sslmode')) return;
  throw new Error(
    `${redact(url)} names a database on another machine and does not say whether the ` +
      'connection is encrypted (SEC-09). Add ?sslmode=require, or ?sslmode=disable to ' +
      'state that this link is trusted.',
  );
}

/** Applies `packages/store/drizzle`. Idempotent; safe to call on every open. */
export async function migrateTo(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, '..', 'drizzle') });
}

/** A connection string carries a password. It does not belong in an error message. */
export function redact(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@');
}
