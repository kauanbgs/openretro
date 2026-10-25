param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [ValidateRange(5, 60)]
    [int]$Seconds = 10
)
$ErrorActionPreference = "Stop"
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$captureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("openretro-startup-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $captureDirectory | Out-Null
$stdoutPath = Join-Path $captureDirectory "stdout.log"
$stderrPath = Join-Path $captureDirectory "stderr.log"
$process = $null
try {
    $process = Start-Process -FilePath $executablePath -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) {
            throw "Desktop exited during startup (exit $($process.ExitCode))."
        }
        Start-Sleep -Milliseconds 250
    }
    $stdout = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
    if ($stdout -notmatch 'OpenRetro initialized;') {
        throw "Desktop did not complete setup within $Seconds seconds."
    }
    Write-Host "Desktop completed setup and stayed running for $Seconds seconds."
} catch {
    Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue | Write-Host
    Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue | Write-Host
    throw
} finally {
    if ($process -and -not $process.HasExited) {
        if (-not $process.CloseMainWindow() -or -not $process.WaitForExit(5000)) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }
}
