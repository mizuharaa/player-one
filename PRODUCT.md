# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Two surfaces with genuinely different design languages, confirmed by Engineering
Brief §3.4 and the §3.2 architecture diagram:

- **Web back-office** — operators, reviewers, finance, admin. Runs on fixed
  machines at staffed upload centres and, for reviewers, over a scoped remote
  session from China.
- **Android app** — collectors. Android first, iOS secondary (decision C10,
  taken by Alois 14 Aug 2026).

## Stack

**Services (this repo):** TypeScript, strict with `noUncheckedIndexedAccess`.
Node ≥ 22.18 running `.ts` directly via native type stripping — the *server* has
no bundler and no build step. pnpm workspace, Fastify, Postgres with drizzle-orm,
zod, vitest. **The engine must never need a database and the server must never
need a build step**; both still hold.

**Back-office console:** **React 19, Vite, TanStack Router and Query, Tailwind,
shadcn/ui, i18next.** TanStack Table for every queue, Recharts for operations
statistics. No SEO and no public users, so no server runtime to secure — it is a
built SPA talking to `/v1` over a cookie session. Decided 25 Aug 2026; see
`docs/adr/0002-back-office-is-a-react-spa.md`. This **supersedes** the
server-rendered console shipped on `feat/review-console`, whose view layer is
replaced while every line of its server logic is kept.

**Upload-centre client, Path C:** Electron 32 wrapping the same component
library. Read-only card mount, better-sqlite3 batch state, resumable multipart
upload. Offline tolerance is a property of shipping a compiled artifact to the
centre, not of avoiding a compiler.

**Collector app:** **React Native 0.82**, TypeScript strict, Expo prebuild and
dev client, Android 9+ (API 28), in a **separate repository**. Kotlin
TurboModule for every large transfer — foreground service, WorkManager, OkHttp,
surviving app kill, Doze and OEM battery managers. Local state in SQLite with
Drizzle, MMKV and TanStack Query, with an offline queue of claims, sessions and
upload intents. VisionCamera for QR device binding, ExoPlayer for preview, FCM
for push, Sentry with scrubbed payloads. Release through Gradle 8, Fastlane
match, Play internal testing.

**Shared design system.** Tokens and the component contract are authored once in
`packages/design` and consumed by the console, the Electron client and the app.
Now that both interactive surfaces are React, this is a real package rather than
a copied theme file — that is the main reason the SPA decision was taken.

## Users

**Collectors.** Members of the public in Vietnam, recruited from VNG's existing
user base. They wear PaXini's Ego head-worn camera and record everyday activity
at home, in offices, in shops and in warehouses. They must accept six agreements,
complete training and pass an exam before they can claim any task — enforced
server-side, not only in the UI (APP-02, APP-05). They are paid per reviewed
effective minute. Their app is in Vietnamese (LOC-01, P0); English is P2.

**Upload-centre operators.** VNG staff at staffed regional centres. A collector
hands a TF card across a counter; the operator records the handover, reconstructs
what was recorded against a declared task, and imports the card on a fixed
machine. Every mutation carries two credentials — a machine token proving where
and an operator token proving who (PRD §8.3.2 rule 1).

**Data reviewers.** PaXini employees in Shenzhen during Phase 1; VNG staff
afterwards (§3.3). They work in Chinese, across a border, on data that must stay
resident in Vietnam — so they reach in under PLT-10, scoped to review functions
only and fully logged. They watch episodes, judge how much footage is usable, and
record an effective duration plus failure reason codes. **That judgement is the
product**: it is the only place the number a collector is paid on comes from.

**Back-office, finance and admin.** VNG staff managing tasks, collectors,
devices, upload centres, batches and settlements; exporting bills and marking
manual payment (BO-01 → BO-14). Permissions are role-based and enforced
server-side (BO-11).

## Product Purpose

Crowdsource ego-centric video, IMU and audio — first-person recordings of ordinary
human activity — at the scale PaXini needs to train robots, and pay the people who
record it correctly and traceably.

Phase-1 targets: **500 collectors, 40,000 hours, roughly 640 TB, ≥85–90%
qualification rate.** The pilot runs about 20 devices.

Success is usable hours delivered, and every one of them attributable to exactly
one task, collector, device, scenario, upload path, reviewer decision and
settlement record. No orphans.

## Positioning

PaXini's Chinese collection is factory-based — their Tianjin facility, the P&G
plant next door, BYD, JD. That produces excellent industrial data and almost no
home data, because finding, trusting and paying individual people in China is
expensive.

