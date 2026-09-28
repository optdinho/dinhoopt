namespace DiNho.Capture.Poc.Encoders;

/// <summary>Critérios do audit AMD, <b>travados em teste</b> antes de qualquer medição.</summary>
public static class AmdAuditCriteria
{
    /// <summary>Variação mínima de bytes na escada para o knob ser considerado obedecido.
    /// Abaixo de 1,02 o encoder praticamente ignorou o alvo.</summary>
    public const double HonoredSpanRatio = 1.30;

    /// <summary>Variação máxima para considerar o knob <b>ignorado</b>. Entre
    /// <see cref="IgnoredSpanRatio"/> e <see cref="HonoredSpanRatio"/> é zona cinzenta e o
    /// relatório imprime o número sem cravar causa.</summary>
    public const double IgnoredSpanRatio = 1.02;

    /// <summary>Desvio relativo tolerado no fator AMF antes de chamar de suspeito.
    /// 25% porque abaixo disso a diferença não é separável do conteúdo sintético.</summary>
    public const double FactorTolerance = 0.25;

    /// <summary>Spread mínimo de VMAF na curva AMF para ela poder falar do fator. Abaixo
    /// disso os pontos não distinguem taxa de qualidade: o encoder não quis mais bits e a
    /// calibração é <b>não medível</b>, não "boa". Ver <c>CurvaAmfChapada_NaoPodeDeclarar
    /// OFatorPlausivel</c>.</summary>
    /// <remarks>1.0 de VMAF ≈ 1% de qualidade perceptível — abaixo disso a diferença é
    /// ruído de codificação, e tratar ruído como sinal é o que produz "calibrado" falso.</remarks>
    public const double MinCurveSpreadVmaf = 1.0;

    /// <summary>Fator nominal que <c>FfmpegEncoder.ComputeAmfTargetKbps</c> promete:
    /// alvo = clamp(round(maxrate × 0.36), 6000, 50000).
    ///
    /// <para>Existe aqui para o relatório citar a mesma fonte de verdade que o código
    /// executa. A primeira versão escrevia "0.36" em três templates de string, e isso
    /// produzia uma mentira específica: num <c>maxrate</c> onde o clamp morde, o fator
    /// <b>real</b> é 0.500, o texto dizia "fator 0.500" e em seguida afirmava que o 0.36
    /// entregou aquilo. O leitor recebia a autoria do resultado atribuda a um número que
    /// não rodou.</para></summary>
    public const double ProductionFactor = 0.36;
}

/// <summary>
/// Critérios do A/B <c>CQP vs 0,36</c> (<c>--probe-amf-cqp</c>), <b>travados em teste antes
/// de medir</b>.
///
/// <para>Existe pela mesma razão do <c>main10</c> (Item 9): o caso perigoso é decidir a
/// promoção com o número já na mão, porque aí o critério vira função do resultado. O
/// "<c>&gt;= 5% de bytes no mesmo VMAF</c>" foi fixado pelo usuário antes da medição, e
/// estes dois campos são onde esse texto vira código — o relatório não pode citar um número
/// diferente do que o judge usou.</para>
/// </summary>
public static class AmdCqpCriteria
{
    /// <summary>Economia mínima de bytes para promover o CQP. Positivo: o veredito mede
    /// <c>(cqp - producao) / producao × 100</c>, então a vitória é <c>&lt;= -5</c>.</summary>
    public const double MinByteWinPct = 5.0;

    /// <summary>Perda máxima de fps tolerada na troca. Mesmo 5% por simetria com a economia:
    /// um preset 20% mais lento com 6% menos bytes troca qualidade por teto de gravação, e
    /// essa é decisão do usuário, não do probe.</summary>
    public const double MaxFpsLossPct = 5.0;
}

/// <summary>Por que uma calibração ficou <see cref="AmdCalibrationState.Unmeasured"/>.
///
/// <para>Existe porque a primeira versão deduzia a causa de um número: se houvesse algum
/// VMAF medido, a culpa era "curva chapada". Com o alvo VMAF desconhecido o judge grava o
/// melhor VMAF observado justamente para não perder dado, o número vinha > 0, e o
/// relatório anunciava "a curva não variou com a taxa" — que é uma afirmação sobre a AMF
/// quando na verdade nenhum alvo existia para comparar. O conserto certo não é afinar a
/// dedução, é escrever a causa no momento em que ela é conhecida.</para></summary>
public enum AmdUnmeasuredCause
{
    /// <summary>Calibração medida; sem causa aplicável.</summary>
    None,

    /// <summary>O encode de produção não rodou: sem arquivo, sem calibração.</summary>
    ProductionFailed,

