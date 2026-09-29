using System.Diagnostics;
using System.Text.RegularExpressions;

namespace DiNho.Capture.Poc.Encoders;

internal sealed partial class FfmpegEncoder
{
    // ── Guard proativo de capacidade (degrade de escala mid-session) ──
    // Quando o encoder fica sustentadamente atrás do realtime (speed < 1x e o lag de
    // saída cresce), o guard degrada a escala (1/1 → 1/2 → 1/4) do MESMO codec ANTES
    // do restart esperar um crash. Sessão AMD 2026-09-18: libx264 full-res 1080p a
    // ~0.62x → lag de 255s→1564s em 26min; o guard teria cortado o lag ao cair p/ 1/2.
    // Escopo: só escala (produto de capacidade), nunca troca de codec mid-session —
    // troca de codec é papel do cascading fallback já existente (crash/restart).

    /// <summary>Lag (elapsed−time do ffmpeg) mínimo para considerar o encoder "atrás".</summary>
    internal const double CapacityLagThresholdSeconds = 30;

    /// <summary>Speed mínimo para degradar: abaixo disso é stall, não lentidão (watchdog/reinit cuida).</summary>
    internal const double CapacitySpeedMinX = 0.10;

    /// <summary>Speed máximo para degradar: ≥0.95 o encoder acompanha e o lag drena sozinho.</summary>
    internal const double CapacitySpeedMaxX = 0.95;

    /// <summary>Cooldown entre degradações (evita restart-loop de ~1/min).</summary>
    internal const double CapacityDegradeCooldownSec = 60;

    /// <summary>Delega o restart real em teste (sem ffmpeg). null = restart real.</summary>
    private Func<bool>? _restartOverrideForCapacity = null;
    private long _lastCapacityDegradeTicks;

    /// <summary>
    /// Decisão pura: degradar escala quando o encoder está comprovadamente atrás do
    /// realtime — lag de saída alto E speed no intervalo ]min, 0.95[ (lentidão, não stall).
    /// </summary>
    internal static bool ShouldDegradeForCapacity(double speedX, double outputLagSeconds) =>
        outputLagSeconds >= CapacityLagThresholdSeconds &&
        speedX >= CapacitySpeedMinX &&
        speedX < CapacitySpeedMaxX;

    /// <summary>
    /// Próximo degrau de escala disponível para o MESMO codec (ex.: 1 → 1/2 → 1/4).
    /// Percorre a cadeia de fallback procurando a primeira entrada do mesmo codec com
    /// divisor maior que o atual. null = nenhum degrau (já no máximo ou codec fora da cadeia).
    /// </summary>
    internal static EncoderManager.FallbackEntry? NextScaleStepFor(
        List<EncoderManager.FallbackEntry>? chain, string codec, int currentScaleDivisor)
    {
        if (chain == null || chain.Count == 0 || string.IsNullOrEmpty(codec))
            return null;
        foreach (var entry in chain)
        {
            if (entry.Codec == codec && entry.ScaleDivisor > currentScaleDivisor)
                return entry;
        }
        return null;
    }

    /// <summary>Seam de teste: grava o último progress lido (speed/lag) sem ffmpeg.</summary>
    internal static void SetLastProgressForTest(FfmpegEncoder encoder, double speedX, double outputLagSeconds)
    {
        lock (encoder._progressSync)
        {
            encoder._lastSpeedX = speedX;
            encoder._lastOutputLagSeconds = outputLagSeconds;
        }
    }

    /// <summary>
    /// Guard proativo de capacidade: degrada a escala do encoder (mesmo codec) quando ele
    /// está sustentadamente atrás do realtime, reiniciando o ffmpeg com a nova resolução.
    /// Retorna false (sem efeito) quando: não inicializado, processo em falha, lag abaixo
    /// do threshold, sem próximo degrau de escala, ou em cooldown de 60s desde a última
    /// degradação. A aplicação do novo divisor acontece ANTES do restart — se o restart
    /// falhar, o retorno é false mas o estado já avançou.
    /// </summary>
    internal bool TryDegradeScaleForCapacity()
    {
        if (_disposed || !_initialized || _processFailed)
            return false;
        if (_fallbackChain is not { Count: > 0 })
            return false;

        var (speedX, outputLag) = LastProgress;
        if (!ShouldDegradeForCapacity(speedX, outputLag))
            return false;

        var next = NextScaleStepFor(_fallbackChain, _codec ?? "", _scaleDivisor);
        if (next == null)
            return false;

        long now = Stopwatch.GetTimestamp();
        if (now - _lastCapacityDegradeTicks < CapacityDegradeCooldownSec * Stopwatch.Frequency)
            return false;

        // Com o piso absoluto (Item 1) os divisores convergem: em 1080p 1/2 e 1/4 dao os
        // mesmos 1280x720, e abaixo do piso nenhum degrau muda a resolucao. Reiniciar o
        // ffmpeg nesse caso descartaria o backlog de output e o estado de PTS sem mudar os
        // argumentos, entao o degrau util e' ignorado. Ver CapacityStepChangesResolution.
        if (!CapacityStepChangesResolution(
                _width, _height, _outputWidth, _outputHeight, _scaleDivisor, next.ScaleDivisor))
            return false;

        var oldCodec = _codec;
        int oldDivisor = _scaleDivisor;
        _currentFallbackIndex = _fallbackChain.IndexOf(next);
        _codec = next.Codec;
        _scaleDivisor = next.ScaleDivisor;
        _lastCapacityDegradeTicks = now;
        // Item 1: o log precisa dizer a resolução REAL, não só o rótulo do divisor. Com o
        // piso absoluto 1280×720, "1/2" sobre 1080p produz 720p (não 540p) e "1/4" também
        // produz 720p — antes desta correção o log dizia 1/2 enquanto o ffmpeg recebia
        // -s 1920x1080, que é exatamente a mentira que escondeu o no-op do divisor.
        // O crop efetivo entra aqui: sem ele o log reportaria a resolução do frame CHEIO
        // enquanto o ffmpeg recebe o frame já recortado — a mesma mentira que o divisor
        // de capacidade produzia (Item 1).
        var effCrop = ResolveEffectiveCrop(_removeBlackBars, _cropX, _cropY, _cropW, _cropH,
            _width, _height, _outputWidth, _outputHeight);
        var after = ResolveOutput(_width, _height, effCrop?.W ?? 0, effCrop?.H ?? 0,
            _outputWidth, _outputHeight, _scaleDivisor);
        Logging.Log.W("FfmpegEncoder",
            $"capacity guard: encoder atrás do realtime (speed={speedX:F2}x lag={outputLag:F0}s" +
            $") — divisor 1/{oldDivisor} → 1/{next.ScaleDivisor} ({oldCodec} → {next.Label}), " +
            $"resolução real {after.EncodedW}x{after.EncodedH}");

        if (_restartOverrideForCapacity != null)
            return _restartOverrideForCapacity();
        return RestartFfmpegProcess();
    }

