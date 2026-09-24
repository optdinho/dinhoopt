using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class FfmpegEncoderProgressTests
{
    // Linha real do stderr do ffmpeg (progress padrão `-stats`), como amostrada na sessão AMD.
    private const string RealProgressLine =
        "frame=24818 fps= 37 q=4.0 size=  797607KiB time=00:06:53.61 bitrate=15797.2kbits/s speed=0.618x elapsed=0:11:08.84    ";

    [Fact]
    public void TryParse_SpeedEmLag_DoProgressReal()
    {
        Assert.True(FfmpegEncoder.TryParseFfmpegProgress(RealProgressLine, out var speed, out var lagSeconds));
        Assert.Equal(0.618, speed, 3);
        // elapsed=0:11:08.84 - time=00:06:53.61 = 668,84s - 413,61s = 255,23s
        Assert.Equal(255.23, lagSeconds, 2);
    }

    [Fact]
    public void TryParse_LinhaSemSpeed_RetornaFalse()
    {
        Assert.False(FfmpegEncoder.TryParseFfmpegProgress(
            "frame=25070 fps= 37 q=4.0 size=  802684KiB", out _, out _));
    }

    [Fact]
    public void TryParse_SpeedSemTimeOuElapsed_LagZeroSemFalha()
    {
        // speed presente, time/elapsed ausentes → parse de speed ok, lag fica 0 (não lança).
        Assert.True(FfmpegEncoder.TryParseFfmpegProgress(
            "bitrate=15797.2kbits/s speed=0.618x", out var speed, out var lag));
        Assert.Equal(0.618, speed, 3);
        Assert.Equal(0.0, lag, 3);
    }

    [Fact]
    public void TryParse_NulaOuVazia_RetornaFalse()
    {
        Assert.False(FfmpegEncoder.TryParseFfmpegProgress(null, out _, out _));
        Assert.False(FfmpegEncoder.TryParseFfmpegProgress("", out _, out _));
        Assert.False(FfmpegEncoder.TryParseFfmpegProgress("   ", out _, out _));
    }

    [Fact]
    public void TryParse_TimeMaiorQueElapsed_LagNegativo()
    {
        // Preroll/credits podem deixar o PTS ahead do wall-clock — lag negativo é esperado e
        // não deve estourar (o diagnóstico quer o sinal, não o abs).
        const string line = "frame=1 fps=60 time=00:02:00.00 bitrate=1000.0kbits/s speed=1.0x elapsed=0:01:30.00";
        Assert.True(FfmpegEncoder.TryParseFfmpegProgress(line, out var speed, out var lag));
        Assert.Equal(1.0, speed, 3);
        Assert.Equal(-30.0, lag, 2);
    }
}