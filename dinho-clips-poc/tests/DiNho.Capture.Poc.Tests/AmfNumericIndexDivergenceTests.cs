using System.Text.RegularExpressions;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Os três encoders AMF (<c>h264_amf</c>, <c>hevc_amf</c>, <c>av1_amf</c>) aceitam os
/// <b>mesmos NOMES</b> de preset de qualidade e de rate control — mas os <b>ÍNDICES
/// numéricos</b> que o ffmpeg esconde atrás desses nomes são <b>diferentes em cada
/// encoder</b>.
///
/// <para><b>Medido no binário embarcado real</b> (ffmpeg 9.0.2,
/// <c>ffmpeg -h full</c>, sem precisar de GPU AMD). O comando importa: <c>-h encoder=&lt;codec&gt;</c>
/// <b>não</b> serve aqui — ele só resume a opção como <c>-quality &lt;int&gt; (from -1 to 3)</c>, sem os
/// nomes nem os números. Quem rodou o comando errado via "nenhuma lista" e não "divergência".
/// <code>
/// -quality  h264_amf: balanced=0 speed=1    quality=2 high_quality=3
///           hevc_amf: quality=0  balanced=5  speed=10 high_quality=15
///           av1_amf:  high_quality=0 quality=30 balanced=70 speed=100
/// -rc       h264_amf: cqp=0 cbr=1 vbr_peak=2 vbr_latency=3 qvbr=4 hqvbr=5 hqcbr=6
///           hevc_amf: cqp=0 cbr=3 vbr_peak=2 vbr_latency=1 qvbr=4 hqvbr=5 hqcbr=6
///           av1_amf:  cqp=0     cbr=3 vbr_peak=2 vbr_latency=1 qvbr=4 hqvbr=5 hqcbr=6
/// -usage    h264_amf: transcoding=0 ultralowlatency=1 lowlatency=2 webcam=3 ...
///           hevc_amf: transcoding=0 ultralowlatency=1 lowlatency=2 webcam=3 ...
///           av1_amf:  transcoding=0 ultralowlatency=2 lowlatency=1 webcam=3 ...  &lt;-- TROCA
/// </code></para>
///
/// <para><b>Por que isto precisa de trava.</b> É a <b>mesma armadilha do <c>-rc 1</c> do
/// D3D12VA</b> (Item 8), agora medida dentro da família que a captura realmente usa. O
/// índice numérico <b>não é validado</b> pelo ffmpeg (o nvenc aceitou <c>-rc 999</c> em
/// silêncio): ele satura, e a chain segue <i>válida</i> encodeando com o <b>rate control
/// errado</b>. Pior, no <c>-quality</c> a troca seria cata TROFIA e não quase: <c>speed</c>
/// é 1 no h264, <b>10</b> no hevc e <b>100</b> no av1. Um atalho numérico compartilhado
/// entre os três trocaria o preset de todos ao mesmo tempo — e como o S2b do audit mediu
/// que o preset <b>não muda os bytes</b> (só a velocidade, 1,8× entre <c>high_quality</c> e
/// <c>speed</c>), a captura continuaria produzindo arquivo normal e <b>ninguém veria</b> o
/// erro, só uma GPU mais lenta.
///
/// <para><b>O que a trava garante.</b> Que a chain AMF emita <b>sempre o nome</b>, nunca o
/// número. O nome é validado pelo ffmpeg: um nome que sumiu da tabela derruba o encoder com
/// <c>Unrecognized option</c>, visível, no primeiro frame. O número não tem essa
/// propriedade. Esta é a mesma razão pela qual o <c>NormalizeAmfUsage</c> existe.</para>
///
/// <para><b>Os testes de caracterização</b> (<c>IndicesDivergem_*</c>) são <b>verdes de
/// propósito</b>: não falham porque mediram algo errado, existem para que a tabela medida
/// não seja "corrigida" por alguém que ache o número mais bonito sem saber o que ele
/// significa. Mesmo padrão de <c>BframeReorderConstraintTests</c>: Characterização é trava,
/// não teste de comportamento.</para>
/// </summary>
public class AmfNumericIndexDivergenceTests
{
    private static readonly string[] AmfCodecs = { "h264_amf", "hevc_amf", "av1_amf" };

