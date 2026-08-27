-- Two guards that belong with the back office and are deliberately NOT in 0006.
--
-- 0006 is already applied on every database built from commit 4f1ef2e, and
-- drizzle decides what to run from the journal's `when`, never from the file's
-- contents. A statement appended to a migration that has already run is a
-- statement that never runs. Measured, rather than assumed: a scratch database
-- migrated at 4f1ef2e and then re-migrated against an edited 0006 still had
-- five back-office triggers, not seven, while the application assumed seven.

-- A cap that can be lowered under the people already holding the task is not a
-- cap, it is a label. BO-02 configures "maximum concurrent claimants" and the
-- insert path enforces it; the edit path could walk straight past it, leaving a
-- task permanently reading `3 / 1` — a state the claim guard says is impossible.
--
-- Refused rather than modelled as a wind-down. An intentional wind-down already
-- has a spelling that keeps the invariant true: release the claims you no longer
-- want, then lower the cap. Inventing an over-cap state instead would mean every
-- reader of `max_concurrent_claimants` has to learn that the number is sometimes
-- advisory, and the first reader to forget is a payment path.
--
-- `FOR UPDATE` on the task row, and it is the same lock the claim guard takes,
-- which is what makes the two orderings symmetric: a claim in flight holds the
-- row, so a cap edit waits for it and then counts it; a cap edit in flight holds
-- the row, so a claim waits and then reads the lowered cap. Counting without
-- taking the lock would read a snapshot from before the concurrent claim and
-- admit exactly the excess this refuses — and a BEFORE trigger is NOT re-run
-- after Postgres re-fetches a concurrently updated row, so the outer UPDATE's
-- own lock is too late to help.
CREATE OR REPLACE FUNCTION tasks_capacity_below_live() RETURNS trigger AS $$
DECLARE live integer;
BEGIN
  IF NEW.max_concurrent_claimants >= OLD.max_concurrent_claimants THEN RETURN NEW; END IF;
  PERFORM 1 FROM tasks WHERE id = NEW.id FOR UPDATE;
  SELECT count(*) INTO live
    FROM task_claims
   WHERE task_id = NEW.id AND released_at IS NULL;
  IF NEW.max_concurrent_claimants < live THEN
    RAISE EXCEPTION 'tasks_capacity_below_live: task % holds % live claims, so its cap cannot drop to %',
      NEW.id, live, NEW.max_concurrent_claimants
      USING ERRCODE = '23514', CONSTRAINT = 'tasks_capacity_below_live';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tasks_capacity_below_live
  BEFORE UPDATE OF max_concurrent_claimants ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_capacity_below_live();
--> statement-breakpoint
-- `released_at rather than a delete: who held what, and until when, is the
-- evidence behind a settlement dispute` is the comment on this table, and until
-- now it was a description of what the API happened to do. A DELETE erases the
-- claim a disputed payment rests on; moving `claimed_at` moves the window that
-- decides which footage the claim covered; rewriting a `released_at` already set
-- changes when the collector stopped being entitled to record.
--
-- Releasing (null -> a moment) is the one legal change, and it passes.
--
-- Un-releasing (a moment -> null) does NOT, and that is the whole point.
-- `claimed_at` cannot move either, so clearing the release does not reopen the
-- claim, it rewrites history: the row then reads as held continuously since the
-- original `claimed_at`, and the interval the collector was actually entitled
-- to record is gone. Re-claiming is a new row with a new id, which is already
-- what the route requires -- a claim id that has been released comes back
-- `task_claims_released`, not a replay. `task_claims_guard_reclaim` in 0006
-- still fires first on that update and still re-runs the eligibility gates; it
-- is now the second lock on a door this one closes.
CREATE OR REPLACE FUNCTION task_claims_history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_claims_history_immutable: when a claim began and when it ended is settlement evidence, not an editable field'
    USING ERRCODE = '23514', CONSTRAINT = 'task_claims_history_immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_claims_history_immutable_update
  BEFORE UPDATE ON task_claims
  FOR EACH ROW WHEN (
    NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at)
  )
  EXECUTE FUNCTION task_claims_history_immutable();
--> statement-breakpoint
CREATE TRIGGER task_claims_history_immutable_delete
  BEFORE DELETE ON task_claims
  FOR EACH ROW EXECUTE FUNCTION task_claims_history_immutable();
