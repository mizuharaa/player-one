import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '@playerone/store';

/**
 * PLT-12, which adopts PaXini's PRD §11.4 alert list verbatim and says not to
 * reinvent it. The nine, in the PRD's own order:
 *
 *   1 continuous upload failures
 *   2 devices offline for extended periods
 *   3 upload centres offline or with queue backlogs
 *   4 fixed upload devices running low on disk space
 *   5 consecutive TF card import failures
 *   6 cloud storage write failures
 *   7 consecutive checksum verification failures
 *   8 review service unable to read cloud storage
 *   9 massive timeouts in cross-border link requests
 *
 * All nine are one SELECT over rows this platform already writes. There is no
 * alerts table, no worker, no notification channel and no escalation policy —
 * a twenty-device pilot has an operator looking at a screen, and every one of
 * those would be a second place for the same fact to live. What is missing for
 * a real deployment is written down at the end of this comment.
 *
 * **Three of the nine cannot fire, and say so rather than reading zero.** A
 * condition nothing records is not a condition that is not happening, and a
 * board showing six greens and three silent zeroes is worse than one that names
 * what it cannot see. Those three answer `no_signal`:
 *
 *   - **6, cloud storage write failures.** `upload.ts` catches a failed `put`
 *     per episode and returns the message in the HTTP response. Nothing is
 *     stored, so nothing can be counted. It needs a persisted transport-attempt
 *     row before it can fire.
 *   - **8, review service unable to read cloud storage.** The review lane reads
 *     the upload centre's local media (ADR 0001), so there is no cloud read to
 *     fail. It becomes measurable when `REVIEW_VERIFICATION_GATE=cloud` retires
 *     that ADR and the lane starts streaming from the bucket.
 *   - **9, cross-border link timeouts.** Nothing in this repository times the
 *     link to Shenzhen or to the bucket. It needs a latency record per request.
 *
 * `observed` is a count of offending things right now, `threshold` is the count
 * at which the condition fires. The PRD gives no numbers, so the ones below are
 * chosen for a twenty-device pilot and are deliberately literals in the query
 * rather than settings: nobody has operated this yet, and a setting invented
 * before the first week of real data is a guess with a knob on it. Tune them
 * here when the pilot says what normal looks like.
 *
 * ponytail: a derived query and one route. Before real money at scale this
 * needs the three missing signals above, a scheduled evaluation (nothing polls
 * this), somewhere for a firing condition to go at 3am, and per-centre
 * breakdowns — this counts machines platform-wide and an operator at one centre
 * sees another centre's number.
 */

export type AlertState = 'ok' | 'firing' | 'no_signal';

export type Alert = {
  id: string;
  state: AlertState;
  /** How many offending things there are, or null when nothing records the fact. */
  observed: number | null;
  threshold: number | null;
};

/**
 * The nine conditions, evaluated in one statement.
 *
 * Each condition is a scalar subquery, so adding one is a `union all` branch
 * and nothing else. `ord` is the PRD's own numbering and is what the rows are
 * ordered by, so the board reads in the order the PRD lists them.
 */
const ALERTS = sql`
  select a.id,
         a.observed,
         a.threshold,
         case when a.observed is null then 'no_signal'
              when a.observed >= a.threshold then 'firing'
              else 'ok' end as state
    from (
      -- 1. Path A deliveries that failed and were never landed. A phone retries,
      -- so a failure with a later verified row for the same delivery is history
      -- and not a fault.
      select 1 as ord, 'upload_failures' as id, 3 as threshold, (
        select count(*)::int from collector_uploads u
         where u.state = 'failed'
           and u.registered_at > now() - interval '24 hours'
           and not exists (select 1 from collector_uploads v
                            where v.episode_id = u.episode_id
                              and v.ingest_id = u.ingest_id
                              and v.state = 'verified')) as observed
      union all
      -- 2. A device somebody is holding that has produced nothing for a week.
      -- Measured from the episodes it recorded, falling back to when it was
      -- handed over: a device bound yesterday is not overdue.
      select 2, 'devices_offline', 1, (
        select count(*)::int from devices d
         where d.bound_collector_id is not null
           and d.status = 'active'
           and coalesce((select max(e.last_seen_at) from episodes e
                          where e.device_serial = d.hardware_serial),
                        d.bound_at) < now() - interval '7 days')
      union all
      -- 3 and 4 read upload_device_status, which the counter's heartbeat route
      -- upserts (PRD §11.3.2 rule 8). No client sends that heartbeat yet, so a
      -- machine that has never reported is NOT counted as quiet — otherwise
      -- every centre sits permanently red and the board is ignored. When the
      -- centre client ships, the join becomes a left join and a missing row
      -- starts meaning what it says. Until any machine reports at all there is
      -- no signal here either.
      select 3, 'upload_centres_offline_or_backlogged', 1, (
        select case when not exists (select 1 from upload_device_status) then null else (
          select count(*)::int from upload_devices ud
            join upload_device_status s on s.upload_device_id = ud.id
           where ud.status = 'active'
             and (s.last_heartbeat_at < now() - interval '15 minutes'
                  or s.queue_depth >= 50)) end)
      union all
      -- 4. 50 GB is under two of the brief's largest sessions, so a machine
      -- below it cannot take another card.
      select 4, 'upload_devices_low_disk', 1, (
        select case when not exists (select 1 from upload_device_status) then null else (
          select count(*)::int from upload_device_status
           where disk_free_bytes < 50000000000) end)
      union all
      -- 5. A card import the operator's client marked failed. Three in a day at
      -- one counter is a reader or a card, not one bad card.
      select 5, 'card_import_failures', 3, (
        select count(*)::int from upload_batches
         where batch_status = 'failed'
           and import_started_at > now() - interval '24 hours')
      union all
      -- 6. Nothing records a failed cloud write. See the note above.
      select 6, 'cloud_write_failures', null, null
      union all
      -- 7. One episode whose bytes did not read back is already a copy known to
      -- be bad: it blocks review and blocks the cache gate, so it fires at one
      -- rather than at three. It clears itself when the upload is re-run and the
      -- read-back passes.
      select 7, 'checksum_failures', 1, (
        select count(*)::int from episodes where verification_state = 'failed')
      union all
      -- 8, 9. Nothing records these. See the note above.
      select 8, 'review_cannot_read_cloud', null, null
      union all
      select 9, 'cross_border_timeouts', null, null
    ) a
   order by a.ord`;

export async function readAlerts(db: Db): Promise<Alert[]> {
  return (await db.execute(ALERTS)) as unknown as Alert[];
}

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

export function registerAlerts(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
): void {
  /**
   * Read-only, and open to any operator session — a counter clerk noticing that
   * their own machine is out of disk is the point. Reviewers and collectors do
   * not reach it: the path is outside both of their scopes (`index.ts`).
   */
  app.get('/api/alerts', { preHandler: requireActor }, async () => ({
    at: new Date().toISOString(),
    alerts: await readAlerts(db),
  }));
}
