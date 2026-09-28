using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// A escolha de <b>quem recebe as voltas extras</b> — a parte do sweep que decide o que o
/// relatório tem o direito de concluir.
///
/// <para><b>Por que estes testes existem.</b> Medido na RX 5700 XT (40 células, 3 finalistas,
/// 3 voltas), o relatório saiu assim:</para>
/// <code>
/// MELHOR CUSTO:      transcoding/qp30  5373388 bytes  79,21  260,4 fps
/// MELHOR VELOCIDADE: default/qp22      10927181 bytes 84,56  237,5 fps
/// </code>
/// <para>Um pick de "mais rápido" <b>22,9 fps mais lento</b> que o de "mais barato". A causa não
/// é ruído: a frente de Pareto tinha 12 células, e <c>front.Take(3)</c> pegou as 3 primeiras na
/// <b>ordem de iteração da grade</b> (usage-major), que neste caso foram
/// <c>default/qp22</c>, <c>default/qp32</c> e <c>default/qp34</c>. Duas delas <b>reprovavam o
/// portão de qualidade na triagem</b> (VMAF 76,65 e 73,46 contra 77,39) — 6 encodes gastos
/// remedindo célula que já tinha perdido. E a célula mais rápida que passava na qualidade
/// (<c>transcoding/qp30</c>, 260,4 fps) estava na frente, mas em 8º lugar, então nunca recebeu as
/// 3 voltas que a tornavam elegível.</para>
///
/// <para><b>Por que os números são literais e não arredondados.</b> A frente depende de "menor
/// byte" e de "igualdade conta como dominação": <c>transcoding/qp22</c> e <c>default/qp22</c>
/// têm os MESMOS bytes e o mesmo VMAF, e quem tem mais fps domina. Arredondar um byte troca quem
/// está na frente e o teste deixa de descrever o sweep que rodou.</para>
///
/// <para><b>Os testes de invariante, não de exemplo.</b> T2 fixa o defeito histórico; os demais
/// fixam a <b>propriedade</b> que o conserta, para que nenhum arrangement futuro a quebre de novo.</para>
/// </summary>
public class AmdFinalistSelectionTests
{
    private const double AnchorVmaf = 77.39;   // o VMAF da âncora medido: 77,39

    /// <summary>A grade real, 5 usage x 8 QP, <b>na ordem em que a triagem realmente percorreu</b>.
    ///
    /// <para><b>A ordem não é detalhe — é o mecanismo do defeito.</b> <c>Pareto</c> devolve as
    /// células na ordem de entrada, e o código antigo fazia <c>front.Take(3)</c>: logo, truncar era
    /// "as 3 primeiras do usage que vier primeiro". O log do sweep fixa a ordem como
    /// <b>usage-major</b> (<c>default qp22..qp36</c>, depois <c>transcoding qp22..qp36</c>, ... —
    /// ver as 21:32:54 a 21:37:45 do RESULT-SWEEP-AMD.txt), o que faz o teto pender para os
    /// membros mais baratos do <c>default</c> e deixar o <c>transcoding</c> sem as voltas.
    /// Montar este fixture na ordem errada (QP-major) reproduz uma frente diferente e o teste
    /// passa sem provar nada — foi exatamente o que aconteceu na 1ª versão deste arquivo.</para></summary>
    private static List<AmdSweepCell> Rx5700XtGrid()
    {
        // (bytes, VMAF, fps) por QP 22/24/26/28/30/32/34/36.
        var defaultRow = new (long B, double V, double F)[]
        {
            (10927181, 84.56, 237.5), (9201985, 83.62, 241.2), (7709415, 82.53, 247.7), (6436228, 81.14, 248.4),
            (5373388, 79.21, 255.9), (4286174, 76.65, 261.6), (3479188, 73.46, 265.7), (2561698, 69.65, 267.6),
        };
        // transcoding: BYTES E VMAF IDÊNTICOS ao default nos 8 QP (só o fps muda).
        var transcodingFps = new[] { 236.8, 246.1, 248.0, 252.9, 260.4, 260.1, 261.7, 263.3 };
        var ultralow = new (long B, double V, double F)[]
        {
            (11003562, 84.54, 232.6), (9271090, 83.59, 243.7), (7770486, 82.46, 250.0), (6490712, 81.07, 252.6),
            (5426308, 79.15, 244.4), (4338063, 76.60, 263.6), (3525037, 73.40, 269.1), (2607619, 69.47, 272.5),
        };
        // lowlatency: 1 byte de diferença em 4 células, idêntico nas outras — o eixo usage é no-op.
        var lowlatencyFps = new[] { 234.9, 243.4, 243.4, 249.2, 259.2, 260.3, 265.3, 265.6 };
        // high_quality: MESMO BYTE (+1) e MESMO VMAF do default, a 8,0 fps.
        var highQualityFps = new[] { 8.0, 8.0, 8.1, 7.9, 8.0, 8.0, 7.9, 8.1 };

        var cells = new List<AmdSweepCell>();

        // Usage-major, como o runner. Esta ordem É o que o teste abaixo fixa.
        for (var i = 0; i < 8; i++)
        {
            var qp = 22 + i * 2;
            cells.Add(new AmdSweepCell("", qp, true, defaultRow[i].B, defaultRow[i].V, defaultRow[i].F, 1));
        }
        for (var i = 0; i < 8; i++)
        {
            var qp = 22 + i * 2;
            cells.Add(new AmdSweepCell("transcoding", qp, true, defaultRow[i].B, defaultRow[i].V, transcodingFps[i], 1));
        }
        for (var i = 0; i < 8; i++)
        {
            var qp = 22 + i * 2;
            cells.Add(new AmdSweepCell("ultralowlatency", qp, true, ultralow[i].B, ultralow[i].V, ultralow[i].F, 1));
        }
        for (var i = 0; i < 8; i++)
        {
            var qp = 22 + i * 2;
            cells.Add(new AmdSweepCell("lowlatency", qp, true, ultralow[i].B, ultralow[i].V, lowlatencyFps[i], 1));
        }
        for (var i = 0; i < 8; i++)
        {
            var qp = 22 + i * 2;
            cells.Add(new AmdSweepCell("high_quality", qp, true, defaultRow[i].B + 1, defaultRow[i].V, highQualityFps[i], 1));
        }
        return cells;
    }

