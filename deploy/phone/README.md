# Run the collector app on a real Android phone

This is the emulator runbook (`deploy/emu/README.md`) done with a real phone
instead. No public server, no domain, no cloud: the phone talks to this laptop
over the Wi-Fi you are both on.

One thing has to be right or nothing works. The demo APK has the API address
**baked in at build time**. The emulator APK was built against
`http://10.0.2.2:8080`, which is the emulator's private name for "the PC it
runs on". A real phone has never heard of that address. So the phone needs an
APK built against this laptop's Wi-Fi address, for example
`http://172.31.147.135:8080`. `serve-lan.ps1` prints the exact address to use.

**On an iPhone there is no APK.** Use Expo Go instead, which has no baked-in
address and no build step at all — see "Expo Go on an iPhone over a hotspot" at
the end of this file, and `hotspot-go.ps1` rather than `serve-lan.ps1`.

## What you need

- Docker Desktop, running.
- The phone and this laptop on the **same Wi-Fi**, and that Wi-Fi must let two
  devices on it talk to each other. Campus, café and guest networks usually do
  not — they isolate clients, and no setting on this laptop changes that. A
  phone hotspot that the laptop joins is the reliable option.
- An APK built against this laptop's Wi-Fi address. See "Rebuild the APK"
  below if `serve-lan.ps1` prints an address that does not match the APK.

## 1. Start the server

