/**
 * One collector who is already past onboarding, so a demonstration opens on the
 * screen worth showing instead of nine screens of tapping.
 *
 *   PLAYERONE_DEMO_PHONE=0900000001 DATABASE_URL=... node packages/api/scripts/seed-demo.mjs
 *
 * Two rules separate this from `seed-console.mjs`, and both exist because this
 * one is pointed at a database somebody might care about.
 *
 * **It never truncates.** `seed-console.mjs` empties every table, which is
 * right for a scratch database and wrong here.
 *
 * **It owns exactly one identity and refuses to touch anything else.** That
 * identity is the fixed ids below, the external reference, and the phone number
 * in `PLAYERONE_DEMO_PHONE`. If any of those is already held by a row that is
 * not this demo collector, the whole transaction rolls back and says which. It
 * never overwrites somebody else's row to make room for itself.
 *
 * What "past onboarding" means is decided by `startRoute` in
 * `apps/collector/src/App.tsx`, not by guesswork: a non-empty name, six
 * accepted agreements, training complete, and a passed exam. Miss any one and
 * the app opens on that step instead of Home.
 */
import { sql } from 'drizzle-orm';
import { open } from '../../store/src/index.ts';

/** Fixed, so running this twice is the same demo rather than a second one. */
const ID = {
  collector: '00000000-0000-4000-8000-00000000d001',
  task: '00000000-0000-4000-8000-00000000d002',
  scenario: '00000000-0000-4000-8000-00000000d003',
  deviceType: '00000000-0000-4000-8000-00000000d004',
  device: '00000000-0000-4000-8000-00000000d005',
  claim: '00000000-0000-4000-8000-00000000d006',
};
const REF = 'demo-collector';
const SERIAL = 'EGO-DEMO-0001';
/** The app's current agreement version. `liveClaim` writes `v1`; the app sends this. */
const AGREEMENT_VERSION = '1.0';
const AGREEMENTS = [
  'user',
  'privacy',
  'data_collection',
  'commercial_use',
  'manual_review',
  'offline_settlement',
];

const phone = process.env['PLAYERONE_DEMO_PHONE'];
if (phone === undefined || phone === '') {
  console.error(
    'PLAYERONE_DEMO_PHONE is not set. This script seeds that one number and no other,\n' +
      'and the API echoes a sign-in code for that number and no other. Set both to the same value.',
  );
  process.exit(2);
}

const db = await open();
const fail = (message) => {
  throw new Error(message);
};

try {
  await db.transaction(async (tx) => {
    // Nothing is written until every collision is ruled out, so a refusal
    // leaves the database exactly as it was.
    const clash = await tx.execute(sql`
      select id, external_ref, phone from collectors
       where (id = ${ID.collector} or external_ref = ${REF} or phone = ${phone})
         and id <> ${ID.collector}`);
    if (clash.length > 0) {
      const row = clash[0];
      fail(
        `a different collector already holds part of this demo identity: id ${row.id}, ` +
          `external_ref ${row.external_ref}, phone ${row.phone}. ` +
          'Refusing rather than overwriting it. Use a demo database, or change the ids in this script.',
      );
    }

    // A released claim cannot be un-released — `task_claims_released_after_check`
    // and the guards in 0007 — so a rerun after the demo consumed it cannot put
    // the collector back where the app expects them. A live claim is
    // `released_at is null`; there is no state column.
    const spent = await tx.execute(sql`
      select released_at from task_claims where id = ${ID.claim} and released_at is not null`);
    if (spent.length > 0) {
      fail(
        `the demo claim was released at ${spent[0].released_at} and cannot be reopened. ` +
          'Seed a fresh demo database rather than rewriting claim history.',
      );
    }

    await tx.execute(sql`
      insert into collectors (id, external_ref, name, phone, status, training_completed_at,
                              exam_result, exam_decided_at)
      values (${ID.collector}, ${REF}, 'Demo Collector', ${phone}, 'qualified', now(), 'pass', now())
      on conflict (id) do update set
        external_ref = excluded.external_ref, name = excluded.name, phone = excluded.phone,
        status = excluded.status, training_completed_at = excluded.training_completed_at,
        exam_result = excluded.exam_result, exam_decided_at = excluded.exam_decided_at`);

    // Append-only: an existing acceptance keeps its original timestamp rather
    // than being restamped on every rerun.
    await tx.execute(sql`
      insert into collector_agreements (collector_id, agreement, version, accepted_at)
      select ${ID.collector}, a, ${AGREEMENT_VERSION}, now()
        from unnest(${sql.raw(`array['${AGREEMENTS.join("','")}']`)}) as a
      on conflict do nothing`);

    await tx.execute(sql`
      insert into scenarios (id, code, privacy_risk_level) values (${ID.scenario}, 'home', 'low')
      on conflict (id) do nothing`);

    await tx.execute(sql`
      insert into tasks (id, name, unit_price, max_concurrent_claimants, status)
      values (${ID.task}, 'Demo housework', 1200.0000, 5, 'published')
      on conflict (id) do update set status = 'published'`);

    // A bound device: `SessionCreate` will not let a session be created without
    // one, so without this the demo stops one screen early.
    await tx.execute(sql`
      insert into device_types (id, code, generation) values (${ID.deviceType}, 'ego_headset', 'gen1')
      on conflict (id) do nothing`);
    await tx.execute(sql`
      insert into devices (id, device_type_id, hardware_serial, status, bound_collector_id, bound_at)
      values (${ID.device}, ${ID.deviceType}, ${SERIAL}, 'active', ${ID.collector}, now())
      on conflict (id) do update set bound_collector_id = excluded.bound_collector_id,
                                     bound_at = excluded.bound_at, status = excluded.status`);

    await tx.execute(sql`
      insert into task_claims (id, task_id, collector_id) values (${ID.claim}, ${ID.task}, ${ID.collector})
      on conflict (id) do nothing`);
  });

  console.log(`Demo collector ready. Sign in on the phone with: ${phone}`);
  console.log('The API returns that number’s code in the response, so the app fills it in.');
  console.log(`Task "Demo housework", device ${SERIAL}, claim active.`);
} catch (error) {
  console.error(`seed-demo refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
