import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import {
  deriveEpisodeId,
  parseSessionBasename,
  EpisodeRecord,
  stateFrom,
} from '@playerone/contracts';
import { z } from 'zod';
import { ADMIN_ROLE, ADMIN_REFUSAL } from './actor.ts';
export type EngineeringCapabilities = {
  objectStore: boolean;
  presignedUpload: boolean;
  mediaRoot: boolean;
  verificationGate: 'local' | 'cloud';
  reviewerMediaEnabled: boolean;
  signInDeliveryMode: 'zns' | 'dev_log' | 'unconfigured' | 'unknown';
  payoutMode: 'manual' | 'api';
  payoutClient: boolean;
  riskEnabled: boolean;
};
const e = schema.episodes;
const episodeFields = {
  episode_id: e.episodeId,
  last_seen_at: e.lastSeenAt,
  resolution_state: e.resolutionState,
  verification_state: e.verificationState,
  upload_path: e.uploadPath,
  ingest_count: e.ingestCount,
};
const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    before: z.string().uuid().optional(),
  })
  .strict();
const auditQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    episode_id: z.string().uuid().optional(),
    before: z
      .string()
      .regex(/^\d{1,16}$/)
      .optional(),
  })
  .strict();
/** Deliberately lossy projection. Paths, hosts, device/people IDs and free text never return. */
export function engineeringRecord(raw: unknown) {
  const result = EpisodeRecord.safeParse(raw);
  if (!result.success)
    return {
      schema_valid: false,
      details: 'Stored record did not match current schema; raw payload withheld.',
    };
  const r = result.data;
  return {
    schema_valid: true,
    schema_version: r.schema_version,
    episode_id: r.episode_id,
    state: r.state,
    timing: r.timing,
    stream_count: r.streams.length,
    source_file_count: r.source_files.length,
    calibration_present: r.calibration.present,
    discrepancies: r.discrepancies
      .slice(0, 100)
      .map((d) => ({ code: d.code, severity: d.severity })),
    discrepancies_truncated: r.discrepancies.length > 100,
  };
}
export function registerEngineering(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: any) => Promise<unknown>,
  cap: EngineeringCapabilities,
) {
  type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
  const read = <T>(run: (tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      return run(tx);
    });
  const guard = async (req: FastifyRequest, reply: any) => {
    await requireActor(req, reply);
    if (reply.sent) return;
    const id = req.actor?.operator?.operatorId;
    const [operator] = id
      ? await db
          .select({ role: schema.operators.role, status: schema.operators.status })
          .from(schema.operators)
          .where(eq(schema.operators.id, id))
      : [];
    if (!operator || operator.role !== ADMIN_ROLE || operator.status !== 'active')
      return reply
        .code(403)
        .send({ error: 'refused', constraint: ADMIN_REFUSAL, role_required: ADMIN_ROLE });
    reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff');
  };
  app.get('/api/engineering/status', { preHandler: guard }, async () => {
    const [security] = await read(async (tx) => {
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      return tx.execute<{
        showcase_rls: boolean;
        runtime_bypass_rls: boolean;
      }>(
        sql`select (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.showcase_footage'::regclass) as showcase_rls,(select rolbypassrls or rolsuper from pg_roles where rolname=current_user) as runtime_bypass_rls`,
      );
    });
    const configured = (value: boolean) => (value ? 'configured_unprobed' : 'unconfigured');
    return {
      checked_at: new Date().toISOString(),
      read_only: true,
      security,
      services: [
        {
          id: 'database',
          state: 'healthy',
          detail: 'Bounded SQL read completed; this does not establish external service health.',
        },
        {
          id: 'ingest_manifest',
          state: 'available',
          detail:
            'Ingest CLI and contract validation code exist; no collector files were ingested by this read.',
        },
        {
          id: 'upload_path_a',
          state: configured(cap.presignedUpload),
          detail: 'Collector presigned upload capability; no upload or remote probe executed.',
        },
        {
          id: 'upload_paths_b_c',
          state: configured(cap.objectStore && cap.mediaRoot),
          detail: 'Centre upload requires object store and local media; transport not probed.',
        },
        {
          id: 'object_verification',
          state: configured(cap.objectStore),
          detail: 'Object readback integration configured status only; no object request executed.',
        },
        {
          id: 'archive',
          state: 'unknown',
          detail: 'Archive worker runs separately; no worker heartbeat registry is available here.',
        },
        {
          id: 'review',
          state: 'available',
          detail: `Metadata review routes available; verification gate ${cap.verificationGate}; reviewer raw playback ${cap.reviewerMediaEnabled ? 'enabled' : 'disabled'}.`,
        },
        {
          id: 'media',
          state: configured(cap.mediaRoot),
          detail: 'Local media root presence only; no file path or raw footage exposed.',
        },
        {
          id: 'settlement',
          state: 'available',
          detail:
            'Finance-authorized settlement implementation; no bills generated or totals exposed.',
        },
        {
          id: 'payment_delivery',
          state: cap.payoutMode === 'manual' ? 'manual' : configured(cap.payoutClient),
          detail: 'No payment, balance call, account verification or financial probe executed.',
        },
        {
          id: 'risk',
          state: cap.riskEnabled ? 'configured_unprobed' : 'unconfigured',
          detail: 'Advisory risk configuration only; no hold or evaluation executed.',
        },
        {
          id: 'sign_in_delivery',
          state:
            cap.signInDeliveryMode === 'zns'
              ? 'configured_unprobed'
              : cap.signInDeliveryMode === 'unknown'
                ? 'unknown'
                : 'unconfigured',
          detail:
            cap.signInDeliveryMode === 'dev_log'
              ? 'Development logging adapter only; codes are NOT delivered.'
              : cap.signInDeliveryMode === 'zns'
                ? 'ZNS adapter configured; delivery not probed.'
                : 'Delivery adapter unavailable or type unknown.',
        },
        {
          id: 'jobs',
          state: 'unknown',
          detail:
            'External job liveness is not registered; this API cannot certify workers are running.',
        },
        {
          id: 'showcase',
          state: security?.showcase_rls ? 'available' : 'unknown',
          detail: 'Private demo storage only; separate from production review and payment.',
        },
      ],
    };
  });
  app.get('/api/engineering/episodes', { preHandler: guard }, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const rows = await read((tx) =>
      tx
        .select(episodeFields)
        .from(e)
        .where(q.data.before ? lt(e.episodeId, q.data.before) : undefined)
        .orderBy(desc(e.episodeId))
        .limit(q.data.limit + 1),
    );
    const more = rows.length > q.data.limit;
    const episodes = rows.slice(0, q.data.limit);
    return { episodes, next_cursor: more ? episodes.at(-1)!.episode_id : null };
  });
  app.get('/api/engineering/episodes/:id', { preHandler: guard }, async (req, reply) =>
    read(async (tx) => {
      const id = z
        .string()
        .uuid()
        .safeParse(
          (
            req.params as {
              id: string;
            }
          ).id,
        );
      if (!id.success) return reply.code(400).send({ error: 'invalid_query' });
      const [row] = await tx
        .select({ ...episodeFields, latest: e.latestIngestId })
        .from(e)
        .where(eq(e.episodeId, id.data));
      if (!row) return reply.code(404).send({ error: 'episode_not_found' });
      const i = schema.episodeIngests;
      const [ingest] = row.latest
        ? await tx
            .select({
              ingest_id: i.ingestId,
              state: i.state,
              ingested_at: i.ingestedAt,
              measured_duration_s: i.measuredDurationS,
              record: sql<unknown>`case when octet_length(${i.recordJson}::text)<=262144 then ${i.recordJson} else null end`,
            })
            .from(i)
            .where(and(eq(i.ingestId, row.latest), eq(i.episodeId, id.data)))
        : [];
      const { latest, ...episode } = row;
      const { record, ...metadata } = ingest ?? { record: null };
      return {
        episode,
        ingest: ingest ? metadata : null,
        record_json: record ? engineeringRecord(record) : null,
        record_redacted: true,
        record_limit_bytes: 262144,
      };
    }),
  );
  app.get('/api/engineering/audit', { preHandler: guard }, async (req, reply) => {
    const q = auditQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const a = schema.auditEvents;
    const rows = await read((tx) =>
      tx
        .select({
          id: sql<string>`${a.id}::text`,
          occurred_at: a.occurredAt,
          action: a.action,
          target_table: a.targetTable,
          target_id: sql<string>`case when ${a.targetId} ~ '^[0-9a-f-]{36}$' then ${a.targetId} else '[redacted]' end`,
          actor_role: a.actorRole,
        })
        .from(a)
        .where(
          and(
            q.data.episode_id
              ? and(eq(a.targetTable, 'episodes'), eq(a.targetId, q.data.episode_id))
              : undefined,
            q.data.before ? sql`${a.id}<${q.data.before}::bigint` : undefined,
          ),
        )
        .orderBy(desc(a.id))
        .limit(q.data.limit + 1),
    );
    const events = rows.slice(0, q.data.limit);
    return {
      events,
      next_cursor: rows.length > q.data.limit ? events.at(-1)!.id : null,
      payloads_omitted: true,
    };
  });
  app.get('/api/engineering/probes/:probe', { preHandler: guard }, async (req, reply) => {
    if (
      (
        req.params as {
          probe: string;
        }
      ).probe !== 'sample-contract'
    )
      return reply.code(400).send({ error: 'unknown_probe' });
    const sample = 'ego_DIAGNOSTIC_20260910_120000';
    const first = deriveEpisodeId(sample);
    return {
      probe: 'sample-contract',
      read_only: true,
      scope: 'Synthetic in-memory contracts only; no ingest/files/network/payment.',
      checks: [
        { id: 'session_basename', passed: parseSessionBasename(sample) !== null },
        { id: 'deterministic_episode_identity', passed: first === deriveEpisodeId(sample) },
        {
          id: 'malformed_record_rejected',
          passed: !EpisodeRecord.safeParse({ state: 'ok' }).success,
        },
        { id: 'empty_discrepancy_state', passed: stateFrom([]) === 'ok' },
      ],
    };
  });
}
