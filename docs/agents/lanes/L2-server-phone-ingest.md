# L2 — Server: trusted ingestion for phone-delivered sessions   (model: Opus)

## Mission
Today `POST /api/me/uploads` (`packages/api/src/collector-upload.ts` ~167) demands a
finished `EpisodeRecord` measured on the phone. The phone cannot measure: the
engine (`packages/ingest`) needs Node fs + ffprobe. Make the server measure
instead: accept an UNMEASURED delivery, verify its bytes (existing read-back),
then materialise it into `mediaRoot` and run the existing engine over it, so it
becomes a normal episode that the review lane can play and settle.

## Base
Branch from `sprint/demo-candidate` (L1's output) into worktree `C:/Users/user/pw/phone-ingest`,
branch `feat/phone-ingest`.

## Contract (frozen. L3 builds the phone against exactly this)
`POST /api/me/uploads` body gains a second shape. Discriminate on presence of `episode`:
- measured (today): unchanged.
- unmeasured (new): `{ id, collection_session_id, session_basename, files: DeclaredFile[], client_version? }`
  - `session_basename`: the on-card directory name (e.g. `ego_AZER76400FE_20260813_072310`).
    Validate with the naming knowledge `packages/ingest/src/classify.ts` already has;
    reject anything else (400 `session_basename_unrecognised`).
  - `files`: EVERY file in the directory: relative_path + bytes + sha256. Same `FilePlan` response as today.
  - `id` stays client-generated (idempotent replay).
`GET /api/me/uploads/:id` returns `state`:
  `registered | transferring | verified | ingesting | ingested | held | failed`, plus
  `held_reason` / `failed_reason`, and `episode_id` once ingested. Existing fields stay.
`POST /api/me/uploads/:id/complete`: unchanged read-back verification, then for an
unmeasured delivery transition to `ingesting` and run the ingest stage (below).
Keep completion SHORT for the demo: synchronous is acceptable for clips under ~200 MB.
Mark it: `// ponytail: synchronous ingest, ceiling ~200 MB per delivery; job table + worker for production sessions`.
PART_SIZE is 64 MiB (`upload-worker.ts:224`).

## Ingest stage
1. Download every verified object to `<mediaRoot>/<session_basename>/<relative_path>`.
   If the directory already exists: compare hashes; identical means the same session
   arriving twice (card AND phone), so reuse; different means state `held`, reason
   `basename_collision`, never overwrite, never ingest.
2. Call the engine exactly as Path C's counter import does (find that call site in
   `packages/api/src/upload.ts` / `counter.ts`; reuse, do not fork). Persist via the
   same store path so the same `episodes` / `episode_ingests` / `episode_streams` rows result.
3. Link `collector_uploads.episode_id`; attribution to `collection_session_id` as
   the app path already defines (APP-16). Session origin stays `app`.
4. Under review gate `cloud`: the delivery IS the cloud copy and has just been read
   back, so record the cloud verification the same way Path C does, and the episode
   enters the review queue.

## Schema
Append a migration (next free number in the journal; never edit an applied one):
`collector_uploads` gains `measured boolean not null default true`, `state`,
`held_reason`, `episode_id` FK. Name constraints explicitly (63-byte limit). Any
new invariant is a CHECK, tested in raw SQL with `violates()` from `packages/store/test/db.ts`.

## Invariants that must not move
Episode id from directory basename only. No UNIQUE on content_fingerprint. Payable
time is the intersection. The phone sends NO duration, NO amount, NO measured anything.
Rounding stays in `quantise`. Nothing deletes source media. Adding a stream never raises payout.

## Proof (vitest, database, fs-backed ObjectStore stub as in `scripts/e2e-loop.mjs`)
A. unmeasured register, plan, PUT parts, complete: state `ingested`, episode row
   exists, streams measured by the engine, `GET /media/episode/:id/part/0` returns 206
   with `PLAYERONE_REVIEWER_MEDIA=1` + secure cookies in the harness. Actual bytes.
B. Same session submitted via Path C afterwards (or before): ONE episode, ONE bill
   possible; the second path reports the reuse. Use a real corpus session
   (`PLAYERONE_SESSIONS`, `PLAYERONE_REQUIRE_CORPUS=1`).
C. Complete called twice: idempotent, no second ingest, no second episode.
D. Tampered byte: read-back fails, state `failed`, nothing under mediaRoot.
E. Basename collision with different content: `held`, original untouched.
F. `env -u DATABASE_URL` suite still green (engine never needs a database).
Record your own pass/fail/skip and the database name. ffprobe is on PATH here.

## Done means
All of A–F green in your report with numbers; migration appended and journaled;
`pnpm typecheck` clean; no change to money, review or ingest engine internals.
Report the exact request/response JSON for the unmeasured path so L3 can copy it.
Do not push.
