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
ALTER TABLE "settlements" ADD COLUMN "exception_from_state" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "exception_reason" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "exception_note" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_exception_reason_check"
  CHECK ("exception_reason" IS NULL OR "exception_reason" IN ('disputed', 'duplicate', 'wrong_collector', 'manual_hold'));--> statement-breakpoint
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
