param(
  [switch]$Package,
  [string]$CertificateProfile = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root ".tizen-stage"
$web = Join-Path $root "dist-tizen"
$runtime = Join-Path $root "dist-runtime/tizen"

Push-Location $root
try {
  npm run build:tizen:web
  if (Test-Path $stage) { Remove-Item -Recurse -Force -LiteralPath $stage }
  New-Item -ItemType Directory -Path $stage | Out-Null
  Copy-Item -Recurse -Force (Join-Path $web "*") $stage
  Copy-Item -Force (Join-Path $root "platforms/tizen/config.xml") $stage
  Copy-Item -Force (Join-Path $root "src-tauri/icons/128x128.png") (Join-Path $stage "icon.png")
  if (Test-Path (Join-Path $runtime "runtime-manifest.json")) {
    Copy-Item -Recurse -Force $runtime (Join-Path $stage "runtime")
  } else {
    Write-Warning "Interface pronta, mas o runtime WASM ainda não foi compilado. Execute npm run build:runtime:tizen."
  }
  if ($Package) {
    if (-not (Get-Command tizen -ErrorAction SilentlyContinue)) {
      throw "Tizen CLI não encontrado. Instale o Tizen Studio com Web CLI e TV Extensions."
    }
    if (-not $CertificateProfile) {
      throw "Informe -CertificateProfile com o perfil criado no Samsung Certificate Manager."
    }
    if (-not (Test-Path (Join-Path $stage "runtime/runtime-manifest.json"))) {
      throw "O pacote jogável exige o runtime WASM. Execute npm run build:runtime:tizen primeiro."
    }
    & tizen build-web -- $stage
    if ($LASTEXITCODE -ne 0) { throw "tizen build-web falhou." }
    & tizen package -t wgt -s $CertificateProfile -- (Join-Path $stage ".buildResult")
    if ($LASTEXITCODE -ne 0) { throw "tizen package falhou." }
  }
  Write-Host "OpenRetro Tizen preparado em $stage"
} finally {
  Pop-Location
}
