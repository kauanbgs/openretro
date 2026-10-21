$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$required = @(
  "platforms/tizen/config.xml",
  "runtime/tizen/cores.env",
  "runtime/tizen/build-emscripten.sh",
  "scripts/build-tizen.ps1",
  "src/platform/tizen/runtime.ts",
  "src/platform/tizen/TizenGameSurface.tsx"
)
foreach ($path in $required) {
  if (-not (Test-Path (Join-Path $root $path))) { throw "Arquivo Tizen ausente: $path" }
}
$pins = Get-Content -Raw (Join-Path $root "runtime/tizen/cores.env")
$commits = [regex]::Matches($pins, '(?m)^\w+_COMMIT=([0-9a-f]{40})$')
if ($commits.Count -ne 5) { throw "Os cinco cores Tizen precisam de commits completos fixados." }
$recipe = Get-Content -Raw (Join-Path $root "runtime/tizen/build-emscripten.sh")
foreach ($value in @('[[ -f Makefile.libretro ]]', '[[ -f Makefile ]]', 'make -f "$makefile" platform=emscripten')) {
  if (-not $recipe.Contains($value)) { throw "A receita Tizen não aceita os formatos de Makefile dos cores: $value" }
}
$config = Get-Content -Raw (Join-Path $root "platforms/tizen/config.xml")
foreach ($value in @('tv-samsung', 'required_version="5.5"', 'privilege/download', 'privilege/tv.inputdevice')) {
  if (-not $config.Contains($value)) { throw "config.xml não contém $value" }
}
Write-Host "Receita Tizen válida: 5 cores fixados, Makefiles compatíveis e manifesto Samsung configurado."
