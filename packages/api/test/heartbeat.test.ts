import { randomUUID } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildApi,
  hashCredential,
  heartbeatSender,
  startHeartbeat,
  type HeartbeatApp,
} from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

useDatabase('heartbeat');

/**
 * PRD §11.3.2 rule 8, client half. `POST /upload-devices/:id/heartbeat` existed
 * from the counter slice and nothing called it, which is why PLT-12's
 * conditions 3 and 4 read `no_signal`. This is the caller: the upload centre's
 * own process, reporting free disk and its queue on an interval.
 *
 * The fake app is the point of most of these. What has to be true is *what the
 * sender sends and how often*, and a real Fastify instance makes that harder to
 * see, not easier — the one thing only a real app can prove (that a machine
 * token alone is now accepted) gets its own test at the bottom.
 */

const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

type Sent = { method: string; url: string; headers?: Record<string, string>; payload?: unknown };

/**
 * An app that records what it was asked to inject and answers whatever the test
 * queued. `token` is the machine token it hands out; `answers` lets one beat be
 * refused so the re-login path is exercised.
 */
function fakeApp(options: { heartbeatStatus?: number[]; signInStatus?: number } = {}) {
  const sent: Sent[] = [];
  const heartbeatStatus = [...(options.heartbeatStatus ?? [])];
  const app: HeartbeatApp = {
    inject: async (o) => {
      sent.push(o);
      if (o.url === '/auth/machine') {
        const status = options.signInStatus ?? 200;
        return {
          statusCode: status,
          json: () => (status === 200 ? { token: `t${sent.length}` } : { error: 'no' }),
        };
      }
      return { statusCode: heartbeatStatus.shift() ?? 200, json: () => ({ ok: true }) };
    },
  };
  const beats = () => sent.filter((s) => s.url.includes('/heartbeat'));
  const signIns = () => sent.filter((s) => s.url === '/auth/machine');
  return { app, sent, beats, signIns };
}

