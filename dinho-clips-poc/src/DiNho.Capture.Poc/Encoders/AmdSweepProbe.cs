using System.Globalization;

namespace DiNho.Capture.Poc.Encoders;

/// <summary>Parâmetros do <c>--probe-amd-sweep</c>.</summary>
/// <param name="Usages">Células da eixo do uso. A string vazia é a referência (sem <c>-usage</c>),
/// e é o mesmo token de <c>--probe-amf-usage</c>.</param>
/// <param name="Qps">Eixo do QP, com CQP. Vira <c>-qp_i</c>/<c>-qp_p</c>.</param>
/// <param name="Finalists">Teto de células que ganham as voltas extras. A frente de Pareto é o
/// critério; este número é só o orçamento de tempo, e por isso o relatorio diz quantas
/// sobraram fora dele.</param>
/// <param name="Rounds">Voltas porifinalista. 1 desliga a refinação (e aí não há pick de
/// desempenho, por <see cref="AmdSweepVerdict.MinSamplesForThroughputPick"/>).</param>
internal sealed record AmdSweepOptions(
    int Width, int Height, int Fps, int Cq, int MaxrateKbps, int BufsizeKbps, int Frames,
    string Codec, string[] Usages, int[] Qps, int Finalists, int Rounds);

/// <summary>
/// Varredura conjunta <c>usage x QP</c> do encoder AMF: procura a célula de melhor
/// custo/desempenho <b>sem perda de qualidade</b> contra a cadeia de produção.
///
/// <para><b>A lacuna que ela fecha.</b> O <c>--probe-amf-usage</c> varia o <c>usage</c> com o
/// rate control da produção, e o <c>--probe-amf-cqp</c> varia o QP com o <c>usage</c> default. Nenhum
/// dos dois mede o par, e se <c>ultralowlatency</c> ganhar folga no primeiro, (ultralowlatency, QP)
/// é exatamente o ponto que os dois não enxergam.</para>
///
/// <para><b>Por que duas fases.</b> A grade inteira é cara (cada célula é um encode <b>mais</b> um
/// VMAF), e a maioria das células é irrelevante. A triagem roda 1 volta por célula, e só a
/// <b>frente de Pareto</b> — as células que ninguém domina nos três eixos — ganha as voltas
/// extras. Reprovar no portão de qualidade <b>não</b> tira uma célula da frente: ela pode estar
/// na frente e mesmo assim serRecommended=false, e esconder isso da frente seria mentir sobre
/// espaço de decisão.</para>
///
/// <para><b>Por que a fonte é materializada uma vez.</b> Mesmo motivo do <c>--probe-amf-cqp</c>, e
/// aqui é ainda mais grave: numa grade de N células a fonte cara seria N vezes cronometrada, e a
/// coluna de fps não responderia ao trabalho do encoder. Ver <c>AmdSourceIsolationTests</c>.</para>
/// </summary>
internal static class AmdSweepProbe
{
    /// <summary>Tokens de <c>usage</c> aceitos. A string vazia é a referência (sem
    /// <c>-usage</c>), e <c>default</c> é o token que a digita.</summary>
    internal static readonly IReadOnlyList<string> KnownUsages = new[]
    {
        "", "transcoding", "ultralowlatency", "lowlatency", "webcam",
        "high_quality", "lowlatency_high_quality",
    };

    /// <summary>Grade de usage, com validação <b>estrita</b> — cada token é conferido contra
    /// <see cref="KnownUsages"/> e um desconhecido é ERRO.
    ///
    /// <para>Não reusa <c>ResolveAmfProbeCandidates</c> de propósito. Ele devolve a lista
    /// <b>inteira</b> quando não reconhece o argumento, e o smoke mostrou o estrago: digitar
    /// <c>"naoexiste"</c> rodou a grade de 7 usages e imprimiria um relatório completo e
    /// plausível sobre uma lista que <b>ninguém pediu</b>. É a mesma classe do
    /// <c>--ffmpeg</c> sem valor do verify-ffmpeg.js: o gate rodou inteiro, disse 51/51, e o
    /// veredito era sobre outro build. Fallback silencioso aqui é veredito errado com cara de
    /// certeza.</para></summary>
    internal static bool TryNormalizeUsages(
        string? raw, out string[] usages, out string? erro)
    {
        var r = (raw ?? "").Trim();
        if (r.Length == 0) { usages = Array.Empty<string>(); erro = null; return true; }

        var lista = new List<string>();
        foreach (var token in r.Split(','))
        {
            var t = token.Trim();
            if (t.Length == 0)
            {
                usages = Array.Empty<string>();
                erro = $"a lista de usage tem um item vazio entre vírgulas: '{r}'";
                return false;
            }
            if (t.Equals(ProgramBenchmark.AmfDefaultUsageToken, StringComparison.OrdinalIgnoreCase))
            {
                lista.Add("");
                continue;
            }
            var norm = FfmpegEncoder.NormalizeAmfUsage(t);
            if (norm.Length == 0)
            {
                usages = Array.Empty<string>();
                erro = $"usage desconhecido: '{t}'. Known: default(=sem -usage), " +
                       string.Join(", ", KnownUsages.Where(u => u.Length > 0));
                return false;
            }
            lista.Add(norm);
        }
        usages = lista.Distinct().ToArray();
        erro = null;
        return true;
    }

