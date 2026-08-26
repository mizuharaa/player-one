-- The finance role, and the two rules that make it mean something.
--
-- WHAT 'finance' IS
--   `operators.role` has no CHECK, and schema.ts says why: the value set is a
--   back-office concern that grows. So "extend operators.role with 'finance'"
--   is not an ALTER — 'finance' is a value the guards below recognise, and
--   nothing else in the schema has to change for it to exist. A finance
--   operator signs in like any counter operator (a centre and a machine token;
--   `operators_centre_check` still applies) and is refused by the reviewer
--   scope like any counter operator.
--
-- BACKFILL: NONE. Deliberately.
--   Existing operators do NOT become finance. Somebody has to grant it, on
--   purpose, and that grant is a deployment step, not a side effect of running
--   migrations:
--
--     UPDATE operators SET role = 'finance', updated_at = now()
--      WHERE upload_centre_id = '<centre>' AND external_ref = '<who>';
--
--   Until it is run, no bill can be marked paid and no payout attempt can be
--   created, on any database this migration has touched. That is the intended
--   failure: a pilot that cannot pay is fixed in an hour by a grant; a pilot
--   where any operator could pay is not fixed at all.
--
-- HOW THE RULES ARE ENFORCED
--   Both are constraints against the audit trail, as the brief asks, and not
--   application if-statements. `mutate` writes the audit row for every change
--   inside the change's own transaction, so at COMMIT the trail says who did
--   this — and a DEFERRED constraint trigger runs at COMMIT. It reads the rows
--   this transaction wrote (`age(xmin) = 0`; see 0012 for the savepoint caveat)
--   and asks two questions of the operator they name:
--
--     1. Is their role 'finance'?  (payout_finance_required)
--     2. Did they create this collector, or issue this bill?
--        (payout_separation_of_duty)
--
--   "Issued" is `bill.generate`: this repo has no separate approval step, so
--   the operator who generated the bill is the one who approved its contents.
--   If an approval step is added later, add its action name to the second
--   check and nothing else moves.
--
--   A write with no audited operator at all — psql, a worker, a script — fails
--   the first question, which is what makes "only finance" a property of the
--   database rather than of the routes that happen to exist today.
--
-- WHAT IT COVERS
--   settlements   bill_generated -> manually_paid   (SET-03, the manual rail)
--   payout_attempts   every INSERT                  (the API rail, and the
--                                                    manual record of a payment)
--
-- WHAT IT DOES NOT COVER, ON PURPOSE
--   A worker polling ZaloPay and moving an attempt from `processing` to
--   `succeeded` has no operator and is not a decision; the money moved when
--   ZaloPay said so. The settlement rows behind an API-paid bill therefore
--   stay `bill_generated` — 'manually_paid' means what it says — and "paid" is
--   read from the attempt. Whether the settlement state set grows an API-paid
--   value is an escalation, not something this migration decides.

CREATE FUNCTION payout_finance_in_transaction(p_bill uuid, p_collector uuid, p_what text) RETURNS void LANGUAGE plpgsql AS $$
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
  END LOOP;
  IF seen = 0 THEN
    RAISE EXCEPTION 'payout_finance_required: % has no audited finance operator in this transaction', p_what
      USING ERRCODE = '23514', CONSTRAINT = 'payout_finance_required';
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION settlements_paid_by_finance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  the_bill uuid;
  the_collector uuid;
BEGIN
  SELECT bl.bill_id, b.collector_id INTO the_bill, the_collector
    FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id
   WHERE bl.settlement_id = NEW.id;
  IF the_bill IS NULL THEN
    RAISE EXCEPTION 'payout_finance_required: settlement % is on no bill, so nobody can have paid it', NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_finance_required';
  END IF;
  PERFORM payout_finance_in_transaction(the_bill, the_collector, 'settlement ' || NEW.id::text || ' -> manually_paid');
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER settlements_paid_by_finance
  AFTER UPDATE ON settlements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.settlement_state = 'manually_paid' AND OLD.settlement_state IS DISTINCT FROM 'manually_paid')
  EXECUTE FUNCTION settlements_paid_by_finance();
--> statement-breakpoint
CREATE FUNCTION payout_attempts_by_finance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE the_collector uuid;
BEGIN
  SELECT collector_id INTO the_collector FROM bills WHERE id = NEW.bill_id;
  PERFORM payout_finance_in_transaction(NEW.bill_id, the_collector, 'payout attempt ' || NEW.id::text);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payout_attempts_by_finance
  AFTER INSERT ON payout_attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_attempts_by_finance();
