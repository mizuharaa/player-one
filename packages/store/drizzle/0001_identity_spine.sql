CREATE TABLE "collection_point_alt_centres" (
	"collection_point_id" uuid NOT NULL,
	"upload_centre_id" uuid NOT NULL,
	CONSTRAINT "cp_alt_centres_pk" PRIMARY KEY("collection_point_id","upload_centre_id")
);
--> statement-breakpoint
CREATE TABLE "collection_points" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"country" text,
	"city" text,
	"region" text,
	"scenario_id" uuid,
	"site_owner" text,
	"network_type" text,
	"operator" text,
	"uplink_mbps" numeric(10, 3),
	"grade" text,
	"centralised_upload_available" boolean,
	"default_upload_centre_id" uuid,
	"charging_available" boolean,
	"sensitive_info_involved" boolean,
	"authorisation_status" text DEFAULT 'pending' NOT NULL,
	"responsible_person" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_points_authorisation_check" CHECK ("collection_points"."authorisation_status" in ('pending', 'approved', 'refused', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "collection_session_devices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"collection_session_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"collection_point_id" uuid,
	"others_in_frame" boolean NOT NULL,
	"sensitive_info_present" boolean NOT NULL,
	"session_origin" text NOT NULL,
	"prepare_time" timestamp with time zone,
	"created_by" text,
	"client_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_sessions_origin_check" CHECK ("collection_sessions"."session_origin" in ('handover', 'app', 'backoffice'))
);
--> statement-breakpoint
CREATE TABLE "collectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_ref" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collectors_status_check" CHECK ("collectors"."status" in ('pending', 'qualified', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "defect_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"blocks_review" boolean NOT NULL,
	"suppresses_settlement" boolean NOT NULL,
	"description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"generation" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_type_id" uuid NOT NULL,
	"hardware_serial" text NOT NULL,
	"firmware_version" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_status_check" CHECK ("devices"."status" in ('active', 'faulty', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "episode_review_reasons" (
	"review_id" uuid NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "episode_review_reasons_review_id_code_pk" PRIMARY KEY("review_id","code")
);
--> statement-breakpoint
CREATE TABLE "episode_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"episode_id" uuid NOT NULL,
	"ingest_id" uuid NOT NULL,
	"measured_duration_s" numeric(20, 6) NOT NULL,
	"effective_duration_s" numeric(20, 6),
	"review_state" text NOT NULL,
	"reviewer_ref" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_reviews_state_check" CHECK ("episode_reviews"."review_state" in ('pending', 'pass', 'partial_pass', 'fail')),
	CONSTRAINT "episode_reviews_effective_le_measured_check" CHECK ("episode_reviews"."effective_duration_s" is null or "episode_reviews"."effective_duration_s" <= "episode_reviews"."measured_duration_s"),
	CONSTRAINT "episode_reviews_effective_nonneg_check" CHECK ("episode_reviews"."effective_duration_s" is null or "episode_reviews"."effective_duration_s" >= 0),
	CONSTRAINT "episode_reviews_fail_is_zero_check" CHECK ("episode_reviews"."review_state" <> 'fail' or "episode_reviews"."effective_duration_s" = 0),
	CONSTRAINT "episode_reviews_decided_check" CHECK ("episode_reviews"."review_state" = 'pending' or ("episode_reviews"."reviewed_at" is not null and "episode_reviews"."effective_duration_s" is not null))
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"tf_card_id" text NOT NULL,
	"upload_centre_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"handover_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_centre_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reason_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"label_en" text NOT NULL,
	"label_vi" text,
	"label_zh" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"privacy_risk_level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenarios_privacy_risk_check" CHECK ("scenarios"."privacy_risk_level" in ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"episode_review_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"effective_minutes" numeric(20, 6) NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"settlement_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_state_check" CHECK ("settlements"."settlement_state" in ('pending_review', 'pending_settlement', 'bill_generated', 'manually_paid', 'exception')),
	CONSTRAINT "settlements_amount_nonneg_check" CHECK ("settlements"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"target_effective_duration_s" numeric(20, 6),
	"max_concurrent_claimants" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('draft', 'published', 'taken_down')),
	CONSTRAINT "tasks_claimants_check" CHECK ("tasks"."max_concurrent_claimants" > 0)
);
--> statement-breakpoint
CREATE TABLE "upload_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handover_id" uuid NOT NULL,
	"upload_device_id" uuid NOT NULL,
	"import_started_at" timestamp with time zone NOT NULL,
	"import_completed_at" timestamp with time zone,
	"cloud_verified_at" timestamp with time zone,
	"local_cache_cleaned_at" timestamp with time zone,
	"file_count" integer,
	"total_size_bytes" bigint,
	"batch_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_batches_status_check" CHECK ("upload_batches"."batch_status" in ('importing', 'imported', 'uploading', 'verifying', 'verified', 'closed', 'failed')),
	CONSTRAINT "upload_batches_cache_after_verify_check" CHECK ("upload_batches"."local_cache_cleaned_at" is null or ("upload_batches"."cloud_verified_at" is not null and "upload_batches"."local_cache_cleaned_at" >= "upload_batches"."cloud_verified_at"))
);
--> statement-breakpoint
CREATE TABLE "upload_centres" (
	"id" uuid PRIMARY KEY NOT NULL,
	"region" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_centres_status_check" CHECK ("upload_centres"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "upload_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_centre_id" uuid NOT NULL,
	"machine_identifier" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_devices_status_check" CHECK ("upload_devices"."status" in ('active', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "collection_session_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "upload_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "resolution_state" text DEFAULT 'quarantined' NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "upload_path" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "verification_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_point_alt_centres" ADD CONSTRAINT "cp_alt_centres_point_fk" FOREIGN KEY ("collection_point_id") REFERENCES "public"."collection_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_point_alt_centres" ADD CONSTRAINT "cp_alt_centres_centre_fk" FOREIGN KEY ("upload_centre_id") REFERENCES "public"."upload_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_points" ADD CONSTRAINT "collection_points_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_points" ADD CONSTRAINT "collection_points_default_upload_centre_id_upload_centres_id_fk" FOREIGN KEY ("default_upload_centre_id") REFERENCES "public"."upload_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_session_devices" ADD CONSTRAINT "collection_session_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_session_devices" ADD CONSTRAINT "csd_session_fk" FOREIGN KEY ("collection_session_id") REFERENCES "public"."collection_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_sessions" ADD CONSTRAINT "collection_sessions_collection_point_id_collection_points_id_fk" FOREIGN KEY ("collection_point_id") REFERENCES "public"."collection_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_device_type_id_device_types_id_fk" FOREIGN KEY ("device_type_id") REFERENCES "public"."device_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_review_reasons" ADD CONSTRAINT "episode_review_reasons_review_id_episode_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."episode_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_review_reasons" ADD CONSTRAINT "episode_review_reasons_code_review_reason_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."review_reason_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_episode_id_episodes_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("episode_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- HAND-ORDERED: drizzle emits every foreign key before any other ALTER,
-- but this UNIQUE is the target of episode_reviews_ingest_fk and Postgres
-- rejects a composite FK whose target has no matching unique constraint.
-- Moved ahead of that FK. Regenerating does not rewrite this file.
ALTER TABLE "episode_ingests" ADD CONSTRAINT "episode_ingests_review_target_key" UNIQUE("episode_id","ingest_id","measured_duration_s");--> statement-breakpoint
ALTER TABLE "episode_reviews" ADD CONSTRAINT "episode_reviews_ingest_fk" FOREIGN KEY ("episode_id","ingest_id","measured_duration_s") REFERENCES "public"."episode_ingests"("episode_id","ingest_id","measured_duration_s") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_upload_centre_id_upload_centres_id_fk" FOREIGN KEY ("upload_centre_id") REFERENCES "public"."upload_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_upload_centre_id_upload_centres_id_fk" FOREIGN KEY ("upload_centre_id") REFERENCES "public"."upload_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_episode_review_id_episode_reviews_id_fk" FOREIGN KEY ("episode_review_id") REFERENCES "public"."episode_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_upload_device_id_upload_devices_id_fk" FOREIGN KEY ("upload_device_id") REFERENCES "public"."upload_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_devices" ADD CONSTRAINT "upload_devices_upload_centre_id_upload_centres_id_fk" FOREIGN KEY ("upload_centre_id") REFERENCES "public"."upload_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_points_site_id_key" ON "collection_points" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_session_devices_role_key" ON "collection_session_devices" USING btree ("collection_session_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_session_devices_phase1_one_per_session" ON "collection_session_devices" USING btree ("collection_session_id");--> statement-breakpoint
CREATE INDEX "collection_sessions_collector_idx" ON "collection_sessions" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "collection_sessions_task_idx" ON "collection_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collectors_external_ref_key" ON "collectors" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "defect_codes_blocking_idx" ON "defect_codes" USING btree ("blocks_review");--> statement-breakpoint
CREATE UNIQUE INDEX "device_types_code_key" ON "device_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_hardware_serial_key" ON "devices" USING btree ("hardware_serial");--> statement-breakpoint
CREATE INDEX "episode_reviews_episode_idx" ON "episode_reviews" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "handovers_collector_idx" ON "handovers" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "handovers_card_idx" ON "handovers" USING btree ("tf_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_ref_key" ON "operators" USING btree ("upload_centre_id","external_ref");--> statement-breakpoint
CREATE INDEX "review_reason_codes_category_idx" ON "review_reason_codes" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_code_key" ON "scenarios" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_review_key" ON "settlements" USING btree ("episode_review_id");--> statement-breakpoint
CREATE INDEX "upload_batches_handover_idx" ON "upload_batches" USING btree ("handover_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_devices_machine_key" ON "upload_devices" USING btree ("upload_centre_id","machine_identifier");--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_collection_session_id_collection_sessions_id_fk" FOREIGN KEY ("collection_session_id") REFERENCES "public"."collection_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_upload_batch_id_upload_batches_id_fk" FOREIGN KEY ("upload_batch_id") REFERENCES "public"."upload_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episodes_session_idx" ON "episodes" USING btree ("collection_session_id");--> statement-breakpoint
CREATE INDEX "episodes_batch_idx" ON "episodes" USING btree ("upload_batch_id");--> statement-breakpoint
CREATE INDEX "episodes_resolution_idx" ON "episodes" USING btree ("resolution_state");--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_resolution_check" CHECK (("episodes"."resolution_state" = 'resolved' and "episodes"."collection_session_id" is not null)
          or ("episodes"."resolution_state" = 'quarantined' and "episodes"."collection_session_id" is null));--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_upload_path_check" CHECK ("episodes"."upload_path" is null or "episodes"."upload_path" in ('A', 'B', 'C'));--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_verification_check" CHECK ("episodes"."verification_state" in ('pending', 'verified', 'failed'));