-- Small, private demonstration clips. No production episode/review/money links.
CREATE TABLE showcase_footage (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 180),
  content_type text NOT NULL CHECK (content_type IN ('video/mp4', 'video/webm')),
  content bytea NOT NULL,
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 20971520 AND bytes = octet_length(content)),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  verdict text CHECK (verdict IN ('good', 'partial', 'bad')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  reviewed_at timestamptz,
  CONSTRAINT showcase_review_state CHECK ((verdict IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT showcase_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);
--> statement-breakpoint
CREATE INDEX showcase_footage_owner ON showcase_footage(operator_id, created_at);
CREATE INDEX showcase_footage_expiry ON showcase_footage(expires_at);
--> statement-breakpoint
-- Every uploader serializes the quota check and insert, including across hosts.
-- Expired demo content is garbage collected, never promoted to production data.
CREATE FUNCTION showcase_footage_quota() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(734091026);
  DELETE FROM showcase_footage WHERE expires_at <= now();
  IF (SELECT count(*) FROM showcase_footage WHERE operator_id = NEW.operator_id) >= 5 THEN
    RAISE EXCEPTION 'showcase operator quota reached' USING ERRCODE = '23514', CONSTRAINT = 'showcase_owner_quota';
  END IF;
  IF (SELECT coalesce(sum(bytes), 0) FROM showcase_footage) + NEW.bytes > 209715200 THEN
    RAISE EXCEPTION 'showcase storage quota reached' USING ERRCODE = '23514', CONSTRAINT = 'showcase_storage_quota';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER showcase_footage_quota BEFORE INSERT ON showcase_footage
FOR EACH ROW EXECUTE FUNCTION showcase_footage_quota();
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON showcase_footage TO playerone_app;
GRANT UPDATE (verdict, note, reviewed_at) ON showcase_footage TO playerone_app;
