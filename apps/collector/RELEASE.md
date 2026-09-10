# Android demo and Play release

Build from the reviewed release candidate, with a frozen lockfile and the Android
toolchain installed. Do not install dependencies through another worktree's junction.
The native `android` directory is generated; never place the upload keystore there.

On Windows, build in a short physical checkout or source snapshot, for example
`C:/build/playerone`, with its own frozen-lockfile install and the repository's
hoisted node linker. The deeply nested demo worktree reproduced Ninja's
`manifest 'build.ninja' still dirty after 100 tries` even with flat dependencies:
Ninja reported an existing ReactAndroid CMake file as missing. The identical
source in a short directory passed that failed native compilation step. Do not
patch generated CMake files or borrow another worktree's dependencies.

## Demo

Set `EXPO_PUBLIC_API_URL` to the real demo API origin (no trailing slash), and
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

Publication also needs the organization account, approved privacy/consent text,
accurate Data safety declarations, a usable account-deletion request path in-app
and on the web, and reviewer access. Retention exceptions for financial/audit
records need approved wording; deleting an account must not erase financial proof.
Do not invent approved documents or publish a placeholder deletion form.
