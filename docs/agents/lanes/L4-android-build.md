# L4 — Android demo APK / AAB from the candidate   (model: Sonnet)

## Mission
Follow `apps/collector/RELEASE.md` exactly on this machine (JDK 17 at JAVA_HOME,
SDK at C:\Android\sdk). Build the demo-profile APK from a clean committed checkout
in a SHORT path (`C:/build/playerone`). The deep worktree reproduces a Ninja
"build.ninja still dirty" fault; do not patch CMake files.

## Two builds
1. Early: from `sprint/demo-candidate` as soon as L1 reports. Proves the pipeline.
2. Final: after `feat/phone-upload` is merged into the candidate (new native modules).

## Inputs
`EXPO_PUBLIC_API_URL` = the demo origin the orchestrator gives you (no trailing slash).
`PLAYERONE_VERSION_CODE` = next positive integer (read the last from provenance).
Unset mock API flags. `pnpm apk` from the collector package.
AAB: only if an upload keystore is provided; otherwise report `blocked: no upload keystore`.

## Proof
Record: candidate SHA, artifact path, SHA-256, size, package id (`.demo`), versionCode,
targetSdk (expect 36), permissions list, signing cert fingerprint, the provenance
file the wrapper writes. `pnpm exec vitest run` (no DATABASE_URL) and
`test:release` before building. No handset is attached: say "not installed", never "installed".
Report your own numbers. Do not push.
