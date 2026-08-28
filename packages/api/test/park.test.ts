import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential } from '../src/index.ts';
import { closeDb, db, hasDb, liveClaim, truncate, useDatabase, violates } from '../../store/test/db.ts';
import { episodeRecord } from './fixtures.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('park');

/**
 * Parking an episode out of the review queue, and taking it back out again.
 *
 * The dead end this answers: a review the queue can serve but no reviewer can
 * finish. The lease expires, the queue re-serves it, the next reviewer is
 * refused the same way, and the only exit anybody had was a bad verdict that
 * pays the collector nothing for footage nobody judged.
 *
 * Every transition is pinned twice: once through the routes, and once in raw
 * SQL with no application in the path, because the rules are in the schema.
 */

const SECRET = 'k';
const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

const rows = async <R,>(q: ReturnType<typeof sql>): Promise<R[]> =>
  (await (await db()).execute(q)) as unknown as R[];

describe.skipIf(!hasDb())('parking an episode out of the queue', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  /** Two centres, two collectors, two cards, one declared session each. */
  async function harness() {
    const d = await db();
    const ids = {
      centre: uid(), machine: uid(), operator: uid(), collector: uid(), device: uid(),
      centre2: uid(), machine2: uid(), operator2: uid(), collector2: uid(), device2: uid(),
      reviewer: uid(), deviceType: uid(), task: uid(), scenario: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values
      (${ids.centre}, 'HCM', 'c', 'active'), (${ids.centre2}, 'HN', 'c2', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values
      (${ids.machine}, ${ids.centre}, 'M1', 'active', ${hash}), (${ids.machine2}, ${ids.centre2}, 'M2', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
      (${ids.operator}, ${ids.centre}, 'op', 'centre_operator', ${hash}),
      (${ids.operator2}, ${ids.centre2}, 'op2', 'centre_operator', ${hash}),
      (${ids.reviewer}, null, 'pax-01', 'reviewer', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values
      (${ids.collector}, 'c1', 'qualified'), (${ids.collector2}, 'c2', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values
      (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active'), (${ids.device2}, ${ids.deviceType}, 'BZER76400FF', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 'housework', 1200, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
    const since = new Date(T - 30 * 24 * 60 * 60_000).toISOString();
    await d.execute(sql`insert into device_assignments (id, device_id, collector_id, valid_from) values
      (${uid()}, ${ids.device}, ${ids.collector}, ${since}), (${uid()}, ${ids.device2}, ${ids.collector2}, ${since})`);

    const app = buildApi({ db: d, tokenSecret: SECRET });
    await app.ready();
    const login = async (machine: string, ref: string) => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: ref, secret: 'pw' } });
      return { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
    };
    const headers: Record<string, string> = await login('M1', 'op');
    const headers2: Record<string, string> = await login('M2', 'op2');
    const session = await app.inject({ method: 'POST', url: '/api/session', payload: { external_ref: 'pax-01', operator_secret: 'pw' } });
    expect(session.statusCode, session.body).toBe(200);
    const cookie = [session.headers['set-cookie'] ?? []].flat().join(' | ');
    const reviewer: Record<string, string> = {
      authorization: `Bearer ${decodeURIComponent(/po_operator=([^;]+)/.exec(cookie)?.[1] ?? '')}`,
    };

    const send = async (method: 'POST' | 'GET', url: string, payload?: unknown, who = headers) =>
      (await app.inject({ method, url, payload: payload as never, headers: who })) as unknown as LightMyRequestResponse;

    /**
     * One card, and whether a session is declared against it. Without one every
     * episode on the card quarantines as `no_sessions`, which is the second of
     * the three dead ends this route is for.
     */
    const card = async (
      who: Record<string, string>,
      collector: string,
      device: string,
      tf: string,
      declare = true,
    ) => {
      const handover = uid();
      await send('POST', '/handovers', { id: handover, collector_id: collector, device_id: device, tf_card_id: tf, handover_time: new Date(T).toISOString() }, who);
      const batch = uid();
      await send('POST', '/upload-batches', { id: batch, handover_id: handover, import_started_at: new Date(T).toISOString() }, who);
      if (declare) {
        const res = await send('POST', `/handovers/${handover}/sessions`, {
          id: uid(), task_id: ids.task, scenario_id: ids.scenario,
          others_in_frame: false, sensitive_info_present: false, prepare_time: new Date(T - 60_000).toISOString(),
        }, who);
        expect(res.statusCode, res.body).toBeLessThan(300);
      }
      return batch;
    };
    // Since 0016_claim_join the counter refuses a session whose collector holds
    // no live claim on the task, so both collectors take the work first.
    await liveClaim(d, ids.task, ids.collector);
    await liveClaim(d, ids.task, ids.collector2);
    const batch = await card(headers, ids.collector, ids.device, 'CARD-1');
    const batch2 = await card(headers2, ids.collector2, ids.device2, 'CARD-2');

    /** One resolved episode on this centre's card. Returns its id. */
    const deliver = async (b = batch, who = headers, serial = 'AZER76400FE', measured = 100) => {
      const a = episodeRecord({ measured, serial });
      const res = await send('POST', `/upload-batches/${b}/episodes`, { episodes: [a] }, who);
      expect(res.statusCode, res.body).toBe(200);
      return { episodeId: a.episode_id, state: res.json().episodes[0].resolution_state as string };
    };

    /** Client-generated id, like every other counter mutation. */
    const park = (episodeId: string, body: Record<string, unknown> = {}, who = headers) =>
      send('POST', `/episodes/${episodeId}/park`, { id: uid(), reason: 'the card must come back', ...body }, who);
    const unpark = (episodeId: string, body: Record<string, unknown> = {}, who = headers) =>
      send('POST', `/episodes/${episodeId}/unpark`, { id: uid(), reason: 'parked in error', ...body }, who);

    return { d, ids, app, headers, headers2, reviewer, send, batch, batch2, card, deliver, park, unpark };
  }

  type H = Awaited<ReturnType<typeof harness>>;

  const parkedOf = async (episodeId: string) =>
    (await rows<{ p: string | null }>(sql`select parked_park_id as p from episodes where episode_id = ${episodeId}`))[0]!.p;

  const goodVerdict = (h: H, episodeId: string, who = h.headers) =>
    h.send('POST', '/api/review/verdict', {
      episode_id: episodeId, verdict_id: uid(), decision: 'good', spans: [], reject_reasons: [],
    }, who);

  /** A park row written straight into the table, bypassing the route. */
  const rawPark = (h: H, episodeId: string, over: Record<string, unknown> = {}) => {
    const v = { id: uid(), releases: null as string | null, from: 'resolved', reason: 'raw', ...over };
    return h.d.execute(sql`
      insert into episode_parks (id, episode_id, releases_park_id, from_state, parked_by, reason)
      values (${v.id}, ${episodeId}, ${v.releases}, ${v.from}, ${h.ids.operator}, ${v.reason})`);
  };

  // -- the schema -----------------------------------------------------------

  it('a park row must say why, from a state the episode is actually in', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();

    await violates('episode_parks_reason_check', rawPark(h, episodeId, { reason: '   ' }));
    // Any state that is not the one the episode carries: the row would be
    // evidence of a state the episode was never in. A nonsense spelling and a
    // legal-but-wrong one are refused by the same rule, which is why there is
    // no separate CHECK listing the spellings.
    await violates('episode_parks_from_state', rawPark(h, episodeId, { from: 'parked' }));
    await violates('episode_parks_from_state', rawPark(h, episodeId, { from: 'quarantined' }));
    expect(await parkedOf(episodeId)).toBe(null);
  });

  it('a park is append-only: no update, no delete', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();
    const ok = await h.park(episodeId);
    expect(ok.statusCode, ok.body).toBe(200);
    const id = ok.json().park_id as string;

    await violates('episode_parks_append_only', h.d.execute(sql`update episode_parks set reason = 'edited' where id = ${id}`));
    await violates('episode_parks_append_only', h.d.execute(sql`delete from episode_parks where id = ${id}`));
  });

  it('one open park at a time, and a release only of the park that is open', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();
    const theirs = await h.deliver(h.batch2, h.headers2, 'BZER76400FF');

    /**
     * Nothing is parked yet, so there is nothing to release — and the park
     * named belongs to another episode besides. `episode_parks_release_fk`
     * would refuse the second half on its own, but a BEFORE trigger runs
     * before constraints are checked, so the trigger is what answers.
     */
    const orphan = uid();
    await rawPark(h, theirs.episodeId, { id: orphan });
    await violates('episode_parks_not_parked', rawPark(h, episodeId, { releases: orphan }));

    const parked = (await h.park(episodeId)).json().park_id as string;
    await violates('episode_parks_already_parked', rawPark(h, episodeId));
    // A second release of the same park: the pointer no longer names it.
    const released = (await h.unpark(episodeId)).json().release_id as string;
    await violates('episode_parks_not_parked', rawPark(h, episodeId, { releases: parked }));
    // And a release cannot release a release.
    const again = (await h.park(episodeId)).json().park_id as string;
    await violates('episode_parks_release_target', rawPark(h, episodeId, { releases: released }));
    expect(await parkedOf(episodeId)).toBe(again);
  });

  it('the pointer cannot skip a release, and cannot name a spent park', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();
    const first = (await h.park(episodeId)).json().park_id as string;
    await h.unpark(episodeId);
    const second = (await h.park(episodeId)).json().park_id as string;

    // Parked by `second`; moving straight to another park skips the release row
    // that is the whole record of the first one ending.
    await violates('episodes_park_pointer_check', h.d.execute(
      sql`update episodes set parked_park_id = ${first} where episode_id = ${episodeId}`,
    ));
    await h.unpark(episodeId);
    // And a park that has already been released cannot be pointed at again.
    await violates('episodes_park_pointer_check', h.d.execute(
      sql`update episodes set parked_park_id = ${second} where episode_id = ${episodeId}`,
    ));
    expect(await parkedOf(episodeId)).toBe(null);
  });

  // -- the money ------------------------------------------------------------

  it('a parked episode cannot be paid, and a paid episode cannot be parked', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();
    expect((await h.send('POST', '/api/review/claim')).statusCode).toBe(200);
    const review = (await rows<{ id: string }>(sql`select id from episode_reviews where episode_id = ${episodeId}`))[0]!;

    // Parked: the settlement the verdict would write is refused at the database,
    // with no route and no eligibility filter in the path.
    expect((await h.park(episodeId)).statusCode).toBe(200);
    await violates('settlements_episode_parked', h.d.execute(sql`
      insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes, amount, settlement_state)
      select ${uid()}, ${review.id}, s.task_id, s.task_claim_id, '1200.0000', '1.000000', '1200.0000', 'pending_settlement'
        from episodes e join collection_sessions s on s.id = e.collection_session_id
       where e.episode_id = ${episodeId}`));
    expect((await rows(sql`select 1 from settlements`)).length).toBe(0);

    // Released and reviewed, the money is ordinary. Then the park is refused:
    // scored money is parked as money (the settlement exception, 0016).
    // The reviewer still holds the lease they took before the park, so they
    // finish the review they started rather than claiming it again.
    expect((await h.unpark(episodeId)).statusCode).toBe(200);
    expect((await goodVerdict(h, episodeId)).statusCode, 'verdict after release').toBe(200);
    expect((await rows(sql`select 1 from settlements`)).length).toBe(1);

    const late = await h.park(episodeId);
    expect(late.statusCode).toBe(409);
    expect(late.json().constraint).toBe('episode_parks_settled');
    await violates('episode_parks_settled', rawPark(h, episodeId));
    expect(await parkedOf(episodeId)).toBe(null);
  });

  // -- the queue ------------------------------------------------------------

  it('a parked episode leaves every queue and stops being served', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();

    // It is there before, and the reviewer holding it is mid-review.
    expect((await h.send('GET', '/api/review/next')).statusCode).toBe(200);
    const claim = await h.send('POST', '/api/review/claim');
    expect(claim.statusCode, claim.body).toBe(200);
    expect(claim.json().queue_depth).toBe(0);

    expect((await h.park(episodeId)).statusCode).toBe(200);

    // Gone from the peek, gone from the claim, and the reviewer still holding a
    // live lease is told so rather than paying for footage nobody judged.
    expect((await h.send('GET', '/api/review/next')).statusCode).toBe(204);
    const verdict = await goodVerdict(h, episodeId);
    expect(verdict.statusCode).toBe(409);
    expect(verdict.json().error).toBe('not reviewable');
    expect((await rows(sql`select 1 from settlements`)).length).toBe(0);
    // The review row is untouched: parking is not a verdict.
    const [review] = await rows<{ state: string }>(sql`select review_state as state from episode_reviews where episode_id = ${episodeId}`);
    expect(review!.state).toBe('pending');

    // The lease runs out and it is still not re-served — the dead end closed.
    await h.d.execute(sql`update episode_reviews set lease_expires_at = now() - interval '1 hour' where episode_id = ${episodeId}`);
    expect((await h.send('POST', '/api/review/claim')).statusCode).toBe(204);

    // Released, it comes back exactly as it was and is paid in full.
    expect((await h.unpark(episodeId)).statusCode).toBe(200);
    const again = await h.send('POST', '/api/review/claim');
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().episode_id).toBe(episodeId);
    expect((await goodVerdict(h, episodeId)).statusCode).toBe(200);
    // 100 s at 1200/minute, through the one rounding site in money.ts.
    const [paid] = await rows<{ minutes: string }>(sql`select effective_minutes as minutes from settlements`);
    expect(paid!.minutes).toBe('1.666667');
  });

  it('a parked episode stops blocking the batch it arrived on', async () => {
    const h = await harness();
    // No session declared against this card, so the episode quarantines with no
    // owner: the ingest-side dead end, with no redelivery to wait for.
    const batch = await h.card(h.headers, h.ids.collector, h.ids.device, 'CARD-3', false);
    const a = episodeRecord({ measured: 100 });
    await h.send('POST', `/upload-batches/${batch}/episodes`, { episodes: [a] });
    const before = await h.send('GET', `/upload-batches/${batch}/exceptions`);
    expect(before.json().summary.quarantined).toBe(1);
    expect(before.json().blocking.length).toBe(1);

    const parked = await h.park(a.episode_id, { reason: 'no session was ever declared for this card' });
    expect(parked.statusCode, parked.body).toBe(200);
    // The park recorded the state it was made from, which here is not 'resolved'.
    const [row] = await rows<{ from_state: string }>(sql`select from_state from episode_parks where id = ${parked.json().park_id}`);
    expect(row!.from_state).toBe('quarantined');

    const after = await h.send('GET', `/upload-batches/${batch}/exceptions`);
    expect(after.json().blocking.length).toBe(0);
    expect(after.json().summary.parked).toBe(1);
    expect(after.json().summary.quarantined).toBe(0);
  });

  // -- the routes -----------------------------------------------------------

  it('refuses what it should, by name, and a reviewer cannot park at all', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();
    const theirs = await h.deliver(h.batch2, h.headers2, 'BZER76400FF');

    expect((await h.park(uid())).statusCode).toBe(404);
    // Another centre's episode reads as unknown, not as refused.
    expect((await h.park(theirs.episodeId)).statusCode).toBe(404);
    expect((await h.send('POST', `/episodes/${episodeId}/park`, { reason: 'x' })).statusCode).toBe(400);
    expect((await h.park(episodeId, { reason: '   ' })).statusCode).toBe(400);
    expect((await h.park(episodeId, { id: 'not-a-uuid' })).statusCode).toBe(400);
    // A reviewer session never reaches the counter's routes (PLT-10 scope).
    expect((await h.park(episodeId, {}, h.reviewer)).statusCode).toBe(403);
    expect((await h.unpark(episodeId, {}, h.reviewer)).statusCode).toBe(403);

    // Nothing above wrote anything.
    expect((await rows(sql`select 1 from episode_parks`)).length).toBe(0);
    expect((await rows(sql`select 1 from audit_events where action in ('episode.park', 'episode.unpark')`)).length).toBe(0);

    const nothing = await h.unpark(episodeId);
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json().constraint).toBe('episode_parks_not_parked');

    expect((await h.park(episodeId)).statusCode).toBe(200);
    const twice = await h.park(episodeId);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().constraint).toBe('episode_parks_already_parked');
  });

  it('a replay under the same id lands once and answers the same', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();

    const body = { id: uid(), reason: 'the card must come back' };
    const first = await h.park(episodeId, body);
    expect(first.statusCode, first.body).toBe(200);
    const second = await h.park(episodeId, body);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().park_id).toBe(first.json().park_id);
    expect(second.json().replayed).toBe(true);
    expect((await rows(sql`select 1 from episode_parks`)).length).toBe(1);
    expect((await rows(sql`select 1 from audit_events where action = 'episode.park'`)).length).toBe(1);

    // The same id carrying a different decision is a reused id, not a replay.
    const reused = await h.park(episodeId, { id: body.id, reason: 'something else entirely' });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().constraint).toBe('episode_park_id_reused');

    const back = { id: uid(), reason: 'parked in error' };
    expect((await h.unpark(episodeId, back)).statusCode).toBe(200);
    const backAgain = await h.unpark(episodeId, back);
    expect(backAgain.statusCode, backAgain.body).toBe(200);
    expect(backAgain.json().replayed).toBe(true);
    expect((await rows(sql`select 1 from episode_parks`)).length).toBe(2);
  });

  it('a second park is a new row, and the audit trail says who, when and why', async () => {
    const h = await harness();
    const { episodeId } = await h.deliver();

    await h.park(episodeId, { reason: 'first park' });
    await h.unpark(episodeId, { reason: 'lifted' });
    await h.park(episodeId, { reason: 'second park' });

    const parks = await rows<{ reason: string; releases: string | null; by: string }>(sql`
      select reason, releases_park_id as releases, parked_by as by
        from episode_parks where episode_id = ${episodeId} order by parked_at, reason`);
    expect(parks.map((p) => p.reason)).toEqual(['first park', 'lifted', 'second park']);
    expect(parks.map((p) => p.releases === null)).toEqual([true, false, true]);
    expect(new Set(parks.map((p) => p.by))).toEqual(new Set([h.ids.operator]));

    const events = await rows<{ action: string; reason: string }>(sql`
      select action, reason from audit_events
       where target_id = ${episodeId} and action in ('episode.park', 'episode.unpark')
       order by occurred_at, reason`);
    expect(events.map((e) => e.action)).toEqual(['episode.park', 'episode.unpark', 'episode.park']);
    expect(events.map((e) => e.reason)).toEqual(['first park', 'lifted', 'second park']);
  });
});
