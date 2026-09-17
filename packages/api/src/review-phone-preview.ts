import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '@playerone/store';
import { z } from 'zod';
import { mutate } from './audit.ts';
import { parseRange, safeJoin } from './media.ts';
import type { ReviewOptions } from './review.ts';

const run = promisify(execFile);
const types: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

// Phone preview is evidence viewing, never an Ego measurement or a payable review.
export async function phonePreview(db: Db, episodeId: string, mediaRoot?: string) {
  if (!mediaRoot) return null;
  const rows = await db.execute(sql`
    select u.source_basename, f.value->>'relative_path' as filename,
           (f.value->>'bytes')::bigint as bytes, h.upload_centre_id as centre_id,
           (s.others_in_frame or s.sensitive_info_present or exists(
             select 1 from episode_reviews r where r.episode_id=e.episode_id and r.queue='privacy')) as privacy
      from collector_uploads u
      join episodes e on e.episode_id=u.episode_id and e.latest_ingest_id=u.ingest_id
      join collection_sessions s on s.id=u.collection_session_id
      left join handovers h on h.id=s.handover_id
      cross join lateral jsonb_array_elements(u.declared_files) f(value)
      join cloud_verifications v on v.episode_id=e.episode_id and v.ingest_id=u.ingest_id
        and v.object_key='episodes/'||e.episode_id||'/'||u.id||'/'||(f.value->>'relative_path')
        and v.sha256=f.value->>'sha256'
     where e.episode_id=${episodeId} and e.verification_state='verified'
       and u.measured=false and u.state='ingested' and left(u.source_basename,8)='library_'
       and lower(f.value->>'relative_path') ~ '[.](mp4|mov|webm)$'
     order by f.value->>'relative_path' limit 1
  `) as unknown as { source_basename: string; filename: string; bytes: string; centre_id: string | null; privacy: boolean }[];
  const row = rows[0];
  if (!row || !types[extname(row.filename).toLowerCase()]) return null;
  const folder = safeJoin(mediaRoot, row.source_basename);
  const path = folder && safeJoin(folder, row.filename);
  if (!path) return null;
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size !== Number(row.bytes)) return null;
  return { ...row, path, size: info.size, contentType: types[extname(row.filename).toLowerCase()]! };
}

export async function previewDuration(path: string): Promise<number | null> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { timeout: 5000, maxBuffer: 4096 });
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch { return null; }
}

export async function reviewPoster(mediaRoot: string | undefined, source: string) {
  if (!mediaRoot || source.includes('/') || source.includes('\\') || source === '.' || source === '..') return null;
  const root = safeJoin(mediaRoot, '.previews');
  const path = root && safeJoin(root, source, 'poster.jpg');
  if (!path) return null;
  const info = await stat(path).catch(() => null);
  return info?.isFile() ? path : null;
}

export function registerPhonePreview(app: FastifyInstance, db: Db, requireActor: (req: FastifyRequest, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) => Promise<unknown>, options: ReviewOptions, inCatalog: (req: FastifyRequest, episodeId: string) => Promise<{demoStandard:boolean} | null>) {
  app.get('/api/review/phone-preview/:id', { preHandler: requireActor }, async (req, reply) => {
    if (req.actor?.reviewer && !options.reviewerMediaEnabled) return reply.code(451).send({ error: 'playback_unauthorised' });
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'bad episode id' });
    const access = await inCatalog(req, id.data);
    if (!access) return reply.code(404).send({ error: 'preview unavailable' });
    const file = await phonePreview(db, id.data, options.mediaRoot);
    if (!file || (req.actor?.operator && file.centre_id !== req.actor.operator.uploadCentreId)) return reply.code(404).send({ error: 'preview unavailable' });
    // Privacy is opt-in here just as it is in the ordinary review queue.
    if (file.privacy && (req.query as { queue?: string }).queue !== 'privacy' && !access.demoStandard) return reply.code(404).send({ error: 'preview unavailable' });
    const range = parseRange(req.headers.range, file.size);
    if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${file.size}`).send();
    await mutate(db, req.actor!, { action: 'review.phone_preview', targetTable: 'episodes', targetId: id.data, after: { filename: file.filename, preview_only: true, payable: false } }, async () => true);
    reply.headers({ 'content-type': file.contentType, 'cache-control': 'private, no-store', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' });
    if (range) return reply.code(206).headers({ 'content-length': String(range.end - range.start + 1), 'content-range': `bytes ${range.start}-${range.end}/${file.size}` }).send(createReadStream(file.path, range));
    return reply.header('content-length', String(file.size)).send(createReadStream(file.path));
  });
}
