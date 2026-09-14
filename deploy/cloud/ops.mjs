import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { bootstrap } from '../../packages/api/bin/bootstrap.ts';
import { open } from '../../packages/store/src/index.ts';
import { preflight } from '../demo-preflight.mjs';
import { pathToFileURL } from 'node:url';
const postgres = createRequire(new URL('../../packages/store/package.json', import.meta.url))('postgres');

export function demoUrl(value) {
  const url = new URL(value);
  if (!/^\/(?:po_demo|playerone_demo)[a-z0-9_]*$/.test(url.pathname)) throw new Error('Refusing a non-demo database');
  return url;
}
export function isolatedUrl(value, name, prefix) {
  const url = demoUrl(value);
  if (!new RegExp(`^${prefix}[a-z0-9_]+$`).test(name) || name.length > 63 || `/${name}` === url.pathname) throw new Error('Refusing unsafe or demo database target');
  url.pathname = `/${name}`;
  return url;
}
const env = process.env;
async function ownerJob(fn, value = env.OWNER_DATABASE_URL) {
  const sql = postgres(value, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try { return await fn(sql); } finally { await sql.end({ timeout: 5 }); }
}
async function health() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${env.PLAYERONE_PUBLIC_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
      if (response.ok && (await response.json()).ready === true) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('/healthz did not become ready');
}
async function main([command, name]) {
  demoUrl(env.DATABASE_URL);
  demoUrl(env.OWNER_DATABASE_URL);
  switch (command) {
    case 'ready':
      for (let i = 0; i < 60; i++) {
        try { await ownerJob(sql => sql`select 1`); return; } catch (e) { if (i === 59) throw e; }
        await new Promise(r => setTimeout(r, 1000));
      }
      break;
    case 'grant':
      await ownerJob(async sql => {
        const password = env.PLAYERONE_APP_PASSWORD;
        if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Expected generated application password');
        await sql.unsafe(`ALTER ROLE playerone_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
      });
      break;
    case 'bootstrap': {
      const db = await open();
      try { await bootstrap(db, {
        mode: 'create', region: 'HCM', name: 'Upload centre HCM-01', machine: env.PLAYERONE_MACHINE_IDENTIFIER,
        secret: env.PLAYERONE_MACHINE_SECRET,
        operators: [{ ref: 'op-1', role: 'administrator', secret: env.PLAYERONE_DEMO_ADMIN_SECRET },
          { ref: 'fin-1', role: 'finance', secret: env.PLAYERONE_DEMO_FINANCE_SECRET }],
      }); } finally { await db.close(); }
      break;
    }
    case 'health': await health(); break;
    case 'e2e': {
      const name = `po_e2e_cloud_${Date.now()}_${randomBytes(6).toString('hex')}`;
      const target = isolatedUrl(env.OWNER_DATABASE_URL, name, 'po_e2e_cloud_');
      const admin = new URL(env.OWNER_DATABASE_URL); admin.pathname = '/postgres';
      await ownerJob(sql => sql`create database ${sql(name)}`, admin.href);
      console.log(`SIMULATION e2e database ${name}; demo ${demoUrl(env.DATABASE_URL).pathname} is excluded`);
      try {
        const childEnv = { ...env, DATABASE_URL: target.href, PLAYERONE_ALLOW_SUPERUSER: '1',
          STORAGE_ENDPOINT: '', STORAGE_BUCKET: '', STORAGE_KEY: '', STORAGE_SECRET: '' };
        // The loop's fake rail and filesystem bucket stay inside this throwaway process/database.
        for (const args of [['node_modules/drizzle-kit/bin.cjs', 'migrate', '--config', 'packages/store/drizzle.config.ts'],
          ['packages/api/scripts/e2e-loop.mjs']]) {
          const child = spawnSync(process.execPath, args, { env: childEnv, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024 });
          for (const line of `${child.stdout ?? ''}\n${child.stderr ?? ''}`.split(/\r?\n/).filter(Boolean)) console.log(`SIMULATION ${line}`);
          if (child.error || child.status !== 0) throw new Error(`Isolated e2e command failed (${child.status})`);
        }
      } finally {
        await ownerJob(async sql => {
          await sql`checkpoint`;
          await sql`drop database ${sql(name)}`;
        }, admin.href);
        console.log(`PASS isolated database cleanup ${name}`);
      }
      break;
    }
    case 'preflight': {
      const findings = await preflight(env);
      for (const f of findings) {
        const level = f.check === 'certificate' && new URL(env.PLAYERONE_PUBLIC_URL).protocol !== 'https:' ? 'SKIPPED' : f.level;
        console.log(`${level} ${f.check}: ${f.message}`);
      }
      if (findings.some(f => f.level === 'FAIL')) throw new Error('Preflight failed');
      break;
    }
    case 'counts': {
      const url = name ? isolatedUrl(env.OWNER_DATABASE_URL, name, 'po_restore_') : demoUrl(env.OWNER_DATABASE_URL);
      const counts = await ownerJob(async sql => sql.begin('isolation level repeatable read read only', async tx => {
        const tables = await tx`select tablename from pg_tables where schemaname = 'public' order by tablename`;
        const values = {};
        for (const { tablename } of tables) {
          const [row] = await tx`select count(*)::text as n from ${tx(tablename)}`;
          values[tablename] = row.n;
        }
        return values;
      }), url.href);
      console.log(JSON.stringify(counts));
      break;
    }
    case 'create-restore': {
      const target = isolatedUrl(env.OWNER_DATABASE_URL, name, 'po_restore_');
      const admin = new URL(env.OWNER_DATABASE_URL); admin.pathname = '/postgres';
      await ownerJob(sql => sql`create database ${sql(target.pathname.slice(1))}`, admin.href);
      break;
    }
    default: throw new Error(`Unknown operation: ${command}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(`FAIL ${process.argv[2]}: ${error.message}`); process.exitCode = 1; }
}
