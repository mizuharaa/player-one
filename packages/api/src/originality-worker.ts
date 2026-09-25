import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isDeepStrictEqual } from 'node:util';
import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { EpisodeRecord, EARLIEST_PLAUSIBLE_START_MS } from '@playerone/contracts';
import { decodeParts, frameStats } from '../../../tools/analysers/frames.ts';
import { safeJoin } from './media.ts';
import { objectBudget, type ObjectStore } from './upload-worker.ts';
import { readOriginalityInventory, recordOriginalityAssessment } from './originality.ts';
import { streamFiles } from './risk/media.ts';
import { fingerprintIndexKeys, informativeFrameHash, matchFrameSegments, mirrorFrameHash, SEGMENT_MATCH_VERSION, validateFingerprint } from './risk/frame-segments.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'execute'> | Pick<Tx, 'execute'>;
type FileRow = { path: string; bytes: number; sha256: string; key: string };
type Source = { episode_id: string; source_basename: string; record_json: unknown; measured_duration_s: string; device_serial: string; legacy: boolean };
type Assessment = { id: string; seq: string; status: string; evidence: Record<string, unknown> };
type Match = { ingest_id: string; method: string; segments?: unknown; reason?: string };

export type OriginalityWorkerOptions = {
  mediaRoot?: string;
  objectStore?: ObjectStore;
  scratchRoot?: string;
  ffmpeg?: string;
  maxBytes?: number;
  deadlineMs?: number;
};
const WINDOW = 60;
const MAX_FRAMES = 14400;
const MAX_PEERS = 64;
const MAX_QUERY_WINDOWS = 240;
const rows = async <T>(db: Reader, query: Parameters<Reader['execute']>[0]): Promise<T[]> => await db.execute(query) as unknown as T[];
const json = (value: unknown) => JSON.stringify(value);
const latest = async (db: Reader, id: string) => (await rows<Assessment>(db, sql`
  select id, seq, status, evidence from originality_assessments where ingest_id=${id}::uuid order by seq desc limit 1`))[0];
const generation = async (db: Reader) => Number((await rows<{ generation: string }>(db, sql`select generation from originality_index_state where singleton`))[0]!.generation);

async function hashFile(path: string, expected: FileRow, signal: AbortSignal): Promise<void> {
  const h = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path, { signal })) {
    bytes += chunk.length;
    if (bytes > expected.bytes) throw new Error('media_size_mismatch');
    h.update(chunk);
  }
  if (bytes !== expected.bytes || h.digest('hex') !== expected.sha256) throw new Error('media_digest_mismatch');
}

