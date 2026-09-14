<#
.SYNOPSIS
  On-site PlayerOne hardware check: TF card inventory + checksum-copy proof
  via WSL, plus the Ego camera SDK probe. Run as Administrator (usbipd
  bind/attach needs it).

.DESCRIPTION
  1. Prints usbipd's version and `usbipd list`.
  2. Binds and attaches the TF reader's bus id to WSL.
  3. Runs card-check.sh in WSL: lsblk -f, session inventory, 4 GiB check,
     a checksum-verified copy of one session (see card-check.sh and
     ../DEMO-SCRIPT.md).
  4. Detaches the reader.
  5. Runs probe.py (60 second timeout) and captures its output.
  6. Writes every step's PASS/FAIL/SKIPPED, plus captured output, to
     hardware-report-<timestamp>.txt next to this script, and prints its path.

  This script never writes to the TF card itself: the WSL mount is always
  read-only (ro,noload); only host-side destinations are written to.

.PARAMETER BusId
  usbipd bus id of the TF card reader, e.g. "2-3". If omitted, `usbipd list`
  is printed and you are prompted for it.

.PARAMETER ProbePath
  Path to probe.py. Default: packages\hardware-checkout\probe.py in this
  checkout.

.PARAMETER Session
  Session directory name to copy off the card. Default: card-check.sh picks
  the newest ego_* directory.

.PARAMETER Dest
  Copy destination inside WSL. Default: /mnt/c/PlayerOne/media.

.PARAMETER DryRun
  Print every command this script would run. Executes no usbipd, mount or
  probe.py call.

.EXAMPLE
  .\hardware-check.ps1
.EXAMPLE
  .\hardware-check.ps1 -BusId 2-3
.EXAMPLE
  .\hardware-check.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$BusId,
  [string]$ProbePath,
  [string]$Session,
  [string]$Dest = "/mnt/c/PlayerOne/media",
  [switch]$DryRun
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..\..\..')).Path
if (-not $ProbePath) {
  $ProbePath = Join-Path $RepoRoot 'packages\hardware-checkout\probe.py'
}

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ReportPath = Join-Path $ScriptDir "hardware-report-$Timestamp.txt"
$Report = New-Object System.Collections.Generic.List[string]

function Log {
  param([string]$Text)
  Write-Host $Text
  $Report.Add($Text)
}

function Step {
  param([string]$Label, [string]$Status, [string]$Detail = '')
  $line = "[$Status] $Label"
  if ($Detail) { $line += " -- $Detail" }
  Log $line
}

# Runs an external exe, captures stdout/stderr, and enforces a timeout by
# killing the process -- used only for probe.py, which is the one step with
# a specified 60 s budget.
function Invoke-WithTimeout {
  param([string]$FilePath, [string]$Arguments, [int]$TimeoutSec)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.Start() | Out-Null
  if ($proc.WaitForExit($TimeoutSec * 1000)) {
    [pscustomobject]@{
      TimedOut = $false
      ExitCode = $proc.ExitCode
      Stdout   = $proc.StandardOutput.ReadToEnd()
      Stderr   = $proc.StandardError.ReadToEnd()
    }
  } else {
    try { $proc.Kill() } catch {}
    [pscustomobject]@{ TimedOut = $true; ExitCode = -1; Stdout = ''; Stderr = '' }
  }
}

Log "PlayerOne hardware check -- $Timestamp"
Log "DryRun: $($DryRun.IsPresent)"
Log "ProbePath: $ProbePath"
Log ""

# 1. usbipd version + list
try {
  $usbipdVersion = & usbipd --version 2>&1
  Log "usbipd version: $usbipdVersion"
  Step "usbipd present" PASS
} catch {
  Step "usbipd present" FAIL $_.Exception.Message
}

$usbipdList = ""
try {
  $usbipdList = (& usbipd list 2>&1) -join "`n"
  Log "usbipd list:`n$usbipdList"
  Step "usbipd list" PASS
} catch {
  Step "usbipd list" FAIL $_.Exception.Message
}

# 2. resolve bus id
if (-not $BusId) {
  Write-Host "`nusbipd list:`n$usbipdList`n"
  $BusId = Read-Host "Enter the TF reader's BUSID from the list above"
}
if ($BusId) {
  Step "bus id supplied" PASS $BusId
} else {
  Step "bus id supplied" FAIL "none given"
}

