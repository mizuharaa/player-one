# PlayerOne — handoff for the next agent

Written 2026-09-11 (Friday) by the Claude session that ran QA and the last two
build lanes. Owner: Daniel. This file replaces every per-day handoff and QA
record that used to live under `docs/design/`; those are deleted in the same
commit. It is a **working document**: correct it when you learn it is wrong,
and re-derive anything measurable with the commands in `CLAUDE.md` rather than
trusting a number here. Decisions and traps stay in `CLAUDE.md`; what the
system *is* stays in `CONTEXT.md`; how to run it stays in `docs/RUNNING.md`.

## 1. The three requirements, in order, and where each stands

| # | Requirement | Honest status on 2026-09-11 |
|---|---|---|
| 1 | **Live demo, Thursday 2026-09-17.** App on the phone, fully functional and pairable with hardware. Admin console fully functional with real footage. | App: builds and runs (demo APK measured on an emulator), sign-in / onboarding / task hall / claim / session-prep work against the API. **Pairing from the phone does not exist**: the device transport is a mock; the real BLE module needs a Kotlin TurboModule, NDK/JNI build and an ARM device (`apps/collector/DEVICE_DEPS.md` §"What blocks"). Console: fully functional; the hosted Railway database has **no episodes**, so every dashboard reads zero. Real footage exists only on the org PC (6 sessions, 1.07 GB). |
| 2 | **Publish on Play Store / App Store.** | Play: `play` build profile with upload-key signing, AAB task and provenance manifest exist (`apps/collector/RELEASE.md`, `scripts/build-android.mjs`, `build-provenance.mjs`). Needs the organisation's Play Console access, a public HTTPS API origin and an upload keystore. App Store: no iOS build exists; needs a Mac or EAS plus Apple Developer Program. TestFlight facts verified: internal ≤100 testers no review, external ≤10,000 with Beta App Review, builds expire in 90 days. |
| 3 | **Real collection test end to end** — training + onboarding, task distribution, acceptance, recording, upload, admin review, manual payment. | Every step is built and tested in code (§4). Never run as one chain on real devices. Blocked on: ZNS credentials (sign-in codes), a reachable API host for the centre, GreenNode allocation for the pilot, and physical access to the Ego device. |

## 2. The single biggest problem: four branches, one product

```
main            325f94e  17 commits nobody else has; dirty tree with a partial port of collector fixes — PRESERVE, do not merge over
sprint/demo-release 6cc29b7  (+8 over main)  pilot API hardening, collector recovery + sign-in isolation, deploy/centre kit, quota preflight, counter recovery CLI, release provenance
sprint/ui-revamp    d39c102  (+43 / −17)     the DEPLOYED showcase lineage: console world, Home revamp, showcase footage, Engineering, operator profile, migrations 0026–0028, Railway kit
sprint/mobile-ui    c2e0775  (+9 over main)  collector lavender tokens + Landing/Film/Trúc (from 6cc29b7)
sprint/debug-fixtures      (planned only)  off d39c102, PLAN.md reviewed three rounds by Codex
```

`sprint/ui-revamp` and `sprint/demo-release` diverged at `960133b`; **27 collector
files changed on both sides**, ten of them by 160–1,586 lines each (`i18n.ts`,
`http.ts`, `ui.tsx`, `api.test.ts`). They are forks, not branches. There is no
one commit today that has both the deployed console and the hardened
collector/API. **Job #1 for the demo is to make that commit.**

## 3. What is done (measured, with where the proof lives)

