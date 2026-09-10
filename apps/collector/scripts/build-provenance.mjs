import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A copied folder cannot establish its source revision. Use a short Git checkout. */
export function releaseSource(repoRoot) {
  function git(...args) {
    const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
      throw new Error('Release provenance requires a real Git checkout; use a short physical checkout, not a source snapshot.');
    }
    return result.stdout.trim();
  }
  const canonical = (path) => {
    const value = realpathSync(path);
    return process.platform === 'win32' ? value.toLowerCase() : value;
  };
  if (canonical(git('rev-parse', '--show-toplevel')) !== canonical(repoRoot)) {
    throw new Error('Release provenance requires this repository to be a Git checkout, not a snapshot inside another checkout.');
  }
  const revision = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--untracked-files=normal')) {
    throw new Error('Release source is dirty. Review and commit the intended changes before building; do not auto-stage generated files.');
  }
  return { revision, dirty: false, lockfile_sha256: sha256(readFileSync(join(repoRoot, 'pnpm-lock.yaml'))) };
}

/** Called only after successful native commands. Inputs are not runtime proof. */
export function writeReleaseManifest({ repoRoot, source, artifactPath, profile, apiOrigin, config }) {
  const after = releaseSource(repoRoot);
  if (JSON.stringify(after) !== JSON.stringify(source)) {
    throw new Error('Release source changed during the build. Review the changes and rebuild from one clean revision.');
  }
  let stat;
  try { stat = statSync(artifactPath); } catch { throw new Error('Native build returned success but its release artifact is missing.'); }
  if (!stat.isFile() || stat.size === 0) throw new Error('Native release artifact must be a non-empty file.');
  const manifest = {
    schema_version: 1,
    built_at: new Date().toISOString(),
    profile,
    api_origin: apiOrigin,
    application_id: config.android.package,
    version: config.version,
    version_code: config.android.versionCode,
    source,
    artifact: { file: basename(artifactPath), bytes: stat.size, sha256: sha256(readFileSync(artifactPath)) },
    runtime_api_verified: false,
  };
  const manifestPath = `${artifactPath}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifestPath;
}
