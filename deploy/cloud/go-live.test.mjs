import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// go-live.sh reads real GreenNode credentials from one of two fixed paths and
// must never print them. The first is this laptop's absolute path, which is
// outside this repo and outside our control; the second is HOME-relative, so
// off that laptop (CI) we can point HOME at a throwaway fixture instead.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const laptopEnvFile = 'C:/Users/Khang/OneDrive/Documents/player-one/.env.local';

let env = process.env, storageKey, storageSecret;
if (existsSync(laptopEnvFile)) {
  const text = readFileSync(laptopEnvFile, 'utf8');
  storageKey = /^STORAGE_KEY=(.*)$/m.exec(text)?.[1];
  storageSecret = /^STORAGE_SECRET=(.*)$/m.exec(text)?.[1];
} else {
  const home = mkdtempSync(join(tmpdir(), 'playerone-go-live-home-'));
  mkdirSync(join(home, '.playerone'));
  storageKey = 'fixture-key-0123456789';
  storageSecret = 'fixture-secret-abcdefghij';
  writeFileSync(join(home, '.playerone', 'greennode.env'),
    `STORAGE_ENDPOINT=https://s3.example.test\nSTORAGE_KEY=${storageKey}\nSTORAGE_SECRET=${storageSecret}\n`);
  env = { ...process.env, HOME: home };
}

function dryRun(args) {
  const result = spawnSync('bash', [join(repoRoot, 'deploy/cloud/go-live.sh'), ...args, '--dry-run'],
    { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('derives the sslip.io domain from the IP', () => {
  const out = dryRun(['203.0.113.7']);
  assert.match(out, /Domain: api\.203-0-113-7\.sslip\.io/);
});

test('--domain overrides the derived one', () => {
  const out = dryRun(['203.0.113.7', '--domain', 'console.example.vn']);
  assert.match(out, /Domain: console\.example\.vn/);
  assert.doesNotMatch(out, /203-0-113-7/);
});

test('uses GreenNode\'s SSH port 234 by default, and --ssh-port to override', () => {
  assert.match(dryRun(['203.0.113.7']), /ssh -p 234 /);
  assert.match(dryRun(['203.0.113.7', '--ssh-port', '2222']), /ssh -p 2222 /);
});

test('never prints the storage key or secret, and masks them with ***', () => {
  const out = dryRun(['203.0.113.7']);
  if (storageKey && storageKey.length > 6) assert.doesNotMatch(out, new RegExp(storageKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  if (storageSecret && storageSecret.length > 6) assert.doesNotMatch(out, new RegExp(storageSecret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(out, /STORAGE_KEY=\*\*\*/);
  assert.match(out, /--storage-secret \*\*\*/);
});

test('passes the Zalo app through to provision.sh, and masks its secret like the others', () => {
  // Absent, nothing is added — the whole point of the default being today's
  // behaviour. An empty argument here would reach configure.mjs as a flag with
  // no value and refuse the provisioning run.
  const plain = dryRun(['203.0.113.7']);
  assert.doesNotMatch(plain, /--zalo-app-id|--sign-in-channel/);

  const out = dryRun(['203.0.113.7',
    '--zalo-app-id', '3849367142822243338',
    '--zalo-app-secret', 'zalo-secret-never-printed',
    '--sign-in-channel', 'sms']);
  assert.match(out, /--zalo-app-id 3849367142822243338/);
  assert.match(out, /--sign-in-channel sms/);
  // The app id is not a credential and stays readable; the secret is one and is
  // masked wherever the dry run would otherwise show it. It also never reaches
  // a command line — it is inside the stdin script, like the storage secret.
  assert.doesNotMatch(out, /zalo-secret-never-printed/);
  assert.match(out, /--zalo-app-secret \*\*\*/);
});

test('passes the demo bypass key through to provision.sh, and masks it', () => {
  // Absent, nothing is added: the demonstration door does not exist on a
  // deployment nobody asked for it on.
  assert.doesNotMatch(dryRun(['203.0.113.7']), /--demo-bypass-key/);

  const key = 'bypass-key-never-printed-and-long-enough-xxxxxxxx';
  const out = dryRun(['203.0.113.7', '--demo-bypass-key', key]);
  // It is a credential — one string trades for a collector session — so it
  // reaches the VM inside the stdin script and is masked wherever the dry run
  // would otherwise show it, exactly like the storage and Zalo secrets.
  assert.doesNotMatch(out, new RegExp(key));
  assert.match(out, /--demo-bypass-key \*\*\*/);
});

test('forwards the eSMS credentials and masks the two that are secrets', () => {
  // Absent, nothing is added: the SMS channel is opt-in and the default
  // deployment must carry no eSMS configuration at all.
  assert.doesNotMatch(dryRun(['203.0.113.7']), /--sms-/);

  const out = dryRun(['203.0.113.7', '--sign-in-channel', 'sms',
    '--sms-api-key', 'esms-key-never-printed',
    '--sms-secret-key', 'esms-secret-never-printed',
    '--sms-brandname', 'PLAYERONE', '--sms-sandbox']);
  assert.match(out, /--sign-in-channel sms/);
  assert.match(out, /--sms-brandname PLAYERONE/);
  assert.match(out, /--sms-sandbox/);
  /**
   * The key and the secret are credentials and are masked wherever a dry run
   * would print them; they also never reach a command line, travelling inside
   * the stdin script like the storage secret. The brandname is a public sender
   * name and stays readable, so an operator can check the plan.
   */
  assert.ok(!out.includes('esms-key-never-printed'), 'the eSMS key was printed');
  assert.ok(!out.includes('esms-secret-never-printed'), 'the eSMS secret was printed');
  assert.match(out, /--sms-api-key \*\*\*/);
  assert.match(out, /--sms-secret-key \*\*\*/);
});

test('the bundle it ships clones into a checkout provision.sh can run from', () => {
  // The only step that runs for real here: everything after it needs the VM.
  const scratch = mkdtempSync(join(tmpdir(), 'playerone-go-live-bundle-'));
  const bundle = join(scratch, 'ship.bundle');
  const made = spawnSync('bash', [join(repoRoot, 'deploy/cloud/go-live.sh'), '203.0.113.7'],
    { cwd: repoRoot, env: { ...env, GO_LIVE_BUNDLE_ONLY: bundle }, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const clone = join(scratch, 'src');
  const cloned = spawnSync('git', ['clone', '-q', bundle, clone], { encoding: 'utf8' });
  assert.equal(cloned.status, 0, cloned.stderr);
  assert.ok(existsSync(join(clone, 'deploy/cloud/provision.sh')), 'provision.sh is in the clone');
  assert.ok(!existsSync(join(clone, '.env.local')), 'secrets do not travel in the bundle');
  rmSync(scratch, { recursive: true, force: true });   // the clone is the whole repo, ~140 MB
});

test('--force reaches provision.sh and --ssh-user changes the login', () => {
  const out = dryRun(['203.0.113.7', '--force', '--ssh-user', 'root']);
  assert.match(out, /--quota-bytes 1250000000 --force/);
  assert.match(out, /root@203\.0\.113\.7/);
});

test('runs the steps in order: bucket, bundle, copy, provision, up, verify', () => {
  const out = dryRun(['203.0.113.7']);
  const at = (label) => out.indexOf(`DRY-RUN ${label}:`);
  const order = ['bucket', 'bundle', 'copy-bundle', 'provision', 'up', 'verify'].map(at);
  for (const index of order) assert.ok(index > -1, 'every step is printed');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'steps print in the order go-live runs them');
});
