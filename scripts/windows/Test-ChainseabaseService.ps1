<#
.SYNOPSIS
  WIN-03: verify the installed Chainseabase website service. Exit 0 when every check passes.

.DESCRIPTION
  Evidence comes from the running service itself, not from this (administrator) PowerShell:
  the website process must run as NT SERVICE\<ServiceName>, answer /api/v1/health (so it read the
  configuration file) and listen on loopback only; the access checks read the rights granted to
  that account's SID (read-only where it must not write). Checks:
    service: running, account, Automatic (delayed), depends on PostgreSQL, recovery actions,
             not a member of Administrators;
    process: node.exe owned by the service account, listening only on 127.0.0.1/::1, healthy;
    access:  configuration read-only, release and wrapper read-only, avatar root / logs /
             .next\cache writable; WinSW binary matches the pinned SHA-256;
    logs:    size-based rotation configured, file count within the limit, service wrote them.
  -BootReport (after a reboot, before anyone signs in): compares the boot time, the first
  website.ready log line and the first interactive sign-in after boot.

.EXAMPLE
  .\scripts\windows\Test-ChainseabaseService.ps1
  .\scripts\windows\Test-ChainseabaseService.ps1 -BootReport
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$ServiceName = 'Chainseabase',
  [string]$ProgramRoot,
  [switch]$BootReport
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here -and $MyInvocation.MyCommand -is [System.Management.Automation.ExternalScriptInfo]) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $here) { $here = Join-Path (Get-Location).ProviderPath 'scripts\windows' }
Import-Module (Join-Path $here 'ChainseabaseService.psm1') -Force

$failures = 0
function Check([bool]$Ok, [string]$Message) {
  if ($Ok) { Write-Output "PASS $Message" } else { Write-Output "FAIL $Message"; $script:failures++ }
}

if (-not $ProgramRoot) { $ProgramRoot = Join-Path $env:ProgramFiles 'Chainseabase' }
$installJson = Join-Path (Join-Path $ProgramRoot 'service') 'install.json'
$svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
if (-not $svc -or -not (Test-Path -LiteralPath $installJson)) { Write-Output "FAIL service $ServiceName is not installed"; exit 1 }
$settings = Get-Content -LiteralPath $installJson -Raw | ConvertFrom-Json
$paths = Get-ChainseabasePaths $ProgramRoot $ServiceName $settings.LogRoot
$port = [int]$settings.Port
$sid = Get-ServiceSid $ServiceName

# service definition
Check ($svc.State -eq 'Running') "service state: $($svc.State)"
Check ($svc.StartName -eq "NT SERVICE\$ServiceName") "runs as the virtual account: $($svc.StartName)"
Check ($svc.StartMode -eq 'Auto' -and $svc.DelayedAutoStart) "start type Automatic (delayed): $($svc.StartMode), delayed=$($svc.DelayedAutoStart)"
$deps = @((Get-Service -Name $ServiceName).ServicesDependedOn | ForEach-Object Name)
Check ($deps -contains $settings.PostgresService) "depends on PostgreSQL ($($settings.PostgresService)): $($deps -join ', ')"
# recovery read as numbers from the service configuration, not from sc.exe text (translated, e.g. zh-TW)
$rec = Get-ServiceRecovery $ServiceName
$recProblems = @(Get-RecoveryProblems $rec.Recovery $rec.NonCrashFlag)
$actionProblems = @($recProblems | Where-Object { $_ -notmatch 'FailureActionsOnNonCrashFailures' })
$policy = Get-RecoveryPolicy
Check ($actionProblems.Count -eq 0) "recovery: restart after $(($policy.DelaysMs | ForEach-Object { $_ / 1000 }) -join '/') s, counter reset after $($policy.ResetSeconds) s (read: $(Format-Recovery $rec.Recovery $rec.NonCrashFlag)$(if ($null -eq $rec.Recovery) { ", FailureActions $($rec.Length) bytes" }))"
foreach ($p in $actionProblems) { Write-Output "     $p" }
Check ($rec.NonCrashFlag -eq 1) "recovery also applies when the process exits with an error (FailureActionsOnNonCrashFailures: $(if ($null -eq $rec.NonCrashFlag) { 'missing' } else { $rec.NonCrashFlag }))"
# membership read by SID (group names are localized); an unreadable group is a failure, not a pass
$adminCheck = $null
try { $adminCheck = -not (@(Get-LocalAdministratorSids) -contains $sid) } catch { }
Check ($adminCheck -eq $true) "NT SERVICE\$ServiceName is not a member of Administrators"

# the running process (this is the service account at work, not this PowerShell)
$proc = Get-WebsiteProcess $ServiceName
Check ($null -ne $proc) 'website process (node.exe under the service wrapper) is running'
if ($proc) {
  $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner
  Check ("$($owner.Domain)\$($owner.User)" -eq "NT SERVICE\$ServiceName") "website process runs as $($owner.Domain)\$($owner.User)"
  $listen = @(Get-NetTCPConnection -OwningProcess $proc.ProcessId -State Listen -ErrorAction SilentlyContinue)
  $addresses = @($listen | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" } | Sort-Object -Unique)
  $outside = @($listen | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
  Check ($listen.Count -gt 0 -and $outside.Count -eq 0 -and @($listen | Where-Object LocalPort -eq $port).Count -gt 0) "listens on loopback only: $($addresses -join ', ')"
}
# a website process left behind by a crashed wrapper would hold the port unmanaged
$ownNode = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner
    "$($o.Domain)\$($o.User)" -eq "NT SERVICE\$ServiceName" })
