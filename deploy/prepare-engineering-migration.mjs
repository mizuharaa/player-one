import { readFile, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCredential } from '../packages/api/src/credentials.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'packages/store/drizzle');
const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8'));
const tags = ['0027_showcase_review_grants', '0028_showcase_rls'];
const entries = await Promise.all(tags.map(async tag => {
  const entry = journal.entries.find(item => item.tag === tag);
  if (!entry) throw new Error('Missing reviewed migration');
  return { tag, when: entry.when, idx: entry.idx, hash: createHash('sha256').update(await readFile(join(folder, `${tag}.sql`))).digest('hex') };
}));
if (entries.some((entry, i) => entry.idx !== 45 + i || entry.when !== [1788990010000, 1789070000000][i])) throw new Error('Unexpected migration journal order');
const [previous, ...migrations] = entries;
const last = migrations.at(-1);
await mkdir(join(root, 'scratchpad'), { recursive: true });
const target = await mkdtemp(join(root, 'scratchpad/engineering-migration-'));
for (const migration of migrations) await copyFile(join(folder, `${migration.tag}.sql`), join(target, `${migration.tag}.sql`));
const exact = entry => `(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}) = 1 AND EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when} AND hash = '${entry.hash}')`;
const allowed = ['verdict', 'note', 'reviewed_at'];
const denied = ['id', 'operator_id', 'filename', 'content_type', 'content', 'bytes', 'sha256', 'created_at', 'expires_at'];
const checks = [
  `NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.showcase_footage'::regclass)`,
  `(SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname='playerone_app')`,
  `(SELECT pg_has_role('playerone_app',relowner,'MEMBER') FROM pg_class WHERE oid='public.showcase_footage'::regclass)`,
  `NOT has_function_privilege('playerone_app','public.showcase_purge_expired()','EXECUTE')`,
  ...['SELECT', 'INSERT', 'DELETE'].map(privilege => `NOT has_table_privilege('playerone_app', 'public.showcase_footage', '${privilege}')`),
  `has_table_privilege('playerone_app', 'public.showcase_footage', 'UPDATE')`,
  ...allowed.map(column => `NOT has_column_privilege('playerone_app', 'public.showcase_footage', '${column}', 'UPDATE')`),
  ...denied.map(column => `has_column_privilege('playerone_app', 'public.showcase_footage', '${column}', 'UPDATE')`),
];
// Optional, explicitly requested rotation of only the three existing showcase
// identities. Plaintext keys stay in ignored local files; the job gets hashes.
let credentialSql = '';
if (process.argv.includes('--short-access')) {
  const old = JSON.parse(await readFile(join(root, 'scratchpad/local-demo/showcase-login.private.json'), 'utf8'));
  const next = JSON.parse(await readFile(join(root, 'scratchpad/local-demo/short-login.private.json'), 'utf8'));
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const uuid = value => /^[0-9a-f-]{36}$/i.test(value);
  if (!uuid(old.centre.id) || old.centre.id !== next.centre.id) throw new Error('Unexpected showcase centre');
  const rows = [
    {name:'machine', table:'upload_devices', column:'machine_identifier', ref:'identifier', label:'studio'},
    {name:'administrator', table:'operators', column:'external_ref', ref:'externalRef', label:'admin', role:'administrator'},
    {name:'finance', table:'operators', column:'external_ref', ref:'externalRef', label:'finance', role:'finance'},
  ];
  for (const row of rows) {
    const before = old[row.name], after = next[row.name];
    if (!uuid(before.id) || before.id !== after.id || after[row.ref] !== row.label || !/^[A-HJ-NP-Z2-9]{12}$/.test(after.secret)) throw new Error('Unexpected showcase credential plan');
    const hash = await hashCredential(after.secret);
    const scope = `id=${quote(before.id)}::uuid AND upload_centre_id=${quote(old.centre.id)}::uuid AND status='active'${row.role ? ` AND role=${quote(row.role)}` : ''}`;
    credentialSql += `
DO $$ BEGIN
 IF (SELECT count(*) FROM public.${row.table} WHERE ${scope} AND ${row.column} IN (${quote(before[row.ref])},${quote(after[row.ref])})) <> 1 THEN
  RAISE EXCEPTION 'Exact showcase identity verification failed; no changes committed';
 END IF;
END $$;
WITH changed AS (
 UPDATE public.${row.table} SET ${row.column}=${quote(after[row.ref])},credential_hash=${quote(hash)}
 WHERE ${scope} AND credential_hash<>${quote(hash)} RETURNING id
)
INSERT INTO public.audit_events(action,target_table,target_id,actor_role,operator_id,upload_device_id,upload_centre_id,"after")
SELECT 'showcase.credentials_rotated',${quote(row.table)},id::text,'operator',${quote(old.administrator.id)}::uuid,${quote(old.machine.id)}::uuid,${quote(old.centre.id)}::uuid,'{"credential_rotated":true,"showcase_only":true}'::jsonb FROM changed;
`;
  }
}
const sql = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
SELECT
  (SELECT max(created_at) FROM drizzle.__drizzle_migrations) = ${previous.when}
  AND ${exact(previous)}
  AND NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= ${migrations[0].when})
  AND to_regclass('public.showcase_footage') IS NOT NULL AS ready,
  (SELECT max(created_at) FROM drizzle.__drizzle_migrations) = ${last.when}
  AND ${entries.map(exact).join('\n  AND ')}
  AND to_regclass('public.showcase_footage') IS NOT NULL AS applied
