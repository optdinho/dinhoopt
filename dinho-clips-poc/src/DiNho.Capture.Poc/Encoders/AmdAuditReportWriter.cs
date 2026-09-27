using System.Globalization;
using System.Text;

namespace DiNho.Capture.Poc.Encoders;

/// <summary>
/// Formata o relatório do audit para o console.
///
/// <para><b>Regra que o formatador existe para garantir:</b> nada que não foi medido aparece
/// como número. É a mesma disciplina do resto do projeto — <c>AmdAuditVerdicts</c> devolve
/// <c>Unmeasured</c>/<c>Inconclusive</c> em vez de inventar veredito, e o veredito só vira
/// número no relatório depois que existiu arquivo de verdade. O risco real deste tool não é
/// crashar, é <b>convencer o usuário de que a AMD está com CQ calibrado</b> quando ninguém
/// mediu nada.</para>
///
/// <para>É função pura de <see cref="AmdAuditReport"/> para string, o que a torna testável sem
/// processo, sem GPU e sem ffmpeg — importante porque o CI não tem hardware AMD.</para>
/// </summary>
internal static class AmdAuditReportWriter
{
    private const double BytesPerKiB = 1024.0;

    /// <summary>Qual preset a escada escolheria — a única frase do relatório que diz o que o
    /// <b>app faria</b> na máquina do usuário, e por isso tem regra de precedência.
    ///
    /// <para>Havia dois campos para a mesma resposta: <c>LadderChoice</c> (o que a lógica de
    /// produção escolheria) e <c>LadderVerdict.Chosen</c> (o mesmo nome, já validado contra
    /// pontos que falharam). Escolher o primeiro em blindagem produzia a combinação
    /// contraditória "escolheria: quality" + "sustaining: nao medido" numa escada em que
    /// nada rodou. A precedência é: veredito validado &gt; escolha da produção com alguma
    /// medição &gt; "não sei".</para></summary>
    internal static string ResolveLadderChoice(AmdAuditReport r)
    {
        if (r.LadderVerdict.State == AmdProbeState.Works && !string.IsNullOrEmpty(r.LadderVerdict.ChosenPreset))
        {
            return r.LadderVerdict.ChosenPreset;
        }

        var temMedicao = r.QualityFps.Any(p => p.Completed);
        if (temMedicao && !string.IsNullOrEmpty(r.LadderChoice))
        {
            return r.LadderChoice;
        }

        return "(nenhuma: a escada nao mediu)";
    }