    /// <summary>Os 4 nomes que os três AMF aceitam em <c>-quality</c> (a allowlist do
    /// <c>NormalizeAmfPreset</c>).</summary>
    private static readonly string[] Presets = { "high_quality", "quality", "balanced", "speed" };

    /// <summary>Os 6 nomes de <c>-usage</c> do ffmpeg 9, medidos no mesmo binário.</summary>
    private static readonly string[] Usages =
    {
        "transcoding", "ultralowlatency", "lowlatency", "webcam", "high_quality", "lowlatency_high_quality"
    };

    /// <summary>Nome → índice, <b>como o binário embarcado respondeu</b>. Fonte única desta
    /// classe: os testes de chain e os de caracterização leem daqui, então corrigir a tabela
    /// errado quebra o teste em vez de passar calado.</summary>
    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, int>> QualityIndex =
        new Dictionary<string, IReadOnlyDictionary<string, int>>
        {
            ["h264_amf"] = new Dictionary<string, int> { ["balanced"] = 0, ["speed"] = 1, ["quality"] = 2, ["high_quality"] = 3 },
            ["hevc_amf"] = new Dictionary<string, int> { ["quality"] = 0, ["balanced"] = 5, ["speed"] = 10, ["high_quality"] = 15 },
            ["av1_amf"] = new Dictionary<string, int> { ["high_quality"] = 0, ["quality"] = 30, ["balanced"] = 70, ["speed"] = 100 },
        };

    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, int>> RcIndex =
        new Dictionary<string, IReadOnlyDictionary<string, int>>
        {
            ["h264_amf"] = new Dictionary<string, int>
            {
                ["cqp"] = 0, ["cbr"] = 1, ["vbr_peak"] = 2, ["vbr_latency"] = 3,
                ["qvbr"] = 4, ["hqvbr"] = 5, ["hqcbr"] = 6
            },
            ["hevc_amf"] = new Dictionary<string, int>
            {
                ["cqp"] = 0, ["vbr_latency"] = 1, ["vbr_peak"] = 2, ["cbr"] = 3,
                ["qvbr"] = 4, ["hqvbr"] = 5, ["hqcbr"] = 6
            },
            ["av1_amf"] = new Dictionary<string, int>
            {
                ["cqp"] = 0, ["vbr_latency"] = 1, ["vbr_peak"] = 2, ["cbr"] = 3,
                ["qvbr"] = 4, ["hqvbr"] = 5, ["hqcbr"] = 6
            },
        };

    /// <summary><c>-usage</c> também diverge, e em <c>av1_amf</c> a divergência é uma
    /// <b>troca</b>: <c>ultralowlatency</c> e <c>lowlatency</c> trocam de índice. Medido no
    /// mesmo binário (ffmpeg 9.0.2, <c>-h full</c>). Sem esta tabela a classe se chamaria
    /// "divergência numérica" documentando só <c>-quality</c> e <c>-rc</c>, que é exatamente
    /// o tipo de lacuna que faz alguém "otimizar" nome por índice achando que é uniforme.</summary>
    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, int>> UsageIndex =
        new Dictionary<string, IReadOnlyDictionary<string, int>>
        {
            ["h264_amf"] = new Dictionary<string, int>
            {
                ["transcoding"] = 0, ["ultralowlatency"] = 1, ["lowlatency"] = 2,
                ["webcam"] = 3, ["high_quality"] = 4, ["lowlatency_high_quality"] = 5
            },
            ["hevc_amf"] = new Dictionary<string, int>
            {
                ["transcoding"] = 0, ["ultralowlatency"] = 1, ["lowlatency"] = 2,
                ["webcam"] = 3, ["high_quality"] = 4, ["lowlatency_high_quality"] = 5
            },
            ["av1_amf"] = new Dictionary<string, int>
            {
                ["transcoding"] = 0, ["ultralowlatency"] = 2, ["lowlatency"] = 1,
                ["webcam"] = 3, ["high_quality"] = 4, ["lowlatency_high_quality"] = 5
            },
        };

    private static string Chain(string codec, string preset = "speed", string usage = "") =>
        FfmpegEncoder.BuildEncoderTuneArgs(
            codec, 18, 55_000, 110_000, 0, 0, "p4", amfPreset: preset, amfUsage: usage);

