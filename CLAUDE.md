# PlayerOne — agent handoff

Read this before touching anything. Written 2026-08-22, at the end of the slice
that gave every recording an owner.

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

Branch **`fix/session-handover-scope`**, everything pushed. `origin/main` is
five PR merge commits behind and **has none of this session's work** — the
content of those merges is already in this chain, so `main` needs a merge commit
when someone decides to do it. Nobody has.

Branch per feature, all on the remote: `feat/operator-auth`,
`feat/audit-trail`, `feat/counter-endpoints`, `feat/session-resolver`,
`fix/session-handover-scope`. Daniel wants a branch per feature with a
descriptive name, and no commit until the feature actually works.

Built and tested: the ingest engine, the episode store, the identity spine
(19 tables), both-token auth, the audit trail, the counter workflow, the session
resolver. Migrations `0000`–`0003`.

**237 tests. 235 pass, 2 skip** (they need `PAXINI_SAMPLE`, a HuggingFace
checkout nobody has). With no `DATABASE_URL`: 148 pass, 89 skip — that property
is load-bearing, see below.

Not built: cloud upload and verification (UPL-04/05/06 runtime), the operator
console (BO-09/BO-10), the review lane (QR-*), settlement logic (SET-*), the
collector app (all `APP-*`, blocked on PaXini owing D1 and D5).

## The next slice, already decided

**Thin review + settlement**, not cloud upload. Reasoning Daniel endorsed: the
in-the-wild review standard does not exist yet — PaXini said on 13 Aug it must
be rewritten during the pilot — and a tool is how it gets written. Reviewer
throughput is the bottleneck at 40,000 hours, so it needs the most time in front
of actual PaXini reviewers.

Two deviations come with it and both need an ADR, not a footnote:
**QR-02** ("no episode enters review before cloud checksum verification") and
**PRD §11.3.1 rule 6**. Rule 6's other half is *not* deviable — **no TF card is
cleared** under this deviation. The review gate reads local verification until
the upload slice lands, and that is a hard gate at acceptance.

Daniel was sending the storage target, so the upload slice may no longer be
blocked. **Ask.** It was meant to run in parallel, not after.

Also owed, from an ADR that was specified and never written: the BO-09 cut
(centres, machines and operators stay CLI/fixtures) with its trigger condition —
second upload centre, or 500 collectors, whichever first.

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
  SQL with no application in the path.
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

- **`~/playerone-sample` holds a DEGRADED copy of the corpus** — two of the five
  sessions have no media. It was the test default and produced green runs on
  broken data. The real corpus is in `docs/sample_data/` (gitignored) and the
  tests find it there with no environment variable. **Delete or replace
  `~/playerone-sample`.** It is still there.
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

## Environment

Windows, Git Bash and PowerShell both available. Local Postgres 18 is running;
password `090807@Khang` for all — **percent-encode the `@` as `%40`** in a URL.
Use a throwaway database, never the default. ffmpeg is on PATH from winget.
Node 24, pnpm 9.
