-- QR-08: dispute and second review.
--
-- A dispute is an append-only row against a DECIDED review. Raising one moves
-- nothing in money: it writes the dispute, and it materialises a second,
-- pending review row for the same delivery in a lane of its own
-- (`queue = 'second_review'`) that the original reviewer is never offered.
-- The second verdict is an ordinary verdict on that row. If it agrees with
-- the first, the dispute closes `upheld` and the original settlement stands.
-- If it differs, the original settlement goes to `exception` with
-- `superseded_by` naming the settlement the second verdict wrote, and that
-- new settlement is what gets billed — exactly once, through the same
-- `settlements_review_key` that already stops a retry paying twice.
--
-- Hand-written, no snapshot, like 0011 and 0012. drizzle cannot declare a
-- trigger or a partial unique index's predicate; schema.ts points here.
--
-- What moved: `episode_reviews_delivery_key` was one review per delivery,
-- full stop. It is now one NON-DISPUTE review per delivery; the second review
-- is keyed on the dispute instead (`episode_reviews_dispute_key`). Nothing
-- else about the claim changed — the `on conflict` targets in review.ts
-- carry the index predicate, and a claim still loses on this index and not on
-- application logic.
--
-- `exception` is SET-05's own state, and 0005 allows `exception ->
-- pending_settlement` as the way back for a human. A superseded settlement
-- must not have that way back — it would be a second payment for one
-- delivery — so `settlements_supersede_guard` pins a row with `superseded_by`
-- set to `exception`, and `bill_lines_dispute_guard` refuses it a bill line
-- regardless of state.

CREATE TABLE "review_disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "review_disputes_reason_check" CHECK (length(btrim("review_disputes"."reason")) > 0),
	CONSTRAINT "review_disputes_outcome_check" CHECK ("review_disputes"."outcome" is null or "review_disputes"."outcome" in ('upheld', 'overturned')),
	CONSTRAINT "review_disputes_resolved_check" CHECK (("review_disputes"."resolved_at" is null) = ("review_disputes"."outcome" is null))
);
--> statement-breakpoint
ALTER TABLE "review_disputes" ADD CONSTRAINT "review_disputes_review_id_episode_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."episode_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_disputes" ADD CONSTRAINT "review_disputes_raised_by_operators_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One OPEN dispute per review. A closed one is history and stays.
CREATE UNIQUE INDEX "review_disputes_open_key" ON "review_disputes" USING btree ("review_id") WHERE "resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_disputes_review_idx" ON "review_disputes" USING btree ("review_id");--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "dispute_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_dispute_id_review_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."review_disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One second review per dispute.
CREATE UNIQUE INDEX "episode_reviews_dispute_key" ON "episode_reviews" USING btree ("dispute_id");--> statement-breakpoint
DROP INDEX "episode_reviews_delivery_key";--> statement-breakpoint
CREATE UNIQUE INDEX "episode_reviews_delivery_key" ON "episode_reviews" USING btree ("episode_id","ingest_id") WHERE "dispute_id" IS NULL;--> statement-breakpoint
ALTER TABLE "episode_reviews" DROP CONSTRAINT "episode_reviews_queue_check";--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_queue_check" CHECK ("episode_reviews"."queue" in ('standard', 'privacy', 'second_review'));--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_superseded_by_settlements_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A settlement supersedes at most one other.
CREATE UNIQUE INDEX "settlements_superseded_by_key" ON "settlements" USING btree ("superseded_by");--> statement-breakpoint
-- What a dispute may be raised against, and that it is never edited or removed.
CREATE FUNCTION review_disputes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  the_state text;
  the_dispute uuid;
  owed_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'review_disputes_append_only: a dispute is never deleted'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_append_only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- The only write after the insert is closing it, once.
    IF OLD.resolved_at IS NOT NULL
       OR NEW.review_id <> OLD.review_id
       OR NEW.raised_by <> OLD.raised_by
       OR NEW.reason <> OLD.reason
       OR NEW.raised_at <> OLD.raised_at THEN
      RAISE EXCEPTION 'review_disputes_append_only: dispute % is written once and closed once', OLD.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_append_only';
    END IF;
    RETURN NEW;
  END IF;

  SELECT review_state, dispute_id INTO the_state, the_dispute
    FROM episode_reviews WHERE id = NEW.review_id;
  -- No such review: the foreign key says so, after this trigger.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF the_state = 'pending' THEN
    RAISE EXCEPTION 'review_disputes_decided_check: review % has not been decided, so there is no outcome to challenge', NEW.review_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_decided_check';
  END IF;
  -- A second review is the last word. Disputing it would be a third review,
  -- and the brief has no such thing.
  IF the_dispute IS NOT NULL THEN
    RAISE EXCEPTION 'review_disputes_final_check: review % is itself a second review and cannot be disputed', NEW.review_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_final_check';
  END IF;
  -- A bill is never revised (docs/review.md). Until it can be, a settlement
  -- already on one — or paid — cannot be reopened.
  --
  -- `FOR UPDATE`, for the same reason 0006's claim guard locks the task row.
  -- READ COMMITTED answers a plain SELECT from a statement snapshot, so a bill
  -- generation that had already written `bill_generated` but not yet committed
  -- was invisible here and the dispute was accepted against a row being billed.
  -- The lock makes the two serialise: whichever arrives second waits, then
  -- reads what the first actually did. The generator takes the same lock before
  -- it writes a bill line (settle.ts), so the wait happens in both orders.
  SELECT settlement_state INTO owed_state
    FROM settlements WHERE episode_review_id = NEW.review_id
     FOR UPDATE;
  IF owed_state IS DISTINCT FROM 'pending_settlement' THEN
    RAISE EXCEPTION 'review_disputes_unbilled_check: the settlement for review % is %, and only a settlement still waiting to be billed can be disputed', NEW.review_id, coalesce(owed_state, 'absent')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'review_disputes_unbilled_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER review_disputes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON review_disputes
  FOR EACH ROW EXECUTE FUNCTION review_disputes_guard();
--> statement-breakpoint
-- A second review names an open dispute, judges the same delivery, and is
-- never held by the reviewer whose verdict is being challenged.
CREATE FUNCTION episode_reviews_dispute_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  first_reviewer uuid;
  first_episode uuid;
  first_ingest uuid;
  closed timestamp with time zone;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.dispute_id IS DISTINCT FROM OLD.dispute_id THEN
    RAISE EXCEPTION 'episode_reviews_dispute_immutable: which dispute a review answers is written once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_reviews_dispute_immutable';
  END IF;
  IF NEW.dispute_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.reviewer_ref, r.episode_id, r.ingest_id, d.resolved_at
    INTO first_reviewer, first_episode, first_ingest, closed
    FROM review_disputes d JOIN episode_reviews r ON r.id = d.review_id
   WHERE d.id = NEW.dispute_id;
  IF TG_OP = 'INSERT' AND closed IS NOT NULL THEN
    RAISE EXCEPTION 'episode_reviews_dispute_open_check: dispute % is closed; a second review answers an open one', NEW.dispute_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_reviews_dispute_open_check';
  END IF;
  IF NEW.episode_id <> first_episode OR NEW.ingest_id <> first_ingest THEN
    RAISE EXCEPTION 'episode_reviews_dispute_delivery_check: a second review judges the delivery the dispute is about'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_reviews_dispute_delivery_check';
  END IF;
  IF NEW.reviewer_ref IS NOT NULL AND NEW.reviewer_ref = first_reviewer THEN
    RAISE EXCEPTION 'episode_reviews_second_reviewer_check: reviewer % gave the verdict under dispute and cannot give the second one', NEW.reviewer_ref
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_reviews_second_reviewer_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER episode_reviews_dispute_guard
  BEFORE INSERT OR UPDATE ON episode_reviews
  FOR EACH ROW EXECUTE FUNCTION episode_reviews_dispute_guard();
--> statement-breakpoint
-- A superseded settlement is written once and parked in `exception` for good:
-- 0005's `exception -> pending_settlement` edge is for a human returning a row
-- to the queue, and this row must never return.
--
-- `BEFORE INSERT OR UPDATE`, not update only. On update alone a row could be
-- BORN with `superseded_by` set and a state that is not `exception`: 0005's
-- transition guard admits `pending_settlement` at insert and knows nothing
-- about supersession, so nothing refused it. The immutability half stays an
-- update-only rule because there is no OLD row at insert.
CREATE FUNCTION settlements_supersede_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
    RAISE EXCEPTION 'settlements_superseded_immutable: settlement % is already superseded by %', OLD.id, OLD.superseded_by
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_superseded_immutable';
  END IF;
  IF NEW.superseded_by IS NOT NULL AND NEW.settlement_state <> 'exception' THEN
    RAISE EXCEPTION 'settlements_superseded_state_check: a superseded settlement stays in exception, not %', NEW.settlement_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_superseded_state_check';
  END IF;
  IF NEW.superseded_by = NEW.id THEN
    RAISE EXCEPTION 'settlements_superseded_state_check: a settlement cannot supersede itself'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_superseded_state_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER settlements_supersede_guard
  BEFORE INSERT OR UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_supersede_guard();
--> statement-breakpoint
-- Neither a disputed settlement nor a superseded one reaches a bill. The
-- generator filters both out; this is the half a generator cannot skip.
CREATE FUNCTION bill_lines_dispute_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  the_review uuid;
  replaced uuid;
BEGIN
  SELECT episode_review_id, superseded_by INTO the_review, replaced
    FROM settlements WHERE id = NEW.settlement_id;
  IF replaced IS NOT NULL THEN
    RAISE EXCEPTION 'bill_lines_superseded_check: settlement % was superseded by % and is not billable', NEW.settlement_id, replaced
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_superseded_check';
  END IF;
  IF EXISTS (SELECT 1 FROM review_disputes WHERE review_id = the_review AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'bill_lines_disputed_check: settlement % is under dispute and is not billable until it closes', NEW.settlement_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_disputed_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bill_lines_dispute_guard
  BEFORE INSERT OR UPDATE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION bill_lines_dispute_guard();
