using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Testes dos vereditos do <c>--audit-amd</c> (audit AMD). Todos os vereditos são funções
/// puras: a máquina de AMD só existe no futuro, então a única parte testável do audit é a
/// <b>regra de decisão</b>. Se a regra não estiver correta, o número da AMD chega e é
/// interpretado errado — que é pior do que não medir.
///
/// <para><b>Por que o audit existe.</b> Lendo a chain de produção, a AMF não recebe o CQ do
/// usuário: <c>FfmpegEncoder.cs:394-396</c> não emite <c>qp</c>/<c>cq</c> nenhum, e o alvo
/// médio sai de <c>ComputeAmfTargetKbps(maxrate) = clamp(maxrate * 0.36, 6000, 50000)</c>
/// (<c>FfmpegEncoder.cs:236</c>). Esse <b>0,36 nunca foi medido em hardware AMD</b>, e a
/// escala de <c>cq</c> já demonstrou não ser comparável entre famílias (o Item 8 mediu
/// ~2,4x de diferença de tamanho entre x264 e nvenc no mesmo CQ). Se o 0,36 estiver errado,
/// todos os presets saem piores na AMD e <b>ninguém percebe</b>, porque a UI só mostra o CQ.</para>
///
/// <para><b>A armadilha que estes testes precisam impedir.</b> O runner genérico
/// <c>RunEncodeProbe</c> documenta (linhas 659-683) que a fonte de ruído reaproveitado já
/// produziu <b>duas</b> conclusões generalizadas que a remedição refutou. E o roteiro
/// <c>4-medir-D3D12VA-AMD.bat</c> chegou a imprimir um veredito de "-qp tem autoridade" a
/// partir de arquivos de <b>0 byte</b>, porque <c>if errorlevel 1</c> não pega exit negativo.
/// Daí a regra central repetida em todos os vereditos: <b>encode que não produziu arquivo
/// não vira veredito, vira UNMEASURED</b>.</para>
/// </summary>
public class AmdAuditVerdictTests
{
    /// <summary>Amostra de escada que rodou e produziu <paramref name="bytes"/>. O
    /// <c>Completed: true</c> explícito importa: sem ele, um outcome com 0 byte cairia em
    /// UNMEASURED e os testes de "knob ignorado" estariam medindo o branch errado.</summary>
    private static AmdEncodeOutcome Sample(string label, long bytes) =>
        new(label, Listed: true, Completed: true, OutputBytes: bytes, Seconds: 2.0, Frames: 120, StderrTail: "");

    // ---------------------------------------------------------------- S1: matriz de encoders

    /// <summary>O caso que mordeu o roteiro 4: encoder <b>listado</b>, probe <b>concluído</b>,
    /// arquivo de <b>0 byte</b>. Não é "works" (nada foi produzido) nem "unmeasured" (a
    /// máquina respondeu). É <c>Refused</c> — e o relatório precisa dizer isso, porque
    /// é a diferença entre "a GPU não tem o encoder" e "o encoder existe e não abre".</summary>
    [Fact]
    public void EncoderListadoQueNaoProduzArquivo_ERefused_NaoWorks()
    {
        var o = new AmdEncodeOutcome("h264_amf", Listed: true, Completed: true, OutputBytes: 0, Seconds: 1.2, Frames: 60, StderrTail: "Could not open encoder before EOF");

        Assert.Equal(AmdProbeState.Refused, AmdAuditVerdicts.JudgeEncoderState(o));
    }

    /// <summary>
    /// <b>O buraco que o exit code cobre.</b> O ffmpeg pode sair com erro <i>depois</i> de ter
    /// escrito metade do arquivo (input cortado, muxer derrubado no meio, OOM no writer). O
    /// arquivo existe e tem bytes, então "produziu arquivo" é verdade — e o encoder ia ser
    /// reportado como <c>WORKS</c>, com um número de VMAF e um tamanho de arquivo medidos a
    /// partir de lixo truncado. É a mesma classe do <c>main10</c> (Item 9) e do
    /// <c>-rc vbr_peak</c> (Item 8): o código parece certo, o teste passa, e o relatório
    /// mente com um número bonito.
    ///
    /// <para>Por isso <see cref="AmdEncodeOutcome"/> carrega o exit code, e <c>Works</c> exige
    /// os dois: processo terminou <b>e</b> saiu com 0.</para>
    /// </summary>
    [Fact]
    public void EncodeQueSaiuComErroMasDeixouArquivoParcial_NaoEWorks()
    {
        var o = new AmdEncodeOutcome(
            "h264_amf", Listed: true, Completed: true, OutputBytes: 45_000, Seconds: 1.0, Frames: 120,
            StderrTail: "Conversion failed", ExitCode: 69);

        Assert.Equal(AmdProbeState.Refused, AmdAuditVerdicts.JudgeEncoderState(o));
    }

    [Fact]
    public void EncodeQueSaiuComZeroEEscreveuArquivo_EWorks()
    {
        var o = new AmdEncodeOutcome(
            "h264_amf", Listed: true, Completed: true, OutputBytes: 45_000, Seconds: 1.0, Frames: 120,
            StderrTail: "", ExitCode: 0);

        Assert.Equal(AmdProbeState.Works, AmdAuditVerdicts.JudgeEncoderState(o));
    }