    internal static string Format(AmdAuditReport r)
    {
        var sb = new StringBuilder();
        sb.AppendLine("========================================================");
        sb.AppendLine("  AUDIT AMD - DiNho Clips (captura de video)");
        sb.AppendLine("========================================================");
        sb.Append(r.Header);
        sb.AppendLine();

        CodecMatrix(sb, r.EncoderMatrix, r.ChosenCodec);
        Knob(sb, "S2a: o -b:v tem autoridade?", "Alvo pedido x taxa alcancada x bytes do arquivo", r.BitrateLadder, r.BitrateVerdict, o => o.RequestedKbps > 0
            ? $"alvo {o.RequestedKbps.ToString("0", CultureInfo.InvariantCulture)} kbps -> {o.Kbps.ToString("0", CultureInfo.InvariantCulture)} kbps"
            : $"{o.Kbps.ToString("0", CultureInfo.InvariantCulture)} kbps");
        Knob(sb, "S2b: o -quality tem autoridade?", "Preset AMF x bytes do arquivo", r.QualityLadder, r.QualityVerdict, o => o.Label);

        sb.AppendLine("--------------------------------------------------------");
        sb.AppendLine("S3: o CQ que voce escolheu significa a mesma coisa na AMF?");
        sb.AppendLine("  A chain AMF nao recebe o CQ: usa maxrate * 0.36 como taxa media.");
        sb.AppendLine("  Referencia de qualidade = x264 no MESMO CQ da sua config.");
        sb.AppendLine();
        Curve(sb, "  x264 (referencia)", r.X264VmafSweep);
        Curve(sb, "  AMF  (producao)", r.AmfVmafCurve);
        sb.AppendLine();
        Calibration(sb, r.Calibration);

        sb.AppendLine("--------------------------------------------------------");
        sb.AppendLine("S4: a escada adaptativa de preset segura 60 fps?");
        foreach (var p in r.QualityFps)
        {
            sb.AppendLine(p.Completed
                ? $"  {p.Preset,-14} {Fmt(p.Fps, "0.0"),7} fps"
                : $"  {p.Preset,-14}   nao medido");
        }
        sb.AppendLine();
        sb.AppendLine($"  Escada escolheria: {ResolveLadderChoice(r)}");
        sb.AppendLine($"  VERDICT: {Describe(r.LadderVerdict.State)}");
        // "NAO" aqui seria uma afirmação que ninguém mediu: com a escada inteira em
        // UNMEASURED não se sabe se o preset segura 60fps. Só se mediu algo é que se pode
        // dizer que não segurou.
        if (r.LadderVerdict.State == AmdProbeState.Works)
        {
            sb.AppendLine($"    sustaining de {Fmt(r.LadderVerdict.TargetFps, "0")} fps: {(r.LadderVerdict.SustainsTarget ? "SIM" : "NAO")}");
            // O código aceita 85% do alvo (51 fps para 60). Esse número vivia no judge e
            // nunca era impresso, então o relatório dizia "NAO" sem dizer que a aplicação
            // aceitaria assim mesmo: quem lesse "NAO" concluiria que o preset seria
            // rejeitado, quando na verdade entraria em produção.
            sb.AppendLine($"    limiar do codigo ({Fmt(r.LadderVerdict.AcceptedFps, "0")} fps = 85% do alvo): {(r.LadderVerdict.MeetsCodeThreshold ? "ATINGE" : "ABAIXO")}");
        }
        else
        {
            sb.AppendLine($"    sustaining de {Fmt(r.LadderVerdict.TargetFps, "0")} fps: nao medido");
        }
        sb.AppendLine($"    preanalysis suportado: {TriState(r.PreanalysisSupported)}");
        sb.AppendLine($"    smart access video (SAV): {TriState(r.SavSupported)}");
        sb.AppendLine();

        sb.AppendLine("--------------------------------------------------------");
        sb.AppendLine("S6: custo em bytes das decisoes na AMF");
        ByteCost(sb, "  GOP 60 -> 120", r.GopCost);
        ByteCost(sb, "  b-frames 0 -> 2", r.BframeCost);
        sb.AppendLine();

        if (r.Notes.Count > 0)
        {
            sb.AppendLine("--------------------------------------------------------");
            sb.AppendLine("OBSERVACOES");
            foreach (var n in r.Notes) sb.AppendLine($"  - {n}");
            sb.AppendLine();
        }

        sb.AppendLine("--------------------------------------------------------");
        sb.AppendLine("Limites usados (fixos, para voce conferir o criterio):");
        sb.AppendLine($"  ignored  se bytes variam < {Fmt(AmdAuditCriteria.IgnoredSpanRatio, "0.00")}x com alvo 4x");
        sb.AppendLine($"  honored  se bytes variam > {Fmt(AmdAuditCriteria.HonoredSpanRatio, "0.00")}x com alvo 4x");
        sb.AppendLine($"  fator 0.36 so e considerado bom se desvio < {Fmt(AmdAuditCriteria.FactorTolerance * 100, "0")}% (tolerancia {Fmt(AmdAuditCriteria.FactorTolerance, "0.00")})");
        sb.AppendLine();
        sb.AppendLine("Aviso: mandelbrot/life sao sinteticos. O audit compara familias no mesmo");
        sb.AppendLine("conteudo; os numeros absolutos nao sao a qualidade do seu jogo.");
        sb.AppendLine("========================================================");
        return sb.ToString();
    }

