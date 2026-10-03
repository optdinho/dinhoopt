using System.Globalization;
using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class FeedLogLineTests
{
    // O formatter usa cultura INVARIANTE: independe do locale da máquina (pt-BR/Brasil usa
    // vírgula como separador decimal). Garante logs parseáveis em qualquer ambiente.
    private const int Good = 197, EncodeNull = 0, Fail = 0, QueueMax = 2;
    private const double Wait = 10.9, Copy = 0.1, Convert = 2.6, Total = 13.6, Fps = 39.4, QueueAvg = 0.2;
    // Janela com 4 outliers: a média limpa e a média de todos precisam aparecer JUNTAS, senão
    // o log mostra um `total` que não multiplica pelo `good` e a conta não fecha.
    private const int Clean = 193;
    private const double TotalAll = 18.9;
    private const double PacingDelay = 13.4, PacingSpin = 0.2;
    private const double Diag = 4.1;

    private static readonly FeedSummary Summary = new(
        GoodFrames: Good,
        EncodeNulls: EncodeNull,
        FailFrames: Fail,
        WaitMs: Wait,
        CopyMs: Copy,
        ConvertMs: Convert,
        TotalMs: Total,
        CleanFrames: Clean,
        TotalMsAll: TotalAll,
        PacingDelayMs: PacingDelay,
        PacingSpinMs: PacingSpin,
        PacingCount: 211,
        FeedFps: Fps,
        QueueDepthAvg: QueueAvg,
        QueueDepthMax: QueueMax,
        DiagnosticsMs: Diag);

    [Fact]
    public void Build_IncludesCodecScaleSpeedLag()
    {
        var line = FeedLogLine.Build(Summary, "libx264", 1, 0.622, 1564, 60);
        Assert.StartsWith("fps=39.4 good=197 fail=0 enqNull=0", line);
        Assert.Contains("wait=10.9ms copy=0.1ms convert=2.6ms total=13.6ms", line);
        Assert.Contains("queue=0.2 avg / 2 max", line);
        Assert.EndsWith("codec=libx264 scale=full speed=0.62x outLag=1564s feedLag=34%/s", line);
    }

    [Fact]
    public void Build_ScaleDivisor2_FormatsHalfScale()
    {
        var line = FeedLogLine.Build(Summary, "h264_amf", 2, 0.9, 0, 60);
        Assert.EndsWith("codec=h264_amf scale=1/2 speed=0.90x outLag=0s feedLag=34%/s", line);
    }

    [Fact]
    public void Build_InvariantCulture_IgnoresHostLocale()
    {
        // Mesmo com cultura pt-BR ativa (vírgula decimal), a saída usa ponto.
        var original = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo("pt-BR");
        try
        {
            var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 3.5, 12, 60);
            Assert.Contains("wait=10.9ms", line);
            Assert.Contains("speed=3.50x", line);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void Build_EncoderDesconhecido_UsaInterrogacao()
    {
        var line = FeedLogLine.Build(Summary, "?", 1, 0, 0, 60);
        Assert.EndsWith("codec=? scale=full speed=0.00x outLag=0s feedLag=34%/s", line);
    }

    // O log tem que mostrar as DUAS populações: `total` (média dos limpos) e `totalAll`
    // (média de todos), com a população de cada uma. Sem isso quem lê o log tenta
    // `total × good`, e o número não fecha quando há outlier.
    [Fact]
    public void Build_ExpoeAsDuasPopulacoes_ComContagemDaMedia()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5, 60);
        Assert.Contains("total=13.6ms", line);
        Assert.Contains("clean=193/197", line);
        Assert.Contains("totalAll=18.9ms", line);
    }

    // `totalAll` precisa vir depois de `total` na MESMA linha e no MESMO bloco: se ficasse
    // no fim, colado no bloco do encoder, pareceria métrica do ffmpeg e não do feed.
    [Fact]
    public void Build_TotalAllFicaNoBlocoDoFeed_AntesDoBlocoDoEncoder()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5, 60);
        var totalAllIdx = line.IndexOf("totalAll=", StringComparison.Ordinal);
        var queueIdx = line.IndexOf("queue=", StringComparison.Ordinal);
        var codecIdx = line.IndexOf("codec=", StringComparison.Ordinal);
        Assert.True(totalAllIdx > 0 && queueIdx > totalAllIdx && codecIdx > queueIdx,
            $"ordem inesperada: {line}");
    }

    // O pacing precisa mostrar os DOIS lados (delay e spin) separados: é a distinção entre
    // "o Task.Delay estourou" e "o spin passou do alvo", e por isso eles não podem somar
    // num número só.
    [Fact]
    public void Build_PacingMostraDelayESpinSeparados()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5, 60);
        Assert.Contains("pace=delay 13.4ms + spin 0.2ms", line);
    }

    // `iters` é o denominador real do pacing: sem ele não dá para saber se o período
    // fecha com as iterações que viraram frame ou se há iterações queimadas.
    [Fact]
    public void Build_ExpoeIters_ContadorDeIteracoesDoLoop()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5, 60);
        Assert.Contains("iters=211", line);
    }

    // `diag` fica no bloco do feed, entre `totalAll` (fim do trabalho medido) e `pace`:
    // é a metade "fora do total" do período que o pacing não cobre.
    [Fact]
    public void Build_ExpoeDiagnostico_EntreTotalAllEPace()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5, 60);
        Assert.Contains("diag=4.1ms", line);
        var totalAllIdx = line.IndexOf("totalAll=", StringComparison.Ordinal);
        var diagIdx = line.IndexOf("diag=", StringComparison.Ordinal);
        var paceIdx = line.IndexOf("pace=", StringComparison.Ordinal);
        Assert.True(totalAllIdx > 0 && diagIdx > totalAllIdx && paceIdx > diagIdx,
            $"ordem inesperada: {line}");
    }

    // `outLag` (elapsed−time do ffmpeg) cresce por relógio e engana; `feedLag` é o déficit
    // honesto do feed (mídia/s de wall-clock). Feed no alvo → 0%, mesmo com outLag alto.
    [Fact]
    public void Build_FeedLagZero_QuandoFeedNoAlvo()
    {
        var healthy = Summary with { FeedFps = 60 };
        var line = FeedLogLine.Build(healthy, "av1_nvenc", 1, 0.99, 173, 60);
        Assert.EndsWith("speed=0.99x outLag=173s feedLag=0%/s", line);
    }

    // =============================================================
    // Bloco CFR (2026-10-03). Sem estes campos o log de 5 s não distingue
    // "60 fps reais" de "57,8 fps com 542 buracos" — as duas coisas imprimem fps≈58.
    // =============================================================

    private static readonly FeedSummary CfrSummary = Summary with
    {
        TotalMsMax = 44.2,
        OverrunFrames = 7,
        DuplicateFrames = 12,
        MaxConsecutiveDup = 2,
        SkippedFrames = 3,
    };

    [Fact]
    public void Build_ExpoeBlocoCfr_Completo()
    {
        var line = FeedLogLine.Build(CfrSummary, "av1_nvenc", 1, 0.64, 5, 60);
        Assert.Contains("totalMax=44.2ms", line);
        Assert.Contains("over=7", line);
        Assert.Contains("dup=12", line);
        Assert.Contains("dupMax=2", line);
        Assert.Contains("skip=3", line);
    }

    // O bloco CFR pertence ao FEED, não ao encoder: tem de ficar depois de `totalAll`
    // e antes de `queue`/`codec`, ou quem lê o log atribui as contagens ao ffmpeg.
    [Fact]
    public void Build_BlocoCfrFicaNoBlocoDoFeed_AntesDaQueue()
    {
        var line = FeedLogLine.Build(CfrSummary, "av1_nvenc", 1, 0.64, 5, 60);
        var totalAllIdx = line.IndexOf("totalAll=", StringComparison.Ordinal);
        var cfrIdx = line.IndexOf("totalMax=", StringComparison.Ordinal);
        var queueIdx = line.IndexOf("queue=", StringComparison.Ordinal);
        var codecIdx = line.IndexOf("codec=", StringComparison.Ordinal);
        Assert.True(totalAllIdx > 0 && cfrIdx > totalAllIdx && queueIdx > cfrIdx && codecIdx > queueIdx,
            $"ordem inesperada: {line}");
    }

    // Sessão saudável: o bloco tem de aparecer na mesma, com zeros — a ausência de
    // "dup=3" é indistinguível de "campo não implementado".
    [Fact]
    public void Build_BlocoCfr_ApareceComZeros_QuandoSaudavel()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5, 60);
        Assert.Contains("totalMax=0.0ms", line);
        Assert.Contains("over=0 dup=0 dupMax=0 skip=0", line);
    }

    // `over` ao lado de `dup`: os dois juntos dizem QUAL dos dois mechanisms está a
    // furar a grelha (loop lento vs. WGC sem frame nova). Múltiplos espaços
    // separadores quebram o grep do log.
    [Fact]
    public void Build_OverEDup_FicamJuntos_SemEspacosDuplos()
    {
        var line = FeedLogLine.Build(CfrSummary, "av1_nvenc", 1, 0.64, 5, 60);
        Assert.DoesNotContain("  ", line);
        var overIdx = line.IndexOf("over=", StringComparison.Ordinal);
        var dupIdx = line.IndexOf("dup=", StringComparison.Ordinal);
        var dupMaxIdx = line.IndexOf("dupMax=", StringComparison.Ordinal);
        Assert.True(overIdx > 0 && dupIdx > overIdx && dupMaxIdx > dupIdx, $"ordem inesperada: {line}");
    }
}