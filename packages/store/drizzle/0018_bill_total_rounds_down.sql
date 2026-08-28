-- 0018: a bill total is paid rounded DOWN.
--
-- Until today `payout_attempts_guard` refused an attempt on any bill whose
-- total was not already whole dong (`payout_attempts_total_fractional`). That
-- refusal was a placeholder for an undecided rule, and it blocked every real
-- payment: the review lane's amounts come from the ROUNDED minutes, so two
-- sixteen-second episodes at 1,200 a minute bill 640.0008 and no collector
-- could be paid at all.
--
-- Daniel decided the rule on 2026-08-27: down. Not half-away-from-zero, not up.
-- The platform never pays more than the reviewed footage was worth.
--
-- WHERE THE FLOOR GOES. Not on the line: `settlements.amount` has to stay
-- reproducible from the line's own `unit_price x effective_minutes`, which is
-- the first thing checked when an invoice is disputed, and flooring each line
-- would charge the loss per line -- twenty 17-second lines of 339.9996 lose
-- 19.992 dong that way. Not on `bills.total` either: `bills_total_matches_lines`
-- (0011) says the total IS the sum of the lines, and a floored total is not.
-- So the floor is taken on the total at the one moment it has to become an
-- integer -- the amount of an attempt. The bill keeps its exact figure, both
-- invariants stand, and the loss is under one dong per bill however many lines
-- it carries.
--
-- The journal `when` is 1788730000000, past everything on
-- integrate/2026-08-28 as well as everything on main. This migration only does
-- CREATE OR REPLACE on a function that has existed since 0012, so it is correct
-- anywhere after 0016; putting it last means it cannot collide with a `when`
-- another branch has already claimed, and it cannot be overwritten by a replay
-- of the old body.
--
-- This replaces the function body from 0016 verbatim except for that one block.
-- The name `payout_attempts_total_fractional` is retired; a wrong figure is
-- now `payout_attempts_amount_check`, which already existed and now names the
-- rounded-down total it wanted.
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

    -- Rounded DOWN, once, on the whole total (Daniel, 2026-08-27; Part R5).
    -- `bills_total_nonneg_check` makes the total non-negative, so floor() and
    -- trunc() agree here; floor() is written because rounding down is the rule
    -- and truncation only happens to match it.
    IF NEW.amount_vnd <> floor(bill_total) THEN
      RAISE EXCEPTION 'payout_attempts_amount_check: attempt is for % VND but bill % totals %, which rounds down to %',
        NEW.amount_vnd, NEW.bill_id, bill_total, floor(bill_total)
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