    private static void CodecMatrix(StringBuilder sb, IReadOnlyList<AmdEncodeOutcome> matrix, string? chosen)
    {
        sb.AppendLine("--------------------------------------------------------");
        sb.AppendLine("S1: quais encoders realmente funcionam aqui?");
        if (matrix.Count == 0)
        {
            sb.AppendLine("  (nenhum encoder testado - ffmpeg nao respondeu)");
            sb.AppendLine();
            return;
        }

        sb.AppendLine($"  {"codec",-14} {"estado",-10} {"tamanho",10} {"fps",8}  detalhe");
        foreach (var o in matrix)
        {
            var works = o.State == AmdProbeState.Works;
            var size = works ? Size(o.OutputBytes) : "-";
            var fps = works ? Fmt(o.Fps, "0") : "-";

            // A marca de "escolhido" só entra em WORKS. Se ela aparecesse num encoder que
            // recusou, o relatório estaria dizendo ao usuário que a captura vai usar um
            // codec que acabou de falhar - que é literalmente o que o audit existe para
            // detectar.
            var mark = chosen != null && o.Label == chosen && works ? "  <- escolhido pela deteccao" : "";
            var detail = works ? "" : (o.StderrTail.Length > 0 ? o.StderrTail : "sem detalhe");
            sb.AppendLine($"  {o.Label,-14} {Describe(o.State),-10} {size,10} {fps,8}  {detail}{mark}");
        }

        sb.AppendLine();
        // O veredito de fallback é derivado da MATRIZ, não do campo `chosen`. Confiar no
        // campo foi o bug: com o campo preenchido e zero encoder funcionando, o relatório
        // anunciava "a deteccao escolheria X" - dizendo ao usuário que a captura usaria um
        // codec que acabara de falhar, que é o oposto do que o audit existe para avisar.
        var hardwareWorks = matrix.Where(m => m.State == AmdProbeState.Works && IsHardware(m.Label)).ToList();
        if (hardwareWorks.Count == 0)
        {
            sb.AppendLine("  RESULTADO: nenhum encoder de hardware (AMF/D3D12VA/NVENC/QSV) produziu");
            sb.AppendLine("  arquivo. A captura cairia no fallback de software.");
        }
        else
        {
            var usable = hardwareWorks.Select(m => m.Label).ToList();
            sb.AppendLine($"  RESULTADO: {usable.Count} encoder(s) de hardware produziram arquivo: {string.Join(", ", usable)}.");
            if (chosen != null && hardwareWorks.Any(m => m.Label == chosen))
            {
                sb.AppendLine($"  A deteccao de producao escolheria {chosen}.");
            }
            else if (chosen != null)
            {
                sb.AppendLine($"  ATENCAO: a deteccao decidiu por {chosen}, que NAO produziu arquivo aqui.");
                sb.AppendLine("  Se isso nao for esperado, a deteccao precisa cair no proximo da cadeia.");
            }
        }

        sb.AppendLine();
    }

    /// <summary>Hardware de verdade. <c>lib*</c> é o fallback de software — que funcionar
    /// não é sinal de que a GPU está sadia, é o oposto.</summary>
    private static bool IsHardware(string codec) => !codec.StartsWith("lib", StringComparison.OrdinalIgnoreCase);

    private static void Knob(StringBuilder sb, string title, string subtitle, IReadOnlyList<AmdEncodeOutcome> samples, AmdKnobState state, Func<AmdEncodeOutcome, string> describe)
    {
        sb.AppendLine("--------------------------------------------------------");
        sb.AppendLine(title);
        sb.AppendLine($"  {subtitle}");
        if (samples.Count == 0)
        {
            sb.AppendLine("  (nao medido)");
            sb.AppendLine();
            return;
        }

        foreach (var o in samples)
        {
            var size = o.State == AmdProbeState.Works ? Size(o.OutputBytes) : "falhou";
            sb.AppendLine($"  {describe(o),-22} {size,10}   {o.State}");
        }

        sb.AppendLine();
        sb.AppendLine($"  VERDICT: {Describe(state)}");
        if (state == AmdKnobState.Inconclusive)
        {
            sb.AppendLine("    Pouca variacao pode ser saturacao do conteudo, nao knob ignorado.");
            sb.AppendLine("    O S3 diz se o conteudo estava no limite.");
        }

        sb.AppendLine();
    }

