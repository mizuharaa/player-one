# Device dependencies — what a real build needs that this repo does not carry

The BLE provisioning flow in this app runs against `MockDeviceTransport`
(`src/device/transport.ts`). The real implementation is a Kotlin TurboModule
wrapping PaXini's EgoLowBle Android library. That library is vendor material,
gitignored under `docs/sdks/`, and is **not** vendored into this app — this
file is what makes a build with the real module reproducible anyway.

## The artifact

| | |
|---|---|
| Library | EgoLowBle Android (BLE provisioning for the Ego camera) |
| Version | 1.1.5 |
| AAR | `EgoLowBle-1.1.5.aar`, 967,811 bytes |
| AAR sha256 | `269fea1d1fd6865a81316aee5a2082ed8067ce4ab9321e2d2690c883d8076d5a` |
| Ships inside | `EgoLowBle-android-1.1.5.zip` (974,514 bytes), sha256 `e45557c4e40118dc438cedc1ca2e0a7c3cc69d40493a79cf3e9285fdc3f53ef8` |
| Which ships inside | `开发工具包.zip` (523,991,352 bytes), sha256 `1b97412f235f71aa5cd07e612b2411f92337e99dc93bc9cb6f4e5e3fc6839a12`, at `docs/sdks/开发工具包.zip` in the main worktree (gitignored) |
| Zip path to the AAR | `开发工具包/SDK工具包/SDK&OrbbecViewer/android/EgoLowBle-android-1.1.5.zip` → `EgoLowBle-android-1.1.5/aar/EgoLowBle-1.1.5.aar` |
| Source | Supplied by PaXini in the development kit hand-off. No public download, no Maven coordinates, no license file in the kit — clarify license terms with PaXini before shipping it inside an APK. |

Verify before building:

```sh
sha256sum EgoLowBle-1.1.5.aar
# 269fea1d1fd6865a81316aee5a2082ed8067ce4ab9321e2d2690c883d8076d5a
```

## What the library exposes

There is **no Kotlin API in the AAR itself** — it carries `libEgoLowBle.so`
(native), and the kit's `examples/android-jni/` shows the intended wrapper:
`EgoLowBleJni.cpp` + `EgoLowBleNative.kt` (package `com.ego.egolowble`), built
with the headers under `include/EgoLowBle/egolowble.h`. The surface, which
`DeviceTransport` mirrors 1:1:

- `nativeScanDevices(handle, timeoutMs)` → `EgoLowBleScanDevice[]` (name, address, rssi, connectable)
- `nativeConnectByName` / `nativeConnectByAddress`
- `nativeConfigureWifi(handle, ssid, password, timeoutMs)` → result + reason
- `nativeRequestIp(handle, timeoutMs)` → result (`SUCCESS | NOT_CONFIGURED | CONFIGURING | CONFIGURE_FAILED`), ip, reason
- `nativeDisconnect`, `nativeGetMtu`, raw characteristic read/write, `nativeGetLastError`

There is deliberately no recording control in `DeviceTransport` and there must
never be one: **the app never starts or stops recording** (engineering brief,
hard rule). The library's raw characteristic write could physically reach
anything the firmware exposes — the TurboModule must expose only the four
provisioning calls above, not the raw write.

## What blocks the real module today

1. **ARM test device.** The `.so` is ARM; nothing here runs or is testable on
   this x64 dev machine, and no Android SDK is installed in CI or locally.
2. **JNI build.** The example wrapper needs the NDK (`build_android_jni.sh`,
   CMake). It compiles against the kit's headers plus the AAR's `.so`.
3. **Path A offload protocol.** Provisioning yields a device IP; how episodes
   are then pulled over that IP is an open PaXini question. `DeviceTransfer`
   (`src/device/transfer.ts`) is the seam; only the mock exists, on purpose —
   do not invent the protocol.

Until all three resolve, `MockDeviceTransport` / `MockDeviceTransfer` are the
only implementations, and the app builds and tests device-free.

## When prebuild happens

