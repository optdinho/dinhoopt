@echo off
set ENGINE_DIR=C:\Users\Administrator\Desktop\001\dinho-clips-poc\src\DiNho.Capture.Poc\bin\Release\net9.0-windows10.0.26100.0\publish
set ENGINE_EXE=%ENGINE_DIR%\DiNho.Capture.Poc.exe

echo ============================================
echo  Teste ProcessAudioSource (MTA Fix)
echo ============================================

echo Killing any residual engine...
taskkill /f /im DiNho.Capture.Poc.exe >nul 2>&1

echo Starting engine...
start "" /B "%ENGINE_EXE%" > "%TEMP%\engine-out.log" 2> "%TEMP%\engine-err.log"
echo Engine started, waiting for pipe...

powershell -ExecutionPolicy Bypass -NoProfile -Command "$pipe = $null; $connected = $false; for($i=0;$i -lt 20;$i++) { try { $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut); $pipe.Connect(2000); $connected = $true; $pipe.Dispose(); break } catch { Start-Sleep -Milliseconds 500 } }; if(!$connected) { Write-Host 'FAIL: Pipe not available' -ForegroundColor Red; exit 1 }; Write-Host 'OK: Pipe connected' -ForegroundColor Green"

timeout /t 2 >nul

echo.
echo === 1. getAudioSessions ===
powershell -ExecutionPolicy Bypass -NoProfile -Command "
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut);
$pipe.Connect(5000);
$r = New-Object System.IO.StreamReader($pipe);
$w = New-Object System.IO.StreamWriter($pipe);
$w.AutoFlush = $true;
$env = '{ \"v\": 1, \"cmd\": \"getAudioSessions\", \"payload\": null }';
$w.WriteLine($env);
$resp = $r.ReadLine();
$pipe.Dispose();
Write-Host 'Response:';
Write-Host $resp
"

echo.
echo === 2. setAudioSessions (first GUI process) ===
powershell -ExecutionPolicy Bypass -NoProfile -Command "
$proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -gt 100 -and $_.Responding } | Select-Object -First 1;
Write-Host ('Target: PID=' + $proc.Id + ' Name=' + $proc.ProcessName);
$payload = '{ \"pids\": [' + $proc.Id + '] }';
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut);
$pipe.Connect(5000);
$r = New-Object System.IO.StreamReader($pipe);
$w = New-Object System.IO.StreamWriter($pipe);
$w.AutoFlush = $true;
$env = '{ \"v\": 1, \"cmd\": \"setAudioSessions\", \"payload\": ' + $payload + ' }';
$w.WriteLine($env);
$resp = $r.ReadLine();
$pipe.Dispose();
Write-Host ('Response: ' + $resp)
"

echo.
echo === 3. startCapture ===
powershell -ExecutionPolicy Bypass -NoProfile -Command "
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut);
$pipe.Connect(5000);
$r = New-Object System.IO.StreamReader($pipe);
$w = New-Object System.IO.StreamWriter($pipe);
$w.AutoFlush = $true;
$env = '{ \"v\": 1, \"cmd\": \"startCapture\", \"payload\": null }';
$w.WriteLine($env);
$resp = $r.ReadLine();
$pipe.Dispose();
Write-Host ('Response: ' + $resp)
"

echo Waiting 5 seconds for audio...
timeout /t 5 >nul

echo.
echo === 4. getStatus (check audioFallback) ===
powershell -ExecutionPolicy Bypass -NoProfile -Command "
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut);
$pipe.Connect(5000);
$r = New-Object System.IO.StreamReader($pipe);
$w = New-Object System.IO.StreamWriter($pipe);
$w.AutoFlush = $true;
$env = '{ \"v\": 1, \"cmd\": \"getStatus\", \"payload\": null }';
$w.WriteLine($env);
$resp = $r.ReadLine();
$pipe.Dispose();
Write-Host ('Status JSON: ' + $resp);
try {
    $obj = $resp | ConvertFrom-Json;
    $fb = $obj.payload.audioFallback;
    $rec = $obj.payload.recording;
    $cb = $obj.payload.captureBackend;
    Write-Host ('recording=' + $rec + ' audioFallback=' + $fb + ' captureBackend=' + $cb);
    if ($fb -eq $false) { Write-Host 'PASS: ProcessAudioSource funcionou! Sem fallback!' -ForegroundColor Green }
    else { Write-Host 'FAIL: Caiu em fallback - per-process loopback nao ativou' -ForegroundColor Red }
} catch { Write-Host 'Could not parse status' -ForegroundColor Red }
"

echo.
echo === 5. saveClip ===
powershell -ExecutionPolicy Bypass -NoProfile -Command "
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut);
$pipe.Connect(5000);
$r = New-Object System.IO.StreamReader($pipe);
$w = New-Object System.IO.StreamWriter($pipe);
$w.AutoFlush = $true;
$env = '{ \"v\": 1, \"cmd\": \"saveClip\", \"payload\": null }';
$w.WriteLine($env);
$resp = $r.ReadLine();
$pipe.Dispose();
Write-Host ('Response: ' + $resp)
"

echo.
echo === 6. stopCapture ===
powershell -ExecutionPolicy Bypass -NoProfile -Command "
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut);
$pipe.Connect(5000);
$r = New-Object System.IO.StreamReader($pipe);
$w = New-Object System.IO.StreamWriter($pipe);
$w.AutoFlush = $true;
$env = '{ \"v\": 1, \"cmd\": \"stopCapture\", \"payload\": null }';
$w.WriteLine($env);
$resp = $r.ReadLine();
$pipe.Dispose();
Write-Host ('Response: ' + $resp)
"

echo.
echo === Engine logs ===
echo -- stdout --
type "%TEMP%\engine-out.log"
echo.
echo -- stderr --
type "%TEMP%\engine-err.log"

powershell -ExecutionPolicy Bypass -NoProfile -Command "taskkill /f /im DiNho.Capture.Poc.exe >nul 2>&1"
echo.
echo === Teste concluido ===