    private static void Curve(StringBuilder sb, string title, IReadOnlyList<AmdVmafPoint> points)
    {
        if (points.Count == 0)
        {
            sb.AppendLine($"{title}: (nao medido)");
            return;
        }

        sb.AppendLine(title);
        foreach (var p in points)
        {
            sb.AppendLine($"  {p.Label,-18} VMAF {Fmt(p.Vmaf, "0.00"),6}   {Size(p.Bytes),10}");
        }
    }

    private static void Calibration(StringBuilder sb, AmdCalibrationVerdict v)
    {
        var codeFactor = Fmt(AmdAuditCriteria.ProductionFactor, "0.00");
        sb.AppendLine($"  VMAF alvo (x264 no seu CQ): {Fmt(v.TargetVmaf, "0.00")}");
        sb.AppendLine($"  Fator de producao: {Fmt(v.ProductionFactor, "0.000")}   (codigo: {codeFactor})");
        if (v.ProductionFactorClamped)
        {
            // Sem esta linha, maxrate baixo produzia "Fator de producao: 0.500 (codigo: 0.36)"
            // e o veredito seguinte atribuía ao 0.36 um resultado produzido pelo clamp de
            // 6000 kbps — ou seja, validava o número que ninguém testou.
            sb.AppendLine($"    ATENCAO: o clamp de 6000..50000 mordeu, entao o {codeFactor} NAO foi o que rodou.");
            sb.AppendLine($"    O fator efetivo e {Fmt(v.ProductionFactor, "0.000")}: e ele que o veredito abaixo avalia.");
        }

        sb.AppendLine($"  VERDICT: {Describe(v.State)}");

        // O sujeito da frase é o fator que rodou, e não o nominal do código. Nos casos
        // clampados, dizer "o 0.36 entrega" é exatamente a mentira que a linha acima
        // desmente.
        var factor = v.ProductionFactor > 0 ? Fmt(v.ProductionFactor, "0.000") : codeFactor;
        switch (v.State)
        {
            case AmdCalibrationState.FactorSuspect:
                sb.AppendLine($"    A taxa de producao equivale a x264 {v.MatchingX264Crf ?? "?"},");
                sb.AppendLine($"    enquanto o seu CQ vale VMAF {Fmt(v.TargetVmaf, "0.00")}. O rotulo CQ esta enganando.");
                if (v.SuggestedAmfKbps is { } kbps && v.SuggestedFactor is { } suggested)
                {
                    sb.AppendLine($"    Sugestao medida: {Fmt(kbps / 1000.0, "0.0")} Mbps (fator {Fmt(suggested, "0.000")})");
                    sb.AppendLine("    NAO foi aplicada automaticamente: muda producao e precisa de decisao sua.");
                }

                break;
            case AmdCalibrationState.FactorPlausible:
                sb.AppendLine($"    O fator {factor} entrega VMAF compativel com o x264 no seu CQ.");
                break;
            case AmdCalibrationState.TargetUnreachable:
                sb.AppendLine($"    O melhor AMF medido chegou a VMAF {Fmt(v.BestAmfVmaf, "0.00")}, abaixo do alvo.");
                sb.AppendLine("    Nao ha taxa que atinja o alvo: o problema e o codec/preset, nao o fator.");
                break;
            case AmdCalibrationState.Unmeasured:
                // A causa vem do judge, e não de um número deduzido aqui. A versão anterior
                // decidia "a curva não variou" só porque havia algum VMAF > 0, e com alvo
                // desconhecido o judge grava o melhor VMAF justamente para não perder dado —
                // então a culpa caía na AMF por uma falha do x264.
                switch (v.Cause)
                {
                    case AmdUnmeasuredCause.FlatCurve:
                        sb.AppendLine($"    A curva foi medida, mas o VMAF nao variou (melhor {Fmt(v.BestAmfVmaf, "0.00")}).");
                        sb.AppendLine($"    O conteudo nao exercitou a taxa, entao o fator {factor} NAO pode ser");
                        sb.AppendLine("    confirmado nem refutado aqui. Aumente os frames ou rode em cena de jogo.");
                        break;
                    case AmdUnmeasuredCause.UnknownTarget:
                        sb.AppendLine($"    Sem alvo: o x264 no seu CQ nao mediu (VMAF alvo = 0), entao todo");
                        sb.AppendLine("    ponto da AMF 'atinge' o alvo e nao ha como calibrar. A curva AMF foi");
                        sb.AppendLine($"    medida (melhor {Fmt(v.BestAmfVmaf, "0.00")}), mas falta a referencia do x264.");
                        sb.AppendLine("    Nao e problema da AMF: rode de novo com o codec x264 disponivel.");
                        break;
                    case AmdUnmeasuredCause.NoPoints:
                        sb.AppendLine("    Nenhum ponto utilizavel na curva (0 bytes ou encode recusado em algum ponto).");
                        break;
                    case AmdUnmeasuredCause.ProductionFailed:
                        sb.AppendLine("    O encode de producao nao rodou, entao nao ha taxa de referencia.");
                        break;
                    default:
                        sb.AppendLine("    Nada foi medido (falha de encode ou VMAF indisponivel).");
                        break;
                }

                break;
        }
    }

