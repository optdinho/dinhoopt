# Soak CFR 60 — orquestrador robusto em 3 fases.
#
# Porquê um script novo e não o soak-hotkey.ps1 antigo: aquele pressionava F12 sem
# verificar nada. A 2026-10-03 a app morreu às 17:43 e o injectdor continuou a
# premir F12 durante 25 minutos no vazio (6 clips nunca apareceram). Aqui cada
# premida é verificada: engine vivo, clip novo confirmado, e aborta com diagnóstico.
#
# FASES (nunca misturadas — ver AGENTS.md):
#   1. Capture : app a gravar, injectamos F12 N vezes. NENHUMA medição aqui.
#   2. Measure : app fechada, descodificamos os clips com showinfo. Lento (~4 min/clip).
#   A mistura das duas matou a app em 2026-10-03.
[CmdletBinding(DefaultParameterSetName = 'Capture')]
param(
    [Parameter(ParameterSetName = 'Capture')][switch]$Capture,
    [Parameter(ParameterSetName = 'Capture')][int]$Presses = 7,
    [Parameter(ParameterSetName = 'Capture')][int]$IntervalSec = 300,
    [Parameter(ParameterSetName = 'Capture')][int]$Vk = 123,   # F12 = clip de 300s
    [Parameter(ParameterSetName = 'Measure')][switch]$Measure,
    # Rejulga um results-*.csv ja medido sem voltar a descodificar (~1 s em vez de
    # ~4 min/clip). Existe porque o criterio de aceitacao mudou depois do soak
    # 6/6: sem isto, corrigir o veredicto obrigaria a repetir 60 min de medicao.
    [Parameter(ParameterSetName = 'Measure')][string]$ResultsPath,
    # Alvo CFR com que o clip foi gravado (a app so aceita 30 ou 60 - normalizeFps).
    # Tem de bater certo com a config no momento da captura: e' a grelha contra a qual
    # fps, D18/D34 e excesso sao julgados. Default 60 mantem o comportamento anterior.
    [Parameter(ParameterSetName = 'Measure')][ValidateSet(30, 60)][int]$TargetFps = 60
)

$RunDir      = "$env:TEMP\opencode\cfr-soak"
$PipeName    = 'dinho-clips-engine'
$ClipDir     = "$env:USERPROFILE\Videos\DiNho Clips"
$Injector    = "$env:TEMP\opencode\injector-save.ps1"
$LogDir      = "$env:APPDATA\dinho-optimizer\logs"
$Stamp       = Get-Date -Format yyyyMMdd-HHmmss
$Log         = Join-Path $RunDir "run-$Stamp.log"
$HealthCsv   = Join-Path $RunDir "health-$Stamp.csv"
$ManifestCsv = Join-Path $RunDir "manifest-$Stamp.csv"
$ResultsCsv  = Join-Path $RunDir "results-$Stamp.csv"

New-Item -ItemType Directory -Path $RunDir -Force | Out-Null

function Say($m) {
    $line = "$(Get-Date -Format 'HH:mm:ss')  $m"
    Write-Host $line
    Add-Content -LiteralPath $Log -Value $line -Encoding utf8
}

