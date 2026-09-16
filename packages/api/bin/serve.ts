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
import {
  payoutOptionsFromEnv,
  buildApi,
  s3StoreFromEnv,
  signInCodeSenderFromEnv,
  zaloLoginFromEnv,
  startHeartbeat,
} from '../src/index.ts';
import { riskConfigFromEnv } from '../src/risk/config.ts';
import { storageQuotaFromEnv } from '../src/alerts.ts';
import { zaloPayClientFromEnv } from '../src/payout/zalopay/client.ts';

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
const trustLoopbackProxy = env['PLAYERONE_TRUST_LOOPBACK_PROXY'] === '1';
if (trustLoopbackProxy && host !== '127.0.0.1' && host !== '::1') {
  console.error('PLAYERONE_TRUST_LOOPBACK_PROXY requires a loopback-only HOST');
  exit(2);
}
const mediaRoot = env['PLAYERONE_MEDIA_ROOT'];
const machineIdentifier = env['PLAYERONE_MACHINE_IDENTIFIER'];
const machineSecret = env['PLAYERONE_MACHINE_SECRET'];
const storageQuotaBytes = storageQuotaFromEnv(env);

/**
 * `buildApi` refuses the two together — reviewer media on with the session
 * cookie in clear — so the rule lives in the service and this file only reads
 * the environment. See `ApiOptions.reviewerMediaEnabled`.
 */
const secureCookies = env['PLAYERONE_SECURE_COOKIES'] === '1';
const reviewerMediaEnabled = env['PLAYERONE_REVIEWER_MEDIA'] === '1';

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

/**
 * The cloud leg (UPL-04/05/06). STORAGE_ENDPOINT unset means no GreenNode
 * contract yet: the upload routes answer 503 and everything else runs. A
 * partial STORAGE_* configuration fails closed inside `s3StoreFromEnv`.
 */
const objectStore = s3StoreFromEnv() ?? undefined;

// QR-02: cloud verification by default; centres without a bucket may opt into 'local'.
const verificationGate = env['REVIEW_VERIFICATION_GATE'] ?? 'cloud';
if (verificationGate !== 'local' && verificationGate !== 'cloud') {
  console.error(`REVIEW_VERIFICATION_GATE must be 'local' or 'cloud', not '${verificationGate}'`);
  exit(2);
}

