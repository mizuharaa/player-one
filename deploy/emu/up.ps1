<#
  Brings up one visible Android emulator with the PlayerOne collector app
  installed, talking to a local API + Postgres + MinIO. See
  deploy/emu/README.md for what this is for and how to use it.

  Re-run safely: every step here is idempotent (existing containers are
  reused, an existing database is left alone, an already-pushed session is
  not re-pushed).
#>
param(
  [string]$ApkPath = "C:/build/playerone-emu/apps/collector/android/app/build/outputs/apk/release/app-release.apk",
  [string]$SessionName = "ego_AZER76400FE_20260813_072310",
  [string]$AvdName = "playerone34",
  [int]$ApiPort = 8080,
  # The directory *containing* ego_* session folders. Defaults to the same
  # variable the test suite and docs/RUNNING.md use.
  [string]$CorpusRoot = $env:PLAYERONE_SESSIONS
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RunDir = Join-Path $PSScriptRoot ".run"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

# Local dev-only constants. Same laptop, same values every time — see
# docs/RUNNING.md and CLAUDE.md's "Environment" section.
$PgContainer = "playerone-pg"
$PgPort = 5433
$PgSuperPassword = "playerone"
$DbName = "po_emu_demo"
$AppRole = "playerone_app"
$AppPassword = "emupass"

$MinioContainer = "playerone-minio"
$MinioUser = "playerone"
$MinioPassword = "playerone123"
$StorageBucket = "playerone"
$StorageEndpoint = "http://127.0.0.1:9000"

$DemoPhone = "+84900000001"
$TokenSecret = "emu-demo-token-secret"
$MediaRoot = "C:\build\emu-runbook\media"

$CentreRegion = "EMU"
$CentreName = "Emulator demo centre"
$MachineId = "emu-machine-1"
$MachineSecret = "emu-machine-secret"
$OperatorRef = "op-1"
$OperatorSecret = "emu-operator-secret"

$Sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "C:\Android\sdk" }
$Adb = Join-Path $Sdk "platform-tools\adb.exe"
$EmulatorExe = Join-Path $Sdk "emulator\emulator.exe"

function Wait-Http($Url, $TimeoutSec, $Label) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      return
    } catch {
      # A caught HTTP error status (e.g. 401 from /whoami) still means the
      # server answered — that counts as up.
      if ($_.Exception.Response) { return }
    }
    Start-Sleep -Seconds 1
  }
  throw "$Label did not answer at $Url within ${TimeoutSec}s"
}

Write-Host "==> Postgres ($PgContainer)"
docker start $PgContainer | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "container '$PgContainer' was not found. It should already exist on this laptop -- see docs/RUNNING.md."
}

Write-Host "==> MinIO ($MinioContainer)"
$existing = docker ps -a --filter "name=^/$MinioContainer`$" --format "{{.Names}}"
if (-not $existing) {
  docker run -d --name $MinioContainer -p 9000:9000 -p 9001:9001 `
    -e MINIO_ROOT_USER=$MinioUser -e MINIO_ROOT_PASSWORD=$MinioPassword `
    quay.io/minio/minio:latest server /data --console-address ":9001" | Out-Null
} else {
  $running = docker ps --filter "name=^/$MinioContainer`$" --format "{{.Names}}"
  if (-not $running) { docker start $MinioContainer | Out-Null }
}
Wait-Http "$StorageEndpoint/minio/health/live" 30 "MinIO"

Write-Host "==> Storage bucket '$StorageBucket'"
$env:STORAGE_ENDPOINT = $StorageEndpoint
$env:STORAGE_BUCKET = $StorageBucket
$env:STORAGE_KEY = $MinioUser
$env:STORAGE_SECRET = $MinioPassword
node "$Root/deploy/emu/ensure-bucket.mjs"
if ($LASTEXITCODE -ne 0) { throw "bucket setup failed" }

Write-Host "==> Database '$DbName'"
$dbCheck = docker exec $PgContainer psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
$env:DATABASE_URL = "postgres://postgres:$PgSuperPassword@127.0.0.1:$PgPort/$DbName"
$env:PLAYERONE_ALLOW_SUPERUSER = "1"
if (-not ($dbCheck -and $dbCheck.Trim() -eq "1")) {
  Write-Host "    creating and migrating (first run) ..."
  docker exec $PgContainer psql -U postgres -c "CREATE DATABASE $DbName" | Out-Null
  Push-Location $Root
  pnpm db:migrate
  $migrateExit = $LASTEXITCODE
  Pop-Location
  if ($migrateExit -ne 0) { throw "pnpm db:migrate failed" }
} else {
  Write-Host "    already exists, skipping create+migrate"
}

