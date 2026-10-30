<#
.SYNOPSIS
  WIN-01 prerequisite check for running Chainseabase natively on Windows.

.DESCRIPTION
  Reports Windows version, administrator rights, Node.js, npm, Git and PostgreSQL (client,
  Windows service and listening addresses), and whether the PostgreSQL port is reachable
  only on loopback. Prints PASS / WARN / FAIL per item and never prints secrets.
  Exit code: 0 when nothing failed, 1 when at least one item failed.

.PARAMETER RequireAdmin
  Treat a non-elevated session as a failure (needed later for service installation, WIN-03).

.PARAMETER PostgreSqlPort
  PostgreSQL port to inspect (default 5432).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\Test-ChainseabasePrerequisites.ps1
  echo "exit=$LASTEXITCODE"
#>
[CmdletBinding()]
param(
  [switch]$RequireAdmin,
  [int]$PostgreSqlPort = 5432
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Item, [string]$Status, [string]$Detail) {
  $results.Add([pscustomobject]@{ Item = $Item; Status = $Status; Detail = $Detail })
}

# Windows PowerShell 5.1 turns native stderr into terminating errors under 'Stop': relax it locally,
# and read $LASTEXITCODE before any pipeline step
function Invoke-Native([string]$Path, [string[]]$Arguments) {
  $ErrorActionPreference = 'Continue'
  $out = @(& $Path @Arguments 2>$null)
  return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out }
}

function Get-CommandVersion([string]$Name, [string[]]$Arguments) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  $r = Invoke-Native $cmd.Source $Arguments
  if ($r.ExitCode -ne 0 -or $r.Output.Count -eq 0) { return $null }
  return [string]$r.Output[0]
}

function Get-SemVer([string]$Text) {
  if ($Text -match '(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
  if ($Text -match '(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2])" }
  return $null
}

# --- Windows version ---
$os = Get-CimInstance Win32_OperatingSystem
Add-Result 'Windows' 'PASS' "$($os.Caption) $($os.Version) (build $($os.BuildNumber))"

# --- administrator rights ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Add-Result 'Administrator' 'PASS' 'session is elevated' }
elseif ($RequireAdmin) { Add-Result 'Administrator' 'FAIL' 'not elevated: run PowerShell as Administrator' }
else { Add-Result 'Administrator' 'WARN' 'not elevated: service installation (WIN-03) will need an elevated session' }

# --- Node.js (package.json engines: >= 22.12.0) ---
$nodeText = Get-CommandVersion 'node' @('--version')
if (-not $nodeText) { Add-Result 'Node.js' 'FAIL' 'node not found on PATH' }
else {
  $nodeVer = Get-SemVer $nodeText
  if ($nodeVer -and $nodeVer -ge [version]'22.12.0') { Add-Result 'Node.js' 'PASS' "$nodeText (engines: >= 22.12.0)" }
  else { Add-Result 'Node.js' 'FAIL' "$nodeText is older than the required 22.12.0" }
}

# --- npm (lockfile is npm 10 format; npm 11 also reads it, record what was used) ---
$npmText = Get-CommandVersion 'npm.cmd' @('--version')
if (-not $npmText) { Add-Result 'npm' 'FAIL' 'npm.cmd not found on PATH' }
else {
  $npmVer = Get-SemVer $npmText
  if ($npmVer -and $npmVer.Major -eq 10) { Add-Result 'npm' 'PASS' "$npmText" }
  else { Add-Result 'npm' 'WARN' "$npmText (lockfile was produced with npm 10; record the version used for npm ci)" }
}

# --- Git ---
$gitText = Get-CommandVersion 'git' @('--version')
if ($gitText) { Add-Result 'Git' 'PASS' $gitText } else { Add-Result 'Git' 'FAIL' 'git not found on PATH' }

# --- PostgreSQL client ---
$psqlText = Get-CommandVersion 'psql' @('--version')
if (-not $psqlText -and $env:PGBIN) {
  $candidate = Join-Path $env:PGBIN 'psql.exe'
  if (Test-Path $candidate) { $r = Invoke-Native $candidate @('--version'); if ($r.ExitCode -eq 0) { $psqlText = [string]$r.Output[0] } }
}
if ($psqlText) { Add-Result 'PostgreSQL client' 'PASS' $psqlText }
else { Add-Result 'PostgreSQL client' 'WARN' 'psql not on PATH (add <PostgreSQL>\bin to PATH for backups and checks)' }

# --- PostgreSQL Windows service: running and starting without a desktop login ---
$services = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
if ($services.Count -eq 0) { Add-Result 'PostgreSQL service' 'FAIL' 'no Windows service named postgresql*' }
else {
  foreach ($svc in $services) {
    $startType = (Get-CimInstance Win32_Service -Filter "Name='$($svc.Name)'").StartMode
    if ($svc.Status -eq 'Running' -and $startType -eq 'Auto') { Add-Result "Service $($svc.Name)" 'PASS' "Running, start mode $startType" }
    elseif ($svc.Status -eq 'Running') { Add-Result "Service $($svc.Name)" 'WARN' "Running, start mode $startType (use Automatic so it starts after reboot)" }
    else { Add-Result "Service $($svc.Name)" 'FAIL' "$($svc.Status), start mode $startType" }
  }
}

# --- PostgreSQL listens on loopback only (never exposed to other networks) ---
$listeners = @(Get-NetTCPConnection -LocalPort $PostgreSqlPort -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) { Add-Result "Port $PostgreSqlPort" 'FAIL' 'nothing is listening' }
else {
  $addresses = @($listeners | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
  $public = @($addresses | Where-Object { $_ -ne '127.0.0.1' -and $_ -ne '::1' })
  if ($public.Count -eq 0) { Add-Result "Port $PostgreSqlPort" 'PASS' "listening on $($addresses -join ', ') only" }
  else { Add-Result "Port $PostgreSqlPort" 'FAIL' "listening on $($public -join ', '): set listen_addresses = 'localhost' in postgresql.conf" }
}

# --- power settings (informational: the host must not sleep, WIN-03/07) ---
# labels are localized (e.g. zh-TW), so read the hex values: min, max and increment come first,
# then the current AC index and the current DC index last
$indexes = @((Invoke-Native 'powercfg.exe' @('/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE')).Output | Where-Object { $_ -match ':\s*0x[0-9a-fA-F]+\s*$' })
if ($indexes.Count -ge 2) {
  $ac = [Convert]::ToInt64(($indexes[$indexes.Count - 2] -split ':')[-1].Trim(), 16)
  if ($ac -eq 0) { Add-Result 'Sleep on AC' 'PASS' 'never' } else { Add-Result 'Sleep on AC' 'WARN' "after $ac seconds (turn off sleep for the server)" }
}

$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
$failed = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
Write-Output ("Summary: {0} pass, {1} warn, {2} fail" -f @($results | Where-Object Status -eq 'PASS').Count, @($results | Where-Object Status -eq 'WARN').Count, $failed)
if ($failed -gt 0) { exit 1 }
exit 0
