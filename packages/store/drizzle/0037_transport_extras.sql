ALTER TABLE episode_ingests ADD COLUMN transport_extra_files jsonb;
--> statement-breakpoint
ALTER TABLE episode_ingests ADD CONSTRAINT episode_ingests_transport_extras_array
  CHECK (transport_extra_files IS NULL OR jsonb_typeof(transport_extra_files) = 'array');
