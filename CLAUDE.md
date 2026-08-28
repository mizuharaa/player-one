# PlayerOne — agent handoff

Read this before touching anything.

This file holds only what does not rot: decisions, and traps that have already
cost time. Both sections are cumulative — append, do not rewrite. Current state
is not in here; the State section below tells you how to derive it from Git.

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

## State — derive it from Git, never read it here

There is no snapshot in this file any more, on purpose.

There used to be one: branch names, test totals, a migration range, a list of
what was not built. It rotted every time somebody merged. One copy of this file
was measured 92 commits behind — it named a branch that had already been
deleted and claimed 342 tests when the suite had about a thousand. Agents are
told this file is binding, so they believed it: they rebuilt work that had
already shipped and branched from the wrong commit.

A snapshot cannot be kept correct by the person writing it. So run these
instead. They take under a minute and they cannot be stale.

**Where you are, and how far `main` has moved.**

```
git fetch origin
git log --oneline -1 origin/main
git status -sb
git log --oneline HEAD..origin/main   # landed since you branched
git log --oneline origin/main..HEAD   # yours alone, not yet merged
```

**What every other agent is doing right now.** One worktree per agent, and the
branch name is the job. Check this before you start: somebody may already be
building what you were asked to build.

```
git worktree list
git for-each-ref --sort=-committerdate \
  --format='%(committerdate:short) %(refname:short)' refs/heads | head -30
```

**The migrations.** drizzle applies them in the journal's `when` order, not by
filename. Numeric prefixes repeat deliberately — `0016_*` is six distinct
migrations. Never renumber one, never edit an applied one (see Traps).

```
grep -o '"tag": "[^"]*"' packages/store/drizzle/meta/_journal.json
grep -c '"tag"' packages/store/drizzle/meta/_journal.json
```

**The test inventory.** Run it both ways; the second is load-bearing and is
explained in Traps.

```
git ls-files '*.test.ts' | wc -l
pnpm exec vitest run --testTimeout=180000 --hookTimeout=180000
env -u DATABASE_URL pnpm exec vitest run --testTimeout=180000
```

Export `PLAYERONE_SESSIONS` at the real corpus first, or 41 tests skip in
silence and the run still looks green. Never write `pnpm test -- --flags`; the
flags do not reach vitest.

**What is and is not built.** The code answers this faster and more honestly
than prose ever did. `git ls-files packages/api/src`, and
`packages/store/src/schema.ts` for the shape of the data. For *why* something
is the way it is, read the commit message — they are long here, and they say
what was measured, what changed and what did not.

**Where live state actually lives:** `CODEX_BRIDGE.md` at the repo root. That
is the running ledger — the protocol, the findings per agent slug, and the
`## Agent reports` log that each agent appends one line to when it finishes.
It is about 350 KB, so do not read all of it: read `## Protocol`, the
`[general]` and `[context-audit]` findings, and your own slug. Open questions
and open review findings belong there, not here.

Only two kinds of thing belong in this file: a decision that will still be true
next month, and a trap that has already cost somebody a day. Both are below.
If you catch yourself typing a number into this file, it belongs in
`CODEX_BRIDGE.md` instead.

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

The **SEC-06 disk-encryption decision** is
`docs/adr/0004-sec06-is-disk-encryption-at-the-upload-centre.md`. It is on
`feat/encryption`, not yet on `main`. Owner is Alois.

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
  stops a retry becoming a second payment), `episode_reviews_delivery_key` and
  `episode_reviews_verdict_id_check` (a decided review must name the request
  that decided it).
- **`episode_reviews_delivery_key` is partial, and that is QR-08, not a bug.**
  `0004_review_lane` made it one review per delivery, full stop.
  `0016_dispute_review` deliberately replaced it with a *partial* unique index
  — one review per delivery **where `dispute_id is null`** — and added
  `episode_reviews_dispute_key`, one second review per dispute. So a delivery
  carries at most one ordinary review plus at most one dispute review. The
  `on conflict` targets in `review.ts` carry the predicate, so a race still
  loses on the index and not on application logic. An earlier version of this
  file still described the 0004 rule; anyone who "restored" it would delete
  second review and undo QR-08. Do not.
