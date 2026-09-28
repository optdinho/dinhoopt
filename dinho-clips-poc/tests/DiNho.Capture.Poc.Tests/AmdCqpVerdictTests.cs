using System.Globalization;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Testes do veredito do <c>--probe-amf-cqp</c>: a comparação A/B entre a chain AMF de
/// produção (<c>-rc vbr_peak -b:v {maxrate * 0.36}</c>) e a cadeia CQP
/// (<c>-rc cqp -qp_i {cq} -qp_p {cq}</c>), que é a mesma que o <b>editor</b> já usa desde o
/// Item 8.
///
/// <para><b>Por que esta comparação existe.</b> O audit na RX 5700 XT mediu, no mesmo
/// conteúdo e no mesmo tamanho de arquivo:
///
/// <list type="bullet">
/// <item>AMF de produção (19,8 Mbps): 5,3 MiB, VMAF <b>77,4</b></item>
/// <item>libx264 crf20: 5,3 MiB, VMAF <b>91,3</b></item>
/// </list>
///
/// São 13,9 pontos de VMAF de diferença <b>pelo mesmo preço</b>, e a curva da AMF satura
/// (19,8 → 77,4 · 39,6 → 82,8 · 59,4 → 84,6), então <b>subir o fator 0,36 não resolve</b>:
/// o S3 já classificou o caso como <c>TargetUnreachable</c>. A lever que sobra é o
/// <i>rate control</i>, não a taxa — e é isso que o probe mede.
///
/// <para><b>Qual é a referência da comparação.</b> O ponto de produção é o encode que a
/// captura <b>faz hoje</b> — 0,36 do <c>maxrate</c> do usuário — e não o melhor degrau da
/// varredura de bitrate. A varredura existe para entender a curva do encoder; o que o CQP
/// substituiria é o rung específico que roda em produção. Usar o melhor degrau da escada
/// como referência tornaria a comparação estritamente mais difícil do que a decisão real,
/// e o veredito poderia dizer "não promove" para uma troca que economizaria 20%.
///
/// <para><b>A armadilha central destes testes.</b> Comparar "CQP no mesmo QP" contra
/// "produção no 0,36" é comparar qualidades diferentes e chamar o resultado de economia de
/// bytes. A família que perde em qualidade <b>vence</b> a comparação de bytes, e o
/// relatório anuncia uma economia que é na verdade uma perda. Por isso o judge
/// <b>iguala a qualidade primeiro</b>: só entra na conta de bytes o ponto CQP que
/// <i>alcança</i> o VMAF da produção, e entre esses, o mais barato.
///
/// <para><b>E o espelho:</b> se o melhor CQP <i>não</i> alcança a produção, o veredito é
/// <see cref="AmdCqpState.CannotMatch"/> — nunca "CQP economiza X%", porque essa comparação
/// não é honesta quando a qualidade não bate.</para>
/// </summary>
public class AmdCqpVerdictTests
{
    private static AmdCqpPoint P(string label, double vmaf, long bytes, double fps = 50) =>
        new(label, vmaf, bytes, fps);

    /// <summary>
    /// Os limites são <b>fixados antes da medição</b>, pelo mesmo motivo do Item 9
    /// (<c>main10</c>): quem decide promover com o número já na mão escolhe o critério que o
    /// número atende. O 5% é o mesmo corte de <c>AmdAuditCriteria.HonoredSpanRatio</c> —
    /// abaixo disso a diferença não separa de ruído de codificação.
    /// </summary>
    [Fact]
    public void CriteriosDoProbeCqpEstaoTravados()
    {
        Assert.Equal(5.0, AmdCqpCriteria.MinByteWinPct);
        Assert.Equal(5.0, AmdCqpCriteria.MaxFpsLossPct);
    }

    // ----------------------------------------------------------------- promote / não promote

