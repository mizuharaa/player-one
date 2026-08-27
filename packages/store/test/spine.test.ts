import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DISCREPANCY_CODES } from '@playerone/contracts';
import { DEFECT_CATALOGUE, REVIEW_REASON_CATALOGUE, seedCatalogues } from '../src/catalogue.ts';
import { closeDb, db, hasDb, liveClaim, truncate, violates, useDatabase } from './db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('spine');

/**
 * The spine, tested the way the invariants are written: in SQL, against the
 * database, with no application code in the path.
 *
 * That is the point of putting them in the schema. An invariant enforced in
 * TypeScript is enforced for callers who go through TypeScript; PLT-04's
 * traceability and QR-03's ceiling have to hold against a psql session, a
 * migration script and a future service written by somebody else.
 */

const uid = () => randomUUID();

/** Minimal rows to hang an episode off. Returns the ids a test needs. */
async function seedSpine() {
  const d = await db();
  const ids = {
    task: uid(),
    collector: uid(),
    deviceType: uid(),
    device: uid(),
    scenario: uid(),
    centre: uid(),
    uploadDevice: uid(),
    operator: uid(),
    /** 0013: only a finance operator on the audit trail may mark a settlement paid. */
    finance: uid(),
    handover: uid(),
    batch: uid(),
    session: uid(),
  };
  await d.execute(sql`
    insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
      values (${ids.task}, 'housework', 1200.0000, 5, 'published');
  `);
  await d.execute(sql`
    insert into collectors (id, external_ref, status)
      values (${ids.collector}, 'collector-0001', 'qualified');
  `);
  await d.execute(sql`
    insert into device_types (id, code, generation)
      values (${ids.deviceType}, 'ego_headset', 'gen1');
  `);
  await d.execute(sql`
    insert into devices (id, device_type_id, hardware_serial, status)
      values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active');
  `);
  await d.execute(sql`
    insert into scenarios (id, code, privacy_risk_level)
      values (${ids.scenario}, 'home', 'low');
  `);
  await d.execute(sql`
    insert into upload_centres (id, region, name, status)
      values (${ids.centre}, 'HCM', 'District 7 centre', 'active');
  `);
  await d.execute(sql`
    insert into upload_devices (id, upload_centre_id, machine_identifier, status)
      values (${ids.uploadDevice}, ${ids.centre}, 'HCM-IMPORT-01', 'active');
  `);
  await d.execute(sql`
    insert into operators (id, upload_centre_id, external_ref, role)
      values (${ids.operator}, ${ids.centre}, 'op-01', 'centre_operator'),
             (${ids.finance}, ${ids.centre}, 'fin-01', 'finance');
  `);
  await d.execute(sql`
    insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
      values (${ids.handover}, ${ids.collector}, ${ids.device}, 'CARD-0001', ${ids.centre}, ${ids.operator}, now());
  `);
  await d.execute(sql`
    insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status)
      values (${ids.batch}, ${ids.handover}, ${ids.uploadDevice}, now(), 'importing');
  `);
  // 0016: the session is recorded under a live claim, and a settlement names it.
  const claim = await liveClaim(d, ids.task, ids.collector);
  await d.execute(sql`
    insert into collection_sessions
      (id, handover_id, task_id, collector_id, scenario_id, others_in_frame,
       sensitive_info_present, session_origin, task_claim_id, unit_price, currency)
      values (${ids.session}, ${ids.handover}, ${ids.task}, ${ids.collector}, ${ids.scenario},
              false, false, 'handover', ${claim}, '1200.0000', 'VND');
  `);
  await d.execute(sql`
    insert into collection_session_devices (collection_session_id, device_id, role)
      values (${ids.session}, ${ids.device}, 'headset');
  `);
  return { ...ids, claim };
}

/** An episode plus one ingest, in whatever resolution state the test wants. */
async function seedEpisode(opts: { sessionId?: string; measured: string; batchId?: string }) {
  const d = await db();
  const episodeId = uid();
  const ingestId = uid();
  const resolved = opts.sessionId !== undefined;
  await d.execute(sql`
    insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at,
                          ingest_count, collection_session_id, upload_batch_id, resolution_state, upload_path)
      values (${episodeId}, 'AZER76400FE', '20260813_072310', now(), now(), 1,
              ${opts.sessionId ?? null}, ${opts.batchId ?? null},
              ${resolved ? 'resolved' : 'quarantined'}, 'C');
  `);
  await d.execute(sql`
    insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename,
                                 measured_duration_s, timing_source, timing_confidence, manifest_present,
                                 engine_version, host, ingested_at, record_json)
      values (${ingestId}, ${episodeId}, repeat('a', 64), 'ok', 'ego_AZER76400FE_20260813_072310',
              ${opts.measured}, 'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb);
  `);
  return { episodeId, ingestId };
}