    [Fact]
    public void Fixture_ReproduzAOrdemUsageMajor_DaTriagemReal()
    {
        var labels = Rx5700XtGrid().Take(9).Select(c => c.Label).ToArray();
        Assert.Equal(
        [
            "default/qp22", "default/qp24", "default/qp26", "default/qp28", "default/qp30",
            "default/qp32", "default/qp34", "default/qp36", "transcoding/qp22",
        ], labels);
    }

    private static string[] Labels(AmdSweepVerdict.AmdFinalistSelection s) =>
        s.Selected.Select(c => c.Label).ToArray();

    private static bool Has(AmdSweepVerdict.AmdFinalistSelection s, string label) =>
        s.Selected.Any(c => c.Label == label);

    // ---------- o defeito, fixado com os números reais ----------

    [Fact]
    public void TakeDaFrente_ReproduzODefeitoDoRelatorio()
    {
        var cells = Rx5700XtGrid();
        var front = AmdSweepVerdict.Pareto(cells);

        // A frente tem 12 células — contagem que o relatório também imprimiu.
        Assert.Equal(12, front.Count);

        // E as 3 primeiras na ordem de iteração são exatamente as que o relatório repetiu.
        var antigo = front.Take(3).Select(c => c.Label).ToArray();
        Assert.Equal(["default/qp22", "default/qp32", "default/qp34"], antigo);

        // 2 das 3 já reprovavam o portão na triagem: 6 encodes em célula que já perdeu.
        Assert.False(AmdSweepVerdict.PassesQuality(front.First(c => c.Label == "default/qp32").Vmaf, AnchorVmaf));
        Assert.False(AmdSweepVerdict.PassesQuality(front.First(c => c.Label == "default/qp34").Vmaf, AnchorVmaf));

        // E a mais rápida que PASSAVA na qualidade ficou de fora — 8ª da frente.
        var maisRapida = AmdSweepVerdict.FastestPassing(cells, AnchorVmaf);
        Assert.NotNull(maisRapida);
        Assert.Equal("transcoding/qp30", maisRapida!.Value.Label);
        Assert.DoesNotContain(maisRapida!.Value.Label, antigo);

        // Daí a contradição impressa: com samples=1 em tudo, o pick de desempenho não tem
        // floor de amostras e devolveria o vencedor. O relatório antigo é o que dá 237,5.
        Assert.Equal(260.4, maisRapida!.Value.Fps, 1);
        Assert.Equal(237.5, front.First(c => c.Label == "default/qp22").Fps, 1);
    }