    [Fact]
    public void EncoderQueProduzArquivo_EWorks()
    {
        var o = new AmdEncodeOutcome("h264_amf", Listed: true, Completed: true, OutputBytes: 123_456, Seconds: 1.0, Frames: 60, StderrTail: "");

        Assert.Equal(AmdProbeState.Works, AmdAuditVerdicts.JudgeEncoderState(o));
    }

    /// <summary>Ausência no binário é <b>fato</b>, não veredito. O relatório precisa
    /// distinguir "não existe" de "existe e falhou", porque o conserto é outro em cada caso.</summary>
    [Fact]
    public void EncoderAusenteNoBinario_ENaoERefused()
    {
        var o = new AmdEncodeOutcome("h264_nvenc", Listed: false, Completed: true, OutputBytes: 0, Seconds: 0, Frames: 0, StderrTail: "");

        Assert.Equal(AmdProbeState.NotPresent, AmdAuditVerdicts.JudgeEncoderState(o));
    }

    /// <summary>Probe que nem chegou a rodar (timeout, crash do processo, arquivo deletado no
    /// meio) não pode virar "o encoder foi recusado" — essa é a confusão que faz o relatório
    /// acusar a GPU por uma falha da própria máquina de medição.</summary>
    [Fact]
    public void ProbeQueNaoConcluiu_EUnmeasured_NuncaRefused()
    {
        var o = new AmdEncodeOutcome("hevc_amf", Listed: true, Completed: false, OutputBytes: 0, Seconds: 0, Frames: 0, StderrTail: "timeout");

        Assert.Equal(AmdProbeState.Unmeasured, AmdAuditVerdicts.JudgeEncoderState(o));
    }

    [Fact]
    public void AusenteTemPrecedenciaSobreTudo()
    {
        // Listed=false + Completed=false + bytes=0: o fato "não existe" é o mais forte.
        var o = new AmdEncodeOutcome("av1_amf", Listed: false, Completed: false, OutputBytes: 0, Seconds: 0, Frames: 0, StderrTail: "x");

        Assert.Equal(AmdProbeState.NotPresent, AmdAuditVerdicts.JudgeEncoderState(o));
    }

    // ---------------------------------------------------------------- S2: honestidade do knob

    /// <summary>Escada de bitrate em que o alvo dobra e o arquivo praticamente não muda: o
    /// encoder está ignorando o alvo. É o modo de falha do <c>main10</c> (Item 9) e do
    /// <c>-rc vbr_peak</c> (Item 8) — opção que "não falha" e o usuário acredita que valeu.
    ///
    /// <para><b>Por que o fixture é 0,08% e não 3%.</b> A primeira versão deste teste usava
    /// 12.000 → 12.400 (3,3% de spread) e esperava <c>Ignored</c>; o judge respondeu
    /// <c>Inconclusive</c> e <b>o judge estava certo</b>. 3% é indistinguível de saturação de
    /// conteúdo — que é exatamente o caso que o Item 2 encontrou ("o VBV impõe teto de
    /// rajada, mas a taxa média é imposta pela entropia"). Acusar o encoder de no-op com 3% de
    /// evidência seria uma acusação falsa, e é o tipo de conclusão que muda configuração
    /// de produção. A distinção fica travada no teste seguinte.</para></summary>
    [Fact]
    public void BitrateAlvoDobraEArquivoQuedaPraQuaseNada_EIgnored()
    {
        var s = new[]
        {
            Sample("t=0.5x", 12_000), Sample("t=1.0x", 12_000), Sample("t=2.0x", 12_010),
        };

        Assert.Equal(AmdKnobState.Ignored, AmdAuditVerdicts.JudgeScaling(s));
    }

    /// <summary>O caso que a lição do Item 2 manda não condenar: 3% de variação com o alvo
    /// dobrado é <b>saturação de conteúdo</b>, não no-op. Cai em Inconclusive e o relatório
    /// imprime os kbps para quem ler decidir — o judge não crava causa.</summary>
    [Fact]
    public void VariacaoDe3PorCento_ComAlvoDobrado_EPodeSerSaturacao_NaoEIgnored()
    {
        var s = new[]
        {
            Sample("t=0.5x", 12_000), Sample("t=1.0x", 12_000), Sample("t=2.0x", 12_400),
        };

        Assert.Equal(AmdKnobState.Inconclusive, AmdAuditVerdicts.JudgeScaling(s));
    }

    [Fact]
    public void BitrateAlvoDobraEArquivoDobra_EHonored()
    {
        var s = new[]
        {
            Sample("t=0.5x", 6_000), Sample("t=1.0x", 12_000), Sample("t=2.0x", 24_000),
        };

        Assert.Equal(AmdKnobState.Honored, AmdAuditVerdicts.JudgeScaling(s));
    }

    /// <summary>A zona entre "ignora" e "obedece" não pode ser a favor de nenhum lado: com
    /// 12% de variação é honesto reportar o número e não cravar causa. Este teste trava essa
    /// Honestidade — promote indevido é tão ruim quanto ignore indevido, porque mexe em
    /// configuração de produção com base em ruído.</summary>
    [Fact]
    public void VariacaoIntermediaria_EInconclusivo_NAOveredito()
    {
        var s = new[]
        {
            Sample("t=0.5x", 12_000), Sample("t=1.0x", 12_500), Sample("t=2.0x", 13_400),
        };

        Assert.Equal(AmdKnobState.Inconclusive, AmdAuditVerdicts.JudgeScaling(s));
    }