    /// <summary>Não sobrou ponto utilizável em nenhuma das duas famílias.</summary>
    NoPoints,

    /// <summary>O x264 no CQ do usuário não mediu, então não há alvo VMAF com o qual
    /// comparar. Todo ponto "atinge" o alvo 0 e o fator fica livre.</summary>
    UnknownTarget,

    /// <summary>A curva AMF não variou o bastante para falar de taxa.</summary>
    FlatCurve,
}

/// <summary>
/// Estado de um encode do audit. <b>Quatro estados, não dois</b>, porque "não existe",
/// "existe e recusou" e "não medido" levam a consertos completamente diferentes:
/// o primeiro é limitação de hardware, o segundo é bug de args, o terceiro é problema da
/// máquina de medição — e o roteiro <c>4-medir-D3D12VA-AMD.bat</c> já confundiu os dois
/// últimos ao imprimir veredito a partir de arquivos de 0 byte.
/// </summary>
public enum AmdProbeState
{
    /// <summary>O binário não lista o encoder. Fato, não veredito.</summary>
    NotPresent,

    /// <summary>Listado, o probe rodou, e o encoder não produziu arquivo.</summary>
    /// <summary>Listado, o probe chegou ao fim, e não saiu um arquivo utilizável
    /// (0 bytes, ou exit code != 0 mesmo com bytes).</summary>
    Refused,

    /// <summary>Produziu arquivo inteiro: processo terminou e saiu com 0.</summary>
    Works,

    /// <summary><b>Nosso harness</b> não conseguiu concluir a medição (timeout, exceção ao
    /// lançar o processo, ffmpeg ausente). Distingue-se de <see cref="Refused"/> por quem
    /// falhou: aqui fomos nós, lá foi o encoder. Antes estes dois docs diziam "arquivo
    /// ausente", que é o mesmo caso — e o relatório passava a chamar de "não medido" um
    /// encoder que tinha acabado de recusar na cara.</summary>
    Unmeasured,

    /// <summary>O audit <b>não tenta</b> esta família, porque medir aqui mediria o harness e
    /// não o encoder.
    ///
    /// <para>Existe por causa do <c>d3d12va</c>. Ele exige frames no pixel format
    /// <c>d3d12</c> via <c>hwupload</c> com referência de device, e o <c>:</c> do
    /// <c>dev:0</c> é separador de filtro no ffmpeg 9: as três formas tentadas
    /// (<c>hwupload=dev:0</c>, <c>dev\:0</c>, <c>d3d12va@0</c> + <c>-filter_hw_device</c>)
    /// falham <b>antes</b> de tocar o encoder. Reportar isso como <c>Refused</c> publicaria
    /// uma causa falsa — "esse encoder não funciona aqui" — quando o que não funciona é a
    /// invocação do audit. <c>Refused</c> continua reservado para recusa real do encoder
    /// (AMF sem <c>amfrt64.dll</c>, QSV sem sessão MFX, d3d12va com device mas sem
    /// <c>-rc 1</c> válido).</para></summary>
    NotAudited,
}

/// <summary>Veredito de um knob: o encoder obedece, ignora, ou o número não separa.</summary>
public enum AmdKnobState
{
    Honored,
    Ignored,

    /// <summary>Entre os dois limites. Reportar o número, não cravar.</summary>
    Inconclusive,
    Unmeasured,
}

/// <summary>Veredito da calibração CQ→bitrate da AMF.</summary>
public enum AmdCalibrationState
{
    /// <summary>A AMF de produção nem rodou: sem número, sem sugestão.</summary>
    Unmeasured,

    /// <summary>O 0,36 de produção está dentro da tolerância do medido.</summary>
    FactorPlausible,

    /// <summary>Medido e fora da tolerância: há um número a promover.</summary>
    FactorSuspect,

    /// <summary>Nenhum bitrate da curva AMF alcança o VMAF alvo. <b>Mais bitrate não
    /// resolve</b> — o conserto é outro (RC diferente, ou trocar de encoder).</summary>
    TargetUnreachable,
}

