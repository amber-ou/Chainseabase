<#
.SYNOPSIS
  WIN-01: set, replace or remove one value in the protected configuration file.

.DESCRIPTION
  Prompts for the value as a SecureString (not echoed, not stored in PowerShell history),
  writes it into the existing file in place (the file keeps its NTFS ACL) and prints the
  variable name only. Restart the website service / scheduled tasks after rotating a secret.

.PARAMETER Name
  Variable name, e.g. GOOGLE_CLIENT_SECRET or PGPASSWORD.

.PARAMETER Path
  Configuration file. Default: the machine CHAINSEABASE_CONFIG_FILE, else
  %ProgramData%\Chainseabase\config\chainseabase.env

.PARAMETER Value
  SecureString for automation; omit to be prompted.

.PARAMETER Remove
  Remove the variable instead of setting it.

.EXAMPLE
  .\scripts\windows\Set-ChainseabaseConfigValue.ps1 -Name PGPASSWORD
  echo "exit=$LASTEXITCODE"
#>
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Z][A-Z0-9_]*$')][string]$Name,
  [string]$Path,
  [securestring]$Value,
  [switch]$Remove
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

if (-not $Path) { $Path = [Environment]::GetEnvironmentVariable('CHAINSEABASE_CONFIG_FILE', 'Machine') }
if (-not $Path) { $Path = Join-Path $env:ProgramData 'Chainseabase\config\chainseabase.env' }
if (-not (Test-Path -LiteralPath $Path)) { throw 'Configuration file not found: run New-ChainseabaseConfig.ps1 first.' }

$lines = New-Object System.Collections.Generic.List[string]
$raw = @([IO.File]::ReadAllLines($Path))
if ($raw.Count -gt 0) { $raw[0] = $raw[0].TrimStart([char]0xFEFF) }
foreach ($l in $raw) { $lines.Add($l) }
$matchIndexes = @(for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -match "^$Name\s*=") { $i } })
if ($matchIndexes.Count -gt 1) { throw "$Name appears more than once in the configuration file; fix it first." }

if ($Remove) {
  if ($matchIndexes.Count -eq 0) { Write-Output "$Name was not set"; exit 0 }
  $lines.RemoveAt($matchIndexes[0])
  $action = 'removed'
} else {
  if (-not $Value) { $Value = Read-Host -AsSecureString -Prompt "Value for $Name (input hidden)" }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "Empty value: use -Remove to unset $Name." }
  if ($plain -match "[`r`n]") { throw 'The value must be a single line.' }
  $entry = "$Name=$plain"
  if ($matchIndexes.Count -eq 1) { $lines[$matchIndexes[0]] = $entry; $action = 'replaced' } else { $lines.Add($entry); $action = 'added' }
  $plain = $null; $entry = $null
}

# write in place: the existing file keeps its protected ACL
[IO.File]::WriteAllText($Path, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
$lines.Clear()
Write-Output "$Name $action in $Path. Restart the website service and scheduled tasks to use it."
exit 0
