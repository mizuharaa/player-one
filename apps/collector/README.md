# Player One — collector app

The Android app collectors use: register, accept the six agreements, train,
pass the exam, claim a task, bind and provision an Ego camera, declare a
session, confirm an upload, watch the income line. React Native 0.82,
TypeScript strict, Vietnamese first (LOC-01 is P0; English rides along at P2).

## What this is, exactly

**A UI scaffold with two mocked seams. It does not launch on a phone yet.**

Read that literally before quoting progress from it:

| | State |
|---|---|
| Screens | All thirteen exist and are reachable; the route registry is `Record<RouteName, ComponentType>`, so a missing screen is a compile error. |
| Server | `MockCollectorApi` — in memory, one process. There is no HTTP client and no auth. |
| Device | `MockDeviceTransport` / `MockDeviceTransfer` — no BLE, no Wi-Fi, no file transfer. See `DEVICE_DEPS.md`. |
| Persistence | **None.** Killing the app resets registration, claims, the upload queue and income. The offline/restart-survival requirement is not met. |
| Native project | **None.** No `android/`, no Metro or Babel config, no Expo dependency. `expo prebuild` has never been run here. |
| Launchable | **No.** `npm start` / `expo run:android` do not exist as scripts because they would not work. |

What *is* runnable today is the typechecker and the unit tests. Those cover the
mock's gates (APP-02, APP-05, APP-10, APP-15, APP-25), the BLE call order, the
message catalogue, and the agreement-id contract with the server.

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
test/          the mock's gates, the device seams, the catalogue, the contract
```

## Known ceilings

Every one of these is marked `ponytail:` at the place it bites:

- No persistence, no restart recovery, no background upload worker (`src/App.tsx`).
- Hand-rolled navigation stack; `@react-navigation` needs `react-native-screens`,
  a native module (`src/nav.tsx`).
- Top inset from `StatusBar.currentHeight` only — no cutout, gesture-bar or
  landscape insets until `react-native-safe-area-context` can be built
  (`src/ui.tsx`). Edge-to-edge on a current Android target is unverified.
- QR device binding is a fixed serial; VisionCamera needs a native build
  (`src/screens/Devices.tsx`).
- Training and exam content is a shell. PaXini owes it.
- One-column phone layout only. No tablet or foldable adaptation — none is
  specified, and the pilot is phones.
