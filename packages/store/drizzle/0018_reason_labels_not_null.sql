-- `review_reason_codes.label_vi` and `label_zh` become NOT NULL.
--
-- What was measured. The columns have been nullable since 0001 and an INSERT
-- carrying only `label_en` succeeds. §6.9 says the review standard does not
-- exist yet and will be rewritten during the pilot, and `seedCatalogues`
-- deliberately leaves an operator's edit alone — so the row that adds a reason
-- mid-pilot is typed by hand, in psql, by somebody who has not read this
-- repository. `GET /api/review/reasons` passes the null straight through and
-- the console renders an empty span beside a live checkbox: a PaXini reviewer
-- in Shenzhen is asked to reject a collector's footage for a reason with no
-- name, and QR-04 says the collector must be told why they were paid nothing.
--
-- The client type hid it. `ReasonCode.label_zh` in apps/console/src/lib/api.ts
-- was declared `string`, so `tsc` never saw the null. That is fixed with this.
--
-- BACKFILL: none, and none is possible to need. All 13 rows in
-- `REVIEW_REASON_CATALOGUE` carry all three labels and the seed is the only
-- writer in the tree, so `SET NOT NULL` scans and passes. On a database where
-- somebody has already added a half-translated row the ALTER fails outright,
-- which is the wanted behaviour: that row is exactly the defect, and the fix
-- is to type the two missing labels, not to let the migration paper over it.

ALTER TABLE "review_reason_codes" ALTER COLUMN "label_vi" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_reason_codes" ALTER COLUMN "label_zh" SET NOT NULL;