describe.skipIf(!hasDb())('the identity spine', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  // -- PLT-05: exactly two resolution states --------------------------------

  describe('PLT-05: an episode is resolved or quarantined, never a third thing', () => {
    it('accepts an episode resolved to a session', async () => {
      const ids = await seedSpine();
      const ep = await seedEpisode({ sessionId: ids.session, measured: '8.500000', batchId: ids.batch });
      expect(ep.episodeId).toBeTruthy();
    });

    it('accepts an unattributable episode as quarantined', async () => {
      await seedSpine();
      const ep = await seedEpisode({ measured: '8.500000' });
      expect(ep.episodeId).toBeTruthy();
    });

    it('refuses "resolved" with no session — the state §4.3 says must not exist', async () => {
      await seedSpine();
      const d = await db();
      await violates('episodes_resolution_check', d.execute(sql`
          insert into episodes (episode_id, device_serial, session_started_at, first_seen_at,
                                last_seen_at, resolution_state, collection_session_id)
            values (${uid()}, 'X', '20260813_072310', now(), now(), 'resolved', null);
        `));
    });

    it('refuses "quarantined" that still points at a session', async () => {
      const ids = await seedSpine();
      const d = await db();
      await violates('episodes_resolution_check', d.execute(sql`
          insert into episodes (episode_id, device_serial, session_started_at, first_seen_at,
                                last_seen_at, resolution_state, collection_session_id)
            values (${uid()}, 'X', '20260813_072310', now(), now(), 'quarantined', ${ids.session});
        `));
    });

    it('has no third state to reach for', async () => {
      await seedSpine();
      const d = await db();
      await violates('episodes_resolution_check', d.execute(sql`
          insert into episodes (episode_id, device_serial, session_started_at, first_seen_at,
                                last_seen_at, resolution_state, collection_session_id)
            values (${uid()}, 'X', '20260813_072310', now(), now(), 'pending', null);
        `));
    });
  });

  // -- QR-03: effective duration cannot exceed measured ---------------------

  /**
   * Every insert below carries a `verdict_id` it does not otherwise care about.
   * `episode_reviews_verdict_id_check` requires one on any row that is not
   * pending: a decided review has to name the request that decided it, because
   * that id is what makes a retried commit return the first answer rather than
   * write a second review and a second payment. These tests are about other
   * constraints; the column is here so they reach them.
   */
  describe('QR-03: effective duration cannot exceed what was measured', () => {
    it('rejects an over-long effective duration in raw SQL, with no application in the path', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_effective_le_measured_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', '8.500001', 'partial_pass', now(), ${uid()});
        `));
    });

    it('accepts an effective duration at exactly the measured value', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', '8.500000', 'pass', now(), ${uid()});
      `);
      const rows = await d.execute(sql`select count(*)::int as n from episode_reviews`);
      expect((rows as unknown as { n: number }[])[0]!.n).toBe(1);
    });

    it('refuses a review that misstates the measured duration it is judging', async () => {
      // The composite FK is what stops the QR-03 ceiling being raised by lying
      // about the ceiling.
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_ingest_fk', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${episodeId}, ${ingestId}, '9999.000000', '9000.000000', 'pass', now(), ${uid()});
        `));
    });

    it('refuses a review attached to an ingest from a different episode', async () => {
      const ids = await seedSpine();
      const a = await seedEpisode({ sessionId: ids.session, measured: '8.500000' });
      const b = await seedEpisode({ measured: '20.980044' });
      const d = await db();
      await violates('episode_reviews_ingest_fk', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${a.episodeId}, ${b.ingestId}, '20.980044', '1.000000', 'pass', now(), ${uid()});
        `));
    });

    it('QR-05: bounds the priority below the API, not only inside it', async () => {
      /**
       * The queue is ordered by this column. One row carrying `2^31-1` sits at
       * the head of every lane until somebody notices; one carrying the minimum
       * is buried under everything that will ever arrive. The request parser
       * bounds it too, and this is the half a `psql` session cannot skip.
       */
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_priority_range_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       review_state, priority)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pending', 2147483647);
        `));
      // And a stopwatch cannot run backwards, for the same reason: it is the
      // input to a number about a person's pace.
      await violates('episode_reviews_time_to_verdict_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       review_state, effective_duration_s, verdict_id,
                                       reviewed_at, time_to_verdict_s)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pass', '8.500000',
                    ${uid()}, now(), -1);
        `));
    });

    it('QR-05: refuses an assignment to somebody who is not an operator', async () => {
      /**
       * An assignment is the one column on this row that can make an episode
       * invisible to everybody at once: the queue offers an assigned review to
       * its assignee and to nobody else, so a typed or stale id parks the
       * footage forever with nothing to see. That has to be a foreign key —
       * the id will be typed by a supervisor into a form, and nothing in the
       * service can tell a wrong uuid from a right one.
       */
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_assignee_ref_operators_id_fk', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       review_state, assignee_ref)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pending', ${uid()});
        `));

      // A real operator is accepted. The identity is `operators.id` because that
      // is what a reviewer signs in with today; when reviewers get their own
      // role the parent moves and this test moves with it.
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     review_state, assignee_ref)
          values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', 'pending', ${ids.operator});
      `);
      const rows = (await d.execute(
        sql`select count(*)::int as n from episode_reviews where assignee_ref = ${ids.operator}`,
      )) as unknown as { n: number }[];
      expect(rows[0]!.n).toBe(1);
    });

    it('requires a failed review to be worth nothing (§6.9)', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      await violates('episode_reviews_fail_is_zero_check', d.execute(sql`
          insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                       effective_duration_s, review_state, reviewed_at, verdict_id)
            values (${uid()}, ${episodeId}, ${ingestId}, '8.500000', '4.000000', 'fail', now(), ${uid()});
        `));
    });
  });

  // -- SET-02: settlement cannot be reached from an upload ------------------

  describe('SET-02: upload success cannot reach a settlement', () => {
    it('has no foreign key from settlements to episodes, ingests or batches', async () => {
      const d = await db();
      const rows = (await d.execute(sql`
        select ccu.table_name as target
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
        where tc.table_name = 'settlements' and tc.constraint_type = 'FOREIGN KEY'
      `)) as unknown as { target: string }[];

      const targets = new Set(rows.map((r) => r.target));
      // The only route to an episode is through a review. An upload event has
      // nothing here it could possibly write against.
      expect(targets).not.toContain('episodes');
      expect(targets).not.toContain('episode_ingests');
      expect(targets).not.toContain('upload_batches');
      expect(targets).toContain('episode_reviews');
    });

    it('cannot bill one review twice', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      const reviewId = uid();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${reviewId}, ${episodeId}, ${ingestId}, '8.500000', '8.500000', 'pass', now(), ${uid()});
      `);
      const bill = (id: string) => sql`
        insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes,
                                 amount, settlement_state)
          values (${id}, ${reviewId}, ${ids.task}, ${ids.claim}, '1200.0000', '0.141667', '170.0000', 'pending_settlement');
      `;
      await d.execute(bill(uid()));
      await violates('settlements_review_key', d.execute(bill(uid())));
    });
  });

  // -- SET-05 / SET-06: the lifecycle, and the bill it ends on --------------

  /**
   * SET-05 gives five states. `settlements_state_check` says which values are
   * legal; it cannot say which *changes* are, because a CHECK only ever sees the
   * row in front of it and `manually_paid` is a legal value whichever row it is
   * on. The edges are enforced by `settlements_transition_guard`, and these
   * tests reach the trigger the way a psql session or a future service would --
   * raw SQL, with no `settle.ts` in the path. That is the whole reason the guard
   * is in the database and not in the endpoint that marks a bill paid.
   */
  describe('SET-05: a settlement moves forward, and nothing walks it back', () => {
    /** A review with a settlement on it, in whatever state the test starts from. */
    async function seedSettlement(state = 'pending_settlement') {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      const reviewId = uid();
      const settlementId = uid();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${reviewId}, ${episodeId}, ${ingestId}, '8.500000', '8.500000', 'pass', now(), ${uid()});
      `);
      await d.execute(sql`
        insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes,
                                 amount, settlement_state)
          values (${settlementId}, ${reviewId}, ${ids.task}, ${ids.claim}, '1200.0000', '0.141667', '170.0000', ${state});
      `);
      return { ...ids, settlementId };
    }

    const move = async (settlementId: string, to: string): Promise<unknown> => {
      const d = await db();
      return d.execute(sql`
        update settlements set settlement_state = ${to}, updated_at = now() where id = ${settlementId};
      `);
    };

    /**
     * The last edge, the way 0013 requires it to be walked: the settlement is
     * on a bill, and the transaction that marks it paid carries the audit row
     * of a finance operator who did not issue that bill
     * (`settlements_paid_by_finance`, checked at commit against
     * `audit_events`). A bare `move(id, 'manually_paid')` is refused, which
     * `payout/domain/schema.test.ts` proves; this helper is the legal shape.
     */
    const pay = async (ids: Awaited<ReturnType<typeof seedSettlement>>): Promise<void> => {
      const d = await db();
      const billId = uid();
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${billId}, ${ids.collector}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '170.0000');
      `);
      await d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${billId}, ${ids.settlementId});`);
      await d.transaction(async (tx) => {
        await tx.execute(sql`
          update settlements set settlement_state = 'manually_paid', updated_at = now() where id = ${ids.settlementId};
        `);
        await tx.execute(sql`
          insert into audit_events (action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id)
            values ('bill.pay', 'bills', ${billId}, 'operator', ${ids.finance}, ${ids.uploadDevice}, ${ids.centre});
        `);
      });
    };

    const stateOf = async (settlementId: string): Promise<string | undefined> => {
      const d = await db();
      const rows = (await d.execute(
        sql`select settlement_state from settlements where id = ${settlementId}`,
      )) as unknown as { settlement_state: string }[];
      return rows[0]?.settlement_state;
    };

    it('refuses a settlement that is born already paid', async () => {
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      const reviewId = uid();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${reviewId}, ${episodeId}, ${ingestId}, '8.500000', '8.500000', 'pass', now(), ${uid()});
      `);
      // Without this every guarded edge is skippable by inserting the end state.
      await violates(
        'settlements_transition_check',
        d.execute(sql`
          insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes,
                                   amount, settlement_state)
            values (${uid()}, ${reviewId}, ${ids.task}, ${ids.claim}, '1200.0000', '0.141667', '170.0000', 'manually_paid');
        `),
      );
    });

    it('walks pending_settlement to bill_generated to manually_paid', async () => {
      const ids = await seedSettlement();
      const { settlementId } = ids;
      await move(settlementId, 'bill_generated');
      await pay(ids);
      expect(await stateOf(settlementId)).toBe('manually_paid');
    });

    it('refuses manually_paid -> pending_review, which the state CHECK accepts', async () => {
      const ids = await seedSettlement();
      const { settlementId } = ids;
      await move(settlementId, 'bill_generated');
      await pay(ids);

      // Both values satisfy settlements_state_check. The edge is what is
      // illegal: a paid settlement that re-enters the queue is a second payment.
      await violates('settlements_transition_check', move(settlementId, 'pending_review'));
      await violates('settlements_transition_check', move(settlementId, 'pending_settlement'));
      await violates('settlements_transition_check', move(settlementId, 'bill_generated'));
      await violates('settlements_transition_check', move(settlementId, 'exception'));
      expect(await stateOf(settlementId)).toBe('manually_paid');
    });

    it('refuses every other jump that skips or reverses the lane', async () => {
      const illegal: [string, string][] = [
        ['pending_review', 'bill_generated'],
        ['pending_review', 'manually_paid'],
        ['pending_settlement', 'pending_review'],
        ['pending_settlement', 'manually_paid'],
        ['bill_generated', 'pending_review'],
        ['bill_generated', 'pending_settlement'],
        ['exception', 'bill_generated'],
        ['exception', 'manually_paid'],
        ['exception', 'pending_review'],
      ];
      for (const [from, to] of illegal) {
        await truncate();
        const { settlementId } = await seedSettlement(
          from === 'pending_review' ? 'pending_review' : 'pending_settlement',
        );
        if (from === 'bill_generated') await move(settlementId, 'bill_generated');
        if (from === 'exception') await move(settlementId, 'exception');
        await violates('settlements_transition_check', move(settlementId, to));
        expect(await stateOf(settlementId)).toBe(from);
      }
    });

    it('lets an exception go back to the queue, because that is the only way out', async () => {
      const { settlementId } = await seedSettlement();
      await move(settlementId, 'exception');
      await move(settlementId, 'pending_settlement');
      await move(settlementId, 'bill_generated');
      expect(await stateOf(settlementId)).toBe('bill_generated');
    });

    it('refuses to change what a settlement is worth after it is written', async () => {
      const { settlementId } = await seedSettlement();
      const d = await db();
      // `bills.total` is the sum of its lines and `bill_lines` stores no money of
      // its own, so an editable amount would let an issued bill quietly stop
      // adding up with nothing in the schema noticing.
      await violates(
        'settlements_amount_immutable_check',
        d.execute(sql`update settlements set amount = '999.0000' where id = ${settlementId};`),
      );
      await violates(
        'settlements_amount_immutable_check',
        d.execute(sql`update settlements set unit_price = '2400.0000' where id = ${settlementId};`),
      );
      await violates(
        'settlements_amount_immutable_check',
        d.execute(
          sql`update settlements set effective_minutes = '9.999999' where id = ${settlementId};`,
        ),
      );
    });

    it('cannot put one settlement on two bills', async () => {
      const { settlementId, collector } = await seedSettlement();
      const d = await db();
      const billOne = uid();
      const billTwo = uid();
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${billOne}, ${collector}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '170.0000'),
                 (${billTwo}, ${collector}, '2026-08-24T00:00:00Z', '2026-08-31T00:00:00Z', 'VND', '170.0000');
      `);
      await d.execute(sql`
        insert into bill_lines (bill_id, settlement_id) values (${billOne}, ${settlementId});
      `);
      // A second bill for the same work has nowhere to write the line.
      await violates(
        'bill_lines_settlement_key',
        d.execute(sql`
          insert into bill_lines (bill_id, settlement_id) values (${billTwo}, ${settlementId});
        `),
      );
    });

    it('freezes an issued bill, and only an issued one', async () => {
      // 0011: a bill is evidence once it has a line. Its collector, period,
      // currency and total are what finance was sent, and a raw-SQL edit after
      // the fact is the tampering the trigger exists to refuse.
      const { settlementId, collector } = await seedSettlement();
      const d = await db();
      const issued = uid();
      const draft = uid();
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${issued}, ${collector}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '170.0000'),
                 (${draft}, ${collector}, '2026-08-24T00:00:00Z', '2026-08-31T00:00:00Z', 'VND', '170.0000');
      `);
      await d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${issued}, ${settlementId});`);
      await violates(
        'bills_issued_immutable',
        d.execute(sql`update bills set total = '1.0000' where id = ${issued};`),
      );
      await violates(
        'bills_issued_immutable',
        d.execute(sql`update bills set period_end = '2026-09-01T00:00:00Z' where id = ${issued};`),
      );
      // A bill with no lines is not issued: the generator may still be writing it.
      await d.execute(sql`update bills set total = '0.0000' where id = ${draft};`);
    });

    it('refuses a line that is another collector\'s work', async () => {
      // 0011: bill_lines carries no collector, so without this a line from
      // collector A's settlement could sit on collector B's bill and the export
      // would pay B for A's minutes.
      const { settlementId } = await seedSettlement();
      const d = await db();
      const other = uid();
      const bill = uid();
      await d.execute(sql`insert into collectors (id, external_ref, status) values (${other}, 'collector-0002', 'qualified');`);
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${bill}, ${other}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '170.0000');
      `);
      await violates(
        'bill_lines_owner_guard',
        d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${bill}, ${settlementId});`),
      );
    });

    it('never lets a line leave an issued bill', async () => {
      // Bridge F-28. Deleting or re-pointing the last line would leave the
      // frozen total standing over nothing, and the issued-bill guard reads
      // "issued" as "has a line". A line is evidence: written once.
      const { settlementId, collector } = await seedSettlement();
      const d = await db();
      const bill = uid();
      const other = uid();
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${bill}, ${collector}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '170.0000'),
                 (${other}, ${collector}, '2026-08-24T00:00:00Z', '2026-08-31T00:00:00Z', 'VND', '170.0000');
      `);
      await d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${bill}, ${settlementId});`);
      await violates(
        'bill_lines_immutable',
        d.execute(sql`delete from bill_lines where settlement_id = ${settlementId};`),
      );
      await violates(
        'bill_lines_immutable',
        d.execute(sql`update bill_lines set bill_id = ${other} where settlement_id = ${settlementId};`),
      );
    });

    it('refuses a total its lines do not add up to', async () => {
      // 0011, deferred to commit: the total is the sum of the lines. The bill
      // may be written before its lines (the generator does), so the check runs
      // when the transaction ends, over the finished bill.
      const { settlementId, collector } = await seedSettlement();
      const d = await db();
      const bill = uid();
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${bill}, ${collector}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '1.0000');
      `);
      await violates(
        'bills_total_matches_lines',
        d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${bill}, ${settlementId});`),
      );
      // The same line on a bill that says 170.0000 is fine.
      const right = uid();
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${right}, ${collector}, '2026-08-24T00:00:00Z', '2026-08-31T00:00:00Z', 'VND', '170.0000');
      `);
      await d.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${right}, ${settlementId});`);
    });

    it('cannot bill a rejected episode, which is worth nothing', async () => {
      // SET-01 pays for pass and partial-pass reviews. The review lane still
      // writes a settlement for a `fail`, worth 0.0000, because that row is the
      // score of the review — but it is not a bill line, and the database is
      // what says so rather than the generator's WHERE clause.
      const ids = await seedSpine();
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: ids.session,
        measured: '8.500000',
      });
      const d = await db();
      const reviewId = uid();
      const settlementId = uid();
      const billId = uid();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${reviewId}, ${episodeId}, ${ingestId}, '8.500000', '0.000000', 'fail', now(), ${uid()});
      `);
      await d.execute(sql`
        insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes,
                                 amount, settlement_state)
          values (${settlementId}, ${reviewId}, ${ids.task}, ${ids.claim}, '1200.0000', '0.000000', '0.0000', 'pending_settlement');
      `);
      await d.execute(sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${billId}, ${ids.collector}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '0.0000');
      `);
      await violates(
        'bill_lines_payable_check',
        d.execute(sql`
          insert into bill_lines (bill_id, settlement_id) values (${billId}, ${settlementId});
        `),
      );
    });

    it('refuses a second bill for the same collector and cycle', async () => {
      const { collector } = await seedSettlement();
      const d = await db();
      const insert = (id: string) => sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${id}, ${collector}, '2026-08-17T00:00:00Z', '2026-08-24T00:00:00Z', 'VND', '170.0000');
      `;
      await d.execute(insert(uid()));
      // SET-07's idempotency, with the generator bypassed entirely.
      await violates('bills_collector_period_key', d.execute(insert(uid())));
    });
  });

  // -- P2-01 / APP-17b ------------------------------------------------------

  describe('the session binds devices as a set, and records both declarations', () => {
    it('refuses a session that does not answer APP-17b', async () => {
      const ids = await seedSpine();
      const d = await db();
      // APP-17b is NOT NULL, so "we did not ask" is not a storable answer.
      await violates(
        'others_in_frame',
        d.execute(sql`
          insert into collection_sessions (id, handover_id, task_id, collector_id, scenario_id,
                                           others_in_frame, sensitive_info_present, session_origin)
            values (${uid()}, ${ids.handover}, ${ids.task}, ${ids.collector}, ${ids.scenario},
                    null, false, 'handover');
        `),
      );
    });

    it('holds devices in a join table, so phase 2 adds gloves without a migration', async () => {
      const ids = await seedSpine();
      const d = await db();
      const cols = (await d.execute(sql`
        select column_name from information_schema.columns
        where table_name = 'collection_sessions'
      `)) as unknown as { column_name: string }[];
      expect(cols.map((c) => c.column_name)).not.toContain('device_id');

      // Phase 1 allows exactly one; the constraint is one droppable index.
      await expect(
        d.execute(sql`
          insert into collection_session_devices (collection_session_id, device_id, role)
            values (${ids.session}, ${ids.device}, 'glove_left');
        `));
    });
  });

  // -- UPL-06 --------------------------------------------------------------

  it('UPL-06: a local cache cannot be cleaned before the cloud verified it', async () => {
    const ids = await seedSpine();
    const d = await db();

    // Migrations 0007 and 0009 extend the gate: neither timestamp is a status an
    // operator can assert, both are consequences of every episode on the batch
    // passing byte read-back. An empty batch has nothing the cloud verified...
    await violates('upload_batches_verify_needs_episodes', d.execute(sql`
      update upload_batches set cloud_verified_at = now(), batch_status = 'verified'
      where id = ${ids.batch};
    `));

    // ...and a batch with an unverified episode is not verified either.
    const ep = await seedEpisode({ sessionId: ids.session, measured: '8.500000', batchId: ids.batch });
    await violates('upload_batches_verify_needs_verified_episodes', d.execute(sql`
      update upload_batches set cloud_verified_at = now(), batch_status = 'verified'
      where id = ${ids.batch};
    `));

    await d.execute(sql`
      update episodes set verification_state = 'verified' where episode_id = ${ep.episodeId};
    `);

    // With the episodes in order, the original CHECK is what still refuses a
    // cleanup the cloud has not signed off: an upload centre's local copy is
    // the only copy until then.
    await violates('upload_batches_cache_after_verify_check', d.execute(sql`
        update upload_batches set local_cache_cleaned_at = now() where id = ${ids.batch};
      `));

    await d.execute(sql`
      update upload_batches set cloud_verified_at = now(), batch_status = 'verified'
      where id = ${ids.batch};
    `);
    await d.execute(sql`
      update upload_batches set local_cache_cleaned_at = now(), batch_status = 'closed'
      where id = ${ids.batch};
    `);

    // And cleaning reads the episodes NOW, not cloud_verified_at. That
    // timestamp says a full verification passed once, which stays true;
    // deleting the only local copy is a decision about the current bytes, so a
    // batch whose episode has since failed re-verification is not cleanable
    // even though it is still stamped verified.
    await d.execute(sql`
      update upload_batches set local_cache_cleaned_at = null where id = ${ids.batch};
    `);
    await d.execute(sql`
      update episodes set verification_state = 'failed' where episode_id = ${ep.episodeId};
    `);
    await violates('upload_batches_verify_needs_verified_episodes', d.execute(sql`
      update upload_batches set local_cache_cleaned_at = now(), batch_status = 'closed'
      where id = ${ids.batch};
    `));
  });

  // -- UPL-05: a verdict belongs to one delivery ---------------------------

  it('UPL-05: a new ingest is unverified, whatever the last one scored', async () => {
    const ids = await seedSpine();
    const d = await db();
    const ep = await seedEpisode({ sessionId: ids.session, measured: '8.500000', batchId: ids.batch });
    const verificationOf = async () => {
      const rows = (await d.execute(sql`
        select verification_state from episodes where episode_id = ${ep.episodeId}
      `)) as unknown as { verification_state: string }[];
      return rows[0]!.verification_state;
    };

    await d.execute(sql`
      update episodes set latest_ingest_id = ${ep.ingestId} where episode_id = ${ep.episodeId};
    `);
    await d.execute(sql`
      update episodes set verification_state = 'verified' where episode_id = ${ep.episodeId};
    `);
    expect(await verificationOf()).toBe('verified');

    // The card comes back with different bytes: a second ingest, and no cloud
    // copy of it. The verdict is about the FIRST delivery's bytes and must not
    // survive onto the second — otherwise QR-02's cloud gate admits an episode
    // whose current bytes nobody has uploaded.
    const second = uid();
    await d.execute(sql`
      insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename,
                                   measured_duration_s, timing_source, timing_confidence, manifest_present,
                                   engine_version, host, ingested_at, record_json)
        values (${second}, ${ep.episodeId}, repeat('b', 64), 'ok', 'ego_AZER76400FE_20260813_072310',
                '8.500000', 'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb);
    `);
    await d.execute(sql`
      update episodes set latest_ingest_id = ${second}, ingest_count = 2
      where episode_id = ${ep.episodeId};
    `);
    expect(await verificationOf()).toBe('pending');

    // Raw SQL cannot smuggle the old verdict across either: the reset is a
    // BEFORE trigger, so it wins over whatever the same statement sets.
    await d.execute(sql`
      update episodes set latest_ingest_id = ${ep.ingestId}, verification_state = 'verified'
      where episode_id = ${ep.episodeId};
    `);
    expect(await verificationOf()).toBe('pending');
  });

  // -- UPL-07 --------------------------------------------------------------

  it('UPL-07: a Path C episode traces to centre, machine, batch and handover', async () => {
    const ids = await seedSpine();
    const { episodeId } = await seedEpisode({
      sessionId: ids.session,
      measured: '8.500000',
      batchId: ids.batch,
    });
    const d = await db();
    const rows = (await d.execute(sql`
      select e.episode_id, b.id as batch, h.id as handover, ud.id as machine, uc.id as centre,
             t.id as task, c.id as collector, dev.id as device, s.id as scenario
      from episodes e
      join upload_batches b on b.id = e.upload_batch_id
      join handovers h on h.id = b.handover_id
      join upload_devices ud on ud.id = b.upload_device_id
      join upload_centres uc on uc.id = ud.upload_centre_id
      join collection_sessions cs on cs.id = e.collection_session_id
      join tasks t on t.id = cs.task_id
      join collectors c on c.id = cs.collector_id
      join scenarios s on s.id = cs.scenario_id
      join collection_session_devices csd on csd.collection_session_id = cs.id
      join devices dev on dev.id = csd.device_id
      where e.episode_id = ${episodeId}
    `)) as unknown as Record<string, string>[];

    // §4.3: exactly one of each, not "at least one".
    expect(rows).toHaveLength(1);
    expect(rows[0]!['centre']).toBe(ids.centre);
    expect(rows[0]!['handover']).toBe(ids.handover);
    expect(rows[0]!['machine']).toBe(ids.uploadDevice);
    expect(rows[0]!['task']).toBe(ids.task);
    expect(rows[0]!['collector']).toBe(ids.collector);
    expect(rows[0]!['device']).toBe(ids.device);
  });

  // -- device assignment ----------------------------------------------------

  /**
   * Daniel, 2026-08-25: one collector holds a headset for an allotted period,
   * and at the end of it the credentials swap to the next collector. That is
   * only a usable crosscheck if the periods cannot overlap — two collectors
   * holding one device across one instant makes "who recorded this" ambiguous
   * again, which is the question the table exists to answer.
   *
   * So the overlap rule is tested here, in SQL, with no API in the path: it has
   * to hold against a psql session and a backfill script as well as against the
   * routes in backoffice.ts.
   */
  describe('a device is assigned to one collector at a time', () => {
    /** The second collector the whole slice turns on, plus a second device. */
    const second = async (ids: { deviceType: string }) => {
      const d = await db();
      const collector = uid();
      const device = uid();
      await d.execute(sql`
        insert into collectors (id, external_ref, status)
          values (${collector}, 'collector-0002', 'qualified');
      `);
      await d.execute(sql`
        insert into devices (id, device_type_id, hardware_serial, status)
          values (${device}, ${ids.deviceType}, 'BZER99900AA', 'active');
      `);
      return { collector, device };
    };

    const assign = async (
      deviceId: string,
      collectorId: string,
      from: string,
      to: string | null,
    ) => {
      const d = await db();
      return d.execute(sql`
        insert into device_assignments (id, device_id, collector_id, valid_from, valid_to)
          values (${uid()}, ${deviceId}, ${collectorId}, ${from}, ${to});
      `);
    };

    it('refuses two closed periods that overlap', async () => {
      const ids = await seedSpine();
      const other = await second(ids);
      await assign(ids.device, ids.collector, '2026-05-01T00:00:00Z', '2026-08-01T00:00:00Z');
      await violates(
        'device_assignments_no_overlap',
        assign(ids.device, other.collector, '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z'),
      );
    });

    it('refuses a closed period that a later open one reaches back into', async () => {
      const ids = await seedSpine();
      const other = await second(ids);
      await assign(ids.device, ids.collector, '2026-05-01T00:00:00Z', '2026-08-01T00:00:00Z');
      await violates(
        'device_assignments_no_overlap',
        assign(ids.device, other.collector, '2026-07-31T23:59:59Z', null),
      );
    });

    it('refuses a second open period, because two open periods always overlap', async () => {
      const ids = await seedSpine();
      const other = await second(ids);
      await assign(ids.device, ids.collector, '2026-05-01T00:00:00Z', null);
      await violates(
        'device_assignments_no_overlap',
        assign(ids.device, other.collector, '2027-05-01T00:00:00Z', null),
      );
    });

    it('refuses a period that ends before it starts, or lasts no time at all', async () => {
      const ids = await seedSpine();
      await violates(
        'device_assignments_period_check',
        assign(ids.device, ids.collector, '2026-08-01T00:00:00Z', '2026-05-01T00:00:00Z'),
      );
      await violates(
        'device_assignments_period_check',
        assign(ids.device, ids.collector, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
      );
    });

    it('allows adjacent periods, because that is what a handover looks like', async () => {
      const ids = await seedSpine();
      const other = await second(ids);
      const d = await db();
      // The instant one allotment ends is the instant the next begins. A rule
      // that refused this would force a gap in which the device belonged to
      // nobody, and an episode recorded in that gap would resolve to no one.
      await assign(ids.device, ids.collector, '2026-05-01T00:00:00Z', '2026-08-01T00:00:00Z');
      await assign(ids.device, other.collector, '2026-08-01T00:00:00Z', null);

      const rows = (await d.execute(sql`
        select collector_id from device_assignments
         where device_id = ${ids.device}
           and tstzrange(valid_from, valid_to, '[)') @> '2026-08-01T00:00:00Z'::timestamptz
      `)) as unknown as Record<string, string>[];
      // The boundary instant belongs to the incoming collector, and to one only.
      expect(rows).toHaveLength(1);
      expect(rows[0]!['collector_id']).toBe(other.collector);
    });

    it('scopes the rule to one device, so the fleet is not one queue', async () => {
      const ids = await seedSpine();
      const other = await second(ids);
      await assign(ids.device, ids.collector, '2026-05-01T00:00:00Z', null);
      await assign(other.device, other.collector, '2026-05-01T00:00:00Z', null);
    });
  });
});

describe.skipIf(!hasDb())('the catalogues', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('gives every defect the engine can emit a routing decision', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select code from defect_codes`,
    )) as unknown as { code: string }[];
    const known = new Set(rows.map((r) => r.code));

    // A new code with no decision would otherwise default to "reaches review"
    // by accident. This fails instead.
    for (const code of DISCREPANCY_CODES) expect(known, code).toContain(code);
    expect(known).toContain('SESSION-CONFLICT');
  });

  it('blocks only the defects that stop a human judging the episode', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select code from defect_codes where blocks_review`,
    )) as unknown as { code: string }[];
    const blocking = new Set(rows.map((r) => r.code));

    expect(blocking).toContain('MEDIA-MISSING');
    expect(blocking).toContain('MEDIA-TRUNCATED');

    // UPL-10 and UPL-12: an unclosed session, stale statistics and a zero-byte
    // PTS file are flagged and kept. 073055 is 458 MB of good video behind
    // exactly these, and blocking them would make that footage unpayable.
    expect(blocking).not.toContain('SESSION-UNCLOSED');
    expect(blocking).not.toContain('STATS-STALE');
    expect(blocking).not.toContain('PTS-EMPTY');
    expect(blocking).not.toContain('TIMING-ESTIMATED');

    /**
     * CHECKSUM-MISMATCH blocks. The ingest spec's defect table (§6) says
     * quarantine — "does not enter the review queue, does not generate
     * settlement, is never deleted" — because the bytes of one session changed
     * between two deliveries and which one is real is an open question. The
     * review-queue slice had tested the opposite; the integration follows the
     * spec (bridge F-36, rebutted and withdrawn). Until a per-episode clearing
     * route exists, a mismatched redelivery is unpayable — escalated, not
     * decided here.
     */
    expect(blocking).toContain('CHECKSUM-MISMATCH');

    // Open question for the product owner, seeded permissive. If this flips,
    // it flips deliberately and this line is what says so.
    expect(blocking).not.toContain('CALIB-MISSING');
  });

  it('withholds no settlement by default, pending the product owner on CALIB-MISSING', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select count(*)::int as n from defect_codes where suppresses_settlement`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });

  it('localises every review reason for the collector and the reviewer', async () => {
    const d = await db();
    await seedCatalogues(d);
    const rows = (await d.execute(sql`
      select count(*)::int as total,
             count(*) filter (where label_vi is null or label_zh is null)::int as untranslated
      from review_reason_codes
    `)) as unknown as { total: number; untranslated: number }[];
    // LOC-04 for the collector, LOC-02 for PaXini's reviewers.
    expect(rows[0]!.total).toBe(REVIEW_REASON_CATALOGUE.length);
    expect(rows[0]!.untranslated).toBe(0);
  });

  it('is idempotent, so re-seeding is how routing gets re-tuned', async () => {
    const d = await db();
    await seedCatalogues(d);
    await seedCatalogues(d);
    const rows = (await d.execute(
      sql`select count(*)::int as n from defect_codes`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(DEFECT_CATALOGUE.length);
  });

  /**
   * §6.9's own note: build the reason codes configurable rather than hard-coded,
   * because PaXini said on 13 Aug the in-the-wild standard does not exist yet
   * and will be rewritten during the pilot.
   *
   * Configurable means an operator's UPDATE survives a restart. It did not: the
   * boot-time seed upserted the labels back over it, which is the worse failure
   * of the two — nothing errors, and the pilot's own tuning quietly reverts to
   * whatever was compiled in.
   */
  it('leaves an operator edit alone, because the review standard is theirs to rewrite', async () => {
    const d = await db();
    await seedCatalogues(d);
    await d.execute(sql`
      update review_reason_codes
         set label_en = 'Lens blocked by clothing', category = 'visual', active = false
       where code = 'VQ-OCCLUSION'
    `);

    await seedCatalogues(d);

    const rows = (await d.execute(sql`
      select label_en, category, active from review_reason_codes where code = 'VQ-OCCLUSION'
    `)) as unknown as { label_en: string; category: string; active: boolean }[];
    expect(rows[0]!.label_en).toBe('Lens blocked by clothing');
    expect(rows[0]!.category).toBe('visual');
    // Retiring a code is how the taxonomy shrinks. The row stays, so the
    // reviews already citing it still render.
    expect(rows[0]!.active).toBe(false);

    // A code the deployment does not have yet still arrives with a release.
    const all = (await d.execute(
      sql`select count(*)::int as n from review_reason_codes`,
    )) as unknown as { n: number }[];
    expect(all[0]!.n).toBe(REVIEW_REASON_CATALOGUE.length);
  });

  /**
   * QR-01 and QR-04 both rest on a decided review still being able to name why.
   * The taxonomy is editable, so the question is what an edit can do to the
   * reviews that already cite it — and the answer has to be a foreign key,
   * because the edit will be typed into psql by somebody who has never read
   * this repository.
   */
  it('cannot orphan a past review, however the taxonomy is edited', async () => {
    const d = await db();
    await seedCatalogues(d);
    const ids = await seedSpine();
    const { episodeId, ingestId } = await seedEpisode({ sessionId: ids.session, measured: '60.000000' });
    const reviewId = uid();
    await d.execute(sql`
      insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, review_state,
                                   effective_duration_s, verdict_id, reviewed_at)
        values (${reviewId}, ${episodeId}, ${ingestId}, '60.000000', 'fail', 0, ${uid()}, now());
    `);
    await d.execute(sql`
      insert into episode_review_reasons (review_id, code) values (${reviewId}, 'VQ-DARK');
    `);

    // Deactivating and relabelling: the picker loses the code, the verdict does not.
    await d.execute(sql`
      update review_reason_codes set active = false, label_en = 'Underexposed' where code = 'VQ-DARK'
    `);
    const joined = (await d.execute(sql`
      select r.code, c.label_en, c.active
        from episode_review_reasons r
        join review_reason_codes c on c.code = r.code
       where r.review_id = ${reviewId}
    `)) as unknown as { code: string; label_en: string; active: boolean }[];
    expect(joined).toHaveLength(1);
    expect(joined[0]!.label_en).toBe('Underexposed');
    expect(joined[0]!.active).toBe(false);

    // Deleting it is the edit that would orphan the verdict, so the database
    // refuses it. Not a rule in the service: this is a psql session.
    await violates(
      'episode_review_reasons_code_review_reason_codes_code_fk',
      d.execute(sql`delete from review_reason_codes where code = 'VQ-DARK'`),
    );

    // Renaming the primary key is the same edit wearing a different hat.
    await violates(
      'episode_review_reasons_code_review_reason_codes_code_fk',
      d.execute(sql`update review_reason_codes set code = 'VQ-UNDEREXPOSED' where code = 'VQ-DARK'`),
    );
  });
});
