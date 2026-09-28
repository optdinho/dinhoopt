using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// O <c>--probe-amd-sweep</c> procura o ponto de melhor custo/desempenho numa grade
/// <c>usage x QP</c>. Estes testes cobrem a <b>lógica de decisão</b> - o que é uma função
/// pura, e por isso é a única parte do sweep que dá para testar sem GPU.
///
/// <para><b>Por que a grade existe.</b> O <c>--probe-amf-usage</c> escolhe <c>usage</c> com o
/// rate control de produção, e o <c>--probe-amf-cqp</c> escolhe QP com o <c>usage</c> default.
/// Os dois nunca medem a combinação - e se <c>ultralowlatency</c> ganhar folga no primeiro, o
/// par (ultralowlatency, QP) é exatamente o optimum que nenhuma das outras sondas vê.</para>
///
/// <para><b>Por que dois picks e nao um.</b> "Melhor custo" e "melhor desempenho" sao
/// criterios <b>conflitantes</b> por construcao: o QP mais barato e o mais lento, e o usage mais
/// rapido costuma custar bytes. Escolher um unico vencedor esconderia a decisao do usuario atras
/// de um numero. A saida sao dois picks explicitos, com o criterio de cada um impresso.</para>
///
/// <para><b>A régua de qualidade é a produção.</b> "Sem perda de qualidade" é definido contra o
/// VMAF da cadeia de produção que roda hoje, não contra um número absoluto de tabela.</para>
///
/// <para><b>A régua de bytes NÃO é um filtro, e isso é deliberado.</b> <c>PickCost</c> devolve a
/// menor célula que passa no VMAF, <b>mesmo que ela seja maior que a produção</b> — e quem aponta
/// isso é o relatório, que imprime o delta contra a âncora e diz explicitamente que nenhuma
/// delas é mais barata que hoje. Um portão duro de bytes aqui esconderia o resultado mais
/// informativo que o sweep pode produzir ("não existe par usage x QP que economize"), trocando-o
/// por um "nenhuma célula" indistinguível de falha de medição. A régua de bytes é o que o
/// relatório <b>afirma</b>, não o que o pick <b>esconde</b>.</para>
/// </summary>
public class AmdSweepVerdictTests
{
    private const double AnchorVmaf = 77.4;
    private static AmdSweepCell C(string usage, int qp, long bytes, double vmaf, double fps, int samples = 1) =>
        new(usage, qp, bytes > 0, bytes, vmaf, fps, samples);

    private static AmdSweepCell Unmeasured(string usage, int qp) =>
        new(usage, qp, false, 0, 0, 0, 0);

    // ---------- relação entre o pick de custo e o de desempenho ----------

    /// <summary>Fixture é a célula real que ganhou os dois picks no sweep da RX 5700 XT de
    /// 27/09: <c>default/qp30</c>, 5.373.388 bytes, VMAF 79,21, 234,2 fps. A célula mais rápida
    /// da triagem foi <c>ultralowlatency/qp28</c> a 240,2 fps — dentro dos 5% — e o desempate
    /// por byte manteve a primeira.</summary>
    private static AmdSweepCell GanhadoraDosDoisPicks() => C("", 30, 5_373_388, 79.21, 234.2, 3);

    [Fact]
    public void ClassifyPicks_MesmaCelula_NaoCaiNoCasoDeBytesIguais()
    {
        // A regressão: SameCell tem de ser testado ANTES de SameBytesDifferentCell, porque
        // a mesma célula TEM os mesmos bytes. Comparando bytes primeiro, este caso — que é o
        // mais comum em máquina real — seria classificado como "células diferentes com o mesmo
        // arquivo" e o relatório afirmaria "rótulos diferentes" sobre rótulos idênticos.
        Assert.Equal(AmdSweepVerdict.PickRelation.SameCell,
            AmdSweepVerdict.ClassifyPicks(GanhadoraDosDoisPicks(), GanhadoraDosDoisPicks()));
    }

    [Fact]
    public void ClassifyPicks_CelulasDistintasComOsMesmosBytes_EhArquivoIdentico()
    {
        // default/qp30 e transcoding/qp30: 5.373.388 bytes nos dois, VMAF 79,21 nos dois.
        var transcoding = C("transcoding", 30, 5_373_388, 79.21, 227.7, 3);
        Assert.Equal(AmdSweepVerdict.PickRelation.SameBytesDifferentCell,
            AmdSweepVerdict.ClassifyPicks(GanhadoraDosDoisPicks(), transcoding));
    }