    /// <summary>Extrai o valor que segue uma opção. O lookbehind impede que <c>-rc</c> case
    /// com <c>-rc-lookahead</c> (que existe nas chains NVENC) e que <c>-quality</c> case
    /// dentro de outro nome — sem ele o teste passaria por acidente se a chain ganhasse uma
    /// opção nova com prefixo igual.</summary>
    private static string? OptValue(string chain, string opt)
    {
        var m = Regex.Match(chain, $@"(?<![\w-])-{Regex.Escape(opt)}\s+(\S+)");
        return m.Success ? m.Groups[1].Value : null;
    }

    // ----------------------------------------------------------------- a regra

    [Fact]
    public void OsTresAmfAceitamOsMesmosNomesDePreset()
    {
        var conjuntos = AmfCodecs.Select(c => QualityIndex[c].Keys.OrderBy(x => x, StringComparer.Ordinal).ToArray()).ToArray();
        for (var i = 1; i < conjuntos.Length; i++)
            Assert.Equal(conjuntos[0], conjuntos[i]);
        Assert.Equal(Presets.OrderBy(x => x, StringComparer.Ordinal), conjuntos[0]);
    }

    [Theory]
    [InlineData("high_quality")]
    [InlineData("quality")]
    [InlineData("balanced")]
    [InlineData("speed")]
    [InlineData("  SPEED  ")]
    public void NormalizeAmfPreset_DevolveNomeQueTodosOsAmfAceitam(string preset)
    {
        var norm = FfmpegEncoder.NormalizeAmfPreset(preset);
        foreach (var codec in AmfCodecs)
            Assert.True(QualityIndex[codec].ContainsKey(norm), $"{codec} não aceita o preset '{norm}'");
    }

    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    public void Chain_NuncaEmitePresetNumerico(string codec)
    {
        foreach (var preset in Presets)
        {
            var v = OptValue(Chain(codec, preset), "quality");
            Assert.NotNull(v);
            // A asserção que importa: o valor NÃO é um inteiro, porque se fosse o ffmpeg
            // aceitaria em silêncio e a GPU escolheria outro preset sem nenhum sinal.
            Assert.False(int.TryParse(v, out _), $"{codec} emitiu -quality {v} (índice numérico) em vez do nome");
            Assert.Contains(v!, QualityIndex[codec].Keys);
        }
    }

    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    public void Chain_NuncaEmiteUsageNumerico(string codec)
    {
        // Mesma armadilha de `-quality` e `-rc`, no campo que o Item 3 introduziu: o `-usage`
        // também é `<int>` e o índice NÃO é validado. E aqui a divergência é pior que "índice
        // diferente": em av1_amf `ultralowlatency` e `lowlatency` TROCAM de índice, então um
        // atalho numérico compartilhado entregaria o modo de uso oposto ao pedido — sem erro,
        // sem warning, só um encoder mais lento. Nada na suíte cobria o `-usage` por nome.
        foreach (var usage in Usages)
        {
            var v = OptValue(Chain(codec, usage: usage), "usage");
            Assert.NotNull(v);
            Assert.False(int.TryParse(v, out _), $"{codec} com usage '{usage}' emitiu -usage {v} (índice numérico) em vez do nome");
            Assert.Contains(v!, UsageIndex[codec].Keys);
        }
    }

