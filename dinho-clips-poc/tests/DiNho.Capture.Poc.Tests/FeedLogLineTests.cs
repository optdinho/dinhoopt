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
        QueueDepthMax: QueueMax);

    [Fact]
    public void Build_IncludesCodecScaleSpeedLag()
    {
        var line = FeedLogLine.Build(Summary, "libx264", 1, 0.622, 1564);
        Assert.StartsWith("fps=39.4 good=197 fail=0 enqNull=0", line);
        Assert.Contains("wait=10.9ms copy=0.1ms convert=2.6ms total=13.6ms", line);
        Assert.Contains("queue=0.2 avg / 2 max", line);
        Assert.EndsWith("codec=libx264 scale=full speed=0.62x lag=1564s", line);
    }

    [Fact]
    public void Build_ScaleDivisor2_FormatsHalfScale()
    {
        var line = FeedLogLine.Build(Summary, "h264_amf", 2, 0.9, 0);
        Assert.EndsWith("codec=h264_amf scale=1/2 speed=0.90x lag=0s", line);
    }

    [Fact]
    public void Build_InvariantCulture_IgnoresHostLocale()
    {
        // Mesmo com cultura pt-BR ativa (vírgula decimal), a saída usa ponto.
        var original = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo("pt-BR");
        try
        {
            var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 3.5, 12);
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
        var line = FeedLogLine.Build(Summary, "?", 1, 0, 0);
        Assert.EndsWith("codec=? scale=full speed=0.00x lag=0s", line);
    }

    // O log tem que mostrar as DUAS populações: `total` (média dos limpos) e `totalAll`
    // (média de todos), com a população de cada uma. Sem isso quem lê o log tenta
    // `total × good`, e o número não fecha quando há outlier.
    [Fact]
    public void Build_ExpoeAsDuasPopulacoes_ComContagemDaMedia()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5);
        Assert.Contains("total=13.6ms", line);
        Assert.Contains("clean=193/197", line);
        Assert.Contains("totalAll=18.9ms", line);
    }

    // `totalAll` precisa vir depois de `total` na MESMA linha e no MESMO bloco: se ficasse
    // no fim, colado no bloco do encoder, pareceria métrica do ffmpeg e não do feed.
    [Fact]
    public void Build_TotalAllFicaNoBlocoDoFeed_AntesDoBlocoDoEncoder()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5);
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
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5);
        Assert.Contains("pace=delay 13.4ms + spin 0.2ms", line);
    }

    // `iters` é o denominador real do pacing: sem ele não dá para saber se o período
    // fecha com as iterações que viraram frame ou se há iterações queimadas.
    [Fact]
    public void Build_ExpoeIters_ContadorDeIteracoesDoLoop()
    {
        var line = FeedLogLine.Build(Summary, "av1_nvenc", 1, 0.64, 5);
        Assert.Contains("iters=211", line);
    }
}