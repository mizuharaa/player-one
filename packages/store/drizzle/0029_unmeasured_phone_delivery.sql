-- 0029: the delivery a real phone can actually make.
--
-- Path A (0019) accepts one shape: a finished `EpisodeRecord`, measured by the
-- phone before a byte moves. No phone can produce one. The engine
-- (`packages/ingest`) reads a directory with Node's fs and measures media with
-- ffprobe, and an Android device has neither, so the one route a collector's
-- phone was given is the one route it cannot take.
--
-- So the same table now records a second shape: an UNMEASURED delivery. The
-- phone declares the session directory's name and every file in it with its
-- size and sha256, the existing read-back proves the cloud holds those exact
-- bytes, and then the SERVER materialises the directory and runs the same
-- engine Path C's counter import runs. What comes out is an ordinary episode.
--
-- Three rules this migration is careful not to touch:
--
--   * The episode id still derives from the directory basename and nothing
--     else. `session_basename` is stored in the column the measured path
--     already stores `source.path` in, and the id is computed from it the same
--     way. No content-derived identity appears here.
--   * The phone still measures nothing. Nothing in the request carries a
--     duration, an amount, a state or a stream, and no column added here could
--     hold one.
--   * Nothing is deleted. `held` exists precisely so that a delivery which
--     would have to overwrite a directory already on disk stops instead.
--
-- The columns that already existed keep their names and their meanings. The
-- two CHECKs that are dropped are re-added under the SAME names with widened
-- predicates, rather than left in place beside a second constraint: two
-- overlapping state rules on one column is how a state nobody meant becomes
-- representable.

-- ---------------------------------------------------------------------------
-- Which shape this row is.
--
-- Default true, so every row written before this migration keeps the meaning
-- it was written with: the phone measured it. Only the new route writes false.
ALTER TABLE collector_uploads
  ADD COLUMN measured boolean NOT NULL DEFAULT true;--> statement-breakpoint

-- Every file of an unmeasured delivery, as the phone declared it: relative
-- path, bytes, sha256.
--
-- It has to be stored rather than recomputed. A measured delivery's inventory
-- is `episode_files` plus `extra_files`, because `storeEpisode` ran during the
-- registration; an unmeasured one has no episode and no ingest until the
-- server has measured the bytes, so until then this column is the only record
-- of what was promised. The resume route re-plans from it after the phone has
-- been reinstalled, and `/complete` verifies the read-back against it.
ALTER TABLE collector_uploads
  ADD COLUMN declared_files jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint

-- Why a delivery stopped. Two columns and not one: `held` and `failed` are
-- different kinds of stop and an operator reading the row should not have to
-- consult the state column to know which sentence they are looking at.
--
-- `held` means the platform refused to proceed because proceeding would have
-- destroyed something — today the only reason is `basename_collision`, a
-- session directory already on disk holding different bytes. `failed` means
-- the cloud copy disagreed with the phone's own digests.
ALTER TABLE collector_uploads
  ADD COLUMN held_reason text;--> statement-breakpoint
ALTER TABLE collector_uploads
  ADD COLUMN failed_reason text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The episode and the ingest become nullable, and only for an unmeasured row.
--
-- 0019's own comment said null "is NOT a state this table allows", because the
-- object keys derive from the episode and the ingest and there was nothing to
-- plan without them. That is still true of a MEASURED delivery and the CHECK
-- below keeps it true. It cannot be true of an unmeasured one: the episode row
-- does not exist yet, the ingest is minted by the measurement, and writing a
-- derived id into a column that references a table with no such row is not
-- possible. Inventing the rows early is worse — it would put an episode with
-- no measurement in front of the review queue.
--
-- An unmeasured delivery's objects are keyed on the upload id in place of the
-- ingest id, which is the one thing that is unique per delivery before the
-- measurement exists. One delivery, one prefix, never overwritten: the same
-- guarantee `objectKey` makes, reached by the only key available at the time.
ALTER TABLE collector_uploads
  ALTER COLUMN episode_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE collector_uploads
  ALTER COLUMN ingest_id DROP NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The states.
