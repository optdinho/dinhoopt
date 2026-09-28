using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Trava o <b>refino de passo 1 na travessia do VMAF</b> da escada CQP.
///
/// <para><b>O buraco que estes testes cobrem, com o numero que o prova.</b> A escada <c>auto</c>
/// anda de <b>2 em 2</b> e para por <b>bytes</b>. Mas quem decide o promote e o <b>VMAF</b>. Os
/// dois sao curvas diferentes: a taxa cai ~14% por degrau, o VMAF cai ~1,3. Medido na
/// RX 5700 XT (1080p60, cq 18, mandelbrot, RESULT-CQP-AMD): producao VMAF <b>77,39</b>;
/// qp30 = <b>79,21</b> com -2,6% de bytes; qp32 = <b>76,65</b>. A travessia do VMAF acontece
/// ENTRE 30 e 32 - ou seja o ultimo QP que ainda passa e o <b>impar</b>. A escada de passo 2
/// mede 30 e 32, <b>nunca 31</b>. O veredito dizia "MANTEM PRODUCAO" olhando so o qp30
/// (-2,6%, abaixo do corte de 5%) e nunca chegou a medir a celula que existe.</para>
///
/// <para><b>Por que a funcao devolve UM degrau, e nao a sequencia toda.</b> Ela nao sabe o
/// VMAF do candidato antes de medi-lo. A monotonicidade (VMAF cai com QP) so se confirma
/// MEDINDO: se o candidato reprovar, tudo acima reprova, e o passo seguinte decide isso.
/// Devolver "31, 33, 35..." seria chutar VMAF para tres celulas de uma vez - que e
/// exatamente o erro que a escada grosso ja cometia, so com menos degraus.</para>
///
/// <para><b>O que estes testes NAO provam.</b> Nenhum deles roda o encoder. O que o refino
/// entrega ao usuario depende do ffmpeg aceitar a chain CQP daquele QP, e isso so a RX 5700 XT
/// responde. O que aqui esta travado e a <b>pergunta</b> ("qual QP medir agora?"), nao a
/// resposta.</para>
/// </summary>
public class AmdCqpRefinementTests
{
    /// <summary>Arms REAIS do RESULT-CQP-AMD (1080p60, cq 18, mandelbrot). Apenas os valores
    /// lidos do arquivo - nada interpolado entra aqui, senao o teste provaria a si mesmo.</summary>
    private static readonly (int Qp, double Vmaf)[] Rx5700Xt =
    {
        (22, 84.56), (24, 83.62), (26, 82.53), (28, 81.14), (30, 79.21), (32, 76.65),
    };

    /// <summary>VMAF da ponta de producao na mesma corrida.</summary>
    private const double ProducaoVmaf = 77.39;

    /// <summary>O teste que importa. A escada mediu 22..32 de dois em dois; o QP que decide o
    /// promote e o 31, e e o unico que ela nunca mediu.</summary>
    [Fact]
    public void NextRefinement_ComOsDadosReaisDaRx5700Xt_DevolveQp31()
    {
        var next = AmdCqpAutoLadder.NextRefinement(Rx5700Xt, ProducaoVmaf);

        Assert.Equal(31, next);
    }

    /// <summary>Por que UM degrau por vez, e nao a sequencia inteira. A funcao nao sabe o VMAF
    /// do candidato antes de medir: a monotonicidade (VMAF cai com QP) so se confirma MEDINDO.
    /// Se devolvesse [31, 32, 33, 34] de uma vez, estaria affirmando que 32, 33 e 34 passam
    /// sem nunca tê-los medido — e o dado real mostra o oposto: o 32 reprova (76,65).
    ///
    /// <para>Chamadas sucessivas sobem de 1 em 1, e cada passo só existe porque o anterior foi
    /// medido e passou. A segunda chamada devolve 32 <b>depois</b> que o 31 foi medido e passou —
    /// nao antes, e nao pulando para 34.</para></summary>
    [Fact]
    public void NextRefinement_DevolveUmDegrauPorVez_NaoAEscaladaInteira()
    {
        var medidos = new List<(int Qp, double Vmaf)> { (28, 81.14), (30, 79.21) };

        // 1a chamada: o 31 e o impar que a escada de passo 2 pulou.
        var primeiro = AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf);
        Assert.Equal(31, primeiro);