- **The amount on a bill comes from the *rounded* minutes, not the exact
  seconds.** 16 s at 1200/min stores `0.266667` and `320.0004`, where the exact
  product is `320.0000`. Deliberate and pinned by a test: `unit_price ×
  effective_minutes` must reproduce `amount`, because that is the first thing
  checked when an invoice is disputed. Do not "fix" it.
- **Rounding lives in exactly one function**, `quantise` in `packages/api/src/money.ts`.
  Everything feeding it converts exactly — including a float64 span boundary,
  which becomes the rational it actually is. A second rounding site anywhere in
  that file voids the guarantee. That part is not negotiable.
- **Bill totals round DOWN.** Daniel decided this on 2026-08-28. Down — not
  half away from zero, not up. The collector is never paid a fraction of a dong
  that was not earned, and the rounding error never favours the platform's
  paperwork over the ledger. `quantise`'s historical rule was half away from
  zero and `main` still carries it, so this is a decision, not a description:
  check `packages/api/src/money.ts` before you assume either way. Whatever the
  rule is, it stays inside `quantise`.
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
- **Do not invent extra collector consent fields beyond APP-17b.** Privacy is
  legal's problem and collectors wear masks; capture the two APP-17b
  declarations and add no third. That is the whole of this rule, and it is
  narrower than it once read. It does **not** waive the platform's privacy,
  access-control, residency, audit or reviewer-routing obligations — the
  privacy review queue, scoped reviewer access, media denied by default and the
  residency gate are all built, all required, and none of them are "expanding
  on privacy". The rule is about the collector-facing consent form only.
- **The app never starts or stops recording.** The camera's own physical
  buttons do, and only they. The Bluetooth library exposes scan, connect,
  characteristic read and write, Wi-Fi provisioning and an IP query — there is
  no record command in it. Do not design a screen, a route or a test around the
  app arming or ending a recording; it cannot.
- **Cloud verification runs inside the GreenNode VPC.** GreenNode has no native
  SHA-256. Their suggested "put the hash in object metadata and read it back
  with HeadObject" is rejected: that returns the hash *we sent*, not a hash of
  the bytes they stored, so it proves nothing about the stored object. The
  read-back has to hash real bytes, and it runs in the VPC so the bytes do not
  cross the internet twice.
- **Disk encryption at the upload centre is SEC-06's answer, and Alois owns
  it.** ADR 0004 (on `feat/encryption`). It is an operations task on the centre
  PC; the software must not depend on it and cannot verify it remotely.
- **A pre-deploy phase runs before the collector pilot**: 20 internal VNG
  employees with Ego devices. Real devices, real upload, real review, staff
  instead of paid collectors. Plan for it as its own phase — it comes first.
- **Status goes in the conversation, not a doc.** `docs/STATUS.md` was written
  and deleted at his request. This file is the exception because it is a handoff
  for an agent — and it holds decisions and traps only, never status.

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
- **`DROP DATABASE` is not hanging — it is waiting for a checkpoint.** Measured
  2026-08-28 on the org PC. `dropdb()` forces an immediate checkpoint and waits
  for it, so a drop costs whatever is dirty at that moment, not what the
  database contains. On an idle server that is nothing: one drop took **2m 2s**
  and flushed a week's backlog, then the next two took **0.34s** and **0.32s**,
  and a bare `CHECKPOINT` took **0.15s**. Under load it comes back — with other
  agents running tests and a large delete churning the disk, drops went back to
  about two minutes each. So `CHECKPOINT;` first, then drop in a loop, and do it
  when the machine is quiet. Confirm it rather than guessing — a drop that looks
  hung shows `wait_event_type = IPC`, `wait_event = CheckpointDone` in
  `pg_stat_activity`. That is waiting, not deadlock, and killing it wastes the
  flush already done. Every agent that met the two-minute first drop
  concluded "drops hang here" and stopped cleaning up, which is how the server
  reached **2,219 `po_*` databases** and slowed every test run for a week. Clean
  up after yourself.
  Use plain `DROP DATABASE`, never `WITH (FORCE)`: plain refuses while anyone is
  connected, and that refusal is the guard that stops you deleting a database
  another agent is using. A dropped test database is cheap anyway — `db()` in
  `packages/store/test/db.ts` recreates and re-migrates it on demand.
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
