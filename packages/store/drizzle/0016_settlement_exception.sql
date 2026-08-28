-- SET-05's fifth state, reachable.
--
-- `settlements_state_check` has named `exception` since 0001 and the guard in
-- 0005 admits it, but no route ever wrote it (bridge F-14/F-15): a bill that
-- turned out to be wrong had nowhere to be parked. This migration makes
-- `exception` a state with a memory. A parked settlement records the state it
-- was parked FROM and a reason code, and the only way out is back to that
-- state — so a row parked off an issued bill returns to that bill, and a row
-- parked from the queue returns to the queue. Nothing about the money moves:
-- the amount is still frozen by `settlements_amount_immutable_check`, the line
-- stays on its bill, and `bills_total_matches_lines` (0011) keeps adding up.
--
-- What a parked settlement cannot do: be billed (`bill_lines_exception_check`
-- below), be paid (`exception -> manually_paid` is not an edge), or be
-- exported as anything but `exception` (the CSV prints the state verbatim).
--
-- The reason codes are the four the brief gives a name to: a dispute (QR-08),
-- a duplicate delivery (UPL-15), footage attributed to the wrong collector
-- (the device-assignment answer of 2026-08-25), and a hold finance asked for.
-- A free-text note carries the rest; it is evidence, so it is kept on the row
-- and in the audit event, and rewriting it in place is refused.
--
-- A fifth reason, `superseded`, is reserved for machinery and no route can
-- write it. A second review that overturns the first one writes a replacement
-- settlement and parks the original for good; that row is a parked row like
-- any other — it names where it came from and why — but it has **no release
-- edge**, because the money it stands for has been rewritten and returning it
-- to the queue would pay the same footage twice. See the release branch of
-- `settlements_transition_guard` below. `feat/dispute-review` is the writer
-- this is for and its UPDATE has to set the two columns; the contract is in
-- that branch's integration notes.
--
-- BACKFILL: NONE, and the shape CHECK below is added VALIDATING on purpose.
--   `settlements_exception_shape_check` demands an origin and a reason on
--   every row already sitting in `exception`, so on a database holding one the
--   ALTER fails outright. That is the wanted behaviour: such a row has a NULL
--   origin, and a NULL origin is a row this migration can never release again.
--   Failing loudly at migration time beats stranding money silently.
--
--   No such row can exist on any database this has been run against. `0001`
--   named `exception` in `settlements_state_check` and `0005` admitted the
--   edge, but up to this commit no route, worker or migration ever wrote the
--   value — measured on the branch with
--   `git grep -n "'exception'" -- packages/api/src packages/store/drizzle`
--   before this migration existed: every hit was a CHECK list or a comment.
--   The only writers are the two routes this migration ships with, and they
--   always set the origin and the reason.
--
--   If a deployment somehow does hold one, the migration is run after a signed
--   one-row UPDATE that says where it belongs, e.g.
--
--     UPDATE settlements
--        SET exception_from_state = 'pending_settlement',
--            exception_reason = 'manual_hold',
--            exception_note = '<who parked it, and why>'
--      WHERE settlement_state = 'exception' AND exception_from_state IS NULL;
--
--   That is a decision somebody signs, not a side effect of a migration.
ALTER TABLE "settlements" ADD COLUMN "exception_from_state" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "exception_reason" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "exception_note" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_exception_reason_check"
  CHECK ("exception_reason" IS NULL OR "exception_reason" IN ('disputed', 'duplicate', 'wrong_collector', 'manual_hold', 'superseded'));--> statement-breakpoint
-- A parked row says where it came from and why; a row anywhere else says nothing.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_exception_shape_check"
  CHECK (CASE WHEN "settlement_state" = 'exception'
              THEN "exception_from_state" IS NOT NULL AND "exception_reason" IS NOT NULL
              ELSE "exception_from_state" IS NULL AND "exception_reason" IS NULL AND "exception_note" IS NULL
         END);--> statement-breakpoint
