# Payout demo state

What each payout state is, which route sets it, and what each surface says. Written for the demo
operator. No live verification or transfer has ever been performed here: `mark-paid` records the
reference of a transfer a finance operator made by hand, it does not send money.

| State | What sets it | Phone (`GET /api/me/payout`) | Finance console |
|---|---|---|---|
| None | no account declared | `none`, no masked number, no payment | no destination on the bill |
| Declared / unverified | `POST /api/payout/accounts` (finance) or `/api/payout/collectors/:id/accounts` (counter); no provider client, an unconfirmed name, or any unsuccessful answer | `awaiting` + masked number + "Awaiting payment — destination unverified" | declared name, masked number, `unverified`, same awaiting sentence |
| Verified | a provider answer whose name matches; in tests, a raw-SQL fixture | `verified` + masked number | `verified`, with the provider's name |
| Paid | `POST /api/payout/bills/:id/mark-paid` by an eligible finance actor | "Paid, reference X" for the payment made to the **current** destination | "Paid, reference X" on the bill |

en/vi/zh all carry both sentences. Vietnamese: "Chờ thanh toán. Nơi nhận tiền chưa xác minh." /
"Đã thanh toán. Mã giao dịch: X".

## The two rules that are easy to get wrong

**A payment belongs to the destination that received it.** `/api/me/payout` joins the attempt to
the collector's current account. Scoped to the collector instead, it told a collector who had just
changed wallet "awaiting payment — destination unverified" and "paid, reference OLD-REF" in the same
card. A collector with no current account gets no payment line at all.

**"Simulation. No live transfer." is about one outcome, not about the deployment.**
Verification and API-attempt provenance is recorded in the existing immutable audit event when the outcome is created. Persisted account and payment reads use `storedSimulation`; the two mark-paid replies use the manual outcome and required real transfer reference through `isSimulation` (also yielding false); changing server credentials later cannot relabel an old sandbox outcome as production. Missing historical provenance stays Simulation. A manual payment with its actual transfer reference remains real, while its destination retains a separate verification label. Verification/payment notifications also retain their own Simulation label.

The provider environment in the console header and aggregate income responses describes configuration, not proof that a transfer occurred.

## Where the sandbox word lives, and why three settle screens carry no per-bill sentence

`/api/payout/environment` answers `{ environment: 'sandbox', simulation: true }` and
`GET /api/engineering/status` reports `payout_environment`. The console header renders it from
`PayoutEnvironment`, which sits in `AppShell`, which every `SettleShell` screen wraps — so Settle,
Preflight, Exceptions and Bill all show the environment, on every tab, with no way to reach a money
screen without it.

`settle.simulation`, the per-bill sentence, is on BillScreen only, and that is deliberate. The other
three screens list bills; a per-row simulation badge on a list where every row would carry it adds
no information the header has not already given, and the sentence belongs next to the one payment it
describes. The audit's preference was to state this rather than spread the badge, so this is the
statement.

## Refusals

- Unverified destination: `409 payout_attempts_account_unverified`. Bill, settlement and attempt
  rows stay byte-identical, and the refusal is audited to the finance actor.
- A verified destination with no verified name cannot exist: `payout_accounts_verified_named_check`,
  appended migration `0032_payout_verified_named`. `IDENT.NAME_UNCONFIRMED` maps to `unverified` in
  `verify.ts` as well, but the constraint is what closes the row shape to a direct insert.
- Verdict author: `payout_reviewer_separation_of_duty`, in the handler and in
  `payout_finance_in_transaction` (migration `0031_payout_verdict_author`).
- Wrong amount: `409 payout_attempts_amount_check`. Wrong role: `403`. A second identical mark-paid:
  `200 replayed`, one attempt.
- **`payout_account_unverified` in `PAYOUT_REFUSALS` is dead and has been left in place.** Nothing
  raises it since the `batch.ts` rename; its three i18n sentences are dead with it. It is not
  removed because CLAUDE.md says not to delete pre-existing dead code unasked, and because
  `deploy/DEMO-RUNBOOK.md` and `packages/api/scripts/seed-stakeholder.mjs` still tell the operator to
  say that name out loud. **The name the API actually answers is
  `payout_attempts_account_unverified`** — the runbook is wrong about this, and that is worth fixing
  in the runbook rather than by keeping a dead constant honest.

## Who may look, and who may act

Finance acts. The administrator — the demo's single `op-1` credential — reads every finance view
(`financeReadGuard`, GETs only: batches, bills, attempts, the masked account detail, the collector
statement) and is refused every finance action and both exports with `403 finance role required`.
A counter operator reads none of it. Nothing about separation of duty moved: those rules are in the
schema.

## Historical payout-honest proof (before the sandbox lane)

