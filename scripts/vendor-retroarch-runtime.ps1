param([switch]$KeepExtras)
$ErrorActionPreference = "Stop"

# Runs only on the release machine. The installer receives this portable
# official runtime as an application resource; end users download nothing.
$version = "1.22.2"
$url = "https://buildbot.libretro.com/stable/$version/windows/x86_64/RetroArch-Win64-setup.exe"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot "src-tauri\resources\runtime"))
$destination = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "retroarch"))
if (-not $destination.StartsWith($runtimeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Runtime destination is outside the expected workspace directory."
}
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "openretro-retroarch-$version.exe"

Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Write-Host "Downloading official RetroArch $version for the OpenRetro installer..."
Invoke-WebRequest -Uri $url -OutFile $scratch
try {
  # The official Windows installer is NSIS and accepts a portable target.
  $process = Start-Process -FilePath $scratch -ArgumentList "/S", "/D=$destination" -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0 -or -not (Test-Path (Join-Path $destination "retroarch.exe"))) {
    throw "The official RetroArch installer did not produce retroarch.exe."
  }
} finally {
  Remove-Item -LiteralPath $scratch -Force -ErrorAction SilentlyContinue
}
if (-not $KeepExtras) {
  # OpenRetro supplies its own UI. Cores are fetched individually on first play;
  # retain DLLs, controller profiles, core info and all license notices.
  foreach ($extra in @("assets", "cores", "database", "thumbnails", "overlays", "shaders", "shaders_slang", "shaders_glsl", "cheats", "recordings", "screenshots", "playlists")) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $destination $extra))
    if (-not $target.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a directory outside the prepared runtime."
    }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  }
}
$totalBytes = (Get-ChildItem -LiteralPath $destination -File -Recurse | Measure-Object -Property Length -Sum).Sum
Write-Host ("Runtime size: {0:N1} MB. Emulator cores are downloaded per console on first Play." -f ($totalBytes / 1MB))
Write-Host "Bundled runtime prepared at $destination"
