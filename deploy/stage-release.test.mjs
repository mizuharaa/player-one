import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Presence and byte-parity check; the staged Docker build proves import closure.
test('staging preserves required runtime files and excludes private inputs', async (t) => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const fixture = await mkdtemp(join(tmpdir(), 'playerone-stage-proof-'));
  assert.equal(dirname(fixture), tmpdir());
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const copy = async (path) => {
    await mkdir(dirname(join(fixture, path)), { recursive: true });
    await cp(join(source, path), join(fixture, path), { recursive: true,
      filter: (path) => !path.split(/[\\/]/).includes('node_modules') });
  };
  for (const path of ['Dockerfile', '.dockerignore', 'railway.toml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'patches', 'packages/api/src', 'packages/api/bin', 'packages/api/scripts', 'packages/contracts/src',
    'packages/store/src', 'packages/store/drizzle', 'packages/store/drizzle.config.ts',
    'packages/ingest/src', 'packages/delivery/src', 'packages/design/src', 'packages/design/scripts',
    'packages/design/generated', 'apps/console/index.html', 'apps/console/tsconfig.json',
    'apps/console/vite.config.ts', 'tools/analysers', 'deploy/stage-release.mjs']) await copy(path);
  const workspace = ['api', 'contracts', 'store', 'ingest', 'delivery', 'design'].map((name) => `packages/${name}`);
  workspace.push('apps/console');
  for (const path of workspace) await copy(`${path}/package.json`);
  for (const dir of ['apps/console/src', 'apps/console/public']) await mkdir(join(fixture, dir), { recursive: true });
  for (const path of ['packages/api/src/.env', 'packages/api/src/credentials.json', 'packages/api/src/debug.test.ts',
    'apps/console/public/local.key']) await writeFile(join(fixture, path), 'must never upload');
  const stdout = execFileSync(process.execPath, [join(fixture, 'deploy/stage-release.mjs')], { encoding: 'utf8', windowsHide: true });
  const { staging, manifest } = JSON.parse(stdout);
  const record = JSON.parse(await readFile(manifest, 'utf8'));
  const paths = new Set(record.files.map((file) => file.path));
  for (const path of workspace) assert.ok(paths.has(`${path}/package.json`), `missing workspace ${path}`);
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  for (const path of Object.values(pkg.pnpm.patchedDependencies)) assert.ok(paths.has(path), `missing patch ${path}`);
  for (const path of ['packages/api/bin/serve.ts', 'packages/api/bin/bootstrap.ts', 'packages/api/scripts/moov.ts',
    'packages/ingest/src/ingest.ts', 'packages/delivery/src/index.ts']) assert.ok(paths.has(path), `missing runtime ${path}`);
  assert.ok(![...paths].some((path) => /\.env|credentials\.json|debug\.test\.ts|local\.key/.test(path)));
  for (const file of record.files) {
    const bytes = await readFile(join(staging, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.deepEqual(bytes, await readFile(join(fixture, file.path)));
  }
  const staged = await readdir(staging, { recursive: true, withFileTypes: true });
  assert.equal(staged.filter((entry) => entry.isFile()).length, record.totalFiles);
});
