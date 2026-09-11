/** Explicitly authorized one-off job. Default mode only validates the artifact. */
import { spawn } from 'node:child_process';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = '5be6dfb6-0437-4a3d-ad33-b25b1a7f9eb6';
const ENVIRONMENT = '040798be-43c1-40ef-95f4-a3f423bdd18a';
const POSTGRES = '6dd60f05-485b-41d2-8095-a1d4aaca4d3b';
const WEB = 'a7913574-d4bb-46b7-a840-48b2ee0fccda';
const NAME = 'playerone-engineering-migration-0028';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--folder');
if (arg < 0 || !process.argv[arg + 1]) throw new Error('Provide --folder <prepared artifact>; --execute requires release authorization.');
const folder = await realpath(resolve(process.argv[arg + 1]));
if (!folder.startsWith(join(root, 'scratchpad') + sep)) throw new Error('Job folder must remain inside this workspace scratchpad.');
const allowed = ['.dockerignore', 'Dockerfile', 'railway.toml', 'manifest.json', 'apply.sql', 'run.sh', '0028_showcase_rls.sql'];
if ((await readdir(folder)).some(name => !allowed.includes(name))) throw new Error('Unexpected file in migration upload folder.');
const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
for (const file of allowed.filter(file => file !== 'manifest.json')) {
  const actual = createHash('sha256').update(await readFile(join(folder, file))).digest('hex');
  if (actual !== manifest.hashes?.[file]) throw new Error(`Artifact changed: ${file}`);
}
const expected = [['0028_showcase_rls', 1789070000000]];
if (manifest.migrations?.length !== 1 || manifest.secretsIncluded !== false) throw new Error('Unexpected migration bundle');
for (const [index, [tag, when]] of expected.entries()) {
  const sourceHash = createHash('sha256').update(await readFile(join(root, 'packages/store/drizzle', tag + '.sql'))).digest('hex');
  const entry = manifest.migrations[index];
  if (entry.tag !== tag || entry.when !== when || entry.hash !== sourceHash || manifest.hashes[tag + '.sql'] !== sourceHash) throw new Error('Migration source changed.');
}
const hash = manifest.hashes['apply.sql'];
if (!process.argv.includes('--execute')) { console.log(JSON.stringify({ validated: true, folder, hash, executed: false })); process.exit(0); }

const npx = join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
const selectors = ['--project', PROJECT, '--environment', ENVIRONMENT];
const statePath = join(root, 'scratchpad/qa/engineering-migration-job-state.json');
const state = { project: PROJECT, environment: ENVIRONMENT, name: NAME, folder, hash,
  service: null, deployment: null, verified: false, removed: false };
const save = async () => writeFile(statePath, JSON.stringify(state, null, 2));
const sanitize = value => value.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[redacted]@');
async function cli(args, input) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [npx, '--yes', '@railway/cli', ...args],
      { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveResult(out) : reject(new Error(`Railway ${args[0]} failed (${code}): ${sanitize(err).slice(-1500)}`)));
    child.stdin.end(input);
  });
}
const services = async () => JSON.parse(await cli(['service', 'list', ...selectors, '--json']));
const status = JSON.parse(await cli(['status', ...selectors, '--json']));
if (status.id !== PROJECT || !JSON.stringify(status.environments).includes(ENVIRONMENT)) throw new Error('Unexpected Railway project/environment.');
const before = await services();
const postgres = before.find(service => service.id === POSTGRES);
if (!postgres || postgres.name !== 'Postgres' || !JSON.stringify(postgres.source).includes('postgres-ssl:18') || !before.some(service => service.id === WEB)) throw new Error('Expected Postgres/web services were not found.');
if (before.some(service => service.name === NAME)) throw new Error('Temporary job name already exists; inspect it, never reuse blindly.');
await cli(['link', ...selectors, '--json']);
await cli(['add', '--service', NAME, '--json']);
const created = (await services()).filter(service => service.name === NAME && !before.some(old => old.id === service.id));
if (created.length !== 1 || [POSTGRES, WEB].includes(created[0].id)) throw new Error('Could not prove newly created job identity.');
state.service = created[0].id; await save();
console.log(`Created temporary migration job ${state.service}`);
const variables = { PGHOST: '${{Postgres.PGHOST}}', PGPORT: '${{Postgres.PGPORT}}',
  PGDATABASE: '${{Postgres.PGDATABASE}}', PGUSER: '${{Postgres.PGUSER}}',
  PGPASSWORD: '${{Postgres.PGPASSWORD}}', PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' };
for (const [key, value] of Object.entries(variables)) {
  await cli(['variable', 'set', ...selectors, '--service', state.service, '--skip-deploys', '--stdin', key], value);
  console.log(`Configured ${key} without exposing its value`);
}
await cli(['up', folder, '--path-as-root', ...selectors, '--service', state.service, '--detach', '--json']);
console.log('Uploaded allowlisted migration job; waiting for its actual completion.');
const deadline = Date.now() + 15 * 60_000;
let verified = false;
while (Date.now() < deadline) {
  const deployments = JSON.parse(await cli(['deployment', 'list', ...selectors, '--service', state.service, '--limit', '1', '--json']));
  const latest = deployments[0];
  if (latest) {
    state.deployment = latest.id; await save();
    console.log(`Migration deployment ${latest.id}: ${latest.status}`);
    if (['SUCCESS', 'COMPLETED', 'REMOVED', 'FAILED', 'CRASHED'].includes(latest.status)) {
      const output = await cli(['logs', latest.id, ...selectors, '--service', state.service, '--deployment', '--lines', '150', '--json']);
      const lines = output.trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line).message ?? ''; } catch { return ''; } });
      const logs = lines.join('\n');
      await writeFile(join(root, 'scratchpad/qa/engineering-migration-job.log'), sanitize(logs));
      const job = (await services()).find(service => service.id === state.service);
      const committed = /Showcase migration (?:applied|already applied with the expected hash)\./.test(logs)
        && /COMMIT/.test(logs) && /SHOWCASE_MIGRATION_EXIT=0/.test(logs)
        && !/(?:ERROR|FATAL):/.test(logs);
      if (committed && (job?.deploymentStopped === true || latest.status === 'COMPLETED')) { verified = true; break; }
      if (['FAILED', 'CRASHED'].includes(latest.status)) throw new Error('Migration job failed; retained only this job for inspection. See sanitized evidence.');
    }
  }
  await new Promise(resolveWait => setTimeout(resolveWait, 10_000));
}
if (!verified) throw new Error('Could not verify terminal success; temporary job retained for review.');
state.verified = true; await save();
const exact = (await services()).find(service => service.id === state.service);
if (exact?.name !== NAME || [POSTGRES, WEB].includes(state.service)) throw new Error('Cleanup target identity changed; refusing deletion.');
await cli(['service', 'delete', ...selectors, '--service', state.service, '--yes', '--json']);
state.removed = !(await services()).some(service => service.id === state.service);
await save();
if (!state.removed) throw new Error('Migration succeeded but temporary service removal was not confirmed.');
console.log(JSON.stringify({ migration: '0028', exit: 0, hash, serviceRemoved: true, evidence: statePath }));
