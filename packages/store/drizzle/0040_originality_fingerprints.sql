-- Fingerprints survive newer risk runs and newer deliveries. They are evidence,
-- not episode identity and not a verdict that footage is payable.
CREATE TABLE originality_index_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0)
);
INSERT INTO originality_index_state (singleton) VALUES (true);
--> statement-breakpoint
-- A mutable job lease/backoff is separate from immutable assessment evidence.
CREATE TABLE originality_processing (
  ingest_id uuid NOT NULL REFERENCES episode_ingests(ingest_id),
  policy_version text NOT NULL,
  inventory jsonb NOT NULL,
  attempt_token uuid NOT NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  next_attempt_at timestamptz NOT NULL,
  terminal boolean NOT NULL DEFAULT false,
  PRIMARY KEY (ingest_id, policy_version)
);
--> statement-breakpoint
CREATE TABLE originality_fingerprints (
  ingest_id uuid NOT NULL REFERENCES episode_ingests(ingest_id),
  policy_version text NOT NULL,
  media_files jsonb NOT NULL,
  attempt_token uuid NOT NULL,
  hashes jsonb NOT NULL CHECK (jsonb_typeof(hashes) = 'array'),
  frame_count integer NOT NULL CHECK (frame_count BETWEEN 20 AND 14400),
  sampled_fps integer NOT NULL CHECK (sampled_fps = 1),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ingest_id, policy_version),
  CHECK (jsonb_array_length(hashes) = frame_count)
);
--> statement-breakpoint
CREATE TABLE originality_fingerprint_frames (
  ingest_id uuid NOT NULL REFERENCES episode_ingests(ingest_id),
  policy_version text NOT NULL,
  attempt_token uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  frame_hash bigint NOT NULL,
  index_keys integer[] NOT NULL CHECK (cardinality(index_keys) = 28),
  PRIMARY KEY (ingest_id, policy_version, attempt_token, ordinal)
);
-- Measured: 2,400 pending tuples pushed a passing 4M-frame query over 2 s.
-- Staging pays index-maintenance cost outside the global admission lock.
CREATE INDEX originality_fingerprint_keys ON originality_fingerprint_frames USING gin(index_keys) WITH (fastupdate=off);
--> statement-breakpoint
CREATE FUNCTION originality_fingerprint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'originality fingerprints are append only'
      USING ERRCODE='23514', CONSTRAINT='originality_fingerprint_append_only';
  END IF;
  PERFORM originality_lock();
  RETURN NEW;
END $$;
CREATE TRIGGER originality_fingerprint_guard BEFORE INSERT OR UPDATE OR DELETE ON originality_fingerprints
  FOR EACH ROW EXECUTE FUNCTION originality_fingerprint_guard();
-- Staging is invisible until the fingerprint header publishes this exact token.
-- It never takes the global payment lock. Only abandoned staging can be deleted.
CREATE FUNCTION originality_frame_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND EXISTS (SELECT 1 FROM originality_processing p
    WHERE p.ingest_id=NEW.ingest_id AND p.policy_version=NEW.policy_version AND p.attempt_token=NEW.attempt_token)
    AND NOT EXISTS (SELECT 1 FROM originality_fingerprints f WHERE f.ingest_id=NEW.ingest_id AND f.policy_version=NEW.policy_version) THEN
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND EXISTS (SELECT 1 FROM originality_processing p WHERE p.ingest_id=OLD.ingest_id
    AND p.policy_version=OLD.policy_version AND p.attempt_token<>OLD.attempt_token)
    AND NOT EXISTS (SELECT 1 FROM originality_fingerprints f WHERE f.ingest_id=OLD.ingest_id
      AND f.policy_version=OLD.policy_version AND f.attempt_token=OLD.attempt_token) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'originality frame evidence is immutable' USING ERRCODE='23514',CONSTRAINT='originality_fingerprint_append_only';
END $$;
CREATE TRIGGER originality_fingerprint_frames_guard BEFORE INSERT OR UPDATE OR DELETE ON originality_fingerprint_frames
  FOR EACH ROW EXECUTE FUNCTION originality_frame_guard();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='playerone_app') THEN
    GRANT SELECT, INSERT ON originality_fingerprints, originality_fingerprint_frames TO playerone_app;
    GRANT DELETE ON originality_fingerprint_frames TO playerone_app;
    GRANT SELECT, UPDATE ON originality_index_state TO playerone_app;
    GRANT SELECT, INSERT, UPDATE ON originality_processing TO playerone_app;
  END IF;
END $$;
