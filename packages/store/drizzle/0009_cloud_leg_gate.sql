-- 0009: the UPL-06 gate asks about NOW, and a verdict belongs to one delivery.
--
-- Appended rather than folded into 0007, which is already pushed: drizzle
-- applies by journal timestamp, so a database migrated at the earlier commit
-- would never see an edited 0007. Every statement here is written to replay
-- cleanly on a database that already ran 0007 and on a fresh one.
--
-- Two corrections, and both come from the same mistake: reading a historical
-- fact as if it answered a question about the present.
--
--   1. 0007 guarded `cloud_verified_at` only. `local_cache_cleaned_at` is the
--      one that authorises deleting an upload centre's only copy, and it was
--      gated on the CHECK alone — that is, on the mere existence of an older
--      `cloud_verified_at`. A batch verified last week, whose episode has since
--      been redelivered or has since failed re-verification, could be closed
--      and its cache recorded clean while the cloud held bytes that do not
--      match. The guard now runs on both timestamps, against the state of the
--      episodes at that moment.
--
--      `cloud_verified_at` stays one-directional and that is deliberate: it
--      records that a full verification passed once, which is a fact and stays
--      true. Cleanup does not read it as permission.
--
--   2. `episodes.verification_state` is a verdict about ONE delivery's bytes:
--      the cloud leg uploads the latest ingest's files and reads every one of
--      them back. A changed redelivery writes a NEW ingest and moves
--      `latest_ingest_id` to it, and those bytes have never been uploaded — so
--      the previous ingest's verdict must not carry over. Without the reset, an
--      episode verified under ingest A entered review under ingest B on a cloud
--      gate that had verified nothing about B.
--
--      This lives in the schema rather than in packages/store/src/index.ts for
--      the usual reason (CLAUDE.md: invariants belong in the schema): the store
--      is not the only thing that can move `latest_ingest_id`, and a repair
--      script that moved it by hand would otherwise leave a stale verdict
--      standing. Being a BEFORE trigger it also beats a raw UPDATE that sets
--      both columns in one statement.
CREATE OR REPLACE FUNCTION upload_batches_cloud_verify_guard() RETURNS trigger
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
DROP TRIGGER IF EXISTS upload_batches_cloud_verify_guard ON upload_batches;--> statement-breakpoint
CREATE TRIGGER upload_batches_cloud_verify_guard
  BEFORE INSERT OR UPDATE OF cloud_verified_at, local_cache_cleaned_at ON upload_batches
  FOR EACH ROW EXECUTE FUNCTION upload_batches_cloud_verify_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION episodes_reset_verification_on_new_ingest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latest_ingest_id IS DISTINCT FROM OLD.latest_ingest_id THEN
    NEW.verification_state := 'pending';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS episodes_reset_verification_on_new_ingest ON episodes;--> statement-breakpoint
CREATE TRIGGER episodes_reset_verification_on_new_ingest
  BEFORE UPDATE OF latest_ingest_id ON episodes
  FOR EACH ROW EXECUTE FUNCTION episodes_reset_verification_on_new_ingest();