    [Fact]
    public void SelectFinalists_AlwaysRepeteACelulaMaisRapidaQuePassa()
    {
        var cells = Rx5700XtGrid();
        var front = AmdSweepVerdict.Pareto(cells);
        var sel = AmdSweepVerdict.SelectFinalists(cells, front, AnchorVmaf, 3);

        Assert.True(Has(sel, "transcoding/qp30"), $"faltou a vencedora: {string.Join(",", Labels(sel))}");
        Assert.False(sel.PerfProvisional);
    }

    [Fact]
    public void SelectFinalists_RepeteACelulaMaisBarataQuePassa()
    {
        var cells = Rx5700XtGrid();
        var front = AmdSweepVerdict.Pareto(cells);
        var sel = AmdSweepVerdict.SelectFinalists(cells, front, AnchorVmaf, 3);
        Assert.True(Has(sel, "transcoding/qp30"));
    }

    // ---------- o invariante que o conserta ----------

    [Fact]
    public void PickDeVelocidadeNuncaPodeSerMaisLentoQueOPickDeCusto()
    {
        var cells = Rx5700XtGrid();
        var front = AmdSweepVerdict.Pareto(cells);
        var sel = AmdSweepVerdict.SelectFinalists(cells, front, AnchorVmaf, 3);

        // As selecionadas ganham as voltas; o resto fica com 1. É o estado real do runner.
        var refined = cells.Select(c =>
            sel.Selected.Any(s => s.Usage == c.Usage && s.Qp == c.Qp) ? c with { Samples = 3 } : c).ToList();

        var cost = AmdSweepVerdict.PickCost(refined, AnchorVmaf);
        var perf = AmdSweepVerdict.PickThroughput(refined, AnchorVmaf, AmdSweepVerdict.FpsTolerancePct);

        Assert.NotNull(cost);
        Assert.NotNull(perf);

        // O pick de desempenho é o máximo de fps do seu poço, e o de custo está no mesmo poço,
        // então perf.Fps >= cost.Fps é garantido. Com `front.Take(3)` isso FALHAVA (237,5 < 260,4).
        Assert.True(perf!.Value.Fps >= cost!.Value.Fps,
            $"MAIS RÁPIDO {perf.Value.Fps} < MAIS BARATO {cost.Value.Fps}");
    }

    [Fact]
    public void NaoGastaSlotComCelulaQueReprova_QuandoExisteCelulaQuePassa()
    {
        var cells = Rx5700XtGrid();
        var front = AmdSweepVerdict.Pareto(cells);
        var sel = AmdSweepVerdict.SelectFinalists(cells, front, AnchorVmaf, 3);

        Assert.All(sel.Selected, c => Assert.True(AmdSweepVerdict.PassesQuality(c.Vmaf, AnchorVmaf),
            $"{c.Label} (VMAF {c.Vmaf}) reprovou e gastou uma volta"));
    }

    [Fact]
    public void ComTetoDeUm_SobreODinheiroFicaOMaisBarato_EODesempenhoFicaProvisorio()
    {
        // Grade sintética porque na real o mais barato e o mais rápido COINCIDEM
        // (transcoding/qp30, 5373388 bytes a 260,4 fps) — ver
        // PickMaisBaratoEMaisRapidoCoincidemNaGradeReal. Com um dado só, teto 1 nunca
        // fica provisório, e o teste passaria sem cobrir o caso que ele existe para cobrir.
        var cells = new List<AmdSweepCell>
        {
            new("", 30, true, 5000, 80, 150, 1),          // a mais barata
            new("transcoding", 30, true, 5000, 80, 150, 1),
            new("", 22, true, 9000, 88, 400, 1),          // a mais rápida, e bem mais cara
        };
        var front = AmdSweepVerdict.Pareto(cells);
        var sel = AmdSweepVerdict.SelectFinalists(cells, front, AnchorVmaf, 1);

        Assert.Equal("default/qp30", AmdSweepVerdict.PickCost(cells, AnchorVmaf)!.Value.Label);
        Assert.Equal("default/qp22", AmdSweepVerdict.FastestPassing(cells, AnchorVmaf)!.Value.Label);

        Assert.Single(sel.Selected);
        Assert.Equal("default/qp30", sel.Selected[0].Label);
        // E o relatório tem que dizer que o de desempenho não cobriu a célula mais rápida.
        Assert.True(sel.PerfProvisional);
    }

