-- 0016: clearing ONE episode out of a CHECKSUM-MISMATCH quarantine.
--
-- A redelivery whose bytes differ from the first delivery writes a second
-- ingest carrying CHECKSUM-MISMATCH, and the ingest spec (§6, defect table)
-- keeps that episode out of review: which of the two deliveries is the real
-- one is an open question. This table is where a person answers it. One row
-- per answer, naming the delivery the operator judged authoritative, who
-- said so, when, why, and what the episode looked like at that moment.
--
-- Rule 6 of the brief: nothing here touches source media or an earlier
-- delivery's record. `episode_ingests` and its children are untouched; the
-- only thing the clearing route moves is `episodes.latest_ingest_id`, and the
-- ingest it moves away from stays on the record with its defects intact.
--
-- Append-only, in the same shape as `collector_agreements`: a second clear is
-- a second row, never an edit, so "who cleared this and on what grounds" is
-- answerable after the second one as well as the first.

-- The named delivery must be a delivery OF THIS EPISODE. A foreign key on
-- `ingest_id` alone would accept another episode's ingest; the composite key
-- cannot. `episode_ingests` carried no unique on exactly (episode_id,
-- ingest_id) — only the wider review target key — so one is added here.
ALTER TABLE episode_ingests
  ADD CONSTRAINT episode_ingests_delivery_key UNIQUE (episode_id, ingest_id);--> statement-breakpoint

CREATE TABLE episode_clearings (
  id uuid PRIMARY KEY,
  episode_id uuid NOT NULL REFERENCES episodes(episode_id),
  -- The delivery the operator named as authoritative.
  ingest_id uuid NOT NULL,
  -- The delivery that was `latest_ingest_id` when the clear was made: what
  -- the episode was cleared FROM.
  prior_latest_ingest_id uuid NOT NULL REFERENCES episode_ingests(ingest_id),
  -- That delivery's ingest state at the same moment.
  from_state text NOT NULL,
  cleared_by uuid NOT NULL REFERENCES operators(id),
  cleared_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  CONSTRAINT episode_clearings_delivery_fk
    FOREIGN KEY (episode_id, ingest_id) REFERENCES episode_ingests(episode_id, ingest_id),
  CONSTRAINT episode_clearings_reason_check CHECK (length(trim(reason)) > 0),
  CONSTRAINT episode_clearings_from_state_check
    CHECK (from_state IN ('ok', 'flagged', 'quarantined'))
);--> statement-breakpoint
CREATE INDEX episode_clearings_episode_idx ON episode_clearings (episode_id, cleared_at DESC);--> statement-breakpoint
CREATE INDEX episode_clearings_ingest_idx ON episode_clearings (ingest_id);--> statement-breakpoint

CREATE OR REPLACE FUNCTION episode_clearings_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'episode_clearings_append_only: a clearing is a record of a decision, not a settings row'
    USING ERRCODE = '23514', CONSTRAINT = 'episode_clearings_append_only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER episode_clearings_append_only
  BEFORE UPDATE OR DELETE ON episode_clearings
  FOR EACH ROW EXECUTE FUNCTION episode_clearings_append_only();
