<#
.SYNOPSIS
  WIN-03: remove the Chainseabase website service without touching data, secrets or backups.

.DESCRIPTION
  Stops and deletes the service and removes the service account's permissions from the
  configuration file, avatar root and log folder. Never deletes: the configuration file and its
  folder, the avatar root, the database, logs, backups. Releases and the WinSW wrapper (program
  files only) stay too unless -RemoveProgramFiles is given. Re-runnable.

.EXAMPLE
  .\scripts\windows\Uninstall-ChainseabaseService.ps1
  echo "exit=$LASTEXITCODE"
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$ServiceName = 'Chainseabase',
  [string]$ProgramRoot,
  [switch]$RemoveProgramFiles
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here -and $MyInvocation.MyCommand -is [System.Management.Automation.ExternalScriptInfo]) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $here) { $here = Join-Path (Get-Location).ProviderPath 'scripts\windows' }
Import-Module (Join-Path $here 'ChainseabaseService.psm1') -Force

if (-not $ProgramRoot) { $ProgramRoot = Join-Path $env:ProgramFiles 'Chainseabase' }
$serviceDir = Join-Path $ProgramRoot 'service'
$installJson = Join-Path $serviceDir 'install.json'
$settings = $null
if (Test-Path -LiteralPath $installJson) { $settings = Get-Content -LiteralPath $installJson -Raw | ConvertFrom-Json }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  $sid = Get-ServiceSid $ServiceName
  if ($settings) {
    if (-not (Stop-ChainseabaseService $ServiceName ([int]$settings.Port))) { Write-Output "FAIL $ServiceName did not stop (or port $($settings.Port) stayed in use); nothing was removed"; exit 1 }
  } elseif ($svc.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
  # permissions granted at install, removed by SID (files and folders stay)
  if ($settings) {
    foreach ($p in @($settings.ConfigFile, (Split-Path -Parent $settings.ConfigFile), $settings.LogRoot)) { Remove-PathAccess $p $sid }
    $avatarRoot = $null
    if (Test-Path -LiteralPath $settings.ConfigFile) { $avatarRoot = Get-ConfigValue $settings.ConfigFile 'AVATAR_STORAGE_DIR' }
    if ($avatarRoot) { Remove-PathAccess $avatarRoot $sid }
  }
  $releases = Join-Path $ProgramRoot 'releases'
  if (Test-Path -LiteralPath $releases) { foreach ($d in Get-ChildItem -LiteralPath $releases -Directory) { Remove-PathAccess $d.FullName $sid; Remove-PathAccess (Join-Path $d.FullName '.next\cache') $sid } }
  Remove-PathAccess $serviceDir $sid
  $r = Invoke-Native "$env:SystemRoot\System32\sc.exe" @('delete', $ServiceName)
  if ($r.ExitCode -ne 0) { Write-Output "FAIL sc.exe delete ($($r.ExitCode)): $($r.Output -join ' ')"; exit 1 }
  Write-Output "Service $ServiceName removed; NT SERVICE\$ServiceName permissions removed"
} else {
  Write-Output "Service $ServiceName is not installed"
}

if ($RemoveProgramFiles) {
  foreach ($d in @($serviceDir, (Join-Path $ProgramRoot 'releases'))) {
    if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force; Write-Output "Removed program files: $d" }
  }
}
Write-Output 'Kept: configuration file and folder (secrets), avatar root, database, logs, backups'
if (-not $RemoveProgramFiles) { Write-Output "Kept: $ProgramRoot (releases and WinSW; -RemoveProgramFiles removes them)" }
exit 0