/// <summary>Resultado bruto de um encode do audit. <see cref="Completed"/> é o que separa
/// "recusou" de "não mediu", e <see cref="Listed"/> o que separa "não existe" dos dois.</summary>
public readonly record struct AmdEncodeOutcome(
    string Label,
    bool Listed,
    bool Completed,
    long OutputBytes,
    double Seconds,
    int Frames,
    string StderrTail,
    /// <summary>Exit code do ffmpeg. <b>Precisa existir</b> porque o ffmpeg pode sair com
    /// erro depois de já ter escrito parte do arquivo: sem este campo, um encode truncado
    /// contaria como <c>Works</c> e o relatório publicaria VMAF e tamanho medidos de lixo.</summary>
    int ExitCode = 0,
    /// <summary>O runner decidiu não tentar esta linha. Vira <see cref="AmdProbeState.NotAudited"/>
    /// e é o que impede o relatório de trocar "não sei medir" por "o encoder recusou".</summary>
    bool Skipped = false)
{
    /// <summary>Alvo de bitrate que o runner <b>pediu</b> para este rung, em kbps. 0 quando a
    /// linha não tem alvo (a matriz de encoders, a escada de <c>-quality</c>).
    ///
    /// <para>Este campo não existia, e o relatório imprimia <see cref="Kbps"/> — a taxa
    /// <i>conquistada</i> — numa coluna intitulada "alvo de bitrate pedido". O resultado é
    /// que o número que o leitor usaria para comparar "pedi X, entregue Y" era o Y com o
    /// rótulo do X: um rung saturado (pediu 3 600, entregou 34 411) aparecia como
    /// "alvo 34411 kbps", e era a saturação — justamente o achado mais importante da S2 —
    /// que ficava invisível, porque o número impresso batia com o pedido.</para></summary>
    public int RequestedKbps { get; init; }
    public AmdProbeState State => AmdAuditVerdicts.JudgeEncoderState(this);

    /// <summary>Quadros por segundo efetivos (frames / segundos de encode), ou 0 se não
    /// houve arquivos suficientes para medir.</summary>
    public double Fps => Seconds > 0 && OutputBytes > 0 ? Frames / Seconds : 0;

    /// <summary>Taxa **conquistada**, em kbps, medida contra a duração nominal do clipe
    /// (frames / fps de origem) e não contra o wall-clock do processo.
    ///
    /// <para>Esta é a correção de uma classe que o próprio projeto já resolveu uma vez: em
    /// <c>EncoderManager.EncodeProbeResult</c> está escrito, em comentário, que "medir contra
    /// o wall-clock dá número sem sentido". O mesmo erro estava aqui, e a consequência era
    /// pior que um número inflado: a coluna da S2a é rotulada <b>alvo</b>, e ela imprimia o
    /// resultado. Um rung saturado que pediu 10 800 e conseguiu 71 000 aparecia como
    /// "alvo 71000 kbps" — o sinal mais forte de saturação renderizado como se fosse o
    /// pedido, e é exatamente o número que o leitor usaria para decidir entre saturação e
    /// no-op. Medido aqui: um encode que rodou a 1,55× realtime era reportado 55% acima da
    /// taxa real do arquivo.</para>
    ///
    /// <para>Por isso o <c>NominalSeconds</c> entra no outcome: o runner sabe os frames e o
    /// fps de origem, e só ele pode saber a duração que o clipe <i>deveria</i> ter.</para></summary>
    public double Kbps
    {
        get
        {
            var nominal = NominalSeconds > 0 ? NominalSeconds : Seconds;
            return nominal > 0 ? OutputBytes * 8.0 / nominal / 1000.0 : 0;
        }
    }

    /// <summary>Duração nominal do clipe em segundos (frames / fps da fonte). 0 quando o
    /// runner não a informou, e aí o <see cref="Kbps"/> cai no wall-clock.</summary>
    public double NominalSeconds { get; init; }
}

/// <summary>Ponto (bitrate, VMAF) de uma curva de taxa-distorção.</summary>
public readonly record struct AmdVmafPoint(string Label, double TargetKbps, double Vmaf, long Bytes);

/// <summary>Ponto da escada de <c>-quality</c> da AMF. <see cref="Completed"/> é o estado
/// <b>julgado</b> (exit 0 + bytes), não o flag cru — o runner monta o rung assim de
/// propósito. Confundir os dois é o que deixa um rung truncado ser escolhido como
/// "o melhor preset que sustenta".</summary>
public readonly record struct AmdLadderPoint(string Preset, double Fps, bool Completed);

/// <summary>Veredito da calibração, com os números que o relatório precisa imprimir.</summary>
public readonly record struct AmdCalibrationVerdict(
    AmdCalibrationState State,
    double ProductionFactor,
    double? SuggestedFactor,
    double? SuggestedAmfKbps,
    string? MatchingX264Crf,
    double TargetVmaf,
    double BestAmfVmaf,
    AmdUnmeasuredCause Cause = AmdUnmeasuredCause.None)
{
    /// <summary>O fator que a produção realmente usou difere do
    /// <see cref="AmdAuditCriteria.ProductionFactor"/> porque o clamp de 6000..50000 mordeu.
    ///
    /// <para>É o que impede o relatório de atribuir ao 0.36 um resultado que o 0.36 não
    /// produziu: com <c>maxrate</c> ≤ 16 667 o clamp de fundo é quem manda, e o fator
    /// efetivo chega a 0.500. Quem leu a versão anterior viu "fator 0.500" e logo abaixo
    /// "o 0.36 entrega isso" — a autoria do número estava errada na direção que faz o
    /// 0.36 parecer validado justamente quando ele não foi testado.</para></summary>
    public bool ProductionFactorClamped => Math.Abs(ProductionFactor - AmdAuditCriteria.ProductionFactor) > 0.001;
}

