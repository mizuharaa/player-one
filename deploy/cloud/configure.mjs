import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function configuration(args) {
  const { values: v } = parseArgs({ args, options: Object.fromEntries([
    ...['domain', 'acme-email', 'database-url', 'storage-endpoint', 'storage-bucket',
      'storage-key', 'storage-secret', 'quota-bytes', 'output'].map(k => [k, { type: 'string' }]),
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