    [Fact]
    public void ClassifyPicks_BytesEPsDiferentes_EhConflitoReal()
    {
        // A mais rápida da triagem, 21% maior em bytes: aqui "mais barato" e "mais rápido"
        // apontam mesmo para arquivos diferentes.
        var maisRapida = C("ultralowlatency", 28, 6_490_712, 81.07, 240.2, 3);
        Assert.Equal(AmdSweepVerdict.PickRelation.Conflict,
            AmdSweepVerdict.ClassifyPicks(GanhadoraDosDoisPicks(), maisRapida));
    }

    [Fact]
    public void ClassifyPicks_UmByteDeDiferencaNaoEhArquivoIdentico()
    {
        // high_quality/qp30 saiu 1 byte acima do default nos dados reais (5.373.389 vs
        // 5.373.388). É o mesmo arquivo para o usuário, mas o classificador é sobre o número
        // medido, e mentir sobre "mesmo byte" aqui esconderia a diferença de rótulo.
        var highQuality = C("high_quality", 30, 5_373_389, 79.21, 7.9, 3);
        Assert.Equal(AmdSweepVerdict.PickRelation.Conflict,
            AmdSweepVerdict.ClassifyPicks(GanhadoraDosDoisPicks(), highQuality));
    }

    [Fact]
    public void ClassifyPicks_ERelacaoEntreCostENaoDependeDaVelocidade()
    {
        // Um pick de desempenho vem das células com 3 voltas, e o fps do MESMO par de bytes
        // varia entre voltas. Se o desempate da velocidade influence a classificação, o
        // relatório muda de frase entre execuções do mesmo sweep.
        var base_ = GanhadoraDosDoisPicks();
        for (var fps = 180.0; fps <= 300.0; fps += 10.0)
        {
            Assert.Equal(AmdSweepVerdict.PickRelation.SameCell,
                AmdSweepVerdict.ClassifyPicks(base_, base_ with { Fps = fps }));
        }
    }

    [Fact]
    public void ClassifyPicks_TodosOsCasosDoEnumsTemTeste()
    {
        // Trava de cobertura: um quarto caso que ninguém exercitou é onde o próximo texto
        // errado nasce.
        var exercitados = new HashSet<AmdSweepVerdict.PickRelation>
        {
            AmdSweepVerdict.ClassifyPicks(GanhadoraDosDoisPicks(), GanhadoraDosDoisPicks()),
            AmdSweepVerdict.ClassifyPicks(GanhadoraDosDoisPicks(), C("transcoding", 30, 5_373_388, 79.21, 227.7, 3)),
            AmdSweepVerdict.ClassifyPicks(GanhadoraDosDoisPicks(), C("ultralowlatency", 28, 6_490_712, 81.07, 240.2, 3)),
        };
        Assert.Equal(Enum.GetValues<AmdSweepVerdict.PickRelation>().Length, exercitados.Count);
        Assert.Equal(
            Enum.GetValues<AmdSweepVerdict.PickRelation>().ToHashSet(),
            exercitados);
    }

    // ---------- régua de qualidade ----------

    [Fact]
    public void PassesQuality_IgualOuAcimaDaProducao_Passa()
    {
        Assert.True(AmdSweepVerdict.PassesQuality(77.4, AnchorVmaf));
        Assert.True(AmdSweepVerdict.PassesQuality(84.5, AnchorVmaf));
    }

    [Fact]
    public void PassesQuality_AbaixoDaProducao_Reprova()
    {
        // Este é o portão que impede o sweep de recomendar "barato e rápido" às custas de
        // qualidade - que é literalmente a coisa que o usuário pediu para não acontecer.
        Assert.False(AmdSweepVerdict.PassesQuality(70.0, AnchorVmaf));
    }

    [Fact]
    public void PassesQuality_TemEpsToleradoParaPontoFlutuante()
    {
        // VMAF sai de um parse de texto; 77,3999999 e 77,4 são o mesmo resultado lido duas
        // vezes. Sem eps, o candidato "igual à produção" reprovaria por arredondamento - e o
        // relatório mostraria KEEPS/REJECT sem que nada tivesse mudado. 0,05 ponto numa escala
        // de 100 é invisível, e está documentado como tolERAÇÃO, não como ganho.
        Assert.True(AmdSweepVerdict.PassesQuality(77.4 - 0.049, AnchorVmaf));
        Assert.False(AmdSweepVerdict.PassesQuality(77.4 - 0.051, AnchorVmaf));
    }

