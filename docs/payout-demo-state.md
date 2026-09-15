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
`isSimulation` (`packages/api/src/payout/domain/config.ts`): a manual attempt carrying a reference is
never a simulation; anything else is a simulation while the provider is the sandbox. It is applied
where a response describes one outcome — the bill in `/api/payout/batches/:period`, both `mark-paid`
replies, and `/api/me/payout`. Two surfaces describe no single outcome, the collector income cycle
and the finance period list, and they keep reporting the environment. Before this, `simulation` was
`PLAYERONE_ZALOPAY_ENV === 'sandbox'` everywhere, both example env files set `sandbox`, and
production refuses to boot without four ZaloPay credentials — so every real manual pilot payment
would have been labelled a simulation.

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

## Proof, measured on this branch

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
