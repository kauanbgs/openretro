param([string]$MsysBash = "")
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

$previousRoot = $env:OPENRETRO_PROJECT_ROOT_WINDOWS
try {
  $env:OPENRETRO_PROJECT_ROOT_WINDOWS = $projectRoot
  & $bash -lc 'cd "$(cygpath -u "$OPENRETRO_PROJECT_ROOT_WINDOWS")" && ./runtime/retroarch/build-mingw64.sh'
  if ($LASTEXITCODE -ne 0) { throw "OpenRetro Runtime build failed with exit code $LASTEXITCODE." }
} finally {
  $env:OPENRETRO_PROJECT_ROOT_WINDOWS = $previousRoot
}
