import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { schema, type Db } from '@playerone/store';
import { mutate } from './audit.ts';
export const SHOWCASE_MAX_BYTES = 20 * 1024 * 1024;
const footage = schema.showcaseFootage;
const metadata = {
  id: footage.id,
  filename: footage.filename,
  content_type: footage.contentType,
  bytes: footage.bytes,
  sha256: footage.sha256,
  created_at: footage.createdAt,
  expires_at: footage.expiresAt,
  verdict: footage.verdict,
  note: footage.note,
  reviewed_at: footage.reviewedAt,
};
const uuid = z.string().uuid();
const review = z
  .object({ verdict: z.enum(['good', 'partial', 'bad']), note: z.string().trim().max(2000) })
  .strict();
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** LOCAL identity disappears at commit/rollback, including on a pooled connection. */
async function identify(tx: Tx, req: FastifyRequest) {
  await tx.execute(
    sql`select set_config('app.showcase_operator_id', ${req.actor!.operator!.operatorId}, true)`,
  );
}
export function showcaseVideoType(bytes: Buffer, type: string): boolean {
  if (type === 'video/mp4') return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  return type === 'video/webm' && bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3;
}
/** Only single byte ranges; malformed/multiple ranges are refused explicitly. */
export function showcaseRange(
  header: string | undefined,
  size: number,
): {
  start: number;
  end: number;
} | null {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = !match[1];
  const first = Number(suffix ? match[2] : match[1]);
  const last = suffix || !match[2] ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    first < 0 ||
    (suffix && first === 0)
  )
    return null;
  const start = suffix ? Math.max(0, size - first) : first;
  const end = Math.min(last, size - 1);
  return start > end || start >= size ? null : { start, end };
}
/** Isolated private clips, never production episodes or payable reviews. */
export function registerShowcaseFootage(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: any) => Promise<unknown>,
) {
  void app.register(async (scoped) => {
    // Authenticate before buffering a body. The two in-flight buffers are bounded
    // independently of the durable database quotas across all replicas.
    let uploads = 0;
    const reserved = new WeakSet<FastifyRequest>();
    const guard = async (req: FastifyRequest, reply: FastifyReply) => {
      await requireActor(req, reply);
      if (reply.sent) return;
      if (!req.actor?.operator)
        return reply.code(403).send({ error: 'showcase_operator_required' });
      // Existing session cookies are SameSite=Strict. This non-simple header
      // additionally requires a same-origin scripted mutation (no CORS enabled).
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-showcase-request'] !== '1') {
        return reply.code(403).send({ error: 'showcase_same_origin_required' });
      }
      const [operator] = await db
        .select({ id: schema.operators.id })
        .from(schema.operators)
        .where(
          and(
            eq(schema.operators.id, req.actor.operator.operatorId),
            eq(schema.operators.status, 'active'),
          ),
        );
      if (!operator) return reply.code(401).send({ error: 'operator is no longer active' });
      reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff');
    };
    scoped.addContentTypeParser(
      ['video/mp4', 'video/webm'],
      { parseAs: 'buffer', bodyLimit: SHOWCASE_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );
    const own = (req: FastifyRequest, id?: string) =>
      and(
        eq(footage.operatorId, req.actor!.operator!.operatorId),
        gt(footage.expiresAt, sql`now()`),
        id ? eq(footage.id, id) : undefined,
      );
    const idOf = (req: FastifyRequest) =>
      uuid.safeParse(
        (
          req.params as {
            id?: string;
          }
        ).id,
      );
    const purge = async () => {
      await db.execute(sql`select public.showcase_purge_expired()`);
    };
    // Content expires after seven days and is inaccessible immediately. At most
    // one additional hour of physical retention; uploads also purge in SQL.
    const timer = setInterval(() => {
      void purge().catch(() => app.log.warn('showcase expiry cleanup failed'));
    }, 3600000);
    timer.unref();
    scoped.addHook('onClose', async () => clearInterval(timer));
    scoped.get('/api/showcase/footage', { onRequest: guard }, async (req) =>
      db.transaction(async (tx) => {
        await identify(tx, req);
        return {
          clips: await tx
            .select(metadata)
            .from(footage)
            .where(own(req))
            .orderBy(desc(footage.createdAt)),
          limits: { max_bytes: SHOWCASE_MAX_BYTES, max_clips: 5, retention_days: 7 },
          demo_only: true,
        };
      }),
    );
    scoped.post(
      '/api/showcase/footage',
      {
        bodyLimit: SHOWCASE_MAX_BYTES,
        onRequest: async (req, reply) => {
          await guard(req, reply);
          if (reply.sent) return;
          if (uploads >= 2)
            return reply
              .code(429)
              .header('Retry-After', '5')
              .send({ error: 'showcase_upload_busy' });
          uploads++;
          reserved.add(req);
        },
        onResponse: async (req) => {
          if (reserved.delete(req)) uploads--;
        },
        onRequestAbort: async (req) => {
          if (reserved.delete(req)) uploads--;
        },
      },
      async (req, reply) => {
        const body = req.body;
        const type = String(req.headers['content-type'] ?? '').split(';')[0]!;
        if (!Buffer.isBuffer(body) || body.length === 0 || !showcaseVideoType(body, type)) {
          return reply.code(415).send({ error: 'showcase_video_required' });
        }
        const rawName = (
          req.query as {
            filename?: unknown;
          }
        ).filename;
        if (
          typeof rawName !== 'string' ||
          rawName.length < 1 ||
          rawName.length > 180 ||
          /[\x00-\x1f/\\]/.test(rawName)
        ) {
          return reply.code(400).send({ error: 'showcase_filename_invalid' });
        }
        const id = randomUUID();
        const sha256 = createHash('sha256').update(body).digest('hex');
        try {
          const clip = await mutate(
            db,
            req.actor!,
            {
              action: 'showcase.upload',
              targetTable: 'showcase_footage',
              targetId: id,
              after: { filename: rawName, bytes: body.length, sha256, demo_only: true },
            },
            async (tx) => {
              await identify(tx, req);
              return (
                await tx
                  .insert(footage)
                  .values({
                    id,
                    operatorId: req.actor!.operator!.operatorId,
                    filename: rawName,
                    contentType: type,
                    content: body,
                    bytes: body.length,
                    sha256,
                  })
                  .returning(metadata)
              )[0];
            },
          );
          return reply.code(201).send({ clip, demo_only: true });
        } catch (error) {
          for (let cause: any = error; cause; cause = cause.cause) {
            if (
              cause.constraint_name === 'showcase_owner_quota' ||
              cause.constraint_name === 'showcase_storage_quota'
            ) {
              return reply.code(409).send({ error: cause.constraint_name });
            }
          }
          throw error;
        }
      },
    );
    scoped.get('/api/showcase/footage/:id/media', { onRequest: guard }, async (req, reply) =>
      db.transaction(async (tx) => {
        await identify(tx, req);
        const parsed = idOf(req);
        if (!parsed.success) return reply.code(404).send({ error: 'showcase_not_found' });
        const [clip] = await tx.select(metadata).from(footage).where(own(req, parsed.data));
        if (!clip) return reply.code(404).send({ error: 'showcase_not_found' });
        const range = showcaseRange(req.headers.range, clip.bytes);
        reply.header('Accept-Ranges', 'bytes');
        if (!range) return reply.code(416).header('Content-Range', `bytes */${clip.bytes}`).send();
        const length = range.end - range.start + 1;
        // Read only the requested bytes, not a whole clip for every seek.
        const [result] = await tx
          .select({
            data: sql<Buffer>`substring(${footage.content} from ${range.start + 1} for ${length})`,
          })
          .from(footage)
          .where(own(req, parsed.data));
        if (!result) return reply.code(404).send({ error: 'showcase_not_found' });
        if (req.headers.range)
          reply
            .code(206)
            .header('Content-Range', `bytes ${range.start}-${range.end}/${clip.bytes}`);
        return reply
          .header('Content-Type', clip.content_type)
          .header('Content-Length', length)
          .send(result.data);
      }),
    );
    scoped.post(
      '/api/showcase/footage/:id/review',
      { onRequest: guard, bodyLimit: 12000 },
      async (req, reply) => {
        const parsed = idOf(req);
        const payload = review.safeParse(req.body);
        if (!parsed.success) return reply.code(404).send({ error: 'showcase_not_found' });
        if (!payload.success) return reply.code(400).send({ error: 'showcase_review_invalid' });
        const clip = await mutate(
          db,
          req.actor!,
          {
            action: 'showcase.review',
            targetTable: 'showcase_footage',
            targetId: parsed.data,
            after: { ...payload.data, demo_only: true },
          },
          async (tx) => {
            await identify(tx, req);
            return (
              await tx
                .update(footage)
                .set({
                  verdict: payload.data.verdict,
                  note: payload.data.note,
                  reviewedAt: new Date(),
                })
                .where(own(req, parsed.data))
                .returning(metadata)
            )[0];
          },
        );
        if (!clip) return reply.code(404).send({ error: 'showcase_not_found' });
        return { clip, demo_only: true };
      },
    );
    scoped.delete('/api/showcase/footage/:id', { onRequest: guard }, async (req, reply) => {
      const parsed = idOf(req);
      if (!parsed.success) return reply.code(404).send({ error: 'showcase_not_found' });
      const clip = await mutate(
        db,
        req.actor!,
        (result: { filename: string; sha256: string }) => ({
          action: 'showcase.delete',
          targetTable: 'showcase_footage',
          targetId: parsed.data,
          before: { filename: result.filename, sha256: result.sha256, demo_only: true },
        }),
        async (tx) => {
          await identify(tx, req);
          return (await tx.delete(footage).where(own(req, parsed.data)).returning(metadata))[0];
        },
      );
      if (!clip) return reply.code(404).send({ error: 'showcase_not_found' });
      return reply.code(204).send();
    });
  });
}