    /// <summary>Reinicia o ffmpeg limpo com a configuração atual (mesmo tail do TryRestart).</summary>
    private bool RestartFfmpegProcess()
    {
        StopFfmpeg();
        ResetState();

        try
        {
            StartFfmpeg();
            _readerCts = new CancellationTokenSource();
            _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
            {
                IsBackground = true,
                Name = "FfmpegReader"
            };
            _readerThread.Start();
            _processFailed = false;
            _lastRestartTicks = Stopwatch.GetTimestamp();
            Logging.Log.I("FfmpegEncoder", "restart OK");
            return true;
        }
        catch (Exception ex)
        {
            Logging.Log.E("FfmpegEncoder", $"restart failed: {ex.Message}");
            return false;
        }
    }

    // Atualizado na thread de stderr a cada linha de progress (frame=... speed=...x elapsed=...).
    // Expõe o backlog de saída (elapsed - time do próprio ffmpeg) para o tick FeedTelemetry:
    // com encoder atrás do feed, o lag cresce (sessão AMD 2026-09-18 chegou a ~26min).
    private readonly object _progressSync = new();
    private double _lastSpeedX;
    private double _lastOutputLagSeconds;

    private static readonly Regex SpeedRegex = new(@"\bspeed=\s*([\d.]+)x\b", RegexOptions.Compiled);
    private static readonly Regex TimeRegex = new(@"\btime=\s*(\d+):(\d+):([\d.]+)", RegexOptions.Compiled);
    private static readonly Regex ElapsedRegex = new(@"\belapsed=\s*(\d+):(\d+):([\d.]+)", RegexOptions.Compiled);

    /// <summary>Codec ativo (atualizado no fallback). "?" se ainda não resolvido.</summary>
    internal string CurrentCodec => _codec ?? "?";

    /// <summary>Divisor de escala ativo do fallback (1 = full, 2 = 1/2, 4 = 1/4).</summary>
    internal int ScaleDivisor => _scaleDivisor;

    /// <summary>Último progress do ffmpeg (speed= e lag de saída em segundos = elapsed - time).</summary>
    internal (double SpeedX, double OutputLagSeconds) LastProgress
    {
        get
        {
            lock (_progressSync)
                return (_lastSpeedX, _lastOutputLagSeconds);
        }
    }

    /// <summary>
    /// Chama da thread de stderr a cada linha de progress do ffmpeg (ex.: "frame=N fps=… time=
    /// HH:MM:SS… speed=0.62x elapsed=HH:MM:SS"). Atualiza speedX e lag de saída. Ignora linhas
    /// sem speed (config dump etc.). Parse com cultura invariante (ffmpeg sempre usa ponto).
    /// </summary>
    private void RecordFfmpegProgress(string line)
    {
        if (!TryParseFfmpegProgress(line, out var speedX, out var lagSeconds))
            return;
        lock (_progressSync)
        {
            _lastSpeedX = speedX;
            _lastOutputLagSeconds = lagSeconds;
        }
    }

    /// <summary>
    /// Extrai speed e lag de saída (elapsed − time, em segundos) de uma linha de progress do
    /// ffmpeg. lag positivo = saída atrás do wall-clock (backlog); negativo = PTS à frente
    /// (preroll/credits). Sem speed → false (não é linha de progress).
    /// </summary>
    internal static bool TryParseFfmpegProgress(string? line, out double speedX, out double outputLagSeconds)
    {
        speedX = 0;
        outputLagSeconds = 0;
        if (string.IsNullOrWhiteSpace(line))
            return false;

        var speedMatch = SpeedRegex.Match(line);
        if (!speedMatch.Success)
            return false;
        if (!double.TryParse(speedMatch.Groups[1].Value, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out speedX))
            return false;

        var timeMatch = TimeRegex.Match(line);
        var elapsedMatch = ElapsedRegex.Match(line);
        if (!timeMatch.Success || !elapsedMatch.Success)
            return true; // speed ok, sem time/elapsed → lag fica 0

        var time = ToSeconds(timeMatch);
        var elapsed = ToSeconds(elapsedMatch);
        if (time < 0 || elapsed < 0)
            return false;
        outputLagSeconds = elapsed - time;
        return true;
    }

    private static double ToSeconds(Match m)
    {
        if (!double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out var h) ||
            !double.TryParse(m.Groups[2].Value, System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out var min) ||
            !double.TryParse(m.Groups[3].Value, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var sec))
            return -1;
        return h * 3600 + min * 60 + sec;
    }
}