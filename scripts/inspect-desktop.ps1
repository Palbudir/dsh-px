# Read-only post-update inventory. Run from an ordinary Windows terminal: packaged parent processes can
# expose a redirected HKCU view. A registry mismatch is a diagnostic, not permission to rewrite keys.
param(
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\DSH-PX Desktop'),
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh-px')
)
$ErrorActionPreference = 'Stop'
$executable = Join-Path $InstallDirectory 'DSH-PX Desktop.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Desktop executable not found: $executable" }
$version = (Get-Item -LiteralPath $executable).VersionInfo.FileVersion
# The application identity is fixed across releases; derive it with the same helper as the build.
$guidModule = ([Uri](Join-Path $PSScriptRoot 'nsis-guid.mjs')).AbsoluteUri
$guid = & node -e 'import(process.argv[1]).then(m=>console.log(m.nsisAppGuid(process.argv[2])))' $guidModule 'com.palbudir.dshpx.desktop'
if ($LASTEXITCODE -ne 0 -or $guid -notmatch '^[a-f0-9-]{36}$') { throw 'Could not resolve the Desktop registry identity; Node must be available.' }
$install = Get-ItemProperty -LiteralPath "HKCU:\Software\$guid" -ErrorAction SilentlyContinue
$entry = Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid" -ErrorAction SilentlyContinue
$profile = Join-Path $DshHome 'profiles\desktop'
$deploymentFile = Join-Path $profile '.dsh-px\deployment.json'
$deployment = if (Test-Path -LiteralPath $deploymentFile) { Get-Content -Raw -Encoding UTF8 -LiteralPath $deploymentFile | ConvertFrom-Json } else { $null }
$plugins = @(Get-ChildItem -LiteralPath (Join-Path $profile 'node_modules') -Directory -Filter 'dsh-px-*' -ErrorAction SilentlyContinue | ForEach-Object {
    $file = Join-Path $_.FullName 'package.json'
    if (Test-Path -LiteralPath $file) {
      $pkg = Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json
      [pscustomobject]@{ name = $pkg.name; version = $pkg.version }
    }
  })
[pscustomobject]@{
  desktopVersion = $version
  executable = $executable
  registration = [pscustomobject]@{
    displayName = $entry.DisplayName
    displayVersion = $entry.DisplayVersion
    installLocation = $install.InstallLocation
    keepShortcuts = $install.KeepShortcuts
    versionMatches = ($entry.DisplayVersion -eq $version)
    locationMatches = ($install.InstallLocation -eq [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\'))
    scope = 'Current process HKCU view; recheck from a normal desktop terminal before treating a mismatch as an installation defect.'
  }
  pack = [pscustomobject]@{
    version = $deployment.active.version
    sourceCommit = $deployment.active.sourceCommit
    pending = $deployment.pending.version
    trial = $deployment.trial.version
    error = $deployment.error
  }
  plugins = $plugins
} | ConvertTo-Json -Depth 6
