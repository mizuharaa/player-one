# ADR 0003 — upload centres, machines and operators stay CLI/fixtures

**Status** Accepted, in force until the retirement condition below is met:
a second upload centre goes live, or the collector count reaches 500,
whichever comes first.
**Date** 2026-08-27
**Affects** BO-09; acceptance §10.2 item 8; BO-11 and SEC-02 for the role the
retirement needs

## Context

BO-09 (P0) reads: *"Create upload centres by region; bind fixed upload devices
and centre operators."* Acceptance §10.2 item 8 restates it: *"Upload centres
are created by region, with fixed devices and operators bound."* The brief's
§4.2 defines an upload centre as a staffed location with fixed hardware and a
card reader. §3.3 sets the scale: ~20 devices in the pilot, 500 collectors at
target.

The data model for all three objects exists and is enforced in the schema, on
`origin/integration/eight-features`: the tables, status CHECKs and unique
indexes in `packages/store/drizzle/0001_identity_spine.sql`, the two
`credential_hash` columns in `packages/store/drizzle/0002_auth_and_audit.sql`,
and `operators_centre_check` in `packages/store/drizzle/0009_reviewer_role.sql`:

- `upload_centres` — `region`, `name`, `status` with
  `upload_centres_status_check` (`active` / `suspended`).
- `upload_devices` — the fixed machines, FK to a centre,
  `upload_devices_machine_key` unique on (centre, `machine_identifier`),
  `upload_devices_status_check` (`active` / `retired`), a scrypt
  `credential_hash` for the machine token.
- `operators` — FK to a centre, `operators_ref_key` unique on (centre,
  `external_ref`), a scrypt `credential_hash` for the operator token, and
  `operators_centre_check`: everyone but a `reviewer` belongs to a centre.

All three are declared in `packages/store/src/schema.ts` (`uploadCentres`,
`uploadDevices`, `operators`). The bindings BO-09 asks for — machine to centre,
operator to centre — are foreign keys, so a machine or an operator cannot exist
unbound. The centre scope is then read on every mutation: `/auth/machine` and
`/auth/operator` in `packages/api/src/index.ts` issue tokens carrying
`uploadCentreId` (`packages/api/src/credentials.ts`, `MachineClaims` /
`OperatorClaims`), the counter refuses a handover at a centre the operator does
not serve (`packages/api/src/counter.ts`, and the cross-centre case in
`packages/api/test/counter.test.ts`, which seeds a second centre `HAN` with its
own operator), and every audit row written by an operator or a machine records
the centre (`packages/api/src/audit.ts`; a reviewer has no centre, and its rows
carry `null`).

What does not exist is a way to create the rows without SQL. There is no
`/api/upload-centres`, `/api/upload-devices` or `/api/operators` route in
`packages/api/src/backoffice.ts` — its routes are tasks, claims, collectors,
devices, bind/unbind and assignments (BO-01→BO-04) — and no console screen:
`apps/console/src/routes/NotBuilt.tsx` is what `/counter` renders, and
`apps/console/src/routes/Pipeline.tsx` lists BO-09 as `buildable`. Today a
centre, its machine and its operator are seeded as three `INSERT`s with
`hashCredential()` from `packages/api/src/credentials.ts`:

- `packages/api/scripts/seed-console.mjs` — the development seed
  (`HCM` / `D7`, machine `HCM-01`, operator `op-1`, role `centre_operator`).
- `packages/api/scripts/verify-review.mjs` and
  `packages/api/scripts/verify-e2e.mjs` — the same three rows.
- the test fixtures, one per API test file: `packages/api/test/counter.test.ts`
  (documented in `docs/RUNNING.md` as the shortest worked example),
  `backoffice.test.ts`, `review.test.ts`, `settle.test.ts`, `upload.test.ts`,
  `audit.test.ts`, `auth.test.ts`, `episodes.test.ts`, `reviewer.test.ts`
  (which also seeds reviewers `pax-01` / `pax-02` with a null centre), and
  `packages/api/test/payout/domain/fixture.ts`.

`docs/RUNNING.md` ("The operator API") tells an operator to do the same by
hand. The pilot has one centre, one region, and a handful of operators who are
JV staff; the fixture path is exercised on every test run and every seed.

## Decision

Upload centres, upload devices (machines) and operators are **not given console
CRUD** in the pilot. They stay as they are: rows in the three tables, written by
the seed scripts and the test fixtures, and by an engineer with `psql` and
`hashCredential()` for a real deployment.

The data invariants BO-09 implies — a machine belongs to exactly one centre, an
operator belongs to exactly one centre (or is a reviewer), references are unique
within a centre, status is one of a closed set — are already enforced in the
schema and tested. What is cut is the *screen and the routes*, not the model.
Nothing here relaxes a constraint, and no code path lets a machine or operator
act outside its centre.

