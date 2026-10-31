$ErrorActionPreference = "Stop"

# npm shells on Windows do not always inherit Rust's user PATH entry.
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (-not (Test-Path (Join-Path $cargoBin "cargo.exe"))) {
  throw "Rust was not found at $cargoBin. Install it with rustup, then reopen the terminal."
}
$env:PATH = "$cargoBin;$env:PATH"
# Rust's MSVC target needs link.exe, which Build Tools only put on PATH inside
# their own prompt. Load that environment when a plain terminal lacks it.
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
  $vcvars = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft Visual Studio\*\*\VC\Auxiliary\Build\vcvars64.bat", "$env:ProgramFiles\Microsoft Visual Studio\*\*\VC\Auxiliary\Build\vcvars64.bat" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($vcvars) {
    cmd /c "`"$($vcvars.FullName)`" >nul && set" | ForEach-Object {
      if ($_ -match '^([^=]+)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
    }
    $env:PATH = "$cargoBin;$env:PATH"
  }
}
& (Join-Path $PSScriptRoot "..\node_modules\.bin\tauri.cmd") @args
exit $LASTEXITCODE
