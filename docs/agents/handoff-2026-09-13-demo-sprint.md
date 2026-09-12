# Handoff: September 17 demo sprint, paused 2026-09-13 for a laptop migration

Written by the orchestrating Claude session on the org PC (DESKTOP-J56KNJ2) at
about 01:30 +07 on 2026-09-13. Read this, then the lane briefs in
`docs/agents/lanes/`, then `CLAUDE.md` at the repo root. Verify every SHA and
count below against Git before trusting it; this file is a dated snapshot.

The goal is unchanged: on Thursday 2026-09-17, one truthful paid transaction.
A fresh physical recording becomes a cloud-verified episode, a human reviews
it, finance records a real manual payment to a verified destination, the
collector sees the receipt. Then a second episode uploaded from a real phone.

## Branches on origin, and what each is

| Branch | SHA | What |
|---|---|---|
| `sprint/demo-candidate` | `e7bde5f` | **The base for all remaining work.** `sprint/ui-revamp` (deployed) merged with `sprint/demo-release` (eight release commits). `e765f0e` is the merge; `e7bde5f` is an empty pause marker. |
| `sprint/ui-revamp` | `9db5248` | What Railway production runs (deployment `ca56508e`). Superseded by the candidate for engineering; keep for reference. |
| `sprint/demo-release` | `6cc29b7` | Retry recovery, onboarding recovery, Android release profiles, centre deployment kit. Merged into the candidate. |
| `sprint/demo` | `adc2f11` | Codex's earlier candidate. Superseded; it lacks three API registrations the candidate has. Do not build on it. |
| `chore/rehearsal-harness` | see Git | L5's evidence script, demo script, payment runbook, ext4 card procedure. Based on demo-release; merges onto the candidate. |
| `wip/main-leftovers-2026-09-09` | see Git | Nine stray edits found on main's working tree, preserved unreviewed. Not for the sprint. |
| `main` | `325f94e` | Untouched. |

## Lane status

Lane briefs are in `docs/agents/lanes/`. Each names its model, base, proof and
"done means". Run each lane in its own worktree under `C:\Users\user\pw\<slug>`
(or the equivalent on the new machine).

**L1 integration: done, with open items.** Worktree `pw/demo-candidate`.
Measured at `e765f0e` by the L1 agent:

- `pnpm install --frozen-lockfile` clean.
- Root typecheck clean. Collector and console typecheck clean; note the root
  gate covers `packages/*` only, so run the app typechecks separately.
- Engine-free vitest: 72 files passed, 39 skipped, 0 failed; 1039 tests
  passed, 834 skipped. Real 5-session corpus.
- Collector `test:release`: 13 pass, 0 fail.
- Route parity: all 16 collector paths and all 40 console paths are
  registered. Table in the merge commit message.
- Dropped `c2e0775` (the native presentation port). It would have deleted
  590 lines of collector translations and swapped the landing video stack.
  Details in the merge commit.
- Corrected `docs/RUNNING.md`: the demo phone must be `+84900000001`, not
  `0900000001`, because the app composes E.164 and the server matches bytes.

Not run at `e765f0e`, so still owed before the candidate is trusted:

1. The database vitest suite. Postgres was down during the lane. It is up
   now on this PC. Run with `PLAYERONE_REQUIRE_CORPUS=1` on a throwaway
   `po_*` database, and record the numbers.
2. `node --test deploy/*.test.mjs`. On `sprint/ui-revamp` this passes 8 of 8
   in under a second. On the merged tree it produced no output for 600 s.
   Not diagnosed. The L1 agent also excluded these files from vitest
   collection, so right now nothing runs them. Diagnose before anything else
   in L2 touches `deploy/`.
3. Console production build.
4. The centre preflight in `deploy/centre/`.

