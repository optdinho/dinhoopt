using DiNho.Capture.Poc.Encoders;
using AmfUsageReport = DiNho.Capture.Poc.ProgramBenchmark.AmfUsageReport;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// O relatório do <c>--probe-amf-usage</c> tem <b>três colunas de delta</b> (fps, kbps, KiB)
/// e elas precisam compartilhar a mesma referência: a linha 1, que é o default de produção.
/// </summary>
///
/// <para><b>Defeito encontrado lendo o RESULT-AMF-USAGE.txt real do RX 5700 XT.</b> A coluna
/// KiB usava <c>Math.Max</c> acumulado <b>dentro</b> do laço, enquanto fps e kbps usavam
/// first-wins. Ou seja: KiB era relativo ao <b>maior arquivo visto até ali</b>, e não à linha 1.
/// Duas consequências, ambas visíveis no arquivo real:</para>
///
/// <list type="bullet">
/// <item><c>ultralowlatency</c> tem 2361 KiB contra 2325 da referência — ou seja <b>+1,5%
/// maior</b>, e a coluna Kbps dizia <b>+2%</b> corretamente. A coluna KiB imprimia
/// <b>+0%</b>, porque ela mesma havia acabado de estabelecer o máximo. Regressão de tamanho
/// publicada como zero.</item>
/// <item><c>webcam</c> (2325 KiB, idêntico à referência) imprimia <b>−2%</b> e
/// <c>lowlatency_high_quality</c> (2318 KiB) imprimia <b>−4%</b> — não porque fossem menores,
/// mas porque linhas anteriores maiores viraram o denominador. Duas linhas mostram
/// economia que não existe.</item>
/// </list>
///
/// <para>O critério de promote do Item 3 é sobre <b>fps</b>, e a linha de leitura do relatório
/// aponta o leitor para o <b>Kbps</b> — então o veredito estava certo e este defeito não o
/// contaminou. Ainda assim, a coluna mente sobre a única coisa que o critério secundário
/// ("bytes no mesmo cq") usaria, e a próxima leva leria justamente ela.</para>
///
/// <para>Os testes usam os números <b>medidos</b>, não números inventados: é a única forma de
/// reproduzir o defeito, já que ele nasce da ordem das linhas.</para>
/// </summary>
public class AmfUsageReportDeltaTests
{
    /// <summary>Linha medida do arquivo real (720p60, cq=20, maxrate 40000K).</summary>
    private static EncoderManager.EncodeProbeResult Row(string variant, double fps, double kbps, int kib) =>
        new("h264_amf", $"usage={variant}", fps, kbps, kib * 1024, 90, 40000);

    // As 7 linhas do bloco 720p60 do RESULT-AMF-USAGE.txt, na ordem em que foram impressas.
    private static readonly EncoderManager.EncodeProbeResult Default720 = Row("", 351.99, 12698.5, 2325);
    private static readonly EncoderManager.EncodeProbeResult Transcoding720 = Row("transcoding", 353.21, 12698.5, 2325);
    private static readonly EncoderManager.EncodeProbeResult Ultralow720 = Row("ultralowlatency", 373.53, 12898.2, 2361);
    private static readonly EncoderManager.EncodeProbeResult Lowlat720 = Row("lowlatency", 371.49, 12895.9, 2361);
    private static readonly EncoderManager.EncodeProbeResult Webcam720 = Row("webcam", 368.32, 12698.5, 2325);
    private static readonly EncoderManager.EncodeProbeResult HighQuality720 = Row("high_quality", 12.79, 13157.9, 2409);
    private static readonly EncoderManager.EncodeProbeResult LowlatHq720 = Row("lowlatency_high_quality", 308.21, 12663.2, 2318);

    private static readonly EncoderManager.EncodeProbeResult[] Todas720 =
    {
        Default720, Transcoding720, Ultralow720, Lowlat720, Webcam720, HighQuality720, LowlatHq720,
    };

