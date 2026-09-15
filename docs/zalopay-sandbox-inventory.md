# ZaloPay sandbox inventory

Baseline: lane/zalopay-sandbox at 79e1862. Task 1 findings before implementation.
Tasks 2-3 await Fable confirming payout-honest landed, then a candidate merge.

## Existing paths to reuse

- `packages/api/src/payout/zalopay/client.ts:444`: `zaloPayClientFromEnv` reads PLAYERONE_ZALOPAY_ENV, APP_ID, PAYMENT_ID, KEY1, PUBLIC_KEY, SIGNING, RSA_PADDING (all prefixed PLAYERONE_ZALOPAY_). No Merchant Wallet ID or sandbox phone read exists. The factory restores escaped PEM newlines and fails partial credentials closed.
- `packages/api/src/payout/domain/config.ts:59`: payout options read PLAYERONE_PAYOUT_MODE, PLAYERONE_ZALOPAY_ENV, the four credential-presence flags, PLAYERONE_PAYOUT_CAP_VND and PLAYERONE_RISK_HOLD. `:101` refuses sandbox with API payout mode; manual mode remains allowed with a sandbox client.
- `packages/api/bin/serve.ts:154`, `packages/api/bin/payout-worker.ts:38`, `packages/api/bin/payout-shadow.ts:82`: production entrypoint factory callers; entrypoints consume process.env. Node's native runtime env-file loader can populate it without a new parser.
- `packages/api/src/payout/zalopay/signing.ts:86`: transfer MAC builder; `:117` verify; `:134` query; `:139` balance; `:144` bank codes. Existing orderings match the supplied spec, including balance excluding embed data.
- `packages/api/src/payout/zalopay/crypto.ts:39`: native RSA encryption; client `:108` encrypts once before signing/sending. Wallet verify payload uses phone; transfer payload uses m_u_id (`client.ts:378`, `:391`).
- `packages/api/src/payout/worker/batch.ts:276`: only application balance caller, shared preflight. `:462`: only application transfer caller, shared payBill used by individual and batch routes. No new transfer path is needed.
- `packages/api/src/payout/routes/payout.ts:407`: finance/counter declarations share verifyDeclaration before transaction; `:457` preserves declaredName separately from verifiedName. `:888` manual mark-paid has no API-mode exclusion. Console `apps/console/src/payout/BillScreen.tsx:374` selects manual submission when a reference is supplied, including API mode.
- `packages/api/src/payout/worker/poll.ts:148`: polls submitted/processing/unknown with row locking. `:234` queries the original partnerOrderId; not-found/errors remain unresolved; exhaustion raises a ticket. `worker/run.ts:21` supplies the existing interval driver.

## Demonstrated gaps

1. Merchant Wallet payload/config: `client.ts:168` defaults transfer embed to {}; `:227` balance has no embed field. `zalopay/types.ts:418` BalanceRequest has no embed. Both need the real Merchant Wallet ID, distinct from payment ID, after the task-2 gate.
2. Name guard: migration 0032 is absent at this baseline (`git ls-files packages/store/drizzle/*0032*` empty). `domain/verify.ts:60` currently stores a null-name wallet as verified; its existing test explicitly expects this. Reconcile with incoming 0032, never create a competing migration.
3. Wallet identity: `client.ts:124` validates m_u_id using a nonEmpty helper (`:374`) that accepts whitespace. Wallet success always yields null name (`:127`), matching the supplied wallet example. That example cannot prove a named destination. `worker/batch.ts:208` only checks ID non-null and `:497` can return an empty ID. Preserve an explicit unresolved result rather than inventing a name or transferring to unusable ID.
4. Verification redirects: `domain/verify.ts:84` retains only onboardingUrl for -101, dropping reformUrl provided by the spec. Existing mappings cover -406/-1011/-1103/-1104; other refusals become error, system outcomes remain error. Add focused code-group checks after merge.
5. Premature success: `domain/state.ts:114` maps ACCEPTED status 1 directly to succeeded; `worker/batch.ts:472` applies that event and `:195` consequently reports paid. Acceptance must await query. `client.ts:182,206` also accepts envelope return_code 3, unsupported by the supplied spec (processing is data.status 3).
6. Logging: `client.ts:421` default warning includes raw provider messages on unknown codes. The smoke needs a redacted warning callback through the existing factory, and must never print exception messages, receiver fields or response bodies.
7. Optional bank diagnostic: `client.ts:246` reads data.banks; supplied spec says data.bank_list. Omit this optional diagnostic from the initial smoke instead of claiming it proves verification/RSA compatibility.
8. Provenance/display: `worker/batch.ts:195`, payout route `:685`, and `packages/api/src/me.ts:640` derive paid from settlements/attempt success. `me.ts:768` derives destination verified solely from verify_status. Console `payout/pieces.tsx:234` renders verify_status; collector `screens/Income.tsx:55` treats paid/manually_paid as paid. These paths carry no per-outcome sandbox provenance at this baseline. Sandbox success must not be presented as real payment; re-inventory the incoming payout-honest changes before editing.
9. Capacity: `domain/verify.ts:131` probes one dong, not the eventual bill amount. A smoke probe proves only that requested amount; no transfer-capacity or payment claim follows.

## Checks and next boundary

Builder: 34/34 baseline tests passed (verify 5, state 8, signing 21), without DATABASE_URL. These characterize existing behavior; green results do not resolve the gaps above.
Independent QA reproduced three mapping/state gaps with pure Node assertions. No provider requests.
`deploy/cloud/cloud.env`: untracked and ignored verified without reading contents. No credential file opened.
Task 4 can build its safety checks now, but a compliant balance request remains blocked until task 2 wires Merchant Wallet embed. No smoke transfer branch, database writes, or live credentials are permitted.
