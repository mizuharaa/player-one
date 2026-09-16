import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function configuration(args) {
  const { values: v } = parseArgs({ args, options: Object.fromEntries([
    ...['domain', 'acme-email', 'database-url', 'storage-endpoint', 'storage-bucket',
      'storage-key', 'storage-secret', 'quota-bytes', 'output',
      // Sign-in channels, owner's decision 2026-09-16. All optional: omitted,
      // they stay empty in cloud.env and the deployment behaves as it did.
      'sign-in-channel', 'zalo-app-id', 'zalo-app-secret', 'demo-phone',
      // The demo bypass key, owner's request 2026-09-16. Optional; omitted, it
      // stays empty in cloud.env and POST /auth/collector/demo answers 404.
      'demo-bypass-key',
      // eSMS.vn, the SMS fallback. Three credentials, all or none, and
      // mandatory when --sign-in-channel is sms.
      'sms-api-key', 'sms-secret-key', 'sms-brandname'].map(k => [k, { type: 'string' }]),
    ...['local-db', 'http-local', 'sms-sandbox'].map(k => [k, { type: 'boolean' }]),
  ]) });
  for (const k of ['domain', 'acme-email', 'storage-endpoint', 'storage-bucket', 'storage-key', 'storage-secret', 'quota-bytes']) {
    if (!v[k] || /[\r\n\0]/.test(v[k])) throw new Error(`--${k} is required and must be one line`);
  }
  if (!/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(v.domain)) throw new Error('Supply a DNS hostname, without scheme or path');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v['acme-email'])) throw new Error('Invalid ACME email');
  // Same lower bound as API storageQuotaFromEnv; this dependency-free CLI runs before pnpm exists.
  if (!/^[1-9][0-9]*$/.test(v['quota-bytes']) || !Number.isSafeInteger(Number(v['quota-bytes'])) || Number(v['quota-bytes']) < 1250000000) throw new Error('Quota must be whole bytes, at least 1250000000');
  if (Boolean(v['local-db']) === Boolean(v['database-url'])) throw new Error('Choose --local-db OR --database-url (migration owner URL)');
  if (v['http-local'] && v.domain !== 'localhost') throw new Error('--http-local is only for localhost Docker proof');
  if (!['https:', ...(v['http-local'] ? ['http:'] : [])].includes(new URL(v['storage-endpoint']).protocol)) throw new Error('Storage endpoint must use HTTPS outside local proof');
  // One Vietnamese mobile number, in any of the three spellings zns.ts
  // normalises. Validated here because it decides whose one-time code this
  // deployment is allowed to write into its own log.
  if (v['demo-phone'] !== undefined && !/^(\+?84|0)[35789][0-9]{8}$/.test(v['demo-phone'])) {
    throw new Error('--demo-phone must be one Vietnamese mobile number (0…, 84… or +84…)');
  }
  // Allowed characters rather than forbidden ones. A Zalo app id is digits and
  // its secret is hex, so anything outside this set is a paste that went wrong
  // and a positive rule cannot be defeated by a separator nobody thought of.
  for (const k of ['sign-in-channel', 'zalo-app-id', 'zalo-app-secret']) {
    if (v[k] !== undefined && !/^[\w.:@+-]*$/.test(v[k])) throw new Error(`--${k} has characters it should not`);
  }
  // The same three names packages/api/src/zns.ts accepts, and nothing else: a
  // typo here would otherwise become a server that refuses to start on the VM.
  if (v['sign-in-channel'] && !['zns', 'sms', 'log'].includes(v['sign-in-channel'])) {
    throw new Error('--sign-in-channel must be zns, sms or log');
  }
  /**
   * `--sign-in-channel sms` had no way to supply eSMS credentials, so it
   * wrote them EMPTY and `smsSenderFromEnv` then refused to start naming what
   * was missing. Following this kit's own documented SMS rollout produced a VM
   * whose API container would not boot. Audit 3 of `3f9bb17` found it.
   *
   * Refused HERE and not at boot, which is the whole value of the change: a
   * message on the laptop before anything is provisioned, rather than a dead
   * container on a machine somebody has to ssh into to read the reason.
   *
   * All three or none, even when the channel is something else, because two
   * of three is a paste that went wrong and an empty secret beside a real key
   * is the configuration that looks done and is not.
   */
  const smsFlags = ['sms-api-key', 'sms-secret-key', 'sms-brandname'];
  const smsMissing = smsFlags.filter(k => !v[k]);
  if (v['sign-in-channel'] === 'sms' && smsMissing.length > 0) {
    throw new Error(`--sign-in-channel sms needs ${smsMissing.map(k => '--' + k).join(', ')}; without them the API refuses to start`);
  }
  if (smsMissing.length > 0 && smsMissing.length < smsFlags.length) {
    throw new Error(`Supply all of --sms-api-key, --sms-secret-key and --sms-brandname, or none: ${smsMissing.map(k => '--' + k).join(', ')} missing`);
  }
  // eSMS's own limit is 11 characters; a longer value is a registration that
  // does not exist, so it is a typo caught now and not `CodeResult 104` in a
  // demo. Space, dot, underscore and hyphen are the specials eSMS allows.
  if (v['sms-brandname'] !== undefined && !/^[A-Za-z0-9 ._-]{1,11}$/.test(v['sms-brandname'])) {
    throw new Error('--sms-brandname is at most 11 characters: letters, digits and space . _ - only');
  }
  for (const k of ['sms-api-key', 'sms-secret-key']) {
    if (v[k] !== undefined && !/^[\w.:@+-]+$/.test(v[k])) throw new Error(`--${k} has characters it should not`);
  }
  // eSMS's test mode is a property of sending over SMS, so it means nothing
  // on another channel and saying so beats ignoring it.
  if (v['sms-sandbox'] && v['sign-in-channel'] !== 'sms') {
    throw new Error('--sms-sandbox only means something with --sign-in-channel sms');
  }
  // Half of a Zalo app is a server that refuses to start naming what is
  // missing; catching it here means finding out before the VM is touched.
  if (Boolean(v['zalo-app-id']) !== Boolean(v['zalo-app-secret'])) {
    throw new Error('Supply both --zalo-app-id and --zalo-app-secret, or neither');
  }
  // Its own character class, because `openssl rand -base64 48` emits `+`, `/`
  // and `=` and the rule above has neither of the last two. Still allowed
  // characters rather than forbidden ones, and still one line.
  if (v['demo-bypass-key'] !== undefined && !/^[\w+/=.:@-]*$/.test(v['demo-bypass-key'])) {
    throw new Error('--demo-bypass-key has characters it should not');
  }
  // The same floor packages/api/src/collector.ts enforces at boot (32). Caught
  // here so a short key is found before the VM is touched, rather than as a
  // container that will not start.
  if (v['demo-bypass-key'] && v['demo-bypass-key'].length < 32) {
    throw new Error('--demo-bypass-key must be at least 32 characters; use `openssl rand -base64 48`');
  }
  const secret = () => randomBytes(32).toString('hex');
  const ownerPassword = secret(), appPassword = secret(), machine = secret(), admin = secret();
  const owner = new URL(v['database-url'] ?? `postgres://postgres:${ownerPassword}@postgres:5432/po_demo_cloud?sslmode=disable`);
  if (!['postgres:', 'postgresql:'].includes(owner.protocol) || !owner.username || !owner.password ||
      !/^\/(?:po_demo|playerone_demo)[a-z0-9_]*$/.test(owner.pathname)) throw new Error('Owner URL must name a po_demo* or playerone_demo* database with credentials');
  if (owner.username === 'playerone_app') throw new Error('Migration URL must use the owner role');
  if (!v['local-db'] && owner.searchParams.get('sslmode') !== 'require') throw new Error('Managed Postgres requires sslmode=require');
  const app = new URL(owner); app.username = 'playerone_app'; app.password = appPassword;
  return {
    PLAYERONE_PUBLIC_URL: `${v['http-local'] ? 'http' : 'https'}://${v.domain}`,
    PLAYERONE_DEPLOY_MODE: v['http-local'] ? 'lan' : 'https-production',
    PLAYERONE_ACME_EMAIL: v['acme-email'], PLAYERONE_SECURE_COOKIES: v['http-local'] ? '0' : '1',
    DATABASE_URL: app.href, OWNER_DATABASE_URL: owner.href, POSTGRES_DB: owner.pathname.slice(1),
    POSTGRES_PASSWORD: ownerPassword, PLAYERONE_APP_PASSWORD: appPassword,
    PLAYERONE_LOCAL_DB: v['local-db'] ? '1' : '0', PLAYERONE_TOKEN_SECRET: secret(),
    PLAYERONE_MACHINE_IDENTIFIER: 'demo-machine-1', PLAYERONE_MACHINE_SECRET: machine,
    PLAYERONE_OPERATOR_REF: 'op-1', PLAYERONE_OPERATOR_SECRET: admin,
    PLAYERONE_DEMO_MACHINE_SECRET: machine, PLAYERONE_DEMO_ADMIN_SECRET: admin,
    PLAYERONE_DEMO_FINANCE_SECRET: secret(), PLAYERONE_DEMO_REVIEWER_SECRET: secret(),
    STORAGE_ENDPOINT: v['storage-endpoint'], STORAGE_BUCKET: v['storage-bucket'],
    STORAGE_KEY: v['storage-key'], STORAGE_SECRET: v['storage-secret'],
    PLAYERONE_STORAGE_QUOTA_BYTES: v['quota-bytes'],
    /**
     * Empty unless asked for, which is what keeps the default behaviour the
     * default. The redirect URI is built from PLAYERONE_PUBLIC_URL above, so
     * there is no separate origin to pass; the callback URL registered at
     * developers.zalo.me has to equal it plus /auth/collector/zalo/callback.
     */
    PLAYERONE_SIGN_IN_CHANNEL: v['sign-in-channel'] ?? '',
    PLAYERONE_ZALO_APP_ID: v['zalo-app-id'] ?? '',
    PLAYERONE_ZALO_APP_SECRET: v['zalo-app-secret'] ?? '',
    /**
     * The only number whose sign-in code this deployment may write to its own
     * log. Empty unless asked for: the log sender is what a sandbox with no ZNS
     * credentials falls back to, which is this kit's own default, and before
     * the allowlist existed it printed every collector's code.
     *
     * Deliberately NOT also `PLAYERONE_DEMO_PHONE`, which is a different thing
     * with a stricter rule: that one makes the API echo the code in the HTTP
     * RESPONSE, which is an enrolment oracle for that number, and
     * `check.test.ts` bans it from this template outright. A log an operator
     * reads on the VM and a response the internet can ask for are not the same
     * disclosure, and one flag setting both would have quietly undone that ban.
     */
    PLAYERONE_DEMO_PHONES: v['demo-phone'] ?? '',
    /**
     * Empty unless asked for, and empty is what every deployment gets: without
     * it POST /auth/collector/demo answers 404 and there is no bypass. Owner's
     * request 2026-09-16, for debugging and the Thursday demonstration only.
     * The value is generated at deploy time and is in no file in this
     * repository.
     */
    PLAYERONE_DEMO_BYPASS_KEY: v['demo-bypass-key'] ?? '',
    /**
     * eSMS.vn, the fallback for the numbers ZNS structurally cannot reach —
     * no Zalo account, or the channel refused. Empty unless asked for, and
     * refused above if the channel is `sms` and any of the three is missing.
     *
     * None of these reaches the printed credential list below. The API key and
     * secret key are credentials; the brandname is not, but there is nothing
     * to gain from echoing it either. `cloud.env` is 0600 and is where they
     * live.
     *
     * The sandbox flag is eSMS's own test mode — charged nothing, delivered
     * nowhere — which is the documented way to exercise the whole request path
     * while the brandname is still inside its 5-10 business-day approval.
     */
    PLAYERONE_SMS_API_KEY: v['sms-api-key'] ?? '',
    PLAYERONE_SMS_SECRET_KEY: v['sms-secret-key'] ?? '',
    PLAYERONE_SMS_BRANDNAME: v['sms-brandname'] ?? '',
    PLAYERONE_SMS_SANDBOX: v['sms-sandbox'] ? '1' : '0',
  };
}

