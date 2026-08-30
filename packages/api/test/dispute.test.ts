import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { open } from '@playerone/store';
import { buildApi, hashCredential } from '../src/index.ts';
import { appDb, closeDb, db, dbUrl, hasDb, liveClaim, truncate, useDatabase, violates } from '../../store/test/db.ts';
import { episodeRecord } from './fixtures.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('dispute');

/**
 * QR-08: dispute and second review.
 *
 * Every guard is exercised in raw SQL with no route in the path, and the money
 * outcome is proved end to end: a second verdict that agrees leaves one
 * settlement; one that differs leaves two, the first parked where no bill can
 * reach it, and one cycle bills the second exactly once.
 *
 * Two centres, two collectors, two cards, two tasks at two prices — the shape
 * that showed the resolver's payment bug, and here the shape that shows a
 * dispute holds back ONE collector's line and not the cycle.
 */

const SECRET = 'k';
const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

type Headers = Record<string, string>;

describe.skipIf(!hasDb())('dispute and second review', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function harness() {
    const d = await db();
    const ids = {
      centreA: uid(),
      centreB: uid(),
      machineA: uid(),
      machineB: uid(),
      /** Two reviewers at centre A — the first verdict and the second must come from different people. */
      opA: uid(),
      opA2: uid(),
      opB: uid(),
      /** A PaXini reviewer: no centre, and no business raising a dispute. */
      paxini: uid(),
      collector1: uid(),
      collector2: uid(),
      deviceType: uid(),
      device1: uid(),
      device2: uid(),
      taskHousework: uid(),
      taskFactory: uid(),
      scenario: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centreA}, 'HCM', 'District 7', 'active'), (${ids.centreB}, 'HAN', 'Cau Giay', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values (${ids.machineA}, ${ids.centreA}, 'HCM-01', 'active', ${hash}), (${ids.machineB}, ${ids.centreB}, 'HAN-01', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.opA}, ${ids.centreA}, 'op-a', 'centre_operator', ${hash}), (${ids.opA2}, ${ids.centreA}, 'op-a2', 'centre_operator', ${hash}), (${ids.opB}, ${ids.centreB}, 'op-b', 'centre_operator', ${hash}), (${ids.paxini}, null, 'pax-01', 'reviewer', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector1}, 'c-0001', 'qualified'), (${ids.collector2}, 'c-0002', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego_headset', 'gen1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device1}, ${ids.deviceType}, 'AZER76400FE', 'active'), (${ids.device2}, ${ids.deviceType}, 'BZER76400FF', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.taskHousework}, 'housework', 1200, 5, 'published'), (${ids.taskFactory}, 'factory', 900, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
    const since = new Date(T - 30 * 24 * 60 * 60_000).toISOString();
    await d.execute(sql`insert into device_assignments (id, device_id, collector_id, valid_from) values (${uid()}, ${ids.device1}, ${ids.collector1}, ${since}), (${uid()}, ${ids.device2}, ${ids.collector2}, ${since})`);

    const app = buildApi({ db: await appDb(), tokenSecret: SECRET });
    await app.ready();

    const login = async (machine: string, operator: string): Promise<Headers> => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
      return { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
    };
    const A = await login('HCM-01', 'op-a');
    const A2 = await login('HCM-01', 'op-a2');
    const B = await login('HAN-01', 'op-b');

    /**
     * A reviewer signs in through the console's own route and carries only the
     * one token it sets — no machine, no centre. Read out of the cookie rather
     * than minted here, so the test fails if sign-in stops issuing one.
     */
    const session = await app.inject({ method: 'POST', url: '/api/session', payload: { external_ref: 'pax-01', operator_secret: 'pw' } });
    expect(session.statusCode, session.body).toBe(200);
    const cookie = [session.headers['set-cookie'] ?? []].flat().join(' | ');
    const PAX: Headers = { authorization: `Bearer ${decodeURIComponent(/po_operator=([^;]+)/.exec(cookie)?.[1] ?? '')}` };

    const send = async (method: 'POST' | 'GET', url: string, payload?: unknown, who: Headers = A): Promise<LightMyRequestResponse> =>
      (await app.inject({ method, url, payload: payload as never, headers: who })) as unknown as LightMyRequestResponse;

    /** One card at one centre carrying one 60-second episode for one collector. */
    const card = async (who: Headers, collectorId: string, deviceId: string, taskId: string, serial: string, tf: string) => {
      const handover = uid();
      await send('POST', '/handovers', { id: handover, collector_id: collectorId, device_id: deviceId, tf_card_id: tf, handover_time: new Date(T).toISOString() }, who);
      const batch = uid();
      await send('POST', '/upload-batches', { id: batch, handover_id: handover, import_started_at: new Date(T).toISOString() }, who);
      const declared = await send('POST', `/handovers/${handover}/sessions`, { id: uid(), task_id: taskId, scenario_id: ids.scenario, others_in_frame: false, sensitive_info_present: false, prepare_time: new Date(T - 60_000).toISOString() }, who);
      // Asserted rather than assumed: a refusal here leaves the episode with no
      // session to resolve against, and the failure surfaces four lines down as
      // an unexplained `quarantined`.
      expect(declared.statusCode, declared.body).toBeLessThan(300);
      const submitted = await send('POST', `/upload-batches/${batch}/episodes`, { episodes: [episodeRecord({ measured: 60, serial })] }, who);
      expect(submitted.statusCode, submitted.body).toBe(200);
      const [e] = submitted.json().episodes as { episode_id: string; resolution_state: string }[];
      expect(e!.resolution_state).toBe('resolved');
      return e!.episode_id;
    };
    // Since 0016_claim_join the counter refuses a session whose collector holds
    // no live claim on the task (`session_claim_missing`).
    await liveClaim(d, ids.taskHousework, ids.collector1);
    await liveClaim(d, ids.taskFactory, ids.collector2);
    const episode1 = await card(A, ids.collector1, ids.device1, ids.taskHousework, 'AZER76400FE', 'CARD-1');
    const episode2 = await card(B, ids.collector2, ids.device2, ids.taskFactory, 'BZER76400FF', 'CARD-2');

    const claimIn = (lane: string | null, who: Headers) =>
      send('POST', lane === null ? '/api/review/claim' : `/api/review/claim?queue=${lane}`, undefined, who);
    const verdict = (who: Headers, episodeId: string, decision: string, spans: unknown[] = []) =>
      send('POST', '/api/review/verdict', { verdict_id: uid(), episode_id: episodeId, decision, spans, reject_reasons: decision === 'bad' ? ['VQ-DARK'] : [] }, who);

    /** op-a reviews both episodes `good`: 60 s at 1200 is 1200.0000, at 900 is 900.0000. */
    const firstVerdicts = async () => {
      const reviews = new Map<string, string>();
      for (;;) {
        const claimed = await claimIn(null, A);
        if (claimed.statusCode === 204) break;
        expect(claimed.statusCode, claimed.body).toBe(200);
        const v = await verdict(A, claimed.json().episode_id, 'good');
        expect(v.statusCode, v.body).toBe(200);
        reviews.set(claimed.json().episode_id, v.json().review_id);
      }
      expect(reviews.size).toBe(2);
      return reviews;
    };

    const dispute = (reviewId: string, who: Headers = A, reason = 'collector says the whole recording is usable') =>
      send('POST', '/api/review/dispute', { review_id: reviewId, reason }, who);

    const settlementsOf = async (reviewId: string) =>
      (await d.execute(sql`select id, settlement_state, amount, superseded_by from settlements where episode_review_id = ${reviewId}`)) as unknown as
        { id: string; settlement_state: string; amount: string; superseded_by: string | null }[];

    return { d, app, ids, A, A2, B, PAX, send, episode1, episode2, claimIn, verdict, firstVerdicts, dispute, settlementsOf };
  }

  const START = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const period = () => ({ period_start: START.toISOString() });

  // -------------------------------------------------------------------------

  describe('raising', () => {
    it('writes the dispute and a pending second review, audits it, and moves no money', async () => {
      const h = await harness();
      const reviews = await h.firstVerdicts();
      const reviewId = reviews.get(h.episode1)!;
      const before = await h.settlementsOf(reviewId);

      const res = await h.dispute(reviewId);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().episode_id).toBe(h.episode1);
      expect(res.json().queue).toBe('second_review');

      const after = await h.settlementsOf(reviewId);
      expect(after).toEqual(before);
      expect(after[0]!.settlement_state).toBe('pending_settlement');

      const second = (await h.d.execute(sql`
        select review_state, queue, reviewer_ref, dispute_id from episode_reviews where id = ${res.json().second_review_id}
      `)) as unknown as { review_state: string; queue: string; reviewer_ref: string | null; dispute_id: string }[];
      expect(second[0]).toEqual({ review_state: 'pending', queue: 'second_review', reviewer_ref: null, dispute_id: res.json().dispute_id });

      const audit = (await h.d.execute(sql`
        select target_id, reason, operator_id, after from audit_events where action = 'review.dispute'
      `)) as unknown as { target_id: string; reason: string; operator_id: string; after: Record<string, unknown> }[];
      expect(audit).toHaveLength(1);
      expect(audit[0]!.target_id).toBe(res.json().dispute_id);
      expect(audit[0]!.operator_id).toBe(h.ids.opA);
      expect(audit[0]!.reason).toBe('collector says the whole recording is usable');
      expect(audit[0]!.after['episode_id']).toBe(h.episode1);
    });

    it('refuses a second open dispute on the same verdict, by the constraint', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      expect((await h.dispute(reviewId)).statusCode).toBe(200);
      const again = await h.dispute(reviewId, h.A2);
      expect(again.statusCode, again.body).toBe(409);
      expect(again.json()).toEqual({ error: 'refused', constraint: 'review_disputes_open_key' });
      const rows = (await h.d.execute(sql`select count(*)::int as n from review_disputes`)) as unknown as { n: number }[];
      expect(rows[0]!.n).toBe(1);
    });

    it('refuses a review that is not decided, a review id that names nothing, and a reviewer session', async () => {
      const h = await harness();
      const claimed = await h.claimIn(null, h.A);
      const pending = (await h.d.execute(sql`select id from episode_reviews where episode_id = ${claimed.json().episode_id}`)) as unknown as { id: string }[];
      const res = await h.dispute(pending[0]!.id);
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('review_disputes_decided_check');
      expect((await h.dispute(uid())).statusCode).toBe(404);
      expect((await h.send('POST', '/api/review/dispute', { review_id: pending[0]!.id, reason: '' })).statusCode).toBe(400);
      // The reviewer session the title names: a dispute is the centre's act.
      const asReviewer = await h.dispute(pending[0]!.id, h.PAX);
      expect(asReviewer.statusCode, asReviewer.body).toBe(403);
      expect(asReviewer.json().error).toContain('upload centre');
    });

    it("refuses another centre's review with the same 404 as an id that names nothing (SEC-02)", async () => {
      const h = await harness();
      const reviews = await h.firstVerdicts();
      // c-0001 handed in at HCM; op-b works at HAN.
      const foreign = await h.dispute(reviews.get(h.episode1)!, h.B);
      expect(foreign.statusCode, foreign.body).toBe(404);
      expect(foreign.json()).toEqual({ error: 'no such review' });
      const rows = (await h.d.execute(sql`select count(*)::int as n from review_disputes`)) as unknown as { n: number }[];
      expect(rows[0]!.n).toBe(0);
      // op-b's own centre's collector is still theirs to dispute for.
      expect((await h.dispute(reviews.get(h.episode2)!, h.B)).statusCode).toBe(200);
    });
  });

  describe('the second-review lane', () => {
    it('is offered to anyone but the original reviewer, and to nobody in the standard lane', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      await h.dispute(reviewId);

      // Nothing standard is left, and the disputed episode is not smuggled in.
      expect((await h.claimIn(null, h.A2)).statusCode).toBe(204);
      // The original reviewer asks for the lane by name and gets nothing.
      expect((await h.claimIn('second_review', h.A)).statusCode).toBe(204);
      // And the peek says the same. A prefetch that warmed this reviewer's own
      // verdict, for a claim that will always answer 204, is the two disagreeing.
      expect((await h.send('GET', '/api/review/next?queue=second_review', undefined, h.A)).statusCode).toBe(204);
      expect((await h.send('GET', '/api/review/next?queue=second_review', undefined, h.A2)).statusCode).toBe(200);
      // A colleague gets the disputed episode.
      const second = await h.claimIn('second_review', h.A2);
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json().episode_id).toBe(h.episode1);
      expect(second.json().queue).toBe('second_review');
      expect(second.json().queue_depth).toBe(0);
    });
  });

  describe('the second verdict', () => {
    it('agreeing closes the dispute upheld and leaves the original settlement standing alone', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      const raised = await h.dispute(reviewId);
      await h.claimIn('second_review', h.A2);
      const v = await h.verdict(h.A2, h.episode1, 'good');
      expect(v.statusCode, v.body).toBe(200);
      expect(v.json().amount).toBe('1200.0000');

      const d = (await h.d.execute(sql`select outcome, resolved_at from review_disputes where id = ${raised.json().dispute_id}`)) as unknown as { outcome: string; resolved_at: Date }[];
      expect(d[0]!.outcome).toBe('upheld');
      expect(d[0]!.resolved_at).not.toBeNull();

      const all = (await h.d.execute(sql`
        select s.settlement_state, s.amount, s.superseded_by, r.dispute_id
          from settlements s join episode_reviews r on r.id = s.episode_review_id
         join episodes e on e.episode_id = r.episode_id
         where e.episode_id = ${h.episode1}
      `)) as unknown as { settlement_state: string; amount: string; superseded_by: string | null; dispute_id: string | null }[];
      expect(all).toEqual([{ settlement_state: 'pending_settlement', amount: '1200.0000', superseded_by: null, dispute_id: null }]);

      const audit = (await h.d.execute(sql`select after from audit_events where action = 'episode.review' and target_id = ${raised.json().second_review_id}`)) as unknown as { after: Record<string, unknown> }[];
      expect(audit[0]!.after['outcome']).toBe('upheld');
      expect(audit[0]!.after['dispute_id']).toBe(raised.json().dispute_id);
    });

    /**
     * The refusal that strands an episode, and the way out of it (0017).
     *
     * This is a real loop and not a hypothetical one. The bill generator can
     * issue the disputed settlement while the dispute is open, and when it has,
     * the second verdict cannot replace it — the route answers 409
     * `review_billed_while_disputed` and writes nothing. The second review row
     * stays `pending` and stays eligible, so the lease runs out, the takeover
     * hands the same episode to the next reviewer in the lane, and they meet the
     * same refusal. The first half of this test measures that loop; the second
     * half proves the park ends it.
     */
    it('a refusal the reviewer cannot answer strands the episode until it is parked', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      await h.dispute(reviewId);
      // The dispute is open; the generator issues the bill anyway. This is the
      // ordering `review_disputes_unbilled_check` cannot prevent, because it
      // gates raising a dispute and not billing one.
      await h.d.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where episode_review_id = ${reviewId}`);

      const first = await h.claimIn('second_review', h.A2);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().episode_id).toBe(h.episode1);
      // A verdict that DIFFERS from the first is the one that has to replace
      // the settlement, and the settlement is already on a bill. 30 s of the
      // 60 s recording, where the first reviewer passed the whole of it.
      const half = [{ start_seconds: 0, end_seconds: 30 }];
      const refused = await h.verdict(h.A2, h.episode1, 'partial', half);
      expect(refused.statusCode, refused.body).toBe(409);
      // Named, so the console can print a sentence instead of the lease banner.
      expect(refused.json().constraint).toBe('review_billed_while_disputed');
      expect(refused.json().error).not.toBe('reassigned');

      // THE LOOP. The reviewer gives the episode back and it comes straight
      // out of the queue again, to be refused again. Nothing in the lane ends
      // this: the only other exit is a `bad` verdict, which pays 0 for footage
      // nobody could judge.
      expect((await h.send('POST', `/api/review/release/${h.episode1}`, undefined, h.A2)).statusCode).toBe(200);
      const again = await h.claimIn('second_review', h.A2);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().episode_id).toBe(h.episode1);
      expect((await h.verdict(h.A2, h.episode1, 'partial', half)).statusCode).toBe(409);

      // THE EXIT. The reviewer sends it back to the counter with a reason.
      const parked = await h.send(
        'POST',
        `/api/review/hold/${h.episode1}`,
        { reason: 'the settlement was billed while the challenge was open' },
        h.A2,
      );
      expect(parked.statusCode, parked.body).toBe(200);
      expect(parked.json().queue).toBe('held');
      expect((await h.claimIn('second_review', h.A2)).statusCode).toBe(204);

      // Nothing was paid and nothing was decided by parking it.
      const rows = (await h.d.execute(sql`
        select review_state, queue from episode_reviews where episode_id = ${h.episode1} and dispute_id is not null
      `)) as unknown as { review_state: string; queue: string }[];
      expect(rows).toEqual([{ review_state: 'pending', queue: 'held' }]);
      const money = (await h.d.execute(sql`
        select count(*)::int as n from settlements s join episode_reviews r on r.id = s.episode_review_id
         where r.episode_id = ${h.episode1}
      `)) as unknown as { n: number }[];
      expect(money[0]!.n).toBe(1);
    });

    /**
     * The park is a reviewer's own action, because the sentence that tells them
     * to send it back is shown to them. Everything else on that route stays an
     * upload-centre decision (BO-15).
     */
    it('a PaXini reviewer may park an episode but not take it back out', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      await h.dispute(reviewId);
      await h.d.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where episode_review_id = ${reviewId}`);
      // Reviewer media is off by default (brief D11), so a reviewer session
      // cannot claim here; the refusal is proved in the test above and this
      // one is about who may move the row.
      const parked = await h.send(
        'POST',
        `/api/review/hold/${h.episode1}`,
        { reason: 'billed while the challenge was open' },
        h.PAX,
      );
      expect(parked.statusCode, parked.body).toBe(200);

      // Deciding the thing the refusal named is fixed is not theirs to make.
      const back = await h.send(
        'POST',
        `/api/review/hold/${h.episode1}`,
        { queue: 'second_review', reason: 'looks fine now' },
        h.PAX,
      );
      expect(back.statusCode, back.body).toBe(403);

      // An operator can, and the SAME row comes back rather than a new one.
      const released = await h.send(
        'POST',
        `/api/review/hold/${h.episode1}`,
        { queue: 'second_review', reason: 'the bill line was reversed' },
        h.A,
      );
      expect(released.statusCode, released.body).toBe(200);
      expect(released.json().queue).toBe('second_review');
      expect((await h.claimIn('second_review', h.A2)).json().episode_id).toBe(h.episode1);
    });

    it('differing supersedes the original and one cycle bills the new settlement exactly once', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      const raised = await h.dispute(reviewId);
      await h.claimIn('second_review', h.A2);
      // Half the recording: 30 s at 1200 a minute is 600.0000, not 1200.0000.
      const v = await h.verdict(h.A2, h.episode1, 'partial', [{ start_seconds: 0, end_seconds: 30 }]);
      expect(v.statusCode, v.body).toBe(200);
      expect(v.json().amount).toBe('600.0000');

      const original = await h.settlementsOf(reviewId);
      const replacement = await h.settlementsOf(raised.json().second_review_id);
      expect(replacement).toHaveLength(1);
      expect(replacement[0]!.settlement_state).toBe('pending_settlement');
      expect(replacement[0]!.amount).toBe('600.0000');
      expect(original[0]!.settlement_state).toBe('exception');
      expect(original[0]!.superseded_by).toBe(replacement[0]!.id);
      // The frozen figures on the original did not move.
      expect(original[0]!.amount).toBe('1200.0000');

      const d = (await h.d.execute(sql`select outcome from review_disputes where id = ${raised.json().dispute_id}`)) as unknown as { outcome: string }[];
      expect(d[0]!.outcome).toBe('overturned');

      const bills = await h.send('POST', '/api/settle/bills', period());
      expect(bills.statusCode, bills.body).toBe(200);
      expect(bills.json().created).toBe(2);
      const byRef = new Map((bills.json().bills as { collector_ref: string; total: string; lines: number }[]).map((b) => [b.collector_ref, b]));
      expect(byRef.get('c-0001')).toMatchObject({ total: '600.0000', lines: 1 });
      expect(byRef.get('c-0002')).toMatchObject({ total: '900.0000', lines: 1 });

      const again = await h.send('POST', '/api/settle/bills', period());
      expect(again.json().created).toBe(0);
      const lines = (await h.d.execute(sql`select settlement_id from bill_lines`)) as unknown as { settlement_id: string }[];
      expect(lines.map((l) => l.settlement_id).sort()).not.toContain(original[0]!.id);
      expect(lines).toHaveLength(2);
      expect(lines.map((l) => l.settlement_id)).toContain(replacement[0]!.id);
    });
  });

  describe('billing', () => {
    it('skips a settlement under open dispute and bills the other collector', async () => {
      const h = await harness();
      const reviews = await h.firstVerdicts();
      await h.dispute(reviews.get(h.episode1)!);

      const bills = await h.send('POST', '/api/settle/bills', period());
      expect(bills.statusCode, bills.body).toBe(200);
      expect(bills.json().created).toBe(1);
      expect((bills.json().bills as { collector_ref: string }[]).map((b) => b.collector_ref)).toEqual(['c-0002']);
      const held = await h.settlementsOf(reviews.get(h.episode1)!);
      expect(held[0]!.settlement_state).toBe('pending_settlement');
    });
  });

  // -------------------------------------------------------------------------

  describe('the guards, in raw SQL', () => {
    it('one open dispute per review; a closed one makes room for the next', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      const first = uid();
      await h.d.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${first}, ${reviewId}, ${h.ids.opA}, 'x')`);
      await violates('review_disputes_open_key', h.d.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${uid()}, ${reviewId}, ${h.ids.opB}, 'y')`));
      await h.d.execute(sql`update review_disputes set resolved_at = now(), outcome = 'upheld' where id = ${first}`);
      await h.d.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${uid()}, ${reviewId}, ${h.ids.opB}, 'y')`);
    });

    it('only a decided, first review with an unbilled settlement can be disputed', async () => {
      const h = await harness();
      const reviews = await h.firstVerdicts();
      const r1 = reviews.get(h.episode1)!;
      const r2 = reviews.get(h.episode2)!;
      // Pending: a fresh second review row is pending, and is itself final.
      const raised = await h.dispute(r1);
      const secondId = raised.json().second_review_id as string;
      await violates('review_disputes_decided_check', h.d.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${uid()}, ${secondId}, ${h.ids.opA}, 'x')`));
      await h.claimIn('second_review', h.A2);
      await h.verdict(h.A2, h.episode1, 'good');
      await violates('review_disputes_final_check', h.d.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${uid()}, ${secondId}, ${h.ids.opA}, 'x')`));
      // Billed.
      await h.d.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where episode_review_id = ${r2}`);
      await violates('review_disputes_unbilled_check', h.d.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${uid()}, ${r2}, ${h.ids.opB}, 'x')`));
      await violates('review_disputes_reason_check', h.d.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${uid()}, ${r1}, ${h.ids.opB}, '  ')`));
    });

    it('waits for a bill generation in flight on the settlement, then refuses', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      // Two connections, as backoffice.test.ts does it: one pooled connection
      // would serialise the two transactions before Postgres saw them.
      const a = await open(dbUrl(), { max: 1 });
      const b = await open(dbUrl(), { max: 1 });
      try {
        let updated: () => void = () => {};
        let commit: () => void = () => {};
        const firstUpdated = new Promise<void>((resolve) => (updated = resolve));
        const held = new Promise<void>((resolve) => (commit = resolve));
        const generator = a.transaction(async (tx) => {
          await tx.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where episode_review_id = ${reviewId}`);
          updated();
          await held;
        });
        await firstUpdated;

        let settled = false;
        const disputed = (async () =>
          b.execute(sql`insert into review_disputes (id, review_id, raised_by, reason) values (${uid()}, ${reviewId}, ${h.ids.opA}, 'x')`))();
        disputed.then(
          () => (settled = true),
          () => (settled = true),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(settled, 'the dispute did not wait for the generator').toBe(false);

        commit();
        await generator;
        await violates('review_disputes_unbilled_check', disputed);
      } finally {
        await a.close();
        await b.close();
      }
      const rows = (await h.d.execute(sql`select count(*)::int as n from review_disputes`)) as unknown as { n: number }[];
      expect(rows[0]!.n).toBe(0);
    });

    it('a dispute is written once and closed once', async () => {
      const h = await harness();
      const reviewId = (await h.firstVerdicts()).get(h.episode1)!;
      const id = (await h.dispute(reviewId)).json().dispute_id as string;
      await violates('review_disputes_append_only', h.d.execute(sql`update review_disputes set reason = 'edited' where id = ${id}`));
      await violates('review_disputes_append_only', h.d.execute(sql`delete from review_disputes where id = ${id}`));
      await violates('review_disputes_resolved_check', h.d.execute(sql`update review_disputes set outcome = 'upheld' where id = ${id}`));
      await h.d.execute(sql`update review_disputes set resolved_at = now(), outcome = 'overturned' where id = ${id}`);
      await violates('review_disputes_append_only', h.d.execute(sql`update review_disputes set outcome = 'upheld' where id = ${id}`));
    });

    it('a second review names an open dispute on its own delivery, once, and never its first reviewer', async () => {
      const h = await harness();
      const reviews = await h.firstVerdicts();
      const r1 = reviews.get(h.episode1)!;
      const raised = await h.dispute(r1);
      const disputeId = raised.json().dispute_id as string;
      const secondId = raised.json().second_review_id as string;
      const copy = (disputeId: string | null, from: string) => sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, review_state, queue, dispute_id)
        select ${uid()}, episode_id, ingest_id, measured_duration_s, 'pending', 'second_review', ${disputeId} from episode_reviews where id = ${from}`;
      // One second review per dispute.
      await violates('episode_reviews_dispute_key', h.d.execute(copy(disputeId, r1)));
      // Still one first review per delivery.
      await violates('episode_reviews_delivery_key', h.d.execute(copy(null, r1)));
      // A second review of the wrong delivery.
      await violates('episode_reviews_dispute_delivery_check', h.d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, review_state, queue, dispute_id)
        select ${uid()}, episode_id, ingest_id, measured_duration_s, 'pending', 'second_review', ${disputeId} from episode_reviews where id = ${reviews.get(h.episode2)!}`));
      // The first reviewer takes the lease on the second review.
      await violates('episode_reviews_second_reviewer_check', h.d.execute(sql`
        update episode_reviews set reviewer_ref = ${h.ids.opA}, claimed_at = now(), lease_expires_at = now() + interval '10 minutes' where id = ${secondId}`));
      await violates('episode_reviews_dispute_immutable', h.d.execute(sql`update episode_reviews set dispute_id = null where id = ${secondId}`));
      // A closed dispute takes no new second review.
      await h.d.execute(sql`delete from episode_reviews where id = ${secondId}`);
      await h.d.execute(sql`update review_disputes set resolved_at = now(), outcome = 'upheld' where id = ${disputeId}`);
      await violates('episode_reviews_dispute_open_check', h.d.execute(copy(disputeId, r1)));
    });

    it('a superseded settlement is pinned to exception and written once', async () => {
      const h = await harness();
      const reviews = await h.firstVerdicts();
      const [s1] = await h.settlementsOf(reviews.get(h.episode1)!);
      const [s2] = await h.settlementsOf(reviews.get(h.episode2)!);
      await violates('settlements_superseded_state_check', h.d.execute(sql`update settlements set superseded_by = ${s2!.id} where id = ${s1!.id}`));
      await violates('settlements_superseded_state_check', h.d.execute(sql`update settlements set superseded_by = ${s1!.id}, settlement_state = 'exception' where id = ${s1!.id}`));
      await h.d.execute(sql`update settlements set superseded_by = ${s2!.id}, settlement_state = 'exception', exception_from_state = settlement_state, exception_reason = 'superseded' where id = ${s1!.id}`);
      await violates('settlements_superseded_immutable', h.d.execute(sql`update settlements set superseded_by = null where id = ${s1!.id}`));
      // 0005's way back out of exception is closed for a superseded row.
      await violates('settlements_superseded_state_check', h.d.execute(sql`update settlements set settlement_state = 'pending_settlement' where id = ${s1!.id}`));
      // Nor can a row be BORN superseded: 0005 admits `pending_settlement` at insert, this guard does not.
      await violates('settlements_superseded_state_check', h.d.execute(sql`
        insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes, amount, settlement_state, superseded_by)
        select ${uid()}, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes, amount, 'pending_settlement', ${s1!.id} from settlements where id = ${s2!.id}`));
    });

    it('a bill line is refused for a disputed or a superseded settlement', async () => {
      const h = await harness();
      const reviews = await h.firstVerdicts();
      const [s1] = await h.settlementsOf(reviews.get(h.episode1)!);
      const [s2] = await h.settlementsOf(reviews.get(h.episode2)!);
      const bill = async (collector: string, total: string) => {
        const id = uid();
        await h.d.execute(sql`insert into bills (id, collector_id, period_start, period_end, currency, total) values (${id}, ${collector}, now() - interval '1 day', now(), 'VND', ${total})`);
        return id;
      };
      await h.dispute(reviews.get(h.episode1)!);
      const b1 = await bill(h.ids.collector1, s1!.amount);
      await violates('bill_lines_disputed_check', h.d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${b1}, ${s1!.id})`));
      // Superseded, with the dispute closed so only the supersession refuses.
      await h.d.execute(sql`update review_disputes set resolved_at = now(), outcome = 'overturned'`);
      await h.d.execute(sql`update settlements set superseded_by = ${s2!.id}, settlement_state = 'exception', exception_from_state = settlement_state, exception_reason = 'superseded' where id = ${s1!.id}`);
      await violates('bill_lines_superseded_check', h.d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${b1}, ${s1!.id})`));
      // The other collector's line, which nothing holds back, goes through.
      const b2 = await bill(h.ids.collector2, s2!.amount);
      await h.d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${b2}, ${s2!.id})`);
    });
  });
});