    /// <summary>Achado da RX 5700 XT, e o que a frase final do relatório devia dizer em vez de
    /// afirmar conflito: o mais barato e o mais rápido que passam <b>caem na mesma célula</b>.
    /// Os eixos se cancelam porque o <c>transcoding</c> dá exatamente os mesmos bytes que o
    /// <c>default</c> nos 8 QP — ele só ganha 4,5 fps, de graça em bytes.</summary>
    [Fact]
    public void PickMaisBaratoEMaisRapidoCoincidemNaGradeReal()
    {
        var cells = Rx5700XtGrid();
        var cheap = AmdSweepVerdict.PickCost(cells, AnchorVmaf);
        var fast = AmdSweepVerdict.FastestPassing(cells, AnchorVmaf);

        Assert.NotNull(cheap);
        Assert.Equal(cheap!.Value.Label, fast!.Value.Label);
        Assert.Equal("transcoding/qp30", cheap!.Value.Label);
        Assert.Equal(5373388, cheap!.Value.Bytes);
        Assert.Equal(260.4, cheap!.Value.Fps, 1);
    }

    // ---------- aritmética de contagem ----------

    [Fact]
    public void FrontPassingDropped_ContaCelulaQuePassavaEFicouDeFora()
    {
        var cells = Rx5700XtGrid();
        var front = AmdSweepVerdict.Pareto(cells);
        var sel = AmdSweepVerdict.SelectFinalists(cells, front, AnchorVmaf, 3);

        var droppedByHand = front.Count(c =>
            AmdSweepVerdict.PassesQuality(c.Vmaf, AnchorVmaf) &&
            !sel.Selected.Any(s => s.Usage == c.Usage && s.Qp == c.Qp));

        Assert.Equal(droppedByHand, sel.FrontPassingDropped);
        // O 3º slot é gasto só por quem passa, então o desperdício é 0 no máximo default=3.
        Assert.True(sel.Selected.Count(c => AmdSweepVerdict.PassesQuality(c.Vmaf, AnchorVmaf)) == 3);
    }

    [Fact]
    public void NenhumaCelulaPassando_RepeteAFrenteInteira_EPickNaoExiste()
    {
        // Âncora inalcançável: nada passa. A frente ainda é o que há para mostrar.
        var cells = Rx5700XtGrid();
        var front = AmdSweepVerdict.Pareto(cells);
        var sel = AmdSweepVerdict.SelectFinalists(cells, front, 99.0, 3);

        Assert.Equal(3, sel.Selected.Count);
        Assert.Null(AmdSweepVerdict.PickCost(cells, 99.0));
        Assert.Null(AmdSweepVerdict.PickThroughput(cells, 99.0, AmdSweepVerdict.FpsTolerancePct));
    }

    [Fact]
    public void PoDosPicks_TemTamanhosDiferentes_ERelatorioDeclaraCadaUm()
    {
        var cells = Rx5700XtGrid();
        // O de custo vê todas as que passam: 5 QPs que passam x 5 usages = 25.
        // O de desempenho só as que têm 3 voltas, e na triagem nenhuma tem.
        Assert.Equal(25, AmdSweepVerdict.CostPoolSize(cells, AnchorVmaf));
        Assert.Equal(0, AmdSweepVerdict.ThroughputPoolSize(cells, AnchorVmaf));

        var sel = AmdSweepVerdict.SelectFinalists(cells, AmdSweepVerdict.Pareto(cells), AnchorVmaf, 3);
        var refined = cells.Select(c =>
            sel.Selected.Any(s => s.Usage == c.Usage && s.Qp == c.Qp) ? c with { Samples = 3 } : c).ToList();
        Assert.Equal(3, AmdSweepVerdict.ThroughputPoolSize(refined, AnchorVmaf));
    }

    [Fact]
    public void FastestPassing_EmpateDeFpsVaiParaOMenosByte()
    {
        var cells = new List<AmdSweepCell>
        {
            new("", 30, true, 5000, 80, 200, 1),
            new("transcoding", 30, true, 4000, 80, 200, 1),
        };
        Assert.Equal("transcoding/qp30", AmdSweepVerdict.FastestPassing(cells, 77.39)!.Value.Label);
    }

    [Fact]
    public void FastestPassing_IgnoraCelulaQueReprova_ETambemNaoMedida()
    {
        var cells = new List<AmdSweepCell>
        {
            new("", 30, true, 4000, 70, 900, 1),   // reprova a qualidade
            new("", 32, false, 0, 0, 0, 0),        // recusada
            new("", 34, true, 5000, 80, 150, 1),   // passa
        };
        Assert.Equal("default/qp34", AmdSweepVerdict.FastestPassing(cells, 77.39)!.Value.Label);
    }
}
