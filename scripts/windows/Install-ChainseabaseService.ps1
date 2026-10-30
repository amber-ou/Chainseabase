<#
.SYNOPSIS
  WIN-03: install (or re-install) the Chainseabase website as a Windows service.

.DESCRIPTION
  Re-runnable. Each run builds a new release from -Source and (re)configures the service; an
  existing service keeps its data, configuration and logs.
    1. Checks: Windows PowerShell as Administrator, node.exe outside any user profile, the
       PostgreSQL service set to Automatic, the configuration file present with a filesystem avatar
       root (WIN-02), and the port free (or held by this service).
    2. Builds a release: <ProgramRoot>\releases\<time>-<commit> (copy without node_modules/.git/
       .env*, then npm ci and npm run build).
    3. Installs the pinned WinSW wrapper (size and SHA-256 verified) and the service definition.
    4. Runs the service as the virtual account NT SERVICE\<ServiceName>: dedicated, no password,
       not an administrator. Start type Automatic (delayed), depends on PostgreSQL, restarts after
       failures (10 s / 30 s / 60 s, counter reset after 1 hour), stops the process tree.
    5. Grants that account only: read the configuration file and folder; read/execute the release
       and the service folder; modify the avatar root, the log folder and the release .next\cache.
    6. Starts the service and waits for /api/v1/health on 127.0.0.1.
  The website only listens on 127.0.0.1; nothing is opened to the network.

.PARAMETER Source
  App source directory (a git checkout). Default: two levels above this script.

.PARAMETER Migrate
  Run db:migrate from the new release before starting. Requires -BackupConfirmed (take a database
  backup first; automated backups are WIN-05).

.EXAMPLE
  .\scripts\windows\Install-ChainseabaseService.ps1
  echo "exit=$LASTEXITCODE"
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$Source,
  [string]$ServiceName = 'Chainseabase',
  [ValidateRange(1, 65535)][int]$Port = 3000,
  [string]$ProgramRoot,
  [string]$LogRoot,
  [string]$ConfigFile,
  [string]$NodePath,
  [string]$PostgresService,
  [string]$WinSWFile,
  [ValidateRange(0, 3600)][int]$DbWaitSeconds = 600,
  [ValidateRange(4, 1048576)][int]$LogSizeKB = 10240,
  [ValidateRange(1, 100)][int]$LogKeepFiles = 8,
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

if ($ServiceName -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,63}$') { Fail 'ServiceName: letters, digits, - and _ only' }
if (-not $ProgramRoot) { $ProgramRoot = Join-Path $env:ProgramFiles 'Chainseabase' }
if (-not $LogRoot) { $LogRoot = Join-Path $env:ProgramData 'Chainseabase\logs' }
if (-not $ConfigFile) { $ConfigFile = Get-DefaultConfigFile }
if ($Migrate -and -not $BackupConfirmed) { Fail '-Migrate needs -BackupConfirmed: take a database backup first.' }
$Source = Resolve-AppDirectory $Source $here
$paths = Get-ChainseabasePaths $ProgramRoot $ServiceName $LogRoot

# 1. checks
if (-not (Test-Path -LiteralPath $ConfigFile)) { Fail "configuration file not found: $ConfigFile (run New-ChainseabaseConfig.ps1)" }
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) { Fail 'node.exe not found (install Node.js for all users, or pass -NodePath)' }
$NodePath = (Resolve-Path -LiteralPath $NodePath).ProviderPath
if ($NodePath.StartsWith((Join-Path $env:SystemDrive 'Users'), [StringComparison]::OrdinalIgnoreCase)) {
  Fail "node.exe is inside a user profile ($NodePath): the service account cannot rely on it. Install Node.js for all users (Program Files)."
}
if (-not $PostgresService) {
  $pg = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
  if ($pg.Count -ne 1) { Fail "found $($pg.Count) PostgreSQL services: pass -PostgresService <name>" }
  $PostgresService = $pg[0].Name
}
$pgSvc = Get-CimInstance Win32_Service -Filter "Name='$PostgresService'"
if (-not $pgSvc) { Fail "PostgreSQL service not found: $PostgresService" }
if ($pgSvc.StartMode -ne 'Auto') { Fail "PostgreSQL service $PostgresService must start Automatically (now: $($pgSvc.StartMode))" }
$avatarRoot = Get-ConfigValue $ConfigFile 'AVATAR_STORAGE_DIR'
if (-not $avatarRoot -or -not (Test-Path -LiteralPath $avatarRoot -PathType Container)) {
  Fail 'the configuration has no existing AVATAR_STORAGE_DIR: run Initialize-ChainseabaseAvatarStorage.ps1 first (WIN-02)'
}
if ((Get-ConfigValue $ConfigFile 'E2E_TEST_LOGIN') -eq 'enabled') { Write-Warning 'E2E_TEST_LOGIN=enabled is set: remove it for a service (Set-ChainseabaseConfigValue.ps1 -Name E2E_TEST_LOGIN -Remove).' }
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
  $holder = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($holder) { Fail "port $Port is already in use (process $($holder.OwningProcess)); stop npm start or choose -Port" }
}
Write-Output "Source: $Source"
Write-Output "Node: $NodePath ($((Invoke-Native $NodePath @('--version')).Output | Select-Object -First 1))"
Write-Output "PostgreSQL service: $PostgresService"