No `android/` directory exists yet, so nothing here declares a minSdk. When
`expo prebuild` (PRODUCT.md's stated path) generates it, **minSdkVersion is
28** — Android 9+ per PRODUCT.md — and the EgoLowBle TurboModule slots in
behind `DeviceTransport` with the JNI pieces above.

## Native modules this app links, and what each is for

Every entry here is a reason the APK has to be rebuilt; there is nothing in this
list that a JavaScript-only change can add or remove.

| Module | Version | Why |
|---|---|---|
| `expo` | 57.0.20 | the runtime |
| `expo-build-properties` | 57.0.17 | config plugin only, no runtime surface |
| `expo-secure-store` | 57.0.3 | the collector token (NFR-03/04) and the Path A resume record |
| `expo-file-system` | 57.0.7 | Path A: the Storage Access Framework directory picker, chunked reads for hashing and for ranged parts, and the native whole-file PUT |
| `react-native` | 0.86.3 | the runtime |

**`expo-file-system` is the only module added for the phone-upload lane**, and
it is added at `57.0.7`. `expo-document-picker` was installed first and then
removed: everything the lane needs is `Directory.pickDirectoryAsync`, which is
`expo-file-system`'s own SAF document-tree picker, and a second autolinked
native module for a picker nothing calls is a larger APK and a larger
permissions surface for no behaviour.

Nothing here is `expo-crypto`. The session digests are computed in JavaScript
(`src/upload/sha256.ts`) precisely so that a third native module is not needed;
that is a measured ceiling, not an oversight, and it is marked where it bites.

## The one patched dependency

`expo-file-system@57.0.7` is patched in this repo — `pnpm`'s
`patchedDependencies`, the diff in `patches/expo-file-system@57.0.7.patch`, and
the patch hash recorded in `pnpm-lock.yaml`. A build from a checkout that skips
`pnpm install` does not get it. **What:** the handle now keeps the
`ParcelFileDescriptor` that `forContentURI` opened, in a field, and closes it in
`close()` after the channel. **Why:** upstream opens the descriptor, takes
`FileInputStream(pfd.fileDescriptor).channel` from it and then keeps no
reference to the descriptor, so the first garbage collection runs
`ParcelFileDescriptor`'s CloseGuard finalizer and closes the file descriptor
while the channel is still reading. Measured on an API 34 emulator: every
Storage-Access-Framework file over 1 MiB failed in `hashSession`
(`src/upload/delivery-native.ts`) with `UnableToReadHandleException` about a
second in, with "A resource failed to call close" from the finalizer daemon in
logcat. `putRange` opens its source the same way and had the same fault, which
is why the fix is in the module and not in either caller.
**ponytail: remove this patch when upstream fixes it** — 57.0.7 is the newest
57.x on npm today, so there is nothing to bump to; re-read the package's
`CHANGELOG.md` at the next expo upgrade and delete the patch file, the
`patchedDependencies` entry and this section together once it is fixed there.

The patch on its own does nothing, and that is the part to remember. Expo 57
ships each of its modules as a **prebuilt AAR inside the npm package** —
`node_modules/expo-file-system/local-maven-repo/host/exp/exponent/expo.modules.filesystem/57.0.7/`
— and `expo-module.config.json` declares that publication, so autolinking adds a
Maven dependency and never includes the module's Gradle project. The Kotlin
under `node_modules/expo-file-system/android/src` is then not compiled at all, so
a patched source file changes nothing in the APK. Measured, not assumed: the
first build of the patch looked clean, and `dexdump` on
`classes2.dex` showed `FileSystemFileHandle` with two instance fields,
`fileChannel` and `mode`, and a `(FileChannel, FileMode)` constructor — the
unpatched class. The build log says which is which: a module printed with a 📦
came from its AAR, a module printed without one was built from source.

`expo.autolinking.android.buildFromSource` in `apps/collector/package.json`
names `expo-file-system` and is what forces the Gradle project in. Both halves
are needed, and neither is any use alone.

## iOS

`src/upload/delivery-native.ts` calls `Directory.pickDirectoryAsync()` and then
`directory.list()` to enumerate a picked session flat. Checked against the
installed `expo-file-system@57.0.7` (not against a general assumption):
**`pickDirectoryAsync` is not Android-only in this version.**
`ios/FileSystemModule.swift` implements it with a real
`UIDocumentPickerViewController` in directory mode
(`ios/FilePickingHandler.swift`), and the package's own `CHANGELOG.md` records
`[iOS] Add pickDirectoryAsync support` and `[iOS] Add pickFileAsync support`.
So `pickSessionDirectory()` is expected to run unmodified on iOS — pick a
folder from Files (on-device, iCloud Drive, or a third-party provider), list
it flat, hash and upload exactly as today. That is unverified because there is
no Mac or iOS device on this machine, not because the API is missing.

The real gap is resume-after-kill, not picking. Android's SAF grant
(`takePersistableUriPermission`) is designed to survive the app being killed
and relaunched, which is why the resume record in `delivery.ts` is written to
`expo-secure-store` in the first place — it exists to survive a kill. iOS's
picker instead hands back a security-scoped URL, and this package's iOS side
(`ios/FileSystemScopedAccess.swift`, `ios/FileSystemPath.swift`) calls
`url.startAccessingSecurityScopedResource()` directly on that URL for each
operation — it never creates or resolves a persisted security-scoped
bookmark (`URL.bookmarkData` / `URL(resolvingBookmarkData:)`), and there is no
JS API in this package to do so either. Apple's documented pattern for
surviving a relaunch is exactly that bookmark; without it, re-accessing a
picked directory after the app process has been fully terminated and
restarted is not guaranteed to keep working. What iOS needs, if this is
confirmed on a device: either (a) accept the narrower guarantee — an
in-progress delivery resumes across a background/foreground cycle but not
across a full kill, and the uploads screen re-prompts the picker instead of
trusting a stale `directoryUri` — or (b) a bookmark-persisting picker, which
means a change inside `expo-file-system`'s native module, not this app. Do
not build either until a device confirms which case it is; today this is
unverified, not broken.
