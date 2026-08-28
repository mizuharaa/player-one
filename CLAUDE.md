# PlayerOne — agent handoff

Read this before touching anything. State below is as of 2026-08-26; the
Decisions and Traps sections are cumulative.

## What this is

VNG PT Lab builds the platform; PaXini supplies the Ego head-worn camera and
reviews the data. Collectors record everyday activity, a human reviews it, and
the collector is paid **per reviewed effective minute**. Targets: 500
collectors, 40,000 hours, ~640 TB, ≥85–90% qualification. Pilot is ~20 devices.

**The authoritative spec is `Player One — Engineering Brief v1.0` and it is NOT
in this repo** — it lives at `~/Downloads/Player One — Engineering Brief v1.0.md`.
Part 6 holds the requirement IDs the code comments cite. Two operators have
looked for it in `docs/` and it was never there. Read it before answering any
scope question; do not reason from these notes alone.

PaXini's own PRDs are `~/Downloads/EgoData_VNG_PRD.pdf` and
`~/Downloads/In-the-Wild Ego Data Collection App PRD.pdf`. §8.3.2 and §11.3 of
the second one govern the upload centre.

`docs/RUNNING.md` is how to run it. Start there for anything mechanical.

## State

Written 2026-08-27, at the cut-over from the home machine to the org PC.
Everything below is on GitHub; nothing is stranded on either machine.

**Branch `integration/eight-features` — pushed.** It is `feat/review-console`
(which already carries #11, the React SPA) plus the eight feature branches of
2026-08-25 merged in journal order — settlement-lifecycle, review-queues,
backoffice-crud, device-assignment, greennode-upload, reviewer-role,
hardware-checkout, collector-app — plus the ZaloPay client
(`feat/payout-zalopay-client`) and the payout domain (`feat/payout-domain`
through `d84d60c`), plus the fixes the combined tree needed. `main` is still
at #9; PRs #10, #12, #13, #14 are open and superseded by this branch. When
Daniel says so, this branch becomes one PR to `main`.

**With `DATABASE_URL`: 685 pass, 41 skip** (the 41 want `docs/sample_data/`).
**With none: 356 pass, 370 skip** — that property is load-bearing, see below.
Measured at `a8b20c6` on a fresh Postgres 16 with `--testTimeout=180000`.
The first run against brand-new databases showed 16 first-test-in-file
timeouts while 41 files migrated at once; the rerun on the same databases was
clean. That is load, not defects: rerun before believing a red first run.

Built and tested, all on this branch: the ingest engine, the episode store,
the identity spine, both-token auth, the audit trail, the counter workflow,
the session resolver with the device-custody crosscheck, the review lane with
two queues (standard/privacy), priority and assignee, the PaXini reviewer role
(scoped, logged, media denied by default), the back office (tasks, collectors,
devices, claims, agreements, exam result) with its console screen, the
settlement lifecycle (state machine, bills, lines, CSV export), the cloud leg
to GreenNode with read-back verification (unproven live — no credits), the
Ego hardware checkout tools, the collector-app scaffold (real home:
`mizuharaa/player-one-app`), the ZaloPay disbursement client (HMAC signing,
RSA-encrypted receiver_info, every sub-code mapped, fake server; 94 tests, no
network), and the payout domain (0012/0013: `payout_accounts`,
`payout_attempts`, `payout_events`, `payout_exports`; finance role with
separation of duty in the database; manual rail `/api/payout/bills/:id/mark-paid`
as the ONLY way a bill becomes paid; API rail + poller + batch runner behind
`PLAYERONE_PAYOUT_MODE=manual`). Migrations `0000`–`0013`; the journal is
ordered by `when`, and tags with the same numeric prefix (`0007_*`,
`0009_*`) are distinct migrations — never renumber.

**In progress on their own branches, all pushed, merge in this order:**

1. `feat/payout-domain` tip `f8667a2` is a WIP commit on top of the merged
   `d84d60c`: `POST /api/payout/batches/:period/run`, the server-side batch
   the console must call instead of looping pay in the browser. Design is in
   the commit message (transaction-scoped advisory lock → 409
   `payout_batch_running`; 200 with `preflight`, `sent[]`, `refused[]`,
   `stopped_at`, `tickets[]`). Not typechecked, not run. Finish, test
   (finance gate, manual mode refused, idempotent second run sends nothing,
   stop-on-failure), merge.
2. `feat/risk-engine` tip `a1145bd` (advisory flags with evidence, reversible
   holds, tuning as data, wrappers over the hardware-checkout analysers,
   provenance detectors designed with stubs; 7,100 lines, migration 0014).
   Two things before it merges: (a) `0014_risk.sql` and `schema.ts` put a
   subquery inside a CHECK constraint (`count(DISTINCT x) from
   unnest(signal_ids)`), which PostgreSQL refuses at CREATE TABLE — move it
   into the BEFORE INSERT trigger and prove it on a freshly migrated database;
   (b) the WIP commit's wiring (`RiskReader` implementation for the payout
   domain's `buildApi({ payout: { risk } })`, `bin/risk-worker.ts`,
   `src/risk/run.ts`) is untested. No parameter properties anywhere —
   `packages/api/test/strip-only.test.ts` fails if one appears.
