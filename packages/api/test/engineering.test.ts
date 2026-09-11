import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, signToken } from '../src/index.ts';
import { engineeringRecord } from '../src/engineering.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
useDatabase('api_engineering_' + randomUUID().replaceAll('-', '').slice(0, 10));
const secret = 'isolated-engineering-secret';
describe('engineering projection', () => {
  it('keeps useful valid timing but omits paths, hosts and executable free text', () => {
    const projected = engineeringRecord({
      schema_version: '1.1.0',
      episode_id: randomUUID(),
      content_fingerprint: '0'.repeat(64),
      state: 'ok',
      source: {
        path: '/private/token',
        ingest_tool_version: 'test',
        ingested_at: '2026-09-10',
        ingest_host: 'private-host',
      },
      device: { serial: 'private-device', firmware_declared: null, calibration_serial: null },
      declared: null,
      streams: [],
      timing: {
        method: 'container',
        confidence: 'exact',
        usable_start_us: null,
        usable_end_us: null,
        raw_duration_s: 12,
        max_stream_skew_ms: 0,
      },
      calibration: { present: false, files: [] },
      source_files: [],
      discrepancies: [],
      unclassified_files: ['<script>alert(1)</script>'],
    });
    expect(projected).toMatchObject({
      schema_valid: true,
      timing: { raw_duration_s: 12 },
      stream_count: 0,
    });
    expect(JSON.stringify(projected)).not.toContain('private');
    expect(JSON.stringify(projected)).not.toContain('<script>');
  });
  it('withholds malformed arbitrary JSON rather than returning secrets', () => {
    expect(engineeringRecord({ password: 'hidden', source: { path: '/private' } })).toEqual({
      schema_valid: false,
      details: 'Stored record did not match current schema; raw payload withheld.',
    });
  });
});
describe.skipIf(!hasDb())('engineering read-only authorization and probes', () => {
  let app: ReturnType<typeof buildApi>;
  let admin: string;
  let centre: string;
  let machine: string;
  let ordinary: string;
  const headers = (id: string) => ({
    authorization:
      'Bearer ' + signToken(secret, { kind: 'operator', operatorId: id, uploadCentreId: centre }),
    'x-machine-token':
      'Bearer ' +
      signToken(secret, { kind: 'machine', uploadDeviceId: machine, uploadCentreId: centre }),
  });
  beforeEach(async () => {
    await truncate();
    admin = randomUUID();
    ordinary = randomUUID();
    centre = randomUUID();
    machine = randomUUID();
    const d = await db();
    await d.execute(
      sql`insert into upload_centres(id,region,name,status) values(${centre},'HCM','Engineering fixture','active')`,
    );
    await d.execute(
      sql`insert into upload_devices(id,upload_centre_id,machine_identifier,status) values(${machine},${centre},'ENGINEERING','active')`,
    );
    await d.execute(
      sql`insert into operators(id,upload_centre_id,external_ref,role) values(${admin},${centre},'engineering-admin','administrator'),(${ordinary},${centre},'engineering-operator','centre_operator')`,
    );
    app = buildApi({ db: await appDb(), tokenSecret: secret });
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(closeDb);
  it('refuses anonymous and nonadministrator reads; configured is not healthy', async () => {
    for (const path of ['/status', '/episodes', '/audit', '/probes/sample-contract']) {
      expect((await app.inject({ url: '/api/engineering' + path })).statusCode).toBe(401);
      expect(
        (await app.inject({ url: '/api/engineering' + path, headers: headers(ordinary) }))
          .statusCode,
      ).toBe(403);
    }
    const response = await app.inject({ url: '/api/engineering/status', headers: headers(admin) });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const result = response.json();
    expect(result.security).toEqual({ showcase_rls: true, runtime_bypass_rls: false });
    expect(result.services.find((s: any) => s.id === 'object_verification').state).toBe(
      'unconfigured',
    );
    expect(result.services.find((s: any) => s.id === 'payment_delivery').state).toBe('manual');
    expect(result.services.find((s: any) => s.id === 'jobs').state).toBe('unknown');
    await (await db()).execute(sql`update operators set status='retired' where id=${admin}`);
    expect(
      (await app.inject({ url: '/api/engineering/status', headers: headers(admin) })).statusCode,
    ).not.toBe(200);
  });
  it('bounds list inputs and refuses SQL/URL/unknown probe inputs', async () => {
    for (const path of [
      '/episodes?limit=999999',
      '/episodes?before=%27%3Bdrop%20table%20episodes',
      '/audit?before=1%20OR%201=1',
      '/audit?url=https://example.com',
      '/probes/https%3A%2F%2Fexample.com',
    ])
      expect(
        (await app.inject({ url: '/api/engineering' + path, headers: headers(admin) })).statusCode,
      ).toBe(400);
    const result = await app.inject({
      url: '/api/engineering/probes/sample-contract',
      headers: headers(admin),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().checks.every((c: any) => c.passed)).toBe(true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/engineering/probes/sample-contract',
          headers: headers(admin),
          payload: { sql: 'delete from episodes' },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('returns allowlisted episode JSON and audit without payloads or money', async () => {
    const id = randomUUID();
    const d = await db();
    await d.execute(
      sql`insert into episodes(episode_id,device_serial,session_started_at,first_seen_at,last_seen_at) values(${id},'PRIVATE-SERIAL','20260910_120000',now(),now())`,
    );
    await d.execute(
      sql`insert into audit_events(action,target_table,target_id,operator_id,upload_device_id,upload_centre_id,before,after) values('episode.test','episodes',${id},${admin},${machine},${centre},${JSON.stringify({ secret: 'do-not-expose' })}::jsonb,${JSON.stringify({ phone: 'private', html: '<script>alert(1)</script>' })}::jsonb)`,
    );
    const detail = await app.inject({
      url: '/api/engineering/episodes/' + id,
      headers: headers(admin),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain('PRIVATE-SERIAL');
    expect(detail.json().record_redacted).toBe(true);
    const audit = await app.inject({
      url: '/api/engineering/audit?episode_id=' + id,
      headers: headers(admin),
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().events).toHaveLength(1);
    expect(audit.body).not.toContain('do-not-expose');
    expect(audit.body).not.toContain('<script>');
    expect(audit.body).not.toContain('private');
    const [counts] = await d.execute(
      sql`select (select count(*) from episode_reviews)::int as reviews,(select count(*) from settlements)::int as settlements,(select count(*) from bills)::int as bills`,
    );
    expect(counts).toEqual({ reviews: 0, settlements: 0, bills: 0 });
  });
});
