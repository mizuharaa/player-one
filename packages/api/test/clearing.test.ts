import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential } from '../src/index.ts';
import { closeDb, db, hasDb, truncate, useDatabase, violates } from '../../store/test/db.ts';
import { episodeRecord } from './fixtures.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('clearing');

/**
 * Clearing one episode out of a CHECKSUM-MISMATCH quarantine.
 *
 * Two deliveries of one session with different bytes: the first (A, 100 s)
 * and a redelivery (B, 60 s). The ingest spec keeps the episode out of review
 * until an operator names the real one, and the tests below follow that
 * decision all the way to the settlement row — the number a collector is
 * paid on has to come from the delivery the operator named, and never from
 * the other.
 */

const SECRET = 'k';
const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

const rows = async <R,>(q: ReturnType<typeof sql>): Promise<R[]> =>
  (await (await db()).execute(q)) as unknown as R[];

describe.skipIf(!hasDb())('clearing a mismatched delivery', () => {
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

    const card = async (who: Record<string, string>, collector: string, device: string, tf: string) => {
      const handover = uid();
      await send('POST', '/handovers', { id: handover, collector_id: collector, device_id: device, tf_card_id: tf, handover_time: new Date(T).toISOString() }, who);
      const batch = uid();
      await send('POST', '/upload-batches', { id: batch, handover_id: handover, import_started_at: new Date(T).toISOString() }, who);
      const res = await send('POST', `/handovers/${handover}/sessions`, {
        id: uid(), task_id: ids.task, scenario_id: ids.scenario,
        others_in_frame: false, sensitive_info_present: false, prepare_time: new Date(T - 60_000).toISOString(),
      }, who);
      expect(res.statusCode, res.body).toBeLessThan(300);
      return batch;
    };
    const batch = await card(headers, ids.collector, ids.device, 'CARD-1');
    const batch2 = await card(headers2, ids.collector2, ids.device2, 'CARD-2');

    /**
     * Delivery A, then the same session again with different bytes and a
     * different measured length. Returns both ingest ids.
     */
    const deliverTwice = async (b = batch, who = headers, serial = 'AZER76400FE') => {
      const a = episodeRecord({ measured: 100, serial });
      const first = await send('POST', `/upload-batches/${b}/episodes`, { episodes: [a] }, who);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().episodes[0].outcome).toBe('new');
      expect(first.json().episodes[0].resolution_state).toBe('resolved');
      const ingestA = await latestOf(a.episode_id);

      const bRecord = { ...episodeRecord({ basename: a.source.path, measured: 60, serial }), content_fingerprint: 'b'.repeat(64) };
      const second = await send('POST', `/upload-batches/${b}/episodes`, { episodes: [bRecord] }, who);
      expect(second.json().episodes[0].outcome).toBe('mismatch');
      const ingestB = await latestOf(a.episode_id);
      expect(ingestB).not.toBe(ingestA);
      return { episodeId: a.episode_id, ingestA, ingestB };
    };

    const clear = (episodeId: string, body: unknown, who = headers) =>
      send('POST', `/episodes/${episodeId}/clear`, body, who);

    return { d, ids, headers, headers2, reviewer, send, batch, batch2, deliverTwice, clear };
  }

  const latestOf = async (episodeId: string) =>
    (await rows<{ latest: string }>(sql`select latest_ingest_id as latest from episodes where episode_id = ${episodeId}`))[0]!.latest;

  const ingestSnapshot = (ingestId: string) =>
    rows(sql`
      select i.state, i.content_fingerprint, i.measured_duration_s,
             (select count(*)::int from episode_defects d where d.ingest_id = i.ingest_id) as defects,
             (select count(*)::int from episode_files f where f.ingest_id = i.ingest_id) as files
        from episode_ingests i where i.ingest_id = ${ingestId}`);

  const goodVerdict = (h: Awaited<ReturnType<typeof harness>>, episodeId: string, who = h.headers) =>
    h.send('POST', '/api/review/verdict', {
      episode_id: episodeId, verdict_id: uid(), decision: 'good', spans: [], reject_reasons: [],
    }, who);

  // -- the schema -----------------------------------------------------------

  it('a clear must name a delivery of its own episode, and say why', async () => {
    const h = await harness();
    const mine = await h.deliverTwice();
    const theirs = await h.deliverTwice(h.batch2, h.headers2, 'BZER76400FF');

    // Another episode's delivery: the composite FK refuses it, not this file.
    await violates('episode_clearings_delivery_fk', h.d.execute(sql`
      insert into episode_clearings (id, episode_id, ingest_id, prior_latest_ingest_id, from_state, cleared_by, reason)
      values (${uid()}, ${mine.episodeId}, ${theirs.ingestA}, ${mine.ingestB}, 'flagged', ${h.ids.operator}, 'wrong episode')`));
    await violates('episode_clearings_reason_check', h.d.execute(sql`
      insert into episode_clearings (id, episode_id, ingest_id, prior_latest_ingest_id, from_state, cleared_by, reason)
      values (${uid()}, ${mine.episodeId}, ${mine.ingestA}, ${mine.ingestB}, 'flagged', ${h.ids.operator}, '   ')`));
    await violates('episode_clearings_from_state_check', h.d.execute(sql`
      insert into episode_clearings (id, episode_id, ingest_id, prior_latest_ingest_id, from_state, cleared_by, reason)
      values (${uid()}, ${mine.episodeId}, ${mine.ingestA}, ${mine.ingestB}, 'cleared', ${h.ids.operator}, 'x')`));
  });

  it('a clearing is append-only: no update, no delete', async () => {
    const h = await harness();
    const { episodeId, ingestA } = await h.deliverTwice();
    const ok = await h.clear(episodeId, { ingest_id: ingestA, reason: 'first delivery matches the card' });
    expect(ok.statusCode, ok.body).toBe(200);
    const id = ok.json().clearing_id as string;
    await violates('episode_clearings_append_only', h.d.execute(sql`update episode_clearings set reason = 'edited' where id = ${id}`));
    await violates('episode_clearings_append_only', h.d.execute(sql`delete from episode_clearings where id = ${id}`));
  });

  // -- the refusals ---------------------------------------------------------

  it('refuses what it should, by name', async () => {
    const h = await harness();
    const { episodeId, ingestA, ingestB } = await h.deliverTwice();
    const theirs = await h.deliverTwice(h.batch2, h.headers2, 'BZER76400FF');

    expect((await h.clear(uid(), { ingest_id: ingestA, reason: 'x' })).statusCode).toBe(404);
    // Another centre's episode reads as unknown, not as refused.
    expect((await h.clear(theirs.episodeId, { ingest_id: theirs.ingestA, reason: 'x' })).statusCode).toBe(404);
    expect((await h.clear(episodeId, { ingest_id: ingestA })).statusCode).toBe(400);
    expect((await h.clear(episodeId, { ingest_id: ingestA, reason: '  ' })).statusCode).toBe(400);
    expect((await h.clear(episodeId, { ingest_id: 'not-a-uuid', reason: 'x' })).statusCode).toBe(400);

    const foreign = await h.clear(episodeId, { ingest_id: theirs.ingestB, reason: 'x' });
    expect(foreign.statusCode).toBe(409);
    expect(foreign.json().constraint).toBe('episode_clearing_foreign_delivery');

    // A reviewer session never reaches the counter's routes.
    expect((await h.clear(episodeId, { ingest_id: ingestA, reason: 'x' }, h.reviewer)).statusCode).toBe(403);

    // Nothing was written by any of the above.
    expect((await rows(sql`select 1 from episode_clearings`)).length).toBe(0);
    expect((await rows(sql`select 1 from audit_events where action = 'episode.clear'`)).length).toBe(0);
    expect(await latestOf(episodeId)).toBe(ingestB);
  });

  it('refuses an episode whose latest delivery carries no mismatch', async () => {
    const h = await harness();
    const a = episodeRecord({ measured: 100 });
    await h.send('POST', `/upload-batches/${h.batch}/episodes`, { episodes: [a] });
    const latest = await latestOf(a.episode_id);
    const res = await h.clear(a.episode_id, { ingest_id: latest, reason: 'nothing wrong with it' });
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('episode_clearing_nothing_to_clear');
  });

  it('refuses to move away from a delivery that has already been paid', async () => {
    const h = await harness();
    const a = episodeRecord({ measured: 100 });
    await h.send('POST', `/upload-batches/${h.batch}/episodes`, { episodes: [a] });
    const ingestA = await latestOf(a.episode_id);
    expect((await h.send('POST', '/api/review/claim')).statusCode).toBe(200);
    expect((await goodVerdict(h, a.episode_id)).statusCode).toBe(200);

    const redelivered = { ...episodeRecord({ basename: a.source.path, measured: 60 }), content_fingerprint: 'b'.repeat(64) };
    await h.send('POST', `/upload-batches/${h.batch}/episodes`, { episodes: [redelivered] });
    const ingestB = await latestOf(a.episode_id);

    const res = await h.clear(a.episode_id, { ingest_id: ingestB, reason: 'the redelivery is the real one' });
    expect(res.statusCode).toBe(409);
    expect(res.json().constraint).toBe('episode_clearing_paid_on_other_delivery');
    // Naming the paid delivery again is allowed: it moves latest back and pays nothing new.
    const back = await h.clear(a.episode_id, { ingest_id: ingestA, reason: 'the paid delivery stands' });
    expect(back.statusCode, back.body).toBe(200);
    expect(await latestOf(a.episode_id)).toBe(ingestA);
    expect((await rows(sql`select 1 from settlements`)).length).toBe(1);
  });

  // -- the money path, end to end -------------------------------------------

  it('pays on the redelivery when the clear names it, and refuses the first', async () => {
    const h = await harness();
    // The first delivery was claimed before the redelivery arrived.
    const a = episodeRecord({ measured: 100 });
    await h.send('POST', `/upload-batches/${h.batch}/episodes`, { episodes: [a] });
    const ingestA = await latestOf(a.episode_id);
    expect((await h.send('POST', '/api/review/claim')).statusCode).toBe(200);

    const redelivered = { ...episodeRecord({ basename: a.source.path, measured: 60 }), content_fingerprint: 'b'.repeat(64) };
    await h.send('POST', `/upload-batches/${h.batch}/episodes`, { episodes: [redelivered] });
    const ingestB = await latestOf(a.episode_id);
    const before = await ingestSnapshot(ingestA);

    // Out of the lane on both sides: the held review cannot be decided, and
    // there is nothing new to claim.
    const stale = await goodVerdict(h, a.episode_id);
    expect(stale.statusCode, stale.body).toBe(409);
    expect((await h.send('POST', '/api/review/claim')).statusCode).toBe(204);
    expect((await rows(sql`select 1 from settlements`)).length).toBe(0);

    const cleared = await h.clear(a.episode_id, { ingest_id: ingestB, reason: 'card re-read after a bad reader; second copy is complete' });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(await latestOf(a.episode_id)).toBe(ingestB);

    const claim = await h.send('POST', '/api/review/claim');
    expect(claim.statusCode, claim.body).toBe(200);
    expect(claim.json().ingest_id).toBe(ingestB);
    expect(claim.json().measured_duration_seconds).toBe('60.000000');
    expect((await goodVerdict(h, a.episode_id)).statusCode).toBe(200);

    const paid = await rows<{ ingest_id: string; effective_minutes: string; amount: string }>(sql`
      select r.ingest_id, s.effective_minutes, s.amount
        from settlements s join episode_reviews r on r.id = s.episode_review_id`);
    expect(paid).toEqual([{ ingest_id: ingestB, effective_minutes: '1.000000', amount: '1200.0000' }]);
    // The first delivery's review is still pending and still unpayable.
    const first = await rows<{ review_state: string }>(sql`select review_state from episode_reviews where ingest_id = ${ingestA}`);
    expect(first).toEqual([{ review_state: 'pending' }]);
    expect((await goodVerdict(h, a.episode_id)).statusCode).toBe(409);
    // And its record is byte-for-byte what it was (Rule 6).
    expect(await ingestSnapshot(ingestA)).toEqual(before);
    expect(before[0]).toMatchObject({ files: 0, defects: 0 });
  });

  it('pays on the first delivery when the clear names it, and the redelivery stays on record', async () => {
    const h = await harness();
    const { episodeId, ingestA, ingestB } = await h.deliverTwice();
    const before = await ingestSnapshot(ingestB);
    expect(before[0]).toMatchObject({ defects: 1, state: 'flagged' });

    const cleared = await h.clear(episodeId, { ingest_id: ingestA, reason: 'redelivery was a partial copy' });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(await latestOf(episodeId)).toBe(ingestA);

    const claim = await h.send('POST', '/api/review/claim');
    expect(claim.statusCode, claim.body).toBe(200);
    expect(claim.json().ingest_id).toBe(ingestA);
    expect((await goodVerdict(h, episodeId)).statusCode).toBe(200);
    const paid = await rows<{ ingest_id: string; effective_minutes: string; amount: string }>(sql`
      select r.ingest_id, s.effective_minutes, s.amount
        from settlements s join episode_reviews r on r.id = s.episode_review_id`);
    expect(paid).toEqual([{ ingest_id: ingestA, effective_minutes: '1.666667', amount: '2000.0004' }]);

    // The redelivery is untouched: its ingest row, its CHECKSUM-MISMATCH, its state.
    expect(await ingestSnapshot(ingestB)).toEqual(before);
    expect((await rows(sql`select 1 from episode_ingests where episode_id = ${episodeId}`)).length).toBe(2);

    // The clearing and the audit row say who, when, why and from what.
    const [k] = await rows<Record<string, unknown>>(sql`
      select ingest_id, prior_latest_ingest_id, from_state, cleared_by, reason from episode_clearings`);
    expect(k).toEqual({
      ingest_id: ingestA, prior_latest_ingest_id: ingestB, from_state: 'flagged',
      cleared_by: h.ids.operator, reason: 'redelivery was a partial copy',
    });
    const [audit] = await rows<{ reason: string; operator_id: string; before: Record<string, unknown>; after: Record<string, unknown> }>(sql`
      select reason, operator_id, before, after from audit_events where action = 'episode.clear'`);
    expect(audit!.reason).toBe('redelivery was a partial copy');
    expect(audit!.operator_id).toBe(h.ids.operator);
    expect(audit!.before).toEqual({ latest_ingest_id: ingestB, state: 'flagged' });
    expect(audit!.after['latest_ingest_id']).toBe(ingestA);
  });

  it('a second clear is a second row, and a third delivery blocks again', async () => {
    const h = await harness();
    const { episodeId, ingestA, ingestB } = await h.deliverTwice();
    expect((await h.clear(episodeId, { ingest_id: ingestB, reason: 'second copy' })).statusCode).toBe(200);
    expect((await h.clear(episodeId, { ingest_id: ingestA, reason: 'changed my mind: first copy' })).statusCode).toBe(200);
    expect(await latestOf(episodeId)).toBe(ingestA);
    expect((await rows(sql`select 1 from episode_clearings`)).length).toBe(2);

    // A third delivery with yet other bytes is a new conflict, cleared by nobody.
    const [src] = await rows<{ basename: string }>(sql`select source_basename as basename from episode_ingests where ingest_id = ${ingestA}`);
    const c = { ...episodeRecord({ basename: src!.basename, measured: 80 }), content_fingerprint: 'c'.repeat(64) };
    expect((await h.send('POST', `/upload-batches/${h.batch}/episodes`, { episodes: [c] })).json().episodes[0].outcome).toBe('mismatch');
    expect((await h.send('POST', '/api/review/claim')).statusCode).toBe(204);
  });
});