const app = buildApi({
  db,
  storageQuotaBytes,
  tokenSecret,
  /**
   * On unless `PLAYERONE_LOG=0`. A deployed server that logs nothing cannot be
   * operated: until 2026-09-05 this process ran with the logger hard-coded
   * off, so every 500 was `{"error":"internal"}` and nothing recorded what had
   * thrown. Off remains the default inside `buildApi` for the test suite.
   */
  logger: env['PLAYERONE_LOG'] !== '0',
  trustLoopbackProxy,
  /**
   * The directory holding the imported `ego_*` session folders. Without it the
   * console runs and the stream route answers 503 saying why, which is the
   * right symptom for a machine that has not been pointed at its storage yet.
   */
  mediaRoot,
  currency: env['PLAYERONE_CURRENCY'],
  /**
   * SET-07's cycle. Weekly is `[ASSUMED]` in the brief's §13.2 rather than
   * agreed, so it is settable here; the API defaults to 7 and nothing in
   * `settle.ts` writes the number down.
   */
  settlementCycleDays: env['PLAYERONE_SETTLEMENT_CYCLE_DAYS']
    ? Number(env['PLAYERONE_SETTLEMENT_CYCLE_DAYS'])
    : undefined,
  /**
   * Off unless asked for. Pilot upload centres are a LAN over plain HTTP, where
   * a `Secure` cookie is simply never sent and the symptom is a sign-in that
   * appears to succeed and does nothing. Turn it on wherever there is TLS.
   */
  secureCookies,
  objectStore,
  verificationGate,
  /**
   * Off unless Legal has signed the playback architecture. D11 — whether
   * background review needs online playback of raw video — is unresolved and
   * escalated, and Part 7.3 says the Phase 1 arrangement is remote access and
   * not data transfer. Until that is answered, a PaXini reviewer in Shenzhen
   * gets review metadata and no footage; setting this to `1` streams raw
   * Vietnamese-collected video across the border, so it is a deliberate act.
   */
  reviewerMediaEnabled,
  /**
   * APP-01. How a collector's sign-in code reaches their phone, from
   * PLAYERONE_ZNS_*. Zalo Notification Service when the credentials are set;
   * a sender that writes the code to this log when they are not, so a pilot
   * runs before VNG has issued a ZNS account. A partial configuration, or
   * PLAYERONE_ZNS_ENV=production with none of it, throws by name.
   */
  sendSignInCode: signInCodeSenderFromEnv(env),
  /**
   * Diagnostic provenance, and it has to agree with what
   * `signInCodeSenderFromEnv` actually built: PLAYERONE_SIGN_IN_CHANNEL now
   * decides, and only falls back to the ZNS-credentials test that was the whole
   * of this before 2026-09-16.
   */
  signInDeliveryMode:
    env['PLAYERONE_SIGN_IN_CHANNEL'] === 'sms'
      ? 'sms'
      : env['PLAYERONE_SIGN_IN_CHANNEL'] === 'log'
        ? 'dev_log'
        : env['PLAYERONE_SIGN_IN_CHANNEL'] === 'zns' ||
            (env['PLAYERONE_ZNS_TEMPLATE_ID'] &&
              (env['PLAYERONE_ZNS_ACCESS_TOKEN'] || env['PLAYERONE_ZNS_REFRESH_TOKEN']))
          ? 'zns'
          : 'dev_log',
  // One number, or nothing. `serve.ts` is the only file under src/ or bin/ that
  // reads it; `scripts/seed-demo.mjs` reads it too, which is the point of it.
  demoPhone: env['PLAYERONE_DEMO_PHONE'],
  /**
   * Zalo Login (OAuth v4), from PLAYERONE_ZALO_APP_ID, PLAYERONE_ZALO_APP_SECRET
   * and PLAYERONE_PUBLIC_ORIGIN (which falls back to PLAYERONE_PUBLIC_URL).
   * Undefined when none of them is set, and then the three Zalo routes answer
   * 503 naming `zalo_not_configured`; a PARTIAL configuration throws by name,
   * the same rule as the ZNS and ZaloPay readers above.
   *
   * Owner's decision of 2026-09-16: this is the route a collector with an
   * ordinary Zalo account signs in through, because VNG's ZNS Official Account
   * is not available and the code channel therefore delivers nothing.
   */
  zaloLogin: zaloLoginFromEnv(env) ?? undefined,
  /**
   * The console's debug-delivery page. One value, `1`, and nothing else turns
   * it on — the same shape as every other switch read here, so a deployment
   * that copies an old `.env` with `PLAYERONE_DEBUG_DELIVERY=0` in it gets the
   * off state rather than a truthy string.
   */
  debugDelivery: env['PLAYERONE_DEBUG_DELIVERY'] === '1',
  /**
   * The payout rail's client, from PLAYERONE_ZALOPAY_*. Null in sandbox with
   * no credentials — verification then stores `unverified` and pay refuses
   * `payout_no_client`; production without every credential throws by name.
   */
  payout: { ...payoutOptionsFromEnv(env), client: zaloPayClientFromEnv(env) ?? undefined },
  risk: riskConfigFromEnv(env),
});

let stopHeartbeat: () => void = () => {};
const shutdown = async (signal: string) => {
  console.log(`${signal}: closing`);
  stopHeartbeat();
  await app.close();
  await db.close();
  exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host, port });
/**
 * This entrypoint serves both upload-centre machines and back-office hosts.
 * Only a centre has all three values, so a back-office process sends nothing;
 * a centre sends one beat immediately and owns the timer until shutdown. The
 * scheduler deliberately lives here rather than in `buildApi`, whose embedded
 * and test callers must never acquire a background timer merely by building an
 * app.
 */
if (
  machineIdentifier !== undefined &&
  machineIdentifier !== '' &&
  machineSecret !== undefined &&
  machineSecret !== '' &&
  mediaRoot !== undefined &&
  mediaRoot !== ''
) {
  stopHeartbeat = startHeartbeat(app, db, {
    machineIdentifier,
    secret: machineSecret,
    mediaRoot,
  });
}
console.log(`playerone api on http://${host}:${port}  (${redact(databaseUrl)})`);
console.log(`review console: http://${host}:${port}/review`);
