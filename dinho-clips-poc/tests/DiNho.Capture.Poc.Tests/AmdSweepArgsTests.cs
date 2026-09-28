using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// As duas entradas de <c>--probe-amd-sweep</c> que o smoke test expôs, e que a assinatura
/// do探 <c>--probe-amf-cqp</c> já resolvia: <b>uma lista mal digitada não pode virar uma
/// varredura de outro objeto</b>.
///
/// <para>Nenhum destes testes precisa de GPU: as duas funções são parsing puro, e é por isso
/// que dá para travar aqui o defeito que o smoke só mostrou na tela.</para>
/// </summary>
public class AmdSweepArgsTests
{
    // ---------- lista de usage ----------

    [Fact]
    public void Usage_ListaVaziaPedeODefault()
    {
        Assert.True(AmdSweepProbe.TryNormalizeUsages("", out var u, out _));
        Assert.Empty(u);
    }

    [Fact]
    public void Usage_TokenDesconhecidoERRO_NaoFallbackParaAListaInteira()
    {
        // O defeito que o smoke pegou: `ResolveAmfProbeCandidates` devolve a lista INTEIRA para
        // um token desconhecido. O sweep rodou 7 cells e imprimiria um relatório completo e
        // plausível sobre uma lista que ninguém pediu - veredito errado com cara de certeza.
        Assert.False(AmdSweepProbe.TryNormalizeUsages("naoexiste", out var u, out var erro));
        Assert.Empty(u);
        Assert.NotNull(erro);
        Assert.Contains("naoexiste", erro!);
        // A mensagem tem que listar o que era válido, senão o usuário só sabe que errou.
        Assert.Contains("ultralowlatency", erro!);
    }

    [Fact]
    public void Usage_TokenVazioEntreVirgulasERRO()
    {
        // "default,,transcoding" é quase sempre dedo errado. Silenciar o item mediria duas
        // células e publicaria um resultado de uma lista de três.
        Assert.False(AmdSweepProbe.TryNormalizeUsages("default,,transcoding", out _, out var erro));
        Assert.NotNull(erro);
    }

    [Fact]
    public void Usage_DefaultViraAStringVaziaDaReferencia()
    {
        Assert.True(AmdSweepProbe.TryNormalizeUsages("default,transcoding", out var u, out _));
        Assert.Equal(new[] { "", "transcoding" }, u);
    }

    [Fact]
    public void Usage_EscapeEAplicaMaiusculas()
    {
        // A doc do ffmpeg é minúscula; digitar maiúscula não pode virar erro de digitação, e o
        // token tem de chegar normalizado na mesma forma que o NormalizeAmfUsage produz.
        Assert.True(AmdSweepProbe.TryNormalizeUsages("UltraLowLatency", out var u, out _));
        Assert.Equal(new[] { "ultralowlatency" }, u);
    }

    [Fact]
    public void Usage_RemoveRepetidos()
    {
        // "default,default" daria DUAS células de referência na grade: a segunda seria
        // dominada pela primeira e o relatório mostraria a mesma escolha duas vezes.
        Assert.True(AmdSweepProbe.TryNormalizeUsages("default,default,transcoding", out var u, out _));
        Assert.Equal(new[] { "", "transcoding" }, u);
    }

    [Theory]
    [InlineData("default")]
    [InlineData("transcoding")]
    [InlineData("ultralowlatency")]
    [InlineData("lowlatency")]
    [InlineData("webcam")]
    [InlineData("high_quality")]
    [InlineData("lowlatency_high_quality")]
    public void Usage_AceitaTodosOsTokensDocumentados(string token)
    {
        Assert.True(AmdSweepProbe.TryNormalizeUsages(token, out var u, out var erro), erro ?? token);
        Assert.Single(u);
    }

    // ---------- lista de QP ----------

    [Fact]
    public void Qp_AutoViraEscadaConcretaENuncaUmSentinel()
    {
        // O `auto` do probe 7 é o sentinel -1, que o próprio probe expande por eixo. A grade não
        // pode: o laço tem Math.Clamp, que tornaria -1 em 0 e mediria o rung MAIS CARO da
        // curva sem ninguém perceber.
        var qps = AmdSweepProbe.ResolveQps(AmdCqpAutoLadder.Sentinel, cq: 18);

        Assert.NotEqual(AmdCqpAutoLadder.Sentinel, qps);
        Assert.DoesNotContain(AmdCqpAutoLadder.Sentinel[0], qps);
        Assert.Equal(AmdCqpAutoLadder.QpSequence(18, AmdCqpAutoLadder.DefaultStep, AmdCqpAutoLadder.DefaultMaxArms), qps);
    }

    [Fact]
    public void Qp_AutoNaoComecaNaEscadaCurta()
    {
        // A escada base {cq-2..cq+4} = {16,18,20,22} é o que a primeira medição usou, e ela deu
        // 43,7 a 67,7 Mbps contra os 22,1 da produção: mediu o cqp só onde ele não tem chance.
        // A grade nasce para achar o lado barato, então o default tem de subir.
        var qps = AmdSweepProbe.ResolveQps(AmdCqpAutoLadder.Sentinel, cq: 18);

        Assert.DoesNotContain(16, qps);
        Assert.Contains(26, qps);
        Assert.True(qps.Max() > 30, $"a escada auto tem de passar de 30 para varrer o lado barato; parou em {qps.Max()}");
    }

    [Fact]
    public void Qp_ListaFixaPassaPorClampEDedupe()
    {
        Assert.Equal(new[] { 24, 26, 28 }, AmdSweepProbe.ResolveQps(new[] { 24, 26, 26, 28 }, 18));
        // Fora da faixa 0..51 o ffmpeg rejeita o encode inteiro: melhor limitar do que medir nada.
        Assert.Equal(new[] { 0, 51 }, AmdSweepProbe.ResolveQps(new[] { -5, 99 }, 18));
    }

    [Fact]
    public void Qp_ListaVaziaNaoGeraCelulaFantasma()
    {
        Assert.Empty(AmdSweepProbe.ResolveQps(Array.Empty<int>(), 18));
    }
}
