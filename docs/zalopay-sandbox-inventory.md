# ZaloPay sandbox inventory

Baseline: lane/zalopay-sandbox at 79e1862. Task 1 findings before implementation.
Tasks 2-3 await Fable confirming payout-honest landed, then a candidate merge.

## Existing paths to reuse

- `packages/api/src/payout/zalopay/client.ts:444`: `zaloPayClientFromEnv` reads PLAYERONE_ZALOPAY_ENV, APP_ID, PAYMENT_ID, KEY1, PUBLIC_KEY, SIGNING, RSA_PADDING (all prefixed PLAYERONE_ZALOPAY_). No Merchant Wallet ID or sandbox phone read exists. The factory restores escaped PEM newlines and fails partial credentials closed.
- `packages/api/src/payout/domain/config.ts:59`: payout options read PLAYERONE_PAYOUT_MODE, PLAYERONE_ZALOPAY_ENV, the four credential-presence flags, PLAYERONE_PAYOUT_CAP_VND and PLAYERONE_RISK_HOLD. `:101` refuses sandbox with API payout mode; manual mode remains allowed with a sandbox client.
- `packages/api/bin/serve.ts:154`, `packages/api/bin/payout-worker.ts:38`, `packages/api/bin/payout-shadow.ts:82`: production entrypoint factory callers; entrypoints consume process.env. Node's native runtime env-file loader can populate it without a new parser.
- `packages/api/src/payout/zalopay/signing.ts:72`: transfer MAC builder; `:100` verify; `:111` query; `:116` balance; `:121` bank codes. Existing orderings match the supplied spec, including balance excluding embed data.
- `packages/api/src/payout/zalopay/crypto.ts:33`: native RSA encryption; client `:108` encrypts once before signing/sending. Wallet verify payload uses phone; transfer payload uses m_u_id (`client.ts:378`, `:391`).
- `packages/api/src/payout/worker/batch.ts:276`: only application balance caller, shared preflight. `:462`: only application transfer caller, shared payBill used by individual and batch routes. No new transfer path is needed.
- `packages/api/src/payout/routes/payout.ts:405`: finance/counter declarations share verifyDeclaration before transaction; `:449` preserves declaredName separately from verifiedName. `:888` manual mark-paid has no API-mode exclusion. Console `apps/console/src/payout/BillScreen.tsx:374` selects manual submission when a reference is supplied, including API mode.
- `packages/api/src/payout/worker/poll.ts:131`: polls submitted/processing/unknown with row locking. `:199` queries the original partnerOrderId; not-found/errors remain unresolved; exhaustion raises a ticket. `worker/run.ts:21` supplies the existing interval driver.

## Demonstrated gaps

1. Merchant Wallet payload/config: `client.ts:166` defaults transfer embed to {}; `:227` balance has no embed field. `zalopay/types.ts:371` BalanceRequest has no embed. Both need the real Merchant Wallet ID, distinct from payment ID, after the task-2 gate.
2. Name guard: migration 0032 is absent at this baseline (`git ls-files packages/store/drizzle/*0032*` empty). `domain/verify.ts:60` currently stores a null-name wallet as verified; its existing test explicitly expects this. Reconcile with incoming 0032, never create a competing migration.
3. Wallet identity: `client.ts:124` validates m_u_id using a nonEmpty helper (`:374`) that accepts whitespace. Wallet success always yields null name (`:127`), matching the supplied wallet example. That example cannot prove a named destination. `worker/batch.ts:207` only checks ID non-null and `:490` can return an empty ID. Preserve an explicit unresolved result rather than inventing a name or transferring to unusable ID.
4. Verification redirects: `domain/verify.ts:81` retains only onboardingUrl for -101, dropping reformUrl provided by the spec. Existing mappings cover -406/-1011/-1103/-1104; other refusals become error, system outcomes remain error. Add focused code-group checks after merge.
5. Premature success: `domain/state.ts:114` maps ACCEPTED status 1 directly to succeeded; `worker/batch.ts:472` applies that event and `:195` consequently reports paid. Acceptance must await query. `client.ts:182,206` also accepts envelope return_code 3, unsupported by the supplied spec (processing is data.status 3).
6. Logging: `client.ts:421` default warning includes raw provider messages on unknown codes. The smoke needs a redacted warning callback through the existing factory, and must never print exception messages, receiver fields or response bodies.
7. Optional bank diagnostic: `client.ts:246` reads data.banks; supplied spec says data.bank_list. Omit this optional diagnostic from the initial smoke instead of claiming it proves verification/RSA compatibility.
8. Provenance/display: `worker/batch.ts:195`, payout route `:670`, and `packages/api/src/me.ts:640` derive paid from settlements/attempt success. `me.ts:768` derives destination verified solely from verify_status. Console `payout/pieces.tsx:234` renders verify_status; collector `screens/Income.tsx:55` treats paid/manually_paid as paid. These paths carry no per-outcome sandbox provenance at this baseline. Sandbox success must not be presented as real payment; re-inventory the incoming payout-honest changes before editing.
9. Capacity: `domain/verify.ts:123` probes one dong, not the eventual bill amount. A smoke probe proves only that requested amount; no transfer-capacity or payment claim follows.

