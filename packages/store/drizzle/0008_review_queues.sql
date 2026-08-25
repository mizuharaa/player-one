DROP INDEX "episode_reviews_queue_idx";--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "queue" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "assignee_ref" text;--> statement-breakpoint
CREATE INDEX "episode_reviews_queue_idx" ON "episode_reviews" USING btree ("review_state","queue","priority" DESC NULLS LAST,"created_at");--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_queue_check" CHECK ("episode_reviews"."queue" in ('standard', 'privacy'));--> statement-breakpoint
-- QR-07 backfill. Without this an episode already waiting in the queue whose
-- collector declared others in frame or sensitive information would stay in the
-- standard lane, which is the one thing QR-07 forbids. New rows get their lane
-- at claim time; these are the ones that already exist.
UPDATE "episode_reviews" r
   SET "queue" = 'privacy'
  FROM "episodes" e
  JOIN "collection_sessions" s ON s."id" = e."collection_session_id"
 WHERE e."episode_id" = r."episode_id"
   AND (s."others_in_frame" OR s."sensitive_info_present");
