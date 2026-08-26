-- The payout spine: where a collector's money goes, and every attempt to send
-- it there. The five tables are the §2.1 contract of the payout brief; the
-- triggers are its frozen invariants, held in the database the way 0005 holds
-- the settlement edges and 0011 freezes an issued bill — so that a writer which
-- is not this API (psql, a worker, a future console) is refused by the same
-- rule and not by a rule it has to remember.
--
-- Hand-written, no snapshot, like 0007_back_office_guards and 0011_bill_guards.
-- drizzle cannot declare a trigger; the declarations in schema.ts point here.
--
-- Two ZaloPay facts shape the attempts table (Part 0 of the brief):
--
--   F3  `partner_order_id` is a server-side idempotency key: ZaloPay itself
--       refuses a repeat with -68. It is therefore computed HERE, from
--       (bill_id, attempt_seq), and never accepted from the application. A
--       random or time-based id would throw that protection away, and a test
--       could only prove the application did not do it today.
--   F4  status 4 (PENDING) needs ZaloPay's own staff. Nothing automatic may
--       move it — see `payout_attempts_pending_resolved` at the bottom.
--
-- Money: `amount_vnd` is whole dong, and `bills.total` is numeric(14,4). The
-- conversion is a rounding decision nobody has taken (Part R5), so a bill whose
-- total has a fractional part cannot be attempted at all until it is.