/// <summary>Veredito da escada adaptativa. <see cref="MeetsCodeThreshold"/> e
/// <see cref="SustainsTarget"/> são separados de propósito: o código aceita 85% do alvo
/// (51 fps para 60), o que pode ser folga deliberada para a captura — mas é um número que
/// precisa aparecer, não um "OK".</summary>
public readonly record struct AmdLadderVerdict(
    AmdProbeState State,
    string ChosenPreset,
    double ChosenFps,
    double TargetFps,
    bool MeetsCodeThreshold,
    bool SustainsTarget)
{
    /// <summary>Fps que o código de produção aceita (85% do alvo). É derivado do mesmo
    /// 0.85 que <c>JudgeLadder</c> usa, para o relatório não poder citar um número
    /// diferente do que o judge decidiu.</summary>
    public double AcceptedFps => TargetFps * 0.85;
}

/// <summary>Veredito de custo em bytes (GOP 60, b-frames).</summary>
public readonly record struct AmdByteCostVerdict(double CostPct, bool IsNegligible, string Verdict);

/// <summary>Veredito do A/B entre a chain AMF de produção e a cadeia CQP.</summary>
public enum AmdCqpState
{
    /// <summary>Nada utilizável foi medido em uma das pontas. <b>Nunca</b> promove: é o estado
    /// que impede o relatório de recomendar uma troca a partir de um probe que não rodou.</summary>
    Unmeasured,

    /// <summary>O melhor CQP medido ficou <b>abaixo</b> do VMAF da produção. Não é "CQP é
    /// pior em bytes" — as duas pontas não estão na mesma qualidade, e comparar bytes entre
    /// elas produz uma economia que não existe. <see cref="AmdCqpVerdict.BestCqpVmaf"/>
    /// existe para o relatório dizer quantos pontos faltaram.</summary>
    CannotMatch,

    /// <summary>Atende as duas pernas: >= 5% menos bytes no VMAF da produção ou mais, sem
    /// perder mais de 5% de fps.</summary>
    Promotes,

    /// <summary>Medido, comparável, e não ganhou o bastante (ou o preço em fps não foi
    /// aceito). É este o resultado que mantém a produção como está.</summary>
    KeepsProduction,
}

/// <summary>Ponto de uma curva do A/B CQP: um encode medido, com a qualidade e o custo que
/// importam para a comparação.</summary>
/// <param name="Label">Identidade do rung, para o relatório citar ("qp18", "0.36").</param>
/// <param name="Vmaf">VMAF contra a fonte. <b>0 = não medido</b>, e o judge descarta o
/// ponto: ver <c>JudgeAmfCqp</c>.</param>
/// <param name="Bytes">Tamanho do arquivo. <b>0 = não medido</b>, mesma regra.</param>
/// <param name="Fps">Quadros por segundo efetivos. <b>0 = não medido</b>, e aí o critério de
/// fps não é avaliado (ver <see cref="AmdCqpVerdict.FpsMeasured"/>).</param>
public readonly record struct AmdCqpPoint(string Label, double Vmaf, long Bytes, double Fps);

