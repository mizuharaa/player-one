CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" text NOT NULL,
	"operator_id" uuid,
	"upload_device_id" uuid,
	"upload_centre_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	CONSTRAINT "audit_events_attributed_check" CHECK ("audit_events"."action" like '%.login'
          or ("audit_events"."operator_id" is not null and "audit_events"."upload_device_id" is not null)),
	CONSTRAINT "audit_events_manual_reason_check" CHECK ("audit_events"."action" <> 'episode.resolve_manual' or "audit_events"."reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "upload_device_status" (
	"upload_device_id" uuid PRIMARY KEY NOT NULL,
	"network_state" text,
	"disk_free_bytes" bigint,
	"card_reader_state" text,
	"queue_depth" integer,
	"client_version" text,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "resolution_method" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "resolution_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "credential_hash" text;--> statement-breakpoint
ALTER TABLE "upload_devices" ADD COLUMN "credential_hash" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_upload_device_id_upload_devices_id_fk" FOREIGN KEY ("upload_device_id") REFERENCES "public"."upload_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_upload_centre_id_upload_centres_id_fk" FOREIGN KEY ("upload_centre_id") REFERENCES "public"."upload_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_device_status" ADD CONSTRAINT "upload_device_status_upload_device_id_upload_devices_id_fk" FOREIGN KEY ("upload_device_id") REFERENCES "public"."upload_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_table","target_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_operator_idx" ON "audit_events" USING btree ("operator_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_resolution_method_check" CHECK ("episodes"."resolution_method" is null
          or "episodes"."resolution_method" in ('automatic_single', 'automatic_time_window', 'manual'));--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_method_requires_resolved_check" CHECK ("episodes"."resolution_method" is null or "episodes"."resolution_state" = 'resolved');--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_confirm_only_automatic_check" CHECK ("episodes"."resolution_confirmed_at" is null
          or "episodes"."resolution_method" in ('automatic_single', 'automatic_time_window'));--> statement-breakpoint
-- HAND-WRITTEN. An audit trail the application can rewrite is not one.
--
-- A trigger rather than REVOKE UPDATE, DELETE: the suite and every local tool
-- connect as a superuser, and a superuser bypasses grants entirely — so the
-- REVOKE would be unverifiable here and silently absent in the one place it
-- matters. This raises for every role, and the test proves it.
-- ponytail: a superuser can still DROP the trigger. Production should ALSO run
-- the app under a restricted role with UPDATE/DELETE revoked; that is
-- deployment config, not schema.
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
