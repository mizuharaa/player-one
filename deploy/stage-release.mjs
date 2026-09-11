/** Build an upload-safe source snapshot before `railway up` archives anything.
 * Run from any cwd. Never copies credentials, git history, local dependencies,
 * recordings outside public website assets, or scratchpad content. Never deletes.
 */
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const exactFiles = [
  'Dockerfile', '.dockerignore', 'railway.toml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'packages/api/package.json', 'packages/api/bin/serve.ts',
  'packages/contracts/package.json', 'packages/store/package.json', 'packages/store/drizzle.config.ts',
  'packages/design/package.json', 'apps/console/package.json', 'apps/console/index.html',
  'apps/console/tsconfig.json', 'apps/console/vite.config.ts',
];
const trees = [
  'packages/api/src', 'packages/contracts/src', 'packages/store/src', 'packages/store/drizzle',
  'packages/design/src', 'packages/design/scripts', 'packages/design/generated',
  'apps/console/src', 'apps/console/public', 'tools/analysers',
];
function excluded(path) {
  return path.split('/').some((part) => ['node_modules', 'scratchpad', '.git', 'docs', 'sample-data', 'corpus'].includes(part))
    || /(^|\/)\.env(?:\.|$)/i.test(path)
    || /\.(?:test\.[^.]+|log|map|md|pem|key|p12|pfx|crt)$/i.test(path)
    || /(^|\/)(?:id_rsa|id_ed25519|credentials\.json|secrets\.json)$/i.test(path);
}

const scratch = resolve(source, 'scratchpad');
await mkdir(scratch, { recursive: true });
const staging = await mkdtemp(join(scratch, 'railway-release-'));
if (!staging.startsWith(`${scratch}${sep}`)) throw new Error('Unexpected staging path');
const files = [];

async function copy(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (excluded(normalized)) return;
  const input = resolve(source, normalized);
  if (!input.startsWith(`${resolve(source)}${sep}`)) throw new Error('Input escapes source root');
  const info = await lstat(input);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular source file: ${normalized}`);
  const output = resolve(staging, normalized);
  if (!output.startsWith(`${staging}${sep}`)) throw new Error('Output escapes staging root');
  await mkdir(dirname(output), { recursive: true });
  await copyFile(input, output);
  const bytes = await readFile(output);
  const inputNow = await readFile(input);
  if (!bytes.equals(inputNow)) throw new Error(`Source changed during snapshot: ${normalized}; make a new stage`);
  files.push({ path: normalized, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}

async function copyTree(relativePath) {
  if (excluded(relativePath)) return;
  const info = await lstat(resolve(source, relativePath));
  if (info.isSymbolicLink()) throw new Error(`Source symlink is not eligible for upload: ${relativePath}`);
  if (info.isFile()) { await copy(relativePath); return; }
  for (const entry of await readdir(resolve(source, relativePath), { withFileTypes: true })) {
    await copyTree(`${relativePath}/${entry.name}`);
  }
}

for (const file of exactFiles) await copy(file);
for (const tree of trees) await copyTree(tree);
for (const entry of await readdir(resolve(source, 'deploy'), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.mjs')) await copy(`deploy/${entry.name}`);
}
files.sort((a, b) => a.path.localeCompare(b.path));
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const manifest = `${staging}.manifest.json`;
await writeFile(manifest, JSON.stringify({ createdAt: new Date().toISOString(), source,
  staging, totalFiles: files.length, totalBytes, files }, null, 2));
console.log(JSON.stringify({ staging, manifest, totalFiles: files.length, totalBytes,
  mebibytes: Number((totalBytes / 1024 / 1024).toFixed(2)),
  sourceRelativeStage: relative(source, staging) }, null, 2));
