-- Catch-up for databases that applied 0014_risk before bf6c572.
--
-- bf6c572 (Codex F-37) added three things to 0014_risk.sql IN PLACE after that
-- migration had already been applied at 4f5351d: the risk_is_signal_set
-- function, the risk_holds_signal_ids_check CHECK that calls it, and the
-- risk_holds_clear_signals_check branch of risk_holds_chain_guard. A database
-- migrated at 4f5351d records 0014 as done and never gets them: a hold there
-- may carry an empty or duplicated signal set, and a clear may carry a set the
-- operator never saw. This migration is idempotent, so a database that ran the
-- edited 0014 ends in the same state as one that ran the original plus this.
--
-- The rule (CLAUDE.md): never edit an applied migration; append.
CREATE OR REPLACE FUNCTION risk_is_signal_set(ids text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(ids) > 0 AND cardinality(ids) = (SELECT count(DISTINCT x) FROM unnest(ids) x)
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_holds_signal_ids_check') THEN
    -- A set: at least one signal, and no signal twice.
    ALTER TABLE "risk_holds" ADD CONSTRAINT "risk_holds_signal_ids_check" CHECK (risk_is_signal_set("signal_ids"));
  END IF;
END
$$;
--> statement-breakpoint
-- The body is 0014's, verbatim.
CREATE OR REPLACE FUNCTION risk_holds_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  open_flag uuid;
  open_raised timestamp with time zone;
  open_signals text[];
BEGIN
  -- Serialise raises and clears on one bill: two engines, or an engine and an
  -- operator, must not both see "no open hold" and both insert.
  PERFORM pg_advisory_xact_lock(hashtext('risk_holds:' || NEW.bill_id::text));
  SELECT raised_by_flag, raised_at, signal_ids INTO open_flag, open_raised, open_signals
    FROM risk_holds
   WHERE bill_id = NEW.bill_id AND cleared_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM risk_holds c
        WHERE c.bill_id = risk_holds.bill_id
          AND c.raised_by_flag = risk_holds.raised_by_flag
          AND c.raised_at = risk_holds.raised_at
          AND c.cleared_at IS NOT NULL)
   ORDER BY raised_at DESC
   LIMIT 1;

  IF NEW.cleared_at IS NULL THEN
    IF open_flag IS NOT NULL THEN
      RAISE EXCEPTION 'risk_holds_already_open: bill % is already held (flag %); clear that hold before raising another', NEW.bill_id, open_flag
        USING ERRCODE = '23514', CONSTRAINT = 'risk_holds_already_open';
    END IF;
  ELSE
    IF open_flag IS NULL OR open_flag <> NEW.raised_by_flag OR open_raised <> NEW.raised_at THEN
      RAISE EXCEPTION 'risk_holds_clear_requires_open: bill % has no open hold matching flag % raised at %', NEW.bill_id, NEW.raised_by_flag, NEW.raised_at
        USING ERRCODE = '23514', CONSTRAINT = 'risk_holds_clear_requires_open';
    END IF;
    -- The clear says what the operator saw, and that is exactly what was raised:
    -- the same set, compared sorted so order cannot make two equal sets differ.
    IF (SELECT array_agg(x ORDER BY x) FROM unnest(NEW.signal_ids) x)
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(open_signals) x) THEN
      RAISE EXCEPTION 'risk_holds_clear_signals_check: a clear of bill % must carry the open hold signals % exactly, not %', NEW.bill_id, open_signals, NEW.signal_ids
        USING ERRCODE = '23514', CONSTRAINT = 'risk_holds_clear_signals_check';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
