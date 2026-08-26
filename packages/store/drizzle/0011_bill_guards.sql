-- Two guards the settlement lifecycle (0005) left to the API.
--
-- `bills.total` is written once by the generator from lines that are themselves
-- frozen, and `bill_lines_payable_guard` only asks whether a settlement is worth
-- more than zero. Neither says a bill, once issued, is evidence: a raw-SQL edit
-- of its collector, period, currency or total, or a line from another collector's
-- settlement, was accepted. Both are refused here, below the API, and tested in
-- raw SQL like the rest of the money chain.
CREATE FUNCTION bills_issued_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM bill_lines WHERE bill_id = OLD.id)
     AND (NEW.collector_id <> OLD.collector_id
          OR NEW.period_start <> OLD.period_start
          OR NEW.period_end <> OLD.period_end
          OR NEW.currency <> OLD.currency
          OR NEW.total <> OLD.total) THEN
    RAISE EXCEPTION 'bills_issued_immutable: bill % has lines; its collector, period, currency and total are frozen', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'bills_issued_immutable';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER bills_issued_immutable
  BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION bills_issued_immutable();
--> statement-breakpoint
CREATE FUNCTION bill_lines_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bill_collector uuid;
  line_collector uuid;
BEGIN
  SELECT collector_id INTO bill_collector FROM bills WHERE id = NEW.bill_id;
  SELECT c.collector_id INTO line_collector
    FROM settlements s
    JOIN episode_reviews r ON r.id = s.episode_review_id
    JOIN episodes e ON e.episode_id = r.episode_id
    JOIN collection_sessions c ON c.id = e.collection_session_id
   WHERE s.id = NEW.settlement_id;
  IF line_collector IS DISTINCT FROM bill_collector THEN
    RAISE EXCEPTION 'bill_lines_owner_guard: settlement % is the work of collector %, and this bill belongs to collector %', NEW.settlement_id, line_collector, bill_collector
      USING ERRCODE = '23514', CONSTRAINT = 'bill_lines_owner_guard';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER bill_lines_owner_guard
  BEFORE INSERT OR UPDATE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION bill_lines_owner_guard();
