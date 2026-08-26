-- The risk engine's three tables, its role, and the two views the payout side
-- reads. Advisory only: nothing here can change a bill, a settlement, a payout
-- attempt or a collector. It raises flags with evidence, and it can put a
-- REVERSIBLE hold on a bill that an operator with a typed reason clears.
--
-- Four rules govern the shape, and each is enforced below rather than hoped for:
--
--   Explainable  every flag carries the evidence that produced it and a real
--                foreign key to the exact tuning row that judged it, so a flag
--                raised today is still explainable in eighteen months.
--   Append-only  risk_flags and risk_holds refuse UPDATE and DELETE outright.
--                A hold is cleared by inserting a second row, never by editing
--                the first.
--   Versioned    risk_signals holds every tuning that has ever been current.
--                Retuning a signal supersedes its row and inserts a new one
--                under a new threshold_version; nothing is retuned in place.
--   Advisory     PROV.SYNTHETIC_HEURISTIC can never be worse than 'notice'. A
--                CHECK on the catalogue, a CHECK on the flags and the band
--                function in packages/api/src/risk/scoring.ts all say so.

-- ---------------------------------------------------------------------------
-- risk_signals: the catalogue, versioned by row.
--
-- The brief sketched `signal_id pk`. The key here is (signal_id,
-- threshold_version) instead, for one reason: a flag stores the version that
-- judged it, and if the current row were the only row, the points and
-- thresholds behind an old flag would be gone the first time anyone retuned.
-- One current row per signal is `risk_signals_current_key`; the history is
-- every row with `superseded_at` set.
--
-- Bands are rows too (family 'BAND'): BAND.NOTICE, BAND.REVIEW and BAND.HOLD
-- carry the lower edge of each band in `default_points`, so retuning a band is
-- the same operation as retuning a signal and leaves the same trail.
CREATE TABLE "risk_signals" (
  "signal_id" text NOT NULL,
  "threshold_version" text NOT NULL,
  "family" text NOT NULL,
  "description" text NOT NULL,
  "default_points" integer NOT NULL,
  "default_severity" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "superseded_at" timestamp with time zone,
  CONSTRAINT "risk_signals_pkey" PRIMARY KEY ("signal_id", "threshold_version"),
  CONSTRAINT "risk_signals_family_check" CHECK ("family" IN ('IDENT', 'VOL', 'CONT', 'PROV', 'OPS', 'BAND', 'META')),
  CONSTRAINT "risk_signals_severity_check" CHECK ("default_severity" IN ('info', 'notice', 'review', 'hold')),
  CONSTRAINT "risk_signals_points_check" CHECK ("default_points" BETWEEN 0 AND 100),
  CONSTRAINT "risk_signals_id_shape_check" CHECK ("signal_id" ~ '^[A-Z]+\.[A-Z0-9_]+$'),
  CONSTRAINT "risk_signals_version_check" CHECK (length(trim("threshold_version")) > 0),
  -- The lowest-weight signal, capped at the catalogue: no retune can lift it.
  CONSTRAINT "risk_signals_synthetic_cap_check" CHECK (
    "signal_id" <> 'PROV.SYNTHETIC_HEURISTIC' OR "default_severity" IN ('info', 'notice')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "risk_signals_current_key" ON "risk_signals" ("signal_id") WHERE "superseded_at" IS NULL;
--> statement-breakpoint
-- The one legal UPDATE is superseding: superseded_at from null to a moment,
-- every other column untouched. Anything else is a retune in place, which is
-- exactly the silent change this table exists to make impossible.
CREATE FUNCTION risk_signals_supersede_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_signals_supersede_only: a tuning row is history once a flag has cited it; supersede it, never delete it'
      USING ERRCODE = '23514', CONSTRAINT = 'risk_signals_supersede_only';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL
     OR NEW.signal_id <> OLD.signal_id
     OR NEW.threshold_version <> OLD.threshold_version
     OR NEW.family <> OLD.family
     OR NEW.description <> OLD.description
     OR NEW.default_points <> OLD.default_points
     OR NEW.default_severity <> OLD.default_severity
     OR NEW.enabled <> OLD.enabled
     OR NEW.params <> OLD.params
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'risk_signals_supersede_only: % / % cannot be retuned in place; insert a new threshold_version and supersede this one', OLD.signal_id, OLD.threshold_version
      USING ERRCODE = '23514', CONSTRAINT = 'risk_signals_supersede_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER risk_signals_supersede_only
  BEFORE UPDATE OR DELETE ON risk_signals
  FOR EACH ROW EXECUTE FUNCTION risk_signals_supersede_only();
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- risk_flags: one row per finding per evaluation run. Never edited.
--
-- `run_id` groups the flags one evaluation wrote. Every run also writes a
-- META.EVALUATED row, so a subject that comes back clean has a newer run with
-- nothing in it and its old flags stop being current. Without that row a flag,
-- once raised, could never fall away, because the latest run that found
-- anything would stay the latest run.
--
-- `seq` is insertion order and is what "latest run" means. `computed_at` is
-- the engine's clock and is kept for the explanation; two instances with
-- skewed clocks, or two runs inside one millisecond, would make it an
-- ambiguous tiebreak, and the view must never pick the older run.
--
-- `subject_id` is text: collectors, episodes and bills are uuid-keyed, a batch
-- is a period. It is not a foreign key on purpose — a flag is evidence about a
-- subject at a moment and must outlive anything that happens to the subject.
CREATE TABLE "risk_flags" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "run_id" uuid NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "signal_id" text NOT NULL,
  "threshold_version" text NOT NULL,
  "points" integer NOT NULL,
  "severity" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "risk_flags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_flags_subject_type_check" CHECK ("subject_type" IN ('collector', 'episode', 'bill', 'batch')),
  CONSTRAINT "risk_flags_severity_check" CHECK ("severity" IN ('info', 'notice', 'review', 'hold')),
  CONSTRAINT "risk_flags_points_check" CHECK ("points" BETWEEN 0 AND 100),
  CONSTRAINT "risk_flags_evidence_object_check" CHECK (jsonb_typeof("evidence") = 'object'),
  CONSTRAINT "risk_flags_synthetic_cap_check" CHECK (
    "signal_id" <> 'PROV.SYNTHETIC_HEURISTIC' OR "severity" IN ('info', 'notice')
  ),
  CONSTRAINT "risk_flags_signal_fk" FOREIGN KEY ("signal_id", "threshold_version")
    REFERENCES "risk_signals" ("signal_id", "threshold_version")
);
--> statement-breakpoint
CREATE INDEX "risk_flags_subject_idx" ON "risk_flags" ("subject_type", "subject_id", "seq" DESC);
--> statement-breakpoint
CREATE INDEX "risk_flags_run_idx" ON "risk_flags" ("run_id");
--> statement-breakpoint
CREATE INDEX "risk_flags_signal_idx" ON "risk_flags" ("signal_id", "computed_at" DESC);
--> statement-breakpoint
-- A trigger rather than REVOKE, for the reason 0002 gives on audit_events: the
-- suite and every local tool connect as a superuser, which bypasses grants, so
-- a REVOKE would be unverifiable here. This raises for every role. The
-- playerone_risk role below is the second lock, for the deployment that runs
-- the engine under it.
CREATE FUNCTION risk_flags_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'risk_flags_append_only: a flag is evidence; it is superseded by a later run, never edited (attempted %)', TG_OP
    USING ERRCODE = '23514', CONSTRAINT = 'risk_flags_append_only';
END
$$;
--> statement-breakpoint
CREATE TRIGGER risk_flags_append_only
  BEFORE UPDATE OR DELETE ON risk_flags
  FOR EACH ROW EXECUTE FUNCTION risk_flags_append_only();
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- risk_holds: a reversible hold on a bill, as a chain of rows.
--
-- Raising writes a row with cleared_* null. Clearing writes a SECOND row that
-- copies bill_id, raised_by_flag and raised_at and fills cleared_at, cleared_by,
-- clear_reason and clear_verdict. The bill is held when the latest row for it
-- is not cleared. Two triggers keep the chain honest: a clear must answer an
-- open hold, and a second open hold cannot be raised over one already open.
--
-- `signal_ids` is the set of signals that were current when the hold was
-- raised. It is what stops the engine re-holding a bill the moment an operator
-- clears it: a hold is raised again only when a signal appears that the
-- operator did not see (packages/api/src/risk/holds.ts). Because the engine
-- TRUSTS that set, the chain guard requires a clear row to carry exactly the
-- open raise's set: a clear written with an invented superset would otherwise
-- mark risk the operator never saw as already reviewed (Codex F-37).
--
-- `clear_verdict` is what the false-positive report counts. 'false_positive'
-- means the operator looked and found nothing; 'accepted' means the risk is
-- real and finance pays anyway; 'resolved' means the cause was fixed. Only the
-- first one is a mark against the thresholds.
-- A CHECK cannot hold a subquery, so the set test is a function it calls.
CREATE FUNCTION risk_is_signal_set(ids text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(ids) > 0 AND cardinality(ids) = (SELECT count(DISTINCT x) FROM unnest(ids) x)
$$;
--> statement-breakpoint
CREATE TABLE "risk_holds" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "bill_id" uuid NOT NULL,
  "raised_by_flag" uuid NOT NULL,
  "raised_at" timestamp with time zone NOT NULL DEFAULT now(),
  "signal_ids" text[] NOT NULL,
  "cleared_at" timestamp with time zone,
  "cleared_by" uuid,
  "clear_reason" text,
  "clear_verdict" text,
  CONSTRAINT "risk_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_holds_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id"),
  CONSTRAINT "risk_holds_raised_by_flag_risk_flags_id_fk" FOREIGN KEY ("raised_by_flag") REFERENCES "public"."risk_flags"("id"),
  CONSTRAINT "risk_holds_cleared_by_operators_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."operators"("id"),
  -- A set: at least one signal, and no signal twice.
  CONSTRAINT "risk_holds_signal_ids_check" CHECK (risk_is_signal_set("signal_ids")),
  -- Two complete shapes and nothing between: a raise, or a clear with a person,
  -- a typed reason of at least ten characters, and a verdict.
  CONSTRAINT "risk_holds_clear_shape_check" CHECK (
    ("cleared_at" IS NULL AND "cleared_by" IS NULL AND "clear_reason" IS NULL AND "clear_verdict" IS NULL)
    OR ("cleared_at" IS NOT NULL AND "cleared_by" IS NOT NULL
        AND length(trim("clear_reason")) >= 10
        AND "clear_verdict" IN ('false_positive', 'accepted', 'resolved')
        AND "cleared_at" >= "raised_at")
  )
);
--> statement-breakpoint
CREATE INDEX "risk_holds_bill_idx" ON "risk_holds" ("bill_id", "raised_at" DESC, "cleared_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE FUNCTION risk_holds_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'risk_holds_append_only: a hold is cleared by a new row that says who and why, never by editing (attempted %)', TG_OP
    USING ERRCODE = '23514', CONSTRAINT = 'risk_holds_append_only';
END
$$;
--> statement-breakpoint
CREATE TRIGGER risk_holds_append_only
  BEFORE UPDATE OR DELETE ON risk_holds
  FOR EACH ROW EXECUTE FUNCTION risk_holds_append_only();
--> statement-breakpoint
CREATE FUNCTION risk_holds_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  open_flag uuid;
  open_raised timestamp with time zone;
  open_signals text[];
BEGIN
  -- Serialise raises and clears on one bill: two engines, or an engine and an
  -- operator, must not both see "no open hold" and both insert.
  PERFORM pg_advisory_xact_lock(hashtext('risk_holds:' || NEW.bill_id::text));
  SELECT raised_by_flag, raised_at, signal_ids INTO open_flag, open_raised, open_signals
    FROM risk_holds
   WHERE bill_id = NEW.bill_id AND cleared_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM risk_holds c
        WHERE c.bill_id = risk_holds.bill_id
          AND c.raised_by_flag = risk_holds.raised_by_flag
          AND c.raised_at = risk_holds.raised_at
          AND c.cleared_at IS NOT NULL)
   ORDER BY raised_at DESC
   LIMIT 1;

  IF NEW.cleared_at IS NULL THEN
    IF open_flag IS NOT NULL THEN
      RAISE EXCEPTION 'risk_holds_already_open: bill % is already held (flag %); clear that hold before raising another', NEW.bill_id, open_flag
        USING ERRCODE = '23514', CONSTRAINT = 'risk_holds_already_open';
    END IF;
  ELSE
    IF open_flag IS NULL OR open_flag <> NEW.raised_by_flag OR open_raised <> NEW.raised_at THEN
      RAISE EXCEPTION 'risk_holds_clear_requires_open: bill % has no open hold matching flag % raised at %', NEW.bill_id, NEW.raised_by_flag, NEW.raised_at
        USING ERRCODE = '23514', CONSTRAINT = 'risk_holds_clear_requires_open';
    END IF;
    -- The clear says what the operator saw, and that is exactly what was raised:
    -- the same set, compared sorted so order cannot make two equal sets differ.
    IF (SELECT array_agg(x ORDER BY x) FROM unnest(NEW.signal_ids) x)
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(open_signals) x) THEN
      RAISE EXCEPTION 'risk_holds_clear_signals_check: a clear of bill % must carry the open hold signals % exactly, not %', NEW.bill_id, open_signals, NEW.signal_ids
        USING ERRCODE = '23514', CONSTRAINT = 'risk_holds_clear_signals_check';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER risk_holds_chain_guard
  BEFORE INSERT ON risk_holds
  FOR EACH ROW EXECUTE FUNCTION risk_holds_chain_guard();
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- The read side. Agent B's payout domain and Agent D's console read these and
-- never the tables behind them.

