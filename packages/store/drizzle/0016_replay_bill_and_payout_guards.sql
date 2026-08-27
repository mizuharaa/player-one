-- 0016: replay the parts of 0011 and 0012 that were edited after they were journaled.
--
-- drizzle applies a migration by the journal's `when` and never again, so a
-- database that ran 0011 or 0012 before these edits landed keeps the old text
-- for good and has none of the guards below. Three in-place edits are owed:
--
--   0011 (e6624e5): bills_total_matches_lines, and its two deferred constraint
--                   triggers on bills and bill_lines.
--   0011 (a8b20c6): bill_lines_immutable, and its trigger.
--   0012 (d84d60c): payout_attempts_guard learned the verify_status check
--                   (payout_attempts_account_unverified). The function body
--                   below is the current 0012 text, verbatim.
--
-- Every statement replays cleanly on such a database and is a no-op in effect
-- on a fresh one: CREATE OR REPLACE for the functions, DROP IF EXISTS + CREATE
-- for the triggers. The edited files are left as they are — a fresh database
-- is right today — and the rule from here on is the one 0009_cloud_leg_gate
-- already follows: never edit an applied migration, append.
-- The total is the sum of the lines, and the database says so at commit.
--
-- A line-by-line check cannot see the whole bill, and the generator writes the
-- bill first and its lines after, so the comparison is a DEFERRED constraint
-- trigger: it runs when the transaction commits, over the finished bill. The
-- amounts are numeric(14,4) and the generator quantises at that scale, so the
-- sum is exact and equality is exact. A bill with no lines yet is not judged:
-- the generator writes the bill and then its lines in one transaction, and a
-- raw-SQL test may do it in two, so the rule is "a bill WITH lines adds up".
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
DROP TRIGGER IF EXISTS bills_total_matches_lines ON bills;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bills_total_matches_lines
  AFTER INSERT OR UPDATE ON bills
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bills_total_matches_lines();
--> statement-breakpoint
DROP TRIGGER IF EXISTS bill_lines_total_matches ON bill_lines;
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
CREATE OR REPLACE FUNCTION bill_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bill_lines_immutable: a bill line is never % once written', lower(TG_OP)
    USING ERRCODE = '23514', CONSTRAINT = 'bill_lines_immutable';
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS bill_lines_immutable ON bill_lines;
--> statement-breakpoint
CREATE TRIGGER bill_lines_immutable
  BEFORE UPDATE OR DELETE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION bill_lines_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payout_attempts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bill_total numeric;
  bill_collector uuid;
  latest_seq integer;
  latest_status text;
  acct_method text;
  acct_collector uuid;
  acct_current boolean;
  acct_verify text;
  computed_seq integer;
  computed_id text;
