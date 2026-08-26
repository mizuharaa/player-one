CREATE TABLE "device_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_assignments_period_check" CHECK ("device_assignments"."valid_to" is null or "device_assignments"."valid_to" > "device_assignments"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_assignments_collector_idx" ON "device_assignments" USING btree ("collector_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-written from here down. THE invariant of this table is about two rows at
-- once, and neither drizzle nor a CHECK can see a second row.

-- One collector holds a given headset for one period, so two assignments of one
-- device can never overlap in time. Written as the exclusion constraint Postgres
-- has for exactly this, rather than as a trigger that reads the other rows: an
-- index-backed constraint is race-free without anybody reasoning about locks,
-- and two concurrent inserts of overlapping periods cannot both win.
--
-- The range is HALF-OPEN, '[)'. Adjacent periods are therefore legal and that is
-- the point: at the end of an allotment the credentials swap, and the moment the
-- outgoing period ends is the moment the incoming one starts. Closed on both
-- ends would refuse the ordinary handover and force a one-second gap in which
-- the device belonged to nobody.
--
-- ponytail: this needs `CREATE EXTENSION btree_gist` at migrate time. The
-- extension is trusted since Postgres 13, so a database owner can install it
-- without being superuser — but a managed Postgres (GreenNode vDB) may still
-- refuse, and then this migration fails loudly rather than silently skipping the
-- invariant. Upgrade path if that happens: replace both statements with a BEFORE
-- INSERT OR UPDATE trigger that takes `SELECT ... FROM devices WHERE id =
-- NEW.device_id FOR UPDATE` and then looks for an overlapping row — the same
-- shape `task_claims_guard` in 0006 uses for the capacity cap, and the same
-- constraint name, so nothing above this line and no test changes.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE device_assignments
  ADD CONSTRAINT device_assignments_no_overlap
  EXCLUDE USING gist (device_id WITH =, tstzrange(valid_from, valid_to, '[)') WITH &&);
