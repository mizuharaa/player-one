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
pnpm test                            68 tests, no sample data needed
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
| 2 | not a session directory |

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