BEGIN
  -- An attempt is the record that money was, or was not, sent. It is never
  -- deleted, whatever else references it.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_attempts_append_only: attempt % is the record of a payment and cannot be deleted', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_append_only';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT total, collector_id INTO bill_total, bill_collector
      FROM bills WHERE id = NEW.bill_id FOR UPDATE;
    -- No bill: let the foreign key say so in its own words.
    IF bill_total IS NULL THEN RETURN NEW; END IF;

    SELECT attempt_seq, status INTO latest_seq, latest_status
      FROM payout_attempts WHERE bill_id = NEW.bill_id
     ORDER BY attempt_seq DESC LIMIT 1;
    IF latest_seq IS NOT NULL AND latest_status <> 'failed' THEN
      RAISE EXCEPTION 'payout_attempts_previous_not_failed: bill % already has attempt % in state %, and a new attempt needs the last one to have failed',
        NEW.bill_id, latest_seq, latest_status
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_previous_not_failed';
    END IF;

    computed_seq := coalesce(latest_seq, 0) + 1;
    computed_id := 'PO-' || NEW.bill_id::text || '-' || computed_seq::text;
    IF (NEW.attempt_seq IS NOT NULL AND NEW.attempt_seq <> computed_seq)
       OR (NEW.partner_order_id IS NOT NULL AND NEW.partner_order_id <> computed_id) THEN
      RAISE EXCEPTION 'payout_attempts_identity_computed: attempt_seq and partner_order_id are computed by the database (% / %), not supplied',
        computed_seq, computed_id
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_identity_computed';
    END IF;
    NEW.attempt_seq := computed_seq;
    NEW.partner_order_id := computed_id;

    IF bill_total <> trunc(bill_total) THEN
      RAISE EXCEPTION 'payout_attempts_total_fractional: bill % totals %, which is not a whole number of dong; the rounding rule is undecided, so the bill cannot be attempted',
        NEW.bill_id, bill_total
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_total_fractional';
    END IF;
    IF NEW.amount_vnd <> bill_total THEN
      RAISE EXCEPTION 'payout_attempts_amount_check: attempt is for % VND but bill % totals %',
        NEW.amount_vnd, NEW.bill_id, bill_total
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_amount_check';
    END IF;

    SELECT method, collector_id, is_current, verify_status
      INTO acct_method, acct_collector, acct_current, acct_verify
      FROM payout_accounts WHERE id = NEW.payout_account_id;
    IF acct_collector IS NULL THEN RETURN NEW; END IF;
    IF acct_collector <> bill_collector THEN
      RAISE EXCEPTION 'payout_attempts_account_owner: account % belongs to collector %, and bill % belongs to collector %',
        NEW.payout_account_id, acct_collector, NEW.bill_id, bill_collector
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_account_owner';
    END IF;
    IF NOT acct_current THEN
      RAISE EXCEPTION 'payout_attempts_account_current: account % has been replaced; pay the current account',
        NEW.payout_account_id
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_account_current';
    END IF;
    -- Whatever the rail. A manual attempt records that a person sent money to
    -- this destination; if ZaloPay did not confirm the destination is the
    -- collector — name mismatch, no wallet, locked, or never asked — that is
    -- the payment to a stranger the whole pilot posture exists to prevent, and
    -- the record of it is refused here, not only by the route that happens to
    -- exist today. Consequence: a pilot with no ZaloPay credentials verifies
    -- nobody and can therefore pay nobody. That is the G3 gate (every active
    -- collector verified before payout), and any override is an escalation.
    IF acct_verify IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'payout_attempts_account_unverified: account % is %, and only a verified account is paid',
        NEW.payout_account_id, acct_verify
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_account_unverified';
    END IF;
    IF acct_method IN ('BANK_ACCOUNT', 'BANK_CARD') THEN
      IF NEW.amount_vnd > 10000000 THEN
        RAISE EXCEPTION 'payout_attempts_bank_ceiling: % VND exceeds the ZaloPay bank transfer limit of 10,000,000 VND per transaction; splitting is an escalation, not an automatic',
          NEW.amount_vnd
          USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_bank_ceiling';
      END IF;
      IF NEW.amount_vnd < 2000 THEN
        RAISE EXCEPTION 'payout_attempts_bank_minimum: % VND is below the ZaloPay bank transfer minimum of 2,000 VND',
          NEW.amount_vnd
          USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_bank_minimum';
      END IF;
    END IF;

    -- An API attempt is born unsent. A manual attempt is born settled, because
    -- it records a transfer a person has already made; anything in between is
    -- a state no manual transfer was ever in.
    IF (NEW.mode = 'api' AND NEW.status <> 'created')
       OR (NEW.mode = 'manual' AND (NEW.status <> 'succeeded' OR NEW.settled_at IS NULL)) THEN
      RAISE EXCEPTION 'payout_attempts_initial_status: a % attempt cannot start at %', NEW.mode, NEW.status
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_initial_status';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.bill_id <> OLD.bill_id
     OR NEW.payout_account_id <> OLD.payout_account_id
     OR NEW.partner_order_id <> OLD.partner_order_id
     OR NEW.attempt_seq <> OLD.attempt_seq
     OR NEW.amount_vnd <> OLD.amount_vnd
     OR NEW.mode <> OLD.mode
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'payout_attempts_identity_immutable: what attempt % is, and how much it is for, is written once', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_identity_immutable';
  END IF;
  IF OLD.status = 'succeeded' AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'payout_attempts_succeeded_immutable: attempt % succeeded; a succeeded attempt is terminal and immutable', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_succeeded_immutable';
  END IF;
  IF OLD.status = 'failed' AND NEW.status <> 'failed' THEN
    RAISE EXCEPTION 'payout_attempts_failed_terminal: attempt % failed; retry with a new attempt, which gets a new partner_order_id', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_failed_terminal';
  END IF;
  -- Evidence is written once. What ZaloPay answered (zlp_order_id,
  -- zp_trans_id, sub_return_code) and when the attempt settled may each go
  -- from unknown to known exactly once and never change afterwards; what a
  -- person typed (manual_reference) is fixed at insert, because a corrected
  -- reference is a different payment and therefore a new attempt. The poll
  -- count only ever rises.
  IF (OLD.zlp_order_id IS NOT NULL AND NEW.zlp_order_id IS DISTINCT FROM OLD.zlp_order_id)
     OR (OLD.zp_trans_id IS NOT NULL AND NEW.zp_trans_id IS DISTINCT FROM OLD.zp_trans_id)
     OR (OLD.sub_return_code IS NOT NULL AND NEW.sub_return_code IS DISTINCT FROM OLD.sub_return_code)
     OR NEW.manual_reference IS DISTINCT FROM OLD.manual_reference
     OR (OLD.settled_at IS NOT NULL AND NEW.settled_at IS DISTINCT FROM OLD.settled_at)
     OR NEW.poll_count < OLD.poll_count THEN
    RAISE EXCEPTION 'payout_attempts_evidence_immutable: what ZaloPay answered and what the operator typed for attempt % is written once', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_evidence_immutable';
  END IF;
  -- A poll that learned nothing may advance the count and the clock, and may
  -- fill in an order id it did not have yet (a -68 duplicate learns its order
  -- id from the first query). It may not change anything else without a
  -- change of state to justify it.
  IF NEW.status = OLD.status THEN
    IF NEW.sub_return_code IS DISTINCT FROM OLD.sub_return_code
       OR NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
      RAISE EXCEPTION 'payout_attempts_evidence_immutable: attempt % did not change state, so only its poll count, poll time and order ids may move', OLD.id
        USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_evidence_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF (OLD.status || '->' || NEW.status) NOT IN (
       'created->submitted',
       -- Never sent; an operator may void it (state.ts: OPERATOR_RESOLVE).
       'created->failed',
       'submitted->succeeded',
       'submitted->processing',
       'submitted->pending_zlp',
       'submitted->failed',
       'submitted->unknown',
       'processing->succeeded',
       'processing->failed',
       'processing->pending_zlp',
       'unknown->succeeded',
       'unknown->failed',
       'unknown->pending_zlp',
       'unknown->processing',
       -- Only with an operator's typed reason: payout_attempts_pending_resolved.
       'pending_zlp->succeeded',
       'pending_zlp->failed'
     ) THEN
    RAISE EXCEPTION 'payout_attempts_transition_check: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_transition_check';
  END IF;
  IF NEW.status IN ('succeeded', 'failed') AND NEW.settled_at IS NULL THEN
    NEW.settled_at := now();
  END IF;
  RETURN NEW;
END
$$;
