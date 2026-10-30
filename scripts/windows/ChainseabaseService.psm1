<#
  WIN-03 shared helpers for the Chainseabase Windows service scripts (Install/Update/Set-State/
  Uninstall/Test). Windows PowerShell 5.1 and PowerShell 7. Prints paths and names only, never
  configuration values.

  Layout (program and data are separate; uninstall never touches data, secrets or backups):
    <ProgramRoot>\releases\<id>\     one built copy of the app per release (read-only for the service)
    <ProgramRoot>\service\           WinSW wrapper (<Name>.exe), its XML and install.json
    <LogRoot>\                       service logs (the service account may write)
    config file / avatar root       from WIN-01 / WIN-02 (service account: read / modify)
#>

Set-StrictMode -Version 3.0

# WinSW v2.12.0 (stable line), x64 self-contained build. SHA-256 recorded from the official GitHub
# release download; every install verifies size and hash before the file is used.
$script:WinSW = @{
  Version = '2.12.0'
  Url     = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
  Sha256  = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'
  Size    = 18243033
}
function Get-WinSWPin { return $script:WinSW.Clone() }

$script:SidSystem = 'S-1-5-18'
$script:SidAdmins = 'S-1-5-32-544'

function Invoke-Native {
  # native tools write to stderr on success too; never let that become a terminating error
  param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
    try { $out = & $FilePath @Arguments 2>&1 | ForEach-Object { "$_" } } finally { if ($WorkingDirectory) { Pop-Location } }
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = @($out) }
  } finally { $ErrorActionPreference = $previous }
}

function Resolve-AppDirectory([string]$AppDirectory, [string]$ScriptRoot) {
  if (-not $AppDirectory) {
    if ($ScriptRoot) { $AppDirectory = Split-Path -Parent (Split-Path -Parent $ScriptRoot) }
    else { $AppDirectory = (Get-Location).ProviderPath }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory 'scripts\service\start-website.mjs'))) {
    throw "Not a Chainseabase source directory: $AppDirectory (pass -Source <app directory>)"
  }
  return (Resolve-Path -LiteralPath $AppDirectory).ProviderPath
}

function Get-ChainseabasePaths([string]$ProgramRoot, [string]$ServiceName, [string]$LogRoot) {
  $serviceDir = Join-Path $ProgramRoot 'service'
  return [pscustomobject]@{
    ProgramRoot = $ProgramRoot
    Releases    = Join-Path $ProgramRoot 'releases'
    ServiceDir  = $serviceDir
    WinSWExe    = Join-Path $serviceDir "$ServiceName.exe"
    Xml         = Join-Path $serviceDir "$ServiceName.xml"
    InstallJson = Join-Path $serviceDir 'install.json'
    History     = Join-Path $serviceDir 'releases.log'
    Logs        = $LogRoot
  }
}

function Get-DefaultConfigFile {
  $p = [Environment]::GetEnvironmentVariable('CHAINSEABASE_CONFIG_FILE', 'Machine')
  if (-not $p) { $p = Join-Path $env:ProgramData 'Chainseabase\config\chainseabase.env' }
  return $p
}

function Get-ConfigValue([string]$ConfigFile, [string]$Name) {
  # one non-secret value by name (paths and modes only)
  foreach ($line in [IO.File]::ReadAllLines($ConfigFile)) {
    $t = $line.TrimStart([char]0xFEFF).Trim()
    if ($t -match "^$Name\s*=\s*(.*)$") { return $Matches[1].Trim().Trim('"', "'") }
  }
  return $null
}

