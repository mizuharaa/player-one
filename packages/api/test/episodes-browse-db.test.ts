import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { storeEpisode } from '@playerone/store';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi } from '../src/index.ts';
import { signToken } from '../src/credentials.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
import { episodeRecord } from './fixtures.ts';

// Database-backed: written for Claude to run; skipped in the database-free proof.
useDatabase('episodes_browse');
const SECRET = 'browse-test';
const T = Date.parse('2026-09-08T00:00:00Z');
const uid = () => randomUUID();

describe.skipIf(!hasDb())('BO-05 centre-scoped episode browsing (database)', () => {
  beforeEach(truncate);
  afterAll(closeDb);
  const apps: ReturnType<typeof buildApi>[] = [];
  afterAll(async () => { await Promise.all(apps.map((app) => app.close())); });

  async function harness() {
    const d = await db();
    const centre = [uid(), uid()] as const;
    const machine = [uid(), uid()] as const;
    const operator = [uid(), uid()] as const;
    const collector = [uid(), uid()] as const;
    const device = [uid(), uid()] as const;
    const task = [uid(), uid()] as const;
    const type = uid();
    const scenario = uid();
    const reviewer = uid();
    await d.execute(sql`insert into device_types (id, code, generation) values (${type}, 'ego', 'g1')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${scenario}, 'home', 'low')`);
    for (const i of [0, 1] as const) {
      await d.execute(sql`insert into upload_centres (id, region, name, status) values (${centre[i]}, 'HCM', ${`centre-${i}`}, 'active')`);
      await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status) values (${machine[i]}, ${centre[i]}, ${`machine-${i}`}, 'active')`);
      await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role) values (${operator[i]}, ${centre[i]}, ${`op-${i}`}, 'centre_operator')`);
      await d.execute(sql`insert into collectors (id, external_ref, status) values (${collector[i]}, ${`collector-${i}`}, 'qualified')`);
      await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${device[i]}, ${type}, ${`EGO-${i}`}, 'active')`);
      await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${task[i]}, ${`task-${i}`}, 1200, 5, 'published')`);
    }
    await d.execute(sql`insert into operators (id, external_ref, role) values (${reviewer}, 'reviewer', 'reviewer')`);
    const app = buildApi({ db: await appDb(), tokenSecret: SECRET });
    apps.push(app);
    const headers = (i: 0 | 1) => ({
      'x-machine-token': `Bearer ${signToken(SECRET, { kind: 'machine', uploadCentreId: centre[i], uploadDeviceId: machine[i] })}`,
      authorization: `Bearer ${signToken(SECRET, { kind: 'operator', uploadCentreId: centre[i], operatorId: operator[i] })}`,
    });
    const get = async (query: Record<string, string> = {}, who = headers(0)) => {
      const res = await app.inject({ method: 'GET', url: `/api/episodes?${new URLSearchParams(query)}`, headers: who });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { episodes: { episode_id: string; task_name: string | null; collector_ref: string | null; device_serial: string | null; resolution_state: string; first_seen_at: string; session_started_at: string }[]; truncated: boolean };
    };
    const batch = async (owner: 0 | 1, atCentre: 0 | 1) => {
      const handover = uid();
      const id = uid();
      await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
        values (${handover}, ${collector[owner]}, ${device[owner]}, ${uid()}, ${centre[atCentre]}, ${operator[atCentre]}, ${new Date(T).toISOString()})`);
      await d.execute(sql`insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status)
        values (${id}, ${handover}, ${machine[atCentre]}, ${new Date(T).toISOString()}, 'imported')`);
      return id;
    };
    const session = async (owner: 0 | 1) => {
      const id = uid();
      await d.execute(sql`insert into collection_sessions (id, task_id, collector_id, scenario_id, others_in_frame, sensitive_info_present, session_origin)
        values (${id}, ${task[owner]}, ${collector[owner]}, ${scenario}, false, false, 'backoffice')`);
      await d.execute(sql`insert into collection_session_devices (collection_session_id, device_id, role) values (${id}, ${device[owner]}, 'headset')`);
      return id;
    };
    const sessions = [await session(0), await session(1)] as const;
    const batches = [await batch(0, 0), await batch(1, 0), await batch(0, 1)] as const;
    let sequence = 0;
    const add = async (b: string | null, s: string | null, at: number) => {
      const stamp = new Date(T - 86400000 + sequence++ * 10000).toISOString().slice(11, 19).replaceAll(':', '');
      const record = episodeRecord({ basename: `ego_EGO-0_20260907_${stamp}` });
      record.source.path = `/private/cards/${record.source.path}`;
      record.streams[0]!.parts[0]!.file = 'private/video/left.mp4';
      await storeEpisode(d, record);
      await d.execute(sql`update episodes set upload_batch_id = ${b}, collection_session_id = ${s},
        resolution_state = ${s === null ? 'quarantined' : 'resolved'}, first_seen_at = ${new Date(at).toISOString()},
        session_started_at = ${`20260907_${stamp}`}
        where episode_id = ${record.episode_id}`);
      return record.episode_id;
    };
    const first = await add(batches[0], sessions[0], T);
    const second = await add(batches[1], sessions[1], T + 1000);
    const unresolved = await add(batches[0], null, T + 2000);
    const otherCentre = await add(batches[2], sessions[0], T + 3000);
    const noBatch = await add(null, sessions[0], T + 4000);
    return { d, app, get, headers, collector, device, task, reviewer, batches, sessions, add, first, second, unresolved, otherCentre, noBatch };
  }

  it('includes only this centre, excludes no-batch episodes, and retains unresolved rows with null labels', async () => {
    const h = await harness();
    const res = await h.get();
    expect(res.episodes.map((r) => r.episode_id)).toEqual([h.unresolved, h.second, h.first]);
    expect(res.episodes[0]).toMatchObject({ task_name: null, collector_ref: null, device_serial: null, resolution_state: 'quarantined' });
    expect((await h.get({}, h.headers(1))).episodes.map((r) => r.episode_id)).toEqual([h.otherCentre]);
    expect(res.truncated).toBe(false);
  });

  it('applies each filter and their intersection, including both time boundaries', async () => {
    const h = await harness();
    const cases: [Record<string, string>, string[]][] = [
      [{ task_id: h.task[0] }, [h.first]], [{ task_id: h.task[1] }, [h.second]],
      [{ collector_id: h.collector[0] }, [h.first]], [{ collector_id: h.collector[1] }, [h.second]],
      [{ device_id: h.device[0] }, [h.first]], [{ device_id: h.device[1] }, [h.second]],
      [{ status: 'resolved' }, [h.second, h.first]], [{ status: 'quarantined' }, [h.unresolved]],
      [{ from: new Date(T + 1000).toISOString() }, [h.unresolved, h.second]],
      [{ to: new Date(T + 1000).toISOString() }, [h.first]],
      [{ task_id: h.task[1], collector_id: h.collector[1], device_id: h.device[1], status: 'resolved', from: new Date(T + 1000).toISOString(), to: new Date(T + 2000).toISOString() }, [h.second]],
      [{ task_id: h.task[0], collector_id: h.collector[1] }, []],
    ];
    for (const [query, ids] of cases) expect((await h.get(query)).episodes.map((r) => r.episode_id), JSON.stringify(query)).toEqual(ids);
  });

  it('uses session attribution after a device is rebound and ignores the observed episode serial', async () => {
    const h = await harness();
    await h.d.execute(sql`update devices set bound_collector_id = ${h.collector[1]}, bound_at = now() where id = ${h.device[0]}`);
    const rows = (await h.get({ device_id: h.device[0] })).episodes;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ episode_id: h.first, collector_ref: 'collector-0', device_serial: 'EGO-0' });
    expect((await h.get({ device_id: h.device[1] })).episodes[0]).toMatchObject({ episode_id: h.second, device_serial: 'EGO-1' });
  });

  it('refuses reviewer and collector tokens with 403', async () => {
    const h = await harness();
    for (const token of [
      signToken(SECRET, { kind: 'reviewer', reviewerId: h.reviewer }),
      signToken(SECRET, { kind: 'collector', collectorId: h.collector[0], epoch: 0 }),
    ]) {
      const res = await h.app.inject({ method: 'GET', url: '/api/episodes', headers: { ...h.headers(0), authorization: `Bearer ${token}` } });
      expect(res.statusCode, res.body).toBe(403);
    }
  });

  it('returns exactly the seven browse fields and no ingest paths or media URLs', async () => {
    const h = await harness();
    const result = await h.get();
    expect(Object.keys(result).sort()).toEqual(['episodes', 'truncated']);
    for (const row of result.episodes) {
      expect(Object.keys(row).sort()).toEqual(['collector_ref', 'device_serial', 'episode_id', 'first_seen_at', 'resolution_state', 'session_started_at', 'task_name']);
      expect(row.first_seen_at).toMatch(/^2026-09-08T.*Z$/);
    }
    expect(JSON.stringify(result)).not.toMatch(/source_basename|record.?json|private|\.mp4|\/media\/|https?:|\\/i);
  });

  it('limits results to 200 newest rows and marks the limit as reached', async () => {
    const h = await harness();
    for (let i = 0; i < 198; i++) await h.add(h.batches[0], h.sessions[0], T + 5000 + i);
    const res = await h.get();
    expect(res.episodes).toHaveLength(200);
    expect(res.truncated).toBe(true);
    expect(res.episodes.some((r) => r.episode_id === h.first)).toBe(false);
  });
});