\\gset
\\if :applied
  \\echo Showcase migration already applied with the expected hash.
\\elif :ready
${migrations.map(entry => `  \\ir ${entry.tag}.sql\n  INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${entry.hash}', ${entry.when});`).join('\n')}
  \\echo Showcase migration applied.
\\else
  DO $$ BEGIN RAISE EXCEPTION 'Unexpected migration head, hash or existing showcase table; refusing changes.'; END $$;
\\endif
DO $$ BEGIN
  IF ${checks.join('\n    OR ')} THEN
    RAISE EXCEPTION 'Showcase runtime grants did not match the reviewed policy.';
  END IF;
END $$;
SELECT current_database() AS database, to_regclass('public.showcase_footage') AS showcase_table, true AS runtime_policy_verified;
${credentialSql}
COMMIT;
`;
await writeFile(join(target, 'apply.sql'), sql);
await writeFile(join(target, 'run.sh'), `#!/bin/sh
set -eu
psql --no-psqlrc --set ON_ERROR_STOP=1 --file /migration/apply.sql
printf '%s\\n' 'SHOWCASE_MIGRATION_EXIT=0'
`);
await writeFile(join(target, 'Dockerfile'), `FROM postgres:18-bookworm
WORKDIR /migration
COPY apply.sql ${migrations.map(entry => entry.tag + '.sql').join(' ')} run.sh ./
USER postgres
ENTRYPOINT ["/bin/sh", "/migration/run.sh"]
`);
await writeFile(join(target, '.dockerignore'), '*\n!Dockerfile\n!apply.sql\n!run.sh\n' + migrations.map(entry => '!' + entry.tag + '.sql\n').join(''));
await writeFile(join(target, 'railway.toml'), '[build]\nbuilder = "DOCKERFILE"\ndockerfilePath = "Dockerfile"\n[deploy]\nrestartPolicyType = "ON_FAILURE"\nrestartPolicyMaxRetries = 1\n');
const files = ['apply.sql', 'run.sh', 'Dockerfile', '.dockerignore', 'railway.toml', ...migrations.map(entry => entry.tag + '.sql')];
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(join(target, file))).digest('hex')])));
const manifest = { target, previous, migrations, hashes, sourceDatabaseImage: 'ghcr.io/railwayapp-templates/postgres-ssl:18', secretsIncluded: false, credentialHashesIncluded: !!credentialSql, executed: false };
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
