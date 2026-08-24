CREATE TABLE "episode_review_spans" (
	"review_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"start_s" numeric(20, 6) NOT NULL,
	"end_s" numeric(20, 6) NOT NULL,
	CONSTRAINT "episode_review_spans_review_id_ordinal_pk" PRIMARY KEY("review_id","ordinal"),
	CONSTRAINT "episode_review_spans_start_nonneg_check" CHECK ("episode_review_spans"."start_s" >= 0),
	CONSTRAINT "episode_review_spans_ordered_check" CHECK ("episode_review_spans"."end_s" > "episode_review_spans"."start_s")
);
--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "verdict_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "reviewer_note" text;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD COLUMN "time_to_verdict_s" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "episode_review_spans" ADD CONSTRAINT "episode_review_spans_review_id_episode_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."episode_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_reviews_delivery_key" ON "episode_reviews" USING btree ("episode_id","ingest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_reviews_verdict_key" ON "episode_reviews" USING btree ("verdict_id");--> statement-breakpoint
CREATE INDEX "episode_reviews_queue_idx" ON "episode_reviews" USING btree ("review_state","lease_expires_at","created_at");--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_verdict_id_check" CHECK ("episode_reviews"."review_state" = 'pending' or "episode_reviews"."verdict_id" is not null);--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_lease_check" CHECK ("episode_reviews"."reviewer_ref" is null
          or ("episode_reviews"."claimed_at" is not null and "episode_reviews"."lease_expires_at" is not null));