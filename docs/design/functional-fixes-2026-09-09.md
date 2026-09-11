# Collector correctness handoff — 9 September 2026

Scope: bounded collector client fixes implemented under the UI/UX parent's delegation. This is builder evidence, not independent QA approval or production certification. No database operations, shared API/schema/money changes, console changes, commit or deployment.

## Verified contracts (correction to API-absence claims)

`packages/api/src/collector-app.ts` already registers:

- `GET /api/me/tasks`, `GET /api/me/tasks/:id`, `POST /api/me/tasks/:id/claims`.
- `GET /api/me/claims` returns active claims, including `task_name`.
- `GET /api/me/devices` returns bound serials, `bound_at`, and `status`. `POST /api/me/devices` binds a serial and returns the binding timestamp; its response does not contain device status.
- `POST /api/me/sessions` binds a session; `GET /api/me/sessions` lists sessions.

Task marketplace and device binding APIs are therefore present. A device-request commerce/provisioning API, native BLE integration, QR camera scanner, claim lifecycle aggregate, task instruction/privacy/payment-rule content, and phone upload implementation are different missing capabilities. Do not equate those missing pieces with absence of the existing endpoints.

## Implemented changes

- Preserve task `published`, `claimable`, `claimed_by_me`, `remaining_slots`, `currency` and original task type. Hall, Home availability and Detail claim control now use authoritative availability instead of spare capacity alone. Price strings are unchanged and displayed with the server currency; no client money computation was added. Qualification and publication refusals have localized explanations.
- Remove the task-type substring guess. A real task carries no scenario; the client represents that as null. Session preparation requires an explicit choice among the existing documented `home`, `office`, `shop`, `warehouse` codes. Neither declarations nor scenario are preselected. The server remains the authority: `scenario_not_found` is displayed if a code is not seeded on that deployment. An unknown saved-session scenario produces an explicit client error rather than silently rewriting it to home.
- Preserve bound-device status, render active/faulty/retired in vi/en/zh, and leave status null for the bind response until the list supplies it. Preserve claim task names so MyTasks no longer depends on a second task-list request to name a claim.
- Production transport defaults to `UnavailableDeviceTransport`, whose scan/connect/configure/IP methods refuse operation. `App` explicitly injects `MockDeviceTransport` only with `PLAYERONE_MOCK_API=1`. The fixed pilot QR serial is offered only in that same demo mode. Real mode offers serial binding and explains the missing QR/Bluetooth features; direct navigation to provisioning cannot show fabricated hardware success.
- SessionCreate distinguishes loading, read failure and verified empty data; retry refetches its dependencies without discarding selections/declarations. Mutations show pending/error feedback; the preparation action and choices lock while submitting and after receiving a session ID. The existing HTTP session replay-ID contract is unchanged.
- Devices distinguishes list loading/failure/empty, preserves existing rows with a failed-refresh notice, locks binding while pending, trims serial entry and translates bind refusals. MyTasks distinguishes failure from loading, retains cached rows with an error/retry notice, and uses server claim names.
- Agreement, training and exam submission failures are visible and retryable; submission controls lock while pending. Registration no longer labels every network/server failure as missing fields.
- Cold-start/profile recovery uses `api/session-entry.ts`: failed reads show a localized recoverable error and Retry, preserving the token. A returning collector is no longer routed to registration because the service is unavailable. Actual 401 still signs out and clears the token through the existing HTTP policy.
- All new copy is in collector-owned `src/i18n.ts` with vi/en/zh parity. Shared API i18n was not changed.

## Builder checks observed

- `pnpm --filter @playerone/collector typecheck`: exit 0.
- `pnpm exec vitest run apps/collector/test`: **42 passed, 0 failed, 0 skipped**, four files, 11:40 local tool output on 9 September. These tests use mocked transport/fetch; no database was contacted.
- New regression coverage: authoritative availability/currency/claim names/device status; unsupported saved scenarios; unavailable hardware transport; cold-start network failure preserving token and successful retry; failure between token restore and profile read; revoked-token sign-out.
- An earlier run was **35 passed / 1 failed** because the old expected bound-device shape omitted the now-preserved `status`. That expectation was updated to match the existing fixture's real `active` status, then the six regressions above were added.

No browser rhythm/contrast, native-device, accessibility or visual acceptance measurement was performed by this builder. Claude remains the independent acceptance owner.

## Claude acceptance scenarios

1. Block each of claims/tasks/devices on SessionCreate independently. Require load failure + retry, never “claim/bind first” inferred from a failed read. Recover without losing explicit declarations. No create action until scenario, claim, device and both declarations are selected. A delayed create response must lock choices; a retry after request failure must retain the same ID for unchanged input.
2. Supply an unpublished held task with spare capacity. It must not appear available on Home/Hall or allow claiming in Detail. Supply a non-VND task currency and verify the display does not relabel it VND. Confirm Vietnamese wrapping separately.
3. Real mode: no fixed QR fill, no fabricated scan results/IP. Demo mode: the existing mock flow remains available. Active/faulty/retired states must remain distinguishable from an unknown state.
4. MyTasks failed initial load must offer retry; failed refresh with cached rows must show a failure notice and keep names. No fabricated review/completed task lifecycle.
5. Onboarding delayed/rejected mutations must show pending/failure and preserve input. Registration network failure must not say the fields are missing.
6. Cold start: offline and 500 lead to recoverable error, token retained. Restore succeeds but the second profile request fails: same result. Retry online resumes server onboarding state. 401 leads to sign-out with token cleared.
7. Inspect Android 320/360/390/412 dp, short height, landscape, keyboard and text enlargement; this patch adds truthful messages that require native layout validation.

## Remaining dependencies and deliberate limits

- The server validates scenario codes against `scenarios.code` but exposes no collector scenario-directory endpoint. The four choices are the already-documented client/server set, not a claim that every deployment has seeded them. Adding new scenes requires a real catalogue contract.
- Task instructions/privacy/payment-rule, readable agreement bodies and approved training/exam content remain missing; the patch does not invent them. Task type remains raw server metadata, not a localized per-session scenario.
- Device QR/BLE, device requests, upload transfer, per-task aggregate review status, sign-out/account settings, duration filters and payout withdrawal are not implemented here.
- Existing cached-data refresh behavior in Home/Hall/Uploads/Income and the Income timeline's asserted review step remain outside this bounded patch. Those require separate tasks; no money or lifecycle changes were attempted.
- `unitPriceVndPerMinute` retains its historical field name for compatibility, but the displayed currency now comes from the server. Any future field rename should update consumers deliberately.
- Browser demo success is not hardware/Android verification. The developer can now no longer obtain simulated hardware success accidentally in real mode.

## Changed-file ownership

`apps/collector/src/App.tsx`; `api/http.ts`, `api/types.ts`, `api/mock.ts`, new `api/session-entry.ts`; `device/transport.ts`, `device/transport-context.tsx`; `i18n.ts`; `ui.tsx` (optional disabled state for Choice only); screens `Agreements`, `Devices`, `Exam`, `Home`, `MyTasks`, `Provisioning`, `Register`, `SessionCreate`, `TaskDetail`, `TaskHall`, `Training`; tests `api.test.ts`, `device.test.ts`.

Native UI refinement may proceed after coordinating ownership of those files. All implementation changes are uncommitted in the shared worktree.
