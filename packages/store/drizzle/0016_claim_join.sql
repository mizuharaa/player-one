-- The claims -> sessions -> settlements join.
--
-- Until this migration a settlement was reachable from a task claim by nothing
-- at all. A session named a task and a collector, and the counter took both on
-- trust; the verdict read `tasks.unit_price` at the moment it committed. So
-- footage recorded by a collector who never claimed the task — or whose claim
-- had been released — resolved, was reviewed, and was paid, and the claim the
-- back office issued (APP-10, BO-02) decided nothing.
--
-- Three changes, all shapes rather than procedure:
--
--   1. A session carries the claim it was recorded under, plus a snapshot of
--      the unit price and the currency at that moment. The FK is composite —
--      (claim, task, collector) — so a session cannot name a claim that belongs
--      to another collector or another task: the pairing is checked by the
--      database, not by the route that happened to write it.
--   2. A settlement names the claim too, again through a composite FK on
--      (claim, task), and `settlements_claim_guard` refuses a NEW settlement
--      with no claim or with a claim that is not the reviewed session's.
--   3. The verdict (review.ts) takes the price from the session's snapshot and
--      not from `tasks`, so a task edited later — or repriced under SET-09 —
--      cannot change what an existing recording earns.
--
-- BACKFILL: NONE. Deliberately.
--   Every column here is nullable and no claim is invented for a session that
--   has none. On every database this migration has been run against there are
--   zero such sessions (measured: the org PC's databases are all test and
--   smoke databases; the five real pilot sessions live in docs/sample_data and
--   have never been declared at a counter). If a deployment does hold sessions
--   from before this migration, a verdict on their footage is refused with
--   `session_claim_missing` rather than paid at a guessed price, and the path
--   is for the back office to issue the claim the collector actually held and
--   then set it on the session by hand:
--
--     UPDATE collection_sessions
--        SET task_claim_id = '<claim>', unit_price = <price>, currency = 'VND'
--      WHERE id = '<session>';
--
--   That is a decision somebody signs, not a side effect of a migration.

-- The targets of the two composite keys. `id` is already the primary key, so
-- neither adds a uniqueness that did not exist; they exist to let the FKs
-- below say "this claim, AND it is for this task and this collector".
ALTER TABLE "task_claims" ADD CONSTRAINT "task_claims_task_key" UNIQUE ("id", "task_id");--> statement-breakpoint
ALTER TABLE "task_claims" ADD CONSTRAINT "task_claims_pairing_key" UNIQUE ("id", "task_id", "collector_id");--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD COLUMN "task_claim_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD COLUMN "unit_price" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_claim_fk" FOREIGN KEY ("task_claim_id","task_id","collector_id") REFERENCES "public"."task_claims"("id","task_id","collector_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A claim without its price, or a price without its claim, is half a record.
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_claim_snapshot_check" CHECK (("collection_sessions"."task_claim_id" is null) = ("collection_sessions"."unit_price" is null) and ("collection_sessions"."task_claim_id" is null) = ("collection_sessions"."currency" is null));--> statement-breakpoint
CREATE INDEX "collection_sessions_claim_idx" ON "collection_sessions" USING btree ("task_claim_id");--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "task_claim_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_claim_fk" FOREIGN KEY ("task_claim_id","task_id") REFERENCES "public"."task_claims"("id","task_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlements_claim_idx" ON "settlements" USING btree ("task_claim_id");--> statement-breakpoint
-- A settlement is born naming the claim the footage was recorded under, and
-- that claim is the reviewed session's — not any claim on the same task. A
-- BEFORE INSERT check rather than a NOT NULL, so rows from before this
-- migration keep walking their lifecycle (an UPDATE never trips it) while no
-- new row can be written without one. On UPDATE the claim is frozen, alongside
-- the price and the amount `settlements_transition_guard` already freezes.
CREATE OR REPLACE FUNCTION settlements_claim_guard() RETURNS trigger AS $$
DECLARE owning uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.task_claim_id IS DISTINCT FROM OLD.task_claim_id THEN
      RAISE EXCEPTION 'settlements_claim_immutable: which claim settlement % was paid under is written once', OLD.id
        USING ERRCODE = '23514', CONSTRAINT = 'settlements_claim_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.task_claim_id IS NULL THEN
    RAISE EXCEPTION 'settlements_claim_required: settlement % names no task claim, so nobody was entitled to record what it pays for', NEW.id
      USING ERRCODE = '23514', CONSTRAINT = 'settlements_claim_required';
  END IF;

  SELECT cs.task_claim_id INTO owning
    FROM episode_reviews r
    JOIN episodes e ON e.episode_id = r.episode_id
    JOIN collection_sessions cs ON cs.id = e.collection_session_id
   WHERE r.id = NEW.episode_review_id;
  IF owning IS DISTINCT FROM NEW.task_claim_id THEN
    RAISE EXCEPTION 'settlements_claim_matches_session: settlement % names claim % but the reviewed footage was recorded under %',
      NEW.id, NEW.task_claim_id, owning
      USING ERRCODE = '23514', CONSTRAINT = 'settlements_claim_matches_session';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER settlements_claim_guard
  BEFORE INSERT OR UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_claim_guard();
