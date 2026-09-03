import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DISCREPANCY_CODES } from '@playerone/contracts';
import { DEFECT_CATALOGUE, REVIEW_REASON_CATALOGUE, seedCatalogues } from '../src/catalogue.ts';
import { closeDb, db, hasDb, truncate, violates, useDatabase } from './db.ts';

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
/**
 * One collector, one card, one centre, one session.
 *
 * `n` suffixes every human-readable reference in the fixture — the collector,
 * the serial, the card, the centre's machine and its operator — so a test that
 * needs a *second* of everything can call this twice. CLAUDE.md is explicit
 * about why that matters: a payment bug survived every green test because every
 * fixture had a single handover, and one collector cannot tell you whether the
 * money went to the right one.
 */
async function seedSpine(n = 1) {
  const d = await db();
  const ref = String(n).padStart(4, '0');
  const ids = {
    task: uid(),
    collector: uid(),
    deviceType: uid(),
    device: uid(),
    scenario: uid(),
    centre: uid(),
    uploadDevice: uid(),
    operator: uid(),
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
      values (${ids.collector}, ${`collector-${ref}`}, 'qualified');
  `);
  await d.execute(sql`
    insert into device_types (id, code, generation)
      values (${ids.deviceType}, ${`ego_headset_${ref}`}, 'gen1');
  `);
  await d.execute(sql`
    insert into devices (id, device_type_id, hardware_serial, status)
      values (${ids.device}, ${ids.deviceType}, ${`AZER764000${ref}`}, 'active');
  `);
  await d.execute(sql`
    insert into scenarios (id, code, privacy_risk_level)
      values (${ids.scenario}, ${`home_${ref}`}, 'low');
  `);
  await d.execute(sql`
    insert into upload_centres (id, region, name, status)
      values (${ids.centre}, 'HCM', ${`District 7 centre ${ref}`}, 'active');
  `);
  await d.execute(sql`
    insert into upload_devices (id, upload_centre_id, machine_identifier, status)
      values (${ids.uploadDevice}, ${ids.centre}, ${`HCM-IMPORT-${ref}`}, 'active');
  `);
  await d.execute(sql`
    insert into operators (id, upload_centre_id, external_ref, role)
      values (${ids.operator}, ${ids.centre}, ${`op-${ref}`}, 'centre_operator');
  `);
  await d.execute(sql`
    insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
      values (${ids.handover}, ${ids.collector}, ${ids.device}, ${`CARD-${ref}`}, ${ids.centre}, ${ids.operator}, now());
  `);
  await d.execute(sql`
    insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status)
      values (${ids.batch}, ${ids.handover}, ${ids.uploadDevice}, now(), 'importing');
  `);
  await d.execute(sql`
    insert into collection_sessions
      (id, handover_id, task_id, collector_id, scenario_id, others_in_frame,
       sensitive_info_present, session_origin)
      values (${ids.session}, ${ids.handover}, ${ids.task}, ${ids.collector}, ${ids.scenario},
              false, false, 'handover');
  `);
  await d.execute(sql`
    insert into collection_session_devices (collection_session_id, device_id, role)
      values (${ids.session}, ${ids.device}, 'headset');
  `);
  return ids;
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
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state)
          values (${id}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND', '1200.0000', '0.141667', '170.0004', 'pending_settlement');
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
    async function seedSettlement(state = 'pending_settlement', n = 1) {
      const ids = await seedSpine(n);
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
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state)
          values (${settlementId}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND',
                  '1200.0000', '0.141667', '170.0004', ${state});
      `);
      return { ...ids, settlementId };
    }

    /**
     * The weekly cycle that contains now, as the pair of local Vietnamese dates
     * a bill is labelled with. `n` steps forward or back by whole cycles.
     *
     * Computed rather than written down, because `bill_lines_period_check`
     * refuses a line whose settlement was owed after its bill ends and every
     * settlement in these fixtures is owed *now*. A hard-coded August 2026 pair
     * was correct for one week and then quietly wrong.
     */
    const ANCHOR = Date.parse('1970-01-05T00:00:00+07:00');
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const localDay = (ms: number) => new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const cycleAt = (ms: number): [string, string] => [localDay(ms), localDay(ms + WEEK)];
    const cycle = (n = 0): [string, string] =>
      cycleAt(ANCHOR + Math.floor((Date.now() - ANCHOR) / WEEK) * WEEK + n * WEEK);
    /** The same length, one day off the lattice: an overlapping cycle. */
    const skewed = (): [string, string] =>
      cycleAt(ANCHOR + Math.floor((Date.now() - ANCHOR) / WEEK) * WEEK + 24 * 60 * 60 * 1000);

    /**
     * A bill, the lines it is the sum of, and the states those lines imply — in
     * one transaction, because the schema gives no other way to write them.
     *
     * Two constraint triggers are DEFERRABLE and both are checked at COMMIT.
     * `bills_total_matches_lines` needs the lines to exist by then, because the
     * header is written first. `bill_lines_settled_guard` needs the settlements
     * to be `bill_generated` by then, and the transition guard needs the lines
     * to exist before it will allow that — the pair is circular on purpose, and
     * a transaction is what resolves it. So this helper is not a convenience:
     * it is the only shape the database accepts, and every fixture below has to
     * take it. That is the invariant working.
     *
     * The period is stated as `+07` and not `Z`. A cycle begins at local
     * midnight in Vietnam, and `bills_period_local_midnight_check` refuses
     * anything else — a UTC midnight is 07:00 in Ho Chi Minh City.
     */
    const issueBill = async (
      billId: string,
      collectorId: string,
      total: string,
      settlementIds: readonly string[],
      period: readonly [string, string] = cycle(),
      currency = 'VND',
    ) => {
      const d = await db();
      return d.transaction(async (tx) => {
        await tx.execute(sql`
          insert into bills (id, collector_id, period_start, period_end, currency, total)
            values (${billId}, ${collectorId}, ${`${period[0]}T00:00:00+07`},
                    ${`${period[1]}T00:00:00+07`}, ${currency}, ${total});
        `);
        for (const settlementId of settlementIds) {
          await tx.execute(sql`
            insert into bill_lines (bill_id, settlement_id) values (${billId}, ${settlementId});
          `);
          await tx.execute(sql`
            update settlements set settlement_state = 'bill_generated', updated_at = now()
             where id = ${settlementId};
          `);
        }
      });
    };

    const move = async (settlementId: string, to: string): Promise<unknown> => {
      const d = await db();
      return d.execute(sql`
        update settlements set settlement_state = ${to}, updated_at = now() where id = ${settlementId};
      `);
    };

    const stateOf = async (settlementId: string): Promise<string | undefined> => {
      const d = await db();
      const rows = (await d.execute(
        sql`select settlement_state from settlements where id = ${settlementId}`,
      )) as unknown as { settlement_state: string }[];
      return rows[0]?.settlement_state;
    };

    /**
     * A second payable settlement for a collector who already has one.
     *
     * Needed by every fixture that has to issue *two* bills, because an empty
     * header is refused now: `bills_total_matches_lines` treats a bill with no
     * billable lines as not a document. So a test about periods still has to
     * bring real money with it.
     */
    const another = async (
      seeded: { session: string; task: string; collector: string },
      /**
       * When the obligation arose. Defaults to now; a fixture that bills an
       * *earlier* cycle has to say so, because `bill_lines_period_check`
       * refuses a line whose settlement was owed after its bill ends. The
       * column is frozen once written, so this is the only chance to set it.
       */
      owedAt?: string,
    ) => {
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: seeded.session,
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
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state, created_at)
          values (${settlementId}, ${reviewId}, ${seeded.task}, ${seeded.collector}, 'VND',
                  '1200.0000', '0.141667', '170.0004', 'pending_settlement',
                  ${owedAt ?? new Date().toISOString()});
      `);
      return settlementId;
    };

    /** An instant inside the cycle `n` steps from the current one. */
    const during = (n: number): string =>
      new Date(Date.parse(`${cycle(n)[0]}T00:00:00+07:00`) + 60 * 60 * 1000).toISOString();

    /** The ordinary path: one settlement, on one issued bill, `bill_generated`. */
    const billed = async () => {
      const seeded = await seedSettlement();
      await issueBill(uid(), seeded.collector, '170.0004', [seeded.settlementId]);
      return seeded;
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
          insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                   unit_price, effective_minutes, amount, settlement_state)
            values (${uid()}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND',
                    '1200.0000', '0.141667', '170.0004', 'manually_paid');
        `),
      );
    });

    it('walks pending_settlement to bill_generated to manually_paid', async () => {
      const { settlementId } = await billed();
      await move(settlementId, 'manually_paid');
      expect(await stateOf(settlementId)).toBe('manually_paid');
    });

    it('refuses manually_paid -> pending_review, which the state CHECK accepts', async () => {
      const { settlementId } = await billed();
      await move(settlementId, 'manually_paid');

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
        /**
         * The edge that used to be legal and is not any more. `bill_lines`
         * membership is written once, so a settlement that left a bill would
         * still be on it: the header would keep counting money nobody intends
         * to pay, and re-billing it later would fail for ever on
         * `bill_lines_settlement_key`. An issued bill is final; correcting one
         * needs a credit note this system does not have.
         */
        ['bill_generated', 'exception'],
        ['exception', 'bill_generated'],
        ['exception', 'manually_paid'],
        ['exception', 'pending_review'],
      ];
      for (const [from, to] of illegal) {
        await truncate();
        if (from === 'bill_generated') {
          const { settlementId } = await billed();
          await violates('settlements_transition_check', move(settlementId, to));
          expect(await stateOf(settlementId)).toBe(from);
          continue;
        }
        const { settlementId } = await seedSettlement(
          from === 'pending_review' ? 'pending_review' : 'pending_settlement',
        );
        if (from === 'exception') await move(settlementId, 'exception');
        await violates('settlements_transition_check', move(settlementId, to));
        expect(await stateOf(settlementId)).toBe(from);
      }
      // Ten cases, each a truncate and a fresh spine. The default 5 s is for a
      // single statement, not for a sweep.
    }, 30_000);

    it('lets an exception go back to the queue, because that is the only way out', async () => {
      const { settlementId, collector } = await seedSettlement();
      await move(settlementId, 'exception');
      await move(settlementId, 'pending_settlement');
      await issueBill(uid(), collector, '170.0004', [settlementId]);
      expect(await stateOf(settlementId)).toBe('bill_generated');
    });

    it('refuses to call a settlement billed while it is on no bill', async () => {
      // Without this the whole lane is walkable on a row that is on no bill and
      // has no line: `pending_settlement -> bill_generated -> manually_paid`
      // would leave a settlement claiming it was billed and paid with nothing
      // to show a finance person. A state name has to be a fact.
      const { settlementId, collector } = await seedSettlement();
      await violates('settlements_billed_has_line_check', move(settlementId, 'bill_generated'));
      expect(await stateOf(settlementId)).toBe('pending_settlement');

      await issueBill(uid(), collector, '170.0004', [settlementId]);
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
      // Who is owed, and in what unit, is as much a part of the amount as the
      // number. Reassigning a session must not repoint a scored verdict's money.
      await violates(
        'settlements_amount_immutable_check',
        d.execute(sql`update settlements set collector_id = ${uid()} where id = ${settlementId};`),
      );
      await violates(
        'settlements_amount_immutable_check',
        d.execute(sql`update settlements set currency = 'USD' where id = ${settlementId};`),
      );
    });

    it('refuses an amount that is not the quantised product of its own two columns', async () => {
      // The one property a disputed invoice is checked against, as a CHECK
      // rather than as a function only `money.ts` is obliged to call. Postgres
      // rounds numerics half away from zero, which is `quantise`'s rule.
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
      const write = (minutes: string, amount: string, price = '1200.0000') => sql`
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state)
          values (${uid()}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND',
                  ${price}, ${minutes}, ${amount}, 'pending_settlement');
      `;
      // 1200 x 0.141667 is 170.0004 exactly. 170.0000 is what a writer that
      // multiplied the *unrounded* seconds would store, and it is wrong.
      await violates('settlements_amount_formula_check', d.execute(write('0.141667', '170.0000')));
      // A negative price is not a discount.
      // Zero minutes, so `amount` stays 0.0000 and both the formula check and
      // `settlements_amount_nonneg_check` are satisfied. Only the operand rule
      // can be what refuses this, which is what the assertion has to prove.
      await violates('settlements_operands_nonneg_check', d.execute(write('0.000000', '0.0000', '-1200.0000')));
      // And the mirror: a negative duration, at a price of zero so the product
      // is still 0.0000 and again only the operand rule can fire.
      await violates('settlements_operands_nonneg_check', d.execute(write('-0.000001', '0.0000', '0.0000')));
      await d.execute(write('0.141667', '170.0004'));
    });

    it('cannot put one settlement on two bills', async () => {
      const seeded = await seedSettlement();
      // Owed during last cycle, so both that cycle and this one could carry it:
      // `bill_lines_period_check` has an upper bound and no lower one, which is
      // the late-obligation policy. Two *adjacent* bills are therefore the
      // sharpest version of this test — neither the period nor the header
      // conflicts, and only the line key stands between one payment and two.
      const settlementId = await another(seeded, during(-1));
      const billOne = uid();
      const billTwo = uid();
      await issueBill(billOne, seeded.collector, '170.0004', [settlementId], cycle(-1));
      // The second bill has nowhere to write the line. It is issued in one
      // transaction with that line, because membership is frozen at issuance
      // and a line added to an existing bill is refused for that reason first —
      // a different constraint, and its own test below.
      await violates(
        'bill_lines_settlement_key',
        issueBill(billTwo, seeded.collector, '170.0004', [settlementId], cycle()),
      );
    });

    it('cannot move a settlement onto another collector’s bill, or off its own', async () => {
      // The two foreign keys on `bill_lines` are independent: nothing in
      // `bill_id uuid` and `settlement_id uuid` says the two have to agree
      // about whose money this is. Without the guard a line can be attached to
      // any bill at all, and can be moved or deleted after the header was
      // totalled -- and then `bills.total` means nothing.
      const one = await seedSettlement();
      const two = await seedSettlement(undefined, 2);
      expect(one.collector).not.toBe(two.collector);
      const d = await db();
      const billOne = uid();
      await issueBill(billOne, one.collector, '170.0004', [one.settlementId]);

      // The stranger's bill is for the same cycle: `bills_no_overlap` is per
      // collector, so a second payee's cycle is not in the way, and the owner
      // check is what has to refuse the line.
      const stranger = uid();
      await violates(
        'bill_lines_owner_check',
        issueBill(stranger, two.collector, '170.0004', [one.settlementId], cycle()),
      );

      await violates(
        'bill_lines_immutable_check',
        d.execute(sql`update bill_lines set bill_id = ${stranger} where settlement_id = ${one.settlementId};`),
      );
      await violates(
        'bill_lines_immutable_check',
        d.execute(sql`delete from bill_lines where settlement_id = ${one.settlementId};`),
      );
    });

    it('refuses a header that does not add up to its own lines', async () => {
      // The only cross-row invariant in the money chain, and the only one a
      // per-row CHECK cannot express: the generator writes the header before
      // the lines it is the sum of, so the check is deferred to commit.
      const { settlementId, collector } = await seedSettlement();
      await violates(
        'bills_total_matches_lines',
        issueBill(uid(), collector, '0.0000', [settlementId]),
      );
      await violates(
        'bills_total_matches_lines',
        issueBill(uid(), collector, '99999.0000', [settlementId]),
      );
      // And the total cannot be edited away from the sum afterwards either.
      const billId = uid();
      await issueBill(billId, collector, '170.0004', [settlementId]);
      const d = await db();
      await violates(
        'bills_total_matches_lines',
        d.execute(sql`update bills set total = '1.0000' where id = ${billId};`),
      );
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
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state)
          values (${settlementId}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND',
                  '1200.0000', '0.000000', '0.0000', 'not_payable');
      `);
      expect(d).toBeDefined();
      await violates(
        'bill_lines_payable_check',
        issueBill(billId, ids.collector, '0.0000', [settlementId]),
      );
    });

    it('refuses a second bill for the same collector and cycle', async () => {
      const seeded = await seedSettlement();
      const second = await another(seeded);
      // SET-07's idempotency, with the generator bypassed entirely.
      await issueBill(uid(), seeded.collector, '170.0004', [seeded.settlementId]);
      await violates(
        'bills_collector_period_key',
        issueBill(uid(), seeded.collector, '170.0004', [second]),
      );
    });

    it('refuses a bill whose lines nobody ever billed', async () => {
      /**
       * The other direction of the causality above. The transition guard says a
       * settlement cannot be `bill_generated` without a line; this says a line
       * cannot exist unless its settlement is billed. The pair is circular by
       * construction, so this half is deferred to COMMIT — which is exactly the
       * state a crash between two transactions would leave: a bill whose lines
       * nobody ever moved.
       */
      const { settlementId, collector } = await seedSettlement();
      const d = await db();
      const billId = uid();
      await violates(
        'bill_lines_settled_check',
        d.transaction(async (tx) => {
          await tx.execute(sql`
            insert into bills (id, collector_id, period_start, period_end, currency, total)
              values (${billId}, ${collector}, ${`${cycle()[0]}T00:00:00+07`},
                      ${`${cycle()[1]}T00:00:00+07`}, 'VND', '170.0004');
          `);
          await tx.execute(sql`
            insert into bill_lines (bill_id, settlement_id) values (${billId}, ${settlementId});
          `);
        }),
      );
      const rows = (await d.execute(
        sql`select count(*)::int as n from bills`,
      )) as unknown as { n: number }[];
      expect(rows[0]!.n).toBe(0);
    });

    it('refuses to bill a failed review even when the amount says otherwise', async () => {
      /**
       * SET-01 makes settlements out of pass and partial-pass reviews. The
       * amount check catches a `fail` in practice, because the review lane
       * scores one 0.0000 — but it was the *amount* being checked, not the
       * verdict, so raw SQL could attach a formula-valid positive settlement to
       * a failed review and bill it. The verdict is what decides now.
       */
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
      // Worth 170.0004 and arithmetically consistent. Only the verdict is wrong.
      await d.execute(sql`
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state)
          values (${settlementId}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND',
                  '1200.0000', '0.141667', '170.0004', 'pending_settlement');
      `);
      await violates(
        'bill_lines_payable_check',
        issueBill(billId, ids.collector, '170.0004', [settlementId]),
      );
    });

    it('refuses to relabel or delete a bill after it is issued', async () => {
      // Every other guard freezes the *lines*. Without this the header could
      // still be moved to another payee, redenominated, or dated into a
      // different cycle while every line stayed where it was — and none of the
      // membership checks would rerun, because they fire on `bill_lines`.
      const { settlementId, collector } = await seedSettlement();
      const billId = uid();
      await issueBill(billId, collector, '170.0004', [settlementId]);
      const d = await db();
      const other = await seedSettlement(undefined, 2);
      for (const set of [
        sql`collector_id = ${other.collector}`,
        sql`currency = 'USD'`,
        sql`period_start = ${`${cycle(1)[0]}T00:00:00+07`}`,
        sql`period_end = ${`${cycle(1)[1]}T00:00:00+07`}`,
      ]) {
        await violates(
          'bills_document_immutable_check',
          d.execute(sql`update bills set ${set} where id = ${billId};`),
        );
      }
      await violates(
        'bills_document_immutable_check',
        d.execute(sql`delete from bills where id = ${billId};`),
      );
    });

    it('cannot issue two overlapping cycles for one collector', async () => {
      /**
       * `bills_collector_period_key` only stops a *duplicate* period. A one-day
       * bill starting on the canonical Monday is a different key, is aligned on
       * its own length, and used to be insertable — and then it sat inside the
       * week and `bills_no_overlap` refused the canonical cycle when it came,
       * for ever, because a bill cannot be deleted.
       *
       * `bills_cycle_length_check` is what stops it now, and it is the earlier
       * and better refusal: with one length for the deployment, aligned periods
       * tile, so two bills either coincide — the unique index — or are
       * disjoint. `bills_no_overlap` remains as the backstop below.
       */
      const seeded = await seedSettlement();
      const collector = seeded.collector;
      const d = await db();
      await issueBill(uid(), collector, '170.0004', [seeded.settlementId], cycle());
      const oneDay: [string, string] = [
        cycle()[0],
        localDay(Date.parse(`${cycle()[0]}T00:00:00+07:00`) + 24 * 60 * 60 * 1000),
      ];
      await violates('bills_cycle_length_check', issueBill(uid(), collector, '0.0000', [], oneDay));

      // The backstop, shown by taking the length guard out of the way. It is a
      // trigger and a trigger can be disabled; the EXCLUDE constraint cannot,
      // and it is the reason an off-length bill can never quietly coexist with
      // the cycle it sits inside.
      await d.execute(sql`alter table bills disable trigger bills_schedule_guard;`);
      try {
        await violates('bills_no_overlap', issueBill(uid(), collector, '0.0000', [], oneDay));
      } finally {
        await d.execute(sql`alter table bills enable trigger bills_schedule_guard;`);
      }

      // `[start, end)`: the instant that ends one cycle begins the next, and the
      // two do not overlap there. That half has to keep working — with a line of
      // its own, because an empty bill is not a bill. The *previous* cycle
      // rather than the next one, because a cycle that has not started cannot
      // be billed, and its settlement is owed inside it.
      await issueBill(
        uid(),
        collector,
        '170.0004',
        [await another(seeded, during(-1))],
        cycle(-1),
      );
    });

    it('refuses a cycle length this deployment does not bill on', async () => {
      /**
       * The schedule, below the API rather than inside it. `settle.ts` knows
       * `PLAYERONE_SETTLEMENT_CYCLE_DAYS`; a psql session does not, and
       * alignment alone cannot tell a fortnight from a week — both divide their
       * own modulus. The length is not written into the schema either, because
       * §13.2 leaves weekly `[ASSUMED]`: the first bill establishes it and
       * every bill after it has to agree.
       */
      const seeded = await seedSettlement();
      await issueBill(uid(), seeded.collector, '170.0004', [seeded.settlementId], cycle());
      const fortnight: [string, string] = [
        cycle(-2)[0],
        localDay(Date.parse(`${cycle(-2)[0]}T00:00:00+07:00`) + 14 * 24 * 60 * 60 * 1000),
      ];
      await violates(
        'bills_cycle_length_check',
        issueBill(uid(), seeded.collector, '170.0004', [await another(seeded, during(-2))], fortnight),
      );
    });

    it('refuses a bill for a cycle that has not started', async () => {
      /**
       * `settleable` has no lower bound, so a bill dated a week ahead sweeps up
       * everything owed today and labels it as work nobody has done yet. The
       * API answers 422; this is the same rule for a writer that does not go
       * through the API.
       */
      const seeded = await seedSettlement();
      await violates(
        'bills_cycle_started_check',
        issueBill(uid(), seeded.collector, '170.0004', [seeded.settlementId], cycle(1)),
      );
    });

    it('refuses a cycle that starts off the lattice', async () => {
      // Local midnight is not enough on its own: a seven-day bill starting on a
      // Tuesday is midnight at both ends and would still win the race for a
      // settlement the canonical Monday cycle wanted.
      const { collector } = await seedSettlement();
      await violates(
        'bills_period_aligned_check',
        issueBill(uid(), collector, '0.0000', [], skewed()),
      );
    });

    it('refuses a line added to a bill that was issued earlier', async () => {
      /**
       * Refusing UPDATE and DELETE stops a line being taken off a bill. It does
       * not stop one being added to a bill issued last month — append an
       * eligible settlement, move it to `bill_generated`, raise the header to
       * the new sum, and every other guard is satisfied inside that one
       * transaction, while a bill finance already paid quietly becomes partly
       * unpaid. Membership is frozen at issuance, not merely append-only.
       */
      const first = await seedSettlement();
      const billId = uid();
      await issueBill(billId, first.collector, '170.0004', [first.settlementId]);
      const d = await db();
      await d.execute(sql`update settlements set settlement_state = 'manually_paid', updated_at = now() where id = ${first.settlementId};`);

      // A second, entirely legitimate settlement for the same collector.
      const { episodeId, ingestId } = await seedEpisode({
        sessionId: first.session,
        measured: '8.500000',
      });
      const reviewId = uid();
      const late = uid();
      await d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${reviewId}, ${episodeId}, ${ingestId}, '8.500000', '8.500000', 'pass', now(), ${uid()});
      `);
      await d.execute(sql`
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state)
          values (${late}, ${reviewId}, ${first.task}, ${first.collector}, 'VND',
                  '1200.0000', '0.141667', '170.0004', 'pending_settlement');
      `);
      await violates(
        'bill_lines_issued_check',
        d.transaction(async (tx) => {
          await tx.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${billId}, ${late});`);
          await tx.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where id = ${late};`);
          await tx.execute(sql`update bills set total = '340.0008' where id = ${billId};`);
        }),
      );
      const rows = (await d.execute(
        sql`select total::text as total from bills where id = ${billId}`,
      )) as unknown as { total: string }[];
      expect(rows[0]!.total).toBe('170.0004');
    });

    it('refuses a line whose settlement was owed after the bill ends', async () => {
      // Otherwise the cycle dates on a bill stop describing the work on it.
      const { settlementId, collector } = await seedSettlement();
      await violates(
        'bill_lines_period_check',
        issueBill(uid(), collector, '170.0004', [settlementId], ['2020-01-06', '2020-01-13']),
      );
    });

    it('refuses to move an obligation between cycles by editing when it was owed', async () => {
      // `created_at` is what decides which cycle a settlement falls in, so an
      // editable one is a way to move money between bills with no audit.
      const { settlementId } = await seedSettlement();
      const d = await db();
      await violates(
        'settlements_amount_immutable_check',
        d.execute(sql`update settlements set created_at = now() - interval '90 days' where id = ${settlementId};`),
      );
    });

    it('refuses a cycle that does not begin at local midnight in Vietnam', async () => {
      // The unique index above only stops a *duplicate* period; it cannot stop
      // two overlapping ones, and overlapping cycles are how a settlement ends
      // up paid in whichever one happened to run first. Pinning both ends to
      // local midnight is what makes cycles tile instead of overlap.
      const { collector, settlementId } = await seedSettlement();
      const d = await db();
      const bill = (start: string, end: string) => sql`
        insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${uid()}, ${collector}, ${start}, ${end}, 'VND', '0.0000');
      `;
      /**
       * A UTC midnight is 07:00 in Ho Chi Minh City, which is what a naive
       * `new Date('2026-08-17')` produces and what this table used to accept.
       *
       * Both windows are deliberately short. A seven-day one starting at 07:00
       * local is also off the lattice, so `bills_period_aligned_check` answers
       * first and this test would pass while proving the wrong thing; an hour
       * and half an hour both divide the anchor exactly, which leaves the
       * midnight rule as the only constraint that can refuse them.
       */
      await violates(
        'bills_period_local_midnight_check',
        d.execute(bill('2026-08-17T00:00:00Z', '2026-08-17T01:00:00Z')),
      );
      await violates(
        'bills_period_local_midnight_check',
        d.execute(bill('2026-08-17T09:30:00+07', '2026-08-17T10:00:00+07')),
      );
      // And the positive control, which has to be a real bill: an empty header
      // is refused for its own reason now.
      await issueBill(uid(), collector, '170.0004', [settlementId], cycle());
    });

    it('gives a settlement worth nothing a terminal state instead of a queue', async () => {
      /**
       * The review lane writes a settlement for a `fail` too, worth 0.0000,
       * because that row is the score of the review. It can never reach a bill,
       * so in `pending_settlement` it was a debt always owed and never paid —
       * rescanned, filtered and re-counted by every cycle for ever.
       *
       * `not_payable` is that outcome named. A zero row must be born there, and
       * it cannot leave: no incoming edge, so real money cannot be written off
       * with an UPDATE, and no outgoing one, so a written-off row cannot be
       * revived into the payable queue.
       */
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
          values (${reviewId}, ${episodeId}, ${ingestId}, '8.500000', '0.000000', 'fail', now(), ${uid()});
      `);
      const write = (id: string, state: string) => sql`
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state)
          values (${id}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND',
                  '1200.0000', '0.000000', '0.0000', ${state});
      `;
      // `pending_settlement` is the only other state a settlement may be born
      // in — the transition guard refuses the rest outright — so it is the only
      // shape this CHECK can be asked to refuse.
      await violates(
        'settlements_zero_not_payable_check',
        d.execute(write(uid(), 'pending_settlement')),
      );

      const zero = uid();
      await d.execute(write(zero, 'not_payable'));
      for (const to of [
        'pending_settlement',
        'pending_review',
        'exception',
        'bill_generated',
        'manually_paid',
      ]) {
        await violates('settlements_transition_check', move(zero, to));
      }
      expect(await stateOf(zero)).toBe('not_payable');

      // And the other direction: money that is owed cannot be written off.
      // A second spine, because the first one already used collector-0001.
      const owed = await seedSettlement(undefined, 2);
      await violates('settlements_transition_check', move(owed.settlementId, 'not_payable'));
      expect(await stateOf(owed.settlementId)).toBe('pending_settlement');
    });

    it('refuses to write real money off by being born in the terminal state', async () => {
      /**
       * The expensive half of the same rule, and the one an implication misses.
       *
       * `amount > 0 or state = 'not_payable'` is satisfied by any positive row,
       * whatever state it is in, and the transition guard permits `not_payable`
       * on INSERT because a worthless row has to start there. Together they let
       * one statement park a formula-valid positive settlement in a terminal
       * state: `not_payable` has no outgoing edge and `amount` is frozen, so
       * the debt is written off permanently and no rule was broken doing it.
       *
       * The UPDATE route is covered above; this is the INSERT route, which is
       * the only other way into the state.
       */
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
      await violates(
        'settlements_zero_not_payable_check',
        d.execute(sql`
          insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                   unit_price, effective_minutes, amount, settlement_state)
            values (${uid()}, ${reviewId}, ${ids.task}, ${ids.collector}, 'VND',
                    '1200.0000', '0.141667', '170.0004', 'not_payable');
        `),
      );
    });

    it('refuses a bill with no lines on it', async () => {
      /**
       * `0 = 0` satisfies the sum rule, so an empty header was legal — and
       * permanent, because a bill cannot be deleted and `bills_no_overlap` then
       * blocks that collector's real cycle for ever. It is also a document
       * telling a collector that a week's work was worth nothing.
       */
      const { collector } = await seedSettlement();
      await violates('bills_total_matches_lines', issueBill(uid(), collector, '0.0000', []));
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
    expect(blocking).not.toContain('CHECKSUM-MISMATCH');

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
});
