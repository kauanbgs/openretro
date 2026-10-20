$ErrorActionPreference = "Stop"

# npm shells on Windows do not always inherit Rust's user PATH entry.
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (-not (Test-Path (Join-Path $cargoBin "cargo.exe"))) {
  throw "Rust was not found at $cargoBin. Install it with rustup, then reopen the terminal."
}
$env:PATH = "$cargoBin;$env:PATH"
& (Join-Path $PSScriptRoot "..\node_modules\.bin\tauri.cmd") @args
exit $LASTEXITCODE