    [Fact]
    public void QualquerAmostraQueNaoRodou_EscalaFicaUnmeasured()
    {
        var s = new[]
        {
            Sample("t=0.5x", 6_000),
            new AmdEncodeOutcome("t=1.0x", true, Completed: false, 0, 0, 0, "died"),
            Sample("t=2.0x", 24_000),
        };

        Assert.Equal(AmdKnobState.Unmeasured, AmdAuditVerdicts.JudgeScaling(s));
    }

    [Fact]
    public void MenosDeDuasAmostras_NaoEVeredito()
    {
        Assert.Equal(AmdKnobState.Unmeasured, AmdAuditVerdicts.JudgeScaling(new[] { Sample("so-uma", 12_000) }));
        Assert.Equal(AmdKnobState.Unmeasured, AmdAuditVerdicts.JudgeScaling(Array.Empty<AmdEncodeOutcome>()));
    }

    /// <summary>Escada de <c>-quality</c> com os quatro valores idênticos byte a byte é o
    /// no-op exato: a escada adaptativa (Item 5) escolheria "o melhor preset que sustenta"
    /// e todos valeriam o mesmo.</summary>
    [Fact]
    public void QuatroQualitysProduzindoBytesIdenticos_EIgnored()
    {
        var s = new[]
        {
            Sample("speed", 30_000), Sample("balanced", 30_000), Sample("quality", 30_001), Sample("high_quality", 30_000),
        };

        Assert.Equal(AmdKnobState.Ignored, AmdAuditVerdicts.JudgeScaling(s));
    }

    /// <summary>Quatro <c>-quality</c> com bytes bem diferentes provam que o preset tem
    /// autoridade — e é assim que se descobre em qual direção a escada de qualidade está
    /// (no NVENC, p1 é o mais rápido e p7 o melhor; AMF nunca foi verificado).</summary>
    [Fact]
    public void QualitysProduzindoBytesDiferentes_EHonored()
    {
        var s = new[]
        {
            Sample("speed", 20_000), Sample("balanced", 28_000), Sample("quality", 36_000), Sample("high_quality", 45_000),
        };

        Assert.Equal(AmdKnobState.Honored, AmdAuditVerdicts.JudgeScaling(s));
    }

    // ---------------------------------------------------------------- S3: calibracao com VMAF