/// <summary>Veredito do A/B CQP, com os números que o relatório precisa imprimir.
///
/// <para><see cref="ByteDeltaPct"/> é negativo quando o CQP economiza. A âncora é
/// <b>sempre</b> o VMAF da produção: sem isso a comparação vira "CQP no mesmo QP contra 0,36
/// no mesmo maxrate", que são qualidades diferentes, e o ponto mais barato da curva CQP
/// vence por ser pior.</para>
/// </summary>
public readonly record struct AmdCqpVerdict(
    AmdCqpState State,
    double AnchorVmaf,
    double BestCqpVmaf,
    long ProductionBytes,
    long CqpBytes,
    double ByteDeltaPct,
    double ProductionFps,
    double CqpFps)
{
    /// <summary>Rung CQP escolhido (o mais barato que <i>atinge</i> a âncora). Nulo quando
    /// nada foi comparável.</summary>
    public string? ChosenCqpLabel { get; init; }

    /// <summary>Os dois lados tiveram fps medido? Enquanto falso, o relatório não pode
    /// dizer que o CQP "não custou desempenho" — só que a pergunta não foi respondida.</summary>
    public bool FpsMeasured => ProductionFps > 0 && CqpFps > 0;

    /// <summary>Delta de fps em %, negativo = CQP mais lento. 0 quando não medido, com
    /// <see cref="FpsMeasured"/> falso para não ser lido como "empate".</summary>
    public double FpsDeltaPct => FpsMeasured ? (CqpFps - ProductionFps) * 100.0 / ProductionFps : 0;

    /// <summary>O CQP economiza pelo menos <see cref="AmdCqpCriteria.MinByteWinPct"/>?
    /// Em <see cref="AmdCqpState.Unmeasured"/> os bytes são 0 e o delta é 0, então isto é
    /// falso por construção — o estado enumérico e o número concordam.</summary>
    public bool ByteWin => ByteDeltaPct <= -AmdCqpCriteria.MinByteWinPct;

    /// <summary>A perda de fps cabe no orçamento. Fps não medido <b>não</b> reprova: travar
    /// aqui deixaria um encode que perdeu a medição de fps vetar uma economia de bytes real.
    /// A lacuna fica explícita em <see cref="FpsMeasured"/>.</summary>
    public bool FpsAcceptable => !FpsMeasured || FpsDeltaPct >= -AmdCqpCriteria.MaxFpsLossPct;
}


/// <summary>
/// Regras de decisão do <c>--audit-amd</c>. Funções puras de propósito: a máquina AMD não
/// existe aqui, então a única parte do audit que dá para testar é a regra que vai ler o
/// número que vier de lá.
/// </summary>
public static class AmdAuditVerdicts
{
    /// <summary>S1 — classifica um encode. Regra única, sem exceção: <b>bytes = 0 é
    /// <c>Refused</c>, nunca <c>Works</c> e nunca <c>Unmeasured</c></b> (desde que o probe
    /// tenha concluído). Foi exatamente o furo do roteiro 4, que printou "o -qp tem
    /// autoridade" a partir de saídas zeradas porque <c>if errorlevel 1</c> não pega exit
    /// negativo do ffmpeg.</summary>
public static AmdProbeState JudgeEncoderState(AmdEncodeOutcome o)
{
    if (o.Skipped) return AmdProbeState.NotAudited;
    if (!o.Listed) return AmdProbeState.NotPresent;
    if (!o.Completed) return AmdProbeState.Unmeasured;

    // Exit code 0 E bytes: só aí o arquivo é um encode inteiro. Ver o comentário de
    // ExitCode no record - sem isso um encode truncado vira WORKS com número inventado.
    return o.ExitCode == 0 && o.OutputBytes > 0 ? AmdProbeState.Works : AmdProbeState.Refused;
}

    /// <summary>S2 — o knob tem autoridade? Compara a spread de bytes na escada
    /// (<c>max/min</c>), não o crescimento par a par: assim o mesmo judge serve para
    /// <c>-b:v</c> e para a escada de <c>-quality</c>, e não depende da ordem das amostras.
    ///
    /// <para><b>Ressalva honesta (a lição do Item 2):</b> tamanho igual pode significar
    /// "knob ignorado" <i>ou</i> "conteúdo exige mais que todos os alvos medidos" — no
    /// segundo caso o teto do VBV não aperta e o número sobe. Por isso o relatório sempre
    /// imprime os kbps de cada degrau: quem lê decide se foi saturação ou no-op. O judge
    /// só evita cravar a causa.</para></summary>
    public static AmdKnobState JudgeScaling(IReadOnlyList<AmdEncodeOutcome> samples)
    {
        if (samples.Count < 2) return AmdKnobState.Unmeasured;
    // Usa o MESMO estado do judge de encoder, e não `Completed` + bytes. `Completed` é o
    // flag cru do runner: o ffmpeg pode sair != 0 DEPOIS de escrever metade do arquivo, e
    // aí `Completed == true` com `OutputBytes > 0` passava o filtro. O rung truncado entrava
    // na spread de bytes e fazia a taxa parecer autorizada quando o encoder morreu no meio.
    // O caso interessante (saturação) sai com exit 0 e continua entrando, então isto não
    // muda nenhum veredito legítimo.
    foreach (var s in samples)
    {
        if (JudgeEncoderState(s) != AmdProbeState.Works) return AmdKnobState.Unmeasured;
    }


        var min = samples.Min(s => s.OutputBytes);
        var max = samples.Max(s => s.OutputBytes);
        if (min <= 0) return AmdKnobState.Unmeasured;

        var span = (double)max / min;
        if (span >= AmdAuditCriteria.HonoredSpanRatio) return AmdKnobState.Honored;
        if (span <= AmdAuditCriteria.IgnoredSpanRatio) return AmdKnobState.Ignored;
        return AmdKnobState.Inconclusive;
    }

