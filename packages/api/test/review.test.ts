import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EpisodeRecord } from '@playerone/contracts';
import { open, type Db } from '@playerone/store';
import { buildApi, hashCredential } from '../src/index.ts';
import { DB_URL, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
import { episodeRecord } from './fixtures.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('review');

/**
 * The review lane over HTTP.
 *
 * This is the only place in the system that produces the number a collector is
 * paid on, so the tests here are about money and about the ways two people or
 * two requests can collide over the same episode — not about whether the routes
 * return 200.
 */

const SECRET = 'k';
const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

const SERIAL_2 = 'BZER76400FF';

const record = episodeRecord;

describe.skipIf(!hasDb())('the review lane', () => {
  beforeEach(truncate);

  const extraConnections: Db[] = [];
  afterAll(async () => {
    for (const d of extraConnections) await d.close();
    await closeDb();
  });

  /**
   * A card, a declared task, and however many episodes resolved against it.
   *
   * `unitPrice` is 1200 per minute so the arithmetic in the assertions is
   * legible: 60 seconds is exactly 1200.
   */
  async function harness(
    options: {
      episodes?: EpisodeRecord[];
      /**
       * Episodes on a *second* centre, a second collector and a second card,
       * whose session declares others in frame — QR-07's own input.
       *
       * A second of everything on purpose. The resolver's payment bug survived
       * every test in the suite because every fixture used one handover, which
       * is exactly the shape that hides a query scoped to the wrong parent; a
       * privacy queue filtered by the wrong join would hide the same way.
       */
      privacy?: EpisodeRecord[];
      mediaRoot?: string;
    } = {},
  ) {
    const d = await db();
    const ids = {
      centre: uid(),
      machine: uid(),
      operator: uid(),
      operator2: uid(),
      collector: uid(),
      deviceType: uid(),
      device: uid(),
      task: uid(),
      scenario: uid(),
      centre2: uid(),
      machine2: uid(),
      operator3: uid(),
      collector2: uid(),
      device2: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centre}, 'HCM', 'c', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values (${ids.machine}, ${ids.centre}, 'M1', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.operator}, ${ids.centre}, 'op', 'centre_operator', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.operator2}, ${ids.centre}, 'op2', 'centre_operator', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 'housework', 1200, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
    /**
     * The device's allotted period, open, starting a month before T. The
     * resolver crosschecks each candidate session against who held the device
     * when the recording started (Daniel, 2026-08-25), so without this every
     * episode below would route to a human and the review lane would have
     * nothing to review.
     */
    await d.execute(sql`insert into device_assignments (id, device_id, collector_id, valid_from)
      values (${uid()}, ${ids.device}, ${ids.collector}, ${new Date(T - 30 * 24 * 60 * 60_000).toISOString()})`);

    const app = buildApi({ db: d, tokenSecret: SECRET, mediaRoot: options.mediaRoot });
    await app.ready();

    const login = async (ref: string, machine = 'M1') => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: ref, secret: 'pw' } });
      return {
        'x-machine-token': `Bearer ${m.json().token}`,
        authorization: `Bearer ${o.json().token}`,
      };
    };
    const headers: Record<string, string> = await login('op');
    const headers2: Record<string, string> = await login('op2');

    const send = async (
      method: 'POST' | 'GET',
      url: string,
      payload?: unknown,
      who: Record<string, string> = headers,
    ): Promise<LightMyRequestResponse> =>
      (await app.inject({
        method,
        url,
        payload: payload as never,
        headers: who,
      })) as unknown as LightMyRequestResponse;

    const handover = uid();
    await send('POST', '/handovers', {
      id: handover,
      collector_id: ids.collector,
      device_id: ids.device,
      tf_card_id: 'CARD-1',
      handover_time: new Date(T).toISOString(),
    });
    const batch = uid();
    await send('POST', '/upload-batches', {
      id: batch,
      handover_id: handover,
      import_started_at: new Date(T).toISOString(),
    });
    const session = uid();
    await send('POST', `/handovers/${handover}/sessions`, {
      id: session,
      task_id: ids.task,
      scenario_id: ids.scenario,
      others_in_frame: false,
      sensitive_info_present: false,
      prepare_time: new Date(T - 60_000).toISOString(),
    });

    const episodes = options.episodes ?? [record({})];
    const submitted = await send('POST', `/upload-batches/${batch}/episodes`, { episodes });
    expect(submitted.statusCode, submitted.body).toBe(200);
    for (const e of submitted.json().episodes as { resolution_state: string }[]) {
      expect(e.resolution_state).toBe('resolved');
    }
    const episodeIds = (submitted.json().episodes as { episode_id: string }[]).map(
      (e) => e.episode_id,
    );

    /** A second centre, collector, card and session — this one declaring others in frame. */
    let privacyIds: string[] = [];
    if (options.privacy !== undefined) {
      await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centre2}, 'HN', 'c2', 'active')`);
      await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values (${ids.machine2}, ${ids.centre2}, 'M2', 'active', ${hash})`);
      await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.operator3}, ${ids.centre2}, 'op3', 'centre_operator', ${hash})`);
      await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector2}, 'c2', 'qualified')`);
      await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device2}, ${ids.deviceType}, ${SERIAL_2}, 'active')`);

      const headers3: Record<string, string> = await login('op3', 'M2');
      const handover2 = uid();
      await send('POST', '/handovers', {
        id: handover2,
        collector_id: ids.collector2,
        device_id: ids.device2,
        tf_card_id: 'CARD-2',
        handover_time: new Date(T).toISOString(),
      }, headers3);
      const batch2 = uid();
      await send('POST', '/upload-batches', {
        id: batch2,
        handover_id: handover2,
        import_started_at: new Date(T).toISOString(),
      }, headers3);
      await send('POST', `/handovers/${handover2}/sessions`, {
        id: uid(),
        task_id: ids.task,
        scenario_id: ids.scenario,
        /** APP-17b. This one boolean is the whole of QR-07's input. */
        others_in_frame: true,
        sensitive_info_present: false,
        prepare_time: new Date(T - 60_000).toISOString(),
      }, headers3);
      const flagged = await send('POST', `/upload-batches/${batch2}/episodes`, {
        episodes: options.privacy,
      }, headers3);
      expect(flagged.statusCode, flagged.body).toBe(200);
      for (const e of flagged.json().episodes as { resolution_state: string }[]) {
        expect(e.resolution_state).toBe('resolved');
      }
      privacyIds = (flagged.json().episodes as { episode_id: string }[]).map((e) => e.episode_id);
    }

    return { d, app, ids, headers, headers2, send, handover, batch, session, episodeIds, privacyIds };
  }

  const claim = async (h: Awaited<ReturnType<typeof harness>>, who?: Record<string, string>) =>
    h.send('POST', '/api/review/claim', undefined, who);

  const verdict = async (
    h: Awaited<ReturnType<typeof harness>>,
    body: Record<string, unknown>,
    who?: Record<string, string>,
  ) => h.send('POST', '/api/review/verdict', body, who);

  // -------------------------------------------------------------------------

  describe('the queue', () => {
    it('hands out an episode with everything the screen needs to judge it', async () => {
      const h = await harness({ episodes: [record({ measured: 132.961, declared: 178 })] });
      const res = await claim(h);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();

      expect(body.review_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.measured_duration_seconds).toBe('132.961000');
      // Advisory, and shown beside the measured value rather than instead of it.
      expect(body.claimed_duration_seconds).toBe('178.000000');
      expect(body.task.price_per_minute).toBe('1200.0000');
      expect(body.collector.display_name).toBe('c1');
      expect(body.media.parts).toHaveLength(1);
      expect(body.media.parts[0].url).toBe(`/media/episode/${body.episode_id}/part/0`);
      expect(body.lease_expires_at).not.toBeNull();
      expect(body.queue_depth).toBe(0);
    });

    it('answers 204 when there is nothing to review', async () => {
      const h = await harness();
      expect((await claim(h)).statusCode).toBe(200);
      expect((await claim(h)).statusCode).toBe(204);
    });

    it('never hands the same episode to two reviewers claiming at once', async () => {
      // Acceptance 1. Two connections, not two requests on one: `for update
      // skip locked` has nothing to skip when both claims queue behind the same
      // connection, so a single-connection test would pass without proving
      // anything about concurrency.
      const h = await harness({ episodes: [record({}), record({}), record({}), record({})] });
      const url = new URL(DB_URL);
      url.pathname = `/${new URL(DB_URL).pathname.replace(/^\//, '') || 'postgres'}_review`;
      const second = await open(url.toString(), { max: 4 });
      extraConnections.push(second);
      const other = buildApi({ db: second, tokenSecret: SECRET });
      await other.ready();

      const claimOn = (app: FastifyInstance, who: Record<string, string>) =>
        app.inject({ method: 'POST', url: '/api/review/claim', headers: who });

      const results = await Promise.all([
        claimOn(h.app, h.headers),
        claimOn(other, h.headers2),
        claimOn(h.app, h.headers),
        claimOn(other, h.headers2),
      ]);
      const claimed = results.filter((r) => r.statusCode === 200).map((r) => r.json().episode_id);
      expect(claimed).toHaveLength(4);
      expect(new Set(claimed).size).toBe(4);
    });

    it('reclaims a lease that has run out, without a sweeper', async () => {
      const h = await harness();
      const first = await claim(h);
      const episodeId = first.json().episode_id;
      expect((await claim(h, h.headers2)).statusCode).toBe(204);

      await h.d.execute(sql`update episode_reviews set lease_expires_at = now() - interval '1 minute'`);

      const second = await claim(h, h.headers2);
      expect(second.statusCode).toBe(200);
      expect(second.json().episode_id).toBe(episodeId);
    });

    it('extends a lease by heartbeat, and refuses one that is gone', async () => {
      const h = await harness();
      const episodeId = (await claim(h)).json().episode_id;

      const beat = await h.send('POST', `/api/review/heartbeat/${episodeId}`);
      expect(beat.statusCode).toBe(200);

      // Somebody else's episode is not somebody else's to extend.
      expect((await h.send('POST', `/api/review/heartbeat/${episodeId}`, undefined, h.headers2)).statusCode).toBe(409);
    });

    it('puts a released episode back at the head of the queue', async () => {
      const h = await harness();
      const episodeId = (await claim(h)).json().episode_id;
      expect((await h.send('POST', `/api/review/release/${episodeId}`)).json().released).toBe(true);
      const again = await claim(h, h.headers2);
      expect(again.json().episode_id).toBe(episodeId);
    });

    it('peeks at the next episode without taking it', async () => {
      const h = await harness({ episodes: [record({}), record({})] });
      await claim(h);
      const peek = await h.send('GET', '/api/review/next');
      expect(peek.statusCode).toBe(200);
      // Peeking twice returns the same one, because peeking claims nothing.
      expect((await h.send('GET', '/api/review/next')).json().episode_id).toBe(peek.json().episode_id);
    });

    /**
     * An episode with no session has no collector and no task, so there is
     * nobody to pay and no price to pay them at. It belongs in the counter's
     * quarantine queue, not in front of a reviewer.
     */
    it('does not offer a quarantined episode', async () => {
      const h = await harness();
      await h.d.execute(sql`
        update episodes set resolution_state = 'quarantined', collection_session_id = null,
                            resolution_method = null`);
      expect((await claim(h)).statusCode).toBe(204);
    });
  });

  // -------------------------------------------------------------------------

  /**
   * QR-05, QR-06, QR-07, PRV-04, BO-15.
   *
   * The queue is a pool by default and the pool is what has to be wrong safely:
   * an episode in the wrong lane is footage a reviewer with no privacy clearance
   * watches, and there is no way to un-watch it. So the first two tests are
   * about absence — the flagged episode is not merely ranked lower, it is not
   * in the answer at all.
   */
  describe('the lanes', () => {
    const claimIn = (
      h: Awaited<ReturnType<typeof harness>>,
      lane: string,
      who?: Record<string, string>,
    ) => h.send('POST', `/api/review/claim?queue=${lane}`, undefined, who);

    it('never offers a privacy-declared episode to the normal queue', async () => {
      const h = await harness({
        episodes: [record({ basename: 'ego_AZER76400FE_20260813_100000' })],
        privacy: [record({ basename: `ego_${SERIAL_2}_20260813_100100`, serial: SERIAL_2 })],
      });
      const [ordinary] = h.episodeIds;
      const [flagged] = h.privacyIds;

      // The peek: one episode waiting, and it is not the flagged one.
      expect((await h.send('GET', '/api/review/next')).json().episode_id).toBe(ordinary);

      // The claim: the normal lane empties after the one episode it may see.
      expect((await claim(h)).json().episode_id).toBe(ordinary);
      expect((await claim(h, h.headers2)).statusCode).toBe(204);
      expect((await h.send('GET', '/api/review/next', undefined, h.headers2)).statusCode).toBe(204);

      // And the depth agrees with what the queue will actually hand out.
      expect((await h.send('GET', '/api/review/shift', undefined, h.headers2)).json().queue_depth).toBe(0);

      // It is not lost — it is in the lane that had to ask for it by name.
      const privacy = await claimIn(h, 'privacy', h.headers2);
      expect(privacy.statusCode, privacy.body).toBe(200);
      expect(privacy.json().episode_id).toBe(flagged);
      expect(privacy.json().queue).toBe('privacy');
      expect(privacy.json().declared.others_in_frame).toBe(true);
    });

    it('hands out the higher priority first, whatever order the footage arrived in', async () => {
      const h = await harness({
        episodes: [
          record({ basename: 'ego_AZER76400FE_20260813_110000' }),
          record({ basename: 'ego_AZER76400FE_20260813_110100' }),
        ],
      });
      const [first, second] = h.episodeIds;
      // Two `new Date()` calls a transaction apart can land on the same
      // millisecond, and then "oldest first" has no answer. Pinned, so the
      // assertion below is about the ordering and not about the clock.
      await h.d.execute(sql`update episodes set first_seen_at = now() - interval '2 hours' where episode_id = ${first}`);
      await h.d.execute(sql`update episodes set first_seen_at = now() - interval '1 hour' where episode_id = ${second}`);

      // Untouched, the queue is oldest-first.
      expect((await h.send('GET', '/api/review/next')).json().episode_id).toBe(first);

      // Both rows exist, and the older one was materialised first — so
      // `created_at` alone would still put it in front. Priority is the only
      // difference between them.
      expect((await h.send('POST', `/api/review/route/${first}`, { priority: 1 })).statusCode).toBe(200);
      const routed = await h.send('POST', `/api/review/route/${second}`, { priority: 10 });
      expect(routed.statusCode, routed.body).toBe(200);
      expect(routed.json().priority).toBe(10);

      // The peek has to predict the claim: the client warms a video from it.
      expect((await h.send('GET', '/api/review/next')).json().episode_id).toBe(second);
      expect((await claim(h)).json().episode_id).toBe(second);
      expect((await claim(h, h.headers2)).json().episode_id).toBe(first);
    });

    it('offers an assigned episode to nobody but its assignee', async () => {
      const h = await harness({
        episodes: [
          record({ basename: 'ego_AZER76400FE_20260813_120000' }),
          record({ basename: 'ego_AZER76400FE_20260813_120100' }),
        ],
      });
      const [first, second] = h.episodeIds;
      expect(
        (await h.send('POST', `/api/review/route/${first}`, { assignee_ref: h.ids.operator2 }))
          .statusCode,
      ).toBe(200);

      // op is never offered it, by either route, and does not count it as work.
      expect((await h.send('GET', '/api/review/next')).json().episode_id).toBe(second);
      expect((await h.send('GET', '/api/review/shift')).json().queue_depth).toBe(1);
      expect((await claim(h)).json().episode_id).toBe(second);
      expect((await claim(h)).statusCode).toBe(204);

      // op2 is.
      expect((await claim(h, h.headers2)).json().episode_id).toBe(first);
    });

    it('moves an episode a reviewer flags mid-review into the privacy lane, and says why', async () => {
      const h = await harness({ episodes: [record({ basename: 'ego_AZER76400FE_20260813_130000' })] });
      const episodeId = (await claim(h)).json().episode_id;

      const flagged = await h.send('POST', `/api/review/route/${episodeId}`, {
        queue: 'privacy',
        reason: 'a bank card is legible at 00:41',
      });
      expect(flagged.statusCode, flagged.body).toBe(200);
      expect(flagged.json().queue).toBe('privacy');

      // Gone from the normal queue for everybody, including the reviewer who
      // flagged it — the lease goes with the move, because they are handing it on.
      expect((await claim(h)).statusCode).toBe(204);
      expect((await claim(h, h.headers2)).statusCode).toBe(204);
      expect((await claimIn(h, 'privacy', h.headers2)).json().episode_id).toBe(episodeId);

      // PRV-04 is a compliance action, so it is in the audit trail under the
      // taxonomy's own code and not as free text somebody has to interpret.
      const audit = (await h.d.execute(sql`
        select action, reason, before, after from audit_events
         where action = 'review.route' and operator_id = ${h.ids.operator}
      `)) as unknown as {
        action: string;
        reason: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown>;
      }[];
      expect(audit).toHaveLength(1);
      expect(audit[0]!.reason).toBe('a bank card is legible at 00:41');
      expect(audit[0]!.after['reason_code']).toBe('CO-PRIVACY');
      expect(audit[0]!.after['queue']).toBe('privacy');
      // Who lost the episode is part of a privacy handoff, not a detail: the
      // move is only reconstructable if the displaced leaseholder is named.
      expect((audit[0]!.before as Record<string, unknown>)['reviewer_ref']).toBe(h.ids.operator);
      expect(audit[0]!.after['reviewer_ref']).toBeNull();

      // And the collector's own declaration is untouched: a reviewer's judgement
      // is a different fact from what was declared before recording.
      const declared = (await h.d.execute(sql`
        select others_in_frame, sensitive_info_present from collection_sessions
      `)) as unknown as { others_in_frame: boolean; sensitive_info_present: boolean }[];
      expect(declared[0]!.others_in_frame).toBe(false);
      expect(declared[0]!.sensitive_info_present).toBe(false);
    });

    it('refuses a lane it does not have, rather than quietly serving the normal one', async () => {
      const h = await harness({ episodes: [record({})] });
      // A misspelling that reads as success is the failure worth refusing: a
      // client asking for a privacy queue and being handed ordinary footage
      // cannot tell, and neither can the reviewer looking at it.
      const misspelt = await claimIn(h, 'privicy');
      expect(misspelt.statusCode, misspelt.body).toBe(400);
      expect((await h.send('GET', '/api/review/next?queue=nope')).statusCode).toBe(400);
      // And the episode is still there, untouched, in the lane it belongs to.
      expect((await claim(h)).statusCode).toBe(200);
    });

    it('hands a quarantined episode on, instead of back to the reviewer it was taken from', async () => {
      const h = await harness({ episodes: [record({ basename: 'ego_AZER76400FE_20260813_133000' })] });
      const [episodeId] = h.episodeIds;
      expect(
        (await h.send('POST', `/api/review/route/${episodeId}`, { assignee_ref: h.ids.operator2 }))
          .statusCode,
      ).toBe(200);

      const flagged = await h.send('POST', `/api/review/route/${episodeId}`, { queue: 'privacy' });
      expect(flagged.statusCode, flagged.body).toBe(200);
      // The assignment went with the lease. Keeping it would put the episode in
      // a lane for cleared reviewers and then offer it to exactly one person —
      // the one it was taken away from.
      expect(flagged.json().assignee_ref).toBeNull();
      expect((await claimIn(h, 'privacy')).json().episode_id).toBe(episodeId);
    });

    it('routes the delivery the queue is waiting on, not the one already decided', async () => {
      const delivered = record({ basename: 'ego_AZER76400FE_20260813_134500', measured: 60 });
      const h = await harness({ episodes: [delivered] });
      const [episodeId] = h.episodeIds;
      const decided = (await claim(h)).json();
      await verdict(h, { verdict_id: uid(), episode_id: decided.episode_id, decision: 'good' });

      // The card comes back and the same session arrives again with different
      // bytes. That is a second ingest and a second review row; the first stays
      // attached to what it judged, and the queue is now waiting on the second.
      const again = await h.send('POST', `/upload-batches/${h.batch}/episodes`, {
        episodes: [{ ...delivered, content_fingerprint: 'c'.repeat(64) }],
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().episodes[0].outcome).toBe('mismatch');
      // A redelivery with different bytes is CHECKSUM-MISMATCH, and the ingest
      // spec (§6) quarantines it: it does not enter the queue until somebody
      // clears it, and no clearing route exists yet. This test is about the
      // lane logic after that, so the block is lifted here, in the test, the
      // way the cloud leg's own redelivery test does.
      await h.d.execute(sql`update defect_codes set blocks_review = false where code = 'CHECKSUM-MISMATCH'`);

      const routed = await h.send('POST', `/api/review/route/${episodeId}`, { priority: 7 });
      expect(routed.statusCode, routed.body).toBe(200);
      expect(routed.json().priority).toBe(7);
      expect(routed.json().review_id).not.toBe(decided.review_id);

      const rows = (await h.d.execute(sql`
        select r.id, r.review_state, r.priority, r.ingest_id = e.latest_ingest_id as is_latest
          from episode_reviews r join episodes e on e.episode_id = r.episode_id
         order by r.created_at
      `)) as unknown as {
        id: string;
        review_state: string;
        priority: number;
        is_latest: boolean;
      }[];
      expect(rows).toHaveLength(2);
      expect(rows[0]!.review_state).toBe('pass');
      expect(rows[0]!.priority).toBe(0);
      expect(rows[1]!.is_latest).toBe(true);
      expect(rows[1]!.priority).toBe(7);

      // And the audit names the row that changed. `target_table` says
      // episode_reviews, so an episode id there is a pointer into nothing.
      const audit = (await h.d.execute(sql`
        select target_id, before from audit_events where action = 'review.route'
      `)) as unknown as { target_id: string; before: unknown }[];
      expect(audit).toHaveLength(1);
      expect(audit[0]!.target_id).toBe(routed.json().review_id);
      expect(audit[0]!.before).toBeNull();
    });

    it('will not move declared-privacy footage into the lane everybody sees', async () => {
      const h = await harness({
        episodes: [record({ basename: 'ego_AZER76400FE_20260813_135000' })],
        privacy: [record({ basename: `ego_${SERIAL_2}_20260813_135100`, serial: SERIAL_2 })],
      });
      const [flagged] = h.privacyIds;

      // The collector declared others in frame. That is a floor, not a default:
      // a reviewer's own PRV-04 flag sits above it and could be lifted, but
      // nobody overrules what was declared before the recording was made.
      const forced = await h.send('POST', `/api/review/route/${flagged}`, { queue: 'standard' });
      expect(forced.statusCode, forced.body).toBe(409);
      expect((await claim(h)).json().episode_id).not.toBe(flagged);

      // Priority still moves, and does not drag the lane with it.
      const prioritised = await h.send('POST', `/api/review/route/${flagged}`, { priority: 5 });
      expect(prioritised.statusCode, prioritised.body).toBe(200);
      expect(prioritised.json().queue).toBe('privacy');
    });

    it('moves a pending review into the privacy lane when the episode is re-resolved onto a declared session', async () => {
      const h = await harness({
        episodes: [record({ basename: 'ego_AZER76400FE_20260813_135500' })],
      });
      const [episodeId] = h.episodeIds;
      // Materialise the review in the ordinary lane, the way a reviewer would.
      expect((await claim(h)).json().episode_id).toBe(episodeId);

      // A second session on the same card, this one declaring sensitive
      // information, and an operator corrects the attribution.
      const corrected = uid();
      const made = await h.send('POST', `/handovers/${h.handover}/sessions`, {
        id: corrected,
        task_id: h.ids.task,
        scenario_id: h.ids.scenario,
        others_in_frame: false,
        sensitive_info_present: true,
        prepare_time: new Date(T - 30_000).toISOString(),
      });
      expect(made.statusCode, made.body).toBe(201);
      const moved = await h.send('POST', `/episodes/${episodeId}/resolve`, {
        collection_session_id: corrected,
        reason: 'the collector recorded against the later session',
      });
      expect(moved.statusCode, moved.body).toBe(200);

      // The lane is derived from the session, so re-pointing the episode has to
      // carry it. Otherwise the review sits in the ordinary queue describing
      // footage the collector declared.
      expect((await claim(h, h.headers2)).statusCode).toBe(204);
      const privacy = await h.send('POST', '/api/review/claim?queue=privacy', undefined, h.headers2);
      expect(privacy.statusCode, privacy.body).toBe(200);
      expect(privacy.json().episode_id).toBe(episodeId);
    });

    it('keeps a quarantine across a redelivery of the same session', async () => {
      const delivered = record({ basename: 'ego_AZER76400FE_20260813_140500', measured: 60 });
      const h = await harness({ episodes: [delivered] });
      const [episodeId] = h.episodeIds;
      expect((await claim(h)).json().episode_id).toBe(episodeId);
      const flagged = await h.send('POST', `/api/review/route/${episodeId}`, {
        queue: 'privacy',
        reason: 'a bank card is legible at 00:41',
      });
      expect(flagged.statusCode, flagged.body).toBe(200);

      // The card comes back and the same session arrives again. Different
      // bytes, a different ingest, and a review row that does not exist yet -
      // and the bank card in shot did not change with the bytes. The lane a new
      // row is born in has to remember the flag, or the redelivery puts the
      // footage back in front of everybody.
      const again = await h.send('POST', `/upload-batches/${h.batch}/episodes`, {
        episodes: [{ ...delivered, content_fingerprint: 'd'.repeat(64) }],
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().episodes[0].outcome).toBe('mismatch');
      // Quarantined by the spec's rule until cleared (see the test above); the
      // lane it is born in is what this test checks.
      await h.d.execute(sql`update defect_codes set blocks_review = false where code = 'CHECKSUM-MISMATCH'`);

      const ordinary = await h.send('GET', '/api/review/next', undefined, h.headers2);
      expect(ordinary.statusCode, ordinary.body).toBe(204);
      const privacy = await h.send('GET', '/api/review/next?queue=privacy', undefined, h.headers2);
      expect(privacy.statusCode, privacy.body).toBe(200);
      expect(privacy.json().episode_id).toBe(episodeId);
    });

    it('asks why before it lets a quarantine be lifted', async () => {
      const h = await harness({ episodes: [record({ basename: 'ego_AZER76400FE_20260813_141000' })] });
      const [episodeId] = h.episodeIds;
      expect(
        (await h.send('POST', `/api/review/route/${episodeId}`, {
          queue: 'privacy',
          reason: 'a bank card is legible at 00:41',
        })).statusCode,
      ).toBe(200);

      // Raising a flag needs no typed reason: the code is fixed and the
      // direction is safe. Lowering one puts footage in front of more people,
      // and the audit row for that has to say why in words.
      const bare = await h.send('POST', `/api/review/route/${episodeId}`, { queue: 'standard' });
      expect(bare.statusCode, bare.body).toBe(400);
      const lifted = await h.send('POST', `/api/review/route/${episodeId}`, {
        queue: 'standard',
        reason: 'the card is a loyalty card and carries no number',
      });
      expect(lifted.statusCode, lifted.body).toBe(200);
      expect(lifted.json().queue).toBe('standard');
    });

    it('refuses to re-queue a review that has already been decided', async () => {
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;
      await verdict(h, { verdict_id: uid(), episode_id: episodeId, decision: 'good' });
      const routed = await h.send('POST', `/api/review/route/${episodeId}`, { queue: 'privacy' });
      expect(routed.statusCode).toBe(409);
    });

    it('measures each reviewer against their own verdicts, and nobody else', async () => {
      const h = await harness({
        episodes: [
          record({ basename: 'ego_AZER76400FE_20260813_140000', measured: 60 }),
          record({ basename: 'ego_AZER76400FE_20260813_140100', measured: 60 }),
          record({ basename: 'ego_AZER76400FE_20260813_140200', measured: 60 }),
        ],
      });
      // op decides two, at 12 s and 24 s. op2 decides one, at 30 s. The elapsed
      // time is set by backdating the claim, because that is the only end of it
      // a test — or a reviewer — can reach: the verdict measures it server-side.
      const backdate = async (episodeId: string, seconds: number) =>
        h.d.execute(sql`
          update episode_reviews set claimed_at = now() - ${`${seconds} seconds`}::interval
           where episode_id = ${episodeId}
        `);
      for (const seconds of [12, 24]) {
        const episodeId = (await claim(h)).json().episode_id;
        await backdate(episodeId, seconds);
        await verdict(h, { verdict_id: uid(), episode_id: episodeId, decision: 'good' });
      }
      const theirs = (await claim(h, h.headers2)).json().episode_id;
      await backdate(theirs, 30);
      await verdict(
        h,
        { verdict_id: uid(), episode_id: theirs, decision: 'bad', reject_reasons: ['VQ-DARK'] },
        h.headers2,
      );

      const res = await h.send('GET', '/api/review/throughput');
      expect(res.statusCode, res.body).toBe(200);
      const rows = res.json().reviewers as Record<string, unknown>[];
      expect(rows).toHaveLength(2);

      const op = rows.find((r) => r['reviewer'] === h.ids.operator)!;
      expect(op['decided']).toBe(2);
      expect(op['approved']).toBe(2);
      // 3600 × 2 ÷ 36 s of measured review time. Loose to a tenth: the
      // stopwatch runs from a real claim to a real verdict, so the request
      // itself is in the number.
      expect(op['reviews_per_hour'] as number).toBeCloseTo(200, 0);
      expect(Number(op['median_seconds_to_verdict'])).toBeCloseTo(18, 1);

      const op2 = rows.find((r) => r['reviewer'] === h.ids.operator2)!;
      expect(op2['decided']).toBe(1);
      expect(op2['approved']).toBe(0);
      expect(op2['reviews_per_hour'] as number).toBeCloseTo(120, 0);

      // A window that starts after every verdict reports nobody, rather than
      // reporting yesterday's pace as today's.
      const later = await h.send(
        'GET',
        `/api/review/throughput?since=${new Date(Date.now() + 60_000).toISOString()}`,
      );
      expect(later.statusCode, later.body).toBe(200);
      expect(later.json().reviewers).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('the verdict', () => {
    it('pays the whole measured duration for a good verdict', async () => {
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;

      const res = await verdict(h, { verdict_id: uid(), episode_id: episodeId, decision: 'good' });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.review_state).toBe('pass');
      expect(body.effective_duration_seconds).toBe('60.000000');
      expect(body.effective_minutes).toBe('1.000000');
      expect(body.amount).toBe('1200.0000');
    });

    it('pays nothing for a rejection, and insists on a reason', async () => {
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;

      // QR-01, QR-04: a collector paid nothing has to be told why.
      const bare = await verdict(h, { verdict_id: uid(), episode_id: episodeId, decision: 'bad' });
      expect(bare.statusCode).toBe(422);

      const res = await verdict(h, {
        verdict_id: uid(),
        episode_id: episodeId,
        decision: 'bad',
        reject_reasons: ['VQ-DARK'],
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().effective_duration_seconds).toBe('0.000000');
      expect(res.json().amount).toBe('0.0000');

      const reasons = (await h.d.execute(sql`select code from episode_review_reasons`)) as unknown as { code: string }[];
      expect(reasons.map((r) => r.code)).toEqual(['VQ-DARK']);
    });

    it('stores overlapping marks as merged, non-overlapping spans', async () => {
      // Acceptance 6. Overlaps are allowed on the client because forbidding them
      // makes marking fiddly; the server is where they become disjoint, so the
      // same second is never paid for twice.
      const h = await harness({ episodes: [record({ measured: 100 })] });
      const episodeId = (await claim(h)).json().episode_id;

      const res = await verdict(h, {
        verdict_id: uid(),
        episode_id: episodeId,
        decision: 'partial',
        spans: [
          { start_seconds: 30, end_seconds: 40 },
          { start_seconds: 10, end_seconds: 25 },
          { start_seconds: 20, end_seconds: 35 },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().effective_duration_seconds).toBe('30.000000');

      const rows = (await h.d.execute(sql`
        select ordinal, start_s, end_s from episode_review_spans order by ordinal
      `)) as unknown as { ordinal: number; start_s: string; end_s: string }[];
      expect(rows).toEqual([{ ordinal: 0, start_s: '10.000000', end_s: '40.000000' }]);
    });

    it('clamps a span that runs past the payable window', async () => {
      const h = await harness({ episodes: [record({ measured: 100 })] });
      const episodeId = (await claim(h)).json().episode_id;
      const res = await verdict(h, {
        verdict_id: uid(),
        episode_id: episodeId,
        decision: 'partial',
        spans: [{ start_seconds: 90, end_seconds: 150 }],
      });
      expect(res.json().effective_duration_seconds).toBe('10.000000');
    });

    it('refuses a shape it was not asked for, rather than ignoring it', async () => {
      const h = await harness({ episodes: [record({}), record({}), record({}), record({})] });

      const one = (await claim(h)).json().episode_id;
      expect(
        (await verdict(h, {
          verdict_id: uid(),
          episode_id: one,
          decision: 'good',
          spans: [{ start_seconds: 0, end_seconds: 1 }],
        })).statusCode,
      ).toBe(422);

      expect(
        (await verdict(h, {
          verdict_id: uid(),
          episode_id: one,
          decision: 'good',
          reject_reasons: ['VQ-DARK'],
        })).statusCode,
      ).toBe(422);

      expect(
        (await verdict(h, { verdict_id: uid(), episode_id: one, decision: 'partial', spans: [] })).statusCode,
      ).toBe(422);

      expect(
        (await verdict(h, {
          verdict_id: uid(),
          episode_id: one,
          decision: 'partial',
          spans: [{ start_seconds: 30, end_seconds: 10 }],
        })).statusCode,
      ).toBe(422);

      // The enumeration is the server's; a free-form code is unusable to the
      // collector who has to act on it and cannot be localised.
      expect(
        (await verdict(h, {
          verdict_id: uid(),
          episode_id: one,
          decision: 'bad',
          reject_reasons: ['NOT-A-REAL-CODE'],
        })).statusCode,
      ).toBe(422);

      // None of the refusals wrote anything.
      const rows = (await h.d.execute(sql`select count(*)::int as n from settlements`)) as unknown as { n: number }[];
      expect(rows[0]!.n).toBe(0);
    });

    it('records a repeated verdict once, however many times it arrives', async () => {
      // Acceptance 2. The double-tap and the retry-after-timeout are the same
      // request twice, and a second review row would mean a second payment.
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;
      const verdictId = uid();
      const body = { verdict_id: verdictId, episode_id: episodeId, decision: 'good' };

      const first = await verdict(h, body);
      const second = await verdict(h, body);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json().replayed).toBe(false);
      expect(second.json().replayed).toBe(true);
      expect(second.json().effective_duration_seconds).toBe(first.json().effective_duration_seconds);
      expect(second.json().amount).toBe(first.json().amount);

      const counts = (await h.d.execute(sql`
        select (select count(*) from episode_reviews where verdict_id = ${verdictId})::int as reviews,
               (select count(*) from settlements)::int as settlements
      `)) as unknown as { reviews: number; settlements: number }[];
      expect(counts[0]).toEqual({ reviews: 1, settlements: 1 });
    });

    it('records one row when the same verdict arrives twice at once', async () => {
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;
      const body = { verdict_id: uid(), episode_id: episodeId, decision: 'good' };

      const [a, b] = await Promise.all([verdict(h, body), verdict(h, body)]);
      expect([a!.statusCode, b!.statusCode]).toEqual([200, 200]);
      expect(a!.json().amount).toBe(b!.json().amount);

      const counts = (await h.d.execute(sql`
        select (select count(*) from episode_reviews where review_state <> 'pending')::int as reviews,
               (select count(*) from settlements)::int as settlements
      `)) as unknown as { reviews: number; settlements: number }[];
      expect(counts[0]).toEqual({ reviews: 1, settlements: 1 });
    });

    it('refuses a verdict from a reviewer who does not hold the lease', async () => {
      const h = await harness();
      const episodeId = (await claim(h)).json().episode_id;
      const res = await verdict(
        h,
        { verdict_id: uid(), episode_id: episodeId, decision: 'good' },
        h.headers2,
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('reassigned');
    });

    it('refuses a verdict once the lease has expired', async () => {
      const h = await harness();
      const episodeId = (await claim(h)).json().episode_id;
      await h.d.execute(sql`update episode_reviews set lease_expires_at = now() - interval '1 minute'`);
      const res = await verdict(h, { verdict_id: uid(), episode_id: episodeId, decision: 'good' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('reassigned');
    });

    it('writes the audit row in the same transaction as the verdict', async () => {
      // PLT-07/PLT-08. An audit trail that can be missing while the change
      // succeeded cannot tell an unaudited change from one that never happened.
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;
      await verdict(h, {
        verdict_id: uid(),
        episode_id: episodeId,
        decision: 'partial',
        spans: [{ start_seconds: 0, end_seconds: 30 }],
        reviewer_note: 'lens fogs after the doorway',
      });

      const rows = (await h.d.execute(sql`
        select action, operator_id, upload_device_id, after
          from audit_events where action = 'episode.review'
      `)) as unknown as { action: string; operator_id: string | null; upload_device_id: string | null; after: Record<string, unknown> }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.operator_id).toBe(h.ids.operator);
      expect(rows[0]!.upload_device_id).toBe(h.ids.machine);
      expect(rows[0]!.after['effective_duration_s']).toBe('30.000000');
      expect(rows[0]!.after['amount']).toBe('600.0000');
      expect(rows[0]!.after['unit_price']).toBe('1200.0000');
    });

    it('leaves no settlement pointing anywhere but at a review', async () => {
      // SET-02, checked against the live row rather than against the schema.
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;
      await verdict(h, { verdict_id: uid(), episode_id: episodeId, decision: 'good' });

      const rows = (await h.d.execute(sql`
        select s.episode_review_id, r.episode_id
          from settlements s join episode_reviews r on r.id = s.episode_review_id
      `)) as unknown as { episode_review_id: string; episode_id: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.episode_id).toBe(episodeId);
    });

    it('measures how long the verdict took itself, and ignores what the client claims', async () => {
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;
      // The claim is the start of the clock, so moving it is how the elapsed
      // time is set in a test. The reviewer cannot reach it.
      await h.d.execute(
        sql`update episode_reviews set claimed_at = now() - interval '12.5 seconds'`,
      );
      await verdict(h, {
        verdict_id: uid(),
        episode_id: episodeId,
        decision: 'good',
        // A client trying to look ten times faster than it is. `/throughput`
        // reports on people, so this number is the server's or it is nothing.
        time_to_verdict_seconds: 0.1,
      });
      const rows = (await h.d.execute(sql`
        select time_to_verdict_s, effective_duration_s from episode_reviews
      `)) as unknown as { time_to_verdict_s: string; effective_duration_s: string }[];
      expect(Number(rows[0]!.time_to_verdict_s)).toBeGreaterThan(12);
      expect(Number(rows[0]!.time_to_verdict_s)).toBeLessThan(13);
      expect(rows[0]!.effective_duration_s).toBe('60.000000');
    });
  });

  // -------------------------------------------------------------------------

  describe('serving the footage', () => {
    const withMedia = async (bytes: Buffer) => {
      const root = await mkdtemp(join(tmpdir(), 'playerone-media-'));
      const basename = 'ego_AZER76400FE_20260813_072310';
      await mkdir(join(root, basename), { recursive: true });
      await writeFile(join(root, basename, 'left_part0001.mp4'), bytes);
      const h = await harness({ episodes: [record({ basename })], mediaRoot: root });
      return { h, root };
    };

    it('answers a range request with 206 and exactly those bytes', async () => {
      // Acceptance 3. Without this a browser asked to seek to 80% of a 437 MB
      // file downloads everything before it first, which is not a slow page but
      // an unreviewable programme.
      const bytes = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
      const { h, root } = await withMedia(bytes);
      try {
        const episodeId = (await claim(h)).json().episode_id;
        const res = await h.send('GET', `/media/episode/${episodeId}/part/0`, undefined, {
          ...h.headers,
          range: 'bytes=800-819',
        });
        expect(res.statusCode).toBe(206);
        expect(res.headers['content-range']).toBe('bytes 800-819/1024');
        expect(res.headers['content-length']).toBe('20');
        expect(res.headers['accept-ranges']).toBe('bytes');
        expect(Buffer.from(res.rawPayload).equals(bytes.subarray(800, 820))).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('advertises range support on a plain request too', async () => {
      const { h, root } = await withMedia(Buffer.alloc(64, 7));
      try {
        const episodeId = (await claim(h)).json().episode_id;
        const res = await h.send('GET', `/media/episode/${episodeId}/part/0`);
        expect(res.statusCode).toBe(200);
        // Without this header a browser may decline to offer seeking at all,
        // even though every range request would have been honoured.
        expect(res.headers['accept-ranges']).toBe('bytes');
        expect(res.headers['content-type']).toBe('video/mp4');
        expect(res.rawPayload).toHaveLength(64);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('answers 416 for a range that does not exist', async () => {
      const { h, root } = await withMedia(Buffer.alloc(64, 7));
      try {
        const episodeId = (await claim(h)).json().episode_id;
        const res = await h.send('GET', `/media/episode/${episodeId}/part/0`, undefined, {
          ...h.headers,
          range: 'bytes=900-999',
        });
        expect(res.statusCode).toBe(416);
        expect(res.headers['content-range']).toBe('bytes */64');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('says so when no media root is configured, rather than implying missing footage', async () => {
      const h = await harness();
      const episodeId = (await claim(h)).json().episode_id;
      const res = await h.send('GET', `/media/episode/${episodeId}/part/0`);
      expect(res.statusCode).toBe(503);
    });

    it('distinguishes a part that does not exist from one that is not on this machine', async () => {
      const { h, root } = await withMedia(Buffer.alloc(8, 1));
      try {
        const episodeId = (await claim(h)).json().episode_id;
        expect((await h.send('GET', `/media/episode/${episodeId}/part/7`)).statusCode).toBe(404);
        await rm(join(root, 'ego_AZER76400FE_20260813_072310'), { recursive: true, force: true });
        const gone = await h.send('GET', `/media/episode/${episodeId}/part/0`);
        expect(gone.statusCode).toBe(404);
        expect(gone.json().error).toBe('media is not on this machine');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('requires a session, like everything else on this service', async () => {
      const { h, root } = await withMedia(Buffer.alloc(8, 1));
      try {
        const episodeId = (await claim(h)).json().episode_id;
        const res = await h.app.inject({
          method: 'GET',
          url: `/media/episode/${episodeId}/part/0`,
        });
        expect(res.statusCode).toBe(401);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------

  describe('the console page', () => {
    it('sends somebody with no session to the sign-in form', async () => {
      const h = await harness();
      const res = await h.app.inject({ method: 'GET', url: '/review' });
      // A JSON 401 is right for an API call and useless to a person who opened
      // a bookmark.
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/review/login?lang=en');
    });

    it('signs in with the same two credentials, carried as cookies', async () => {
      const h = await harness();
      const res = await h.app.inject({
        method: 'POST',
        url: '/review/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'machine_identifier=M1&machine_secret=pw&external_ref=op&operator_secret=pw',
      });
      expect(res.statusCode).toBe(303);
      const cookies = res.headers['set-cookie'] as string[];
      expect(cookies.join(' ')).toContain('po_machine=');
      expect(cookies.join(' ')).toContain('po_operator=');
      // HttpOnly so script cannot read them; SameSite so another origin cannot
      // cause a request that carries them.
      expect(cookies.every((c) => c.includes('HttpOnly') && c.includes('SameSite=Strict'))).toBe(true);

      const jar = cookies.map((c) => c.split(';')[0]).join('; ');
      const page = await h.app.inject({ method: 'GET', url: '/review', headers: { cookie: jar } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('id="video-a"');
    });

    it('lets the cookie session reach the API, because a video element cannot set headers', async () => {
      const h = await harness();
      const login = await h.app.inject({
        method: 'POST',
        url: '/review/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'machine_identifier=M1&machine_secret=pw&external_ref=op&operator_secret=pw',
      });
      const jar = (login.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
      const res = await h.app.inject({ method: 'POST', url: '/api/review/claim', headers: { cookie: jar } });
      expect(res.statusCode).toBe(200);
    });

    it('refuses a machine and an operator from different centres', async () => {
      const h = await harness();
      const otherCentre = uid();
      await h.d.execute(sql`insert into upload_centres (id, region, name, status) values (${otherCentre}, 'HN', 'c2', 'active')`);
      await h.d.execute(sql`update operators set upload_centre_id = ${otherCentre} where external_ref = 'op2'`);
      const res = await h.app.inject({
        method: 'POST',
        url: '/review/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'machine_identifier=M1&machine_secret=pw&external_ref=op2&operator_secret=pw',
      });
      expect(res.statusCode).toBe(403);
    });

    it('renders the whole screen in Chinese, with no English left in it', async () => {
      // Acceptance 8. LOC-02: PaXini's reviewers work in Chinese through phase 1.
      const h = await harness();
      const login = await h.app.inject({
        method: 'POST',
        url: '/review/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'machine_identifier=M1&machine_secret=pw&external_ref=op&operator_secret=pw',
      });
      const jar = (login.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
      const page = await h.app.inject({ method: 'GET', url: '/review?lang=zh', headers: { cookie: jar } });

      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('lang="zh-Hans"');
      // Strip the markup, the bootstrap JSON and the product name, then look for
      // any remaining run of Latin letters: that is an untranslated string.
      const visible = page.body
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/g, ' ')
        .replace(/PlayerOne|English/g, ' ');
      const leaked = visible.match(/[A-Za-z]{3,}/g) ?? [];
      expect(leaked).toEqual([]);
    });

    it('serves the module and the stylesheet, and nothing else off the disk', async () => {
      const h = await harness();
      expect((await h.app.inject({ method: 'GET', url: '/review/assets/review.js' })).statusCode).toBe(200);
      expect((await h.app.inject({ method: 'GET', url: '/review/assets/review.css' })).statusCode).toBe(200);
      expect((await h.app.inject({ method: 'GET', url: '/review/assets/index.ts' })).statusCode).toBe(404);
    });
  });
});