    /// <summary>Expande o <c>auto</c> do probe 7 numa lista <b>estática</b>.
    ///
    /// <para>No <c>--probe-amf-cqp</c>, <c>auto</c> é um <b>sentinel</b> (<c>{-1}</c>) que o
    /// próprio probe expande subindo de 2 em 2 até cruzar os bytes da produção — um passeio
    /// dinâmico por eixo. A grade não pode usar o sentinel: ele passaria por QP e o laço tem
    /// <c>Math.Clamp</c>, que transformaria -1 em 0 e mediria o rung mais caro da curva sem
    /// ninguém perceber. E um passeio dinâmico por usage daria a cada linha da tabela um
    /// número de colunas diferente, o que quebra a leitura da grade.</para>
    ///
    /// <para>Por isso a grade é o retângulo que o auto <b>exploraria no pior caso</b> — mesmo
    /// início, passo e teto — e a regência dos bytes fica com o portão de qualidade e o
    /// relatório, não com o formato da tabela.</para></summary>
    internal static int[] ResolveQps(IReadOnlyList<int> qps, int cq)
    {
        if (AmdCqpAutoLadder.IsAuto(qps))
            return AmdCqpAutoLadder.QpSequence(cq, AmdCqpAutoLadder.DefaultStep, AmdCqpAutoLadder.DefaultMaxArms).ToArray();

        return qps.Select(q => Math.Clamp(q, 0, 51)).Distinct().ToArray();
    }

