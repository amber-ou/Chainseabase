<#
.SYNOPSIS
  WIN-03: start, stop, restart or show the Chainseabase website service.

.DESCRIPTION
  Start/Restart wait for /api/v1/health on 127.0.0.1. Stop waits until the port is released, so
  the process tree is gone (the service runs node.exe directly; WinSW stops it and its children).
  Status prints state, account, process, listening addresses and health. Exit 0 on success.

.EXAMPLE
  .\scripts\windows\Set-ChainseabaseServiceState.ps1 -Action Restart
  echo "exit=$LASTEXITCODE"
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Start', 'Stop', 'Restart', 'Status')][string]$Action,
  [string]$ServiceName = 'Chainseabase',
  [string]$ProgramRoot,
  [ValidateRange(30, 1800)][int]$HealthTimeoutSec = 240
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here -and $MyInvocation.MyCommand -is [System.Management.Automation.ExternalScriptInfo]) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $here) { $here = Join-Path (Get-Location).ProviderPath 'scripts\windows' }
Import-Module (Join-Path $here 'ChainseabaseService.psm1') -Force

if (-not $ProgramRoot) { $ProgramRoot = Join-Path $env:ProgramFiles 'Chainseabase' }
$installJson = Join-Path (Join-Path $ProgramRoot 'service') 'install.json'
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -or -not (Test-Path -LiteralPath $installJson)) {
  Write-Output "FAIL service $ServiceName is not installed"; exit 1
}
$settings = Get-Content -LiteralPath $installJson -Raw | ConvertFrom-Json
$port = [int]$settings.Port

if ($Action -in @('Stop', 'Restart')) {
  if (-not (Stop-ChainseabaseService $ServiceName $port)) { Write-Output "FAIL $ServiceName did not stop (or port $port stayed in use)"; exit 1 }
  Write-Output "stopped; port $port released"
}
if ($Action -in @('Start', 'Restart')) {
  Start-Service -Name $ServiceName
  if (-not (Wait-Healthy $port $HealthTimeoutSec)) { Write-Output "FAIL not healthy within $HealthTimeoutSec s; see $($settings.LogRoot)"; exit 1 }
  Write-Output "running and healthy on http://127.0.0.1:$port"
}
if ($Action -eq 'Status') {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  Write-Output "State: $($svc.State); start mode: $($svc.StartMode) (delayed: $($svc.DelayedAutoStart)); account: $($svc.StartName)"
  $w = $null
  try { $w = Get-WebsiteProcessOwner $ServiceName } catch { Write-Output "FAIL website process owner could not be read: $($_.Exception.Message)"; exit 1 }
  if ($w) {
    $p = $w.Process
    $listen = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" })
    Write-Output "Website process: node.exe $($p.ProcessId) as $($w.Owner), started $($p.CreationDate); listening: $($listen -join ', ')"
  }
  $healthy = Wait-Healthy $port 5
  Write-Output "Health: $(if ($healthy) { 'ok' } else { 'not answering' })"
  Write-Output "Release: $(Get-CurrentRelease (Get-ChainseabasePaths $ProgramRoot $ServiceName $settings.LogRoot))"
  if ($svc.State -ne 'Running' -or -not $healthy) { exit 1 }
}
exit 0
