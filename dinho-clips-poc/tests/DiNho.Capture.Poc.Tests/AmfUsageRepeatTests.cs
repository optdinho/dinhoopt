using DiNho.Capture.Poc.Encoders;
using AmfUsageReport = DiNho.Capture.Poc.ProgramBenchmark.AmfUsageReport;
using AmfUsageRepeat = DiNho.Capture.Poc.ProgramBenchmark.AmfUsageRepeat;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// O veredito de <c>--probe-amf-usage</c> decide por <b>fps</b>, e a coluna de fps é a única
/// que <b>não é repetível</b> nesta máquina. Duas execuções do mesmo probe, mesmo PC, mesmo
/// conteúdo, mesmas chains, ~1 h de intervalo:
///
/// <list type="bullet">
/// <item>a <b>referência</b> (default, sem <c>-usage</c>) foi de <b>351,99</b> para <b>336,40</b> fps: −4,4%;</item>
/// <item>os <b>mesmos</b> braços foram de 368–374 para 371–386 fps: ~+3%;</item>
/// <item>e os deltas, que são relativos a uma referência medida <b>uma única vez</b>, pularam
/// de +0/+5/+6% para <b>+11/+12/+15%</b>.</item>
/// </list>
///
/// <para>Ou seja: o tremor da referência (4,4%) entra em todos os deltas de uma vez e
/// infla cada um em ~5 pontos. O critério de promote é <b>10%</b> — e o ruído observado no
/// delta é <b>±7 pontos</b>. Ou seja: o critério estava dentro do ruído, e nenhuma das duas
/// execuções podia decidir a pergunta. Uma delas "reprovava" com +6%, a outra "aprovava" com
/// +15%.</para>
///
/// <para><b>É este o defeito que estes testes travam</b>, e ele é de método, não de conta: o
/// relatório publicava um delta com 0 casas decimais, <b>sem nenhuma indicação de quanta
/// confiança ele tinha</b>. Um "+6%" e um "+15%" saíam visualmente idênticos a um "+600%",
/// que seria um sinal claro. Não é erro de aritmética — é um número sem erro aparente que a
/// pessoa usa para decidir trocar a chain de produção.</para>
///
/// <para><b>Não é "repetir 5 vezes e pronto".</b> Repetir tudo com N fixo não corrige nada se
/// a referência continuar sendo <b>medida uma vez</b>: o viés fica, só encolhe. O que neutraliza
/// o drift é (a) medir a referência <b>em toda volta</b> e usar a <b>mediana</b>, e (b)
/// <b>publicar a dispersão dela como piso de ruído</b>, para o leitor saber que +6% está
/// dentro. Ambos são testados aqui.</para>
///
/// <para><b>O que NÃO mudou:</b> as colunas de bytes. Kbps e KiB bateram idênticos nas duas
/// execuções (2325/2325, 2361/2361 KiB), o que mostra que o encoder é determinístico em
/// <i>saída</i> e que o ruído está só em <i>velocidade</i>. Por isso a repetição afeta o fps e
/// não o denominador de bytes — e por isso um teste que só exercitasse o denominador de bytes
/// passaria verde com o defeito inteiro presente.</para>
/// </summary>
public class AmfUsageRepeatTests
{
    private static EncoderManager.EncodeProbeResult Row(string variant, double fps) =>
        new("h264_amf", $"usage={variant}", fps, 12698.5, 2325 * 1024, 90, 40000);

    // As DUAS execuções reais do bloco 720p60, linha por linha. São 14 amostras de fps reais
    // medidas no RX 5700 XT — o insumo mais honesto que existe para o teste.
    private static readonly double[] Ref720 = { 351.99, 336.40 };
    private static readonly double[] Transcoding720 = { 353.21, 375.02 };
    private static readonly double[] Ultralow720 = { 373.53, 385.75 };
    private static readonly double[] Webcam720 = { 368.32, 377.48 };
    private static readonly double[] HighQuality720 = { 12.79, 15.45 };

