/**
 * The one seed for the Thursday stakeholder demo.
 *
 *   DATABASE_URL=postgres://playerone_app:...@host:5433/po_demo_readiness \
 *   node packages/api/scripts/seed-stakeholder.mjs
 *
 * What it leaves behind: one upload centre with a machine, three staff
 * identities (administrator, finance, reviewer), the demo collector
 * +84900000001 past training and exam with a declared collection session and
 * work on it, four published tasks, and the collector's ZaloPay destination
 * declared - unverified, which is the honest state of this pilot.
 *
 * It composes the three scripts that already do this work rather than
 * reimplementing them, because each already carries its own ownership refusals
 * and its own reasons:
 *
 *   - bin/bootstrap.ts            centre, machine, administrator, finance
 *   - scripts/seed-demo.mjs       the collector, past onboarding
 *   - scripts/seed-demo-work.mjs  three more tasks, the session, episodes, a bill
 *
 * It adds the two things none of them do: a reviewer (bootstrap refuses that
 * role on purpose - a reviewer belongs to no centre) and the payout
 * destination, declared through POST /api/payout/accounts, which is the route
 * finance itself uses. No ZaloPay client is passed, so verifyDeclaration
 * stores `unverified` (payout/domain/verify.ts) and the demo ends at
 * "awaiting payment - destination unverified". That is not a simulation of the
 * refusal; it is the refusal.
 *
 * It never truncates anything. `seed-console.mjs` and `e2e-loop.mjs` both
 * truncate every table, which is why they are pointed at throwaway databases
 * and why neither may ever be run against the demo database. This script only
 * inserts, every id is fixed, and a second run adds nothing.
 *
 * It refuses any database whose name does not begin `po_demo` or
 * `playerone_demo`, so a mistyped DATABASE_URL cannot write demo identities
 * into a database somebody cares about.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { open } from '../../store/src/index.ts';
import { bootstrap } from '../bin/bootstrap.ts';
import { hashCredential, verifyCredential } from '../src/credentials.ts';
import { buildApi } from '../src/index.ts';

/* ----------------------------------------------------------- what it seeds */

const CENTRE = { region: 'HCM', name: 'Upload centre HCM-01' };
const MACHINE = 'demo-machine-1';
const ADMIN = 'op-1';
const FINANCE = 'fin-1';
const REVIEWER = 'rev-1';
const PHONE = process.env['PLAYERONE_DEMO_PHONE'] ?? '+84900000001';
/**
 * The serial of the unit that will actually record, because the handover's
 * device and the recording's basename have to agree. They did not on
 * 2026-09-14: the seed bound `EGO-DEMO-0001`, the owner's unit writes
 * `Orbbec_Ego_AZER76400HV_*`, and every episode off that card carried the
 * `SERIAL-CONFLICT` defect ("episode says AZER76400HV, handover says
 * EGO-DEMO-0001"). Default is the owner's unit.
 *
 * A second unit is added the same way: seed a second demo database with
 * `PLAYERONE_DEMO_DEVICE_SERIAL=<the other serial>`, or bind the second device
 * through the console's device screens, which is what a real centre does.
 * Note that changing this against an ALREADY-seeded database is refused rather
 * than rewritten - `seed-demo.mjs` checks that it owns the device row by its
 * serial - so a serial change means a fresh demo database.
 */
const DEVICE_SERIAL = process.env['PLAYERONE_DEMO_DEVICE_SERIAL'] ?? 'AZER76400HV';
/**
 * The wallet as `AccountBody` wants it: ten digits starting with 0
 * (payout/routes/payout.ts). Same subscriber number as PHONE, national form.
 */
const WALLET = process.env['PLAYERONE_ZALOPAY_SANDBOX_PHONE'] ?? '0900000001';
if (process.env['PLAYERONE_ZALOPAY_SANDBOX_PHONE'] !== undefined && (process.env['PLAYERONE_ZALOPAY_ENV'] ?? 'sandbox') !== 'sandbox') throw new Error('Sandbox destination requires sandbox environment');
if (!/^0\d{9}$/.test(WALLET)) throw new Error('Sandbox destination must be a national-format wallet phone');
const DECLARED_NAME = 'Demo Collector';
/** Fixed, so a rerun replays the declaration rather than making a second one. */
const ACCOUNT_ID = '00000000-0000-4000-8000-00000000c001';
/** seed-demo.mjs owns this id; the declaration has to name the same collector. */
const COLLECTOR_ID = '00000000-0000-4000-8000-00000000d001';

