import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApi, hashCredential } from '../src/index.ts';
import { closeDb, db, hasDb, liveClaim, truncate, useDatabase, violates } from '../../store/test/db.ts';
import { episodeRecord, FIXTURE_T as T } from './fixtures.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('reviewer');

/**
 * PLT-10: "Remote access for PaXini reviewers in China, scoped to review
 * functions only, fully logged."
 *
 * Three separate claims, and each is tested as its own property rather than as
 * a happy path that happens to touch all of them:
 *
 *   - **A reviewer is an actor.** One credential, no machine, no upload centre,
 *     and the review lane works end to end on that session.
 *   - **Scoped, server-side.** The counter, the batches and the console's own
 *     diagnostics answer 403 to a reviewer token — decided in the route guard,
 *     so a review route added tomorrow is in scope by its path and a counter
 *     route added tomorrow is out of it without anybody remembering to say so.
 *   - **Fully logged, and distinguishably.** The audit row a reviewer writes
 *     names them as a reviewer, with no invented device and no invented centre.
 *
 * The fixture carries two centres, two collectors and two cards on purpose. A
 * single-handover fixture is the exact shape that hid a payment bug in the
 * resolver, and it is also the shape that would let a centre-scoped 403 pass
 * for the wrong reason.
 */

const SECRET = 'k';
const uid = () => randomUUID();

