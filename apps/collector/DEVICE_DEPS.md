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
