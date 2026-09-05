-- 0023: commitment contracts (APP-11 / BO-02).
--
-- Brought forward from `feat/commitment-contracts`, which was written against
-- 4f1ef2e and numbered itself 0011 — a number `0011_bill_guards` already holds
-- on main. Nothing about the DDL changed; only the file name, the journal
-- entry and the migration numbers named in comments. The two tables and the
-- two `tasks` columns are new, so nothing here alters an applied migration.
--
-- `pnpm db:generate` could not produce this file: the snapshot chain in
-- `meta/` stops at 0010 and 0005/0006/0008/0009 all claim the same parent, so
-- drizzle-kit refuses the folder before it reads the schema. Every migration
-- since 0010 is hand-written for the same reason. The DDL below is the
-- generator's own output from the branch, kept verbatim.

CREATE TABLE "commitment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"commitment_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"pledged_minutes" numeric(20, 6) NOT NULL,
	"delivered_minutes" numeric(20, 6) NOT NULL,
	CONSTRAINT "commitment_events_event_check" CHECK ("commitment_events"."event" in ('completed', 'released', 'abandoned')),
	CONSTRAINT "commitment_events_pledged_check" CHECK ("commitment_events"."pledged_minutes" > 0),
	CONSTRAINT "commitment_events_delivered_check" CHECK ("commitment_events"."delivered_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_commitments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"pledged_hours_per_week" integer NOT NULL,
	"started_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_commitments_state_check" CHECK ("task_commitments"."state" in ('active', 'completed', 'released', 'abandoned')),
	CONSTRAINT "task_commitments_hours_check" CHECK ("task_commitments"."pledged_hours_per_week" > 0),
	CONSTRAINT "task_commitments_whole_weeks_check" CHECK ("task_commitments"."ends_on" > "task_commitments"."started_on" and ("task_commitments"."ends_on" - "task_commitments"."started_on") % 7 = 0),
	CONSTRAINT "task_commitments_closed_at_check" CHECK (("task_commitments"."state" = 'active') = ("task_commitments"."closed_at" is null)),
	CONSTRAINT "task_commitments_abandon_reason_check" CHECK ("task_commitments"."state" <> 'abandoned' or "task_commitments"."close_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "commitment_hours_options" integer[];--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "commitment_weeks" integer;--> statement-breakpoint
ALTER TABLE "commitment_events" ADD CONSTRAINT "commitment_events_commitment_id_task_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."task_commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_events" ADD CONSTRAINT "commitment_events_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_commitments" ADD CONSTRAINT "task_commitments_claim_id_task_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."task_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitment_events_collector_idx" ON "commitment_events" USING btree ("collector_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "commitment_events_commitment_key" ON "commitment_events" USING btree ("commitment_id");--> statement-breakpoint
CREATE INDEX "task_commitments_claim_idx" ON "task_commitments" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_commitments_active_key" ON "task_commitments" USING btree ("claim_id") WHERE "task_commitments"."state" = 'active';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_commitment_terms_check" CHECK (("tasks"."commitment_hours_options" is null) = ("tasks"."commitment_weeks" is null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_commitment_shape_check" CHECK ("tasks"."commitment_hours_options" is null
          or (array_length("tasks"."commitment_hours_options", 1) >= 1
              and 0 < all("tasks"."commitment_hours_options")));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_commitment_weeks_check" CHECK ("tasks"."commitment_weeks" is null or "tasks"."commitment_weeks" > 0);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-written from here down, same as 0006. Everything below is about the
-- value a column USED to hold, about rows in another table, or about today's
-- date — and a CHECK can see none of the three.

-- How many reviewed minutes a contract actually earned.
--
-- ONE implementation, called by both readers: the adherence endpoint reads it
-- per request, and `task_commitments_emit_event` freezes its answer into the
-- reputation event when a human closes the contract. Two copies of this join
-- would be two chances to disagree about what a collector delivered, and the
-- disagreement would surface as a reputation score that does not match the
-- screen the operator decided from.
--
-- The join is the one the settlement lane already built and is not a new path
-- from footage to money: settlements -> episode_reviews -> episodes ->
-- collection_sessions, which is where the task and the collector are. A
-- settlement row exists only because a reviewer committed a verdict, so
-- "reviewed" needs no separate predicate — the row IS the review evidence.
--
-- Nothing here is or feeds a payment. `settlements.effective_minutes` is read,
-- never written; the settlement formula stays `quantise(unit_price x
-- effective_minutes)` in money.ts and a commitment is not one of its operands.
--
-- Deliberately NOT filtered on `settlement_state`: a verdict awaiting a bill is
-- delivered work, and a contract's adherence must not change because finance
-- moved a row.
--
-- The window is matched against the RECORDING DAY, taken from the episode's
-- directory basename — the device's own local clock at the moment the collector
-- was working. Not the review date (that measures the reviewer's backlog) and
-- not the ingest date (that measures how often the collector visits a counter).
-- Both sides of the comparison are therefore wall-clock calendars with no zone,
-- which is the only comparison that is honest here.
--
-- ponytail: an episode whose basename did not parse (EPISODE-ID-FALLBACK keeps
-- the row, ING-17) has no recording day and counts toward no window. It reads
-- as undelivered rather than as mis-attributed, which is the safer of the two
-- wrong answers; the upgrade is a parsed start instant on `episodes`, which the
-- engine already computes and does not store.
CREATE OR REPLACE FUNCTION commitment_delivered_minutes(p_commitment uuid)
RETURNS numeric AS $$
  SELECT coalesce(sum(s.effective_minutes), 0)
    FROM task_commitments tc
    JOIN task_claims cl ON cl.id = tc.claim_id
    JOIN collection_sessions cs
      ON cs.task_id = cl.task_id AND cs.collector_id = cl.collector_id
    JOIN episodes e ON e.collection_session_id = cs.id
    JOIN episode_reviews r ON r.episode_id = e.episode_id
    JOIN settlements s ON s.episode_review_id = r.id
   WHERE tc.id = p_commitment
     AND e.session_started_at ~ '^[0-9]{8}_'
     AND substring(e.session_started_at from 1 for 8) >= to_char(tc.started_on, 'YYYYMMDD')
     AND substring(e.session_started_at from 1 for 8) <  to_char(tc.ends_on, 'YYYYMMDD');
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
-- What a contract pledged, in minutes. Exact, because
-- `task_commitments_whole_weeks_check` makes the week count an integer.
CREATE OR REPLACE FUNCTION commitment_pledged_minutes(p_hours integer, p_from date, p_to date)
RETURNS numeric AS $$
  SELECT (p_hours * 60)::numeric * ((p_to - p_from) / 7)::numeric;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
-- The pledge has to be one the operator actually offered, checked against the
-- task at the moment it is taken. A CHECK cannot read `tasks`, and the API is
-- not the only writer.
--
-- After this fires, the terms on the contract row are a COPY and are never
-- compared to the task again. That is what lets an operator re-price the
-- commitment options tomorrow without rewriting what anybody agreed to — the
-- same guarantee `tasks_price_frozen` buys by the opposite means.
CREATE OR REPLACE FUNCTION task_commitments_terms_gate() RETURNS trigger AS $$
DECLARE
  cl record;
  t  record;
BEGIN
  SELECT task_id, released_at INTO cl FROM task_claims WHERE id = NEW.claim_id;
  -- No such claim: say nothing and let the foreign key give the real error.
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF cl.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'task_commitments_live_claim: claim % was released, so there is nothing to pledge against',
      NEW.claim_id
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_live_claim';
  END IF;

  SELECT commitment_hours_options, commitment_weeks INTO t FROM tasks WHERE id = cl.task_id;
  IF t.commitment_weeks IS NULL THEN
    RAISE EXCEPTION 'task_commitments_task_has_no_terms: task % offers no commitment terms to pledge against',
      cl.task_id
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_task_has_no_terms';
  END IF;

  IF NOT (NEW.pledged_hours_per_week = ANY (t.commitment_hours_options)) THEN
    RAISE EXCEPTION 'task_commitments_pledge_not_offered: task % does not offer % hours a week',
      cl.task_id, NEW.pledged_hours_per_week
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_pledge_not_offered';
  END IF;

  IF (NEW.ends_on - NEW.started_on) <> t.commitment_weeks * 7 THEN
    RAISE EXCEPTION 'task_commitments_duration_mismatch: task % runs % weeks, the contract spans % days',
      cl.task_id, t.commitment_weeks, (NEW.ends_on - NEW.started_on)
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_duration_mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_commitments_terms_gate
  BEFORE INSERT ON task_commitments
  FOR EACH ROW EXECUTE FUNCTION task_commitments_terms_gate();
--> statement-breakpoint
-- The state machine, and the two timing rules that make release and abandon
-- different words rather than synonyms.
--
--   active -> released   a collector changed their mind EARLY. Neutral, and
--                        only inside the first quarter of the window: past that
--                        the pledge has already been counted on by whoever
--                        planned around it.
--   active -> abandoned  a human looked at a finished window and judged that
--                        materially nothing was delivered. Only after the
--                        window, because "nothing yet" and "nothing ever" are
--                        the same reading until the window closes.
--   active -> completed  the window ended and nobody abandoned it.
--
-- The 25% threshold is in days and compared with `current_date`, not with an
-- instant. Both ends of the window are calendar dates and a day-granularity
-- rule wants day-granularity arithmetic; making it an instant would import a
-- timezone question into a rule that does not have one.
--
-- What is NOT here: any test of how much was delivered. Abandonment is a human
-- decision through the audit trail — the trigger says WHEN it may be taken, and
-- a person says whether it should be. A threshold in SQL would turn a judgement
-- into an automatic forfeiture, which is exactly the decision this repo keeps
-- with people.
--
-- ponytail: there is no state for a collector who walks away after 25% and
-- before the window ends. Their contract stands and is judged at the end, which
-- is what a commitment means. If the pilot shows collectors need a late exit
-- that is not abandonment, it is a fourth terminal state and one more branch
-- here — a product decision, not a schema one.
CREATE OR REPLACE FUNCTION task_commitments_state_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;

  IF OLD.state <> 'active' THEN
    RAISE EXCEPTION 'task_commitments_state_transition: contract % is already %, and that is final',
      OLD.id, OLD.state
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_state_transition';
  END IF;

  IF NEW.state = 'released'
     AND (current_date - OLD.started_on) * 4 >= (OLD.ends_on - OLD.started_on) THEN
    RAISE EXCEPTION 'task_commitments_release_window: contract % is more than a quarter through its window',
      OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_release_window';
  END IF;

  IF NEW.state IN ('completed', 'abandoned') AND current_date < OLD.ends_on THEN
    RAISE EXCEPTION 'task_commitments_window_open: contract % runs until %, so it cannot be % yet',
      OLD.id, OLD.ends_on, NEW.state
      USING ERRCODE = '23514', CONSTRAINT = 'task_commitments_window_open';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_commitments_state_transition
  BEFORE UPDATE OF state ON task_commitments
  FOR EACH ROW EXECUTE FUNCTION task_commitments_state_transition();
--> statement-breakpoint
-- The reputation event, emitted by the database rather than by a route.
--
-- A trigger because the event is the ONLY record of what was true when the
-- contract closed, and a writer that closes a contract with one UPDATE would
-- otherwise close it silently. It is also the shorter diff: route code plus a
-- test that the route remembered is more than this.
--
-- Nothing here scores anything. The row carries what was pledged and what was
-- delivered and stops; how heavily an abandonment weighs is the reputation
-- engine's, and putting a weight here would make a schema migration out of a
-- number docs/reputation.md says is a starting value.
CREATE OR REPLACE FUNCTION task_commitments_emit_event() RETURNS trigger AS $$
BEGIN
  INSERT INTO commitment_events
         (event, commitment_id, collector_id, pledged_minutes, delivered_minutes)
  SELECT NEW.state,
         NEW.id,
         cl.collector_id,
         commitment_pledged_minutes(NEW.pledged_hours_per_week, NEW.started_on, NEW.ends_on),
         commitment_delivered_minutes(NEW.id)
    FROM task_claims cl
   WHERE cl.id = NEW.claim_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_commitments_emit_event
  AFTER UPDATE OF state ON task_commitments
  FOR EACH ROW WHEN (OLD.state = 'active' AND NEW.state <> 'active')
  EXECUTE FUNCTION task_commitments_emit_event();
--> statement-breakpoint
-- A claim on a task that asks for a commitment must carry one.
--
-- Deferred, because the contract cannot exist before the claim it references:
-- both rows are written in one transaction and this is checked at COMMIT, when
-- the pair is either complete or it is not. A BEFORE INSERT trigger would have
-- to refuse every claim, including the correct ones.
--
-- This is the server-side half of "a claim without terms is refused". The route
-- validates the body; this refuses the claim however it arrived.
CREATE OR REPLACE FUNCTION task_claims_commitment_required() RETURNS trigger AS $$
DECLARE has_terms boolean;
BEGIN
  SELECT commitment_weeks IS NOT NULL INTO has_terms FROM tasks WHERE id = NEW.task_id;
  IF NOT coalesce(has_terms, false) THEN RETURN NULL; END IF;

  PERFORM 1 FROM task_commitments WHERE claim_id = NEW.id AND state = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_claims_commitment_required: task % asks for a time commitment and claim % pledged none',
      NEW.task_id, NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_commitment_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER task_claims_commitment_required
  AFTER INSERT ON task_claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION task_claims_commitment_required();
--> statement-breakpoint
-- Un-releasing a claim is claiming it again, so it needs a live pledge for the
-- same reason `task_claims_guard_reclaim` re-runs the eligibility gates.
CREATE CONSTRAINT TRIGGER task_claims_commitment_required_reclaim
  AFTER UPDATE ON task_claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.released_at IS NOT NULL AND NEW.released_at IS NULL)
  EXECUTE FUNCTION task_claims_commitment_required();
--> statement-breakpoint
-- The other direction: a claim carrying a live contract cannot be released out
-- from under it. Otherwise the collector keeps a contract nobody is holding a
-- slot for, and the contract's own timing rules — the quarter window, the "not
-- before the window ends" rule — are bypassable by releasing the claim instead.
--
-- Closing the contract first, in the same transaction, is what the commitment
-- route does; by the time it releases the claim there is no active contract
-- left for this to see. So this refuses exactly the wrong order and nothing
-- else.
CREATE OR REPLACE FUNCTION task_claims_commitment_open() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM task_commitments WHERE claim_id = NEW.id AND state = 'active';
  IF FOUND THEN
    RAISE EXCEPTION 'task_claims_commitment_open: claim % still holds an active commitment; close that first',
      NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'task_claims_commitment_open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER task_claims_commitment_open
  BEFORE UPDATE ON task_claims
  FOR EACH ROW WHEN (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL)
  EXECUTE FUNCTION task_claims_commitment_open();
