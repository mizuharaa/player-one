import Fastify from 'fastify';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEpisodes } from '../src/episodes.ts';
import type { CounterActor } from '../src/actor.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
const FROM = '2026-09-08T00:00:00+07:00';
const TO = '2026-09-09T00:00:00+07:00';
const filters = { task_id: UUID, collector_id: UUID, device_id: UUID, status: 'resolved', from: FROM, to: TO };
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function harness(rows: unknown[] = []) {
  const app = Fastify();
  apps.push(app);
  const execute = vi.fn(async (_query: SQL) => rows);
  registerEpisodes(app, { execute } as unknown as Db, async (req) => {
    req.actor = { operator: { uploadCentreId: UUID } } as CounterActor;
  }, 0);
  const get = (query: string) => app.inject({ method: 'GET', url: `/api/episodes${query ? `?${query}` : ''}` });
  const compiled = () => new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
  return { get, execute, compiled };
}

describe('BO-05 strict query, without a database', () => {
  it.each(Object.entries(filters))('accepts %s alone', async (key, value) => {
    const h = harness();
    const res = await h.get(new URLSearchParams({ [key]: value }).toString());
    expect(res.statusCode, res.body).toBe(200);
    expect(h.compiled().params).toContain(value);
  });

  it.each([
    {}, { status: 'quarantined' },
    { task_id: UUID, collector_id: UUID, device_id: UUID },
    { status: 'resolved', from: FROM, to: TO }, filters,
  ])('accepts combined filters %j', async (query) => {
    const h = harness();
    const res = await h.get(new URLSearchParams(query as Record<string, string>).toString());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ episodes: [], truncated: false });
  });

  const invalid = [
    'unknown=x', 'status=pending', 'status=verified', 'status=RESOLVED',
    ...Object.entries(filters).flatMap(([key, value]) => [
      `${key}=`, new URLSearchParams([[key, value], [key, value]]).toString(),
    ]),
    ...['task_id', 'collector_id', 'device_id'].map((key) => `${key}=not-a-uuid`),
    'from=2026-09-08', 'to=2026-09-08T00:00:00', 'from=2026-02-30T00:00:00Z',
    new URLSearchParams({ from: '2026-09-08T00:00:00+99:00' }).toString(),
    new URLSearchParams({ from: FROM, to: FROM }).toString(),
    new URLSearchParams({ from: TO, to: FROM }).toString(),
    new URLSearchParams({ from: '2026-09-08T00:00:00Z', to: FROM }).toString(),
  ];
  it.each(invalid)('refuses %s with 400 before reading rows', async (query) => {
    const h = harness();
    expect((await h.get(query)).statusCode).toBe(400);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('emits inclusive From and exclusive To predicates at the boundary timestamp', async () => {
    const h = harness();
    await h.get(new URLSearchParams({ from: FROM, to: TO }).toString());
    const { sql, params } = h.compiled();
    expect(sql).toContain('e.first_seen_at >= $2::timestamptz');
    expect(sql).toContain('e.first_seen_at < $3::timestamptz');
    expect(params).toEqual([UUID, FROM, TO]);
    // Evaluate the emitted operators at each boundary, not a separate filter helper.
    const matches = (at: number) => [...sql.matchAll(/e\.first_seen_at (>=|<) \$(\d+)::timestamptz/g)].every((m) => {
      const boundary = Date.parse(String(params[Number(m[2]) - 1]));
      return m[1] === '>=' ? at >= boundary : at < boundary;
    });
    expect(matches(Date.parse(FROM) - 1)).toBe(false);
    expect(matches(Date.parse(FROM))).toBe(true);
    expect(matches(Date.parse(TO) - 1)).toBe(true);
    expect(matches(Date.parse(TO))).toBe(false);
  });

  it('selects only browse fields with centre and session joins, newest first', async () => {
    const h = harness();
    await h.get(new URLSearchParams(filters).toString());
    const { sql } = h.compiled();
    expect(sql).toContain('where h.upload_centre_id = $1');
    for (const join of ['join upload_batches b on b.id = e.upload_batch_id', 'join handovers h on h.id = b.handover_id',
      'left join collection_sessions s on s.id = e.collection_session_id', 'left join tasks t on t.id = s.task_id',
      'left join collectors c on c.id = s.collector_id', 'left join collection_session_devices sd on sd.collection_session_id = s.id',
      'left join devices d on d.id = sd.device_id']) expect(sql).toContain(join);
    for (const field of ['s.task_id', 's.collector_id', 'sd.device_id', 'e.resolution_state']) expect(sql).toContain(`and ${field} =`);
    expect(sql).toContain('order by e.first_seen_at desc, e.episode_id asc');
    expect(sql).toContain('limit 200');
    expect(sql).not.toMatch(/bound_collector_id|source_basename|record_json|media|select\s+\*/);
  });

  it.each([0, 199, 200])('returns the exact response keys and truncation for %i rows', async (n) => {
    const row = { episode_id: UUID, task_name: null, collector_ref: null, device_serial: null,
      resolution_state: 'quarantined', first_seen_at: new Date(FROM), session_started_at: '20260907_120000' };
    const h = harness(Array.from({ length: n }, () => ({ ...row, source_basename: 'secret', record_json: { source: { path: '/private' } } })));
    const res = await h.get('');
    expect(res.json()).toEqual({ episodes: Array.from({ length: n }, () => ({ ...row, first_seen_at: row.first_seen_at.toISOString() })), truncated: n === 200 });
  });
});