    private static void ByteCost(StringBuilder sb, string title, AmdByteCostVerdict v)
    {
        sb.AppendLine($"  {title,-20} {Fmt(v.CostPct, "+0.00;-0.00;0")}%   {v.Verdict}");
    }

    /// <summary>Escala automática: os arquivos do audit são de poucos MiB, e "0,1 MB" para
    /// 84 KB perde a informação que o relatório existe para mostrar.</summary>
    private static string Size(long bytes)
    {
        if (bytes < 1024 * 1024) return $"{Fmt(bytes / BytesPerKiB, "0.0")} KiB";
        return $"{Fmt(bytes / BytesPerKiB / 1024.0, "0.0")} MiB";
    }

    /// <summary>Números sempre com ponto decimal, independente da cultura da máquina. O
    /// relatório vai ser colado em bug report e comparado com outros; "VMAF 95,00" numa
    /// máquina pt-BR e "95.00" numa en-US vira discussão sobre o número em vez do número.</summary>
    private static string Fmt(double v, string format) =>
        v.ToString(format, CultureInfo.InvariantCulture);

    private static string Describe(AmdProbeState s) => s switch
    {
        AmdProbeState.Works => "WORKS",
        AmdProbeState.Refused => "REFUSED",
        AmdProbeState.NotPresent => "NOT PRESENT",
        AmdProbeState.NotAudited => "NOT AUDITED",
        _ => "UNMEASURED",
    };

    private static string Describe(AmdKnobState s) => s switch
    {
        AmdKnobState.Honored => "HONORED",
        AmdKnobState.Ignored => "IGNORED",
        AmdKnobState.Inconclusive => "INCONCLUSIVE",
        _ => "UNMEASURED",
    };

    private static string Describe(AmdCalibrationState s) => s switch
    {
        AmdCalibrationState.FactorPlausible => "FACTOR PLAUSIVEL",
        AmdCalibrationState.FactorSuspect => "FATOR SUSPEITO",
        AmdCalibrationState.TargetUnreachable => "ALVO INALCANCAVEL",
        _ => "UNMEASURED",
    };

    private static string TriState(bool? v) => v is null ? "nao medido" : v.Value ? "sim" : "nao";
}
