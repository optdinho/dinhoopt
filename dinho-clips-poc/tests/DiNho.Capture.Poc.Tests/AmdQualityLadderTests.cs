using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// A escada do S2b (<c>o -quality tem autoridade?</c>) é a única seção do audit que varia o
/// <b>preset</b> com o <b>codec fixo</b>. O <see cref="AmdEncodeOutcome.Label"/>, porém, é
/// preenchido por <c>Encode</c> com o codec — e a tabela imprimia esse campo. O resultado
/// medido na RX 5700 XT saiu assim:
///
/// <code>
/// S2b: o -quality tem autoridade?
///   h264_amf    6.6 MiB   Works
///   h264_amf    6.6 MiB   Works
///   h264_amf    6.5 MiB   Works
///   h264_amf    6.5 MiB   Works
/// </code>
///
/// Quatro linhas com a coluna que deveria variar constante. Quem less não tem como saber
/// qual era <c>speed</c> e qual era <c>high_quality</c> — ou seja, a tabela não conseguia
/// responder a pergunta que a seção faz. Pior: a leituraIngênua "o preset não muda nada"
/// era a conclusão <b>errada</b>, e a diferença entre as duas respostas é exatamente o que o
/// S4 mede (o preset muda a <b>velocidade</b> em 1,8×, não os bytes).
///
/// <para><b>O que estes testes protegem.</b> O seam <c>BuildQualityLadder</c> existe para que a
/// carimbagem do preset seja verificável sem GPU. O teste central
/// (<c>CarimbaCadaRungComONomeDoPreset</c>) <b>cai se o <c>with { Label = ... }</c> for
/// removido</b> — que é a mutação exata que produz o relatório de cima. Um teste no
/// report writer <b>não</b> pegaria isso: com quatro labels iguais, imprimir quatro linhas
/// iguais é o comportamento correto da impressora, e o defeito está em como as linhas foram
/// construídas.</para>
/// </summary>
public class AmdQualityLadderTests
{
    /// <summary>Codec que o <c>Encode</c> carimba no <c>Label</c> — o valor "errado" que o
    /// seam tem que substituir. Numa máquina AMD o subject real é este.</summary>
    private const string CodecQueEncodeCarimba = "h264_amf";

    private static AmdEncodeOutcome EncodeFalso(string _ /* preset */, long bytes) =>
        new(CodecQueEncodeCarimba, true, true, bytes, 1.0, 120, "", 0);

    private static long BytesDoPreset(string preset) => preset switch
    {
        "speed" => 6_900_000,
        "balanced" => 6_800_000,
        "quality" => 6_700_000,
        "high_quality" => 6_600_000,
        _ => 1
    };

    /// <summary>Bytes <b>iguais</b> para os quatro presets — o que a RX 5700 XT realmente
    /// mediu (6,6 / 6,6 / 6,5 / 6,5 MiB) e a razão de o preset não ter autoridade sobre o
    /// tamanho. É o fixture fiel para os testes de relatório: com bytes iguais, a única coisa
    /// que distingue uma linha da outra é o rótulo, então um rótulo repetido produz quatro
    /// linhas idênticas — a forma exata do defeito. Um fake com bytes variando por preset
    /// esconderia o bug atrás de números diferentes.</summary>
    private static AmdEncodeOutcome EncodeFalsoBytesIguais(string _ /* preset */) =>
        new(CodecQueEncodeCarimba, true, true, 6_900_000, 1.0, 120, "", 0);

    // ------------------------------------------------- o carimbo (o teste que pega o bug)

    [Fact]
    public void CarimbaCadaRungComONomeDoPreset()
    {
        var ladder = AmdAudit.BuildQualityLadder(p => EncodeFalso(p, BytesDoPreset(p)));

        Assert.Equal(AmdAudit.QualityPresets, ladder.Select(r => r.Label));

        // A forma do defeito: quatro linhas, um único label repetido. Contar os distintos é
        // o que pega a regressão, porque `Assert.Equal(codec, r.Label)` passaria se o seam
        // devolvesse o codec para as quatro.
        Assert.Equal(AmdAudit.QualityPresets.Count, ladder.Select(r => r.Label).Distinct().Count());
        Assert.DoesNotContain(ladder, r => r.Label == CodecQueEncodeCarimba);
    }

    [Fact]
    public void ChamaOEncodeUmaVezPorPresetPassandoONomeCerto()
    {
        // A chain de cada rung é montada a partir do preset, então o delegate precisa receber
        // o nome — um seam que chamasse com o codec faria os quatro encodes saírem com a mesma
        // chain e ainda assim "passariam" no teste de labels.
        var pedidos = new List<string>();
        AmdAudit.BuildQualityLadder(p => { pedidos.Add(p); return EncodeFalso(p, 1); });

        Assert.Equal(AmdAudit.QualityPresets, pedidos);
    }

    [Fact]
    public void OWithDoCarimboNaoPerdeOsCamposMedidos()
    {
        // `with` num record struct copia tudo; esta trava existe porque um refactor futuro
        // que reconstruísse o record em vez de usar `with` perderia o estado — e o S2b
        // publicaria "não medido" com a linha ainda no relatório.
        var ladder = AmdAudit.BuildQualityLadder(p => EncodeFalso(p, BytesDoPreset(p)));

        foreach (var r in ladder)
        {
            var esperado = BytesDoPreset(r.Label);
            Assert.Equal(esperado, r.OutputBytes);
            Assert.True(r.Completed);
            Assert.Equal(120, r.Frames);
            Assert.Equal(0, r.ExitCode);
        }
    }

