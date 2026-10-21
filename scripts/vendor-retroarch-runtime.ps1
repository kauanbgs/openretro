param(
  [string]$Archive = $env:OPENRETRO_RUNTIME_ARCHIVE,
  [switch]$AllowOfficialFallback
)
$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$upstreamSettings = @{}
Get-Content -LiteralPath (Join-Path $workspaceRoot "runtime\retroarch\upstream.env") | ForEach-Object {
  if ($_ -match '^([A-Z0-9_]+)=(.+)$') { $upstreamSettings[$matches[1]] = $matches[2] }
}
$version = $upstreamSettings.RETROARCH_VERSION
if (-not $version) { throw "RETROARCH_VERSION is missing from runtime/retroarch/upstream.env." }
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot "src-tauri\resources\runtime"))
$destination = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "retroarch"))
if (-not $destination.StartsWith($runtimeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Runtime destination is outside the expected workspace directory."
}

function Test-OpenRetroRuntime([string]$Path, [switch]$RequireCustom) {
  $executable = Join-Path $Path "retroarch.exe"
  $manifestPath = Join-Path $Path "runtime-manifest.json"
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    return $false
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($RequireCustom -and $manifest.kind -ne "openretro-minimal") { return $false }
  if ($manifest.retroarchSha256) {
    $actual = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne [string]$manifest.retroarchSha256) {
      throw "OpenRetro Runtime integrity check failed. Rebuild the runtime."
    }
  }
  return $true
}

if ($Archive) {
  $resolvedArchive = (Resolve-Path -LiteralPath $Archive).Path
  $scratchDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("openretro-runtime-" + [guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Path $scratchDirectory | Out-Null
    Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $scratchDirectory
    if (-not (Test-OpenRetroRuntime $scratchDirectory -RequireCustom)) {
      throw "The selected archive is not an OpenRetro minimal runtime."
    }
    Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $scratchDirectory "*") -Destination $destination -Recurse -Force
  } finally {
    Remove-Item -LiteralPath $scratchDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (Test-OpenRetroRuntime $destination -RequireCustom) {
  $totalBytes = (Get-ChildItem -LiteralPath $destination -File -Recurse | Measure-Object -Property Length -Sum).Sum
  Write-Host ("OpenRetro minimal runtime verified: {0:N1} MB" -f ($totalBytes / 1MB))
  exit 0
}

if (-not $AllowOfficialFallback) {
  throw @"
The OpenRetro minimal runtime has not been built.
Run npm run build:runtime in MSYS2, or set OPENRETRO_RUNTIME_ARCHIVE to a runtime archive produced by CI.
The release pipeline never silently substitutes the full official RetroArch package.
"@
}

# Development-only escape hatch. Releases use the source-built minimal runtime.
$url = "https://buildbot.libretro.com/stable/$version/windows/x86_64/RetroArch-Win64-setup.exe"
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "openretro-retroarch-$version.exe"
Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Write-Host "Downloading official RetroArch $version fallback..."
Invoke-WebRequest -Uri $url -OutFile $scratch
try {
  $process = Start-Process -FilePath $scratch -ArgumentList "/S", "/D=$destination" -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0 -or -not (Test-Path (Join-Path $destination "retroarch.exe"))) {
    throw "The official RetroArch installer did not produce retroarch.exe."
  }
} finally {
  Remove-Item -LiteralPath $scratch -Force -ErrorAction SilentlyContinue
}

foreach ($extra in @("assets", "cores", "database", "thumbnails", "overlays", "shaders", "shaders_slang", "shaders_glsl", "cheats", "recordings", "screenshots", "playlists")) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $destination $extra))
  if (-not $target.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a directory outside the prepared runtime."
  }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
$hash = (Get-FileHash -LiteralPath (Join-Path $destination "retroarch.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
@{
  kind = "official-fallback"
  retroarchVersion = $version
  target = "windows-x86_64"
  retroarchSha256 = $hash
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination "runtime-manifest.json") -Encoding utf8

$totalBytes = (Get-ChildItem -LiteralPath $destination -File -Recurse | Measure-Object -Property Length -Sum).Sum
Write-Host ("Official development fallback prepared: {0:N1} MB" -f ($totalBytes / 1MB))