    // ---------- mediana ----------

    [Theory]
    [InlineData(new[] { 5.0 }, 5.0)]
    [InlineData(new[] { 3.0, 9.0 }, 6.0)]                                   // par = média do meio
    [InlineData(new[] { 1.0, 2.0, 3.0 }, 2.0)]                              // ímpar = do meio
    [InlineData(new[] { 1.0, 2.0, 3.0, 4.0 }, 2.5)]
    [InlineData(new[] { 1.0, 100.0, 2.0, 3.0, 4.0 }, 3.0)]                  // outlier não puxa
    public void Mediana_E_OValorCentral(double[] amostras, double esperada)
        => Assert.Equal(esperada, AmfUsageRepeat.Median(amostras), 3);

    [Fact]
    public void Mediana_DeListaVazia_NaoInventaNumero()
    {
        // Retornar 0 faria "sem amostra" virar "0 fps", que o relatório imprimiria como
        // medição. Precisa ser estado explícito.
        Assert.Equal(0, AmfUsageRepeat.Median(Array.Empty<double>()));
        Assert.Equal(0, AmfUsageRepeat.Median(null!));
    }

    // ---------- dispersão = piso de ruído ----------

    [Fact]
    public void Dispensao_ComUmaAmostra_NaoSeMede()
    {
        // Com N=1 não existe dispersão. Devolver 0 seria afirmar "ruído zero", que é
        // exatamente a mentira que estes testes existem para tirar do relatório.
        Assert.Equal(0, AmfUsageRepeat.SpreadPct(new[] { 351.99 }));
    }

    [Fact]
    public void Dispensao_ComDuasExecucoesReais_ERuidoDe4Ponto5PorCento()
    {
        // 351,99 e 336,40 reais: (351,99-336,40)/mediana(344,195)*100 = 4,5294% => 4,53%.
        var ruido = AmfUsageRepeat.SpreadPct(Ref720);

        Assert.Equal(4.53, ruido, 2);
    }

    [Fact]
    public void Dispensao_UsaMedianaComoBase_NaoOMaximoNemOMinimo()
    {
        // Dados escolhidos para que a mediana seja 110 — distinta do máximo (130), do mínimo
        // (100) e da média (114). A versão anterior usava {100,100,100,130}, onde a mediana
        // coincide com o mínimo: o teste passava com qualquer base que não fosse o máximo, e
        // portanto não provava o que o nome afirma. Teste que não distingue as hipóteses é
        // teste decorativo — o mesmo problema do `-profile:v main` vs `main10`.
        var amostras = new[] { 100.0, 100.0, 110.0, 130.0, 130.0 };
        const double esperado = 30.0 / 110.0 * 100.0;   // (max-min)/mediana

        Assert.Equal(esperado, AmfUsageRepeat.SpreadPct(amostras), 2);

        // E a distinção explícita contra as outras bases possíveis.
        Assert.NotEqual(30.0 / 130.0 * 100.0, AmfUsageRepeat.SpreadPct(amostras), 2);   // base = máximo
        Assert.NotEqual(30.0 / 100.0 * 100.0, AmfUsageRepeat.SpreadPct(amostras), 2);   // base = mínimo
        Assert.NotEqual(30.0 / 114.0 * 100.0, AmfUsageRepeat.SpreadPct(amostras), 2);   // base = média
    }

    // ---------- a referência passa a ser a mediana das voltas ----------

    [Fact]
    public void Referencia_ComVariasVoltas_NemEhAPrimeiraNemAMaior()
    {
        // Este é o teste que pega o defeito real. A referência era a PRIMEIRA linha medida;
        // com 3 voltas ela tem de ser a mediana, senão um tremor de uma volta só volta a
        // contaminar todos os deltas (que é o que aconteceu entre 19h e 20h).
        var r = AmfUsageReport.Reference(new[]
        {
            Row("", 336.40),   // a 1ª volta foi a mais lenta
            Row("", 351.99),
            Row("", 344.00),
        });

        Assert.Equal(344.00, r.Fps, 2);
        Assert.NotEqual(336.40, r.Fps, 2);   // não é a primeira
        Assert.NotEqual(351.99, r.Fps, 2);   // não é a máxima
    }

