-- Deactivating a person, and making a sign-in name mean exactly one row.
--
-- STATUS
--   `upload_devices` has carried `status` since 0000 and `authenticateMachine`
--   has always read it. `operators` never got one, so there was no way to
--   deactivate a person at all: DELETE is refused by `audit_events.operator_id`
--   (an audit trail that loses its actor is not an audit trail), and blanking
--   `credential_hash` stops only the NEXT sign-in — measured, the cookie
--   already in the leaver's browser kept answering 200 for the rest of its
--   twelve-hour token. Same column, same two values, same shape as the device.
--
--   DEFAULT 'active' because every row that exists is somebody who works here;
--   NOT NULL because "unknown" is not a state a login may fall through.
--
--   The already-issued token is stopped in `requireActor`, which now reads this
--   column once per request. There is no token epoch and no revocation list:
--   the row is the answer, and one primary-key lookup is cheaper than a second
--   place for the same fact to be wrong.
--
-- ONE ROW PER SIGN-IN NAME
--   `POST /auth/operator` takes a reference and a secret; `POST /auth/machine`
--   takes an identifier and a secret. Neither has a centre to give, so both
--   lookups select on the name alone and take the first row Postgres returns —
--   heap order, which an unrelated UPDATE reorders. `operators_ref_key` is
--   UNIQUE(upload_centre_id, external_ref) and `upload_devices_machine_key` is
--   UNIQUE(upload_centre_id, machine_identifier), so two centres both calling
--   their clerk 'counter-1' both insert cleanly, and then one of them signs in
--   and the other is told their password is wrong — and which one changes.
--
--   0009 already settled this shape for reviewers with
--   `operators_reviewer_ref_key`: make the name unique so a lookup by name
--   alone has one row or none, never a first row. Same answer for the two other
--   login names. The refusal now lands when the second centre is set up, by
--   name, instead of at seven on a Monday morning at the counter.
--
--   The operator index is partial on `role <> 'reviewer'` so that it does not
--   overlap 0009's: a reviewer and a counter operator may still share a
--   reference, which `/api/session` already handles by role and which each
--   lookup already filters by role. The per-centre keys stay: they are what
--   makes "one clerk per name per centre" true independently of this.
--
--   A database that already holds a cross-centre duplicate will refuse this
--   migration by name. That is the intended failure — the duplicate is a
--   sign-in that answers at random today — and the fix is to rename one of
--   them before migrating.

ALTER TABLE "operators" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_status_check" CHECK ("operators"."status" in ('active', 'retired'));--> statement-breakpoint
CREATE UNIQUE INDEX "operators_counter_ref_key" ON "operators" USING btree ("external_ref") WHERE role <> 'reviewer';--> statement-breakpoint
CREATE UNIQUE INDEX "upload_devices_identifier_key" ON "upload_devices" USING btree ("machine_identifier");
