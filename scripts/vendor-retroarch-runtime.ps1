$ErrorActionPreference = "Stop"

# Runs only on the release machine. The installer receives this portable
# official runtime as an application resource; end users download nothing.
$version = "1.22.2"
$url = "https://buildbot.libretro.com/stable/$version/windows/x86_64/RetroArch-Win64-setup.exe"
$destination = Join-Path $PSScriptRoot "..\src-tauri\resources\runtime\retroarch"
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "openretro-retroarch-$version.exe"

Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Write-Host "Downloading official RetroArch $version for the OpenRetro installer..."
Invoke-WebRequest -Uri $url -OutFile $scratch
try {
  # The official Windows installer is NSIS and accepts a portable target.
  $process = Start-Process -FilePath $scratch -ArgumentList "/S", "/D=$destination" -Wait -PassThru
  if ($process.ExitCode -ne 0 -or -not (Test-Path (Join-Path $destination "retroarch.exe"))) {
    throw "The official RetroArch installer did not produce retroarch.exe."
  }
} finally {
  Remove-Item -LiteralPath $scratch -Force -ErrorAction SilentlyContinue
}
Write-Host "Bundled runtime prepared at $destination"
