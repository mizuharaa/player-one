ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_attributed_check";--> statement-breakpoint
-- Hand-edited: drizzle emits the type change with no USING clause, and
-- Postgres has no assignment cast from text to uuid, so it fails as generated.
ALTER TABLE "episode_reviews" ALTER COLUMN "reviewer_ref" SET DATA TYPE uuid USING "reviewer_ref"::uuid;--> statement-breakpoint
ALTER TABLE "operators" ALTER COLUMN "upload_centre_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_role" text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_reviewer_ref_operators_id_fk" FOREIGN KEY ("reviewer_ref") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operators_reviewer_ref_key" ON "operators" USING btree ("external_ref") WHERE role = 'reviewer';--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_role_check" CHECK ("audit_events"."actor_role" in ('operator', 'reviewer'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_attributed_check" CHECK ("audit_events"."action" like '%.login'
          or ("audit_events"."actor_role" = 'reviewer'
              and "audit_events"."operator_id" is not null
              and "audit_events"."upload_device_id" is null
              and "audit_events"."upload_centre_id" is null)
          or ("audit_events"."actor_role" = 'operator'
              and "audit_events"."operator_id" is not null
              and "audit_events"."upload_device_id" is not null
              and "audit_events"."upload_centre_id" is not null));--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_centre_check" CHECK ("operators"."upload_centre_id" is not null or "operators"."role" = 'reviewer');