VNG's Vietnamese consumer base is the recruitment mechanism they lack. The thing
a neighbouring product could not truthfully copy is not the hardware or the
review tooling — it is a trusted, consumer-scale recruitment and payment rail in
Vietnam, wired to a payment chain that can survive an audit.

## Operating Context

**Three upload paths, only one of which currently exists.**

| Path | Route | State |
|---|---|---|
| A | Device → phone app → cloud | Primary for Vietnam. Blocked on D1. |
| B | Device → cloud direct | P1. Blocked on D2. |
| C | TF card → staffed upload centre | **Built.** The pilot runs on this. |

**Upload centres are offline-tolerant by design.** They sit on a LAN, the link
drops, and the counter workflow has to keep working. This is why the ingest
engine must never require a database and why the console has no build step.

**Data residency is a hard constraint.** Recordings stay in Vietnam. Reviewers in
China reach in rather than data reaching out (PLT-10, Part 7).

**Three languages, three audiences.** Collectors read Vietnamese, reviewers read
Chinese, engineering works in English. Failure reason codes must reach the
collector in a form they can act on (LOC-04, QR-04), which is why they are
catalogue rows with per-language labels rather than enum values.

**Money is downstream of a human.** `useful minutes × task unit price`. There is
no automatic quality inspection in Phase 1 — PaXini reviews and hands over the
standard afterwards. The review standard itself does not exist yet; PaXini said
on 13 Aug 2026 that it must be rewritten during the pilot, so the tool is how it
gets written.

## Capabilities and Constraints

**Built and tested** (342 tests; 182 of them pass with no database, which is a
load-bearing property): the ingest and measurement engine, the episode store, the
identity spine, both-token auth, the audit trail, the counter workflow, the
session resolver, the review lane and its console, and the settlement row a
verdict writes. Migrations 0000–0004.

**Rules that must survive any future change:**

- **Payable time is the intersection of stream coverage, not the union.** The
  brief's own Appendix B prints the union and reads ~3% high, 18% on one session.
  §5.3.3 and UPL-14 require the intersection. The engine is right.
- **The device manifest is always advisory** (UPL-08). Its duration overstates
  media by about a third; its file list names files that do not exist.
- **The episode id is derived from the directory basename only**, never from
  content. The content fingerprint is a column, never a key.
- **Invariants belong in the schema**, as CHECK constraints and foreign-key
  shapes, not in TypeScript.
- **The server computes money.** A client never sends a duration or an amount.
- **Rounding happens in exactly one function**, half away from zero.
- **A settlement can only be reached through a review.** There is deliberately no
  foreign key from a payment to a recording.
- **No TF card is cleared** while the QR-02 deviation is in force, and no code
  path deletes source media. See `docs/adr/0001-review-reads-local-verification.md`.
- **The engine must never need a database.**

**Blocked on PaXini deliverables:**

| Item | Blocks | Status |
|---|---|---|
| **D1** — Wi-Fi protocol between device and phone | The entire Path A upload flow | Promised, not received |
| **D5** — Device SDK, API docs and user manual | "Everything" — device binding, pre-collection checks, firmware display | Promised 13 Aug, not received |
| **D11** — Whether background review needs online playback of raw video | Whether reviewers stream video, and so whether video leaves Vietnam in practice | **Unresolved on PaXini's side. Escalate.** |
| **D2** — Storage target | Path B, cloud upload and verification | May now be resolved — confirm |

**Known gaps, recorded rather than invented:**

- **Reviewer identity does not exist yet.** The review console currently signs
  reviewers in with upload-centre operator credentials. PLT-10 requires a scoped,
  fully-logged remote reviewer role instead, because reviewers are in Shenzhen and
  not at a VNG counter. This is the next architectural correction on the console.
- `tasks` has no currency column, so what a task pays in is deployment
  configuration rather than data.
- `collectors` has no display name; the console shows an external reference.
- The **BO-09 cut** — upload centres, machines and operators stay CLI/fixtures —
  is recorded in `docs/adr/0003-bo09-centres-machines-operators-stay-fixtures.md`
  with its trigger condition (second centre, or 500 collectors, whichever comes
  first).
- Dispute and second review are P2 and deliberately not built.

