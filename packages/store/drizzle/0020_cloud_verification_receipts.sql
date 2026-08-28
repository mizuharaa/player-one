-- 0020: one receipt per cloud object whose bytes have been read back and
-- matched, so a re-run does not have to prove the same file twice.
--
-- UPL-05 verifies a delivery by downloading every object and re-hashing it
-- against the digest the engine settled at import, because an ETag is not a
-- content digest (ING-29) and metadata travels with the object, so a write that
-- damaged the bytes can still carry a clean-looking sha256. That is right, and
-- it is also the whole download side of the wire bill: measured against a real
-- S3 endpoint, a verified episode costs exactly 1.00x its raw size up and 1.00x
-- down, and every later run of the same batch cost another 1.00x down for
-- nothing. One 512-byte damaged object on a 16 MB episode cost 16.00 MB up and
-- 16.00 MB down, because `force` was decided per episode and there was no
-- finer fact to decide it with.
--
-- This table is that finer fact. A row says: these exact bytes, at this exact
-- object key, of this exact delivery, were pulled back out of the cloud and
-- hashed to this digest at this time. The upload route writes one after each
-- successful read-back and deletes exactly the one whose read-back failed, so a
-- repair re-sends and re-reads one file rather than an episode.
--
-- The digest is a column and not just the key because the file at a key can
-- change without the key changing: a redelivery whose media fingerprint is
-- unchanged keeps its ingest and therefore its object prefix, and the manifest
-- beside it is hashed at transport time. A receipt that does not name the bytes
-- about to be transported authorises nothing.
--
-- Bookkeeping, not evidence: the audited `episode.cloud_verify` event remains
-- the record of the verdict, and losing every row here costs bandwidth, not
-- correctness — the next run simply proves everything again.
CREATE TABLE "cloud_verifications" (
  "object_key" text PRIMARY KEY NOT NULL,
  "episode_id" uuid NOT NULL,
  "ingest_id" uuid NOT NULL,
  "sha256" text NOT NULL,
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cloud_verifications" ADD CONSTRAINT "cloud_verifications_episode_id_episodes_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("episode_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The named delivery must be a delivery OF THIS EPISODE. A foreign key on
-- `ingest_id` alone would accept another episode's ingest; the composite key
-- `episode_ingests_delivery_key` is what makes that unrepresentable, exactly as
-- `episode_clearings` uses it.
ALTER TABLE "cloud_verifications" ADD CONSTRAINT "cloud_verifications_delivery_fk" FOREIGN KEY ("episode_id","ingest_id") REFERENCES "public"."episode_ingests"("episode_id","ingest_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_verifications_episode_idx" ON "cloud_verifications" USING btree ("episode_id");
