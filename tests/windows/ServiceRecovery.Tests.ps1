<#
  WIN-03: the recovery check reads the service manager's numbers, not sc.exe display text.
  Run on Windows (PowerShell 7 and 5.1): exit 0 when every case passes. Kept ASCII so 5.1 reads it
  the same under any code page; the zh-TW sample below is built from \u escapes.
#>
Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'scripts\windows\ChainseabaseService.psm1') -Force

$failures = 0
function Case([string]$Name, [bool]$Ok) {
  if ($Ok) { Write-Output "PASS $Name" } else { Write-Output "FAIL $Name"; $script:failures++ }
}
# the registry layout of SERVICE_FAILURE_ACTIONS: reset, 2 unused, count, 1 unused, then type/delay pairs
function New-FailureActions([uint32]$Reset, [object[]]$Actions) {
  $b = New-Object System.Collections.Generic.List[byte]
  foreach ($v in @($Reset, 0, 0, [uint32]$Actions.Count, 0)) { $b.AddRange([BitConverter]::GetBytes([uint32]$v)) }
  foreach ($a in $Actions) { $b.AddRange([BitConverter]::GetBytes([uint32]$a[0])); $b.AddRange([BitConverter]::GetBytes([uint32]$a[1])) }
  return , $b.ToArray()
}
function Problems([byte[]]$Bytes, $Flag) { @(Get-RecoveryProblems (ConvertFrom-FailureActions $Bytes) $Flag) }

$good = New-FailureActions 3600 @(@(1, 10000), @(1, 30000), @(1, 60000))
$p = Problems $good 1
Case 'installed policy (reset 3600 s; restart 10/30/60 s; on error exit) has no problems' ($p.Count -eq 0)
$r = ConvertFrom-FailureActions $good
Case 'decoded values' ($r.ResetSeconds -eq 3600 -and $r.Actions.Count -eq 3 -and $r.Actions[2].Type -eq 1 -and $r.Actions[2].DelayMs -eq 60000)

# counterexamples: each wrong setting is reported, none passes
Case 'reset period 60 s is reported' ((Problems (New-FailureActions 60 @(@(1, 10000), @(1, 30000), @(1, 60000))) 1) -match 'reset after 60 s')
Case 'a different delay is reported' ((Problems (New-FailureActions 3600 @(@(1, 5000), @(1, 30000), @(1, 60000))) 1) -match 'failure 1: restart after 5000 ms')
Case 'two actions instead of three are reported' ((Problems (New-FailureActions 3600 @(@(1, 10000), @(1, 30000))) 1) -match '2 failure actions')
Case 'no actions at all are reported' ((Problems (New-FailureActions 3600 @()) 1) -match '0 failure actions')
Case '"take no action" on the 3rd failure is reported' ((Problems (New-FailureActions 3600 @(@(1, 10000), @(1, 30000), @(0, 0))) 1) -match 'failure 3: action type 0')
Case 'reboot instead of restart is reported' ((Problems (New-FailureActions 3600 @(@(2, 10000), @(1, 30000), @(1, 60000))) 1) -match 'failure 1: action type 2')
Case 'not applied on an error exit (flag 0) is reported' ((Problems $good 0) -match 'FailureActionsOnNonCrashFailures: 0')
Case 'flag missing is reported' ((Problems $good $null) -match 'FailureActionsOnNonCrashFailures: missing')
Case 'value missing is reported, not passed' ((Problems $null 1) -match 'missing or in an unrecognised layout')
Case 'truncated value is reported, not passed' ((Problems ($good[0..30]) 1) -match 'unrecognised layout')
Case 'count larger than the data is reported, not passed' ((Problems ([byte[]](@(16, 14, 0, 0) + (, 0 * 8) + @(9, 0, 0, 0) + (, 0 * 4))) 1) -match 'unrecognised layout')

# the zh-TW host case: sc.exe qfailure translates its labels, which the old text check misread
$zh = [regex]::Unescape("RESET_PERIOD (單位: 秒) : 3600`nFAILURE_ACTIONS : RESTART -- 延遲 = 10000 毫秒。")
Case 'regression: the old text pattern misreads the zh-TW output of a correct setting' (-not ($zh -match 'RESET_PERIOD[^:]*:\s*3600'))
$testScript = Get-Content -Raw (Join-Path $root 'scripts\windows\Test-ChainseabaseService.ps1')
Case 'Test-ChainseabaseService does not parse sc.exe qfailure/qfailureflag or net.exe output' (-not ($testScript -match "'qfailure|'qfailureflag|net\.exe"))

# Administrators membership: the ADSI fallback reads the same SIDs as Get-LocalGroupMember
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$adsi = @(Get-LocalAdministratorSids -Method Adsi)
Case "ADSI fallback lists the current administrator ($me)" ($adsi -contains $me)
$lgm = $null
try { $lgm = @(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | ForEach-Object { $_.SID.Value }) } catch { Write-Output "note: Get-LocalGroupMember unavailable here ($($_.Exception.Message))" }
if ($null -ne $lgm) { Case 'ADSI fallback and Get-LocalGroupMember agree' (-not (Compare-Object ($adsi | Sort-Object) ($lgm | Sort-Object))) }
Case 'a virtual service account SID is not reported as an administrator' (-not ($adsi -contains 'S-1-5-80-0'))

if ($failures -gt 0) { Write-Output "$failures case(s) failed"; exit 1 }
Write-Output 'All recovery and membership cases passed'
exit 0
