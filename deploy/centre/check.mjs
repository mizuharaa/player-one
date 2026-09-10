#!/usr/bin/env node
// Deployment checks only: no SQL, storage writes, sign-ins or task registration.
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function readEnvironment(text) {
  const values = {};
  for (const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=([^"\r\n]*)$/.exec(raw);
    if (!match || Object.hasOwn(values, match[1]) || match[2] !== match[2].trim()) {
      throw new Error(`Invalid or duplicate environment entry at line ${index + 1}; use unquoted KEY=value.`);
    }
    values[match[1]] = match[2];
  }
  return values;
}

const placeholder = (value) => !value || /REPLACE|CHANGEME|<[^>]+>|example\.(com|org|vn)/i.test(value);
const privateIPv4 = (host) => isIP(host) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
const loopback = (host) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
const result = (level, check, message) => ({ level, check, message });

export function configurationChecks(env) {
  const out = [];
  const fail = (check, message) => out.push(result('FAIL', check, message));
  for (const name of ['DATABASE_URL', 'PLAYERONE_TOKEN_SECRET', 'PLAYERONE_MEDIA_ROOT',
    'PLAYERONE_MACHINE_IDENTIFIER', 'PLAYERONE_MACHINE_SECRET', 'PLAYERONE_OPERATOR_REF',
    'PLAYERONE_OPERATOR_SECRET', 'STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_KEY', 'STORAGE_SECRET',
    'PLAYERONE_STORAGE_QUOTA_BYTES', 'PLAYERONE_PUBLIC_URL', 'PLAYERONE_BIND',
    'PLAYERONE_CONSOLE_ROOT', 'PLAYERONE_BACKUP_DIR']) {
    if (placeholder(env[name])) fail(name, `${name}: supply the deployment's real value; values are never printed.`);
  }
  const mode = env.PLAYERONE_DEPLOY_MODE;
  if (!['lan-demo', 'https-production'].includes(mode)) fail('mode', 'Set PLAYERONE_DEPLOY_MODE=lan-demo or https-production.');
  if (env.HOST !== '127.0.0.1') fail('api-bind', 'Keep HOST=127.0.0.1; only Caddy is reachable from another machine.');
  if (!/^\d+$/.test(env.PORT ?? '') || +env.PORT < 1 || +env.PORT > 65535) fail('api-port', 'Set PORT to a valid TCP port.');
  if (env.REVIEW_VERIFICATION_GATE !== 'cloud') fail('review-gate', 'REVIEW_VERIFICATION_GATE must remain cloud.');
  if (env.PLAYERONE_REVIEWER_MEDIA !== '0') fail('reviewer-media', 'Set PLAYERONE_REVIEWER_MEDIA=0; this kit does not authorize remote footage playback.');
  if (env.PLAYERONE_PAYOUT_MODE !== 'manual') fail('payout-mode', 'Keep PLAYERONE_PAYOUT_MODE=manual; real gateway activation is a separate handoff.');
  if ((env.PLAYERONE_ZALOPAY_ENV ?? 'sandbox') !== 'sandbox' ||
      ['APP_ID', 'PAYMENT_ID', 'KEY1', 'PUBLIC_KEY'].some((key) => env[`PLAYERONE_ZALOPAY_${key}`])) {
    fail('gateway-scope', 'Remove gateway credentials and keep its environment sandbox for this pre-gateway deployment; billing still works.');
  }
  if (!/^\d+$/.test(env.PLAYERONE_STORAGE_QUOTA_BYTES ?? '') || BigInt(env.PLAYERONE_STORAGE_QUOTA_BYTES ?? '0') <= 0n) {
    fail('quota', 'Set PLAYERONE_STORAGE_QUOTA_BYTES to the actual positive allocation in bytes.');
  }
  if ((env.PLAYERONE_TOKEN_SECRET ?? '').length < 32) fail('token-secret', 'Generate a persistent token secret of at least 32 characters.');
  try {
    const db = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.username !== 'playerone_app') {
      fail('database-role', 'DATABASE_URL must use playerone_app, never the migration owner.');
    }
    if (!loopback(db.hostname) && !['require', 'verify-full', 'disable'].includes(db.searchParams.get('sslmode'))) {
      fail('database-tls', 'A non-loopback database must state sslmode=require (or explicitly disable only on the approved trusted link).');
    } else if (!loopback(db.hostname) && db.searchParams.get('sslmode') === 'disable') {
      out.push(result('NOTE', 'database-tls', 'Database TLS is explicitly disabled; confirm this is the approved trusted link.'));
    }
  } catch { fail('database-url', 'DATABASE_URL is not a valid database URL.'); }
  try {
    const url = new URL(env.PLAYERONE_PUBLIC_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      fail('public-origin', 'PLAYERONE_PUBLIC_URL must be an origin without credentials, path, query or fragment.');
    }
    if (mode === 'lan-demo') {
      if (url.protocol !== 'http:' || !(privateIPv4(url.hostname) || loopback(url.hostname))) {
        fail('lan-origin', 'LAN demo needs an explicit private-IP HTTP origin; never expose it publicly.');
      }
      if (env.PLAYERONE_BIND !== url.hostname) fail('lan-bind', 'PLAYERONE_BIND must equal the LAN origin host.');
      if (env.PLAYERONE_SECURE_COOKIES !== '0') fail('cookies', 'Plain HTTP needs PLAYERONE_SECURE_COOKIES=0.');
    } else if (mode === 'https-production') {
      if (url.protocol !== 'https:' || loopback(url.hostname) || privateIPv4(url.hostname) || !/[a-z]/i.test(url.hostname)) {
        fail('tls-origin', 'HTTPS production needs the actual certificate-backed public hostname.');
      }
      if (env.PLAYERONE_SECURE_COOKIES !== '1') fail('cookies', 'HTTPS production needs PLAYERONE_SECURE_COOKIES=1.');
      if (env.PLAYERONE_DEMO_PHONE) fail('demo-phone', 'Remove PLAYERONE_DEMO_PHONE before production; it exposes that account\'s demo code.');
      if (env.PLAYERONE_ZNS_ENV !== 'production') fail('zns-mode', 'Production must use PLAYERONE_ZNS_ENV=production, never logged development codes.');
    }
  } catch { fail('public-origin', 'Set PLAYERONE_PUBLIC_URL to the actual reachable HTTP/HTTPS origin.'); }
  const zns = [env.PLAYERONE_ZNS_ACCESS_TOKEN, env.PLAYERONE_ZNS_TEMPLATE_ID];
  if (!['sandbox', 'production'].includes(env.PLAYERONE_ZNS_ENV ?? 'sandbox')) fail('zns-mode', 'PLAYERONE_ZNS_ENV must be sandbox or production.');
  if (zns.some(Boolean) && zns.some(placeholder)) fail('zns', 'Both ZNS access token and template ID must be configured together.');
  if (mode === 'https-production' && zns.some(placeholder)) fail('zns', 'Production needs real ZNS credentials; their delivery still needs handset proof.');
  if (mode === 'lan-demo' && !zns.some(Boolean) && !env.PLAYERONE_DEMO_PHONE) {
    fail('collector-sign-in', 'Configure the explicitly chosen demo phone or real ZNS delivery; log-only codes are not a rehearsed collector sign-in.');
  }
  out.push(result('NOTE', 'scope', 'Configuration checks do not prove database grants, cloud bytes, handset connectivity or backup recovery.'));
  return out;
}

export async function localChecks(env) {
  const out = [];
  for (const [name, path, file] of [
    ['media', env.PLAYERONE_MEDIA_ROOT, false], ['console-build', env.PLAYERONE_CONSOLE_ROOT && join(env.PLAYERONE_CONSOLE_ROOT, 'index.html'), true],
    ['backup-target', env.PLAYERONE_BACKUP_DIR, false],
  ]) {
    try {
      if (!path || !isAbsolute(path)) throw new Error('path');
      const item = await stat(path);
      if (file ? !item.isFile() : !item.isDirectory()) throw new Error('kind');
      await access(path, name === 'backup-target' ? constants.W_OK : constants.R_OK);
      out.push(result('OK', name, `${name}: present and accessible to this account; no write probe was performed.`));
    } catch { out.push(result('FAIL', name, `${name}: supply an accessible absolute path (and build the console if needed).`)); }
  }
  for (const [name, executable, args] of [
    ['node', env.PLAYERONE_NODE_EXE || (process.platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : process.execPath), ['--version']], ['ffprobe', 'ffprobe', ['-version']],
    ['caddy', env.PLAYERONE_CADDY_EXE || 'C:\\Tools\\Caddy\\caddy.exe', ['version']],
    ['pg_dump', 'pg_dump', ['--version']], ['pg_restore', 'pg_restore', ['--version']], ['psql', 'psql', ['--version']],
  ]) {
    const run = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    out.push(result(run.status === 0 ? 'OK' : 'FAIL', name,
      run.status === 0 ? `${name}: command is available.` : `${name}: install it or add the correct executable directory to PATH.`));
    if (name === 'node' && run.status === 0) {
      const version = /^v(\d+)\.(\d+)/.exec(run.stdout.trim());
      if (!version || +version[1] < 22 || (+version[1] === 22 && +version[2] < 18)) {
        out.push(result('FAIL', 'configured-node-version', 'The configured Node executable must be >=22.18.'));
      }
    }
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) out.push(result('FAIL', 'node-version', 'Use Node >=22.18 for native TypeScript entrypoints.'));
  return out;
}

export async function healthChecks(env, { timeoutMs = 5000 } = {}) {
  const out = [];
  let origin;
  try {
    origin = new URL(env.PLAYERONE_PUBLIC_URL);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error();
  } catch { return [result('FAIL', 'origin', 'Supply a valid credential-free PLAYERONE_PUBLIC_URL origin.')]; }
  const get = (path, headers) => fetch(new URL(path, origin), { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  try {
    const response = await get('/');
    const html = await response.text();
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html') || !html.includes('id="root"')) throw new Error();
    out.push(result('OK', 'console', 'Console HTML is served through the configured origin.'));
    const script = /<script\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];
    if (!script || new URL(script, origin).origin !== origin.origin) throw new Error();
    const asset = await get(script);
    if (asset.status !== 200 || !/(javascript|ecmascript)/i.test(asset.headers.get('content-type') ?? '')) throw new Error();
    await asset.body?.cancel();
    out.push(result('OK', 'console-script', 'The entry script is reachable and is not SPA fallback HTML.'));
  } catch { out.push(result('FAIL', 'console', 'Check Caddy, its console root/build, firewall and certificate; HTML or entry script did not load.')); }
  const machine = env.PLAYERONE_HEALTH_MACHINE_TOKEN;
  const operator = env.PLAYERONE_HEALTH_OPERATOR_TOKEN;
  if (Boolean(machine) !== Boolean(operator)) return [...out, result('FAIL', 'identity', 'Supply both existing health tokens, or neither; no sign-in is performed.')];
  try {
    const response = await get('/whoami', machine ? { 'x-machine-token': `Bearer ${machine}`, authorization: `Bearer ${operator}` } : undefined);
    const body = await response.json();
    if (machine) {
      if (response.status !== 200 || body.role !== 'operator' || !body.operator_id || !body.upload_device_id) throw new Error();
      out.push(result('OK', 'identity', 'Existing operator and machine tokens were accepted through the proxy and database-backed authentication.'));
    } else {
      if (response.status !== 401 || typeof body.error !== 'string') throw new Error();
      out.push(result('OK', 'api-route', 'API authentication route responds through the proxy.'));
      out.push(result('NOTE', 'database-unproven', 'No existing tokens supplied: database access and grants are NOT proven. Sign in normally, then repeat with the two temporary health tokens.'));
    }
  } catch { out.push(result('FAIL', 'identity', 'Check API startup, proxy routing, database access and existing-token expiry. No response body or credentials were logged.')); }
  return out;
}

async function main() {
  const [command, file] = process.argv.slice(2);
  if (!['preflight', 'health'].includes(command) || !file || process.argv.length !== 4) {
    console.error('Usage: node deploy/centre/check.mjs <preflight|health> <centre.env>');
    process.exitCode = 2; return;
  }
  let env;
  try { env = { ...process.env, ...readEnvironment(await readFile(file, 'utf8')) }; }
  catch { console.error('Cannot read environment file or its format is invalid. No values were printed.'); process.exitCode = 2; return; }
  const findings = command === 'preflight' ? [...configurationChecks(env), ...await localChecks(env)] : await healthChecks(env);
  for (const finding of findings) console.log(`${finding.level} ${finding.check}: ${finding.message}`);
  process.exitCode = findings.some((finding) => finding.level === 'FAIL') ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
