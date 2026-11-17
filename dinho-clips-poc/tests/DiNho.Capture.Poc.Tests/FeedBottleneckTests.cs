using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Números reais das janelas de degradação de 2026-11-16 (60 fps, orçamento 16,67 ms).
/// O log dizia "o encoder não é o gargalo" em todas elas — a atribuição era circular.
/// </summary>
public sealed class FeedBottleneckTests
{
    [Fact]
    public void DegradedWindow_36Fps_ConvertDominates_IsConvertBound()
    {
        // 20:30:04.704 — fps=36.0 wait=1.3ms convert=23.7ms total=25.1ms
        Assert.Equal(
            FeedBottleneckVerdict.ConvertBound,
            FeedBottleneck.Classify(36.0, 60, waitMs: 1.3, convertMs: 23.7));
    }

    [Fact]
    public void DegradedWindow_30Fps_WorstConvert_IsConvertBound()
    {
        // 20:30:20.247 — fps=30.0 convert=30.6ms
        Assert.Equal(
            FeedBottleneckVerdict.ConvertBound,
            FeedBottleneck.Classify(30.0, 60, waitMs: 0.8, convertMs: 30.6));
    }

    [Fact]
    public void HealthyWindow_IsSustained()
    {
        // 23:10:07.918 de 2026-11-15 — fps=60.0 wait=0.6ms convert=8.3ms
        Assert.Equal(
            FeedBottleneckVerdict.Sustained,
            FeedBottleneck.Classify(60.0, 60, waitMs: 0.6, convertMs: 8.3));
    }

    [Fact]
    public void SourceWaits_IsSourceBound()
    {
        // WGC a entregar a 11,6 ms por frame (sessão FiveM de 2026-09-15).
        Assert.Equal(
            FeedBottleneckVerdict.SourceBound,
            FeedBottleneck.Classify(30.0, 60, waitMs: 22.0, convertMs: 2.0));
    }

    [Fact]
    public void DegradedWindow_48Fps_ConvertAtBudget_IsConvertBound()
    {
        // Janela real de 11-16: fps=48.0 wait=0.6ms convert=16.9ms skip=83/323 (26%).
        // O convert sozinho come o slot de 16,67 ms — a 120% isto ficava sem atribuição.
        Assert.Equal(
            FeedBottleneckVerdict.ConvertBound,
            FeedBottleneck.Classify(48.0, 60, waitMs: 0.6, convertMs: 16.9));
    }

    [Fact]
    public void DegradedWindow_54Fps_IsNotDeclaredSustained()
    {
        // 10 janelas de 11-16 ficaram exatamente em 54 fps com 13% dos slots perdidos.
        // Com o limiar antigo de 90% (54 ≥ 54) eram declaradas saudáveis.
        Assert.Equal(
            FeedBottleneckVerdict.ConvertBound,
            FeedBottleneck.Classify(54.0, 60, waitMs: 0.6, convertMs: 18.4));
    }

    [Fact]
    public void WorstHealthyWindow_IsSustained()
    {
        // Pior convert medido nas janelas sem perda (559 janelas de 11-16): 14,6 ms a 60 fps.
        Assert.Equal(
            FeedBottleneckVerdict.Sustained,
            FeedBottleneck.Classify(60.0, 60, waitMs: 0.8, convertMs: 14.6));
    }

    [Fact]
    public void NearNominal_IsNotDeficient()
    {
        // "feed entrega 59,9fps (alvo 60, déficit 0%/s)" já apareceu no log como se
        // fosse falha. 0,17% abaixo do alvo é ruído.
        Assert.Equal(
            FeedBottleneckVerdict.Sustained,
            FeedBottleneck.Classify(59.9, 60, waitMs: 1.0, convertMs: 6.0));
    }

    [Fact]
    public void NoMeasurement_IsUnknown()
    {
        Assert.Equal(
            FeedBottleneckVerdict.Unknown,
            FeedBottleneck.Classify(0, 60, waitMs: 0, convertMs: 0));
        Assert.Equal(
            FeedBottleneckVerdict.Unknown,
            FeedBottleneck.Classify(30, 0, waitMs: 1, convertMs: 30));
    }

    [Fact]
    public void DeficitWithoutDominantStage_IsUnknown()
    {
        // Nem convert nem wait explicam: melhor não atribuir culpa do que mentir.
        Assert.Equal(
            FeedBottleneckVerdict.Unknown,
            FeedBottleneck.Classify(40.0, 60, waitMs: 2.0, convertMs: 8.0));
    }

    [Theory]
    [InlineData(60, 16.6667)]
    [InlineData(30, 33.3333)]
    [InlineData(0, 0)]
    public void SlotBudget_MatchesFramePeriod(double fps, double expectedMs)
    {
        Assert.Equal(expectedMs, FeedBottleneck.SlotBudgetMs(fps), 3);
    }
}