    /// <summary>O cenário que o audit existe para achar: a chain AMF de produção entrega
    /// VMAF <b>pior</b> que o x264 no CQ do usuário, e a curva AMF mostra que mesmo o
    /// ponto de maior bitrate não alcança o alvo. <b>Mais bitrate não resolve</b> — o
    /// conserto não é aumentar o 0,36, é mudar de RC (o Item 8 descobriu exatamente isso
    /// quando <c>-rc vbr_peak</c> descarta <c>qp_i/qp_p</c> em silêncio).</summary>
    [Fact]
    public void CurvaAmfNuncaAlcancaOVmafAlvo_ETargetUnreachable_NaoSugereFator()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 90_000, 2.0, 120, "");
        var amf = new[]
        {
            new AmdVmafPoint("6 Mbps", 6_000, 78, 40_000),
            new AmdVmafPoint("24 Mbps", 24_000, 84, 160_000),
        };
        var x264 = new[] { new AmdVmafPoint("crf20", 0, 92, 70_000) };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 92, productionMaxrateKbps: 30_000);

        Assert.Equal(AmdCalibrationState.TargetUnreachable, v.State);
        Assert.Null(v.SuggestedFactor);
        Assert.Null(v.SuggestedAmfKbps);
    }

    /// <summary>Cenário normal: a curva AMF cruza o alvo do x264 num ponto, e o fator
    /// suggested difere bastante do 0,36 de produção. É um achado acionável — "passe
    /// 20 Mbps, não 10,8".</summary>
    [Fact]
    public void Fator036MuitoBaixo_SugereFatorCorreto()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 45_000, 2.0, 120, "");
        var amf = new[]
        {
            new AmdVmafPoint("10.8 Mbps (producao)", 10_800, 84, 45_000),
            new AmdVmafPoint("20 Mbps", 20_000, 92, 84_000),
            new AmdVmafPoint("30 Mbps", 30_000, 95, 126_000),
        };
        var x264 = new[] { new AmdVmafPoint("crf20", 0, 92, 70_000) };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 92, productionMaxrateKbps: 30_000);

        Assert.Equal(AmdCalibrationState.FactorSuspect, v.State);
        Assert.Equal(20_000, v.SuggestedAmfKbps);
        // 20000/30000 = 0,6667 contra 0,36 de produção: mais que o dobro.
        Assert.Equal(0.36, v.ProductionFactor, 3);
        Assert.Equal(0.667, v.SuggestedFactor!.Value, 3);
    }

    /// <summary>Se o fator já estiver dentro da tolerância, o veredito é "plausível" e o
    /// relatório NÃO deve promover mudança nenhuma. Promote sem necessidade é tão dano
    /// quanto não promote quando devia.
    ///
    /// <para><b>A curva tem o ponto de produção ACIMA do alvo (93 &gt; 92)</b>, senão o judge
    /// acha que é preciso subir de bitrate e promove. A primeira versão deste teste punha
    /// produção em 91 com alvo 92 — e o judge respondeu "suspect, use 20 Mbps", que estava
    /// <b>correto</b>: 91 não atinge 92. O fixture é que prometia "sem mudança" com números
    /// que pedem mudança.</para></summary>
    [Fact]
    public void FatorDentroDaTolerancia_EPlausivel_NAoSugereMudanca()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 45_000, 2.0, 120, "");
        var amf = new[]
        {
            new AmdVmafPoint("10.8 Mbps (producao)", 10_800, 93, 45_000),
            new AmdVmafPoint("20 Mbps", 20_000, 96, 84_000),
        };
        var x264 = new[] { new AmdVmafPoint("crf20", 0, 92, 70_000) };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 92, productionMaxrateKbps: 30_000);

        Assert.Equal(AmdCalibrationState.FactorPlausible, v.State);
        Assert.Equal(10_800, v.SuggestedAmfKbps);
    }

    /// <summary>
    /// <b>O bug que o smoke test do audit expôs.</b> Com a curva AMF chapada (as três
    /// medições dando exatamente o mesmo VMAF e os mesmos bytes), o judge escolhia o ponto
    /// mais barato "que atinge o alvo" — que era justamente o ponto de produção — e
    /// declarava <c>FactorPlausible</c>.
    ///
    /// <para>Ou seja: confirmava o 0.36 com os próprios dados que não conseguem falar sobre
    /// o 0.36. Numa curva plana o encoder nunca quis mais bits, e a única leitura honesta é
    /// "não dá para medir" — o mesmo fundamento de <c>Inconclusive</c> na S2. Sem este
    /// teste, o audit reportaria "calibrado" numa máquina cujo conteúdo nunca exercitou a
    /// taxa, que é a pior forma de reassurance falso.</para>
    /// </summary>
    [Fact]
    public void CurvaAmfChapada_NaoPodeDeclararOFatorPlausivel()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 2_200_000, 2.0, 60, "");
        var amf = new[]
        {
            new AmdVmafPoint("10.8 Mbps", 10_800, 96.50, 2_200_000),
            new AmdVmafPoint("21.6 Mbps", 21_600, 96.50, 2_200_000),
            new AmdVmafPoint("32.4 Mbps", 32_400, 96.50, 2_200_000),
        };
        var x264 = new[] { new AmdVmafPoint("crf20", 0, 91.92, 1_100_000) };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 91.92, productionMaxrateKbps: 30_000);

        Assert.Equal(AmdCalibrationState.Unmeasured, v.State);
        Assert.Null(v.SuggestedFactor);
    }

    [Fact]
    public void CurvaAmfComSpreadReal_ContinuaPermitindoVeredito()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 2_200_000, 2.0, 60, "");
        var amf = new[]
        {
            new AmdVmafPoint("10.8 Mbps", 10_800, 88, 2_200_000),
            new AmdVmafPoint("21.6 Mbps", 21_600, 93, 3_900_000),
            new AmdVmafPoint("32.4 Mbps", 32_400, 96, 5_100_000),
        };
        var x264 = new[] { new AmdVmafPoint("crf20", 0, 91.92, 1_100_000) };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 91.92, productionMaxrateKbps: 30_000);

        Assert.Equal(AmdCalibrationState.FactorSuspect, v.State);
    }

    /// <summary>Se o x264 no CQ do usuário não mediu, não existe alvo — e alvo 0 faz
    /// <b>todos</b> os pontos parecerem "atingir o alvo", promoting o mais barato. A curva
    /// de AMF também não pode virar palpite: sem referência, é unmeasured.</summary>
    [Fact]
    public void AlvoVmafDesconhecido_NaoPromoveFatorPorAccidentalDeZero()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 2_200_000, 2.0, 60, "");
        var amf = new[]
        {
            new AmdVmafPoint("10.8 Mbps", 10_800, 88, 2_200_000),
            new AmdVmafPoint("21.6 Mbps", 21_600, 96, 4_000_000),
        };
        var x264 = new[] { new AmdVmafPoint("crf30", 0, 80, 700_000) };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 0, productionMaxrateKbps: 30_000);

        Assert.Equal(AmdCalibrationState.Unmeasured, v.State);
        Assert.Null(v.SuggestedAmfKbps);
    }

    /// <summary>Se a produção nem rodou, não há curva que salve: sugerir fator a partir de
    /// uma encode que falhou seria inventar número.</summary>
    [Fact]
    public void ProducaoRecusada_NaoSugereFator()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 0, 1.0, 0, "Could not open encoder before EOF");
        var amf = new[] { new AmdVmafPoint("20 Mbps", 20_000, 92, 84_000) };
        var x264 = new[] { new AmdVmafPoint("crf20", 0, 92, 70_000) };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 92, productionMaxrateKbps: 30_000);

        Assert.Equal(AmdCalibrationState.Unmeasured, v.State);
        Assert.Null(v.SuggestedFactor);
    }

    /// <summary>O relatório precisa dizer "no mesmo rótulo de CQ, a AMF equivale ao x264 CRF N",
    /// porque é essa frase que traduz o número para quem decide. Sem ela, o número de VMAF é
    /// solto.</summary>
    [Fact]
    public void RelatorioDizQualCrfDoX264EquivaleAoVmafDaProducaoAmf()
    {
        var prod = new AmdEncodeOutcome("producao", true, true, 45_000, 2.0, 120, "");
        var amf = new[]
        {
            new AmdVmafPoint("10.8 Mbps (producao)", 10_800, 88, 45_000),
            new AmdVmafPoint("20 Mbps", 20_000, 94, 84_000),
        };
        var x264 = new[]
        {
            new AmdVmafPoint("crf16", 0, 96, 120_000),
            new AmdVmafPoint("crf20", 0, 92, 70_000),
            new AmdVmafPoint("crf24", 0, 85, 38_000),
        };

        var v = AmdAuditVerdicts.JudgeCalibration(prod, amf, x264, targetVmaf: 92, productionMaxrateKbps: 30_000);

        // VMAF 88 da produção fica entre crf24 (85) e crf20 (92); o mais próximo é crf20 (dif 4) vs crf24 (dif 3).
        Assert.Equal("crf24", v.MatchingX264Crf);
    }

    // ---------------------------------------------------------------- S4: escada adaptativa

    /// <summary>A escada de produção aceita 85% do alvo (<c>SelectAmfPreset</c>), ou seja
    /// <b>51 fps para um alvo de 60</b>. Isso pode ser deliberado (folga para a captura), mas
    /// precisa aparecer no relatório como número, não ser escondido dentro de um "OK".</summary>
    [Fact]
    public void PresetEscolhidoAtinge85PorCento_ReportaQueNaoSustenta60()
    {
        var pts = new[]
        {
            new AmdLadderPoint("high_quality", 44, true),
            new AmdLadderPoint("quality", 52, true),
            new AmdLadderPoint("balanced", 96, true),
            new AmdLadderPoint("speed", 140, true),
        };

        var v = AmdAuditVerdicts.JudgeLadder(pts, chosen: "quality", targetFps: 60, codeAcceptRatio: 0.85);

        Assert.Equal("quality", v.ChosenPreset);
        Assert.True(v.MeetsCodeThreshold);   // 52 >= 51
        Assert.False(v.SustainsTarget);      // 52 < 60
    }

    [Fact]
    public void PresetEscolhidoAcimaDoAlvo_Sustenta()
    {
        var pts = new[]
        {
            new AmdLadderPoint("quality", 95, true),
            new AmdLadderPoint("balanced", 130, true),
        };

        var v = AmdAuditVerdicts.JudgeLadder(pts, chosen: "quality", targetFps: 60, codeAcceptRatio: 0.85);

        Assert.True(v.SustainsTarget);
    }

    /// <summary>Se o preset escolhido não está na lista de pontos medidos, o relatório não
    /// pode dizer que "sustenta" — tem que dizer que não mediu.</summary>
    [Fact]
    public void PresetEscolhidoSemMedida_NaoAfirmaQueSustenta()
    {
        var pts = new[] { new AmdLadderPoint("speed", 140, true) };

        var v = AmdAuditVerdicts.JudgeLadder(pts, chosen: "high_quality", targetFps: 60, codeAcceptRatio: 0.85);

        Assert.Equal(AmdProbeState.Unmeasured, v.State);
        Assert.False(v.SustainsTarget);
    }

    [Fact]
    public void PontoDaEscadaQueNaoRodou_InvalidaOPresetEscolhido()
    {
        var pts = new[]
        {
            new AmdLadderPoint("quality", 0, Completed: false),
            new AmdLadderPoint("balanced", 130, true),
        };

        var v = AmdAuditVerdicts.JudgeLadder(pts, chosen: "quality", targetFps: 60, codeAcceptRatio: 0.85);

        Assert.Equal(AmdProbeState.Unmeasured, v.State);
    }

    // ---------------------------------------------------------------- S6: custo em bytes

    /// <summary>Item 4 mediu ~0% de custo do GOP 60 no NVENC. Se na AMF for o mesmo, o
    /// veredito precisa dizer que o custo é desprezível — e não exigir uma reconfiguração.</summary>
    [Fact]
    public void CustoDeBytesDesprezivel_NAoPromoveMudanca()
    {
        var r = AmdAuditVerdicts.JudgeByteCost(baselineBytes: 4_603_000, variantBytes: 4_616_000, negligiblePct: 2.0);

        Assert.True(r.IsNegligible);
        Assert.Equal("negligible", r.Verdict);
    }

    [Fact]
    public void CustoDeBytesRelevante_ReportaOPercentual()
    {
        var r = AmdAuditVerdicts.JudgeByteCost(baselineBytes: 4_000_000, variantBytes: 4_600_000, negligiblePct: 2.0);

        Assert.False(r.IsNegligible);
        Assert.Equal(15.0, r.CostPct, 1);
        Assert.Equal("material", r.Verdict);
    }

    /// <summary>Baseline de 0 byte não é divisão por zero nem "custo infinito": é
    /// UNMEASURED, pelo mesmo motivo dos outros vereditos.</summary>
    [Fact]
    public void BaselineZero_NAoViraCustoInfinito()
    {
        var r = AmdAuditVerdicts.JudgeByteCost(baselineBytes: 0, variantBytes: 4_000_000, negligiblePct: 2.0);

        Assert.Equal("unmeasured", r.Verdict);
        Assert.False(r.IsNegligible);
    }

    // ---------------------------------------------------------------- travas dos criterios

    /// <summary>Os números de critério ficam em código de produção e são usados para decidir
    /// mudança de configuração. Alterá-los depois de ver o resultado da AMD seria decidir
    /// olhando a régua — por isso a trava.</summary>
