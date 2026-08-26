-- Reconciliation: the record of every time this system asked "does the other
-- side agree with our ledger", and every place it did not.
--
-- Hand-written, no snapshot, like 0007_back_office_guards, 0011_bill_guards
-- and 0012_payout. The tables are Agent F's two from the payout brief
-- (Part 3, AGENT F, BUILD 1) with the columns the three reconciliations need:
--
--   zalopay      the daily run over query-txn (Part 0, F2: there is no
--                webhook, so the only way to know is to ask)
--   statement    a bank or wallet statement matched against manual attempts
--   shadow       what the API rail WOULD have sent, captured while
--                PLAYERONE_PAYOUT_MODE=manual (Part 4, gate G7)
--   shadow_diff  that intention, compared with what an operator actually paid
--
-- Two rules, both held here and not in the worker:
--
--   NOTHING AUTO-RESOLVES. A discrepancy line is closed by an operator with
--   the finance role and a typed reason, and by nobody else — not the next
--   run, not a poll, not a script. The proof is a deferred constraint trigger
--   against the audit trail, the same shape 0012 uses for pending_zlp: at
--   COMMIT there must be an attributed `recon_line.resolve` row for this line
--   from the operator the line names, with a reason. A worker has no operator
--   and cannot write that row (audit_events_attributed_check), so it cannot
--   close a line no matter what its code says.
--
--   APPEND-ONLY. A line is evidence. Nothing about what was found may change
--   after it is written; the only edit a line ever takes is its resolution,
--   exactly once. A run may be finished once. Neither is ever deleted.

