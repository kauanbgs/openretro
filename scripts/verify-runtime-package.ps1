param(
  [string]$RuntimeDirectory = "",
  [string]$DistDirectory = ""
)
$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $RuntimeDirectory) { $RuntimeDirectory = Join-Path $workspaceRoot "src-tauri/resources/runtime/retroarch" }
if (-not $DistDirectory) { $DistDirectory = Join-Path $workspaceRoot "dist-runtime" }

$settings = @{}
Get-Content -LiteralPath (Join-Path $workspaceRoot "runtime/retroarch/upstream.env") | ForEach-Object {
  if ($_ -match '^([A-Z0-9_]+)=(.+)$') { $settings[$matches[1]] = $matches[2] }
}
function Get-StreamSha256($stream) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Test-Manifest($manifest) {
  if ($manifest.kind -ne 'openretro-minimal' -or
      $manifest.target -ne 'windows-x86_64' -or
      $manifest.menuIncluded -ne $false -or $manifest.coresIncluded -ne $false -or
      $manifest.retroarchVersion -ne $settings.RETROARCH_VERSION -or
      $manifest.retroarchCommit -ne $settings.RETROARCH_COMMIT -or
      $manifest.autoconfigCommit -ne $settings.AUTOCONFIG_COMMIT -or
      [string]$manifest.runtimeRevision -ne $settings.OPENRETRO_RUNTIME_REVISION -or
      $manifest.retroarchSha256 -notmatch '^[0-9a-f]{64}$') {
    throw 'The runtime manifest does not match the pinned OpenRetro recipe.'
  }
}
$requiredFiles = @('runtime-manifest.json', 'retroarch.exe', 'SDL2.dll', 'retroarch.cfg', 'SOURCE.md', 'DEPENDENCIES.txt', 'licenses/RetroArch-GPL-3.0.txt')
foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDirectory $file) -PathType Leaf)) {
    throw "Runtime package is missing $file."
  }
}
$manifest = Get-Content -LiteralPath (Join-Path $RuntimeDirectory 'runtime-manifest.json') -Raw | ConvertFrom-Json
Test-Manifest $manifest
$stream = [System.IO.File]::OpenRead((Join-Path $RuntimeDirectory 'retroarch.exe'))
try { $binaryHash = Get-StreamSha256 $stream } finally { $stream.Dispose() }
if ($binaryHash -ne $manifest.retroarchSha256) { throw 'The runtime executable failed its SHA-256 check.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $DistDirectory 'openretro-runtime-windows-x86_64.zip'))
try {
  $archivedFiles = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
  foreach ($file in $requiredFiles) {
    if ($archivedFiles -notcontains $file) { throw "The runtime ZIP is missing $file." }
  }
  $entry = $zip.GetEntry('runtime-manifest.json')
  if (-not $entry) { throw 'The runtime ZIP has no manifest.' }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { $archivedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  Test-Manifest $archivedManifest
  $entry = $zip.GetEntry('retroarch.exe')
  if (-not $entry) { throw 'The runtime ZIP has no executable.' }
  $stream = $entry.Open()
  try { $archivedHash = Get-StreamSha256 $stream } finally { $stream.Dispose() }
  if ($archivedHash -ne $binaryHash -or $archivedHash -ne $archivedManifest.retroarchSha256) {
    throw 'The runtime ZIP does not contain the verified executable.'
  }
} finally { $zip.Dispose() }

$version = $settings.RETROARCH_VERSION
$revision = $settings.OPENRETRO_RUNTIME_REVISION
$source = Join-Path $DistDirectory "openretro-runtime-source-$version-r$revision.tar.gz"
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'The corresponding runtime source archive is missing.' }
$entries = @("RetroArch-$version/COPYING", "RetroArch-$version/openretro-build/upstream.env", "RetroArch-$version/openretro-build/configure-flags.txt")
$listing = & tar -tzf $source @entries
if ($LASTEXITCODE -ne 0 -or @($listing).Count -ne $entries.Count) {
  throw 'The corresponding source archive is invalid or is missing its license/build recipe.'
}
Write-Host "OpenRetro Runtime verified: pinned revision $revision, binary SHA-256, ZIP, license and corresponding source."