/// <summary>
/// Trava a ordem de entradas do <c>libvmaf</c>.
///
/// <para>Esta é a regressão mais cara já encontrada neste audit, e nenhuma das formas
/// normais de teste a pegaria: a versão invertida rodava, imprimia um número plausível e
/// o relatório inteiro ficava bonito. Só appeared ao comparar o mesmo par de arquivos nos
/// dois sentidos — e ela mentia <b>para o lado otimista</b> justamente nas imagens
/// destruídas, que são as que o audit existe para acusar.</para>
///
/// <para>O filtro declara <c>#0: main</c> e <c>#1: reference</c>. Se os papéis trocam, o
/// VMAF passa a medir "quão bem a íntegra prevê a codificada", que é uma métrica diferente
/// e mais alta. Um teste que só conferisse "tem libvmaf na linha" passaria com o bug.</para>
/// </summary>
public class AmdAuditVmafArgsTests
{
    private static int IndexOfValue(string[] args, string flag)    {
        var i = Array.IndexOf(args, flag);
        Assert.True(i >= 0 && i + 1 < args.Length, $"flag {flag} ausente ou sem valor");
        return i + 1;
    }

    private static List<string> InputsOf(string[] args)
    {
        var inputs = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "-i") inputs.Add(args[i + 1]);
        }

        return inputs;
    }

    [Fact]
    public void EntradaZeroEDoArquivoCodificado_EEntradaUmEDaReferencia()
    {
        var args = AmdAudit.BuildVmafArgs("mandelbrot=size=64x64:rate=30", @"C:\tmp\out.h264", 30, AmdSourceMode.LavfiRealtime);

        // #0 (main = distorcido) = o arquivo codificado; #1 (reference) = a fonte íntegra.
        // A primeira versão do audit invertia exatamente aqui.
        var inputs = InputsOf(args);
        Assert.Equal(2, inputs.Count);
        Assert.Contains("out.h264", inputs[0], StringComparison.OrdinalIgnoreCase);
        Assert.StartsWith("mandelbrot", inputs[1], StringComparison.Ordinal);

        // E a fonte precisa mesmo estar marcada como lavfi, senão o ffmpeg tenta abrir
        // "mandelbrot=..." como um arquivo.
        var lavfiAt = Array.IndexOf(args, "lavfi");
        Assert.True(lavfiAt > 0 && args[lavfiAt - 1] == "-f", "a referencia precisa de -f lavfi");
        Assert.Equal(lavfiAt + 2, Array.IndexOf(args, inputs[1]!)); // a fonte vem logo depois de -f lavfi -i
    }

    [Fact]
    public void SemFramesV_NumeroInfinitoDeReferenciaFariaOEncodeNuncaTerminar()
    {
        var args = AmdAudit.BuildVmafArgs("mandelbrot=size=64x64:rate=30", @"C:\tmp\out.h264", 90, AmdSourceMode.LavfiRealtime);

        Assert.Equal("90", args[IndexOfValue(args, "-frames:v")]);
    }

    /// <summary>Sem <c>eof_action=endall</c> o framesync repete o último frame de um arquivo
    /// curto e ainda imprime uma pontuação válida: um encode que entregou 112 de 120 frames
    /// entraria na curva como se estivesse inteiro.</summary>
    [Fact]
    public void EofActionEndall_ImpedeQueArquivoCurtoRepitaUltimoFrame()
    {
        var args = AmdAudit.BuildVmafArgs("mandelbrot=size=64x64:rate=30", @"C:\tmp\out.h264", 30, AmdSourceMode.LavfiRealtime);

        var filter = args[Array.IndexOf(args, "-lavfi") + 1];
        Assert.Contains("eof_action=endall", filter);
    }
}

