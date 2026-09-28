using System.Text.RegularExpressions;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Testes da transformação que monta a chain CQP a partir da chain AMF de produção, para o
/// <c>--probe-amf-cqp</c>.
///
/// <para><b>Por que uma transformação e não um parâmetro novo.</b> O A/B tem que mudar
/// <b>uma</b> coisa: o modo de rate control. Se eu adicionasse um parâmetro em
/// <c>BuildEncoderTuneArgs</c>, a função de produção da captura passaria a ter um ramo novo
/// que ninguém pediu, e o probe estaria medindo código de produção em vez de medir a
/// produção. Aqui a chain de produção é <b>gerada por ela</b> e depois reescrita — o mesmo
/// padrão de <c>TryFixAmfBitrate</c>, que troca o <c>-b:v</c> sem tocar em produção.
///
/// <para><b>O histórico que impede "simplificar" esta função.</b> O comentário da cadeia AMF
/// (<c>FfmpegEncoder.cs:321-325</c>) registra que <b>CQP puro já foi tentado em produção
/// nesta mesma RX 5700 XT e estourou ~180 Mbps</b>, com spill ~10x e clip de 94 s ≈ 930 MB.
/// Ou seja: "CQP na AMF é ruim" não é hipótese, é um número que alguém já pagou para medir.
/// <para>O que o <c>--probe-amf-cqp</c> testa é a outra pergunta, que nunca foi respondida:
/// <b>CQP <i>com o teto VBV</i></b> (o mesmo <c>-maxrate</c>/<c>-bufsize</c> que o front
/// manda) contra <c>vbr_peak</c> com alvo 0,36. Por isso esta transformação
/// <b>preserva o VBV e o AQ</b>: sem o teto, o probe só repetiria o estouro de 930 MB já
/// conhecido e o chamaria de "CQP não serve".</para>
/// </summary>
public class AmdCqpTuneTests
{
    /// <summary>Chain AMF de produção <b>real</b>, montada pela função que a captura usa.
    /// O CQ 18 / maxrate 55000 é o preset default do <c>AppConfig</c> e a configuração em que
    /// o <c>--audit-amd</c> foi rodado na RX 5700 XT.</summary>
    private static string ChainDeProducao(int cq = 18) =>
        FfmpegEncoder.BuildEncoderTuneArgs(
            "h264_amf", cq, 55_000, 110_000, 0, 0, "p4", amfPreset: "speed");

    // ------------------------------------------------ o que a transformação precisa encontrar

    /// <summary>
    /// Caracteriza a <b>entrada</b> da transformação. Sem este teste a função abaixo seria
    /// testada contra uma string que eu escrevi à mão — e a string real da produção pode não
    /// ter <c>-b:v</c> amanhã (por exemplo se a AMF migrar para QP), quando a transformação
    /// passaria a devolver <c>false</c> em produção e ninguém perceberia.
    ///
    /// <para>Também amarra o alvo 0,36: 55000 × 0,36 = 19800 K, o número que apareceu no
    /// audit real.</para>
    /// </summary>
    [Fact]
    public void ChainDeProducaoTemRcVbrPeakEBvDoFator036()
    {
        var tune = ChainDeProducao();

        Assert.Equal(19_800, FfmpegEncoder.ComputeAmfTargetKbps(55_000));
        Assert.Contains("-rc vbr_peak", tune);
        Assert.Contains("-b:v 19800K", tune);
        Assert.Contains("-maxrate 55000K", tune);
    }

    // ------------------------------------------------------------- o que a transformação faz

    /// <summary>Modo de RC precisa virar <b>cqp</b> — e ser o valor exato do <c>-rc</c>, não
    /// um prefixo dele: <c>cqp</c> é prefixo de nada aqui, mas a comparação por
    /// <c>Contains</c> é a mesma armadilha do <c>main10</c>/<c>main</c> (Item 9), então o
    /// teste extrai o valor e compara.</summary>
    [Fact]
    public void TransformaParaCqp_DefineRcCqp()
    {
        Assert.True(AmdAudit.TryMakeAmfCqpTune(ChainDeProducao(), 18, out var tune));

        var partes = tune.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var i = Array.IndexOf(partes, "-rc");
        Assert.True(i >= 0, "o -rc sumiu da chain");
        Assert.Equal("cqp", partes[i + 1]);
    }

    /// <summary>
    /// O <c>-b:v</c> tem que <b>sumir</b>, não virar 0. Deixar o alvo de bitrate junto de
    /// <c>-rc cqp</c> é a combinação ambígua que o próprio Item 8 encontrou no editor: no
    /// NVENC o <c>-b:v 0</c> é obrigatório para o CQP colar, mas na AMF manter um alvo de
    /// taxa é o que faz o QP ser sobreposto pelo alvo (issue obs-ffmpeg #12994, citada na
    /// chain de produção). O probe compara <b>taxa contra QP</b>, então os dois não podem
    /// mandar ao mesmo tempo.
    /// </summary>
    [Fact]
    public void TransformaParaCqp_RemoveOBvEEscreveQpI_QpP()
    {
        Assert.True(AmdAudit.TryMakeAmfCqpTune(ChainDeProducao(), 18, out var tune));

        var partes = tune.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        Assert.DoesNotContain("-b:v", partes);
        Assert.Equal("18", partes[Array.IndexOf(partes, "-qp_i") + 1]);
        Assert.Equal("18", partes[Array.IndexOf(partes, "-qp_p") + 1]);
    }

