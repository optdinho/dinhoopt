$ErrorActionPreference = 'Stop'
Write-Host '=== Teste ProcessAudioSource (MTA Fix) ===' -ForegroundColor Magenta

# Kill residual
Get-Process -Name 'DiNho.Capture.Poc' -ErrorAction SilentlyContinue | Stop-Process -Force

# Start engine
$engDir = 'C:\Users\Administrator\Desktop\001\dinho-clips-poc\src\DiNho.Capture.Poc\bin\Release\net9.0-windows10.0.26100.0\publish'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = Join-Path $engDir 'DiNho.Capture.Poc.exe'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = $engDir
$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "Engine PID: $($proc.Id)" -ForegroundColor Gray

# Wait for pipe
Write-Host 'Waiting for pipe...' -ForegroundColor Yellow
$connected = $false
for ($i = 0; $i -lt 20; $i++) {
    try {
        $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut)
        $p.Connect(2000)
        $p.Dispose()
        $connected = $true
        break
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $connected) { Write-Host 'FAIL: Pipe not available' -ForegroundColor Red; $proc.Kill(); exit 1 }
Write-Host 'OK: Pipe connected' -ForegroundColor Green
Start-Sleep 1

function Send-Cmd {
    param($cmd, $payload)
    # JSON com envelope
    if ($payload -ne $null) {
        $body = @{ v = 1; cmd = $cmd; payload = $payload } | ConvertTo-Json -Depth 5 -Compress
    } else {
        $body = @{ v = 1; cmd = $cmd; payload = $null } | ConvertTo-Json -Depth 5 -Compress
    }
    $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut)
    $p.Connect(5000)
    $r = New-Object System.IO.StreamReader($p)
    $w = New-Object System.IO.StreamWriter($p)
    $w.AutoFlush = $true
    $w.WriteLine($body)
    $resp = $r.ReadLine()
    $p.Dispose()
    return $resp
}

# 1) getAudioSessions
Write-Host "`n--- getAudioSessions ---" -ForegroundColor Yellow
$resp = Send-Cmd 'getAudioSessions' $null
Write-Host $resp

# 2) setAudioSessions with first GUI process
$target = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -gt 100 -and $_.Responding } | Select-Object -First 1
if ($target) {
    Write-Host "`n--- setAudioSessions PID $($target.Id) ($($target.ProcessName)) ---" -ForegroundColor Yellow
    $payload = @{ pids = @($target.Id) }
    $resp = Send-Cmd 'setAudioSessions' $payload
    Write-Host $resp
}

# 3) startCapture
Write-Host "`n--- startCapture ---" -ForegroundColor Yellow
$resp = Send-Cmd 'startCapture' $null
Write-Host $resp

# 4) Wait for audio
Write-Host "`nWaiting 5s for audio..." -ForegroundColor Yellow
Start-Sleep 5

# 5) getStatus - check audioFallback
Write-Host "`n--- getStatus ---" -ForegroundColor Yellow
$resp = Send-Cmd 'getStatus' $null
Write-Host $resp
try {
    $obj = $resp | ConvertFrom-Json
    $fb = $obj.payload.audioFallback
    $rec = $obj.payload.recording
    $cb = $obj.payload.captureBackend
    Write-Host "recording=$rec audioFallback=$fb captureBackend=$cb" -ForegroundColor Cyan
    if ($fb -eq $false) { Write-Host 'PASS: ProcessAudioSource funcionou!' -ForegroundColor Green }
    else { Write-Host 'FAIL: Caiu em fallback' -ForegroundColor Red }
} catch { Write-Host 'Parse error' -ForegroundColor Red }

# 6) stopCapture
Write-Host "`n--- stopCapture ---" -ForegroundColor Yellow
$resp = Send-Cmd 'stopCapture' $null
Write-Host $resp

# Get logs
Start-Sleep 1
if (-not $proc.HasExited) {
    try { $proc.Kill() } catch {}
}
$out = $proc.StandardOutput.ReadToEnd()
$err = $proc.StandardError.ReadToEnd()
Write-Host "`n=== Engine stdout ===" -ForegroundColor Magenta
if ($out) { Write-Host $out }
Write-Host "`n=== Engine stderr ===" -ForegroundColor Magenta
if ($err) { Write-Host $err }
Write-Host "`n=== Done ===" -ForegroundColor Magenta
