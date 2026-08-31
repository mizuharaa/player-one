# Player One — collector app

The Android app collectors use: register, accept the six agreements, train,
pass the exam, claim a task, bind and provision an Ego camera, declare a
session, confirm an upload, watch the income line. React Native 0.82,
TypeScript strict, Vietnamese first (LOC-01 is P0; English rides along at P2).

## What this is, exactly

**A real client against the platform, one mocked seam left, and it does not
launch on a phone yet.**

Read that literally before quoting progress from it:

| | State |
|---|---|
| Screens | All thirteen exist and are reachable; the route registry is `Record<RouteName, ComponentType>`, so a missing screen is a compile error. Sign-in is a fourteenth screen and deliberately not a route — it is what the app is when there is no session. |
| Server | `HttpCollectorApi` over `fetch`, against the fourteen `/api/me/*` routes plus `/api/me/income` and `/api/me/episodes`. `MockCollectorApi` is still selectable with `PLAYERONE_MOCK_API=1` and is what the screen tests run on. |
| Auth | **Real.** `POST /auth/collector/request-code` → a one-time code over Zalo → `POST /auth/collector/verify` → a thirty-day token, presented as `Authorization: Bearer`. |
| Device | `MockDeviceTransport` / `MockDeviceTransfer` — no BLE, no Wi-Fi, no file transfer. See `DEVICE_DEPS.md`. |
| Persistence | **The token, and only the token** — `expo-secure-store`, one key. A cold start restores it and refetches claims, devices, sessions, episodes and income from the server. Nothing else is stored: the server is the record, and there is no offline mutation queue because Path A upload is out of the pilot. |
| Native project | **None.** No `android/`, no Metro or Babel config. `expo-secure-store` is a dependency (it pulls `expo` as a peer) but `expo prebuild` has never been run here, so the keystore is unexercised on real hardware. |
| Launchable | **No.** `npm start` / `expo run:android` do not exist as scripts because they would not work. |

What *is* runnable today is the typechecker and the unit tests. Those cover the
mock's gates (APP-02, APP-05, APP-10, APP-15, APP-25), the BLE call order, the
message catalogue, the agreement-id contract with the server, and the HTTP
client against a fake `fetch` — the sign-in exchange, the cold-start restore,
and what a 401, a 403 and a lost connection each do to the stored token.

Two environment variables decide what a build talks to, and there are no others:
`PLAYERONE_API_URL` (default `http://10.0.2.2:8080`, the Android emulator's
route to the host) and `PLAYERONE_MOCK_API=1`.

```sh
pnpm install
pnpm typecheck
pnpm test          # from the repository root
```

## The Android floor

**minSdkVersion 28 — Android 9+.** PRODUCT.md fixes it; nothing in this
directory can enforce it yet because there is no `android/` to put it in.
When `expo prebuild` generates one, 28 is the number, and the generated
`build.gradle` is the first place it becomes real rather than stated.

## Rules this app must not break

Three of them are hard, and each is pinned by a test rather than a convention:

1. **The app never starts or stops recording.** There is no such method on
   `DeviceTransport`, and `test/device.test.ts` scans both device seams for the
   verbs. Recording is the camera's own affair.
2. **No code path deletes device media.** Rule 6's non-deviable half — no TF
   card is cleared, ever. Same test, same scan.
3. **The client never sends a duration or an amount, and never computes one.**
   Effective minutes and money arrive from the server as strings, already
   rounded by the single rounding site in the platform. No input type here
   carries either.

A fourth is structural: **uploads start only from an explicit tap.**
`confirmUpload` is the only transition out of `pending_upload` — no effect, no
timer, no network-state listener (APP-25, PRV-03: the collector decides what
leaves their phone).

## Layout

```
src/api/       CollectorApi (the typed seam) + the mock that fills it today
src/device/    DeviceTransport (BLE provisioning) + DeviceTransfer (Path A)
src/screens/   one file per screen
src/ui.tsx     Screen, ListScreen, Card, CardLink, Choice, Button, Field, Tag, Note
src/nav.tsx    the typed stack, and Android's hardware Back
src/theme.tsx  the only door design tokens come through
src/i18n.ts    every user-facing string, Vietnamese-based
test/          the API seam (both implementations), the device seams, the catalogue
```

## Known ceilings

Every one of these is marked `ponytail:` at the place it bites:

- No background upload worker, and no offline queue (`src/App.tsx`). The token
  survives a kill; nothing else is stored, on purpose — a phone's copy of claims
  and money goes stale the moment the app closes, and Path A upload is out of
  the pilot so there is nothing a collector can do offline that needs replaying.
- `confirmUpload` has no server route and throws `upload_not_supported`
  (`src/api/http.ts`). It is unreachable in practice: the button only renders
  for `pending_upload`, and the server cannot return that state because it only
  knows episodes already ingested at an upload centre.
- A task's `scenario`, `instructions`, `privacyNotice` and `paymentRule` have no
  server source — APP-09 is not built and `collector-app.ts` says why. The three
  text fields come back empty and render `detail.notSupplied`; `scenario` is
  guessed from `tasks.type` with `home` as the fallback, which
  `SessionCreate.tsx` then declares. What a task's scenario *is* remains an open
  product question (`src/api/http.ts`).
- Hand-rolled navigation stack; `@react-navigation` needs `react-native-screens`,
  a native module (`src/nav.tsx`).
- Top inset from `StatusBar.currentHeight` only — no cutout, gesture-bar or
  landscape insets until `react-native-safe-area-context` can be built
  (`src/ui.tsx`). Edge-to-edge on a current Android target is unverified.
- QR device binding is a fixed serial; VisionCamera needs a native build
  (`src/screens/Devices.tsx`).
- Training and exam content is a shell. PaXini owes it.
- No logout and no account switching. A session ends when the token expires,
  when an operator bumps `collectors.token_epoch`, or when the server answers
  401. Nobody has asked for a sign-out button and there is no screen for one.
- Agreements show a title and a version, not a document. There is no body,
  effective date, or server-supplied current version, so the revision path
  cannot be exercised — consent here is a mechanism, not yet informed consent
  (`src/screens/Agreements.tsx`).
- Verdict status pills fail WCAG AA for normal text on the light theme —
  measured 3.06:1 (pass), 3.81:1 (partial), 3.43:1 (reject), and 3.80/4.28:1
  for partial and reject on dark. The values are `verdict.*.fg` in
  `packages/design`, shared with the back-office console, so the fix belongs
  in the token set for all three surfaces rather than forked here. The primary
  button was the same failure (white on `sun[500]`, 2.61:1) and *was* fixable
  in this app without forking, so it was: it now measures 7.19:1.
- One-column phone layout only. No tablet or foldable adaptation — none is
  specified, and the pilot is phones.
- Safe area is the top inset only. Bottom, side, cutout and IME insets, and
  predictive back, need `react-native-safe-area-context` and platform
  navigation — both native modules (`src/ui.tsx`, `src/nav.tsx`).
- The six agreement identifiers are pinned by a literal on each side of a
  repository boundary. A rename in this app fails a test here; a rename in the
  platform's `collector_agreements_name_check` cannot be seen from this repo at
  all. A published contract artifact or a cross-repo CI check is owed. Nothing
  can be written against the constraint today in any case — `collector_agreements`
  exists only in an unpushed working branch of the platform repo.
- No test renders a screen or drives navigation, so labels, focus and error
  announcements are asserted by reading the code, not the accessibility tree.
  That needs a React Native test renderer this project does not have.