    /// <summary>S3 — calibração do fator <c>0,36</c>.
    ///
    /// <para><b>O que cada número significa.</b> <paramref name="targetVmaf"/> é o VMAF do
    /// x264 no <b>CQ que o usuário escolheu</b> — ou seja, a qualidade que o número da UI
    /// promete. A curva AMF diz qual bitrate entrega esse VMAF. A razão entre esse bitrate e
    /// o <paramref name="productionMaxrateKbps"/> é o fator corrigido.</para>
    ///
    /// <para><b>Por que <see cref="AmdCalibrationState.TargetUnreachable"/> é um estado
    /// próprio.</b> Se nem o ponto mais alto da curva AMF alcança o alvo, sugerir "passe mais
    /// bitrate" seria mentira: o Item 8 já mostrou o caso onde <c>-rc vbr_peak</c> descarta
    /// <c>qp</c> em silêncio, e aí nenhum <c>-b:v</c> conserta. Esse estado diz ao usuário
    /// que o problema é o modo de RC, não a taxa.</para></summary>
    public static AmdCalibrationVerdict JudgeCalibration(
        AmdEncodeOutcome production,
        IReadOnlyList<AmdVmafPoint> amfCurve,
        IReadOnlyList<AmdVmafPoint> x264Sweep,
        double targetVmaf,
        double productionMaxrateKbps)
    {
        var productionFactor = productionMaxrateKbps > 0
            ? Math.Round(amfTargetFor(productionMaxrateKbps) / productionMaxrateKbps, 3)
            : 0;

        if (production.State != AmdProbeState.Works)
        {
            return new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, productionFactor, null, null, null, targetVmaf, 0, AmdUnmeasuredCause.ProductionFailed);
        }

