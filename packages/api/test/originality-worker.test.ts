import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { open, storeEpisode, type Db } from '@playerone/store';
import { encodeClip, renderClip } from '../../../tools/analysers/synth.ts';
import { evaluateOriginality, originalityDue } from '../src/originality-worker.ts';
import type { ObjectStore } from '../src/upload-worker.ts';
import { closeDb, db, dbUrl, hasDb, liveClaim, truncate, useDatabase } from '../../store/test/db.ts';
import { episodeRecord } from './fixtures.ts';
import { auditRow, seedPayout } from './payout/domain/fixture.ts';

useDatabase('originality_worker');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe.skipIf(!hasDb())('originality worker scheduling and verified media', () => {
  let root: string;
  let video: Buffer;
  let serial = 0;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'originality-worker-test-'));
    const clip = renderClip({ seconds: 24, fps: 1, seed: 91, content: 'moving',
      noise: 0, motion: Array(24).fill(5) });
    const file = join(root, 'source.mp4');
    await encodeClip(clip.frames, { file, fps: clip.fps });
    video = await readFile(file);
  });
  beforeEach(async () => {
    await truncate();
    await (await db()).execute(sql`insert into originality_index_state(singleton) values(true)`);
  });
  afterAll(async () => {
    await closeDb();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function source(d: Db, options: { badTime?: boolean; cameraSpan?: number; old?: boolean } = {}) {
    const basename = `ego_WORKER_${++serial}_20260821_090000`;
    const record = episodeRecord({ basename, serial: `WORKER_${serial}`, measured: 24 });
    const blobs = new Map([
      ['left_part0001.mp4', video],
      ['left_part0001_pts.csv', Buffer.from('timestamp_us\n1787302800000000\n')],
      ['meta.json', Buffer.from('{"source":"worker-test"}')],
    ]);
    const files = [...blobs].map(([relative_path, body]) => ({ relative_path, bytes: body.length, sha256: sha(body) }));
    record.source_files = files.filter(f => f.relative_path !== 'meta.json');
    record.content_fingerprint = sha(Buffer.from(JSON.stringify(record.source_files)));
    record.streams[0]!.parts = [{ file: 'left_part0001.mp4', bytes: video.length, sha256: sha(video) }];
    if (options.cameraSpan !== undefined) {
      record.streams[0]!.span_s = options.cameraSpan;
      record.streams[0]!.last_pts_us = String(BigInt(record.streams[0]!.first_pts_us!) + BigInt(options.cameraSpan * 1_000_000));
    }
    if (options.badTime) {
      record.timing.usable_start_us = '1';
      record.timing.usable_end_us = '24000001';
    }
    const saved = await storeEpisode(d, record, options.old ? new Date('2026-01-01') : new Date());
    const ingestId = saved.ingestId!;
    await d.execute(sql`update episode_ingests set transport_extra_files = ${JSON.stringify(files.filter(f => f.relative_path === 'meta.json'))}::jsonb
      where ingest_id=${ingestId}`);
    return { ingestId, episodeId: saved.episodeId, record, files, blobs };
  }

  async function receipts(d: Db, s: Awaited<ReturnType<typeof source>>, prefix = s.ingestId) {
    const objects = new Map<string, Buffer>();
    for (const f of s.files) {
      const key = `episodes/${s.episodeId}/${prefix}/${f.relative_path}`;
      await d.execute(sql`insert into cloud_verifications(object_key,episode_id,ingest_id,sha256)
        values(${key},${s.episodeId},${s.ingestId},${f.sha256})`);
      objects.set(key, s.blobs.get(f.relative_path)!);
    }
    return objects;
  }

  function objectStore(objects: Map<string, Buffer>) {
    const reads: string[] = [];
    const store: ObjectStore = {
      async read(key, from = 0) {
        reads.push(key);
        const body = objects.get(key);
        return body === undefined ? null : (async function* () { yield body.subarray(from); })();
      },
      async put() { throw new Error('worker must never upload'); },
      async tag() { throw new Error('worker must never mutate objects'); },
    };
    return { store, reads };
  }

  function holdRead(store: ObjectStore) {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const read = store.read.bind(store);
    let held = false;
    store.read = async (...args) => {
      if (!held) { held = true; enter(); await released; }
      return read(...args);
    };
    return { entered, release };
  }

  it('twenty permanent failures do not starve a newer ingest', async () => {
    const d = await db();
    const old: string[] = [];
    for (let i = 0; i < 20; i++) old.push((await source(d, { badTime: true, old: true })).ingestId);
    const newer = await source(d);
    expect(new Set(await originalityDue(d))).toEqual(new Set(old));
    for (const ingestId of await originalityDue(d)) {
      expect((await evaluateOriginality(d, ingestId)).outcome).toBe('failed');
    }
    // Exercise the due query after its age/backoff windows, without sleeping
    // or altering immutable history: add older-dated fixture assessments with
    // the exact evidence the real worker produced, and expire the job delays.
    await d.execute(sql`insert into originality_assessments(id,ingest_id,inventory,policy_version,status,evidence,assessed_at)
      select gen_random_uuid(),ingest_id,inventory,policy_version,status,evidence,now()-interval '10 minutes'
      from originality_assessments`);
    await d.execute(sql`update originality_processing set next_attempt_at=now()-interval '1 second'`);
    expect(await originalityDue(d)).toEqual([newer.ingestId]);
    const jobs = await d.execute(sql`select terminal, attempts from originality_processing`);
    expect(jobs).toHaveLength(20);
    expect(jobs.every(j => j.terminal === true && j.attempts === 1)).toBe(true);
    expect((await evaluateOriginality(d, old[0]!)).outcome).toBe('deferred');
    expect((await d.execute(sql`select count(*)::int as n from originality_assessments`))[0]!.n).toBe(40);
  }, 60_000);

  it('unchanged transient failure renews backoff without adding duplicate evidence', async () => {
    const d = await db();
    const s = await source(d);
    await receipts(d, s);
    expect((await evaluateOriginality(d, s.ingestId)).outcome).toBe('unavailable');
    const [first] = await d.execute(sql`select attempts,terminal,next_attempt_at from originality_processing where ingest_id=${s.ingestId}`);
    expect(first).toMatchObject({ attempts: 1, terminal: false });
    expect(await originalityDue(d)).toEqual([]);
    expect((await evaluateOriginality(d, s.ingestId)).outcome).toBe('deferred');
    await d.execute(sql`insert into originality_assessments(id,ingest_id,inventory,policy_version,status,evidence,assessed_at)
      select gen_random_uuid(),ingest_id,inventory,policy_version,status,evidence,now()-interval '10 minutes'
      from originality_assessments where ingest_id=${s.ingestId}`);
    await d.execute(sql`update originality_processing set next_attempt_at=now()-interval '1 second' where ingest_id=${s.ingestId}`);
    expect(await originalityDue(d)).toEqual([s.ingestId]);
    expect((await evaluateOriginality(d, s.ingestId)).outcome).toBe('unchanged');
    const [again] = await d.execute(sql`select attempts,terminal,
      extract(epoch from next_attempt_at-now())::float as delay from originality_processing where ingest_id=${s.ingestId}`);
    expect(again).toMatchObject({ attempts: 2, terminal: false });
    expect(Number(again!.delay)).toBeGreaterThan(590);
    expect(Number(again!.delay)).toBeLessThanOrEqual(600);
    expect((await d.execute(sql`select count(*)::int as n from originality_assessments where ingest_id=${s.ingestId}`))[0]!.n).toBe(2);
    expect(await originalityDue(d)).toEqual([]);
  });

  it('loads missing cache files from verified raw upload-id keys and indexes actual decoded footage', async () => {
    const d = await db();
    const s = await source(d);
    const collector = randomUUID(), task = randomUUID(), scenario = randomUUID(), session = randomUUID(), upload = randomUUID();
    await d.execute(sql`insert into collectors(id,external_ref,status) values(${collector},'worker-c','qualified')`);
    await d.execute(sql`insert into tasks(id,name,unit_price,max_concurrent_claimants,status) values(${task},'worker',1200,5,'published')`);
    await d.execute(sql`insert into scenarios(id,code,privacy_risk_level) values(${scenario},'worker','low')`);
    const claim = await liveClaim(d, task, collector);
    await d.execute(sql`insert into collection_sessions(id,task_id,collector_id,scenario_id,task_claim_id,unit_price,currency,
      others_in_frame,sensitive_info_present,session_origin)
      values(${session},${task},${collector},${scenario},${claim},1200,'VND',false,false,'app')`);
    await d.execute(sql`insert into collector_uploads(id,collector_id,collection_session_id,device_serial,episode_id,ingest_id,
      source_basename,file_count,total_bytes,declared_files,measured,state,completed_at)
      values(${upload},${collector},${session},${s.record.device.serial},${s.episodeId},${s.ingestId},${s.record.source.path},
        ${s.files.length},${s.files.reduce((n,f)=>n+f.bytes,0)},${JSON.stringify(s.files)}::jsonb,false,'ingested',now())`);
    // Raw transport has no canonical <ingestId> keys. SQL must resolve <uploadId> receipts.
    const objects = await receipts(d, s, upload);
    const { store, reads } = objectStore(objects);
    const cache = join(root, 'cache');
    await mkdir(join(cache, s.record.source.path), { recursive: true });
    const sidecar = 'left_part0001_pts.csv';
    await writeFile(join(cache, s.record.source.path, sidecar), s.blobs.get(sidecar)!);
    const result = await evaluateOriginality(d, s.ingestId, { mediaRoot: cache, objectStore: store, scratchRoot: root });
    expect(result.outcome).toBe('complete');
    expect(reads.sort()).toEqual(s.files.filter(f => f.relative_path !== sidecar)
      .map(f => `episodes/${s.episodeId}/${upload}/${f.relative_path}`).sort());
    const [fp] = await d.execute(sql`select frame_count from originality_fingerprints where ingest_id=${s.ingestId}`);
    expect(Number(fp!.frame_count)).toBe(24);
    const [assessment] = await d.execute(sql`select status,evidence from originality_assessments where ingest_id=${s.ingestId}`);
    expect(assessment!.status).toBe('complete');
    expect(assessment!.evidence).toMatchObject({ human_review_required: true });
    expect((await d.execute(sql`select originality_ingest_payable(${s.ingestId}::uuid) as payable`))[0]!.payable).toBe(false);
    expect(await readFile(join(cache, s.record.source.path, sidecar))).toEqual(s.blobs.get(sidecar));
    expect((await readdir(root)).filter(name => name.startsWith('playerone-originality-'))).toEqual([]);
  }, 60_000);

  it('refuses truncated primary-camera coverage even when payable intersection is shorter', async () => {
    const d = await db();
    const s = await source(d, { cameraSpan: 100 });
    const { store } = objectStore(await receipts(d, s));
    expect((await evaluateOriginality(d, s.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('failed');
    const [assessment] = await d.execute(sql`select evidence from originality_assessments where ingest_id=${s.ingestId}`);
    expect(assessment!.evidence).toMatchObject({ reason: 'incomplete_media_coverage', media_verified: false });
    expect(await d.execute(sql`select * from originality_fingerprints where ingest_id=${s.ingestId}`)).toHaveLength(0);
  }, 60_000);

  it('reassesses added transport extras without rejecting an unchanged camera fingerprint', async () => {
    const d = await db();
    const s = await source(d);
    const objects = await receipts(d, s);
    const { store } = objectStore(objects);
    expect((await evaluateOriginality(d, s.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('complete');
    const [before] = await d.execute(sql`select hashes,media_files from originality_fingerprints where ingest_id=${s.ingestId}`);
    const body = Buffer.from('{"operator_note":"additional transport metadata"}');
    const extra = { relative_path: 'notes.json', bytes: body.length, sha256: sha(body) };
    const key = `episodes/${s.episodeId}/${s.ingestId}/${extra.relative_path}`;
    objects.set(key, body);
    await d.execute(sql`update episode_ingests set transport_extra_files=transport_extra_files || ${JSON.stringify([extra])}::jsonb
      where ingest_id=${s.ingestId}`);
    await d.execute(sql`insert into cloud_verifications(object_key,episode_id,ingest_id,sha256)
      values(${key},${s.episodeId},${s.ingestId},${extra.sha256})`);
    expect(await originalityDue(d)).toEqual([s.ingestId]);
    expect((await evaluateOriginality(d, s.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('complete');
    const fingerprints = await d.execute(sql`select hashes,media_files from originality_fingerprints where ingest_id=${s.ingestId}`);
    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0]).toEqual(before);
    const [assessment] = await d.execute(sql`select status,evidence from originality_assessments where ingest_id=${s.ingestId} order by seq desc limit 1`);
    expect(assessment!.status).toBe('complete');
    expect(assessment!.evidence).toMatchObject({ media_verified: true });
  }, 60_000);

  it('claims one lease when separate connections evaluate the same ingest concurrently', async () => {
    const d = await db(), s = await source(d);
    const { store } = objectStore(await receipts(d, s));
    const hold = holdRead(store), pool = await open(dbUrl(), { max: 8 });
    const first = evaluateOriginality(pool, s.ingestId, { objectStore: store, scratchRoot: root });
    try {
      await hold.entered;
      expect((await evaluateOriginality(pool, s.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('deferred');
      hold.release();
      expect((await first).outcome).toBe('complete');
      expect((await d.execute(sql`select count(*)::int as n from originality_assessments`))[0]!.n).toBe(1);
      expect((await d.execute(sql`select attempts from originality_processing where ingest_id=${s.ingestId}`))[0]!.attempts).toBe(1);
    } finally { hold.release(); await first.catch(() => undefined); await pool.close(); }
  }, 60_000);

  it('supersedes an analysis when its inventory changes during an actual object read', async () => {
    const d = await db(), s = await source(d);
    const { store } = objectStore(await receipts(d, s));
    const hold = holdRead(store), pool = await open(dbUrl(), { max: 8 });
    const pending = evaluateOriginality(pool, s.ingestId, { objectStore: store, scratchRoot: root });
    try {
      await hold.entered;
      await d.execute(sql`update episode_ingests set transport_extra_files=transport_extra_files ||
        '[{"relative_path":"late.json","bytes":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb
        where ingest_id=${s.ingestId}`);
      hold.release();
      expect((await pending).outcome).toBe('superseded');
      expect(await d.execute(sql`select * from originality_assessments`)).toHaveLength(0);
      expect(await d.execute(sql`select * from originality_fingerprints`)).toHaveLength(0);
      expect((await d.execute(sql`select terminal from originality_processing where ingest_id=${s.ingestId}`))[0]!.terminal).toBe(false);
    } finally { hold.release(); await pending.catch(() => undefined); await pool.close(); }
  }, 60_000);

  it('refuses to publish a complete result when index generation changes after matching', async () => {
    const d = await db(), s = await source(d);
    const { store } = objectStore(await receipts(d, s));
    const hold = holdRead(store), pool = await open(dbUrl(), { max: 8 });
    let pending: ReturnType<typeof evaluateOriginality> | undefined;
    try {
      await d.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('originality_index'))`);
        pending = evaluateOriginality(pool, s.ingestId, { objectStore: store, scratchRoot: root });
        await hold.entered;
        hold.release();
        // Wait for the worker's publication lock, rather than relying on decode timing.
        let waiting = false;
        for (let i = 0; i < 500 && !waiting; i++) {
          const [row] = await tx.execute(sql`select exists(select 1 from pg_locks where locktype='advisory'
            and not granted and objid=hashtext('originality_index')::oid) as waiting`);
          waiting = row!.waiting === true;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        // Real decoding has staged rows, but candidate readers must not see
        // them until this attempt publishes its header under the index lock.
        const [staged] = await tx.execute(sql`select count(*)::integer as n from originality_fingerprint_frames
          where ingest_id=${s.ingestId}`);
        expect(staged!.n).toBeGreaterThan(0);
        expect(await tx.execute(sql`select f.ingest_id from originality_fingerprint_frames f
          join originality_fingerprints published using(ingest_id,policy_version,attempt_token)
          where f.ingest_id=${s.ingestId}`)).toHaveLength(0);
        await tx.execute(sql`update originality_index_state set generation=generation+1 where singleton`);
      });
      expect((await pending!).outcome).toBe('unavailable');
      const [assessment] = await d.execute(sql`select evidence from originality_assessments where ingest_id=${s.ingestId}`);
      expect(assessment!.evidence).toMatchObject({ reason: 'index_changed_during_analysis' });
      expect(await d.execute(sql`select * from originality_fingerprints`)).toHaveLength(0);
    } finally { hold.release(); await pending?.catch(() => undefined); await pool.close(); }
  }, 60_000);

  it('a newly indexed matching ingest reopens an unpaid peer for reassessment', async () => {
    const d = await db(), first = await source(d), second = await source(d);
    const objects = await receipts(d, first);
    for (const [key, body] of await receipts(d, second)) objects.set(key, body);
    const { store } = objectStore(objects);
    expect((await evaluateOriginality(d, first.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('complete');
    expect((await evaluateOriginality(d, second.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('complete');
    const [assessment] = await d.execute(sql`select status,evidence from originality_assessments where ingest_id=${first.ingestId} order by seq desc limit 1`);
    expect(assessment!.status).toBe('unavailable');
    expect(assessment!.evidence).toMatchObject({ reason: 'new_matching_ingest', matching_ingest: second.ingestId });
    expect((await d.execute(sql`select terminal from originality_processing where ingest_id=${first.ingestId}`))[0]!.terminal).toBe(false);
    // Age the immutable evidence via another fixture row, then expire the retry.
    await d.execute(sql`insert into originality_assessments(id,ingest_id,inventory,policy_version,status,evidence,assessed_at)
      select gen_random_uuid(),ingest_id,inventory,policy_version,status,evidence,now()-interval '10 minutes'
      from originality_assessments where ingest_id=${first.ingestId} order by seq desc limit 1`);
    await d.execute(sql`update originality_processing set next_attempt_at=now()-interval '1 second' where ingest_id=${first.ingestId}`);
    expect(await originalityDue(d)).toContain(first.ingestId);
    expect((await evaluateOriginality(d, first.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('complete');
  }, 60_000);

  it('new matching footage preserves the completed assessment and ledger of a manually paid peer', async () => {
    const d = await db(), first = await source(d), second = await source(d);
    const objects = await receipts(d, first);
    for (const [key, body] of await receipts(d, second)) objects.set(key, body);
    const { store } = objectStore(objects);
    const checked = await evaluateOriginality(d, first.ingestId, { objectStore: store, scratchRoot: root });
    expect(checked.outcome).toBe('complete');
    if (!('assessmentId' in checked)) throw new Error('worker did not write an assessment');
    const ids = await seedPayout(d), decision = randomUUID(), review = randomUUID(), settlement = randomUUID(), bill = randomUUID();
    const reason = 'Independent review of the actual synthetic footage';
    await d.execute(sql`update episodes set collection_session_id=${ids.session1},resolution_state='resolved',upload_path='C'
      where episode_id=${first.episodeId}`);
    await d.transaction(async tx => {
      await tx.execute(sql`insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
        values(${decision},${checked.assessmentId},'cleared',${ids.finB},${reason})`);
      await auditRow(tx, ids, { action: 'originality.decide', targetTable: 'originality_decisions', targetId: decision, operatorId: ids.finB, reason });
    });
    await d.execute(sql`insert into episode_reviews(id,episode_id,ingest_id,measured_duration_s,effective_duration_s,review_state,reviewed_at,verdict_id)
      values(${review},${first.episodeId},${first.ingestId},24,24,'pass',now(),${randomUUID()})`);
    await d.execute(sql`insert into settlements(id,episode_review_id,task_id,task_claim_id,unit_price,effective_minutes,amount,settlement_state)
      values(${settlement},${review},${ids.task},${ids.claim1},1200,0.4,480,'pending_settlement')`);
    await d.execute(sql`update settlements set settlement_state='bill_generated' where id=${settlement}`);
    await d.transaction(async tx => {
      await tx.execute(sql`insert into bills(id,collector_id,period_start,period_end,currency,total)
        values(${bill},${ids.collector1},'2026-08-17','2026-08-24','VND',480)`);
      await tx.execute(sql`insert into bill_lines(bill_id,settlement_id) values(${bill},${settlement})`);
    });
    await d.transaction(async tx => {
      await tx.execute(sql`update settlements set settlement_state='manually_paid' where id=${settlement}`);
      await auditRow(tx, ids, { action: 'bill.mark_paid', targetTable: 'bills', targetId: bill, operatorId: ids.finA });
    });
    expect((await evaluateOriginality(d, second.ingestId, { objectStore: store, scratchRoot: root })).outcome).toBe('complete');
    const assessments = await d.execute(sql`select id,status from originality_assessments where ingest_id=${first.ingestId}`);
    expect(assessments).toEqual([{ id: checked.assessmentId, status: 'complete' }]);
    expect((await d.execute(sql`select settlement_state,amount from settlements where id=${settlement}`))[0])
      .toMatchObject({ settlement_state: 'manually_paid', amount: '480.0000' });
    expect((await d.execute(sql`select terminal from originality_processing where ingest_id=${first.ingestId}`))[0]!.terminal).toBe(true);
  }, 60_000);
});