describe.skipIf(!hasDb())('the upload centre heartbeat sender', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  /**
   * Two machines at two centres, and batches on both. The second machine is not
   * decoration: a queue depth that counted every unfinished batch platform-wide
   * would still pass with one machine in the fixture.
   */
  async function seed() {
    const d = await db();
    const ids = {
      centreA: uid(),
      centreB: uid(),
      machineA: uid(),
      machineB: uid(),
      operatorA: uid(),
      collector: uid(),
      deviceType: uid(),
      device: uid(),
      handoverA: uid(),
      handoverB: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values
      (${ids.centreA}, 'HCM', 'A', 'active'), (${ids.centreB}, 'HN', 'B', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values
      (${ids.machineA}, ${ids.centreA}, 'HCM-01', 'active', ${hash}),
      (${ids.machineB}, ${ids.centreB}, 'HN-01', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${ids.operatorA}, ${ids.centreA}, 'op-a', 'centre_operator', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status)
      values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active')`);
    for (const [handover, centre, card] of [
      [ids.handoverA, ids.centreA, 'CARD-1'],
      [ids.handoverB, ids.centreB, 'CARD-2'],
    ] as const) {
      await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
        values (${handover}, ${ids.collector}, ${ids.device}, ${card}, ${centre}, ${ids.operatorA}, ${new Date(T).toISOString()})`);
    }
    const batch = (handover: string, machine: string, status: string) =>
      d.execute(sql`insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status)
        values (${uid()}, ${handover}, ${machine}, ${new Date(T).toISOString()}, ${status})`);
    // Machine A: three waiting on the cloud leg, two already through it.
    await batch(ids.handoverA, ids.machineA, 'importing');
    await batch(ids.handoverA, ids.machineA, 'imported');
    await batch(ids.handoverA, ids.machineA, 'verifying');
    await batch(ids.handoverA, ids.machineA, 'verified');
    await batch(ids.handoverA, ids.machineA, 'closed');
    // Machine B's backlog belongs to machine B.
    await batch(ids.handoverB, ids.machineB, 'importing');
    await batch(ids.handoverB, ids.machineB, 'imported');
    return { d, ids };
  }

  const config = { machineIdentifier: 'HCM-01', secret: 'pw', mediaRoot: tmpdir() };

  it('signs in once, then posts this machine\'s free disk and its own queue depth', async () => {
    const { ids } = await seed();
    const f = fakeApp();
    const beat = heartbeatSender(f.app, await db(), config);

    expect(await beat()).toBe(true);
    expect(f.signIns()).toHaveLength(1);
    expect(f.signIns()[0]!.payload).toEqual({ machine_identifier: 'HCM-01', secret: 'pw' });

    // Posted to the id the machine_identifier resolves to, never to one from
    // configuration: the route refuses a body naming another machine.
    const [first] = f.beats();
    expect(first!.url).toBe(`/upload-devices/${ids.machineA}/heartbeat`);
    expect(first!.headers).toEqual({ 'x-machine-token': 'Bearer t1' });

    const body = first!.payload as { disk_free_bytes: number; queue_depth: number };
    const fs = await statfs(config.mediaRoot);
    expect(body.disk_free_bytes).toBe(fs.bavail * fs.bsize);
    // Three of machine A's five batches are still waiting on the cloud leg, and
    // machine B's two are not machine A's problem.
    expect(body.queue_depth).toBe(3);

    // The token and the resolved id live in the sender's closure: a second beat
    // signs in again only if the first token stopped working.
    expect(await beat()).toBe(true);
    expect(f.signIns()).toHaveLength(1);
    expect(f.beats()).toHaveLength(2);
  });

  it('signs in again when a token is refused, and never throws out of a beat', async () => {
    await seed();
    // The first beat is answered 401 (a restarted API signing with a new
    // secret), the retry after re-login succeeds; the next beat is a 500.
    const f = fakeApp({ heartbeatStatus: [401, 200, 500] });
    const beat = heartbeatSender(f.app, await db(), config);

    expect(await beat()).toBe(true);
    expect(f.signIns()).toHaveLength(2);
    expect(f.beats()).toHaveLength(2);
    expect(f.beats()[1]!.headers).toEqual({ 'x-machine-token': 'Bearer t3' });

    // A refused status POST is a missed beat and nothing more. Throwing here
    // would take down the API process whose health this reports.
    expect(await beat()).toBe(false);
  });

  it('says false rather than throwing when the machine has no row at all', async () => {
    const f = fakeApp();
    const beat = heartbeatSender(f.app, await db(), {
      ...config,
      machineIdentifier: 'NOT-A-MACHINE',
    });
    expect(await beat()).toBe(false);
    // It never got as far as asking for a token.
    expect(f.sent).toHaveLength(0);
  });

  it('beats immediately at boot, then on the interval, and stops when told', async () => {
    await seed();
    const f = fakeApp();
    const stop = startHeartbeat(f.app, await db(), { ...config, intervalMs: 20 });
    try {
      // Immediately, not after the first interval: a machine that waited a
      // minute to say anything would be counted offline for that minute.
      const until = Date.now() + 5000;
      while (f.beats().length < 1 && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
      expect(f.beats().length).toBeGreaterThanOrEqual(1);

      while (f.beats().length < 3 && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
      expect(f.beats().length).toBeGreaterThanOrEqual(3);
    } finally {
      stop();
    }
    const afterStop = f.beats().length;
    await new Promise((r) => setTimeout(r, 100));
    expect(f.beats().length).toBe(afterStop);
  });

  it('is accepted by the real route on a machine token alone', async () => {
    const { d, ids } = await seed();
    const app = buildApi({ db: await appDb(), tokenSecret: 'k' });
    await app.ready();
    try {
      /**
       * The whole point of the guard change. An unattended centre process has
       * no operator signed in — if it needed one, the heartbeat would stop
       * every night when the clerk goes home and condition 3 would fire at
       * every centre until morning.
       */
      const beat = heartbeatSender(app as unknown as HeartbeatApp, d, config);
      expect(await beat()).toBe(true);

      const rows = (await d.execute(
        sql`select upload_device_id, disk_free_bytes, queue_depth from upload_device_status`,
      )) as unknown as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!['upload_device_id']).toBe(ids.machineA);
      expect(Number(rows[0]!['queue_depth'])).toBe(3);
      expect(Number(rows[0]!['disk_free_bytes'])).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
