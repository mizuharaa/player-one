<#
  One command for the owner's iPhone-hotspot demo, run on this laptop after it
  has joined the hotspot.

  `serve-lan.ps1`, next to this file, serves an *installed APK* built against
  one baked-in address. This one serves **Expo Go**: Metro bundles the app on
  the laptop and the phone loads it over the hotspot, so there is no Gradle
  build and no rebuild when the address changes. Otherwise it is the same
  bring-up `deploy/emu/up.ps1` does, with three differences that already cost
  time:

    - it WAITS for Postgres (`pg_isready`). up.ps1 only `docker start`s it, and
      a container still recovering answers "rejecting connections" for the
      better part of a minute -- measured 7 x 10 s after a crash reboot on
      2026-09-15, and the migrate then fails on a database that is about to be
      fine.
    - it seeds `seed-stakeholder.mjs` on a `po_demo*` database rather than
      `seed-demo.mjs` on `po_emu_demo`: the demo needs the reviewer and the
      declared payout destination, and that script refuses any other name.
    - it refuses a network the phone cannot use instead of printing an address
      that will be ignored. See Get-HotspotIp.

  `.\hotspot-go.ps1 -Down` stops the API, Metro and MinIO and leaves Postgres
  running. See deploy/phone/README.md.
#>
param(
  [switch]$Down,
  # Leave the firewall alone: the rules are already there from an earlier run,
  # or somebody manages them by hand. Without this the first run needs an
  # elevated PowerShell.
  [switch]$NoFirewall,
  # Override the detection below with this laptop's address on the network the
  # phone is really on. ponytail: the calibration knob -- the shape test cannot
  # know every hotspot, and a wrong refusal must not stop the demo.
  [string]$Ip,
  [int]$ApiPort = 8080,
  [int]$MetroPort = 8081,
  # Must start po_demo or playerone_demo, or seed-stakeholder.mjs refuses it.
  [string]$DbName = "po_demo_hotspot",
  # The unit that will actually record. A mismatch against the recording's
  # basename is the SERIAL-CONFLICT defect of 2026-09-14.
  [string]$DeviceSerial = "AZER76400HV"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RunDir = Join-Path $PSScriptRoot ".run"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

# Local dev-only constants, same as deploy/emu/up.ps1 except the database, the
# media root and the token secret -- see docs/RUNNING.md and CLAUDE.md.
$PgContainer = "playerone-pg"
$PgPort = 5433
$PgSuperPassword = "playerone"
$AppRole = "playerone_app"
$AppPassword = "emupass"
$MinioContainer = "playerone-minio"
$MinioUser = "playerone"
$MinioPassword = "playerone123"
$StorageBucket = "playerone"
$DemoPhone = "+84900000001"
$TokenSecret = "hotspot-demo-token-secret"
$MediaRoot = "C:\build\hotspot-demo\media"
$MachineId = "demo-machine-1"
$OperatorRef = "op-1"
# seed-demo.mjs owns this id; its presence is how a seeded database is known.
$CollectorId = "00000000-0000-4000-8000-00000000d001"
# The API, MinIO (the presigned PUTs go straight to it) and Metro.
$FirewallPorts = @($ApiPort, 9000, $MetroPort)
$FirewallPrefix = "PlayerOne hotspot demo"

function Stop-Saved($File, $Label) {
  $path = Join-Path $RunDir $File
  if (-not (Test-Path $path)) { Write-Host "    no $File, nothing to stop"; return }
  $savedPid = (Get-Content $path).Trim()
  # Checked first, because `taskkill` on a pid that is already gone writes to
  # stderr, and a native command's stderr under $ErrorActionPreference='Stop'
  # is a terminating NativeCommandError -- it would abort the whole script.
  if (Get-Process -Id $savedPid -ErrorAction SilentlyContinue) {
    # /T, the whole tree: `npx expo start` is node under a PowerShell window,
    # and killing only the window leaves Metro holding the port.
    taskkill /T /F /PID $savedPid | Out-Null
    Write-Host "    stopped $Label (pid $savedPid)"
  } else {
    Write-Host "    $Label (pid $savedPid) was already gone"
  }
  Remove-Item $path -ErrorAction SilentlyContinue
}

function Wait-Http($Url, $TimeoutSec, $Label) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
      return
    } catch {
      # A caught HTTP status (401 from /whoami, say) still means the server
      # answered, and that counts as up.
      if ($_.Exception.Response) { return }
    }
    Start-Sleep -Seconds 1
  }
  throw "$Label did not answer at $Url within ${TimeoutSec}s"
}