    /// <summary>O QP do probe tem que ser o QP que o probe recebeu, não o da chain original —
    /// o A/B varre o QP, e um QP travado no <c>cq</c> da config transformaria a varredura em
    /// três encodes idênticos.</summary>
    [Fact]
    public void TransformaParaCqp_UsaOCqQueFoiPassado()
    {
        Assert.True(AmdAudit.TryMakeAmfCqpTune(ChainDeProducao(), 24, out var tune));

        var partes = tune.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("24", partes[Array.IndexOf(partes, "-qp_i") + 1]);
        Assert.Equal("24", partes[Array.IndexOf(partes, "-qp_p") + 1]);
    }

    /// <summary>
    /// <b>O teto VBV e o AQ sobrevivem.</b> É o que separa este probe da repetição do estouro
    /// de 930 MB já documentado, e é o que mantém a variável isolada: as duas pontas do A/B
    /// têm o mesmo teto e o mesmo AQ, e só o RC muda.
    /// </summary>
    [Fact]
    public void TransformaParaCqp_PreservaTetoVbvQualidadeEAq()
    {
        Assert.True(AmdAudit.TryMakeAmfCqpTune(ChainDeProducao(), 18, out var tune));

        Assert.Contains("-maxrate 55000K", tune);
        Assert.Contains("-bufsize 110000K", tune);
        Assert.Contains("-quality speed", tune);
        Assert.Contains("-vbaq true", tune);
        Assert.Contains("-me_quarter_pel true", tune);
        Assert.Contains("-g 60", tune);
        Assert.Contains("-bf 0", tune);
    }

    /// <summary>Nenhum resíduo de <c>vbr_peak</c>: se sobrasse um <c>-rc</c> antigo em
    /// qualquer lugar, a medição seria CQP na descrição e vbr_peak na execução — que é
    /// exatamente a classe de mentira que o projeto já pagou 4 vezes
    /// (<c>main10</c>, <c>-rc vbr_peak</c>, <c>libsvtav1</c>, escada NVENC morta).</summary>
    [Fact]
    public void TransformaParaCqp_NaoDeixaResiduoDeVbrPeak()
    {
        Assert.True(AmdAudit.TryMakeAmfCqpTune(ChainDeProducao(), 18, out var tune));

        Assert.DoesNotContain("vbr_peak", tune);
        Assert.DoesNotContain("vbr_latency", tune);
    }

    /// <summary>Um único par <c>-qp_i</c>/<c>-qp_p</c>: duplicar faria o ffmpeg usar o
    /// último, e o relatório mostraria dois QP diferentes do que rodou.</summary>
    [Fact]
    public void TransformaParaCqp_EscreveQpUmaVezSo()
    {
        Assert.True(AmdAudit.TryMakeAmfCqpTune(ChainDeProducao(), 18, out var tune));

        Assert.Single(Regex.Matches(tune, "-qp_i "));
        Assert.Single(Regex.Matches(tune, "-qp_p "));
    }

    // ------------------------------------------------------------ quando não dá para transformar

    /// <summary>Chain sem <c>-b:v</c> (o x264 recebe <c>-crf</c>) não tem taxa para trocar
    /// por QP. Devolver a string <b>intacta com <c>true</c></c> mediria a mesma chain dos
    /// dois lados e o relatório anunciaria um A/B que não aconteceu — por isso
    /// <c>false</c>.</summary>
    [Fact]
    public void ChainSemBv_NaoPromoveCqp()
    {
        var x264 = "-crf 20 -preset veryfast -g 60";

        Assert.False(AmdAudit.TryMakeAmfCqpTune(x264, 18, out var patched));
        Assert.Equal(x264, patched);
    }

    /// <summary>Sem <c>-rc</c> não há como declarar o modo CQP: acrescentar um <c>-rc cqp</c>
    /// novo mudaria mais de uma coisa do A/B.</summary>
    [Fact]
    public void ChainSemRc_NaoPromoveCqp()
    {
        var semRc = "-quality speed -b:v 19800K -maxrate 55000K";

        Assert.False(AmdAudit.TryMakeAmfCqpTune(semRc, 18, out var patched));
        Assert.Equal(semRc, patched);
    }

    /// <summary>Flags truncadas não são convertidas. O runner do audit já endosso esse
    /// cuidado: ele monta a própria linha de comando, e um <c>-b:v</c> sem valor no fim da
    /// string faria o ffmpeg engolir o nome do arquivo de saída como taxa.</summary>
    [Theory]
    [InlineData("-rc vbr_peak -b:v", "b:v sem valor")]
    [InlineData("-rc", "rc sem valor")]
    [InlineData("-b:v 19800K", "sem rc")]
    public void ChainTruncada_NaoPromoveCqp(string tune, string _)
    {
        Assert.False(AmdAudit.TryMakeAmfCqpTune(tune, 18, out var patched));
        Assert.Equal(tune, patched);
    }

    /// <summary>String vazia também não vira CQP.</summary>
    [Fact]
    public void ChainVazia_NaoPromoveCqp()
    {
        Assert.False(AmdAudit.TryMakeAmfCqpTune("", 18, out var patched));
        Assert.Equal("", patched);
    }
}