/**
 * Which variables a release needs that an existing cloud.env has never heard of.
 *
 * `provision.sh --force` keeps the credentials a deployment is already using
 * and used to skip this file entirely, so every variable added after the first
 * provision silently never reached the VM. Measured on 2026-09-16: the demo
 * bypass key, the log allowlist and the three Zalo values were all absent from
 * a redeploy of the right revision, and `POST /auth/collector/demo` answered
 * 404 as though the feature had not shipped.
 *
 * Only names that are missing are returned. A variable already in the file is
 * left exactly as it is, because its value may be a credential this deployment
 * is running on; changing one is an edit to cloud.env, not a re-provision.
 */
export const missingFrom = (existing, env) => {
  const held = new Set([...existing.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map(m => m[1]));
  return Object.keys(env).filter(k => !held.has(k));
};

// Compose single quotes preserve literal dollars and backslashes; never source this as shell code.
export const dotenv = values => Object.entries(values).map(([k, v]) => `${k}='${v.replaceAll("'", "\\'")}'`).join('\n') + '\n';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    /**
     * `--merge` is the re-provision path: keep what is there, add what is new.
     * Without it the write still refuses to touch an existing file (`wx`).
     */
    const argv = process.argv.slice(2);
    const merge = argv.includes('--merge');
    const args = argv.filter(a => a !== '--merge'), values = configuration(args);
    const output = args.includes('--output') ? args[args.indexOf('--output') + 1] : new URL('cloud.env', import.meta.url);
    const template = readFileSync(new URL('cloud.env.example', import.meta.url), 'utf8');
    const fixed = Object.fromEntries(template.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const env = { ...fixed, ...values };
    if (Object.values(env).some(v => v.includes('REPLACE_'))) throw new Error('An unfilled template value remains');
    if (merge && existsSync(output)) {
      const missing = missingFrom(readFileSync(output, 'utf8'), env);
      // Names only: a value here could be a credential, and this runs on every redeploy.
      if (missing.length === 0) console.log('PASS cloud.env already carries every variable this release needs');
      else {
        appendFileSync(output, dotenv(Object.fromEntries(missing.map(k => [k, env[k]]))));
        console.log(`PASS cloud.env gained ${missing.length} variable(s) this release added: ${missing.join(', ')}`);
        console.log('PASS values already in cloud.env were left as they are; edit the file to change one');
      }
    } else {
      writeFileSync(output, dotenv(env), { flag: 'wx', mode: 0o600 });
      console.log('PASS configuration written; save these credentials (printed only on creation):');
      for (const k of ['PLAYERONE_TOKEN_SECRET', 'PLAYERONE_MACHINE_SECRET', 'PLAYERONE_APP_PASSWORD', 'POSTGRES_PASSWORD',
        'PLAYERONE_DEMO_ADMIN_SECRET', 'PLAYERONE_DEMO_FINANCE_SECRET', 'PLAYERONE_DEMO_REVIEWER_SECRET']) console.log(`${k}=${env[k]}`);
    }
  } catch (error) { console.error(`FAIL configuration: ${error.message}`); process.exitCode = 1; }
}