<#
  The address the phone will use, or a refusal naming what was found instead.

  A hotspot hands out a small subnet: iOS Personal Hotspot is 172.20.10.0/28,
  an Android hotspot a /24. A campus or office DHCP scope is far larger -- this
  laptop gets 172.31.147.135/16 on the campus Wi-Fi -- and such a network
  usually isolates its clients from each other, which no firewall rule on this
  laptop can fix. So the prefix length is the test, and it is a shape test, not
  a vendor list. 169.254.* is an adapter that is up with no network at all.
#>
function Get-HotspotIp {
  $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -like "Wi-Fi*" }
  $usable = $all | Where-Object {
    $_.PrefixOrigin -eq "Dhcp" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixLength -ge 24
  } | Select-Object -First 1
  if ($usable) { return $usable }
  $found = ($all | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength) on '$($_.InterfaceAlias)'" }) -join "; "
  if (-not $found) { $found = "no Wi-Fi IPv4 address at all" }
  # Write-Host and exit, not throw: a refusal the owner has to read must not
  # come wrapped in a PowerShell stack trace.
  Write-Host @"
No hotspot address on this laptop. Found: $found.
A hotspot gives out a /24 or smaller subnet (iPhone: 172.20.10.x/28). A
169.254.* address is an adapter with no network, and a /16 is a campus or
office scope -- those isolate clients from each other, so the phone could not
reach this laptop even with the firewall open.
Join the iPhone's Personal Hotspot on this laptop and run this again, or pass
-Ip <this laptop's address on the phone's network> if you know the phone can
reach it.
"@ -ForegroundColor Yellow
  exit 1
}

if ($Down) {
  Write-Host "==> Stopping the API and Metro"
  Stop-Saved "api.pid" "the API"
  Stop-Saved "metro.pid" "Metro"
  Write-Host "==> Stopping MinIO"
  $running = docker ps --filter "name=^/$MinioContainer`$" --format "{{.Names}}"
  if ($running) { docker stop $MinioContainer | Out-Null; Write-Host "    stopped $MinioContainer" }
  else { Write-Host "    $MinioContainer was not running" }
  Write-Host "==> Done. Postgres ($PgContainer) and the demo database are left running."
  Write-Host "    The firewall rules are left in place, so the next run needs no elevation."
  Write-Host "    Remove them with: .\serve-lan.ps1 -Close  (same ports), or by hand."
  return
}

# --- the address -----------------------------------------------------------
if ($Ip) {
  $LanIp = $Ip
  Write-Host "==> Address: $LanIp (-Ip, detection skipped)"
} else {
  $found = Get-HotspotIp
  $LanIp = $found.IPAddress
  Write-Host "==> Hotspot address: $LanIp/$($found.PrefixLength) (adapter '$($found.InterfaceAlias)')"
}
$ApiOrigin = "http://${LanIp}:$ApiPort"
$StorageEndpoint = "http://${LanIp}:9000"
$MetroUrl = "exp://${LanIp}:$MetroPort"