--
--   registered   the plan has been issued; nothing is known to be in the cloud.
--   transferring at least one object is up and the delivery is not complete.
--   verified     every object read back and matched the phone's digests.
--   ingesting    the bytes are being materialised and measured by the engine.
--   ingested     the episode exists, measured by the server. Terminal, good.
--   held         the delivery cannot be ingested without destroying something.
--   failed       read-back disagreed with the phone. Terminal until re-sent.
ALTER TABLE collector_uploads
  DROP CONSTRAINT collector_uploads_state_check;--> statement-breakpoint
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_state_check CHECK (
    state IN ('registered', 'transferring', 'verified', 'ingesting', 'ingested', 'held', 'failed')
  );--> statement-breakpoint

-- A measured delivery keeps exactly the three states it had before this
-- migration. The four new ones describe work only the server-side ingest does,
-- and a measured row reaching one of them would mean this service had measured
-- a record it is told never to re-measure.
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_measured_state_check CHECK (
    measured = false OR state IN ('registered', 'verified', 'failed')
  );--> statement-breakpoint

-- Same sentence as 0019's, widened for the states that come after the
-- read-back: `completed_at` is when the bytes got their verdict, so every state
-- past `verified` carries it and neither state before it does.
ALTER TABLE collector_uploads
  DROP CONSTRAINT collector_uploads_completed_check;--> statement-breakpoint
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_completed_check CHECK (
    (state IN ('registered', 'transferring')) = (completed_at IS NULL)
  );--> statement-breakpoint

-- A measured delivery names its episode and its delivery from the first
-- statement; an unmeasured one names neither until the engine has measured it.
-- Both halves matter: the second is what makes the nullable columns safe, and
-- the first is what stops the original Path A quietly acquiring them.
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_measured_delivery_check CHECK (
    measured = false OR (episode_id IS NOT NULL AND ingest_id IS NOT NULL)
  );--> statement-breakpoint

-- Half a delivery reference is worse than none: it names an episode with no
-- bytes behind it, or bytes belonging to no episode.
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_delivery_pair_check CHECK (
    (episode_id IS NULL) = (ingest_id IS NULL)
  );--> statement-breakpoint

-- `ingested` is the sentence "this delivery became that episode", so it has to
-- name one.
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_ingested_check CHECK (
    state <> 'ingested' OR (episode_id IS NOT NULL AND ingest_id IS NOT NULL)
  );--> statement-breakpoint

-- A held delivery says why, and nothing else carries a held reason.
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_held_reason_check CHECK (
    (state = 'held') = (held_reason IS NOT NULL)
  );--> statement-breakpoint

-- One direction only. Every unmeasured failure names its reason; the measured
-- path was written before this column existed, records the verdict detail in
-- its audit row, and leaves this null.
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_failed_reason_check CHECK (
    failed_reason IS NULL OR state = 'failed'
  );--> statement-breakpoint

-- The declared inventory IS the delivery, so it has to agree with the count of
-- it. `file_count` is what the registration answered and what an operator
-- reads; a list that disagrees with it makes those two different facts about
-- one delivery. Measured rows are exempt because their inventory lives in
-- `episode_files` and this column is empty for them.
ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_declared_files_check CHECK (
    jsonb_typeof(declared_files) = 'array'
    AND (measured = true OR jsonb_array_length(declared_files) = file_count)
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- One ingested upload per delivery, and no second one.
--
-- `collector_uploads_verified_key` cannot cover this. An unmeasured delivery is
-- `verified` while its episode id is still null, and null is distinct from null
-- in a unique index, so every unmeasured delivery passes that key without being
-- constrained by it. What must not exist twice is "this delivery became that
-- episode": two such rows is one recording read as two, which is the shape that
-- pays twice.
CREATE UNIQUE INDEX collector_uploads_ingested_key
  ON collector_uploads (episode_id, ingest_id)
  WHERE state = 'ingested';