    /// <summary>CQP que <b>iguala ou supera</b> a qualidade de produção com 8% menos bytes e
    /// o mesmo fps promove. É o critério escolhido antes de medir: "só promove se >= 5% de
    /// bytes no mesmo VMAF".</summary>
    [Fact]
    public void CqpQuePoupar8PorCentoNoMesmoVmaf_Promove()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 84.5, 9_200_000, 50) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.Promotes, v.State);
        Assert.True(v.ByteWin);
        Assert.True(v.FpsAcceptable);
        Assert.Equal(84.0, v.AnchorVmaf, 3);           // a âncora é a produção, não o CQP
        Assert.Equal(-8.0, v.ByteDeltaPct, 3);
        Assert.Equal("qp18", v.ChosenCqpLabel);
    }

    /// <summary>
    /// <b>Fronteira exata: 5,0% conta como vitória.</b> O critério é <c>&lt;= -5</c>, não
    /// <c>&lt; -5</c>. Um teste que esperasse "não promove" em 5,0% deixaria a fronteira
    /// ambígua, e ambiguidade aparece como um caso que "às vezes" promove — que é o jeito de
    /// um critério virar número decorativo.
    /// </summary>
    [Fact]
    public void CqpQuePouparExatamente5PorCento_Promove()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 85.0, 9_500_000, 50) };

        Assert.Equal(AmdCqpState.Promotes, AmdAuditVerdicts.JudgeAmfCqp(producao, cqp).State);
    }

    /// <summary>4% de economia fica abaixo do corte. O número é reportado para o leitor ver
    /// o quanto faltou, em vez de o veredito só dizer "não".</summary>
    [Fact]
    public void CqpQuePouparMenosDe5PorCento_NaoPromove()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 84.5, 9_600_000, 50) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.KeepsProduction, v.State);
        Assert.False(v.ByteWin);
        Assert.Equal(-4.0, v.ByteDeltaPct, 3);
    }

    /// <summary>
    /// O CQP pode <b>superar</b> a qualidade da produção sem que isso seja LOSS: um ponto
    /// acima da âncora com bytes menores é ambíguo (qualidade e custo), e o judge não
    /// pode fingir que a qualidade extra foi de graça. O que ele faz é aceitar o ponto e
    /// reportar o VMAF, sem descontar byte por qualidade.
    /// </summary>
    [Fact]
    public void CqpAcimaDaAncora_ComMenosBytes_AceitaComoVitoriaDeBytes()
    {
        var producao = P("0.36", 80.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 85.0, 8_000_000, 50) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.Promotes, v.State);
        Assert.Equal(85.0, v.BestCqpVmaf, 3);
        Assert.Equal(-20.0, v.ByteDeltaPct, 3);
    }

    /// <summary>
    /// <b>Fronteira do empate.</b> CQP com VMAF <i>exatamente</i> igual ao da produção é o
    /// caso mais limpo de vitória que existe, e é também a fronteira entre
    /// <see cref="AmdCqpState.CannotMatch"/> e <see cref="AmdCqpState.Promotes"/>: o filtro
    /// "alcança" usa <c>&gt;=</c>, e trocar por <c>&gt;</c> classificaria este caso como
    /// CannotMatch.
    ///
    /// <para>Sem este teste a fronteira não tem cobertura nenhuma — todos os outros têm QP
    /// claramente acima ou claramente abaixo da âncora, então <c>&gt;=</c> e <c>&gt;</c>
    /// dariam exatamente a mesma resposta em toda a suíte, e o "empate não é falha" ficaria
    /// garantido só por leitura do código.</para>
    /// </summary>
    [Fact]
    public void CqpComVmafExatamenteIgualAAProducao_AlcancaEPromove()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 84.0, 8_000_000, 50) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.Promotes, v.State);
        Assert.Equal(-20.0, v.ByteDeltaPct, 3);
    }

    /// <summary>Um centésimo de VMAF abaixo já é <b>outra</b> família: a fronteira é
    /// fechada, e é este o teste que prova que <c>&gt;=</c> não é "praticamente igual".</summary>
    [Fact]
    public void CqpUmCentésimoAbaixoDaProducao_NaoAlcanca()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 83.99, 4_000_000, 50) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.CannotMatch, v.State);
        Assert.False(v.ByteWin);   // 60% "de economia" que não pode ser declarada
    }

    // ------------------------------------------------------- a armadilha: qualidade primeiro

    /// <summary>
    /// <b>O teste que este arquivo existe para impedir.</b> A curva CQP tem dois pontos: um
    /// <b>barato e ruim</b> (77,4 VMAF) e um <b>caro e bom</b> (84,6 VMAF). A produção está
    /// em 82,8 VMAF.
    ///
    /// <para>O ponto barato daria "−43% de bytes" contra 9,3 MiB — uma economia fantasma,
    /// porque é <b>5,4 pontos de VMAF mais ruim</b>. O judge tem de escolher o ponto de
    /// 7,1 MiB, e esse número (−27%) é a economia <b>real</b>.</para>
    ///
    /// <para>Os VMAF/bytes aqui são os da curva de produção medidos na RX 5700 XT mais um
    /// ponto CQP <b>inventado</b> (a curva CQP ainda não foi medida): o que se trava aqui é a
    /// <i>regra de escolha</i>, não um resultado.</para>
    /// </summary>
    [Fact]
    public void CqpEscolheOPontoMaisBaratoQueAtinge_NAoOPontoMaisBaratoDeTodos()
    {
        var producao = P("0.36", 82.77, 9_752_025, 43.5);
        var cqp = new List<AmdCqpPoint>
        {
            P("qp22", 77.39, 5_557_453, 43.5),   // o mais barato de todos, e PIOR que a produção
            P("qp18", 84.61, 7_100_000, 43.5),   // mais caro, e melhor
        };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.Promotes, v.State);
        Assert.Equal("qp18", v.ChosenCqpLabel);
        Assert.Equal(7_100_000, v.CqpBytes);
        Assert.Equal(-27.2, v.ByteDeltaPct, 1);
        // -43% seria a economia fantasma do ponto de pior qualidade.
        Assert.True(v.ByteDeltaPct > -30, $"delta veio {v.ByteDeltaPct}: e a economia do ponto ruim");
    }

    /// <summary>Entre os pontos que <b>atingem</b> a âncora, vale o mais barato: dois pontos
    /// acima do VMAF de produção, e o judge não pode escolher o mais caro dos dois.</summary>
    [Fact]
    public void CqpComVariosPontosAcimaDaAncora_EscolheOMaisBarato()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint>
        {
            P("qp16", 90.0, 9_000_000, 50),
            P("qp18", 85.0, 7_000_000, 50),
            P("qp20", 86.0, 7_400_000, 50),
        };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal("qp18", v.ChosenCqpLabel);
        Assert.Equal(7_000_000, v.CqpBytes);
    }

    /// <summary>
    /// CQP <b>não</b> alcança a qualidade de produção. O veredito é
    /// <see cref="AmdCqpState.CannotMatch"/> e <b>não</b> uma comparação de bytes:
    /// <see cref="AmdCqpVerdict.BestCqpVmaf"/> e <see cref="AmdCqpVerdict.AnchorVmaf"/>
    /// existem para o relatório dizer quantos pontos faltaram, em vez de bater o resultado
    /// sem explicação.
    /// </summary>
    [Fact]
    public void CqpNaoAlcancaAQualidadeDaProducao_EDeCannotMatch()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp22", 79.0, 5_000_000, 50) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.CannotMatch, v.State);
        Assert.Equal(84.0, v.AnchorVmaf, 3);
        Assert.Equal(79.0, v.BestCqpVmaf, 3);
        Assert.Equal(0, v.CqpBytes);
        Assert.False(v.ByteWin);
    }

    // ----------------------------------------------------------------- fps

    /// <summary>Economia de bytes <b>com</b> queda de fps acima do corte não promove. O
    /// critério tem duas pernas de propósito: preset 20% mais lento com 6% menos bytes troca
    /// qualidade por teto de gravação, e essa é decisão do usuário, não do probe.</summary>
    [Fact]
    public void CqpQuePerderMaisDe5PorCentoDeFps_NaoPromove_MesmoGanhandoBytes()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 85.0, 7_000_000, 38) };   // -24% de fps

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.KeepsProduction, v.State);
        Assert.True(v.ByteWin);          // -30%: a economia existe
        Assert.False(v.FpsAcceptable);   // mas o preço não foi aceito
        Assert.True(v.FpsDeltaPct < -AmdCqpCriteria.MaxFpsLossPct);
    }

    /// <summary>Perder exatamente 5% de fps ainda é aceito (mesma fronteira simétrica do
    /// ganho de bytes).</summary>
    [Fact]
    public void CqpQuePerderExatamente5PorCentoDeFps_Aceita()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 85.0, 7_000_000, 47.5) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.True(v.FpsAcceptable);
        Assert.Equal(AmdCqpState.Promotes, v.State);
    }

    /// <summary>
    /// <b>Este é o teste que fixa o corte de 5% de fps, e ele só existe porque a mutação
    /// pegou o furo.</b> Trocar <see cref="AmdCqpCriteria.MaxFpsLossPct"/> de 5 para 20
    /// deixava a suíte inteira verde: o teste de 24% de perda reprovava nos dois cortes, e o
    /// de 5% passava nos dois. Nenhum valor estava <i>entre</i> os cortes, então o número
    /// estava sem cobertura — o critério podia ser qualquer coisa de 5% a 20% e o gate não
    /// diria nada.
    ///
    /// <para>−8% de fps: reprovado pelo corte de 5%, aceito pelo de 20%. Com bytes em −30%,
    /// o veredito só pode ser <c>KeepsProduction</c>.</para>
    /// </summary>
    [Fact]
    public void CqpQuePerder8PorCentoDeFps_NaoPromove_AunqueGanhando30PorCentoDeBytes()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 85.0, 7_000_000, 46) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(-8.0, v.FpsDeltaPct, 3);
        Assert.True(v.ByteWin);
        Assert.False(v.FpsAcceptable);
        Assert.Equal(AmdCqpState.KeepsProduction, v.State);
    }

    /// <summary>
    /// Fps não medido num dos lados <b>não</b> bloqueia uma economia de bytes legítima, e
    /// <see cref="AmdCqpVerdict.FpsMeasured"/> fica falso para o relatório dizer que o
    /// critério de fps não foi avaliado.
    ///
    /// <para>Escolha deliberada, e o contrário também seria defensável: bloquear deixaria
    /// um encode que perdeu a medição de fps vetar um resultado de bytes que é real. O
    /// relatório não pode esconder a lacuna — daí o <c>FpsMeasured</c> separado, e não
    /// <c>FpsDeltaPct = 0</c> fingindo que os dois lados foram medidos.</para>
    /// </summary>
    [Fact]
    public void FpsNaoMedido_NaoBloqueiaOPromote_EDeFicaExplicito()
    {
        var producao = P("0.36", 84.0, 10_000_000, 0);
        var cqp = new List<AmdCqpPoint> { P("qp18", 85.0, 7_000_000, 0) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.Promotes, v.State);
        Assert.False(v.FpsMeasured);
        Assert.True(v.FpsAcceptable);
    }

    // ----------------------------------------------------------------- unmeasured

    /// <summary>
    /// VMAF 0 = a medição de qualidade falhou. Um ponto assim é <b>descartado</b>, não
    /// tratado como "qualidade 0, que é a pior possível" — que faria o CQP parecer
    /// altíssimo e promover. É a regra central do audit: encode que não produziu número
    /// medido não vira veredito.
    /// </summary>
    [Fact]
    public void PontoCqpComVmafZeroEDeDescartado_NAoViraVitoriaDoCqp()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        // VMAF 0 com 10x menos bytes: se o ponto fosse usado, isto seria "economia" de 90%.
        var cqp = new List<AmdCqpPoint> { P("qp18", 0, 1_000_000, 50) };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.Unmeasured, v.State);
        Assert.False(v.ByteWin);
    }

    /// <summary>Um ponto CQP quebrado <b>junto</b> de um ponto bom: o quebrado é descartado e
    /// o bom decide. Se o quebrado contasse, o veredito mudaria.</summary>
    [Fact]
    public void PontoCqpQuebrado_JuntoDeUmBom_NaoContaParaOVeredito()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint>
        {
            P("qp20", 0, 1_000_000, 50),        // medição de VMAF falhou
            P("qp18", 86.0, 7_000_000, 50),
        };

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, cqp);

        Assert.Equal(AmdCqpState.Promotes, v.State);
        Assert.Equal(7_000_000, v.CqpBytes);
    }

    [Fact]
    public void PontoCqpComBytesZeroEDeDescartado()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 90.0, 0, 50) };

        Assert.Equal(AmdCqpState.Unmeasured, AmdAuditVerdicts.JudgeAmfCqp(producao, cqp).State);
    }

    [Fact]
    public void ProducaoNaoMedida_EDeUnmeasured()
    {
        // Sem bytes de produção não há contra o que comparar: dividir por 0 seria o
        // "custo infinito" que JudgeByteCost já teve que tratar.
        var producao = P("0.36", 0, 0, 50);
        var cqp = new List<AmdCqpPoint> { P("qp18", 90.0, 5_000_000, 50) };

        Assert.Equal(AmdCqpState.Unmeasured, AmdAuditVerdicts.JudgeAmfCqp(producao, cqp).State);
    }

    [Fact]
    public void CqpSemNenhumPonto_EDeUnmeasured()
    {
        var producao = P("0.36", 84.0, 10_000_000, 50);

        var v = AmdAuditVerdicts.JudgeAmfCqp(producao, new List<AmdCqpPoint>());

        Assert.Equal(AmdCqpState.Unmeasured, v.State);
        Assert.Equal(0, v.CqpBytes);
        Assert.False(v.ByteWin);
    }

    /// <summary><see cref="AmdCqpState.Unmeasured"/> não pode promover por acidente: os
    /// bytes zeredos dão delta 0, e 0 não é &lt;= −5. Trivialmente verdade no código, e
    /// existe porque o estado enumérico é a única coisa que impede o relatório de promover
    /// a partir de um probe que não rodou.</summary>
    [Fact]
    public void Unmeasured_NuncaPromove()
    {
        var v = AmdAuditVerdicts.JudgeAmfCqp(P("0.36", 0, 0, 50), new List<AmdCqpPoint>());

        Assert.NotEqual(AmdCqpState.Promotes, v.State);
        Assert.False(v.ByteWin);
        Assert.False(v.FpsAcceptable && v.ByteWin);
    }

    // ------------------------------------------------------- o texto que o leitor vai usar

    /// <summary>As linhas do relatório são a decisão: é delas que sai "trocar a captura".
    /// Por isso são testadas sem GPU — o que decide o comportamento é a frase, não o número.</summary>
    private static string Texto(AmdCqpState state, double anchor, double bestCqp, long prodBytes, long cqpBytes,
        double delta, double prodFps, double cqpFps, string? label = null) =>
        string.Join("\n", AmdCqpReportWriter.VerdictLines(new AmdCqpVerdict(
            state, anchor, bestCqp, prodBytes, cqpBytes, delta, prodFps, cqpFps) { ChosenCqpLabel = label }));

    /// <summary>
    /// <b>O texto tem que diferenciar "não medi" de "não compensa".</b> São decisões opostas:
    /// a primeira manda investigar, a segunda manda manter. Um probe que falhou e publica
    /// "CQP não compensa" faz o usuário fechar uma pergunta que continua aberta — a mesma
    /// razão do <c>Unmeasured</c> como estado de primeira classe do Item 9.
    ///
    /// <para>As asserções são sobre o <b>invariante</b> (nenhuma linguagem de decisão numa
    /// medição que não aconteceu), não sobre frases literais: a primeira versão dizia
    /// <c>"'não medi' não é 'não compensa'"</c>, que <b>continha</b> a expressão proibida e
    /// era lida por quem passava os olhos. Fixar a frase teria travado o defeito em vez de
    /// corrigi-lo, e trocar de frase a cada redação tornaria o teste decorativo.</para>
    /// </summary>
    [Fact]
    public void TextoDeUnmeasured_NaoDizQueNaoCompensa()
    {
        var txt = Texto(AmdCqpState.Unmeasured, 0, 0, 0, 0, 0, 0, 0);

        Assert.Contains("UNMEASURED", txt);
        Assert.Contains("não respondeu", txt);      // a culpa é da máquina, não do encoder
        // O invariante: sem medição, nenhuma das duas decisões pode aparecer no texto.
        Assert.DoesNotContain("não compensa", txt);
        Assert.DoesNotContain("PROMOVE", txt);
        Assert.DoesNotContain("MANTÉM", txt);
        Assert.DoesNotContain("% de bytes", txt);
    }

    /// <summary><see cref="AmdCqpState.CannotMatch"/> tem que dizer <b>quantos pontos de VMAF
    /// faltaram</b> — é isso que diz se o CQP está perto (vale estender a escada) ou longe
    /// (a hipótese está errada). E não pode citar percentual de bytes: as duas pontas não
    /// estão na mesma qualidade, e um número ali seria a economia fantasma do teste
    /// <see cref="CqpEscolheOPontoMaisBaratoQueAtinge_NAoOPontoMaisBaratoDeTodos"/>.</summary>
    [Fact]
    public void TextoDeCannotMatch_DizAFaltaEProibeComparacaoDeBytes()
    {
        var txt = Texto(AmdCqpState.CannotMatch, 84.0, 79.0, 10_000_000, 0, 0, 50, 50);

        Assert.Contains("CANNOT MATCH", txt);
        Assert.Contains("5.00", txt);          // 84.00 - 79.00
        Assert.Contains("MENOS qualidade", txt);
        Assert.DoesNotContain("% de bytes", txt);
    }

    [Fact]
    public void TextoDePromote_NomeiaORungEOEconomiaEmBytes()
    {
        var txt = Texto(AmdCqpState.Promotes, 84.0, 86.0, 10_000_000, 8_000_000, -20.0, 50, 50, "qp20");

        Assert.Contains("PROMOVE", txt);
        Assert.Contains("qp20", txt);
        Assert.Contains("-20.0% de bytes", txt);
    }

    /// <summary>
    /// O aviso de conteúdo sintético é <b>obrigatório</b> em toda linha de PROMOVE. Ele é o
    /// que impede promoting uma decisão de produção a partir do mandelbrot: a medição é de
    /// codificador, e jogo real é outra distribuição. O teste existe porque um aviso é
    /// exatamente a linha que alguém remove numa revisão de texto, achando que é redundante.
    /// </summary>
    [Fact]
    public void TextoDePromote_SempreAvisaQueENumeroSintetico()
    {
        var txt = Texto(AmdCqpState.Promotes, 84.0, 86.0, 10_000_000, 8_000_000, -20.0, 50, 50, "qp20");

        Assert.Contains("sintético", txt);
        Assert.Contains("jogo real", txt);
    }

    /// <summary>
    /// <b>Trava de cultura.</b> O <c>--audit-amd</c> já rodou na AMD e imprimiu "VMAF
    /// 77.39"; se este relatório imprimisse "77,39" em pt-BR, o mesmo número apareceria de
    /// dois jeitos e a comparação a olho seria errada. Roda sob <c>pt-BR</c> de propósito:
    /// sem trocar a cultura, o teste passaria em qualquer máquina en-US e não provaria nada.
    /// É o mesmo motivo do teste do resumo de NVENC que fixava "12.00 fps".
    /// </summary>
    [Fact]
    public void TextoDePromote_NAoUsaSeparadorDecimalBrasileiro()
    {
        var anterior = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("pt-BR");
            var txt = Texto(AmdCqpState.Promotes, 77.39, 86.0, 5_557_453, 4_000_000, -28.0, 43.5, 43.5, "qp20");

            Assert.Contains("77.39", txt);
            Assert.DoesNotContain("77,39", txt);
        }
        finally
        {
            CultureInfo.CurrentCulture = anterior;
        }
    }

    /// <summary>Os dois motivos de "mantém produção" são textos <b>distintos</b>: economia
    /// abaixo do corte está perto do número; economia que existe mas o fps não aceitou é um
    /// problema de desempenho. Colapsar os dois em "não promotes" obriga quem lê a refazer a
    /// conta sem os dados que o probe já tinha.</summary>
    [Fact]
    public void TextoDeMantemProducao_DistingueBytesDeFps()
    {
        var porBytes = Texto(AmdCqpState.KeepsProduction, 84.0, 85.0, 10_000_000, 9_600_000, -4.0, 50, 50, "qp18");
        var porFps = Texto(AmdCqpState.KeepsProduction, 84.0, 85.0, 10_000_000, 7_000_000, -30.0, 50, 38, "qp18");

        Assert.Contains("abaixo do corte", porBytes);
        Assert.DoesNotContain("fps não passou", porBytes);
        Assert.Contains("fps não passou no orçamento", porFps);
    }

    /// <summary>Fps não medido tem que aparecer no texto. Sem essa linha o relatório mostra
    /// "43.5 → 43.5" ou omite a coluna, e o leitor conclui que o CQP não custou desempenho —
    /// que é uma afirmação que ninguém mediu.</summary>
    [Fact]
    public void TextoDePromote_AvisaQueFpsNaoFoiAvaliado()
    {
        var txt = Texto(AmdCqpState.Promotes, 84.0, 86.0, 10_000_000, 8_000_000, -20.0, 0, 0, "qp20");

        Assert.Contains("NÃO COMPARÁVEL", txt);
        Assert.Contains("não foi avaliado", txt);
    }

    // --------------------------------------------- a coluna "teto" da tabela do probe

    /// <summary><b>Um encode que falhou não pode anunciar folga de teto.</b> Esta é a mesma
    /// armadilha do texto de UNMEASURED, mas numa coluna: o achieved de um encode recusado
    /// é 0 kbps, e a primeira versão da tabela imprimia "folga" nesse 0 — publicando
    /// resultado a partir de uma medição que não aconteceu. O rodapé do launcher diz ao
    /// usuário que "apertou nas duas pontas" significa que o número é do teto e não do CQP;
    /// se a coluna mentir "folga" justamente quando nada mediu, essa instrução vira
    /// armadilha.</summary>
    [Fact]
    public void Teto_NaoMedidoNaoDiceQueHaviaFolga()
    {
        Assert.Equal("-", AmdCqpProbe.CeilingWord(measured: false, kbps: 0, maxrateKbps: 55000));
        Assert.DoesNotContain("folga", AmdCqpProbe.CeilingWord(false, 0, 55000));
    }

    /// <summary>A distinção que importa para a leitura: perto do teto significa que o VBV
    /// mandou, longe significa que o QP mandou. 95% do teto é o corte usado no relatório,
    /// e a fronteira é inclusiva no lado do "apertou".</summary>
    [Theory]
    [InlineData(55000, "VBV APERTA")]   // exatamente no teto
    [InlineData(53000, "VBV APERTA")]   // 96% — colado
    [InlineData(50000, "folga")]        // 91% — o QP mandou
    [InlineData(19800, "folga")]        // a produção real: bem abaixo
    public void Teto_MeasureD_ComparaOAchievedComOTeto(int kbps, string esperado)
    {
        Assert.Equal(esperado, AmdCqpProbe.CeilingWord(measured: true, kbps, maxrateKbps: 55000));
    }
}
