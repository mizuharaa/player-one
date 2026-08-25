CREATE TABLE "collector_agreements" (
	"collector_id" uuid NOT NULL,
	"agreement" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_agreements_collector_id_agreement_version_pk" PRIMARY KEY("collector_id","agreement","version"),
	CONSTRAINT "collector_agreements_name_check" CHECK ("collector_agreements"."agreement" in ('user', 'privacy', 'data_collection', 'commercial_use', 'manual_review', 'offline_settlement')),
	CONSTRAINT "collector_agreements_version_check" CHECK (length(trim("collector_agreements"."version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "task_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_claims_released_after_check" CHECK ("task_claims"."released_at" is null or "task_claims"."released_at" >= "task_claims"."claimed_at")
);
--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "exam_result" text;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "exam_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "bound_collector_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "bound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "fault_note" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "collector_agreements" ADD CONSTRAINT "collector_agreements_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_claims" ADD CONSTRAINT "task_claims_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_claims" ADD CONSTRAINT "task_claims_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_claims_task_idx" ON "task_claims" USING btree ("task_id","released_at");--> statement-breakpoint
CREATE INDEX "task_claims_collector_idx" ON "task_claims" USING btree ("collector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_claims_live_key" ON "task_claims" USING btree ("task_id","collector_id") WHERE "task_claims"."released_at" is null;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_bound_collector_id_collectors_id_fk" FOREIGN KEY ("bound_collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_bound_collector_idx" ON "devices" USING btree ("bound_collector_id");--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_exam_result_check" CHECK ("collectors"."exam_result" is null or "collectors"."exam_result" in ('pass', 'fail'));--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_exam_decided_check" CHECK (("collectors"."exam_result" is null) = ("collectors"."exam_decided_at" is null));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_bound_at_check" CHECK (("devices"."bound_collector_id" is null) = ("devices"."bound_at" is null));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_retired_unbound_check" CHECK ("devices"."status" <> 'retired' or "devices"."bound_collector_id" is null);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-written from here down. Every invariant below is about more than one
-- row, or about the value a column USED to hold, and a CHECK can see neither.

-- BO-01, the transition half. `tasks_status_check` says which states exist; it
-- cannot say which moves between them are legal, because it never sees the old
-- value. Draft becomes published, published becomes taken down, and nothing
-- comes back: a task that was taken down had claimants and a unit price, and
-- reviving it silently changes what a live claim means.
CREATE OR REPLACE FUNCTION tasks_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'published' THEN RETURN NEW; END IF;
  IF OLD.status = 'published' AND NEW.status = 'taken_down' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'tasks_status_transition: % -> % is not a legal task transition',
    OLD.status, NEW.status
    USING ERRCODE = '23514', CONSTRAINT = 'tasks_status_transition';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tasks_status_transition
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_status_transition();
--> statement-breakpoint
-- The price of a published task is frozen, and this is a money rule rather than
-- a tidiness one.
--
-- A settlement takes its unit price from `tasks` at the moment the verdict is
-- committed (review.ts). So editing the price of a published task does not
-- change what future work pays — it changes what ALREADY RECORDED footage pays,
-- retroactively, for every episode still waiting in the review queue. Publish
-- 1200, let a collector record eleven minutes, edit to 1, and the reviewer's
-- verdict pays 1.
--
-- BO-01 says a task can be edited. It does not say the commercial terms a
-- collector accepted can be rewritten underneath them, and the two are only the
-- same sentence if nobody has claimed yet — which is exactly what `draft` means.
-- Everything else about a published task stays editable.
CREATE OR REPLACE FUNCTION tasks_price_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW.unit_price = OLD.unit_price OR OLD.status = 'draft' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'tasks_price_frozen: task % is %, so its unit price is settled terms',
    OLD.id, OLD.status
    USING ERRCODE = '23514', CONSTRAINT = 'tasks_price_frozen';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tasks_price_frozen
  BEFORE UPDATE OF unit_price ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_price_frozen();
--> statement-breakpoint
-- APP-05 and APP-10, in the one place every writer passes through.
--
-- The capacity cap is the reason this is a trigger and not a CHECK: counting
-- the other claimants means reading other rows, and two counters that both read
-- "4 of 5 taken" and both insert produce six. `FOR UPDATE` on the task row is
-- the fix and is the whole design — a second claim for the last slot blocks on
-- that lock until the first commits, then counts it and is refused. Nothing
-- here depends on the caller holding a lock, using SERIALIZABLE, or being the
-- API at all.
--
-- The eligibility gates ride along because APP-05 says "enforced server-side,
-- not only in the UI", and a gate that lives in one route is a gate one route
-- can forget. Two of them: the exam pass APP-05 names, and `qualified` — a
-- suspended collector holding last month's pass must not be able to take work,
-- which is the only thing the suspended state is for.
--
-- Consent (APP-02 / PRV-01) is the third gate, and it is here because PRODUCT.md
-- is explicit: a collector "must accept six agreements, complete training and
-- pass an exam before they can claim any task - enforced server-side, not only
-- in the UI". An earlier draft of this file left consent out on the argument
-- that the agreements belong to registration; that argument loses to the
-- sentence above, which names claiming as the thing they gate.
--
-- `count(distinct agreement) = 6` and not `count(*)`, because acceptances are
-- append-only and a collector who accepted two versions of the privacy policy
-- has two rows for one agreement. Counting rows would let five agreements plus
-- one reissue look like all six.
--
-- Training is NOT gated here, and that is a gap rather than a decision: nothing
-- in this schema records training completion (APP-03 is the collector app's,
-- and unbuilt). When a training record exists it belongs in this function, next
-- to the other three.
CREATE OR REPLACE FUNCTION task_claims_guard() RETURNS trigger AS $$
DECLARE
  t record;
  c record;
  taken integer;
  accepted integer;
BEGIN
  SELECT status, max_concurrent_claimants
    INTO t
    FROM tasks
   WHERE id = NEW.task_id
     FOR UPDATE;
  -- No such task: say nothing and let the foreign key give the real error.
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF t.status <> 'published' THEN
    RAISE EXCEPTION 'task_claims_published_gate: task % is %, so it is not claimable',
      NEW.task_id, t.status
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_published_gate';
  END IF;

  SELECT status, exam_result INTO c FROM collectors WHERE id = NEW.collector_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF c.exam_result IS DISTINCT FROM 'pass' THEN
    RAISE EXCEPTION 'task_claims_exam_gate: collector % has no exam pass (APP-05)',
      NEW.collector_id
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_exam_gate';
  END IF;

  IF c.status <> 'qualified' THEN
    RAISE EXCEPTION 'task_claims_qualified_gate: collector % is %, not qualified',
      NEW.collector_id, c.status
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_qualified_gate';
  END IF;

  SELECT count(DISTINCT agreement) INTO accepted
    FROM collector_agreements
   WHERE collector_id = NEW.collector_id;
  IF accepted < 6 THEN
    RAISE EXCEPTION 'task_claims_consent_gate: collector % has accepted % of the six agreements',
      NEW.collector_id, accepted
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_consent_gate';
  END IF;

  SELECT count(*) INTO taken
    FROM task_claims
   WHERE task_id = NEW.task_id AND released_at IS NULL AND id <> NEW.id;
  IF taken >= t.max_concurrent_claimants THEN
    RAISE EXCEPTION 'task_claims_capacity: task % already holds % of % claimants',
      NEW.task_id, taken, t.max_concurrent_claimants
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_capacity';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_claims_guard
  BEFORE INSERT ON task_claims
  FOR EACH ROW WHEN (NEW.released_at IS NULL)
  EXECUTE FUNCTION task_claims_guard();
--> statement-breakpoint
-- Un-releasing a claim is claiming it again, and has to clear the same gates.
-- Without this the cap is bypassable with one UPDATE, which is not a cap.
CREATE TRIGGER task_claims_guard_reclaim
  BEFORE UPDATE ON task_claims
  FOR EACH ROW WHEN (OLD.released_at IS NOT NULL AND NEW.released_at IS NULL)
  EXECUTE FUNCTION task_claims_guard();
--> statement-breakpoint
-- The remaining way past the gates: keep the row live and move it. Repointing an
-- existing claim at another task, or at another collector, walks around the
-- published check, the exam, the qualification and the cap in one UPDATE — the
-- guard above only fires on an insert or on a re-release.
--
-- Immutable rather than re-checked, because a claim IS the pairing. Changing
-- either half does not edit a claim, it fabricates a different one, and the
-- honest spelling of that is a release and a new claim, both of which are on
-- the record.
CREATE OR REPLACE FUNCTION task_claims_identity_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_claims_identity_immutable: a claim cannot be moved between tasks or collectors'
    USING ERRCODE = '23514', CONSTRAINT = 'task_claims_identity_immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_claims_identity_immutable
  BEFORE UPDATE ON task_claims
  FOR EACH ROW WHEN (NEW.task_id <> OLD.task_id OR NEW.collector_id <> OLD.collector_id)
  EXECUTE FUNCTION task_claims_identity_immutable();

--> statement-breakpoint
-- Append-only, enforced rather than intended.
--
-- The comment on `collector_agreements` calls an acceptance evidence of what a
-- person agreed to on a day. Evidence that a later statement can rewrite is not
-- evidence, and "the API only ever inserts" is a property of one caller. An
-- UPDATE or a DELETE here is refused for everyone, so the answer to "what did
-- this collector consent to, and when" is whatever the rows say.
--
-- ponytail: a trigger, not a revoked table privilege. GRANT is the stronger
-- tool and would also stop the owner, but this repo has one database role and
-- migrations run as it; the upgrade path is a writer role that lacks
-- UPDATE/DELETE on this table.
CREATE OR REPLACE FUNCTION collector_agreements_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'collector_agreements_append_only: an acceptance is a record of a moment, not a settings row'
    USING ERRCODE = '23514', CONSTRAINT = 'collector_agreements_append_only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER collector_agreements_append_only
  BEFORE UPDATE OR DELETE ON collector_agreements
  FOR EACH ROW EXECUTE FUNCTION collector_agreements_append_only();
