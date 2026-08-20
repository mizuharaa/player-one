CREATE TABLE "episode_defects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ingest_id" uuid NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"payload" jsonb,
	CONSTRAINT "episode_defects_severity_check" CHECK ("episode_defects"."severity" in ('info', 'flag', 'quarantine'))
);
--> statement-breakpoint
CREATE TABLE "episode_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ingest_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_ingests" (
	"ingest_id" uuid PRIMARY KEY NOT NULL,
	"episode_id" uuid NOT NULL,
	"content_fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"source_basename" text NOT NULL,
	"declared_duration_s" numeric(20, 6),
	"measured_duration_s" numeric(20, 6) NOT NULL,
	"timing_source" text NOT NULL,
	"timing_confidence" text NOT NULL,
	"stream_skew_ms" numeric(20, 3),
	"device_firmware" text,
	"calibration_serial" text,
	"manifest_present" boolean NOT NULL,
	"engine_version" text NOT NULL,
	"host" text NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	"record_json" jsonb NOT NULL,
	CONSTRAINT "episode_ingests_state_check" CHECK ("episode_ingests"."state" in ('ok', 'flagged', 'quarantined')),
	CONSTRAINT "episode_ingests_timing_source_check" CHECK ("episode_ingests"."timing_source" in ('pts_sidecar', 'container', 'imu_span', 'wall_clock')),
	CONSTRAINT "episode_ingests_timing_confidence_check" CHECK ("episode_ingests"."timing_confidence" in ('exact', 'derived', 'estimated'))
);
--> statement-breakpoint
CREATE TABLE "episode_streams" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ingest_id" uuid NOT NULL,
	"stream_name" text NOT NULL,
	"sample_count" bigint NOT NULL,
	"duration_s" numeric(20, 6) NOT NULL,
	"timing_source" text NOT NULL,
	"first_timestamp_us" numeric(20, 0),
	"last_timestamp_us" numeric(20, 0),
	"excluded" boolean DEFAULT false NOT NULL,
	"exclusion_reason" text
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"episode_id" uuid PRIMARY KEY NOT NULL,
	"device_serial" text NOT NULL,
	"session_started_at" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"latest_ingest_id" uuid,
	"ingest_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_defects" ADD CONSTRAINT "episode_defects_ingest_id_episode_ingests_ingest_id_fk" FOREIGN KEY ("ingest_id") REFERENCES "public"."episode_ingests"("ingest_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_files" ADD CONSTRAINT "episode_files_ingest_id_episode_ingests_ingest_id_fk" FOREIGN KEY ("ingest_id") REFERENCES "public"."episode_ingests"("ingest_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_ingests" ADD CONSTRAINT "episode_ingests_episode_id_episodes_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("episode_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_streams" ADD CONSTRAINT "episode_streams_ingest_id_episode_ingests_ingest_id_fk" FOREIGN KEY ("ingest_id") REFERENCES "public"."episode_ingests"("ingest_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_latest_ingest_id_episode_ingests_ingest_id_fk" FOREIGN KEY ("latest_ingest_id") REFERENCES "public"."episode_ingests"("ingest_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_defects_ingest_idx" ON "episode_defects" USING btree ("ingest_id");--> statement-breakpoint
CREATE INDEX "episode_files_ingest_idx" ON "episode_files" USING btree ("ingest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_files_ingest_path_key" ON "episode_files" USING btree ("ingest_id","relative_path");--> statement-breakpoint
CREATE INDEX "episode_ingests_episode_idx" ON "episode_ingests" USING btree ("episode_id","ingested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "episode_ingests_fingerprint_idx" ON "episode_ingests" USING btree ("content_fingerprint");--> statement-breakpoint
CREATE INDEX "episode_streams_ingest_idx" ON "episode_streams" USING btree ("ingest_id");