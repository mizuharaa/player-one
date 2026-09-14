/**
 * The work and the money behind the demo collector, so the v2 screens can be
 * reviewed against figures the server actually computed.
 *
 *   PLAYERONE_DEMO_PHONE=+84900000001 DATABASE_URL=... node packages/api/scripts/seed-demo-work.mjs
 *
 * Run it AFTER `seed-demo.mjs` and AFTER `packages/api/bin/bootstrap.ts`, which
 * is the order `deploy/emu/up.ps1` already runs them in. It is a separate
 * script and not an extension of `seed-demo.mjs` for one structural reason: a
 * `handovers` row needs an upload centre and an operator, and those are
 * bootstrap's to create, not seed-demo's. Folding this in would have made
 * seed-demo depend on a step that runs after it.
 *
 * What it adds, and why each piece is needed to look at a screen:
 *
 * - **Three more published tasks**, with different unit prices and a `type`
 *   drawn from the four scenario codes. `GET /api/me/tasks` sends `type` and
 *   no scenario, and SPEC §21.2 picks a task's placeholder photograph from it,
 *   so without these the hall is one tile and one photograph.
 * - **Five episodes on one collection session**, each landing on a different
 *   collector-facing state. Four of APP-23's six are reachable against a real
 *   server at all: `pending_upload` and `uploading` describe bytes that have
 *   not reached the platform, and the platform only knows episodes an upload
 *   centre has already ingested (`EPISODE_STATE_OF` in `api/http.ts` says so).
 *   Those two states are only ever produced by the local delivery machine.
 * - **A bill over the last cycle**, because `cycle.confirmedVnd` is summed in
 *   SQL over `bill_lines → settlements`. With no bill the server sends an
 *   empty label and a zero, which is a true answer to a different question.
 * - **No payout account.** `/api/me/payout` then answers `none`, which is what
 *   this collector's situation actually is. SPEC §14 is explicit that a
 *   fixture must never seed `verified`: it teaches every reviewer a state the
 *   platform has never produced.
 *
 * Idempotent: every id is fixed and every insert is `on conflict do nothing`,
 * so a second run adds nothing. It refuses rather than overwriting if one of
 * its ids is held by a row it did not write.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { open, seedCatalogues } from '../../store/src/index.ts';

/** Fixed, so running this twice is the same demo rather than a second one. */
const ID = {
  collector: '00000000-0000-4000-8000-00000000d001',
  task: '00000000-0000-4000-8000-00000000d002',
  device: '00000000-0000-4000-8000-00000000d005',
  handover: '00000000-0000-4000-8000-00000000e001',
  batch: '00000000-0000-4000-8000-00000000e002',
  session: '00000000-0000-4000-8000-00000000e003',
  bill: '00000000-0000-4000-8000-00000000e004',
};
const EPISODE = (n) => `00000000-0000-4000-8000-0000000f000${n}`;
const TASK = (n) => `00000000-0000-4000-8000-0000000a000${n}`;
const CARD = 'TF-DEMO-0001';
const UNIT_PRICE = '1200.0000';

/**
 * The extra tasks. `type` is one of `SCENARIOS`, which is what §21.2's
 * placeholder map reads; the prices differ so the hall's price chips are not
 * four copies of one figure, and the targets differ so the claim bars are not
 * four copies of one shape.
 */
const TASKS = [
  { n: 1, name: 'Một buổi làm việc', type: 'office', price: '3800.0000', target: '14400.000000' },
  { n: 2, name: 'Đi chợ buổi sáng', type: 'shop', price: '5200.0000', target: '10800.000000' },
  { n: 3, name: 'Ca kho hàng', type: 'warehouse', price: '6000.0000', target: '21600.000000' },
];

const phone = process.env['PLAYERONE_DEMO_PHONE'];
if (phone === undefined || phone === '') {
  console.error('PLAYERONE_DEMO_PHONE is not set. Run seed-demo.mjs first, with the same value.');
  process.exit(2);
}

const db = await open();
/**
 * The review standard's own catalogue, so the failed episode below can name a
 * real reason code with PaXini's own Vietnamese rather than one invented here.
 * `seedCatalogues` is idempotent and the API calls it on boot anyway; calling
 * it first means this script does not depend on the API having been started.
 */
await seedCatalogues(db);

const fail = (message) => {
  throw new Error(message);
};
const one = async (tx, q) => (await tx.execute(q))[0];

