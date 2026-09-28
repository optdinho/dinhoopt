using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// A escada de QP do <c>--probe-amf-cqp</c> é o que decide <b>se a pergunta do A/B é
/// respondível</b>. A escada original era fixa em <c>{cq-2, cq, cq+2, cq+4}</c> e mediu, no
/// RX 5700 XT real, 43,7 a 67,7 Mbps contra os <b>22,1 Mbps</b> da produção: ou seja, todos
/// os 4 degraus custavam de 2x a 3,1x o arquivo da produção. O probe media o CQP só onde ele
/// não tem chance de ganhar, e o veredito <c>MANTÉM PRODUÇÃO</c> (+98% de bytes) era correto
/// — mas era a resposta a uma pergunta mais fraca do que a que valia a pena fazer.
///
/// <para>A região que falta é <b>acima</b> de <c>cq+4</c>, onde os bytes descem até encontrar a
/// produção. E ela é previsível: na curva medida, cada +2 de QP corta ~14% da taxa
/// (67,7 → 57,6 → 50,2 → 43,7), então de 43,7 para 22,1 são ~4,5 passos = <b>~qp31</b>.
/// Testar isso às cegas seria chute; por isso a escada virou parâmetro, e o passo automático
/// existe para não depender da minha previsão estar certa.</para>
///
/// <para><b>Erro de classe que estes testes travam.</b> A AGENTS.md registra o bug do
/// <c>verify-ffmpeg.js</c>: <c>--ffmpeg</c> sem valor caía no default do <c>PATH</c>, a
/// validação rodava inteira, imprimia "51/51 OK" e o veredito era sobre <b>outro build</b> —
/// silenciosamente. O mesmo se aplica a uma lista de QP malformada: se "abc" ou "2a4" caísse
/// na escada default, o probe mediria a escada errada e publicaria um veredito seemingly
/// legítimo sobre ela. Lista explícita inválida é <b>erro duro</b>, com o token culpado nomeado.</para>
/// </summary>
public class AmdCqpQpLadderTests
{
    // ---------- NormalizeQps: lista explícita ----------

    [Fact]
    public void ListaVazia_UsaAEscadaPadrao()
    {
        // Sem argumento, o comportamento é idêntico ao da versão já medida: a escada default.
        Assert.True(AmdCqpProbe.TryNormalizeQps(null, 18, out var qps, out var erro));
        Assert.Null(erro);
        Assert.Equal(new[] { 16, 18, 20, 22 }, qps);

        Assert.True(AmdCqpProbe.TryNormalizeQps("   ", 18, out qps, out erro));
        Assert.Equal(new[] { 16, 18, 20, 22 }, qps);
    }

    [Fact]
    public void ListaExplicita_EhUsadaComoDigitada()
    {
        Assert.True(AmdCqpProbe.TryNormalizeQps("24,26,28", 18, out var qps, out var erro));
        Assert.Null(erro);
        Assert.Equal(new[] { 24, 26, 28 }, qps);
    }

    [Fact]
    public void Lista_IgnoraEspacosOrdemERepeticoes()
    {
        // Usuário digitando na mão vai sobrar espaço e vai repetir um degrau. Dedup + sort
        // estabiliza a ordem porque o relatório é lido de cima para baixo e "mais barato
        // primeiro" só vale se a curva estiver ordenada por QP.
        Assert.True(AmdCqpProbe.TryNormalizeQps(" 28 , 24 ,28, 26 ", 18, out var qps, out _));
        Assert.Equal(new[] { 24, 26, 28 }, qps);
    }

    [Theory]
    // Fora da faixa real do ffmpeg: 52 é REJEITADO por "-qp_i ... out of range [-1 - 51]"
    // (medido no binário embarcado). Aceitar e medir outra coisa seria o gate-julgando-o-errado.
    [InlineData("52", "52")]
    [InlineData("0,52", "52")]
    [InlineData("-1", "-1")]
    [InlineData("abc", "abc")]
    [InlineData("2a4", "2a4")]
    [InlineData("24;26", "24;26")]
    public void ListaInvalida_ErroDuroNomeandoOToken(string arg, string tokenEsperado)
    {
        Assert.False(AmdCqpProbe.TryNormalizeQps(arg, 18, out _, out var erro));
        Assert.NotNull(erro);
        // A mensagem tem que conter o token culpado: "erro genérico" num probe manual é
        // indistinguível de "o probe não roda", e o usuário ficaria sem saber o que corrigir.
        Assert.Contains(tokenEsperado, erro);
    }

