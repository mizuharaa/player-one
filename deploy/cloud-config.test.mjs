import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuration, dotenv } from './cloud/configure.mjs';

const inputs = ['--domain', 'console.example.vn', '--acme-email', 'ops@example.vn',
  '--local-db', '--storage-endpoint', 'https://s3.example.vn', '--storage-bucket', 'demo',
  '--storage-key', 'key', '--storage-secret', "literal$secret'with\\slash", '--quota-bytes', '1000000'];
test('configuration makes a demo database and independent random credentials', () => {
  const a = configuration(inputs), b = configuration(inputs);
  assert.equal(new URL(a.DATABASE_URL).username, 'playerone_app');
  assert.equal(new URL(a.OWNER_DATABASE_URL).pathname, '/po_demo_cloud');
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
  assert.throws(() => configuration(inputs.map(x => x === '1000000' ? '1.5' : x)));
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