Docker `playerone-pg:5433`, `DATABASE_URL=…/po_payfix`, `PLAYERONE_DB_ROLE=playerone_app`,
`PLAYERONE_REQUIRE_CORPUS=1`, `PLAYERONE_SESSIONS` at the five-session corpus.
`--maxWorkers=2 --minWorkers=1` is load-bearing: unbounded, 32 database files in parallel fail on
contention (measured, 19 files / 20 tests).

```
pnpm exec tsc -p tsconfig.json --noEmit                       # exit 0
pnpm exec tsc -p apps/collector/tsconfig.json --noEmit        # exit 0
pnpm exec vitest run packages/api/test/payout packages/api/test/me.test.ts \
  packages/api/test/backoffice.test.ts packages/api/test/backoffice-role.test.ts \
  packages/api/test/settle.test.ts packages/api/test/engineering.test.ts packages/store/test \
  --testTimeout=180000 --hookTimeout=180000 --maxWorkers=2 --minWorkers=1
# Test Files 31 passed | 1 skipped (32); Tests 578 passed | 5 skipped (583)
env -u DATABASE_URL pnpm exec vitest run --testTimeout=180000 --hookTimeout=180000 --maxWorkers=2 --minWorkers=1
# Test Files 94 passed | 42 skipped (136); Tests 1180 passed | 896 skipped (2076)
pnpm exec vitest run apps/collector/test --testTimeout=180000 --maxWorkers=2 --minWorkers=1
# Test Files 22 passed (22); Tests 173 passed (173)
pnpm exec vitest run apps/console
# Test Files 17 passed (17); Tests 142 passed (142)
```

The five provider sandbox tests skip for want of verification credentials; no live payout is
claimed. Cleanup: `CHECKPOINT`, then 23 `po_payfix*` databases dropped in a loop without FORCE.
`po_payfix%` count now 0.


## Sandbox verification path (2026-09-15)

Builder status: implementation and offline checks only. No real sandbox response, named destination verification, or transfer is claimed. Owner provisions the Merchant Wallet and test user; Fable runs the read-only smoke and finance declaration proof. Thursday's fallback remains **awaiting payment - destination unverified** until that evidence exists.

```powershell
cd C:/Users/Khang/pw/zalopay-sandbox
node packages/api/scripts/zalopay-sandbox-smoke.mjs
```

The script reads `~/.playerone/zalopay-sandbox.env` only at runtime through Node's env loader. It accepts no arguments, refuses production and URL overrides, blocks redirects, and exposes only balance and verify-account. There is no transfer branch and no database write. Every output line is labelled Simulation and contains only statuses, codes and fixed meanings. Never paste credentials, provider bodies, phone numbers, wallet identifiers, or raw provider messages into evidence.

Core env names: `PLAYERONE_ZALOPAY_ENV=sandbox`, `PLAYERONE_ZALOPAY_APP_ID`, `PLAYERONE_ZALOPAY_PAYMENT_ID`, `PLAYERONE_ZALOPAY_KEY1`, `PLAYERONE_ZALOPAY_PUBLIC_KEY`, `PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID`, `PLAYERONE_ZALOPAY_SANDBOX_PHONE`. The existing `PLAYERONE_ZALOPAY_SIGNING` and `PLAYERONE_ZALOPAY_RSA_PADDING` settings remain supported. Payment ID and Merchant Wallet ID are different; neither substitutes for the other. Keep `PLAYERONE_PAYOUT_MODE=manual`.

The client puts the configured Merchant Wallet ID in transfer and balance embed JSON; balance excludes embed from its MAC. Missing or conflicting configuration refuses the request. The sandbox phone override is used only for the existing demo seed's declared payout destination, never its login identity. The seed still performs no provider verification itself.

Exit 0 means all configured read calls succeeded, not that a named account is verified. Exit 1 means a read remains unresolved; exit 2 means configuration/argument refusal. The wallet spec returns an ID without a holder name: that answer remains **unverified**, even when the smoke succeeds. Its one-dong probe does not establish capacity for a later bill amount. Bank-code lookup is omitted because it is optional and the old parser differs from the supplied spec; it would not prove wallet verification anyway.

For the verified variant, Fable must declare through the finance route on a throwaway database and show a persisted matching nonempty provider name, usable wallet ID where applicable, verification status, and visible Simulation labels on phone, console and notification. A fixture is not this proof. No migration was added: incoming 0031 enforces separation of duty and 0032 enforces the named-account constraint.

Acceptance is never Paid: statuses 1-3 on transfer acceptance remain processing until query; status 4 remains operator-pending. Duplicate submission queries the same order. Malformed/unknown replies and exhausted polling remain unresolved. Whole-bill flooring, authorization and manual payment gates remain in force.

Manual fallback: record mark-paid only after an actual bank transfer with its real reference, by an eligible finance actor distinct from the verdict/account authors. Without that evidence, leave the bill awaiting. A funded sandbox transfer is a separate owner decision and has not been requested or performed.