    /// <summary>
    /// A trava do defeito: <c>ultralowlatency</c> é <b>maior</b> que a referência e as duas
    /// colunas precisam concordar nisso. Com o <c>Math.Max</c> acumulado, a coluna KiB
    /// devolvia "+0%" — a linha virava o próprio denominador e anulava o próprio aumento.
    /// </summary>
    [Fact]
    public void UsageMaiorQueOReference_NAoApareceComoZeroNaColunaKiB()
    {
        var linha = AmfUsageReport.FormatRow("ultralowlatency", Ultralow720, AmfUsageReport.Reference(Default720));

        // 2361 / 2325 - 1 = +1,55% -> +2%
        Assert.Equal("+2%", Delta(linha, "KiB"));
        // E as duas colunas não podem discordar entre si: kbps também é +2%.
        Assert.Equal("+2%", Delta(linha, "Kbps"));
    }

    /// <summary>
    /// O outro lado: <c>webcam</c> tem <b>exatamente</b> os bytes da referência (2325 KiB) e
    /// <c>lowlatency_high_quality</c> tem menos (2318 KiB). Com o denominador errado, o
    /// arquivo real imprimiu −2% e −4% — economia fantasma, que é o tipo de número que faria
    /// alguém promover um <c>-usage</c> que não economiza nada.
    ///
    /// <para><b>Por que os dois esperam "0%" e não "−1%":</b> a diferença real é de 0,3%, e o
    /// .NET usa a seção zero do formato <c>+0;-0;0</c> quando um valor negativo arredonda para
    /// zero — medido, não assumido. Isso é coerente com as outras duas colunas de delta (fps e
    /// kbps, ambas em 0 casas) e é a razão de a linha de leitura apontar o <b>Kbps</b>, que tem
    /// 1 casa, como coluna de tamanho. Sub-1% não é invisível no relatório inteiro; é
    /// invisível <b>naquela</b> coluna.</para>
    /// </summary>
    [Fact]
    public void UsageIgualOuMenorQueOReference_NAoApareceComoEconomiaFantasma()
    {
        var refBytes = AmfUsageReport.Reference(Default720).Bytes;

        Assert.Equal("0%", AmfUsageReport.ByteDeltaText(Webcam720.OutputBytes, refBytes));
        Assert.Equal("0%", AmfUsageReport.ByteDeltaText(LowlatHq720.OutputBytes, refBytes));
    }

    /// <summary>
    /// Regressão de tamanho tem que aparecer com sinal, nas duas direções. As duas linhas do
    /// arquivo real que são maiores que a referência: ultralowlatency (+2%) e high_quality
    /// (+4%). É a checagem que a coluna KiB original não conseguia fazer por construção,
    /// porque o denominador crescia junto com o numerador.
    /// </summary>
    [Theory]
    [InlineData("ultralowlatency", 2361, "+2%")]
    [InlineData("high_quality", 2409, "+4%")]
    [InlineData("", 2325, "0%")]
    [InlineData("lowlatency_high_quality", 2318, "0%")]
    public void DeltaDeBytes_SempreContraALinha1(string usage, int kib, string esperado)
    {
        var linha = AmfUsageReport.FormatRow(usage, Row(usage, 300, 12000, kib), AmfUsageReport.Reference(Default720));

        Assert.Equal(esperado, Delta(linha, "KiB"));
    }

    /// <summary>
    /// A ordem das linhas não pode mudar o resultado — é isso que o <c>Math.Max</c> acumulado
    /// quebrava. Percorrer as 7 linhas reais, fixando a referência na primeira, tem de dar o
    /// mesmo delta para o ultralowlatency do que medir a linha isolada.
    /// </summary>
    [Fact]
    public void DeltaDeBytes_NaoDependeDaOrdemDasLinhas()
    {
        AmfUsageReport.AmfUsageReference?andamento = null;
        foreach (var linha in Todas720) andamento = AmfUsageReport.Reference(linha, andamento);

        Assert.NotNull(andamento);
        var baseBytes = andamento.Bytes;
        Assert.Equal(Default720.OutputBytes, baseBytes);
        Assert.Equal("+2%", AmfUsageReport.ByteDeltaText(Ultralow720.OutputBytes, baseBytes));
        // A linha mais pesada do conjunto (2409 KiB) segue +4% contra a linha 1, e não 0%.
        Assert.Equal("+4%", AmfUsageReport.ByteDeltaText(HighQuality720.OutputBytes, baseBytes));
    }

    /// <summary>Referência ausente (nenhuma linha produziu bytes) não pode virar "0%": um
    /// delta sem base é desconhecido, e era publicado como empate.</summary>
    [Fact]
    public void SemReferencia_ODeltaDeBytesEDesconhecido()
    {
        Assert.Equal("-", AmfUsageReport.ByteDeltaText(Ultralow720.OutputBytes, baselineBytes: 0));
        Assert.Equal("-", AmfUsageReport.ByteDeltaText(0, baselineBytes: 0));
    }

