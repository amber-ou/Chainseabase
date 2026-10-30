<#
.SYNOPSIS
  WIN-02: create the protected avatar directory and point the configuration file at it.

.DESCRIPTION
  1. Creates the avatar root (outside the app directory, so upgrades never touch it) with an NTFS
     ACL that does not inherit: SYSTEM and Administrators full control, the optional service
     account Modify (read/write files, no permission changes). Existing files are kept.
  2. Optionally copies existing development avatars (e.g. the app's .data\avatars) into the root.
     Only files named like the app's own objects (<user id>\<16 chars>.webp) are copied; existing
     destination files are never overwritten and the source is never deleted.
  3. Sets STORAGE_PROVIDER=filesystem and AVATAR_STORAGE_DIR=<Path> in the configuration file
     (written in place, the file keeps its ACL). A different AVATAR_STORAGE_DIR already in the file
     is refused: changing it without moving the files would lose every avatar.
  Prints paths and counts only. Restart the website afterwards.

.PARAMETER Path
  Avatar root. Default: %ProgramData%\Chainseabase\data\avatars

.PARAMETER ConfigFile
  Configuration file. Default: the machine CHAINSEABASE_CONFIG_FILE, else
  %ProgramData%\Chainseabase\config\chainseabase.env

.PARAMETER ServiceAccount
  Account that runs the website service (WIN-03), granted Modify on the avatar root.

.PARAMETER ImportFrom
  Existing avatar directory to copy from (e.g. .\.data\avatars). Left untouched.

.PARAMETER AppDirectory
  Chainseabase app directory, used to refuse an avatar root inside it. Default: two levels above
  this script, else the current directory; it must contain package.json.

.EXAMPLE
  # elevated PowerShell, in the app directory
  .\scripts\windows\Initialize-ChainseabaseAvatarStorage.ps1 -ImportFrom .\.data\avatars
  echo "exit=$LASTEXITCODE"
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$Path,
  [string]$ConfigFile,
  [string]$ServiceAccount,
  [string]$ImportFrom,
  [string]$AppDirectory
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

if (-not $Path) { $Path = Join-Path $env:ProgramData 'Chainseabase\data\avatars' }
if (-not $ConfigFile) { $ConfigFile = [Environment]::GetEnvironmentVariable('CHAINSEABASE_CONFIG_FILE', 'Machine') }
if (-not $ConfigFile) { $ConfigFile = Join-Path $env:ProgramData 'Chainseabase\config\chainseabase.env' }
if (-not (Test-Path -LiteralPath $ConfigFile)) { Write-Output 'FAIL configuration file not found: run New-ChainseabaseConfig.ps1 first.'; exit 1 }

# resolved in the body: $PSScriptRoot can be empty in a parameter default (Windows 11 host report)
if (-not $AppDirectory) {
  $scriptDirectory = $PSScriptRoot
  if (-not $scriptDirectory -and $MyInvocation.MyCommand -is [System.Management.Automation.ExternalScriptInfo]) {
    $scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  if ($scriptDirectory) { $AppDirectory = Split-Path -Parent (Split-Path -Parent $scriptDirectory) }
  else { $AppDirectory = (Get-Location).ProviderPath }
}
if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory 'package.json'))) {
  Write-Output "FAIL not the Chainseabase app directory: $AppDirectory (pass -AppDirectory <app directory>)"
  exit 1
}

