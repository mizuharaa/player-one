# Payout demo state

Branch: `lane/payout-honest`. Each work-order step is committed; nothing pushed. No emulator launched.
No live verification or transfer was performed. Fixture-paid proofs use only `po_pay*` test databases.
Sandbox phone and console views visibly say simulation/no live transfer. Keep sandbox databases and bills separate from live.
Live “paid” requires an actual transfer; mark-paid records the finance operator's transfer reference, it does not send money.

| State | What sets it | Phone | Finance console |
|---|---|---|---|
| Declared | `POST /api/payout/accounts` (finance), or `/api/payout/collectors/:id/accounts` (counter) | Masked destination from `GET /api/me/payout` | Declared name, masked destination, verification status |
| Unverified | Declaration without verification credentials, an unconfirmed name, or another unsuccessful verification | `awaiting`: “Awaiting payment — destination unverified” | Same awaiting sentence and unverified status |
| Verified | Declaration with a matching provider-confirmed name; raw SQL fixture only in tests | Verified destination | Verified destination; sandbox simulation label |
| Paid | `POST /api/payout/bills/:id/mark-paid` by eligible finance actor | Latest successful reference; income reads `paid` with `payment_reference` after reload or refresh | Paid, reference X; sandbox simulation label |

English, Vietnamese and Chinese render both awaiting and paid sentences. Vietnamese: “Chờ thanh toán. Nơi nhận tiền chưa xác minh.” / “Đã thanh toán. Mã giao dịch: X”.
The console header and `GET /api/engineering/status` expose the configured sandbox environment.
Unverified payment: `409 payout_attempts_account_unverified`; bill, settlement and attempt rows stay byte-identical, with an attributed refusal audit.
Verdict authors are refused by `payout_reviewer_separation_of_duty` in the handler and appended migration `0031_payout_verdict_author`; existing creator/issuer/declarer separation remains.
Independent tests cover collector isolation, wrong role (403), wrong amount (409), duplicate replay and concurrent duplicate replay with one attempt.
The fixture proves `679.9992 → 679` dong, reference `SIMULATION-REF-X`, and the finance audit actor. `IDENT.NAME_UNCONFIRMED` stays unverified and cannot pay.

Proof commands (PowerShell, repository root; observed output tails follow each command):

```powershell
docker exec playerone-pg createdb -U postgres po_pay
$env:DATABASE_URL='postgres://postgres:playerone@localhost:5433/po_pay'
$env:PLAYERONE_DB_ROLE='playerone_app'
$env:PLAYERONE_REQUIRE_CORPUS='1'
$env:PLAYERONE_SESSIONS='C:\Users\Khang\OneDrive\Documents\player-one\docs\sample_data\EgoCamera Sample Data'
$g=@('--testTimeout=180000','--hookTimeout=180000','--maxWorkers=2','--minWorkers=1')
pnpm typecheck
# tsc; exit 0
pnpm --filter @playerone/collector typecheck
# tsc -p tsconfig.json --noEmit; exit 0
pnpm exec vitest run packages/api/test/payout packages/api/test/me.test.ts packages/api/test/backoffice.test.ts packages/api/test/backoffice-role.test.ts packages/api/test/settle.test.ts packages/api/test/engineering.test.ts apps/console/src/payout apps/console/src/components/shell/payout-environment.test.tsx @g
# Test Files 29 passed | 1 skipped (30); Tests 496 passed | 5 skipped (501)
pnpm exec vitest run packages/api/test/payout/honest.test.ts packages/api/test/payout/domain/routes.test.ts @g
# Final replay-race change: Test Files 2 passed (2); Tests 50 passed (50); root typecheck also passed again.
Remove-Item Env:DATABASE_URL
pnpm exec vitest run @g
# Test Files 83 passed | 41 skipped (124); Tests 1113 passed | 885 skipped (1998)
pnpm exec vitest run apps/collector/test --testTimeout=180000 --maxWorkers=2 --minWorkers=1
# Test Files 12 passed (12); Tests 116 passed (116)
pnpm --filter @playerone/collector test:release
# tests 13; pass 13; fail 0; skipped 0
```

The test harness alone enables `PLAYERONE_ALLOW_SUPERUSER=1` for database creation/migration; API authorization proofs use `playerone_app`.
The database-free run intentionally skips database tests; the complete five-session media corpus is required and present.
The five provider sandbox tests skip because verification credentials are unavailable; no live payout is claimed.
Cleanup: `CHECKPOINT` completed, then 16 `po_pay*` databases were dropped without FORCE. Final database count: `0`.