CREATE TABLE "payout_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector_id" uuid NOT NULL,
	"method" text NOT NULL,
	"phone" text,
	"bank_code" text,
	"account_no_last4" text,
	"declared_name" text NOT NULL,
	"verified_name" text,
	"m_u_id" text,
	"verify_status" text NOT NULL,
	"verified_at" timestamp with time zone,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "payout_accounts_method_check" CHECK ("payout_accounts"."method" in ('WALLET', 'BANK_ACCOUNT', 'BANK_CARD')),
	CONSTRAINT "payout_accounts_verify_status_check" CHECK ("payout_accounts"."verify_status" in ('unverified', 'verified', 'name_mismatch', 'no_wallet', 'locked', 'kyc_limit', 'error')),
	-- The contract's own column comments, made true: a phone is the wallet
	-- route, a bank code is the bank routes, and m_u_id only ever comes from a
	-- wallet verification.
	CONSTRAINT "payout_accounts_route_check" CHECK (
		("payout_accounts"."method" = 'WALLET' and "payout_accounts"."phone" is not null and "payout_accounts"."bank_code" is null)
		or ("payout_accounts"."method" <> 'WALLET' and "payout_accounts"."bank_code" is not null and "payout_accounts"."phone" is null and "payout_accounts"."m_u_id" is null)),
	CONSTRAINT "payout_accounts_declared_name_check" CHECK (length(trim("payout_accounts"."declared_name")) > 0),
	CONSTRAINT "payout_accounts_last4_check" CHECK ("payout_accounts"."account_no_last4" is null or length("payout_accounts"."account_no_last4") <= 4),
	-- A verified name without a moment, or a moment without a status that
	-- means ZaloPay answered, is not a record of a verification.
	CONSTRAINT "payout_accounts_verified_at_check" CHECK (("payout_accounts"."verify_status" = 'unverified') = ("payout_accounts"."verified_at" is null))
);
--> statement-breakpoint
CREATE TABLE "payout_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bill_id" uuid NOT NULL,
	"payout_account_id" uuid NOT NULL,
	"partner_order_id" text NOT NULL,
	"attempt_seq" integer NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"zlp_order_id" text,
	"zp_trans_id" text,
	"sub_return_code" integer,
	"manual_reference" text,
	"last_polled_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payout_attempts_partner_order_key" UNIQUE("partner_order_id"),
	CONSTRAINT "payout_attempts_bill_seq_key" UNIQUE("bill_id","attempt_seq"),
	CONSTRAINT "payout_attempts_amount_positive_check" CHECK ("payout_attempts"."amount_vnd" > 0),
	CONSTRAINT "payout_attempts_mode_check" CHECK ("payout_attempts"."mode" in ('manual', 'api')),
	CONSTRAINT "payout_attempts_status_check" CHECK ("payout_attempts"."status" in ('created', 'submitted', 'processing', 'pending_zlp', 'succeeded', 'failed', 'unknown')),
	-- §2.1: a manual attempt is the record of a transfer a person made outside
	-- this system, and the reference is the only evidence that it happened.
	CONSTRAINT "payout_attempts_manual_reference_check" CHECK ("payout_attempts"."mode" <> 'manual' or length(trim(coalesce("payout_attempts"."manual_reference", ''))) > 0),
	CONSTRAINT "payout_attempts_poll_count_check" CHECK ("payout_attempts"."poll_count" >= 0)
);
--> statement-breakpoint
-- What Agent C's risk engine reads from this side of the seam, and the trail
-- of everything a worker did without an operator behind it. Append-only:
-- a name mismatch at declaration is evidence eighteen months later, and a
-- poll that moved an attempt is the only record of why it moved.
CREATE TABLE "payout_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"collector_id" uuid,
	"payout_account_id" uuid,
	"bill_id" uuid,
	"payout_attempt_id" uuid,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_events_kind_check" CHECK (length(trim("payout_events"."kind")) > 0)
);
--> statement-breakpoint
-- The export finance receives, hashed so the file that comes back is provably
-- the file that went out. `bills` is frozen by 0011 and is not this
-- migration's table to widen, so the hashes live beside the bill, keyed on it.
CREATE TABLE "payout_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"file_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_by" uuid NOT NULL,
	CONSTRAINT "payout_exports_period_check" CHECK ("payout_exports"."period_end" > "payout_exports"."period_start")
);
--> statement-breakpoint
CREATE TABLE "payout_export_rows" (
	"export_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"row_hash" text NOT NULL,
	CONSTRAINT "payout_export_rows_pk" PRIMARY KEY("export_id","bill_id")
);
--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_created_by_operators_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_payout_account_id_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_payout_account_id_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_payout_attempt_id_payout_attempts_id_fk" FOREIGN KEY ("payout_attempt_id") REFERENCES "public"."payout_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_exports" ADD CONSTRAINT "payout_exports_exported_by_operators_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_export_rows" ADD CONSTRAINT "payout_export_rows_export_id_payout_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."payout_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_export_rows" ADD CONSTRAINT "payout_export_rows_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- §2.1: exactly one current account per collector.
CREATE UNIQUE INDEX "payout_accounts_current_key" ON "payout_accounts" USING btree ("collector_id") WHERE "payout_accounts"."is_current";--> statement-breakpoint
CREATE INDEX "payout_accounts_collector_idx" ON "payout_accounts" USING btree ("collector_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- The poller's own index: the three states it may touch, and nothing else.
CREATE INDEX "payout_attempts_polling_idx" ON "payout_attempts" USING btree ("status","last_polled_at") WHERE "payout_attempts"."status" in ('submitted', 'processing', 'unknown');--> statement-breakpoint
CREATE INDEX "payout_events_collector_idx" ON "payout_events" USING btree ("collector_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payout_events_bill_idx" ON "payout_events" USING btree ("bill_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payout_events_kind_idx" ON "payout_events" USING btree ("kind","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payout_exports_period_idx" ON "payout_exports" USING btree ("period_start","period_end","exported_at" DESC NULLS LAST);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-written from here down.

-- An account is history. What a collector declared, what ZaloPay answered and
-- when, is the evidence a name-mismatch flag points at; correcting it in place
-- would erase the signal. A collector who fixes their details declares a NEW
-- account, and the one legal change to an old row is that it stops being
-- current when its successor arrives.
CREATE FUNCTION payout_accounts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_accounts_append_only: a payout account is evidence; declare a new one instead of deleting %', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_accounts_append_only';
  END IF;
  IF (to_jsonb(NEW) - 'is_current') <> (to_jsonb(OLD) - 'is_current')
     OR (NEW.is_current AND NOT OLD.is_current) THEN
    RAISE EXCEPTION 'payout_accounts_append_only: account % may only stop being current; every other change is a new account', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_accounts_append_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payout_accounts_append_only
  BEFORE UPDATE OR DELETE ON payout_accounts
  FOR EACH ROW EXECUTE FUNCTION payout_accounts_append_only();
--> statement-breakpoint
-- The attempt guard. One function, both operations, because the INSERT rules
-- and the UPDATE rules share one source of truth about what an attempt is.
--
-- INSERT
--   The bill row is the lock. Two inserts for one bill serialise on it, so the
--   second reads the first's row below and is refused. Without the lock both
--   would read "no attempt yet" and both would be written; the unique index on
--   (bill_id, attempt_seq) would then catch one of them, but only because they
--   also happened to compute the same sequence number — a guard that holds by
--   coincidence is not a guard. This is what makes two operators, or one
--   operator's double-click, produce exactly one attempt.
--
--   attempt_seq and partner_order_id are computed here. An application value
--   is accepted only when it equals the computed one, which is how a caller that
--   thinks it knows the id finds out when it is wrong instead of paying twice.
--
--   The amount must equal the bill's total, and the total must be whole dong.
--   The second check is deliberate: a bill of 320.0004 has no whole-VND amount
--   until somebody decides floor, round or ceil, and until then it has no
--   attempt either (Part R5).
--
--   ZaloPay's own limits (Part 0, F5) are checked against the account's route:
--   bank transfers are 2,000 to 10,000,000 VND per transaction. A bill above the
--   ceiling is refused by name. It is NOT split — splitting a payout is a
--   money-correctness change (§0.7 item 3) and is not this migration's to make.
--
-- UPDATE
--   Identity and amount never change. A succeeded attempt never changes at all;
--   a failed one never leaves failed, because a new attempt with a new
--   partner_order_id is how a failure is retried (F4). Every other move is an
--   edge of the state machine in payout/domain/state.ts, listed here a second
--   time so the database refuses the same jumps as the code.
CREATE FUNCTION payout_attempts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bill_total numeric;
  bill_collector uuid;
  latest_seq integer;
  latest_status text;
  acct_method text;
  acct_collector uuid;
  acct_current boolean;
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

    SELECT method, collector_id, is_current INTO acct_method, acct_collector, acct_current
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
--> statement-breakpoint
CREATE TRIGGER payout_attempts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payout_attempts
  FOR EACH ROW EXECUTE FUNCTION payout_attempts_guard();
--> statement-breakpoint
-- §2.1, the last invariant: `pending_zlp` is never auto-transitioned by any
-- worker. Only an operator with a typed reason moves it.
--
-- "An operator with a typed reason" is a row in `audit_events` — that is what
-- the trail is — so the rule is checked against the trail. It is a DEFERRED
-- constraint trigger because `mutate` writes the audit row after the change,
-- inside the same transaction; at COMMIT both exist, and `age(xmin) = 0`
-- selects exactly the rows this transaction wrote. A worker has no operator
-- and no machine, so it cannot write an attributed audit row at all
-- (audit_events_attributed_check), so it cannot move a pending attempt, no
-- matter what its code says. That is the point: the poller is proved unable,
-- not merely tested not to.
--
-- Rows written under a savepoint carry the subtransaction's xid and do not
-- satisfy `age(xmin) = 0`. `mutate` writes at the top level of the transaction,
-- which is the shape this relies on.
CREATE FUNCTION payout_attempts_pending_resolved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_events a
     WHERE age(a.xmin) = 0
       AND a.action = 'payout_attempt.resolve'
       AND a.actor_role = 'operator'
       AND a.target_table = 'payout_attempts'
       AND a.target_id = NEW.id::text
       AND length(trim(coalesce(a.reason, ''))) > 0
  ) THEN
    RAISE EXCEPTION 'payout_attempts_pending_operator_only: attempt % is pending inside ZaloPay (status 4); only an operator with a typed reason may move it, and no worker, timeout or poll count ever will', NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_pending_operator_only';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payout_attempts_pending_resolved
  AFTER UPDATE ON payout_attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status = 'pending_zlp' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION payout_attempts_pending_resolved();
--> statement-breakpoint
-- Append-only, the way audit_events is (0002): a raised flag, a poll that moved
-- an attempt, a ticket for an operator — resolved by adding a row, never by
-- editing one. Same shape for the export ledger: what went out, went out.
CREATE FUNCTION payout_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER payout_events_append_only
  BEFORE UPDATE OR DELETE ON payout_events
  FOR EACH ROW EXECUTE FUNCTION payout_history_append_only();
--> statement-breakpoint
CREATE TRIGGER payout_exports_append_only
  BEFORE UPDATE OR DELETE ON payout_exports
  FOR EACH ROW EXECUTE FUNCTION payout_history_append_only();
--> statement-breakpoint
CREATE TRIGGER payout_export_rows_append_only
  BEFORE UPDATE OR DELETE ON payout_export_rows
  FOR EACH ROW EXECUTE FUNCTION payout_history_append_only();
--> statement-breakpoint
-- An export's membership is decided in the transaction that hashes it and
-- never afterwards. Refusing UPDATE and DELETE on the rows is not enough: a
-- later INSERT would attach a bill to a file whose hash and count were
-- already handed to finance, and the ledger would describe a file that never
-- went out. So a row may only join an export created in the same transaction
-- (`age(xmin) = 0` on the parent), and at COMMIT the export must hold exactly
-- the number of rows it claims.
CREATE FUNCTION payout_export_rows_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE still_open boolean;
BEGIN
  SELECT age(xmin) = 0 INTO still_open FROM payout_exports WHERE id = NEW.export_id;
  IF still_open IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'payout_export_rows_sealed: export % was hashed and handed over; a row cannot be added to it afterwards', NEW.export_id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_export_rows_sealed';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payout_export_rows_sealed
  BEFORE INSERT ON payout_export_rows
  FOR EACH ROW EXECUTE FUNCTION payout_export_rows_sealed();
--> statement-breakpoint
CREATE FUNCTION payout_exports_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held integer;
BEGIN
  SELECT count(*) INTO held FROM payout_export_rows WHERE export_id = NEW.id;
  IF held <> NEW.row_count THEN
    RAISE EXCEPTION 'payout_exports_complete: export % claims % rows and holds %', NEW.id, NEW.row_count, held
      USING ERRCODE = '23514', CONSTRAINT = 'payout_exports_complete';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payout_exports_complete
  AFTER INSERT ON payout_exports
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_exports_complete();
