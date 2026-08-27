import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { schema, type Db } from '@playerone/store';
import { loadTuning, retuneSignal, tuningHistory } from './catalogue.ts';
import { batchId, type RiskEngine } from './engine.ts';
import { CLEAR_VERDICTS, clearHold, currentHolds, holdHistory, NoOpenHold } from './holds.ts';
import { falsePositiveReport } from './report.ts';
import { RISK_LOCALES, sentence } from './sentences.ts';
import type { Flag, RiskSummary, SubjectType } from './types.ts';

/**
 * The risk engine's HTTP surface, for Agent D's console and Agent B's payout
 * routes. Registered by `registerRisk(app, db, requireActor, engine)`; the
 * one-line call in `buildApi` is the integrator's, because `index.ts` is not
 * this branch's to edit.
 *
 * Reads are open to any operator session. The two writes that change what
 * the engine does — clearing a hold, retuning a signal — need the finance
 * role (Agent B's 0013), read from `operators.role` at request time.
 * Reviewers reach none of it: PLT-10 scopes them to `/api/review/`.
 */

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

const SubjectParams = z.object({
  type: z.enum(['collector', 'episode', 'bill', 'batch']),
  id: z.string().min(1),
});

const ClearBody = z.object({
  reason: z.string().trim().min(10),
  verdict: z.enum(CLEAR_VERDICTS as unknown as [string, ...string[]]),
});

const RetuneBody = z.object({
  threshold_version: z.string().trim().min(1),
  points: z.number().int().min(0).max(100).optional(),
  severity: z.enum(['info', 'notice', 'review', 'hold']).optional(),
  enabled: z.boolean().optional(),
  params: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  reason: z.string().trim().min(10),
});

const Window = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** A flag with its sentence in every language, which is what a screen renders. */
export const shapeFlag = (f: Flag) => ({
  signal_id: f.signalId,
  severity: f.severity,
  points: f.points,
  threshold_version: f.thresholdVersion,
  computed_at: f.computedAt,
  evidence: f.evidence,
  sentence: Object.fromEntries(RISK_LOCALES.map((l) => [l, sentence(f, l)])),
});

export const shapeSummary = (s: RiskSummary & { evaluatedAt?: string | null }) => ({
  subject_type: s.subjectType,
  subject_id: s.subjectId,
  score: s.score,
  band: s.band,
  evaluated_at: s.evaluatedAt ?? null,
  flags: s.flags.map(shapeFlag),
});

