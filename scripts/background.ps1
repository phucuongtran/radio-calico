param([ValidateSet('start', 'stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectPath 'app.py'
$logPath = Join-Path $projectPath 'logs'
$pidPath = Join-Path $logPath 'server-process.json'
$runtimePidPath = Join-Path $logPath 'server-runtime.pid'

if (Test-Path -LiteralPath $pidPath) {
    $savedProcess = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
    $serverProcessId = [int]$savedProcess.id
    $existingProcess = Get-Process -Id $serverProcessId -ErrorAction SilentlyContinue
    if ($existingProcess -and $existingProcess.ProcessName -eq 'python' -and
        $existingProcess.StartTime.ToUniversalTime().Ticks.ToString() -eq $savedProcess.startedAt) {
        if ($Action -eq 'stop') {
            Stop-Process -Id $serverProcessId
            Remove-Item -LiteralPath $pidPath
            Remove-Item -LiteralPath $runtimePidPath -ErrorAction SilentlyContinue
            Write-Output 'Local server stopped. SQLite data is preserved.'
        } else {
            Write-Output "Local server is already running (PID $serverProcessId)."
        }
        exit 0
    }
    Remove-Item -LiteralPath $pidPath
}

if ($Action -eq 'stop') {
    Write-Output 'No managed background server is running.'
    exit 0
}

New-Item -ItemType Directory -Path $logPath -Force | Out-Null
$pythonPath = Join-Path $projectPath '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Create .venv and install requirements.txt first.' }
Remove-Item -LiteralPath $runtimePidPath -ErrorAction SilentlyContinue
$serverArguments = '-u "{0}" --pid-file "{1}"' -f $serverPath, $runtimePidPath
$serverProcess = Start-Process -FilePath $pythonPath -WindowStyle Hidden -PassThru `
    -WorkingDirectory $projectPath `
    -ArgumentList $serverArguments `
    -RedirectStandardOutput (Join-Path $logPath 'server.log') `
    -RedirectStandardError (Join-Path $logPath 'server-error.log')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 100
    if ((Test-Path -LiteralPath $runtimePidPath) -or $serverProcess.HasExited) { break }
}
Start-Sleep -Milliseconds 300
$serverProcess.Refresh()
if ($serverProcess.HasExited) {
    Get-Content -LiteralPath (Join-Path $logPath 'server-error.log')
    throw 'Server failed to start.'
}
if (-not (Test-Path -LiteralPath $runtimePidPath)) { throw 'The server did not record its process ID.' }
$runtimeProcess = Get-Process -Id ([int](Get-Content -LiteralPath $runtimePidPath -Raw).Trim())
@{ id = $runtimeProcess.Id; startedAt = $runtimeProcess.StartTime.ToUniversalTime().Ticks.ToString() } |
    ConvertTo-Json | Set-Content -LiteralPath $pidPath
Write-Output "Local Flask server started (PID $($runtimeProcess.Id)). Logs: $logPath"