CREATE OR REPLACE FUNCTION settlements_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.settlement_state NOT IN ('pending_review', 'pending_settlement') THEN
      RAISE EXCEPTION
        'settlements_transition_check: a settlement cannot start at %', NEW.settlement_state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.effective_minutes IS DISTINCT FROM OLD.effective_minutes
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.episode_review_id IS DISTINCT FROM OLD.episode_review_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION
      'settlements_amount_immutable_check: what a settlement is worth is written once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_amount_immutable_check';
  END IF;

  IF NEW.settlement_state = OLD.settlement_state THEN
    -- Why a row is parked is evidence. To change it, release and park again,
    -- so the change is two audited moves and not an edit nobody can see.
    IF NEW.exception_from_state IS DISTINCT FROM OLD.exception_from_state
       OR NEW.exception_reason IS DISTINCT FROM OLD.exception_reason
       OR NEW.exception_note IS DISTINCT FROM OLD.exception_note THEN
      RAISE EXCEPTION
        'settlements_exception_from_check: a parked settlement''s origin and reason are written once'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_exception_from_check';
    END IF;
    RETURN NEW;
  END IF;

  -- Into exception: from any state that is not final, remembering which.
  IF NEW.settlement_state = 'exception' THEN
    IF OLD.settlement_state NOT IN ('pending_review', 'pending_settlement', 'bill_generated') THEN
      RAISE EXCEPTION
        'settlements_transition_check: % cannot become exception', OLD.settlement_state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
    END IF;
    IF NEW.exception_from_state IS DISTINCT FROM OLD.settlement_state THEN
      RAISE EXCEPTION
        'settlements_exception_from_check: parked from % but the row says %',
        OLD.settlement_state, NEW.exception_from_state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_exception_from_check';
    END IF;
    RETURN NEW;
  END IF;

  -- Out of exception: only to where it came from. A row parked off a bill is
  -- still that bill's line; a row parked from the queue owes no bill anything.
  -- The origin and reason go with it — the release is one column write, and
  -- the audit event is where why-it-was-parked lives from here on.
  IF OLD.settlement_state = 'exception' THEN
    -- `superseded` is the one reason with no way back. A second review already
    -- wrote the replacement settlement; releasing this one would put the same
    -- footage on a bill twice.
    IF OLD.exception_reason = 'superseded' THEN
      RAISE EXCEPTION
        'settlements_transition_check: settlement % was superseded and cannot be released', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
    END IF;
    IF NEW.settlement_state IS DISTINCT FROM OLD.exception_from_state THEN
      RAISE EXCEPTION
        'settlements_transition_check: exception cannot become %, it was parked from %',
        NEW.settlement_state, OLD.exception_from_state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
    END IF;
    NEW.exception_from_state := NULL;
    NEW.exception_reason := NULL;
    NEW.exception_note := NULL;
    RETURN NEW;
  END IF;

  IF (OLD.settlement_state || '->' || NEW.settlement_state) NOT IN (
       'pending_review->pending_settlement',
       'pending_settlement->bill_generated',
       'bill_generated->manually_paid'
     ) THEN
    RAISE EXCEPTION
      'settlements_transition_check: % cannot become %', OLD.settlement_state, NEW.settlement_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
-- The generator only reads `pending_settlement`, but the rule is a row that
-- cannot be inserted, in the same guard that keeps a refused episode off a bill.
CREATE OR REPLACE FUNCTION bill_lines_payable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owed numeric; parked text;
BEGIN
  SELECT amount, settlement_state INTO owed, parked FROM settlements WHERE id = NEW.settlement_id;
  IF coalesce(owed, 0) <= 0 THEN
    RAISE EXCEPTION
      'bill_lines_payable_check: settlement % is worth %, which is not billable',
      NEW.settlement_id, owed
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_payable_check';
  END IF;
  IF parked = 'exception' THEN
    RAISE EXCEPTION
      'bill_lines_exception_check: settlement % is parked in exception and cannot be billed',
      NEW.settlement_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_exception_check';
  END IF;
  RETURN NEW;
END;
$$;
