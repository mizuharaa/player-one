-- BO-11 and SEC-02: the back-office administrator role.
--
-- WHAT WAS WRONG
--   Every mutation in packages/api/src/backoffice.ts was open to any
--   authenticated operator at any centre: publish a task, price it, take it
--   down, qualify a collector, record an exam pass, bind or unbind a device.
--   `grep uploadCentreId packages/api/src/backoffice.ts` returns nothing across
--   1,257 lines, and that is correct rather than a bug: `collectors`, `devices`
--   and `tasks` carry no centre column and docs/adr/0003 records that the back
--   office is national by design. The gap was never a missing WHERE clause. It
--   was a missing role, and docs/adr/0003 item 2 of "What retiring it takes"
--   named it before this migration existed.
--
-- WHAT 'administrator' IS
--   `operators.role` has no CHECK, and schema.ts says why: the value set is a
--   back-office concern that grows. So this is not an ALTER. 'administrator' is
--   a value the guards below and `adminGuard` in packages/api/src/actor.ts
--   recognise.
--
--   §4.1 of the brief names an *operations administrator* (creates and prices
--   tasks, manages collectors) and a *device administrator* (device inventory,
--   binding, fault handling) as two JV roles. The pilot collapses them into
--   one: one centre, a handful of JV staff, and both people's whole surface is
--   one file. Splitting them is a value in this column and a second guard, with
--   no migration, on the day a site has enough staff to want it.
--
--   It is NOT §4.1's *super administrator*. It holds no finance power (0013 is
--   still the only way a bill is paid, and the separation of duty there still
--   bites) and it cannot mint operators or centres, because no route does that
--   at all — docs/adr/0003 is the record of that cut.
--
-- BACKFILL: YES, AND ON PURPOSE — the opposite of 0013.
--
--     UPDATE operators SET role = 'administrator' WHERE role = 'centre_operator'
--
--   0013 added a power nobody had, so failing closed cost nothing: until
--   somebody granted 'finance', nobody could pay, and an hour of a stopped
--   payout is cheaper than an open one. This migration REMOVES a power
--   everybody already holds. Failing closed here means that on the morning it
--   merges, at a pilot centre whose administrator is nobody, no task can be
--   published and no collector can be qualified — the back office stops, and
--   the fix needs the engineer who holds the database, who per docs/adr/0003 is
--   the person the on-site staff already are.
--
--   Promoting every existing `centre_operator` changes nobody's access on day
--   one. What changes is that the power is now named, refusable, and recorded:
--   the deployment step is DEMOTION, and it is one statement per clerk.
--
--     UPDATE operators SET role = 'centre_operator', updated_at = now()
--      WHERE upload_centre_id = '<centre>' AND external_ref = '<who>';
--
--   Until that is run the role is decoration. Say so out loud rather than
--   pretend otherwise: this migration makes the separation possible and
--   auditable, and a human decides who is a clerk.
--
--   `finance` and `reviewer` are deliberately NOT promoted. A finance operator
--   does lose task and collector shaping here, and that is the one intended
--   loss: 0013 exists so that the person who pays a collector is not the person
--   who created them, and letting finance keep the power to price the task they
--   will later pay out on is the same conflict one step earlier. An operator
--   holds one role, so a site that needs both needs two sign-ins, which is what
--   separation of duty means.
--
-- WHAT IS ENFORCED HERE, AND WHAT IS ONLY A ROUTE GUARD
--   A route guard is a courtesy; a trigger is a guarantee. The rule 0013 uses
--   to choose is money, so the same rule is used here.
--
--   IN THE DATABASE — `tasks` and `collectors`:
--     * `tasks` carries `unit_price`, the number money.ts multiplies into every
--       payment. 0006's `tasks_price_frozen` makes the price of a PUBLISHED
--       task settled terms, so the last moment a price can be set is the moment
--       a task is created or published — and after that a wrong figure is not
--       editable, it is paid. Publishing at 12000 instead of 1200 is money out
--       of the door with no route back.
--     * `collectors` carries the qualification and the exam result. 0006's
--       `task_claims_guard` refuses a claim without `qualified` status, an exam
--       pass and all six agreements, at the database. So whoever can write those
--       columns decides who may record and be paid at all. It is the entry gate
--       to the payable pipeline, and 0013's separation of duty already treats
--       `collector.create` as a decision that disqualifies the same person from
--       paying.
--
--   ROUTE GUARD ONLY — `devices`, `device_assignments`, `collector_agreements`:
--     * A device binding is inventory, not attribution. schema.ts says it
--       plainly on `devices.bound_collector_id`: §4.3 forbids inferring a
--       session's device from "whoever last had it", the session records its own
--       device, and resolve.ts pays on handover scoping. Changing a binding does
--       not change a payment, so it gets the guard the routes give it, plus the
--       audit row SEC-04 requires.
--     * `collector_agreements` IS a payment gate (the consent gate above), and
--       it is deliberately left to the route anyway. Both routes that write it
--       update the `collectors` row in the same transaction, so the trigger
--       below already covers every writer that exists. A trigger of its own
--       would bite the wrong actor as soon as `feat/collector-auth` lets a
--       collector accept their own agreements in the app (APP-02), which is a
--       collector's act and not an administrator's.
--
-- HOW THE TRIGGERS WORK, AND WHAT THEY DO NOT CLAIM
--   Same mechanism as 0013: `mutate` writes the audit row for every change
--   inside the change's own transaction, and a DEFERRED constraint trigger runs
--   at COMMIT, reads the rows this transaction wrote (`age(xmin) = 0`; see 0012
--   for the savepoint caveat) and asks the operator they name whether their role
--   is 'administrator'.
--
--   This is what makes the rule survive a forgotten route guard. A route added
--   next month still has to call `mutate` — that is the file's own rule — so it
--   still writes an audit row naming its operator, and the trigger still refuses
--   it. The route list is not the enforcement.
--
--   UNLIKE 0013, a write with NO audited operator passes. 0013 could refuse
--   those, because nothing legitimately writes a settlement or a payout attempt
--   outside a route. Tasks, collectors and devices are different: the seed
--   scripts (packages/api/scripts/*.mjs) and every API test fixture insert them
--   as raw SQL with no audit row, by the design docs/adr/0003 records, and a
--   trigger that refused them would refuse the fixtures rather than an attacker.
--   So the guarantee is stated exactly: IF AN OPERATOR DID IT, THAT OPERATOR
--   HOLDS THE ADMINISTRATOR ROLE. An engineer with psql is not in scope, and
--   could drop this trigger anyway.
--
--   Only `actor_role = 'operator'` rows are inspected. A reviewer cannot reach
--   these routes (PLT-10 scope in index.ts) and holds no back-office role. If a
--   later branch audits a third kind of actor — a collector under
--   `feat/collector-auth` — it must be recorded with its own `actor_role` and
--   not as 'operator', or this trigger will look it up in `operators`, find
--   nothing, and refuse.

UPDATE operators SET role = 'administrator', updated_at = now() WHERE role = 'centre_operator';
--> statement-breakpoint
CREATE FUNCTION backoffice_admin_in_transaction(p_table text, p_id text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
  actor_role text;
BEGIN
  FOR actor IN
    SELECT DISTINCT a.operator_id
      FROM audit_events a
     WHERE age(a.xmin) = 0
       AND a.actor_role = 'operator'
       AND a.operator_id IS NOT NULL
       AND a.action NOT LIKE '%.login'
       AND a.target_table = p_table
       AND a.target_id = p_id
  LOOP
    SELECT role INTO actor_role FROM operators WHERE id = actor;
    IF actor_role IS DISTINCT FROM 'administrator' THEN
      RAISE EXCEPTION 'backoffice_admin_required: % was written by operator %, whose role is %, not administrator', p_what, actor, actor_role
        USING ERRCODE = '23514', CONSTRAINT = 'backoffice_admin_required';
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE FUNCTION tasks_shaped_by_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM backoffice_admin_in_transaction('tasks', NEW.id::text, 'task ' || NEW.id::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tasks_shaped_by_admin
  AFTER INSERT OR UPDATE ON tasks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tasks_shaped_by_admin();
--> statement-breakpoint
CREATE FUNCTION collectors_shaped_by_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM backoffice_admin_in_transaction('collectors', NEW.id::text, 'collector ' || NEW.id::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER collectors_shaped_by_admin
  AFTER INSERT OR UPDATE ON collectors
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION collectors_shaped_by_admin();
