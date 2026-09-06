-- 0024: close the raw-SQL bypasses in commitment contracts (0023).
-- Applied terms stay copied, contracts close rather than disappear, and an
-- attributed episode with an unset device clock uses the session's day.

ALTER TABLE tasks DROP CONSTRAINT tasks_commitment_shape_check;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_commitment_shape_check
  CHECK (commitment_hours_options IS NULL
    OR (cardinality(commitment_hours_options) >= 1
        AND array_position(commitment_hours_options, NULL) IS NULL
        AND 0 < ALL(commitment_hours_options)));
--> statement-breakpoint
ALTER TABLE task_commitments DROP CONSTRAINT task_commitments_abandon_reason_check;
--> statement-breakpoint
ALTER TABLE task_commitments ADD CONSTRAINT task_commitments_abandon_reason_check
  CHECK (state <> 'abandoned'
    OR (close_reason IS NOT NULL AND length(btrim(close_reason)) > 0));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION task_commitments_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.claim_id IS DISTINCT FROM OLD.claim_id
     OR NEW.pledged_hours_per_week IS DISTINCT FROM OLD.pledged_hours_per_week
     OR NEW.started_on IS DISTINCT FROM OLD.started_on
     OR NEW.ends_on IS DISTINCT FROM OLD.ends_on THEN
    RAISE EXCEPTION 'task_commitments_terms_immutable: contract % terms cannot be rewritten', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_terms_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_commitments_terms_immutable
  BEFORE UPDATE ON task_commitments
  FOR EACH ROW EXECUTE FUNCTION task_commitments_terms_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION task_commitments_insert_active() RETURNS trigger AS $$
BEGIN
  IF NEW.state <> 'active' THEN
    RAISE EXCEPTION 'task_commitments_insert_active: contract % must start active', NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_insert_active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_commitments_insert_active
  BEFORE INSERT ON task_commitments
  FOR EACH ROW EXECUTE FUNCTION task_commitments_insert_active();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION task_commitments_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_commitments_no_delete: contract % must be closed, not removed', OLD.id
    USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_no_delete';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_commitments_no_delete
  BEFORE DELETE ON task_commitments
  FOR EACH ROW EXECUTE FUNCTION task_commitments_no_delete();
--> statement-breakpoint
-- The fleet floor is 2026-01-01 (EARLIEST_PLAUSIBLE_START_MS in contracts).
-- Attribution vouches for the session when the device's own day is earlier.
-- An unparsed basename still counts toward no window, as in 0023.
CREATE OR REPLACE FUNCTION commitment_delivered_minutes(p_commitment uuid)
RETURNS numeric AS $$
  SELECT coalesce(sum(s.effective_minutes), 0)
    FROM task_commitments tc
    JOIN task_claims cl ON cl.id = tc.claim_id
    JOIN collection_sessions cs
      ON cs.task_id = cl.task_id AND cs.collector_id = cl.collector_id
    JOIN episodes e ON e.collection_session_id = cs.id
    JOIN episode_reviews r ON r.episode_id = e.episode_id
    JOIN settlements s ON s.episode_review_id = r.id
   WHERE tc.id = p_commitment
     AND e.session_started_at ~ '^[0-9]{8}_'
     AND CASE WHEN substring(e.session_started_at from 1 for 8) < '20260101'
              THEN to_char(cs.prepare_time, 'YYYYMMDD')
              ELSE substring(e.session_started_at from 1 for 8)
         END >= to_char(tc.started_on, 'YYYYMMDD')
     AND CASE WHEN substring(e.session_started_at from 1 for 8) < '20260101'
              THEN to_char(cs.prepare_time, 'YYYYMMDD')
              ELSE substring(e.session_started_at from 1 for 8)
         END < to_char(tc.ends_on, 'YYYYMMDD');
$$ LANGUAGE sql STABLE;
