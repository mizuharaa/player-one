import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuration, dotenv } from './cloud/configure.mjs';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const inputs = ['--domain', 'console.example.vn', '--acme-email', 'ops@example.vn',
  '--local-db', '--storage-endpoint', 'https://s3.example.vn', '--storage-bucket', 'demo',
  '--storage-key', 'key', '--storage-secret', "literal$secret'with\\slash", '--quota-bytes', '2000000000'];
test('configuration makes a demo database and independent random credentials', () => {
  const a = configuration(inputs), b = configuration(inputs);
  assert.equal(new URL(a.DATABASE_URL).username, 'playerone_app');
  assert.equal(new URL(a.OWNER_DATABASE_URL).pathname, '/po_demo_cloud');
  assert.equal(new URL(a.DATABASE_URL).searchParams.get('sslmode'), 'disable');
  assert.equal(a.PLAYERONE_PUBLIC_URL, 'https://console.example.vn');
  for (const name of ['PLAYERONE_TOKEN_SECRET', 'PLAYERONE_MACHINE_SECRET', 'PLAYERONE_APP_PASSWORD', 'POSTGRES_PASSWORD']) {
    assert.match(a[name], /^[a-f0-9]{64}$/);
    assert.notEqual(a[name], b[name]);
  }
  assert.equal(a.PLAYERONE_MACHINE_SECRET, a.PLAYERONE_DEMO_MACHINE_SECRET);
  assert.equal(a.PLAYERONE_OPERATOR_SECRET, a.PLAYERONE_DEMO_ADMIN_SECRET);
  assert.match(dotenv(a), /STORAGE_SECRET='literal\$secret\\'with\\slash'/);
});
test('configuration refuses ambiguous database mode, unsafe name, origin and quota', () => {
  assert.throws(() => configuration([...inputs, '--database-url', 'postgres://owner:p@db/po_demo_x']));
  assert.throws(() => configuration(inputs.map(x => x === '2000000000' ? '1.5' : x)));
  assert.throws(() => configuration(inputs.map(x => x === '2000000000' ? '1000000000' : x)));
  assert.throws(() => configuration(inputs.map(x => x === 'console.example.vn' ? 'https://example.vn/path' : x)));
  assert.throws(() => configuration(inputs.map(x => x === 'key' ? 'key\ninjected=yes' : x)));
  const managed = inputs.filter(x => x !== '--local-db');
  assert.throws(() => configuration([...managed, '--database-url', 'postgres://owner:p@db/production']));
  const env = configuration([...managed, '--database-url', 'postgres://owner:encoded%24@db/po_demo_x?sslmode=require']);
  assert.equal(new URL(env.DATABASE_URL).search, '?sslmode=require');
  assert.equal(new URL(env.OWNER_DATABASE_URL).username, 'owner');
});
test('plain HTTP requires explicit local proof mode', () => {
  assert.throws(() => configuration([...inputs, '--http-local']));
  const env = configuration([...inputs.map(x => x === 'console.example.vn' ? 'localhost' : x), '--http-local']);
  assert.equal(env.PLAYERONE_PUBLIC_URL, 'http://localhost');
  assert.equal(env.PLAYERONE_SECURE_COOKIES, '0');
});
test('the sign-in channel and the Zalo app are optional, validated, and empty by default', () => {
  // Omitted, they are empty, which is what keeps today's behaviour the default.
  const plain = configuration(inputs);
  assert.equal(plain.PLAYERONE_SIGN_IN_CHANNEL, '');
  assert.equal(plain.PLAYERONE_ZALO_APP_ID, '');
  assert.equal(plain.PLAYERONE_ZALO_APP_SECRET, '');

  const env = configuration([...inputs, '--sign-in-channel', 'sms',
    '--zalo-app-id', '3849367142822243338', '--zalo-app-secret', 'abc123']);
  assert.equal(env.PLAYERONE_SIGN_IN_CHANNEL, 'sms');
  assert.equal(env.PLAYERONE_ZALO_APP_ID, '3849367142822243338');
  // The redirect URI is derived from the public URL, so there is nothing else
  // to pass — and the callback URL registered at developers.zalo.me has to be
  // exactly this string.
  assert.equal(env.PLAYERONE_PUBLIC_URL + '/auth/collector/zalo/callback',
    'https://console.example.vn/auth/collector/zalo/callback');

  // A channel the API does not accept, half a Zalo app, and an injected line.
  assert.throws(() => configuration([...inputs, '--sign-in-channel', 'zalo']));
  assert.throws(() => configuration([...inputs, '--zalo-app-id', '123']));
  assert.throws(() => configuration([...inputs, '--zalo-app-secret', 'abc']));
  assert.throws(() => configuration([...inputs, '--sign-in-channel', 'sms\nSTORAGE_KEY=stolen']));
});
/**
 * Whose one-time code this deployment may write into its own log.
 *
 * The log sender is what a sandbox with no ZNS credentials falls back to, which
 * is this kit's own default, and before the allowlist it printed EVERY number's
 * code — so a public demo put real collectors' codes where anyone with log
 * access could read them. Both audits of `4a32929` found it.
 */
test('the demo phone is empty by default, validated, and never turns on the response echo', () => {
  const plain = configuration(inputs);
  assert.equal(plain.PLAYERONE_DEMO_PHONES, '');

  const env = configuration([...inputs, '--demo-phone', '0900000001']);
  assert.equal(env.PLAYERONE_DEMO_PHONES, '0900000001');
  /**
   * And it does NOT set `PLAYERONE_DEMO_PHONE`, which makes the API echo the
   * code in the HTTP response. `check.test.ts` bans that from the cloud
   * template because it is an enrolment oracle on a public hostname; a log an
   * operator reads on the VM is a different disclosure from a response the
   * internet can ask for, and one flag setting both would undo that ban.
   */
  assert.equal(env.PLAYERONE_DEMO_PHONE, undefined);
  for (const spelling of ['+84900000001', '84900000001']) {
    assert.equal(configuration([...inputs, '--demo-phone', spelling]).PLAYERONE_DEMO_PHONES, spelling);
  }

  // Not a list, not a foreign number, not a typo: a wrong value here is a
  // deployment that logs nobody's code and looks like it logs one.
  for (const bad of ['0900000001,0900000002', '+8613800138000', '090000000', 'demo', '0100000001']) {
    assert.throws(() => configuration([...inputs, '--demo-phone', bad]), undefined, bad);
  }
});

test('the demo bypass key is optional, floored at 32 characters, and empty by default', () => {
  // Omitted, POST /auth/collector/demo answers 404 and the deployment has no
  // bypass. Owner's request 2026-09-16, for debugging and the demonstration.
  assert.equal(configuration(inputs).PLAYERONE_DEMO_BYPASS_KEY, '');

  // What `openssl rand -base64 48` actually produces: 64 characters including
  // `+`, `/` and `=`, none of which the Zalo character rule allows.
  const key = 'aB3+/cD4=' + 'x'.repeat(55);
  assert.equal(configuration([...inputs, '--demo-bypass-key', key]).PLAYERONE_DEMO_BYPASS_KEY, key);

  // The same floor the API enforces at boot, caught before the VM is touched.
  assert.throws(() => configuration([...inputs, '--demo-bypass-key', 'x'.repeat(31)]));
  // A space, a newline that would inject a second variable, and a shell quote.
  assert.throws(() => configuration([...inputs, '--demo-bypass-key', 'x'.repeat(40) + ' y']));
  assert.throws(() => configuration([...inputs, '--demo-bypass-key', 'x'.repeat(40) + '\nSTORAGE_KEY=stolen']));
  assert.throws(() => configuration([...inputs, '--demo-bypass-key', 'x'.repeat(40) + "'"]));
});
/**
 * A re-provision keeps the credentials a deployment runs on. Before this test
 * it also kept the ABSENCE of every variable added since that file was
 * written: on 2026-09-16 a redeploy of the right revision left
 * PLAYERONE_DEMO_BYPASS_KEY out entirely and the route answered 404 as though
 * the feature had never shipped.
 */
test('a re-provision adds the variables a release added and touches nothing it already holds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'playerone-cloud-merge-'));
  const output = join(directory, 'cloud.env');
  const key = 'k'.repeat(40);
  try {
    // A cloud.env from an older release: these two variables, and nothing else.
    writeFileSync(output, `PLAYERONE_TOKEN_SECRET='kept-secret'
PLAYERONE_DEMO_BYPASS_KEY=''
`);
    const args = ['deploy/cloud/configure.mjs', ...inputs, '--output', output, '--merge'];
    const first = spawnSync(process.execPath, [...args, '--demo-bypass-key', key], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const merged = readFileSync(output, 'utf8');

    // What it already held is byte-identical, the credential included.
    assert.match(merged, /^PLAYERONE_TOKEN_SECRET='kept-secret'$/m);
    // Held variables are left alone even when a flag would have set one.
    assert.match(merged, /^PLAYERONE_DEMO_BYPASS_KEY=''$/m);
    assert.doesNotMatch(merged, new RegExp(key));
    // And what the release has since added is now there.
    assert.match(merged, /^POSTGRES_PASSWORD=/m);
    assert.match(merged, /^PLAYERONE_DEMO_PHONES=/m);
    assert.match(first.stdout, /cloud\.env gained \d+ variable/);
    // Names, never values: this runs on every redeploy.
    assert.doesNotMatch(first.stdout, /kept-secret/);

    // Run it again and there is nothing left to add.
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already carries every variable/);
    assert.equal(readFileSync(output, 'utf8'), merged);
  } finally { rmSync(output, { force: true }); rmdirSync(directory); }
});

test('CLI refuses a second write and prints secrets only on the first creation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'playerone-cloud-config-'));
  const output = join(directory, 'cloud.env');
  try {
    const args = ['deploy/cloud/configure.mjs', ...inputs, '--output', output];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const original = readFileSync(output, 'utf8');
    assert.match(first.stdout, /PLAYERONE_TOKEN_SECRET=[a-f0-9]{64}/);
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 1);
    assert.equal(second.stdout, '');
    assert.equal(readFileSync(output, 'utf8'), original);
  } finally { rmSync(output, { force: true }); rmdirSync(directory); }
});
