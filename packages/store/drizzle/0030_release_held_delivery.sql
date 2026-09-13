-- An operator can end a held delivery, and `released_by_operator` is the word
-- for how it ended.
--
-- `held` was terminal. `/complete` refuses `upload_basename_collision` for ever
-- (0029), no route un-held the row, and nothing else writes that column — so a
-- collector's phone showed a delivery that could never finish, under an id that
-- could never be reused. The release moves it to `failed`, which is the state
-- the phone already reads as over: the collector can deliver the recording
-- again under a fresh id, or not. Nothing under the media root is touched by
-- it; the other recording is the whole reason the delivery was held.
--
-- The list is closed rather than left open, which is the part worth arguing.
-- `failed_reason` is what the phone prints to a collector whose footage was
-- refused, and `REASON_KEYS` in the app falls back to printing the column when
-- it has no sentence for a value. An open column means the next reason reaches
-- a collector as `released_by_operator`. Three values exist, every one of them
-- has a sentence in all three languages, and a fourth has to be added here —
-- which is the point at which somebody remembers to write them.
ALTER TABLE collector_uploads
  DROP CONSTRAINT collector_uploads_failed_reason_check;--> statement-breakpoint

ALTER TABLE collector_uploads
  ADD CONSTRAINT collector_uploads_failed_reason_check CHECK (
    failed_reason IS NULL
    OR (
      state = 'failed'
      AND failed_reason IN ('checksum_mismatch', 'ingest_failed', 'released_by_operator')
    )
  );
