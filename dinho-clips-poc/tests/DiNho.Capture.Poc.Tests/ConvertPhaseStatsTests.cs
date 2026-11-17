using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// O log de 2026-11-16 provou que o gargalo era o <c>convert</c>, mas não qual das suas
/// quatro fases. Sem esta separação não se sabe se a correção é não bloquear no Map
/// (perder o frame é aceitável) ou aliviar a GPU/baixar o fps (blit/copy caros).
/// </summary>
public sealed class ConvertPhaseStatsTests
{
    [Fact]
    public void NoFrames_ReturnsNull()
    {
        Assert.Null(new ConvertPhaseStats().Take());
    }

    [Fact]
    public void SingleFrame_ReturnsTheFrameItself()
    {
        var stats = new ConvertPhaseStats();
        stats.Record(blitMs: 4.0, copyMs: 0.5, mapMs: 15.0, packMs: 4.2);

        var avg = stats.Take();

        Assert.NotNull(avg);
        Assert.Equal(4.0, avg!.Value.BlitMs, 3);
        Assert.Equal(0.5, avg.Value.CopyMs, 3);
        Assert.Equal(15.0, avg.Value.MapMs, 3);
        Assert.Equal(4.2, avg.Value.PackMs, 3);
        Assert.Equal(1, avg.Value.Frames);
    }

    [Fact]
    public void ManyFrames_ReturnsAverage()
    {
        var stats = new ConvertPhaseStats();
        for (int i = 0; i < 4; i++)
            stats.Record(blitMs: 2.0, copyMs: 1.0, mapMs: 6.0, packMs: 3.0);

        var avg = stats.Take();

        Assert.NotNull(avg);
        Assert.Equal(2.0, avg!.Value.BlitMs, 3);
        Assert.Equal(1.0, avg.Value.CopyMs, 3);
        Assert.Equal(6.0, avg.Value.MapMs, 3);
        Assert.Equal(3.0, avg.Value.PackMs, 3);
        Assert.Equal(4, avg.Value.Frames);
    }

    [Fact]
    public void Take_ResetsTheWindow()
    {
        var stats = new ConvertPhaseStats();
        stats.Record(5, 5, 5, 5);
        _ = stats.Take();

        Assert.Null(stats.Take());
    }

    [Fact]
    public void SecondWindow_HasOnlyTheNewFrames()
    {
        var stats = new ConvertPhaseStats();
        stats.Record(1, 1, 1, 1);
        _ = stats.Take();
        stats.Record(9, 9, 9, 9);

        var avg = stats.Take();

        Assert.Equal(9.0, avg!.Value.MapMs, 3);
        Assert.Equal(1, avg.Value.Frames);
    }
}
