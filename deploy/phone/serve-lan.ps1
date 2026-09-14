<#
  The emulator runbook (deploy/emu) serves the API on 127.0.0.1 and its APK is
  built against http://10.0.2.2:8080 -- an address that exists only inside an
  Android emulator. A real phone on the same Wi-Fi needs this laptop's LAN
  address instead. This script is deploy/emu/up.ps1 with the emulator removed
  and every address replaced by that LAN address:

    - the API binds 0.0.0.0, so the phone can reach it
    - STORAGE_ENDPOINT is http://<lan-ip>:9000, so the presigned upload URLs
      the API hands the phone carry the LAN address and not 127.0.0.1
    - Windows Firewall is opened for the TCP ports the phone touches
    - a static server on 8081 hands out the APK, so the phone can download it

  Run `.\serve-lan.ps1` to start and `.\serve-lan.ps1 -Close` to stop and to
  remove the firewall rules. Adding firewall rules needs an elevated
  PowerShell; the script says so and stops if it is not elevated.

  See deploy/phone/README.md for the owner-facing steps.
#>
param(
  [switch]$Close,
  # Leave the firewall alone: the rules are already there, or somebody manages
  # them by hand. Without this the script needs an elevated shell.
  [switch]$SkipFirewall,
  [int]$ApiPort = 8080,
  [int]$DownloadPort = 8081,
  [string]$ApkDir = "C:/build/playerone-emu/apps/collector/android/app/build/outputs/apk/release",
  [string]$ApkName = "app-release.apk"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RunDir = Join-Path $PSScriptRoot ".run"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

# The three ports a phone on the Wi-Fi has to reach: the API, MinIO (the
# presigned PUTs go straight to it), and the server that hands out the APK.
$FirewallPorts = @($ApiPort, 9000, $DownloadPort)
$FirewallPrefix = "PlayerOne phone demo"

function Stop-Saved($File, $Label) {
  $path = Join-Path $RunDir $File
  if (-not (Test-Path $path)) { Write-Host "    no $File, nothing to stop"; return }
  $savedPid = Get-Content $path
  Get-Process -Id $savedPid -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item $path -ErrorAction SilentlyContinue
  Write-Host "    stopped $Label (pid $savedPid)"
}

if ($Close) {
  Write-Host "==> Stopping the API and the APK download server"
  Stop-Saved "api.pid" "the API"
  Stop-Saved "download.pid" "the download server"
  Write-Host "==> Removing the firewall rules"
  foreach ($port in $FirewallPorts) {
    $name = "$FirewallPrefix $port"
    try {
      Remove-NetFirewallRule -DisplayName $name -ErrorAction Stop
      Write-Host "    removed '$name'"
    } catch {
      Write-Host "    '$name' was not present"
    }
  }
  Write-Host "==> Done. MinIO, Postgres and the demo database are left alone."
  Write-Host "    Run deploy/emu/down.ps1 as well if you want MinIO stopped."
  return
}

# --- the LAN address -------------------------------------------------------
# The Wi-Fi adapter's DHCP IPv4. A 169.254.* address means the adapter is up
# but has no network, so it is not a usable answer.
$wifi = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.InterfaceAlias -like "Wi-Fi*" -and
    $_.PrefixOrigin -eq "Dhcp" -and
    $_.IPAddress -notlike "169.254.*"
  } | Select-Object -First 1
if (-not $wifi) {
  throw "No Wi-Fi IPv4 address found. Connect this laptop to the demo Wi-Fi first, then run this again."
}
$LanIp = $wifi.IPAddress
$ApiOrigin = "http://${LanIp}:$ApiPort"
$StorageEndpoint = "http://${LanIp}:9000"
$DownloadUrl = "http://${LanIp}:$DownloadPort/$ApkName"
Write-Host "==> LAN address: $LanIp (adapter '$($wifi.InterfaceAlias)')"

$netProfile = Get-NetConnectionProfile -InterfaceAlias $wifi.InterfaceAlias -ErrorAction SilentlyContinue
if ($netProfile -and $netProfile.NetworkCategory -ne "Private") {
  Write-Host ""
  Write-Host "  !! This Wi-Fi ('$($netProfile.Name)') is a $($netProfile.NetworkCategory) network." -ForegroundColor Yellow
  Write-Host "     The rules below go on the Private profile, so on this network they" -ForegroundColor Yellow
  Write-Host "     will NOT apply and the phone will be refused. Worse, campus and" -ForegroundColor Yellow
  Write-Host "     guest Wi-Fi usually isolates clients from each other, which no" -ForegroundColor Yellow
  Write-Host "     firewall rule can fix. Use a phone hotspot or the demo router," -ForegroundColor Yellow
  Write-Host "     then in an elevated shell:" -ForegroundColor Yellow
  Write-Host "       Set-NetConnectionProfile -InterfaceAlias '$($wifi.InterfaceAlias)' -NetworkCategory Private" -ForegroundColor Yellow
  Write-Host ""
}

# --- firewall --------------------------------------------------------------
$elevated = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host "==> Firewall: inbound TCP $($FirewallPorts -join ', '), Private profile"
if ($SkipFirewall) { Write-Host "    -SkipFirewall, leaving the rules as they are" }
foreach ($port in $FirewallPorts) {
  if ($SkipFirewall) { break }
  $name = "$FirewallPrefix $port"
  if (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) {
    Write-Host "    '$name' already present"
    continue
  }
  if (-not $elevated) {
    throw "Adding a firewall rule needs an elevated PowerShell. Right-click PowerShell, choose 'Run as administrator', and run this script again. (If the rules already exist from an earlier run, nothing needs elevation.)"
  }
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $port -Profile Private | Out-Null
  Write-Host "    added '$name'"
}

