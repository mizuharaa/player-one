-- 0022: a bill that says it is worth something must have the work to show for it.
--
-- `bills_total_matches_lines` (0011, replayed verbatim by 0016) skipped every
-- bill with no lines, whatever its total said:
--
--     IF n = 0 THEN CONTINUE; END IF;
--
-- The exemption was written for the order in which a bill is built — the
-- generator inserts the bill, then its lines, and the check is deferred to the
-- commit that carries both — but it was measured against the wrong thing. The
-- check already runs at commit, so by then a bill either has its lines or it
-- never will, and `n = 0` at that moment is not "not finished yet", it is
-- "finished with nothing on it". A bill of 5,000 VND with no lines therefore
-- committed and became payable: `payout_attempts_guard` (0012/0018) reads
-- `bills.total` and would have paid it for no reviewed work.
--
-- One line changes. A bill with no lines is still allowed, but only when it is
-- worth nothing:
--
--     IF n = 0 AND expected = 0 THEN CONTINUE; END IF;
--
-- Everything else is the 0016 body, verbatim. When n = 0 and the total is
-- positive, `actual` is 0 and the existing comparison raises the existing
-- refusal — no new constraint name, so the refusal maps and their sentences are
-- unchanged. `bills_total_nonneg_check` (0005) already forbids a negative
-- total, so `expected = 0` and `expected > 0` are the only two cases.
--
-- Replay shape: CREATE OR REPLACE, which is the `IF NOT EXISTS` of a function.
-- No trigger DDL. Both constraint triggers — `bills_total_matches_lines` on
-- bills and `bill_lines_total_matches` on bill_lines — already call this
-- function by name, and 0016 is what guarantees they exist on a database old
-- enough to have missed them. Replacing the body reaches them both.
--
-- What this makes load-bearing: a bill and its lines must now COMMIT together.
-- The deferral used to be a convenience for writing them in two statements;
-- from here it is the only thing that lets a positive bill be written at all.
-- Two operational consequences follow, neither of them reachable from the
-- application today, both of them cheaper to know than to discover at 3am:
--
--   * `SET CONSTRAINTS ALL IMMEDIATE` in a session would refuse the generator's
--     own bill INSERT, because the lines have not been written yet at that
--     instant. Nothing in this repository sets it.
--   * A data-only restore (`pg_dump -a`, then `pg_restore`) loads `bills` and
--     `bill_lines` as separate autocommitted COPY statements, so every positive
--     bill is refused. Restore with `--single-transaction`, or with
--     `--disable-triggers`. A schema+data restore is unaffected, because the
--     triggers are created after the data is loaded.
--
-- One consequence a later reader will meet: `packages/api/test/migration-replay.test.ts`
-- re-runs 0016's text by hand, which puts the older, weaker body back inside
-- that test's own database. That is correct there — the claim that file proves
-- is that 0016 restores the 0011/0012 text — and it cannot happen anywhere
-- else, because drizzle applies a tag once and never again.
CREATE OR REPLACE FUNCTION bills_total_matches_lines() RETURNS trigger LANGUAGE plpgsql AS $$
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
    -- An empty bill is only excused when it claims nothing. An empty bill with
    -- a positive total falls through to the comparison below, where `actual` is
    -- 0 and `expected` is not, and is refused.
    IF n = 0 AND expected = 0 THEN CONTINUE; END IF;
    IF actual <> expected THEN
      RAISE EXCEPTION 'bills_total_matches_lines: bill % says %, its lines sum to %', the_bill, expected, actual
        USING ERRCODE = '23514', CONSTRAINT = 'bills_total_matches_lines';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
