param([string]$MsysBash = "", [switch]$Incremental)
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$candidates = @(
  $MsysBash,
  "$env:MSYS2_ROOT\usr\bin\bash.exe",
  "C:\msys64\usr\bin\bash.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$bash = $candidates | Select-Object -First 1
if (-not $bash) {
  throw @"
MSYS2 was not found. Install MSYS2 and these packages once:
  pacman -S --needed git make base-devel mingw-w64-x86_64-toolchain mingw-w64-x86_64-SDL2 mingw-w64-x86_64-vulkan-headers mingw-w64-x86_64-vulkan-loader mingw-w64-x86_64-ntldd
Then run npm run build:runtime again.
"@
}

# Windows PowerShell strips embedded double quotes from native arguments, so
# the login shell starts in the project folder instead of receiving a cd.
$previousMsystem = $env:MSYSTEM
$previousChere = $env:CHERE_INVOKING
$previousIncremental = $env:OPENRETRO_RUNTIME_INCREMENTAL
Push-Location -LiteralPath $projectRoot
try {
  $env:MSYSTEM = "MINGW64"
  $env:CHERE_INVOKING = "1"
  # Local iteration only: releases always build from a clean tree.
  $env:OPENRETRO_RUNTIME_INCREMENTAL = if ($Incremental) { "1" } else { "0" }
  & $bash -lc 'bash ./runtime/retroarch/build-mingw64.sh'
  if ($LASTEXITCODE -ne 0) { throw "OpenRetro Runtime build failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
  $env:MSYSTEM = $previousMsystem
  $env:CHERE_INVOKING = $previousChere
  $env:OPENRETRO_RUNTIME_INCREMENTAL = $previousIncremental
}
