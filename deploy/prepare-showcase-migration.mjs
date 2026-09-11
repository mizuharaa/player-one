import { readFile, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'packages/store/drizzle');
const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8'));
const tags = ['0025_cloud_verification_exception', '0026_showcase_footage', '0027_showcase_review_grants'];
const entries = await Promise.all(tags.map(async tag => {
  const entry = journal.entries.find(item => item.tag === tag);
  if (!entry) throw new Error('Missing reviewed migration');
  return { tag, when: entry.when, idx: entry.idx, hash: createHash('sha256').update(await readFile(join(folder, `${tag}.sql`))).digest('hex') };
}));
if (entries.some((entry, i) => entry.idx !== 43 + i || entry.when !== [1788800000000, 1788990000000, 1788990010000][i])) throw new Error('Unexpected migration journal order');
const [previous, ...migrations] = entries;
const last = migrations.at(-1);
await mkdir(join(root, 'scratchpad'), { recursive: true });
const target = await mkdtemp(join(root, 'scratchpad/showcase-migration-'));
for (const migration of migrations) await copyFile(join(folder, `${migration.tag}.sql`), join(target, `${migration.tag}.sql`));
const exact = entry => `(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}) = 1 AND EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when} AND hash = '${entry.hash}')`;
const allowed = ['verdict', 'note', 'reviewed_at'];
const denied = ['id', 'operator_id', 'filename', 'content_type', 'content', 'bytes', 'sha256', 'created_at', 'expires_at'];
const checks = [
  ...['SELECT', 'INSERT', 'DELETE'].map(privilege => `NOT has_table_privilege('playerone_app', 'public.showcase_footage', '${privilege}')`),
  `has_table_privilege('playerone_app', 'public.showcase_footage', 'UPDATE')`,
  ...allowed.map(column => `NOT has_column_privilege('playerone_app', 'public.showcase_footage', '${column}', 'UPDATE')`),
  ...denied.map(column => `has_column_privilege('playerone_app', 'public.showcase_footage', '${column}', 'UPDATE')`),
];
const sql = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
SELECT
  (SELECT max(created_at) FROM drizzle.__drizzle_migrations) = ${previous.when}
  AND ${exact(previous)}
  AND NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= ${migrations[0].when})
  AND to_regclass('public.showcase_footage') IS NULL AS ready,
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
const manifest = { target, previous, migrations, hashes, sourceDatabaseImage: 'ghcr.io/railwayapp-templates/postgres-ssl:18', secretsIncluded: false, executed: false };
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
