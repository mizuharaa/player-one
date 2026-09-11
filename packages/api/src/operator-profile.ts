import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';

const TIMEZONE = 'Asia/Ho_Chi_Minh' as const;
const DAY_MS = 86_400_000;

/** Calendar labels and the query's lower bound share the same Vietnam date. */
export function operatorActivityWindow(now: Date) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const to = `${part('year')}-${part('month')}-${part('day')}`;
  const last = Date.parse(`${to}T00:00:00Z`);
  const dates = Array.from({ length: 84 }, (_, i) =>
    new Date(last - (83 - i) * DAY_MS).toISOString().slice(0, 10));
  return { from: dates[0]!, to, dates, start: `${dates[0]}T00:00:00+07:00` };
}

/**
 * Own recorded audit actions, not time worked, earnings or a performance score.
 * Count every own audit row except *.login and *.login_failed (the complete
 * authentication event vocabulary today). session.create is collection work,
 * so it counts. Reads, failed/rolled-back writes and unattributed events do not.
 * Existing reviewer/collector scope restrictions remain in requireActor.
 */
export function registerOperatorProfile(
  app: FastifyInstance,
  db: Db,
  guard: (req: FastifyRequest, reply: any) => Promise<unknown>,
) {
  app.get('/api/operator/profile', { preHandler: guard }, async (req, reply) => {
    const operatorId = req.actor?.operator?.operatorId;
    if (operatorId === undefined) {
      return reply.code(403).send({ error: 'operator session required' });
    }

    // Explicit projection: credentials, audit payloads and other people never
    // enter the response. Recheck active status if it changed after the guard.
    const [operator] = await db.select({
      id: schema.operators.id,
      external_ref: schema.operators.externalRef,
      role: schema.operators.role,
      status: schema.operators.status,
      centre: {
        id: schema.uploadCentres.id,
        name: schema.uploadCentres.name,
        region: schema.uploadCentres.region,
      },
    }).from(schema.operators)
      .leftJoin(schema.uploadCentres, eq(schema.uploadCentres.id, schema.operators.uploadCentreId))
      .where(and(eq(schema.operators.id, operatorId), eq(schema.operators.status, 'active')));
    if (operator === undefined) {
      return reply.code(401).send({ error: 'operator is no longer active' });
    }

    const now = new Date();
    const window = operatorActivityWindow(now);
    // Range uses the existing (operator_id, occurred_at) index. Both grouping
    // and bounds are timezone-explicit, independent of server/session timezone.
    const counts = await db.execute<{ date: string; count: number }>(sql`
      select to_char(occurred_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as date,
             count(*)::integer as count
        from audit_events
       where operator_id = ${operatorId}
         and occurred_at >= ${window.start}::timestamptz
         and occurred_at <= ${now.toISOString()}::timestamptz
         and action not like '%.login'
         and action not like '%.login_failed'
       group by 1
    `);
    const byDate = new Map(counts.map((row) => [row.date, row.count]));
    const days = window.dates.map((date) => ({ date, count: byDate.get(date) ?? 0 }));
    return {
      operator,
      activity: {
        timezone: TIMEZONE,
        from: window.from,
        to: window.to,
        days,
        total_actions: days.reduce((sum, day) => sum + day.count, 0),
        active_days: days.filter((day) => day.count > 0).length,
        scope: 'recorded_operator_actions' as const,
      },
    };
  });
}
