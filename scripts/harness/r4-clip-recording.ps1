# R4 — E2E de clip real (harness, NÃO corre na suite vitest default).
#
# Porquê este ficheiro existe
# ---------------------------
# Nenhuma spec E2E de clips faz um save real: o engine/pipe nunca assertou
# sucesso e um ".mp4" nunca foi aberto. Este harness fecha esse buraco: faz um
# saveClip REAL pelo pipe e prova que o ficheiro resultante tem frames > 0.
#
# Não duplica a orquestração: o save vive no soak-cfr.ps1 (-Capture) e a medição
# no cfr-soak.ps1 (-Glob, o mesmo caminho do gate CFR do AGENTS). Aqui só se
# acrescenta a ASSERT final (frames > 0 + exit code) que faltava.
#
# Uso
# ---
#   # com a app a GRAVAR (elevada): 1 press pelo pipe, depois verifica o clip
#   pwsh -NoProfile -File scripts/harness/r4-clip-recording.ps1 -Capture
#
#   # verificar um clip já existente
#   pwsh -NoProfile -File scripts/harness/r4-clip-recording.ps1 -ClipPath "$env:USERPROFILE\Videos\DiNho Clips\x.mp4"
#
#   # sem argumentos: verifica o clip mais recente da pasta
#   pwsh -NoProfile -File scripts/harness/r4-clip-recording.ps1
#
# Pré-requisitos (por isso NUNCA entra no vitest default nem no CI):
#   - Windows + GPU + engine a gravar (para -Capture)
#   - ffmpeg embarcado em resources/clips-engine-staging/ffmpeg.exe
#
# AVISO: escrito mas NÃO executado nesta sessão (exige GPU + app elevada a
# gravar). O ramo de verificação reutiliza cfr-soak.ps1, já validado; o ramo de
# captura reutiliza soak-cfr.ps1, também já validado. Riscos conhecidos em
# comentário no fim do ficheiro.
[CmdletBinding()]
param(
    [switch]$Capture,
    [string]$ClipPath,
    [ValidateSet(30, 60)][int]$TargetFps = 60,
    [int]$TimeoutSec = 420
)

$ErrorActionPreference = 'Stop'

$Root     = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Ffmpeg   = Join-Path $Root 'resources\clips-engine-staging\ffmpeg.exe'
$ClipDir  = Join-Path $env:USERPROFILE 'Videos\DiNho Clips'
$RunDir   = Join-Path $env:TEMP 'opencode\cfr-soak'
$Soak     = Join-Path $Root 'scripts\soak-cfr.ps1'
$Measure  = Join-Path $Root 'scripts\cfr-soak.ps1'
$ResultsCsv = Join-Path $RunDir 'clips.csv'

function Say($m) { Write-Host "$(Get-Date -Format 'HH:mm:ss')  $m" }

# ── preflight ───────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $Ffmpeg)) {
    Say "ABORTA: ffmpeg embarcado em falta ($Ffmpeg)."
    exit 2
}
if (-not (Test-Path -LiteralPath $Measure)) {
    Say "ABORTA: medidor em falta ($Measure)."
    exit 2
}

# ── -Capture: delega a captura ao soak-cfr.ps1 (saveClip pelo pipe) ──────────
if ($Capture) {
    if (-not (Test-Path -LiteralPath $Soak)) { Say "ABORTA: $Soak em falta."; exit 2 }
    Say 'CAPTURE: soak-cfr.ps1 -Capture -Presses 1 (saveClip pelo pipe)...'
    # O soak-cfr.ps1 auto-eleva e espera. `-IntervalSec 0` = 1 unico save, sem sleep.
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $Soak -Capture -Presses 1 -IntervalSec 0
    if ($LASTEXITCODE -ne 0) { Say "AVISO: soak-cfr.ps1 devolveu exit $LASTEXITCODE" }

    # O manifesto mais recente diz o nome do clip produzido.
    $manifest = Get-ChildItem -LiteralPath $RunDir -Filter 'manifest-*.csv' -EA SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($manifest) {
        $rows = @(Import-Csv -LiteralPath $manifest.FullName)
        if ($rows.Count -gt 0) { $ClipPath = Join-Path $ClipDir $rows[-1].Name }
    }
}

# ── escolher o clip a verificar ──────────────────────────────────────────────
if (-not $ClipPath) {
    $latest = Get-ChildItem -LiteralPath $ClipDir -Filter *.mp4 -EA SilentlyContinue |
              Where-Object { $_.Name -notlike '*.partial.mp4' } |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { Say "ABORTA: nenhum clip em $ClipDir."; exit 2 }
    $ClipPath = $latest.FullName
}

if (-not (Test-Path -LiteralPath $ClipPath)) {
    Say "ABORTA: clip não encontrado — $ClipPath"
    exit 2
}

Say "clip: $ClipPath  (alvo ${TargetFps} fps)"

# ── medir com o medidor real (cfr-soak.ps1 -Glob escreve $ResultsCsv) ─────────
if (Test-Path -LiteralPath $ResultsCsv) { Remove-Item -LiteralPath $ResultsCsv -Force }
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& pwsh -NoProfile -ExecutionPolicy Bypass -File $Measure -Glob $ClipPath -TargetFps $TargetFps *> $null
$sw.Stop()
Say ("medição terminou em {0:N0}s" -f $sw.Elapsed.TotalSeconds)

if (-not (Test-Path -LiteralPath $ResultsCsv)) {
    Say "FALHA: o medidor não escreveu $ResultsCsv (clip ilegível ou ffmpeg falhou)."
    exit 1
}

$row = Import-Csv -LiteralPath $ResultsCsv | Select-Object -Last 1
if (-not $row) { Say 'FALHA: clips.csv vazio.'; exit 1 }

$frames = 0
[void][int]::TryParse([string]$row.Frames, [ref]$frames)

Say ("{0}  frames={1}  fps={2}  segundos={3}" -f $row.Clip, $row.Frames, $row.Fps, $row.Segundos)

if ($frames -gt 0) {
    Say "VEREDITO: PASS — clip real com $frames frames (>0)."
    exit 0
}

Say 'VEREDITO: FAIL — clip sem frames (o save produziu um ficheiro vazio/inválido).'
exit 1

# ── riscos conhecidos (não verificados nesta sessão) ─────────────────────────
# 1. `clips.csv` é reescrito a cada -Glob; apagamo-lo antes para não ler uma
#    linha obsoleta. Se o medidor mudar de nome de ficheiro, ajustar $ResultsCsv.
# 2. Em -Capture, o soak-cfr.ps1 auto-eleva via UAC; correr isto de uma consola
#    já elevada evita um segundo prompt.
# 3. O medidor descodifica o clip inteiro (~4 min/clip a 1080p60). Para um clip
#    de 300 s isto é lento de propósito — é o mesmo caminho do gate do AGENTS.