# same rules as the application (AVATAR_STORAGE_DIR): a local drive path outside the app directory
if ($Path -notmatch '^[A-Za-z]:[\\/]') { Write-Output 'FAIL the avatar root must be an absolute local drive path (no UNC or device path).'; exit 1 }
$root = [IO.Path]::GetFullPath($Path).TrimEnd('\')
$app = [IO.Path]::GetFullPath($AppDirectory).TrimEnd('\')
if ($root -ieq $app -or $root.StartsWith("$app\", [StringComparison]::OrdinalIgnoreCase)) {
  Write-Output 'FAIL the avatar root must be outside the application directory (upgrades replace that directory).'
  exit 1
}

# config values: refuse to repoint an existing root (its files would be orphaned)
$lines = New-Object System.Collections.Generic.List[string]
$raw = @([IO.File]::ReadAllLines($ConfigFile))
if ($raw.Count -gt 0) { $raw[0] = $raw[0].TrimStart([char]0xFEFF) }
foreach ($l in $raw) { $lines.Add($l) }
function Find-Key([string]$Name) {
  $found = @(for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -match "^$Name\s*=") { $i } })
  if ($found.Count -gt 1) { throw "$Name appears more than once in the configuration file; fix it first." }
  return ,$found
}
$dirIndex = Find-Key 'AVATAR_STORAGE_DIR'
if ($dirIndex.Count -eq 1) {
  $current = ($lines[$dirIndex[0]] -replace '^\s*AVATAR_STORAGE_DIR\s*=\s*', '').Trim().Trim('"', "'")
  if ($current -and ([IO.Path]::GetFullPath($current).TrimEnd('\') -ine $root)) {
    Write-Output "FAIL AVATAR_STORAGE_DIR is already $current. Move its files first and change it deliberately; this script does not repoint an existing root."
    exit 1
  }
}

# 1. protected root
$sidSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$sidAdmins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$serviceSid = $null
if ($ServiceAccount) { $serviceSid = (New-Object Security.Principal.NTAccount($ServiceAccount)).Translate([Security.Principal.SecurityIdentifier]) }
$created = -not (Test-Path -LiteralPath $root)
New-Item -ItemType Directory -Force -Path $root | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$prop = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
$acl.SetAccessRuleProtection($true, $false)   # no inherited rules (e.g. BUILTIN\Users)
$acl.SetOwner($sidAdmins)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sidSystem, 'FullControl', $inherit, $prop, $allow)))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sidAdmins, 'FullControl', $inherit, $prop, $allow)))
if ($serviceSid) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($serviceSid, 'Modify', $inherit, $prop, $allow))) }
Set-Acl -LiteralPath $root -AclObject $acl

# 2. optional copy of existing avatars (same object names, so database paths stay valid)
$copied = 0; $kept = 0; $ignored = 0
if ($ImportFrom) {
  if (-not (Test-Path -LiteralPath $ImportFrom -PathType Container)) { Write-Output 'FAIL ImportFrom is not a directory.'; exit 1 }
  $source = (Resolve-Path -LiteralPath $ImportFrom).ProviderPath
  foreach ($f in Get-ChildItem -LiteralPath $source -Recurse -File) {
    $rel = $f.FullName.Substring($source.TrimEnd('\').Length + 1)
    if ($rel -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\[A-Za-z0-9_-]{16}\.webp$') { $ignored++; continue }
    $dest = Join-Path $root $rel
    if (Test-Path -LiteralPath $dest) { $kept++; continue }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $f.FullName -Destination $dest
    $copied++
  }
}

# 3. configuration values (not secrets), written in place so the file keeps its ACL
foreach ($pair in @(@('STORAGE_PROVIDER', 'filesystem'), @('AVATAR_STORAGE_DIR', $root))) {
  $idx = Find-Key $pair[0]
  $entry = "$($pair[0])=$($pair[1])"
  if ($idx.Count -eq 1) { $lines[$idx[0]] = $entry } else { $lines.Add($entry) }
}
[IO.File]::WriteAllText($ConfigFile, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))

Write-Output "Avatar root: $root ($(if ($created) { 'created' } else { 'existing directory kept' }))"
Write-Output "Access: SYSTEM, Administrators$(if ($ServiceAccount) { ", $ServiceAccount (modify)" }); inheritance removed"
if ($ImportFrom) { Write-Output "Imported from ${source}: $copied copied, $kept already present (kept), $ignored other files ignored; source left untouched" }
Write-Output "Configuration: STORAGE_PROVIDER=filesystem, AVATAR_STORAGE_DIR set in $ConfigFile. Restart the website to use it."
exit 0