/// <summary>Os números de critério ficam em código de produção e são usados para decidir
/// mudança de configuração. Alterá-los depois de ver o resultado da AMD seria decidir
/// olhando a régua - por isso a trava.</summary>
[Fact]
public void CriteriosDoAuditEstaoTravados()
{
    Assert.Equal(1.30, AmdAuditCriteria.HonoredSpanRatio, 3);
    Assert.Equal(1.02, AmdAuditCriteria.IgnoredSpanRatio, 3);
    Assert.Equal(0.25, AmdAuditCriteria.FactorTolerance, 3);
    Assert.Equal(1.0, AmdAuditCriteria.MinCurveSpreadVmaf, 3);

    // A fórmula do 0.36 é a de PRODUÇÃO, chamada pelo judge. Se alguém voltar a duplicá-la
    // numa cópia local, este teste continua verde — quem pega isso é o code review; a trava
    // aqui é sobre o número que o relatório vai mostrar ao usuário.
    Assert.Equal(0.36, FfmpegEncoder.ComputeAmfTargetKbps(30_000) / 30_000d, 3);
}
}

/// <summary>Trava o "sem drift de args". O teste compara o que o audit pede com o que
/// <c>ConfigManager</c> tem por default — porque a versão anterior fixava
/// <c>lookahead: 4</c> e <c>multipass: false</c> e mesmo assim o relatório afirmava que
/// media a configuração de produção.</summary>
public class AmdAuditChainDriftTests
{
    private static AmdAuditRequest Req() => new(1280, 720, 60, 20, 40_000, 80_000, 120);

