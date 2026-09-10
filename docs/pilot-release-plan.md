# PlayerOne pilot release and unblock plan

Prepared 2026-09-10. Pilot scope: invited testers, actual card-to-cloud collection and review, truthful bills awaiting payment. Public launch and live disbursement are separate gates.

## Distribution: pilot first

Use Google Play internal testing for invited pilot users. Google permits starting this track before app setup is complete and supports up to 100 testers. Internal-only apps are exempt from the Data safety form. This is a distribution allowance, not approval to collect footage without an appropriate notice/consent.

Sources checked 2026-09-10: [internal testing](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en), [Data safety exemption](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

For an immediate staff smoke test, a rebuilt demo APK can be installed directly. Play internal app sharing also accepts APKs/bundles signed with any key and re-signs them, subject to account/app/tester access and device setup. It is a separate mechanism from the internal testing track; do not treat its link as a public store release. [Internal app sharing](https://support.google.com/googleplay/android-developer/answer/9844679?hl=en).

The existing lab APK points at the emulator host and uses demo signing. Rebuild for the chosen reachable host before handing it to a physical-phone tester. For repeatable Play internal-track updates, use the existing AAB profile, a controlled upload key, a stable package ID and increasing version codes. Confirm the organization's Play Console access before promising a download date. Public store metadata, Data safety and broader release review can follow in their proper phase.

## Paths and evidence

| Path | Current conclusion | Clean next action |
| --- | --- | --- |
| C: camera card -> centre -> ingest -> GreenNode -> reviewed bill | Built; real recording upload and byte read-back are recorded in docs/cloud-scale-findings.md and commit 4e08fc1. That is prior-run evidence, not a fresh network measurement. | Rehearse the same path from the actual centre network with a physical Android client. |
| A: camera -> phone -> cloud | Blocked on retrieving existing recordings from camera storage. Captured BLE provisioning works; documented SDK stream/host recording does not prove card-file offload. See docs/hw-captures/FINDINGS-2026-09-03.md. | Ask PaXini for a supported authenticated list/download API or tool, compatible firmware and a working recorded-file example. Recheck newer materials over RustDesk first. |
| B: camera -> cloud directly | Not a pilot dependency; no proven supported device upload integration. | Keep pilot on Path C. Revisit after PaXini supplies a supported interface. |
| Cloud commercial terms | Separate from functional byte verification. Prior answers say PAYG actual usage and project pricing; mixed-tier billing remains ambiguous. | Admin handles purchasing/credits/allocation and gets a worked mixed-tier billing example in the commercial meeting. No further transfer-stack redesign based on quotation wording. |
| Live payout | ZaloPay credentials/onboarding and destination verification remain pending. Manual mark-paid also requires a verified destination. | Get sandbox Verify Account/disbursement/query access first. Retain existing database gates; show bills awaiting payment during pilot. |

Cloud proof is scoped: it does not certify centre bandwidth, sustained concurrency, all provider fault modes, storage-tier billing or a production SLA. Archive tagging happens after billing under the current design; it is not proof of payment or provider tier transition.

## Ordered delivery work

1. **Checkpoint and integrate.** Commit explicit reviewed files on feature branches, review each diff independently and reproduce consequential findings. Preserve existing unrelated main/UI edits. Gate: one identified candidate SHA, clean candidate tree, passing relevant tests and a reviewed integration diff. APK and server artifacts record their source SHA and API origin. A branch commit is not a deployment or an instruction to merge.
2. **Make the pilot installable.** Confirm Play organization access/tester emails and the actual API origin; configure an isolated pilot backend; build the appropriate APK/AAB and install it with Metro stopped. Gate: invited physical-phone tester signs in, restarts, returns to the same account, signs out and signs in as another account without seeing old data. Confirm real ZNS delivery for independent collectors; demo OTP disclosure stays confined to an explicitly isolated staff demo. ZNS sign-in and ZaloPay payout credentials are different dependencies.
3. **Remote hardware/centre rehearsal.** Use the existing RustDesk session on Ubuntu 22.04 for read-only inventory of USB/SDK/firmware, mounted files and networking. Run supported SDK/ingest checks on copies; preserve the card. Gate: a known raw session joins to the correct collector/task, uploads, hashes correctly on read-back, reaches review and creates one bill. Confirm the Ubuntu laptop's role before deployment: hardware bench or actual centre host. The current Windows Task Scheduler kit is not an Ubuntu deployment; if Ubuntu hosts the API, provide equivalent systemd units and Caddy configuration and test service restart.
4. **Exercise failure and recovery.** Existing Vitest/PostgreSQL/socket tests already cover duplicate claims, lost replies, multipart resume, corrupt bytes and concurrent billing. Apply those scenarios to the pilot configuration. Gate: resume avoids resending completed parts, corrupt data stays blocked, competing requests create one accepted claim/review/bill, one task's limits do not lock unrelated tasks, and restarts do not duplicate debt. Record actual environment and pass/fail evidence; do not label mock gateway tests as ZaloPay proof.
5. **Finish the operator recovery surface.** Reuse existing alerts, episode/batch views and archive retry route. Show actionable failure sentences and episode/bill references, last successful heartbeat and query-error states. Add a small triage view only where existing screens cannot expose these facts. Gate: an operator can locate a failed upload/tag, understand the cause, perform the supported retry and verify the outcome. Archive alerts count historical failed operations, not unresolved objects.
6. **Content and operations closure.** Insert legal-approved pilot notice/consent and PaXini's approved task/exam material. Do not invent questions or bypass qualification. Deliver a test alert to the nominated channel and restore a backup into an isolated database. Gate: complete collector onboarding and a reboot/restore rehearsal with evidence. Public-release privacy/deletion/store paperwork proceeds alongside this, without blocking staff-only technical testing unnecessarily.
7. **Gateway follow-up after access.** With explicit sandbox configuration, test account verification, a successful transfer, refusal, timeout/unknown result, reconciliation and duplicate callback/request handling. Gate: one intended transfer per bill, an unknown result is queried rather than resent, and real funds remain disabled until the owner authorizes activation. Any finance-attested verification override requires an explicit policy decision and separate audited design; it is not a workaround to sneak into this pilot.

Use the existing TypeScript/Fastify API, PostgreSQL/Drizzle invariants, AWS S3 SDK for GreenNode, React/Vite console and Expo/React Native app. Vitest plus isolated PostgreSQL and local failure sockets provide regression proof; Playwright covers console journeys; ADB and physical-device checks cover installation and native behavior. Add only the missing operator presentation and host-specific deployment glue.

## Remote versus on-site work

Remote via RustDesk: inspect connected device/SDK, inspect mounted recordings, ingest copies, build/install through ADB if a phone is connected and already authorized, examine logs, run networking checks and rehearse service recovery on a named isolated target.

On-site help only when physical action is needed: power/wear the headset, press physical recording buttons, move/insert the TF card, attach or unlock a phone, approve a new USB-debugging prompt, scan the camera label, or change the local network. Request a short recording first; request a naturally split recording only if an existing suitable sample is unavailable. The app must not acquire recording start/stop controls.

Minimum handoff to proceed: existing RustDesk session access through the approved channel, whether this Ubuntu laptop is a bench or deployment host, and one on-site contact for the physical steps. Keep passwords and payment keys out of chat and Git.

## Combined draft for Alois/admin — not sent

We are preparing an invited PlayerOne pilot, using Google Play internal testing rather than a public launch. The card-to-GreenNode upload/read-back and review-to-bill path already has functional proof; current work is release integration and real-device rehearsal.

Please help with four items:

- **Pilot distribution and notice:** confirm our organization Play Console/app owner and grant testing-release access; provide the tester email list and feedback contact. Ask Legal for an approved short pilot privacy/consent notice covering camera/audio capture, bystanders, VNG/PaXini review access, storage/retention, withdrawal/deletion contact and whether/how approved minutes will be paid. A clearly scoped interim document approved by Legal is sufficient for the pilot decision; engineering will not fabricate temporary legal text.
- **ZaloPay follow-up:** obtain an owner and ETA for the company sandbox account, app_id, payment_id, key1, ZaloPay RSA public key, endpoints/signing settings and access to Verify Account, disbursement, status query/reconciliation and balance. Provide credentials through the approved secret channel, plus sandbox test-account instructions and production activation steps. Destination verification also blocks the manual mark-paid route. Until access is ready, the pilot demonstrates reviewed bills awaiting payment; we will not label a mock transfer as paid.
- **Pilot infrastructure and sign-in:** confirm the intended API hostname/host owner, usable GreenNode allocation/credits for pilot traffic, and the alert/backup owner. Identify the ZNS sign-in owner and provide the approved template and token access through the secret channel; this is separate from ZaloPay payouts and is needed for independent collectors to receive codes. Keep commercial pricing negotiation separate; request the mixed-tier billing example in that meeting.
- **On-site support:** nominate one contact who can attach/authorize an Android phone, operate the headset's physical buttons and expose a raw recording from its card on the Ubuntu laptop. Daniel already has RustDesk, so a new remote-access setup is unnecessary. PaXini should provide the supported recorded-file download interface if camera-to-phone transfer is required later.

Please return owners and availability for these items, not a new general requirements document.
