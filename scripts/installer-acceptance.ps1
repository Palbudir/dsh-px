# Real installer acceptance for DSH-PX Desktop on a disposable Windows runner.
#
# Installs the currently published Desktop, upgrades it silently with the candidate exactly as the in-app
# updater does (--updated /S), then injects the two failures users met: a missing install registration and a
# client that is still running. Each failure must exit with code 2, record the installer's reason in the
# trace and leave the installed program usable. Never run this on a workstation: it installs per-user into
# the default location and rewrites this application's HKCU registration.
param(
  [Parameter(Mandatory)][string]$Candidate,
  [Parameter(Mandatory)][string]$CandidateVersion,
  [Parameter(Mandatory)][string]$Previous,
  [Parameter(Mandatory)][string]$PreviousVersion,
  [Parameter(Mandatory)][string]$Guid
)
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Installer acceptance only runs on disposable CI runners; it rewrites this application''s per-user registration.'
}
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\DSH-PX Desktop'
$exe = Join-Path $installDir 'DSH-PX Desktop.exe'
$installKey = "HKCU:\Software\$Guid"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Guid"
$logs = Join-Path $env:LOCALAPPDATA 'dsh-px-desktop-updater\installer-logs'
if (Test-Path $installDir) { throw "Runner already has $installDir" }

function Invoke-Installer([string]$File, [string[]]$Arguments, [int]$TimeoutSeconds = 900) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  # Holding the handle keeps ExitCode readable after the process ends.
  $null = $process.Handle
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill()
    throw "Installer did not finish within $TimeoutSeconds s: $File $Arguments"
  }
  return $process.ExitCode
}
function Get-LastRun([string]$Version) {
  $path = Join-Path $logs "install-$Version.log"
  if (-not (Test-Path $path)) { throw "Missing installer trace $path" }
  $rows = @(Get-Content $path | ForEach-Object {
      if ($_ -match '^pid=(\d+) stage=([\w-]+)(?: reason=(.*))?') { [pscustomobject]@{ Pid = $Matches[1]; Stage = $Matches[2]; Reason = "$($Matches[3])".Trim() } }
    })
  if (-not $rows.Count) { throw "Empty installer trace $path" }
  $last = $rows[-1].Pid
  return @($rows | Where-Object Pid -eq $last)
}
function Assert-Installed([string]$Version) {
  if ((Get-Item $exe).VersionInfo.FileVersion -ne $Version) { throw "Installed executable is not $Version" }
  $location = (Get-ItemProperty $installKey).InstallLocation
  if ($location -ne $installDir) { throw "InstallLocation is '$location', expected '$installDir'" }
  $entry = Get-ItemProperty $uninstallKey
  if ($entry.DisplayVersion -ne $Version) { throw "Uninstall entry reports '$($entry.DisplayVersion)', expected $Version" }
  if (-not (Test-Path (Join-Path $installDir 'Uninstall DSH-PX Desktop.exe'))) { throw 'Uninstaller is missing' }
  $leftovers = @(Get-ChildItem (Split-Path $installDir) -Directory | Where-Object Name -match '^DSH-PX Desktop\.(new|old)-')
  if ($leftovers.Count) { throw "Staging directories remain: $($leftovers.Name -join ', ')" }
}
function Stop-InstalledClient {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

Write-Host "1. Fresh silent install of the published $PreviousVersion"
$code = Invoke-Installer $Previous @('/S')
if ($code -ne 0) { throw "Previous installer exited with $code" }
Assert-Installed $PreviousVersion

Write-Host "2. Silent in-app style upgrade to $CandidateVersion"
$code = Invoke-Installer $Candidate @('--updated', '/S', '--px-quiet-failure')
if ($code -ne 0) { throw "Candidate upgrade exited with $code" }
Assert-Installed $CandidateVersion
$run = Get-LastRun $CandidateVersion
if ($run[-1].Stage -ne 'installed') { throw "Upgrade trace ends with '$($run[-1].Stage)'" }
if ((Get-ItemProperty $installKey).KeepShortcuts -ne 'true') { throw 'KeepShortcuts was not recorded' }

Write-Host '3. Missing install registration: the update must stop with a reason and keep the program'
Remove-ItemProperty $installKey -Name InstallLocation
$code = Invoke-Installer $Candidate @('--updated', '/S', '--px-quiet-failure')
if ($code -ne 2) { throw "Unregistered update exited with $code, expected 2" }
$run = Get-LastRun $CandidateVersion
if ($run[-1].Stage -ne 'failed' -or -not $run[-1].Reason) { throw "Unregistered update trace: $($run | Out-String)" }
if ((Get-Item $exe).VersionInfo.FileVersion -ne $CandidateVersion) { throw 'The installed program changed after a refused update' }
Set-ItemProperty $installKey -Name InstallLocation -Value $installDir
Assert-Installed $CandidateVersion

Write-Host '4. Client still running: the update must wait, stop with a reason and relaunch the registered client'
# The installed executable stays alive without a window; the installer only matches its path.
# The relaunched client inherits an isolated data directory and never registers the protocol.
$env:DSH_PX_USER_DATA_DIR = Join-Path $env:RUNNER_TEMP 'px-installer-acceptance-data'
$env:DSH_PX_DISABLE_PROTOCOL_REGISTRATION = '1'
$env:ELECTRON_RUN_AS_NODE = '1'
$client = Start-Process -FilePath $exe -ArgumentList @('-e', 'setTimeout(()=>{},240000)') -PassThru
Remove-Item Env:ELECTRON_RUN_AS_NODE
try {
  Start-Sleep -Seconds 5
  if ($client.HasExited) { throw "The installed executable exited early with $($client.ExitCode)" }
  $code = Invoke-Installer $Candidate @('--updated', '/S', '--px-quiet-failure')
  if ($code -ne 2) { throw "Update with a running client exited with $code, expected 2" }
  $run = Get-LastRun $CandidateVersion
  $failed = @($run | Where-Object Stage -eq 'failed')
  if (-not $failed.Count -or -not $failed[-1].Reason) { throw "Running-client trace: $($run | Out-String)" }
  if (-not ($run | Where-Object Stage -eq 'relaunch-available')) { throw 'A registered client was not relaunched after the failure' }
} finally {
  Stop-InstalledClient
  Remove-Item Env:DSH_PX_USER_DATA_DIR, Env:DSH_PX_DISABLE_PROTOCOL_REGISTRATION -ErrorAction SilentlyContinue
}
Assert-Installed $CandidateVersion
Write-Host "Installer acceptance passed: $PreviousVersion -> $CandidateVersion"