/**
 * The period the operator must ask `POST /api/settle/bills` for at 0:24.
 *
 * Printed here because it is not obvious and getting it wrong looks like the
 * platform failing in front of the room. Two rules decide it, and both were
 * measured at the rehearsal:
 *
 *   - It may not be the period the seeded bill already owns.
 *     `bills_collector_period_key` is (collector, period_start, period_end) and
 *     a collision is reported as `deferred_to_next_period`, not as an error —
 *     so the request answers `created: 0` and no bill appears. The seeded bill
 *     now closes on the 14th (`BILL_PERIOD` in `seed-demo-work.mjs`) and this
 *     period starts after it.
 *
 *   - `period_end` must be AFTER the demo day, not on it. `settleable()` in
 *     `settle.ts` bounds the cycle with `settlements.created_at < period_end`
 *     and has no lower bound at all, so an end at the demo day's own midnight
 *     excludes the money the room just watched being reviewed. The rehearsal's
 *     working request was `2026-09-15 → 2026-09-16` — the day after — and
 *     answered `created: 1`. Thursday is the 17th, so this ends on the 18th.
 *
 * `period_start` filters nothing; it is the label the collector then reads as
 * "This cycle" on the income screen, so it is the day after the last cycle.
 */
const DEMO_BILL_PERIOD = { start: '2026-09-15T00:00:00Z', end: '2026-09-18T00:00:00Z' };

/**
 * Supplied secrets are used as given; missing ones are generated and printed
 * once. Keep them: bootstrap compares a credential it already holds and
 * refuses a rerun that presents a different one, so a rerun needs the same
 * values in the environment.
 */
const generated = [];
const credential = (name) => {
  const held = process.env[name];
  if (held !== undefined && held !== '') return held;
  const made = randomBytes(12).toString('base64url');
  generated.push(name);
  return made;
};
const secrets = {
  machine: credential('PLAYERONE_DEMO_MACHINE_SECRET'),
  admin: credential('PLAYERONE_DEMO_ADMIN_SECRET'),
  finance: credential('PLAYERONE_DEMO_FINANCE_SECRET'),
  reviewer: credential('PLAYERONE_DEMO_REVIEWER_SECRET'),
};

/* ----------------------------------------------------------------- guards */

/** The database name out of a connection URL, or null if it is not one. */
export function databaseName(url) {
  try {
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return null;
    const held = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return held === '' ? null : held;
  } catch {
    return null;
  }
}

/** A demo database is one whose name says so. Nothing else may be written. */
export const DEMO_PREFIXES = ['po_demo', 'playerone_demo'];
export const isDemoDatabase = (name) =>
  name !== null && DEMO_PREFIXES.some((prefix) => name.startsWith(prefix));

const dbName = databaseName(process.env['DATABASE_URL'] ?? '');
if (!isDemoDatabase(dbName)) {
  const named = dbName === null ? 'no database' : "'" + dbName + "'";
  console.error(
    'seed-stakeholder refused: DATABASE_URL names ' + named + ', and this script only writes a ' +
      'demo database - one whose name starts with ' +
      DEMO_PREFIXES.map((p) => "'" + p + "'").join(' or ') + '. ' +
      'It seeds staff identities and a payout destination; a mistyped URL must not put those anywhere else.',
  );
  process.exit(2);
}

/* ------------------------------------------------------------------ steps */

const run = (script) => {
  console.log('\n== ' + script);
  const out = spawnSync(process.execPath, [join(import.meta.dirname, script)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYERONE_DEMO_PHONE: PHONE,
      PLAYERONE_DEMO_DEVICE_SERIAL: DEVICE_SERIAL,
    },
  });
  if (out.status !== 0) {
    const how = out.status ?? 'on signal ' + out.signal;
    throw new Error(script + ' exited ' + how + '; nothing further was seeded');
  }
};

/**
 * The reviewer. `bootstrap` refuses ref:reviewer:secret and
 * `authenticateOperator` excludes role = 'reviewer', both on purpose: PLT-10
 * puts PaXini's reviewers outside any VNG centre, so the row carries
 * upload_centre_id = null and the partial indexes on `operators` are written
 * around exactly that. Same refusal shape as bootstrap's: an existing row
 * whose credential differs is not overwritten.
 */
