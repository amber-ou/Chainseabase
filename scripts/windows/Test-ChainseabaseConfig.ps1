<#
.SYNOPSIS
  WIN-01: verify the configuration file's NTFS protection and validate its contents.

.DESCRIPTION
  1. The file and its directory must not inherit permissions and may grant access only to
     SYSTEM, Administrators and the listed service account(s).
  2. Runs `npm run config:check` in the app directory with CHAINSEABASE_CONFIG_FILE set for that
     child process only: the same loader the website and CLI scripts use, then the application's
     own validation. Output contains variable names, sources and provider modes only.
  Exit code: 0 when both pass, 1 otherwise.

.PARAMETER Path
  Configuration file. Default: the machine CHAINSEABASE_CONFIG_FILE, else
  %ProgramData%\Chainseabase\config\chainseabase.env

.PARAMETER AllowedReader
  Additional accounts allowed on the file (e.g. the service account).

.PARAMETER AppDirectory
  Chainseabase app directory (default: two levels above this script).

.EXAMPLE
  .\scripts\windows\Test-ChainseabaseConfig.ps1
  echo "exit=$LASTEXITCODE"
#>
[CmdletBinding()]
param(
  [string]$Path,
  [string[]]$AllowedReader = @(),
  [string]$AppDirectory = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

if (-not $Path) { $Path = [Environment]::GetEnvironmentVariable('CHAINSEABASE_CONFIG_FILE', 'Machine') }
if (-not $Path) { $Path = Join-Path $env:ProgramData 'Chainseabase\config\chainseabase.env' }
$failures = New-Object System.Collections.Generic.List[string]

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Output "FAIL configuration file not found: $Path"
  exit 1
}

$allowedSids = @('S-1-5-18', 'S-1-5-32-544')   # SYSTEM, Administrators
foreach ($account in $AllowedReader) {
  $allowedSids += (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value
}

function Test-Acl([string]$Target, [string]$Label) {
  $acl = Get-Acl -LiteralPath $Target
  if (-not $acl.AreAccessRulesProtected) { $failures.Add("$Label inherits permissions from its parent") }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    if ($allowedSids -notcontains $rule.IdentityReference.Value) {
      $name = $rule.IdentityReference.Value
      try { $name = $rule.IdentityReference.Translate([Security.Principal.NTAccount]).Value } catch { }
      $failures.Add("$Label grants $($rule.FileSystemRights) to $name")
    }
  }
}

Test-Acl (Split-Path -Parent $Path) 'configuration directory'
Test-Acl $Path 'configuration file'
if ($failures.Count -eq 0) { Write-Output 'PASS NTFS ACL: only SYSTEM, Administrators and allowed readers have access' }
else { foreach ($f in $failures) { Write-Output "FAIL $f" } }

# same loader and validation as the website and CLI scripts; the path is set for the child only
$previous = $env:CHAINSEABASE_CONFIG_FILE
$env:CHAINSEABASE_CONFIG_FILE = $Path
Push-Location -LiteralPath $AppDirectory
try {
  $ErrorActionPreference = 'Continue'
  & npm.cmd run --silent config:check
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  $env:CHAINSEABASE_CONFIG_FILE = $previous
  $ErrorActionPreference = 'Stop'
}
if ($code -eq 0) { Write-Output 'PASS npm run config:check (exit 0)' }
else { Write-Output "FAIL npm run config:check (exit $code)"; $failures.Add('config:check') }

if ($failures.Count -gt 0) { exit 1 }
exit 0