**Terminology.** Requirement IDs are the shared vocabulary between the brief, the
code and the console: `APP-` collector app, `BO-` back office, `UPL-` upload,
`QR-` quality review, `SET-` settlement, `PLT-` platform, `LOC-` localisation,
`PRV-` privacy, `SEC-` security, `NFR-` non-functional, `P2-` phase two. Code
comments cite them and so should any new surface.

## Brand Commitments

- **Name:** PlayerOne. A joint venture between **VNG PT Lab** (platform) and
  **PaXini** (hardware and, in Phase 1, review).
- **Colour, as stated by the product owner:** VNG is orange / sun / peach; PaXini
  is tech blue and white. **No formal brand guideline or binding hex values
  exist** — confirmed, so the drafted values are the design system's own choice
  and not corporate assets. Future work may refine them; it should not go hunting
  for an official palette.
- **A mascot is confirmed in scope** — an animal, chosen over a robot, whose state
  follows the time of day because upload centres run shifts. Her rendering belongs
  to the design system, not here.
- **Localisation is a product commitment, not a preference.** Back-office in
  English and Chinese (LOC-02). Collector app in Vietnamese (LOC-01), English at
  P2 (LOC-05). Training, exam and task descriptions localised to Vietnamese with
  diagrams and worked examples (LOC-03).
- **Voice.** Plain and specific. The product owner has asked more than once for
  explanations without buzzwords, and in Simplified Technical English when
  describing system behaviour. Error and review copy reaches people who are paid
  or not paid on it, so it says what happened and what to do.

## Evidence on Hand

**Authoritative and not in this repository:**

- `~/Downloads/Player One — Engineering Brief v1.0.md` — the specification. Part 6
  holds every requirement ID the code cites. Read it before answering any scope
  question.
- `~/Downloads/EgoData_VNG_PRD.pdf` and
  `~/Downloads/In-the-Wild Ego Data Collection App PRD.pdf` — PaXini's own PRDs.
  §8.3.2 and §11.3 of the second govern the upload centre.

**In the repository:**

- `fixtures/sessions/` — 22 synthetic sessions, one per failure mode, committed.
  The MP4s are 32-byte stubs and cannot answer questions about real encoding.
- `docs/sample_data/` — five real sessions from device `AZER76400FE`, 13 Aug 2026,
  about 630 MB. **Gitignored, not in the repo**; ask Alois.
- `docs/review.md`, `docs/matching.md`, `docs/episode-identity.md`,
  `docs/RUNNING.md`, `docs/adr/0001-review-reads-local-verification.md`,
  `docs/design/product-draft.html`.
- `CLAUDE.md` — the agent handoff, including decisions that must not be
  re-litigated.

**Absences that must not be filled with invention:** there are no customers, no
testimonials, no benchmarks, no pricing beyond a task's unit price, and no device
SDK or firmware documentation. There is no evidence about how PaXini's encoder
writes MP4 files — `pnpm moov` answers that question against the real corpus and
has not been run on it.

## Product Principles

1. **Refuse rather than guess on the money path.** A wrong match pays the wrong
   person silently; an unmatched recording sits visibly in a queue where somebody
   fixes it. The resolver has no tie-break, and that is the point.
2. **Measure; never trust a declaration.** Every number that becomes money comes
   from the media itself. Anything the device says about itself is a hint.
3. **Put invariants where they cannot be bypassed.** If a rule protects a payment,
   it belongs in the database as a constraint, not in a function somebody can
   forget to call.
4. **Reviewer throughput is the programme's ceiling.** At 40,000 hours, every
   second per episode multiplies by tens of thousands. Playback is fast, seekable
   and keyboard-driven, and a verdict never requires leaving the player.
5. **Never destroy the only copy.** Cards are not cleared and media is not deleted
   while the cloud does not exist.

## Accessibility & Inclusion

No standard is mandated by the brief or by VNG policy — confirmed, not assumed.
The floor this project holds itself to:

- **WCAG 2.2 AA contrast**, in both themes. This is not decoration on the review
  screen: `VQ-DARK` and `VQ-OVEREXPOSED` are reject reasons a collector is paid or
  not paid on, so interface brightness next to footage is a correctness concern.
- **Full keyboard reachability.** A complete review must be possible with no
  pointer at all; that is a throughput requirement before it is an access one.
- **Never colour alone.** Verdict states carry a shape or glyph as well as a
  colour — red/green colour-blindness is common and this axis decides money.
- **Legibility across a wide Android device range** for collectors, and training
  material carried by diagrams and worked examples rather than by text alone
  (LOC-03), because collectors are members of the public with varied literacy and
  hardware.