This is the same cut `packages/api/src/backoffice.ts` records for device
assignments ("API and fixtures is the pilot shape, the same cut BO-09 took for
centres and machines"), and the one `PRODUCT.md` and `CLAUDE.md` said still
owed an ADR.

## Consequences

- Adding a centre, a machine or an operator is an engineering action, not an
  operations one. In the pilot there is one centre and the people who staff it
  are the people who can run the seed, so nobody is blocked. This stops being
  true at the retirement condition.
- Creating a credential means running `hashCredential()` and inserting the
  hash. Rotating one means the same. No self-service password change exists
  for an operator; a lost secret is a new row or an `UPDATE`.
- There is no audit row for creating a centre, a machine or an operator,
  because none goes through the audited mutate path in `audit.ts`. Every
  action *by* an operator or machine is audited; their creation is only in
  the Postgres log. This is the one BO-11-adjacent gap the cut opens, and it
  is acceptable while the rows are seeded by the engineer who also holds the
  database.
- A second centre is already a shape the code handles — `counter.test.ts`
  proves the scope check — so retiring this ADR is a screen, not a redesign.
- BO-09 stays P0 and unmet as a *screen*. Acceptance §10.2 item 8 is met at
  the data level and not at the interface level, and this ADR is the record
  of why.

## When this expires

This ADR is retired when **either** of the following happens, whichever comes
first:

1. **A second upload centre goes live** — a second row in `upload_centres`
   that real operators sign in against, not a test fixture. At that point an
   engineer is no longer the person on site, and the per-centre scoping the
   counter enforces (`packages/api/src/counter.ts`, handover must belong to
   the operator's centre) has to be administered by someone who cannot run
   SQL.
2. **The collector count reaches 500** — the §3.3 target. At that scale
   throughput at the counter makes operator turnover and machine replacement a
   routine event, and a routine event cannot be an `INSERT` an engineer runs.

The trigger is a fact in the database, so it can be checked with two queries:
`select count(*) from upload_centres where status = 'active'` and
`select count(*) from collectors`.

## What retiring it takes

1. Three route groups in `packages/api/src/backoffice.ts`, in the style of the
   existing `/api/devices` ones: list, create, patch (status) for
   `/api/upload-centres`, `/api/upload-devices` and `/api/operators`. Every
   mutation goes through the audited mutate path in `packages/api/src/audit.ts`;
   refusals use the existing `REFUSALS` / `API_REFUSALS` pattern with `en` and
   `zh` sentences in `packages/api/src/i18n.ts`. Credential creation calls
   `hashCredential()` server-side and never returns the hash.
2. A role check. **Half of this item is now done.** Migration
   `0020_backoffice_admin_role.sql` added `administrator` — §4.1's operations
   administrator and device administrator, collapsed into one for the pilot —
   with `adminGuard` in `packages/api/src/actor.ts` on every shaping route in
   `backoffice.ts` and two constraint triggers on `tasks` and `collectors`
   underneath them, in exactly the pair this item describes. What is still
   owed for BO-09 is the *super* administrator: `administrator` deliberately
   cannot mint an operator, a machine or a centre, because those routes do not
   exist, and it holds no finance power. The paragraph below is how the
   position read before that migration and is kept because the reasoning in
   "Alternatives considered" rests on it.

   `operators.role` before 0020 distinguished `centre_operator`,
   `reviewer` and `finance` (the last added by
   `packages/store/drizzle/0013_finance_role.sql` and checked in
   `packages/api/src/payout/routes/payout.ts`), and nothing else: there is no
   super-administrator role, and every other back-office route is open to any
   centre operator. Creating centres and operators is the super
   administrator's job in §4.1, so the routes need a role the session can
   carry before they are safe to expose. `operators.role` has no CHECK by
   design (the schema comment says why), so the value set can grow without a
   migration. The enforcement goes in two places, the way `finance` is done:
   a route `preHandler` that reads the role from the row (`payout.ts`,
   `requireFinance`), and the invariant in the schema — 0013's
   `payout_finance_required` trigger refuses a payout row whose audited actor
   is not `finance`, so the route check is a courtesy and the database is the
   gate. Centre and operator creation needs the same pair: a trigger on
   `upload_centres` / `upload_devices` / `operators` that requires the
   audited actor in the transaction to hold the new role, tested in raw SQL
   via `violates()` in `packages/store/test/db.ts`.
3. A console screen under `/counter` (or a new `/centres` route in
   `apps/console/src/router.tsx`), replacing the `counter` entry in
   `NotBuilt.tsx`, and flipping the BO-09 row in `Pipeline.tsx` from
   `buildable` to `built`.
4. Fixtures with a second centre, a second machine and a second operator in
   the new tests, because a single-centre fixture is the shape that hid a
   scoping bug before.
5. One migration, for the trigger in item 2 only. The tables, constraints and
   FKs are already what the screen needs.

## Alternatives considered

**Build the screen now.** Rejected: one centre, one region, a handful of staff
who are also the engineers. The screen would be exercised by nobody before the
pilot and would carry a role model (item 2 above) that does not exist yet.
Building it first would mean building the super-administrator role first,
which is more surface than the three routes it protects.

**Ship the routes without the screen.** Rejected for the same reason as above:
routes that create credentials need the role check, and a route reachable by
every centre operator that can mint another operator is a worse state than no
route.

**Manage them in the collector app or the upload-centre client.** Rejected:
BO-09 is a back-office requirement and §4.1 assigns it to the super
administrator, not to a centre operator or a collector.