Original offline smoke check: `node --test packages/api/scripts/zalopay-sandbox-smoke.check.mjs` (6 checks). Final builder gate evidence follows below; historical counts above belong to payout-honest, not this lane.


### Final builder proof

Candidate 5aaf46f merged as f1d4630. Task 2: 4a9ad7c. Task 3: e0be777. Task 6 worker proof: a7e6977. The smoke implementation began at 5504ff6; use the final lane with Merchant Wallet wiring and the renamed `.check.mjs` check.

Database gate used Docker `playerone-pg:5433`, a throwaway `po_zlp`, `PLAYERONE_DB_ROLE=playerone_app`, `PLAYERONE_REQUIRE_CORPUS=1`, and `PLAYERONE_SESSIONS` pointing to the local five-session EgoCamera corpus. Builder measured these final results on 2026-09-15:

```powershell
pnpm.cmd exec vitest run packages/api/test/payout packages/api/test/settle.test.ts packages/api/test/me.test.ts packages/store/test --cache=false --maxWorkers=2 --minWorkers=1 --testTimeout=30000
# 29 files passed, 1 skipped; 551 tests passed, 5 skipped

# With DATABASE_URL removed, same corpus settings:
pnpm.cmd exec vitest run --cache=false --maxWorkers=4 --minWorkers=1 --testTimeout=30000
# 96 files passed, 43 skipped; 1234 tests passed, 912 skipped

pnpm.cmd typecheck
pnpm.cmd exec tsc -p apps/collector/tsconfig.json --noEmit
# Both exit 0
node --test packages/api/scripts/zalopay-sandbox-smoke.check.mjs
# 6 passed
```

The database gate includes 11 worker and 30 edge-case checks. The five optional live-provider tests skipped: no credential file was loaded and no provider call or actual transfer was made. The no-database gate intentionally skips database-dependent suites. UI label behavior is covered by component tests; no emulator or physical-device proof was run.

Independent QA reviewed the code and runbook corrections, with its own 63 UI/API checks, 30 mapper checks and 6 offline smoke checks passing. Its feedback on provenance propagation and the older runbook's verification/payment conflation was fixed and re-reviewed.

Cleanup completed: CHECKPOINT followed by plain DROP DATABASE for all 19 owned `po_zlp`/`po_zlp_*` databases, without FORCE; remaining count is 0. No push. Task 5 real sandbox provisioning/declaration evidence remains pending owner/Fable; the accepted demo ending remains awaiting payment with an unverified destination until that evidence exists.


### Verify-only smoke without a provisioned Merchant Wallet

The owner cannot reach the SBMC reset OTP phone today. Merchant Wallet ID is therefore optional for this read-only diagnostic: with `PLAYERONE_ZALOPAY_SANDBOX_PHONE` and the core client credentials, the same command runs verify-account only and prints `Simulation | balance | skipped | code=none | skipped: no merchant wallet id`. No placeholder wallet ID is created. A successful nameless lookup still cannot verify a named destination.

With both inputs it reads balance and verifies; with only Merchant Wallet ID it reads balance and reports verification skipped. With neither input, malformed phone, missing or structurally invalid local configuration, production, URL overrides or CLI arguments, exit 2 precedes any request. Exit 0 means every configured read succeeded; exit 1 means an attempted read is unresolved, including provider authentication refusals that can only be detected by a request. The runtime loader and redaction rules are unchanged.

Normal payout client configuration still requires `merchantWalletId: string`. Only an explicit verification-only factory option may omit it, and that client refuses balance and transfer before signing or transport, even if an untyped caller supplies an ID. The smoke transport remains pinned to the two sandbox read endpoints. Builder uses synthetic responses only; no live request or credential-file read is authorized.


### Independent-review fixes: builder rerun

F1 uses a short translated sandbox token only on verified pills; the real awaiting/dual-simulation-flag shape is covered. F2 restores the documented acceptance envelope while retaining rejection of undocumented return code 3. F3 is a documentation clarification of manual replies. F5 guards Merchant Wallet ID in centre preflight. F6 requires the normal client's wallet ID; the owner's explicit verify-only diagnostic is the guarded exception described above. F4 and F7 were left as noted, as requested.

Using the same commands and corpus settings listed above, the final builder rerun passed 554 database tests with 5 live-provider skips (29 files passed, 1 skipped), and 1241 no-database tests with 912 skips (96 files passed, 43 skipped). Root and collector typechecks exited 0; offline smoke checks passed 9/9. Independent QA passed 9 smoke and 15 targeted adapter checks, reviewed the label changes, and approved the corrected documentation. No live requests or credential reads were made.

This rerun also completed CHECKPOINT and plain DROP of all 19 owned `po_zlp`/`po_zlp_*` databases; remaining count 0.