    [Fact]
    public void PassesQuality_ProducaoNaoMedida_NaoReprovaTudo()
    {
        // Âncora 0 = produção não medida. Reprovar tudo por causa de uma régua ausente
        // devolveria "nenhuma célula passou", que o leitor não distingue de "nenhuma célula
        // passou porque todas são ruins". Aqui a ausência da régua libera o portão, e quem
        // tem de avisar é o relatório, não o veredito silencioso.
        Assert.True(AmdSweepVerdict.PassesQuality(70.0, 0));
    }

    // ---------- rótulo da célula ----------

    [Fact]
    public void Label_DaReferenceNaoFicaComSegmentoVazio()
    {
        // A célula de referência é a de usage VAZIO (produção não emite -usage). Interpolar
        // isso dava "/qp16": uma linha sem sujeito, e a coluna de usage parece deslocada.
        Assert.Equal("default/qp16", new AmdSweepCell("", 16, true, 1, 1, 1, 1).Label);
        Assert.Equal("ultralowlatency/qp22", new AmdSweepCell("ultralowlatency", 22, true, 1, 1, 1, 1).Label);
    }

    [Fact]
    public void Label_E_UnicoPorCelulaDaGrade()
    {
        // A frente de Pareto é montada por identidade de ÍNDICE, e `Refine` house as
        // repetições por Label. Se dois pares distintos (usage, QP) colidissem no rótulo, uma
        // finalist seria confundida com a outra e a segunda busca acharia a célula errada.
        var labels = new[] { "", "transcoding", "ultralowlatency", "lowlatency", "high_quality" }
            .SelectMany(u => new[] { 22, 24, 26, 28, 30, 32, 34, 36 }.Select(qp => $"{u}/qp{qp}"))
            .ToList();

        Assert.Equal(labels.Count, labels.Distinct().Count());
    }

    [Fact]
    public void CelulaNaoMedida_NuncaPassa()
    {
        // Um braço recusado pelo encoder tem bytes 0 e VMAF 0. Sem a guarda de `Measured` ele
        // reprovaria na qualidade (ok) mas GANHARIA o pick de custo, porque 0 bytes é o menor
        // número possível - e o sweep recomendaria um encoder que não funcionou. Aqui a outra
        // célula é válida, então a prova é que o pick NÃO é a recusada, e não que não há pick.
        var cells = new[] { C("default", 26, 3_000_000, 78.1, 300, samples: 3), Unmeasured("ultralowlatency", 30) };

        var pick = AmdSweepVerdict.PickCost(cells, AnchorVmaf);

        Assert.NotNull(pick);
        Assert.Equal("default", pick!.Value.Usage);
        Assert.Equal(26, pick.Value.Qp);
    }

    [Fact]
    public void CelulaNaoMedida_SozinhaNaoGeraPickDeCusto()
    {
        // O caso degenerado do anterior: sem nenhuma célula válida, o certo é não devolver
        // nada - devolver a recusada seria pior que devolver nulo.
        var cells = new[] { Unmeasured("ultralowlatency", 30), Unmeasured("default", 40) };

        Assert.Null(AmdSweepVerdict.PickCost(cells, AnchorVmaf));
    }

    [Fact]
    public void PickCost_NaoEconomizaParaBuscarQualidade()
    {
        // A mais barata da grade REPROVA na qualidade (por 0,06, abaixo do epsilon de 0,05).
        // Um pick que "negociasse" bytes por qualidade devolveria a de 2 MiB; o certo é devolver
        // a de 3 MiB e deixar o relatório dizer que ela é 50% mais cara que a outra.
        var cells = new[]
        {
            C("default", 20, 2_000_000, AnchorVmaf - 0.06, 300),
            C("default", 30, 3_000_000, AnchorVmaf, 240),
        };

        var pick = AmdSweepVerdict.PickCost(cells, AnchorVmaf);

        Assert.NotNull(pick);
        Assert.Equal(30, pick!.Value.Qp);
        Assert.Equal(3_000_000, pick.Value.Bytes);
    }

    // ---------- frente de Pareto ----------

    [Fact]
    public void Pareto_RemoveCelulaDominada()
    {
        // A celula em (default, 30) e pior que (default, 28) nos TRES eixos ao mesmo tempo:
        // mais bytes, menos VMAF e mais lenta. Ela nunca pode ser a escolha, offertar menos.
        var cells = new[]
        {
            C("default", 28, 2_000_000, 77.6, 300, samples: 3),
            C("default", 30, 3_500_000, 76.9, 290, samples: 3),
        };

        var front = AmdSweepVerdict.Pareto(cells);

        Assert.Single(front);
        Assert.Equal(28, front[0].Qp);
    }