- **Ingest engine** (`packages/ingest`): reads a session directory, measures
  every stream, emits an `EpisodeRecord`; payable time is the intersection of
  coverage; quarantines faults. Database-free. All five 2026-08-13 sessions
  ingest; three are deliberate fault cases (`docs/RUNNING.md` §"Adding the
  sample sessions").
- **Path C** (`packages/api/bin/counter.ts import`, `src/upload.ts`,
  `src/upload-worker.ts`): handover → batch → session → episodes → multipart
  upload to GreenNode (S3 SDK) with resume, lost-ack survival, ranged read-back
  hash verification. Proven on a real recording against HCM04 on 2026-09-08
  (`docs/cloud-scale-findings.md`, commit `4e08fc1`), not yet from inside the
  VPC. `counter.ts upload --batch` resumes an existing batch; `archive-retry
  --bill` retries archive tags one page at a time.
- **Review lane** (`src/review.ts`, `docs/review.md`): claim/heartbeat/verdict,
  dispute + second review, `REVIEW_VERIFICATION_GATE=cloud` by default.
- **Money** (`src/settle.ts`, `src/money.ts`, `src/payout/**`): verdict →
  settlement → bill (total floors to whole dong, lines don't) → payout attempt.
  Manual mode: `POST /api/payout/bills/:id/pay` (finance role) needs a
  verified destination registered via `POST /api/payout/collectors/:id/accounts`.
  ZaloPay client complete, **never run against ZaloPay**; sandbox suite skips
  without credentials.
- **Storage & deletion**: no code path deletes source media; a TF card is never
  cleared. `POST /upload-batches/:id/cache-clean` refuses until the cloud has
  verified the batch. Showcase clips expire after 7 days. Archive tagging runs
  after billing and is not proof of storage tier.
- **Console** (`apps/console`): 12 routes; operator workspace; review; settle;
  back office; Demo studio (private ≤20 MB clips, demo verdicts, RLS);
  Engineering (admin-only diagnostics incl. redacted `EpisodeRecord`); the
  public `/discover` landing. Deployed to Railway from `sprint/ui-revamp`
  snapshots (`docs/railway-release-2026-09-10.md`); the Home revamp in
  `d39c102` is **committed, not yet deployed**.
- **Collector app** (`apps/collector`, Expo 57 / RN 0.86, Android): 14 screens;
  sign-in with retired-client isolation, onboarding retry that never loses a
  pass, PXCap headset guidance; `MockDeviceTransport`. Demo v3 APK smoke-tested
  on emulator `playerone_qa_5580` (launch 2.5 s, no crashes, API reachable).
- **Deploy kit** (`deploy/centre`, on `demo-release`): Windows Task Scheduler
  wrappers for API/alerts/Caddy, preflight `check.mjs` (now matches runtime
  bounds), REHEARSAL runbook incl. backup/restore, recovery CLI docs.
- **Hardware** (`packages/hardware-checkout/probe.py`, `docs/hw-captures/
  FINDINGS-2026-09-03.md`): BLE pairing + Wi-Fi handoff from a laptop **works,
  protocol captured**; the device exposes streaming/control only, **no file
  API** — Path A (device→phone) is blocked on PaXini.
- **Agent tooling**: Codex + Claude rotation through 9router (`docs/agents/
  quota-rotation.md`), read-only auditor pane, `claudex-loop` plan/diff review.

## 4. Order of action

### Priority 1 — Thursday demo (owner-ordered)

**1a. Integrate to one branch (day 1–2).** New branch `sprint/demo` from
`sprint/demo-release` (it has the hardened API, collector recovery and the deploy
kit). Merge `sprint/mobile-ui` (clean, additive). Then bring the console and API
additions from `sprint/ui-revamp` **by feature, not by merge**: `apps/console`
wholesale (it is the deployed UI), `packages/api/src/{showcase-footage,
engineering,operator-profile,session}.ts` with their tests, migrations
0026–0028 appended to the journal in `when` order, `packages/design` from
`sprint/mobile-ui` (superset of both). For the 27 diverged collector files keep
`demo-release`'s (auth/recovery/tests) and port ui-revamp's *presentation* per
screen, as `C:/tmp/po-mobile/PLAN.md` already prescribes. Gates: root/console/
collector `tsc`, the DB-free suite, then the full suite on an isolated Postgres
with `PLAYERONE_SESSIONS` pointed at the corpus. Independent QA reads the diff.

**1b. Console with real footage (day 2–3).** Fastest true path: run the API on
the org PC where the corpus lives and push the five sessions through the *real*
pipeline — `pnpm ingest <dir> --store` for the record, `counter.ts import` for
the full handover → batch → episodes → upload → review chain (needs one
collector, task, device, centre from `seed-demo.mjs`/`bootstrap.ts`). Review
two episodes in the console, let a bill form, show the payout screen in manual
mode. That is the real product with real footage, on a LAN — exactly what
`deploy/centre` (`lan-demo`) was built for. The Railway console can show the
same *summaries* plus proxies via the debug-fixtures plan (§5) if the residency
decision allows; if not, it shows synthetic clips labelled as such.

**1c. App on the phone (day 2–3).** Build the `demo` profile pointed at the
LAN API (`EXPO_PUBLIC_API_URL=http://<centre-ip>:8080`, cleartext allowed for
demo) or the `play` profile at the Railway HTTPS origin (accepted by
`app.config.cjs`). Sign in with the seeded demo phone (`PLAYERONE_DEMO_PHONE`,
no ZNS needed), walk onboarding → task hall → claim → session prep. Wire
`Landing` into `App.tsx` at `startRoute` first (Codex's open slice).

**1d. "Pairable with hardware" — say what is true.** From the phone, pairing
requires the EgoLowBle TurboModule: Kotlin wrapper over the vendor AAR, JNI via
NDK/CMake, tested on an ARM device — none of which exists, and PaXini's kit
ships no Kotlin API. Realistic with an Android developer and the device in
hand: **3–5 working days**, i.e. not safely inside Thursday. Two honest options
for the demo: (i) pair the device from the laptop with `probe.py` (proven) on
screen while the app shows its provisioning flow labelled as mocked; (ii) run
the TurboModule as a stretch lane starting Monday, demo (i) if it is not green
by Wednesday. **Recommendation: (ii) with (i) as the committed fallback**, and
the recording still happens on the camera's own buttons — the app never starts
or stops recording (decision in `CLAUDE.md`).

### Priority 2 — publish

Play internal testing first (100 testers, no review): needs Play Console
access, an upload keystore, a public HTTPS API origin (Railway qualifies
today), `PLAYERONE_VERSION_CODE`; `pnpm --filter @playerone/collector aab`
emits the AAB and the provenance manifest. iOS later: EAS or a Mac, Apple
Developer Program, then TestFlight internal (same 100-tester no-review shape).

### Priority 3 — the real collection test

Run the chain once, on real devices, with evidence per step:
training/onboarding (server-enforced APP-02/04/05) → task created in back
office → claim → record on the camera → hand the card to the counter →
`counter import` → cloud upload + read-back → review → bill → **manual pay**
(`/api/payout/bills/:id/pay` after `POST /api/payout/collectors/:id/accounts`
registers a verified destination). Prerequisites that are not code: ZNS
credentials (or the demo phone for staff only), GreenNode allocation, a centre
API host, one Ego device and card, legal's pilot notice. `docs/pilot-release-
plan.md` (on `demo-release`) holds the gates per step; keep it.

## 5. What is blocked, and by whom

| Blocker | Blocks | Owner / next move |
|---|---|---|
| EgoLowBle TurboModule (ARM device, NDK/JNI build, no Kotlin API in AAR) | phone pairing | Android dev + device; PaXini for a Kotlin-facing API |
| Device exposes no file API | Path A (device→phone offload) | PaXini; pilot stays on Path C |
| ZNS access token + template | collector sign-in for non-demo numbers | VNG Zalo owner |
| ZaloPay sandbox credentials | any payout beyond manual | Alois/admin |
| Centre API host + GreenNode pilot allocation | pilot deployment | Alois/infra; Ubuntu vs Windows undecided |
| Railway has no Vietnam region | real footage on the hosted showcase (PLT-10) | Daniel + Alois decide (a) accept in writing incl. staff consent, or (b) local only |
| Branch fork (27 collector files) | everything in Priority 1 | integrate first (§4.1a) |
| Play Console access / upload keystore | publish | Daniel |

## 6. Approaches and stacks per area (for whoever picks each up)

- **Integration**: git only; no `git add -A` (630 MB corpus lives under
  `docs/sample_data`, gitignored); journal `when` order for migrations; never
  edit an applied migration. Gates in §4.1a. One integrator; builders never
  commit.
- **API**: TypeScript strict, Fastify + zod, drizzle + raw-SQL invariants,
  vitest with one throwaway database per file. Invariants go in the schema.
- **Console**: React 19, Vite, TanStack Router/Query/Table, Tailwind v4,
  shadcn, i18next (vi/en/zh); tokens only from `packages/design`; Playwright via
  `apps/console/scripts/browser.mjs` (`withBrowser`, one context at a time).
- **Collector**: Expo 57 / RN 0.86, `expo prebuild`, `expo-video`,
  `react-native-safe-area-context`; vi/en; tests are jsdom + mocked RN (logic,
  not rendering) — the handset is the only rendering evidence.
- **Debug fixtures** (console with footage, hosted): `C:/Users/user/pw/
  debug-fixtures/PLAN.md`, three Codex rounds, v4 pending Daniel's residency
  answer. Own table with GUC-scoped RLS, two-phase atomic load, ≤8 MB proxies,
  redacted extraction summaries, 30-day purge independent of the flag, probes
  incl. money-table non-reachability. Build lanes: API+migration+loader,
  console Debug tab; Sonnet auditor; Codex diff review.
- **Hardware**: Python probes in `packages/hardware-checkout`; captures in
  `docs/hw-captures`. BLE read-polling FF03, not notify.
- **Agents**: `claude-router` for builders (9router rotates accounts),
  `claude-qa` for the auditor on a separate account, Codex via `codex exec
  --sandbox read-only` for plan/diff review; `herdr agent list/read/prompt`.
  Whoever made the thing never checks the thing.

## 7. What this commit deleted, and why

61 per-day direction/handoff/QA records under `docs/design/` (superseded by
`DESIGN.md`, `CONTEXT.md`, this file and Git history) and 65 one-off QA
scripts under `apps/console/scripts/` (kept: `browser.mjs`, `rhythm.mjs`,
`contrast.mjs`, `shots.mjs`). Nine `docs/design/*-direction*.md` files that
`DESIGN.md` links to were kept. Nothing under `docs/adr`, `docs/agents`,
`docs/hw-captures`, `docs/RUNNING.md`, `docs/review.md` or the deploy docs was
touched. If you need an old record, it is one `git log -- docs/design` away.
