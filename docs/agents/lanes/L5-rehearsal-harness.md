# L5 — Path C rehearsal harness, evidence bundle, payment runbook   (model: Sonnet)

## Mission
Make Thursday's paid loop repeatable and its evidence machine-readable, and
re-prove today that GreenNode is reachable with the local keys. No new product code.

## Base
`sprint/demo-candidate` in worktree `C:/Users/user/pw/rehearsal`, branch `chore/rehearsal-harness`.

## Deliverables
1. `packages/api/scripts/demo-evidence.mjs`: given a database URL and any of
   collector / session / episode / ingest / handover / batch / bill / attempt IDs, print ONE JSON
   with every linked row, file digests, measured vs effective duration, unit price,
   exact bill total, floored attempt amount, transfer reference, timestamps, and
   the source SHA of the running server. Read-only. No credentials in output.
2. `deploy/centre/DEMO-SCRIPT.md`: the meeting acceptance script as numbered operator
   steps, each naming the command or screen and the evidence field it produces.
   Include the honest fallback line for "awaiting payment" if ZaloPay verification is absent.
3. Payment runbook section: counter declares the destination
   (`POST /api/payout/collectors/:id/accounts`), a non-finance operator runs the cycle,
   finance marks paid with the real reference. Name the four env vars that unblock
   the real verifier (`PLAYERONE_ZALOPAY_APP_ID / KEY1 / PUBLIC_KEY / PAYMENT_ID`) and the
   exact refusal seen without them (`payout_attempts_account_unverified`).
4. Card procedure for Windows: the TF card is ext4. Document and, if a reader is
   attached, test: `usbipd attach --wsl --busid <id>` → mount in WSL Ubuntu →
   copy the session directory read-only to the centre inbox → `sha256sum` before
   and after. No reader is attached today: write it, mark untested.
5. Re-run `packages/api/scripts/e2e-loop.mjs` with `STORAGE_*` from the root
   `.env.local` (GreenNode HCM04) on throwaway `po_rehearsal_*` with the real corpus,
   as on 2026-09-08. Report checks passed and that the bucket holds what it held
   before. This is today's proof that the cloud leg is unblocked.

## Rules
Never point seed scripts at retained data. Never format or clear a card. Drop
your database afterwards. Report your own numbers. Do not push.