Write-Host "==> Seeding the demo collector ($DemoPhone)"
$env:PLAYERONE_DEMO_PHONE = $DemoPhone
node "$Root/packages/api/scripts/seed-demo.mjs"
if ($LASTEXITCODE -ne 0) { throw "seed-demo.mjs failed" }

Write-Host "==> Bootstrapping the console operator ($OperatorRef)"
node "$Root/packages/api/bin/bootstrap.ts" `
  --centre-region $CentreRegion --centre-name $CentreName `
  --machine $MachineId --machine-secret $MachineSecret `
  --operator "$($OperatorRef):administrator:$OperatorSecret"
if ($LASTEXITCODE -ne 0) { throw "bootstrap.ts failed" }
Remove-Item Env:\PLAYERONE_ALLOW_SUPERUSER -ErrorAction SilentlyContinue

Write-Host "==> Starting the API on port $ApiPort (new window)"
New-Item -ItemType Directory -Force -Path $MediaRoot | Out-Null
$env:HOST = "0.0.0.0"
$env:PORT = "$ApiPort"
$env:PLAYERONE_MEDIA_ROOT = $MediaRoot
$env:PLAYERONE_TOKEN_SECRET = $TokenSecret
$env:DATABASE_URL = "postgres://${AppRole}:$AppPassword@127.0.0.1:$PgPort/$DbName"
$apiProc = Start-Process -FilePath "node" -ArgumentList @("packages/api/bin/serve.ts") `
  -WorkingDirectory $Root -PassThru
"$($apiProc.Id)" | Out-File -FilePath (Join-Path $RunDir "api.pid") -Encoding ascii
Wait-Http "http://127.0.0.1:$ApiPort/whoami" 20 "The API"

Write-Host "==> Booting the emulator ($AvdName, visible window)"
$emuProc = Start-Process -FilePath $EmulatorExe `
  -ArgumentList @("-avd", $AvdName, "-gpu", "swiftshader_indirect") -PassThru
"$($emuProc.Id)" | Out-File -FilePath (Join-Path $RunDir "emulator.pid") -Encoding ascii

& $Adb wait-for-device
$deadline = (Get-Date).AddSeconds(150)
$booted = $false
while ((Get-Date) -lt $deadline) {
  $prop = (& $Adb shell getprop sys.boot_completed 2>$null)
  if ($prop -and $prop.Trim() -eq "1") { $booted = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $booted) { throw "emulator did not report sys.boot_completed within 150s" }
Write-Host "    booted"

Write-Host "==> adb reverse tcp:9000 (so the phone's STORAGE_ENDPOINT reaches host MinIO)"
& $Adb reverse tcp:9000 tcp:9000 | Out-Null

Write-Host "==> Installing the APK"
& $Adb install -r "$ApkPath"
if ($LASTEXITCODE -ne 0) { throw "adb install failed" }

Write-Host "==> Pushing the corpus session '$SessionName'"
if (-not $CorpusRoot) {
  throw "CorpusRoot is empty. Set `$env:PLAYERONE_SESSIONS or pass -CorpusRoot."
}
$sessionSource = Join-Path $CorpusRoot $SessionName
if (-not (Test-Path $sessionSource)) {
  throw "session '$SessionName' not found under '$CorpusRoot'"
}
$remoteParent = "/sdcard/Documents/PlayerOne"
$remoteDir = "$remoteParent/$SessionName"
& $Adb shell mkdir -p $remoteParent
$check = (& $Adb shell "[ -d $remoteDir ] && echo yes || echo no")
if ($check -and $check.Trim() -eq "yes") {
  Write-Host "    already on the device, skipping push"
} else {
  & $Adb push "$sessionSource" "$remoteDir"
  if ($LASTEXITCODE -ne 0) { throw "adb push failed" }
}

Write-Host ""
Write-Host "==================================================================="
Write-Host " Ready. On the emulator:"
Write-Host "   Sign in with +84 900000001 (country Vietnam, number 900000001)."
Write-Host "   The 6-digit code is filled in on screen automatically -- demo mode."
Write-Host "   Uploads -> Tai len -> Chon thu muc phien -> Documents > PlayerOne >"
Write-Host "   $SessionName -> USE THIS FOLDER -> ALLOW."
Write-Host ""
Write-Host " To watch it land in the console:"
Write-Host "   `$env:PLAYERONE_API = 'http://127.0.0.1:$ApiPort'"
Write-Host "   pnpm --filter @playerone/console dev"
Write-Host "   Sign in at http://localhost:5173 as an operator:"
Write-Host "     identifier: $MachineId   secret: $MachineSecret"
Write-Host "     reference:  $OperatorRef   secret: $OperatorSecret"
Write-Host ""
Write-Host " Run deploy/emu/down.ps1 to stop the emulator, the API and MinIO."
Write-Host "==================================================================="