    /// <summary>A referência é a <b>primeira linha medida</b> (o default), nunca a maior. E uma
    /// referência já fixada não é redefinida por uma linha maior posterior.</summary>
    [Fact]
    public void ReferenciaEAlwaysAPrimeiraLinhaMedida_NuncaOMaior()
    {
        var fixada = AmfUsageReport.Reference(Default720);

        Assert.Equal(Default720.OutputBytes, fixada.Bytes);
        Assert.Equal(Default720.OutputBytes, AmfUsageReport.Reference(HighQuality720, fixada).Bytes);
        // Default recusado (0 bytes): a próxima linha medida vira a referência.
        Assert.Equal(Ultralow720.OutputBytes, AmfUsageReport.Reference(Ultralow720, null).Bytes);
    }

    /// <summary>
    /// <c>EncoderManager.EncodeProbeResult.Variant</c> é <c>"usage=&lt;normalizado&gt;"</c>, e no default
    /// vira <c>"usage="</c> — sem nome nenhum. A linha da tabela precisa do rótulo legível
    /// ("(default, sem -usage)"), senão a 1ª linha da tabela não diz o que é, que é o bug de
    /// leitura que o <c>AmfUsageLabel</c> existe para impedir.
    /// </summary>
    [Fact]
    public void LinhaDaTabela_NomeiaODefaultExplicitamente()
    {
        var linha = AmfUsageReport.FormatRow("", Default720, AmfUsageReport.Reference(Default720));

        Assert.Contains("(default, sem -usage)", linha);
        Assert.DoesNotContain("usage= :", linha);
    }

    /// <summary>
    /// A coluna de headroom é o que diz ao usuário se o <c>-maxrate</c> estaba mandando. A
    /// versão anterior imprimia <c>VBV APERTA (-5000 K)</c> — negação dupla, onde o "5000"
    /// já é o excedente e o "-" do texto o transforma numa leitura ambígua. Aqui o número é o
    /// excedente, com a unidade falando.
    /// </summary>
    [Fact]
    public void Headroom_QuandoAVBVAperta_DizOExcedenteEmKbps()
    {
        // maxrate 40000, achieved 45000 -> headroom -5000 -> VbvBinds verdadeiro.
        var acima = new EncoderManager.EncodeProbeResult("h264_amf", "usage=", 300, 45000, 45000 * 1024 / 8, 90, 40000);
        var linha = AmfUsageReport.FormatRow("", acima, AmfUsageReport.Reference(Default720));

        Assert.Contains("VBV APERTA", linha);
        Assert.Contains("5000 K acima do teto", linha);
        // E a negação dupla não volta em nenhuma forma.
        Assert.DoesNotContain("-5000", linha);
    }

    /// <summary>Com folga, a coluna nomeia o teto como teto — é o número que o relatório do
    /// CQP usa para dizer que o VBV não estava mandando.</summary>
    [Fact]
    public void Headroom_ComFolga_DizAFolgaParaOTeto()
    {
        var linha = AmfUsageReport.FormatRow("", Default720, AmfUsageReport.Reference(Default720));

        Assert.Contains("folga p/ teto 27302 K", linha);
        Assert.DoesNotContain("VBV APERTA", linha);
    }

    /// <summary>Extrai o delta dentro dos parênteses de uma coluna ("Kbps (  +2%)" -> "+2%").
    /// O espaço de alinhamento é o que torna <c>Contains</c> frouxo demais aqui: "0%" casaria
    /// dentro de "+0%" e "-0%", e a distinção entre essas três é justamente o que o defeito
    /// apagava.</summary>
    private static string Delta(string linha, string coluna)
    {
        var i = linha.IndexOf(coluna, StringComparison.Ordinal);
        Assert.True(i >= 0, $"coluna '{coluna}' ausente em: {linha}");
        var abre = linha.IndexOf('(', i);
        var fecha = linha.IndexOf(')', abre);
        Assert.True(abre > 0 && fecha > abre, $"delta ausente em: {linha}");
        return linha.Substring(abre + 1, fecha - abre - 1).Trim();
    }
}
