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
--> statement-breakpoint
-- The total is the sum of the lines, and the database says so at commit.
--
-- A line-by-line check cannot see the whole bill, and the generator writes the
-- bill first and its lines after, so the comparison is a DEFERRED constraint
-- trigger: it runs when the transaction commits, over the finished bill. The
-- amounts are numeric(14,4) and the generator quantises at that scale, so the
-- sum is exact and equality is exact. A bill with no lines yet is not judged:
-- the generator writes the bill and then its lines in one transaction, and a
-- raw-SQL test may do it in two, so the rule is "a bill WITH lines adds up".
CREATE FUNCTION bills_total_matches_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  the_bill uuid;
  expected numeric;
  actual numeric;
  n integer;
  targets uuid[];
BEGIN
  -- On a line moved between bills both bills change; the old one is checked
  -- too, or a line could be walked out of an issued bill leaving its total
  -- standing over nothing.
  -- NEW is unassigned on DELETE and OLD on INSERT, and a single CASE expression
  -- is parsed whole, so the branches are separate statements: plpgsql only
  -- compiles a statement when it first runs.
  IF TG_TABLE_NAME = 'bills' THEN
    targets := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    targets := ARRAY[NEW.bill_id];
  ELSIF TG_OP = 'DELETE' THEN
    targets := ARRAY[OLD.bill_id];
  ELSE
    targets := ARRAY(SELECT DISTINCT b FROM unnest(ARRAY[NEW.bill_id, OLD.bill_id]) AS b);
  END IF;
  FOREACH the_bill IN ARRAY targets LOOP
    SELECT total INTO expected FROM bills WHERE id = the_bill;
    IF expected IS NULL THEN CONTINUE; END IF;  -- bill deleted in this tx
    SELECT count(*), coalesce(sum(s.amount), 0) INTO n, actual
      FROM bill_lines l JOIN settlements s ON s.id = l.settlement_id
     WHERE l.bill_id = the_bill;
    IF n = 0 THEN CONTINUE; END IF;
    IF actual <> expected THEN
      RAISE EXCEPTION 'bills_total_matches_lines: bill % says %, its lines sum to %', the_bill, expected, actual
        USING ERRCODE = '23514', CONSTRAINT = 'bills_total_matches_lines';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bills_total_matches_lines
  AFTER INSERT OR UPDATE ON bills
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bills_total_matches_lines();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bill_lines_total_matches
  AFTER INSERT OR UPDATE OR DELETE ON bill_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bills_total_matches_lines();
--> statement-breakpoint
-- A bill line is evidence and is never removed or moved. The generator writes
-- lines once; without this, deleting or re-pointing the last line of an issued
-- bill leaves its frozen total standing over nothing, and the guards above,
-- which read "issued" as "has a line", stop protecting it (bridge F-28).
CREATE FUNCTION bill_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bill_lines_immutable: a bill line is never % once written', lower(TG_OP)
    USING ERRCODE = '23514', CONSTRAINT = 'bill_lines_immutable';
END
$$;
--> statement-breakpoint
CREATE TRIGGER bill_lines_immutable
  BEFORE UPDATE OR DELETE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION bill_lines_immutable();
