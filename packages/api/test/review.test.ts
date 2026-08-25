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

const record = (opts: { basename?: string; measured?: number; declared?: number | null }): EpisodeRecord => {
  const measured = opts.measured ?? 100;
  return {
    schema_version: '1.1.0',
    episode_id: uid(),
    content_fingerprint: 'a'.repeat(64),
    state: 'ok',
    source: {
      path: opts.basename ?? `ego_AZER76400FE_20260813_${String(Math.random()).slice(2, 8)}`,
      ingest_tool_version: '0.3.1',
      ingested_at: new Date().toISOString(),
      ingest_host: 'test',
    },
    device: { serial: 'AZER76400FE', firmware_declared: '1.0.3', calibration_serial: null },
    declared:
      opts.declared === undefined
        ? null
        : {
            session_id: null,
            status: 'completed',
            duration_sec: opts.declared,
            start_time: null,
            end_time: null,
            video_left_frame_count: null,
            video_right_frame_count: null,
            imu_accel_count: null,
            imu_gyro_count: null,
            audio_frame_count: null,
          },
    streams: [
      {
        role: 'camera_left',
        parts: [{ file: 'left_part0001.mp4', bytes: 64, sha256: 'b'.repeat(64) }],
        pts_source: 'sidecar',
        first_pts_us: String(T * 1000),
        last_pts_us: String((T + measured * 1000) * 1000),
        sample_count: 300,
        span_s: measured,
        nominal_rate_hz: 30,
      },
    ],
    timing: {
      method: 'pts_sidecar',
      confidence: 'exact',
      usable_start_us: String(T * 1000),
      usable_end_us: String((T + measured * 1000) * 1000),
      raw_duration_s: measured,
      max_stream_skew_ms: 0,
    },
    calibration: { present: true, files: [] },
    source_files: [],
    discrepancies: [],
    unclassified_files: [],
  };
};

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
  async function harness(options: { episodes?: EpisodeRecord[]; mediaRoot?: string } = {}) {
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

    const login = async (ref: string) => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'M1', secret: 'pw' } });
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

    return { d, app, ids, headers, headers2, send, handover, batch, session };
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

    it('records how long the verdict took, without letting it touch the money', async () => {
      const h = await harness({ episodes: [record({ measured: 60 })] });
      const episodeId = (await claim(h)).json().episode_id;
      await verdict(h, {
        verdict_id: uid(),
        episode_id: episodeId,
        decision: 'good',
        time_to_verdict_seconds: 12.5,
      });
      const rows = (await h.d.execute(sql`
        select time_to_verdict_s, effective_duration_s from episode_reviews
      `)) as unknown as { time_to_verdict_s: string; effective_duration_s: string }[];
      expect(rows[0]!.time_to_verdict_s).toBe('12.500');
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
