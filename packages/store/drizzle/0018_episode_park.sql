-- 0018: taking ONE episode out of the review queue, and putting it back.
--
-- Three dead ends share a shape. A verdict refused as
-- `review_duration_implausible` leaves the review row pending; the lease runs
-- out; the queue serves the same episode to the next reviewer, who is refused
-- the same way, for ever. A `DUR-EXCEEDS-WINDOW` or `CALIB-MISSING` ingest
-- quarantine has no operator route out at all. A session with no claim is
-- refused `session_claim_missing` on every decision. In each case the only
-- exit anybody had was a bad verdict, which pays the collector nothing for
-- footage that was never judged.
--
-- This is the exit. An operator parks the episode: it leaves every queue, it
-- stops being served, and the row here says who did it, when, from which
-- state, and why. Another row puts it back.
--
-- WHY A NEW STATE AND NOT AN EXISTING ONE
--
--   `episodes.resolution_state` was the first candidate and does not fit.
--   `episodes_resolution_check` (0000) ties `quarantined` to
--   `collection_session_id IS NULL`, so parking a resolved episode would mean
--   throwing away the attribution that a person or the resolver worked out —
--   the one fact the release would have to restore and could not.
--
--   `settlements.settlement_state = 'exception'` (0016) was the second and is
--   the wrong object. It parks MONEY: a settlement exists only after a verdict,
--   and every episode this migration is for has no verdict at all. The two are
--   complementary and the boundary is enforced below: an episode that has been
--   settled cannot be parked (`episode_parks_settled`, park the settlement
--   instead), and a parked episode cannot be settled
--   (`settlements_episode_parked`).
--
--   `episode_reviews.review_state` was the third. A park has to work for an
--   episode NOBODY has claimed — the queue is lazy and materialises a review
--   row only at claim time — so a state on a row that does not exist parks
--   nothing.
--
-- So: a new table, in the shape `episode_clearings` (0016) already proved, and
-- one pointer column on `episodes` that says which park currently holds it.
-- The rows are append-only evidence; the pointer is what the queue reads, the
-- same division as `episode_clearings` and `episodes.latest_ingest_id`.
--
-- A release is a ROW, not an edit. A park that was made in error and lifted
-- leaves both facts on the record, and a second park is a third row. Nothing
-- here is ever updated.
--
-- BACKFILL: none. The column is added NULL and every existing episode is
-- unparked, which is what it was before this migration existed.

CREATE TABLE episode_parks (
  id uuid PRIMARY KEY,
  episode_id uuid NOT NULL REFERENCES episodes(episode_id),
  -- NULL on a park; on a release, the park row it lifts. One release per park
  -- (`episode_parks_release_key`), and the composite FK below keeps it to a
  -- park of the SAME episode.
  releases_park_id uuid,
  -- `episodes.resolution_state` at the moment of the write. No CHECK on the
  -- value: the trigger below demands it equal the live row, which is stronger
  -- than any list of legal spellings and makes one redundant. Evidence, and a
  -- release that says the episode was quarantined when the park said resolved
  -- is a record nobody can read back.
  from_state text NOT NULL,
  parked_by uuid NOT NULL REFERENCES operators(id),
  parked_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  -- The target of the self-reference and of `episodes.parked_park_id`; `id`
  -- alone is already unique, so this exists only to bind the episode.
  CONSTRAINT episode_parks_episode_key UNIQUE (episode_id, id),
  CONSTRAINT episode_parks_release_key UNIQUE (releases_park_id),
  CONSTRAINT episode_parks_release_fk
    FOREIGN KEY (episode_id, releases_park_id) REFERENCES episode_parks (episode_id, id),
  CONSTRAINT episode_parks_reason_check CHECK (length(trim(reason)) > 0)
);--> statement-breakpoint
CREATE INDEX episode_parks_episode_idx ON episode_parks (episode_id, parked_at DESC);--> statement-breakpoint

-- Which park holds this episode out of the queue, or NULL. One column, because
-- the queue asks the question on every scan and "is there a park row with no
-- release row" is a nested NOT EXISTS in the hot path of every claim.
--
-- It is also the whole of "one open park at a time": a column holds one value,
-- so no trigger has to count rows to say so.
ALTER TABLE episodes ADD COLUMN parked_park_id uuid;--> statement-breakpoint
ALTER TABLE episodes ADD CONSTRAINT episodes_parked_park_fk
  FOREIGN KEY (episode_id, parked_park_id) REFERENCES episode_parks (episode_id, id);--> statement-breakpoint
CREATE INDEX episodes_parked_idx ON episodes (parked_park_id) WHERE parked_park_id IS NOT NULL;--> statement-breakpoint

