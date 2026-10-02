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

    /// <summary>
    /// Quanto tempo o encoder precisa ficar comprovadamente saudável antes de a
    /// resolução ser promovida de volta. É a histerese do guard: a degradação dispara
    /// com speed em ]0,10, 0,95[ e a promoção exige speed >= 0,95, mas sem dwell um
    /// único tick bom arrancaria o relógio e a promoção viria no tick ruim seguinte —
    /// dois restarts de ffmpeg por minuto, alternando 1080p e 720p no arquivo.
    /// </summary>
    internal const double CapacityPromoteDwellSec = 120;

    /// <summary>
    /// Cooldown entre promoções. Maior que o da degradação porque promover consome o
    /// mesmo restart caro e não deve reagir rápido: se o encoder-promovido volta a
    /// degradar logo, o par é sinal de que a capacidade não voltou de verdade.
    /// </summary>
    internal const double CapacityPromoteCooldownSec = 300;

    /// <summary>Delega o restart real em teste (sem ffmpeg). null = restart real.</summary>
    private Func<bool>? _restartOverrideForCapacity = null;
    private long _lastCapacityDegradeTicks;
    private long _lastCapacityPromoteTicks;

    /// <summary>
    /// O que o GUARD aplicou por último. A promoção só desfaz exatamente este par
    /// (codec + divisor): se o cascading fallback trocou o codec, ou se o divisor veio
    /// da própria cadeia, a escala pertence ao fallback e não é do guard.
    /// </summary>
    private string? _capacityAppliedCodec;
    private int _capacityAppliedDivisor;

    /// <summary>
    /// Tick desde que o encoder começou a ficar saudável (0 = streak quebrado). Só
    /// zera/restaura no cadence do guard, então um único tick ruim cancela a promoção
    /// mesmo que ela estivesse quase no dwell.
    /// </summary>
    private long _healthySinceTicks;

    /// <summary>
    /// Decisão pura: degradar escala quando o encoder está comprovadamente atrás do
    /// realtime — lag de saída alto E speed no intervalo ]min, 0.95[ (lentidão, não stall).
    ///
    /// <para>
    /// <b>Legado/testes.</b> Este overload não tem telemetria de feed, então assume o
    /// encoder como gargalo (a intenção original do guard). Não use em produção: lá o
    /// estado do feed é obrigatório e <see cref="FeedState.Unknown"/> tem de BLOQUEAR a
    /// degradação. Ver <see cref="ShouldDegradeForCapacity(double,double,FeedState)"/>.
    /// </para>
    /// </summary>
    internal static bool ShouldDegradeForCapacity(double speedX, double outputLagSeconds) =>
        ShouldDegradeForCapacity(speedX, outputLagSeconds, FeedState.Healthy);

    /// <summary>
    /// Decisão real do guard: degrada a escala do MESMO codec quando o encoder está
    /// comprovadamente atrás do realtime E o feed está no alvo.
    ///
    /// <para>
    /// Reduzir a escala só aumenta o número de frames entregues se o encoder for o
    /// gargalo. Se o feed é que está devendo frames, a degradação é receita de
    /// qualidade pior (720p, e o restart descarta backlog e PTS) sem recuperar frame
    /// nenhum — foi exatamente o que o T4 corrigiu ao trocar o lag de saída, que
    /// cresce por relógio em vez de por lentidão.
    /// </para>
    /// <para>
    /// <b>Unknown bloqueia.</b> Sem medição de feed não há prova de que o encoder seja o
    /// gargalo, e o custo de errar é alto demais para degradar por omissão.
    /// </para>
    /// </summary>
    internal static bool ShouldDegradeForCapacity(
        double speedX, double outputLagSeconds, FeedState feed)
    {
        // O gargalo tem que ser o encoder. Feed desconhecido ou abaixo do alvo: não
        // degrada.
        if (feed != FeedState.Healthy) return false;
        // Lentidão, não stall.
        if (speedX < CapacitySpeedMinX || speedX >= CapacitySpeedMaxX) return false;
        if (outputLagSeconds < CapacityLagThresholdSeconds) return false;
        return true;
    }

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

        // T4: o lag de saída do ffmpeg não distingue "encoder lento" de "feed
        // lento" — com -r 60 e feed de 40 fps o `time` fica atrás do `elapsed`
        // mesmo com encoder instantâneo. Só degrada se o encoder for o gargalo.
        //
        // `FeedFps` devolve 0 quando NÃO há medição (janela enchendo, contador
        // zerado, nenhum frame ainda) — e é exatamente nos colapsos do WGC que a
        // janela não fecha. Derivar "encoder é o gargalo" desse 0 foi a regressão
        // de 2026-10-01 21:34:14: feed a 5,8 fps, guard degradou para 720p e
        // reiniciou o ffmpeg. `ClassifyFeed` separa desconhecido de saudável.
        var feedFps = FeedFps;
        var feed = CapacityGuardMath.ClassifyFeed(feedFps, _frameRate);
        if (!ShouldDegradeForCapacity(speedX, outputLag, feed))
        {
            if (outputLag >= CapacityLagThresholdSeconds && feed != FeedState.Healthy)
            {
                var deficit = CapacityGuardMath.FeedLagSeconds(feedFps, _frameRate);
                var why = feed == FeedState.Unknown
                    ? "feed sem medição (janela de 3s não fechou) — degradação exige prova de gargalo"
                    : $"feed entrega {feedFps:F1}fps (alvo {_frameRate}, déficit {deficit:P0}/s) " +
                      "e o encoder não é o gargalo";
                Logging.Log.I("FfmpegEncoder",
                    $"capacity guard: ignorado - {why} (lag de saída {outputLag:F0}s, speed {speedX:F2}x)");
            }
            return false;
        }

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
        // Marca o que o GUARD aplicou, para que a promoção saiba desfazer isto e só
        // isto (ver TryPromoteScaleForCapacity).
        _capacityAppliedCodec = _codec;
        _capacityAppliedDivisor = _scaleDivisor;
        // O encoder acabou de reiniciar: nada foi provado sobre a nova escala ainda.
        Volatile.Write(ref _healthySinceTicks, 0);
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

    /// <summary>
    /// Decide o tick inteiro do guard de capacidade: mantém o streak de saúde e
    /// escolhe entre degradar e promover. Promover só é considerado quando o tick
    /// NÃO degradou — degradar e promover no mesmo tick seria contraditório.
    /// </summary>
    internal bool TickCapacityGuard()
    {
        TrackHealthyStreak();
        if (TryDegradeScaleForCapacity()) return true;
        TryPromoteScaleForCapacity();
        return false;
    }

    /// <summary>
    /// Zera o streak enquanto o encoder não estiver comprovadamente saudável, e o
    /// arranca no primeiro tick bom. Precisa rodar TODO tick (não só quando vai
    /// promover) senão o tempo saudável nunca acumularia.
    /// </summary>
    private void TrackHealthyStreak()
    {
        long now = Stopwatch.GetTimestamp();
        var (speedX, outputLag) = LastProgress;
        var feed = CapacityGuardMath.ClassifyFeed(FeedFps, _frameRate);
        bool healthy = !_disposed && _initialized && !_processFailed
            && ShouldPromoteForCapacity(speedX, outputLag, feed, _scaleDivisor);
        if (!healthy)
        {
            Volatile.Write(ref _healthySinceTicks, 0);
            return;
        }
        if (Volatile.Read(ref _healthySinceTicks) == 0)
            Volatile.Write(ref _healthySinceTicks, now);
    }

    /// <summary>
    /// Promoção: devolve ao divisor anterior (1/2 → 1/1) quando o encoder se recuperou.
    ///
    /// <para>
    /// <b>Regressão de runtime 2026-10-01.</b> O guard degradou para 1280×720 num
    /// colapso do WGC; o encoder se recuperou (speed 1,01x, lag −1s) e a resolução
    /// NUNCA voltou — todas as gravações seguintes ficaram em 720p até reiniciar o app.
    /// A degradação era de mão única.
    /// </para>
    /// <para>
    /// Promover custa o mesmo restart que degradar, então exige: ser a degradação do
    /// próprio guard (mesmo codec e mesmo divisor), feed saudável (simetria com a
    /// degradação), encoder acompanhando, backlog drenado, dwell e cooldown.
    /// </para>
    /// </summary>
    internal bool TryPromoteScaleForCapacity()
    {
        if (_disposed || !_initialized || _processFailed) return false;
        if (_fallbackChain is not { Count: > 0 }) return false;
        if (_scaleDivisor <= 1) return false;

        // Só desfaz o que o GUARD degradou. Se o cascading fallback mexeu no codec ou no
        // divisor, a escala é dele e promover aqui trocaria a entrada da cadeia por baixo
        // dos panos.
        if (_capacityAppliedDivisor != _scaleDivisor || _capacityAppliedCodec != _codec)
            return false;

        var (speedX, outputLag) = LastProgress;
        var feed = CapacityGuardMath.ClassifyFeed(FeedFps, _frameRate);
        if (!ShouldPromoteForCapacity(speedX, outputLag, feed, _scaleDivisor))
            return false;

        long now = Stopwatch.GetTimestamp();
        var healthySince = Volatile.Read(ref _healthySinceTicks);
        if (healthySince == 0) return false;
        if (now - healthySince < (long)(CapacityPromoteDwellSec * Stopwatch.Frequency))
            return false;
        if (now - _lastCapacityPromoteTicks < (long)(CapacityPromoteCooldownSec * Stopwatch.Frequency))
            return false;

        var prev = PreviousScaleStepFor(_fallbackChain, _codec ?? "", _scaleDivisor);
        if (prev == null) return false;

        // Mesmo filtro da degradação: 1/2 e 1/4 convergem no piso 1280×720, então
        // promover entre eles não mudaria byte nenhum e gastaria um restart.
        if (!CapacityStepChangesResolution(
                _width, _height, _outputWidth, _outputHeight, _scaleDivisor, prev.ScaleDivisor))
            return false;

        int oldDivisor = _scaleDivisor;
        var oldCodec = _codec;
        _currentFallbackIndex = _fallbackChain.IndexOf(prev);
        _codec = prev.Codec;
        _scaleDivisor = prev.ScaleDivisor;
        _lastCapacityPromoteTicks = now;
        _capacityAppliedCodec = _codec;
        _capacityAppliedDivisor = _scaleDivisor;
        Volatile.Write(ref _healthySinceTicks, 0);

        var effCrop = ResolveEffectiveCrop(_removeBlackBars, _cropX, _cropY, _cropW, _cropH,
            _width, _height, _outputWidth, _outputHeight);
        var after = ResolveOutput(_width, _height, effCrop?.W ?? 0, effCrop?.H ?? 0,
            _outputWidth, _outputHeight, _scaleDivisor);
        Logging.Log.I("FfmpegEncoder",
            $"capacity guard: encoder recuperou (speed={speedX:F2}x lag={outputLag:F0}s) — " +
            $"divisor 1/{oldDivisor} → 1/{prev.ScaleDivisor} ({oldCodec} → {prev.Label}), " +
            $"resolução real {after.EncodedW}x{after.EncodedH}");

        if (_restartOverrideForCapacity != null)
            return _restartOverrideForCapacity();
        return RestartFfmpegProcess();
    }

    /// <summary>
    /// Decisão pura da promoção: o encoder voltou a acompanhar E o backlog drenou.
    /// Espelha <see cref="ShouldDegradeForCapacity(double,double,FeedState)"/> em sentido
    /// oposto — mesma faixa de feed, speed do outro lado do limite.
    /// </summary>
    internal static bool ShouldPromoteForCapacity(
        double speedX, double outputLagSeconds, FeedState feed, int currentScaleDivisor)
    {
        if (currentScaleDivisor <= 1) return false;
        // Simetria com a degradação: só sob as mesmas condições em que se degrada.
        // Promover com feed desconhecido devolveria o encoder para 1080p um instante
        // antes de o próximo tick degradar de novo.
        if (feed != FeedState.Healthy) return false;
        if (speedX < CapacitySpeedMaxX) return false;
        if (outputLagSeconds >= CapacityLagThresholdSeconds) return false;
        return true;
    }

    /// <summary>
    /// Entrada anterior do MESMO codec na cadeia (a de maior divisor abaixo do
    /// atual). null = já em full-res ou codec sem degrau anterior.
    /// </summary>
    internal static EncoderManager.FallbackEntry? PreviousScaleStepFor(
        List<EncoderManager.FallbackEntry>? chain, string codec, int currentScaleDivisor)
    {
        if (chain == null || chain.Count == 0 || string.IsNullOrEmpty(codec))
            return null;
        EncoderManager.FallbackEntry? best = null;
        foreach (var entry in chain)
        {
            if (entry.Codec != codec || entry.ScaleDivisor >= currentScaleDivisor) continue;
            if (best == null || entry.ScaleDivisor > best.ScaleDivisor)
                best = entry;
        }
        return best;
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
    /// <summary>
    /// Janela deslizante do fps efetivo do feed (T4). Uma janela de 3 s é longa
    /// o bastante para não reagir a um hiccup e curta o bastante para agir antes
    /// que o backlog de saída cresce por minutos.
    /// </summary>
    internal const double FeedFpsWindowSec = 3.0;

    /// <summary>
    /// Tempo mínimo antes de a taxa da janela valer como medição.
    ///
    /// Não pode ser o próprio <see cref="FeedFpsWindowSec"/>: a janela é renovada
    /// por <see cref="RecordFeedFrame"/> no primeiro frame depois de vencer, o que
    /// zera o início. Exigir a janela completa fazia o getter devolver 0 durante
    /// quase 3 s após cada renovação e só ler número na fatia de ~25 ms antes da
    /// seguinte (<1% do tempo) — o guard via "feed sem medição" permanentemente e
    /// a promoção de resolução nunca tinha como disparar. Medir a taxa com 250 ms
    /// de janela é estável acima de ~4 fps, bem abaixo de qualquer gargalo real.
    /// </summary>
    internal const double FeedFpsMinElapsedSec = 0.25;

    /// <summary>
    /// fps efetivo do feed na janela corrente. 0 = sem medição (nenhum frame
    /// entrou, ou a janela tem menos de <see cref="FeedFpsMinElapsedSec"/>).
    ///
    /// A defasagem é limitada por <see cref="FeedFpsWindowSec"/> porque a renovação
    /// zera a contagem; se o feed PARAR, não há renovação e a taxa decai sozinha em
    /// direção a 0, que é o comportamento desejado (feed morto não pode ler
    /// "saudável").
    /// </summary>
    internal double FeedFps
    {
        get
        {
            var (count, start) = (Volatile.Read(ref _feedFrameCount), Volatile.Read(ref _feedWindowStartTicks));
            if (start == 0 || count == 0) return 0;
            var minElapsed = (long)(FeedFpsMinElapsedSec * Stopwatch.Frequency);
            var elapsed = Stopwatch.GetTimestamp() - start;
            if (elapsed < minElapsed) return 0; // janela nova demais para uma taxa
            return count * (double)Stopwatch.Frequency / elapsed;
        }
    }

    /// <summary>Registra um frame que entrou no ffmpeg (chamado do writer thread).</summary>
    internal void RecordFeedFrame()
    {
        var now = Stopwatch.GetTimestamp();
        var windowTicks = (long)(FeedFpsWindowSec * Stopwatch.Frequency);
        var start = Volatile.Read(ref _feedWindowStartTicks);
        if (start == 0 || now - start >= windowTicks)
        {
            // Nova janela: zera a contagem em vez de acumular para sempre.
            Interlocked.Exchange(ref _feedWindowStartTicks, now);
            Interlocked.Exchange(ref _feedFrameCount, 1);
            return;
        }
        Interlocked.Increment(ref _feedFrameCount);
    }

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