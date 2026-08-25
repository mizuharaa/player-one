-- 0007: the cloud leg extends the UPL-06 gate (hand-written; drizzle-kit
-- cannot emit triggers).
--
-- upload_batches already holds the gate's state: cloud_verified_at,
-- local_cache_cleaned_at, and upload_batches_cache_after_verify_check, which
-- makes "cleaned before verified" unrepresentable. What that CHECK cannot see
-- is WHAT the cloud verified: either timestamp could be stamped on a batch
-- whose episodes never passed — or never existed. This trigger closes that
-- half. Neither cloud_verified_at nor local_cache_cleaned_at can be set unless
-- the batch has at least one episode and every episode on it reads
-- verification_state = 'verified' AT THAT MOMENT (the byte read-back verdict,
-- never an ETag — spec ING-29).
--
-- Both timestamps, not just the first, because "once passed" is not the
-- question cleanup asks. cloud_verified_at is deliberately one-directional: it
-- records that a full verification passed once, which is a fact and stays
-- true. Deleting the only local copy is a decision about NOW, so it re-reads
-- the episodes instead of trusting that historical timestamp. A batch whose
-- episode was redelivered (below), or whose re-verification failed, is
-- therefore not cleanable until it verifies again — while the TF card, which
-- is never cleared, still holds the source bytes.
CREATE FUNCTION upload_batches_cloud_verify_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.cloud_verified_at IS NOT NULL
      AND (TG_OP = 'INSERT' OR OLD.cloud_verified_at IS NULL))
     OR (NEW.local_cache_cleaned_at IS NOT NULL
         AND (TG_OP = 'INSERT' OR OLD.local_cache_cleaned_at IS NULL)) THEN
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
CREATE TRIGGER upload_batches_cloud_verify_guard
  BEFORE INSERT OR UPDATE OF cloud_verified_at, local_cache_cleaned_at ON upload_batches
  FOR EACH ROW EXECUTE FUNCTION upload_batches_cloud_verify_guard();--> statement-breakpoint

-- episodes.verification_state is a fact about ONE delivery's bytes: the cloud
-- leg uploads the latest ingest's source files and reads every one of them
-- back. A changed redelivery writes a NEW ingest row and moves
-- latest_ingest_id to it, and those bytes have never been uploaded — so the
-- previous ingest's verdict must not carry over onto them. Without this, an
-- episode verified under ingest A goes straight into review under ingest B on
-- a cloud gate that has verified nothing about B.
--
-- It lives here rather than in packages/store/src/index.ts for the usual
-- reason (CLAUDE.md: invariants belong in the schema): the store is not the
-- only thing that can move latest_ingest_id, and a repair script that moved it
-- by hand would otherwise leave a stale verdict behind.
CREATE FUNCTION episodes_reset_verification_on_new_ingest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latest_ingest_id IS DISTINCT FROM OLD.latest_ingest_id THEN
    NEW.verification_state := 'pending';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER episodes_reset_verification_on_new_ingest
  BEFORE UPDATE OF latest_ingest_id ON episodes
  FOR EACH ROW EXECUTE FUNCTION episodes_reset_verification_on_new_ingest();