**L5 rehearsal harness: written, GreenNode run pending.** Worktree
`pw/rehearsal`, branch `chore/rehearsal-harness`. Written: read-only
`packages/api/scripts/demo-evidence.mjs`, `deploy/centre/DEMO-SCRIPT.md`
with the payment runbook and the ext4 card procedure. The e2e-loop run
against GreenNode HCM04 was requested after Postgres came up; check the
branch's latest commit message for whether it ran and its numbers. If it did
not, run it: it is today's proof that the cloud leg is unblocked.

**L2 server phone ingest: not started.** Opus. Base: the candidate. The
contract is frozen in `lanes/L2-server-phone-ingest.md` and L3 builds against
it. This is the single largest piece of new code in the sprint.

**L3 phone upload app: not started.** Opus. Base: the candidate. Parallel
with L2 against the same contract.

**L4 Android build: not started.** Sonnet. Build once from the candidate
now to prove the pipeline, again after L3 merges.

## Priority order

1. Close L1's four open items on the candidate.
2. L2 and L3 in parallel.
3. L4 first build, in parallel with 2.
4. Merge L5, then L2, then L3 onto the candidate; QA each diff and re-run
   every gate on a fresh database before merging.
5. L4 final build.
6. Rehearsal, freeze, on-site.

## Blockers that need the owner, not an agent

- ZaloPay Verify Account credentials (`PLAYERONE_ZALOPAY_APP_ID`, `KEY1`,
  `PUBLIC_KEY`, `PAYMENT_ID`). Without them mark-paid refuses with
  `payout_attempts_account_unverified` and the demo ends at "awaiting
  payment". Not present in any local or Railway environment.
- Demo host. Railway production has only `DATABASE_URL`, cookies and the
  token secret: no storage keys, no media root, no payout mode, no ffmpeg in
  the image. It cannot run the paid loop. The centre kit on a Windows PC is
  the designed host. GreenNode keys live in the org PC's root `.env.local`.
- Hardware: Ego unit, TF reader, ARM Android phone with OTG. The card is
  ext4; Windows cannot read it. The org PC has usbipd-win and WSL Ubuntu, so
  the card can be attached into WSL. Procedure written in L5, untested.
- Reviewer playback: `PLAYERONE_REVIEWER_MEDIA=1` is off until legal signs.
  "Play and seek before verdict" needs it on. Owner decision.
- Google Play: org account access, upload keystore, tester list.

## Corrections to earlier plans

- The orchestrator's brief for L1 said the merge had zero conflicts. It had
  nineteen. The measurement used the old three-argument `git merge-tree`
  form, which does not report conflicts the way `--write-tree` does. Measure
  with `git merge-tree --write-tree A B`.
- Git's auto-merge silently duplicated six constructs outside any conflict
  marker (imports, `disabled` attributes, i18n keys). Only the app typechecks
  caught them. Any future merge of these two lineages needs both app
  typechecks, not just the root one.
- Another Claude session on the org PC had drafted a parallel plan for the
  same sprint with different lane names (A, B1, B2, D, E, H) based on
  `sprint/demo`. It was in plan mode and wrote no code. Its plan is
  superseded by this handoff; do not run both.

## Environment on the org PC, for whoever continues there

Postgres 18 service; password `090807@Khang` (encode `@` as `%40`). Starting
it needs an elevated shell. After an unclean stop it fsyncs the whole data
directory for twenty minutes or more; that is recovery, not a hang. Node 24,
pnpm 9, ffprobe on PATH, JDK 17 and the Android SDK at `C:\Android\sdk`,
`PLAYERONE_SESSIONS` set to the real corpus. Docker Desktop's disk image was
deleted on 2026-09-13 to free 45 GB; Docker will recreate it. Railway CLI is
not on PATH: `npx --yes @railway/cli`.

## Meeting acceptance, unchanged

See `deploy/centre/DEMO-SCRIPT.md` on `chore/rehearsal-harness` and the
"Meeting acceptance script" section of the Codex assessment
(`~/Documents/Codex/2026-09-12/playerone-demo-sprint.md` on the org PC, also
in the migration bundle). If provider verification is absent on Thursday the
honest state is "awaiting payment"; a fake verifier must not turn that gate
green.