    /// <summary>Caracterização: a troca <c>ultralowlatency</c>/<c>lowlatency</c> do
    /// <c>av1_amf</c> é medida, não deduzida. Existe para a tabela <c>UsageIndex</c> não ser
    /// "corrigida" para uniforme por quem supõe que a família AMF é homogênea — a suíte
    /// inteira do projeto depende dessa suposição estar errada.</summary>
    [Fact]
    public void Av1Amf_TrocaOsIndicesDeUltralowlatencyELowlatency()
    {
        Assert.Equal(1, UsageIndex["h264_amf"]["ultralowlatency"]);
        Assert.Equal(2, UsageIndex["h264_amf"]["lowlatency"]);
        Assert.Equal(1, UsageIndex["hevc_amf"]["ultralowlatency"]);
        Assert.Equal(2, UsageIndex["hevc_amf"]["lowlatency"]);
        // av1_amf inverte: é o único ponto da tabela onde um nome tem índice MENOR que o vizinho.
        Assert.Equal(2, UsageIndex["av1_amf"]["ultralowlatency"]);
        Assert.Equal(1, UsageIndex["av1_amf"]["lowlatency"]);
    }

    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    public void Chain_NuncaEmiteRcNumerico(string codec)
    {
        // Cobre o default e cada `-usage` possível, porque `NormalizeAmfRc` deriva o modo de
        // rate control do usage: um valor numérico escaparia por esse ramo, não pelo default.
        foreach (var usage in new[] { "" }.Concat(Usages))
        {
            var v = OptValue(Chain(codec, usage: usage), "rc");
            Assert.NotNull(v);
            Assert.False(int.TryParse(v, out _), $"{codec} com usage '{usage}' emitiu -rc {v} (índice numérico) em vez do nome");
            Assert.Contains(v!, RcIndex[codec].Keys);
        }
    }

    [Theory]
    [InlineData("ultralowlatency", "vbr_latency")]
    [InlineData("lowlatency", "vbr_latency")]
    [InlineData("transcoding", "vbr_peak")]
    [InlineData("", "vbr_peak")]
    public void NormalizeAmfRc_DevolveNomeQueTodosOsAmfAceitam(string usage, string expectedRc)
    {
        var rc = FfmpegEncoder.NormalizeAmfRc(usage);
        Assert.Equal(expectedRc, rc);
        foreach (var codec in AmfCodecs)
            Assert.True(RcIndex[codec].ContainsKey(rc), $"{codec} não aceita o modo '{rc}'");
    }

    /// <summary>O caminho do probe: <c>--probe-amf-cqp</c> reescreve a chain trocando
    /// <c>-rc vbr_peak -b:v N</c> por <c>-rc cqp -qp_i/-qp_p</c>. É a transformação que vai
    /// rodar em <c>hevc_amf</c> na próxima sessão, e ela precisa emitir o <b>nome</b>
    /// <c>cqp</c> — o único valor de rate control cujo índice é estável nos três (medido).</summary>
    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    public void TryMakeAmfCqpTune_EmiteCqpPorNomeNosTresAmf(string codec)
    {
        var prod = Chain(codec);
        Assert.Equal("vbr_peak", OptValue(prod, "rc"));   // a entrada que a transformação exige
        Assert.NotNull(OptValue(prod, "b:v"));

        Assert.True(AmdAudit.TryMakeAmfCqpTune(prod, 31, out var cqp));
        Assert.Equal("cqp", OptValue(cqp, "rc"));
        Assert.Equal("31", OptValue(cqp, "qp_i"));
        Assert.Equal("31", OptValue(cqp, "qp_p"));
        // O -b:v tem que sumir: sob `cqp` ele é descartado em silêncio (issue obs-ffmpeg
        // #12994) e o relatório imprimiria um "teto" que não existe.
        Assert.Null(OptValue(cqp, "b:v"));
        // O teto VBV permanece, senão o probe mediria o estouro de ~180 Mbps já pago.
        Assert.Equal("55000K", OptValue(cqp, "maxrate"));
    }

    /// <summary>A faixa de QP da AMF medida no binário: <c>-qp_i</c>/<c>-qp_p</c> aceitam
    /// <b>−1..51</b> nos três encoders, e <b>−1 é o sentinel de "não definido"</b> (é o
    /// default das duas opções). Ou seja a faixa que <i>significa</i> algo é 0..51 — e é
    /// exatamente o clamp do probe, que existe para a escada automática não saturar em
    /// silêncio.</summary>
    [Fact]
    public void AFaixaDeQpDaAmfCobreOClampDoProbe()
    {
        // Medido: "(from -1 to 51)" em qp_i e qp_p de h264_amf, hevc_amf e av1_amf, com
        // "(default -1)" — o -1 é "deixe por conta do encoder", não um QP.
        const int sentinel = -1, ffmpegMax = 51;

        Assert.True(AmdCqpProbe.MinQp > sentinel,
            $"o clamp começa em {AmdCqpProbe.MinQp}, dentro do sentinel {sentinel}: -qp_i -1 não é um QP, é 'não definir'");
        Assert.True(AmdCqpProbe.MaxQp <= ffmpegMax,
            $"o clamp vai até {AmdCqpProbe.MaxQp} e o ffmpeg recusa acima de {ffmpegMax} (out of range [-1 - 51])");
    }