    [Fact]
    public void Pareto_MantemCelulasQueTradeamUmEixoContraOutro()
    {
        // Estas DUAS se dominam mutuamente por eixos diferentes: a primeira e mais barata e
        // lenta, a segunda e mais cara e rapida. Nenhuma domina a outra, e por isso as duas
        // ficam - e e por isso que existem dois picks em vez de um.
        var cells = new[]
        {
            C("ultralowlatency", 28, 2_100_000, 77.5, 420, samples: 3),
            C("default", 28, 2_000_000, 77.6, 300, samples: 3),
        };

        var front = AmdSweepVerdict.Pareto(cells);

        Assert.Equal(2, front.Count);
    }

    [Fact]
    public void Pareto_IgnoraCelulaNaoMedida()
    {
        var cells = new[] { C("default", 26, 3_000_000, 78.1, 300, samples: 3), Unmeasured("default", 99) };

        var front = AmdSweepVerdict.Pareto(cells);

        Assert.Single(front);
        Assert.Equal(26, front[0].Qp);
    }

    [Fact]
    public void Pareto_ListaVaziaNaoQuebra()
    {
        Assert.Empty(AmdSweepVerdict.Pareto([]));
    }

    // ---------- pick de custo ----------

    [Fact]
    public void PickCost_EscolheOMenosBytesEntreOsQuePassamNaQualidade()
    {
        var cells = new[]
        {
            C("default", 26, 3_000_000, 78.1, 300, samples: 3),
            C("ultralowlatency", 28, 2_100_000, 77.5, 420, samples: 3),
            C("default", 34, 900_000, 71.0, 300, samples: 3),   // barato mas reprovado na qualidade
        };

        var pick = AmdSweepVerdict.PickCost(cells, AnchorVmaf);

        Assert.NotNull(pick);
        Assert.Equal("ultralowlatency", pick!.Value.Usage);
        Assert.Equal(28, pick!.Value.Qp);
    }

    [Fact]
    public void PickCost_DesempateEmBytesVaiParaOMaisRapido()
    {
        // Dois usos com o MESMO byte count: sem desempate, a ordem da lista decidiria, e a
        // lista vem da triagem - que tem timing proprio e portanto pode reordenar entre
        // execucoes. O sorteio nao pode depender disso.
        var cells = new[]
        {
            C("transcoding", 28, 2_000_000, 77.6, 150, samples: 3),
            C("ultralowlatency", 28, 2_000_000, 77.6, 420, samples: 3),
        };

        var pick = AmdSweepVerdict.PickCost(cells, AnchorVmaf);

        Assert.Equal("ultralowlatency", pick!.Value.Usage);
    }

    [Fact]
    public void PickCost_NinguemPassaNaQualidade_DevolveNulo()
    {
        var cells = new[] { C("default", 40, 500_000, 60.0, 300, samples: 3) };

        Assert.Null(AmdSweepVerdict.PickCost(cells, AnchorVmaf));
    }

    // ---------- pick de desempenho ----------

    [Fact]
    public void PickThroughput_EscolheOMaisRapido()
    {
        var cells = new[]
        {
            C("default", 28, 2_000_000, 77.6, 300, samples: 3),
            C("ultralowlatency", 28, 2_100_000, 77.5, 420, samples: 3),
            C("lowlatency", 28, 2_050_000, 77.5, 380, samples: 3),
        };

        var pick = AmdSweepVerdict.PickThroughput(cells, AnchorVmaf, AmdSweepVerdict.FpsTolerancePct);

        Assert.Equal("ultralowlatency", pick!.Value.Usage);
    }

    [Fact]
    public void PickThroughput_DentroDaToleranciaPrefereOsMaisBaratos()
    {
        // 420 e 400 fps sao 4,8% - dentro dos 5% de tolerancia. Escolher o mais rapido
        // ignoraria que os dois sao indistinguiveis na pratica e que o de 400 fps entrega o
        // mesmo por 5% menos bytes. A tolerancia existe para isso: "mais rapido" so conta
        // quando a diferenca e perceptivel.
        var cells = new[]
        {
            C("ultralowlatency", 28, 3_000_000, 77.5, 420, samples: 3),
            C("lowlatency", 28, 2_100_000, 77.5, 400, samples: 3),
        };

        var pick = AmdSweepVerdict.PickThroughput(cells, AnchorVmaf, AmdSweepVerdict.FpsTolerancePct);

        Assert.Equal("lowlatency", pick!.Value.Usage);
    }

