-- 0007: the cloud leg extends the UPL-06 gate (hand-written; drizzle-kit
-- cannot emit triggers).
--
-- upload_batches already holds the gate's state: cloud_verified_at,
-- local_cache_cleaned_at, and upload_batches_cache_after_verify_check, which
-- makes "cleaned before verified" unrepresentable. What that CHECK cannot see
-- is WHAT the cloud verified: cloud_verified_at could be stamped on a batch
-- whose episodes never passed — or never existed. This trigger closes that
-- half. cloud_verified_at can only be set when the batch has at least one
-- episode and every episode on it reads verification_state = 'verified' (the
-- byte read-back verdict, never an ETag — spec ING-29).
--
-- Deliberately one-directional: an episode that LATER fails a re-verification
-- does not claw back cloud_verified_at. The timestamp records that a full
-- verification once passed — the moment the local cache became deletable —
-- and un-verifying after a cleanup would violate the cache CHECK anyway. A
-- later failure still blocks that episode from review (the eligibility
-- predicate reads verification_state directly), and the TF card, which is
-- never cleared, still holds the source bytes for a re-upload.
CREATE FUNCTION upload_batches_cloud_verify_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cloud_verified_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.cloud_verified_at IS NULL) THEN
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
  BEFORE INSERT OR UPDATE OF cloud_verified_at ON upload_batches
  FOR EACH ROW EXECUTE FUNCTION upload_batches_cloud_verify_guard();