-- Every rule about a park row, in one function on one trigger. INSERT is the
-- only operation that may happen at all; the rest is what an insert must say.
CREATE OR REPLACE FUNCTION episode_parks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held uuid; live text; target_is_park boolean; settled uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'episode_parks_append_only: a park is a record of a decision, not a settings row'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_parks_append_only';
  END IF;

  -- The lock the whole design rests on. The verdict transaction takes the same
  -- one before it reads eligibility, so a park racing a verdict serialises:
  -- either the verdict sees the park and writes nothing, or the park waits and
  -- then finds the settlement it is refused by.
  SELECT e.parked_park_id, e.resolution_state INTO held, live
    FROM episodes e WHERE e.episode_id = NEW.episode_id FOR UPDATE;

  IF NEW.from_state IS DISTINCT FROM live THEN
    RAISE EXCEPTION
      'episode_parks_from_state: episode % is %, but the row says %',
      NEW.episode_id, live, NEW.from_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_parks_from_state';
  END IF;

  IF NEW.releases_park_id IS NULL THEN
    IF held IS NOT NULL THEN
      RAISE EXCEPTION
        'episode_parks_already_parked: episode % is already parked by %', NEW.episode_id, held
        USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_parks_already_parked';
    END IF;
    -- The boundary with the settlement exception. Money that has been scored
    -- is parked as money (0016), and letting an episode be parked afterwards
    -- would leave a settlement standing behind a parked episode — the one
    -- shape `settlements_episode_parked` below exists to make impossible.
    SELECT s.id INTO settled
      FROM settlements s
      JOIN episode_reviews r ON r.id = s.episode_review_id
     WHERE r.episode_id = NEW.episode_id
     LIMIT 1;
    IF settled IS NOT NULL THEN
      RAISE EXCEPTION
        'episode_parks_settled: episode % already carries settlement %; park the settlement, not the episode',
        NEW.episode_id, settled
        USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_parks_settled';
    END IF;
    RETURN NEW;
  END IF;

  SELECT (p.releases_park_id IS NULL) INTO target_is_park
    FROM episode_parks p WHERE p.id = NEW.releases_park_id;
  IF target_is_park IS NOT TRUE THEN
    RAISE EXCEPTION
      'episode_parks_release_target: % is a release, not a park', NEW.releases_park_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_parks_release_target';
  END IF;
  -- Releasing a park that is not the one currently held covers both "this
  -- episode is not parked" and "that park was already released": in either
  -- case the pointer does not name it.
  IF held IS DISTINCT FROM NEW.releases_park_id THEN
    RAISE EXCEPTION
      'episode_parks_not_parked: episode % is not parked by %', NEW.episode_id, NEW.releases_park_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episode_parks_not_parked';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER episode_parks_guard
  BEFORE INSERT OR UPDATE OR DELETE ON episode_parks
  FOR EACH ROW EXECUTE FUNCTION episode_parks_guard();--> statement-breakpoint

-- The pointer's own rules, for the caller that writes it directly rather than
-- through a park row. The FK already says it names a park of this episode; this
-- says the park is fresh, and that a second park goes through NULL.
CREATE OR REPLACE FUNCTION episodes_park_pointer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parked_park_id IS NOT DISTINCT FROM OLD.parked_park_id THEN
    RETURN NEW;
  END IF;
  IF OLD.parked_park_id IS NOT NULL AND NEW.parked_park_id IS NOT NULL THEN
    RAISE EXCEPTION
      'episodes_park_pointer_check: episode % is parked by %; release it before parking it again',
      OLD.episode_id, OLD.parked_park_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episodes_park_pointer_check';
  END IF;
  IF NEW.parked_park_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM episode_parks r WHERE r.releases_park_id = NEW.parked_park_id) THEN
    RAISE EXCEPTION
      'episodes_park_pointer_check: park % has already been released', NEW.parked_park_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'episodes_park_pointer_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER episodes_park_pointer_guard
  BEFORE UPDATE ON episodes
  FOR EACH ROW EXECUTE FUNCTION episodes_park_pointer_guard();--> statement-breakpoint

-- Can a parked episode ever be paid? No.
--
-- The brief settles it rather than leaving it open: §4.3's discussion says an
-- episode with no resolvable session is "unattributable, unpayable", and PLT-05
-- gives quarantine an explicit state with a human resolution path. A parked
-- episode is that shape generalised — it is out of review because a person said
-- the delivery cannot be judged as it stands — so it earns nothing until
-- somebody releases it and a reviewer scores it. Releasing puts it back in the
-- queue at full value; nothing about the money is destroyed by parking.
--
-- Enforced here and not in `review.ts`, because the eligibility clause in the
-- queue is a filter and a filter is not an invariant. A settlement can only be
-- written against a review, so this is the one gate every payment passes.
CREATE OR REPLACE FUNCTION settlements_park_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parked uuid;
BEGIN
  SELECT e.parked_park_id INTO parked
    FROM episode_reviews r
    JOIN episodes e ON e.episode_id = r.episode_id
   WHERE r.id = NEW.episode_review_id;
  IF parked IS NOT NULL THEN
    RAISE EXCEPTION
      'settlements_episode_parked: the episode behind review % is parked (%) and cannot be paid',
      NEW.episode_review_id, parked
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_episode_parked';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER settlements_park_guard
  BEFORE INSERT ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_park_guard();