    [Fact]
    public void PickThroughput_CelulaMaisLentaNaoEntra()
    {
        var cells = new[]
        {
            C("ultralowlatency", 28, 2_100_000, 77.5, 420, samples: 3),
            C("transcoding", 26, 2_000_000, 78.0, 90, samples: 3),
        };

        var pick = AmdSweepVerdict.PickThroughput(cells, AnchorVmaf, AmdSweepVerdict.FpsTolerancePct);

        Assert.Equal("ultralowlatency", pick!.Value.Usage);
    }

    [Fact]
    public void PickThroughput_SoUmaMedidaNaoViraEscolhaDeDesempenho()
    {
        // Mesma disciplina do MinRoundsForPromote no --probe-amf-usage: uma unica volta da
        // triagem e um numero de timing, nao uma escolha. Ou mede com varias voltas, ou o
        // desempenho fica reportado sem nenhum pick.
        var cells = new[] { C("default", 28, 2_000_000, 77.6, 300, samples: 1) };

        Assert.Null(AmdSweepVerdict.PickThroughput(cells, AnchorVmaf, AmdSweepVerdict.FpsTolerancePct));
    }

    [Fact]
    public void PickThroughput_ComVariasVoltasVoltaAEscolher()
    {
        var cells = new[] { C("default", 28, 2_000_000, 77.6, 300, samples: 3) };

        Assert.NotNull(AmdSweepVerdict.PickThroughput(cells, AnchorVmaf, AmdSweepVerdict.FpsTolerancePct));
    }

    // ---------- folga: a coluna que substituiu a GPU% ----------

    [Fact]
    public void Headroom_EhVecesOTargetQueOEncoderAguenta()
    {
        // A pergunta que a coluna de GPU% nao respondia de forma interpretavel - "esta
        // configuracao da conta do meu alvo?" - em uma divisao que o leitor faz de cabeca.
        Assert.Equal(7.0, AmdSweepVerdict.Headroom(420, 60), 6);
        Assert.Equal(1.0, AmdSweepVerdict.Headroom(60, 60), 6);
        Assert.Equal(0.5, AmdSweepVerdict.Headroom(30, 60), 6);
    }

    [Fact]
    public void Headroom_TargetZeroNaoViraInfinity()
    {
        Assert.Equal(0, AmdSweepVerdict.Headroom(300, 0));
    }

    [Fact]
    public void Headroom_FpsZeroDaZero()
    {
        // Celula nao medida mostraria "Infinity x" na coluna de folga se so dividisse.
        Assert.Equal(0, AmdSweepVerdict.Headroom(0, 60));
    }

    // ---------- Bytes contra a producao ----------

    [Fact]
    public void BytesVsAnchor_PositivoECrescimento()
    {
        Assert.Equal(100, AmdSweepVerdict.BytesDeltaPct(2_000_000, 1_000_000), 6);
    }

    [Fact]
    public void BytesVsAnchor_ZeroEZero()
    {
        Assert.Equal(0, AmdSweepVerdict.BytesDeltaPct(0, 0));
    }

    [Fact]
    public void BytesVsAnchor_AnchorZeroNaoViraInfinity()
    {
        // Producao sem bytes medidos: o divisor e 0 e o texto sairia "Infinity%". O que o
        // leitor precisa ler ali e "producao nao medida", e quem decide isso e o relatorio.
        Assert.Equal(0, AmdSweepVerdict.BytesDeltaPct(2_000_000, 0));
    }

    // ---------- WireFormat: as duas opcoes nunca podem se identificar ----------

    [Fact]
    public void WireFormat_NomeEValorCeramParaForaDoArgv()
    {
        // `usage` e uma palavra que o ffmpeg consome (-usage transcoding), e um
        // argumento malformado nela viraria opcao do encoder em vez de nome de celula.
        // O probe de CQP ja tinha esse caminho com lista de QP; aqui a lista e de
        // usage e precisa da mesma trava de quoting.
        var args = AmdSweepVerdict.BuildCellArgs("h264_amf", "ultralowlatency", 30);

        Assert.Equal(new[] { "h264_amf", "ultralowlatency", "30" }, args);
    }
}