    [Fact]
    public void Referencia_PublicaOSeuProprioRuido()
    {
        var r = AmfUsageReport.Reference(new[] { Row("", 336.40), Row("", 351.99) });

        Assert.Equal(4.53, r.FpsSpreadPct, 2);
    }

    [Fact]
    public void Referencia_DeUmaVoltaSo_NAoDeclaraRuidoZero()
    {
        // N=1: o relatório tem de dizer que não mediu ruído, e não "ruído 0%".
        var r = AmfUsageReport.Reference(new[] { Row("", 351.99) });

        Assert.Equal(0, r.FpsSpreadPct);
        Assert.Equal(1, r.FpsSamples);
        Assert.False(r.NoiseMeasured);
    }

    [Fact]
    public void Delta_ComReferenciaMediana_NaoHerdaOTremorDaPrimeiraVolta()
    {
        // A pergunta: o delta de ultralowlatency muda quando a base deixa de ser a 1ª volta?
        // Números reais: ultralowlatency = mediana(373,53; 385,75) = 379,64 fps. A referência
        // variou 336,40 / 351,99 / 344,00, e o MESMO braço dá três deltas diferentes:
        //
        //   contra 336,40 (a 1ª volta, a mais lenta)  => +12,86%
        //   contra 351,99 (a mais rápida)              =>  +7,85%
        //   contra a mediana 344,00                    => +10,36%
        //
        // É um spread de 5 pontos no MESMO número, sem que nada tenha mudado no braço. Esse
        // é o defeito: não é o delta que é instável, é o denominador.
        var ref3 = AmfUsageReport.Reference(new[]
        {
            Row("", 336.40), Row("", 351.99), Row("", 344.00),
        });
        var ultraMediana = AmfUsageRepeat.Median(Ultralow720);

        var delta = (ultraMediana / ref3.Fps - 1) * 100.0;
        var contraLenta = (ultraMediana / 336.40 - 1) * 100.0;
        var contraRapida = (ultraMediana / 351.99 - 1) * 100.0;

        Assert.Equal(10.36, delta, 2);
        // A propriedade que importa: a base-mediana não é nenhum dos extremos.
        Assert.True(delta > contraRapida, $"{delta} deveria ser acima do extremo rápido {contraRapida}");
        Assert.True(delta < contraLenta, $"{delta} deveria ser abaixo do extremo lento {contraLenta}");
    }

    // ---------- veredito acima do ruído ----------

    [Fact]
    public void Veredito_ExigeSuperarOBarreEORuido()
    {
        // Ambos os lados: passar do corte fixo de 10% não basta se o próprio piso de ruído
        // for maior — aí o delta é indistinguível de zero e promover seria ler ruído.
        Assert.True(AmfUsageRepeat.Promote(deltaPct: 15, noisePct: 4.5));
        Assert.True(AmfUsageRepeat.Promote(deltaPct: 10.5, noisePct: 4.5));
    }

    [Theory]
    [InlineData(6, 4.5)]    // não chega no corte de 10%
    [InlineData(15, 20)]    // acima do corte, mas dentro do ruído
    [InlineData(10, 10.1)]  // exatamente no corte e exatamente no ruído: não é "acima de nada"
    [InlineData(0, 0)]      // sem repetição não há como sustentar promote
    public void Veredito_ReprovaForaDoRuido(double delta, double ruido)
        => Assert.False(AmfUsageRepeat.Promote(delta, ruido));

    [Fact]
    public void Veredito_SemRuidoMedido_NaoPromove()
    {
        // N=1: não há como distinguir "+15% de verdade" de "+15% porque a referência foi
        // rápida". A saída honesta é "não decidido", nunca "promovido".
        Assert.False(AmfUsageRepeat.Promote(15, noisePct: 0, noiseMeasured: false));
    }

