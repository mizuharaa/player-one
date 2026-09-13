# Android demo and Play release

Build from the reviewed release candidate, with a frozen lockfile and the Android
toolchain installed. Do not install dependencies through another worktree's junction.
The native `android` directory is generated; never place the upload keystore there.

On Windows, build in a short physical Git checkout, for example
`C:/build/playerone`, with its own frozen-lockfile install and the repository's
hoisted node linker. The deeply nested demo worktree reproduced Ninja's
`manifest 'build.ninja' still dirty after 100 tries` even with flat dependencies:
Ninja reported an existing ReactAndroid CMake file as missing. The identical
source in a short directory passed that failed native compilation step. Do not
patch generated CMake files or borrow another worktree's dependencies.

The wrapper requires a clean, committed checkout before it starts. Plain source
snapshots are rejected: a supplied revision string cannot prove what was copied.
Review and commit the intended inputs first. If Expo changes tracked files while
generating Android, the wrapper refuses to record a successful release; inspect
those changes and rebuild from a clean commit. It never stages them for you.

Run both test gates from the repository root: `pnpm exec vitest run` (unset
`DATABASE_URL` for the database-free run) and
`pnpm --filter @playerone/collector test:release`. The latter runs the Node release
configuration/provenance tests, which Vitest does not collect. Its direct
equivalent is `node --test apps/collector/scripts/*.test.mjs`. Neither gate is a
native build or handset test.

## Demo

Set `EXPO_PUBLIC_API_URL` to the real demo API origin (no trailing slash) —
for the centre kit that is Caddy's `PLAYERONE_PUBLIC_URL` on the LAN address,
which is port 80 in the LAN template and never `:8080`, because the API itself
binds `127.0.0.1:8080` and no handset can reach it — and
`PLAYERONE_VERSION_CODE` to the next positive integer. Unset mock API flags.
Run `pnpm apk` from this package. The wrapper selects the demo profile, validates
configuration before native generation, and builds the release-variant APK.

This uses a distinct `.demo` package and permits the centre's HTTP LAN. The
generated template signs it with the Android debug key: it is a demo artifact,
not a Play submission. Install on a physical handset with Metro stopped; test
fresh sign-in, session restoration, headset guidance and a full counter-to-bill
journey. Demo OTP disclosure belongs only on an isolated demo backend.

## Play