/** Scratch is exclusively ours. No centre cache, card or canonical object is deleted. */
async function materialise(source: Source, files: FileRow[], o: OriginalityWorkerOptions) {
  const budget = objectBudget({ deadlineMs: o.deadlineMs ?? 2 * 60 * 60 * 1000 });
  const ceiling = o.maxBytes ?? 32 * 1024 ** 3;
  if (files.length === 0 || files.length > 512 || files.some(f => !Number.isSafeInteger(f.bytes) || f.bytes < 0)
      || files.reduce((sum, f) => sum + f.bytes, 0) > ceiling) throw new Error('media_inventory_limit');
  const scratch = await mkdtemp(join(o.scratchRoot ?? tmpdir(), 'playerone-originality-'));
  const paths = new Map<string, string>();
  try {
    for (const f of files) {
      const local = o.mediaRoot ? safeJoin(o.mediaRoot, source.source_basename, f.path) : null;
      const cached = local !== null && await stat(local).then(s => s.isFile(), () => false);
      const path = safeJoin(scratch, '.', f.path);
      if (path === null) throw new Error('unsafe_media_path');
      await mkdir(join(path, '..'), { recursive: true });
      // Decode a private, digest-bound snapshot, never a mutable centre file.
      const body = cached ? createReadStream(local!, { signal: budget.signal }) : await o.objectStore?.read(f.key, 0, budget);
      if (body == null) throw new Error('media_unavailable');
      let bytes = 0;
      const h = createHash('sha256');
      await pipeline(Readable.from(body), async function* (chunks: AsyncIterable<Uint8Array>) {
        for await (const chunk of chunks) {
          budget.signal.throwIfAborted();
          bytes += chunk.length;
          if (bytes > f.bytes) throw new Error('media_size_mismatch');
          h.update(chunk);
          yield chunk;
        }
      }, createWriteStream(path, { flags: 'wx' }), { signal: budget.signal });
      if (bytes !== f.bytes || h.digest('hex') !== f.sha256) throw new Error('media_digest_mismatch');
      paths.set(f.path, path);
    }
    return { paths, cleanup: () => rm(scratch, { recursive: true, force: true }), verify: async () => {
      for (const f of files) await hashFile(paths.get(f.path)!, f, budget.signal);
    } };
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

async function inventoryFiles(db: Reader, ingestId: string, inventory: Record<string, unknown>): Promise<FileRow[]> {
  const files = new Map<string, Omit<FileRow, 'key'>>();
  const add = (path: unknown, bytes: unknown, sha: unknown) => {
    if (typeof path !== 'string' || !path || typeof sha !== 'string' || !/^[a-f0-9]{64}$/.test(sha)
        || !Number.isSafeInteger(Number(bytes)) || Number(bytes) < 0) throw new Error('invalid_file_inventory');
    const file = { path, bytes: Number(bytes), sha256: sha };
    const old = files.get(path);
    if (old && !isDeepStrictEqual(old, file)) throw new Error('conflicting_file_inventory');
    files.set(path, file);
  };
  if (!Array.isArray(inventory.files)) throw new Error('invalid_file_inventory');
  for (const f of inventory.files) {
    if (!Array.isArray(f) || f.length !== 3) throw new Error('invalid_file_inventory');
    add(f[0], f[1], f[2]);
  }
  const extras: unknown[] = [];
  if (Array.isArray(inventory.extras)) extras.push(...inventory.extras);
  if (Array.isArray(inventory.uploads)) for (const upload of inventory.uploads) {
    if (upload && typeof upload === 'object' && Array.isArray(upload.files)) extras.push(...upload.files);
  }
  for (const f of extras) {
    if (!f || typeof f !== 'object') throw new Error('invalid_file_inventory');
    const value = f as Record<string, unknown>;
    add(value.relative_path, value.bytes, value.sha256);
  }
  const out: FileRow[] = [];
  for (const file of [...files.values()].sort((a, b) => a.path < b.path ? -1 : 1)) {
    const [key] = await rows<{ key: string | null }>(db, sql`select originality_file_key(${ingestId}::uuid,${file.path},${file.sha256}) as key`);
    if (!key?.key) throw new Error('cloud_receipt_missing');
    out.push({ ...file, key: key.key });
  }
  return out;
}

async function candidates(db: Db, ingestId: string, hashes: string[]): Promise<{ ids: string[]; complete: boolean; ambiguousFrames: number; excludedFrames: number; timedOut: boolean }> {
  const ids = new Set<string>();
  let ambiguousFrames = 0;
  const eligible = hashes.filter(informativeFrameHash);
  const result = (complete: boolean, timedOut = false) => ({ ids: [...ids].sort(), complete, ambiguousFrames, excludedFrames: hashes.length - eligible.length, timedOut });
  // ponytail: one indexed row per sampled frame for the pilot; compress the
  // temporal index before the 40,000-hour target (~144 million frame rows).
  for (let offset = 0, n = 0; offset < eligible.length; offset += WINDOW, n++) {
    if (n >= MAX_QUERY_WINDOWS) return result(false);
    const query = eligible.slice(offset, offset + WINDOW).flatMap((hash, frame) => [hash, mirrorFrameHash(hash)].map(h => ({ frame, hash: BigInt.asIntN(64, BigInt(`0x${h}`)).toString(), keys: fingerprintIndexKeys([h]) })));
    try {
      const hits = await db.transaction(async tx => {
        await tx.execute(sql`set transaction read only`);
        await tx.execute(sql`set local statement_timeout='2000ms'`);
        await tx.execute(sql`set local jit=off`);
        return rows<{ frame: number; hits: number; peers: string[] | null }>(tx, sql`
          select (q->>'frame')::integer as frame,result.hits,result.peers
          from jsonb_array_elements(${json(query)}::jsonb) query(q)
          cross join lateral (
            select count(f.ingest_id)::integer as hits,
              array_agg(distinct f.ingest_id) filter(where bit_count((f.frame_hash # (q->>'hash')::bigint)::bit(64))<=6) as peers
            from (
              select f.ingest_id,f.frame_hash from originality_fingerprint_frames f
              join originality_fingerprints published using(ingest_id,policy_version,attempt_token)
               where f.policy_version=${SEGMENT_MATCH_VERSION} and f.ingest_id<>${ingestId}::uuid
                 and f.index_keys && ARRAY(select jsonb_array_elements_text(q->'keys')::integer)
               limit 4097
            ) f
          ) result`);
      });
      ambiguousFrames += new Set(hits.filter(h => h.hits > 4096).map(h => h.frame)).size;
      for (const hit of hits) for (const id of hit.peers ?? []) {
        if (ids.size === MAX_PEERS && !ids.has(id)) return result(false);
        ids.add(id);
      }
      if (ambiguousFrames > 0) return result(false);
    } catch (error) {
      if ((error as { code?: string }).code === '57014' || (error as { cause?: { code?: string } }).cause?.code === '57014') return result(false, true);
      throw error;
    }
  }
  return result(true);
}

async function exactPeers(db: Reader, ingestId: string): Promise<Match[]> {
  const peers = await rows<{ ingest_id: string }>(db, sql`
    select distinct other.ingest_id
      from episode_files own join episode_files other on other.sha256=own.sha256
      join episode_ingests a on a.ingest_id=own.ingest_id
      join episode_ingests b on b.ingest_id=other.ingest_id
     where own.ingest_id=${ingestId}::uuid and a.episode_id<>b.episode_id
       and own.size_bytes>4096 and (own.relative_path ilike '%.mp4' or own.relative_path ilike '%.wav')
     order by other.ingest_id limit ${MAX_PEERS + 1}`);
  return peers.map(p => ({ ingest_id: p.ingest_id, method: 'exact_media_digest' }));
}

/** CPU, disk and object reads all finish BEFORE either advisory lock is taken. */
export async function evaluateOriginality(db: Db, ingestId: string, o: OriginalityWorkerOptions = {}) {
  const before = await latest(db, ingestId);
  const inventory = await readOriginalityInventory(db, ingestId);
  if (inventory === null) throw new Error('no_such_ingest');
  const token = randomUUID();
  // The statement commits before any analysis. A lease prevents loop/--once
  // workers downloading the same large recording concurrently.
  const [job] = await rows<{ attempts: number }>(db, sql`
    insert into originality_processing(ingest_id,policy_version,inventory,attempt_token,next_attempt_at)
    values(${ingestId}::uuid,${SEGMENT_MATCH_VERSION},${json(inventory)}::jsonb,${token}::uuid,now()+interval '3 hours')
    on conflict(ingest_id,policy_version) do update set
      attempts=case when originality_processing.inventory=excluded.inventory then originality_processing.attempts+1 else 1 end,
      inventory=excluded.inventory,attempt_token=excluded.attempt_token,next_attempt_at=excluded.next_attempt_at,terminal=false
    where originality_processing.inventory is distinct from excluded.inventory
       or (not originality_processing.terminal and originality_processing.next_attempt_at<=now())
    returning attempts`);
  if (!job) return { ingestId, outcome: 'deferred' as const };
  const ownsLease = await db.transaction(async tx => {
    const [lease] = await rows<{ attempt_token: string }>(tx, sql`select attempt_token from originality_processing
      where ingest_id=${ingestId}::uuid and policy_version=${SEGMENT_MATCH_VERSION} for update`);
    if (lease?.attempt_token !== token) return false;
    await tx.execute(sql`delete from originality_fingerprint_frames f where f.ingest_id=${ingestId}::uuid
      and f.policy_version=${SEGMENT_MATCH_VERSION} and f.attempt_token<>${token}::uuid
      and not exists(select 1 from originality_fingerprints p where p.ingest_id=f.ingest_id
        and p.policy_version=f.policy_version and p.attempt_token=f.attempt_token)`);
    return true;
  });
  if (!ownsLease) return { ingestId, outcome: 'superseded' as const };
  const [source] = await rows<Source>(db, sql`
    select i.episode_id, i.source_basename, i.record_json, i.measured_duration_s, e.device_serial,
           exists(select 1 from collector_uploads u where u.ingest_id=i.ingest_id and u.measured) as legacy
      from episode_ingests i join episodes e on e.episode_id=i.episode_id where i.ingest_id=${ingestId}::uuid`);
  if (!source) throw new Error('no_such_ingest');
  let hashes: string[] | null = null;
  let status: 'complete' | 'unavailable' | 'failed' = 'unavailable';
  let evidence: Record<string, unknown> = { reason: 'media_unavailable' };
  let indexGeneration = await generation(db);
  let matches: Match[] = [];
  let mediaVerified = false;
  let fingerprintMedia: Omit<FileRow, 'key'>[] = [];
  let fingerprintFailure: string | undefined;
  try {
    if (source.legacy) throw new Error('legacy_client_measurement_requires_recovery');
    const parsed = EpisodeRecord.safeParse(source.record_json);
    if (!parsed.success) throw new Error('invalid_ingest_record');
    if (parsed.data.discrepancies.some(d => d.code === 'DEVICE-CLOCK-UNSET')
        || parsed.data.timing.usable_start_us === null || parsed.data.timing.usable_end_us === null
        || BigInt(parsed.data.timing.usable_start_us) < BigInt(EARLIEST_PLAUSIBLE_START_MS) * 1000n) throw new Error('untrusted_device_time');
    const files = await inventoryFiles(db, ingestId, inventory);
    const media = await materialise(source, files, o);
    try {
      const video = streamFiles(parsed.data).video;
      if (video.length === 0) throw new Error('no_video');
      fingerprintMedia = video.map(path => {
        const file = files.find(f => f.path === path);
        if (!file) throw new Error('video_not_in_inventory');
        return { path, bytes: file.bytes, sha256: file.sha256 };
      });
      const paths = video.map(f => {
        const path = media.paths.get(f);
        if (!path || !files.some(x => x.path === f)) throw new Error('video_not_in_inventory');
        return path;
      });
      const camera = parsed.data.streams.find(s => s.role === 'camera_left') ?? parsed.data.streams.find(s => s.role.startsWith('camera_'));
      if (!camera || camera.span_s === null || camera.span_s <= 0) throw new Error('incomplete_media_coverage');
      // Over-length recordings still get a full decode/coverage check for an
      // audited administrator disposition. Reduced-rate hashes never enter the index.
      const fps = Math.min(1, (MAX_FRAMES - 1) / camera.span_s);
      const frames = frameStats(await decodeParts(paths, { fps, maxFrames: MAX_FRAMES + 1, ffmpeg: o.ffmpeg, timeoutMs: 15 * 60 * 1000 }));
      await media.verify();
      hashes = frames.ahash;
      if ((frames.count + video.length + 1) / fps < Math.max(Number(source.measured_duration_s), camera.span_s)) throw new Error('incomplete_media_coverage');
      mediaVerified = true;
      const valid = validateFingerprint(hashes);
      fingerprintFailure = fps < 1 ? 'budget_exceeded' : valid.complete ? undefined : valid.reason ?? 'invalid_fingerprint';
    } finally { await media.cleanup(); }

    indexGeneration = await generation(db);
    matches = await exactPeers(db, ingestId);
    const timePeers = await rows<{ ingest_id: string }>(db, sql`
      select i.ingest_id from episode_ingests i join episodes e on e.episode_id=i.episode_id
       where e.device_serial=${source.device_serial} and i.episode_id<>${source.episode_id}::uuid
         and (i.record_json->'timing'->>'usable_start_us')::numeric < ${parsed.data.timing.usable_end_us}::numeric
         and (i.record_json->'timing'->>'usable_end_us')::numeric > ${parsed.data.timing.usable_start_us}::numeric
       order by i.ingest_id limit ${MAX_PEERS + 1}`);
    matches.push(...timePeers.map(p => ({ ingest_id: p.ingest_id, method: 'same_device_time_overlap' })));
    // Short/flat recordings still expose exact reuse and device-time evidence
    // to the administrator; algorithm limits do not erase known matches.
    if (fingerprintFailure) throw new Error(fingerprintFailure);
    const retrieved = await candidates(db, ingestId, hashes);
    let complete = retrieved.complete && new Set([...retrieved.ids, ...matches.map(m => m.ingest_id)]).size <= MAX_PEERS;
    for (const id of retrieved.ids) {
      const [peer] = await rows<{ hashes: string[] }>(db, sql`select hashes from originality_fingerprints
        where ingest_id=${id}::uuid and policy_version=${SEGMENT_MATCH_VERSION}`);
      if (!peer) { complete = false; continue; }
      const result = matchFrameSegments(hashes, peer.hashes);
      if (!result.complete) complete = false;
      if (result.segments.length) matches.push({ ingest_id: id, method: 'frame_segments', segments: result.segments });
    }
    status = complete ? 'complete' : retrieved.timedOut || retrieved.ambiguousFrames > 0 ? 'unavailable' : 'failed';
    evidence = { reason: complete ? (matches.length ? 'suspected_reuse' : 'no_match_in_index') : status === 'unavailable' ? 'candidate_query_budget' : 'candidate_or_match_budget',
      index_generation: indexGeneration, matching_ingests: matches, frames: hashes.length, sampled_fps: 1,
      ambiguous_frames: retrieved.ambiguousFrames, excluded_frames: retrieved.excludedFrames, query_timed_out: retrieved.timedOut,
      media_verified: mediaVerified, human_review_required: true, limitations: ['crop_overlay_unvalidated', 'fleet_thresholds_uncalibrated'] };
  } catch (error) {
    const reason = error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'analysis_unavailable';
    evidence = { reason, media_verified: mediaVerified, matching_ingests: matches, human_review_required: true };
    // Only known byte/record failures are terminal. Network, filesystem and
    // decoder infrastructure errors back off rather than permanently stranding a delivery.
    status = new Set(['legacy_client_measurement_requires_recovery', 'invalid_ingest_record',
      'untrusted_device_time', 'invalid_file_inventory', 'conflicting_file_inventory',
      'media_inventory_limit', 'unsafe_media_path', 'media_size_mismatch', 'media_digest_mismatch',
      'no_video', 'video_not_in_inventory', 'invalid_fingerprint', 'insufficient_samples',
      'low_information', 'budget_exceeded', 'incomplete_media_coverage', 'frame_decode_failed',
      'partial_decoded_frame']).has(String(evidence.reason)) ? 'failed' : 'unavailable';
    hashes = null;
  }

  const indexRows = hashes?.flatMap((hash, ordinal) => informativeFrameHash(hash) ? [{ ordinal, hash: BigInt.asIntN(64, BigInt(`0x${hash}`)).toString(), keys: fingerprintIndexKeys([hash]) }] : []) ?? [];
  const alreadyIndexed = (await rows(db, sql`select 1 from originality_fingerprints
    where ingest_id=${ingestId}::uuid and policy_version=${SEGMENT_MATCH_VERSION}`)).length > 0;
  if (status === 'complete' && !alreadyIndexed) {
    // GIN writes measured >5 seconds for 14,400 frames. Stage outside both
    // admission locks; queries see only rows joined to a published header.
    for (let at = 0; at < indexRows.length; at += 1200) {
      await db.execute(sql`insert into originality_fingerprint_frames(ingest_id,policy_version,attempt_token,ordinal,frame_hash,index_keys)
        select ${ingestId}::uuid,${SEGMENT_MATCH_VERSION},${token}::uuid,(f->>'ordinal')::integer,(f->>'hash')::bigint,
          ARRAY(select jsonb_array_elements_text(f->'keys')::integer) from jsonb_array_elements(${json(indexRows.slice(at, at + 1200))}::jsonb) f`);
    }
  }
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('originality_index'))`);
    await tx.execute(sql`select originality_lock()`);
    const [lease] = await rows<{ attempt_token: string }>(tx, sql`select attempt_token from originality_processing
      where ingest_id=${ingestId}::uuid and policy_version=${SEGMENT_MATCH_VERSION} for update`);
    if (lease?.attempt_token !== token) return { ingestId, outcome: 'superseded' as const };
    const finish = async (terminal: boolean) => {
      const delay = Math.min(3600, 300 * 2 ** Math.min(job.attempts - 1, 4));
      await tx.execute(sql`update originality_processing set terminal=${terminal},next_attempt_at=now()+${delay}*interval '1 second'
        where ingest_id=${ingestId}::uuid and policy_version=${SEGMENT_MATCH_VERSION} and attempt_token=${token}::uuid`);
    };
    const now = await latest(tx, ingestId);
    if (now?.seq !== before?.seq) { await finish(false); return { ingestId, outcome: 'superseded' as const }; }
    const currentInventory = await readOriginalityInventory(tx, ingestId);
    if (!isDeepStrictEqual(currentInventory, inventory)) { await finish(false); return { ingestId, outcome: 'superseded' as const }; }
    if (await generation(tx) !== indexGeneration) {
      status = 'unavailable';
      matches = matches.filter(m => m.method !== 'frame_segments');
      evidence = { reason: 'index_changed_during_analysis', matching_ingests: matches, media_verified: mediaVerified, human_review_required: true };
      hashes = null;
    }
    const old = await rows<{ ingest_id: string; media_files: unknown }>(tx, sql`select ingest_id,media_files from originality_fingerprints
      where ingest_id=${ingestId}::uuid and policy_version=${SEGMENT_MATCH_VERSION}`);
    if (old[0] && mediaVerified && !isDeepStrictEqual(old[0].media_files, fingerprintMedia)) {
      status='failed'; hashes=null; evidence={reason:'fingerprint_inventory_changed_requires_recovery',human_review_required:true};
    }
    if (hashes !== null && status === 'complete' && old.length === 0) {
      const [staged] = await rows<{ n: number }>(tx, sql`select count(*)::integer as n from originality_fingerprint_frames
        where ingest_id=${ingestId}::uuid and policy_version=${SEGMENT_MATCH_VERSION} and attempt_token=${token}::uuid`);
      if (staged?.n !== indexRows.length) throw new Error('incomplete_fingerprint_staging');
      await tx.execute(sql`insert into originality_fingerprints(ingest_id,policy_version,attempt_token,media_files,hashes,frame_count,sampled_fps)
        values(${ingestId}::uuid,${SEGMENT_MATCH_VERSION},${token}::uuid,${json(fingerprintMedia)}::jsonb,${json(hashes)}::jsonb,${hashes.length},1)`);
      await tx.execute(sql`update originality_index_state set generation=generation+1 where singleton`);
    }
    // Exact/time evidence also exists for byte-verified short/flat recordings
    // without an index entry. Invalidate each ordered pair once, never churn it.
    if (mediaVerified) {
      for (const peer of [...new Set(matches.map(m => m.ingest_id))].sort()) {
        if ((await rows(tx, sql`select 1 from originality_assessments where ingest_id=${peer}::uuid
          and evidence->>'matching_ingest'=${ingestId} limit 1`)).length) continue;
        const paid = await rows(tx, sql`select 1 from episode_reviews r join settlements s on s.episode_review_id=r.id
          left join bill_lines l on l.settlement_id=s.id where r.ingest_id=${peer}::uuid and
          (s.settlement_state='manually_paid' or exists(select 1 from payout_attempts p where p.bill_id=l.bill_id and p.status='succeeded')) limit 1`);
        const peerAssessment = await latest(tx, peer);
        if (paid.length || !peerAssessment) continue;
        const accepted = peerAssessment.status === 'complete' || (await rows(tx, sql`select 1 from originality_decisions
          where assessment_id=${peerAssessment.id}::uuid and decision='accepted_unassessable'`)).length > 0;
        if (!accepted) continue;
        const peerInventory = await readOriginalityInventory(tx, peer);
        if (peerInventory !== null) {
          await recordOriginalityAssessment(tx, { ingestId: peer, inventory: peerInventory,
            policyVersion: SEGMENT_MATCH_VERSION, status: 'unavailable', evidence: {
              reason: 'new_matching_ingest', matching_ingest: ingestId, previous_assessment: peerAssessment.id, human_review_required: true } });
          await tx.execute(sql`update originality_processing set terminal=false,next_attempt_at=now(),attempts=1
            where ingest_id=${peer}::uuid and policy_version=${SEGMENT_MATCH_VERSION}`);
        }
      }
    }
    await finish(status === 'complete' || status === 'failed');
    if (now?.status === status && isDeepStrictEqual(now.evidence, evidence)) return { ingestId, outcome: 'unchanged' as const };
    const result = await recordOriginalityAssessment(tx, { ingestId, inventory, policyVersion: SEGMENT_MATCH_VERSION, status, evidence });
    return { ingestId, outcome: status, assessmentId: result.id };
  }, { isolationLevel: 'read committed' });
}

/** Backfill missing history; transient failures back off, deterministic failures wait for changed inputs. */
export async function originalityDue(db: Db, limit = 20): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('originality limit must be 1..200');
  const due = await rows<{ ingest_id: string }>(db, sql`
    select i.ingest_id from episode_ingests i
      left join lateral (select a.* from originality_assessments a where a.ingest_id=i.ingest_id order by seq desc limit 1) a on true
      left join originality_processing p on p.ingest_id=i.ingest_id and p.policy_version=${SEGMENT_MATCH_VERSION}
     where (a.id is null or a.policy_version<>${SEGMENT_MATCH_VERSION}
       or a.inventory is distinct from originality_inventory(i.ingest_id)
       or (a.status<>'complete' and a.assessed_at<now()-interval '5 minutes'))
       and (p.ingest_id is null or p.inventory is distinct from originality_inventory(i.ingest_id)
         or (not p.terminal and p.next_attempt_at<=now()))
     order by i.ingested_at,i.ingest_id limit ${limit}`);
  return due.map(row => row.ingest_id);
}
