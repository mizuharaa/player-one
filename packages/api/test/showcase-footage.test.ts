import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { open } from '@playerone/store';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, signToken } from '../src/index.ts';
import { SHOWCASE_MAX_BYTES, showcaseRange, showcaseVideoType } from '../src/showcase-footage.ts';
import { appDb, closeDb, db, dbUrl, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
useDatabase(`api_showcase_${randomUUID().replaceAll('-', '').slice(0, 10)}`);
const SECRET = 'isolated-showcase-test-signing-secret';
const PATH = '/api/showcase/footage';
const VIDEO = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432', 'hex');
describe('showcase transport boundaries', () => {
  it('checks actual signatures, not the supplied MIME alone', () => {
    expect(showcaseVideoType(VIDEO, 'video/mp4')).toBe(true);
    expect(showcaseVideoType(Buffer.from('<html>evil</html>'), 'video/mp4')).toBe(false);
    expect(showcaseVideoType(Buffer.from('1a45dfa3', 'hex'), 'video/webm')).toBe(true);
    expect(showcaseVideoType(VIDEO, 'text/html')).toBe(false);
  });
  it('supports browser prefix/open/suffix ranges and refuses invalid bounds', () => {
    expect(showcaseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(showcaseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(showcaseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    for (const range of ['bytes=10-', 'bytes=-0', 'bytes=5-2', 'bytes=0-1,4-5', 'bytes=NaN-'])
      expect(showcaseRange(range, 10)).toBeNull();
  });
});
describe.skipIf(!hasDb())('private nonpayable showcase workflow', () => {
  let app: Awaited<ReturnType<typeof buildApi>>;
  let ids: {
    centre: string;
    machine: string;
    owner: string;
    peer: string;
    third: string;
  };
  let headers: Record<string, string>;
  const operatorHeader = (id: string) =>
    `Bearer ${signToken(SECRET, { kind: 'operator', operatorId: id, uploadCentreId: ids.centre })}`;
  beforeEach(async () => {
    await truncate();
    ids = {
      centre: randomUUID(),
      machine: randomUUID(),
      owner: randomUUID(),
      peer: randomUUID(),
      third: randomUUID(),
    };
    const d = await db();
    await d.execute(
      sql`insert into upload_centres (id,region,name,status) values (${ids.centre},'HCM','Demo test','active')`,
    );
    await d.execute(sql`insert into upload_devices (id,upload_centre_id,machine_identifier,status)
   values (${ids.machine},${ids.centre},'DEMO-TEST','active')`);
    await d.execute(sql`insert into operators (id,upload_centre_id,external_ref,role) values
   (${ids.owner},${ids.centre},'demo-own','admin'),(${ids.peer},${ids.centre},'demo-peer','centre_operator'),
   (${ids.third},${ids.centre},'demo-third','finance')`);
    headers = {
      authorization: operatorHeader(ids.owner),
      'x-machine-token': `Bearer ${signToken(SECRET, { kind: 'machine', uploadDeviceId: ids.machine, uploadCentreId: ids.centre })}`,
      'x-showcase-request': '1',
    };
    app = await buildApi({ db: await appDb(), tokenSecret: SECRET });
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(closeDb);
  const upload = (extra: Record<string, string> = {}, body = VIDEO) =>
    app.inject({
      method: 'POST',
      url: `${PATH}?filename=demo.mp4`,
      headers: { ...headers, 'content-type': 'video/mp4', ...extra },
      payload: body,
    });
  it('uploads, reads exact bytes/ranges, self-reviews and deletes without production records', async () => {
    const uploaded = await upload();
    expect(uploaded.statusCode).toBe(201);
    const clip = uploaded.json().clip;
    expect(uploaded.json().demo_only).toBe(true);
    const full = await app.inject({ url: `${PATH}/${clip.id}/media`, headers });
    expect(full.rawPayload).toEqual(VIDEO);
    expect(full.headers['cache-control']).toBe('private, no-store');
    const range = await app.inject({
      url: `${PATH}/${clip.id}/media`,
      headers: { ...headers, range: 'bytes=4-7' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toEqual(VIDEO.subarray(4, 8));
    expect(range.headers['content-range']).toBe(`bytes 4-7/${VIDEO.length}`);
    expect(
      (
        await app.inject({
          url: `${PATH}/${clip.id}/media`,
          headers: { ...headers, range: 'bytes=999-' },
        })
      ).statusCode,
    ).toBe(416);
    const reviewed = await app.inject({
      method: 'POST',
      url: `${PATH}/${clip.id}/review`,
      headers,
      payload: { verdict: 'partial', note: 'Demo framing could improve.' },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().clip.verdict).toBe('partial');
    const listed = await app.inject({ url: PATH, headers });
    expect(listed.json().clips[0].reviewed_at).not.toBeNull();
    expect(listed.body).not.toContain('content":');
    const [counts] = await (
      await db()
    ).execute(sql`select (select count(*) from episodes)::int as episodes,
   (select count(*) from episode_reviews)::int as reviews, (select count(*) from settlements)::int as settlements`);
    expect(counts).toMatchObject({ episodes: 0, reviews: 0, settlements: 0 });
    expect(
      (await app.inject({ method: 'DELETE', url: `${PATH}/${clip.id}`, headers })).statusCode,
    ).toBe(204);
    expect((await app.inject({ url: `${PATH}/${clip.id}/media`, headers })).statusCode).toBe(404);
    const events = await (
      await db()
    ).execute(
      sql`select action from audit_events where target_table='showcase_footage' order by occurred_at`,
    );
    expect(events.map((row) => row.action)).toEqual([
      'showcase.upload',
      'showcase.review',
      'showcase.delete',
    ]);
  });
  it('isolates owners including a peer in the same centre', async () => {
    const id = (await upload()).json().clip.id;
    const peer = { ...headers, authorization: operatorHeader(ids.peer) };
    expect((await app.inject({ url: PATH, headers: peer })).json().clips).toEqual([]);
    expect((await app.inject({ url: `${PATH}/${id}/media`, headers: peer })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${PATH}/${id}/review`,
          headers: peer,
          payload: { verdict: 'good', note: '' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `${PATH}/${id}`, headers: peer })).statusCode,
    ).toBe(404);
  });
  it('refuses unauthenticated, collector, reviewer and unprotected mutation requests', async () => {
    expect((await app.inject({ url: PATH })).statusCode).toBe(401);
    for (const token of [
      signToken(SECRET, { kind: 'reviewer', reviewerId: ids.owner }),
      signToken(SECRET, { kind: 'collector', collectorId: randomUUID(), epoch: 1 }),
    ]) {
      expect(
        (await app.inject({ url: PATH, headers: { ...headers, authorization: `Bearer ${token}` } }))
          .statusCode,
      ).toBe(403);
    }
    expect((await upload({ 'x-showcase-request': '' })).statusCode).toBe(403);
    expect((await upload({}, Buffer.from('<script>bad</script>'))).statusCode).toBe(415);
    expect((await upload({}, Buffer.alloc(SHOWCASE_MAX_BYTES + 1))).statusCode).toBe(413);
  });
  it('enforces five clips and removes expired content before a new upload', async () => {
    for (let i = 0; i < 5; i++) expect((await upload()).statusCode).toBe(201);
    const full = await upload();
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe('showcase_owner_quota');
    await (
      await db()
    ).execute(
      sql`update showcase_footage set created_at=now()-interval '8 days', expires_at=now()-interval '1 day'`,
    );
    expect((await app.inject({ url: PATH, headers })).json().clips).toEqual([]);
    expect((await upload()).statusCode).toBe(201);
    const [count] = await (
      await db()
    ).execute(sql`select count(*)::int as n from showcase_footage`);
    expect(count!.n).toBe(1);
  });
  it('enforces the durable global logical-byte cap', async () => {
    for (const owner of [ids.owner, ids.peer])
      await (
        await db()
      ).execute(sql`
   insert into showcase_footage(id,operator_id,filename,content_type,content,bytes,sha256)
   select gen_random_uuid(),${owner},'quota.mp4','video/mp4',repeat('x',${SHOWCASE_MAX_BYTES})::bytea,
    ${SHOWCASE_MAX_BYTES},repeat('0',64) from generate_series(1,5)`);
    const result = await upload({ authorization: operatorHeader(ids.third) });
    expect(result.statusCode).toBe(409);
    expect(result.json().error).toBe('showcase_storage_quota');
  });
  it('serializes competing uploads at the database quota, even on separate connections', async () => {
    for (let i = 0; i < 4; i++) expect((await upload()).statusCode).toBe(201);
    const url = new URL(dbUrl());
    url.searchParams.set('role', 'playerone_app');
    const concurrent = await open(url.toString(), { max: 2 });
    try {
      const results = await Promise.allSettled(
        [0, 1].map(() =>
          concurrent.transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.showcase_operator_id',${ids.owner},true)`);
            return tx.execute(sql`
    insert into showcase_footage(id,operator_id,filename,content_type,content,bytes,sha256)
    values (${randomUUID()},${ids.owner},'race.mp4','video/mp4',${VIDEO},${VIDEO.length},repeat('0',64))`);
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const [count] = await (
        await db()
      ).execute(sql`select count(*)::int as n from showcase_footage`);
      expect(count!.n).toBe(5);
    } finally {
      await concurrent.close();
    }
  });
  it('refuses runtime changes to ownership, content and expiry but permits demo review fields', async () => {
    const id = (await upload()).json().clip.id;
    const runtime = await appDb();
    for (const query of [
      sql`update showcase_footage set operator_id=${ids.peer} where id=${id}`,
      sql`update showcase_footage set content=${VIDEO} where id=${id}`,
      sql`update showcase_footage set expires_at=expires_at+interval '1 hour' where id=${id}`,
      sql`update showcase_footage set filename='replaced.mp4' where id=${id}`,
    ])
      await expect(runtime.execute(query)).rejects.toMatchObject({ cause: { code: '42501' } });
    const [grants] = await runtime.execute(sql`select
   has_table_privilege(current_user,'showcase_footage','SELECT') as readable,
   has_table_privilege(current_user,'showcase_footage','INSERT') as uploadable,
   has_table_privilege(current_user,'showcase_footage','DELETE') as deletable,
   has_table_privilege(current_user,'showcase_footage','UPDATE') as broad_update`);
    expect(grants).toMatchObject({
      readable: true,
      uploadable: true,
      deletable: true,
      broad_update: false,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${PATH}/${id}/review`,
          headers,
          payload: { verdict: 'good', note: 'Still allowed as a demo.' },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('enforces RLS without API predicates and clears local identity after commit and rollback', async () => {
    const ownId = (await upload()).json().clip.id;
    const peerId = (await upload({ authorization: operatorHeader(ids.peer) })).json().clip.id;
    const runtime = await appDb();
    expect(await runtime.execute(sql`select id from showcase_footage`)).toHaveLength(0);
    await runtime.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.showcase_operator_id',${ids.owner},true)`);
      expect(await tx.execute(sql`select id from showcase_footage`)).toEqual([{ id: ownId }]);
      expect(
        await tx.execute(
          sql`update showcase_footage set note='foreign' where id=${peerId} returning id`,
        ),
      ).toHaveLength(0);
      expect(
        await tx.execute(sql`delete from showcase_footage where id=${peerId} returning id`),
      ).toHaveLength(0);
    });
    expect(await runtime.execute(sql`select id from showcase_footage`)).toHaveLength(0);
    await expect(
      runtime.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.showcase_operator_id',${ids.peer},true)`);
        throw Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await runtime.execute(sql`select id from showcase_footage`)).toHaveLength(0);
    await expect(
      runtime.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.showcase_operator_id',${ids.owner},true)`);
        await tx.execute(
          sql`insert into showcase_footage(id,operator_id,filename,content_type,content,bytes,sha256) values(${randomUUID()},${ids.peer},'wrong.mp4','video/mp4',${VIDEO},${VIDEO.length},repeat('0',64))`,
        );
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    const [role] = await runtime.execute(
      sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const [ownership] = await runtime.execute(
      sql`select pg_has_role(current_user,relowner,'MEMBER') as inherited_owner from pg_class where oid='public.showcase_footage'::regclass`,
    );
    expect(ownership!.inherited_owner).toBe(false);
    await expect(
      runtime.transaction(async (tx) => {
        await tx.execute(sql`set local row_security=off`);
        await tx.execute(sql`select id from showcase_footage`);
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
  it('fixed expiry cleanup removes expired rows only, without an owner identity', async () => {
    const expired = (await upload()).json().clip.id;
    const live = (await upload({ authorization: operatorHeader(ids.peer) })).json().clip.id;
    await (
      await db()
    ).execute(
      sql`update showcase_footage set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=${expired}`,
    );
    await (await appDb()).execute(sql`select public.showcase_purge_expired()`);
    expect(await (await db()).execute(sql`select id from showcase_footage`)).toEqual([
      { id: live },
    ]);
  });
  it('preserves suspicious text as JSON data and never serves uploaded HTML as media', async () => {
    const filename = '<img onerror=alert(1)>.mp4';
    const created = await app.inject({
      method: 'POST',
      url: PATH + '?filename=' + encodeURIComponent(filename),
      headers: { ...headers, 'content-type': 'video/mp4' },
      payload: VIDEO,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().clip.filename).toBe(filename);
    expect(created.headers['content-type']).toContain('application/json');
    const note = "<script>alert(1)</script>' OR 1=1 --";
    const response = await app.inject({
      method: 'POST',
      url: PATH + '/' + created.json().clip.id + '/review',
      headers,
      payload: { verdict: 'partial', note },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().clip.note).toBe(note);
    const media = await app.inject({
      url: PATH + '/' + created.json().clip.id + '/media',
      headers,
    });
    expect(media.headers['content-type']).toBe('video/mp4');
    expect(media.headers['x-content-type-options']).toBe('nosniff');
    expect((await upload({}, Buffer.from('<html>not video</html>'))).statusCode).toBe(415);
  });
});
