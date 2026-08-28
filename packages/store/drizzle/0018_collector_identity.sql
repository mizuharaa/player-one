-- 0018: a collector can sign in.
--
-- APP-01, SEC-01, PLT-06. Before this, `collectors` held a reference, a status
-- and an exam result, and nothing a person could present. Only machines,
-- operators and reviewers could authenticate, so every collector-facing route
-- was blocked on the identity, not on the route.
--
-- PaXini's PRD §7.1 registers a collector by phone number with NO password, so
-- what lands here is a phone number and a place to keep one short-lived code:
-- a scrypt hash of the code, the moment it dies, and how many times it has been
-- offered. There is no long-lived secret on this table and there must not be
-- one — the credential is possession of the number.
--
-- Every column is nullable or defaulted, so this migrates a populated table
-- without touching a row. Collectors enrolled before today have no phone and
-- therefore cannot sign in, which is correct: nobody has confirmed a number for
-- them.
--
-- `collectors_phone_key` is a unique index on a nullable column. Postgres holds
-- any number of nulls under one and exactly one of each number, which is what
-- makes the sign-in lookup safe: it is by phone alone, so there is one row or
-- none and never a first row.
--
-- `token_epoch` is the revocation story for a credential that lives in a
-- pocket. The token carries the number and every request checks it against the
-- row, so `update collectors set token_epoch = token_epoch + 1 where id = ...`
-- signs that collector out of every device at once. A table of live tokens
-- would be a second write on every sign-in and a pruning job forever.
--
-- The only existing object that changes is `audit_events_actor_role_check`,
-- which gains 'collector'. The predicate is strictly weaker than the old one,
-- so every existing row still satisfies it and the ADD validates without a
-- rewrite. `audit_events_attributed_check` is NOT touched: it already exempts
-- `%.login` and `%.login_failed` by action (0017), which is every row a
-- collector can currently write, and it refuses every other shape carrying the
-- new role — a collector cannot be recorded as the actor on a mutation until
-- somebody adds a collector mutation and decides what that row looks like.
ALTER TABLE "collectors" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "sign_in_code_hash" text;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "sign_in_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "sign_in_code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "token_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "collectors_phone_key" ON "collectors" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_sign_in_code_check" CHECK (
  ("collectors"."sign_in_code_hash" is null) = ("collectors"."sign_in_code_expires_at" is null)
);--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_sign_in_code_attempts_check" CHECK (
  "collectors"."sign_in_code_attempts" >= 0
);--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_token_epoch_check" CHECK (
  "collectors"."token_epoch" >= 1
);--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_role_check";--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_role_check" CHECK (
  "audit_events"."actor_role" in ('operator', 'reviewer', 'collector')
);