3. `feat/payout-recon` tip `2454dbd` (0015 recon tables, daily reconciliation
   tick, statement matching, shadow mode, the E01–E29 edge-case suite). Five
   review findings open, all real: an open discrepancy's resolution is
   mutable (make it write-once); two concurrent runs duplicate one open
   discrepancy and its ticket (partial unique index or SKIP LOCKED); the
   losing concurrent resolver returns the stale row (lock, then re-read); a
   provider order behind a locally never-sent attempt is reported clean
   (must be a discrepancy); impossible statement dates normalise into real
   dates (parse strictly). Fixtures must write a bill's lines in ONE
   statement (0011's total check runs at statement end) and use whole-dong
   totals.
4. `feat/payout-console` tip `5216c51` — a single WIP commit: the whole
   console (settle tab, preflight, bill screen with mark-paid, API batch,
   exceptions queue, flag review, api client, vi catalogue in
   `packages/api/src/i18n.ts` with a sentence for every `PAYOUT_REFUSALS`
   name). Never typechecked or run. Open: the preflight gate compares `>` at
   the five-minute boundary and has no fake-clock test (make it `>=`, cover
   299,999 / 300,000 / future / changed fingerprint); the API batch calls the
   `/run` route from item 1; the three-locale switch is a cycle and must be a
   selector; `lib/i18n.ts`'s comment still says Vietnamese is absent.
5. `mizuharaa/player-one-app` branch `feat/payout-screens` (`f75506d`, 58
   tests) — the collector's payout screens; merge into that repo's `main`.

Then: one full run with a database, a rewrite of this section, one PR.

**Decisions Daniel has to make before any real payout, in order:**
(whole-dong rounding was decided on 2026-08-27 — down — and is built);
non-verified payout accounts are refused on BOTH rails by SQL, so with no
live ZaloPay verification nobody is payable — gate G3, override is an
escalation; ZaloPay's wallet verification returns no holder name, so
"verified" on the wallet route cannot include a name check; the
`CHECKSUM-MISMATCH` quarantine (ingest spec §6) makes a redelivery with
changed bytes unpayable until a per-episode clearing route exists; PIT
withholding (export column is 0); bank-ceiling splitting (refused by name).

Not built: a console screen for Settle beyond item 4, `exception` as a
state any route can reach, the claims → sessions → settlement join (footage
can still be paid with no live claim behind it), a launchable collector app
(device transfer is a mock), dispute and second review (P2), achievements /
badges / reputation / deposit (no spec; the brief says a deposit is likely
unviable — decide before building).

Integration decisions taken on 2026-08-26, reversible, recorded in code:
custody tracking for a device starts with its first recorded period and
footage from before that is not judged (`resolve.ts`, `assigneeAt`);
bind/unbind write the custody period (`backoffice.ts`); the legacy
`/api/settle/bills/:id/pay` is gone.

The review ledger for all of this (`codex-bridge.md`, 51 findings with
verdicts and evidence) is an untracked file on the home machine; every open
item from it is in this section.

## The review slice, now built

**Thin review + settlement** landed before cloud upload. Reasoning Daniel
endorsed: the in-the-wild review standard does not exist yet — PaXini said on
13 Aug it must be rewritten during the pilot — and a tool is how it gets written.
Reviewer throughput is the bottleneck at 40,000 hours, so it needs the most time
in front of actual PaXini reviewers.

`docs/review.md` is the design record. Read it before touching
`packages/api/src/review.ts` or `money.ts`.

The **QR-02 deviation now has its ADR**:
`docs/adr/0001-review-reads-local-verification.md`, including the condition that
retires it. Rule 6's other half is *not* deviable and nothing in the lane bends
it — **no TF card is cleared**, and no code path deletes source media. That is
still a hard gate at acceptance.

The **BO-09 cut** (centres, machines and operators stay CLI/fixtures) is
recorded in `docs/adr/0003-bo09-centres-machines-operators-stay-fixtures.md`
with its trigger condition — second upload centre, or 500 collectors,
whichever first.

Daniel was sending the storage target, so the upload slice may no longer be
blocked. **Ask.** It was meant to run in parallel, not after.

## Decisions taken. Do not re-litigate these.

- **The episode id is derived from the directory basename only**, never from
  content. A content-derived id changes when bytes change, which makes
  corruption look like a new episode and silences `CHECKSUM-MISMATCH`. The
  fingerprint is a column, never a key.
- **No `UNIQUE` on `content_fingerprint`.** Two different empty sessions both
  hash to `e3b0c442…` (sha256 of nothing) and sample `072415` is one of them. A
  unique index loses a real episode.
- **Payable time is the intersection of stream coverage, not the union.**
  Appendix B of the brief prints an "actual media" column that is the IMU span —
  the widest stream — so it reads ~3% high, and 18% high on `072516`. §5.3.3 and
  UPL-14 both require the intersection. **The engine is right; do not "fix" it
  to match the appendix.**
- **A cut PTS sidecar is an incomplete index, not a stopped sensor.** Its end is
  measured from its own media: WAV byte count, MP4 packet count. Never borrowed
  from another stream — that put a `max` inside an intersection and let adding a
  stream raise a payout.
- **The device manifest is always advisory.** Its `duration_sec` is wall clock
  and overstates media ~34%, its file list names files that do not exist, its
  statistics go stale or read zero, and its `session_id` is absent in all five
  real samples. Same argument applies to anything else it claims.
- **Invariants belong in the schema, not TypeScript.** PLT-05, QR-03, SET-02,
  UPL-06 and the APP-17b declarations are CHECKs and FK shapes, tested in raw
  SQL with no application in the path. The review lane added three more:
  `episode_reviews_verdict_key` (one review per client verdict id, which is what
  stops a retry becoming a second payment), `episode_reviews_delivery_key` (one
  review per delivery) and `episode_reviews_verdict_id_check` (a decided review
  must name the request that decided it).
- **The amount on a bill comes from the *rounded* minutes, not the exact
  seconds.** 16 s at 1200/min stores `0.266667` and `320.0004`, where the exact
  product is `320.0000`. Deliberate and pinned by a test: `unit_price ×
  effective_minutes` must reproduce `amount`, because that is the first thing
  checked when an invoice is disputed. Do not "fix" it.
- **Rounding lives in exactly one function**, `quantise` in `packages/api/src/money.ts`.
  Everything feeding it converts exactly — including a float64 span boundary,
  which becomes the rational it actually is. A second rounding site anywhere in
  that file voids the guarantee. `quantise` takes a rule, and there are two:
  `half-away` is the default and everything on the review side uses it;
  `floor` is used by exactly one caller, `wholeVnd`. Two rules, still one
  function — which rule applies is a caller's decision, where the arithmetic
  happens is not.
- **A bill total is paid rounded DOWN** (Daniel, 2026-08-27). Down, not
  half-away-from-zero and not up: the platform never pays a collector more than
  the reviewed footage was worth. The floor is taken in `wholeVnd`
  (`packages/api/src/payout/domain/attempts.ts`) and by `payout_attempts_guard`
  in migration `0018`, and nowhere else. **Not on the line** — a line's amount
  has to stay reproducible from its own `unit_price × effective_minutes`, and
  flooring each line charges the loss per line: twenty 17-second lines of
  `339.9996` lose 19.992 dong that way against 0.992 dong for one floor on the
  total. **Not on `bills.total`** either — `bills_total_matches_lines` (0011)
  says the total IS the sum of the lines, and a floored total is not. So the
  bill keeps its exact figure and only the attempt's `amount_vnd` is whole. The
  refusal `payout_attempts_total_fractional` is retired; a wrong figure is now
  `payout_attempts_amount_check`. **A bill worth less than one dong floors to
  0, which is not a payment**: `issuesOf` gives it the issue `under_one_dong`
  and preflight refuses it by name, `payout_attempts_amount_positive_check`.
  That name is the table CHECK in 0012, reused before the insert on purpose —
  when the issue was missing, the insert threw mid-run and `runBatch` turned it
  into `BatchAborted`, which stopped the whole period and left every other
  collector on it unpaid.
- **A test for a rounding rule has to separate that rule from its
  alternatives.** `640.0008` gives 640 under floor AND under half-away, so a
  test written on it is green with the floor removed and proves nothing. Use a
  figure whose fractional part is at least a half — `679.9992` (679 vs 680),
  `6799.9920` (6799 vs 6800). Three of the four tests in
  `payout/integration/round-down.test.ts` were on `640.0008` and were measured
  passing with the rule disabled; they are on 17-second episodes now.
- **Auto session matching by time applies only to `session_origin = 'app'`.**
  A handover-origin `prepare_time` is what an operator typed from what a
  collector remembered; matching a microsecond PTS start against it and paying
  on the result is precision on one side only. Pilot sessions are all
  handover-origin, so multi-session cards go to the operator to confirm.
- **No `session_ended_at`.** An operator cannot supply a truthful end, and a
  retroactively typed end that decides payment attribution is the failure the
  brief warns about.
- **Session creation is split**: the app binds a session before recording
  (APP-16); the operator creates the handover when the card arrives (BO-10).
  Different objects, different moments. In the pilot the operator also creates
  the session, stamped `session_origin = 'handover'`, so the drift is measurable.
- **Privacy is legal's problem and collectors wear masks.** Capture the two
  APP-17b flags and stop. Daniel has said so explicitly; do not expand on it.
- **Status goes in the conversation, not a doc.** `docs/STATUS.md` was written
  and deleted at his request. This file is the exception because it is a handoff
  for an agent.

## Traps that have already cost time

- **The corpus is per machine, and a degraded copy once produced green runs.**
  The five real sessions live in `docs/sample_data/` (gitignored) on the org
  PC; the tests find them there with no environment variable and skip 41 tests
  when the directory is absent, which is what happens on the home machine.
  Check before trusting a green run: `ls docs/sample_data | wc -l` should say 5.
  A copy at `~/playerone-sample` with two sessions missing their media was the
  test default once; if such a copy still exists anywhere, do not point tests
  at it.
- **Never `git add -A` in this repo.** The sample corpus is 630 MB of MP4 under
  `docs/sample_data/`. It is gitignored now, but one careless add already staged
  it and timed out a push.
- **The engine must never need a database.** `env -u DATABASE_URL pnpm test`
  must keep passing — that is why the counter can work with the link down. If a
  change breaks it, the change is wrong.
- **Every test was green while a payment bug sat in the resolver.** Candidate
  sessions were scoped by collector instead of handover, and *every fixture used
  a single handover*, which is the exact shape that hides it. When you add
  fixtures, add a second collector, a second card and a second centre.
- **drizzle generates two things wrongly here.** It names constraints past
  Postgres's 63-byte limit and they truncate into collisions — name long ones
  explicitly. And it emits every FK before other `ALTER`s, so a composite FK can
  precede the `UNIQUE` it targets; `0001` is hand-ordered and says so.
- **Never edit an applied migration; append.** drizzle applies by the journal's
  `when` and never re-runs a tag, so an edit to a journaled file reaches only
  databases migrated after the edit. `0011` and `0012` were edited in place
  (`e6624e5`, `a8b20c6`, `d84d60c`) and every database migrated before that
  was silently missing `bill_lines_immutable`, `bills_total_matches_lines` and
  the unverified-account refusal; `0016_replay_bill_and_payout_guards` replays
  them idempotently, the way `0009_cloud_leg_gate` did for `0007`.
- **Vitest runs test files in parallel and every database file truncates.** Each
  gets its own database via `useDatabase(name)` in
  `packages/store/test/db.ts`. An advisory lock was tried first and does not
  scale past two files.
- **`violates()` in `packages/store/test/db.ts`** is how to assert a constraint
  fired. `rejects.toThrow(/name/)` matches drizzle's wrapper message and passes
  for any failure, including a typo in the test's own SQL.

## How Daniel works

He runs QA and audit agents against finished work and pastes the findings back.
They are usually specific and usually right. Reproduce before responding — and
do not accept on authority either: one reported fault turned out to be the
spec's own deliberate rule, and one of my own "fixes" turned out to change
nothing at all.

**Measure before asserting, including about your own change.** Claims retracted
this session: a refactor that "fixed monotonicity" and was a semantic no-op; "a
net deletion" when the file grew 490→662 lines; a 237 MB/s CPU ceiling from a
cold-buffer benchmark that was really 520. Diff old against new over the real
corpus and report the actual delta.

**Decide anything the spec already answers.** A question was escalated as a
product decision that the brief had already assigned. Search first.

**Write plainly when he asks what is going on.** He has said "too many buzzwords
I dont understand our progress", and has asked for explanations in ASD-STE100
Simplified Technical English — short sentences, one idea each, active voice.
Take that literally when asked.

Commit messages here are long and explanatory, and he reads them. State what was
measured, what changed, and what did not.

**No assistant attribution.** No `Co-Authored-By:` naming an AI, no
`Claude-Session:` trailer, no "Generated with" line in a commit message or a pull
request body. The history was rewritten once on 2026-08-25 to strip these and he
does not want them reintroduced; the work is authored by whoever runs the repo.
A sentence that happens to mention `CLAUDE.md` is content about a file and is
fine.

## Environment

Windows, Git Bash and PowerShell both available. ffmpeg is on PATH from winget.
Use a throwaway database, never the default.

He works across two machines and they differ in the two ways that break a
command, so **check which one you are on before pasting a `DATABASE_URL`**:

- **The org PC.** Local Postgres 18 is installed and running. The password is
  in the untracked `.env.local` on that machine and nowhere else — it was in
  this file once, in a public repository, and has to be rotated. If it has an
  `@`, **percent-encode it as `%40`** in a URL. Node 24, pnpm 9.
- **The other machine.** No local Postgres at all: it runs in Docker, as
  `docker start playerone-pg`, password `playerone`, and Docker Desktop may need
  launching first. Node 24, **pnpm 11** — which is why `pnpm-workspace.yaml`
  carries `allowBuilds: esbuild: true` and `.npmrc` carries
  `confirm-modules-purge=false`. Neither is needed on pnpm 9 and neither harms it.

`docs/RUNNING.md` has both paths written out.
