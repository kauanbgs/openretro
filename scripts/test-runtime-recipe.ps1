$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$recipe = Join-Path $root "runtime/retroarch"

$settings = @{}
Get-Content -LiteralPath (Join-Path $recipe "upstream.env") | ForEach-Object {
  if ($_ -match '^([A-Z0-9_]+)=(.+)$') { $settings[$matches[1]] = $matches[2] }
}
foreach ($required in @("RETROARCH_VERSION", "RETROARCH_COMMIT", "RETROARCH_REPOSITORY", "AUTOCONFIG_COMMIT", "AUTOCONFIG_REPOSITORY", "OPENRETRO_RUNTIME_REVISION")) {
  if (-not $settings[$required]) { throw "Missing $required in upstream.env." }
}
foreach ($commit in @($settings.RETROARCH_COMMIT, $settings.AUTOCONFIG_COMMIT)) {
  if ($commit -notmatch '^[0-9a-f]{40}$') { throw "Runtime dependencies must use full 40-character commits." }
}

$flags = Get-Content -LiteralPath (Join-Path $recipe "configure-flags.txt") |
  ForEach-Object { ($_ -replace '\s*#.*$', '').Trim() } |
  Where-Object { $_ }
$duplicates = $flags | Group-Object | Where-Object Count -gt 1
if ($duplicates) { throw "Duplicate configure flags: $($duplicates.Name -join ', ')" }
foreach ($flag in $flags) {
  if ($flag -notmatch '^--(enable|disable)-[a-z0-9_]+$') { throw "Invalid configure flag: $flag" }
}
foreach ($requiredFlag in @("--disable-menu", "--enable-command", "--enable-dynamic", "--enable-screenshots", "--enable-sdl2")) {
  if ($flags -notcontains $requiredFlag) { throw "Missing required runtime flag: $requiredFlag" }
}
foreach ($forbiddenFlag in @("--enable-menu", "--disable-command", "--disable-dynamic", "--disable-screenshots")) {
  if ($flags -contains $forbiddenFlag) { throw "Incompatible runtime flag: $forbiddenFlag" }
}
if ($flags -contains "--disable-slang") {
  $slangBackends = @("--enable-opengl_core", "--enable-vulkan", "--enable-d3d11", "--enable-d3d12") | Where-Object { $flags -contains $_ }
  if ($slangBackends) {
    throw "RetroArch requires Slang for these video backends: $($slangBackends -join ', ')."
  }
}
if ($flags -contains "--enable-opengl" -and $flags -contains "--disable-glsl") {
  throw "RetroArch's OpenGL driver cannot start without GLSL shaders."
}

$build = Get-Content -LiteralPath (Join-Path $recipe "build-mingw64.sh") -Raw
foreach ($marker in @('retroarch.exe', 'patches/*.patch', 'runtime-manifest.json', 'SOURCE.md', 'DEPENDENCIES.txt', 'RetroArch-GPL-3.0.txt')) {
  if (-not $build.Contains($marker)) { throw "Build recipe does not package $marker." }
}
Write-Host "OpenRetro Runtime recipe is internally consistent ($($flags.Count) feature flags)."
