-- Two facts a settlement must carry rather than look up, and the repair a
-- database that already applied 0005 needs before any of this is enforceable.
--
-- Every statement below adds a constraint, and a constraint is validated
-- against the rows that are already in the table. Original 0005 wrote none of
-- these rules down: its `bills` may carry a period at UTC midnight -- the
-- instant `new Date('2026-08-17')` yields, which is 07:00 in Ho Chi Minh City
-- -- and its `settlements` name no payee and no unit at all. On such a database
-- the `ALTER TABLE`s abort part way and leave the schema in neither version.
--
-- So the block below repairs what has exactly one deterministic reading and
-- refuses, by name and with a count, what does not. A migration that guesses at
-- money is worse than one that stops.
ALTER TABLE "settlements" ADD COLUMN "collector_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "currency" text;--> statement-breakpoint
DO $$
DECLARE n bigint;
BEGIN
  -- A UTC midnight is the only non-conforming boundary original 0005 could
  -- produce: its caller named a calendar date and `Date.parse` read it as UTC.
  -- The date the operator typed is therefore the UTC calendar date, and local
  -- midnight of that same date is the cycle they meant. It moves the label by
  -- seven hours and moves no line between bills -- membership is already
  -- written and is not consulted here.
  UPDATE bills
     SET period_start = (period_start AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh',
         period_end   = (period_end   AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
   WHERE period_start = date_trunc('day', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     AND period_end   = date_trunc('day', period_end   AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     AND period_start <> date_trunc('day', period_start AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';

  -- Anything else is a period nobody can read back: 09:30 on a Tuesday is not a
  -- mis-parsed date, it is a window somebody chose, and there is no honest way
  -- to decide which cycle it was meant to be.
  SELECT count(*) INTO n FROM bills
   WHERE period_start <> date_trunc('day', period_start AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
      OR period_end   <> date_trunc('day', period_end   AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % bill(s) have a period that is neither a Vietnamese local midnight nor a UTC one, so which cycle was meant cannot be decided here. Re-label or remove them and re-run: select id, collector_id, period_start, period_end from bills order by period_start;', n;
  END IF;

  -- The lattice, and then the overlaps it exists to prevent. Both are declared
  -- as constraints below as well; counted here so the failure names the data
  -- rather than the constraint that met it.
  SELECT count(*) INTO n FROM bills
   WHERE (extract(epoch from period_start)::bigint - 320400)
         % (extract(epoch from period_end)::bigint - extract(epoch from period_start)::bigint) <> 0;
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % bill(s) start off the cycle lattice anchored at 1970-01-05 00:00+07. Re-label or remove them and re-run.', n;
  END IF;

  SELECT count(*) INTO n FROM bills a JOIN bills b
      ON b.collector_id = a.collector_id AND b.id <> a.id
     AND tstzrange(a.period_start, a.period_end, '[)') && tstzrange(b.period_start, b.period_end, '[)');
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % overlapping bill pair(s) exist for one collector, so which cycle paid a settlement is already ambiguous. Resolve them and re-run.', n;
  END IF;

  -- The payee, from the strongest evidence first. A billed settlement takes its
  -- collector and unit off the bill it is on: that header is the document
  -- finance was handed, and it outranks a session that may have been reparented
  -- since. `bills.total` is the sum of these rows' amounts, so a backfill that
  -- disagreed with the header would make an issued bill stop adding up.
  UPDATE settlements s
     SET collector_id = b.collector_id, currency = b.currency
    FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id
   WHERE bl.settlement_id = s.id AND s.collector_id IS NULL;

  -- Everything not yet billed has one piece of evidence and no other: the
  -- session its episode was recorded under, read now, before this column makes
  -- that read unnecessary for ever.
  --
  -- The currency is the one part of this that cannot be read from anywhere.
  -- Nothing in the 0005 schema records a unit per row -- not on `settlements`,
  -- not on `tasks` -- so `PLAYERONE_CURRENCY` at the moment of the verdict is
  -- unrecoverable. It has to be supplied, and the earlier advice to "correct
  -- these columns before upgrading" was not advice anybody could take: the
  -- columns do not exist until this migration adds them, so there is nothing to
  -- correct beforehand. This is the input instead, and it is executable before
  -- the upgrade rather than after it:
  --
  --   ALTER DATABASE playerone SET playerone.upgrade_currency = 'USD';
  --
  -- Unset means VND, which is the default of `PLAYERONE_CURRENCY` and the only
  -- unit any deployment of this code has run with. The count is raised as a
  -- notice so an upgrade log says how many rows took an assumed unit rather
  -- than a read one.
  UPDATE settlements s
     SET collector_id = cs.collector_id,
         currency = coalesce(nullif(current_setting('playerone.upgrade_currency', true), ''), 'VND')
    FROM episode_reviews r
    JOIN episodes e ON e.episode_id = r.episode_id
    JOIN collection_sessions cs ON cs.id = e.collection_session_id
   WHERE r.id = s.episode_review_id AND s.collector_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '0006 upgrade: % unbilled settlement(s) took currency % and their session''s current collector. Neither was recorded in 0005; set playerone.upgrade_currency before upgrading if the unit was not that.',
      n, coalesce(nullif(current_setting('playerone.upgrade_currency', true), ''), 'VND');
  END IF;

  SELECT count(*) INTO n FROM settlements WHERE collector_id IS NULL OR currency IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % settlement(s) reach no collector through either a bill or a session, so who is owed cannot be established. Investigate them and re-run: select id, episode_review_id from settlements where collector_id is null;', n;
  END IF;

  -- The arithmetic rules are declared below as CHECKs. Counting them here first
  -- turns "ALTER TABLE failed" into a sentence naming how many rows and which
  -- rule, which is the difference between a five-minute fix and an hour.
  SELECT count(*) INTO n FROM settlements
   WHERE amount <> round(unit_price * effective_minutes, 4)
      OR unit_price < 0 OR effective_minutes < 0;
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % settlement(s) do not satisfy round(unit_price * effective_minutes, 4) = amount with both operands nonnegative. These were not written by money.ts; correct them and re-run.', n;
  END IF;

  -- A settlement worth nothing becomes `not_payable` below, and that is a
  -- terminal state. One that original 0005 already walked to `bill_generated`
  -- or `manually_paid` cannot go there -- and it cannot have a line either,
  -- because 0005's payable guard refused one. It is a state that lies about a
  -- document, so resolving it is a person's decision and not this migration's.
  SELECT count(*) INTO n FROM settlements
   WHERE amount = 0 AND settlement_state IN ('bill_generated', 'manually_paid');
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % settlement(s) worth 0.0000 claim to be billed or paid, which no bill can show. Resolve them and re-run.', n;
  END IF;

  -- Everything below is an invariant the guards further down enforce on new
  -- writes and cannot enforce on old ones. A trigger fires on the row in front
  -- of it; a row already in the table is never shown to it. So a database that
  -- ran original 0005 can hold a bill that breaks a rule this migration is
  -- about to declare -- and, once the freeze is installed, that bill can no
  -- longer be repaired: `bill_lines_issued_check` refuses a line for a header
  -- an earlier transaction wrote, `bill_lines_immutable_check` refuses to move
  -- or remove one, and `bills_document_immutable_check` refuses to relabel or
  -- delete the header. The window for a person to fix it is *now*, before the
  -- ALTER TABLEs below, which is why each of these stops rather than repairs.
  --
  -- The first is the one the relabel above creates. Original 0005 accepted a
  -- period ending at UTC midnight and billed everything owed before that
  -- instant; moving the label seven hours earlier can leave a line outside the
  -- window its own header now claims. Which is true -- the document's dates or
  -- its membership -- is not something a migration may decide, because either
  -- answer changes what a collector was paid for.
  SELECT count(*) INTO n FROM bill_lines bl
    JOIN bills b ON b.id = bl.bill_id JOIN settlements s ON s.id = bl.settlement_id
   WHERE s.created_at >= b.period_end;
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % bill line(s) fall outside the period their bill now claims, because a UTC-midnight period was relabelled to Vietnamese local midnight. Reconcile the bill dates against their lines and re-run: select bl.bill_id, bl.settlement_id, s.created_at, b.period_end from bill_lines bl join bills b on b.id = bl.bill_id join settlements s on s.id = bl.settlement_id where s.created_at >= b.period_end;', n;
  END IF;

  SELECT count(*) INTO n FROM bills b
   WHERE NOT EXISTS (SELECT 1 FROM bill_lines bl WHERE bl.bill_id = b.id);
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % bill(s) have no lines. An empty header is not a document, and after this migration it can be neither filled nor deleted, while bills_no_overlap blocks that collector''s real cycle for ever. Remove them and re-run.', n;
  END IF;

  SELECT count(*) INTO n FROM bills b
   WHERE b.total <> (SELECT coalesce(sum(s.amount), 0) FROM bill_lines bl
                      JOIN settlements s ON s.id = bl.settlement_id WHERE bl.bill_id = b.id);
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % bill(s) state a total that is not the sum of their lines. Both become immutable below, so the disagreement would be permanent. Resolve them and re-run.', n;
  END IF;

  SELECT count(*) INTO n FROM bill_lines bl JOIN settlements s ON s.id = bl.settlement_id
   WHERE s.settlement_state NOT IN ('bill_generated', 'manually_paid');
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % settlement(s) are on a bill but are not billed or paid. Resolve them and re-run.', n;
  END IF;

  SELECT count(*) INTO n FROM settlements s
   WHERE s.settlement_state IN ('bill_generated', 'manually_paid')
     AND NOT EXISTS (SELECT 1 FROM bill_lines bl WHERE bl.settlement_id = s.id);
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % settlement(s) claim to be billed or paid while on no bill, so there is nothing to show a finance person. Resolve them and re-run.', n;
  END IF;

  -- SET-01 as the new membership guard states it: the verdict decides, not the
  -- amount. 0005 checked only the amount, so a positive settlement from a
  -- failed review could reach a bill.
  SELECT count(*) INTO n FROM bill_lines bl JOIN settlements s ON s.id = bl.settlement_id
    LEFT JOIN episode_reviews r ON r.id = s.episode_review_id
   WHERE r.review_state IS DISTINCT FROM 'pass' AND r.review_state IS DISTINCT FROM 'partial_pass';
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % bill line(s) came from a review that is neither a pass nor a partial pass. Resolve them and re-run.', n;
  END IF;

  -- And the schedule `bills_schedule_guard` is about to install. It reads the
  -- established length off an existing row, so a history that already holds two
  -- lengths would pin whichever row the LIMIT happened to find.
  SELECT count(DISTINCT period_end - period_start) INTO n FROM bills;
  IF n > 1 THEN
    RAISE EXCEPTION '0006 upgrade: bills of % different lengths exist, so there is no one cycle length for this deployment to enforce. Reconcile them and re-run: select distinct period_end - period_start from bills;', n;
  END IF;

  SELECT count(*) INTO n FROM bills WHERE period_start > now();
  IF n > 0 THEN
    RAISE EXCEPTION '0006 upgrade: % bill(s) are dated in a cycle that has not started. Resolve them and re-run.', n;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "settlements" ALTER COLUMN "collector_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ALTER COLUMN "currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A cycle begins at local midnight in Vietnam and nowhere else. A UTC midnight
-- is 07:00 in Ho Chi Minh City, which is what a naive `new Date('2026-08-17')`
-- produces. `Asia/Ho_Chi_Minh` rather than a fixed `+07:00`: today they are the
-- same, and naming the zone makes a future political change the tz database's
-- problem instead of ours.
ALTER TABLE "bills" ADD CONSTRAINT "bills_period_local_midnight_check" CHECK ("bills"."period_start" = date_trunc('day', "bills"."period_start" at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
          and "bills"."period_end" = date_trunc('day', "bills"."period_end" at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh');--> statement-breakpoint
-- The money rule, as a row that cannot exist rather than as a function nobody
-- outside `money.ts` is obliged to call. `settlementFor` computes `amount` as
-- `quantise(unit_price x effective_minutes, 4)`; Postgres's `round(numeric, 4)`
-- is half away from zero, which is `quantise`'s rule, and both operands are
-- exact decimals. Note it is the *quantised* product: one second at 1 a minute
-- stores 0.016667 minutes and 0.0167, and the raw equality is false there.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amount_formula_check" CHECK ("settlements"."amount" = round("settlements"."unit_price" * "settlements"."effective_minutes", 4));--> statement-breakpoint
-- A negative price is not a discount, and a negative duration is not a refund.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_operands_nonneg_check" CHECK ("settlements"."unit_price" >= 0 and "settlements"."effective_minutes" >= 0);--> statement-breakpoint
-- SET-01, the state a rejected episode ends in.
--
-- The review lane writes a settlement for every verdict, a `fail` included, and
-- that row is the score of the review: `amount` 0.0000, and the thing a dispute
-- over a refused episode points at. Left in `pending_settlement` it is money
-- that is owed for ever and never paid -- every generation rescans it, the
-- standing backlog only grows, and nothing in the schema ever says it is
-- finished. `bill_lines_membership_guard` refuses it a line, so the row is
-- simultaneously "awaiting settlement" and unable to reach one.
--
-- `not_payable` is that outcome named. It is terminal: the transition guard
-- below gives it no outgoing edge, so a row cannot be quietly revived into the
-- payable queue. And it is where every settlement worth nothing must *start*,
-- which is the CHECK -- a row cannot be moved into it either, so nobody can
-- write real money off with an UPDATE.
--
-- The rule is the amount and not the verdict, deliberately: a partial pass
-- whose every span was cut is also worth 0.0000, and it would sit in the same
-- queue for ever for the same reason.
--
-- The CHECK is a biconditional and has to be. Written one way round -- `amount
-- > 0 OR state = 'not_payable'` -- it says only that a worthless row is
-- finished. It leaves the mirror image legal, and the mirror image is the
-- expensive one: the transition guard lets a row be *born* `not_payable`, so
-- one INSERT could put a formula-valid positive settlement straight into a
-- terminal state. Nothing then moves it -- `not_payable` has no outgoing edge
-- and `amount` is frozen -- so a real debt is written off permanently, by a
-- statement that violated no rule. `(amount = 0) = (state = 'not_payable')`
-- says the thing that was meant: worth nothing and finished are the same fact.
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_state_check";--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_state_check" CHECK ("settlements"."settlement_state" in ('pending_review', 'pending_settlement', 'bill_generated', 'manually_paid', 'exception', 'not_payable'));--> statement-breakpoint
-- The trigger is off for exactly this one statement, because the edge it would
-- refuse is the edge this migration makes legal once: the rows original 0005
-- left in `pending_settlement` are the backlog the new state exists for. The
-- preflight above has already proved none of them claims to be billed or paid.
ALTER TABLE "settlements" DISABLE TRIGGER "settlements_transition_guard";--> statement-breakpoint
UPDATE "settlements" SET "settlement_state" = 'not_payable', "updated_at" = now() WHERE "amount" = 0;--> statement-breakpoint
ALTER TABLE "settlements" ENABLE TRIGGER "settlements_transition_guard";--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_zero_not_payable_check" CHECK (("settlements"."amount" = 0) = ("settlements"."settlement_state" = 'not_payable'));--> statement-breakpoint
-- Cycles tile; they do not overlap.
--
-- `bills_collector_period_key` stops a *duplicate* period and nothing more.
-- `[17 Aug, 24 Aug)` and `[18 Aug, 25 Aug)` are different keys, both insertable,
-- and whichever generator ran first would have decided which cycle a settlement
-- was paid in. Overlap is not something you can validate one request at a time,
-- so it is made unrepresentable. This is Postgres's own construct for that
-- shape; `btree_gist` is what lets a uuid take part in a gist index alongside
-- the range. The unique index stays: it is what `ON CONFLICT` targets.
-- A cycle also has to sit on the lattice, not merely start at midnight.
--
-- The local-midnight check above accepts any pair of midnights, so raw SQL could
-- still issue a 7-day bill starting on a Tuesday and win the race for a
-- settlement the canonical Monday cycle wanted. The length of a cycle is
-- `period_end - period_start` and the anchor is 1970-01-05 00:00+07 -- epoch
-- 320400, a Monday -- so alignment is one modulo. `bills_period_check` already
-- guarantees the divisor is positive.
--
-- Alignment fixes the weekday and not the duration: a one-day bill starting on
-- the canonical Monday divides its own modulus and passes. That is the shape
-- `bills_schedule_guard` below refuses, because it is the one that does damage
-- -- it takes the lattice apart, and a bill cannot be deleted afterwards.
ALTER TABLE "bills" ADD CONSTRAINT "bills_period_aligned_check" CHECK (
  (extract(epoch from "period_start")::bigint - 320400)
    % (extract(epoch from "period_end")::bigint - extract(epoch from "period_start")::bigint) = 0
);--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_no_overlap"
  EXCLUDE USING gist (
    "collector_id" WITH =,
    tstzrange("period_start", "period_end", '[)') WITH &&
  );--> statement-breakpoint
-- The schedule itself, below every writer rather than in the service that
-- happens to know the configured value.
--
-- Two rules, and each closes a hole the constraints above leave open.
--
-- 1. **One length for the deployment.** Alignment is a modulo of the bill's own
--    length, so a one-day bill starting on the canonical Monday satisfies it,
--    sits inside the week, and blocks that collector's real cycle for ever --
--    `bills_no_overlap` refuses whichever comes second, and the second one is
--    the canonical bill. That is a denial of service on payroll that no
--    statement had to break a rule to cause. With the length fixed, aligned
--    periods tile: two bills either coincide, and the unique index refuses the
--    duplicate, or they are disjoint. `bills_no_overlap` stays as the backstop
--    that catches this trigger being disabled.
--
--    The length is *not* written down here. `PLAYERONE_SETTLEMENT_CYCLE_DAYS`
--    is `[ASSUMED]` in the brief's §13.2 -- weekly is nobody's decision yet --
--    so freezing 7 in the schema would decide it. Instead the first bill any
--    deployment issues establishes the length, and every bill after it must
--    agree. The configured value reaches the database once, by being used, and
--    then cannot change silently. Changing it deliberately is a migration,
--    which is the right ceremony for repricing a payroll cycle: the periods
--    before and after a length change do not tile, so history and future would
--    otherwise overlap.
--
--    ponytail: one length for every collector, not one per collector. Nothing
--    asks for two schedules; if a second payee class ever needs one, this reads
--    a length off the collector rather than off the first row.
--
-- 2. **A cycle that has not started cannot be billed.** `settleable` has no
--    lower bound -- late obligations join the next cycle on purpose -- so a
--    bill dated a week ahead sweeps up everything owed today and labels it as
--    work nobody has done yet. `settle.ts` refuses it with a 422; this is the
--    same rule for a psql session. `now()` is transaction start, and a period
--    that has started stays started, so this never turns a valid row invalid.
CREATE FUNCTION bills_schedule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE established interval;
BEGIN
  SELECT b.period_end - b.period_start INTO established FROM bills b WHERE b.id <> NEW.id LIMIT 1;
  IF established IS NOT NULL AND NEW.period_end - NEW.period_start <> established THEN
    RAISE EXCEPTION
      'bills_cycle_length_check: this deployment bills every % and bill % claims %',
      established, NEW.id, NEW.period_end - NEW.period_start
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bills_cycle_length_check';
  END IF;
  IF NEW.period_start > now() THEN
    RAISE EXCEPTION
      'bills_cycle_started_check: the cycle beginning % has not started', NEW.period_start
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bills_cycle_started_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bills_schedule_guard
  BEFORE INSERT ON bills
  FOR EACH ROW EXECUTE FUNCTION bills_schedule_guard();--> statement-breakpoint
-- SET-05's edges, extended. `CREATE OR REPLACE` rather than a second function:
-- 0005 is applied and immutable, and there is exactly one place the rule lives.
--
-- Three things change from 0005's body.
--
-- 1. `collector_id`, `currency` and `created_at` join the frozen columns. Who is
--    owed and in what unit are as much a part of what the row is worth as the
--    number; and `created_at` is what decides which cycle an obligation falls
--    in, so an editable one lets raw SQL move money between bills.
-- 2. `bill_generated` and `manually_paid` require a bill line. Without it the
--    whole lane is walkable on a row that is on no bill: the settlement claims
--    it was billed and paid and there is nothing to show a finance person. A
--    state name has to be a fact about the world.
-- 3. `bill_generated -> exception` is removed. It looked kinder and was a trap.
--    `bill_lines` membership is written once, so a settlement that left a bill
--    would still be on it: the header would go on counting money nobody intends
--    to pay, and re-billing it in a later cycle would fail for ever on
--    `bill_lines_settlement_key`. The state would say "recoverable" and the
--    schema would say otherwise. An issued bill is final; correcting one is a
--    credit note against a new bill, which this system does not have and which
--    is named as owed in docs/review.md.
CREATE OR REPLACE FUNCTION settlements_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.settlement_state NOT IN ('pending_review', 'pending_settlement', 'not_payable') THEN
      RAISE EXCEPTION
        'settlements_transition_check: a settlement cannot start at %', NEW.settlement_state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.effective_minutes IS DISTINCT FROM OLD.effective_minutes
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.episode_review_id IS DISTINCT FROM OLD.episode_review_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.collector_id IS DISTINCT FROM OLD.collector_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'settlements_amount_immutable_check: what a settlement is worth is written once'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_amount_immutable_check';
  END IF;

  IF NEW.settlement_state = OLD.settlement_state THEN
    RETURN NEW;
  END IF;

  IF (OLD.settlement_state || '->' || NEW.settlement_state) NOT IN (
       'pending_review->pending_settlement',
       'pending_review->exception',
       'pending_settlement->bill_generated',
       'pending_settlement->exception',
       'bill_generated->manually_paid',
       'exception->pending_settlement'
     ) THEN
    RAISE EXCEPTION
      'settlements_transition_check: % cannot become %', OLD.settlement_state, NEW.settlement_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_transition_check';
  END IF;

  IF NEW.settlement_state IN ('bill_generated', 'manually_paid')
     AND NOT EXISTS (SELECT 1 FROM bill_lines WHERE settlement_id = NEW.id) THEN
    RAISE EXCEPTION
      'settlements_billed_has_line_check: settlement % cannot be % while it is on no bill',
      NEW.id, NEW.settlement_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'settlements_billed_has_line_check';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
-- `bill_lines_payable_guard` becomes `bill_lines_membership_guard`, because the
-- payable rule was only one of four things a line has to satisfy and they all
-- belong at the same moment.
--
-- The two foreign keys are independent: nothing in `bill_id uuid` and
-- `settlement_id uuid` says the two have to agree about whose money this is. On
-- their own they allow one collector's settlement to be attached to another
-- collector's bill, and allow a line to be moved or deleted after the header was
-- totalled -- and then `bills.total` means nothing.
--
-- SET-01's rule gains its missing half too. 0005 refused a line worth nothing,
-- which catches a `fail` in practice because the review lane scores it 0.0000.
-- It is the amount that was checked, not the verdict, so raw SQL could attach a
-- formula-valid positive settlement to a failed review and bill it. The review
-- state is now what decides, with the amount kept as the second condition.
DROP TRIGGER bill_lines_payable_guard ON bill_lines;--> statement-breakpoint
DROP FUNCTION bill_lines_payable_guard();--> statement-breakpoint
CREATE FUNCTION bill_lines_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s settlements%ROWTYPE;
        b bills%ROWTYPE;
        verdict text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'bill_lines_immutable_check: a bill line is written once (attempted %)', TG_OP
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_immutable_check';
  END IF;

  -- Membership is frozen at issuance, not merely append-only.
  --
  -- Refusing UPDATE and DELETE stops a line being taken off a bill. It does not
  -- stop one being *added* to a bill issued last month: append an eligible
  -- settlement, move it to `bill_generated`, raise the header to the new sum,
  -- and every guard above is satisfied inside that one transaction -- while a
  -- bill finance already paid quietly becomes partly unpaid.
  --
  -- So a line may only be written by the transaction that created its bill.
  -- `xmin` is the inserting transaction of the header row and equals
  -- `pg_current_xact_id()` exactly when that is this one; the generator writes
  -- header, lines and states together, so it passes, and nothing later can.
  PERFORM 1 FROM bills WHERE id = NEW.bill_id AND xmin = pg_current_xact_id()::xid;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'bill_lines_issued_check: bill % was issued by an earlier transaction and its lines are fixed',
      NEW.bill_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_issued_check';
  END IF;

  SELECT * INTO s FROM settlements WHERE id = NEW.settlement_id;
  SELECT * INTO b FROM bills WHERE id = NEW.bill_id;
  SELECT r.review_state INTO verdict FROM episode_reviews r WHERE r.id = s.episode_review_id;

  -- SET-01: settlement records generate from pass and partial-pass reviews.
  IF verdict IS DISTINCT FROM 'pass' AND verdict IS DISTINCT FROM 'partial_pass' THEN
    RAISE EXCEPTION
      'bill_lines_payable_check: settlement % came from a % review, which is not billable',
      NEW.settlement_id, coalesce(verdict, 'missing')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_payable_check';
  END IF;

  IF coalesce(s.amount, 0) <= 0 THEN
    RAISE EXCEPTION
      'bill_lines_payable_check: settlement % is worth %, which is not billable',
      NEW.settlement_id, s.amount
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_payable_check';
  END IF;

  IF s.collector_id IS DISTINCT FROM b.collector_id OR s.currency IS DISTINCT FROM b.currency THEN
    RAISE EXCEPTION
      'bill_lines_owner_check: settlement % (collector %, %) does not belong on bill % (collector %, %)',
      NEW.settlement_id, s.collector_id, s.currency, NEW.bill_id, b.collector_id, b.currency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_owner_check';
  END IF;

  -- The line has to sit inside the period its header claims, or the cycle dates
  -- on a bill stop describing the work on it.
  IF s.created_at >= b.period_end THEN
    RAISE EXCEPTION
      'bill_lines_period_check: settlement % was owed at %, after bill % ends at %',
      NEW.settlement_id, s.created_at, NEW.bill_id, b.period_end
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_period_check';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bill_lines_membership_guard
  BEFORE INSERT OR UPDATE OR DELETE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION bill_lines_membership_guard();--> statement-breakpoint
-- The other direction of the same causality.
--
-- The transition guard says a settlement cannot be `bill_generated` without a
-- line. This says a line cannot exist unless its settlement is billed. The pair
-- is circular by construction, so this half has to be deferred: the generator
-- writes header, lines and states inside one transaction, and at COMMIT both
-- statements are true. What it refuses is the state a crash between two
-- transactions would leave -- a bill whose lines nobody ever moved.
CREATE FUNCTION bill_lines_settled_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
  SELECT settlement_state INTO state FROM settlements WHERE id = NEW.settlement_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF state NOT IN ('bill_generated', 'manually_paid') THEN
    RAISE EXCEPTION
      'bill_lines_settled_check: settlement % is on a bill but is still %',
      NEW.settlement_id, state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bill_lines_settled_check';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bill_lines_settled_guard
  AFTER INSERT ON bill_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bill_lines_settled_guard();--> statement-breakpoint
-- `bills.total` is a denormalisation, and this is the price of keeping it.
--
-- Every other guard here protects one row. This is the only cross-row invariant
-- in the money chain, and "the header equals the sum of its lines" is not a
-- property any single INSERT can be judged against: the generator writes the
-- header before the lines it is the sum of. A CONSTRAINT TRIGGER deferred to
-- commit is the native answer.
--
-- Deriving the total instead would remove the need for this, and was rejected: a
-- bill is a document finance sends, and the number on it has to be the number
-- that was issued, not one recomputed by whatever query runs next. With the
-- amount frozen, the membership frozen and the owner forced to match, a total
-- that added up once adds up for ever.
CREATE FUNCTION bills_total_matches_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
        summed numeric(14,4);
        stated numeric(14,4);
BEGIN
  -- IF and not a CASE in the DECLARE: plpgsql plans a default expression as one
  -- SQL statement, so `CASE ... THEN NEW.id ELSE NEW.bill_id END` would have to
  -- resolve both field names against whichever record it was handed, and `bills`
  -- has no `bill_id`.
  IF TG_TABLE_NAME = 'bills' THEN target := NEW.id; ELSE target := NEW.bill_id; END IF;

  -- The bill may have been rolled back out from under a deferred check.
  SELECT b.total INTO stated FROM bills b WHERE b.id = target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(sum(s.amount), 0) INTO summed
    FROM bill_lines bl JOIN settlements s ON s.id = bl.settlement_id
   WHERE bl.bill_id = target;
  IF summed <> stated THEN
    RAISE EXCEPTION
      'bills_total_matches_lines: bill % states % but its lines sum to %', target, stated, summed
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bills_total_matches_lines';
  END IF;
  -- And a bill with no lines is not a bill. `0 = 0` satisfies the sum rule, so
  -- an empty header is otherwise perfectly legal -- and permanent, because
  -- `bills_document_immutable_guard` refuses to delete one and
  -- `bills_no_overlap` then blocks that collector's real cycle for ever. It
  -- also tells a collector, in a document, that a week's work was worth
  -- nothing. The generator cannot produce one: it only reaches a payee that has
  -- lines. This is the same statement for everything that is not the generator.
  IF summed <= 0 THEN
    RAISE EXCEPTION
      'bills_total_matches_lines: bill % has no billable lines, so it is not a document', target
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bills_total_matches_lines';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bills_total_matches_lines
  AFTER INSERT OR UPDATE ON bills
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bills_total_matches_lines();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bills_total_matches_lines
  AFTER INSERT ON bill_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bills_total_matches_lines();--> statement-breakpoint
-- A bill is a document. Its identity is written once.
--
-- Everything above freezes the *lines*; without this the header could still be
-- relabelled. `UPDATE bills SET collector_id = ...` reruns none of the
-- membership checks, because those fire on `bill_lines`, so an issued bill could
-- be moved to another payee, redenominated, or dated into a different cycle
-- while every line stayed where it was. `total` is not on this list: it is
-- pinned by `bills_total_matches_lines`, which is the stronger statement.
CREATE FUNCTION bills_document_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'bills_document_immutable_check: an issued bill is not deleted'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bills_document_immutable_check';
  END IF;
  IF NEW.collector_id IS DISTINCT FROM OLD.collector_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.generated_at IS DISTINCT FROM OLD.generated_at THEN
    RAISE EXCEPTION
      'bills_document_immutable_check: bill % cannot be relabelled after it is issued', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bills_document_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER bills_document_immutable_guard
  BEFORE UPDATE OR DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION bills_document_immutable_guard();