describe.skipIf(!hasDb())('the reviewer role', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function harness(
    options: { mediaRoot?: string; reviewerMediaEnabled?: boolean; basenameA?: string } = {},
  ) {
    const d = await db();
    const ids = {
      centreA: uid(),
      centreB: uid(),
      machineA: uid(),
      machineB: uid(),
      operatorA: uid(),
      operatorB: uid(),
      reviewer: uid(),
      reviewerB: uid(),
      collectorA: uid(),
      collectorB: uid(),
      deviceType: uid(),
      deviceA: uid(),
      deviceB: uid(),
      task: uid(),
      scenario: uid(),
    };
    const hash = await hashCredential('pw');

    await d.execute(sql`
      insert into upload_centres (id, region, name, status) values
        (${ids.centreA}, 'HCM', 'centre HCM', 'active'),
        (${ids.centreB}, 'HAN', 'centre HAN', 'active')`);
    await d.execute(sql`
      insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values
        (${ids.machineA}, ${ids.centreA}, 'HCM-IMPORT-01', 'active', ${hash}),
        (${ids.machineB}, ${ids.centreB}, 'HAN-IMPORT-01', 'active', ${hash})`);
    await d.execute(sql`
      insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
        (${ids.operatorA}, ${ids.centreA}, 'op-a', 'centre_operator', ${hash}),
        (${ids.operatorB}, ${ids.centreB}, 'op-b', 'centre_operator', ${hash})`);
    // The reviewer: no centre at all. `operators_centre_check` allows the null
    // only because the role says reviewer.
    await d.execute(sql`
      insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
        (${ids.reviewer}, null, 'pax-01', 'reviewer', ${hash}),
        (${ids.reviewerB}, null, 'pax-02', 'reviewer', ${hash})`);
    await d.execute(sql`
      insert into collectors (id, external_ref, status) values
        (${ids.collectorA}, 'c1', 'qualified'), (${ids.collectorB}, 'c2', 'qualified')`);
    await d.execute(
      sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`,
    );
    await d.execute(sql`
      insert into devices (id, device_type_id, hardware_serial, status) values
        (${ids.deviceA}, ${ids.deviceType}, 'AZER76400FE', 'active'),
        (${ids.deviceB}, ${ids.deviceType}, 'BZER76400FF', 'active')`);
    await d.execute(sql`
      insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
        values (${ids.task}, 'housework', 1200, 5, 'published')`);
    await d.execute(
      sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`,
    );
    // Each card's session is recorded under its collector's live claim (0016).
    await liveClaim(d, ids.task, ids.collectorA);
    await liveClaim(d, ids.task, ids.collectorB);

    const app = buildApi({
      db: d,
      tokenSecret: SECRET,
      mediaRoot: options.mediaRoot,
      reviewerMediaEnabled: options.reviewerMediaEnabled,
      // `buildApi` refuses reviewer media with the session cookie in clear, so
      // the flag brings TLS with it here exactly as it must in a deployment.
      secureCookies: options.reviewerMediaEnabled === true,
    });
    await app.ready();

    const counter = async (machine: string, ref: string): Promise<Record<string, string>> => {
      const m = await app.inject({
        method: 'POST',
        url: '/auth/machine',
        payload: { machine_identifier: machine, secret: 'pw' },
      });
      const o = await app.inject({
        method: 'POST',
        url: '/auth/operator',
        payload: { external_ref: ref, secret: 'pw' },
      });
      expect(m.statusCode, m.body).toBe(200);
      expect(o.statusCode, o.body).toBe(200);
      return {
        'x-machine-token': `Bearer ${m.json().token}`,
        authorization: `Bearer ${o.json().token}`,
      };
    };
    const headersA = await counter('HCM-IMPORT-01', 'op-a');
    const headersB = await counter('HAN-IMPORT-01', 'op-b');

    /**
     * The reviewer signs in through the console's own JSON route and the token
     * is read back out of the cookie it set — the same value the browser would
     * carry. Nothing here mints a token by hand, so the test fails if sign-in
     * stops issuing one.
     */
    const signIn = async (ref: string, secret: string) =>
      app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { external_ref: ref, operator_secret: secret },
      });

    const asReviewer = async (ref: string): Promise<Record<string, string>> => {
      const session = await signIn(ref, 'pw');
      expect(session.statusCode, session.body).toBe(200);
      const setCookie = [session.headers['set-cookie'] ?? []].flat().join(' | ');
      const token = /po_operator=([^;]+)/.exec(setCookie)?.[1] ?? '';
      return { authorization: `Bearer ${decodeURIComponent(token)}` };
    };
    const reviewerHeaders = await asReviewer('pax-01');
    const reviewerHeadersB = await asReviewer('pax-02');

    const send = async (
      method: 'POST' | 'GET' | 'PATCH',
      url: string,
      payload?: unknown,
      who: Record<string, string> = headersA,
    ): Promise<LightMyRequestResponse> =>
      (await app.inject({
        method,
        url,
        payload: payload as never,
        headers: who,
      })) as unknown as LightMyRequestResponse;

    /** One card per centre, each with its own collector, session and episode. */
    const cards: { handover: string; batch: string; session: string }[] = [];
    const centres = [
      { who: headersA, collector: ids.collectorA, device: ids.deviceA, serial: 'AZER76400FE' },
      { who: headersB, collector: ids.collectorB, device: ids.deviceB, serial: 'BZER76400FF' },
    ];
    for (const [i, centre] of centres.entries()) {
      const handover = uid();
      const batch = uid();
      const collectionSession = uid();
      await send(
        'POST',
        '/handovers',
        {
          id: handover,
          collector_id: centre.collector,
          device_id: centre.device,
          tf_card_id: `CARD-${i + 1}`,
          handover_time: new Date(T).toISOString(),
        },
        centre.who,
      );
      await send(
        'POST',
        '/upload-batches',
        { id: batch, handover_id: handover, import_started_at: new Date(T).toISOString() },
        centre.who,
      );
      await send(
        'POST',
        `/handovers/${handover}/sessions`,
        {
          id: collectionSession,
          task_id: ids.task,
          scenario_id: ids.scenario,
          others_in_frame: false,
          sensitive_info_present: false,
          prepare_time: new Date(T - 60_000).toISOString(),
        },
        centre.who,
      );
      const submitted = await send(
        'POST',
        `/upload-batches/${batch}/episodes`,
        {
          episodes: [
            episodeRecord({
              serial: centre.serial,
              measured: 60,
              basename: i === 0 ? options.basenameA : undefined,
            }),
          ],
        },
        centre.who,
      );
      expect(submitted.statusCode, submitted.body).toBe(200);
      for (const e of submitted.json().episodes as { resolution_state: string }[]) {
        expect(e.resolution_state).toBe('resolved');
      }
      cards.push({ handover, batch, session: collectionSession });
    }

    return {
      d,
      app,
      ids,
      headersA,
      headersB,
      reviewerHeaders,
      reviewerHeadersB,
      send,
      signIn,
      cards,
    };
  }

  /**
   * The world in which Legal has signed: a reviewer can watch, and therefore
   * can work. Everything about the lane itself is tested here, because with the
   * flag off there is no lane for a reviewer to run — see the D11 tests below,
   * which are the ones that assert the default.
   */
  const lane = () => harness({ reviewerMediaEnabled: true });

  // -------------------------------------------------------------------------
  // A reviewer is an actor

  it('signs a reviewer in on one credential and issues no machine token', async () => {
    const h = await harness();
    const res = await h.signIn('pax-01', 'pw');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ role: 'reviewer', reviewer_id: h.ids.reviewer });

    /**
     * The machine cookie is cleared rather than left alone. A shared
     * workstation that a counter operator used an hour ago still holds one, and
     * a reviewer token beside a live machine token is a session neither
     * credential earned.
     */
    const cookies = [res.headers['set-cookie'] ?? []].flat().join(' | ');
    expect(cookies).toMatch(/po_operator=[^;]+/);
    expect(cookies).toMatch(/po_machine=;/);
  });

  it('runs the whole review lane on a reviewer session: claim, heartbeat, verdict', async () => {
    const h = await lane();
    const who = h.reviewerHeaders;

    const claim = await h.send('POST', '/api/review/claim', undefined, who);
    expect(claim.statusCode, claim.body).toBe(200);
    const episodeId = claim.json().episode_id as string;

    const beat = await h.send('POST', `/api/review/heartbeat/${episodeId}`, undefined, who);
    expect(beat.statusCode, beat.body).toBe(200);

    const verdict = await h.send(
      'POST',
      '/api/review/verdict',
      {
        verdict_id: uid(),
        episode_id: episodeId,
        // `good` means every measured second is useful, so it carries no spans.
        decision: 'good',
      },
      who,
    );
    expect(verdict.statusCode, verdict.body).toBe(200);
    // The server computes the money; 60 s at 1200 per minute is 1200.
    expect(verdict.json().effective_minutes).toBe('1.000000');
    expect(verdict.json().amount).toBe('1200.0000');

    // The lease and the verdict are both recorded against the reviewer's own id
    // and not against a borrowed operator's.
    const rows = (await h.d.execute(sql`
      select reviewer_ref from episode_reviews where episode_id = ${episodeId}
    `)) as unknown as { reviewer_ref: string }[];
    expect(rows[0]!.reviewer_ref).toBe(h.ids.reviewer);
  });

  it('lets a reviewer quarantine what they hold, and nothing else on the routing route', async () => {
    // Bridge F-5. The reviewer scope is a route prefix, and /api/review/route
    // is inside it — so the route itself has to say that lowering a flag,
    // moving priority or reassigning are the upload centre's decisions.
    const h = await lane();
    const who = h.reviewerHeaders;
    const episodeId = (await h.send('POST', '/api/review/claim', undefined, who)).json()
      .episode_id as string;

    for (const body of [
      { queue: 'standard', reason: 'looked fine to me' },
      { queue: 'privacy', priority: 5 },
      { queue: 'privacy', assignee_ref: h.ids.reviewer },
      { priority: 1 },
    ]) {
      const res = await h.send('POST', `/api/review/route/${episodeId}`, body, who);
      expect(res.statusCode, `${JSON.stringify(body)}: ${res.body}`).toBe(403);
    }

    const raised = await h.send('POST', `/api/review/route/${episodeId}`, { queue: 'privacy' }, who);
    expect(raised.statusCode, raised.body).toBe(200);
    expect(raised.json().queue).toBe('privacy');
  });

  it('keeps a reviewer session out of the upload leg', async () => {
    // Bridge F-7. `/upload-batches/*` is the machine's route; a reviewer has no
    // machine, and the route must refuse before the handler dereferences one.
    const h = await lane();
    const batch = h.cards[0]!.batch;
    for (const url of [`/upload-batches/${batch}/upload`, `/upload-batches/${batch}/cache-clean`]) {
      const res = await h.send('POST', url, undefined, h.reviewerHeaders);
      expect(res.statusCode, `${url}: ${res.body}`).toBe(403);
    }
  });

  it('records a reviewer verdict as a reviewer, with no invented machine or centre', async () => {
    const h = await lane();
    const who = h.reviewerHeaders;
    const episodeId = (await h.send('POST', '/api/review/claim', undefined, who)).json()
      .episode_id as string;
    await h.send(
      'POST',
      '/api/review/verdict',
      {
        verdict_id: uid(),
        episode_id: episodeId,
        // `good` means every measured second is useful, so it carries no spans.
        decision: 'good',
      },
      who,
    );

    const [row] = (await h.d.execute(sql`
      select actor_role, operator_id, upload_device_id, upload_centre_id
        from audit_events
       where action not like '%.login'
       order by id desc limit 1
    `)) as unknown as Record<string, string | null>[];

    // PLT-10's "fully logged" is not the same as "logged": a PaXini reviewer
    // and a VNG counter operator both land in `operator_id`, so without
    // `actor_role` the trail cannot answer who was remote.
    expect(row!['actor_role']).toBe('reviewer');
    expect(row!['operator_id']).toBe(h.ids.reviewer);
    expect(row!['upload_device_id']).toBeNull();
    expect(row!['upload_centre_id']).toBeNull();

    // And the sign-in itself is a distinct action, not `operator.login`. The
    // fixture signs two reviewers in, so this is the first one: `pax-01`.
    const [login] = (await h.d.execute(sql`
      select action, actor_role, operator_id, upload_centre_id
        from audit_events where action = 'reviewer.login' order by id limit 1
    `)) as unknown as Record<string, string | null>[];
    expect(login!['actor_role']).toBe('reviewer');
    expect(login!['operator_id']).toBe(h.ids.reviewer);
    expect(login!['upload_centre_id']).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Scoped to review, server-side

  it('refuses a reviewer session everything outside the review lane', async () => {
    const h = await harness();
    const who = h.reviewerHeaders;
    const card = h.cards[0]!;

    const refused: [string, 'POST' | 'GET' | 'PATCH', string, unknown?][] = [
      [
        'the counter',
        'POST',
        '/handovers',
        {
          id: uid(),
          collector_id: h.ids.collectorA,
          device_id: h.ids.deviceA,
          tf_card_id: 'CARD-9',
          handover_time: new Date(T).toISOString(),
        },
      ],
      [
        'a session on a card',
        'POST',
        `/handovers/${card.handover}/sessions`,
        {
          id: uid(),
          task_id: h.ids.task,
          scenario_id: h.ids.scenario,
          others_in_frame: false,
          sensitive_info_present: false,
          prepare_time: new Date(T).toISOString(),
        },
      ],
      [
        'opening a batch',
        'POST',
        '/upload-batches',
        { id: uid(), handover_id: card.handover, import_started_at: new Date(T).toISOString() },
      ],
      ['closing a batch', 'PATCH', `/upload-batches/${card.batch}`, { batch_status: 'complete' }],
      ['listing batches', 'GET', '/upload-batches'],
      ['the exception queue', 'GET', `/upload-batches/${card.batch}/exceptions`],
      ['submitting episodes', 'POST', `/upload-batches/${card.batch}/episodes`, { episodes: [] }],
      ['the machine heartbeat', 'POST', `/upload-devices/${h.ids.machineA}/heartbeat`, {}],
      ['the reference cache', 'GET', '/reference/sync'],
      /**
       * The collector's own answer to "why did my footage fail". It reads
       * exactly what a reviewer wrote, so it looks like review data — but the
       * reader it is shaped for is the collector, and PLT-10 scopes PaXini to
       * the review functions and no further.
       */
      ['an episode outcome', 'GET', `/api/episodes/${uid()}/outcome`],
    ];

    for (const [what, method, url, payload] of refused) {
      const res = await h.send(method, url, payload, who);
      expect(res.statusCode, `${what} (${method} ${url}): ${res.body}`).toBe(403);
      expect(res.json().error).toContain('scoped to review');
    }

    // And the same routes still work for the counter operators they belong to.
    expect((await h.send('GET', '/upload-batches', undefined, h.headersA)).statusCode).toBe(200);
    expect((await h.send('GET', '/upload-batches', undefined, h.headersB)).statusCode).toBe(200);
  });

  it('answers the identity probe for both, because the console cannot read its own cookie', async () => {
    /**
     * `/whoami` is the single named exception to the review scope. The session
     * cookies are `HttpOnly`, so a 403 here would leave the console unable to
     * tell a signed-in reviewer from a signed-out one — it would bounce them to
     * the sign-in form, which would sign them in, which would bounce them
     * again. It returns the caller's own identity and nothing else.
     */
    const h = await harness();

    const reviewer = await h.send('GET', '/whoami', undefined, h.reviewerHeaders);
    expect(reviewer.statusCode, reviewer.body).toBe(200);
    expect(reviewer.json()).toEqual({ role: 'reviewer', reviewer_id: h.ids.reviewer });

    const operator = await h.send('GET', '/whoami', undefined, h.headersA);
    expect(operator.statusCode, operator.body).toBe(200);
    expect(operator.json()).toEqual({
      role: 'operator',
      operator_id: h.ids.operatorA,
      upload_device_id: h.ids.machineA,
      upload_centre_id: h.ids.centreA,
    });
  });

  it('refuses a reviewer credential presented as an operator credential', async () => {
    const h = await harness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: 'pax-01', secret: 'pw' },
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it('leaves the counter sign-in exactly as it was', async () => {
    const h = await harness();
    // Both tokens, one centre, and the reviewer row in the same table changes
    // nothing about it.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: {
        machine_identifier: 'HCM-IMPORT-01',
        machine_secret: 'pw',
        external_ref: 'op-a',
        operator_secret: 'pw',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      role: 'operator',
      upload_centre_id: h.ids.centreA,
      operator_id: h.ids.operatorA,
    });
  });

  // -------------------------------------------------------------------------
  // D11 and Part 7: raw video is default-denied

  it('refuses a reviewer the footage, the claim and the verdict until the flag is set', async () => {
    /**
     * Brief D11 records "whether background review requires online playback of
     * raw video" as unresolved and marked "Escalate — this is not a minor
     * detail", because it "decides whether reviewers stream video, and
     * therefore whether video leaves Vietnam in practice". Part 7.3: the Phase
     * 1 arrangement is "remote access, not data transfer", and that distinction
     * "must hold in the implementation, not just in the description".
     *
     * So this asserts a refusal, not a feature — and the refusal covers the
     * whole act of reviewing, not only the bytes. Withholding the video while
     * leaving the claim and the verdict live would let a reviewer in Shenzhen
     * take an episode off the queue and pay a collector `good` for footage
     * nobody watched, which reads as an ordinary payment afterwards.
     */
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const root = await mkdtemp(join(tmpdir(), 'playerone-reviewer-media-'));
    const basename = 'ego_AZER76400FE_20260813_072310';
    await mkdir(join(root, basename), { recursive: true });
    await writeFile(join(root, basename, 'left_part0001.mp4'), bytes);

    try {
      const off = await harness({ mediaRoot: root, basenameA: basename });

      // 451, not 403: the credential is good and the route is in scope. This is
      // a legal refusal and it flips with the flag.
      const claim = await off.send('POST', '/api/review/claim', undefined, off.reviewerHeaders);
      expect(claim.statusCode, claim.body).toBe(451);
      expect(claim.json().error).toBe('playback_unauthorised');

      // Nothing was taken off the queue by the attempt.
      const [pending] = (await off.d.execute(
        sql`select count(*)::int as n from episode_reviews`,
      )) as unknown as { n: number }[];
      expect(pending!.n).toBe(0);

      // The verdict route refuses the same way, so a reviewer holding a lease
      // from before the flag was turned off cannot decide on it either.
      const decided = await off.send(
        'POST',
        '/api/review/verdict',
        { verdict_id: uid(), episode_id: uid(), decision: 'good' },
        off.reviewerHeaders,
      );
      expect(decided.statusCode, decided.body).toBe(451);

      // The VNG operator at the machine holding the file is unaffected: they
      // claim, they read the metadata, and they get the bytes.
      const operatorClaim = await off.send('POST', '/api/review/claim', undefined, off.headersA);
      expect(operatorClaim.statusCode, operatorClaim.body).toBe(200);
      const episodeId = operatorClaim.json().episode_id as string;
      expect(operatorClaim.json().media.parts[0].url).toBe(`/media/episode/${episodeId}/part/0`);
      const allowed = await off.send(
        'GET',
        `/media/episode/${episodeId}/part/0`,
        undefined,
        off.headersA,
      );
      expect(allowed.statusCode, allowed.body).toBe(200);

      // And a reviewer who composes the media url by hand is still refused.
      const denied = await off.send(
        'GET',
        `/media/episode/${episodeId}/part/0`,
        undefined,
        off.reviewerHeaders,
      );
      expect(denied.statusCode, denied.body).toBe(403);

      await truncate();

      // With the flag on the whole lane opens, and only then.
      const on = await harness({ mediaRoot: root, basenameA: basename, reviewerMediaEnabled: true });
      const onEpisode = (
        await on.send('POST', '/api/review/claim', undefined, on.reviewerHeaders)
      ).json().episode_id as string;
      const served = await on.send(
        'GET',
        `/media/episode/${onEpisode}/part/0`,
        undefined,
        on.reviewerHeaders,
      );
      expect(served.statusCode, served.body).toBe(200);
      expect(Buffer.from(served.rawPayload).equals(bytes)).toBe(true);

      const onMeta = await on.send(
        'GET',
        `/api/review/episode/${onEpisode}`,
        undefined,
        on.reviewerHeaders,
      );
      expect(onMeta.json().media.parts[0].url).toBe(`/media/episode/${onEpisode}/part/0`);

      /**
       * And only that episode. With the flag on, the route guard alone would
       * let a signed-in reviewer stream any episode id they can name; PLT-10
       * grants remote access to their own queue, not to the archive.
       */
      const others = (await on.d.execute(sql`
        select episode_id from episodes where episode_id <> ${onEpisode} limit 1
      `)) as unknown as { episode_id: string }[];
      const notTheirs = await on.send(
        'GET',
        `/media/episode/${others[0]!.episode_id}/part/0`,
        undefined,
        on.reviewerHeaders,
      );
      expect(notTheirs.statusCode, notTheirs.body).toBe(403);

      /**
       * And the policy can be withdrawn under a live lease.
       *
       * A reviewer holding a claimed episode when the flag is turned off is the
       * case that matters at acceptance: whatever they had open, no verdict, no
       * settlement and no payment audit row may commit after the withdrawal.
       * Same database, same token, a process started with the flag off — which
       * is what a restart after Legal changes its mind actually looks like.
       */
      const withdrawn = buildApi({ db: on.d, tokenSecret: SECRET, mediaRoot: root });
      await withdrawn.ready();
      const afterWithdrawal = await withdrawn.inject({
        method: 'POST',
        url: '/api/review/verdict',
        payload: { verdict_id: uid(), episode_id: onEpisode, decision: 'good' },
        headers: on.reviewerHeaders,
      });
      expect(afterWithdrawal.statusCode, afterWithdrawal.body).toBe(451);
      const [after] = (await on.d.execute(sql`
        select
          (select count(*) from settlements) as settlements,
          (select count(*) from episode_reviews where review_state <> 'pending') as decided,
          (select count(*) from audit_events where action = 'episode.review') as audited
      `)) as unknown as Record<string, string>[];
      expect(after).toEqual({ settlements: '0', decided: '0', audited: '0' });
      // The lease itself is untouched: withdrawing the policy is not a release,
      // and the row still names the reviewer who was holding it.
      const [held] = (await on.d.execute(sql`
        select reviewer_ref from episode_reviews where episode_id = ${onEpisode}
      `)) as unknown as { reviewer_ref: string }[];
      expect(held!.reviewer_ref).toBe(on.ids.reviewer);

      // Nor can the page keep that lease alive. Refused, it lapses and the
      // episode returns to the queue, which is what withdrawal should mean; a
      // heartbeat that still worked would hold unwatchable footage for as long
      // as the tab stayed open.
      const beat = await withdrawn.inject({
        method: 'POST',
        url: `/api/review/heartbeat/${onEpisode}`,
        headers: on.reviewerHeaders,
      });
      expect(beat.statusCode, beat.body).toBe(451);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Fully logged, and only what is theirs

  it('logs a reviewer taking an episode and giving it back, and an operator differently', async () => {
    /**
     * PLT-10 says remote reviewer access is *fully logged*, and until this test
     * existed it was not. `reviewer_ref` is a mutable column: the next claimant
     * overwrites it and a release sets it to null, so a reviewer who claimed an
     * episode, watched it and handed it back left the store in exactly the
     * state it was in before they saw it. Part 7 makes "which footage did
     * somebody outside Vietnam open" a question that has to have an answer, and
     * only an append-only row is one.
     */
    const h = await lane();
    const who = h.reviewerHeaders;
    const episodeId = (await h.send('POST', '/api/review/claim', undefined, who)).json()
      .episode_id as string;
    const released = await h.send('POST', `/api/review/release/${episodeId}`, undefined, who);
    expect(released.json()).toEqual({ released: true });

    const rows = (await h.d.execute(sql`
      select action, actor_role, operator_id, upload_device_id, upload_centre_id,
             target_table, target_id, before, after
        from audit_events
       where action in ('review.claim', 'review.release')
       order by id
    `)) as unknown as Record<string, unknown>[];
    expect(rows.map((r) => r['action'])).toEqual(['review.claim', 'review.release']);
    for (const r of rows) {
      expect(r['actor_role']).toBe('reviewer');
      expect(r['operator_id']).toBe(h.ids.reviewer);
      // No invented machine and no invented centre: PaXini staff sit at neither.
      expect(r['upload_device_id']).toBeNull();
      expect(r['upload_centre_id']).toBeNull();
      expect(r['target_table']).toBe('episode_reviews');
    }
    // The pair names the same episode and the same review row, so the interval
    // between them is how long that reviewer had the footage open.
    expect((rows[0]!['after'] as { episode_id: string }).episode_id).toBe(episodeId);
    expect((rows[1]!['before'] as { episode_id: string }).episode_id).toBe(episodeId);
    expect(rows[0]!['target_id']).toBe(rows[1]!['target_id']);

    // Releasing something already released changes nothing, so it logs nothing.
    const again = await h.send('POST', `/api/review/release/${episodeId}`, undefined, who);
    expect(again.json()).toEqual({ released: false });

    // The counter operator's own claim is logged too, and as an operator — with
    // the machine and the centre the reviewer's row cannot carry.
    const operatorClaim = await h.send('POST', '/api/review/claim', undefined, h.headersA);
    expect(operatorClaim.statusCode, operatorClaim.body).toBe(200);
    const [op] = (await h.d.execute(sql`
      select actor_role, operator_id, upload_device_id, upload_centre_id
        from audit_events where action = 'review.claim' order by id desc limit 1
    `)) as unknown as Record<string, unknown>[];
    expect(op!['actor_role']).toBe('operator');
    expect(op!['operator_id']).toBe(h.ids.operatorA);
    expect(op!['upload_device_id']).toBe(h.ids.machineA);
    expect(op!['upload_centre_id']).toBe(h.ids.centreA);

    // Exactly two releases were attempted and one happened.
    const [count] = (await h.d.execute(sql`
      select count(*)::int as n from audit_events where action = 'review.release'
    `)) as unknown as { n: number }[];
    expect(count!.n).toBe(1);
  });

  it('shows a reviewer metadata only for the episodes they hold', async () => {
    /**
     * Unrestricted, `/api/review/episode/:id` hands any signed-in reviewer the
     * collector, the task, the device serial, the APP-17b declarations and the
     * resolver's working for any episode id they can name — the whole corpus,
     * one id at a time, to a session that Part 7 says should reach a queue.
     * `/next` reveals one unclaimed episode on purpose, because that is the
     * queue; this route revealed all of them.
     */
    const h = await lane();
    const mine = (await h.send('POST', '/api/review/claim', undefined, h.reviewerHeaders)).json()
      .episode_id as string;
    const [other] = (await h.d.execute(sql`
      select episode_id from episodes where episode_id <> ${mine} limit 1
    `)) as unknown as { episode_id: string }[];

    const own = await h.send('GET', `/api/review/episode/${mine}`, undefined, h.reviewerHeaders);
    expect(own.statusCode, own.body).toBe(200);

    const theirs = await h.send(
      'GET',
      `/api/review/episode/${other!.episode_id}`,
      undefined,
      h.reviewerHeaders,
    );
    // The same 404 an unknown id gets, so it is not an oracle for which exist.
    expect(theirs.statusCode, theirs.body).toBe(404);
    expect(theirs.body).not.toContain('BZER76400FF');

    // A second reviewer holds nothing at all and sees nothing at all.
    const stranger = await h.send(
      'GET',
      `/api/review/episode/${mine}`,
      undefined,
      h.reviewerHeadersB,
    );
    expect(stranger.statusCode, stranger.body).toBe(404);

    // The VNG counter operator is unaffected: inside Vietnam, on the machine
    // holding the files.
    const operator = await h.send(
      'GET',
      `/api/review/episode/${other!.episode_id}`,
      undefined,
      h.headersA,
    );
    expect(operator.statusCode, operator.body).toBe(200);
  });

  it('does not replay a verdict to a reviewer who merely quotes its id', async () => {
    /**
     * `verdict_id` is the *client's* idempotency key, not a secret. Unscoped,
     * the replay path answered any reviewer who presented a verdict id that
     * exists — handing back somebody else's episode id, durations, marked
     * spans, unit price and amount. A genuine retry carries the same reviewer
     * and the same episode it sent the first time, so scoping the lookup costs
     * the retry nothing.
     */
    const h = await lane();
    const first = (await h.send('POST', '/api/review/claim', undefined, h.reviewerHeaders)).json()
      .episode_id as string;
    const verdictId = uid();
    const decided = await h.send(
      'POST',
      '/api/review/verdict',
      { verdict_id: verdictId, episode_id: first, decision: 'good' },
      h.reviewerHeaders,
    );
    expect(decided.statusCode, decided.body).toBe(200);

    const second = (await h.send('POST', '/api/review/claim', undefined, h.reviewerHeadersB)).json()
      .episode_id as string;
    expect(second).not.toBe(first);

    const stolen = await h.send(
      'POST',
      '/api/review/verdict',
      { verdict_id: verdictId, episode_id: second, decision: 'good' },
      h.reviewerHeadersB,
    );
    expect(stolen.statusCode, stolen.body).toBe(409);
    expect(stolen.body).not.toContain(first);
    expect(stolen.body).not.toContain('1200.0000');

    // And the first reviewer's own retry still replays, which is the whole
    // point of the key.
    const retry = await h.send(
      'POST',
      '/api/review/verdict',
      { verdict_id: verdictId, episode_id: first, decision: 'good' },
      h.reviewerHeaders,
    );
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().replayed).toBe(true);

    // One settlement, not two.
    const [n] = (await h.d.execute(
      sql`select count(*)::int as n from settlements`,
    )) as unknown as { n: number }[];
    expect(n!.n).toBe(1);
  });

  it('refuses a verdict on a lease the database considers expired, whatever this process thinks', async () => {
    /**
     * The pre-check compares the stored lease against `Date.now()` in this
     * process; the deciding UPDATE compares it against the database's `now()`.
     * When the two clocks disagree — and an API server and a database server do
     * disagree — only the second one is the arbiter. This drives them apart on
     * purpose rather than waiting for a real skew: the lease is expired to
     * Postgres and still live to Node, so the pre-check waves the verdict
     * through and only the WHERE stops it.
     *
     * Without `lease_expires_at >= now()` in that WHERE, this writes a verdict,
     * a settlement and an audit row against a lease that had lapsed.
     */
    const h = await lane();
    const episodeId = (await h.send('POST', '/api/review/claim', undefined, h.reviewerHeaders))
      .json().episode_id as string;
    await h.d.execute(sql`
      update episode_reviews set lease_expires_at = now() - interval '1 minute'
       where episode_id = ${episodeId}`);

    const skew = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 10 * 60_000);
    try {
      const late = await h.send(
        'POST',
        '/api/review/verdict',
        { verdict_id: uid(), episode_id: episodeId, decision: 'good' },
        h.reviewerHeaders,
      );
      expect(late.statusCode, late.body).toBe(409);
    } finally {
      skew.mockRestore();
    }

    const [row] = (await h.d.execute(sql`
      select review_state, verdict_id from episode_reviews where episode_id = ${episodeId}
    `)) as unknown as { review_state: string; verdict_id: string | null }[];
    expect(row!.review_state).toBe('pending');
    expect(row!.verdict_id).toBeNull();
    const [n] = (await h.d.execute(
      sql`select count(*)::int as n from settlements`,
    )) as unknown as { n: number }[];
    expect(n!.n).toBe(0);
  });

  it('honours the role the sign-in form chose when one reference names two people', async () => {
    /**
     * Reviewer references are globally unique and centre references are unique
     * per centre, but nothing stops the two namespaces colliding. Trying the
     * reviewer path first and falling through meant somebody who picked
     * "Upload centre" could be handed a reviewer session — with their machine
     * cookie cleared — because a PaXini reviewer happened to share their
     * reference.
     */
    const h = await harness();
    await h.d.execute(sql`
      insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${uid()}, null, 'op-a', 'reviewer', ${await hashCredential('pw')})`);

    const counter = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: {
        role: 'operator',
        machine_identifier: 'HCM-IMPORT-01',
        machine_secret: 'pw',
        external_ref: 'op-a',
        operator_secret: 'pw',
      },
    });
    expect(counter.statusCode, counter.body).toBe(200);
    expect(counter.json().role).toBe('operator');
    expect(counter.json().operator_id).toBe(h.ids.operatorA);

    const reviewer = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { role: 'reviewer', external_ref: 'op-a', operator_secret: 'pw' },
    });
    expect(reviewer.statusCode, reviewer.body).toBe(200);
    expect(reviewer.json().role).toBe('reviewer');

    // And picking Reviewer never falls through to the counter: a counter-only
    // reference gets the same opaque refusal as a wrong secret.
    const noFallthrough = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: {
        role: 'reviewer',
        machine_identifier: 'HAN-IMPORT-01',
        machine_secret: 'pw',
        external_ref: 'op-b',
        operator_secret: 'pw',
      },
    });
    expect(noFallthrough.statusCode, noFallthrough.body).toBe(401);

    // A role this service does not know is refused, not treated as absent. A
    // typo or an older client silently getting whichever path matches is the
    // opposite of what an explicit choice is for.
    const nonsense = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { role: 'admin', external_ref: 'pax-01', operator_secret: 'pw' },
    });
    expect(nonsense.statusCode, nonsense.body).toBe(400);

    // And a client that sends no role at all still works, unchanged.
    const legacy = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { external_ref: 'pax-01', operator_secret: 'pw' },
    });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect(legacy.json().role).toBe('reviewer');
  });

  it('refuses to build a service with remote playback on and the cookie in clear', async () => {
    /**
     * `secureCookies` is off by default and that default is right for a pilot
     * upload centre: the LAN is plain HTTP and a `Secure` cookie is never sent
     * at all, which reads as a sign-in that does nothing. It is not right for a
     * service streaming raw footage to Shenzhen on a twelve-hour bearer cookie.
     *
     * The rule is in `buildApi` and not in `bin/serve.ts`, so an embedded
     * caller cannot assemble the insecure combination either — which is the
     * whole reason this asserts on the constructor rather than on a process.
     */
    const d = await db();
    expect(() => buildApi({ db: d, tokenSecret: SECRET, reviewerMediaEnabled: true })).toThrow(
      /secureCookies/,
    );
    // Both halves of the pair are fine on their own: an upload centre on plain
    // HTTP with no reviewer media, and a TLS deployment with it.
    expect(() => buildApi({ db: d, tokenSecret: SECRET })).not.toThrow();
    expect(() =>
      buildApi({ db: d, tokenSecret: SECRET, reviewerMediaEnabled: true, secureCookies: true }),
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // The invariants, in the schema — raw SQL, no application in the path

  it('refuses a verdict attributed to somebody who is not in the operators table', async () => {
    /**
     * `reviewer_ref` is the only record of who decided a payment, and it was
     * unconstrained text. It is now a real foreign key: a review cannot name a
     * reviewer that does not exist.
     */
    const h = await lane();
    const episodeId = (
      await h.send('POST', '/api/review/claim', undefined, h.reviewerHeaders)
    ).json().episode_id as string;
    await violates(
      'episode_reviews_reviewer_ref_operators_id_fk',
      h.d.execute(sql`
        update episode_reviews set reviewer_ref = ${uid()} where episode_id = ${episodeId}`),
    );
  });

  it('refuses a centre-less operator who is not a reviewer', async () => {
    const d = await db();
    await violates(
      'operators_centre_check',
      d.execute(sql`
        insert into operators (id, upload_centre_id, external_ref, role)
          values (${uid()}, null, 'stray', 'centre_operator')`),
    );
  });

  it('refuses a second reviewer holding the same reference', async () => {
    // `operators_ref_key` cannot see this: two null centres are distinct to a
    // unique index, so without the partial index a duplicate `pax-01` inserts
    // and sign-in picks whichever row comes back first.
    const d = await db();
    await d.execute(sql`
      insert into operators (id, upload_centre_id, external_ref, role)
        values (${uid()}, null, 'pax-01', 'reviewer')`);
    await violates(
      'operators_reviewer_ref_key',
      d.execute(sql`
        insert into operators (id, upload_centre_id, external_ref, role)
          values (${uid()}, null, 'pax-01', 'reviewer')`),
    );
  });

  it('still refuses a counter mutation that names no machine', async () => {
    // Making room for a reviewer relaxed `audit_events_attributed_check`. This
    // is the half that must not have moved: an operator's change still cannot
    // be recorded without the device it was made on.
    const d = await db();
    const centre = uid();
    const operator = uid();
    await d.execute(
      sql`insert into upload_centres (id, region, name, status) values (${centre}, 'HCM', 'c', 'active')`,
    );
    await d.execute(sql`
      insert into operators (id, upload_centre_id, external_ref, role)
        values (${operator}, ${centre}, 'op-x', 'centre_operator')`);
    await violates(
      'audit_events_attributed_check',
      d.execute(sql`
        insert into audit_events (action, target_table, target_id, actor_role, operator_id, upload_centre_id)
          values ('task.create', 'tasks', ${uid()}, 'operator', ${operator}, ${centre})`),
    );
  });

  it('refuses a reviewer audit row that carries a machine', async () => {
    /**
     * The other half of the exact-shape check. A reviewer row that also names
     * an upload device is evidence of somebody standing at a VNG counter who
     * was not there, and a loose "reviewer needs an operator_id" predicate
     * would have accepted it.
     */
    const d = await db();
    const centre = uid();
    const device = uid();
    const reviewer = uid();
    await d.execute(
      sql`insert into upload_centres (id, region, name, status) values (${centre}, 'HCM', 'c', 'active')`,
    );
    await d.execute(sql`
      insert into upload_devices (id, upload_centre_id, machine_identifier, status)
        values (${device}, ${centre}, 'HCM-IMPORT-09', 'active')`);
    await d.execute(sql`
      insert into operators (id, upload_centre_id, external_ref, role)
        values (${reviewer}, null, 'pax-09', 'reviewer')`);
    await violates(
      'audit_events_attributed_check',
      d.execute(sql`
        insert into audit_events (action, target_table, target_id, actor_role, operator_id, upload_device_id)
          values ('episode.review', 'episode_reviews', ${uid()}, 'reviewer', ${reviewer}, ${device})`),
    );
  });

  it('refuses an audit row that claims a role nobody has', async () => {
    const d = await db();
    await violates(
      'audit_events_actor_role_check',
      d.execute(sql`
        insert into audit_events (action, target_table, target_id, actor_role)
          values ('operator.login', 'operators', ${uid()}, 'admin')`),
    );
  });
});
