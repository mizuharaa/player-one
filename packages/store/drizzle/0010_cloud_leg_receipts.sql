-- 0010: a receipt must not outlive the facts it certifies, and the gate must
-- hold against writers that never called the API.
--
-- Numbered 0010: review-queues holds 0008 and this branch's 0009 is already
-- pushed. Same replay rule as 0009 — every statement lands identically on a
-- database that has run 0007+0009 and on a fresh one.
--
-- Three corrections, all from Codex's re-audit of the 0009 gate:
--
--   1. **A redelivery invalidates the cleanup receipt.** `local_cache_cleaned_at`
--      says "this machine's cache holds nothing the cloud does not". The moment
--      a new ingest lands — or an episode moves onto the batch — that sentence
--      is false: the import just wrote bytes into that cache that nobody has
--      verified. 0009 reset the episode's verification but left the receipt
--      standing, so `/cache-clean` kept answering `replayed: true` and a
--      deletion client trusting it could delete the only copy of the new,
--      unverified bytes. The `episodes_invalidate_cache_receipt` trigger nulls
--      the receipt in the same transaction that moves `latest_ingest_id` or
--      `upload_batch_id`, so a standing receipt always describes the present.
--      `cloud_verified_at` stays: it records that a full verification once
--      passed, which remains true.
--
--   2. **The gate takes its own locks.** 0009's trigger read episode rows with
--      plain EXISTS, so it answered from a READ COMMITTED snapshot; the
--      route-level `lockEpisodes()` protected the two API paths, but a raw
--      UPDATE — a repair script, a future writer — could stamp a timestamp
--      while a concurrent transaction failed an episode, and both would
--      commit. The guard now takes FOR UPDATE row locks on the batch's
--      episodes before it reads them, ordered by episode_id like the routes,
--      so the check and the episode write serialise no matter who the writer
--      is. A writer that locks the batch row first and the episodes second
--      (raw SQL skipping the route order) can deadlock against a live
--      redelivery rather than race it; Postgres aborts one, and the invariant
--      holds either way.
--
--   3. **Timestamps are receipts, not fields.** Once set, `cloud_verified_at`
--      never changes again, and `local_cache_cleaned_at` changes only by being
--      invalidated (set NULL, per 1) — never silently re-stamped over a
--      standing value. Two concurrent first cleanups therefore cannot both
--      write: the API's UPDATE carries `local_cache_cleaned_at IS NULL`, the
--      loser's WHERE re-evaluates to nothing after the winner commits, and a
--      raw writer that skips the CAS hits the write-once check here.
CREATE OR REPLACE FUNCTION upload_batches_cloud_verify_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.cloud_verified_at IS NOT NULL
     AND NEW.cloud_verified_at IS DISTINCT FROM OLD.cloud_verified_at THEN
    RAISE EXCEPTION 'cloud_verified_at records that a full verification once passed; it is write-once'
      USING ERRCODE = '23514', CONSTRAINT = 'upload_batches_cloud_verified_write_once';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.local_cache_cleaned_at IS NOT NULL
     AND NEW.local_cache_cleaned_at IS NOT NULL
     AND NEW.local_cache_cleaned_at IS DISTINCT FROM OLD.local_cache_cleaned_at THEN
    RAISE EXCEPTION 'a standing cleanup receipt is never re-stamped; a redelivery invalidates it first'
      USING ERRCODE = '23514', CONSTRAINT = 'upload_batches_cache_clean_write_once';
  END IF;
  IF (NEW.cloud_verified_at IS NOT NULL
      AND (TG_OP = 'INSERT' OR OLD.cloud_verified_at IS NULL))
     OR (NEW.local_cache_cleaned_at IS NOT NULL
         AND (TG_OP = 'INSERT' OR OLD.local_cache_cleaned_at IS NULL)) THEN
    -- The locks ARE the invariant: without them this reads a snapshot, and a
    -- concurrent redelivery or verification failure commits beside it.
    PERFORM 1 FROM episodes WHERE upload_batch_id = NEW.id ORDER BY episode_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM episodes WHERE upload_batch_id = NEW.id) THEN
      RAISE EXCEPTION 'a batch with no episodes has nothing the cloud could have verified'
        USING ERRCODE = '23514', CONSTRAINT = 'upload_batches_verify_needs_episodes';
    END IF;
    IF EXISTS (SELECT 1 FROM episodes
                WHERE upload_batch_id = NEW.id AND verification_state <> 'verified') THEN
      RAISE EXCEPTION 'an episode on this batch has not passed cloud read-back verification'
        USING ERRCODE = '23514', CONSTRAINT = 'upload_batches_verify_needs_verified_episodes';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- The 0009 trigger definition is unchanged; replacing the function above is
-- enough. This one is new: new bytes in a cache mean the cache is not clean.
CREATE OR REPLACE FUNCTION episodes_invalidate_cache_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.latest_ingest_id IS NOT DISTINCT FROM OLD.latest_ingest_id
     AND NEW.upload_batch_id IS NOT DISTINCT FROM OLD.upload_batch_id THEN
    RETURN NULL;  -- the resolution UPDATE re-sets both columns on every submit
  END IF;
  IF NEW.upload_batch_id IS NOT NULL THEN
    UPDATE upload_batches SET local_cache_cleaned_at = NULL
     WHERE id = NEW.upload_batch_id AND local_cache_cleaned_at IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS episodes_invalidate_cache_receipt ON episodes;--> statement-breakpoint
CREATE TRIGGER episodes_invalidate_cache_receipt
  AFTER INSERT OR UPDATE OF latest_ingest_id, upload_batch_id ON episodes
  FOR EACH ROW EXECUTE FUNCTION episodes_invalidate_cache_receipt();
