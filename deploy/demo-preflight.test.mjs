import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupCheck, certificateCheck, databaseChecks, databaseName, hoursBetween,
  isDemoDatabase, newestDump,
} from './demo-preflight.mjs';

test('only a demo database name is accepted', () => {
  assert.equal(databaseName('postgres://u:p@h:5433/po_demo_readiness'), 'po_demo_readiness');
  assert.equal(databaseName('postgres://h/'), null);
  assert.equal(databaseName('not a url'), null);
  assert.equal(databaseName('mysql://h/po_demo_x'), null);
  for (const name of ['po_demo_readiness', 'playerone_demo', 'po_demo']) {
    assert.ok(isDemoDatabase(name), name);
  }
  for (const name of ['playerone', 'po_e2e', 'demo_po', null]) {
    assert.ok(!isDemoDatabase(name), String(name));
  }
});

test('a non-demo database is refused without a connection being attempted', async () => {
  // The host does not exist: if this ever tried to connect it would not return
  // one immediate FAIL.
  const out = await databaseChecks({ DATABASE_URL: 'postgres://u:p@203.0.113.1:5432/playerone' });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'FAIL');
  assert.equal(out[0].check, 'demo-database');
  assert.match(out[0].message, /No query was run/);
});

test('the newest dump wins, and only dumps count', () => {
  const entries = [
    { name: 'notes.txt', mtime: new Date('2026-09-14T10:00:00Z') },
    { name: 'demo-1.dump', mtime: new Date('2026-09-12T10:00:00Z') },
    { name: 'demo-2.sql.gz', mtime: new Date('2026-09-13T10:00:00Z') },
  ];
  assert.equal(newestDump(entries).name, 'demo-2.sql.gz');
  assert.equal(newestDump([{ name: 'readme.md', mtime: new Date() }]), null);
  assert.equal(hoursBetween(new Date('2026-09-14T00:00:00Z'), new Date('2026-09-15T01:30:00Z')), 25);
});

test('a dump older than a day fails, a fresh one passes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'playerone-preflight-'));
  const dump = join(dir, 'po_demo_readiness.dump');
  await writeFile(dump, 'not really a dump');
  const now = new Date();
  const old = new Date(now.getTime() - 30 * 3_600_000);
  await utimes(dump, old, old);
  const stale = await backupCheck({ PLAYERONE_BACKUP_DIR: dir }, { now });
  assert.equal(stale[0].level, 'FAIL');
  assert.match(stale[0].message, /30 hours old/);

  const fresh = new Date(now.getTime() - 3_600_000);
  await utimes(dump, fresh, fresh);
  const good = await backupCheck({ PLAYERONE_BACKUP_DIR: dir }, { now });
  assert.equal(good[0].level, 'PASS');
  assert.match(good[0].message, /1 hour\(s\) old/);

  const none = await backupCheck({}, { now });
  assert.equal(none[0].level, 'FAIL');
});

test('a plain-HTTP origin has no certificate to check, and says so', async () => {
  const out = await certificateCheck({ PLAYERONE_PUBLIC_URL: 'http://192.168.1.50' });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'PASS');
  assert.match(out[0].message, /centre-PC LAN variant only/);
});