        // O 31 so existe como candidato; so depois de medido e aprovado ele vira degrau.
        medidos.Add((31, 78.00));
        var segundo = AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf);
        Assert.Equal(32, segundo);

        // Um degrau por vez: +1 a cada chamada, nunca +2 e nunca a sequencia inteira.
        medidos.Add((32, ProducaoVmaf + 0.10));
        Assert.Equal(33, AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf));
    }

    /// <summary>Um QP reprovado ACIMA <b>nao</b> desqualifica o QP entre ele e o ultimo que
    /// passou. E o ponto mais importante desta funcao: a escada grossa via 30, viu 32 reprovar,
    /// e parou ali - achando que nao havia nada entre os dois. Mas o VMAF medido mostra o
    /// contrario: 30 = 79,21, 32 = 76,65, e o 31 interpolado (77,93) <b>passa</b> o corte de
    /// 77,39. Uma funcao que desistisse por causa do 32 perderia exatamente a celula que o
    /// refino existe para achar.</summary>
    [Fact]
    public void NextRefinement_QpAcimaReprovado_NaoDesqualificaOImparNaoMedido()
    {
        var medidos = new List<(int Qp, double Vmaf)> { (30, 79.21), (32, 76.65) };

        Assert.Equal(31, AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf));
    }

    /// <summary>O caso simetrico: o 31 foi medido e REPROVOU, entao 31 e o ultimo que passa e o
    /// proximo candidato e 32 - que ja foi medido. Pela monotonicidade, tudo acima reprova, e
    /// parar aqui e o comportamento certo (e nao uma medicao desperdicada).</summary>
    [Fact]
    public void NextRefinement_CandidatoReprovadoJaMedido_Para()
    {
        var medidos = new List<(int Qp, double Vmaf)> { (30, 79.21), (31, 76.90), (32, 76.65) };

        Assert.Null(AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf));
    }

    /// <summary>Nenhum QP passa no VMAF da producao: nao ha travessia para refinar, e subir
    /// seria medir celulas que so podem reprovar.</summary>
    [Fact]
    public void NextRefinement_NadaPassaNoVmafDaProducao_RetornaNull()
    {
        var medidos = new[] { (22, 70.0), (24, 68.0) };

        Assert.Null(AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf));
    }

    /// <summary>Producao sem VMAF medido (0 = "nao medido", nao "VMAF zero"). Sem ancora nao ha
    /// travessia definida. O `&lt;= 0` tambem protege o caso de um VMAF negativo, que o
    /// ffmpeg imprime como "N/A" em alguns pontos de falha.</summary>
    [Fact]
    public void NextRefinement_ProducaoSemVmaf_RetornaNull()
    {
        var medidos = new[] { (30, 79.21) };

        Assert.Null(AmdCqpAutoLadder.NextRefinement(medidos, 0));
        Assert.Null(AmdCqpAutoLadder.NextRefinement(medidos, -1));
    }

    /// <summary>QP repetido: vale o <b>melhor</b> VMAF visto. O outro caminho - manter o
    /// ultimo - trataria um rung reprovado como reprovado mesmo depois de uma remedida que
    /// passou, e o refino pararia cedo demais sem nunca achar a travessia.</summary>
    [Fact]
    public void NextRefinement_QpMedidoMaisDeUmaVez_UsaOMelhorVmaf()
    {
        // O 31 reprovou numa Remedida e passou na seguinte: tem de continuar subindo.
        var medidos = new[] { (30, 79.21), (31, 76.90), (31, 78.10) };

        Assert.Equal(32, AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf));
    }

    /// <summary>Teto do ffmpeg: QP 51 e o maximo aceito, entao 52 seria um rung que o
    /// encoder rejeita. O clamp la no chamador existe, mas um `52` devolvido aqui viraria
    /// "medindo como qp51 (aviso)" a cada rodada - e o aviso esconderia que o refino travou
    /// por outro motivo.</summary>
    [Fact]
    public void NextRefinement_NaoDevolveQpAcimaDoTetoDoFfmpeg()
    {
        var medidos = new[] { (51, 99.0) };

        Assert.Null(AmdCqpAutoLadder.NextRefinement(medidos, ProducaoVmaf));
    }

    /// <summary>Lista vazia: nada medido, nada a refinar. Nao e lanca, e devolvolve null -
    /// quem chama (o runner) decide se isso e normal ou um sinal para reclamar.</summary>
    [Fact]
    public void NextRefinement_SemMedicoes_RetornaNull()
    {
        Assert.Null(AmdCqpAutoLadder.NextRefinement(Array.Empty<(int, double)>(), ProducaoVmaf));
        Assert.Null(AmdCqpAutoLadder.NextRefinement(null!, ProducaoVmaf));
    }

    /// <summary>Trava o teto de degraus. Sem isto, um QP que passa sempre devolveria um
    /// infinito de degraus e a corrida nao terminaria - o `while` do runner so para porque
    /// este numero existe.</summary>
    [Fact]
    public void MaxRefinements_EUmTetoPequenoEPositivo()
    {
        Assert.InRange(AmdCqpAutoLadder.MaxRefinements, 1, 8);
    }
}
