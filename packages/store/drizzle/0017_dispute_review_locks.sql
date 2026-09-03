-- QR-08, two holes in 0016 found in review, both reproduced in raw SQL with
-- two sessions before this was written.
--
-- 1. `review_disputes_guard` read the settlement's state with a plain SELECT.
--    Under READ COMMITTED that sees `pending_settlement` while a bill
--    generator's `UPDATE settlements SET settlement_state = 'bill_generated'`
--    on that very row is still uncommitted, so both commit and the result is
--    a billed settlement with an open dispute — the state
--    `review_disputes_unbilled_check` exists to forbid, and one no verdict can
--    close (the second verdict's UPDATE wants `pending_settlement`).
--    Measured: bill txn (insert line, update settlement, sleep) + dispute
--    insert during the sleep -> `bill_generated | 1 line | 1 open dispute`.
--    `FOR UPDATE` makes the dispute wait on the in-flight bill and then read
--    the committed state, which is `bill_generated`, and refuse. The other
--    interleaving — dispute in flight, generator arriving — is closed by the
--    generator moving the settlement BEFORE it writes the line (settle.ts):
--    that UPDATE waits on the dispute's row lock, and the line insert that
--    follows sees the committed dispute and is refused by
--    `bill_lines_disputed_check`.
--
-- 2. `settlements_supersede_guard` was BEFORE UPDATE only, so a settlement
--    could be BORN with `superseded_by` set and `settlement_state =
--    'pending_settlement'` (0005's insert rule allows that state). No line
--    could be written for it — `bill_lines_superseded_check` reads the column,
--    not the state — but it was a row the comment on 0016 said cannot exist.
--    Now BEFORE INSERT OR UPDATE.
--
-- Hand-written, no snapshot, like 0016. `CREATE OR REPLACE` keeps the
-- triggers that already name these functions.

CREATE OR REPLACE FUNCTION review_disputes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  the_state text;
  the_dispute uuid;
  owed_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'review_disputes_append_only: a dispute is never deleted'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_append_only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- The only write after the insert is closing it, once.
    IF OLD.resolved_at IS NOT NULL
       OR NEW.review_id <> OLD.review_id
       OR NEW.raised_by <> OLD.raised_by
       OR NEW.reason <> OLD.reason
       OR NEW.raised_at <> OLD.raised_at THEN
      RAISE EXCEPTION 'review_disputes_append_only: dispute % is written once and closed once', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_append_only';
    END IF;
    RETURN NEW;
  END IF;

  SELECT review_state, dispute_id INTO the_state, the_dispute
    FROM episode_reviews WHERE id = NEW.review_id;
  -- No such review: the foreign key says so, after this trigger.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF the_state = 'pending' THEN
    RAISE EXCEPTION 'review_disputes_decided_check: review % has not been decided, so there is no outcome to challenge', NEW.review_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_decided_check';
  END IF;
  -- A second review is the last word. Disputing it would be a third review,
  -- and the brief has no such thing.
  IF the_dispute IS NOT NULL THEN
    RAISE EXCEPTION 'review_disputes_final_check: review % is itself a second review and cannot be disputed', NEW.review_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_final_check';
  END IF;
  -- A bill is never revised (docs/review.md). Until it can be, a settlement
  -- already on one — or paid — cannot be reopened. FOR UPDATE: a generator
  -- that is billing this row right now holds its lock, and this waits for
  -- its commit and then reads `bill_generated`, not the snapshot from before.
  -- The lock is held to the end of this transaction, which is what makes a
  -- generator arriving after this wait see the dispute before it writes a line.
  SELECT settlement_state INTO owed_state FROM settlements WHERE episode_review_id = NEW.review_id FOR UPDATE;
  IF owed_state IS DISTINCT FROM 'pending_settlement' THEN
    RAISE EXCEPTION 'review_disputes_unbilled_check: the settlement for review % is %, and only a settlement still waiting to be billed can be disputed', NEW.review_id, coalesce(owed_state, 'absent')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_unbilled_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION settlements_supersede_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
    RAISE EXCEPTION 'settlements_superseded_immutable: settlement % is already superseded by %', OLD.id, OLD.superseded_by
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_superseded_immutable';
  END IF;
  IF NEW.superseded_by IS NOT NULL AND NEW.settlement_state <> 'exception' THEN
    RAISE EXCEPTION 'settlements_superseded_state_check: a superseded settlement stays in exception, not %', NEW.settlement_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_superseded_state_check';
  END IF;
  IF NEW.superseded_by = NEW.id THEN
    RAISE EXCEPTION 'settlements_superseded_state_check: a settlement cannot supersede itself'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_superseded_state_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER settlements_supersede_guard ON settlements;--> statement-breakpoint
CREATE TRIGGER settlements_supersede_guard
  BEFORE INSERT OR UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_supersede_guard();