try {
  await db.transaction(async (tx) => {
    const collector = await one(
      tx,
      sql`select id from collectors where id = ${ID.collector} and phone = ${phone}`,
    );
    if (collector === undefined) {
      fail(
        `no demo collector at ${ID.collector} with phone ${phone}. ` +
          'Run packages/api/scripts/seed-demo.mjs first.',
      );
    }

    // Bootstrap's centre and operator. This script creates neither: a demo
    // that invented its own would not be the one the console signs into.
    const centre = await one(tx, sql`select id from upload_centres order by created_at asc limit 1`);
    const operator = await one(tx, sql`select id from operators order by created_at asc limit 1`);
    const machine = await one(tx, sql`select id from upload_devices order by created_at asc limit 1`);
    if (centre === undefined || operator === undefined || machine === undefined) {
      fail('no upload centre, machine or operator. Run packages/api/bin/bootstrap.ts first.');
    }
    const scenario = await one(tx, sql`select id from scenarios where code = 'home' limit 1`);
    if (scenario === undefined) fail("no 'home' scenario. Run seed-demo.mjs first.");

    // -- the hall ---------------------------------------------------------
    for (const t of TASKS) {
      const held = await one(tx, sql`select name from tasks where id = ${TASK(t.n)}`);
      if (held !== undefined && held.name !== t.name) {
        fail(`tasks ${TASK(t.n)} is held by "${held.name}". Refusing rather than overwriting it.`);
      }
      await tx.execute(sql`
        insert into tasks (id, name, type, unit_price, target_effective_duration_s,
                           max_concurrent_claimants, status)
        values (${TASK(t.n)}, ${t.name}, ${t.type}, ${t.price}, ${t.target}, 5, 'published')
        on conflict (id) do nothing`);
    }
    // The task the collector already claimed gets a type and a target too, so
    // Home's claimed-task still and the detail hero are not the neutral one.
    await tx.execute(sql`
      update tasks set type = 'home', target_effective_duration_s = '14400.000000'
       where id = ${ID.task} and type is null`);

    // -- one recorded session ---------------------------------------------
    await tx.execute(sql`
      insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time)
      values (${ID.handover}, ${ID.collector}, ${ID.device}, ${CARD}, ${centre.id}, ${operator.id}, now())
      on conflict (id) do nothing`);
    await tx.execute(sql`
      insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status)
      values (${ID.batch}, ${ID.handover}, ${machine.id}, now(), 'importing')
      on conflict (id) do nothing`);
    const claim = await one(
      tx,
      sql`select id from task_claims where collector_id = ${ID.collector} and task_id = ${ID.task}
           and released_at is null limit 1`,
    );
    if (claim === undefined) fail('the demo collector holds no live claim. Run seed-demo.mjs first.');
    await tx.execute(sql`
      insert into collection_sessions (id, handover_id, task_id, collector_id, scenario_id,
                                       others_in_frame, sensitive_info_present, session_origin,
                                       task_claim_id, unit_price, currency)
      values (${ID.session}, ${ID.handover}, ${ID.task}, ${ID.collector}, ${scenario.id},
              false, false, 'handover', ${claim.id}, ${UNIT_PRICE}, 'VND')
      on conflict (id) do nothing`);
    await tx.execute(sql`
      insert into collection_session_devices (collection_session_id, device_id, role)
      values (${ID.session}, ${ID.device}, 'headset')
      on conflict do nothing`);

    /**
     * One episode, with as much of the chain as the state it should land on
     * needs. Every amount below is `unit_price × effective_minutes` at
     * MONEY_SCALE, computed here the way `settle.ts` computes it, because a
     * settlement whose amount does not reproduce from its own two columns is
     * the first thing a disputed invoice is checked against.
     */
    const episode = async ({ n, startedAt, seconds, review, minutes, amount, state, reason }) => {
      const episodeId = EPISODE(n);
      const ingestId = randomUUID();
      const held = await one(tx, sql`select device_serial from episodes where episode_id = ${episodeId}`);
      if (held !== undefined) return; // already seeded
      await tx.execute(sql`
        insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at,
                              ingest_count, collection_session_id, resolution_state, upload_path)
        values (${episodeId}, 'EGO-DEMO-0001', ${startedAt}, now(), now(), 1, ${ID.session}, 'resolved', 'A')`);
      await tx.execute(sql`
        insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename,
                                     measured_duration_s, timing_source, timing_confidence, manifest_present,
                                     engine_version, host, ingested_at, record_json)
        values (${ingestId}, ${episodeId}, ${'d'.repeat(63) + String(n)}, 'ok',
                ${`ego_EGO-DEMO-0001_${startedAt}`}, ${seconds}, 'pts_sidecar', 'exact', true,
                '0.3.1', 'seed-demo-work', now(), '{}'::jsonb)`);
      await tx.execute(sql`
        update episodes set latest_ingest_id = ${ingestId} where episode_id = ${episodeId}`);
      /*
       * The files, so the upload screen prints a size and not "0.0 GB".
       * `GET /api/me/episodes` sums `episode_files.size_bytes` over the latest
       * ingest, and with no rows that sum is a real zero — which reads on the
       * phone as a measured zero-byte recording rather than as "not supplied".
       * One video and one IMU log per episode, roughly the shape a real Ego
       * session has, scaled off the measured duration.
       */
      const mb = (n) => Math.round(n * 1024 * 1024);
      await tx.execute(sql`
        insert into episode_files (ingest_id, relative_path, size_bytes, sha256) values
          (${ingestId}, 'video.mp4', ${mb(Number(seconds) * 0.9)}, ${'e'.repeat(63) + String(n)}),
          (${ingestId}, 'imu.csv', ${mb(Number(seconds) * 0.02)}, ${'f'.repeat(63) + String(n)})`);
      if (review === null) return { episodeId, settlementId: null };

      const reviewId = randomUUID();
      await tx.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, effective_duration_s,
                                     review_state, reviewed_at, verdict_id)
        values (${reviewId}, ${episodeId}, ${ingestId}, ${seconds}, ${review === 'fail' ? '0.000000' : seconds},
                ${review}, now(), ${randomUUID()})`);
      if (reason !== undefined) {
        await tx.execute(sql`
          insert into episode_review_reasons (review_id, code) values (${reviewId}, ${reason})
          on conflict do nothing`);
      }
      const settlementId = randomUUID();
      await tx.execute(sql`
        insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price,
                                 effective_minutes, amount, settlement_state)
        values (${settlementId}, ${reviewId}, ${ID.task}, ${claim.id}, ${UNIT_PRICE},
                ${minutes}, ${amount}, 'pending_settlement')`);
      if (state === 'bill_generated') {
        await tx.execute(sql`
          update settlements set settlement_state = 'bill_generated', updated_at = now()
           where id = ${settlementId}`);
      }
      return { episodeId, settlementId };
    };

    // `uploaded` — ingested, nobody has looked at it yet.
    await episode({ n: 1, startedAt: '20260908_081500', seconds: '1680.000000', review: null });
    // `not_paid` → review_failed on the app. A failed review's settlement is
    // worth 0.0000 and stays in pending_settlement for ever, on purpose.
    await episode({
      n: 2,
      startedAt: '20260909_143000',
      seconds: '900.000000',
      review: 'fail',
      minutes: '0.000000',
      amount: '0.0000',
      state: 'pending_settlement',
      // A code out of `REVIEW_REASON_CATALOGUE`, with PaXini's own Vietnamese.
      // The app prints `coalesce(label_vi, label_en)` verbatim and this
      // repository does not own that sentence.
      reason: 'VQ-OCCLUSION',
    });
    // `approved` → reviewed and worth money, not yet on a bill. This is what
    // `cycle.estimatedVnd` is made of, and it is the SAME list the collector
    // sees — the server filters its own rows, it does not run a second query.
    await episode({
      n: 3,
      startedAt: '20260910_101500',
      seconds: '1620.000000',
      review: 'pass',
      minutes: '27.000000',
      amount: '32400.0000',
      state: 'pending_settlement',
    });
    // Two on a bill → `on_a_bill` (review_passed), and `cycle.confirmedVnd`.
    const billed = [
      await episode({
        n: 4,
        startedAt: '20260901_091000',
        seconds: '1080.000000',
        review: 'pass',
        minutes: '18.000000',
        amount: '21600.0000',
        state: 'bill_generated',
      }),
      await episode({
        n: 5,
        startedAt: '20260903_170000',
        seconds: '2160.000000',
        review: 'pass',
        minutes: '36.000000',
        amount: '43200.0000',
        state: 'bill_generated',
      }),
    ].filter((e) => e !== undefined && e.settlementId !== null);

    /**
     * The bill. `bills_total_matches_lines` (0011) says the total IS the sum
     * of the lines, and it is deferred to commit — so the bill and its lines go
     * in one transaction, which is what `settle.ts` does. The total below is
     * the exact sum of the two line amounts and is not rounded: a bill keeps
     * its exact figure, and only a payout attempt's `amount_vnd` is whole.
     */
    if (billed.length === 2) {
      const existing = await one(tx, sql`select id from bills where id = ${ID.bill}`);
      if (existing === undefined) {
        await tx.execute(sql`
          insert into bills (id, collector_id, period_start, period_end, currency, total)
          values (${ID.bill}, ${ID.collector}, '2026-09-01T00:00:00Z'::timestamptz,
                  '2026-09-16T00:00:00Z'::timestamptz, 'VND', '64800.0000')`);
        await tx.execute(sql`
          insert into bill_lines (bill_id, settlement_id) values
            (${ID.bill}, ${billed[0].settlementId}), (${ID.bill}, ${billed[1].settlementId})`);
      }
    }
  });

  console.log('Demo work seeded: 4 published tasks, 5 episodes, 1 bill over 01/09 - 15/09.');
  console.log('No payout account, on purpose: /api/me/payout answers "none" and never "verified".');
} catch (error) {
  console.error(`seed-demo-work refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