CREATE TABLE "recon_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	-- The window the run looked at, as a label ('2026-08-17/2026-08-24') and as bounds.
	"period" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "recon_runs_source_check" CHECK ("recon_runs"."source" in ('zalopay', 'statement', 'shadow', 'shadow_diff')),
	CONSTRAINT "recon_runs_period_check" CHECK ("recon_runs"."period_end" > "recon_runs"."period_start"),
	CONSTRAINT "recon_runs_finished_check" CHECK ("recon_runs"."finished_at" is null or "recon_runs"."finished_at" >= "recon_runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "recon_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	-- Null for a statement line that matched nothing of ours: there is no bill to name.
	"bill_id" uuid,
	"payout_attempt_id" uuid,
	"partner_order_id" text,
	-- What the other side called it: a zlp order id, or a statement reference.
	"reference" text,
	"our_status" text,
	"their_status" text,
	"our_amount" bigint,
	"their_amount" bigint,
	"discrepancy_kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolve_reason" text,
	CONSTRAINT "recon_lines_kind_check" CHECK ("recon_lines"."discrepancy_kind" in (
		-- The daily run (brief, AGENT F, BUILD 2).
		'WE_SAY_PAID_THEY_DONT', 'THEY_SAY_PAID_WE_DONT', 'AMOUNT_MISMATCH',
		'ORPHAN_AT_ZLP', 'STALE_PROCESSING', 'STUCK_PENDING',
		-- The shadow diff (BUILD 6): intended and not paid, paid and not intended.
		'SHADOW_UNPAID', 'SHADOW_UNINTENDED')),
	-- A resolution is a moment, a person and a reason: all three, or none. The
	-- two shapes are spelled out in full — an open line carries NO reason, so
	-- a reason cannot be added, replaced or erased on evidence that is still
	-- open (bridge finding F-43).
	CONSTRAINT "recon_lines_resolution_check" CHECK (
		("recon_lines"."resolved_at" is null and "recon_lines"."resolved_by" is null and "recon_lines"."resolve_reason" is null)
		or ("recon_lines"."resolved_at" is not null and "recon_lines"."resolved_by" is not null
		    and length(trim(coalesce("recon_lines"."resolve_reason", ''))) > 0)),
	CONSTRAINT "recon_lines_amount_check" CHECK (
		("recon_lines"."our_amount" is null or "recon_lines"."our_amount" >= 0)
		and ("recon_lines"."their_amount" is null or "recon_lines"."their_amount" >= 0))
);
--> statement-breakpoint
ALTER TABLE "recon_lines" ADD CONSTRAINT "recon_lines_run_id_recon_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_lines" ADD CONSTRAINT "recon_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_lines" ADD CONSTRAINT "recon_lines_payout_attempt_id_payout_attempts_id_fk" FOREIGN KEY ("payout_attempt_id") REFERENCES "public"."payout_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_lines" ADD CONSTRAINT "recon_lines_resolved_by_operators_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recon_runs_source_idx" ON "recon_runs" USING btree ("source","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recon_lines_run_idx" ON "recon_lines" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "recon_lines_bill_idx" ON "recon_lines" USING btree ("bill_id","raised_at" DESC NULLS LAST);--> statement-breakpoint
-- The operator's queue: what is still open, newest first.
CREATE INDEX "recon_lines_open_idx" ON "recon_lines" USING btree ("discrepancy_kind","raised_at" DESC NULLS LAST) WHERE "recon_lines"."resolved_at" is null;--> statement-breakpoint
-- One open line per discrepancy. "The same discrepancy" is the kind and the
-- thing it is about — the attempt, or the bill and the probed order id, or the
-- statement reference — with NULLS NOT DISTINCT so two lines about the same
-- statement reference (bill and attempt both null) are the same line. Held by
-- the database, so two reconciliations running at once cannot both raise it
-- and both ticket it: the second INSERT conflicts, does nothing, and writes no
-- ticket (bridge finding F-44). A resolved line leaves the index, so a
-- discrepancy that comes back after being resolved is raised afresh.
CREATE UNIQUE INDEX "recon_lines_open_key" ON "recon_lines" USING btree ("discrepancy_kind","payout_attempt_id","bill_id","partner_order_id","reference") NULLS NOT DISTINCT WHERE "recon_lines"."resolved_at" is null;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-written from here down.

-- A run is started once and finished once. What it looked at (period, source,
-- start) never changes; `finished_at` and `summary` are written when it ends,
-- and after that the row is closed.
CREATE FUNCTION recon_runs_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recon_runs_append_only: run % is the record of a reconciliation and cannot be deleted', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'recon_runs_append_only';
  END IF;
  IF NEW.id <> OLD.id OR NEW.period <> OLD.period OR NEW.period_start <> OLD.period_start
     OR NEW.period_end <> OLD.period_end OR NEW.source <> OLD.source OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'recon_runs_sealed: what run % looked at is written once', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'recon_runs_sealed';
  END IF;
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'recon_runs_sealed: run % finished at % and is closed', OLD.id, OLD.finished_at
      USING ERRCODE = '23514', CONSTRAINT = 'recon_runs_sealed';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER recon_runs_sealed
  BEFORE UPDATE OR DELETE ON recon_runs
  FOR EACH ROW EXECUTE FUNCTION recon_runs_sealed();
--> statement-breakpoint
-- A line is written once. The one edit it takes is its resolution — the three
-- resolution columns, from null to set, together, once. Everything else that
-- was found (statuses, amounts, kind, detail, which run) is evidence.
CREATE FUNCTION recon_lines_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recon_lines_append_only: discrepancy % is evidence and cannot be deleted; resolve it with a reason', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'recon_lines_append_only';
  END IF;
  IF (to_jsonb(NEW) - 'resolved_at' - 'resolved_by' - 'resolve_reason')
     <> (to_jsonb(OLD) - 'resolved_at' - 'resolved_by' - 'resolve_reason') THEN
    RAISE EXCEPTION 'recon_lines_append_only: what was found for discrepancy % is written once; only its resolution may be added', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'recon_lines_append_only';
  END IF;
  IF OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'recon_lines_append_only: discrepancy % was resolved at % and cannot be reopened or re-resolved', OLD.id, OLD.resolved_at
      USING ERRCODE = '23514', CONSTRAINT = 'recon_lines_append_only';
  END IF;
  -- The one edit an open line takes is its resolution, whole. An update that
  -- leaves the line open — touching the reason alone, say — is not that edit
  -- and is refused here, before the deferred audit check would have let it
  -- through unattributed (bridge finding F-43).
  IF NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'recon_lines_append_only: discrepancy % is open; the only edit it takes is a complete resolution', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'recon_lines_append_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER recon_lines_append_only
  BEFORE UPDATE OR DELETE ON recon_lines
  FOR EACH ROW EXECUTE FUNCTION recon_lines_append_only();
--> statement-breakpoint
-- Nothing auto-resolves. A resolution is an operator with the finance role and
-- a typed reason, checked against the audit trail at COMMIT (`mutate` writes
-- the audit row after the change, in the same transaction; `age(xmin) = 0`
-- selects the rows this transaction wrote — see 0012 for the savepoint
-- caveat). The row must name THIS line and THIS operator: a resolution
-- attributed to somebody other than the person whose audit row it is would be
-- a resolution nobody can be asked about.
CREATE FUNCTION recon_lines_resolved_by_operator() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_events a
     WHERE age(a.xmin) = 0
       AND a.action = 'recon_line.resolve'
       AND a.actor_role = 'operator'
       AND a.target_table = 'recon_lines'
       AND a.target_id = NEW.id::text
       AND a.operator_id = NEW.resolved_by
       AND length(trim(coalesce(a.reason, ''))) > 0
  ) THEN
    RAISE EXCEPTION 'recon_lines_resolved_by_operator: discrepancy % may only be resolved by an operator with a typed reason; no run, poll or script ever resolves one', NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'recon_lines_resolved_by_operator';
  END IF;
  SELECT role INTO actor_role FROM operators WHERE id = NEW.resolved_by;
  IF actor_role IS DISTINCT FROM 'finance' THEN
    RAISE EXCEPTION 'recon_lines_resolved_by_operator: discrepancy % was resolved by operator %, whose role is %, not finance', NEW.id, NEW.resolved_by, actor_role
      USING ERRCODE = '23514', CONSTRAINT = 'recon_lines_resolved_by_operator';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recon_lines_resolved_by_operator
  AFTER UPDATE ON recon_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL)
  EXECUTE FUNCTION recon_lines_resolved_by_operator();
--> statement-breakpoint
-- A line born resolved would be a discrepancy nobody ever saw open.
CREATE FUNCTION recon_lines_born_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resolved_at IS NOT NULL OR NEW.resolved_by IS NOT NULL OR NEW.resolve_reason IS NOT NULL THEN
    RAISE EXCEPTION 'recon_lines_born_open: discrepancy % cannot be written already resolved', NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'recon_lines_born_open';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER recon_lines_born_open
  BEFORE INSERT ON recon_lines
  FOR EACH ROW EXECUTE FUNCTION recon_lines_born_open();