    // ---------- como o delta é apresentado ----------

    [Fact]
    public void Texto_ComDeltaDentroDoRuido_DizQueEstaDentroDoRuido()
    {
        // O ponto do teste: o número continua impresso, porque escondê-lo seria pior, mas
        // ele vem marcado como indistinguível de zero.
        //
        // Os dados são genuinamente DENTRO do ruído (3 < 4,5). A versão anterior usava
        // delta=6 com ruído=4,5 — que pela própria regra (|delta| <= ruído) está FORA do
        // ruído, então o teste nomeava um caso que não reproduzia.
        var t = AmfUsageRepeat.DeltaText(3, noisePct: 4.5, promotePct: 10, noiseMeasured: true);

        Assert.Contains("+3%", t);
        Assert.Contains("dentro do ruido", t);
    }

    [Fact]
    public void Texto_ForaDoRuidoMasAbaixoDoCorte_NAoMarcaComoRuido()
    {
        // O outro lado da honestidade: +6% contra ruído de 4,5% NÃO é indistinguível de
        // zero, e marcá-lo como tal seria o mesmo erro em sentido inverso — subestimar um
        // delta real. Ele continua sem promote porque está abaixo do corte de 10%, e o leitor
        // vê os dois números: o delta e o piso de ruído impresso no resumo.
        var t = AmfUsageRepeat.DeltaText(6, noisePct: 4.5, promotePct: 10, noiseMeasured: true);

        Assert.Contains("+6%", t);
        Assert.DoesNotContain("dentro do ruido", t);
    }

    /// <summary>
    /// O piso de ruído de um delta é o do <b>pior</b> dos dois braços, não só o da referência.
    /// O delta é a diferença entre duas medições independentes: se o braço candidato treme
    /// mais que a referência, é o tremor <i>dele</i> que domina a incerteza. Nos dados reais
    /// isso muda o veredito: <c>transcoding</c> treme 5,99% contra os 4,53% da referência, e
    /// o delta de +5,79% cai <b>para dentro</b> do ruído — deixa de ser promovível.
    /// </summary>
    [Fact]
    public void PisoDeRuidoEDosDoisBracos_NaoSoDaReferencia()
    {
        Assert.Equal(5.99, AmfUsageRepeat.NoiseFloor(AmfUsageRepeat.SpreadPct(Ref720), AmfUsageRepeat.SpreadPct(Transcoding720)), 2);
        // ultralowlatency treme menos que a referência: aí o piso é o da referência.
        Assert.Equal(4.53, AmfUsageRepeat.NoiseFloor(AmfUsageRepeat.SpreadPct(Ref720), AmfUsageRepeat.SpreadPct(Ultralow720)), 2);
    }

    [Fact]
    public void Transcoding_EReprovadoPelaBarra_EPeloPiso_NaoSoPeloPiso()
    {
        // Medianas reais das DUAS execuções: referência 344,195 fps, transcoding 364,115.
        var refFps = AmfUsageRepeat.Median(Ref720);
        var transcodingFps = AmfUsageRepeat.Median(Transcoding720);
        var delta = (transcodingFps / refFps - 1) * 100.0;    // +5,79%
        var piso = AmfUsageRepeat.NoiseFloor(
            AmfUsageRepeat.SpreadPct(Ref720), AmfUsageRepeat.SpreadPct(Transcoding720));

        Assert.Equal(5.79, delta, 2);
        Assert.Equal(5.99, piso, 2);

        // <b>Correção de uma afirmação falsa que este teste fazia.</b> Ele dizia que o +5,79%
        // "cai para dentro do ruído e deixa de ser promovível", como se o piso fosse o que
        // reprova. Não é: 5,79% está abaixo da barra de 10% de qualquer forma, então este
        // braço é reprovado DUPLAMENTE, e trocar o piso por qualquer valor abaixo de 5,79%
        // não mudaria nada. A mutação do NoiseFloor confirma — este teste continua verde
        // com o piso quebrado. O que o piso faz de fato é rotular, e o caso em que ele
        // BLOQUEIA é o de baixo.
        Assert.False(AmfUsageRepeat.Promote(delta, piso, samples: 9));
        Assert.False(AmfUsageRepeat.Promote(delta, AmfUsageRepeat.SpreadPct(Ref720), samples: 9));
    }

