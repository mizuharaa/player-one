-- 0034: anybody may sign up and look; only an enrolled collector may take work.
--
-- HAND-WRITTEN. Drizzle generates neither the trigger body nor the grant block,
-- and the CHECK it would emit for a widened `collectors_status_check` would be
-- a drop-and-add it cannot see the reason for.
--
-- Owner's product decision, 2026-09-15: a person downloads the app, signs in
-- with their own number and browses the task board, so the app can advertise
-- the service. Taking work still costs a visit to a collection centre. Before
-- this, `POST /auth/collector/request-code` answered 204 for a number no
-- `collectors` row carried and nothing else happened — there was no way to
-- become a collector except an operator typing an `external_ref` (BO-03).
--
-- Three things, and they are one change: somewhere to keep a code for a number
-- that is not a collector yet, a status for the person that code creates, and a
-- gate that refuses them work by one name.
--
-- ---------------------------------------------------------------------------
-- 1. `sign_up_codes` — the code for a number nobody owns.
--
-- A collector's sign-in code lives in four columns on their own row
-- (`collectors.sign_in_code_hash` and the three beside it, migration 0018).
-- That is not available to somebody who has no row, and creating the row when
-- the code is REQUESTED is the thing this table exists to avoid: an
-- unauthenticated caller would then be able to fill `collectors` with rows for
-- numbers nobody answers, and an operator's collector list would be
-- attacker-controlled. So the row is created when the code is PRESENTED, and
-- until then the code sits here.
--
-- What makes this table a smaller thing to abuse than `collectors` would be:
-- nothing references it, nothing joins to it, it carries no `external_ref` and
-- no name, and every row in it is dead inside five minutes. It is a credential
-- in flight, not a person.
--
-- The phone is the primary key, which is the property the sign-in depends on
-- the same way `collectors_phone_key` is: the lookup is by phone alone, so
-- there must be one row or none and never a first row. A new request replaces
-- whatever was there and resets the attempt count, exactly as it does for an
-- enrolled collector.
--
-- `consumed_at` rather than a DELETE, and that is not a stylistic choice: 0021
-- grants the application DELETE on `cloud_verifications` and nowhere else, and
-- `app-role.test.ts` pins that. Consuming is an UPDATE that only the winner of
-- `WHERE consumed_at IS NULL` performs, which is the same "only the UPDATE
-- winner signs in" shape `collector.ts` already uses to make a code single-use.
--
-- THE CEILING: THIS TABLE ONLY GROWS, AND THERE IS NO REAPER. Every number
-- that signs up leaves a consumed row for ever, and every request nobody
-- answers leaves a live one; the application cannot delete either, by the
-- grant above. Rows are tiny and a row is dead to the sign-in five minutes
-- after it is written, so at pilot scale — 500 collectors, and whatever
-- mistyped numbers arrive with them — this is a table with a few thousand
-- rows in it and nothing reads it but a lookup on its primary key.
-- The upgrade path when that stops being true is a reaper that runs as the
-- schema owner, `DELETE FROM sign_up_codes WHERE created_at < now() -
-- interval '<n> days'`, on whatever schedule the deployment already has. It is
-- deliberately not built now: a cron job and a second role in the deployment
-- for a table measured in kilobytes is machinery guarding nothing, and the
-- grant is what makes writing it a deliberate act rather than an accident.
CREATE TABLE sign_up_codes (
  phone text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  -- How many times this code has been offered. Same cap and same reason as
  -- `collectors.sign_in_code_attempts`: six digits is a million codes and the
  -- rate limiter alone would let a determined caller work through a useful
  -- slice of them, so the counter is what kills a code after a handful of
  -- tries instead of at its expiry.
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sign_up_codes_phone_check CHECK (length(trim(phone)) > 0),
  CONSTRAINT sign_up_codes_attempts_check CHECK (attempts >= 0),
  CONSTRAINT sign_up_codes_consumed_check CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);--> statement-breakpoint

