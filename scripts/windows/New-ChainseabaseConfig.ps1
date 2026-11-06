<#
.SYNOPSIS
  WIN-01: create (or complete) the protected Chainseabase configuration file.

.DESCRIPTION
  Creates the configuration directory and file with an NTFS ACL that allows only SYSTEM,
  Administrators and an optional service account (read). Inheritance is removed before any
  secret is written. Existing values are never overwritten; AUTH_SESSION_SECRET and
  TOKEN_ENCRYPTION_KEY are generated only when missing (regenerating them would sign everyone
  out and make stored calendar tokens unreadable). Optionally imports an existing .env.local.
  Prints variable names only, never values.

  The website, CLI scripts and scheduled tasks read this file through CHAINSEABASE_CONFIG_FILE
  (scripts/config/load-config.mjs). With -SetMachineVariable that path is stored at machine
  scope, so services and scheduled tasks see it without an interactive PowerShell session.

.PARAMETER Path
  Configuration file. Default: %ProgramData%\Chainseabase\config\chainseabase.env

.PARAMETER ServiceAccount
  Account that runs the website service / scheduled tasks (WIN-03/05), granted read only.
  Example: 'NT SERVICE\chainseabase' or '.\chainseabase-svc'.

.PARAMETER ImportEnvFile
  Existing environment file (e.g. the app's .env.local) whose KEY=VALUE lines are copied into a
  NEW configuration file. Not used when the configuration file already exists. The source file
  is left untouched; move it out of the app directory yourself afterwards.

.PARAMETER SetMachineVariable
  Store CHAINSEABASE_CONFIG_FILE=<Path> as a machine environment variable (new processes only).

.EXAMPLE
  # elevated PowerShell, in the app directory
  .\scripts\windows\New-ChainseabaseConfig.ps1 -ImportEnvFile .\.env.local -SetMachineVariable
  echo "exit=$LASTEXITCODE"
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$Path = (Join-Path $env:ProgramData 'Chainseabase\config\chainseabase.env'),
  [string]$ServiceAccount,
  [string]$ImportEnvFile,
  [switch]$SetMachineVariable
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Path must be absolute.' }
$dir = Split-Path -Parent $Path

# well-known SIDs: independent of the Windows display language
$sidSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$sidAdmins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$serviceSid = $null
if ($ServiceAccount) {
  $serviceSid = (New-Object Security.Principal.NTAccount($ServiceAccount)).Translate([Security.Principal.SecurityIdentifier])
}

function Protect-Path([string]$Target, [bool]$IsDirectory) {
  if ($IsDirectory) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $readRights = [Security.AccessControl.FileSystemRights]'ReadAndExecute'
  } else {
    $acl = New-Object Security.AccessControl.FileSecurity
    $inherit = [Security.AccessControl.InheritanceFlags]::None
    $readRights = [Security.AccessControl.FileSystemRights]'Read'
  }
  $prop = [Security.AccessControl.PropagationFlags]::None
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $acl.SetAccessRuleProtection($true, $false)   # no inherited rules (e.g. BUILTIN\Users)
  $acl.SetOwner($sidAdmins)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sidSystem, 'FullControl', $inherit, $prop, $allow)))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sidAdmins, 'FullControl', $inherit, $prop, $allow)))
  if ($serviceSid) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($serviceSid, $readRights, $inherit, $prop, $allow))) }
  Set-Acl -LiteralPath $Target -AclObject $acl
}

function Read-ConfigLines([string]$File) {
  $lines = @([IO.File]::ReadAllLines($File))
  if ($lines.Count -gt 0) { $lines[0] = $lines[0].TrimStart([char]0xFEFF) }
  return ,$lines
}

function Get-Keys([string[]]$Lines) {
  $keys = @()
  foreach ($line in $Lines) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    if ($t -match '^([A-Z][A-Z0-9_]*)\s*=') { $keys += $Matches[1] }
    else { throw 'A line in the source file is not KEY=VALUE (fix it first; values are not printed).' }
  }
  $dupes = @($keys | Group-Object | Where-Object Count -gt 1 | ForEach-Object Name)
  if ($dupes.Count -gt 0) { throw "Duplicate keys: $($dupes -join ', ')" }
  return ,$keys
}

function New-RandomBase64([int]$Bytes, [switch]$Url) {
  $buf = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
  $s = [Convert]::ToBase64String($buf)
  if ($Url) { $s = $s.TrimEnd('=').Replace('+', '-').Replace('/', '_') }
  return $s
}

# 1. protected directory first, then the file (created empty, protected, then filled)
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Protect-Path $dir $true
$created = $false
if (-not (Test-Path -LiteralPath $Path)) {
  [IO.File]::WriteAllText($Path, '', (New-Object Text.UTF8Encoding($false)))
  $created = $true
}
Protect-Path $Path $false

# 2. content: existing file is kept as is; a new file may import an existing env file
if ($created) {
  $lines = @('# Chainseabase configuration (WIN-01). Protected by NTFS ACL; never commit or paste values.')
  if ($ImportEnvFile) {
    if (-not (Test-Path -LiteralPath $ImportEnvFile)) { throw 'ImportEnvFile does not exist.' }
    $lines += (Read-ConfigLines (Resolve-Path -LiteralPath $ImportEnvFile).Path)
  }
} else {
  if ($ImportEnvFile) { Write-Warning 'The configuration file already exists: -ImportEnvFile is ignored (existing values are kept).' }
  $lines = Read-ConfigLines $Path
}
$keys = Get-Keys $lines

# 3. persistent secrets: generated only when missing
$generated = @()
if ($keys -notcontains 'AUTH_SESSION_SECRET') { $lines += "AUTH_SESSION_SECRET=$(New-RandomBase64 48 -Url)"; $generated += 'AUTH_SESSION_SECRET' }
if ($keys -notcontains 'TOKEN_ENCRYPTION_KEY') {
  $lines += "TOKEN_ENCRYPTION_KEY=$(New-RandomBase64 32)"; $generated += 'TOKEN_ENCRYPTION_KEY'
  if ($keys -notcontains 'TOKEN_ENCRYPTION_KEY_VERSION') { $lines += 'TOKEN_ENCRYPTION_KEY_VERSION=1'; $generated += 'TOKEN_ENCRYPTION_KEY_VERSION' }
}
[IO.File]::WriteAllText($Path, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))

# 4. machine-scope path for services and scheduled tasks (not a secret)
if ($SetMachineVariable) {
  [Environment]::SetEnvironmentVariable('CHAINSEABASE_CONFIG_FILE', $Path, 'Machine')
}

$finalKeys = Get-Keys (Read-ConfigLines $Path)
Write-Output "Configuration file: $Path ($(if ($created) { 'created' } else { 'existing file kept' }))"
Write-Output "Readers: SYSTEM, Administrators$(if ($ServiceAccount) { ", $ServiceAccount (read)" })"
Write-Output "Keys present: $($finalKeys -join ', ')"
if ($generated.Count) { Write-Output "Generated (store a copy in your secret backup): $($generated -join ', ')" }
if ($SetMachineVariable) { Write-Output 'CHAINSEABASE_CONFIG_FILE stored at machine scope (open a new PowerShell window to use it).' }
if ($ImportEnvFile -and $created) { Write-Output 'Imported. Move the source file out of the app directory: the loader refuses .env* files next to a config file.' }
exit 0
