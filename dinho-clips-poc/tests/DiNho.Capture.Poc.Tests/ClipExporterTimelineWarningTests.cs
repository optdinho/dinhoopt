using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// O clip acelerado de 2026-11-16 saiu sem um único aviso: 49,17 s de 244,66 s
/// desapareceram e o log só tinha um <c>[PTS] Post-sync</c> informativo. Esta função
/// decide quando a diferença entre a duração esperada e a duração ativa já é um defeito
/// que o utilizador vai notar (não ruído de arredondamento) e devolve o texto do WARN.
/// </summary>
public sealed class ClipExporterTimelineWarningTests
{
    [Fact]
    public void RealAcceleratedClip_ReportsFactorAndLostSeconds()
    {
        // 20:32:03 de 2026-11-16 (×1,252 — o pior dos três clips do dia).
        var msg = ClipExporter.DescribeCollapsedTimeline(244.66, 195.48);

        Assert.NotNull(msg);
        Assert.Contains("49.18s", msg);
        Assert.Contains("x1.25", msg);
    }

    [Fact]
    public void SecondRealClip_ReportsFactor()
    {
        // 20:30:01 de 2026-11-16 (×1,084).
        var msg = ClipExporter.DescribeCollapsedTimeline(191.25, 176.41);

        Assert.NotNull(msg);
        Assert.Contains("x1.08", msg);
    }

    [Fact]
    public void SmallRoundingDifference_ReturnsNull()
    {
        // 0,66 s em 244,66 s = 0,27% — não é colapso.
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(244.66, 244.00));
    }

    [Fact]
    public void ShortClipBelowOneSecond_ReturnsNull()
    {
        // 0,1 s num clip de 10 s: abaixo do piso absoluto de 1 s.
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(10.0, 9.9));
    }

    [Fact]
    public void ExactlyTwoPercent_ReturnsNull()
    {
        // Limiar é "> max(1 s, 2%)": exatamente 2% ainda não avisa.
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(100.0, 98.0));
    }

    [Fact]
    public void AboveTwoPercent_Reports()
    {
        Assert.NotNull(ClipExporter.DescribeCollapsedTimeline(100.0, 97.9));
    }

    [Fact]
    public void NoCollapse_ReturnsNull()
    {
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(120.0, 120.0));
        // Áudio/vídeo ligeiramente mais longos que o esperado também não é colapso.
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(120.0, 121.0));
    }

    [Fact]
    public void InvalidInput_ReturnsNull()
    {
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(0, 0));
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(-1, 5));
        Assert.Null(ClipExporter.DescribeCollapsedTimeline(10, 0));
    }
}