export function registerRisk(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  engine: RiskEngine,
): void {
  const opts = { preHandler: requireActor };

  const operatorOf = (req: FastifyRequest): string | null => req.actor?.operator?.operatorId ?? null;

  const requireFinance = async (req: FastifyRequest, reply: Reply): Promise<string | null> => {
    const operatorId = operatorOf(req);
    if (operatorId === null) {
      reply.code(403).send({ error: 'an operator session is required' });
      return null;
    }
    const [row] = await db
      .select({ role: schema.operators.role })
      .from(schema.operators)
      .where(eq(schema.operators.id, operatorId));
    if (row?.role !== 'finance') {
      reply.code(403).send({ error: 'the finance role is required', role: row?.role ?? null });
      return null;
    }
    return operatorId;
  };

  app.get('/api/risk/summary/:type/:id', opts, async (req, reply) => {
    const p = SubjectParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'unknown subject type' });
    return reply.send(shapeSummary(await engine.summary(p.data.type as SubjectType, p.data.id)));
  });

  app.post('/api/risk/evaluate/:type/:id', opts, async (req, reply) => {
    const p = SubjectParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'unknown subject type' });
    if (operatorOf(req) === null) return reply.code(403).send({ error: 'an operator session is required' });
    try {
      const r =
        p.data.type === 'collector'
          ? await engine.evaluateCollector(p.data.id)
          : p.data.type === 'episode'
            ? await engine.evaluateEpisode(p.data.id)
            : p.data.type === 'bill'
              ? await engine.evaluateBill(p.data.id)
              : await (() => {
                  const [start, end] = p.data.id.split('/');
                  const s = new Date(start ?? '');
                  const e = new Date(end ?? '');
                  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) throw new Error('a batch id is <period_start>/<period_end>');
                  return engine.evaluateBatch(s, e);
                })();
      return reply.send({ ...shapeSummary(r), run_id: r.runId, hold: r.hold, tools: r.tools });
    } catch (err) {
      const message = (err as Error).message;
      if (message.startsWith('no such')) return reply.code(404).send({ error: message });
      if (message.startsWith('a batch id')) return reply.code(400).send({ error: message });
      throw err;
    }
  });

  app.get('/api/risk/holds', opts, async (_req, reply) => {
    const holds = await currentHolds(db);
    return reply.send({
      holds_enabled: engine.holdsEnabled,
      holds: holds.map((h) => ({
        hold_id: h.holdId,
        bill_id: h.billId,
        raised_by_flag: h.raisedByFlag,
        raised_at: h.raisedAt.toISOString(),
        signal_ids: h.signalIds,
      })),
    });
  });

  app.get('/api/risk/holds/:billId', opts, async (req, reply) => {
    const { billId } = req.params as { billId: string };
    if (!/^[0-9a-f-]{36}$/i.test(billId)) return reply.code(400).send({ error: 'not a bill id' });
    const history = await holdHistory(db, billId);
    return reply.send({
      bill_id: billId,
      held: history.length > 0 && history[history.length - 1]!.clearedAt === null,
      history: history.map((h) => ({
        hold_id: h.id,
        raised_by_flag: h.raisedByFlag,
        raised_at: h.raisedAt.toISOString(),
        signal_ids: h.signalIds,
        cleared_at: h.clearedAt?.toISOString() ?? null,
        cleared_by: h.clearedBy,
        clear_reason: h.clearReason,
        clear_verdict: h.clearVerdict,
      })),
    });
  });

  app.post('/api/risk/holds/:billId/clear', opts, async (req, reply) => {
    const { billId } = req.params as { billId: string };
    if (!/^[0-9a-f-]{36}$/i.test(billId)) return reply.code(400).send({ error: 'not a bill id' });
    const body = ClearBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'a typed reason of at least ten characters and a verdict are required', detail: body.error.issues.slice(0, 3) });
    const operatorId = await requireFinance(req, reply);
    if (operatorId === null) return;
    try {
      const cleared = await clearHold(db, req.actor!, {
        billId,
        operatorId,
        reason: body.data.reason,
        verdict: body.data.verdict as (typeof CLEAR_VERDICTS)[number],
        now: engine.clock(),
      });
      return reply.send({ bill_id: billId, cleared_hold: cleared.id, held: false });
    } catch (err) {
      if (err instanceof NoOpenHold) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.get('/api/risk/report/false-positives', opts, async (req, reply) => {
    const w = Window.safeParse(req.query ?? {});
    if (!w.success) return reply.code(400).send({ error: 'from and to must be dates' });
    const to = w.data.to ?? new Date();
    const from = w.data.from ?? new Date(to.getTime() - 90 * 86_400_000);
    return reply.send(await falsePositiveReport(db, { from, to }));
  });

  app.get('/api/risk/signals', opts, async (_req, reply) => {
    const tuning = await loadTuning(db);
    return reply.send({
      signals: [...tuning.values()]
        .sort((a, b) => (a.signalId < b.signalId ? -1 : 1))
        .map((t) => ({
          signal_id: t.signalId,
          family: t.family,
          description: t.description,
          points: t.points,
          severity: t.severity,
          enabled: t.enabled,
          threshold_version: t.thresholdVersion,
          params: t.params,
        })),
    });
  });

  app.get('/api/risk/signals/:id/history', opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const history = await tuningHistory(db, id);
    if (history.length === 0) return reply.code(404).send({ error: `no signal ${id}` });
    return reply.send({
      signal_id: id,
      versions: history.map((h) => ({
        threshold_version: h.thresholdVersion,
        points: h.defaultPoints,
        severity: h.defaultSeverity,
        enabled: h.enabled,
        params: h.params,
        created_at: h.createdAt.toISOString(),
        superseded_at: h.supersededAt?.toISOString() ?? null,
      })),
    });
  });

  app.post('/api/risk/signals/:id/retune', opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = RetuneBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid retune', detail: body.error.issues.slice(0, 3) });
    const operatorId = await requireFinance(req, reply);
    if (operatorId === null) return;
    try {
      const next = await retuneSignal(db, req.actor!, {
        signalId: id,
        thresholdVersion: body.data.threshold_version,
        points: body.data.points,
        severity: body.data.severity,
        enabled: body.data.enabled,
        params: body.data.params,
        description: body.data.description,
        reason: body.data.reason,
      });
      return reply.send({ signal_id: next.signalId, threshold_version: next.thresholdVersion, points: next.points, severity: next.severity, enabled: next.enabled, params: next.params });
    } catch (err) {
      const message = (err as Error).message;
      if (message.startsWith('no current tuning row')) return reply.code(404).send({ error: message });
      // The two CHECKs that refuse lifting the synthetic cap, and the pkey that refuses a reused version.
      const constraint = walk(err);
      if (constraint) return reply.code(409).send({ error: 'refused', constraint });
      throw err;
    }
  });

  /** For a console that wants to show a batch's flags by period. */
  app.get('/api/risk/batch', opts, async (req, reply) => {
    const w = Window.safeParse(req.query ?? {});
    if (!w.success || !w.data.from || !w.data.to) return reply.code(400).send({ error: 'from and to are required' });
    return reply.send(shapeSummary(await engine.summary('batch', batchId(w.data.from, w.data.to))));
  });
}

function walk(err: unknown): string | null {
  for (let e: unknown = err; e !== undefined && e !== null; e = (e as { cause?: unknown }).cause) {
    const c = (e as { constraint_name?: string }).constraint_name;
    if (c) return c;
  }
  return null;
}
