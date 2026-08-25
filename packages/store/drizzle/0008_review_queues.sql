DROP INDEX "episode_reviews_queue_idx";--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "queue" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "assignee_ref" uuid;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_assignee_ref_operators_id_fk" FOREIGN KEY ("assignee_ref") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_reviews_queue_idx" ON "episode_reviews" USING btree ("review_state","queue","priority" DESC NULLS LAST,"created_at");--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_queue_check" CHECK ("episode_reviews"."queue" in ('standard', 'privacy'));--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_priority_range_check" CHECK ("episode_reviews"."priority" between -1000 and 1000);--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_time_to_verdict_check" CHECK ("episode_reviews"."time_to_verdict_s" is null or "episode_reviews"."time_to_verdict_s" >= 0);--> statement-breakpoint
-- QR-07 backfill. Without this an episode already waiting in the queue whose
-- collector declared others in frame or sensitive information would stay in the
-- standard lane, which is the one thing QR-07 forbids. New rows get their lane
-- at claim time; these are the ones that already exist. `assignee_ref` is added
-- by this same migration, so no existing row can carry one.
--
-- The lease goes with the move, in the same statement. A pending review that
-- changes lane while somebody still holds it is footage a reviewer with no
-- privacy clearance can go on to heartbeat and decide — the lane would be right
-- and the person watching would be the same one, which is the migration doing
-- half its job. Clearing the claim hands it back to whoever the lane is for.
--
-- Pending rows only. On a decided review `reviewer_ref` is who decided it, not
-- a lease, and blanking that would erase the attribution on a payment; a
-- decided row is in no lane anyway, because every queue read filters on pending.
UPDATE "episode_reviews" r
   SET "queue" = 'privacy',
       "reviewer_ref" = NULL,
       "claimed_at" = NULL,
       "lease_expires_at" = NULL,
       "updated_at" = now()
  FROM "episodes" e
  JOIN "collection_sessions" s ON s."id" = e."collection_session_id"
 WHERE e."episode_id" = r."episode_id"
   AND r."review_state" = 'pending'
   AND (s."others_in_frame" OR s."sensitive_info_present");