-- Per 0021 and 0033. `ALTER DEFAULT PRIVILEGES` in 0021 already covers a table
-- created later by the same user, which is every deployment so far; this block
-- is what makes the grant true when it is not. No DELETE, and the absence is
-- the point: a spent code is consumed by the UPDATE above.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON sign_up_codes TO playerone_app;
    REVOKE DELETE, TRUNCATE ON sign_up_codes FROM playerone_app;
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `prospect` — what a person is between signing up and being enrolled.
--
-- The three existing values come from 0001 and none of them fits. 'pending' is
-- a collector an operator created and has not qualified yet (BO-03 writes it),
-- and reusing it would make a self-served sign-up indistinguishable from a
-- person who walked into a centre — so an operator's pending list would fill
-- with app installs and "who is waiting for me to qualify them" would stop
-- being answerable. 'suspended' says somebody was stopped, which is a
-- statement about a person nobody has met.
--
-- Dropped and re-added under the same name, because a CHECK is replaced and
-- not amended. No row moves: every existing collector is one of the three.
ALTER TABLE collectors DROP CONSTRAINT collectors_status_check;--> statement-breakpoint
ALTER TABLE collectors ADD CONSTRAINT collectors_status_check
  CHECK (status in ('prospect', 'pending', 'qualified', 'suspended'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. One name for "you have not been enrolled yet".
--
-- `task_claims_guard` (0006) already refuses a prospect: `status = 'prospect'`
-- is not 'qualified', so `task_claims_qualified_gate` fires, and before that
-- `task_claims_exam_gate` fires because they have sat no exam. That is two
-- different sentences for one situation, and the first of them — "pass the
-- exam" — is advice that does not unlock anything, because the exam is
-- self-service and the qualification is not.
--
-- So the prospect branch goes FIRST and answers by its own name. A prospect who
-- has accepted the six agreements, marked training done and answered the
-- placeholder exam still gets this one, which is the honest answer: what they
-- are missing is an operator at a collection centre, and everything else they
-- can do on the phone is already done.
--
-- The rest of the function is 0006's, statement for statement. It is replaced
-- rather than extended because a trigger function has no other shape; the
-- triggers themselves (`task_claims_guard` on INSERT,
-- `task_claims_guard_reclaim` on un-release) are untouched and keep pointing
-- here. Nothing about a 'pending', 'qualified' or 'suspended' collector changes.
CREATE OR REPLACE FUNCTION task_claims_guard() RETURNS trigger AS $$
DECLARE
  t record;
  c record;
  taken integer;
  accepted integer;
BEGIN
  SELECT status, max_concurrent_claimants
    INTO t
    FROM tasks
   WHERE id = NEW.task_id
     FOR UPDATE;
  -- No such task: say nothing and let the foreign key give the real error.
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF t.status <> 'published' THEN
    RAISE EXCEPTION 'task_claims_published_gate: task % is %, so it is not claimable',
      NEW.task_id, t.status
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_published_gate';
  END IF;

  SELECT status, exam_result INTO c FROM collectors WHERE id = NEW.collector_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF c.status = 'prospect' THEN
    RAISE EXCEPTION 'task_claims_onboarding_gate: collector % signed up in the app and has not been enrolled at a collection centre',
      NEW.collector_id
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_onboarding_gate';
  END IF;

  IF c.exam_result IS DISTINCT FROM 'pass' THEN
    RAISE EXCEPTION 'task_claims_exam_gate: collector % has no exam pass (APP-05)',
      NEW.collector_id
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_exam_gate';
  END IF;

  IF c.status <> 'qualified' THEN
    RAISE EXCEPTION 'task_claims_qualified_gate: collector % is %, not qualified',
      NEW.collector_id, c.status
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_qualified_gate';
  END IF;

  SELECT count(DISTINCT agreement) INTO accepted
    FROM collector_agreements
   WHERE collector_id = NEW.collector_id;
  IF accepted < 6 THEN
    RAISE EXCEPTION 'task_claims_consent_gate: collector % has accepted % of the six agreements',
      NEW.collector_id, accepted
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_consent_gate';
  END IF;

  SELECT count(*) INTO taken
    FROM task_claims
   WHERE task_id = NEW.task_id AND released_at IS NULL AND id <> NEW.id;
  IF taken >= t.max_concurrent_claimants THEN
    RAISE EXCEPTION 'task_claims_capacity: task % already holds % of % claimants',
      NEW.task_id, taken, t.max_concurrent_claimants
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_capacity';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
