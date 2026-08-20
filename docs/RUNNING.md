# Running the ingest engine

## Setup, once

```
cd C:\Users\user\OneDrive\Documents\player-one
pnpm install
```

## From the repo directory

```
pnpm ingest <session-dir>            summary
pnpm ingest <session-dir> --json     the EpisodeRecord
pnpm ingest <session-dir> --json --out episode.json
pnpm ingest <session-dir> --store    also write it to Postgres
pnpm ingest --list                   stored episodes, newest first
pnpm ingest --show <episode-id>      one episode and its ingest history
pnpm test                            no sample data and no database needed
pnpm typecheck
pnpm fixtures                        regenerate fixtures/sessions
pnpm bench --gb 4                    throughput and peak memory
```

`pnpm ingest` only works from inside the repo — pnpm looks for package.json in
the current directory. From anywhere else, call node directly:

```
node "C:\Users\user\OneDrive\Documents\player-one\packages\ingest\bin\ingest.ts" "<session-dir>"
```

Paths must be in your shell's own format. `/c/Users/...` is a Git Bash path and
cmd.exe cannot resolve it; use `C:\Users\...` in cmd and PowerShell.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok or flagged |
| 1 | quarantined |
| 2 | not a session directory, or a bad argument |
| 3 | measured fine, but the store could not be written |

## Worked example, cmd.exe

```
cd C:\Users\user\OneDrive\Documents\player-one
pnpm ingest "C:\Users\user\playerone-sample\EgoCamera Sample Data\ego_AZER76400FE_20260813_072310"
```

Expect `8.500 s`, `pts_sidecar`, `exact`, skew `504.2 ms`, state `FLAGGED`.

## Fixtures worth pointing it at

Each is one failure mode, and none needs the sample data.

| Directory under `fixtures/sessions/` | Proves |
|---|---|
| `multipart` | three parts assembled into one episode |
| `reversed-parts` | numbering contradicts timestamps; timestamps win |
| `clock-fault` | broken sensor clock excluded, footage kept |
| `truncated-sidecar` | timestamp file cut mid-number |
| `interior-part-missing` | quarantined, exit 1 |
| `no-manifest` | the only fixture that comes out `ok` |

## Running against the real sample sessions

```
set PLAYERONE_SESSIONS=C:\Users\user\playerone-sample\EgoCamera Sample Data
pnpm test
```

Without it, the 14 real-session tests skip and the other 68 still run.

## The assessment write-up

`docs/ingest-assessment.html` — open it in a browser. No server, no network.

## The episode store

`--store` is opt-in and off by default. Without it the engine opens no
connection at all and behaves exactly as it did in 0.3.1 — it runs at upload
centres with the link down, so the measurement path never needs a database.

### Postgres for the tests, once

```
docker run -d --name playerone-pg -e POSTGRES_PASSWORD=playerone -p 5432:5432 postgres:16
```

Then, in cmd.exe:

```
set DATABASE_URL=postgres://postgres:playerone@localhost:5432/postgres
```

or in PowerShell:

```
$env:DATABASE_URL = "postgres://postgres:playerone@localhost:5432/postgres"
```

`pnpm test` applies the migrations itself and truncates between tests. Without
`DATABASE_URL` the store tests skip and everything else still runs, the same way
the real-session tests skip without `PLAYERONE_SESSIONS`.

Bring it back up later with `docker start playerone-pg`; throw it away with
`docker rm -f playerone-pg`.

### Migrations

```
pnpm db:generate                     after editing packages/store/src/schema.ts
pnpm db:migrate                      apply to $DATABASE_URL
```

Generated SQL lands in `packages/store/drizzle/` and is committed. `--store`
does not migrate on its own; run `pnpm db:migrate` against a new database first.

### What a re-ingest does

| Second delivery | Result |
|---|---|
| never seen | `stored: new` |
| same fingerprint | `stored: duplicate (no-op)`, only `last_seen_at` moves |
| different fingerprint | `stored: mismatch`, a second ingest row plus `CHECKSUM-MISMATCH` naming every changed, added and removed file |

One episode is one session however many times it arrives. Identity comes from
the directory name, never from the bytes — see `docs/episode-identity.md` for
why that distinction is the one worth not reversing.