# --- everything below is deploy/emu/up.ps1, with the same constants --------
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

$DemoPhone = "+84900000001"
$TokenSecret = "emu-demo-token-secret"
$MediaRoot = "C:\build\emu-runbook\media"

$CentreRegion = "EMU"
$CentreName = "Emulator demo centre"
$MachineId = "emu-machine-1"
$MachineSecret = "emu-machine-secret"
$OperatorRef = "op-1"
$OperatorSecret = "emu-operator-secret"

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
# On the LAN address, not 127.0.0.1: if this answers, the presigned URLs the
# phone is handed are reachable too.
Wait-Http "$StorageEndpoint/minio/health/live" 30 "MinIO on the LAN address"

Write-Host "==> Storage bucket '$StorageBucket' (endpoint $StorageEndpoint)"
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

Write-Host "==> Seeding the demo collector's work and money"
node "$Root/packages/api/scripts/seed-demo-work.mjs"
if ($LASTEXITCODE -ne 0) { throw "seed-demo-work.mjs failed" }

Remove-Item Env:\PLAYERONE_ALLOW_SUPERUSER -ErrorAction SilentlyContinue

Write-Host "==> Starting the API on 0.0.0.0:$ApiPort (new window)"
New-Item -ItemType Directory -Force -Path $MediaRoot | Out-Null
$env:HOST = "0.0.0.0"
$env:PORT = "$ApiPort"
$env:PLAYERONE_MEDIA_ROOT = $MediaRoot
$env:PLAYERONE_TOKEN_SECRET = $TokenSecret
$env:DATABASE_URL = "postgres://${AppRole}:$AppPassword@127.0.0.1:$PgPort/$DbName"
$apiProc = Start-Process -FilePath "node" -ArgumentList @("packages/api/bin/serve.ts") `
  -WorkingDirectory $Root -PassThru
"$($apiProc.Id)" | Out-File -FilePath (Join-Path $RunDir "api.pid") -Encoding ascii
# /whoami, not /healthz: the API has no /healthz route of its own. /healthz
# belongs to the front server (deploy/http-server.mjs) and to Caddy, and both
# answer it by rewriting to /whoami. An unauthenticated /whoami returns 401,
# which is the API answering.
Wait-Http "$ApiOrigin/whoami" 20 "The API on the LAN address"

# --- the APK download server ----------------------------------------------
Write-Host "==> Serving the APK from $ApkDir on port $DownloadPort"
$ApkFile = Join-Path $ApkDir $ApkName
if (-not (Test-Path $ApkFile)) {
  throw "no APK at $ApkFile. Build one first (apps/collector/RELEASE.md), or pass -ApkDir."
}
# Every path returns the APK. A phone browser only ever asks for the one file,
# and this way a mistyped path downloads it instead of returning 404.
$serverJs = @"
const { createServer } = require('node:http');
const { createReadStream, statSync } = require('node:fs');
const file = process.argv[2];
createServer((req, res) => {
  res.writeHead(200, {
    'content-type': 'application/vnd.android.package-archive',
    'content-length': statSync(file).size,
    'content-disposition': 'attachment; filename="$ApkName"',
  });
  createReadStream(file).pipe(res);
}).listen($DownloadPort, '0.0.0.0');
"@
$serverPath = Join-Path $RunDir "serve-apk.cjs"
$serverJs | Out-File -FilePath $serverPath -Encoding ascii
$dlProc = Start-Process -FilePath "node" -ArgumentList @("`"$serverPath`"", "`"$ApkFile`"") -PassThru
"$($dlProc.Id)" | Out-File -FilePath (Join-Path $RunDir "download.pid") -Encoding ascii
Wait-Http $DownloadUrl 15 "The APK download server"

# The download URL, also written to a file so it can be copied or mailed.
$urlFile = Join-Path $RunDir "download-url.txt"
$DownloadUrl | Out-File -FilePath $urlFile -Encoding ascii
# qrcode is not a dependency of this repo. If someone has installed it, draw
# the code; otherwise the URL is the only thing the phone needs.
if (Test-Path (Join-Path $Root "node_modules/qrcode")) {
  Push-Location $Root
  node -e "require('qrcode').toString(process.argv[1],{type:'terminal',small:true},(e,s)=>{if(e){console.log('  (qrcode failed: '+e.message+')')}else{console.log(s)}})" $DownloadUrl
  Pop-Location
} else {
  Write-Host "    (no 'qrcode' in node_modules, so no QR code -- type the URL below)"
}

Write-Host ""
Write-Host "==================================================================="
Write-Host " API origin for the phone:  $ApiOrigin"
Write-Host " Build the APK with:        EXPO_PUBLIC_API_URL=$ApiOrigin"
Write-Host " Presigned uploads go to:   $StorageEndpoint"
Write-Host ""
Write-Host " On the phone, on the same Wi-Fi, open in the browser:"
Write-Host "   $DownloadUrl"
Write-Host " Also written to: $urlFile"
Write-Host ""
Write-Host " Sign in with +84 900000001. For this one seeded number the API sends"
Write-Host " the 6-digit code back in its reply and the app fills it in and says"
Write-Host " so on screen. That is staff-assisted, not real sign-in: a real"
Write-Host " collector gets the code over Zalo, which needs ZNS credentials."
Write-Host ""
Write-Host " Run '.\serve-lan.ps1 -Close' to stop the API and the download"
Write-Host " server and to remove the firewall rules."
Write-Host "==================================================================="
