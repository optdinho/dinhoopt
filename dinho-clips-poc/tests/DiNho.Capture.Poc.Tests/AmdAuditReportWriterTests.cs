using System.Globalization;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// O formatador é a última etapa entre o número e a decisão do usuário. Se ele imprime
/// "0 KB" onde não mediu, ou um veredito onde o encoder recusou, o audit vira exatamente a
/// ferramenta enganosa que ele existe para evitar — e o dano é maior que um crash, porque
/// ninguém percebe um relatório bonito demais.
///
/// <para>Estes testes não verificam o texto inteiro (isso trava em refactor sem valor). Eles
/// verificam a <b>garantia</b>: para cada estado que significa "não medido", o relatório
/// precisa dizer isso e não pode apresentar número.</para>
/// </summary>
[Collection("FfmpegCodecCache")]
public class AmdAuditReportWriterTests
{
private static AmdAuditReport Report(
    IReadOnlyList<AmdEncodeOutcome>? matrix = null,
    AmdCalibrationVerdict? calibration = null,
    IReadOnlyList<AmdVmafPoint>? amfCurve = null,
    IReadOnlyList<AmdLadderPoint>? ladder = null,
    AmdLadderVerdict? ladderVerdict = null,
    IReadOnlyList<AmdEncodeOutcome>? bitrate = null,
    AmdKnobState? bitrateVerdict = null)
{
    var empty = Array.Empty<AmdEncodeOutcome>();
    var emptyVmaf = Array.Empty<AmdVmafPoint>();
    return new AmdAuditReport(
    "GPU: teste\nConfig auditada: 1280x720@60, CQ 20, maxrate 30000K\n",
    matrix ?? empty, "h264_amf",
    bitrate ?? empty, bitrateVerdict ?? AmdKnobState.Unmeasured,
    empty, AmdKnobState.Unmeasured,
    new AmdEncodeOutcome("producao", true, false, 0, 0, 0, "falhou"),
            amfCurve ?? emptyVmaf, emptyVmaf,
            calibration ?? new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, 0.36, null, null, null, 0, 0),
            ladder ?? Array.Empty<AmdLadderPoint>(), "quality",
            ladderVerdict ?? new AmdLadderVerdict(AmdProbeState.Works, "quality", 52, 60, true, false),
            null, null,
            new AmdByteCostVerdict(0, false, "nao medido"),
            new AmdByteCostVerdict(0, false, "nao medido"),
            Array.Empty<string>());
    }

    [Fact]
    public void EncoderRecusado_NaoApareceComTamanhoNemFps()
    {
        // Completed=true + ExitCode!=0 = o encoder recusou (o probe rodou). Completed=false
        // seria timeout, que é Unmeasured - fixture errada aqui hidria exatamente a
        // distinção que o enum existe para fazer.
        var text = AmdAuditReportWriter.Format(Report(
            matrix: new[] { new AmdEncodeOutcome("h264_amf", true, true, 0, 0.4, 120, "no such device", 69) }));

        var line = text.Split('\n').First(l => l.Contains("h264_amf"));
        Assert.DoesNotContain("MB", line);
        Assert.DoesNotContain("fps", line);
        Assert.Contains("REFUSED", line);
        Assert.Contains("no such device", line);
    }

    [Fact]
    public void ProbeQueNaoConcluiu_DizUnmeasured_NuncaRefused()
    {
        var text = AmdAuditReportWriter.Format(Report(
            matrix: new[] { new AmdEncodeOutcome("h264_amf", true, false, 0, 0, 0, "timeout") }));

        var line = text.Split('\n').First(l => l.Contains("h264_amf"));
        Assert.Contains("UNMEASURED", line);
        Assert.DoesNotContain("REFUSED", line);
    }

    [Fact]
    public void EncoderAusente_ApareceComoNotPresent_SemDetalheDeErro()
    {
        var text = AmdAuditReportWriter.Format(Report(
            matrix: new[] { new AmdEncodeOutcome("av1_amf", false, true, 0, 0, 0, "") }));

        var line = text.Split('\n').First(l => l.Contains("av1_amf"));
        Assert.Contains("NOT PRESENT", line);
        Assert.DoesNotContain("MB", line);
    }

    [Fact]
    public void NenhumHardwareFuncionando_AnunciaOFallbackEmVezDeNumero()
    {
        var text = AmdAuditReportWriter.Format(Report(
            matrix: new[] { new AmdEncodeOutcome("libx264", true, true, 4_000_000, 0.5, 120, "") }));

        Assert.Contains("nenhum encoder de hardware", text);
        Assert.Contains("fallback de software", text);
    }

    /// <summary>
    /// <b>Regressão do bug que o dump do relatório expôs.</b> O relatório recebia o codec
    /// escolhido num campo e imprimia "a detecção escolheria X" sem olhar a matriz. Com o
    /// campo preenchido e zero encoder funcionando, ele anunciava um codec que acabara de
    /// recusar — invertendo o aviso mais importante do audit.
    ///
    /// <para>A trava é explícita: mesmo com <c>chosen</c> setado, sem nenhum
    /// <c>WORKS</c> de hardware, a linha do "escolheria" não pode existir.</para>
    /// </summary>
    [Fact]
    public void CodecEscolhidoMasNadaFuncionou_NuncaAnunciaQueEleSeraUsado()
    {
        var text = AmdAuditReportWriter.Format(Report(
            matrix: new[]
            {
                new AmdEncodeOutcome("h264_amf", true, true, 0, 0.4, 120, "no such device", 69),
                new AmdEncodeOutcome("av1_amf", true, true, 0, 0.2, 120, "no such device", 69),
            }));

        // Asserção no BLOCO S1, não no documento inteiro: "escolheria" também existe na S4
        // ("Escada escolheria: ..."), e um DoesNotContain global falha por motivo errado —
        // a mesma armadilha do Contains("main") que passa com "main10" presente.
        var s1 = text.Split("S2a:")[0];
        Assert.DoesNotContain("escolheria", s1);
        Assert.Contains("fallback de software", s1);
    }

    [Fact]
    public void CodecEscolhidoQueFalhou_ApontaParaAFuncaoEmVezDeAnunciarEle()
    {
        var text = AmdAuditReportWriter.Format(Report(
            matrix: new[]
            {
                new AmdEncodeOutcome("h264_nvenc", true, true, 4_000_000, 0.5, 120, "", 0),
                new AmdEncodeOutcome("h264_amf", true, false, 0, 0.4, 0, "no such device", 69),
            }));

        Assert.Contains("ATENCAO", text);
        Assert.Contains("NAO produziu arquivo", text);
        Assert.Contains("h264_nvenc", text);
    }

    [Fact]
    public void SoftwareFuncionandoNaoContaComoHardwareSaudavel()
    {
        // libx264 rodando é o fallback esperado em máquina sem encoder; não pode impedir
        // o relatório de dizer que nenhum hardware funcionou.
        var text = AmdAuditReportWriter.Format(Report(
            matrix: new[]
            {
                new AmdEncodeOutcome("libx264", true, true, 4_000_000, 0.5, 120, "", 0),
                new AmdEncodeOutcome("libsvtav1", true, true, 9_000_000, 2.9, 120, "", 0),
            }));

        Assert.Contains("nenhum encoder de hardware", text);
    }

    [Fact]
    public void CalibracaoNaoMedida_NaoSugereFatorNemFalaEmQualidade()
    {
        var text = AmdAuditReportWriter.Format(Report(
            calibration: new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, 0.36, null, null, null, 0, 0)));

        Assert.Contains("UNMEASURED", text);
        Assert.DoesNotContain("Sugestao medida", text);
        Assert.DoesNotContain("VMAF  ", text);
        Assert.Contains("Nada foi medido", text);
    }

    /// <summary>Curva medida e chapada é caso diferente de "nada medido": o encoder rodou e
    /// o número existe, mas não varia o bastante para falar do fator. As duas causas pedem
    /// ações opostas, então o relatório não pode dizer a mesma frase para as duas.</summary>
    [Fact]
    public void CurvaMedidaMasChapada_DizQueNaoVariou_EmVezDeDizerQueNadaFoiMedido()
    {
        var text = AmdAuditReportWriter.Format(Report(
            amfCurve: new[]
            {
                new AmdVmafPoint("10.8 Mbps", 10_800, 96.50, 2_200_000),
                new AmdVmafPoint("32.4 Mbps", 32_400, 96.50, 2_200_000),
            },
            calibration: new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, 0.36, null, null, null, 91.9, 96.50, AmdUnmeasuredCause.FlatCurve)));

        Assert.Contains("VMAF nao variou", text);
        Assert.Contains("NAO pode ser", text);
        Assert.DoesNotContain("Nada foi medido", text);
    }

    /// <summary>Regressão do achado mais insidioso do relatório: o texto anunciava "a curva
    /// não variou" — uma afirmação sobre a AMF — quando a causa real era o x264 não ter
    /// medido. As duas pedem consertos opostos, e o número que o writer usava para adivinhar
    /// (BestAmfVmaf &gt; 0) era preenchido justamente nesse caminho.</summary>
    [Fact]
    public void AlvoVmafDesconhecido_NaoCulpaACurvaAmf()
    {
        var text = AmdAuditReportWriter.Format(Report(
            amfCurve: new[] { new AmdVmafPoint("10.8 Mbps", 10_800, 96.50, 2_200_000) },
            calibration: new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, 0.36, null, null, null, 0, 96.50, AmdUnmeasuredCause.UnknownTarget)));

        Assert.Contains("Sem alvo", text);
        Assert.DoesNotContain("VMAF nao variou", text);
        Assert.DoesNotContain("Nada foi medido", text);
        Assert.Contains("Nao e problema da AMF", text);
    }

    /// <summary>Quando o clamp morde, o veredito não pode atribuir ao 0.36 um resultado
    /// produzido pelo clamp — era o que	validava um número que ninguém testou.</summary>
    [Fact]
    public void FatorClampado_DizQueONominalNaoRodou()
    {
        var text = AmdAuditReportWriter.Format(Report(
            amfCurve: new[] { new AmdVmafPoint("10.8 Mbps", 10_800, 96.50, 2_200_000) },
            calibration: new AmdCalibrationVerdict(AmdCalibrationState.FactorPlausible, 0.500, null, null, "crf24", 96.0, 96.50)));

        Assert.Contains("ATENCAO", text);
        Assert.Contains("0.500", text);
        Assert.Contains("O fator 0.500 entrega", text);
        Assert.DoesNotContain("O 0.36 entrega", text);
    }

    /// <summary>O limiar de 85% decide se o preset entra em produção, então tem de aparecer:
    /// "NAO" sozinho levava o leitor a concluir rejeição onde há aceitação.</summary>
    [Fact]
    public void EscadaAbaixoDoAlvoMasAcimaDoLimiarMostraOsDoisNumeros()
    {
        var text = AmdAuditReportWriter.Format(Report(
            ladder: new[] { new AmdLadderPoint("quality", 52, true) }));

        Assert.Contains("sustaining de 60 fps: NAO", text);
        Assert.Contains("51 fps", text);
        Assert.Contains("ATINGE", text);
    }

    [Fact]
    public void CalibracaoSuspeita_ImprimeFatorSugeridoEDizQueNaoAplicouSozinho()
    {
        var text = AmdAuditReportWriter.Format(Report(
            amfCurve: new[] { new AmdVmafPoint("20 Mbps", 20_000, 95, 84_000) },
            calibration: new AmdCalibrationVerdict(
                AmdCalibrationState.FactorSuspect, 0.36, 0.667, 20_000, "crf24", 92.1, 95)));

        Assert.Contains("FATOR SUSPEITO", text);
        Assert.Contains("20.0 Mbps", text);
        Assert.Contains("fator 0.667", text);
        Assert.Contains("NAO foi aplicada automaticamente", text);
    }

    /// <summary>A coluna da S2a dizia "alvo de bitrate pedido" e imprimia a taxa
    /// <i>conquistada</i>. O efeito era o oposto do desejado: um rung saturado (pediu
    /// 3 600, entregou 34 411) aparecia como "alvo 34411" e a saturação — o achado mais
    /// importante da S2 — ficava invisível, porque o número impresso batia com o pedido.</summary>
    [Fact]
    public void S2a_ImprimeOPedidoEAATaxaAlcancada()
    {
        var text = AmdAuditReportWriter.Format(Report(
            bitrate: new[]
            {
                new AmdEncodeOutcome("x", true, true, 4_600_000, 2, 60, "", 0) { RequestedKbps = 3_600, NominalSeconds = 2 },
                new AmdEncodeOutcome("x", true, true, 11_500_000, 2, 60, "", 0) { RequestedKbps = 7_200, NominalSeconds = 2 },
            }));

        Assert.Contains("alvo 3600 kbps", text);
        Assert.Contains("18400 kbps", text);   // 4 600 000 B × 8 / 2 s
        Assert.Contains("alvo 7200 kbps", text);
        Assert.Contains("46000 kbps", text);
    }

    [Fact]
    public void S2a_QuandoNaoHaAlvoImprimeOResultadoPuro()
    {
        var text = AmdAuditReportWriter.Format(Report(
            bitrate: new[] { new AmdEncodeOutcome("x", true, true, 2_000_000, 1, 60, "", 0) { NominalSeconds = 1 } }));

        Assert.Contains("16000 kbps", text);
        // Sem RequestedKbps não há seta nem "alvo <número>" na linha. A regex anterior
        // batia no rodapé dos critérios ("com alvo 4x"), que é texto legítimo.
        Assert.DoesNotContain("kbps ->", text);
        Assert.DoesNotContain("alvo 0 kbps", text);
    }

    [Fact]
    public void EscadaQueNaoSustenta60fps_DizQueNaoSustenta()
    {
        var text = AmdAuditReportWriter.Format(Report(
            ladder: new[] { new AmdLadderPoint("high_quality", 44, true), new AmdLadderPoint("quality", 52, true) }));

        Assert.Contains("sustaining de 60 fps: NAO", text);
        Assert.Contains("Escada escolheria: quality", text);
    }

    [Fact]
    public void PresetQueFalhou_ApareceComoNaoMedido_NuncaComZeroFps()
    {
        var text = AmdAuditReportWriter.Format(Report(
            ladder: new[] { new AmdLadderPoint("high_quality", 0, false) }));

        var line = text.Split('\n').First(l => l.Contains("high_quality") && l.Contains("nao medido"));
        Assert.NotNull(line);
    }

    [Fact]
    public void PreanalysisESav_DesconhecidosAparecemComoNaoMedido()
    {
        var text = AmdAuditReportWriter.Format(Report());

        Assert.Contains("preanalysis suportado: nao medido", text);
        Assert.Contains("smart access video (SAV): nao medido", text);
    }

    /// <summary>Escada que não rodou é o mesmo "não medido" no resumo. O dangeroso aqui é
    /// o caminho oposto: um veredito em branco que o reportador convertesse em SIM/NAO
    /// faria o usuário trocar de preset com base em nada — e ele nem perceberia que o
    /// número não existe.</summary>
    [Fact]
    public void EscadaQueNaoRodou_ResumeComoNaoMedido_EmVezDeSimOuNao()
    {
        var text = AmdAuditReportWriter.Format(Report(
            ladder: Array.Empty<AmdLadderPoint>(),
            ladderVerdict: new AmdLadderVerdict(AmdProbeState.Unmeasured, "", 0, 60, false, false)));

        Assert.Contains("sustaining de 60 fps: nao medido", text);
        Assert.Contains("Escada escolheria: (nenhuma: a escada nao mediu)", text);
        Assert.DoesNotContain("sustaining de 60 fps: SIM", text);
        Assert.DoesNotContain("sustaining de 60 fps: NAO", text);
    }

    /// <summary><c>NotAudited</c> é o estado que impede o audit de publicar uma recusa que
    /// ele mesmo caused — a família D3D12VA precisa de frames d3d12 via hwupload com
    /// referência de device, que o audit não replica. Se essa linha virar "REFUSED", o
    /// usuário procura um problema de driver que não existe.</summary>
    [Fact]
    public void FamiliaNaoAuditada_NuncaApareceComoRecusada()
    {
        var naoAuditada = new AmdEncodeOutcome(
            "h264_d3d12va", true, false, 0, 0, 0, "o audit nao replica o caminho", 0, true);

        var text = AmdAuditReportWriter.Format(Report(matrix: new[] { naoAuditada }));

        Assert.Contains("h264_d3d12va", text);
        Assert.Contains("NOT AUDITED", text);
        var linha = text.Split('\n').First(l => l.Contains("h264_d3d12va"));
        Assert.DoesNotContain("REFUSED", linha);
        Assert.DoesNotContain("WORKS", linha);
    }

    [Fact]
    public void RelatorioImprimeOsLimitesUsadosParaConferirOCriterio()
    {
        var text = AmdAuditReportWriter.Format(Report());

        // Invariante dos dois lados: o relatório imprime com ponto decimal independente da
        // cultura (para o número ser copiável entre máquinas), então o teste compara com
        // CultureInfo.InvariantCulture e não com ToString() da cultura corrente — que em
        // pt-BR daria "1,30" e falharia por motivo que não é o do teste.
        Assert.Contains(AmdAuditCriteria.HonoredSpanRatio.ToString("0.00", CultureInfo.InvariantCulture), text);
        Assert.Contains(AmdAuditCriteria.IgnoredSpanRatio.ToString("0.00", CultureInfo.InvariantCulture), text);
        Assert.Contains(AmdAuditCriteria.FactorTolerance.ToString("0.00", CultureInfo.InvariantCulture), text);
    }

    [Fact]
    public void RelatorioAvisaQueOTextoSinteticoNaoEQualidadeDeJogo()
    {
        var text = AmdAuditReportWriter.Format(Report());

        Assert.Contains("sinteticos", text);
    }

    [Fact]
    public void MatrizVazia_NaoQuebra()
    {
        var text = AmdAuditReportWriter.Format(Report(matrix: Array.Empty<AmdEncodeOutcome>()));

        Assert.Contains("nenhum encoder testado", text);
    }
}