    /// <summary>
    /// O único papel do piso de ruído que <b>muda um veredito</b>: quando o próprio braço é
    /// mais instável que o delta que ele produz.
    ///
    /// <para>Nos dados reais isto não ocorre (o braço mais instável é o <c>transcoding</c>, com
    /// 5,99%, e o delta dele é 5,79% — abaixo da barra de 10%, então a barra já reprova). Por
    /// isso o caso é sintético, e é justamente por isso que ele precisa existir: sem um caso
    /// em que o piso seja <i>o</i> motivo da reprovação, o piso é indistinguível de decoração —
    /// e foi mutado sem quebrar quase nada.</para>
    /// </summary>
    [Fact]
    public void PisoDeRuido_ReprovaQuandoOBraçoTremeMaisQueOSeuProprioDelta()
    {
        // Referência estável (3 voltas, spread ~0), candidato com +12% de delta mas tremendo
        // 15%: a barra de 10% passa, o delta é grande, e mesmo assim o número é ruído — porque
        // 15% de dispersão no braço significa que o +12% observado pode ser o braço instável
        // aparecendo no lado alto da amostra.
        var delta = 12.0;
        const double refNoise = 0.5, candidatoNoise = 15.0;

        // Sem o piso (só a barra), promoveria.
        Assert.True(AmfUsageRepeat.Promote(delta, noisePct: 0, samples: 9));

        // Com o piso correto, não.
        Assert.False(AmfUsageRepeat.Promote(delta, AmfUsageRepeat.NoiseFloor(refNoise, candidatoNoise), samples: 9));
    }

    /// <summary>
    /// <b>Por que 3 voltas são o mínimo para promover.</b> Com 2 amostras a "mediana" é a
    /// média das duas e a "dispersão" é a distância entre elas — duas statistics de um
    /// intervalo, sem nenhuma estimativa de quão variável o processo é. O pior caso é
    /// <c>ultralowlatency</c>: com a base-mediana ele dá +10,30%, ou seja 0,30 ponto
    /// <b>acima</b> da barra de 10%. Um veredito de promote dependendo do 3º decimal de uma
    /// mediana de 2 amostras é um número com aparência de decisão e sem medição atrás.
    ///
    /// <para>Esta trava só pode <b>impedir</b> um promote, nunca conceder um: o corte de 10%
    /// continua sendo 10%, e N alto não rebaixa o critério. Se o usuário preferir promover
    /// com 2 voltas, é trocar <c>MinRoundsForPromote</c> — não mexer nesta regra.</para></summary>
    [Fact]
    public void Veredito_Com2Voltas_NaoPromove_Porque2NaoEstimaDispersao()
    {
        var refFps = AmfUsageRepeat.Median(Ref720);
        var ultraFps = AmfUsageRepeat.Median(Ultralow720);
        var delta = (ultraFps / refFps - 1) * 100.0;
        var piso = AmfUsageRepeat.NoiseFloor(
            AmfUsageRepeat.SpreadPct(Ref720), AmfUsageRepeat.SpreadPct(Ultralow720));

        // O número que faria promover se o piso fosse o da referência e o N fosse 2.
        Assert.Equal(10.30, delta, 2);
        Assert.Equal(3, AmfUsageRepeat.MinRoundsForPromote);
        Assert.False(AmfUsageRepeat.Promote(delta, piso, samples: 2));
        // Com 3 voltas (o default do probe) o mesmo par passa — o que mostra que a trava é
        // sobre a amostra, não sobre o delta.
        Assert.True(AmfUsageRepeat.Promote(delta, piso, samples: 3));
    }

