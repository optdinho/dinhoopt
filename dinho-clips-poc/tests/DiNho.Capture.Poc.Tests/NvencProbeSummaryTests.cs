namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Item 5: o relatório do <c>--probe-nvenc</c> anunciava "melhor preset que sustenta ≥51fps"
/// e imprimia o <b>argmax</b> do fps medido — ou seja, respondia "qual preset é mais rápido?"
/// enquanto dizia "qual preset tem a melhor qualidade que ainda sustenta?".
///
/// A inversão não é cosmética: a semântica do NVENC é p1 = fastest/lowest quality e
/// p7 = slowest/best quality (<c>ffmpeg -h encoder=h264_nvenc</c>), então ler a tabela ao
/// contrário produz conclusionões erradas — foi exatamente o que gerou a premissa quebrada do
/// Item 5 no plano (achar que p7 era o preset mais rápido).
///
/// Estes testes travam as DUAS perguntas separadamente, e o caso que mais importa: quando
/// todos os presets sustentam (situação real a 1080p60, 5-6x o alvo), o argmax é ruído e a
/// resposta útil é o p7.
/// </summary>
public class NvencProbeSummaryTests
{
    private static Dictionary<string, double?> Measured(params (string Preset, double? Fps)[] rows)
        => rows.ToDictionary(r => r.Preset, r => r.Fps);

    [Fact]
    public void SummarizeNvencProbe_AllPresetsSustain_ReportsP7_NotTheFastest()
    {
        // Caso real medido na RTX 5050 a 1080p60: p7 sustenta 287fps contra o alvo de 60, e o
        // preset mais rápido do run foi p2. A resposta útil é p7 (melhor qualidade que
        // sustenta); o antigo relatório diria p2.
        var summary = ProgramBenchmark.SummarizeNvencProbe(Measured(
            ("p7", 287.54), ("p6", 331.49), ("p5", 374.22), ("p4", 386.27),
            ("p3", 382.98), ("p2", 396.48), ("p1", 358.57)), targetFps: 60);

        Assert.Equal("p2", summary.FastestPreset);
        Assert.Equal(396.48, summary.FastestFps);
        Assert.Equal("p7", summary.BestQualitySustaining);
        Assert.Equal(287.54, summary.BestQualitySustainingFps);
    }

    [Fact]
    public void SummarizeNvencProbe_WeakGpu_P7TooSlow_PicksFirstSustainingInLadder()
    {
        // GPU fraca: p7/p6 não seguram, p5 segura. A escada p7→p1 (pior→melhor qualidade)
        // devolve p5 — a melhor qualidade que ainda sustenta, que é o que a produção usa.
        var summary = ProgramBenchmark.SummarizeNvencProbe(Measured(
            ("p7", 30.0), ("p6", 40.0), ("p5", 55.0), ("p4", 60.0),
            ("p3", 70.0), ("p2", 80.0), ("p1", 90.0)), targetFps: 60);

        Assert.Equal("p5", summary.BestQualitySustaining);
        Assert.Equal("p1", summary.FastestPreset);
    }

    [Fact]
    public void SummarizeNvencPreset_ThresholdIs85Percent_SameCutAsProduction()
    {
        // 0.85 × 60 = 51. Um preset que mede exatamente 51 sustenta; 50,99 não. O corte tem que
        // ser o mesmo do EncoderManager.SelectNvencPreset, senão o CLI e a produção discordam
        // do que é "sustentável" e o número deixa de servir para decidir o preset.
        var atThreshold = ProgramBenchmark.SummarizeNvencProbe(
            Measured(("p7", 50.99), ("p6", 51.0)), targetFps: 60);
        Assert.Equal("p6", atThreshold.BestQualitySustaining);
        Assert.Equal(51.0, atThreshold.SustainThresholdFps);

        var belowThreshold = ProgramBenchmark.SummarizeNvencProbe(
            Measured(("p7", 50.99)), targetFps: 60);
        Assert.Null(belowThreshold.BestQualitySustaining);
    }

    [Fact]
    public void SummarizeNvencProbe_NothingSustains_ReportsNull_AndLineSaysSo()
    {
        // O caso que precisa de alerta explícito: GPU que não dá conta do alvo. O relatório
        // antigo imprimiria "melhor: p1 (12fps)" e pareceria uma escolha sadia.
        var summary = ProgramBenchmark.SummarizeNvencProbe(
            Measured(("p7", 5.0), ("p1", 12.0)), targetFps: 60);

        Assert.Null(summary.BestQualitySustaining);
        Assert.Equal("p1", summary.FastestPreset);
        var line = summary.ToReportLine(60);
        Assert.Contains("NENHUM sustenta", line);
        // "0.00" é culture-dependent (pt-BR dá "12,00"), então o esperado é formatado com a
        // cultura corrente em vez de hardcodar o separador decimal.
        Assert.Contains(12.0.ToString("0.00"), line);
    }

    [Fact]
    public void SummarizeNvencProbe_FailedPresets_AreSkippedNotTreatedAsZero()
    {
        // null = o probe falhou (exit != 0, driver sem suporte). Não pode contar como 0 fps e
        // também não pode "sustentar" o alvo. Um p7 que falhou não é a melhor qualidade.
        var summary = ProgramBenchmark.SummarizeNvencProbe(
            Measured(("p7", null), ("p6", 60.0), ("p1", 90.0)), targetFps: 60);

        Assert.Equal("p6", summary.BestQualitySustaining);
        Assert.Equal("p1", summary.FastestPreset);
    }

    [Fact]
    public void SummarizeNvencProbe_AllFailed_ReportsNotMeasured()
    {
        var summary = ProgramBenchmark.SummarizeNvencProbe(
            Measured(("p7", null), ("p6", null)), targetFps: 60);

        Assert.False(summary.AnyMeasured);
        Assert.Null(summary.FastestPreset);
        Assert.Null(summary.BestQualitySustaining);
        Assert.Contains("nenhum preset medido", summary.ToReportLine(60));
    }

    [Fact]
    public void SummarizeNvencProbe_EmptyResult_IsSafe()
    {
        var summary = ProgramBenchmark.SummarizeNvencProbe(
            new Dictionary<string, double?>(), targetFps: 60);

        Assert.False(summary.AnyMeasured);
        Assert.Contains("nenhum preset medido", summary.ToReportLine(60));
    }

    [Fact]
    public void NvencPresetLadder_IsOrderedBestToLowestQuality()
    {
        // A ordem da escada É a semântica: p7 = slowest (best quality) até p1 = fastest
        // (lowest quality). Inverter esta lista faria a escada devolver p1 como "melhor
        // qualidade que sustenta" — o oposto do que a produção faz.
        Assert.Equal(
            new[] { "p7", "p6", "p5", "p4", "p3", "p2", "p1" },
            ProgramBenchmark.NvencPresetLadder);
    }

    [Fact]
    public void ToReportLine_NamesBothQuestions()
    {
        // O rótulo é o contrato com quem lê a tabela: precisa dizer que os dois números são
        // perguntas diferentes, senão o próximo teste de hardware repete a confusão.
        var summary = ProgramBenchmark.SummarizeNvencProbe(Measured(
            ("p7", 287.54), ("p2", 396.48)), targetFps: 60);

        var line = summary.ToReportLine(60);
        Assert.Contains("mais rápido", line);
        Assert.Contains("melhor qualidade que sustenta", line);
        Assert.Contains("p2", line);
        Assert.Contains("p7", line);
    }
}
