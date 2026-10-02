using System.Diagnostics;
using System.Reflection;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

[Collection("FfmpegCodecCache")]
public sealed class FfmpegEncoderCapacityGuardTests
{
    // ── ShouldDegradeForCapacity (decisão pura, sem HW) ──────────────

    [Fact]
    public void ShouldDegrade_ReturnsTrue_WhenLagHighAndSpeedLow()
    {
        // Speed 0.62x + lag de ~26min (assinatura da sessão AMD real) → degradar escala.
        Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 1564));
        Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(0.5, 255));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenLagBelowThreshold()
    {
        // Lag pequeno (preroll/arranque) — não degradar.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 10));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenSpeedNearOrAboveOne()
    {
        // Encoder acompanhando (speed>=0.95) mesmo com lag residual — o lag vai zerar sozinho.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.95, 1564));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(1.02, 1564));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(2.5, 100));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenSpeedInvalid()
    {
        // Sem progress ainda (speed 0) ou negativo — não degradar.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0, 1564));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(-1, 1564));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenSpeedTooLowMachineStalled()
    {
        // speed extremamente baixo sugere stall real, não lentidão de encoder — não degradar
        // à toa (é caso para o watchdog/reinit, não para troca de escala).
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.05, 1564));
    }

    // ── NextScaleStepFor (escolha do próximo degrau, pura, sem HW) ───

    private static readonly List<EncoderManager.FallbackEntry> Chain = new()
    {
        new() { Codec = "av1_amf", Label = "HW native (av1_amf)" },
        new() { Codec = "av1_amf", ScaleDivisor = 2, Label = "HW 1/2 (av1_amf)" },
        new() { Codec = "av1_amf", ScaleDivisor = 4, Label = "HW 1/4 (av1_amf)" },
        new() { Codec = "h264_amf", Label = "HW native (h264_amf)" },
        new() { Codec = "libx264", Label = "CPU (libx264)" },
        new() { Codec = "libx264", ScaleDivisor = 2, Label = "CPU 1/2 (libx264)" },
    };

    [Fact]
    public void NextScaleStep_ReturnsSameCodecNextDivisor()
    {
        var next = FfmpegEncoder.NextScaleStepFor(Chain, "av1_amf", 1);
        Assert.NotNull(next);
        Assert.Equal("av1_amf", next!.Codec);
        Assert.Equal(2, next.ScaleDivisor);
    }

    [Fact]
    public void NextScaleStep_FromHalf_ReturnsQuarter()
    {
        var next = FfmpegEncoder.NextScaleStepFor(Chain, "av1_amf", 2);
        Assert.NotNull(next);
        Assert.Equal(4, next!.ScaleDivisor);
    }

    /// <summary>
    /// O degrau 1/2 → 1/4 em 1080p e' <b>inutil</b>: o piso absoluto 1280x720 (Item 1) faz os
    /// dois divisores produzirem a MESMA resolucao. Sem esta trava o guard reiniciava o
    /// ffmpeg (descartando o backlog de output e o estado de PTS) sem mudar um unico byte
    /// dos argumentos — e o log dizia "1/2 → 1/4" como se fosse uma mudanca real.
    /// </summary>
    [Fact]
    public void CapacityStep_QuarterAfterHalfOn1080p_ChangesNothing_SoTheGuardMustNotRestart()
    {
        Assert.False(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1920, inputH: 1080, outW: 0, outH: 0, oldDivisor: 2, newDivisor: 4));
    }

    [Fact]
    public void CapacityStep_HalfFromFullOn1080p_ChangesResolution_SoTheGuardProceeds()
    {
        Assert.True(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1920, inputH: 1080, outW: 0, outH: 0, oldDivisor: 1, newDivisor: 2));
    }

    [Fact]
    public void CapacityStep_BelowTheFloor_ChangesNothing()
    {
        // Captura 1280x720: o piso efetivo e' a propria entrada, entao o divisor nao tem
        // para onde ir e qualquer degrau e' inutil.
        Assert.False(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1280, inputH: 720, outW: 0, outH: 0, oldDivisor: 1, newDivisor: 2));
    }

    [Fact]
    public void CapacityStep_4K_HalfChangesResolution()
    {
        Assert.True(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 3840, inputH: 2160, outW: 0, outH: 0, oldDivisor: 1, newDivisor: 2));
    }

    [Fact]
    public void CapacityStep_SameDivisor_ChangesNothing()
    {
        Assert.False(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1920, inputH: 1080, outW: 0, outH: 0, oldDivisor: 2, newDivisor: 2));
    }

    [Fact]
    public void NextScaleStep_ReturnsNull_WhenAtMaxDivisor()
    {
        Assert.Null(FfmpegEncoder.NextScaleStepFor(Chain, "av1_amf", 4));
    }

    [Fact]
    public void NextScaleStep_ReturnsNull_WhenCodecNotInChain()
    {
        Assert.Null(FfmpegEncoder.NextScaleStepFor(Chain, "hevc_nvenc", 1));
    }

    [Fact]
    public void NextScaleStep_ReturnsNull_ForEmptyChain()
    {
        Assert.Null(FfmpegEncoder.NextScaleStepFor([], "av1_amf", 1));
    }

    [Fact]
    public void NextScaleStep_CpuNative_StepsToCpuHalf()
    {
        // Sessão AMD: fallback já caiu em libx264 full-res com lag crescente → próximo degrau = CPU 1/2.
        var next = FfmpegEncoder.NextScaleStepFor(Chain, "libx264", 1);
        Assert.NotNull(next);
        Assert.Equal(2, next!.ScaleDivisor);
        Assert.Equal("libx264", next.Codec);
    }

    // ── TryDegradeScaleForCapacity (decisão + aplicação, sem ffmpeg) ─

    private static FfmpegEncoder CreateEncoder()
    {
        // Ctor real (só cria o _outputChannel), sem Initialize() — não spawna ffmpeg.
        // Não pode usar GetUninitializedObject: os field-initializers (ex.: _progressSync)
        // não rodam e o guard trava no lock.
        FfmpegEncoder.ResetEncoderCachesForTest();
        return new FfmpegEncoder();
    }

    private static void SetField(FfmpegEncoder encoder, string name, object? value)
    {
        var field = typeof(FfmpegEncoder).GetField(name,
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        field!.SetValue(encoder, value);
    }

    private static object? GetField(FfmpegEncoder encoder, string name)
    {
        var field = typeof(FfmpegEncoder).GetField(name,
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        return field!.GetValue(encoder);
    }

    /// <summary>
    /// Encoder degradável. Por padrão o feed é medido NO ALVO (60 fps), porque o
    /// guard só degrada com o encoder comprovadamente como gargalo — sem essa
    /// medição os testes que exercitam cooldown/piso/cadeia passariam a ser
    /// verdadeiros pelo motivo errado (feed desconhecido) e perderiam a cobertura
    /// do caminho que estão descrevendo. Passar <paramref name="feedFps"/> = null
    /// deixa o feed sem medição.
    /// </summary>
    private static FfmpegEncoder CreateDegradableEncoder(
        string codec, int divisor, int fallbackIndex, bool processFailed = false,
        int width = 1920, int height = 1080, double? feedFps = 60)
    {
        var enc = CreateEncoder();
        SetField(enc, "_initialized", true);
        SetField(enc, "_fallbackChain", Chain);
        SetField(enc, "_currentFallbackIndex", fallbackIndex);
        SetField(enc, "_scaleDivisor", divisor);
        SetField(enc, "_codec", codec);
        SetField(enc, "_processFailed", processFailed);
        // Captura real: o guard decide o degrau util comparando a resolucao ANTES e DEPOIS
        // (piso absoluto do Item 1), entao sem dims o encoder ficaria 0x0 e todo degrau seria
        // "inutil" - o que os testes antigos nao percebiam porque a resolucao nunca participou.
        SetField(enc, "_width", width);
        SetField(enc, "_height", height);
        // O alvo nominal do guard. Sem ele `ClassifyFeed` devolve Unknown (não há como
        // dizer que o feed está saudável) e o guard segura — o que também vale como
        // teste: `_frameRate` = 0 não degrada.
        SetField(enc, "_frameRate", 60);
        // Sem restart real (sem ffmpeg no teste) - seam de teste retorna true.
        SetField(enc, "_restartOverrideForCapacity", (Func<bool>)(() => true));
        if (feedFps is { } fps) SimulateFeed(enc, fps);
        return enc;
    }

    [Fact]
    public void TryDegrade_ReturnsTrue_AndAdvancesScaleDivisor()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.True(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
        Assert.Equal("av1_amf", enc.CurrentCodec);
    }

    [Fact]
    public void TryDegrade_ReturnsTrue_OnCpuFallback_RoutesToHalf()
    {
        var enc = CreateDegradableEncoder("libx264", 1, 4); // CPU (libx264) full-res
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 600);

        Assert.True(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
        Assert.Equal("libx264", enc.CurrentCodec);
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenProcessFailed()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, processFailed: true);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        // Processo em falha já está no caminho de restart do watchdog — guard não interfere.
        Assert.False(enc.TryDegradeScaleForCapacity());
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenScaleAlreadyAtMax()
    {
        var enc = CreateDegradableEncoder("av1_amf", 4, 2);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 1000);

        Assert.False(enc.TryDegradeScaleForCapacity());
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenRecentlyDegraded()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);
        // Degradação recente (há <60s) — cooldown impede restart-loop.
        SetField(enc, "_lastCapacityDegradeTicks",
            Stopwatch.GetTimestamp() - (long)(30 * Stopwatch.Frequency));

        Assert.False(enc.TryDegradeScaleForCapacity());
    }

    [Fact]
    public void TryDegrade_WhenRestartFails_ReturnsFalseButAppliesState()
    {
        // O guard aplica a degradação (escala) ANTES do restart; se o restart real falhar,
        // o retorno é false mas o estado avançou (próxima chamada continuaria com 1/2).
        var enc = CreateDegradableEncoder("av1_amf", 1, 0);
        SetField(enc, "_restartOverrideForCapacity", (Func<bool>)(() => false));
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }

    /// <summary>
    /// O caso de produção que o guard Now ignora: em 1080p, já degradado para 1/2 (720p), o
    /// próximo degrau da cadeia é 1/4 — mas o piso do Item 1 faz 1/4 produzir os mesmos
    /// 1280x720. Reiniciar ali descartaria o backlog de output e o estado de PTS sem mudar
    /// os argumentos, o log ainda por cima anunciaria "1/2 → 1/4". Antes desta trava o
    /// guard fazia exatamente esse restart inútil a cada cooldown.
    /// </summary>
    [Fact]
    public void TryDegrade_AtHalfOn1080p_SkipsTheUselessQuarterStep_AndKeepsTheState()
    {
        var enc = CreateDegradableEncoder("av1_amf", 2, 1);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
        Assert.Equal("av1_amf", enc.CurrentCodec);
    }

    /// <summary>
    /// E o mesmo guard numa captura abaixo do piso: nenhum degrau muda a resolução, então
    /// reiniciar o ffmpeg nunca reduziria o backlog. Não há o que re-tentar.
    /// </summary>
    [Fact]
    public void TryDegrade_BelowFloorCapture_DoesNotRestartBecauseNoStepChangesResolution()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, width: 1280, height: 720);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
    }

    // ── RecordFeedFrame / FeedFps: a janela deslizante que decide o gargalo ─
    //
    // O guard do T4 compara o fps EFETIVO do feed com o fps nominal. Esse número
    // vinha de uma janela deslizante interna que só era exercitada indiretamente
    // (nunca num teste): se ela devolvesse sempre 0, o guard cairia no
    // "gargalo desconhecido" e degradaria a escala mesmo com o feed devendo
    // frames — exatamente o que o T4 existe para impedir.

    [Fact]
    public void FeedFps_IsZero_BeforeAnyFrameIsRecorded()
    {
        using var enc = CreateEncoder();

        Assert.Equal(0, enc.FeedFps);
    }

    [Fact]
    public void FeedFps_IsZero_WhileTheWindowIsStillFilling()
    {
        // Uma janela de 3 s que acabou de abrir não tem medição: reportar o fps
        // parcial faria o guard decidir com base em 1 frame.
        using var enc = CreateEncoder();
        enc.RecordFeedFrame();

        Assert.Equal(0, enc.FeedFps);
    }

    [Fact]
    public void FeedFps_CountsTheRealFrameRateOnceTheWindowCloses()
    {
        // 60 frames numa janela vencida de 3 s = 20 fps. O número tem que vir da
        // contagem real, não de uma constante.
        using var enc = CreateEncoder();
        for (var i = 0; i < 60; i++) enc.RecordFeedFrame();
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(3.0 * Stopwatch.Frequency));

        Assert.Equal(20.0, enc.FeedFps, 0);
    }

    [Fact]
    public void FeedFps_Drops_WhenFewerFramesArriveInTheSameWindow()
    {
        using var enc = CreateEncoder();
        for (var i = 0; i < 12; i++) enc.RecordFeedFrame();
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(3.0 * Stopwatch.Frequency));

        Assert.Equal(4.0, enc.FeedFps, 0);
    }

    [Fact]
    public void FeedFps_StartsANewWindow_InsteadOfAccumulatingForever()
    {
        // Frames antigos não podem contaminar a janela seguinte: com acúmulo, um
        // pico de 60fps seguido de feed parado continuaria reportando 60fps.
        using var enc = CreateEncoder();
        for (var i = 0; i < 180; i++) enc.RecordFeedFrame();
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(5.0 * Stopwatch.Frequency));
        var afterOverflow = enc.FeedFps;

        // Agora um único frame abre a próxima janela: a contagem reinicia em 1.
        enc.RecordFeedFrame();

        Assert.Equal(0, enc.FeedFps); // janela nova ainda enchendo
        Assert.True(afterOverflow > 0, "a janela vencida deveria reportar fps antes de virar");
    }

    [Fact]
    public void FeedFps_TracksTheCadenceOfTheRealSession()
    {
        // A assinatura medida em 2026-09-15: WGC entregava ~46,9 fps de um alvo
        // de 60. É o caso que separa "encoder é o gargalo" de "o feed é o gargalo".
        using var enc = CreateEncoder();
        const int frames = 140; // ~3 s a ~46,9 fps
        for (var i = 0; i < frames; i++) enc.RecordFeedFrame();
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(3.0 * Stopwatch.Frequency));

        var feedFps = enc.FeedFps;
        var feed = CapacityGuardMath.ClassifyFeed(feedFps, 60);
        var feedLag = CapacityGuardMath.FeedLagSeconds(feedFps, 60);

        Assert.True(feedLag > 0, $"feed de {feedFps:F1}fps contra alvo de 60 tem de ter déficit");
        Assert.Equal(FeedState.Deficient, feed);
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 1564, feed),
            "com o feed devendo frames, degradar a escala não recupera nada");
    }

    [Fact]
    public void FeedFps_RemainsMeasured_WhileTheWindowIsStillRenewing()
    {
        // Regressão de runtime 2026-10-01 23:32:37. O getter exigia janela COMPLETA
        // (elapsed >= 3 s) mas RecordFeedFrame renova a janela no primeiro frame
        // depois de vencida. O getter só conseguia ler um número na fatia de ~25 ms
        // entre "janela vencida" e "próximo frame" (<1% do tempo), então o guard
        // lia "feed sem medição" praticamente sempre: com FeedTelemetry a medir
        // 39,6 fps o log dizia que não havia medição, e a promoção de resolução
        // (que exige FeedState.Healthy) nunca podia disparar.
        //
        // Este é o ciclo REAL: janela vencida -> frame renova -> 500 ms depois
        // ainda estamos dentro da janela nova, com frames a entrar.
        using var enc = CreateEncoder();

        enc.RecordFeedFrame(); // abre a primeira janela
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(3.0 * Stopwatch.Frequency));
        enc.RecordFeedFrame(); // o frame que renova (contagem volta a 1)
        for (var i = 0; i < 20; i++) enc.RecordFeedFrame(); // ~500 ms a ~40 fps
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(0.5 * Stopwatch.Frequency));

        var feedFps = enc.FeedFps;

        Assert.True(feedFps > 0,
            "a meio da janela o feed tem de continuar medido, senão o guard lê Unknown para sempre");
        Assert.Equal(42.0, feedFps, 1); // 21 frames / 0,5 s
    }

    [Fact]
    public void FeedFps_ClassifiesTheFeedWhileTheWindowIsRenewing_NotUnknown()
    {
        // O sintoma do T4 em runtime: feed medido a ~40 fps de um alvo de 60 tem de
        // chegar ao guard como Deficient (bloqueia degradação E promoção), nunca como
        // Unknown — que era o que a janela nunca fechada produzia.
        using var enc = CreateEncoder();

        enc.RecordFeedFrame();
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(3.0 * Stopwatch.Frequency));
        enc.RecordFeedFrame();
        for (var i = 0; i < 20; i++) enc.RecordFeedFrame();
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(0.5 * Stopwatch.Frequency));

        var feed = CapacityGuardMath.ClassifyFeed(enc.FeedFps, 60);

        Assert.Equal(FeedState.Deficient, feed);
    }

    [Fact]
    public void FeedFps_DecaysTowardZero_WhenTheFeedStopsEntirely()
    {
        // Se o feed morre não há renovação, logo a janela envelhece: a taxa tem de
        // decair sozinha em vez de ficar presa no último valor bom (que leria
    // "saudável" e o guard degradaria por um encoder que nem está a receber).
        using var enc = CreateEncoder();
        for (var i = 0; i < 180; i++) enc.RecordFeedFrame(); // 60 fps
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(3.0 * Stopwatch.Frequency));

        var whileFlowing = enc.FeedFps;
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(300.0 * Stopwatch.Frequency));
        var afterSilence = enc.FeedFps;

        Assert.True(whileFlowing > 0);
        Assert.True(afterSilence < whileFlowing / 10,
            $"feed parado tem de cair muito abaixo do valor anterior ({whileFlowing:F1} -> {afterSilence:F2})");
        Assert.Equal(FeedState.Deficient, CapacityGuardMath.ClassifyFeed(afterSilence, 60));
    }

    [Fact]
    public void FeedFps_IsNotDisturbedByConcurrentRecording()
    {
        // RecordFeedFrame roda na thread do writer do ffmpeg e é chamado de
        // qualquer lugar; a janela não pode produzir número negativo/NaN.
        using var enc = CreateEncoder();
        Parallel.For(0, 500, _ => enc.RecordFeedFrame());
        SetWindowStart(enc, Stopwatch.GetTimestamp() - (long)(3.0 * Stopwatch.Frequency));

        var fps = enc.FeedFps;

        Assert.False(double.IsNaN(fps) || double.IsInfinity(fps));
        Assert.True(fps > 0);
    }

    private static void SetWindowStart(FfmpegEncoder encoder, long ticks)
    {
        var field = typeof(FfmpegEncoder).GetField("_feedWindowStartTicks",
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        field!.SetValue(encoder, ticks);
    }

    /// <summary>
    /// Simula uma janela de feed já vencida com o fps dado. É o estado que o guard
    /// encontra em produção — a janela de 3 s enche com o tempo, não com uma chamada.
    ///
    /// <para>
    /// Grava um frame a mais que o nominal: o relógio entre gravar a janela e lê-la
    /// faz o fps medido cair um fração abaixo do alvo, e em 60 fps (exatamente o
    /// limite de <see cref="FeedState.Healthy"/>) isso inverteria o estado. O frame
    /// extra deixa o caso "feed no alvo" inequivoco.
    /// </para>
    /// </summary>
    private static void SimulateFeed(FfmpegEncoder encoder, double fps, double windowSec = 3.0)
    {
        var frames = (int)Math.Round(fps * windowSec) + 1;
        for (var i = 0; i < frames; i++) encoder.RecordFeedFrame();
        SetWindowStart(encoder, Stopwatch.GetTimestamp() - (long)(windowSec * Stopwatch.Frequency));
    }

    // ── ClassifyFeed: o feed tem TRÊS estados, não dois ───────────────
    //
    // Regressão de runtime 2026-10-01 21:34:14. O guard leu `FeedFps` = 0 (sem
    // medição: janela ainda enchendo / contador zerado) como se fosse "feed
    // saudável", concluiu que o ENCODER era o gargalo e degradou para 1/2
    // durante um colapso do WGC (FeedTelemetry 5,8 fps, 183 falhas) — exatamente
    // o que o T4 existe para impedir. "Desconhecido" precisa ser um terceiro
    // estado, distinto de "saudável".

    [Fact]
    public void ClassifyFeed_IsUnknown_WhenThereIsNoMeasurement()
    {
        // FeedFps = 0 significa "sem medição" (janela enchendo, contador zerado
        // ou nenhum frame ainda), nunca "feed no alvo".
        Assert.Equal(FeedState.Unknown, CapacityGuardMath.ClassifyFeed(feedFps: 0, nominalFps: 60));
    }

    [Fact]
    public void ClassifyFeed_IsUnknown_WhenNominalFpsIsUnknown()
    {
        // Sem alvo conhecido não há como dizer que o feed está saudável.
        Assert.Equal(FeedState.Unknown, CapacityGuardMath.ClassifyFeed(feedFps: 60, nominalFps: 0));
    }

    [Theory]
    [InlineData(60)]
    [InlineData(120)] // feed ACIMA do alvo também é saudável (encoder sofre mais)
    public void ClassifyFeed_IsHealthy_AtOrAboveTarget(double feedFps)
    {
        Assert.Equal(FeedState.Healthy, CapacityGuardMath.ClassifyFeed(feedFps, 60));
    }

    [Theory]
    [InlineData(5.8)] // a assinatura do colapso de 2026-10-01
    [InlineData(39)]
    [InlineData(46.9)]
    public void ClassifyFeed_IsDeficient_BelowTarget(double feedFps)
    {
        Assert.Equal(FeedState.Deficient, CapacityGuardMath.ClassifyFeed(feedFps, 60));
    }

    // ── ShouldDegradeForCapacity com FeedState: a decisão real ───────

    [Fact]
    public void ShouldDegrade_False_WhenFeedUnknown_EvenWithSlowEncoder()
    {
        // speed 0,55x + lag 35s = a assinatura exata do log de 2026-10-01. Sem
        // medição de feed não há prova de que o encoder seja o gargalo, e o custo
        // de errar é alto: restart do ffmpeg (descarta backlog e PTS) + 720p
        // pelo resto da sessão. Ausência de evidência não é evidência.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.55, 35, FeedState.Unknown));
    }

    [Fact]
    public void ShouldDegrade_False_WhenFeedDeficient_EvenWithSlowEncoder()
    {
        // Feed devendo frames: reduzir a escala não recupera nenhum frame.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.55, 35, FeedState.Deficient));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 1564, FeedState.Deficient));
    }

    [Fact]
    public void ShouldDegrade_True_WhenFeedHealthyAndEncoderSlow()
    {
        // Feed no alvo + encoder com speed 0,62x e lag alto = gargalo comprovado.
        Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 255, FeedState.Healthy));
    }

    [Theory]
    [InlineData(0.02, 35)] // stall — watchdog/reinit, não o guard
    [InlineData(0.05, 35)]
    [InlineData(0.95, 35)] // encoder acompanha, o lag drena sozinho
    [InlineData(1.02, 35)]
    [InlineData(0.55, 10)] // lag abaixo do threshold
    public void ShouldDegrade_False_WhenSpeedOrLagUnfit_RegardlessOfFeed(
        double speedX, double outputLag)
    {
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(speedX, outputLag, FeedState.Healthy));
    }

    // ── TryDegradeScaleForCapacity: a mesma decisão, com o feed real ──

    /// <summary>
    /// Regressão 2026-10-01: encoder com speed 0,55x e lag de 35s, mas SEM medição
    /// de feed (o WGC colapsou e a janela do encoder nunca fechou). O guard degradava
    /// para 1280x720 e reiniciava o ffmpeg no meio do colapso de captura.
    /// </summary>
    [Fact]
    public void TryDegrade_ReturnsFalse_WhenFeedIsUnmeasured()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, feedFps: null);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.55, 35);

        // Nenhum RecordFeedFrame: o FeedFps do encoder é 0 = desconhecido.
        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
        Assert.Equal("av1_amf", enc.CurrentCodec);
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenFeedCollapsedToFivePointEightFps()
    {
        // A assinatura medida: FeedTelemetry fps=5,8 good=29 fail=183 na janela
        // em que o guard degradou. Com o feed medido e deficitário, não degrada.
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, feedFps: 5.8);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.55, 35);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
    }

    /// <summary>
    /// O caminho que TEM que degradar: feed no alvo e encoder comprovadamente
    /// lento. É o cenário AMD de 2026-09-18 que o capacity guard foi criado para
    /// cortar — e que os testes antigos cobriam sem nunca medir o feed.
    /// </summary>
    [Fact]
    public void TryDegrade_ReturnsTrue_WhenFeedMeasuredAtTarget()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, feedFps: 60);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.55, 35);

        Assert.True(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenFeedMeasuredAtThirtyNineFps()
    {
        // A assinatura do plano (E5): WGC entregando ~39 fps contra -r 60. O
        // outputLag cresce por relógio, não por lentidão do encoder.
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, feedFps: 39);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.65, 12600);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
    }

    /// <summary>
    /// Sem alvo nominal conhecido não há como classificar o feed, então o estado é
    /// <see cref="FeedState.Unknown"/> e o guard segura — mesmo com o encoder lento.
    /// É a direção segura: segurar custa backlog, degradar errado custa 720p + restart.
    /// </summary>
    [Fact]
    public void TryDegrade_ReturnsFalse_WhenNominalFpsIsUnknown()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, feedFps: 60);
        SetField(enc, "_frameRate", 0);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.55, 35);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
    }

    // ── Promoção: restaurar a resolução que o GUARD degradou ───────────
    //
    // Regressão de runtime 2026-10-01: o guard degradou para 1280x720 num colapso
    // do WGC, o encoder se recuperou (speed 1,01x, lag -1s às 21:36) e a resolução
    // NÃO voltou — todas as gravações seguintes ficaram em 720p até o app
    // reiniciar. A degradação era de mão única.
    //
    // A promoção é o caminho mais perigoso do guard: reiniciar o ffmpeg para
    // RECUPERAR qualidade custa o mesmo restart que a degradação custa, então ela
    // precisa de histerese (dwell) e cooldown, senão o par degrada/promove vira
    // oscilação a cada minuto.

    private static void SetTicksAgo(FfmpegEncoder enc, string field, double seconds)
    {
        SetField(enc, field, Stopwatch.GetTimestamp() - (long)(seconds * Stopwatch.Frequency));
    }

    /// <summary>Coloca o encoder no estado em que o guard o deixou: degradado em 1/2.</summary>
    private static FfmpegEncoder CreateGuardDegradedEncoder(double? feedFps = 60)
    {
        var enc = CreateDegradableEncoder("av1_amf", 2, 1, feedFps: feedFps);
        SetField(enc, "_capacityAppliedCodec", "av1_amf");
        SetField(enc, "_capacityAppliedDivisor", 2);
        return enc;
    }

    [Fact]
    public void PreviousScaleStep_ReturnsSmallerDivisorSameCodec()
    {
        var prev = FfmpegEncoder.PreviousScaleStepFor(Chain, "av1_amf", 4);
        Assert.NotNull(prev);
        Assert.Equal("av1_amf", prev!.Codec);
        Assert.Equal(2, prev.ScaleDivisor);
    }

    [Fact]
    public void PreviousScaleStep_ReturnsNull_WhenAlreadyFullResolution()
    {
        Assert.Null(FfmpegEncoder.PreviousScaleStepFor(Chain, "av1_amf", 1));
    }

    [Fact]
    public void PreviousScaleStep_DoesNotCrossCodecs()
    {
        // h264_amf está em full-res na cadeia; não há degrau anterior de h264_amf.
        Assert.Null(FfmpegEncoder.PreviousScaleStepFor(Chain, "h264_amf", 1));
    }

    // ── A decisão pura da promoção ────────────────────────────────────

    [Fact]
    public void ShouldPromote_True_WhenEncoderRecoveredAndBacklogDrained()
    {
        Assert.True(FfmpegEncoder.ShouldPromoteForCapacity(1.01, -1, FeedState.Healthy, 2));
    }

    [Fact]
    public void ShouldPromote_False_WhenAlreadyFullResolution()
    {
        Assert.False(FfmpegEncoder.ShouldPromoteForCapacity(1.01, -1, FeedState.Healthy, 1));
    }

    [Theory]
    [InlineData(0.62)] // encoder ainda lento
    [InlineData(0.94)] // na faixa de lentidão
    public void ShouldPromote_False_WhenEncoderNotRecovered(double speedX)
    {
        Assert.False(FfmpegEncoder.ShouldPromoteForCapacity(speedX, -1, FeedState.Healthy, 2));
    }

    [Fact]
    public void ShouldPromote_False_WhenBacklogNotDrained()
    {
        Assert.False(FfmpegEncoder.ShouldPromoteForCapacity(1.01, 255, FeedState.Healthy, 2));
    }

    [Theory]
    [InlineData(FeedState.Unknown)]
    [InlineData(FeedState.Deficient)]
    public void ShouldPromote_False_WhenFeedIsNotHealthy(FeedState feed)
    {
        // Simetria com a degradação: só se promove sob as mesmas condições em que se
        // degrada. Promover com o feed desconhecido re-promoveria para 1080p um
        // encoder que não sustenta — e o próximo tick degradaria de novo.
        Assert.False(FfmpegEncoder.ShouldPromoteForCapacity(1.01, -1, feed, 2));
    }

    // ── A promoção aplicada ───────────────────────────────────────────

    [Fact]
    public void TryPromote_AdvancesBackToFullResolution_AfterDwell()
    {
        var enc = CreateGuardDegradedEncoder();
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);

        Assert.True(enc.TryPromoteScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
        Assert.Equal("av1_amf", enc.CurrentCodec);
    }

    [Fact]
    public void TryPromote_ReturnsFalse_BeforeTheDwellElapses()
    {
        // A histerese que impede a oscilação: o encoder acabou de recuperar, ainda não
        // provou que aguenta.
        var enc = CreateGuardDegradedEncoder();
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", 5);

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }

    [Fact]
    public void TryPromote_ReturnsFalse_WithoutAHealthyStreak()
    {
        var enc = CreateGuardDegradedEncoder();
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetField(enc, "_healthySinceTicks", 0L); // streak nunca começou

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }

    [Fact]
    public void TryPromote_ReturnsFalse_WhenRecentlyPromoted()
    {
        // Cooldown: sem ele, um par promover/degradar/promover ficava e voltava a cada
        // cooldown de 60s, gastando dois restarts de ffmpeg por minuto.
        var enc = CreateGuardDegradedEncoder();
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);
        SetTicksAgo(enc, "_lastCapacityPromoteTicks", 30);

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }

    [Fact]
    public void TryPromote_ReturnsFalse_WhenTheDegradationWasNotTheGuards()
    {
        // O 1/2 veio do cascading fallback (o codec 1/2 é a entrada dele), não do
        // guard de capacidade. Promover aqui trocaria o codec/índice da cadeia por
        // baixo dos panos.
        var enc = CreateDegradableEncoder("av1_amf", 2, 1);
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }

    [Fact]
    public void TryPromote_ReturnsFalse_WhenTheCodecFallbackMovedOn()
    {
        // O guard degradou, mas o cascading fallback depois trocou de codec: o
        // divisor atual já não é o que o guard aplicou.
        var enc = CreateGuardDegradedEncoder();
        SetField(enc, "_codec", "libx264");
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);

        Assert.False(enc.TryPromoteScaleForCapacity());
    }

    [Fact]
    public void TryPromote_ReturnsFalse_WhenAlreadyAtFullResolution()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0);
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
    }

    [Fact]
    public void TryPromote_ReturnsFalse_WhenStepWouldNotChangeResolution()
    {
        // 1/2 e 1/4 convergem no piso 1280x720: promover 1/4 → 1/2 não mudaria byte
        // nenhum dos argumentos e gastaria um restart.
        var enc = CreateDegradableEncoder("av1_amf", 4, 2, feedFps: 60);
        SetField(enc, "_capacityAppliedCodec", "av1_amf");
        SetField(enc, "_capacityAppliedDivisor", 4);
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(4, enc.ScaleDivisor);
    }

    [Fact]
    public void TryPromote_ReturnsFalse_WhenRestartFails_ButAppliesState()
    {
        // Mesma semântica da degradação: o estado avança antes do restart.
        var enc = CreateGuardDegradedEncoder();
        SetField(enc, "_restartOverrideForCapacity", (Func<bool>)(() => false));
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
    }

    [Fact]
    public void TryPromote_DoesNotFire_WhenEncoderIsStillBehind()
    {
        // O encoder continua em speed 0,62x (o caso do log): nada a promover.
        var enc = CreateGuardDegradedEncoder();
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);
        SetTicksAgo(enc, "_healthySinceTicks", FfmpegEncoder.CapacityPromoteDwellSec + 10);

        Assert.False(enc.TryPromoteScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }

    // ── A histerese que impede a oscilação ────────────────────────────

    [Fact]
    public void TickCapacityGuard_HealthyStreakSurvivesOnlyWhileTheEncoderKeepsUp()
    {
        // O streak é zerado por qualquer tick fora da faixa. Sem isso, um único
        // momento saudável arranca o relógio e a promoção acontece no próximo tick
        // ruim — que é exatamente a oscilação.
        var enc = CreateGuardDegradedEncoder();
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);
        enc.TickCapacityGuard();
        Assert.Equal(0L, GetField(enc, "_healthySinceTicks"));

        // `SimulateFeed` de novo: a janela simulada ENVELHECE com o tempo (é uma
        // janela de 3s que ninguém re-alimenta), então o fps lido cai abaixo do alvo
        // e o feed vira Deficient. Em produção `RecordFeedFrame` a renova a cada frame.
        SimulateFeed(enc, 60);
        FfmpegEncoder.SetLastProgressForTest(enc, 1.01, -1);
        enc.TickCapacityGuard();
        Assert.NotEqual(0L, GetField(enc, "_healthySinceTicks"));

        // E um tick ruim cancela o streak inteiro, mesmo já quase no dwell.
        SimulateFeed(enc, 60);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.30, 0);
        enc.TickCapacityGuard();
        Assert.Equal(0L, GetField(enc, "_healthySinceTicks"));
    }

    [Fact]
    public void TickCapacityGuard_DoesNotPromoteOnTheSameTickItWouldDegrade()
    {
        // Feed no alvo + encoder lento = degrada. Promover no mesmo tick seria
        // contraditório; a ordem é sempre degradar, e só promover se não degradou.
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, feedFps: 60);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.True(enc.TickCapacityGuard());
        Assert.Equal(2, enc.ScaleDivisor);
    }
}