    internal static void Run(AmdSweepOptions o, Action<string>? progress = null)
    {
        void Step(string m) => progress?.Invoke(m);

        Console.WriteLine("=== AMF: varredura usage x QP (custo x desempenho) ===");
        Console.WriteLine($"{o.Width}x{o.Height}@{o.Fps} | cq={o.Cq} | maxrate={o.MaxrateKbps}K | " +
                          $"bufsize={o.BufsizeKbps}K | {o.Frames} frames | codec={o.Codec}");
        Console.WriteLine($"Grade: {o.Usages.Length} usage(s) x {o.Qps.Length} QP(s) = " +
                          $"{o.Usages.Length * o.Qps.Length} células | finalistas máx {o.Finalists} x {o.Rounds} voltas");
        Console.WriteLine("Régua: VMAF >= o da produção (sem perda de qualidade). " +
                          $"Empate em desempenho: {AmdSweepVerdict.FpsTolerancePct:0}% de fps contam como iguais, e vence a mais barata.");
        Console.WriteLine();

        if (!EncoderManager.IsAmfCodec(o.Codec))
        {
            Console.WriteLine($"ERRO: '{o.Codec}' não é codec AMF. Use h264_amf/hevc_amf.");
            return;
        }
        if (!EncoderManager.CheckFfmpegEncoder(o.Codec))
        {
            Console.WriteLine($"'{o.Codec}' indisponível neste ffmpeg/hardware — nada medido, sem veredito.");
            Console.WriteLine("A varredura só existe em máquina com GPU AMD.");
            return;
        }

        var dir = Path.Combine(Path.GetTempPath(), "dinho-amd-sweep");
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        Directory.CreateDirectory(dir);

        try
        {
            var req = new AmdAuditRequest(o.Width, o.Height, o.Fps, o.Cq, o.MaxrateKbps, o.BufsizeKbps, o.Frames);
            var sourceSpec = AmdAudit.QualitySource(o.Width, o.Height, o.Fps);

            Step("materializando a fonte em y4m (uma vez, fora do cronômetro de cada célula)...");
            var sourceFile = Path.Combine(dir, "fonte.y4m");
            if (!AmdAudit.MaterializeSource(sourceSpec, o.Frames, o.Fps, sourceFile, out var srcElapsed, out var srcError))
            {
                var hint = AmdAudit.SourceCost(o.Frames, o.Fps, srcElapsed);
                Console.WriteLine($"ERRO: não consegui materializar a fonte — {srcError}.");
                Console.WriteLine("Medir de novo com a fonte gerada dentro de cada encode publicaria fps que");
                Console.WriteLine("NÃO mede o encoder — e numa grade isso viraria N cópias do mesmo número falso" +
                                  (hint > 0 ? $" (a fonte entrega {hint:0.0} fps contra alvo de {o.Fps} fps)." : "."));
                Console.WriteLine("Nenhuma medição foi feita.");
                return;
            }
            const AmdSourceMode mode = AmdSourceMode.PreMaterialized;
            Console.WriteLine($"Fonte materializada 1x: {AmdAudit.SourceCost(o.Frames, o.Fps, srcElapsed):0.0} fps de conteúdo " +
                              $"em {srcElapsed:0.00}s, fora do cronômetro das {o.Usages.Length * o.Qps.Length} células.");
            Console.WriteLine();

            // ---------------- âncora: a cadeia que roda hoje ----------------
            Step("medindo a âncora (produção: vbr_peak + fator 0,36)...");
            var prodTune = AmdAudit.ProductionTune(o.Codec, req, bframes: 0);
            var anchor = Measure(dir, o, req, sourceFile, mode, "ancora", prodTune);
            var anchorVmaf = anchor.Ok ? anchor.Vmaf : 0;
            var anchorBytes = anchor.Ok ? anchor.Bytes : 0;
            if (!anchor.Ok)
            {
                // PARAR aqui, e nao seguir medindo as celulas. Sem a ancora nao existe regua de
                // qualidade, entao nenhuma celula poderia ser promovida - o sweep inteiro seria
                // {N} encodes e {N} VMAF para publicar uma tabela que ninguem pode usar. E o
                // sintoma seria ruim de ler: uma parede de tracinhos e um
                // "SEM ANCORA" embaixo, que parece falha de medicao quando e falha de hardware.
                Console.WriteLine($"Âncora (produção): {anchor.State}. A cadeia de produção é a régua de");
                Console.WriteLine("qualidade e de bytes deste sweep; sem ela nenhuma célula pode ser");
                Console.WriteLine("promovida, e por isso a varredura PAROU em vez de medir a grade.");
                Console.WriteLine();
                Console.WriteLine("O que costuma significar, nesta ordem:");
                Console.WriteLine("  - a GPU nao inicializou o AMF (driver ausente, ou GPU nao e AMD)");
                Console.WriteLine("  - o ffmpeg embarcado nao tem h264_amf (rode --encoders para ver)");
                Console.WriteLine("  - a maquina esta ocupada a ponto de o encode nao subir (feche o jogo)");
                return;
            }
            Console.WriteLine($"Âncora (produção): {anchor.Bytes} bytes, VMAF {anchor.Vmaf:0.00}");

            // ---------------- fase 1: triagem ----------------
            var cells = new List<AmdSweepCell>();
            Step($"triagem: {o.Usages.Length * o.Qps.Length} células, 1 volta cada...");
            foreach (var usage in o.Usages)
            {
                var usageLabel = ProgramBenchmark.AmfUsageLabel(usage);
                foreach (var qp in o.Qps)
                {
                    var tune = BuildCellTune(o, usage, qp);
                    if (tune == null)
                    {
                        Console.WriteLine($"  {usageLabel} qp{qp}: chain CQP não montável — célula descartada.");
                        cells.Add(new AmdSweepCell(usage, qp, false, 0, 0, 0, 0));
                        continue;
                    }
                    Step($"  {usageLabel} qp{qp}...");
                    var m = Measure(dir, o, req, sourceFile, mode, CellFile(usage, qp), tune);
                    cells.Add(new AmdSweepCell(usage, qp, m.Ok, m.Bytes, m.Vmaf, m.Fps, m.Ok ? 1 : 0));
                }
            }

            Console.WriteLine();
            PrintTriage(cells, anchorBytes, o.Fps);

            // ---------------- fase 2: finalistas com repetição ----------------
            var front = AmdSweepVerdict.Pareto(cells);
            var selection = AmdSweepVerdict.SelectFinalists(cells, front, anchorVmaf, o.Finalists);
            var picks = selection.Selected.ToList();
            // "de N medidas" contaria a GRADE, e a grade tem celulas recusadas. Dizer "0 de 20
            // medidas" quando nenhuma rodou e o numero certo: mede-se o que se mediu.
            var measuredCount = cells.Count(c => c.Measured);
            var frontPassing = front.Count(c => AmdSweepVerdict.PassesQuality(c.Vmaf, anchorVmaf));
            Console.WriteLine();
            Console.WriteLine($"Frente de Pareto: {front.Count} célula(s) de {measuredCount} medida(s); " +
                              $"{frontPassing} passa(m) no portão de qualidade.");
            Console.WriteLine($"Repetindo {picks.Count}: {string.Join(", ", picks.Select(p => p.Label))}.");
            if (selection.FrontPassingDropped > 0)
            {
                // Isto NÃO é "aumente FINALISTAS se quiser". Medido: a truncagem muda a resposta.
                // 9 das 12 células da frente ficaram sem as 3 voltas e o pick de desempenho
                // apontou a 237,5 fps quando havia 260,4 fps na grade que passou na qualidade.
                Console.WriteLine($"ATENÇÃO: {selection.FrontPassingDropped} célula(s) da frente que PASSAVAM na qualidade " +
                                  "ficaram sem as voltas. Bytes e VMAF delas seguem válidos; o pick de desempenho " +
                                  "que elas podiam ganhar sai PROVISÓRIO, e o relatório marca como tal.");
            }
            if (o.Rounds <= 1)
            {
                Console.WriteLine($"VOLTAS=1: sem refinação, e por isso SEM pick de desempenho " +
                                  $"(o piso é {AmdSweepVerdict.MinSamplesForThroughputPick} voltas). Bytes e VMAF seguem válidos.");
            }
            else
            {
                foreach (var p in picks) Step($"  {p.Label} ({o.Rounds} voltas)...");
                cells = Refine(dir, o, req, sourceFile, mode, cells, picks, o.Rounds, prodTune);
                Console.WriteLine();
                PrintFinalists(cells, picks, anchorBytes, anchorVmaf, o.Fps);
            }

            Console.WriteLine();
            PrintPicks(cells, anchorVmaf, anchorBytes, o, o.Rounds, selection);
        }
        finally
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        }
    }

    // ---------------- tune da célula ----------------

    /// <summary>Chain de uma célula: <b>CQP</b> no QP pedido, com o <c>usage</c> pedido.
    ///
    /// <para>A ordem importa e não é arbitrária. <c>BuildEncoderTuneArgs</c> recebe o
    /// <c>amfUsage</c> e emite o <c>-rc</c> que <b>corresponde</b> a ele (LCVBR para os
    /// latências, PCVBR para o resto). Só depois <c>TryMakeAmfCqpTune</c> troca esse
    /// <c>-rc</c> por <c>cqp</c> e põe <c>-qp_i/-qp_p</c>. Inverter deixaria o <c>-rc</c> do
    /// usage anterior apontando para um QP que ele não controla — e o <c>qp_i/qp_p</c> é
    /// <b>descartado em silêncio</b> fora do CQP, que é a classe de bug do Item 8.</para>
    ///
    /// <para><c>-maxrate</c>/<c>-bufsize</c> ficam iguais em todas as células, de propósito: o
    /// teto tem de ser o mesmo para a comparação de bytes significar alguma coisa.</para></summary>
    private static string? BuildCellTune(AmdSweepOptions o, string usage, int qp)
    {
        var baseTune = FfmpegEncoder.BuildEncoderTuneArgs(
            o.Codec, o.Cq, o.MaxrateKbps, o.BufsizeKbps, 0, 16, "p5",
            amfPreset: "speed", multipass: true, amfUsage: usage);
        return AmdAudit.TryMakeAmfCqpTune(baseTune, qp, out var patched) ? patched : null;
    }

    private static string CellFile(string usage, int qp) =>
        $"cel-{FfmpegEncoder.NormalizeAmfUsage(usage)}-{qp}";

    // ---------------- medição ----------------

    private readonly record struct Measured(bool Ok, long Bytes, double Vmaf, double Fps, AmdProbeState State);

    private static Measured Measure(
        string dir, AmdSweepOptions o, AmdAuditRequest req,
        string source, AmdSourceMode mode, string fileTag, string tune)
    {
        var path = Path.Combine(dir, $"{fileTag}.{AmdAudit.RawExt(o.Codec)}");
        var enc = AmdAudit.Encode(o.Codec, req, tune, source, req.Frames, path, extraInput: null, mode);
        if (enc.State != AmdProbeState.Works) return new Measured(false, 0, 0, 0, enc.State);
        var vmaf = AmdAudit.MeasureVmaf(source, path, req.Frames, mode);
        return new Measured(true, enc.OutputBytes, vmaf, enc.Fps, enc.State);
    }

    /// <summary>Repete as finalistas e troca a célula pela mediana das voltas. Células fora da
    /// frente preservam o valor da triagem — elas não foram remedidas, e fingir que foram
    /// trocaria "medido 1x" por "medido Nx" sem nenhum encode a mais.</summary>
    /// <param name="prodTune">A chain da âncora, **reaproveitada**. <c>ProductionTune</c> chama
    /// <c>SelectAmfPreset</c>, que sonda a GPU; recalcular aqui custaria uma segunda sondagem
    /// inteira por dentro de um probe que já roda dezenas de encodes.</param>
    private static List<AmdSweepCell> Refine(
        string dir, AmdSweepOptions o, AmdAuditRequest req,
        string source, AmdSourceMode mode, List<AmdSweepCell> all, List<AmdSweepCell> picks,
        int rounds, string prodTune)
    {
        for (var i = 0; i < all.Count; i++)
        {
            var cell = all[i];
            if (picks.All(p => p.Label != cell.Label) || !cell.Measured) continue;

            var tune = BuildCellTune(o, cell.Usage, cell.Qp);
            if (tune == null) continue;

            var bytes = new List<long> { cell.Bytes };
            var vmafs = new List<double> { cell.Vmaf };
            var fpss = new List<double> { cell.Fps };
            // A volta da triagem CONTA como uma das voltas: ela é um encode real do mesmo par,
            // e deitar fora seria peor que repetir. As extras é que somam.
            for (var r = 1; r < rounds; r++)
            {
                var m = Measure(dir, o, req, source, mode, $"{CellFile(cell.Usage, cell.Qp)}-r{r}", tune);
                if (!m.Ok) continue;
                bytes.Add(m.Bytes); vmafs.Add(m.Vmaf); fpss.Add(m.Fps);
            }
            all[i] = cell with
            {
                Bytes = Median(bytes), Vmaf = Median(vmafs), Fps = Median(fpss), Samples = bytes.Count,
            };
        }
        return all;
    }

    internal static double Median(List<double> xs)
    {
        if (xs.Count == 0) return 0;
        var s = xs.OrderBy(x => x).ToList();
        var mid = s.Count / 2;
        return s.Count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2.0;
    }

    internal static long Median(List<long> xs)
    {
        if (xs.Count == 0) return 0;
        var s = xs.OrderBy(x => x).ToList();
        return s[s.Count / 2];
    }

    /// <summary>Dispersão relativa, a mesma do <c>--probe-amf-usage</c>: (max-min)/mediana.
    /// Publicada para que o leitor possa julgar se a mediana de 3 voltas vale alguma coisa
    /// naquela máquina.</summary>
    internal static double SpreadPct(List<double> xs)
    {
        var med = Median(xs);
        return med > 0 ? (xs.Max() - xs.Min()) / med * 100.0 : 0;
    }

    // ---------------- relatório ----------------

    private static string F(double d, string f) => d.ToString(f, CultureInfo.CurrentCulture);
    private static string MiB(long b) => b > 0 ? F(b / 1048576.0, "0.00") : "-";

    private static void PrintTriage(List<AmdSweepCell> cells, long anchorBytes, int targetFps)
    {
        Console.WriteLine("--- triagem (1 volta por célula) ---");
        Console.WriteLine("célula                  estado      bytes      MiB     VMAF      fps  folga  vs prod");
        foreach (var c in cells)
        {
            var label = c.Label.PadRight(24);
            if (!c.Measured) { Console.WriteLine($"{label} {"-",-10} {"-",9} {"-",7} {"-",8} {"-",7} {"-",6}  -"); continue; }
            var vs = anchorBytes > 0
                ? F(AmdSweepVerdict.BytesDeltaPct(c.Bytes, anchorBytes), "+0;-0;0") + "%"
                : "-";
            Console.WriteLine($"{label} {"ok",-10} {c.Bytes,9} {MiB(c.Bytes),7} {F(c.Vmaf, "0.00"),8} " +
                              $"{F(c.Fps, "0.0"),7} {F(AmdSweepVerdict.Headroom(c.Fps, targetFps), "0.0"),6}  {vs}");
        }
    }

    private static void PrintFinalists(
        List<AmdSweepCell> all, List<AmdSweepCell> picks, long anchorBytes, double anchorVmaf, int targetFps)
    {
        Console.WriteLine("--- finalistas (mediana das voltas) ---");
        Console.WriteLine("célula                  bytes      MiB     VMAF      fps  folga  vs prod  qualidade");
        foreach (var p in picks)
        {
            var c = all.First(x => x.Label == p.Label);
            if (!c.Measured) { Console.WriteLine($"{c.Label.PadRight(24)} {"-",-9} {"-",7} {"-",8} {"-",7} {"-",6}  -        -"); continue; }
            var vs = anchorBytes > 0 ? F(AmdSweepVerdict.BytesDeltaPct(c.Bytes, anchorBytes), "+0;-0;0") + "%" : "-";
            var qual = anchorVmaf > 0
                ? (AmdSweepVerdict.PassesQuality(c.Vmaf, anchorVmaf) ? "ok" : "REPROVADA")
                : "(ancora nao medida)";
            Console.WriteLine($"{c.Label.PadRight(24)} {c.Bytes,9} {MiB(c.Bytes),7} {F(c.Vmaf, "0.00"),8} " +
                              $"{F(c.Fps, "0.0"),7} {F(AmdSweepVerdict.Headroom(c.Fps, targetFps), "0.0"),6}  {vs,-8} {qual}");
        }
    }

    private static void PrintPicks(List<AmdSweepCell> cells, double anchorVmaf, long anchorBytes, AmdSweepOptions o, int rounds,
        AmdSweepVerdict.AmdFinalistSelection selection)
    {
        Console.WriteLine("=== escolha ===");
        if (anchorVmaf <= 0)
        {
            Console.WriteLine("SEM ÂNCORA: a régua de qualidade não mediu, então nenhum pick é emitido.");
            Console.WriteLine("Uma escolha aqui seria chute com formato de recomendação.");
            return;
        }

        var cost = AmdSweepVerdict.PickCost(cells, anchorVmaf);
        if (cost is null)
        {
            Console.WriteLine($"Nenhuma célula atingiu o VMAF da produção ({F(anchorVmaf, "0.00")}). " +
                              "Nenhum par usage x QP entrega qualidade de graça aqui.");
        }
        else
        {
            var vs = anchorBytes > 0 ? F(AmdSweepVerdict.BytesDeltaPct(cost.Value.Bytes, anchorBytes), "+0;-0;0") + "%" : "-";
            var verdict = anchorBytes > 0 && cost.Value.Bytes < anchorBytes
                ? $"MELHOR CUSTO — {vs} de bytes no mesmo VMAF ou acima"
                : $"MAIS BARATA ENTRE AS QUE PASSAM, mas {vs} contra a produção (ou seja, nenhuma delas é mais barata que hoje)";
            Console.WriteLine($"MELHOR CUSTO:   {cost.Value.Label}  VMAF {F(cost.Value.Vmaf, "0.00")}  {cost.Value.Bytes} bytes  {F(cost.Value.Fps, "0.0")} fps");
            Console.WriteLine($"                critério: menor byte entre as que passam no VMAF >= {F(anchorVmaf, "0.00")} -> {verdict}");
            Console.WriteLine($"                poço: {AmdSweepVerdict.CostPoolSize(cells, anchorVmaf)} célula(s) medida(s) que passam na qualidade");
        }

        var perf = AmdSweepVerdict.PickThroughput(cells, anchorVmaf, AmdSweepVerdict.FpsTolerancePct);
        if (rounds < AmdSweepVerdict.MinSamplesForThroughputPick)
        {
            Console.WriteLine($"DESEMPENHO:    sem pick — {AmdSweepVerdict.MinSamplesForThroughputPick} voltas são o piso e você passou {rounds}.");
        }
        else if (perf is null)
        {
            Console.WriteLine("DESEMPENHO:    sem pick — nenhuma célula com as voltas necessárias passou na qualidade.");
        }
        else
        {
            var vs = anchorBytes > 0 ? F(AmdSweepVerdict.BytesDeltaPct(perf.Value.Bytes, anchorBytes), "+0;-0;0") + "%" : "-";
            // (C) Veredito parcial tem que parecer parcial. Este é o defeito que o sweep real
            // expôs: o poço do pick de desempenho tinha 3 células e a grade inteira tinha 26 que
            // passavam, então "o mais rápido" saiu de um poço que não continha o vencedor.
            var mark = selection.PerfProvisional ? "  [PROVISÓRIO]" : "";
            Console.WriteLine($"MELHOR VELOCIDADE:{mark} {perf.Value.Label}  {F(perf.Value.Fps, "0.0")} fps  VMAF {F(perf.Value.Vmaf, "0.00")}  {vs} de bytes");
            Console.WriteLine($"                critério: mais fps; empate dentro de {AmdSweepVerdict.FpsTolerancePct:0}% decide no byte");
            Console.WriteLine($"                poço: {AmdSweepVerdict.ThroughputPoolSize(cells, anchorVmaf)} célula(s) com as voltas necessárias e qualidade");
            if (selection.PerfProvisional)
            {
                var missed = selection.FastestPassing!.Value;
                Console.WriteLine($"                PROVISÓRIO: {missed.Label} tinha {F(missed.Fps, "0.0")} fps na triagem e NÃO entrou nas voltas,");
                Console.WriteLine($"                           então este pick não cobriu a célula mais rápida que passava na qualidade.");
                Console.WriteLine($"                           bytes e VMAF dela seguem válidos — só o ranking de fps é incompleto.");
            }
        }

        Console.WriteLine();
        // Isto era uma AFIRMAÇÃO sobre os dados, escrita como fato fixo, e o sweep real a
        // refutou: custo e velocidade apontaram para saídas byte-idênticas (default e
        // transcoding dão os mesmos bytes nos 8 QP). Afirmar conflito onde não há conflito é
        // a mesma classe de erro do pick — então o texto só afirma o que os dados mostram.
        if (cost is not null && perf is not null)
        {
            // A classificação é a parte testável (AmdSweepVerdict.ClassifyPicks); aqui só o texto.
            switch (AmdSweepVerdict.ClassifyPicks(cost.Value, perf.Value))
            {
                case AmdSweepVerdict.PickRelation.SameCell:
                    Console.WriteLine($"Os dois picks são a MESMA célula ({cost.Value.Label}): 'mais barato' e 'mais rápido' não conflitam aqui.");
                    var rawFinal = selection.FastestPassing;
                    if (rawFinal is not null && rawFinal.Value.Label != cost.Value.Label)
                    {
                        Console.WriteLine($"A mais rápida da triagem era {rawFinal.Value.Label} a {F(rawFinal.Value.Fps, "0.0")} fps — dentro dos {AmdSweepVerdict.FpsTolerancePct:0}% — e o desempate é byte, então o arquivo menor venceu.");
                    }
                    else
                    {
                        Console.WriteLine("Nenhuma outra célula da triagem bateu essa em desempenho, então o empate não dependeu da tolerância.");
                    }
                    break;
                case AmdSweepVerdict.PickRelation.SameBytesDifferentCell:
                    Console.WriteLine($"Os dois picks CAÍRAM NO MESMO BYTE ({cost.Value.Bytes}) — rótulos diferentes, arquivo idêntico.");
                    Console.WriteLine("Se os rótulos diferem e os bytes não, o que separou as células foi o que NÃO conta: usage.");
                    break;
                default:
                    Console.WriteLine("Os dois picks são células diferentes porque 'mais barato' e 'mais rápido' são critérios");
                    Console.WriteLine($"conflitantes aqui: {F(Math.Abs(cost.Value.Fps - perf.Value.Fps), "0.0")} fps e " +
                                      $"{F(Math.Abs(AmdSweepVerdict.BytesDeltaPct(perf.Value.Bytes, cost.Value.Bytes)), "0.0")}% de bytes de diferença.");
                    break;
            }
        }
        Console.WriteLine("Escolha o seu e valide no jogo antes de mudar a produção — o VMAF aqui é de mandelbrot,");
        Console.WriteLine("não do seu conteúdo.");
    }
}
