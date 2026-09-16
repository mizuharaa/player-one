-- 0035: signing in with an ordinary Zalo account.
--
-- HAND-WRITTEN. Drizzle generates neither the grant block nor a comment for
-- the reason a column exists, and the whole value of this file is the reason.
--
-- Owner's decision, 2026-09-16, which overrides "the sign-in code is delivered
-- over ZNS and do not build a second channel" (2026-08-29, CLAUDE.md): VNG's
-- ZNS Official Account is not available, so a collector's ZNS code cannot be
-- sent at all. Sign-in has to work for anybody who holds an ordinary Zalo
-- account, which is Zalo Login (OAuth v4) and not ZNS: it needs no Official
-- Account, no approved template and no per-message quota, and the credential
-- is the Zalo session the person is already signed in to on that phone.
--
-- Two things, and they are one change: somewhere to keep the identity Zalo
-- gives back, and somewhere to keep one sign-in attempt while it is in flight.
--
-- ---------------------------------------------------------------------------
-- 1. `collectors.zalo_id` — who Zalo says this is.
--
-- Zalo's `id` from `graph.zalo.me/v2.0/me` is stable per (app, user) and is
-- the only identifier the profile call returns that we may rely on; the name
-- and the picture change, and the phone number is NOT available to us (reading
-- it needs a separate, approved permission we do not hold — see
-- `docs/sign-in-channels.md`). So a Zalo sign-in cannot fill `phone`, and this
-- column is the second way a `collectors` row can be found.
--
-- Nullable, because every collector enrolled before today has no Zalo id, and
-- unique for exactly the reason `collectors_phone_key` is unique: the lookup is
-- by this column alone, so there must be one row or none and never a first row.
-- Postgres lets a unique index hold any number of nulls and one of each value,
-- which is the property that makes both true at once.
ALTER TABLE collectors ADD COLUMN zalo_id text;--> statement-breakpoint
CREATE UNIQUE INDEX collectors_zalo_id_key ON collectors (zalo_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `zalo_sign_ins` — one attempt, from the first tap to the app's session.
--
-- The flow is three requests and the state between them cannot live in the
-- app: the middle one arrives from Zalo's servers on a redirect, in a browser,
-- with no token on it. So it lives here, and one row is one attempt:
--
--   POST /auth/collector/zalo/start     writes the row: `state`, `code_verifier`
--   GET  /auth/collector/zalo/callback  spends `state`, writes `ticket_hash`
--   POST /auth/collector/ticket         spends `ticket_hash`, issues the token
--
-- `code_verifier` is the PKCE secret and it MUST NOT leave the server: the
-- `code_challenge` goes to Zalo, the verifier is presented once at the token
-- exchange, and that pairing is what stops an intercepted `code` from being
-- redeemed by anybody else. `state` is the CSRF half — the callback is refused
-- unless it names a row this server wrote.
--
-- Why one table and not two: the second and third steps are the same attempt
-- by the same person seconds apart, and splitting them would mean a foreign
-- key, a second expiry and a second reaper for a row that is dead inside ten
-- minutes either way. Each half has its own spent-marker, and each is spent by
-- an UPDATE carrying `... is null` in its `where` — the same "only the UPDATE
-- winner proceeds" shape `collector.ts` already uses to make a code
-- single-use, and what makes a replayed ticket a refusal rather than a second
-- session.
--
-- `ticket_hash` is a SHA-256 of a 256-bit random token, not scrypt. scrypt is
-- for a secret a person can type — six digits, a password — where the cost is
-- the defence. A 256-bit random token has nothing to brute-force, and the
-- lookup here is BY the token, which scrypt's per-row salt makes impossible
-- without a table scan. What matters is that the plaintext ticket is not in a
-- column, and a digest is enough for that.
--
-- `collector_id` references nothing on purpose: it is the answer the callback
-- already computed, held for one more request, and a foreign key with a
-- cascade on it would be machinery for a row with a ten-minute life.
--
-- THE CEILING: THIS TABLE ONLY GROWS, AND THERE IS NO REAPER — the same
-- ceiling `sign_up_codes` states in 0034, for the same reason (the application
-- is granted no DELETE, so a spent row is marked and not removed), and with
-- the same upgrade path: `DELETE FROM zalo_sign_ins WHERE created_at < now() -
-- interval '<n> days'` run as the schema owner once the row count is worth a
-- cron job. At pilot scale it is one small row per sign-in attempt and nothing
-- reads it but a lookup on a unique index.
CREATE TABLE zalo_sign_ins (
  -- The `state` parameter, and the primary key for the same reason
  -- `sign_up_codes.phone` is one: the callback looks up by it alone.
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  -- Ten minutes, and it covers BOTH halves: the hop from the callback to the
  -- app's deep link is immediate, so one deadline is honest and two would be a
  -- second thing to get wrong.
  expires_at timestamptz NOT NULL,
  -- When the callback spent the state. Null until then.
  callback_at timestamptz,
  -- Written by the callback, with `collector_id`. Null before it, and after it
  -- the only way in.
  ticket_hash text,
  collector_id uuid,
  ticket_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zalo_sign_ins_state_check CHECK (length(trim(state)) > 0),
  -- RFC 7636 §4.1: a code verifier is 43 to 128 characters.
  CONSTRAINT zalo_sign_ins_verifier_check CHECK (length(code_verifier) between 43 and 128),
  -- A ticket and the collector it signs in are one fact. Both or neither, the
  -- same shape as `collectors_sign_in_code_check`: half of this pair written is
  -- either a ticket that signs in nobody, or a name with no way to present it.
  CONSTRAINT zalo_sign_ins_ticket_check CHECK ((ticket_hash IS NULL) = (collector_id IS NULL)),
  -- A ticket cannot exist before the callback that minted it, and cannot be
  -- used before it exists.
  CONSTRAINT zalo_sign_ins_ticket_order_check CHECK (ticket_hash IS NULL OR callback_at IS NOT NULL),
  CONSTRAINT zalo_sign_ins_used_order_check CHECK (ticket_used_at IS NULL OR ticket_hash IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX zalo_sign_ins_ticket_hash_key ON zalo_sign_ins (ticket_hash);--> statement-breakpoint

-- Per 0021, 0033 and 0034, and the absence of DELETE is the point: a spent
-- state and a spent ticket are both marked by the UPDATE that spends them.
-- `ALTER DEFAULT PRIVILEGES` in 0021 already covers a table created later by
-- the same user; this block is what makes the grant true when it does not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'playerone_app') THEN
    GRANT SELECT, INSERT, UPDATE ON zalo_sign_ins TO playerone_app;
    REVOKE DELETE, TRUNCATE ON zalo_sign_ins FROM playerone_app;
  END IF;
END $$;
