-- Admission is the INSERT of a new attempt, not reconciliation of one already
-- admitted. A later hold must not hide a provider result or undo a payment.
CREATE FUNCTION payout_attempts_admission_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  -- insertAttempt sets this from server configuration for BOTH payment rails.
  -- Missing/empty retains the existing disabled default for raw SQL callers.
  IF NOT coalesce(nullif(current_setting('app.payout_holds_enabled', true), ''), 'false')::boolean THEN
    RETURN NEW;
  END IF;

  -- A transaction snapshot could retain "no hold" after waiting for a raise.
  -- Fail closed if a caller changes the API's READ COMMITTED transaction mode.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'payout_risk_isolation: hold admission requires READ COMMITTED'
      USING ERRCODE = '25001', CONSTRAINT = 'payout_risk_isolation';
  END IF;

  -- Same lock and order as risk_holds_chain_guard: advisory lock, then bill
  -- row/FK locks. The separate SELECT below gets a fresh READ COMMITTED
  -- snapshot after the lock wait (this trigger function must stay VOLATILE).
  PERFORM pg_advisory_xact_lock(hashtext('risk_holds:' || NEW.bill_id::text));
  IF EXISTS (SELECT 1 FROM risk_current_holds WHERE bill_id = NEW.bill_id) THEN
    RAISE EXCEPTION 'payout_risk_hold: bill % has an open risk hold', NEW.bill_id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_risk_hold';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- BEFORE triggers run alphabetically: admission MUST precede the existing
-- payout_attempts_guard, which locks the bill row with FOR UPDATE.
CREATE TRIGGER payout_attempts_admission_guard
  BEFORE INSERT ON payout_attempts
  FOR EACH ROW EXECUTE FUNCTION payout_attempts_admission_guard();