async function ensureReviewer(db) {
  const [held] = await db.execute(
    sql`select id, credential_hash from operators
         where external_ref = ${REVIEWER} and role = 'reviewer'`,
  );
  if (held !== undefined) {
    if (!(await verifyCredential(secrets.reviewer, held.credential_hash))) {
      throw new Error(
        "reviewer '" + REVIEWER + "' (" + held.id + ') already exists with a different ' +
          'credential. Supply PLAYERONE_DEMO_REVIEWER_SECRET with the value it was created ' +
          'with, rather than overwriting a sign-in somebody may be holding.',
      );
    }
    return "reviewer '" + REVIEWER + "' exists " + held.id;
  }
  // `operators.id` has no database default; bootstrap generates one too.
  const id = randomUUID();
  await db.execute(
    sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
        values (${id}, null, ${REVIEWER}, 'reviewer', ${await hashCredential(secrets.reviewer)})`,
  );
  return "reviewer '" + REVIEWER + "' created " + id;
}

/**
 * The destination, through finance's own route.
 *
 * Both tokens, because `requireActor` wants a person AND a machine from the
 * same centre - PRD 8.3.2 rule 1, and why bootstrap made a machine. No
 * payout.client is passed, so the stored status is `unverified` and ZaloPay is
 * never contacted.
 */
async function declareAccount(db) {
  const app = buildApi({ db, tokenSecret: randomBytes(24).toString('hex'), currency: 'VND' });
  try {
    const post = async (url, payload, headers) => {
      const res = await app.inject({ method: 'POST', url, payload, headers });
      if (res.statusCode >= 300) {
        throw new Error('POST ' + url + ' -> ' + res.statusCode + ' ' + res.body);
      }
      return res.json();
    };
    const machine = await post('/auth/machine', {
      machine_identifier: MACHINE,
      secret: secrets.machine,
    });
    const finance = await post('/auth/operator', {
      external_ref: FINANCE,
      secret: secrets.finance,
    });
    const body = await post(
      '/api/payout/accounts',
      {
        id: ACCOUNT_ID,
        collector_id: COLLECTOR_ID,
        method: 'WALLET',
        declared_name: DECLARED_NAME,
        phone: WALLET,
      },
      {
        'x-machine-token': 'Bearer ' + machine.token,
        authorization: 'Bearer ' + finance.token,
      },
    );
    return 'payout destination ' + (body.replayed ? 'replayed' : 'declared') + ' ' + body.method +
      ' verify_status=' + body.verify_status;
  } finally {
    await app.close();
  }
}

/* ------------------------------------------------------------------- main */

const db = await open();
try {
  console.log("Seeding the stakeholder demo on '" + dbName + "'. Nothing is truncated.");
  console.log('\n== bootstrap: centre, machine, administrator, finance');
  for (const line of await bootstrap(db, {
    mode: 'create',
    region: CENTRE.region,
    name: CENTRE.name,
    machine: MACHINE,
    secret: secrets.machine,
    operators: [
      { ref: ADMIN, role: 'administrator', secret: secrets.admin },
      { ref: FINANCE, role: 'finance', secret: secrets.finance },
    ],
  })) {
    console.log(line);
  }
  console.log('\n== reviewer');
  console.log(await ensureReviewer(db));

  run('seed-demo.mjs');
  run('seed-demo-work.mjs');

  console.log('\n== payout destination, through the finance route');
  const declared = await declareAccount(db);
  console.log(declared);

  const [tasks] = await db.execute(
    sql`select count(*)::int as n from tasks where status = 'published'`,
  );
  const [sessions] = await db.execute(
    sql`select count(*)::int as n from collection_sessions where collector_id = ${COLLECTOR_ID}`,
  );
  /**
   * Read back, not restated. The period is `BILL_PERIOD` in
   * `seed-demo-work.mjs`, and a second copy of it here is a second thing to
   * keep in step — which is the failure that put the seeded bill on the demo's
   * own period in the first place.
   */
  const [seededBill] = await db.execute(
    sql`select period_start, period_end from bills
         where collector_id = ${COLLECTOR_ID}
         order by period_end desc limit 1`,
  );
  const day = (at) => new Date(at).toISOString().slice(0, 10);
  const seededPeriod =
    seededBill === undefined
      ? 'no seeded bill was found'
      : day(seededBill.period_start) + ' - ' + day(seededBill.period_end);
  const note =
    generated.length === 0
      ? ' All four were supplied from the environment.'
      : ' Generated this run - save them now:\n   ' + generated.join('\n   ') +
        '\n A rerun presenting different values is refused rather than overwriting a sign-in.';

  console.log(
    [
      '',
      '=====================================================================',
      " Stakeholder demo ready on '" + dbName + "'",
      '   centre              ' + CENTRE.region + ' / ' + CENTRE.name,
      '   machine             ' + MACHINE,
      '   administrator       ' + ADMIN,
      '   finance             ' + FINANCE,
      '   reviewer            ' + REVIEWER + '   (no centre, by role)',
      '   collector           ' + PHONE + '   qualified, exam pass',
      '   device serial       ' + DEVICE_SERIAL +
        '   (must match the recording basename, or SERIAL-CONFLICT)',
      '   collection sessions ' + sessions.n,
      '   published tasks     ' + tasks.n,
      '   ' + declared,
      '',
      ' The bill request to make at 0:24. POST /api/settle/bills needs a body,',
      ' and the period must not be one the collector already has a bill for:',
      '   {"period_start":"' + DEMO_BILL_PERIOD.start + '",' +
        '"period_end":"' + DEMO_BILL_PERIOD.end + '"}',
      '   seeded bill covers  ' + seededPeriod +
        '   (asking for that period again answers created: 0)',
      '   period_end is exclusive, so it has to be AFTER the demo day, not on it',
      '',
      ' Sign-in secrets, printed once:',
      '   machine ' + MACHINE + '    ' + secrets.machine,
      '   ' + ADMIN + '                    ' + secrets.admin,
      '   ' + FINANCE + '                   ' + secrets.finance,
      '   ' + REVIEWER + '                   ' + secrets.reviewer,
      note,
      " The payout destination is unverified, and that is the demo's honest ending:",
      ' no ZaloPay verification credential exists, so no account can be verified',
      ' and the API refuses a payment by name: payout_attempts_account_unverified',
      ' (with the database trigger payout_attempts_account_unverified behind it).',
      '=====================================================================',
    ].join('\n'),
  );
} catch (error) {
  console.error(
    '\nseed-stakeholder refused: ' + (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
