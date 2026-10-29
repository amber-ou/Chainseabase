<#
.SYNOPSIS
  WIN-03: deploy a new release to the installed service, or switch back to an earlier one.

.DESCRIPTION
  1. Prepares the release first, while the current one keeps serving: a new build from -Source,
     or an existing folder under <ProgramRoot>\releases with -UseRelease (this is also how to roll
     back). An incomplete release is refused before anything changes.
  2. Optional db:migrate from the new release (-Migrate needs -BackupConfirmed).
  3. Points the service at the release, restarts it and waits for /api/v1/health. If it does not
     become healthy, the previous release is restored and restarted, and the script exits 1.
  Releases, data, configuration and logs are never deleted.

.EXAMPLE
  .\scripts\windows\Update-ChainseabaseService.ps1                      # build from this checkout
  .\scripts\windows\Update-ChainseabaseService.ps1 -UseRelease 20261029-101500-6f45809   # roll back
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$Source,
  [string]$UseRelease,
  [string]$ServiceName = 'Chainseabase',
  [string]$ProgramRoot,
  [ValidateRange(30, 1800)][int]$HealthTimeoutSec = 240,
  [switch]$Migrate,
  [switch]$BackupConfirmed
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here -and $MyInvocation.MyCommand -is [System.Management.Automation.ExternalScriptInfo]) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $here) { $here = Join-Path (Get-Location).ProviderPath 'scripts\windows' }
Import-Module (Join-Path $here 'ChainseabaseService.psm1') -Force

function Fail([string]$Message) { Write-Output "FAIL $Message"; exit 1 }

if (-not $ProgramRoot) { $ProgramRoot = Join-Path $env:ProgramFiles 'Chainseabase' }
if ($Migrate -and -not $BackupConfirmed) { Fail '-Migrate needs -BackupConfirmed: take a database backup first.' }
$installJson = Join-Path (Join-Path $ProgramRoot 'service') 'install.json'
if (-not (Test-Path -LiteralPath $installJson) -or -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
  Fail "service $ServiceName is not installed: run Install-ChainseabaseService.ps1 first"
}
$settings = Get-Content -LiteralPath $installJson -Raw | ConvertFrom-Json
$paths = Get-ChainseabasePaths $ProgramRoot $ServiceName $settings.LogRoot
$previous = Get-CurrentRelease $paths
$sid = Get-ServiceSid $ServiceName

# 1. prepare
if ($UseRelease) {
  if ($UseRelease -notmatch '^[0-9]{8}-[0-9]{6}-[0-9a-z]{4,7}$') { Fail 'UseRelease: a release folder name such as 20261029-101500-6f45809' }
  $release = Join-Path $paths.Releases $UseRelease
  if (-not (Test-Path -LiteralPath $release -PathType Container)) { Fail "release not found: $release" }
} else {
  $Source = Resolve-AppDirectory $Source $here
  Write-Output "Building a release from $Source (npm ci, npm run build)..."
  $release = New-ChainseabaseRelease $Source $paths.Releases
}
$problem = Test-ReleaseDirectory $release
if ($problem) { Fail "release incomplete ($problem): nothing was changed" }
if ($previous -and ((Resolve-Path -LiteralPath $release).ProviderPath -ieq $previous)) { Fail "$release is already the current release" }
Protect-Release $release $sid
Write-Output "Release: $release (current: $previous)"

# 2. optional migration (additive migrations only; the previous release must keep working)
if ($Migrate) {
  $old = $env:CHAINSEABASE_CONFIG_FILE
  $env:CHAINSEABASE_CONFIG_FILE = $settings.ConfigFile
  try { $r = Invoke-Native npm.cmd @('run', '--silent', 'db:migrate') $release } finally { $env:CHAINSEABASE_CONFIG_FILE = $old }
  $r.Output | Write-Output
  if ($r.ExitCode -ne 0) { Fail "db:migrate failed (exit $($r.ExitCode)); the service still runs $previous" }
}

# 3. switch, verify, roll back on failure
function Switch-To([string]$Dir) {
  Write-ServiceXml $paths $ServiceName $Dir $settings
  Stop-Service -Name $ServiceName -Force
  if (-not (Wait-PortReleased $settings.Port 30)) { throw "port $($settings.Port) still in use after stopping" }
  Start-Service -Name $ServiceName
  return (Wait-Healthy $settings.Port $HealthTimeoutSec)
}
if (Switch-To $release) {
  Add-Content -LiteralPath $paths.History -Value "$((Get-Date).ToString('o')) switch $(Split-Path -Leaf $release) (from $(Split-Path -Leaf $previous))"
  Write-Output "PASS $ServiceName now runs $(Split-Path -Leaf $release) and is healthy"
  exit 0
}
Write-Output "Release $(Split-Path -Leaf $release) did not become healthy within $HealthTimeoutSec s: restoring $(Split-Path -Leaf $previous)"
$restored = $false
if ($previous) { $restored = Switch-To $previous }
Add-Content -LiteralPath $paths.History -Value "$((Get-Date).ToString('o')) rollback $(Split-Path -Leaf $release) -> $(Split-Path -Leaf $previous) (healthy: $restored)"
if ($restored) { Fail "rolled back to $(Split-Path -Leaf $previous) (healthy); see $($paths.Logs) for why the new release failed" }
Fail "rollback to $(Split-Path -Leaf $previous) is not healthy either; see $($paths.Logs)"
