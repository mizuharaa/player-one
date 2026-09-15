-- The verdict author cannot pay their own reviewed footage, on either rail.
-- Preserve the existing creator, issuer and account-declarer guards.
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
      SELECT 1 FROM audit_events v
      JOIN settlements s ON v.target_id = s.episode_review_id::text
      JOIN bill_lines l ON l.settlement_id = s.id
      WHERE l.bill_id = p_bill AND v.target_table = 'episode_reviews'
        AND v.action = 'episode.review' AND v.operator_id = actor
    ) THEN
      RAISE EXCEPTION 'payout_reviewer_separation_of_duty: the verdict author may not pay bill %', p_bill
        USING ERRCODE = '23514', CONSTRAINT = 'payout_reviewer_separation_of_duty';
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
