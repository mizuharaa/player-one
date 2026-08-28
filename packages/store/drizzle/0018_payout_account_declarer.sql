-- Separation of duty, third question: the payer may not have chosen the
-- destination.
--
-- 0013 asks two questions of the finance operator whose audit rows are in the
-- paying transaction: is their role 'finance', and did they create this
-- collector or issue this bill. Both are the same rule — the person who moves
-- the money must not also be the person who established what is being paid.
--
-- Declaring a payout account is establishing WHERE the money goes. It belongs
-- on the same side of the line as `collector.create`, not on the payer's side.
-- The code had it the other way round: `POST /api/payout/accounts` was
-- finance-only, so the only people who could name a destination were exactly
-- the people who send money to it. One finance operator could declare their
-- own ZaloPay wallet under a collector's name — ZaloPay's verification checks
-- the holder name against the DECLARED name, which the same person types — and
-- then pay it. That is a one-person path from "a collector exists" to "money
-- in my own wallet", and it is the path 0013 exists to close.
--
-- So the answer is no: declaring an account is not an act the payer may
-- perform on a bill they then pay. The route added with this migration lets
-- the centre operator declare it at the counter, which is where the collector
-- is, and this function makes the rule a property of the database rather than
-- of the routes that happen to exist today.
--
-- WHAT CHANGES
--   One more EXISTS in payout_finance_in_transaction, raising the SAME
--   constraint name (`payout_separation_of_duty`) as the other two, because it
--   is the same rule and the console already has a sentence for it. Everything
--   else in the function is unchanged, copied forward verbatim: CREATE OR
--   REPLACE FUNCTION replaces the whole body, so it has to be.
--
-- WHAT DOES NOT CHANGE
--   The triggers. `settlements_paid_by_finance` and `payout_attempts_by_finance`
--   still call this function and still fire where they fired before.
--
-- WHAT IT COSTS
--   A finance operator who declares an account can no longer pay that
--   collector's bill; somebody else in finance must. In a one-finance-person
--   pilot that reads as a deadlock, and it is the intended one: the counter
--   route is the way out, and the grant of a second finance operator is the
--   other. Nothing here can be worked around by declaring the account twice —
--   the check is against the account the attempt actually names.

CREATE OR REPLACE FUNCTION payout_finance_in_transaction(p_bill uuid, p_collector uuid, p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
  actor_role text;
  seen integer := 0;
BEGIN
  FOR actor IN
    SELECT DISTINCT a.operator_id
      FROM audit_events a
     WHERE age(a.xmin) = 0
       AND a.actor_role = 'operator'
       AND a.operator_id IS NOT NULL
       AND a.action NOT LIKE '%.login'
       AND ((a.target_table = 'bills' AND a.target_id = p_bill::text)
            OR (a.target_table = 'payout_attempts'
                AND a.target_id IN (SELECT id::text FROM payout_attempts WHERE bill_id = p_bill)))
  LOOP
    seen := seen + 1;
    SELECT role INTO actor_role FROM operators WHERE id = actor;
    IF actor_role IS DISTINCT FROM 'finance' THEN
      RAISE EXCEPTION 'payout_finance_required: % was written by operator %, whose role is %, not finance', p_what, actor, actor_role
        USING ERRCODE = '23514', CONSTRAINT = 'payout_finance_required';
    END IF;
    IF EXISTS (
      SELECT 1 FROM audit_events c
       WHERE c.operator_id = actor
         AND c.action = 'collector.create'
         AND c.target_table = 'collectors'
         AND c.target_id = p_collector::text
    ) THEN
      RAISE EXCEPTION 'payout_separation_of_duty: operator % created collector % and may not pay them', actor, p_collector
        USING ERRCODE = '23514', CONSTRAINT = 'payout_separation_of_duty';
    END IF;
    IF EXISTS (
      SELECT 1 FROM audit_events g
       WHERE g.operator_id = actor
         AND g.action = 'bill.generate'
         AND g.target_table = 'bills'
         AND g.target_id = p_bill::text
    ) THEN
      RAISE EXCEPTION 'payout_separation_of_duty: operator % issued bill % and may not pay it', actor, p_bill
        USING ERRCODE = '23514', CONSTRAINT = 'payout_separation_of_duty';
    END IF;
    -- New in 0018. The account the attempt names, not "any account of this
    -- collector": a stale account somebody declared and a successor replaced
    -- is not what this payment goes to, and refusing on it would strand the
    -- lane for a reason that is not true any more.
    IF EXISTS (
      SELECT 1 FROM audit_events d
       WHERE d.operator_id = actor
         AND d.action = 'payout_account.declare'
         AND d.target_table = 'payout_accounts'
         AND d.target_id IN (SELECT payout_account_id::text FROM payout_attempts WHERE bill_id = p_bill)
    ) THEN
      RAISE EXCEPTION 'payout_separation_of_duty: operator % declared the payout account this pays and may not pay it', actor
        USING ERRCODE = '23514', CONSTRAINT = 'payout_separation_of_duty';
    END IF;
  END LOOP;
  IF seen = 0 THEN
    RAISE EXCEPTION 'payout_finance_required: % has no audited finance operator in this transaction', p_what
      USING ERRCODE = '23514', CONSTRAINT = 'payout_finance_required';
  END IF;
END
$$;
