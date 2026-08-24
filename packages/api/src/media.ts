import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { EpisodeRecord } from '@playerone/contracts';
import { schema, type Db } from '@playerone/store';

/**
 * Serving the footage a reviewer is about to judge.
 *
 * This route exists because of one property that is easy to miss and expensive
 * to discover late: **without byte-range support, seeking is broken**. A
 * `<video>` element asked to jump to the eighty-percent mark of a 437 MB file
 * issues a range request; a server that answers 200 with the whole body instead
 * makes the browser download everything up to that point first. At 40,000 hours
 * of footage that is not a slow page, it is a programme that cannot be
 * reviewed.
 *
 * Nothing here writes, moves or deletes anything. That is worth stating rather
 * than assuming: the review lane runs under a documented deviation from QR-02,
 * and the half of PRD §11.3.1 rule 6 that is *not* deviable is that no TF card
 * is cleared. No code path in this file removes source media, and none should
 * be added.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
};

export type Range = { start: number; end: number };

/**
 * Parses a `Range` header for the one form that matters here.
 *
 * Returns `null` when there is no range to honour and `'unsatisfiable'` when the
 * client asked for bytes that do not exist — which is a 416 and not a 206 of
 * whatever happened to be nearby. Multi-range requests (`bytes=0-99,200-299`)
 * are deliberately not supported: no browser media element issues one, and a
 * multipart/byteranges response is a lot of surface to carry untested.
 */
export function parseRange(header: string | undefined, size: number): Range | null | 'unsatisfiable' {
  if (header === undefined || header === '') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return null;
  const [, rawStart = '', rawEnd = ''] = m;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // `bytes=-500`: the last 500 bytes. Used by probes looking for a trailing
    // moov atom, so it is not hypothetical.
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return 'unsatisfiable';
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

/**
 * Resolves a file inside the media root, or refuses.
 *
 * Both components come from the database rather than from the request, so this
 * is not the front line of anything — but a stored basename is still data, and
 * a check that costs one `relative()` call is cheaper than the argument about
 * whether it could ever matter.
 */
export function safeJoin(root: string, ...parts: string[]): string | null {
  const base = resolve(root);
  const target = resolve(join(base, ...parts));
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) return null;
  return target;
}

export function registerMedia(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  mediaRoot?: string,
): void {
  const opts = { preHandler: requireActor };

  app.get('/media/episode/:id/part/:index', opts, async (req, reply) => {
    if (mediaRoot === undefined || mediaRoot === '') {
      // A machine that has not been told where the footage lives should say so.
      // A 404 here would read as "this episode has no video", which is a
      // different and much more alarming fact.
      return reply.code(503).send({ error: 'no media root is configured on this machine' });
    }
    const { id, index } = req.params as { id: string; index: string };
    const part = Number(index);
    if (!Number.isInteger(part) || part < 0) return reply.code(400).send({ error: 'bad part index' });

    const [row] = await db
      .select({
        sourceBasename: schema.episodeIngests.sourceBasename,
        recordJson: schema.episodeIngests.recordJson,
      })
      .from(schema.episodes)
      .innerJoin(
        schema.episodeIngests,
        eq(schema.episodeIngests.ingestId, schema.episodes.latestIngestId),
      )
      .where(eq(schema.episodes.episodeId, id));
    if (row === undefined) return reply.code(404).send({ error: 'no such episode' });

    const record = EpisodeRecord.safeParse(row.recordJson);
    if (!record.success) return reply.code(500).send({ error: 'stored record does not parse' });
    const stream =
      record.data.streams.find((s) => s.role === 'camera_left') ??
      record.data.streams.find((s) => s.role === 'camera_right');
    const file = stream?.parts[part]?.file;
    if (file === undefined) return reply.code(404).send({ error: 'no such part' });

    const path = safeJoin(mediaRoot, row.sourceBasename, file);
    if (path === null) return reply.code(400).send({ error: 'bad media path' });

    let size: number;
    try {
      const info = await stat(path);
      if (!info.isFile()) return reply.code(404).send({ error: 'media is not a file' });
      size = info.size;
    } catch {
      /**
       * The store knows the file existed at import; the disk says otherwise.
       * That is a fact about this machine, not about the episode, and it is
       * worth distinguishing so an operator looks at the mount rather than at
       * the collector.
       */
      return reply.code(404).send({ error: 'media is not on this machine', detail: file });
    }

    const contentType = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = parseRange(req.headers['range'], size);

    if (range === 'unsatisfiable') {
      return reply
        .code(416)
        .headers({ 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' })
        .send({ error: 'range not satisfiable' });
    }

    if (range === null) {
      /**
       * `accept-ranges` on the plain response too. It is what tells the element
       * that seeking is available at all — without it a browser may decline to
       * offer a scrub bar even though every subsequent range request would have
       * been honoured.
       */
      return reply
        .code(200)
        .headers({
          'content-type': contentType,
          'content-length': String(size),
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=3600',
        })
        .send(createReadStream(path));
    }

    return reply
      .code(206)
      .headers({
        'content-type': contentType,
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=3600',
      })
      .send(createReadStream(path, { start: range.start, end: range.end }));
  });
}