function Install-WinSWBinary([string]$Destination, [string]$SourceFile) {
  $pin = $script:WinSW
  if (Test-Path -LiteralPath $Destination) {
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $pin.Sha256) { return 'kept' }
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("winsw-" + [guid]::NewGuid().ToString('N') + '.exe')
  try {
    if ($SourceFile) { Copy-Item -LiteralPath $SourceFile -Destination $tmp }
    else {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
      try { Invoke-WebRequest -Uri $pin.Url -OutFile $tmp -UseBasicParsing } finally { $ProgressPreference = $old }
    }
    $size = (Get-Item -LiteralPath $tmp).Length
    $hash = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash
    if ($size -ne $pin.Size -or $hash -ne $pin.Sha256) {
      throw "WinSW $($pin.Version) verification failed (size $size, SHA-256 $hash); expected $($pin.Size) / $($pin.Sha256). Not installed."
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Move-Item -LiteralPath $tmp -Destination $Destination -Force
    return 'installed'
  } finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
}

function Get-ServiceSid([string]$ServiceName) {
  # the virtual account NT SERVICE\<name> exists once the service does
  return (New-Object Security.Principal.NTAccount("NT SERVICE\$ServiceName")).Translate([Security.Principal.SecurityIdentifier]).Value
}

function Set-ProtectedAcl([string]$Path, [hashtable]$Grants) {
  # replace the ACL: no inheritance from the parent; SYSTEM and Administrators full control,
  # plus the given SID => rights (applied to the folder, subfolders and files)
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $prop = [Security.AccessControl.PropagationFlags]::None
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($script:SidAdmins)))
  foreach ($sid in @($script:SidSystem, $script:SidAdmins)) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', $inherit, $prop, $allow)))
  }
  foreach ($sid in $Grants.Keys) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), [Security.AccessControl.FileSystemRights]$Grants[$sid], $inherit, $prop, $allow)))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Add-PathAccess([string]$Path, [string]$Sid, [string]$Rights, [switch]$ThisFolderOnly) {
  # add one allow rule to an existing (already protected) ACL, keeping everything else.
  # -ThisFolderOnly: the folder itself (list/traverse), not the files already in it
  $item = Get-Item -LiteralPath $Path
  $acl = Get-Acl -LiteralPath $Path
  $id = New-Object Security.Principal.SecurityIdentifier($Sid)
  if ($item.PSIsContainer -and -not $ThisFolderOnly) { $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { $inherit = [Security.AccessControl.InheritanceFlags]::None }
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($id, [Security.AccessControl.FileSystemRights]$Rights, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.PurgeAccessRules($id)
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Remove-PathAccess([string]$Path, [string]$Sid) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $acl = Get-Acl -LiteralPath $Path
  $acl.PurgeAccessRules((New-Object Security.Principal.SecurityIdentifier($Sid)))
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-PathRights([string]$Path, [string]$Sid) {
  # rights explicitly or inherited granted to one SID (allow rules only)
  $rights = [Security.AccessControl.FileSystemRights]0
  foreach ($r in (Get-Acl -LiteralPath $Path).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -eq $Sid) { $rights = $rights -bor $r.FileSystemRights }
  }
  return $rights
}

function Test-CanWrite([Security.AccessControl.FileSystemRights]$Rights) {
  $write = [Security.AccessControl.FileSystemRights]'WriteData, AppendData, Delete, ChangePermissions, TakeOwnership'
  return [bool]($Rights -band $write)
}

function New-ChainseabaseRelease([string]$Source, [string]$Releases) {
  $commit = (Invoke-Native git @('-C', $Source, 'rev-parse', '--short=7', 'HEAD')).Output | Select-Object -First 1
  if (-not $commit -or $commit -notmatch '^[0-9a-f]{7}$') { $commit = 'nogit' }
  $id = (Get-Date).ToString('yyyyMMdd-HHmmss') + "-$commit"
  $dir = Join-Path $Releases $id
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  # program files only: no dependencies, builds, git data, local data or .env* files
  $rc = Invoke-Native robocopy.exe @($Source, $dir, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XD', (Join-Path $Source 'node_modules'), (Join-Path $Source '.next'), (Join-Path $Source '.git'), (Join-Path $Source '.data'),
    (Join-Path $Source 'test-results'), (Join-Path $Source 'playwright-report'), '/XF', '.env*')
  if ($rc.ExitCode -ge 8) { throw "copying the source failed (robocopy $($rc.ExitCode))" }
  $npmVersion = ((Invoke-Native npm.cmd @('--version')).Output | Select-Object -First 1)
  if ($npmVersion -like '10.*') { $npm = 'npm.cmd'; $ciArgs = @('ci', '--no-audit', '--no-fund') }
  else { $npm = 'npx.cmd'; $ciArgs = @('--yes', 'npm@10.9.4', 'ci', '--no-audit', '--no-fund') }
  $r = Invoke-Native $npm $ciArgs $dir
  if ($r.ExitCode -ne 0) { $r.Output | Select-Object -Last 20 | Write-Output; throw "npm ci failed in $dir (exit $($r.ExitCode))" }
  $r = Invoke-Native npm.cmd @('run', 'build') $dir
  if ($r.ExitCode -ne 0) { $r.Output | Select-Object -Last 30 | Write-Output; throw "npm run build failed in $dir (exit $($r.ExitCode))" }
  [IO.File]::WriteAllText((Join-Path $dir 'release.json'), (@{ id = $id; commit = $commit; createdAt = (Get-Date).ToString('o'); npm = $npmVersion } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  return $dir
}

function Test-ReleaseDirectory([string]$Dir) {
  foreach ($p in @('package.json', '.next\BUILD_ID', 'node_modules\next\dist\bin\next', 'scripts\service\start-website.mjs', 'scripts\config\load-config.mjs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Dir $p))) { return "missing $p" }
  }
  return $null
}

function Protect-Release([string]$Dir, [string]$ServiceSid) {
  # the service reads and runs the release; only .next\cache is writable for it
  Set-ProtectedAcl $Dir @{ $ServiceSid = 'ReadAndExecute' }
  $cache = Join-Path $Dir '.next\cache'
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  Add-PathAccess $cache $ServiceSid 'Modify'
}

function ConvertTo-XmlText([string]$Value) { return [Security.SecurityElement]::Escape($Value) }

function Write-ServiceXml($Paths, [string]$ServiceName, [string]$Release, $Settings) {
  $e = { param($v) ConvertTo-XmlText ([string]$v) }
  $entry = Join-Path $Release 'scripts\service\start-website.mjs'
  $events = Join-Path $Paths.Logs "$ServiceName.events.log"
  $xml = @"
<!-- Chainseabase website service (WIN-03). Generated by Install/Update-ChainseabaseService.ps1; edits are overwritten. -->
<service>
  <id>$(& $e $ServiceName)</id>
  <name>Chainseabase website ($(& $e $ServiceName))</name>
  <description>Chainseabase Next.js website on 127.0.0.1:$($Settings.Port) (WIN-03)</description>
  <executable>$(& $e $Settings.NodePath)</executable>
  <arguments>"$(& $e $entry)" --port=$($Settings.Port) --db-wait-seconds=$($Settings.DbWaitSeconds) --exit-with-parent "--event-log=$(& $e $events)"</arguments>
  <workingdirectory>$(& $e $Release)</workingdirectory>
  <env name="CHAINSEABASE_CONFIG_FILE" value="$(& $e $Settings.ConfigFile)"/>
  <env name="NODE_ENV" value="production"/>
  <env name="NEXT_TELEMETRY_DISABLED" value="1"/>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <depend>$(& $e $Settings.PostgresService)</depend>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>20 sec</stoptimeout>
  <stopparentprocessfirst>true</stopparentprocessfirst>
  <logpath>$(& $e $Paths.Logs)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>$($Settings.LogSizeKB)</sizeThreshold>
    <keepFiles>$($Settings.LogKeepFiles)</keepFiles>
  </log>
</service>
"@
  [IO.File]::WriteAllText($Paths.Xml, $xml, (New-Object Text.UTF8Encoding($false)))
}

function Get-CurrentRelease($Paths) {
  if (-not (Test-Path -LiteralPath $Paths.Xml)) { return $null }
  [xml]$x = [IO.File]::ReadAllText($Paths.Xml)
  return [string]$x.service.workingdirectory
}

function Get-RecoveryPolicy {
  # the one definition of the recovery actions: applied at install, checked by Test-ChainseabaseService
  [pscustomobject]@{ ResetSeconds = 3600; DelaysMs = @(10000, 30000, 60000) }
}

function ConvertFrom-FailureActions([byte[]]$Bytes) {
  # SERVICE_FAILURE_ACTIONS as the service manager stores it (registry value FailureActions):
  # reset period in seconds, two unused pointer slots, action count, one unused pointer slot (4 bytes
  # each), then per action its type (0 none, 1 restart, 2 reboot, 3 run command) and delay in ms.
  # Numbers, not sc.exe display text, so the result does not depend on the display language.
  # $null for a missing value or any other layout (the check then fails, it does not pass).
  if ($null -eq $Bytes -or $Bytes.Length -lt 20) { return $null }
  $count = [BitConverter]::ToUInt32($Bytes, 12)
  if ($count -gt 64 -or $Bytes.Length -ne 20 + 8 * $count) { return $null }
  $actions = @(for ($i = 0; $i -lt $count; $i++) {
      [pscustomobject]@{ Type = [BitConverter]::ToUInt32($Bytes, 20 + 8 * $i); DelayMs = [BitConverter]::ToUInt32($Bytes, 24 + 8 * $i) } })
  [pscustomobject]@{ ResetSeconds = [BitConverter]::ToUInt32($Bytes, 0); Actions = $actions }
}

function Get-RecoveryProblems($Recovery, $NonCrashFlag) {
  # differences from Get-RecoveryPolicy, as messages; none means the recovery is configured as installed
  $policy = Get-RecoveryPolicy
  if ($null -eq $Recovery) { return @('failure actions missing or in an unrecognised layout') }
  $problems = @()
  if ($Recovery.ResetSeconds -ne $policy.ResetSeconds) { $problems += "failure counter reset after $($Recovery.ResetSeconds) s (expected $($policy.ResetSeconds) s)" }
  if ($Recovery.Actions.Count -ne $policy.DelaysMs.Count) { $problems += "$($Recovery.Actions.Count) failure actions (expected $($policy.DelaysMs.Count))" }
  for ($i = 0; $i -lt [Math]::Min($Recovery.Actions.Count, $policy.DelaysMs.Count); $i++) {
    $a = $Recovery.Actions[$i]
    if ($a.Type -ne 1) { $problems += "failure $($i + 1): action type $($a.Type), not restart (1)" }
    if ($a.DelayMs -ne $policy.DelaysMs[$i]) { $problems += "failure $($i + 1): restart after $($a.DelayMs) ms (expected $($policy.DelaysMs[$i]) ms)" }
  }
  if ($NonCrashFlag -ne 1) { $problems += "not applied when the process exits with an error (FailureActionsOnNonCrashFailures: $(if ($null -eq $NonCrashFlag) { 'missing' } else { $NonCrashFlag }), expected 1)" }
  return $problems
}

function Format-Recovery($Recovery, $NonCrashFlag) {
  if ($null -eq $Recovery) { return 'unreadable' }
  $kinds = @{ 0 = 'none'; 1 = 'restart'; 2 = 'reboot'; 3 = 'command' }
  $steps = @($Recovery.Actions | ForEach-Object { "$(if ($kinds.ContainsKey([int]$_.Type)) { $kinds[[int]$_.Type] } else { "type $($_.Type)" }) $($_.DelayMs) ms" })
  return "reset $($Recovery.ResetSeconds) s; $($steps -join ', '); on error exit: $NonCrashFlag"
}

function Get-ServiceRecovery([string]$ServiceName) {
  # read from the service's registry key, where the service manager keeps its configuration
  $item = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -ErrorAction Stop
  $bytes = $null; $flag = $null
  if ($item.PSObject.Properties['FailureActions']) { $bytes = [byte[]]$item.FailureActions }
  if ($item.PSObject.Properties['FailureActionsOnNonCrashFailures']) { $flag = [int]$item.FailureActionsOnNonCrashFailures }
  [pscustomobject]@{ Recovery = (ConvertFrom-FailureActions $bytes); NonCrashFlag = $flag; Length = $(if ($bytes) { $bytes.Length } else { 0 }) }
}

function Get-LocalAdministratorSids([ValidateSet('Auto', 'Adsi')][string]$Method = 'Auto') {
  # member SIDs of the local Administrators group (S-1-5-32-544), never display text. Get-LocalGroupMember
  # fails when the group holds an unresolvable member; ADSI reads the SIDs directly. Throws if neither works.
  if ($Method -eq 'Auto') {
    try { return @(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop | ForEach-Object { $_.SID.Value }) } catch { }
  }
  $group = (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
  $adsi = [ADSI]"WinNT://$env:COMPUTERNAME/$group,group"
  return @($adsi.Invoke('Members') | ForEach-Object {
      $raw = [byte[]]$_.GetType().InvokeMember('objectSid', 'GetProperty', $null, $_, $null)
      (New-Object Security.Principal.SecurityIdentifier($raw, 0)).Value })
}

function Set-ServiceRegistration([string]$ServiceName, [string]$PostgresService) {
  # account, start type, dependency and recovery, applied explicitly (idempotent)
  $sc = "$env:SystemRoot\System32\sc.exe"
  $policy = Get-RecoveryPolicy
  $actions = (@($policy.DelaysMs | ForEach-Object { "restart/$_" })) -join '/'
  foreach ($a in @(
      @('config', $ServiceName, 'obj=', "NT SERVICE\$ServiceName", 'start=', 'delayed-auto', 'depend=', $PostgresService),
      @('failure', $ServiceName, 'reset=', "$($policy.ResetSeconds)", 'actions=', $actions),
      @('failureflag', $ServiceName, '1'),
      @('sidtype', $ServiceName, 'unrestricted'))) {
    $r = Invoke-Native $sc $a
    if ($r.ExitCode -ne 0) { throw "sc.exe $($a[0]) failed ($($r.ExitCode)): $($r.Output -join ' ')" }
  }
}

function Wait-Healthy([int]$Port, [int]$TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/health" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Stop-ChainseabaseService([string]$ServiceName, [int]$Port, [int]$TimeoutSec = 90) {
  # a failing release is restarted by the recovery actions, so a stop request can arrive while the
  # service is starting or stopping, when it cannot accept controls (Stop-Service then fails). Retry
  # until it is stopped and the port is free; a stop issued during a recovery restart is re-issued.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $s = Get-Service -Name $ServiceName
    if ($s.Status -eq 'Stopped') {
      if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { return $true }
    } elseif ($s.Status -in @('Running', 'Paused')) {
      try { $s.Stop() } catch { }
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Get-WebsiteProcess([string]$ServiceName) {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  if (-not $svc -or -not $svc.ProcessId) { return $null }
  return Get-CimInstance Win32_Process -Filter "ParentProcessId=$($svc.ProcessId) AND Name='node.exe'" | Select-Object -First 1
}

function Test-CimNotFound($ErrorRecord) {
  # WBEM_E_NOT_FOUND (0x80041002): the instance, here a process, no longer exists
  if ("$($ErrorRecord.FullyQualifiedErrorId)" -like 'HRESULT 0x80041002*') { return $true }
  $e = $ErrorRecord.Exception
  while ($e) {
    if ($e.GetType().FullName -eq 'Microsoft.Management.Infrastructure.CimException' -and "$($e.NativeErrorCode)" -eq 'NotFound') { return $true }
    $e = $e.InnerException
  }
  return $false
}

function Get-ProcessOwner($Process) {
  # DOMAIN\user of a Win32_Process; $null only when the process exited after it was listed.
  # Every other failure (access denied, GetOwner returning an error) is thrown for the caller to report.
  try { $r = Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop }
  catch { if (Test-CimNotFound $_) { return $null }; throw }
  if ($r.ReturnValue -ne 0) { throw "GetOwner for process $($Process.ProcessId) returned $($r.ReturnValue)" }
  return "$($r.Domain)\$($r.User)"
}

function Get-ProcessesOwnedBy([string]$Name, [string]$Account, [int]$Attempts = 3) {
  # processes named $Name running as $Account. A process that exits between the listing and the owner
  # lookup leaves the sample incomplete: take a new one, at most $Attempts times, then throw.
  for ($i = 1; $i -le $Attempts; $i++) {
    $owned = @(); $vanished = 0
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='$Name'")) {
      $o = Get-ProcessOwner $p
      if ($null -eq $o) { $vanished++ } elseif ($o -eq $Account) { $owned += $p }
    }
    if ($vanished -eq 0) { return $owned }
    Start-Sleep -Milliseconds 500
  }
  throw "$Name processes kept exiting while their owners were read ($Attempts samples)"
}

function Get-WebsiteProcessOwner([string]$ServiceName, [int]$Attempts = 3) {
  # the website process and its owner; $null when the service runs no website process
  for ($i = 1; $i -le $Attempts; $i++) {
    $p = Get-WebsiteProcess $ServiceName
    if (-not $p) { return $null }
    $o = Get-ProcessOwner $p
    if ($null -ne $o) { return [pscustomobject]@{ Process = $p; Owner = $o } }
    Start-Sleep -Milliseconds 500
  }
  throw "the website process kept exiting while its owner was read ($Attempts samples)"
}

function Get-SidKind([string]$Sid) {
  # person: local and domain accounts (S-1-5-21-...) and Microsoft Entra ID accounts (S-1-12-1-...).
  # windows: Window Manager DWM-n (S-1-5-90-...) and Font Driver Host UMFD-n (S-1-5-96-...), which start
  # interactive (type 2) logon sessions at every boot, SYSTEM, LOCAL/NETWORK SERVICE and service SIDs.
  # Anything else is unknown and is treated like a person: it can never turn the boot check into a pass.
  if (-not $Sid) { return 'unknown' }
  if ($Sid -like 'S-1-5-21-*' -or $Sid -like 'S-1-12-1-*') { return 'person' }
  if ($Sid -like 'S-1-5-90-*' -or $Sid -like 'S-1-5-96-*' -or $Sid -like 'S-1-5-80-*' -or $Sid -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) { return 'windows' }
  return 'unknown'
}

function Get-InteractiveSignIns([datetime]$Since) {
  # interactive (2), remote desktop (10) and cached (11, 12) sign-ins since $Since, from the logon
  # sessions that still exist (account, SID, Windows session IDs) and from the Security log (event 4624,
  # which also keeps sessions that ended). Read as SIDs and numbers, never as translated display text.
  $types = @(2, 10, 11, 12)
  $records = @{}
  $accounts = @{}
  foreach ($l in @(Get-CimInstance Win32_LoggedOnUser -ErrorAction SilentlyContinue)) { $accounts["$($l.Dependent.LogonId)"] = "$($l.Antecedent.Domain)\$($l.Antecedent.Name)" }
  foreach ($s in @(Get-CimInstance Win32_LogonSession | Where-Object { $_.LogonType -in $types -and $_.StartTime -ge $Since })) {
    $id = "$($s.LogonId)"
    $account = $null; $sid = $null
    if ($accounts.ContainsKey($id)) { $account = $accounts[$id] }
    if ($account) { try { $sid = (New-Object Security.Principal.NTAccount($account)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { } }
    $sessions = @(Get-CimAssociatedInstance -InputObject $s -ResultClassName Win32_Process -ErrorAction SilentlyContinue | ForEach-Object { $_.SessionId } | Sort-Object -Unique)
    $records[$id] = [pscustomobject]@{ Time = $s.StartTime; LogonType = [int]$s.LogonType; LogonId = $id; Account = $account; Sid = $sid; SessionIds = ($sessions -join ','); Source = 'session'; Kind = $null }
  }
  $logReadable = $true; $logError = $null; $events = @()
  $from = $Since.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $typeFilter = ($types | ForEach-Object { "Data[@Name='LogonType']='$_'" }) -join ' or '
  try { $events = @(Get-WinEvent -LogName Security -FilterXPath "*[System[EventID=4624 and TimeCreated[@SystemTime>='$from']]] and *[EventData[$typeFilter]]" -ErrorAction Stop) }
  catch { if ("$($_.FullyQualifiedErrorId)" -notlike 'NoMatchingEventsFound*') { $logReadable = $false; $logError = $_.Exception.Message } }
  foreach ($e in $events) {
    $d = @{}
    foreach ($n in @(([xml]$e.ToXml()).Event.EventData.Data)) { $d[$n.GetAttribute('Name')] = $n.InnerText }
    if (-not $d['TargetLogonId']) { continue }
    $id = "$([Convert]::ToUInt64(($d['TargetLogonId'] -replace '^0x', ''), 16))"
    if ($records.ContainsKey($id)) {
      $r = $records[$id]
      if (-not $r.Sid) { $r.Sid = $d['TargetUserSid'] }
      $r.Source = 'session+log'
      continue
    }
    $records[$id] = [pscustomobject]@{ Time = $e.TimeCreated; LogonType = [int]$d['LogonType']; LogonId = $id; Account = "$($d['TargetDomainName'])\$($d['TargetUserName'])"; Sid = $d['TargetUserSid']; SessionIds = ''; Source = 'log'; Kind = $null }
  }
  foreach ($r in $records.Values) { $r.Kind = Get-SidKind $r.Sid }
  [pscustomobject]@{ SignIns = @($records.Values | Sort-Object Time); LogReadable = $logReadable; LogError = $logError }
}

function Select-FirstPersonSignIn($SignIns) {
  # the earliest sign-in that is not Windows itself (a person, or an account that cannot be identified)
  return @($SignIns | Where-Object { $_.Kind -ne 'windows' } | Sort-Object Time) | Select-Object -First 1
}

function Get-AutomaticSignInSettings {
  # read only, and never the stored password: whether Windows signs a user in by itself
  # (Winlogon AutoAdminLogon, or automatic restart sign-on, ARSO, for which an opt-out is kept per SID)
  $w = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
  $auto = $false; $user = $null
  if ($w -and $w.PSObject.Properties['AutoAdminLogon']) { $auto = ("$($w.AutoAdminLogon)" -eq '1') }
  if ($w -and $w.PSObject.Properties['DefaultUserName']) { $user = "$($w.DefaultUserName)" }
  $policy = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction SilentlyContinue
  $arsoPolicyOff = [bool]($policy -and $policy.PSObject.Properties['DisableAutomaticRestartSignOn'] -and "$($policy.DisableAutomaticRestartSignOn)" -eq '1')
  $arso = @{}
  $key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\UserARSO'
  if (Test-Path -LiteralPath $key) {
    foreach ($k in @(Get-ChildItem -LiteralPath $key)) {
      $p = Get-ItemProperty -LiteralPath $k.PSPath
      $arso[$k.PSChildName] = $(if ($p.PSObject.Properties['OptOut']) { "OptOut=$($p.OptOut)" } else { 'no OptOut value' })
    }
  }
  [pscustomobject]@{ AutoAdminLogon = $auto; DefaultUserName = $user; ArsoDisabledByPolicy = $arsoPolicyOff; ArsoBySid = $arso }
}

function Read-SharedText([string]$Path) {
  # read a log the service is still writing
  $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite, Delete')
  try { $sr = New-Object IO.StreamReader($fs); return $sr.ReadToEnd() } finally { $fs.Dispose() }
}

Export-ModuleMember -Function *
