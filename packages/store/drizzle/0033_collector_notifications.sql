-- 0033: what happened to a collector's own work, told to the collector.
--
-- HAND-WRITTEN, because the grant block at the bottom is and drizzle would not
-- have produced it. The table itself is what `collectorNotifications` in
-- `schema.ts` declares, constraint for constraint.
--
-- Nothing in this service has ever spoken to a collector about their own work.
-- `alerts.ts` pages the ops team; `zns.ts` sends a sign-in code. A collector
-- found out that footage was reviewed by opening the app and reading a list,
-- and found out a bill was paid by noticing money. This table is the record,
-- and `docs/notifications.md` is the catalogue that governs it.
--
-- Rows are written by `notify()` INSIDE the transaction of the event they
-- describe. That is the whole design and both halves matter: a notification
-- cannot exist for a change that rolled back, and a change cannot commit
-- without its notification. There is no queue to drain and no worker to be down.
--
-- `collector_notifications_source_key` is what makes a retry free. The pair
-- (source_table, source_id) names the EVENT's row — the upload, the review, the
-- bill, the attempt — and never this row, so two notifications about one
-- verdict are recognisably the same notification and the second insert does
-- nothing. A phone with a bad connection re-posting `/complete` is the ordinary
-- case, not the exotic one.
--
-- `collector_notifications_kind_check` names all thirteen kinds. The vocabulary
-- belongs in the schema for the reason every other closed set in this database
-- does: a route that invents a kind is refused by Postgres, not by a code
-- review. A fourteenth kind is a new migration that replaces this CHECK, the
-- way 0030 replaces the upload reason CHECK — which is also the moment somebody
-- remembers the kind needs a sentence in three languages.
--
-- `payload` carries ids and the server's stored figures only. It is jsonb and
-- not a set of columns because the figures differ per kind; it is CHECKed to be
-- an object so a bare string or an array cannot land in it. Nothing internal
-- goes in — no reason code, no reviewer, no note, no exception reason.

CREATE TABLE collector_notifications (
  id uuid PRIMARY KEY,
  collector_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_table text NOT NULL,
  source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT collector_notifications_collector_id_fk
    FOREIGN KEY (collector_id) REFERENCES collectors(id),
  CONSTRAINT collector_notifications_kind_check CHECK (
    kind IN (
      'upload_verified', 'upload_ingested', 'upload_held', 'upload_failed',
      'review_passed', 'review_partial', 'review_failed',
      'bill_issued', 'payment_recorded',
      'payout_account_verified', 'payout_account_refused',
      'task_published', 'claim_accepted'
    )
  ),
  CONSTRAINT collector_notifications_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT collector_notifications_source_check CHECK (
    length(trim(source_table)) > 0 AND length(trim(source_id)) > 0
  ),
  CONSTRAINT collector_notifications_read_check CHECK (read_at IS NULL OR read_at >= created_at)
);--> statement-breakpoint

-- The idempotency. One notification per (collector, kind, event row).
CREATE UNIQUE INDEX collector_notifications_source_key
  ON collector_notifications (collector_id, kind, source_table, source_id);--> statement-breakpoint

-- The inbox keyset: newest first, and `id` after `created_at` because two
-- notifications written in one transaction share an instant and a cursor on a
-- non-unique key loses rows.
CREATE INDEX collector_notifications_inbox_idx
  ON collector_notifications (collector_id, created_at DESC, id DESC);--> statement-breakpoint

-- Per 0021. `ALTER DEFAULT PRIVILEGES` in that migration already covers a table
-- created later BY THE SAME USER, which is every deployment so far; this block
-- is what makes the grant true when it is not, and it is the place the absence
-- of DELETE is stated rather than inherited. A collector's record of what
-- happened to their money is not something the application may remove — the
-- read route sets `read_at` and that is the only UPDATE it needs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON collector_notifications TO playerone_app;
    REVOKE DELETE, TRUNCATE ON collector_notifications FROM playerone_app;
  END IF;
END $$;