    /// <summary>Defaults do <c>AppConfig</c> = o que a captura usa quando o usuário não
    /// mexeu em nada, que é exatamente o caso do teste 6 na máquina do usuário.</summary>
    private static DiNho.Capture.Poc.Config.AppConfig ProductionDefaults() => new();

    [Fact]
    public void LookaheadDoAuditEOQueAProducaoUsa()
    {
        var config = ProductionDefaults();
        var req = new AmdAuditRequest(1280, 720, 60, 20, 40_000, 80_000, 120)
        {
            Lookahead = config.Lookahead,
            Multipass = config.Multipass,
        };

        Assert.Equal(config.Lookahead, req.Lookahead);
        Assert.Equal(16, config.Lookahead);           // o número que a captura manda
        Assert.True(config.Multipass);
    }

    [Fact]
    public void DefaultsDoRequestSaoOsDaProducaoENaoOsDoAuditor()
    {
        var config = ProductionDefaults();
        var req = Req();

        Assert.Equal(config.Lookahead, req.Lookahead);
        Assert.Equal(config.Multipass, req.Multipass);
        Assert.Equal(0, req.Bframes);
    }
}

/// <summary>Regressões de medição e de estado. Cada uma existia numa versão anterior do
/// audit e produzia um relatório plausível e errado — a classe de bug que a documentação
/// do projeto chama de "o código está certo, testado, e não faz o que promete".</summary>
public class AmdAuditMeasurementTests
{
    private static AmdAuditRequest Req() => new(1280, 720, 60, 20, 40_000, 80_000, 120);

    /// <summary>A coluna da S2a é rotulada "alvo". Medir contra o wall-clock do processo
    /// imprimia o resultado no lugar do pedido — e era justamente o rung saturado (pediu
    /// 10 800, conseguiu 71 000) que aparecia mais inflado, ou seja, o sinal mais forte de
    /// saturação renderizado como se fosse o alvo.</summary>
    [Fact]
    public void Kbps_UsaDuracaoNominal_NaoOWallClock()
    {
        // 60 frames a 60 fps = 1 s de conteúdo. O processo levou 2 s (startup do encoder),
        // o que é normal e não pode virar taxa.
        var o = new AmdEncodeOutcome("h264_amf", true, true, 125_000, 2.0, 60, "", 0) { NominalSeconds = 1.0 };

        Assert.Equal(1000.0, o.Kbps, 0);
        Assert.NotEqual(500.0, o.Kbps, 0);
    }

    [Fact]
    public void SemDuracaoNominal_CaiNoWallClock()
    {
        var o = new AmdEncodeOutcome("h264_amf", true, true, 250_000, 2.0, 60, "", 0);

        Assert.Equal(1000.0, o.Kbps, 0);
    }

    /// <summary>Sem <c>-b:v</c> não existe rampa de taxa, e a escada inteira vira ruído.
    /// Só AMF e D3D12VA recebem <c>-b:v</c> de <c>BuildEncoderTuneArgs</c>, e o override de
    /// <c>CODEC</c> existe justamente para rodar em máquina sem AMF.</summary>
    [Fact]
    public void CodecSemBv_NaoDevolveTaxaAlterada()
    {
        // É a linha que o x264 recebe em -crf: sem -b:v.
        var x264Tune = "-crf 20 -preset veryfast -g 60";

        Assert.False(AmdAudit.TryFixAmfBitrate(x264Tune, 20_000, out var patched));
        Assert.Equal(x264Tune, patched);
    }

    [Fact]
    public void CodecComBv_DevolveTaxaAlterada()
    {
        Assert.True(AmdAudit.TryFixAmfBitrate("-rc vbr_peak -b:v 14400K -maxrate 40000K", 20_000, out var patched));
        Assert.Contains("-b:v 20000K", patched);
        Assert.Contains("-maxrate 40000K", patched);
    }

    /// <summary>Trava a constante que o relatório imprime contra a função que a produção
    /// executa. Divergir aqui é o que fez o relatório dizer "0.36" quando o clamp da
    /// produção mandava 0.500 — validando um número que ninguém testou.</summary>
    [Fact]
    public void FatorNominalDoCodigoEOQueAFormulaDaProducaoUsa()
    {
        Assert.Equal(AmdAuditCriteria.ProductionFactor, FfmpegEncoder.ComputeAmfTargetKbps(30_000) / 30_000d, 5);
    }

    [Fact]
    public void FatorClampadoNaoSeConfundeComOnominal()
    {
        var clamped = new AmdCalibrationVerdict(AmdCalibrationState.FactorPlausible, 0.600, null, null, "crf24", 96, 96);
        var nominal = new AmdCalibrationVerdict(AmdCalibrationState.FactorPlausible, 0.36, null, null, "crf24", 96, 96);

        Assert.True(clamped.ProductionFactorClamped);
        Assert.False(nominal.ProductionFactorClamped);
    }

