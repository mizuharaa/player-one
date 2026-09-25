import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { roleOf } from './actor.ts';
import { mutate } from './audit.ts';
import { constraintOf } from './backoffice.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Db | Tx;
export const ORIGINALITY_POLICY_VERSION = 'segment-v1';
export type OriginalityInventory = Record<string, unknown>;

export async function lockOriginality(db: Reader): Promise<void> {
  await db.execute(sql`select originality_lock()`);
}

export async function readOriginalityInventory(db: Reader, ingestId: string): Promise<OriginalityInventory | null> {
  const [row] = await db.execute(sql`select originality_inventory(${ingestId}::uuid) as inventory`);
  return (row?.inventory ?? null) as OriginalityInventory | null;
}

/** Capture inventory BEFORE decoding. The database rejects a changed snapshot. */
export async function recordOriginalityAssessment(db: Reader, input: {
  ingestId: string; inventory: OriginalityInventory; policyVersion: string;
  status: 'complete' | 'unavailable' | 'failed'; evidence: Record<string, unknown>;
}): Promise<{ id: string; seq: number }> {
  const [row] = await db.execute(sql`
    insert into originality_assessments(id, ingest_id, inventory, policy_version, status, evidence)
    values (${randomUUID()}, ${input.ingestId}, ${JSON.stringify(input.inventory)}::jsonb,
      ${input.policyVersion}, ${input.status}, ${JSON.stringify(input.evidence)}::jsonb)
    returning id, seq`);
  return { id: String(row!.id), seq: Number(row!.seq) };
}

export async function billOriginalityBlocker(db: Reader, billId: string): Promise<string | null> {
  const [row] = await db.execute(sql`select bill_originality_blocker(${billId}::uuid) as blocker`);
  return row?.blocker == null ? null : String(row.blocker);
}

const Id = z.object({ id: z.string().uuid() });
const Decision = z.object({ decision: z.enum(['cleared', 'reused', 'accepted_unassessable']), reason: z.string().trim().min(10).max(4000) });
const Identity = z.object({ collector_id: z.string().uuid().nullable(), reason: z.string().trim().min(10).max(4000) }).strict();
const DECISION_REFUSALS = new Set(['originality_assessment_not_current', 'originality_reviewer_forbidden',
  'originality_identity_unverified_or_self', 'originality_reuse_confirmed']);
type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

export function registerOriginality(app: FastifyInstance, db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>): void {
  const preHandler = [requireActor, async (req: FastifyRequest, reply: Reply) => {
    if (!['finance', 'administrator'].includes((await roleOf(db, req.actor)) ?? '')) {
      return reply.code(403).send({ error: 'originality review requires finance or administrator' });
    }
  }];

  app.post('/api/originality/operators/:id/identity', { preHandler }, async (req, reply) => {
    const p = Id.safeParse(req.params), body = Identity.safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ error: 'operator id, collector_id (or null), and reason required' });
    if (await roleOf(db, req.actor) !== 'administrator' || req.actor?.operator?.operatorId === p.data.id) {
      return reply.code(403).send({ error: 'a different administrator must attest this identity' });
    }
    if (body.data.collector_id !== null) {
      const [collector] = await db.execute(sql`select id from collectors where id=${body.data.collector_id}`);
      if (!collector) return reply.code(404).send({ error: 'collector not found' });
    }
    const result = await mutate(db, req.actor!, {
      action: 'originality.identity_attest', targetTable: 'operators', targetId: p.data.id, reason: body.data.reason,
      after: { collector_id: body.data.collector_id, collector_identity_verified: true },
    }, async tx => {
      await lockOriginality(tx);
      const [operator] = await tx.execute(sql`update operators set collector_id=${body.data.collector_id}, collector_identity_verified=true
        where id=${p.data.id} returning id, collector_id, collector_identity_verified`);
      return operator;
    });
    if (!result) return reply.code(404).send({ error: 'operator not found' });
    return result;
  });

  app.get('/api/originality/ingests/:id', { preHandler }, async (req, reply) => {
    const p = Id.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid ingest id' });
    const inventory = await readOriginalityInventory(db, p.data.id);
    if (inventory === null) return reply.code(404).send({ error: 'ingest not found' });
    const rows = await db.execute(sql`
      select a.*, d.id as decision_id, d.decision, d.operator_id, d.reason, d.decided_at
      from originality_assessments a left join originality_decisions d on d.assessment_id = a.id
      where a.ingest_id = ${p.data.id} order by a.seq desc limit 100`);
    const [state] = await db.execute(sql`select originality_ingest_payable(${p.data.id}::uuid) as payable`);
    const [identity] = await db.execute(sql`select collector_identity_verified from operators where id=${req.actor?.operator?.operatorId ?? null}`);
    return { ingest_id: p.data.id, policy_version: ORIGINALITY_POLICY_VERSION,
      payable: state?.payable === true, identity_verified: identity?.collector_identity_verified === true,
      disposition: rows[0]?.decision ?? 'pending', inventory, assessments: rows };
  });

  app.post('/api/originality/assessments/:id/decision', { preHandler }, async (req, reply) => {
    const p = Id.safeParse(req.params), body = Decision.safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ error: 'assessment id, decision and reason (10+ characters) required' });
    const operatorId = req.actor?.operator?.operatorId;
    if (!operatorId) return reply.code(403).send({ error: 'operator session required' });
    const id = randomUUID();
    try {
      const result = await mutate(db, req.actor!, (row: { id: string; evidenceDigest: string; parked: string[] }) => ({
        action: 'originality.decide', targetTable: 'originality_decisions', targetId: id,
        reason: body.data.reason,
        after: { assessment_id: p.data.id, decision: body.data.decision, evidence_digest: row.evidenceDigest, parked_settlements: row.parked },
      }), async (tx) => {
        await lockOriginality(tx);
        const [assessment] = await tx.execute(sql`select * from originality_assessments where id = ${p.data.id}`);
        if (!assessment) return undefined;
        await tx.execute(sql`insert into originality_decisions(id, assessment_id, decision, operator_id, reason)
          values (${id}, ${p.data.id}, ${body.data.decision}, ${operatorId}, ${body.data.reason})`);
        // Paid/admitted transfers remain reconcilable. No clawback or rewriting bill totals.
        const parked = body.data.decision !== 'reused' ? [] : await tx.execute(sql`
          update settlements s set settlement_state = 'exception', exception_from_state = s.settlement_state,
            exception_reason = 'duplicate', exception_note = ${body.data.reason}, updated_at = now()
          from episode_reviews r where r.id = s.episode_review_id and r.ingest_id = ${assessment.ingest_id}
            and s.settlement_state in ('pending_review', 'pending_settlement', 'bill_generated')
            and not exists (select 1 from bill_lines l join payout_attempts p on p.bill_id = l.bill_id
              where l.settlement_id = s.id and p.status in ('submitted', 'processing', 'pending_zlp', 'unknown', 'succeeded'))
          returning s.id`);
        return { id, evidenceDigest: createHash('sha256').update(JSON.stringify({
          inventory: assessment.inventory, policy: assessment.policy_version, evidence: assessment.evidence,
        })).digest('hex'), parked: parked.map((s) => String(s.id)) };
      });
      if (result === undefined) return reply.code(404).send({ error: 'assessment not found' });
      return reply.code(201).send(result);
    } catch (error) {
      const name = constraintOf(error);
      const constraint = name === 'originality_decisions_assessment_id_key' ? 'originality_assessment_not_current' : name;
      if (constraint && DECISION_REFUSALS.has(constraint)) return reply.code(409).send({ error: 'refused', constraint });
      throw error;
    }
  });
}