Check ($ownNode.Count -eq 1) "exactly one node.exe runs as NT SERVICE\$ServiceName (found $($ownNode.Count); no orphan from a crashed wrapper)"
$any = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
Check ($any.Count -eq 0) "nothing listens on port $port beyond loopback"
Check (Wait-Healthy $port 10) "health: http://127.0.0.1:$port/api/v1/health answers 200 (the service read its configuration)"

# access of NT SERVICE\<name>
$avatarRoot = Get-ConfigValue $settings.ConfigFile 'AVATAR_STORAGE_DIR'
$release = Get-CurrentRelease $paths
$cfgRights = Get-PathRights $settings.ConfigFile $sid
Check ((($cfgRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0) -and -not (Test-CanWrite $cfgRights)) "configuration file: read only ($cfgRights)"
Check (-not (Test-CanWrite (Get-PathRights (Split-Path -Parent $settings.ConfigFile) $sid))) 'configuration folder: no write'
foreach ($other in @(Get-ChildItem -LiteralPath (Split-Path -Parent $settings.ConfigFile) -File | Where-Object { $_.FullName -ne (Resolve-Path -LiteralPath $settings.ConfigFile).ProviderPath })) {
  Check ((Get-PathRights $other.FullName $sid) -eq 0) "no access to other files in the configuration folder: $($other.Name)"
}
Check (Test-CanWrite (Get-PathRights $avatarRoot $sid)) "avatar root writable: $avatarRoot"
Check (Test-CanWrite (Get-PathRights $paths.Logs $sid)) "log folder writable: $($paths.Logs)"
Check (-not (Test-CanWrite (Get-PathRights $release $sid))) "release read-only: $release"
Check (Test-CanWrite (Get-PathRights (Join-Path $release '.next\cache') $sid)) 'release .next\cache writable'
Check (-not (Test-CanWrite (Get-PathRights $paths.ServiceDir $sid))) "service folder read-only: $($paths.ServiceDir)"
$pin = Get-WinSWPin
Check ((Get-FileHash -LiteralPath $paths.WinSWExe -Algorithm SHA256).Hash -eq $pin.Sha256) "WinSW $($pin.Version) binary matches the pinned SHA-256"
Check ((Get-Acl -LiteralPath $release).AreAccessRulesProtected) 'release folder does not inherit permissions'

# logs
[xml]$x = [IO.File]::ReadAllText($paths.Xml)
Check ($x.service.log.mode -eq 'roll-by-size') "log rotation: roll-by-size, $($x.service.log.sizeThreshold) KB, keep $($x.service.log.keepFiles)"
$outLogs = @(Get-ChildItem -LiteralPath $paths.Logs -Filter "$ServiceName.*out.log" -File -ErrorAction SilentlyContinue)
Check ($outLogs.Count -ge 1 -and $outLogs.Count -le ([int]$x.service.log.keepFiles + 1)) "log files: $($outLogs.Count) (limit $([int]$x.service.log.keepFiles + 1))"
$wrapperStart = (Get-CimInstance Win32_Process -Filter "ProcessId=$($svc.ProcessId)").CreationDate
# the running website process logs its own pid at start; finding it proves the service account wrote
# the log (directory timestamps of a file held open are updated lazily, so they are not evidence)
$logText = ($outLogs | ForEach-Object { Read-SharedText $_.FullName }) -join "`n"
$ownLine = $false
if ($proc) { $ownLine = $logText -match ('"event":"website\.starting"[^\n]*"pid":' + $proc.ProcessId + '\b') }
Check $ownLine "the running website process (pid $(if ($proc) { $proc.ProcessId })) wrote its start line to the log"

if ($BootReport) {
  $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  $ready = @()
  foreach ($f in $outLogs) {
    foreach ($line in ((Read-SharedText $f.FullName) -split "`r?`n")) {
      if ($line -match '"event":"website\.ready"') {
        try { $t = [datetime]::Parse(($line | ConvertFrom-Json).at).ToLocalTime(); if ($t -ge $boot) { $ready += $t } } catch { }
      }
    }
  }
  $firstReady = $ready | Sort-Object | Select-Object -First 1
  $logons = @(Get-CimInstance Win32_LogonSession | Where-Object { $_.LogonType -in @(2, 10, 11) -and $_.StartTime -ge $boot } | ForEach-Object StartTime | Sort-Object)
  $firstLogon = $logons | Select-Object -First 1
  Write-Output "Boot: $boot"
  Write-Output "Service wrapper started: $wrapperStart"
  Write-Output "First website.ready after boot: $(if ($firstReady) { $firstReady } else { 'none' })"
  Write-Output "First interactive sign-in after boot: $(if ($firstLogon) { $firstLogon } else { 'none' })"
  Check ($null -ne $firstReady -and ($null -eq $firstLogon -or $firstReady -lt $firstLogon)) 'website was ready after the reboot before anyone signed in'
}

if ($failures -gt 0) { Write-Output "$failures check(s) failed"; exit 1 }
Write-Output 'All checks passed'
exit 0