        var usableAmf = amfCurve.Where(p => p.Bytes > 0).ToList();
        var usableX264 = x264Sweep.Where(p => p.Bytes > 0).ToList();
        if (usableAmf.Count == 0 || usableX264.Count == 0)
        {
            return new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, productionFactor, null, null, null, targetVmaf, 0, AmdUnmeasuredCause.NoPoints);
        }

        // Alvo desconhecido (o x264 no CQ do usuário não mediu) não é o mesmo que alvo baixo:
        // com target 0 todo ponto "atinge", e o judge escolheria o mais barato e chamaria de
        // plausível. Sem alvo não há calibração possível.
        //
        // A causa é UnknownTarget, e não FlatCurve: o VMAF máximo é devolvido aqui de
        // propósito (é dado real, não lixo) e o relatório da versão anterior lia esse
        // número > 0 e deduzia "a curva não variou" — blaming na AMF por uma falha que era
        // do x264.
        if (targetVmaf <= 0)
        {
            return new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, productionFactor, null, null, null, 0, usableAmf.Max(p => p.Vmaf), AmdUnmeasuredCause.UnknownTarget);
        }

        // Curva chapada = o encoder nunca quis mais bits, então os pontos não distinguem taxa
        // de qualidade e o fator é **não medível**. Sem este guard o judge escolhia o ponto
        // mais barato que "atinge" o alvo — que era o ponto de produção — e declarava o 0.36
        // plausível usando os dados que não falam do 0.36. Achado no smoke test: mandelbrot
        // com 3 bitrates diferentes deu VMAF 96.50 nos três.
        var amfSpread = usableAmf.Max(p => p.Vmaf) - usableAmf.Min(p => p.Vmaf);
        if (amfSpread < AmdAuditCriteria.MinCurveSpreadVmaf)
        {
            return new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, productionFactor, null, null, null, targetVmaf, usableAmf.Max(p => p.Vmaf), AmdUnmeasuredCause.FlatCurve);
        }

        // Qual CRF do x264 equivale ao VMAF que a produção AMF entregou? É a frase que
        // traduz o número para quem decide ("CQ 20 na AMD equivale a CRF 24 no x264").
        string? matchingCrf = null;
        if (production.Kbps > 0)
        {
            // VMAF do ponto de produção: procura na curva AMF o ponto de bitrate mais próximo
            // do alvo real de produção e usa o seu VMAF como proxy do que a produção entregou.
            var productionTarget = amfTargetFor(productionMaxrateKbps);
            var nearest = usableAmf.OrderBy(p => Math.Abs(p.TargetKbps - productionTarget)).First();
            var productionVmaf = nearest.Vmaf;
            matchingCrf = usableX264
                .OrderBy(p => Math.Abs(p.Vmaf - productionVmaf))
                .First()
                .Label;
        }

        // Menor bitrate que ATINGE o alvo. Testar só o ponto mais próximo erra nos dois
        // sentidos: com pontos em 91 e 95 e alvo 92, o mais próximo é 91 (abaixo) e o judge
        // diria "inalcançável" existindo um ponto que alcança — que é a decisão que muda a
        // recomendação de "mude o RC" para "passe mais bitrate".
        var reaching = usableAmf.Where(p => p.Vmaf >= targetVmaf)
            .OrderBy(p => p.TargetKbps)
            .ToList();
        var bestVmaf = usableAmf.Max(p => p.Vmaf);
        if (reaching.Count == 0)
        {
            // Nenhum bitrate testado chega no alvo: saturou. Não há fator a promover.
            return new AmdCalibrationVerdict(
                AmdCalibrationState.TargetUnreachable, productionFactor, null, null, matchingCrf, targetVmaf, bestVmaf);
        }

        var suggestedKbps = reaching[0].TargetKbps;
        var suggestedVmaf = reaching[0].Vmaf;
        var suggestedFactor = productionMaxrateKbps > 0
            ? Math.Round(suggestedKbps / productionMaxrateKbps, 3)
            : 0;
        var relative = productionFactor > 0 ? Math.Abs(suggestedFactor - productionFactor) / productionFactor : 1;
        var state = relative > AmdAuditCriteria.FactorTolerance
            ? AmdCalibrationState.FactorSuspect
            : AmdCalibrationState.FactorPlausible;

        return new AmdCalibrationVerdict(
            state, productionFactor, suggestedFactor, suggestedKbps, matchingCrf, targetVmaf, suggestedVmaf);
    }

    /// <summary>S4 — a escada escolheu um preset que segura 60fps? Reporta os dois
    /// critérios (o de 85% do código e o de 60 real) sem decidir entre eles: mudar o
    /// limiar de seleção é decisão de produto, e o audit só entrega o número.</summary>
    public static AmdLadderVerdict JudgeLadder(
        IReadOnlyList<AmdLadderPoint> points,
        string chosen,
        double targetFps,
        double codeAcceptRatio)
    {
        var chosenPoint = points.FirstOrDefault(p => p.Preset == chosen);
        // `AmdLadderPoint.Completed` JÁ é o estado julgado (o runner monta o rung com
    // `o.State == Works`, que checa exit code e bytes) — diferente do
    // `AmdEncodeOutcome.Completed`, que é o flag cru. Não trocar por um
    // `JudgeEncoderState` aqui: o outcome nem existe neste record.
    if (chosenPoint.Preset == null || !chosenPoint.Completed)
        {
            return new AmdLadderVerdict(AmdProbeState.Unmeasured, chosen, 0, targetFps, false, false);
        }

        var meets = chosenPoint.Fps >= targetFps * codeAcceptRatio;
        var sustains = chosenPoint.Fps >= targetFps;
        return new AmdLadderVerdict(AmdProbeState.Works, chosen, chosenPoint.Fps, targetFps, meets, sustains);
    }

    /// <summary>S6 — custo em bytes de uma decisão (GOP 60, b-frames) na AMF. Baseline
    /// zerado é UNMEASURED, nunca divisão por zero nem "custo infinito".</summary>
    public static AmdByteCostVerdict JudgeByteCost(long baselineBytes, long variantBytes, double negligiblePct)
    {
        if (baselineBytes <= 0 || variantBytes <= 0)
        {
            return new AmdByteCostVerdict(0, false, "unmeasured");
        }

        var pct = (variantBytes - baselineBytes) * 100.0 / baselineBytes;
        var negligible = Math.Abs(pct) < negligiblePct;
        return new AmdByteCostVerdict(Math.Round(pct, 2), negligible, negligible ? "negligible" : "material");
    }

    /// <summary>
    /// A/B da chain AMF: <c>CQP</c> contra o <c>0,36</c> de produção, no VMAF da produção.
    ///
    /// <para><b>A regra, em uma frase:</b> entre os pontos CQP que <i>alcançam ou superam</i>
    /// o VMAF da produção, vence o mais barato; e o CQP só é promovido se esse ponto custar
    /// pelo menos <see cref="AmdCqpCriteria.MinByteWinPct"/> menos bytes sem perder mais de
    /// <see cref="AmdCqpCriteria.MaxFpsLossPct"/> de fps.</para>
    ///
    /// <para><b>Por que "alcançam" e não "o QP do usuário".</b> A primeira versão deste judge
    /// comparava o ponto CQP do QP do usuário contra a produção, e o resultado teria sido uma
    /// economia de 43% que era na verdade <b>5,4 pontos de VMAF mais ruim</b> — a família que
    /// perde em qualidade vence a conta de bytes. É a mesma classe de erro do <c>main10</c>
    /// (Item 9) e do <c>-rc vbr_peak</c> (Item 8): o número sai bonito e significa o
    /// contrário do que a frase diz. Por isso a curva CQP é medidas em mais de um QP: sem
    /// isso não existe ponto para casar com a qualidade da produção.</para>
    ///
    /// <para><b>Por que a referência é o encode de produção, não o melhor degrau da
    /// varredura.</b> A varredura de bitrate existe para descrever a curva do encoder; o que
    /// o CQP substituiria é o rung que a captura usa hoje. Comparar contra o melhor degrau
    /// seria exigir mais do que a troca real exige, e o veredito poderia reprovar uma
    /// economia de 20%.</para>
    ///
    /// <para><b>Ponto não medido é descartado, nunca comparado.</b> VMAF 0 ou bytes 0 tiram o
    /// rung da curva. Tratá-los como número produziria as duas conclusões erradas que o
    /// projeto já pagou: VMAF 0 lido como "qualidade 0" faria o CQP parecer altíssimo e
    /// promover; e "sem bytes" divideria por zero.</para>
    /// </summary>
    public static AmdCqpVerdict JudgeAmfCqp(AmdCqpPoint production, IReadOnlyList<AmdCqpPoint> cqp)
    {
        if (!usable(production))
        {
            return new AmdCqpVerdict(AmdCqpState.Unmeasured, 0, 0, 0, 0, 0, 0, 0);
        }

        var usableCqp = (cqp ?? Array.Empty<AmdCqpPoint>()).Where(usable).ToList();
        if (usableCqp.Count == 0)
        {
            return new AmdCqpVerdict(AmdCqpState.Unmeasured, production.Vmaf, 0, production.Bytes, 0, 0, production.Fps, 0);
        }

        var bestCqpVmaf = usableCqp.Max(p => p.Vmaf);

        // "Alcança" é >= (e não >): um empate de VMAF com menos bytes é a vitória mais limpa
        // possível, e tratar o empate como falha faria o judge procurar um rung mais caro.
        var reaching = usableCqp.Where(p => p.Vmaf >= production.Vmaf).ToList();
        if (reaching.Count == 0)
        {
            return new AmdCqpVerdict(
                AmdCqpState.CannotMatch, production.Vmaf, bestCqpVmaf, production.Bytes, 0, 0, production.Fps, 0);
        }

        // Mais barato entre os que alcançam. OrderBy é estável, então dois pontos com os
        // mesmos bytes escolhem o primeiro da curva — e o empate exato é indistinguível
        // pelos dados, então não vale cravar preferência.
        var chosen = reaching.OrderBy(p => p.Bytes).First();

        var deltaPct = production.Bytes > 0
            ? (chosen.Bytes - production.Bytes) * 100.0 / production.Bytes
            : 0;

        var verdict = new AmdCqpVerdict(
            AmdCqpState.KeepsProduction, production.Vmaf, bestCqpVmaf, production.Bytes, chosen.Bytes,
            Math.Round(deltaPct, 2), production.Fps, chosen.Fps)
        {
            ChosenCqpLabel = chosen.Label,
        };

        return verdict.ByteWin && verdict.FpsAcceptable
            ? verdict with { State = AmdCqpState.Promotes }
            : verdict;
    }

    /// <summary>Um ponto só entra na comparação com VMAF e bytes medidos. Fps 0 <b>não</b>
    /// descarta: falta de fps é lacuna do critério de desempenho, não do encode (e o
    /// veredito expõe isso em <see cref="AmdCqpVerdict.FpsMeasured"/>).</summary>
    private static bool usable(AmdCqpPoint p) => p.Vmaf > 0 && p.Bytes > 0;

    /// <summary>Alvo médio que a produção realmente manda para a AMF.
    ///
    /// <para><b>Chama a função de produção, não replica a fórmula.</b> Este rascunho tinha
    /// uma cópia local de <c>clamp(maxrate * 0.36, 6000, 50000)</c> "de propósito" (o audit
    /// precisa do valor mesmo sem encode rodando). Isso está errado pela mesma razão que o
    /// Item 8 usou libx264 hardcoded no editor: duas cópias do mesmo número divergem, e a
    /// divergência é silenciosa — o audit passaria a reportar o alvo errado sem nenhum erro.
    /// <c>ComputeAmfTargetKbps</c> é uma função pura e não depende de encode ter rodado, então
    /// não há o que ganhar duplicando. O teste
    /// <c>CriteriosDoAuditEstaoTravados</c> amarra a fórmula de produção ao número que o
    /// relatório apresenta.</para></summary>
    private static double amfTargetFor(double maxrateKbps) =>
        FfmpegEncoder.ComputeAmfTargetKbps((int)Math.Round(maxrateKbps));
}
