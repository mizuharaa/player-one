import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential } from '../src/index.ts';
import { closeDb, db, hasDb, truncate, useDatabase, violates } from '../../store/test/db.ts';
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
      insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${ids.reviewer}, null, 'pax-01', 'reviewer', ${hash})`);
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

    const app = buildApi({
      db: d,
      tokenSecret: SECRET,
      mediaRoot: options.mediaRoot,
      reviewerMediaEnabled: options.reviewerMediaEnabled,
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

    const session = await signIn('pax-01', 'pw');
    expect(session.statusCode, session.body).toBe(200);
    const setCookie = [session.headers['set-cookie'] ?? []].flat().join(' | ');
    const token = /po_operator=([^;]+)/.exec(setCookie)?.[1] ?? '';
    const reviewerHeaders: Record<string, string> = {
      authorization: `Bearer ${decodeURIComponent(token)}`,
    };

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

    return { d, app, ids, headersA, headersB, reviewerHeaders, send, signIn, cards };
  }

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
    const h = await harness();
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

  it('records a reviewer verdict as a reviewer, with no invented machine or centre', async () => {
    const h = await harness();
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

    // And the sign-in itself is a distinct action, not `operator.login`.
    const [login] = (await h.d.execute(sql`
      select action, actor_role, operator_id, upload_centre_id
        from audit_events where action = 'reviewer.login' order by id desc limit 1
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

  it('refuses a reviewer the raw footage by default and serves it only behind the flag', async () => {
    /**
     * Brief D11 records "whether background review requires online playback of
     * raw video" as unresolved and marked "Escalate — this is not a minor
     * detail", because it "decides whether reviewers stream video, and
     * therefore whether video leaves Vietnam in practice". Part 7.3: the Phase
     * 1 arrangement is "remote access, not data transfer", and that distinction
     * "must hold in the implementation, not just in the description".
     *
     * So this asserts a refusal, not a feature: a reviewer in Shenzhen gets the
     * metadata and no bytes until the flag is deliberately set.
     */
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const root = await mkdtemp(join(tmpdir(), 'playerone-reviewer-media-'));
    const basename = 'ego_AZER76400FE_20260813_072310';
    await mkdir(join(root, basename), { recursive: true });
    await writeFile(join(root, basename, 'left_part0001.mp4'), bytes);

    try {
      const off = await harness({ mediaRoot: root, basenameA: basename });
      const episodeId = (
        await off.send('POST', '/api/review/claim', undefined, off.reviewerHeaders)
      ).json().episode_id as string;

      // Metadata is fine: it carries no footage.
      const meta = await off.send(
        'GET',
        `/api/review/episode/${episodeId}`,
        undefined,
        off.reviewerHeaders,
      );
      expect(meta.statusCode, meta.body).toBe(200);
      expect(meta.json().media.parts[0].url).toBe(`/media/episode/${episodeId}/part/0`);

      // The bytes are not.
      const denied = await off.send(
        'GET',
        `/media/episode/${episodeId}/part/0`,
        undefined,
        off.reviewerHeaders,
      );
      expect(denied.statusCode, denied.body).toBe(403);

      // The VNG operator at the machine holding the file is unaffected.
      const allowed = await off.send(
        'GET',
        `/media/episode/${episodeId}/part/0`,
        undefined,
        off.headersA,
      );
      expect(allowed.statusCode, allowed.body).toBe(200);

      await truncate();

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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // The invariants, in the schema — raw SQL, no application in the path

  it('refuses a verdict attributed to somebody who is not in the operators table', async () => {
    /**
     * `reviewer_ref` is the only record of who decided a payment, and it was
     * unconstrained text. It is now a real foreign key: a review cannot name a
     * reviewer that does not exist.
     */
    const h = await harness();
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
