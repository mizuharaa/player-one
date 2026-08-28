-- 0017: a failed sign-in leaves an audit row.
--
-- SEC-03. Before this, a wrong password left nothing in `audit_events` at all:
-- sixty concurrent wrong passwords against `POST /auth/operator` grew the table
-- by one row, and that row was the success afterwards. A rate limit that cannot
-- be checked against the trail afterwards is a rate limit nobody can audit, so
-- the four sign-in routes now write one row per refused attempt.
--
-- The row names the reference that was typed, the address it came from and
-- which refusal it got. It never names the secret. `target_id` is `text` with
-- no foreign key, so an attempt on an operator who does not exist still records
-- what was tried — which is the case that matters most.
--
-- Only the attribution CHECK moves. A failed sign-in has no operator, no upload
-- device and no centre, exactly like the `%.login` rows the check already
-- exempts, so `%.login_failed` joins that exemption and nothing else changes.
-- The new predicate is strictly weaker than the old one, so every existing row
-- still satisfies it and the ADD validates without a rewrite.
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_attributed_check";--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_attributed_check" CHECK (
  "audit_events"."action" like '%.login'
  or "audit_events"."action" like '%.login_failed'
  or ("audit_events"."actor_role" = 'reviewer'
      and "audit_events"."operator_id" is not null
      and "audit_events"."upload_device_id" is null
      and "audit_events"."upload_centre_id" is null)
  or ("audit_events"."actor_role" = 'operator'
      and "audit_events"."operator_id" is not null
      and "audit_events"."upload_device_id" is not null
      and "audit_events"."upload_centre_id" is not null)
);
