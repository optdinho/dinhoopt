$engDir = 'C:\Users\Administrator\Desktop\001\dinho-clips-poc\src\DiNho.Capture.Poc\bin\Release\net9.0-windows10.0.26100.0\publish'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = Join-Path $engDir 'DiNho.Capture.Poc.exe'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = $engDir
$p = [System.Diagnostics.Process]::Start($psi)
Write-Host "Engine PID: $($p.Id)"
Start-Sleep 3

$envBytes = [System.Text.Encoding]::UTF8.GetBytes('{"v":1,"cmd":"getAudioSessions","payload":null}' + "`n")
$pc = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'dinho-clips-engine', [System.IO.Pipes.PipeDirection]::InOut)
$pc.Connect(10000)
Write-Host 'Connected' -ForegroundColor Green
$pc.Write($envBytes, 0, $envBytes.Length)
Write-Host 'Sent' -ForegroundColor Green
Start-Sleep 2

$buf = New-Object byte[] 16384
if ($pc.DataAvailable) {
    $read = $pc.Read($buf, 0, $buf.Length)
    $resp = [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
    Write-Host 'Response:' -ForegroundColor Cyan
    Write-Host $resp
} else {
    Write-Host 'No response data' -ForegroundColor Yellow
}
$pc.Dispose()

Start-Sleep 1
$err = $p.StandardError.ReadExisting()
if ($err) { Write-Host "--- stderr ---"; Write-Host $err }
$out = $p.StandardOutput.ReadExisting()
if ($out) { Write-Host "--- stdout ---"; Write-Host $out }
if (-not $p.HasExited) { $p.Kill() }
