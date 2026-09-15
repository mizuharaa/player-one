-- A verified destination has to carry the name ZaloPay returned.
--
-- The payable question is asked in three places — `payout_attempts_guard`
-- (0012, replayed by 0016), `payout_finance_in_transaction` (0018, carried
-- forward by 0031) and `refusalFor` in the handler — and all three ask
-- `verify_status <> 'verified'` plus, for a WALLET, that `m_u_id` is present.
-- None of them asks for `verified_name`. So a row reading
-- `verify_status = 'verified'`, `verified_name = NULL`, `m_u_id = 'mu-unnamed'`
-- — which is exactly what ZaloPay's IDENT.NAME_UNCONFIRMED answer used to
-- store — was payable: the P0-4 audit's probe marked such a bill paid, 201,
-- 679 dong, reference UNNAMED-BUT-PAID.
--
-- `outcomeOf` (packages/api/src/payout/domain/verify.ts) now maps that answer
-- to `unverified`, and that stays. But it is one line of TypeScript in front of
-- the only writer we have today, and CLAUDE.md's rule is that invariants belong
-- in the schema: this is the same question, asked where a psql session, a
-- migration script and a service written by somebody else all have to answer
-- it.
--
-- Existing rows. This is a plain ADD CONSTRAINT, so Postgres validates every
-- row already in the table and the migration fails, naming this constraint, if
-- any row is verified without a name. No such row can exist: `outcomeOf` is the
-- only writer of `verify_status` (`payout.ts`, the declare and re-verify
-- routes), and it has only ever returned `verified` together with the name the
-- provider returned — before this lane a nameless answer became `verified` with
-- `verifiedName` carrying ZaloPay's value, and where there was no value at all
-- it is `unverified`. `payout_accounts_append_only` (0012) then forbids editing
-- either column afterwards. If a database somewhere does hold one — hand-seeded
-- in a test run, say — failing loudly is the honest outcome: that row is a
-- destination somebody could have been paid on without a verified name, and a
-- human has to look at it rather than have it silently kept or silently
-- dropped.
--
-- Named explicitly, 36 bytes, well inside Postgres's 63.
ALTER TABLE payout_accounts
  ADD CONSTRAINT payout_accounts_verified_named_check
  CHECK (verify_status <> 'verified'
         OR (verified_name IS NOT NULL AND length(trim(verified_name)) > 0));
