powershell -Command @"
# Teste do ProcessAudioSource — verifica per-process loopback apos fix MTA

`$EngineDir = "C:\Users\Administrator\Desktop\001\dinho-clips-poc\src\DiNho.Capture.Poc\bin\Release\net9.0-windows10.0.26100.0\publish"
`$EngineExe = Join-Path `$EngineDir "DiNho.Capture.Poc.exe"
`$PipeName = "dinho-clips-engine"
`$Global:EngineProcess = `$null

function Send-PipeCommand {
    param(`$Cmd, `$PayloadJson)
    `$envelope = @{
        v = 1
        cmd = `$Cmd
        payload = if (`$PayloadJson) { (`$PayloadJson | ConvertFrom-Json) } else { `$null }
    } | ConvertTo-Json -Depth 5 -Compress
    try {
        `$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', `$PipeName, [System.IO.Pipes.PipeDirection]::InOut)
        `$pipe.Connect(5000)
        `$reader = New-Object System.IO.StreamReader(`$pipe)
        `$writer = New-Object System.IO.StreamWriter(`$pipe)
        `$writer.AutoFlush = `$true
        `$writer.WriteLine(`$envelope)
        Write-Host "  >> `$Cmd" -ForegroundColor Cyan
        `$response = `$reader.ReadLine()
        `$pipe.Dispose()
        if (`$response) {
            `$obj = `$response | ConvertFrom-Json
            Write-Host "  << `$(`$obj.cmd)" -ForegroundColor Green
            return `$obj
        }
    }
    catch {
        Write-Host "  !! Erro pipe: `$_" -ForegroundColor Red
    }
    return `$null
}

function Wait-ForPipe {
    Write-Host "Aguardando pipe `$PipeName..." -ForegroundColor Yellow
    for (`$i = 0; `$i -lt 30; `$i++) {
        try {
            `$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', `$PipeName, [System.IO.Pipes.PipeDirection]::InOut)
            `$pipe.Connect(2000)
            `$pipe.Dispose()
            return `$true
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return `$false
}

function Read-EngineLogs {
    if (`$Global:EngineProcess -and !`$Global:EngineProcess.HasExited) {
        try {
            `$line = `$Global:EngineProcess.StandardOutput.ReadExisting()
            if (`$line) { Write-Host "  [engine] `$line" -ForegroundColor DarkYellow }
            `$errLine = `$Global:EngineProcess.StandardError.ReadExisting()
            if (`$errLine) { Write-Host "  [engine:err] `$errLine" -ForegroundColor DarkRed }
        } catch {}
    }
}

Write-Host "=== Teste ProcessAudioSource (MTA fix) ===" -ForegroundColor Magenta

# Mata engine residual
Get-Process -Name "DiNho.Capture.Poc" -ErrorAction SilentlyContinue | Stop-Process -Force

# Inicia engine
Write-Host "`nIniciando engine..." -ForegroundColor Yellow
`$psi = New-Object System.Diagnostics.ProcessStartInfo
`$psi.FileName = `$EngineExe
`$psi.UseShellExecute = `$false
`$psi.RedirectStandardOutput = `$true
`$psi.RedirectStandardError = `$true
`$psi.CreateNoWindow = `$true
`$psi.WorkingDirectory = `$EngineDir
`$Global:EngineProcess = [System.Diagnostics.Process]::Start(`$psi)
Write-Host "PID: `$(`$Global:EngineProcess.Id)" -ForegroundColor Gray

if (!(Wait-ForPipe)) {
    Write-Host "ERRO: Pipe nao disponivel apos 15s" -ForegroundColor Red
    Read-EngineLogs
    `$Global:EngineProcess.Kill()
    exit 1
}
Start-Sleep -Milliseconds 500
Read-EngineLogs

# 1) getAudioSessions
Write-Host "`n--- getAudioSessions ---" -ForegroundColor Yellow
`$sessions = Send-PipeCommand -Cmd "getAudioSessions"
if (`$sessions -and `$sessions.payload) {
    `$audioList = `$sessions.payload.sessions
    if (`$audioList) {
        Write-Host "Sessoes de audio encontradas: `$(`$audioList.Count)" -ForegroundColor Cyan
        `$audioList | Select-Object -First 10 | ForEach-Object {
            Write-Host "  PID `$(`$_.processId): `$(`$_.processName)" -ForegroundColor Gray
        }
    }
}
Read-EngineLogs

# 2) setAudioSessions com o primeiro processo GUI ativo
`$targetProc = Get-Process | Where-Object { `$_.MainWindowHandle -ne 0 -and `$_.Id -gt 100 -and `$_.Responding } | Select-Object -First 1
if (`$targetProc) {
    Write-Host "`n--- setAudioSessions PID `$(`$targetProc.Id) (`$(`$targetProc.ProcessName)) ---" -ForegroundColor Yellow
    `$payload = @{ pids = @(`$targetProc.Id) } | ConvertTo-Json -Compress
    `$result = Send-PipeCommand -Cmd "setAudioSessions" -PayloadJson `$payload
    Read-EngineLogs
}

# 3) startCapture
Write-Host "`n--- startCapture ---" -ForegroundColor Yellow
`$capResult = Send-PipeCommand -Cmd "startCapture"
Read-EngineLogs

# 4) Aguarda audio fluir (5s)
Write-Host "`nAguardando 5s para audio..." -ForegroundColor Yellow
for (`$i = 0; `$i -lt 5; `$i++) {
    Start-Sleep -Seconds 1
    Read-EngineLogs
}

# 5) getStatus para verificar audioFallback
Write-Host "`n--- getStatus ---" -ForegroundColor Yellow
`$status = Send-PipeCommand -Cmd "getStatus"
if (`$status -and `$status.payload) {
    Write-Host "Status:" -ForegroundColor Cyan
    Write-Host "  recording: `$(`$status.payload.recording)" -ForegroundColor Gray
    Write-Host "  audioFallback: `$(`$status.payload.audioFallback)" -ForegroundColor Gray
    Write-Host "  captureBackend: `$(`$status.payload.captureBackend)" -ForegroundColor Gray
    Write-Host "  audioPacketCount: (see logs)" -ForegroundColor Gray

    if (`$status.payload.audioFallback -eq `$false) {
        Write-Host "`n[OK] ProcessAudioSource FUNCIONOU! Sem fallback!" -ForegroundColor Green
    } else {
        Write-Host "`n[FAIL] ProcessAudioSource FALHOU - caiu em fallback" -ForegroundColor Red
    }
}

# 6) stopCapture
Write-Host "`n--- stopCapture ---" -ForegroundColor Yellow
Send-PipeCommand -Cmd "stopCapture"
Read-EngineLogs

# 7) saveClip
Write-Host "`n--- saveClip ---" -ForegroundColor Yellow
`$saveResult = Send-PipeCommand -Cmd "saveClip"
Read-EngineLogs

# Para engine
Write-Host "`nParando engine..." -ForegroundColor Yellow
try { Send-PipeCommand -Cmd "stopEngine"; Start-Sleep -Seconds 1; Read-EngineLogs } catch {}

if (`$Global:EngineProcess -and !`$Global:EngineProcess.HasExited) {
    `$Global:EngineProcess.Kill()
    `$Global:EngineProcess.WaitForExit(3000)
}
Write-Host "`n=== Teste concluido ===" -ForegroundColor Magenta
"@ | powershell -ExecutionPolicy Bypass -NoProfile -Command -