# 2. release
New-Item -ItemType Directory -Force -Path $paths.Releases, $paths.ServiceDir, $paths.Logs | Out-Null
Write-Output 'Building a release (npm ci, npm run build)...'
$release = New-ChainseabaseRelease $Source $paths.Releases
$problem = Test-ReleaseDirectory $release
if ($problem) { Fail "release incomplete: $problem" }
Write-Output "Release: $release"

# 3. wrapper and definition
$winsw = Install-WinSWBinary $paths.WinSWExe $WinSWFile
$pin = Get-WinSWPin
Write-Output "WinSW $($pin.Version): $winsw (SHA-256 verified)"
$settings = [pscustomobject]@{
  ServiceName = $ServiceName; Port = $Port; NodePath = $NodePath; ConfigFile = $ConfigFile; PostgresService = $PostgresService
  DbWaitSeconds = $DbWaitSeconds; LogSizeKB = $LogSizeKB; LogKeepFiles = $LogKeepFiles; LogRoot = $paths.Logs; ProgramRoot = $ProgramRoot
}
if ($existing) {
  if (-not (Stop-ChainseabaseService $ServiceName $Port)) { Fail "$ServiceName did not stop (or port $Port stayed in use)" }
}
Write-ServiceXml $paths $ServiceName $release $settings
if (-not $existing) {
  $r = Invoke-Native $paths.WinSWExe @('install')
  if ($r.ExitCode -ne 0) { Fail "WinSW install failed ($($r.ExitCode)): $($r.Output -join ' ')" }
}
Set-ServiceRegistration $ServiceName $PostgresService
[IO.File]::WriteAllText($paths.InstallJson, ($settings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

# 4./5. least-privilege access for NT SERVICE\<name>
$sid = Get-ServiceSid $ServiceName
Set-ProtectedAcl $paths.ServiceDir @{ $sid = 'ReadAndExecute' }
Set-ProtectedAcl $paths.Logs @{ $sid = 'Modify' }
Protect-Release $release $sid
# the folder itself only (other files there, e.g. env-local.backup, stay administrators-only)
Add-PathAccess (Split-Path -Parent $ConfigFile) $sid 'ReadAndExecute' -ThisFolderOnly
Add-PathAccess $ConfigFile $sid 'Read'
Add-PathAccess $avatarRoot $sid 'Modify'
Write-Output "Service account: NT SERVICE\$ServiceName ($sid)"
Write-Output "  read: configuration file (folder: list only); read/execute: release, service folder"
Write-Output "  modify: $avatarRoot, $($paths.Logs), release .next\cache"

if ($Migrate) {
  $previous = $env:CHAINSEABASE_CONFIG_FILE
  $env:CHAINSEABASE_CONFIG_FILE = $ConfigFile
  try { $r = Invoke-Native npm.cmd @('run', '--silent', 'db:migrate') $release } finally { $env:CHAINSEABASE_CONFIG_FILE = $previous }
  $r.Output | Write-Output
  if ($r.ExitCode -ne 0) { Fail "db:migrate failed (exit $($r.ExitCode)); the service was not started" }
}

# 6. start
Start-Service -Name $ServiceName
if (-not (Wait-Healthy $Port $HealthTimeoutSec)) { Fail "service started but /api/v1/health did not answer within $HealthTimeoutSec s; see $($paths.Logs)" }
Add-Content -LiteralPath $paths.History -Value "$((Get-Date).ToString('o')) install $(Split-Path -Leaf $release)"
Write-Output "PASS service $ServiceName running, healthy on http://127.0.0.1:$Port"
Write-Output "Next: .\scripts\windows\Test-ChainseabaseService.ps1"
exit 0