    [Fact]
    public void PresetsAceitaListaCustomizada()
    {
        // Usado para medir só um trecho da escada sem mexer no default.
        var ladder = AmdAudit.BuildQualityLadder(p => EncodeFalso(p, 1), new[] { "speed", "high_quality" });
        Assert.Equal(new[] { "speed", "high_quality" }, ladder.Select(r => r.Label));
    }

    [Fact]
    public void EscadaVaziaNaoInventaRung()
    {
        // Delegate que devolve a linha preenchida é o caso normal; um preset que falhou
        // continua sendo uma linha (é o que o veredito IGNORED/HONORED lê), mas a lista
        // precisa respeitar o que foi pedido.
        var ladder = AmdAudit.BuildQualityLadder(p => EncodeFalso(p, 0), Array.Empty<string>());
        Assert.Empty(ladder);
    }

    // ------------------------------------------------------ a lista default vem do binário

    [Fact]
    public void QualityPresets_OsQuatroNomesDoFfmpegNaOrdemDoHelp()
    {
        // `ffmpeg -h encoder=h264_amf` (9.0.1, binário embarcado) lista balanced, speed,
        // quality, high_quality. A ordem aqui é rápido → caro, que é a ordem em que a
        // escada deve ser lida. Os ÍNDICES são outro assunto (divergem por encoder) e não
        // entram aqui de propósito — ver AmfNumericIndexDivergenceTests.
        Assert.Equal(new[] { "speed", "balanced", "quality", "high_quality" }, AmdAudit.QualityPresets);
    }

    // ------------------------------------------------------------- e o relatorio imprime

    [Fact]
    public void RelatorioS2b_ImprimeOPresetDeCadaLinha()
    {
        // Fecha a cadeia: o seam carimba o preset E a impressora mostra o preset. Se alguém
        // voltar a imprimir o codec aqui, cai.
        var ladder = AmdAudit.BuildQualityLadder(EncodeFalsoBytesIguais);
        var texto = AmdAuditReportWriter.Format(RelatorioCom(ladder));

        var secao = Secao(texto, "S2b");
        foreach (var preset in AmdAudit.QualityPresets)
            Assert.Contains(preset, secao);
    }

    [Fact]
    public void RelatorioS2b_NaoRepeteOCodecQuatroVezes()
    {
        // A forma exata do defeito relatado. O fixture usa bytes IGUAIS nos quatro presets
        // (o que a máquina mediu), então a linha inteira é idêntica quando o rótulo volta a
        // ser o codec — e é por isso que a comparação é de linha inteira e não só de label.
        var ladder = AmdAudit.BuildQualityLadder(EncodeFalsoBytesIguais);
        var secao = Secao(AmdAuditReportWriter.Format(RelatorioCom(ladder)), "S2b");

        var linhas = secao.Split('\n').Select(l => l.Trim()).Where(l => l.Contains("MiB", StringComparison.Ordinal)).ToArray();
        Assert.Equal(AmdAudit.QualityPresets.Count, linhas.Length);
        Assert.Equal(linhas.Length, linhas.Distinct().Count());
    }

    private static string Secao(string texto, string titulo)
    {
        var linhas = texto.Split('\n');
        var inicio = Array.FindIndex(linhas, l => l.Contains(titulo, StringComparison.Ordinal));
        Assert.True(inicio >= 0, $"seção {titulo} não encontrada no relatório");
        var fim = inicio + 1;
        while (fim < linhas.Length && !linhas[fim].TrimStart().StartsWith("---", StringComparison.Ordinal)) fim++;
        return string.Join('\n', linhas.Skip(inicio).Take(fim - inicio));
    }

    /// <summary>Relatório mínimo com a escada de qualidade montada — o resto fica em
    /// <c>Unmeasured</c> de propósito, para o teste não dependa de nenhum outro veredito.</summary>
    private static AmdAuditReport RelatorioCom(IReadOnlyList<AmdEncodeOutcome> quality) =>
        new(
            "GPU: teste\nConfig auditada: 1920x1080@60, CQ 18, maxrate 55000K\n",
            Array.Empty<AmdEncodeOutcome>(), CodecQueEncodeCarimba,
            Array.Empty<AmdEncodeOutcome>(), AmdKnobState.Unmeasured,
            quality, AmdKnobState.Ignored,
            new AmdEncodeOutcome("producao", true, true, 5_518_522, 4.0, 120, ""),
            Array.Empty<AmdVmafPoint>(), Array.Empty<AmdVmafPoint>(),
            new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, 0.36, null, null, null, 0, 0),
            Array.Empty<AmdLadderPoint>(), "speed",
            new AmdLadderVerdict(AmdProbeState.Works, "speed", 222, 60, true, false),
            null, null,
            new AmdByteCostVerdict(0, false, "nao medido"),
            new AmdByteCostVerdict(0, false, "nao medido"),
            Array.Empty<string>());
}
