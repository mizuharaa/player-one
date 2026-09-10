import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { releaseSource, writeReleaseManifest } from './build-provenance.mjs';

let repoRoot;
function git(...args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function commit(...paths) {
  git('add', 'pnpm-lock.yaml', '.gitignore', ...paths);
  git('-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
}
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'playerone-release-test-'));
  git('init', '--quiet');
  writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'abc');
  writeFileSync(join(repoRoot, '.gitignore'), 'output/\nsnapshot/\n');
  commit();
  mkdirSync(join(repoRoot, 'output'));
});
afterEach(() => {
  // Only remove the exact disposable directory created by this test.
  const within = relative(realpathSync(tmpdir()), realpathSync(repoRoot));
  assert.ok(within.startsWith('playerone-release-test-') && !within.includes('..') && !isAbsolute(within));
  rmSync(repoRoot, { recursive: true });
});
const config = { version: '0.0.1', android: { package: 'vn.vng.playerone.collector.demo', versionCode: 4 } };
function inputs() {
  return { repoRoot, source: releaseSource(repoRoot), artifactPath: join(repoRoot, 'output', 'app-release.apk'), profile: 'demo', apiOrigin: 'http://192.168.1.10:8080', config };
}

test('records committed revision, exact lock/artifact hashes, selected configuration and no runtime claim', () => {
  const args = inputs();
  writeFileSync(args.artifactPath, 'abc');
  const manifest = JSON.parse(readFileSync(writeReleaseManifest(args), 'utf8'));
  assert.deepEqual(manifest.source, { revision: git('rev-parse', 'HEAD'), dirty: false, lockfile_sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
  assert.deepEqual(manifest.artifact, { file: 'app-release.apk', bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
  assert.equal(manifest.api_origin, args.apiOrigin);
  assert.equal(manifest.application_id, config.android.package);
  assert.equal(manifest.version_code, 4);
  assert.equal(manifest.version, '0.0.1');
  assert.equal(manifest.profile, 'demo');
  assert.equal(manifest.runtime_api_verified, false);
  assert.ok(Number.isFinite(Date.parse(manifest.built_at)));
});

test('refuses modified and untracked release source before building', () => {
  writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'modified');
  assert.throws(() => releaseSource(repoRoot), /dirty.*commit/);
  writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'abc');
  writeFileSync(join(repoRoot, 'extra-source.js'), 'unreviewed');
  assert.throws(() => releaseSource(repoRoot), /dirty.*commit/);
});

test('rejects a copied snapshot even when Git discovers its parent repository', () => {
  const snapshot = join(repoRoot, 'snapshot');
  mkdirSync(snapshot);
  writeFileSync(join(snapshot, 'pnpm-lock.yaml'), 'abc');
  assert.throws(() => releaseSource(snapshot), /snapshot inside another checkout/);
});

test('no successful manifest is emitted for missing or empty native output', () => {
  const args = inputs();
  assert.throws(() => writeReleaseManifest(args), /artifact is missing/);
  assert.equal(existsSync(`${args.artifactPath}.manifest.json`), false);
  writeFileSync(args.artifactPath, '');
  assert.throws(() => writeReleaseManifest(args), /non-empty file/);
  assert.equal(existsSync(`${args.artifactPath}.manifest.json`), false);
});

test('refuses tracked changes made during native generation', () => {
  const args = inputs();
  writeFileSync(args.artifactPath, 'artifact');
  writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'changed during build');
  assert.throws(() => writeReleaseManifest(args), /dirty/);
  assert.equal(existsSync(`${args.artifactPath}.manifest.json`), false);
});

test('refuses a changed revision even when the checkout becomes clean again', () => {
  const args = inputs();
  writeFileSync(args.artifactPath, 'artifact');
  writeFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'new revision');
  commit();
  assert.throws(() => writeReleaseManifest(args), /source changed during/);
  assert.equal(existsSync(`${args.artifactPath}.manifest.json`), false);
});

test('does not overwrite an existing artifact manifest with a new build claim', () => {
  const args = inputs();
  writeFileSync(args.artifactPath, 'artifact');
  const manifestPath = `${args.artifactPath}.manifest.json`;
  writeFileSync(manifestPath, 'previous proof');
  assert.throws(() => writeReleaseManifest(args), /EEXIST/);
  assert.equal(readFileSync(manifestPath, 'utf8'), 'previous proof');
});

test('a failed native command exits without relabelling an older artifact as a fresh build', () => {
  const collector = join(repoRoot, 'apps', 'collector');
  const scripts = join(collector, 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const file of ['build-android.mjs', 'build-provenance.mjs']) {
    writeFileSync(join(scripts, file), readFileSync(new URL(file, import.meta.url)));
  }
  writeFileSync(join(collector, 'app.config.cjs'), 'module.exports = ({ config }) => config;');
  writeFileSync(join(collector, 'app.json'), JSON.stringify({ expo: config }));
  writeFileSync(join(repoRoot, '.gitignore'), 'output/\nsnapshot/\nnode_modules/\napps/collector/android/\n');
  commit('apps/collector/scripts/build-android.mjs', 'apps/collector/scripts/build-provenance.mjs', 'apps/collector/app.config.cjs', 'apps/collector/app.json');
  const expo = join(repoRoot, 'node_modules', 'expo', 'bin');
  mkdirSync(expo, { recursive: true });
  // Execute the real wrapper; only Expo is replaced with a failing child process.
  writeFileSync(join(expo, 'cli'), 'process.exit(19);');
  const output = join(collector, 'android', 'app', 'build', 'outputs', 'apk', 'release');
  mkdirSync(output, { recursive: true });
  const manifestPath = join(output, 'app-release.apk.manifest.json');
  writeFileSync(join(output, 'app-release.apk'), 'older artifact');
  writeFileSync(manifestPath, 'older proof');
  const result = spawnSync(process.execPath, [join(scripts, 'build-android.mjs'), 'demo'], {
    env: { ...process.env, EXPO_PUBLIC_API_URL: 'http://192.168.1.10:8080' }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 19, result.stderr);
  assert.equal(result.stdout.includes('build complete'), false);
  assert.equal(readFileSync(manifestPath, 'utf8'), 'older proof');
});
