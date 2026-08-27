-- The engine takes `SET LOCAL ROLE playerone_risk` at the top of every
-- evaluation (0014, packages/api/src/risk/engine.ts). SET ROLE needs the
-- connected user to be a MEMBER of that role, and nothing granted membership:
-- 0014 created the role and its table grants and stopped. The suite could not
-- see it because it connects as a superuser, which may SET ROLE to anything.
-- On a deployment with a dedicated application user every evaluation fails on
-- `permission denied to set role "playerone_risk"` and no flag or hold is ever
-- written (bridge finding [risk-engine] engine.ts:251).
--
-- The migrating user is the application user in every deployment so far, so
-- membership is granted to whoever runs this. A different application user
-- needs `GRANT playerone_risk TO <user>` by hand (docs/RUNNING.md); the engine
-- checks membership at its first evaluation and names that statement.
--
-- Appended rather than folded into 0014: 0014 has been applied on databases
-- that must not have it edited under them (the rule 0015 states). Guarded
-- like 0014's own role block, and idempotent — re-granting an existing
-- membership is a NOTICE, not an error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_risk') THEN
    EXECUTE format('GRANT playerone_risk TO %I', current_user);
  ELSE
    RAISE NOTICE 'playerone_risk does not exist (0014 could not CREATE ROLE); create it, re-run the grants in 0014_risk.sql, then GRANT playerone_risk TO %', current_user;
  END IF;
END
$$;