Open PowerShell **as administrator** (right-click PowerShell, "Run as
administrator") in this folder, `deploy/phone`, and run:

```powershell
.\serve-lan.ps1
```

Administrator is needed only to add the firewall rules, and only the first
time — after that a normal window works.

It starts the same things `deploy/emu/up.ps1` does, at the Wi-Fi address
instead of `127.0.0.1`: the file storage (MinIO), the demo database with one
ready-made collector, the API, and a small server on port 8081 whose only job
is to hand the APK to the phone.

At the end it prints:

- the **API origin** the APK must be built against, e.g. `http://172.31.147.135:8080`
- the **download URL** for the APK, e.g. `http://172.31.147.135:8081/app-release.apk`
  (also saved to `deploy/phone/.run/download-url.txt`)

Leave the API window open. It is the server.

If the script prints a yellow warning that the Wi-Fi is a **Public** network,
stop and read it. The firewall rules go on the Private profile, so on a Public
network they do not apply and the phone gets refused.

## 2. Install the app on the phone

1. Connect the phone to the same Wi-Fi as this laptop.
2. In the phone's browser, type the download URL the script printed. There is
   no QR code — `qrcode` is not installed in this repository, and the script
   says so rather than pretending.
3. Chrome will warn about the file type. Tap **Download anyway**.
4. Open the downloaded file. Android will refuse the first time and offer a
   settings screen — allow **Install unknown apps** for Chrome (or your file
   manager), then go back and install.
5. Play Protect may warn that the app was not scanned. Tap **Install anyway**.
   The demo APK is signed with the Android debug key on purpose; it is a demo
   artifact, not a Play release.

## 3. Sign in

On the sign-in screen:

1. Pick country **Vietnam (+84)**.
2. Type the number **900000001**.
3. Tap to send the code.

**This is staff-assisted, not real sign-in.** For this one seeded demo number
the server sends the six-digit code straight back in its reply, and the app
puts it in the box for you and says on screen that it did. A real collector
gets the code over Zalo, and that needs ZNS credentials which do not exist yet.
Nothing about this step proves that a real collector can sign in.

Tap to verify. You are in. Home shows the current cycle, tasks and income for
the seeded collector.

## 4. Put a recording on the phone

The phone needs a session folder to upload. There is no camera in the room, so
copy one over USB from this laptop:

1. Plug the phone into the laptop with a USB cable.
2. On the phone, pull down the notification shade, tap the USB notification and
   choose **File transfer** / **MTP**.
3. On the laptop, open the phone in File Explorer: **Internal shared storage ▸
   Documents**. Create a folder named **PlayerOne** if it is not there.
4. Copy one whole `ego_*` session folder into it — from the sample corpus on
   this laptop, the folder the environment variable `PLAYERONE_SESSIONS` points
   at, for example `ego_AZER76400FE_20260813_072310`. Copy the **entire
   folder**, with every file inside it.
5. Unplug the phone.

The result must be `Documents/PlayerOne/ego_AZER76400FE_20260813_072310/...` on
the phone.

## 5. Upload it

1. In the app, go to **Uploads**.
2. Tap **Tải lên** (Upload).
3. Tap **Chọn thư mục phiên** (Choose session folder).
4. In the folder picker: **Documents ▸ PlayerOne ▸ ego_AZER76400FE_20260813_072310**.
5. Tap **USE THIS FOLDER**, then **ALLOW** when Android asks for permission.

The app uploads to this laptop over the Wi-Fi. The media itself goes straight
to the storage service on port 9000, using addresses the API signs and hands to
the phone — which is why the script sets the storage address to the Wi-Fi
address too, and why port 9000 is in the firewall rules.

## 6. See the result on the laptop

Open a **second** PowerShell window (do not close the API window) and, from the
repository root:

```powershell
$env:PLAYERONE_API = "http://127.0.0.1:8080"
pnpm --filter @playerone/console dev
```

Open http://localhost:5173 and sign in as **Operator** with the credentials
`serve-lan.ps1` printed:

- Machine identifier / secret: `emu-machine-1` / `emu-machine-secret`
- Reference / secret: `op-1` / `emu-operator-secret`

## 7. Stop everything

```powershell
.\serve-lan.ps1 -Close
```

This stops the API and the download server and removes the firewall rules. It
leaves MinIO, Postgres and the demo database alone, so the next run is fast.
Run `deploy/emu/down.ps1` as well if you want MinIO stopped too.

## What to send back

Four things, and the first three are the proof:

1. A **screenshot of Home** on the phone after sign-in — showing the cycle
   card, tasks and income filled in, not zeros.
2. A **screenshot of the upload result** in Uploads — the session listed, with
   whatever state it ended in.
3. The **API window's log lines** for that run. Select the text in the window,
   copy it, and paste it into the reply. These are what tie the screenshots to
   a real request from a real phone; the screenshots alone could have come from
   the emulator.
4. Anything that went wrong, with the exact words on screen. A refusal is a
   result.

## Rebuild the APK for a different Wi-Fi address

The Wi-Fi address changes when you move to another network, and the APK has the
old one baked in. Rebuild with the emulator **closed** — this laptop is short
on RAM and Gradle plus the emulator can run it out. In the clean build checkout
(`C:/build/playerone-emu`), in `apps/collector`, in Git Bash:

```sh
EXPO_PUBLIC_API_URL=http://<the-address-serve-lan-printed>:8080 \
PLAYERONE_VERSION_CODE=<one higher than last time> \
GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.workers.max=2 -Dorg.gradle.parallel=false" \
env -u NoDefaultCurrentDirectoryInExePath pnpm apk
```

`NoDefaultCurrentDirectoryInExePath` is set for this Windows account and stops
`cmd.exe` from finding `gradlew.bat` by name; unsetting it for the build is
what `env -u` does. The new APK lands where `serve-lan.ps1` serves from, so
step 1 picks it up with no change.

## Expo Go on an iPhone over a hotspot

Everything above assumes an APK, which means Android and a Gradle build for
every new address. An iPhone cannot install one. **Expo Go** is the way round
it: Metro bundles the app on this laptop and the phone loads it over the
hotspot, so the API address is a Metro environment variable and not something
baked into a binary. No build, and no rebuild when the address changes.

Join the iPhone's **Personal Hotspot** on this laptop first. Then, in this
folder (`deploy/phone`), in PowerShell — **as administrator the first time**,
for the firewall rules:

```powershell
.\hotspot-go.ps1
```

It refuses a network the phone cannot use rather than printing an address that
will be ignored: a hotspot hands out a /24 or smaller subnet, while a
`169.254.*` address is an adapter with no network and a /16 is a campus or
office scope whose clients are isolated from each other. If it refuses a
network you know works, pass `-Ip <this laptop's address on it>`.

Then it starts Postgres (**and waits** for it, which `deploy/emu/up.ps1` does
not), MinIO, the demo database `po_demo_hotspot`, the seed, the API on
`0.0.0.0:8080` and Metro on 8081 in its own window. It ends by printing the API
origin, the Expo URL and the five steps below.

1. **Install Expo Go** from the App Store, and keep the phone on the hotspot.
2. **Scan the QR code** in the Metro window with the Camera app. It encodes
   `exp://<hotspot-ip>:8081`, and the app opens in Expo Go.
3. **Only if the app shows a different server**: Profile ▸ About ▸ the
   **Server** row ▸ type `<hotspot-ip>:8080` ▸ Save; the app signs you out
   and returns to Landing. Metro bakes `EXPO_PUBLIC_API_URL` into the bundle,
   so the default should already be right; the row exists because one
   TestFlight build has to reach a laptop today and the cloud later.
4. **Sign in**: country **Vietnam (+84)**, number **900000001**. For this one
   seeded number the API returns the six-digit code in its reply and the app
   fills it in. Staff-assisted, not real sign-in: a real collector gets the
   code over Zalo, which needs ZNS credentials that do not exist yet.
5. **Upload**: Uploads ▸ **Tải lên** ▸ **Chọn thư mục phiên** ▸ pick a session
   folder on the phone (put one there over USB — step 4 of the runbook above).

To watch it land, on this laptop:

```powershell
$env:PLAYERONE_API = "http://127.0.0.1:8080"
pnpm --filter @playerone/console dev -- --host
```

Then `http://<hotspot-ip>:5173`, or `http://localhost:5173` on the laptop
itself. Sign in as **Operator** with machine `demo-machine-1` and reference
`op-1`. Their secrets are the values of `PLAYERONE_DEMO_MACHINE_SECRET` and
`PLAYERONE_DEMO_ADMIN_SECRET`; `hotspot-go.ps1` never prints a secret, but
`seed-stakeholder.mjs` does print any it had to generate, **once** — save them
from that run, because a rerun presenting different values is refused rather
than overwriting a sign-in.

Stop with:

```powershell
.\hotspot-go.ps1 -Down
```

That stops the API, Metro and MinIO and leaves Postgres and the demo database
running, so the next run skips the seed. The firewall rules are left in place,
so the next run needs no elevation.
