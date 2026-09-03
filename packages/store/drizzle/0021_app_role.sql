-- 0021: the Postgres role the application connects as.
--
-- HAND-WRITTEN. Drizzle does not generate roles or grants.
--
-- The API connects as `postgres` today, and a superuser bypasses every grant
-- and owns every table, so the append-only audit trail is a courtesy rather
-- than a rule. Measured on this branch against a migrated database, connected
-- exactly as the API connects:
--
--   TRUNCATE audit_events;                                   -- succeeded
--   ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
--   UPDATE audit_events SET action = 'nothing happened';     -- succeeded
--
-- PLT-07 and PLT-08 want every mutation attributed and the record kept. A
-- record the recording process can rewrite is not a record. 0002 says so in its
-- own comment — *"an audit trail the application can rewrite is not one"* — and
-- names this migration's job as the missing half: *"production should ALSO run
-- the app under a restricted role with UPDATE/DELETE revoked"*. 0006 names the
-- same upgrade path for `collector_agreements`.
--
-- What closes the two holes above is not mainly the REVOKE. It is that
-- `playerone_app` **owns nothing**: a non-owner cannot TRUNCATE a table,
-- cannot ALTER it, and therefore cannot disable a trigger on it. Every
-- append-only trigger in this schema — audit_events, collector_agreements,
-- task_claims, bills, bill_lines, payout_accounts, payout_events,
-- payout_exports, payout_export_rows, risk_signals, risk_flags, risk_holds,
-- recon_runs, recon_lines, episode_clearings, episodes — becomes unbypassable
-- from the application's own connection at the same moment, without this
-- migration having to enumerate which of them allow which update. The REVOKE
-- below is the second lock on the one table the whole trail hangs from.
--
-- Shape and idempotency are copied from 0014's `playerone_risk` block, for the
-- reasons that block states: a role is cluster-wide while a migration runs
-- against one database, so two databases of one cluster race on CREATE ROLE;
-- and a migrating user without CREATEROLE must get a NOTICE rather than a dead
-- migration.

DO $$
BEGIN
  CREATE ROLE playerone_app NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'playerone_app was not created: the migrating user lacks CREATEROLE. Create it by hand and re-run the grants in 0021_app_role.sql.';
END $$;
--> statement-breakpoint

-- Exactly what the application does, and nothing else.
--
--   SELECT, INSERT, UPDATE   every route reads and writes.
--   DELETE                   `cloud_verifications` only. It is the one table
--                            the API deletes a row from (upload.ts: a receipt
--                            whose read-back failed, and the receipts of a
--                            batch an operator asked to re-verify). Nothing
--                            else in this repository issues a DELETE.
--   USAGE on sequences       the `bigserial` keys.
--   playerone_risk           the engine takes `SET LOCAL ROLE playerone_risk`
--                            at the top of every evaluation (0014), which
--                            needs the connected role to be a member.
--
-- Not granted, and each absence is the point: no TRUNCATE on anything, no
-- ownership, no CREATE on the schema, no DELETE anywhere else, no UPDATE on
-- `audit_events`.
--
-- `ALTER DEFAULT PRIVILEGES` covers tables a LATER migration creates, as long
-- as the same user runs it — which is every deployment so far. A migration run
-- by a different user needs these grants re-run; docs/RUNNING.md says so.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_app') THEN
    GRANT USAGE ON SCHEMA public TO playerone_app;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO playerone_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE ON TABLES TO playerone_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO playerone_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE ON SEQUENCES TO playerone_app;
    GRANT DELETE ON cloud_verifications TO playerone_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM playerone_app;
  END IF;
END $$;
--> statement-breakpoint

-- Best-effort, in its own block so a refusal cannot roll back the grants above.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_risk')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_app') THEN
    GRANT playerone_risk TO playerone_app;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'playerone_risk was not granted to playerone_app: this user may not administer the role. Until a superuser runs  GRANT playerone_risk TO playerone_app;  every risk evaluation under the application role refuses.';
END $$;
--> statement-breakpoint

-- Membership for whoever migrated, the same courtesy 0016 grants for
-- `playerone_risk` and for the same reason: without it nobody on this machine
-- can `SET ROLE playerone_app` to check what the application can actually do,
-- and the test that proves the grants cannot run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_app') THEN
    EXECUTE format('GRANT playerone_app TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'playerone_app was not granted to %: this user may not administer the role. Run  GRANT playerone_app TO %;  as a superuser.', current_user, current_user;
END $$;
