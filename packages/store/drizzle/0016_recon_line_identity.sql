-- A statement line is identified by what the bank printed on it: the
-- reference, the amount and the date (the matcher in statement.ts matches on
-- exactly those three). 0015's `recon_lines_open_key` keyed an unmatched
-- statement line on the reference alone, so two lines carrying the same
-- reference — 'CHUYEN TIEN' for 1,200,000 on the 5th and 'CHUYEN TIEN' for
-- 2,400,000 on the 9th, neither matching an attempt — wrote ONE line and ONE
-- ticket; the second was counted as "still open" and nobody was ever asked
-- about that money (bridge finding 296).
--
-- `their_at` is when the other side says it happened: the statement line's
-- date. Null for the ZaloPay kinds, whose identity is the attempt or the
-- probed order id. The key gains `their_amount` and `their_at`, so two
-- statement lines that differ in any of reference, amount or date are two
-- discrepancies, while re-ingesting the same statement tomorrow still
-- conflicts on every line and raises nothing new. Two lines identical in all
-- three — the same sum, twice, under the same reference, on the same day —
-- still collapse; a bank reference is unique per transfer at every bank we
-- have seen a statement from, so that is the ceiling, not the case.
--
-- 0015 is not edited: it has been applied to the QA databases and to every
-- builder's po_* database on this branch, and an edited migration is one
-- those databases never see (0007 → 0009 set the precedent). This file is
-- replay-safe on a database that already carries 0015.
ALTER TABLE "recon_lines" ADD COLUMN IF NOT EXISTS "their_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "recon_lines_open_key";--> statement-breakpoint
CREATE UNIQUE INDEX "recon_lines_open_key" ON "recon_lines" USING btree ("discrepancy_kind","payout_attempt_id","bill_id","partner_order_id","reference","their_amount","their_at") NULLS NOT DISTINCT WHERE "recon_lines"."resolved_at" is null;
