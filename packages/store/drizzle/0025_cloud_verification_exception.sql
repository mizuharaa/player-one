-- Policy B: a failed cloud copy may park a paid settlement; the payment stands.
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_exception_reason_check";--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_exception_reason_check"
  CHECK ("exception_reason" IS NULL OR "exception_reason" IN ('disputed', 'duplicate', 'wrong_collector', 'manual_hold', 'superseded', 'cloud_verification_failed'));--> statement-breakpoint
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
    IF OLD.settlement_state = 'manually_paid' AND NEW.exception_reason = 'cloud_verification_failed' THEN
      IF NEW.exception_from_state IS DISTINCT FROM OLD.settlement_state THEN
        RAISE EXCEPTION
          'settlements_exception_from_check: parked from % but the row says %',
          OLD.settlement_state, NEW.exception_from_state
          USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_exception_from_check';
      END IF;
      RETURN NEW;
    END IF;
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
$$;
