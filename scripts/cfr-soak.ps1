<#
.SYNOPSIS
    Harness de soak do plano CFR 60 fps (docs/plans/clips-cfr-60fps-padding-2026-10-03.md).

.DESCRIPTION
    Automatiza o soak pelo named pipe do engine (\\.\pipe\dinho-clips-engine), sem hotkeys
    nem cliques. Protocolo: envelope v1 em JSON, uma linha por mensagem (ReadLine/WriteLine).

    Limite de produto aqo: setReplayTime tem clamp duro Math.Clamp(secs, 30, 600)
    (IpcMessageHandler.Config.cs:66), por isso saveClip exporta no máximo 10 min. Cada
    "sessão" de 15/30 min e' feita em segmentos de 10 min medidos um a um.

.EXAMPLE
    .\cfr-soak.ps1 -Probe
    .\cfr-soak.ps1 -Session 15 -Label A
    .\cfr-soak.ps1 -Session 30 -Label C
    .\cfr-soak.ps1 -Glob "$env:USERPROFILE\Videos\DiNho Clips\*2026-10-03*.mp4"
#>
[CmdletBinding(DefaultParameterSetName = 'Measure')]
param(
    [Parameter(ParameterSetName = 'Probe')]      [switch]$Probe,
    [Parameter(ParameterSetName = 'Session')]    [ValidateSet(15, 30)][int]$Session = 15,
    [Parameter(ParameterSetName = 'Session')]    [ValidateSet('A', 'B', 'C')][string]$Label = 'A',
    [Parameter(ParameterSetName = 'Measure')]    [string]$Glob,
    [Parameter(ParameterSetName = 'Session')]    [string]$GameProcess = '',
    [int]$SegmentSeconds = 600,
    # Alvo CFR do clip. A app so suporta 30 ou 60 (normalizeFps em clips-quality-presets.ts),
    # por isso a whitelist e' exactamente essa. Todas as grelhas derivadas sao funcao do alvo:
    # um clip gravado a 30 FPS deve ser julgado contra 33,333 ms por frame de OBJECTO, e
    # nao sempre contra 60 - senao da' FAIL enganador num clip CFR-30 perfeito.
    [ValidateSet(30, 60)][int]$TargetFps = 60
)

$ErrorActionPreference = 'Stop'
$PipeName = 'dinho-clips-engine'
$Root     = 'C:\Users\Windows\Desktop\001'
$Ffmpeg   = Join-Path $Root 'resources\clips-engine-staging\ffmpeg.exe'
$OutDir   = Join-Path $Root 'resources\clips-engine-staging'
$LogDir   = Join-Path $env:APPDATA 'dinho-optimizer\logs'
$MeasureDir = Join-Path $env:TEMP 'opencode\cfr-soak'

# O engine corre ELEVADO (o app tem requireAdministrator) e o pipe e' CurrentUserOnly. O
# Mandatory Integrity Control do Windows bloqueia um cliente de integridade media de
# escrever num objecto high-integrity: "Access to the path is denied". Por isso o harness
# auto-eleva e passa a escrever o transcript num ficheiro.
$Self     = $MyInvocation.MyCommand.Path
$Elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
             ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$Transcript = Join-Path $MeasureDir "soak-$(Get-Date -Format yyyyMMdd-HHmmss).log"

# Relega sem shell: o stdout vai para o console E para o transcript (assim o run
# demorado pode ser acompanhado com Get-Content -Wait sem perder a saida formatada).
function Write-Run([string]$line) {
    Write-Host $line
    if ($Elevated) { Add-Content -LiteralPath $Transcript -Value $line -Encoding utf8 }
}

