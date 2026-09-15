import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signToken } from '../src/credentials.ts';
import { buildApi } from '../src/index.ts';
import { STATE_SENTENCES, collectorStateOf, type CollectorState } from '../src/me.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
import { P1, seedAccount, seedBill, seedPayout, seedSettlement, uid } from './payout/domain/fixture.ts';

/**
 * The collector money read side.
 *
 * The four defects it exists to remove were measured on this branch against
 * `GET /api/payout/collectors/:id/income` before any of it was written:
 *
 *   1. a bill with no payout account reported `approved`
 *   2. a rejected episode reported `pending_review` for ever
 *   3. reviewed-not-yet-billed money reported `pending_review`
 *   4. a settlement parked in `exception` off a bill vanished: `periods: []`
 *
 * Each has a test below named for it.
 */

useDatabase('collector_me');

const SECRET = 'k';

// ---------------------------------------------------------------------------
// The pure half: no database, so it runs everywhere.

describe('the state vocabulary', () => {
  const base = {
    reviewState: 'pass',
    settlementState: 'bill_generated',
    superseded: false,
    disputeOpen: false,
    amount: '1200.0000',
    billIssues: [] as const,
    billPaid: false,
  };

  it('every state has a Vietnamese and an English sentence, and no Chinese', () => {
    // LOC-01 puts Vietnamese on the app; LOC-02 puts Chinese on the back
    // office, which is not this endpoint.
    for (const [state, text] of Object.entries(STATE_SENTENCES)) {
      expect(text.en.trim(), state).not.toBe('');
      expect(text.vi.trim(), state).not.toBe('');
      expect(Object.keys(text).sort()).toEqual(['en', 'vi']);
      // A Vietnamese sentence, not the English one copied across.
      expect(text.vi, state).not.toBe(text.en);
    }
  });

  it('no sentence names a reason code, a signal, a note or a person', () => {
    const forbidden = [
      'wrong_collector',
      'duplicate',
      'disputed',
      'manual_hold',
      'superseded',
      'SELF_DEALING',
      'REVIEW_TOO_FAST',
      'NEAR_DUPLICATE',
      'SHARED',
      'OPS.',
      'IDENT.',
      'CONT.',
      'reviewer',
      'risk',
    ];
    for (const [state, text] of Object.entries(STATE_SENTENCES)) {
      for (const word of forbidden) {
        expect(`${text.en} ${text.vi}`.toLowerCase(), `${state} / ${word}`).not.toContain(
          word.toLowerCase(),
        );
      }
    }
  });

  it('no verdict yet is "uploaded", whether the review row is absent or pending', () => {
    expect(collectorStateOf({ ...base, reviewState: null, settlementState: null })).toBe('uploaded');
    expect(collectorStateOf({ ...base, reviewState: 'pending', settlementState: null })).toBe('uploaded');
  });

  it('a rejected episode is "not_paid", never "uploaded" — defect 2', () => {
    // review_state 'fail' writes a 0.0000 settlement that stays in
    // pending_settlement for ever. It has been reviewed and it was refused.
    expect(
      collectorStateOf({
        ...base,
        reviewState: 'fail',
        settlementState: 'pending_settlement',
        amount: '0.0000',
      }),
    ).toBe('not_paid');
  });

  it('reviewed money not yet billed is "approved", never "uploaded" — defect 3', () => {
    expect(collectorStateOf({ ...base, settlementState: 'pending_settlement' })).toBe('approved');
  });

  it('a missing or unverified payout account is "action_needed" — defect 1', () => {
    expect(collectorStateOf({ ...base, billIssues: ['no_account'] })).toBe('action_needed');
    expect(collectorStateOf({ ...base, billIssues: ['account_unverified'] })).toBe('action_needed');
  });

  it('a risk hold and a parked line are both the neutral "on_hold"', () => {
    expect(collectorStateOf({ ...base, billIssues: ['risk_hold'] })).toBe('on_hold');
    expect(collectorStateOf({ ...base, billIssues: ['line_in_exception'] })).toBe('on_hold');
    expect(collectorStateOf({ ...base, settlementState: 'exception' })).toBe('on_hold');
  });

  it('our own backlog is "waiting_on_us" and says the collector need do nothing', () => {
    for (const issue of ['under_one_dong', 'over_bank_ceiling', 'under_bank_minimum', 'over_cap', 'attempt_open'] as const) {
      expect(collectorStateOf({ ...base, billIssues: [issue] }), issue).toBe('waiting_on_us');
    }
  });

  /**
   * The precedence, and why. A bill can trip several conditions at once, and
   * the collector should be told the one they can act on.
   */
  it('action_needed beats a hold: the fixable thing is the thing to say', () => {
    expect(collectorStateOf({ ...base, billIssues: ['risk_hold', 'no_account'] })).toBe('action_needed');
    expect(collectorStateOf({ ...base, billIssues: ['line_in_exception', 'account_unverified'] })).toBe('action_needed');
  });

  it('4e: a parked settlement keeps paid only when a succeeded attempt proves payment', () => {
    expect(collectorStateOf({ ...base, settlementState: 'exception', billPaid: true })).toBe('paid');
    expect(collectorStateOf({ ...base, settlementState: 'exception', billPaid: false })).toBe('on_hold');
  });

  it('paid beats everything', () => {
    expect(collectorStateOf({ ...base, billIssues: ['no_account'], billPaid: true })).toBe('paid');
    expect(collectorStateOf({ ...base, settlementState: 'manually_paid' })).toBe('paid');
  });

  it('an open dispute is "being_rechecked", and a superseded row "cannot_be_paid"', () => {
    expect(collectorStateOf({ ...base, disputeOpen: true })).toBe('being_rechecked');
    expect(collectorStateOf({ ...base, superseded: true })).toBe('cannot_be_paid');
  });

  /**
   * The safety property. An internal state added next year that nobody mapped
   * renders as "we are checking", never as a leak and never as a crash.
   */
  it('an unmapped internal state becomes "unknown" and still has a sentence', () => {
    const state = collectorStateOf({ ...base, settlementState: 'some_state_invented_in_2027' });
    expect(state).toBe('unknown');
    expect(STATE_SENTENCES[state].vi).not.toBe('');
  });

  it('a bill_generated line whose bill cannot be loaded is "unknown", never "on_a_bill"', () => {
    expect(collectorStateOf({ ...base, billIssues: null })).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// The database half.

async function signedIn() {
  const d = await db();
  const ids = await seedPayout(d);
  const app = buildApi({
    db: await appDb(),
    tokenSecret: SECRET,
    payout: { mode: 'manual', zaloPayEnv: 'sandbox' },
    // Holds default to off (the pilot). On here, so the leak test actually
    // exercises the risk path instead of asserting about a code path that
    // never ran. With no flag planted the band is clear and nothing changes.
    risk: { holdsEnabled: true, engineEnabled: true, mediaRoot: undefined },
  });
  await app.ready();

  const asCollector = (collectorId: string) => ({
    authorization: `Bearer ${signToken(SECRET, { kind: 'collector', collectorId, epoch: 1 })}`,
  });
  const get = async (url: string, headers: Record<string, string>) =>
    await app.inject({ method: 'GET', url, headers });
  const login = async (machine: string, operator: string) => {
    const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
    const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
    return { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
  };

  const income = async (collectorId: string) => {
    const r = await get('/api/me/income', asCollector(collectorId));
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const episodes = async (collectorId: string) => {
    const r = await get('/api/me/episodes', asCollector(collectorId));
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  const payout = async (collectorId: string) => {
    const r = await get('/api/me/payout', asCollector(collectorId));
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  /** The inbox, with whatever query string the paging test is proving. */
  const notifications = async (collectorId: string, query = '') => {
    const r = await get(`/api/me/notifications${query}`, asCollector(collectorId));
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { notifications: { id: string; kind: string; payload: Record<string, unknown>; created_at: string; read_at: string | null }[]; next: string | null };
  };
  const unread = async (collectorId: string) => {
    const r = await get('/api/me/notifications/unread-count', asCollector(collectorId));
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { unread: number };
  };
  /** The one write under `/api/me`, and the only one this file makes. */
  const markRead = async (collectorId: string, id: string) =>
    await app.inject({
      method: 'POST',
      url: `/api/me/notifications/${id}/read`,
      headers: asCollector(collectorId),
    });

  return { d, ids, app, asCollector, get, login, income, episodes, payout, notifications, unread, markRead };
}

/** A reviewed episode left in `pending_settlement` — reviewed, not yet billed. */
async function reviewed(
  d: Awaited<ReturnType<typeof db>>,
  ids: Awaited<ReturnType<typeof seedPayout>>,
  opts: { verdict: 'pass' | 'fail'; effectiveS: string; minutes: string; amount: string },
): Promise<{ episodeId: string; reviewId: string; settlementId: string }> {
  const episodeId = uid();
  const ingestId = uid();
  const reviewId = uid();
  const settlementId = uid();
  await d.execute(sql`
    insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at, ingest_count,
                          collection_session_id, resolution_state, upload_path)
      values (${episodeId}, 'AZER76400FE', '20260813_072310', now(), now(), 1, ${ids.session1}, 'resolved', 'C')
  `);
  await d.execute(sql`
    insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename, measured_duration_s,
                                 timing_source, timing_confidence, manifest_present, engine_version, host, ingested_at, record_json)
      values (${ingestId}, ${episodeId}, ${'f'.repeat(64)}, 'ok', 'ego_x', '600.000000',
              'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb)
  `);
  await d.execute(sql`insert into episode_files (ingest_id, relative_path, size_bytes, sha256) values (${ingestId}, 'a.mp4', 111, repeat('c', 64)), (${ingestId}, 'b.wav', 222, repeat('d', 64))`);
  await d.execute(sql`
    insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, effective_duration_s, review_state, reviewed_at, verdict_id)
      values (${reviewId}, ${episodeId}, ${ingestId}, '600.000000', ${opts.effectiveS}, ${opts.verdict}, now(), ${uid()})
  `);
  await d.execute(sql`
    insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes, amount, settlement_state)
      values (${settlementId}, ${reviewId}, ${ids.task}, ${ids.claim1}, '1200.0000', ${opts.minutes}, ${opts.amount}, 'pending_settlement')
  `);
  return { episodeId, reviewId, settlementId };
}

/** An episode uploaded and never reviewed. */
async function unreviewed(
  d: Awaited<ReturnType<typeof db>>,
  ids: Awaited<ReturnType<typeof seedPayout>>,
): Promise<string> {
  const episodeId = uid();
  const ingestId = uid();
  await d.execute(sql`
    insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at, ingest_count,
                          collection_session_id, resolution_state, upload_path)
      values (${episodeId}, 'AZER76400FE', '20260814_101500', now(), now(), 1, ${ids.session1}, 'resolved', 'C')
  `);
  await d.execute(sql`
    insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename, measured_duration_s,
                                 timing_source, timing_confidence, manifest_present, engine_version, host, ingested_at, record_json)
      values (${ingestId}, ${episodeId}, ${'e'.repeat(64)}, 'ok', 'ego_y', '123.000000',
              'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb)
  `);
  await d.execute(sql`insert into episode_files (ingest_id, relative_path, size_bytes, sha256) values (${ingestId}, 'a.mp4', 999, repeat('e', 64))`);
  return episodeId;
}

describe.skipIf(!hasDb())('GET /api/me/income and /api/me/episodes', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  // -------------------------------------------------------------------------
  // Who may ask, and for whom

  describe('the collector id comes from the token and appears nowhere else', () => {
    it('refuses an operator token on /api/me/', async () => {
      const h = await signedIn();
      try {
        const who = await h.login('HCM-01', 'fin-hcm');
        for (const url of ['/api/me/income', '/api/me/episodes']) {
          const r = await h.get(url, who);
          expect(r.statusCode, url).toBe(403);
        }
      } finally {
        await h.app.close();
      }
    });

    it('refuses a reviewer token on /api/me/', async () => {
      const h = await signedIn();
      try {
        const who = { authorization: `Bearer ${signToken(SECRET, { kind: 'reviewer', reviewerId: h.ids.opA })}` };
        const r = await h.get('/api/me/income', who);
        expect(r.statusCode).toBe(403);
      } finally {
        await h.app.close();
      }
    });

    it('refuses a collector token everywhere outside /api/me/', async () => {
      const h = await signedIn();
      try {
        const who = h.asCollector(h.ids.collector1);
        const r = await h.get(`/api/payout/collectors/${h.ids.collector2}/income`, who);
        expect(r.statusCode).toBe(403);
      } finally {
        await h.app.close();
      }
    });

    /**
     * The point of taking the id off the token: there is no id in the URL for
     * one collector to swap for another's, so the whole class of bug has no
     * route to occur on. This asserts the routes carry no id parameter at all.
     */
    it('answers only about the token holder, and has no id in its path', async () => {
      const h = await signedIn();
      try {
        await seedBill(h.d, h.ids, 1, P1, ['1200.0000'], '1200.0000');
        const mine = await h.income(h.ids.collector1);
        const theirs = await h.income(h.ids.collector2);
        expect(mine.episodes.length).toBe(1);
        expect(theirs.episodes.length).toBe(0);
        expect(theirs.periods.length).toBe(0);

        const paths = h.app.printRoutes({ commonPrefix: false });
        /**
         * The load-bearing half: no route under `/api/me` takes a path
         * parameter, so there is no id for a collector to edit.
         *
         * This used to assert the printed tree contained the literal string
         * `/api/me/income`. It did, until feat/collector-auth added
         * `GET /api/me` itself; fastify then prints `/income` as a child node
         * of `/api/me` and the full path never appears on one line. The route
         * is still there — the two calls above went through it — so what is
         * asserted here is the rule, not the shape of a debug printer.
         */
        const lines = paths.split(String.fromCharCode(10));
        const root = lines.findIndex((l) => l.includes('/api/me '));
        expect(root).toBeGreaterThanOrEqual(0);
        const depth = (l: string): number => l.search(/[a-z/]/i);
        const params: string[] = [];
        for (let n = root + 1; n < lines.length; n += 1) {
          const line = lines[n]!;
          if (line.trim() === '' || depth(line) <= depth(lines[root]!)) break;
          if (line.includes(':')) params.push(line.replace(/^[^a-z/]*/i, ''));
        }
        /**
         * Every path parameter under `/api/me`, and not one of them is a
         * collector id.
         *
         * This branch's rule was "no id in any path under /api/me", and it
         * was true when this branch was the only one registering routes
         * there. feat/path-a-upload added `GET /api/me/uploads/:id`, the
         * resume route, whose `:id` is a `collector_uploads.id`.
         *
         * That does not break the rule this test exists for. The rule is that
         * a collector cannot name somebody else, and an upload id is not a
         * collector id: that route looks the row up by id AND by the
         * collector off the token, and answers 404 for another collector's
         * upload rather than confirming it exists
         * (collector-upload.test.ts:678). What must never appear here is a
         * `:collectorId`, so that is what is asserted.
         *
         * feat/collector-routes added the second, `GET /api/me/tasks/:id`, and
         * the same argument covers it: a task id names a task and not a person,
         * and the row is read with the collector off the token in the same
         * query (`taskRows` in collector-app.ts), so a task the collector may
         * not see is not there rather than confirmed to exist.
         *
         * lane/notifications added the third, `POST /api/me/notifications/:id/read`,
         * and it is the first one that WRITES. The argument holds for the same
         * reason and one step harder: the `update` carries `collector_id = $me`
         * in its own WHERE, so there is no row for another collector to stamp
         * and no decision the handler makes after a read. It answers 404 rather
         * than 403 for a notification that is not the asker's, which is what
         * keeps it from being a membership oracle over every notification on
         * the platform (the two tests at the end of this file).
         *
         * The list stays EXACT rather than becoming "none of them says
         * collector". Both halves matter, and the exact half is the forcing
         * one: a fourth parameter should be somebody's decision in a diff, not a
         * line that slips past a predicate.
         */
        expect(params).toEqual(['/:id (GET, HEAD)', '/:id/read (POST)', '/:id (GET, HEAD)']);
        for (const line of params) expect(line.toLowerCase()).not.toContain('collector');
      } finally {
        await h.app.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // The four measured defects

  it('DEFECT 1: a bill with no payout account is action_needed, not approved', async () => {
    const h = await signedIn();
    try {
      await seedBill(h.d, h.ids, 1, P1, ['1200.0000'], '1200.0000');
      const body = await h.income(h.ids.collector1);
      expect(body.episodes[0].state).toBe('action_needed');
      // And it says how to fix it, in Vietnamese.
      expect(body.episodes[0].state_text.vi).toContain('ZaloPay');
      expect(body.periods[0].state).toBe('action_needed');
    } finally {
      await h.app.close();
    }
  });

  it('DEFECT 1b: with a verified account and nothing blocking, the same bill is on_a_bill', async () => {
    const h = await signedIn();
    try {
      await seedBill(h.d, h.ids, 1, P1, ['1200.0000'], '1200.0000');
      await seedAccount(h.d, h.ids, 1);
      const body = await h.income(h.ids.collector1);
      expect(body.episodes[0].state).toBe('on_a_bill');
    } finally {
      await h.app.close();
    }
  });

  it('DEFECT 2: a rejected episode is not_paid, not "awaiting review"', async () => {
    const h = await signedIn();
    try {
      await reviewed(h.d, h.ids, { verdict: 'fail', effectiveS: '0.000000', minutes: '0.000000', amount: '0.0000' });
      const body = await h.income(h.ids.collector1);
      expect(body.episodes[0].state).toBe('not_paid');
      expect(body.episodes[0].confirmed).toBe(true);
      expect(body.episodes[0].amount).toBe('0.0000');
    } finally {
      await h.app.close();
    }
  });

  it('DEFECT 3: reviewed money not yet billed is approved, not "awaiting review"', async () => {
    const h = await signedIn();
    try {
      await reviewed(h.d, h.ids, { verdict: 'pass', effectiveS: '600.000000', minutes: '10.000000', amount: '12000.0000' });
      const body = await h.income(h.ids.collector1);
      expect(body.episodes[0].state).toBe('approved');
      expect(body.not_yet_billed).toEqual({ episodes: 1, amount: '12000.0000' });
    } finally {
      await h.app.close();
    }
  });

  it('DEFECT 4: a settlement parked in exception still appears, as on_hold', async () => {
    const h = await signedIn();
    try {
      const s = await seedSettlement(h.d, h.ids, 1, '1200.0000');
      await h.d.execute(sql`
        update settlements
           set settlement_state = 'exception', exception_from_state = 'bill_generated',
               exception_reason = 'wrong_collector', exception_note = 'looks like c-0002 wore the device',
               updated_at = now()
         where id = ${s.settlementId}
      `);
      const body = await h.income(h.ids.collector1);
      // It exists. That is the fix: the episode does not vanish.
      expect(body.episodes.length).toBe(1);
      expect(body.episodes[0].episode_id).toBe(s.episodeId);
      expect(body.episodes[0].state).toBe('on_hold');
    } finally {
      await h.app.close();
    }
  });

  // -------------------------------------------------------------------------
  // Never send an estimate the server did not compute

  it('an un-reviewed episode has null minutes, price and amount, and a real raw duration', async () => {
    const h = await signedIn();
    try {
      await unreviewed(h.d, h.ids);
      const body = await h.income(h.ids.collector1);
      const row = body.episodes[0];
      expect(row.state).toBe('uploaded');
      expect(row.confirmed).toBe(false);
      expect(row.effective_minutes).toBeNull();
      expect(row.unit_price).toBeNull();
      expect(row.amount).toBeNull();
      // 123 s measured. Through `quantise`, the one rounding site.
      expect(row.raw_minutes).toBe('2.050000');
      expect(row.recorded_at).toBe('20260814_101500');
    } finally {
      await h.app.close();
    }
  });

  it('a reviewed episode reports the stored figures, and unit_price × effective_minutes reproduces amount', async () => {
    const h = await signedIn();
    try {
      await reviewed(h.d, h.ids, { verdict: 'pass', effectiveS: '600.000000', minutes: '10.000000', amount: '12000.0000' });
      const row = (await h.income(h.ids.collector1)).episodes[0];
      expect(row.confirmed).toBe(true);
      expect(row.raw_minutes).toBe('10.000000');
      expect(row.effective_minutes).toBe('10.000000');
      expect(row.unit_price).toBe('1200.0000');
      expect(Number(row.unit_price) * Number(row.effective_minutes)).toBe(Number(row.amount));
      expect(row.task_name).toBe('housework');
    } finally {
      await h.app.close();
    }
  });

  // -------------------------------------------------------------------------
  // QR-04 / APP-27: why the footage failed, in words the collector can act on

  it('a failed episode carries its reason codes with the Vietnamese label', async () => {
    const h = await signedIn();
    try {
      const r = await reviewed(h.d, h.ids, { verdict: 'fail', effectiveS: '0.000000', minutes: '0.000000', amount: '0.0000' });
      await h.d.execute(sql`insert into episode_review_reasons (review_id, code) values (${r.reviewId}, 'VQ-DARK'), (${r.reviewId}, 'DI-NO-IMU')`);
      const body = await h.episodes(h.ids.collector1);
      expect(body.episodes[0].state).toBe('not_paid');
      expect(body.episodes[0].reasons).toEqual([
        { code: 'DI-NO-IMU', label: 'Thiếu dữ liệu IMU' },
        { code: 'VQ-DARK', label: 'Quá tối' },
      ]);
      // Size of the latest delivery: 111 + 222.
      expect(body.episodes[0].size_bytes).toBe('333');
    } finally {
      await h.app.close();
    }
  });

  /**
   * The structural guarantee, stated as a test. An exception reason is not a
   * row in `review_reason_codes`, so the INNER JOIN that builds `reasons`
   * cannot produce a label for one even if somebody attaches it.
   */
  it('an exception reason can never appear as a failure reason: it is not in the catalogue', async () => {
    const h = await signedIn();
    try {
      const [row] = (await h.d.execute(sql`
        select count(*)::int as n from review_reason_codes
         where code in ('wrong_collector', 'duplicate', 'disputed', 'manual_hold', 'superseded')
      `)) as unknown as { n: number }[];
      expect(row!.n).toBe(0);
    } finally {
      await h.app.close();
    }
  });

  // -------------------------------------------------------------------------
  // THE LEAK TEST

  /**
   * Every forbidden value planted at once, then the whole serialized response
   * searched for each of them.
   *
   * This is the test that would fail if somebody widened a response type or
   * added a column to the SELECT. It is deliberately a string search over the
   * raw body rather than an assertion about fields, because the failure it
   * guards against is a field nobody thought to assert about.
   */
  it('leaks nothing: no exception reason, no note, no dispute text, no reviewer, no signal', async () => {
    const h = await signedIn();
    try {
      /**
       * A REAL risk hold on a real bill, raised by `OPS.SELF_DEALING` — a
       * finding about VNG's own staff, carrying evidence that names a second
       * person. The collector's bill is held by it and must be told nothing
       * about it beyond "on hold".
       */
      const heldBill = await seedBill(h.d, h.ids, 1, P1, ['1200.0000'], '1200.0000');
      await seedAccount(h.d, h.ids, 1);
      const runId = uid();
      for (const [signal, severity, points] of [
        ['META.EVALUATED', 'info', 0],
        ['OPS.SELF_DEALING', 'hold', 90],
        ['CONT.NEAR_DUPLICATE', 'review', 40],
      ] as const) {
        await h.d.execute(sql`
          insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence)
            values (${runId}, 'bill', ${heldBill}, ${signal}, 'v1', ${points}, ${severity},
                    ${JSON.stringify({ note: 'SENTINEL-RISK-EVIDENCE', other_collector: 'c-0002' })}::jsonb)
        `);
      }

      // A parked settlement carrying an accusation and an operator's note.
      const parked = await seedSettlement(h.d, h.ids, 1, '1200.0000');
      await h.d.execute(sql`
        update settlements
           set settlement_state = 'exception', exception_from_state = 'bill_generated',
               exception_reason = 'duplicate', exception_note = 'SENTINEL-NOTE-fraud-suspected',
               updated_at = now()
         where id = ${parked.settlementId}
      `);

      // A disputed episode, with the challenge text and a named reviewer.
      const disputed = await reviewed(h.d, h.ids, { verdict: 'fail', effectiveS: '0.000000', minutes: '0.000000', amount: '0.0000' });
      // `episode_reviews_lease_check`: naming a reviewer means naming the lease too.
      await h.d.execute(sql`
        update episode_reviews
           set reviewer_ref = ${h.ids.finA}, reviewer_note = 'SENTINEL-REVIEWER-NOTE',
               claimed_at = now(), lease_expires_at = now() + interval '1 hour'
         where id = ${disputed.reviewId}
      `);
      await h.d.execute(sql`
        insert into review_disputes (id, review_id, raised_by, reason)
          values (${uid()}, ${disputed.reviewId}, ${h.ids.opA}, 'SENTINEL-DISPUTE-TEXT')
      `);

      const bodies = [
        JSON.stringify(await h.income(h.ids.collector1)),
        JSON.stringify(await h.episodes(h.ids.collector1)),
      ].join('\n');

      for (const secret of [
        'SENTINEL-NOTE-fraud-suspected',
        'SENTINEL-DISPUTE-TEXT',
        'SENTINEL-REVIEWER-NOTE',
        'SENTINEL-RISK-EVIDENCE',
        'c-0002', // the other collector, named in the risk evidence
        'duplicate',
        'wrong_collector',
        'manual_hold',
        'exception_reason',
        'exception_note',
        'reviewer_ref',
        h.ids.finA, // the reviewer's identity
        h.ids.opA, // who raised the dispute
        'OPS.',
        'SELF_DEALING',
        'REVIEW_TOO_FAST',
        'NEAR_DUPLICATE',
        '_SHARED',
      ]) {
        expect(bodies, `leaked: ${secret}`).not.toContain(secret);
      }

      /**
       * And it still told the collector something true about every episode.
       * The bill held by `OPS.SELF_DEALING` reads `on_hold` — the neutral
       * bucket — rather than vanishing or naming the signal.
       */
      const states: CollectorState[] = (await h.income(h.ids.collector1)).episodes.map(
        (e: { state: CollectorState }) => e.state,
      );
      expect(states.sort()).toEqual(['being_rechecked', 'on_hold', 'on_hold']);
    } finally {
      await h.app.close();
    }
  });

  it('every state the endpoint can emit is one of the closed set', async () => {
    const h = await signedIn();
    try {
      await seedBill(h.d, h.ids, 1, P1, ['1200.0000'], '1200.0000');
      await reviewed(h.d, h.ids, { verdict: 'pass', effectiveS: '600.000000', minutes: '10.000000', amount: '12000.0000' });
      await unreviewed(h.d, h.ids);
      const known = new Set(Object.keys(STATE_SENTENCES));
      for (const body of [await h.income(h.ids.collector1), await h.episodes(h.ids.collector1)]) {
        for (const e of body.episodes) {
          expect(known.has(e.state), e.state).toBe(true);
          expect(e.state_text).toEqual(STATE_SENTENCES[e.state as CollectorState]);
        }
      }
    } finally {
      await h.app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// SPEC §14.1 and §14.2: the two fields the income screen was missing.

describe.skipIf(!hasDb())('the cycle total and the payout destination', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  /**
   * §14.1, the case the screen exists for: money finance has committed to, and
   * money a reviewer has approved that no bill has picked up yet.
   *
   * The two figures must not be the same number twice and must not be the same
   * rows counted twice. The bill's one line is 1,200; the reviewed-unbilled
   * episode is 12,000; the total is their sum and nothing else.
   *
   * The bounds come from the bill's own period, inclusive of its last day. P1
   * is `[17 Aug, 24 Aug)`, which is seven days ending on the 23rd — printing
   * `24/08` would tell the collector they were paid for eight.
   */
  it('a confirmed bill and a reviewed-unbilled episode give both figures and the bounds', async () => {
    const h = await signedIn();
    try {
      await seedBill(h.d, h.ids, 1, P1, ['1200.0000'], '1200.0000');
      await reviewed(h.d, h.ids, { verdict: 'pass', effectiveS: '600.000000', minutes: '10.000000', amount: '12000.0000' });

      const body = await h.income(h.ids.collector1);
      expect(body.cycle).toEqual({
        label: '17/08 – 23/08',
        confirmedVnd: '1200.0000',
        estimatedVnd: '12000.0000',
        totalVnd: '13200.0000',
      });
      // The card cannot contradict the list under it: `estimatedVnd` IS
      // `not_yet_billed.amount`, not a second query that agrees today.
      expect(body.cycle.estimatedVnd).toBe(body.not_yet_billed.amount);
    } finally {
      await h.app.close();
    }
  });

  /**
   * A collector who has recorded nothing. Zeros, not nulls and not an absent
   * object: the app is forbidden from computing a cycle, so a server that has
   * nothing to say still has to say zero in the server's own words.
   *
   * The label is empty because there is no bill, and there is therefore no
   * period the server can name. Inventing bounds for it would be the server
   * guessing at a cycle finance has not run.
   */
  it('a collector with nothing gets zeros, no bounds, and a payout status of none', async () => {
    const h = await signedIn();
    try {
      const body = await h.income(h.ids.collector1);
      expect(body.cycle).toEqual({
        label: '',
        confirmedVnd: '0.0000',
        estimatedVnd: '0.0000',
        totalVnd: '0.0000',
      });
      expect(await h.payout(h.ids.collector1)).toEqual({
        channel: 'zalopay',
        status: 'none',
        masked: null,
      });
    } finally {
      await h.app.close();
    }
  });

  /**
   * §14.2's three statuses.
   *
   * NOTE ON THE WORD: the spec names `verified | awaiting | none`, and that is
   * what this endpoint emits. A declared-but-unverified account is `awaiting`,
   * not `declared`, and there is no `refused`: `name_mismatch`, `locked`,
   * `kyc_limit` and `error` all reach the collector as `awaiting` too. The
   * collector's move is identical in every one of those cases — go to a
   * support point — and naming which refusal ZaloPay returned would relay what
   * the provider said about their identity.
   */
  it('a declared but unverified account is awaiting, and a verified one is verified', async () => {
    const h = await signedIn();
    try {
      const first = await seedAccount(h.d, h.ids, 1, { verifyStatus: 'unverified' });
      expect(await h.payout(h.ids.collector1)).toEqual({
        channel: 'zalopay',
        status: 'awaiting',
        // The redaction is the server's: a WALLET's phone is stored in full and
        // only its last four digits are selected, so there is no full
        // identifier in the response to leak.
        masked: '•••• 5678',
      });

      // The account history is append-only, so verification is a new current row.
      await h.d.execute(sql`update payout_accounts set is_current = false where id = ${first}`);
      await seedAccount(h.d, h.ids, 1);
      expect((await h.payout(h.ids.collector1)).status).toBe('verified');
    } finally {
      await h.app.close();
    }
  });

  it('every ZaloPay refusal is awaiting, never a word about what the provider said', async () => {
    const h = await signedIn();
    try {
      for (const status of ['name_mismatch', 'no_wallet', 'locked', 'kyc_limit', 'error']) {
        // `payout_accounts_append_only` refuses a delete — an account is
        // evidence — so each refusal is a new current row, which is what a
        // collector re-declaring their details actually produces.
        await h.d.execute(
          sql`update payout_accounts set is_current = false where collector_id = ${h.ids.collector1} and is_current`,
        );
        await seedAccount(h.d, h.ids, 1, { verifyStatus: status });
        const body = await h.payout(h.ids.collector1);
        expect(body.status, status).toBe('awaiting');
        expect(JSON.stringify(body), status).not.toContain(status);
      }
    } finally {
      await h.app.close();
    }
  });

  /**
   * The scoping test, in the shape that would actually catch a missing WHERE:
   * the other collector has everything and this one has nothing, so a query
   * that forgot the token's id would read as a full, plausible cycle here.
   */
  it("another collector's bill, unbilled money and account reach neither field", async () => {
    const h = await signedIn();
    try {
      await seedBill(h.d, h.ids, 2, P1, ['1200.0000'], '1200.0000');
      await seedAccount(h.d, h.ids, 2);

      const body = await h.income(h.ids.collector1);
      expect(body.cycle).toEqual({
        label: '',
        confirmedVnd: '0.0000',
        estimatedVnd: '0.0000',
        totalVnd: '0.0000',
      });
      expect(await h.payout(h.ids.collector1)).toEqual({
        channel: 'zalopay',
        status: 'none',
        masked: null,
      });

      // And the other collector still sees their own, so the scoping is a
      // filter and not an endpoint that answers nothing.
      expect((await h.income(h.ids.collector2)).cycle.confirmedVnd).toBe('1200.0000');
      expect((await h.payout(h.ids.collector2)).status).toBe('verified');
    } finally {
      await h.app.close();
    }
  });

  it('refuses an operator token, like every other route under /api/me', async () => {
    const h = await signedIn();
    try {
      const who = await h.login('HCM-01', 'fin-hcm');
      const r = await h.get('/api/me/payout', who);
      expect(r.statusCode).toBe(403);
    } finally {
      await h.app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The inbox.
//
// `notify()` and its call sites are covered by the suites of the events
// themselves — collector-upload, review, settle, payout, backoffice,
// collector-app. What is tested here is the read side: the order, the cursor,
// the scoping to the token holder, and the one write, which is the read stamp.

/** A row straight into the table, the shape `notify` writes. */
async function noted(
  d: Awaited<ReturnType<typeof db>>,
  collectorId: string,
  kind: string,
  opts: { payload?: Record<string, unknown>; at?: string } = {},
): Promise<string> {
  const id = uid();
  await d.execute(sql`
    insert into collector_notifications (id, collector_id, kind, payload, source_table, source_id, created_at)
      values (${id}, ${collectorId}, ${kind}, ${JSON.stringify(opts.payload ?? {})}::jsonb,
              'episode_reviews', ${id},
              ${opts.at ?? new Date().toISOString()}::timestamptz)
  `);
  return id;
}

describe.skipIf(!hasDb())('GET /api/me/notifications', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('pages by the (created_at, id) pair, so a shared instant loses no row', async () => {
    const h = await signedIn();
    try {
      // Three rows sharing ONE instant to the microsecond, which is what
      // notifications written in one transaction look like. A cursor on
      // `created_at` alone drops whichever of them lands on a page boundary.
      const at = '2026-09-10T03:00:00.000000Z';
      const ids = [
        await noted(h.d, h.ids.collector1, 'upload_verified', { at }),
        await noted(h.d, h.ids.collector1, 'upload_ingested', { at }),
        await noted(h.d, h.ids.collector1, 'review_passed', { at }),
      ];

      const first = await h.notifications(h.ids.collector1, '?limit=2');
      expect(first.notifications.length).toBe(2);
      expect(first.next).toBe(first.notifications[1]!.id);

      const second = await h.notifications(h.ids.collector1, `?limit=2&after=${first.next!}`);
      expect(second.notifications.length).toBe(1);
      expect(second.next).toBeNull();

      // Every row appeared exactly once across the two pages.
      const seen = [...first.notifications, ...second.notifications].map((n) => n.id);
      expect([...seen].sort()).toEqual([...ids].sort());

      // And the order inside the shared instant is stable, which is what makes
      // the paging repeatable rather than accidentally correct once.
      const all = await h.notifications(h.ids.collector1);
      expect(all.notifications.map((n) => n.id)).toEqual(seen);
    } finally {
      await h.app.close();
    }
  });

  it('is newest first, and the payload arrives as the object it was stored as', async () => {
    const h = await signedIn();
    try {
      await noted(h.d, h.ids.collector1, 'bill_issued', {
        at: '2026-09-01T00:00:00Z',
        payload: { bill_id: 'b-1', total: '1200.0000', currency: 'VND' },
      });
      const newer = await noted(h.d, h.ids.collector1, 'payment_recorded', {
        at: '2026-09-08T00:00:00Z',
        payload: { attempt_id: 'a-1', amount_vnd: '1200', reference: null },
      });

      const r = await h.notifications(h.ids.collector1);
      expect(r.notifications.map((n) => n.kind)).toEqual(['payment_recorded', 'bill_issued']);
      expect(r.notifications[0]!.id).toBe(newer);
      // The stored figure, as the string the column holds. Nothing rounded it
      // and nothing added it to anything.
      expect(r.notifications[0]!.payload).toEqual({ attempt_id: 'a-1', amount_vnd: '1200', reference: null });
      expect(r.notifications[0]!.read_at).toBeNull();
    } finally {
      await h.app.close();
    }
  });

  it("answers about the token holder only, and another collector's cursor pages from the top", async () => {
    const h = await signedIn();
    try {
      const mine = await noted(h.d, h.ids.collector1, 'claim_accepted');
      const theirs = await noted(h.d, h.ids.collector2, 'claim_accepted');

      const one = await h.notifications(h.ids.collector1);
      const two = await h.notifications(h.ids.collector2);
      expect(one.notifications.map((n) => n.id)).toEqual([mine]);
      expect(two.notifications.map((n) => n.id)).toEqual([theirs]);

      /**
       * A cursor copied out of somebody else's inbox is not an error and not a
       * window into it: the cursor row is read under the asking collector's own
       * id, finds nothing, and the page comes back from the top. A stale cursor
       * is an ordinary thing for a phone to hold.
       */
      const withTheirs = await h.notifications(h.ids.collector1, `?after=${theirs}`);
      expect(withTheirs.notifications.map((n) => n.id)).toEqual([mine]);
    } finally {
      await h.app.close();
    }
  });

  it('refuses an operator token and a reviewer token, like every other route under /api/me', async () => {
    const h = await signedIn();
    try {
      const operator = await h.login('HCM-01', 'fin-hcm');
      const reviewer = { authorization: `Bearer ${signToken(SECRET, { kind: 'reviewer', reviewerId: h.ids.opA })}` };
      for (const who of [operator, reviewer]) {
        for (const url of ['/api/me/notifications', '/api/me/notifications/unread-count']) {
          expect((await h.get(url, who)).statusCode, url).toBe(403);
        }
      }
    } finally {
      await h.app.close();
    }
  });

  it("counts only the collector's own unread rows", async () => {
    const h = await signedIn();
    try {
      const a = await noted(h.d, h.ids.collector1, 'upload_verified');
      await noted(h.d, h.ids.collector1, 'upload_ingested');
      await noted(h.d, h.ids.collector2, 'upload_verified');
      expect(await h.unread(h.ids.collector1)).toEqual({ unread: 2 });
      expect(await h.unread(h.ids.collector2)).toEqual({ unread: 1 });

      await h.markRead(h.ids.collector1, a);
      expect(await h.unread(h.ids.collector1)).toEqual({ unread: 1 });
      expect(await h.unread(h.ids.collector2)).toEqual({ unread: 1 });
    } finally {
      await h.app.close();
    }
  });

  it('stamps read once: a second tap keeps the first instant', async () => {
    const h = await signedIn();
    try {
      const id = await noted(h.d, h.ids.collector1, 'review_failed');
      const first = await h.markRead(h.ids.collector1, id);
      expect(first.statusCode, first.body).toBe(200);
      const stamped = first.json().read_at as string;
      expect(stamped).not.toBeNull();

      const second = await h.markRead(h.ids.collector1, id);
      expect(second.statusCode).toBe(200);
      // "When did they see it" is evidence about a person's attention, and a
      // double tap must not rewrite it.
      expect(second.json().read_at).toBe(stamped);
      expect(await h.unread(h.ids.collector1)).toEqual({ unread: 0 });
    } finally {
      await h.app.close();
    }
  });

  it("is a 404 for another collector's row and for an id that is not a uuid, never a 403", async () => {
    const h = await signedIn();
    try {
      const theirs = await noted(h.d, h.ids.collector2, 'bill_issued');

      /**
       * 403 would confirm the id exists, which is a membership oracle over
       * every notification on the platform. And the row stays unread for the
       * collector it belongs to, so the refusal is a refusal and not a
       * half-applied write.
       */
      expect((await h.markRead(h.ids.collector1, theirs)).statusCode).toBe(404);
      expect(await h.unread(h.ids.collector2)).toEqual({ unread: 1 });

      // An unparseable uuid would reach Postgres as a cast error and read as a
      // 500 on a request that was only ever malformed.
      expect((await h.markRead(h.ids.collector1, 'not-a-uuid')).statusCode).toBe(404);
      expect((await h.markRead(h.ids.collector1, uid())).statusCode).toBe(404);
    } finally {
      await h.app.close();
    }
  });
});
