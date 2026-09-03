CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"forfeit_amount" numeric(14, 4) DEFAULT '0' NOT NULL,
	"reason" text,
	"fault_audit_event_id" bigint,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"receipt_reference" text,
	"released_at" timestamp with time zone,
	"forfeited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_state_check" CHECK ("deposits"."state" in ('held', 'released', 'partially_forfeited', 'forfeited')),
	CONSTRAINT "deposits_amount_positive_check" CHECK ("deposits"."amount" > 0),
	CONSTRAINT "deposits_currency_check" CHECK ("deposits"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "deposits_forfeit_bounds_check" CHECK ("deposits"."forfeit_amount" >= 0 and "deposits"."forfeit_amount" <= "deposits"."amount"),
	CONSTRAINT "deposits_forfeit_amount_state_check" CHECK (case "deposits"."state"
            when 'held' then "deposits"."forfeit_amount" = 0
            when 'released' then "deposits"."forfeit_amount" = 0
            when 'partially_forfeited' then "deposits"."forfeit_amount" > 0 and "deposits"."forfeit_amount" < "deposits"."amount"
            when 'forfeited' then "deposits"."forfeit_amount" = "deposits"."amount"
          end),
	CONSTRAINT "deposits_forfeit_reason_check" CHECK ("deposits"."state" not in ('partially_forfeited', 'forfeited')
          or ("deposits"."reason" is not null and length(trim("deposits"."reason")) > 0)),
	CONSTRAINT "deposits_forfeit_requires_receipt_check" CHECK ("deposits"."forfeit_amount" = 0 or "deposits"."received_at" is not null),
	CONSTRAINT "deposits_released_at_check" CHECK (("deposits"."state" = 'released') = ("deposits"."released_at" is not null)),
	CONSTRAINT "deposits_forfeited_at_check" CHECK (("deposits"."state" in ('partially_forfeited', 'forfeited')) = ("deposits"."forfeited_at" is not null)),
	CONSTRAINT "deposits_fault_event_state_check" CHECK ("deposits"."fault_audit_event_id" is null
          or "deposits"."state" in ('partially_forfeited', 'forfeited'))
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_fault_audit_event_id_audit_events_id_fk" FOREIGN KEY ("fault_audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_open_device_key" ON "deposits" USING btree ("device_id") WHERE state = 'held';--> statement-breakpoint
CREATE INDEX "deposits_collector_idx" ON "deposits" USING btree ("collector_id","held_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deposits_device_idx" ON "deposits" USING btree ("device_id","held_at" DESC NULLS LAST);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-written from here down. Every rule below is about the value a column
-- USED to hold, or about a row in another table, and a CHECK can see neither.

-- The state machine. `deposits_state_check` says which states exist; only a
-- trigger can say which moves between them are legal, because a CHECK never
-- sees the old value.
--
--   (nothing) -> held
--   held      -> released | partially_forfeited | forfeited
--
-- and nothing else. Every terminal state is terminal: a released deposit that
-- can go back to held is a deposit that can be collected twice, and a forfeited
-- one that can be re-opened erases the decision somebody signed for.
--
-- The INSERT half matters as much as the UPDATE half. Without it a row can be
-- born `forfeited`, which is a forfeiture with no `held` period, no receipt
-- decision and no audit row for the moment money changed hands — the whole
-- point of the ledger, skipped in one statement.
CREATE OR REPLACE FUNCTION deposits_state_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'held' THEN
      RAISE EXCEPTION 'deposits_state_transition: a deposit is created held, not %', NEW.state
        USING ERRCODE = '23514', CONSTRAINT = 'deposits_state_transition';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF OLD.state = 'held' AND NEW.state IN ('released', 'partially_forfeited', 'forfeited') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'deposits_state_transition: % -> % is not a legal deposit transition',
    OLD.state, NEW.state
    USING ERRCODE = '23514', CONSTRAINT = 'deposits_state_transition';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deposits_state_transition_insert
  BEFORE INSERT ON deposits
  FOR EACH ROW EXECUTE FUNCTION deposits_state_transition();
--> statement-breakpoint
CREATE TRIGGER deposits_state_transition
  BEFORE UPDATE OF state ON deposits
  FOR EACH ROW EXECUTE FUNCTION deposits_state_transition();
--> statement-breakpoint
-- The terms are what the deposit was taken under, and a settled forfeiture is
-- one of them.
--
-- `deposits_forfeit_bounds_check` says a forfeiture cannot exceed the deposit.
-- That is worth nothing if the deposit can be lowered afterwards: forfeit 5,000
-- of 5,000, then edit `amount` to 500, and the row now reads as a 500 deposit
-- fully kept while 4,500 of somebody's money is unaccounted for. Same argument
-- as `tasks_price_frozen`, and the same answer.
--
-- Moving a deposit to another collector or another device is the same shape as
-- `task_claims_identity_immutable`: it does not edit this deposit, it fabricates
-- a different one. The honest spelling is to close this row and open another,
-- and both of those are on the record.
--
-- `reason` stays editable on purpose — a forfeiture reason with a typo in it
-- should be fixable, and every edit goes through `mutate` and is audited.
CREATE OR REPLACE FUNCTION deposits_terms_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deposits_terms_immutable: deposit % was taken under these terms; a settled deposit is not re-priced or re-assigned',
    OLD.id
    USING ERRCODE = '23514', CONSTRAINT = 'deposits_terms_immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deposits_terms_immutable
  BEFORE UPDATE ON deposits
  FOR EACH ROW WHEN (
    NEW.collector_id <> OLD.collector_id
    OR NEW.device_id <> OLD.device_id
    OR NEW.amount <> OLD.amount
    OR NEW.currency <> OLD.currency
    OR (OLD.state <> 'held' AND NEW.forfeit_amount <> OLD.forfeit_amount))
  EXECUTE FUNCTION deposits_terms_immutable();
--> statement-breakpoint
-- A forfeiture may cite the device fault it was decided on. BO-04 records a
-- fault as `devices.status = 'faulty'` plus `fault_note`, written through
-- `mutate`, so the citable record of the moment is the `audit_events` row.
--
-- The foreign key proves the event exists. It cannot prove the event is about
-- THIS device, and an event id that points at a task edit or at another
-- headset is a forfeiture that documents nothing while looking documented.
-- Cross-row, so it is a trigger.
--
-- Note what this deliberately does NOT check: that the event is a fault report
-- rather than any other device event. A fault today is a status change and a
-- note on the device row, and `action` is an open list by design
-- (`audit_events` has no CHECK on it). Pinning an action name here would break
-- the next slice that renames one; the device is the part that must match.
CREATE OR REPLACE FUNCTION deposits_fault_event_matches_device() RETURNS trigger AS $$
DECLARE e record;
BEGIN
  SELECT target_table, target_id INTO e FROM audit_events WHERE id = NEW.fault_audit_event_id;
  -- No such event: say nothing and let the foreign key give the real error.
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF e.target_table <> 'devices' OR e.target_id <> NEW.device_id::text THEN
    RAISE EXCEPTION 'deposits_fault_event_matches_device: audit event % is about %/%, not device %',
      NEW.fault_audit_event_id, e.target_table, e.target_id, NEW.device_id
      USING ERRCODE = '23514', CONSTRAINT = 'deposits_fault_event_matches_device';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deposits_fault_event_matches_device
  BEFORE INSERT OR UPDATE ON deposits
  FOR EACH ROW WHEN (NEW.fault_audit_event_id IS NOT NULL)
  EXECUTE FUNCTION deposits_fault_event_matches_device();
