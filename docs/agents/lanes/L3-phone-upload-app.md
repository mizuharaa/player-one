# L3 — Collector app: real phone → cloud upload   (model: Opus)

## Mission
`apps/collector/src/api/http.ts` ~447 throws `upload_not_supported` with a comment
saying no server route exists. That is stale: `/api/me/uploads` exists and L2 is
extending it to accept unmeasured deliveries (contract in `L2-server-phone-ingest.md`,
frozen). Build the phone side: pick a session directory, hash it, register, send
bytes with resume, complete, and show truthful state.

## Base
Branch from `sprint/demo-candidate` into worktree `C:/Users/user/pw/phone-upload`,
branch `feat/phone-upload`. Expo SDK 57; `expo-secure-store` is present; there is
no filesystem or picker module yet (`token-store.ts` says so). Add
`expo-file-system` and `expo-document-picker` (SAF directory permission on Android)
and nothing heavier. Every new native module is a reason the APK must be rebuilt (L4 knows).

## Behaviour
1. Uploads screen: "Upload a recorded session" → SAF `requestDirectoryPermissionsAsync`
   → list files → derive `session_basename` from the directory name → user picks the
   declared collection session it belongs to (APP-16; sessions already exist in the app).
2. Hash every file sha256 WITHOUT loading the whole file in memory (chunked read;
   an incremental sha256 in JS is acceptable for the demo). Mark the ceiling:
   `// ponytail: JS chunked sha256, fine for demo clips; native hashing when sessions reach GB scale`.
3. Register (unmeasured shape). Persist `{upload id, directory URI, inventory, plan}`
   in secure storage so a kill/restart can resume.
4. Transfer: files below 64 MiB → single signed PUT via `FileSystem.uploadAsync`
   (native, streams from disk). Files at/above 64 MiB → ranged parts: chunked read →
   PUT each part URL. Skip anything the plan marks `done` / `held_parts`.
5. On restart / network return: `GET /api/me/uploads/:id` → resend only what the
   server does not hold; refresh expired URLs by re-registering with the same id.
6. Complete → poll state → show `verified / ingesting / ingested / held / failed`
   with the server's reason, verbatim. Never show "uploaded" before the server says `verified`.
7. Delete the stale `confirmUpload` and its comment. Keep the queue/offline pattern
   the app already uses for mutations.

## Rules
Server computes everything: no durations, no amounts, no "estimated minutes" from the phone.
Copy in the three languages (vi/en/zh) through the app's existing i18n; Vietnamese first.
Tokens from `packages/design`; no literal colours in `.tsx`.
Consent/APP-17b flags untouched. No new consent fields.

## Proof
- Unit tests (vitest, no device): the planner/resume state machine against a
  mocked fetch: fresh; resume-after-kill with 2 of 5 parts held; expired URL; tamper → failed.
- `pnpm --filter @playerone/collector test:release` still green.
- Typecheck clean. Engine-free suite green.
- Manual on a handset is L4 / on-site; you cannot do it. Say so; do not claim it.
Report your own numbers.

## Done means
Feature complete against the frozen contract, tests above green, the stale
comment gone, an exact list of new native modules for L4, and a written
"what a real phone would still need to prove" list. Do not push.