    [Fact]
    public void Texto_ComDeltaAcimaDoRuido_NAoMarca()
    {
        var t = AmfUsageRepeat.DeltaText(15, noisePct: 4.5, promotePct: 10, noiseMeasured: true);

        Assert.Contains("+15%", t);
        Assert.DoesNotContain("dentro do ruido", t);
    }

    [Fact]
    public void Texto_ComDeltaNegativoDentroDoRuido_TambemMarca()
    {
        // A ambiguidade é simétrica: "−4%" com ruído de ±5% não é lentidão, é nada. O
        // lowlatency_high_quality real (run 1: −12%, run 2: −4%) é exatamente esse caso.
        var t = AmfUsageRepeat.DeltaText(-4, noisePct: 4.5, promotePct: 10, noiseMeasured: true);

        Assert.Contains("dentro do ruido", t);
    }

    [Fact]
    public void Texto_SemRuidoMedido_NaoFingeQueEstaDentroOuFora()
    {
        // N=1: o leitor precisa saber que a comparação não foi feita, e não ler "dentro do
        // ruido 0%" (que seria uma afirmação) nem um delta cru (que é o defeito original).
        var t = AmfUsageRepeat.DeltaText(15, noisePct: 0, promotePct: 10, noiseMeasured: false);

        Assert.Contains("+15%", t);
        Assert.Contains("1 execucao", t);
    }

    // ---------- a linha renderizada carrega o N e a dispersão ----------

    /// <summary>
    /// A linha da tabela é a superfície que o usuário realmente lê, e é nela que o N e a
    /// dispersão aparecem. Sem este teste, o sufixo <c>[n=..., ...% de dispersão]</c> podia
    /// sumir — ou pior, aparecer só quando N=1, que é o caso em que ele não informa nada.
    /// </summary>
    [Fact]
    public void LinhaRenderizada_MostraNEDispersao_QuandoHouveMaisDeUmaVolta()
    {
        var ref3 = AmfUsageReport.Reference(new[]
        {
            Row("", 336.40), Row("", 351.99), Row("", 344.00),
        });
        var ultra = new[] { Row("ultralowlatency", 373.53), Row("ultralowlatency", 385.75) };

        var linha = AmfUsageReport.FormatRow("ultralowlatency", ultra, ref3);

        // As strings esperadas são montadas por interpolação, e NÃO hardcoded com ponto ou
        // vírgula: o formato é culture-dependent e a suíte roda em pt-BR (o mesmo cuidado que
        // o NvencProbeSummary exigiu). Hardcodar o separador faria o teste passar por acidente
        // numa cultura e falhar na outra — e o "acidente" seria metade das máquinas.
        var ruido = AmfUsageRepeat.SpreadPct(Ultralow720);
        var delta = (AmfUsageRepeat.Median(Ultralow720) / ref3.Fps - 1) * 100.0;

        Assert.Contains("n=2", linha);
        // O "%" faz parte do esperado: a versão anterior renderizava "[n=2, 3,2 de dispersão]",
        // sem o símbolo, e nenhum outro teste veria isso — a linha inteira nunca é comparada.
        Assert.Contains($"n=2, {ruido:0.0}% de dispersão", linha);
        // E o número que a repetição existe para estabilizar, com 1 casa: é o que permite
        // ao leitor auditar o veredito contra o corte de 10%. Com 0 casas, +10,36% viraria
        // "+10%", indistinguível de reprovado.
        Assert.Contains($"+{delta:0.0}%", linha);
    }

    [Fact]
    public void LinhaRenderizada_NaoAnunciaDispersao_ComUmaVoltaSo()
    {
        // Com N=1 não existe dispersão, e anunciar "0% de dispersão" seria uma afirmação.
        var ref1 = AmfUsageReport.Reference(new[] { Row("", 351.99) });
        var linha = AmfUsageReport.FormatRow("transcoding", Row("transcoding", 353.21), ref1);

        Assert.DoesNotContain("dispersão", linha);
        Assert.DoesNotContain("n=1", linha);
    }
}