# translate this script's own path into a WSL path, for the card-check.sh call
$shScript = Join-Path $ScriptDir 'card-check.sh'
$driveLetter = $shScript.Substring(0,1).ToLower()
$wslShScript = "/mnt/$driveLetter" + ($shScript.Substring(2) -replace '\\','/')

if ($DryRun) {
  Log ""
  Log "-- dry run: commands that would run, nothing executed --"
  Log "usbipd bind --busid $BusId"
  Log "usbipd attach --wsl --busid $BusId"
  Log "wsl lsblk -dn -o NAME   # before/after, to find the new device"
  $sessionArg = if ($Session) { " --session `"$Session`"" } else { "" }
  Log "wsl bash `"$wslShScript`" --device /dev/sdX$sessionArg --dest `"$Dest`""
  Log "usbipd detach --busid $BusId"
  Log "python `"$ProbePath`"   # 60s timeout"
  Step "dry run" PASS "no usbipd, mount or probe executed"
  $Report | Set-Content -Path $ReportPath -Encoding utf8
  Write-Host "`nReport: $ReportPath"
  return
}

# 3. bind + attach, tracking which WSL block device appears
$newDisk = $null
if ($BusId) {
  & usbipd bind --busid $BusId 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -eq 0) { Step "usbipd bind $BusId" PASS } else { Step "usbipd bind $BusId" FAIL "exit $LASTEXITCODE (may already be bound)" }

  $before = @(& wsl -e lsblk -dn -o NAME 2>$null)

  & usbipd attach --wsl --busid $BusId 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -eq 0) {
    Step "usbipd attach --wsl $BusId" PASS
    Start-Sleep -Seconds 3
  } else {
    Step "usbipd attach --wsl $BusId" FAIL "exit $LASTEXITCODE"
  }

  $after = @(& wsl -e lsblk -dn -o NAME 2>$null)
  $newDisk = $after | Where-Object { $before -notcontains $_ } | Select-Object -First 1
  if ($newDisk) {
    Step "new WSL block device detected" PASS "/dev/$newDisk"
  } else {
    Step "new WSL block device detected" FAIL "no new device seen after attach (before: $($before -join ','); after: $($after -join ','))"
  }
} else {
  Step "usbipd bind/attach" SKIPPED "no bus id"
}

# 4. run the WSL half
if ($newDisk) {
  $sessionArg = if ($Session) { " --session `"$Session`"" } else { "" }
  $cmd = "bash `"$wslShScript`" --device /dev/$newDisk$sessionArg --dest `"$Dest`""
  $cardOut = (& wsl bash -c $cmd 2>&1) -join "`n"
  Log "card-check.sh output:`n$cardOut"
  if ($LASTEXITCODE -eq 0) { Step "card-check.sh" PASS } else { Step "card-check.sh" FAIL "exit $LASTEXITCODE" }
} else {
  Step "card-check.sh" SKIPPED "no card block device to check"
}

# 5. detach
if ($BusId) {
  & usbipd detach --busid $BusId 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -eq 0) { Step "usbipd detach $BusId" PASS } else { Step "usbipd detach $BusId" FAIL "exit $LASTEXITCODE" }
} else {
  Step "usbipd detach" SKIPPED "no bus id"
}

# 6. probe.py, 60 second timeout
if (Test-Path $ProbePath) {
  $result = Invoke-WithTimeout -FilePath "python" -Arguments "`"$ProbePath`"" -TimeoutSec 60
  if ($result.TimedOut) {
    Step "probe.py" FAIL "timed out after 60s"
  } else {
    Log "probe.py stdout:`n$($result.Stdout)"
    if ($result.Stderr) { Log "probe.py stderr:`n$($result.Stderr)" }
    if ($result.ExitCode -eq 0) {
      Step "probe.py" PASS "device found"
    } elseif ($result.ExitCode -eq 3) {
      Step "probe.py" FAIL "SDK loaded, no device found (exit 3)"
    } else {
      Step "probe.py" FAIL "exit $($result.ExitCode)"
    }
  }
} else {
  Step "probe.py" SKIPPED "not found at $ProbePath"
}

$Report | Set-Content -Path $ReportPath -Encoding utf8
Write-Host "`nReport written: $ReportPath"
