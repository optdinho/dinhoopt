using System.Globalization;
using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class FeedLogLineTests
{
    // O formatter usa cultura INVARIANTE: independe do locale da máquina (pt-BR/Brasil usa
    // vírgula como separador decimal). Garante logs parseáveis em qualquer ambiente.
    private const int Good = 197, EncodeNull = 0, Fail = 0, QueueMax = 2;
    private const double Wait = 10.9, Copy = 0.1, Convert = 2.6, Total = 13.6, Fps = 39.4, QueueAvg = 0.2;

    private static readonly FeedSummary Summary = new(
        GoodFrames: Good,
        EncodeNulls: EncodeNull,
        FailFrames: Fail,
        WaitMs: Wait,
        CopyMs: Copy,
        ConvertMs: Convert,
        TotalMs: Total,
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
}