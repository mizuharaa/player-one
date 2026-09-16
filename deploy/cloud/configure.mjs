import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
      'demo-bypass-key'].map(k => [k, { type: 'string' }]),
    ...['local-db', 'http-local'].map(k => [k, { type: 'boolean' }]),
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
  };
}

// Compose single quotes preserve literal dollars and backslashes; never source this as shell code.
export const dotenv = values => Object.entries(values).map(([k, v]) => `${k}='${v.replaceAll("'", "\\'")}'`).join('\n') + '\n';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), values = configuration(args);
    const output = args.includes('--output') ? args[args.indexOf('--output') + 1] : new URL('cloud.env', import.meta.url);
    const template = readFileSync(new URL('cloud.env.example', import.meta.url), 'utf8');
    const fixed = Object.fromEntries(template.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const env = { ...fixed, ...values };
    if (Object.values(env).some(v => v.includes('REPLACE_'))) throw new Error('An unfilled template value remains');
    writeFileSync(output, dotenv(env), { flag: 'wx', mode: 0o600 });
    console.log('PASS configuration written; save these credentials (printed only on creation):');
    for (const k of ['PLAYERONE_TOKEN_SECRET', 'PLAYERONE_MACHINE_SECRET', 'PLAYERONE_APP_PASSWORD', 'POSTGRES_PASSWORD',
      'PLAYERONE_DEMO_ADMIN_SECRET', 'PLAYERONE_DEMO_FINANCE_SECRET', 'PLAYERONE_DEMO_REVIEWER_SECRET']) console.log(`${k}=${env[k]}`);
  } catch (error) { console.error(`FAIL configuration: ${error.message}`); process.exitCode = 1; }
}
