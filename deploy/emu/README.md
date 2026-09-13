# Run the collector app in the emulator

You have no Android phone. This runbook uses an Android emulator instead. It
looks and works like a real phone, in a window on this PC.

## What you need, already installed

- Docker Desktop, running.
- The Android SDK at `C:\Android\sdk`, with the `playerone34` emulator image.
- A built demo APK. One already exists at
  `C:/build/playerone-emu/apps/collector/android/app/build/outputs/apk/release/app-release.apk`.
- The sample session footage. `up.ps1` reads its folder from the
  `PLAYERONE_SESSIONS` environment variable, already set on this PC.

You do not need to install anything else. `up.ps1` starts and connects
everything below.

## The one command

Open PowerShell in this folder (`deploy/emu`) and run:

```powershell
.\up.ps1
```

It takes about a minute, most of it the emulator booting. You will see, in
order:

1. Postgres and a small file-storage service (MinIO) start.
2. A demo database is created and filled with one ready-to-use collector, the
   first time only.
3. The API server opens in its own window. Leave that window open — it is
   the server. Closing it stops the app from working.
4. The emulator opens in its own window and boots to the Android home screen.
5. The app's demo APK installs on the emulator.
6. The one sample recording is copied onto the emulator's storage.
7. The window prints the phone number to sign in with, and the console
   command.

## Sign in

On the emulator, open the PlayerOne app (it installs itself; tap it on the
home screen or app drawer if it does not open on its own).

On the sign-in screen:

1. Pick country **Vietnam (+84)**.
2. Type the number **900000001**.
3. Tap to send the code.

This is a demo account, so the app fills in the 6-digit code for you and
says so on screen. Tap to verify. You are in.

## Upload the sample recording

`up.ps1` already copied one recording onto the emulator, so there is
something to upload:

1. Go to **Uploads**.
2. Tap **Tải lên** (Upload).
3. Tap **Chọn thư mục phiên** (Choose session folder).
4. In the folder picker: **Documents ▸ PlayerOne ▸ ego_AZER76400FE_20260813_072310**.
5. Tap **USE THIS FOLDER**, then **ALLOW** when Android asks for permission.

The app uploads the recording to the local server. This is the same code
path a real phone uses.

## See the result in the console

The console is the screen an operator or reviewer uses — it is where the
uploaded recording shows up. Open a **second** PowerShell window (do not
close the one running `up.ps1`'s output) and, from the repository root:

```powershell
$env:PLAYERONE_API = "http://127.0.0.1:8080"
pnpm --filter @playerone/console dev
```

Open http://localhost:5173 in a browser. Sign in as **Operator**, with the
credentials `up.ps1` printed at the end of its run:

- Machine identifier / secret: `emu-machine-1` / `emu-machine-secret`
- Reference / secret: `op-1` / `emu-operator-secret`

Once signed in, the uploaded episode shows up on the review queue and on the
home screen's counts.

## Stop everything

```powershell
.\down.ps1
```

This closes the emulator and the API window, and stops the storage service.
It leaves the database alone, so the next `up.ps1` is fast and the console
still has data to show.

## Rebuild the APK when the code changes

Only do this with the emulator **closed** — this laptop is short on RAM, and
Gradle and the emulator together can run it out.

From `apps/collector`, in PowerShell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
$env:ANDROID_HOME = "C:\Android\sdk"
$env:ANDROID_SDK_ROOT = "C:\Android\sdk"
$env:EXPO_PUBLIC_API_URL = "http://10.0.2.2:8080"
$env:GRADLE_OPTS = "-Xmx2g"
Remove-Item Env:\NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue
pnpm apk
```

Three things about this, specific to this laptop:

- `EXPO_PUBLIC_API_URL=http://10.0.2.2:8080` is the emulator's address for
  "this PC". It gets baked into the APK, so it has to be set before the
  build, not after.
- `GRADLE_OPTS=-Xmx2g` caps how much memory Gradle's own JVM will grab. Skip
  it and a Gradle build on this machine can starve everything else running.
- `NoDefaultCurrentDirectoryInExePath` is set for this Windows account, and it
  stops `cmd.exe` from finding `gradlew.bat` by name even from inside the
  `android` folder — the build fails partway through with no obviously
  related error. Unset it for this PowerShell session before building; it is
  safe to leave unset afterwards.

The build takes several minutes and writes the new APK to the same path
`up.ps1` installs from. Run `.\up.ps1` again afterwards to test it.