## Checks and next boundary

Builder: 34/34 baseline tests passed (verify 5, state 8, signing 21), without DATABASE_URL. These characterize existing behavior; green results do not resolve the gaps above.
Independent QA reproduced three mapping/state gaps with pure Node assertions. No provider requests.
`deploy/cloud/cloud.env`: untracked and ignored verified without reading contents. No credential file opened.
Task 4 can build its safety checks now, but a compliant balance request remains blocked until task 2 wires Merchant Wallet embed. No smoke transfer branch, database writes, or live credentials are permitted.

## Read-only smoke usage (task 4)

Task 2 now supplies Merchant Wallet embed. Run from this worktree:

```powershell
node packages/api/scripts/zalopay-sandbox-smoke.mjs
```

The script loads `~/.playerone/zalopay-sandbox.env` at runtime using Node's native loader and the existing client factory. It accepts no CLI options. Core names: PLAYERONE_ZALOPAY_ENV=sandbox, PLAYERONE_ZALOPAY_APP_ID, PLAYERONE_ZALOPAY_PAYMENT_ID, PLAYERONE_ZALOPAY_KEY1, PLAYERONE_ZALOPAY_PUBLIC_KEY, PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID, PLAYERONE_ZALOPAY_SANDBOX_PHONE. Existing SIGNING/RSA_PADDING settings remain supported by the client. Any ZaloPay URL override is refused, and redirects are disabled. No transfer endpoint or database is used.

Every output line is Simulation with status/code and a fixed meaning; no balance amount, phone, wallet identifier, key, name or raw provider message is printed. Exit 0 means all configured read calls succeeded; it does not mean a named destination was verified or money moved. Exit 1 means an unresolved read (including a refused incomplete balance payload); exit 2 means invalid configuration or arguments. A one-dong wallet lookup cannot establish the named-account requirement or capacity for an eventual bill. Fable must separately prove the persisted finance declaration on a throwaway database.

Offline checks: `node --test packages/api/scripts/zalopay-sandbox-smoke.check.mjs` (6 tests); builder payout regression 88/88 and root typecheck passed. No real sandbox requests have been run by the builder.

Task 2 proof: 57/57 client tests and 6/6 smoke checks passed with synthetic responses only. Configured transfer/balance embed and independent MAC expectations are asserted; payment ID cannot substitute for Merchant Wallet ID. The demo seed accepts the sandbox phone only as its declared destination and prints no destination identifier.

## Tasks 3 and 6: final implementation and worker proof

Fable authorized the candidate merge at 5aaf46f; merge commit f1d4630 brought in the named-account and separation-of-duty constraints. Task 2 is 4a9ad7c; task 3 is e0be777. No migration or route was added.

Task 3 refuses empty names and unusable wallet IDs, preserves declared names and refusal reform URLs, and treats unknown envelopes as unresolved. Existing audit rows retain provider provenance separately for verification and payment; collector, console and notifications show Simulation from that stored outcome. A real manual payment does not erase the destination's sandbox label.

Task 6 reuses the worker and edge-case suites: 11 worker tests and 30 edge-case tests passed within the final database gate. Acceptance stays processing until query; duplicate reconciliation uses the original order, and uncertain/exhausted results stay unresolved. These use local synthetic provider responses, never real transfers.

Builder's final gates (2026-09-15): database payout/settle/me/store 551 passed, 5 skipped (29 files passed, 1 skipped); full suite without DATABASE_URL 1234 passed, 912 skipped (96 files passed, 43 skipped); root and collector typechecks exit 0; offline smoke checks 6/6 passed. The five optional live sandbox tests skipped. Independent QA closed the mapping, HTTP provenance and documentation feedback; its own focused checks passed. No real provider request or credential-file read was made by the builder.

Task 5 remains with owner/Fable: provision the Merchant Wallet/test user, run the read-only smoke, and prove a named persisted declaration on a throwaway database. A successful nameless wallet lookup remains unverified. No funded sandbox transfer was requested.


### Verify-only smoke without a provisioned Merchant Wallet

The owner cannot reach the SBMC reset OTP phone today. Merchant Wallet ID is therefore optional for this read-only diagnostic: with `PLAYERONE_ZALOPAY_SANDBOX_PHONE` and the core client credentials, the same command runs verify-account only and prints `Simulation | balance | skipped | code=none | skipped: no merchant wallet id`. No placeholder wallet ID is created. A successful nameless lookup still cannot verify a named destination.

With both inputs it reads balance and verifies; with only Merchant Wallet ID it reads balance and reports verification skipped. With neither input, malformed phone, missing or structurally invalid local configuration, production, URL overrides or CLI arguments, exit 2 precedes any request. Exit 0 means every configured read succeeded; exit 1 means an attempted read is unresolved, including provider authentication refusals that can only be detected by a request. The runtime loader and redaction rules are unchanged.

Normal payout client configuration still requires `merchantWalletId: string`. Only an explicit verification-only factory option may omit it, and that client refuses balance and transfer before signing or transport, even if an untyped caller supplies an ID. The smoke transport remains pinned to the two sandbox read endpoints. Builder uses synthetic responses only; no live request or credential-file read is authorized.