    // --------------------------------------- caracterização da divergência (verdes de propósito)

    [Fact]
    public void Caracterizacao_IndicesDeQualityDivergemNosTresAmf()
    {
        // `speed`: 1 no h264, 10 no hevc, 100 no av1. Uma linha de "simplificação" trocando
        // o nome pelo número_INDEX comum não teria valor nenhum aqui — não existe.
        Assert.Equal(1, QualityIndex["h264_amf"]["speed"]);
        Assert.Equal(10, QualityIndex["hevc_amf"]["speed"]);
        Assert.Equal(100, QualityIndex["av1_amf"]["speed"]);

        // E `quality` tem ordem invertida: 2 no h264, 0 no hevc, 30 no av1.
        Assert.Equal(2, QualityIndex["h264_amf"]["quality"]);
        Assert.Equal(0, QualityIndex["hevc_amf"]["quality"]);
        Assert.Equal(30, QualityIndex["av1_amf"]["quality"]);

        // Só o h264 usa 0 para `balanced`; nos outros dois `quality` é que é 0.
        Assert.Equal(0, QualityIndex["h264_amf"]["balanced"]);
        Assert.Equal(5, QualityIndex["hevc_amf"]["balanced"]);
        Assert.Equal(70, QualityIndex["av1_amf"]["balanced"]);
    }

    [Fact]
    public void Caracterizacao_CbrEVbrLatencyTrocamDeIndiceNoH264()
    {
        // A divergência que MORDERIA o código: `NormalizeAmfRc` pode emitir `vbr_latency`, e
        // ele é 3 no h264_amf mas 1 no hevc/av1 — justamente o índice do `cbr` no h264.
        // Um atalho numérico entregaria CBR no h264 (taxa constante, arquivo variando) e
        // vbr_latency certo nos outros dois, sem erro em nenhum.
        Assert.Equal(3, RcIndex["h264_amf"]["vbr_latency"]);
        Assert.Equal(1, RcIndex["hevc_amf"]["vbr_latency"]);
        Assert.Equal(1, RcIndex["av1_amf"]["vbr_latency"]);

        Assert.Equal(1, RcIndex["h264_amf"]["cbr"]);
        Assert.Equal(3, RcIndex["hevc_amf"]["cbr"]);
        Assert.Equal(3, RcIndex["av1_amf"]["cbr"]);
    }

    [Fact]
    public void Caracterizacao_SoCqpEVbrPeakTêmIndiceEstavel()
    {
        // Os dois que o código usa (`vbr_peak` em produção, `cqp` no probe) são os únicos com
        // índice igual nos três. Ainda assim a chain emite o NOME, e é o que este arquivo
        // trava: `vbr_latency` — também alcançável pelo `-usage` — não é estável, então
        // "os dois que uso são estáveis" nunca vira "o índice serve".
        foreach (var nome in new[] { "cqp", "vbr_peak" })
        {
            var indices = AmfCodecs.Select(c => RcIndex[c][nome]).Distinct().ToArray();
            Assert.True(indices.Length == 1, $"{nome} tem índice divergente: {string.Join("/", indices)}");
        }
        Assert.Equal(0, RcIndex["h264_amf"]["cqp"]);
        Assert.Equal(2, RcIndex["h264_amf"]["vbr_peak"]);
    }

    [Fact]
    public void Caracterizacao_IndicesDeQualityNaoSaoUnicos_Consequencia()
    {
        // A consequência em uma asserção: para NENHUM preset o índice é o mesmo nos três.
        // Se alguém reintroduzir um caminho numérico, esta é a linha que documenta por quê
        // não pode existir.
        foreach (var preset in Presets)
        {
            var indices = AmfCodecs.Select(c => QualityIndex[c][preset]).Distinct().ToArray();
            Assert.True(indices.Length > 1,
                $"'{preset}' tem índice {indices[0]} igual nos três AMF — se algum dia for verdade, " +
                "a tabelamedida está desatualizada e a razão para emitir nome precisa ser reavaliada");
        }
    }
}