    [Fact]
    public void Lista_ComItemVazio_ErroDuro()
    {
        // "24,,26" é quase sempre dedo errado. Aceitar removendo o vazio faria o probe medir
        // 24 e 26 sem avisar que a lista digitada tinha três itens.
        Assert.False(AmdCqpProbe.TryNormalizeQps("24,,26", 18, out _, out var erro));
        Assert.NotNull(erro);
        Assert.Contains("vazio", erro);
    }

    [Fact]
    public void TokenAuto_NAoEhConfundidoComUmQpNumerico()
    {
        // "auto" é o modo que percorre a curva até achar a taxa da produção. Se fosse tratado
        // como lista, daria erro de parse e o modo seria inalcançável.
        Assert.True(AmdCqpProbe.TryNormalizeQps("auto", 18, out var qps, out var erro));
        Assert.Null(erro);
        Assert.Equal(AmdCqpAutoLadder.Sentinel, qps);
    }

    // ---------- escada automática ----------

    [Fact]
    public void EscadaAuto_ComecaAcimaDoCQ_eSobeDe2Em2()
    {
        // Começa em cq+4 (o topo da escada default) e não em cq: os degraus abaixo já foram
        // medidos e a economia só existe subindo.
        var seq = AmdCqpAutoLadder.QpSequence(cq: 18, step: 2, maxArms: 8);

        Assert.Equal(new[] { 22, 24, 26, 28, 30, 32, 34, 36 }, seq);
    }

    [Fact]
    public void EscadaAuto_NuncaPassaDoTetoDoFfmpeg()
    {
        // cq alto + maxArms grande não pode gerar um QP que o ffmpeg rejeita: a escada
        // automático tem o mesmo clamp 0..51 da escada default.
        var seq = AmdCqpAutoLadder.QpSequence(cq: 48, step: 2, maxArms: 20);

        Assert.All(seq, qp => Assert.InRange(qp, AmdCqpProbe.MinQp, AmdCqpProbe.MaxQp));
        Assert.Equal(AmdCqpProbe.MaxQp, seq[^1]);
    }

    [Fact]
    public void EscadaAuto_ParaDepoisDeMedirDoisDegrausAcimaDoCruzamento()
    {
        // Medir 8 degraus quando o cruzamento acontece no 2º é desperdício de minutos do
        // usuário. Regra: depois do primeiro braço que já cabe no orçamento da produção,
        // mede mais `ArmsPastCrossing` para ver se algum deles ainda ALCANÇA o VMAF da
        // produção — que é a única forma de o critério (byte no VMAF da produção) ser
        // satisfeito. Cortar no cruzamento perderia essa resposta.
        const long prod = 5_518_522;
        var medidos = new List<long> { 12_544_439, 5_100_000, 4_950_000, 4_800_000 };

        // 4 medidos, cruzamento no índice 1, dois degraus acima dele.
        Assert.True(AmdCqpAutoLadder.ShouldStop(prod, medidos, out var motivo));
        Assert.Contains("abaixo", motivo, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EscadaAuto_NaoParaNoPrimeiroCruzamento()
    {
        // Este é o passo que impede o veredito errado: parar no cruzamento mediria um braço
        // abaixo da produção mas provavelmente também ABAIXO do VMAF dela, e o judge
        // responderia "CannotMatch" sem nunca ter olhado o resto da curva.
        const long prod = 5_518_522;
        var medidos = new List<long> { 12_544_439, 5_100_000 };

        Assert.False(AmdCqpAutoLadder.ShouldStop(prod, medidos, out var motivo));
        Assert.Contains("abaixo", motivo, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EscadaAuto_NuncaParaAntesDeCruzar()
    {
        // Dois degraus medidos, nenhum abaixo da produção: parar aqui declararia "não
        // promote" sem nunca ter olhado a região que compete.
        const long prod = 5_518_522;
        var medidos = new List<long> { 12_544_439, 10_927_181 };

        Assert.False(AmdCqpAutoLadder.ShouldStop(prod, medidos, out var motivo));
        Assert.Contains("abaixo", motivo, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EscadaAuto_SemProducaoMedida_NuncaPara()
    {
        // bytes 0 = produção não medida. Tratar 0 como "orçamento infinito" faria todo
        // braço contar como cruzamento e parar no primeiro — o oposto do defensivo.
        var medidos = new List<long> { 5_100_000, 4_950_000, 4_800_000 };

        Assert.False(AmdCqpAutoLadder.ShouldStop(productionBytes: 0, medidos, out _));
    }
}
