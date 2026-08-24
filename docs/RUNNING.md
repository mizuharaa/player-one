# Running PlayerOne

From a fresh clone, on any machine. Every command is run from the repo root.

## What you need

| | Why |
|---|---|
| **Node ≥ 22.18** | The repo runs `.ts` files directly, which needs native type stripping. `node -v` |
| **pnpm 9** | Workspace. `npm i -g pnpm@9` |
| **ffmpeg** on PATH | `ffprobe` is the container-timing fallback when a PTS sidecar is unusable. Six tests fail without it, and an upload centre without it measures durations wrong. `ffprobe -version` |
| **Postgres 16+** | Only for the store, the API and their tests. Everything else runs without one. |

## First run

```
pnpm install
pnpm typecheck
pnpm test
```

`pnpm test` passes on a clean machine with no database and no sample data — the
tests that need either skip themselves. That is deliberate: the ingest engine
runs at upload centres with the link down, so it must never need a database.

Expect roughly `148 passed, 85 skipped`. With a database and the sample corpus,
`237 passed, 2 skipped`.

## Adding a database

Any Postgres will do. A throwaway one is safest, because the test suite
truncates every table and creates a database per test file.

```
docker run -d --name playerone-pg -e POSTGRES_PASSWORD=playerone -p 5432:5432 postgres:16
```

Then point `DATABASE_URL` at it and apply the migrations:

```
# bash
export DATABASE_URL='postgres://postgres:playerone@localhost:5432/postgres'
# PowerShell
$env:DATABASE_URL = "postgres://postgres:playerone@localhost:5432/postgres"
# cmd
set DATABASE_URL=postgres://postgres:playerone@localhost:5432/postgres

pnpm db:migrate
pnpm test
```

**A password with `@` or `:` in it must be percent-encoded** — `@` is `%40`.
An unencoded one parses as part of the host and fails to connect.

The suite creates `<database>_store`, `_spine`, `_api`, `_audit`, `_counter`
and `_episodes` beside whatever `DATABASE_URL` names, one per test file, because
vitest runs files in parallel and each truncates. Nothing else uses them.

## Adding the sample sessions

Five real sessions from device `AZER76400FE`, recorded 13 August 2026. **Not in
the repo** — 630 MB of H.264 — and `.gitignore` excludes them. Ask Alois.

Extract so that the `ego_AZER76400FE_20260813_*` folders end up under
`docs/sample_data/`. One wrapper directory is fine; the tests look through it.
No environment variable needed:

```
docs/sample_data/EgoCamera Sample Data/ego_AZER76400FE_20260813_072310/...
docs/sample_data/<anything>/EgoCamera Sample Data/ego_AZER76400FE_.../...   also works
```

Anywhere else, set `PLAYERONE_SESSIONS` to the directory *containing* the
`ego_*` folders.

Sanity check — all five must ingest, none quarantine:

| Session | Duration | Notes |
|---|---|---|
| 072310 | 8.500 s | 3 clean sessions |
| 072415 | 9.333 s | |
| 072516 | 10.400 s | IMU clock fault, streams excluded |
| 072538 | 20.980 s | never closed, zero-byte camera PTS |
| 073055 | 132.961 s | never closed, all statistics zero, 437 MB of good video |

That is acceptance 10.3.9, and the brief calls it the test to build first.

## The CLI

```
pnpm ingest <session-dir>                   summary
pnpm ingest <session-dir> --json            the EpisodeRecord
pnpm ingest <session-dir> --json --out episode.json
pnpm ingest <session-dir> --store           also write it to Postgres
pnpm ingest --list                          stored episodes, newest first
pnpm ingest --show <episode-id>             one episode and its ingest history
pnpm bench --gb 2                           throughput and peak memory
pnpm fixtures                               regenerate fixtures/sessions
```

`pnpm ingest` only works from inside the repo. From elsewhere, call node
directly: `node packages/ingest/bin/ingest.ts <session-dir>`.

Paths must be in your own shell's format — `/c/Users/...` is Git Bash and
cmd.exe cannot resolve it.

Exit codes: `0` ok or flagged, `1` quarantined, `2` not a session directory or a
bad argument, `3` measured fine but the store could not be written.

## The operator API

`packages/api` is a Fastify app, built by `buildApi({ db, tokenSecret })`. There
is no server entrypoint yet — the console slice adds it. Until then the tests
and `packages/api/scripts/verify-e2e.mjs` are how it runs.

Two credentials are required on every mutation: a machine token and an operator
token. Seed a centre, a machine and an operator with `credential_hash` set from
`hashCredential()`, then `POST /auth/machine` and `POST /auth/operator`.
`packages/api/test/counter.test.ts` is the shortest worked example.

## Migrations

```
pnpm db:generate     after editing packages/store/src/schema.ts
pnpm db:migrate      apply to $DATABASE_URL
```

Generated SQL lands in `packages/store/drizzle/` and is committed. Two things
drizzle gets wrong here and that a generated file may need fixing for by hand:

- It names constraints past Postgres's 63-byte limit and they get truncated into
  collisions. Name anything long explicitly in `schema.ts`.
- It emits every foreign key before other `ALTER`s, so a composite FK can be
  written before the `UNIQUE` it targets. `0001` is hand-ordered for this and
  says so in a comment; regenerating does not rewrite it.

## Where things are

| Path | What |
|---|---|
| `packages/contracts` | `EpisodeRecord` (zod), episode id and content fingerprint |
| `packages/ingest` | the measurement engine and the CLI |
| `packages/store` | Postgres schema, migrations, episode store, catalogues |
| `packages/api` | operator API: auth, counter workflow, session resolver |
| `fixtures/sessions` | 22 synthetic sessions, one per failure mode, committed |
| `docs/episode-identity.md` | why the episode id is derived the way it is |
| `docs/playerone-ingest-engine-spec.md` | the engine specification |

The authoritative requirements document is `Player One — Engineering Brief
v1.0`, which is **not in this repo**. Part 6 holds the requirement IDs that the
code comments cite (`PLT-`, `UPL-`, `QR-`, `SET-`, `APP-`, `BO-`, `P2-`).

## Two things that will bite

**The device manifest is always advisory.** Its `duration_sec` is wall clock and
overstates media by ~34%; its file list names files that do not exist; its
statistics go stale or read zero. Raw duration comes from stream timestamps
only. If you find yourself reading the manifest to decide something, that is the
bug.

**Payable time is the intersection of stream coverage, not the union.** Appendix
B of the brief prints an "actual media" column that is the IMU span — the widest
stream — so it reads ~3% higher than what this engine reports, and 18% higher on
072516. §5.3.3 and UPL-14 both require the intersection. The engine is right and
the appendix is the union; do not "fix" the engine to match it.