# --- firewall --------------------------------------------------------------
Write-Host "==> Firewall: inbound TCP $($FirewallPorts -join ', '), Private profile"
Write-Host "    If the phone cannot reach this laptop, these are the exact lines:"
$elevated = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
foreach ($port in $FirewallPorts) {
  $name = "$FirewallPrefix $port"
  Write-Host "      netsh advfirewall firewall add rule name=`"$name`" dir=in action=allow protocol=TCP localport=$port profile=private"
  if ($NoFirewall) { continue }
  if (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) {
    Write-Host "    '$name' already present"
    continue
  }
  if (-not $elevated) {
    throw "Adding a firewall rule needs an elevated PowerShell. Right-click PowerShell, 'Run as administrator', and run this again -- or run the netsh lines above once, then use -NoFirewall."
  }
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $port -Profile Private | Out-Null
  Write-Host "    added '$name'"
}
if ($NoFirewall) { Write-Host "    -NoFirewall, leaving the rules as they are" }
$netProfile = Get-NetConnectionProfile -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -like "Wi-Fi*" } | Select-Object -First 1
if ($netProfile -and $netProfile.NetworkCategory -ne "Private") {
  Write-Host "  !! '$($netProfile.Name)' is a $($netProfile.NetworkCategory) network, and the rules above are on the Private profile, so they do NOT apply. In an elevated shell:" -ForegroundColor Yellow
  Write-Host "     Set-NetConnectionProfile -InterfaceAlias '$($netProfile.InterfaceAlias)' -NetworkCategory Private" -ForegroundColor Yellow
}

# --- Postgres, and wait for it --------------------------------------------
Write-Host "==> Postgres ($PgContainer)"
docker start $PgContainer | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "container '$PgContainer' was not found. It should already exist on this laptop -- see docs/RUNNING.md."
}
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
  # try/catch, because a not-yet-ready pg_isready writes to stderr and a native
  # command's stderr is a terminating error here. The exit code still lands.
  try { docker exec $PgContainer pg_isready -U postgres 2>&1 | Out-Null } catch { }
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "$PgContainer did not accept connections within 120s (pg_isready)" }
Write-Host "    accepting connections"

# --- MinIO ----------------------------------------------------------------
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
# On the hotspot address, not 127.0.0.1: if this answers, the presigned URLs
# the phone is handed are reachable too.
Wait-Http "$StorageEndpoint/minio/health/live" 60 "MinIO on the hotspot address"

Write-Host "==> Storage bucket '$StorageBucket' (endpoint $StorageEndpoint)"
$env:STORAGE_ENDPOINT = $StorageEndpoint
$env:STORAGE_BUCKET = $StorageBucket
$env:STORAGE_KEY = $MinioUser
$env:STORAGE_SECRET = $MinioPassword
node "$Root/deploy/emu/ensure-bucket.mjs"
if ($LASTEXITCODE -ne 0) { throw "bucket setup failed" }

# --- database, migrate, seed ----------------------------------------------
Write-Host "==> Database '$DbName'"
$dbCheck = docker exec $PgContainer psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
if (-not ($dbCheck -and $dbCheck.Trim() -eq "1")) {
  docker exec $PgContainer psql -U postgres -c "CREATE DATABASE $DbName" | Out-Null
  Write-Host "    created"
} else {
  Write-Host "    already there"
}
# drizzle never re-runs an applied tag, so migrating every time is idempotent
# and cheaper than deciding whether it is needed.
Write-Host "==> Migrating (as postgres, the owner role)"
$env:DATABASE_URL = "postgres://postgres:$PgSuperPassword@127.0.0.1:$PgPort/$DbName"
$env:PLAYERONE_ALLOW_SUPERUSER = "1"
Push-Location $Root
pnpm db:migrate
$migrateExit = $LASTEXITCODE
Pop-Location
if ($migrateExit -ne 0) { throw "pnpm db:migrate failed" }
# 0021 creates playerone_app NOLOGIN, on purpose: a password is a deployment's
# business, not a migration's. This is that deployment. Idempotent.
docker exec $PgContainer psql -U postgres -c "ALTER ROLE $AppRole LOGIN PASSWORD '$AppPassword'" | Out-Null
Remove-Item Env:\PLAYERONE_ALLOW_SUPERUSER -ErrorAction SilentlyContinue

# The application role from here on, which is also what seed-stakeholder wants:
# `open()` refuses a superuser URL (migration 0021).
$env:DATABASE_URL = "postgres://${AppRole}:$AppPassword@127.0.0.1:$PgPort/$DbName"
$env:PLAYERONE_DEMO_PHONE = $DemoPhone
$env:PLAYERONE_DEMO_DEVICE_SERIAL = $DeviceSerial
$seeded = docker exec $PgContainer psql -U postgres -d $DbName -tAc "SELECT count(*) FROM collectors WHERE id='$CollectorId'"
if ($seeded -and $seeded.Trim() -eq "1") {
  Write-Host "==> Seed: the demo collector is already there, skipping seed-stakeholder"
  Write-Host "    (a re-seed with different PLAYERONE_DEMO_*_SECRET values is refused, not overwritten)"
} else {
  Write-Host "==> Seeding ($DemoPhone, device $DeviceSerial)"
  Write-Host "    Secrets come from PLAYERONE_DEMO_MACHINE_SECRET, _ADMIN_SECRET,"
  Write-Host "    _FINANCE_SECRET and _REVIEWER_SECRET. Any that are unset are generated"
  Write-Host "    and printed once below -- SAVE THEM, a rerun needs the same values."
  node "$Root/packages/api/scripts/seed-stakeholder.mjs"
  if ($LASTEXITCODE -ne 0) { throw "seed-stakeholder.mjs failed" }
}

# --- the API --------------------------------------------------------------
# A second run must not leave the first API and Metro orphaned on the same
# ports. Measured: without this the new API loses the bind, the health wait
# passes anyway because the OLD one answers, and the pid file then names a
# process that is already gone.
Write-Host "==> Stopping anything an earlier run left behind"
Stop-Saved "api.pid" "the previous API"
Stop-Saved "metro.pid" "the previous Metro"

Write-Host "==> API on 0.0.0.0:$ApiPort (new window)"
New-Item -ItemType Directory -Force -Path $MediaRoot | Out-Null
$env:HOST = "0.0.0.0"
$env:PORT = "$ApiPort"
$env:PLAYERONE_MEDIA_ROOT = $MediaRoot
$env:PLAYERONE_TOKEN_SECRET = $TokenSecret
# The console's debug-delivery page, so a folder can be pushed from the laptop
# if the phone will not. deploy/centre/check.mjs refuses it in production.
$env:PLAYERONE_DEBUG_DELIVERY = "1"
# Cleared rather than set: with no ZNS credentials the API writes each sign-in
# code to its own log (`dev_log`), and PLAYERONE_DEMO_PHONE also returns that
# one number's code in the request-code reply. Unset PLAYERONE_ZALOPAY_ENV and
# PLAYERONE_PAYOUT_MODE default to sandbox + manual, which is the pilot rail.
# A stale value in this shell must not flip either of them.
foreach ($name in @(
  "PLAYERONE_ZNS_ACCESS_TOKEN", "PLAYERONE_ZNS_TEMPLATE_ID", "PLAYERONE_ZNS_ENV",
  "PLAYERONE_ZALOPAY_ENV", "PLAYERONE_PAYOUT_MODE"
)) { Remove-Item "Env:\$name" -ErrorAction SilentlyContinue }
$apiProc = Start-Process -FilePath "node" -ArgumentList @("packages/api/bin/serve.ts") `
  -WorkingDirectory $Root -PassThru
"$($apiProc.Id)" | Out-File -FilePath (Join-Path $RunDir "api.pid") -Encoding ascii
# /whoami, not /healthz: serve.ts has no /healthz -- that route belongs to the
# front server and to Caddy. An unauthenticated /whoami answers 401, and a 401
# is the API answering.
Wait-Http "$ApiOrigin/whoami" 30 "The API on the hotspot address"
# The wait above proves SOMETHING answers on that port. This proves it is the
# process this script started -- an API that lost the bind to a stray older one
# exits at once, and the wait would pass on the wrong server's answer.
if ($apiProc.HasExited) {
  throw "the API exited immediately. Port $ApiPort is most likely already held by a process this script did not start: netstat -ano | findstr :$ApiPort"
}

# --- Metro, for Expo Go ---------------------------------------------------
Write-Host "==> Metro on $MetroPort (new window)"
$collector = Join-Path $Root "apps\collector"
# REACT_NATIVE_PACKAGER_HOSTNAME: this laptop has eight IPv4 addresses (WSL,
# VirtualBox, Tailscale, three idle Wi-Fi adapters), and `--host lan` otherwise
# picks whichever it finds first and prints a URL the phone cannot open.
$metroCommand = "`$env:EXPO_PUBLIC_API_URL='$ApiOrigin'; `$env:EXPO_NO_TYPESCRIPT_SETUP='1'; " +
  "`$env:REACT_NATIVE_PACKAGER_HOSTNAME='$LanIp'; Set-Location '$collector'; " +
  "npx expo start --host lan --port $MetroPort"
$metroProc = Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-Command", $metroCommand) -PassThru
"$($metroProc.Id)" | Out-File -FilePath (Join-Path $RunDir "metro.pid") -Encoding ascii
Wait-Http "http://${LanIp}:$MetroPort/status" 120 "Metro"
if ($metroProc.HasExited) {
  throw "the Metro window closed. Port $MetroPort is most likely already held by a process this script did not start: netstat -ano | findstr :$MetroPort"
}

Write-Host @"

===================================================================
 API origin:        $ApiOrigin
 Presigned uploads: $StorageEndpoint
 Metro / Expo Go:   $MetroUrl
   The QR code is in the Metro window. It encodes the URL above.

 On the phone:
   1. Install Expo Go from the App Store, and join the same hotspot.
   2. Scan the QR code in the Metro window with the Camera app.
   3. Only if the app shows a different server: Profile > the 'Server' row
      under About > type ${LanIp}:$ApiPort > Save. Metro bakes
      EXPO_PUBLIC_API_URL=$ApiOrigin into this bundle, so it should
      already match and this step should not be needed.
   4. Sign in: country Vietnam (+84), number 900000001. The API returns that
      one seeded number's 6-digit code in its reply and the app fills it in.
      Staff-assisted, not real sign-in: a real collector gets the code over
      Zalo, which needs ZNS credentials nobody has yet.
   5. Uploads > Tai len > Chon thu muc phien > pick a session folder.

 The console, on this laptop:
   `$env:PLAYERONE_API = 'http://127.0.0.1:$ApiPort'
   pnpm --filter @playerone/console dev -- --host
   http://${LanIp}:5173   (or http://localhost:5173 here)
   Sign in as Operator: machine '$MachineId', reference '$OperatorRef'. Their
   secrets are the values of PLAYERONE_DEMO_MACHINE_SECRET and
   PLAYERONE_DEMO_ADMIN_SECRET -- this script never prints a secret.

 Stop with: .\hotspot-go.ps1 -Down   (leaves Postgres running)
===================================================================
"@
