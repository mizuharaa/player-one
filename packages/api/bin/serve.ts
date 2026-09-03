/**
 * The server entrypoint.
 *
 * There was not one before this slice: the API existed and was exercised by
 * tests and by `verify-e2e.mjs`, which is fine for a machine client and useless
 * for a screen a person opens in a browser.
 *
 *     DATABASE_URL=... PLAYERONE_TOKEN_SECRET=... node packages/api/bin/serve.ts
 *
 * Everything is configuration and nothing is defaulted where a wrong default
 * would be silent. The token secret in particular fails closed: a service that
 * invented one at boot would issue tokens that stop verifying the next time it
 * restarts, which presents as reviewers being randomly signed out rather than
 * as a missing setting.
 */

import { env, exit } from 'node:process';
import { open, redact } from '@playerone/store';
import { buildApi } from '../src/index.ts';

const required = (name: string): string => {
  const value = env[name];
  if (value === undefined || value === '') {
    console.error(`${name} is required`);
    exit(2);
  }
  return value;
};

const databaseUrl = required('DATABASE_URL');
const tokenSecret = required('PLAYERONE_TOKEN_SECRET');
const host = env['HOST'] ?? '127.0.0.1';
const port = Number(env['PORT'] ?? 8080);

/**
 * A pool, not a single connection.
 *
 * `open` defaults to one because it was written for the ingest CLI, where one
 * session is imported at a time. A server is the opposite case: several
 * reviewers claim from the queue at once, and on a single connection they queue
 * behind each other — `for update skip locked` has nothing to skip when there is
 * no second transaction holding a row.
 */
const db = await open(databaseUrl, { max: Number(env['PLAYERONE_DB_POOL'] ?? 10) });

const app = buildApi({
  db,
  tokenSecret,
  /**
   * The directory holding the imported `ego_*` session folders. Without it the
   * console runs and the stream route answers 503 saying why, which is the
   * right symptom for a machine that has not been pointed at its storage yet.
   */
  mediaRoot: env['PLAYERONE_MEDIA_ROOT'],
  currency: env['PLAYERONE_CURRENCY'],
  /**
   * The device deposit. Both are defaults for a column, not the column: an
   * amount and a currency ride on every `deposits` row, because PaXini quotes
   * the deposit in CNY and the collectors are Vietnamese, and which one binds
   * is not settled.
   */
  depositAmount: env['PLAYERONE_DEPOSIT_AMOUNT'],
  depositCurrency: env['PLAYERONE_DEPOSIT_CURRENCY'],
  /**
   * Off unless asked for. Pilot upload centres are a LAN over plain HTTP, where
   * a `Secure` cookie is simply never sent and the symptom is a sign-in that
   * appears to succeed and does nothing. Turn it on wherever there is TLS.
   */
  secureCookies: env['PLAYERONE_SECURE_COOKIES'] === '1',
});

const shutdown = async (signal: string) => {
  console.log(`${signal}: closing`);
  await app.close();
  await db.close();
  exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host, port });
console.log(`playerone api on http://${host}:${port}  (${redact(databaseUrl)})`);
console.log(`review console: http://${host}:${port}/review`);
