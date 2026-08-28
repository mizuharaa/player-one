import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { signToken } from '../src/credentials.ts';
import { buildApi } from '../src/index.ts';
import { STATE_SENTENCES, collectorStateOf, type CollectorState } from '../src/me.ts';
import { closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
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
    for (const issue of ['total_fractional', 'over_bank_ceiling', 'under_bank_minimum', 'over_cap', 'attempt_open'] as const) {
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
    db: d,
    tokenSecret: SECRET,
    payout: { mode: 'manual', zaloPayEnv: 'sandbox' },
    // Holds default to off (the pilot). On here, so the leak test actually
    // exercises the risk path instead of asserting about a code path that
    // never ran. With no flag planted the band is clear and nothing changes.
    risk: { holdsEnabled: true, engineEnabled: true, mediaRoot: undefined },
  });
  await app.ready();

  const asCollector = (collectorId: string) => ({
    authorization: `Bearer ${signToken(SECRET, { kind: 'collector', collectorId })}`,
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

  return { d, ids, app, asCollector, get, login, income, episodes };
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
        expect(paths).toContain('/api/me/income');
        expect(paths).not.toMatch(/\/api\/me\/[^\n]*:/);
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
