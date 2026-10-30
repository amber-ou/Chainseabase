<#
  WIN-03: BootReport counts a sign-in only for a person, and process owners are read without a race.
  Run on Windows as administrator (PowerShell 7 and 5.1): exit 0 when every case passes. ASCII only.
#>
Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'scripts\windows\ChainseabaseService.psm1') -Force

$failures = 0
function Case([string]$Name, [bool]$Ok) {
  if ($Ok) { Write-Output "PASS $Name" } else { Write-Output "FAIL $Name"; $script:failures++ }
}

# SID classes (structured, independent of the display language)
foreach ($c in @(
    @('S-1-5-21-1004336348-1177238915-682003330-1001', 'person'),
    @('S-1-12-1-1234567890-1234567890-1234567890-1234567890', 'person'),
    @('S-1-5-90-0-1', 'windows'), @('S-1-5-96-0-0', 'windows'), @('S-1-5-96-0-1', 'windows'),
    @('S-1-5-18', 'windows'), @('S-1-5-19', 'windows'), @('S-1-5-20', 'windows'),
    @('S-1-5-80-1904714016-2257161475-1914970682-2405687154-3837917288', 'windows'),
    @('S-1-5-7', 'unknown'), @('', 'unknown'))) {
  Case "SID '$($c[0])' is $($c[1])" ((Get-SidKind $c[0]) -eq $c[1])
}

# a boot like the host report: Windows' own sessions seconds after boot, the person minutes later
$boot = Get-Date '2026-10-30T14:02:19'
function S([int]$Seconds, [string]$Account, [string]$Sid) {
  [pscustomobject]@{ Time = $boot.AddSeconds($Seconds); LogonType = 2; LogonId = "$Seconds"; Account = $Account; Sid = $Sid; SessionIds = '1'; Source = 'test'; Kind = (Get-SidKind $Sid) }
}
$seq = @((S 10 'Font Driver Host\UMFD-0' 'S-1-5-96-0-0'), (S 11 'Font Driver Host\UMFD-1' 'S-1-5-96-0-1'), (S 11 'Window Manager\DWM-1' 'S-1-5-90-0-1'), (S 300 'PC\amber' 'S-1-5-21-1-2-3-1001'))
$old = @($seq | Where-Object { $_.LogonType -in @(2, 10, 11) } | Sort-Object Time | Select-Object -First 1)
Case 'regression: the old filter (LogonType only) took a Windows session 10 s after boot as the sign-in' ($old[0].Account -eq 'Font Driver Host\UMFD-0')
$first = Select-FirstPersonSignIn $seq
Case 'the first person sign-in is the user 5 minutes after boot, not DWM/UMFD' ($null -ne $first -and $first.Account -eq 'PC\amber')
Case 'only Windows sessions: no person signed in' ($null -eq (Select-FirstPersonSignIn @($seq[0], $seq[1], $seq[2])))
$unknown = Select-FirstPersonSignIn @($seq[0], (S 20 'X\y' 'S-1-5-7'), $seq[3])
Case 'an unidentified account counts as a sign-in (never a silent pass)' ($null -ne $unknown -and $unknown.Sid -eq 'S-1-5-7')
$noSid = Select-FirstPersonSignIn @($seq[0], (S 30 $null $null))
Case 'a session whose account cannot be read counts as a sign-in' ($null -ne $noSid -and $noSid.LogonId -eq '30')

# process owners: a process that exited after it was listed (the 0x80041002 race) gives $null ...
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$self = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
Case "owner of this PowerShell is $me" ((Get-ProcessOwner $self) -eq $me)
$ping = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\PING.EXE') -ArgumentList '-n', '2', '127.0.0.1' -WindowStyle Hidden -PassThru
$gone = Get-CimInstance Win32_Process -Filter "ProcessId=$($ping.Id)"
$ping.WaitForExit(); Start-Sleep -Seconds 1
$raised = $null; $owner = 'not called'
try { $owner = Get-ProcessOwner $gone } catch { $raised = $_ }
Case 'an exited process gives no owner instead of an error (0x80041002)' ($null -eq $raised -and $null -eq $owner)
# ... while any other failure is still raised
$raised = $null
try { [void](Get-ProcessOwner (Get-CimInstance Win32_OperatingSystem)) } catch { $raised = $_ }
Case 'a different GetOwner failure is raised, not ignored' ($null -ne $raised -and -not (Test-CimNotFound $raised))
$ping = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\PING.EXE') -ArgumentList '-n', '30', '127.0.0.1' -WindowStyle Hidden -PassThru
try { Case 'processes owned by an account are listed' (@(Get-ProcessesOwnedBy 'PING.EXE' $me | ForEach-Object ProcessId) -contains $ping.Id) }
finally { Stop-Process -Id $ping.Id -Force -ErrorAction SilentlyContinue }

# this machine's real sessions since boot: Windows' own are classified as such
$since = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$si = Get-InteractiveSignIns $since
foreach ($r in $si.SignIns) { Write-Output ("  {0}  {1,-7} LogonType {2} {3} {4} LogonId {5} session {6} [{7}]" -f $r.Time, $r.Kind, $r.LogonType, $r.Account, $r.Sid, $r.LogonId, $r.SessionIds, $r.Source) }
Case "Security log readable for logon events since boot$(if (-not $si.LogReadable) { ": $($si.LogError)" })" $si.LogReadable
$sys = @($si.SignIns | Where-Object { $_.Sid -like 'S-1-5-90-*' -or $_.Sid -like 'S-1-5-96-*' })
Case "the $($sys.Count) DWM/UMFD session(s) since boot are classified as Windows" (@($sys | Where-Object Kind -ne 'windows').Count -eq 0)
Case 'every listed session is interactive, remote or cached (2, 10, 11, 12)' (@($si.SignIns | Where-Object { $_.LogonType -notin @(2, 10, 11, 12) }).Count -eq 0)
$auto = Get-AutomaticSignInSettings
Write-Output "  automatic sign-in settings: AutoAdminLogon $($auto.AutoAdminLogon), ARSO policy off $($auto.ArsoDisabledByPolicy), ARSO entries $($auto.ArsoBySid.Count)"

if ($failures -gt 0) { Write-Output "$failures case(s) failed"; exit 1 }
Write-Output 'All boot report and process owner cases passed'
exit 0
