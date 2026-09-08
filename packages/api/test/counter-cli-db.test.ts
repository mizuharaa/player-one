import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential, type ObjectStore } from '../src/index.ts';
import { appDb, closeDb, db, hasDb, liveClaim, truncate, useDatabase } from '../../store/test/db.ts';
import { argsFor, fixture, flags, runCounter } from './counter-cli-helpers.ts';

useDatabase('counter_cli');

// Database-backed acceptance test: written, NOT run in the counter-cli implementation lane.
describe.skipIf(!hasDb())('counter command against the API and Postgres', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('imports a fixture over HTTP and leaves one attached episode and a verified batch', async () => {
    const d = await db();
    const ids = {
      centre: randomUUID(), device: randomUUID(), operator: randomUUID(), collector: randomUUID(),
      deviceType: randomUUID(), egoDevice: randomUUID(), task: randomUUID(), scenario: randomUUID(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status)
      values (${ids.centre}, 'HCM', 'centre', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${ids.device}, ${ids.centre}, 'HCM-01', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${ids.operator}, ${ids.centre}, 'op-1', 'centre_operator', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status)
      values (${ids.collector}, 'c-1', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation)
      values (${ids.deviceType}, 'ego_headset', 'gen1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status)
      values (${ids.egoDevice}, ${ids.deviceType}, 'SYNTH0000001', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
      values (${ids.task}, 'housework', 1200.0000, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level)
      values (${ids.scenario}, 'home', 'low')`);
    await liveClaim(d, ids.task, ids.collector);

    const temp = await mkdtemp(join(tmpdir(), 'po-counter-cli-'));
    const mediaRoot = join(temp, 'media');
    const objects = join(temp, 'objects');
    const metadata = new Map<string, string>();
    const tags = new Map<string, Record<string, string>>();
    const pathOf = (key: string) => join(objects, key.replaceAll('/', '__'));
    const objectStore: ObjectStore = {
      async put(key, localPath, sha256, force = false) {
        const stored = await stat(pathOf(key)).catch(() => null);
        if (!force && metadata.get(key) === sha256 && stored?.size === (await stat(localPath)).size) return 'kept';
        await mkdir(objects, { recursive: true });
        await copyFile(localPath, pathOf(key));
        metadata.set(key, sha256);
        return 'uploaded';
      },
      async read(key, from = 0) {
        return metadata.has(key) ? createReadStream(pathOf(key), { start: from }) : null;
      },
      async tag(key, value) { tags.set(key, value); },
    };
    const app = buildApi({ db: await appDb(), tokenSecret: 'counter-cli-test', mediaRoot, objectStore });
    try {
      const sessionDir = join(mediaRoot, basename(fixture));
      await cp(fixture, sessionDir, { recursive: true });
      const api = await app.listen({ host: '127.0.0.1', port: 0 });
      const result = await runCounter(argsFor({
        ...flags, api, 'session-dir': sessionDir, collector: ids.collector, device: ids.egoDevice,
        task: ids.task, scenario: ids.scenario, 'prepare-time': '2026-08-13T09:08:00.000Z',
      }), { PLAYERONE_MEDIA_ROOT: mediaRoot });
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({ cloud_verified: true, failed_step: null });
      const batches = await d.execute(sql`select batch_status from upload_batches where id = ${output.batch_id}`);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toMatchObject({ batch_status: 'verified' });
      const episodes = await d.execute(sql`select episode_id, collection_session_id, upload_path
        from episodes where upload_batch_id = ${output.batch_id}`);
      expect(episodes).toHaveLength(1);
      expect(episodes[0]).toMatchObject({ episode_id: output.episode_id,
        collection_session_id: output.session_id, upload_path: 'C' });
    } finally {
      await app.close();
      await rm(temp, { recursive: true, force: true });
    }
  });
});
