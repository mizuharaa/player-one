CREATE TABLE "bill_lines" (
	"bill_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	CONSTRAINT "bill_lines_settlement_key" PRIMARY KEY("settlement_id")
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"total" numeric(14, 4) NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_period_check" CHECK ("bills"."period_end" > "bills"."period_start"),
	CONSTRAINT "bills_total_nonneg_check" CHECK ("bills"."total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_lines_bill_idx" ON "bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_collector_period_key" ON "bills" USING btree ("collector_id","period_start","period_end");--> statement-breakpoint
-- SET-05, the half a CHECK cannot express.
--
-- `settlements_state_check` already names the five states. It validates the row
-- in front of it and nothing else, so it accepts `manually_paid` becoming
-- `pending_review` exactly as readily as the reverse: both are legal *values*.
-- What is illegal is the *edge*, and an edge needs the previous value.
--
-- Two designs were on the table. An append-only transition table can make an
-- illegal jump uninsertable, but only with a self-referencing composite FK from
-- (settlement, seq-1, from_state) to (settlement, seq, to_state) — which needs a
-- generated prev_seq column, a sequence per settlement, a special case for the
-- first row, and a second place the current state is written down. This trigger
-- is one function, keeps one source of truth, and refuses the same jumps. The
-- history of who moved a settlement and when is already kept: every move goes
-- through `mutate`, which writes an `audit_events` row in the same transaction.
--
-- The same function freezes the money. `bills.total` is the sum of its lines and
-- `bill_lines` deliberately stores no amount of its own; if `settlements.amount`
-- could be edited after the bill was issued, the bill would silently stop adding
-- up. It cannot be edited, so it cannot.
CREATE FUNCTION settlements_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A settlement is born owing a decision. Inserting one already `manually_paid`
    -- would pay for footage no state machine ever walked.
    IF NEW.settlement_state NOT IN ('pending_review', 'pending_settlement') THEN
      RAISE EXCEPTION
        'settlements_transition_check: a settlement cannot start at %', NEW.settlement_state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.effective_minutes IS DISTINCT FROM OLD.effective_minutes
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.episode_review_id IS DISTINCT FROM OLD.episode_review_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION
      'settlements_amount_immutable_check: what a settlement is worth is written once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_amount_immutable_check';
  END IF;

  -- Touching updated_at, or any other no-op write, is not a transition.
  IF NEW.settlement_state = OLD.settlement_state THEN
    RETURN NEW;
  END IF;

  IF (OLD.settlement_state || '->' || NEW.settlement_state) NOT IN (
       'pending_review->pending_settlement',
       'pending_review->exception',
       'pending_settlement->bill_generated',
       'pending_settlement->exception',
       'bill_generated->manually_paid',
       'bill_generated->exception',
       -- The only way back. An exception is a settlement a human has to look at,
       -- and what they can do is return it to the queue for billing.
       'exception->pending_settlement'
     ) THEN
    RAISE EXCEPTION
      'settlements_transition_check: % cannot become %', OLD.settlement_state, NEW.settlement_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER settlements_transition_guard
  BEFORE INSERT OR UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_transition_guard();
--> statement-breakpoint
-- SET-01: "settlement records generate automatically from pass and partial-pass
-- reviews."
--
-- The review lane writes one settlement per verdict, a rejected episode
-- included, and that row is the *score* of the review: amount 0.0000. It is what
-- the console's settled-value sum reads and what a later dispute over a refused
-- episode has to point at, and `settlements_review_key` — one settlement per
-- review — is the shape that stops a retry becoming a second payment. So the row
-- stays.
--
-- What must not happen is that row reaching a bill, where it would print a
-- zero-value line for work that was refused. Filtering it out in the generator
-- would leave the rule in one query in one language; here it is a row that
-- cannot be inserted, which is where the rest of this schema's money invariants
-- live.
CREATE FUNCTION bill_lines_payable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owed numeric;
BEGIN
  SELECT amount INTO owed FROM settlements WHERE id = NEW.settlement_id;
  IF coalesce(owed, 0) <= 0 THEN
    RAISE EXCEPTION
      'bill_lines_payable_check: settlement % is worth %, which is not billable',
      NEW.settlement_id, owed
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_payable_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bill_lines_payable_guard
  BEFORE INSERT OR UPDATE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION bill_lines_payable_guard();
