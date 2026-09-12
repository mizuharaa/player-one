# L1 — Release integration → `sprint/demo-candidate`   (model: Opus)

## Mission
Produce ONE reviewed source revision that carries everything on `sprint/ui-revamp`
(deployed to Railway as ca56508e) PLUS the eight release commits on
`sprint/demo-release` (d1168fb..6cc29b7) PLUS, if it fits without fighting, the
native presentation port c2e0775. This revision is the base for every other lane.

## Facts already measured (do not re-derive)
- `git merge-tree` of demo-release onto ui-revamp: 0 conflicts.
- `registerEngineering`, `registerOperatorProfile`, `registerShowcaseFootage` are
  registered in ui-revamp's `packages/api/src/index.ts` (lines ~763-765). The
  demo branch adc2f11 lacks them; adc2f11 is superseded by your branch.
- ui-revamp has NO `deploy/centre/` and NO ffmpeg in its Dockerfile. demo-release
  brings `deploy/centre/` (Windows centre kit: Caddy, tasks, check.mjs, REHEARSAL.md).
- Both branches edit `apps/collector`; ui-revamp's d39c102 did a "collector native pass".

## Steps
0. Worktree: `git worktree add C:/Users/user/pw/demo-candidate -b sprint/demo-candidate sprint/ui-revamp`
   (ui-revamp's working tree in pw/ui-integrate will have been committed by the
   orchestrator before you start; verify `git status` there is clean, else stop and say so.)
1. `git merge --no-ff sprint/demo-release`. Read the full merge result for
   semantic conflicts that Git cannot see, specifically: `packages/api/src/index.ts`,
   `packages/api/bin/serve.ts`, `apps/collector/src/api/http.ts`, the collector
   navigation root, `docs/RUNNING.md`. Both sides added things; nothing may be lost.
2. Try `git cherry-pick c2e0775`. If it conflicts in more than trivial ways with
   ui-revamp's collector pass, DROP it and report which screens differ; do not
   hand-merge two visual systems.
3. Route parity: extract every path the collector app calls
   (`grep -o "'/api/[^']*'" apps/collector/src/api/http.ts`) and every path the
   console calls (`grep -rho "'/api/[^']*'" apps/console/src`) and prove each is
   registered on the server (`grep -rn "app\.\(get\|post\|put\|patch\|delete\)('" packages/api/src`).
   Report the table. Unregistered = blocker; fix by registering, never by stubbing.
4. Gates. Run all. Record the numbers YOU observed at THIS step and the database
   name. A count quoted from an earlier step is a failed gate.
   - `pnpm install --frozen-lockfile`
   - `pnpm typecheck` (root)
   - `env -u DATABASE_URL pnpm exec vitest run --testTimeout=180000`
   - `DATABASE_URL=<throwaway po_l1_*> PLAYERONE_REQUIRE_CORPUS=1 pnpm exec vitest run --testTimeout=180000 --hookTimeout=180000`
     (local Postgres 18; password in root `.env.local`; `%40` for `@`; PLAYERONE_SESSIONS is already set)
   - `pnpm --filter @playerone/collector test:release`
   - `node --test deploy/*.test.mjs`   (node:test files; vitest reports them as "no suite", which is not a failure)
   - `pnpm --filter @playerone/console build`
   - the centre preflight named in `deploy/centre/README.md`, against `centre.env.example`. Report what it checks and what passed.
5. Drop the throwaway database (`CHECKPOINT;` first; plain DROP, never FORCE).

## Invariants (from CLAUDE.md, binding)
Never edit an applied migration. Never `git add -A`. No assistant attribution
trailers in commit messages. Engine must pass with no DATABASE_URL. Commit messages
say what was measured, what changed, what did not.

## Done means
Branch `sprint/demo-candidate` exists, one merge commit (+ optional cherry-pick),
all gates above green with your own numbers in the report, route-parity table
with zero unregistered rows, and a list of what c2e0775 would have changed if dropped.
Report the SHA. Do NOT push. Do NOT merge into main.
