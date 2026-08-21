ALTER TABLE "collection_point_alt_centres" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "collection_point_alt_centres" CASCADE;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD COLUMN "handover_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_sessions_handover_idx" ON "collection_sessions" USING btree ("handover_id");--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_handover_required_check" CHECK ("collection_sessions"."session_origin" <> 'handover' or "collection_sessions"."handover_id" is not null);