    [Fact]
    public void AlvoDesconhecidoARegistraCausaCerta()
    {
        // x264 COM arquivo (Bytes > 0, entra em usableX264) mas sem VMAF: é o caso do
        // libvmaf indisponível. Não é NoPoints, porque ponto houve — o que faltou foi o
        // alvo com o qual comparar, e a causa precisa distinguir os dois.
        var amf = new[] { new AmdVmafPoint("a", 10_000, 96.0, 1_000), new AmdVmafPoint("b", 20_000, 97.5, 1_000) };
        var x264 = new[] { new AmdVmafPoint("crf20", 5_000, 0, 1_000) };
        var production = new AmdEncodeOutcome("h264_amf", true, true, 100_000, 1, 60, "", 0);

        var v = AmdAuditVerdicts.JudgeCalibration(production, amf, x264, 0, 40_000);

        Assert.Equal(AmdCalibrationState.Unmeasured, v.State);
        Assert.Equal(AmdUnmeasuredCause.UnknownTarget, v.Cause);
    }

    /// <summary>x264 que não produziu arquivo é causa diferente de x264 que produziu e não
    /// mediu: a primeira diz "rode de novo", a segunda diz "falta libvmaf".</summary>
    [Fact]
    public void X264SemArquivoARegistraNoPoints_NaoUnknownTarget()
    {
        var amf = new[] { new AmdVmafPoint("a", 10_000, 96.0, 1_000), new AmdVmafPoint("b", 20_000, 97.5, 1_000) };
        var x264 = new[] { new AmdVmafPoint("crf20", 0, 0, 0) };
        var production = new AmdEncodeOutcome("h264_amf", true, true, 100_000, 1, 60, "", 0);

        var v = AmdAuditVerdicts.JudgeCalibration(production, amf, x264, 0, 40_000);

        Assert.Equal(AmdUnmeasuredCause.NoPoints, v.Cause);
    }

    [Fact]
    public void CurvaChapadaARegistraCausaCerta()
    {
        var amf = new[] { new AmdVmafPoint("a", 10_000, 96.0, 1_000), new AmdVmafPoint("b", 20_000, 96.1, 1_000) };
        var x264 = new[] { new AmdVmafPoint("crf20", 5_000, 90, 1_000) };
        var production = new AmdEncodeOutcome("h264_amf", true, true, 100_000, 1, 60, "", 0);

        var v = AmdAuditVerdicts.JudgeCalibration(production, amf, x264, 90, 40_000);

        Assert.Equal(AmdUnmeasuredCause.FlatCurve, v.Cause);
    }

    /// <summary>O ffmpeg pode sair != 0 DEPOIS de escrever metade do arquivo. Com
    /// <c>Completed</c> + bytes > 0 como filtro, esse rung entrava na spread e a taxa
    /// parecia autorizada porque um encoder morreu no meio — e dead-on: um rung de 8 KB
    /// contra um de 200 KB dá span 25, ou seja, "AUTORIZADO" com a melhor nota possível.</summary>
    [Fact]
    public void RungTruncadoNaoAutorizaOAtalhoDeTaxa()
    {
        var truncated = new AmdEncodeOutcome("h264_amf", true, true, 8_000, 1, 60, "morreu no meio", -22);
        var whole = new AmdEncodeOutcome("h264_amf", true, true, 200_000, 1, 60, "", 0);

        Assert.Equal(AmdProbeState.Refused, truncated.State);
        Assert.Equal(AmdKnobState.Unmeasured, AmdAuditVerdicts.JudgeScaling(new[] { truncated, whole }));
    }

    /// <summary>Contrapartida: a saturação é o caso que o audit existe para achar, e ela sai
    /// com exit 0 — então a correção acima não pode engolir o sinal.</summary>
    [Fact]
    public void RungSaturadoContinuaAutorizando()
    {
        var saturated = new AmdEncodeOutcome("h264_amf", true, true, 3_000_000, 1, 60, "", 0);
        var lower = new AmdEncodeOutcome("h264_amf", true, true, 200_000, 1, 60, "", 0);

        Assert.Equal(AmdKnobState.Honored, AmdAuditVerdicts.JudgeScaling(new[] { lower, saturated }));
    }
}

/// <summary>O limiar de aceitação da escada decide se o preset entra em produção, então o
/// número precisa existir fora do judge — sem isso o relatório dizia "NAO" sem dizer que a
/// aplicação aceitaria assim mesmo.</summary>
public class AmdAuditLadderTests
{
    [Fact]
    public void LimiarDe85PorCentoEDerivadoDoMesmoNumeroQueoJudgeUsa()
    {
        var v = AmdAuditVerdicts.JudgeLadder(
            new[] { new AmdLadderPoint("quality", 52, true) }, "quality", 60, 0.85);

        // 52 fps não atinge 60, mas atinge 51 (85%): o código aceitaria o preset.
        Assert.False(v.SustainsTarget);
        Assert.True(v.MeetsCodeThreshold);
        Assert.Equal(51.0, v.AcceptedFps, 3);
    }
}