# ── auto-elevação (SendInput para a app elevada é bloqueado por UIPI) ──────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    # Um [switch] tem de ser passado PELO NOME. `-Measure True` chega ao processo
    # elevado como argumento posicional e muda o parameter set, pelo que o script
    # deixava de measure. Os valores que nao sao switch vao citados.
    $switchNames = @('Capture', 'Measure')
    $fwd = @()
    foreach ($k in $PSBoundParameters.Keys) {
        $fwd += "-$k"
        if ($switchNames -notcontains $k) { $fwd += "`"$($PSBoundParameters[$k])`"" }
    }
    # `-Verb RunAs` nao pode ser combinado com -RedirectStandardOutput (Start-Process
    # usa o parameter set ShellExecute). Sem `-Wait` e sem redireccao, o processo
    # elevado corria as costas do chamador e TODO o output se perdia - foi o que
    # aconteceu na primeira tentativa de medir o 7.o clip. Passamos por cmd.exe,
    # que redigere para o MESMO log, e esperamos.
    $exe = (Get-Process -Id $PID).Path
    # `*>&1` e sintaxe do PowerShell e nao do cmd: com `-File` ele chega ao script
    # como argumento posicional e mata o processo. O redireccionamento e do cmd.
    $inner = "`"$exe`" -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $($fwd -join ' ') >> `"$Log`" 2>&1"
    $cmdLine = "cd /d `"$PWD`" && $inner"
    Say "auto-elevar: $cmdLine"
    Start-Process -FilePath cmd.exe -ArgumentList '/c', $cmdLine -Verb RunAs -Wait -WindowStyle Hidden | Out-Null
    Say "auto-elevar terminou"
    return
}

# ── plumbing do pipe ────────────────────────────────────────────────────────
function Invoke-Engine {
    param([string]$Command, [object]$Payload, [int]$TimeoutSec = 15)
    $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(4000)
    try {
        $env = @{ v = 1; cmd = $Command; reqId = [guid]::NewGuid().ToString('N') }
        if ($PSBoundParameters.ContainsKey('Payload') -and $null -ne $Payload) { $env.payload = $Payload }
        $sw = [System.IO.StreamWriter]::new($pipe, [System.Text.UTF8Encoding]::new($false))
        $sw.AutoFlush = $true
        $sw.WriteLine(($env | ConvertTo-Json -Compress -Depth 8))
        $sr = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8)
        $task = $sr.ReadLineAsync()
        if (-not $task.Wait($TimeoutSec * 1000)) { throw "timeout de ${TimeoutSec}s em $Command" }
        return ($task.Result | ConvertFrom-Json)
    } finally { $pipe.Dispose() }
}

# O engine responde a getStatus com payload.value (DOIS niveis):
#   {v:1,cmd:"getStatus",payload:{event:"engineStatus",version:"1.0",value:{...}}}
# Ler só .payload devolve null e faz o preflight abortar com a app saudavel.
function Unwrap-Status($resp) {
    if ($null -eq $resp) { return $null }
    $v = $resp.payload
    if ($null -ne $v -and $null -ne $v.value) { return $v.value }
    if ($null -ne $v) { return $v }
    if ($null -ne $resp.value) { return $resp.value }
    return $null
}

# ── detecção de vida ────────────────────────────────────────────────────────
function Get-Liveness {
    $proc = @(Get-Process DiNho.Capture.Poc -EA SilentlyContinue)
    $pipe = Test-Path "\\.\pipe\$PipeName"
    $st = $null
    try { $st = Unwrap-Status (Invoke-Engine -Command 'getStatus' -TimeoutSec 8) } catch { }
    [pscustomobject]@{
        EngineProc   = $proc.Count
        Pipe         = $pipe
        Ok           = ($proc.Count -gt 0 -and $pipe -and $null -ne $st)
        Recording    = [bool]$st.recording
        Pipelines    = [int]$st.activePipelines
        WatchdogOk   = [bool]$st.watchdogOk
        MemoryMB     = [int]$st.memoryMB
        ReplayMB     = [math]::Round(([double]$st.replayBufferBytes / 1MB), 1)
        Dropped      = [int]$st.droppedFrames
    }
}

# Memória do engine a partir das linhas [RAM] (1/s). É a assinatura que
# antecedeu a morte de 2026-10-03 17:43 — sem isto não há como diagnosticar.
function Add-HealthRow($live, $phase) {
    $ram = ''
    try {
        $log = Get-ChildItem $LogDir -Filter *.jsonl -EA SilentlyContinue |
               Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($log) {
            $hit = Get-Content $log.FullName -Tail 400 -EA SilentlyContinue |
                   Select-String '\[RAM\]' | Select-Object -Last 1
            if ($hit) { $ram = $hit.Line }
        }
    } catch { }
    $num = { param($k) $m = [regex]::Match($ram, "$k=(\d+)MB"); if ($m.Success) { $m.Groups[1].Value } else { '' } }
    $row = [pscustomobject]@{
        Time       = (Get-Date -Format 'HH:mm:ss')
        Phase      = $phase
        EngineProc = $live.EngineProc
        Pipe       = $live.Pipe
        Recording  = $live.Recording
        Pipelines  = $live.Pipelines
        WatchdogOk = $live.WatchdogOk
        MemMB      = $live.MemoryMB
        ReplayMB   = $live.ReplayMB
        Dropped    = $live.Dropped
        ProcMB     = (& $num 'proc')
        GcManaged  = (& $num 'gcManaged')
        NativeMB   = (& $num 'native')
        LohMB      = (& $num 'loh')
    }
    if (Test-Path $HealthCsv) { $row | Export-Csv -LiteralPath $HealthCsv -Append -NoTypeInformation -Encoding utf8 }
    else { $row | Export-Csv -LiteralPath $HealthCsv -NoTypeInformation -Encoding utf8 }
    $row
}

# ── save por PIPE, não por injecção de tecla ────────────────────────────────
# Porquê: o HotkeyManager do engine faz POLL de GetAsyncKeyState e o SendInput
# prime-down/prime-up passa entre dois tiques — a 2026-10-03 19:21 o F12 foi
# injectado 7 vezes com a app viva e NENHUM save ocorreu. O pipe é determinístico
# e devolve o resultado (caminho + tamanho), o que valida a guarda 2.
# Bónus: é o proprio multi-cliente a ser usado como cliente externo.
function Save-ClipViaPipe {
    param([int]$TimeoutSec = 420)

    # Regra dura: NUNCA abandonar um ReadLineAsync pendente e iniciar outro. Perder a
    # leitura dessincroniza o stream e perde a resposta. Reutilizamos UMA task.
    # E o ground-truth nao e a resposta: e o FICHEIRO em disco. A resposta do pipe e
    # so telemetria — a 2026-10-03 19:27 o clip foi salvo (1,42 GB) mas a resposta
    # nao chegou e o script ficou pendurado ate ao timeout.
    $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(5000)
    $mark = Get-Date
    try {
        $sw = [System.IO.StreamWriter]::new($pipe, [System.Text.UTF8Encoding]::new($false))
        $sw.AutoFlush = $true
        $sw.WriteLine((@{ v = 1; cmd = 'saveClip'; reqId = [guid]::NewGuid().ToString('N') } | ConvertTo-Json -Compress))
        $sr = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8)

        $deadline = (Get-Date).AddSeconds($TimeoutSec)
        $readTask = $null
        $result = $null
        $lastSize = -1
        $stable = 0

        while ((Get-Date) -lt $deadline) {
            if ($null -eq $readTask) { $readTask = $sr.ReadLineAsync() }
            if ($readTask.Wait(1000)) {
                $line = $null
                try { $line = $readTask.Result } catch { }
                $readTask = $null
                if ($line) {
                    try {
                        $msg = $line | ConvertFrom-Json
                        if ($msg.cmd -eq 'saveClip' -and $msg.payload.status -ne 'accepted') { $result = $msg }
                    } catch { }
                }
            }

            # ground truth: clip novo com tamanho estavel
            $c = @(Get-ChildItem $ClipDir -Filter *.mp4 -EA SilentlyContinue |
                   Where-Object { $_.LastWriteTime -gt $mark -and $_.Name -notlike '*.partial.mp4' } |
                   Sort-Object LastWriteTime -Descending | Select-Object -First 1)
            if ($c.Count -gt 0 -and $c[0].Length -gt 0) {
                if ($c[0].Length -eq $lastSize) { $stable++ } else { $stable = 0; $lastSize = $c[0].Length }
                if ($stable -ge 2) { return [pscustomobject]@{ Clip = $c[0]; Result = $result } }
            }
        }
        throw "saveClip: nenhum clip estavel em ${TimeoutSec}s"
    } finally { $pipe.Dispose() }
}

# ── espera por clip novo com tamanho estável ────────────────────────────────
function Wait-NewClip {
    param([datetime]$Since, [int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $seen = $null
    while ((Get-Date) -lt $deadline) {
        $c = @(Get-ChildItem $ClipDir -Filter *.mp4 -EA SilentlyContinue |
               Where-Object { $_.LastWriteTime -gt $Since -and $_.Name -notlike '*.partial.mp4' } |
               Sort-Object LastWriteTime -Descending | Select-Object -First 1)
        if ($c.Count -gt 0) {
            $len = $c[0].Length
            Start-Sleep -Seconds 6
            $again = Get-Item $c[0].FullName -EA SilentlyContinue
            if ($again -and $again.Length -eq $len -and $len -gt 0) { return $again }
            $seen = $again
        }
        Start-Sleep -Seconds 5
    }
    if ($seen) { return $seen }
    return $null
}

# ════════════════════════════════════════════════════════════════════════════
#  FASE 1 — CAPTURE
# ════════════════════════════════════════════════════════════════════════════
if ($PSCmdlet.ParameterSetName -eq 'Capture') {
    Say "=== FASE 1 CAPTURE: $Presses x F12 de ${IntervalSec}s ==="
    Say "log: $Log   health: $HealthCsv"

    $live = Get-Liveness
    Add-HealthRow $live 'preflight' | Out-Null
    if (-not $live.Ok) {
        Say "ABORTA: engine ausente ou sem resposta (proc=$($live.EngineProc) pipe=$($live.Pipe)). Arranca a captura na app primeiro."
        return
    }
    if (-not $live.Recording -or $live.Pipelines -lt 1) {
        Say "ABORTA: recording=$($live.Recording) pipelines=$($live.Pipelines) — a app tem de estar a GRAVAR um alvo."
        return
    }
    Say "OK engine vivo, recording=$($live.Recording) pipelines=$($live.Pipelines) watchdog=$($live.WatchdogOk) mem=$($live.MemoryMB)MB"

    $startAt = Get-Date
    $produced = @()

    for ($i = 1; $i -le $Presses; $i++) {
        # GUARDA 1: o engine tem de estar vivo. Sem isto repetimos o erro de 17:45.
        $live = Get-Liveness
        Add-HealthRow $live "press$i-before" | Out-Null
        if (-not $live.Ok) {
            Say "ABORTA no press #${i}: engine morreu (proc=$($live.EngineProc) pipe=$($live.Pipe)). Ver health-$Stamp.csv."
            break
        }

        Say "press #${i}/$Presses  mem=$($live.MemoryMB)MB replay=$($live.ReplayMB)MB dropped=$($live.Dropped)"
        # saveClip pelo pipe (a injecção de tecla não é fiável — ver Save-ClipViaPipe).
        $res = Save-ClipViaPipe -TimeoutSec 420
        $clip = $res.Clip
        if ($res.Result) { Say "  resposta: $(($res.Result | ConvertTo-Json -Compress -Depth 4))" }
        if (-not $clip) {
            Say "ABORTA no press #${i}: o save nao produziu clip."
            break
        }

        # GUARDA 2 já é feita dentro de Save-ClipViaPipe (clip novo + tamanho estável
        # no disco). Um save falhado nunca passa por "ok".
        Say ("  -> {0}  {1:N1} MB" -f $clip.Name, ($clip.Length / 1MB))
        $produced += $clip
        $produced | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } },
                             @{n = 'Hora'; e = { $_.LastWriteTime.ToString('HH:mm:ss') } } |
            Export-Csv -LiteralPath $ManifestCsv -NoTypeInformation -Encoding utf8

        if ($i -lt $Presses) {
            Say "  a dormir ${IntervalSec}s (a amostrar memoria cada 15s)..."
            $until = (Get-Date).AddSeconds($IntervalSec)
            while ((Get-Date) -lt $until) {
                Start-Sleep -Seconds 15
                $live = Get-Liveness
                Add-HealthRow $live "press$i-sleep" | Out-Null
                if (-not $live.Ok) { Say "ABORTA durante o sono: engine morreu. Ver health-$Stamp.csv."; break }
            }
            if (-not (Get-Liveness).Ok) { break }
        }
    }

    Say "=== CAPTURE terminou: $($produced.Count)/$Presses clips ==="
    if ($produced.Count -gt 0) {
        Say "manifesto: $ManifestCsv"
        Say 'Nao mecas agora. Fecha a app e corre:  -Measure'
    }
    return
}

# ════════════════════════════════════════════════════════════════════════════
#  FASE 2 — MEASURE  (so com a app FECHADA)
# ════════════════════════════════════════════════════════════════════════════
# O medidor vive ao lado deste script (scripts/cfr-soak.ps1, versionado). O
# TEMP mantem-se como fallback para quem ainda tenha a copia antiga.
$ScriptDir = Split-Path -Parent $PSCommandPath
$harn = Join-Path $ScriptDir 'cfr-soak.ps1'
if (-not (Test-Path $harn)) { $harn = "$env:TEMP\opencode\cfr-soak.ps1" }
if (-not (Test-Path $harn)) { Say 'ABORTA: cfr-soak.ps1 em falta (nem em scripts/ nem em %TEMP%\opencode).'; return }

if ($ResultsPath) {
    # Rejulgamento de um CSV ja medido: aritmetica pura, nao precisa da app fechada
    # nem descodifica nada.
    $ResultsCsv = $ResultsPath
    if (-not (Test-Path $ResultsCsv)) { Say "ABORTA: $ResultsCsv nao existe."; return }
    Say "=== REJULGAMENTO: $ResultsCsv ==="
} else {
    if (@(Get-Process DiNho.Capture.Poc -EA SilentlyContinue).Count -gt 0) {
        Say 'ABORTA: o engine ainda esta a correr. Descodificar com a captura viva compete por CPU/GPU e polui a medicao.'
        Say '         Fecha a app (e o engine) e volta a correr -Measure.'
        return
    }

    $manifest = Get-ChildItem $RunDir -Filter 'manifest-*.csv' -EA SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $manifest) { Say 'ABORTA: nenhum manifesto de captura. Corre primeiro a fase Capture.'; return }
    $clips = @(Import-Csv $manifest.FullName)
    Say "=== FASE 2 MEASURE: $($clips.Count) clips de $($manifest.Name) ==="
    Say "resultados: $ResultsCsv"

    foreach ($c in $clips) {
        $path = Join-Path $ClipDir $c.Name
        if (-not (Test-Path $path)) { Say "  FALTA $($c.Name) - saltado"; continue }
        Say "==> a medir $($c.Name)  (showinfo, ~4 min)"
        try {
            & pwsh -NoProfile -ExecutionPolicy Bypass -File $harn -Glob $path -TargetFps $TargetFps *> $null
            $csv = Join-Path $RunDir 'clips.csv'
            if (Test-Path $csv) {
                $row = Import-Csv $csv | Select-Object -Last 1
                $row | Export-Csv -LiteralPath $ResultsCsv -Append -NoTypeInformation -Encoding utf8
                Say ("   {0}s {1} frames {2} fps | D18={3} D34={4} DMax={5}ms | excesso={6}s | T2={7}" -f `
                     $row.Segundos, $row.Frames, $row.Fps, $row.D18, $row.D34, $row.DMax, $row.ExcessoS, $row.T2)
            }
    } catch {
            Say "   ERRO a medir $($c.Name): $_"
        }
    }
    Say '=== MEASURE terminou ==='
}
if (Test-Path $ResultsCsv) {
    $rows = @(Import-Csv $ResultsCsv)
    Say ''
    Say 'Clip                          Segundos  Frames    Fps  D18  D34  DMax   ExcessoS  T2'
    foreach ($r in $rows) {
        Say ("{0,-28} {1,8} {2,8} {3,6} {4,4} {5,4} {6,6} {7,9} {8,3}" -f `
             $r.Clip, $r.Segundos, $r.Frames, $r.Fps, $r.D18, $r.D34, $r.DMax, $r.ExcessoS, $r.T2)
    }

    # ── VEREDITO (2026-10-03) ──────────────────────────────────────────────────
    # O criterio antigo era "D18 == 0 em todos os clips". ERA ERRADO e dava FAIL
    # enganoso: uma anomalia isolada de 33-50 ms (2-3 slots da grelha) NAO acumula
    # na timeline. No soak 6/6 houve 9 anomalias em 110 045 frames (0,008%) a
    # valer +0,168 s em 1817 s de duracao - ou seja, ZERO deriva. O que prova que
    # o pacer esta correcto e a DERIVA, nao a contagem bruta de anomalias.
    #
    # O alvo vem POR LINHA (AlvoFps), nao de uma constante 60. Antes era fixo: um clip
    # CFR-30 perfeito (5741 frames, 191,33 s, delta 33/34 ms) era julgado a 30 fps contra
    # a grelha de 60 e recebia "FAIL - a grelha fugiu" - mentira. Passou a PASS em 2026-10-03.
    #   PASS  = fps >= alvo - 0,05  E  |excesso| <= 0,1% da duracao
    #   AVISO = fps e deriva ok, mas D18 acima de 0,5% dos frames
    #   FAIL  = deriva > 0,1%  OU  fps abaixo do alvo - 0,05  (a grelha fugiu)
    $Num = { param($v) [double](($v -replace '\.', '') -replace ',', '.') }
    $fails = @(); $warns = @(); $totExc = 0.0; $totSec = 0.0; $totD18 = 0; $totFr = 0
    foreach ($r in $rows) {
        $sec = & $Num $r.Segundos; $fps = & $Num $r.Fps; $exc = & $Num $r.ExcessoS
        $alvo = if ($r.AlvoFps) { [int]$r.AlvoFps } else { $TargetFps }
        $fr = [int]$r.Frames; $d18 = [int]$r.D18
        $totExc += [math]::Abs($exc); $totSec += $sec; $totD18 += $d18; $totFr += $fr
        $pctExc = if ($sec -gt 0) { [math]::Abs($exc) / $sec * 100 } else { 999 }
        $pctD18 = if ($fr -gt 0) { $d18 / $fr * 100 } else { 999 }
        if ($fps -lt ($alvo - 0.05) -or $pctExc -gt 0.1) { $fails += $r }
        elseif ($pctD18 -gt 0.5) { $warns += $r }
    }
    Say ''
    if ($totSec -gt 0) {
        Say ("TOTAL: {0:N1}s  {1} frames  {2} anomalias dPTS (={3:N4}% dos frames)  deriva {4:N3}s (={5:N4}%)" -f `
             $totSec, $totFr, $totD18, ($totD18 / [math]::Max($totFr,1) * 100), $totExc, ($totExc / $totSec * 100))
    }
    Say ''
    if ($fails.Count -eq 0 -and $warns.Count -eq 0) {
        Say 'VEREDITO: PASS — a grelha CFR nao fugiu: fps e deriva dentro do alvo em todos os clips.'
    }
    elseif ($fails.Count -eq 0) {
        Say "VEREDITO: PASS com AVISO — grelha no sitio (sem deriva), mas $($warns.Count) clip(s) com D18 acima de 0,5% dos frames. Investigar a origem das anomalias."
    }
    else {
        Say "VEREDITO: FAIL — $($fails.Count) clip(s) com deriva > 0,1% ou fps abaixo do alvo - 0,05 (a grelha fugiu). Nao e o mesmo que 'tem anomalias'."
        foreach ($f in $fails) {
            $fa = if ($f.AlvoFps) { [int]$f.AlvoFps } else { $TargetFps }
            Say ("   FALHOU: {0}  fps={1} (alvo {2})  excesso={3}s" -f $f.Clip, $f.Fps, $fa, $f.ExcessoS)
        }
    }
}