if (-not $Elevated -and $PSCmdlet.ParameterSetName -ne 'Measure') {
    New-Item -ItemType Directory -Force -Path $MeasureDir | Out-Null
    # `$args` esta VAZIO: `-Probe`etc. ligam por NOME aos parametros do script. Tem de se
    # reconstruir a invocacao a partir de `$PSBoundParameters`.
    $fwd = @()
    foreach ($n in 'Probe', 'Session', 'Label', 'GameProcess', 'SegmentSeconds', 'Glob') {
        if ($PSBoundParameters.ContainsKey($n)) {
            $fwd += "-$n"
            if ($n -ne 'Probe') { $fwd += "'" + $PSBoundParameters[$n] + "'" }
        }
    }
    $cmd = "& '$Self' $($fwd -join ' ')"
    Write-Host "relancando elevado: $cmd"
    Start-Process -FilePath (Get-Process -Id $PID).Path -Verb RunAs -WindowStyle Hidden `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd | Out-Null
    Write-Host "transcript: $Transcript   ->   Get-Content '$Transcript' -Wait"
    return
}

if ($Elevated) {
    New-Item -ItemType Directory -Force -Path $MeasureDir | Out-Null
    "=== soak $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') :: $((Get-Date).ToString('o')) ===" |
        Set-Content -LiteralPath $Transcript -Encoding utf8
}

# A janela do processo elevado e' Hidden: sem isto, um throw morre ali e o transcript
# fica truncado no ultimo "==>" sem dizer porque.
trap {
    Write-Run "!! ERRO $($_.Exception.GetType().Name): $($_.Exception.Message)"
    Write-Run "   linha $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())"
    Write-Run "   pos $($_.InvocationInfo.PositionMessage)"
    break
}

function Write-Step($m) { Write-Run "==> $m" }
function Write-Ok($m)   { Write-Run "    $m" }
function Write-Bad($m)  { Write-Run "    !! $m" }

# ── Cliente IPC: uma ligacao por invocacao (o engine responde linha a linha) ──────────
function Invoke-Engine {
    # Payload é [object] e não [hashtable]: o engine aceita valores escalares em alguns
    # comandos (setReplayTime lê msg.Value.GetInt32(), ou seja, exige um número cru,
    # não um objeto).
    param([Parameter(Mandatory)][string]$Command, [object]$Payload, [int]$TimeoutSec = 20)

    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(5000)
    try {
        $env = @{ v = 1; cmd = $Command; reqId = [guid]::NewGuid().ToString('N') }
        if ($PSBoundParameters.ContainsKey('Payload') -and $null -ne $Payload) { $env.payload = $Payload }
        $json = $env | ConvertTo-Json -Compress -Depth 8
        $sw = [System.IO.StreamWriter]::new($pipe, [System.Text.UTF8Encoding]::new($false))
        $sw.AutoFlush = $true
        $sw.WriteLine($json)

        $sr = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8)
        $task = $sr.ReadLineAsync()
        if (-not $task.Wait($TimeoutSec * 1000)) { throw "timeout de ${TimeoutSec}s à resposta de $Command" }
        $line = $task.Result
        if ([string]::IsNullOrWhiteSpace($line)) { throw "resposta vazia a $Command" }
        return ($line | ConvertFrom-Json)
    } finally { $pipe.Dispose() }
}

# saveClip e' long-running: o server responde {status=accepted} e o resultado vem
# numa ligacao subsequente. O drain so acontece no cliente que fica ligado.
function Save-ClipAndWait {
    param([int]$TimeoutSec = 300)

    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(5000)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $before = @(Get-ChildItem (Join-Path $env:USERPROFILE 'Videos\DiNho Clips') -Filter *.mp4 -EA SilentlyContinue).Count
    try {
        $sw = [System.IO.StreamWriter]::new($pipe, [System.Text.UTF8Encoding]::new($false))
        $sw.AutoFlush = $true
        $sw.WriteLine((@{ v = 1; cmd = 'saveClip'; reqId = [guid]::NewGuid().ToString('N') } | ConvertTo-Json -Compress))

        $sr = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8)
        $accepted = $null
        while ((Get-Date) -lt $deadline) {
            $t = $sr.ReadLineAsync()
            if (-not $t.Wait(5000)) { continue }
            $line = $t.Result
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $msg = $line | ConvertFrom-Json
            if ($msg.cmd -eq 'saveClip' -and $msg.payload.status -eq 'accepted') { $accepted = $msg; continue }
            if ($msg.cmd -eq 'saveClip') { return $msg }   # resultado final
            if ($msg.cmd -eq '_event') { continue }        # broadcast de status
        }
        throw 'saveClip excedeu o timeout'
    } finally { $pipe.Dispose() }
}

function Get-CfrLine {
    param([string]$Since)
    $log = Get-ChildItem $LogDir -Filter *.jsonl -EA SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $log) { throw "sem JSONL em $LogDir" }
Get-Content $log.FullName | Select-String '\[FeedTelemetry\]' |
             ForEach-Object { try { $_.Line | ConvertFrom-Json } catch { } } |
             Where-Object { $_.message -and $_.message -match 'totalMax=' }
}

function Unwrap-Status($resp) {
    # getStatus responde com payload.value (dois niveis), nao .payload.
    if ($null -eq $resp) { return $null }
    $v = $resp.payload
    if ($null -ne $v -and $null -ne $v.value) { return $v.value }
    if ($null -ne $v) { return $v }
    if ($null -ne $resp.value) { return $resp.value }
    return $null
}

function Measure-Clips {
    param([string]$Pattern)

    New-Item -ItemType Directory -Force -Path $MeasureDir | Out-Null
    $clips = @(Get-ChildItem $Pattern -EA SilentlyContinue | Sort-Object LastWriteTime)
    if ($clips.Count -eq 0) { throw "nenhum clip em $Pattern" }

    $rows = @()
    foreach ($c in $clips) {
        # ── Vista fina (ms, timescale do contentor = 1/16000): a que reproduz o baseline ──
# showinfo exige DECODIFICACAO: ~4 min por clip de 5 min. E' a unica via sem ffprobe.
# `-nostdin` e obrigatorio: por omissao o ffmpeg le stdin para comandos interactivos
# e, lanado a partir de uma janela elevada oculta com o handle herdado partido, fica
# BLOQUEADO indefinidamente sem consumir CPU (observado: 0,06 s de CPU em 20 min, sem
# .crc escrito). Nao e um timeout - nao termina nunca sozinho.
Write-Step "showinfo (decodifica): $($c.Name)"
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $log = & $Ffmpeg -nostdin -hide_banner -loglevel info -i $c.FullName -vf showinfo -f null - 2>&1
        $sw.Stop()
        $t = @($log | ForEach-Object {
            if ($_ -match 'n:\s*\d+ pts:\s*\d+ pts_time:([0-9.]+)') { [double]$Matches[1] }
        })
        if ($t.Count -lt 2) { throw "showinfo devolveu $($t.Count) frames de $($c.Name)" }

        $d = @()
        $mono = $true
        for ($i = 1; $i -lt $t.Count; $i++) {
            $d += ($t[$i] - $t[$i - 1]) * 1000.0
            if ($t[$i] -le $t[$i - 1]) { $mono = $false }
        }
        $spanS = $t[-1] - $t[0]
        # Toda a grelha deriva do alvo, nao de 60 hardcoded. A 60 fps reproduz os valores
        # historicos (18,33 e 33,33 ms); a 30 fps o periodo dobra e o excesso passa a medir
        # 33,333 ms de fundo de escala.
        $periodMs = 1000.0 / $TargetFps
        $thr1 = $periodMs * 1.1
        $thr2 = $periodMs * 2.0
        $nominalS = ($t.Count - 1) / $TargetFps
        $hist = ($d | ForEach-Object { [math]::Round($_) } | Group-Object |
                Sort-Object { [int]$_.Name } | ForEach-Object { "$($_.Name):$($_.Count)" }) -join ' '

        # ── Vista estrutural (ticks): T2/T3 = frames REALMENTE ausentes do ficheiro ──
        # O framecrc reduz o timescale a 1001/60000 (tick 16,6833 ms), mais grosso: uma
        # fuga de 1,3 ms que a vista fina conta como anomalia desaparece aqui. Serve para
        # confirmar quantos frames NAO foram escritos.
        Write-Step "framecrc (estrutural): $($c.Name)"
        $crc = Join-Path $MeasureDir ($c.BaseName + '.crc')
        & $Ffmpeg -nostdin -v error -i $c.FullName -map 0:v:0 -f framecrc $crc 2>&1 | Out-Null
        $lines = Get-Content $crc
        $tb = $lines | Where-Object { $_ -like '#tb*' } | Select-Object -First 1
        $ticks = @()
        if ($tb -match '#tb\s*\d*:\s*(\d+)/(\d+)') {
            $ticks = @($lines | Where-Object { $_ -match '^\s*\d+,' } |
                       ForEach-Object { [int64](($_ -split ',')[2].Trim()) })
        }
        $t2 = 0; $t3 = 0
        for ($i = 1; $i -lt $ticks.Count; $i++) {
            $delta = $ticks[$i] - $ticks[$i - 1]
            if ($delta -eq 2) { $t2++ } elseif ($delta -ge 3) { $t3++ }
        }

        $rows += [pscustomobject]@{
            Clip     = $c.Name
            Segundos = [math]::Round($spanS, 2)
            Frames   = $t.Count
            Fps      = [math]::Round(($t.Count - 1) / $spanS, 2)
            AlvoFps = $TargetFps
            D18      = @($d | Where-Object { $_ -ge $thr1 }).Count
            D34      = @($d | Where-Object { $_ -ge $thr2 }).Count
            DMax     = [math]::Round((($d | Measure-Object -Maximum).Maximum), 2)
            DAvg     = [math]::Round((($d | Measure-Object -Average).Average), 3)
            ExcessoS = [math]::Round($spanS - $nominalS, 3)
            T2       = $t2
            T3       = $t3
            Monotonico = $mono
            DecodS   = [math]::Round($sw.Elapsed.TotalSeconds, 0)
            Histograma = $hist
        }
    }

    $rows | Select-Object Clip, Segundos, Frames, Fps, AlvoFps, D18, D34, DMax, DAvg, ExcessoS, T2, T3, Monotonico, DecodS |
        Format-Table -AutoSize | Out-String -Width 220 | Write-Output
    $rows | Export-Csv (Join-Path $MeasureDir 'clips.csv') -NoTypeInformation
    Write-Output "=> $(Join-Path $MeasureDir 'clips.csv')"
    Write-Output ""
    Write-Output "histogramas (delta_ms:contagem):"
    $rows | ForEach-Object { Write-Output "  $($_.Clip)"; Write-Output "    $($_.Histograma)" }
}

# ── Modos ─────────────────────────────────────────────────────────────────────────────
if ($PSCmdlet.ParameterSetName -eq 'Probe') {
    Write-Step 'handshake'
    Write-Run ('    ' + ((Invoke-Engine -Command 'handshake' -Payload @{ protoVersion = 1 }) | ConvertTo-Json -Depth 6 -Compress))
    Write-Step 'getStatus'
    $st = (Unwrap-Status (Invoke-Engine -Command 'getStatus'))
    Write-Run ('    ' + ($st | ConvertTo-Json -Depth 6 -Compress))
    Write-Ok "replay buffer: $($st.replayBufferVideoFrames) frames / $($st.replayBufferBytes) bytes"
    Write-Step 'setReplayTime 600 (limite do produto)'
    Invoke-Engine -Command 'setReplayTime' -Payload 600 | Out-Null
    Write-Ok 'replay = 600 s'
    return
}

if ($PSCmdlet.ParameterSetName -eq 'Measure') {
    if (-not (Test-Path $Ffmpeg)) { throw "ffmpeg embarcado em falta: $Ffmpeg" }
    Measure-Clips -Pattern $Glob
    return
}

# ── Soak ─────────────────────────────────────────────────────────────────────────────
if (-not (Test-Path $Ffmpeg)) { throw "ffmpeg embarcado em falta: $Ffmpeg" }

$segments = [math]::Ceiling($Session / 10)
Write-Step "Sessão $Label — $segments segmentos x $SegmentSeconds s (~${Session} min)"

Write-Step 'preflight'
$st = (Unwrap-Status (Invoke-Engine -Command 'getStatus'))
if ($st.activePipelines -lt 1) { throw "activePipelines=$($st.activePipelines) — alvo de captura invalido" }
    Write-Ok "activePipelines=$($st.activePipelines) captureBackend=$($st.captureBackend) mode=$($st.captureMode) codec=$($st.codec)"
    Write-Ok "processo alvo: $($st.game)  recording=$($st.recording)"
Invoke-Engine -Command 'setReplayTime' -Payload $SegmentSeconds | Out-Null
Write-Ok "replay = $SegmentSeconds s (clamp 30..600)"
if ($PSBoundParameters.ContainsKey('GameProcess') -and $GameProcess) {
    Invoke-Engine -Command 'startCapture' -Payload @{ gameProcess = $GameProcess } | Out-Null
    Write-Ok "startCapture gameProcess=$GameProcess"
}

$SessionStart = Get-Date
for ($i = 1; $i -le $segments; $i++) {
    Write-Step "segmento $i/$segments — $SegmentSeconds s"
    $t0 = Get-Date
    Start-Sleep -Seconds $SegmentSeconds
    $elapsed = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Write-Ok "dormiu ${elapsed}s — a guardar"

    $r = Save-ClipAndWait
    if ($r.payload.action -eq 'error') { Write-Bad "saveClip erro: $($r.payload.error)" }
    else { Write-Ok "saveClip ok ($elapsed s de gravação)" }

    # Campos do envelope v1 (NamedPipeServer.EngineStatusValue): ActivePipelines,
    # LastFrameMs, DroppedFrames, GpuBusyDrops, ReplayBufferVideoFrames. O `activeFps`
    # do log de 5 s do FeedTelemetry e' a leitura de fps que interessa.
    $st2 = (Unwrap-Status (Invoke-Engine -Command 'getStatus'))
    Write-Ok "activePipelines=$($st2.activePipelines) lastFrameMs=$($st2.lastFrameMs) dropped=$($st2.droppedFrames) gpuBusy=$($st2.gpuBusyDrops) bufferFrames=$($st2.replayBufferVideoFrames)"
}

Write-Step 'bloco CFR do log'
Get-CfrLine | Select-Object -Last 12 | ForEach-Object { Write-Run "    $($_.data.msg)" }

Write-Step "clips da sessão $Label (gravados depois de $stamp)"
Get-ChildItem (Join-Path $env:USERPROFILE 'Videos\DiNho Clips') -Filter *.mp4 |
    Where-Object { $_.LastWriteTime -gt $SessionStart } |
    Sort-Object LastWriteTime | ForEach-Object { Write-Run "    $($_.Name)  [$($_.LastWriteTime.ToString('HH:mm:ss'))]" }

Write-Ok 'sessão concluída — medir com -Measure'