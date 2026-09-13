<#
  Stops what up.ps1 started: the emulator, the API window and MinIO.
  Leaves the database running and in place -- it is cheap to leave and
  the next up.ps1 reuses it. Postgres itself (playerone-pg) is shared by
  other worktrees on this laptop and is never stopped here.
#>
param(
  [string]$AvdName = "playerone34"
)

$RunDir = Join-Path $PSScriptRoot ".run"
$Sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "C:\Android\sdk" }
$Adb = Join-Path $Sdk "platform-tools\adb.exe"

Write-Host "==> Stopping the emulator"
$devices = & $Adb devices
$serial = $null
foreach ($line in $devices) {
  if ($line -match "^(emulator-\d+)\s+device$") { $serial = $matches[1] }
}
if ($serial) {
  & $Adb -s $serial emu kill | Out-Null
  Write-Host "    sent emu kill to $serial"
} else {
  Write-Host "    no running emulator device found"
}
Start-Sleep -Seconds 2
Get-Process -Name "qemu-system-x86_64" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$emuPidFile = Join-Path $RunDir "emulator.pid"
if (Test-Path $emuPidFile) {
  Get-Process -Id (Get-Content $emuPidFile) -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item $emuPidFile -ErrorAction SilentlyContinue
}

Write-Host "==> Stopping the API"
$apiPidFile = Join-Path $RunDir "api.pid"
if (Test-Path $apiPidFile) {
  $apiPid = Get-Content $apiPidFile
  Get-Process -Id $apiPid -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Remove-Item $apiPidFile -ErrorAction SilentlyContinue
  Write-Host "    stopped pid $apiPid"
} else {
  Write-Host "    no api.pid found, nothing to stop"
}

Write-Host "==> Stopping MinIO"
docker stop playerone-minio | Out-Null

Write-Host "==> Done. Postgres (playerone-pg) and the po_emu_demo database are left running."