-- Bills held right now: one row per bill whose latest hold row is not cleared.
CREATE VIEW "risk_current_holds" AS
  SELECT h.id AS hold_id, h.bill_id, h.raised_by_flag, h.raised_at, h.signal_ids
    FROM risk_holds h
   WHERE h.cleared_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM risk_holds c
        WHERE c.bill_id = h.bill_id
          AND c.raised_by_flag = h.raised_by_flag
          AND c.raised_at = h.raised_at
          AND c.cleared_at IS NOT NULL);
--> statement-breakpoint
-- The flags of each subject's latest run. META.EVALUATED marks the run and is
-- not itself a finding, so it is what the join keys on and what is left out.
CREATE VIEW "risk_current_flags" AS
  SELECT f.*
    FROM risk_flags f
    JOIN (
      SELECT DISTINCT ON (subject_type, subject_id) subject_type, subject_id, run_id
        FROM risk_flags
       WHERE signal_id = 'META.EVALUATED'
       ORDER BY subject_type, subject_id, seq DESC
    ) latest USING (subject_type, subject_id, run_id)
   WHERE f.signal_id <> 'META.EVALUATED';
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- The role the engine runs under.
--
-- SELECT on everything, INSERT on its own two evidence tables, INSERT and
-- UPDATE on the catalogue (supersede-only, per the trigger), and no write of
-- any kind anywhere else. The engine takes `SET LOCAL ROLE playerone_risk` at
-- the top of every evaluation transaction, so "the risk engine cannot write to
-- bills" is a property Postgres enforces and a test proves, not a convention.
--
-- CREATE ROLE is cluster-wide, so it is guarded: the suite migrates one
-- database per test file on the same server. A migrating user without
-- CREATEROLE gets a NOTICE and the grants are skipped; the engine then refuses
-- to run under the role and says so, which is the right failure.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_risk') THEN
    CREATE ROLE playerone_risk NOLOGIN;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'playerone_risk was not created: the migrating user lacks CREATEROLE. Create it by hand and re-run the grants in 0014_risk.sql.';
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_risk') THEN
    GRANT USAGE ON SCHEMA public TO playerone_risk;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO playerone_risk;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO playerone_risk;
    GRANT INSERT ON risk_flags, risk_holds TO playerone_risk;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO playerone_risk;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO playerone_risk;
    GRANT INSERT, UPDATE ON risk_signals TO playerone_risk;
  END IF;
END
$$;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- The catalogue itself is NOT seeded here. The suite truncates every table
-- between tests and the repo already answers that for defect_codes and
-- review_reason_codes by seeding from code on boot (packages/store/src/catalogue.ts).
-- The risk catalogue follows: packages/api/src/risk/catalogue.ts holds the v1
-- rows and `seedRiskSignals` inserts any signal that has no row yet. It never
-- touches a signal that already has one, so a retune in the database is never
-- undone by a deploy.