For an invited pilot, use the **internal testing track**, not a public launch.
Google permits internal testing before app setup is complete; apps exclusively
on this track do not need the Data safety form. Obtain the organization's Play
Console testing-release access and tester emails, then use the bundle build
below. The public-publication checklist at the end is not a blanket gate on
staff-only technical testing. Real participant data still needs an appropriate
approved pilot notice and consent. See [Google's internal testing guidance](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en)
and [Data safety exemption](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

For immediate staff smoke tests, direct installation of the demo APK is also
available after rebuilding for the reachable host. Google's separate
[internal app sharing](https://support.google.com/googleplay/android-developer/answer/9844679?hl=en)
accepts APKs/bundles signed with any key and re-signs them; it still needs
appropriate account/app/tester access and phone setup. Do not confuse that
mechanism with the internal testing track or a public store listing.

Set `EXPO_PUBLIC_API_URL` to the public HTTPS API origin (no trailing slash), and
`PLAYERONE_VERSION_CODE` to a value higher than the last uploaded one.
Provide these only in the build environment, never source control or Expo `extra`:

- `PLAYERONE_UPLOAD_KEYSTORE`: absolute path to the existing upload keystore.
- `PLAYERONE_UPLOAD_STORE_PASSWORD`.
- `PLAYERONE_UPLOAD_KEY_ALIAS`.
- `PLAYERONE_UPLOAD_KEY_PASSWORD`.

Run `pnpm aab` from this package. The wrapper selects the Play profile, verifies
the configured key is a private-key entry and rejects Android Debug certificates
before native generation, then builds the release bundle. JDK `keytool` must be
on PATH. Do not bypass the wrapper with a direct Gradle build for publication.
The bundle is `android/app/build/outputs/bundle/release/app-release.aab`.
The profile enforces HTTPS, disables cleartext, targets API 36 and overrides
template debug signing with the configured upload key. Use this bundle profile
for the internal testing track and public publication; the separate internal
app sharing mechanism described above may use a demo APK. Configuration checks
are not proof of a successful build.

Before uploading, verify the bundle signature/certificate matches the upload key
registered in Play Console (and is not `CN=Android Debug`); inspect final target
SDK, permissions, package/version and native library page-size compatibility.
Run Play internal testing and its device reports. Record Git SHA, lockfile hash,
artifact SHA-256, build profile, API origin, signing certificate fingerprint and
device checks together. Do not record passwords or private key material.

## Build provenance and matching services

After both native commands succeed, the wrapper requires a non-empty output and
writes `<artifact>.manifest.json` next to the APK or AAB. This records its actual
byte count and SHA-256, build time, selected profile, validated API origin,
application id/version, Git revision, clean-source status and lockfile SHA-256.
It refuses changed source or an existing sidecar. Native regeneration clears the
generated output directory; retain delivered artifacts and their sidecars outside
that directory. A failed command creates no new sidecar and is not a new release.

Build the server and console from the same recorded Git revision and lockfile:
install frozen dependencies in each clean checkout, run the repository typecheck,
then build the console with `pnpm --filter @playerone/console build`. The API runs
from the checked-out TypeScript through the centre kit; its deployment unit is
that revision plus the frozen dependencies, not the console bundle. Keep the
revision and lockfile hash with the deployed server and console build. Do not mix
an older generated console directory with a newer server checkout.

The Android sidecar records selected inputs, **not** which API the installed app
actually reaches. For the chosen host, install the resulting artifact on a
handset, stop Metro, and make a sign-in request. Correlate its time and route with
the selected server's request log and record that result separately. Check fresh
sign-in and restored-session behavior. The old emulator origin `10.0.2.2` is not
a reachable API address for an ordinary phone.

Demo and Play use different application ids: the Play installation does not
upgrade the demo package or inherit its saved session. Test its fresh sign-in.

Publication also needs the organization account, approved privacy/consent text,
accurate Data safety declarations, a usable account-deletion request path in-app
and on the web, and reviewer access. Retention exceptions for financial/audit
records need approved wording; deleting an account must not erase financial proof.
Do not invent approved documents or publish a placeholder deletion form.

## iOS

There is no Mac and no Apple Developer account on this machine, so nothing
signed can be built or uploaded here — the two commands below run on EAS's
cloud builders instead, which is the point of having them ready. Prerequisites,
none of which exist yet:

- **Apple Developer Program enrolment** for the organization (not an individual
  account) — this is what everything else below depends on. Apple typically
  clears an organization enrolment in 1–3 days once submitted, longer if
  D-U-N-S number verification is needed for an org Apple does not already
  recognize; start the D-U-N-S check first if the organization does not have
  one, since that step alone can take longer than enrolment.
- An **App Store Connect app record** (bundle id `vn.vng.playerone.collector`,
  matching `app.json`), created after enrolment clears.
- An **EAS account** with access to this project, and `eas login` run once from
  a machine that has it.

Once those exist, `eas build` can create the iOS signing identity and
provisioning profile itself (`eas credentials` if it needs to be done by hand).
The two commands, run from `apps/collector`:

```sh
eas build --platform ios --profile demo
eas submit --platform ios --profile store
```

`demo` builds an internal-distribution `.demo` bundle id build for ad hoc
device installs, matching the Android demo profile. `store` builds and, as a
separate step, submits the signed `vn.vng.playerone.collector` build to
TestFlight; it reads `ascAppId`, `appleId` and `appleTeamId` from the shell
environment (`eas.json`'s `submit.store.ios` interpolates them, it does not
hold them), the same way `EXPO_PUBLIC_API_URL` and `PLAYERONE_VERSION_CODE`
are supplied to `build.demo`/`build.store` rather than hardcoded.

What cannot happen before enrolment: any signed iOS build at all — EAS refuses
to build for a physical device or the App Store without a matching Apple
credential — and therefore no TestFlight upload either. `eas build --profile
development` (a simulator/dev-client build) needs no Apple account and could
run today from a machine with EAS access, but nobody has run it yet; prebuild
itself cannot even generate the `ios/` project on this Windows machine (Expo
skips native iOS project generation outside macOS/Linux), so the earliest this
was checked was `expo prebuild --platform ios` reaching a config-only warning
and no `ios/` directory.
