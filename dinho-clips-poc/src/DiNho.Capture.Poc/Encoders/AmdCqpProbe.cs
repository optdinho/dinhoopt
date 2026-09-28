using System.Globalization;

namespace DiNho.Capture.Poc.Encoders;
/// <summary>Parâmetros do <c>--probe-amf-cqp</c>. Vem da <c>AppConfig</c> real (como o
/// <c>--audit-amd</c>), porque o A/B só vale para a configuração que o usuário está gravando:
/// um preset de CQ diferente produz outro veredito.</summary>
internal sealed record AmdCqpProbeOptions(
    int Width, int Height, int Fps, int Cq, int MaxrateKbps, int BufsizeKbps, int Frames, string Codec)
{
    /// <summary>Escada de QP a medir.
    ///
    /// <para>Começa <b>abaixo</b> do CQ do usuário e sobe até <c>+4</c>, e não o contrário,
    /// porque o judge procura o ponto <b>mais barato que ainda atinge</b> o VMAF da produção:
    /// QP alto é barato, então se a escada não subisse o suficiente, o CQP seria medido só
    /// no lado caro e pareceria perdedor por construção. Descer até <c>-2</c> cobre o outro
    /// caso — o CQP ser <i>pior</i> que a produção já no CQ do usuário, o que pediria QP
    /// menor para compensar.</para>
    ///
    /// <para>Subir é o lado que importa: é onde está a economia possível.</para>
    ///
    /// <para><b>Por que isto virou parâmetro (medido, não por intuição).</b> A escada
    /// fixa foi rodada no RX 5700 XT real e mediu 43,7 a 67,7 Mbps contra os <b>22,1 Mbps</b>
    /// da produção: os quatro degraus custavam de <b>2x a 3,1x</b> o arquivo da produção. O
    /// veredito <c>MANTÉM PRODUÇÃO (+98%)</c> estava certo — mas era resposta a uma pergunta
    /// mais fraca, porque a região onde o CQP <i>poderia</i> competir nunca foi medida. Ver
    /// <see cref="AmdCqpAutoLadder"/>.</para></summary>
    public IReadOnlyList<int> Qps { get; init; } = DefaultQps(Cq);

    public static IReadOnlyList<int> DefaultQps(int cq) => new[] { cq - 2, cq, cq + 2, cq + 4 };
}

/// <summary>
/// A escada <c>auto</c>: subir o QP até o braço caber no orçamento de bytes da produção.
///
/// <para><b>Por que isso não é um detalhe.</b> Na curva medida, cada +2 de QP corta ~14% da
/// taxa (67,7 → 57,6 → 50,2 → 43,7 Mbps). De 43,7 para os 22,1 da productions são ~4,5 passos
/// = <b>~qp31</b>. Esse número é uma <i>extrapolação minha</i>, e extrapolação não é
/// medição — se ela estiver errada, a escada fixa erra junto. Percorrer até cruzar mede o
/// ponto em vez de prevê-lo.</para>
///
/// <para><b>Regra de parada.</b> Para <i>depois</i> do cruzamento, não no cruzamento: o
/// primeiro braço que cabe no orçamento de bytes quase certamente também fica <b>abaixo</b> do
/// VMAF da produção (bytes e qualidade caem juntos quando o QP sobe), e parar ali faria o
/// judge responder <c>CannotMatch</c> sem ter olhado o resto da curva. Medir
/// <see cref="ArmsPastCrossing"/> degraus acima do cruzamento é o que dá ao judge um ponto
/// "cabe no orçamento E alcança a qualidade" para existir — que é a única combinação que o
/// critério de promote consegue aprovar.</para>
/// </summary>
internal static class AmdCqpAutoLadder
{
    /// <summary>Token que pede a escada automática.</summary>
    internal const string AutoToken = "auto";

    /// <summary>Passo da escada, em QP. 2 é o mesmo espaçamento da escada default.</summary>
    internal const int DefaultStep = 2;

    /// <summary>Teto de braços. 8 × ~9 s ≈ 72 s: mais que isso é o usuário esperando sem
    /// necessidade, já que a taxa cai ~14% por passo e o cruzamento veio em ~4,5.</summary>
    internal const int DefaultMaxArms = 8;

    /// <summary>Quantos degraus continuar medindo depois do cruzamento.</summary>
    internal const int ArmsPastCrossing = 2;

    /// <summary>Marca de "escada automática" numa lista de QP. O valor <c>-1</c> é impossível
    /// num QP real (a faixa é 0..51, e o ffmpeg rejeita fora dela), então a lista não colide
    /// com nenhuma escada verdadeira. Importante: a checagem acontece <b>antes</b> do laço de
    /// medição, porque o laço tem um <c>Math.Clamp</c> que converteria -1 em 0 e mediria o
    /// rung mais caro da curva sem ninguém perceber.</summary>
    internal static readonly IReadOnlyList<int> Sentinel = new[] { -1 };

    /// <summary>Teto de degraus de refino. Nao precisa ser grande: o refino so anda para
    /// cima a partir do ULTIMO QP que passa, e ele para no primeiro reprovado.</summary>
    internal const int MaxRefinements = 4;

    /// <summary>Proximo degrau de <b>refino</b>: o QP logo acima do mais alto que ainda passa
    /// no VMAF da producao, ou <c>null</c> quando nao ha o que medir.
    ///
    /// <para><b>Por que isto existe, e o numero que motiva.</b> A escada anda de <b>2 em 2</b>
    /// porque a taxa cai ~14% por degrau e o passo grosso economiza tempo. Mas o criterio de
    /// promote e sobre <b>VMAF</b>, e o VMAF cai so ~1,3 por degrau. Medido na RX 5700 XT
    /// (1080p60, cq 18): producao VMAF 77,39; qp30 = 79,21 com -2,6% de bytes; qp32 = 76,65.
    /// A travessia do VMAF acontece entre 30 e 32, ou seja o ULTIMO QP que passa e o IMPAR -
    /// e a escada de passo 2 mede 30 e 32, nunca 31. O qp31 interpolado daria VMAF 77,93
    /// (0,54 ACIMA da producao) com ~-12,5% de bytes: um promote limpo Sitting entre duas
    /// medicoes, e o veredito reportava "MANTEM PRODUCAO" sobre um ponto que existe.</para>
    ///
    /// <para><b>Por que a funcao devolve UM degrau por vez.</b> Ela nao sabe o VMAF do
    /// candidato antes de medi-lo, e a monotonicidade (VMAF cai com QP) so se confirma
    /// MEDINDO - se o candidato reprovar, tudo acima reprova, e o proximo passo decide isso.
    /// Devolver a sequencia inteira seria chutar VMAF.</para></summary>
    internal static int? NextRefinement(IReadOnlyList<(int Qp, double Vmaf)> medidos, double anchorVmaf)
    {
        if (anchorVmaf <= 0 || medidos is null || medidos.Count == 0) return null;

        // Um QP pode aparecer mais de uma vez; o que vale e o MELHOR VMAF visto para ele.
        // Escolher o pior faria a escada tratar um rung reprovado como reprovado mesmo
        // depois de uma remedida que passou.
        var byQp = new Dictionary<int, double>();
        foreach (var (qp, vmaf) in medidos)
            if (!byQp.TryGetValue(qp, out var atual) || vmaf > atual) byQp[qp] = vmaf;

        var lastPassing = byQp.Where(kv => kv.Value >= anchorVmaf).Select(kv => kv.Key).DefaultIfEmpty(-1).Max();
        if (lastPassing < 0) return null;   // nada passou: refino nao tem onde subir

        var next = lastPassing + 1;
        if (next > AmdCqpProbe.MaxQp) return null;
        // Ja medido e reprovou: pela monotonicidade, tudo acima reprova tambem.
        return byQp.ContainsKey(next) ? null : next;
    }

    internal static bool IsAuto(IReadOnlyList<int>? qps)
        => qps is not null && qps.Count == 1 && qps[0] == Sentinel[0];

    /// <summary>Sequência de QP a percorrer, já saturada no teto do ffmpeg.</summary>
    internal static IReadOnlyList<int> QpSequence(int cq, int step, int maxArms)
    {
        var seq = new List<int>();
        if (maxArms <= 0 || step <= 0) return seq;
        // Começa no topo da escada default (cq+4): os degraus abaixo já foram medidos e a
        // economia só existe subindo. O `min` importa: com cq alto, cq+4 já passa do teto, e
        // um `if (qp > MaxQp) break` na primeira iteração devolveria lista VAZIA — a escada
        // automática ficaria sem medir nada e o relatório não teria braço nenhum, sem erro.
        var qp = Math.Min(AmdCqpProbe.MaxQp, cq + 4);
        if (qp < AmdCqpProbe.MinQp) qp = AmdCqpProbe.MinQp;
        for (var i = 0; i < maxArms; i++)
        {
            if (qp > AmdCqpProbe.MaxQp) break;
            seq.Add(qp);
            qp += step;
        }
        return seq;
    }

    /// <summary>Já mediu o suficiente? A mensagem diz <b>por quê</b> nos dois caminhos, porque
    /// um probe que para sem explicar parece igual em "parou porque cruzou" e "parou porque deu
    /// erro" — e são estados diferentes que o relatório não pode imprimi-los iguais.</summary>
    internal static bool ShouldStop(long productionBytes, IReadOnlyList<long> medidos, out string motivo)
    {
        if (productionBytes <= 0)
        {
            // Produção não medida. Tratar 0 como orçamento infinito faria todo braço contar
            // como cruzamento e parar no primeiro — o oposto do comportamento defensivo.
            motivo = "produção sem bytes medidos: nenhuma escada pode ser comparada";
            return false;
        }

        var lista = (medidos ?? Array.Empty<long>()).Where(b => b > 0).ToList();
        var idx = lista.FindIndex(b => b <= productionBytes);
        if (idx < 0)
        {
            motivo = lista.Count == 0
                ? $"nenhum braço medido ainda; orçamento da produção = {productionBytes} bytes"
                : $"nenhum dos {lista.Count} braços medidos caiu abaixo do orçamento da produção " +
                  $"({productionBytes} bytes) — o mais barato ainda tem {lista.Max()} bytes";
            return false;
        }

        // "Acima" aqui é posição na lista de medição (degrau de QP maior = mais barato), e
        // não byte: após o cruzamento os braços são os que estão ABAIXO do orçamento.
        var acima = lista.Count - 1 - idx;
        if (acima >= ArmsPastCrossing)
        {
            motivo = $"cruzou: {acima} degraus já medidos abaixo do orçamento da produção ({productionBytes} bytes)";
            return true;
        }

        motivo = $"cruzou o orçamento da produção ({productionBytes} bytes); falta {ArmsPastCrossing - acima} " +
                 "degrau(s) abaixo para o judge ter um ponto que cabe E alcança o VMAF da produção";
        return false;
    }
}

/// <summary>Uma ponta do A/B: o encode que rodou, a chain que ele usou e o VMAF medido.</summary>
internal readonly record struct AmdCqpArm(string Label, string Tune, AmdEncodeOutcome Encode, double Vmaf)
{
    public bool Ok => Encode.State == AmdProbeState.Works;
    public AmdCqpPoint ToPoint() => new(Label, Vmaf, Encode.OutputBytes, Encode.Fps);
}

/// <summary>
/// A/B entre a chain AMF de produção e a cadeia CQP, com o teto VBV preservado.
///
/// <para><b>A pergunta.</b> O <c>--audit-amd</c> mediu na RX 5700 XT que a AMF de produção
/// entrega VMAF 77,4 no mesmo tamanho em que o x264 crf20 entrega 91,3, e que a curva da
/// AMF satura (mais bitrate não compra qualidade). Ou seja: a produção está pagando caro por
/// qualidade que o encoder não entrega. A lever que sobra é o <i>rate control</i>.</para>
///
/// <para><b>O que já foi tentado, e por que isto não é repetição.</b> A cadeia de produção
/// (<c>FfmpegEncoder.cs:321-325</c>) registra que <b>CQP puro, sem teto, estourou ~180
/// Mbps</b> na mesma GPU, com clip de 94 s ≈ 930 MB. Aqui o <c>-maxrate</c>/<c>-bufsize</c>
/// do front <b>permanece</b> nas duas pontas: o que se mede é CQP <i>contido pelo teto</i>,
/// que é a configuração que a captura poderia usar. E o número que mais importa no
/// relatório é justamente <b>o teto apertou</b> — é ele que separa "CQP com contenção" do
/// estouro de 930 MB já pago.</para>
///
/// <para><b>Nada aqui decide troca de produção.</b> O veredito é lido por uma pessoa, e o
/// critério (>= 5% de bytes no mesmo VMAF sem perder > 5% de fps) está travado em
/// <see cref="AmdCqpCriteria"/> antes de medir.</para>
/// </summary>
internal static class AmdCqpProbe
{
    /// <summary>Faixa de QP usada para <c>-qp_i</c>/<c>-qp_p</c> na AMF (H.264/HEVC em 8
    /// bits). O clamp é explícito porque o ffmpeg <b>não</b> recusa um QP fora da faixa: ele
    /// satura, e a escada perderia o sentido sem erro nenhum — a mesma classe de falha
    /// silenciosa do <c>-rc</c> por índice do D3D12VA.</summary>
    internal const int MinQp = 0;
    internal const int MaxQp = 51;

    /// <summary>Valida a lista de QP explícita da linha de comando.
    ///
    /// <para><b>Lista inválida é erro duro, nunca queda silenciosa na escada default.</b> A
    /// lição vem do <c>verify-ffmpeg.js</c>: <c>--ffmpeg</c> sem valor caía no default do
    /// <c>PATH</c>, a validação rodava inteira e imprimia "51/51 OK" — mas o veredito era
    /// sobre <b>outro binário</b>, sem nenhuma palavra de erro. Aqui, "abc" ou "52" fariam o
    /// probe medir a escada default e publicar um veredito aparentemente legítimo <i>sobre
    /// ela</i>. Nomear o token culpado é o que separa "não roda" de "rodei a coisa
    /// errada".</para>
    ///
    /// <para>A faixa é a do ffmpeg, medida no binário embarcado: <c>-qp_i 52</c> é rejeitado
    /// com <c>out of range [-1 - 51]</c>.</para></summary>
    internal static bool TryNormalizeQps(string? arg, int cq, out IReadOnlyList<int> qps, out string? erro)
    {
        var raw = (arg ?? "").Trim();
        if (raw.Length == 0)
        {
            qps = AmdCqpProbeOptions.DefaultQps(cq);
            erro = null;
            return true;
        }

        if (raw.Equals(AmdCqpAutoLadder.AutoToken, StringComparison.OrdinalIgnoreCase))
        {
            qps = AmdCqpAutoLadder.Sentinel;
            erro = null;
            return true;
        }

        var lista = new List<int>();
        foreach (var token in raw.Split(','))
        {
            var t = token.Trim();
            if (t.Length == 0)
            {
                // "24,,26" é quase sempre dedo errado. Remover o vazio mediria 24 e 26 sem
                // avisar que a lista digitada tinha três itens.
                qps = Array.Empty<int>();
                erro = $"lista de QP tem um item vazio entre vírgulas: '{raw}'";
                return false;
            }

            if (!int.TryParse(t, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var qp))
            {
                qps = Array.Empty<int>();
                erro = $"QP inválido '{t}' em '{raw}': use números separados por vírgula (ex.: 24,26,28) ou 'auto'";
                return false;
            }

            if (qp < MinQp || qp > MaxQp)
            {
                qps = Array.Empty<int>();
                erro = $"QP {qp} fora da faixa {MinQp}..{MaxQp} em '{raw}' (o ffmpeg rejeita: out of range [-1 - 51])";
                return false;
            }

            lista.Add(qp);
        }

        // Dedup + sort: quem digita na mão sobra espaço e repete degrau, e a curva é lida de
        // cima para baixo — "mais barato primeiro" só vale se estiver ordenada por QP.
        qps = lista.Distinct().OrderBy(x => x).ToList();
        erro = null;
        return true;
    }

    internal static void Run(AmdCqpProbeOptions o, Action<string>? progress = null)
    {
        void Step(string m) => progress?.Invoke(m);

        Console.WriteLine("=== AMF CQP vs 0,36 (A/B) ===");
        Console.WriteLine($"{o.Width}x{o.Height}@{o.Fps} | cq={o.Cq} | maxrate={o.MaxrateKbps}K | " +
                          $"bufsize={o.BufsizeKbps}K | {o.Frames} frames | codec={o.Codec}");
        Console.WriteLine($"Alvo médio da produção: -b:v {FfmpegEncoder.ComputeAmfTargetKbps(o.MaxrateKbps)}K " +
                          $"(fator {AmdAuditCriteria.ProductionFactor:0.00}, clamp 6000..50000)");
        Console.WriteLine($"Critério (travado antes de medir): CQP promove com >= {AmdCqpCriteria.MinByteWinPct:0}% de bytes " +
                          $"no VMAF da produção ou acima, e <= {AmdCqpCriteria.MaxFpsLossPct:0}% de fps.");
        Console.WriteLine();

        if (!EncoderManager.IsAmfCodec(o.Codec))
        {
            Console.WriteLine($"ERRO: '{o.Codec}' não é codec AMF. Use h264_amf/hevc_amf.");
            return;
        }

        if (!EncoderManager.CheckFfmpegEncoder(o.Codec))
        {
            Console.WriteLine($"'{o.Codec}' indisponível neste ffmpeg/hardware — nada medido, sem veredito.");
            Console.WriteLine("Rode numa máquina com GPU AMD (o A/B só existe aí).");
            return;
        }

        var dir = Path.Combine(Path.GetTempPath(), "dinho-amd-cqp");
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        Directory.CreateDirectory(dir);

        try
        {
            var req = new AmdAuditRequest(o.Width, o.Height, o.Fps, o.Cq, o.MaxrateKbps, o.BufsizeKbps, o.Frames);
            // Mesma fonte do S3 (mandelbrot): os números são comparáveis com o audit já rodado.
            var source = AmdAudit.QualitySource(o.Width, o.Height, o.Fps);

            // ---------------- fonte: UMA materialização, fora do relógio ----------------
            // Sem isto a coluna de fps mede a fonte, não o encoder. Medido no RX 5700 XT:
            // produção a 22.074 kbps e CQP qp16 a 67.681 kbps deram 42,8 e 42,6 fps - taxa
            // 3x, fps idêntico. O mandelbrot 1080p60 entrega ~20 fps de conteúdo, abaixo do
            // alvo de 60, e como o ffmpeg é pipeline (gerar e codificar se sobrepõem) o
            // encoder fica escondido atrás da fonte. Medido no binário real: 17x de
            // diferença de bits move 6,4% do fps no modo lavfi e 39% no materializado.
            //
            // E se a materialização falhar, o probe NÃO volta para a lavfi: publicaria de
            // novo um fps que não mede o encoder, sem nenhum sinal visível. Abortar com
            // UNMEASURED é a única saída honesta.
            Step("materializando a fonte em y4m (uma vez, fora do cronômetro de cada ponta)...");
            var sourceFile = Path.Combine(dir, "fonte.y4m");
            if (!AmdAudit.MaterializeSource(source, o.Frames, o.Fps, sourceFile, out var srcElapsed, out var srcError))
            {
                var hint = AmdAudit.SourceCost(o.Frames, o.Fps, srcElapsed);
                Console.WriteLine($"ERRO: não consegui materializar a fonte — {srcError}.");
                Console.WriteLine("Medir de novo com a fonte gerada dentro do encode publicaria um fps que");
                Console.WriteLine("NÃO mede o encoder, sem nenhum aviso: a fonte seria o gargalo do pipeline e");
                Console.WriteLine($"todas as pontas leriem o mesmo número{(hint > 0 ? $" (fonte: {hint:0.0} fps contra alvo de {o.Fps} fps)" : "")}.");
                Console.WriteLine("Nenhuma medição foi feita. Corrija o ffmpeg/espaço e rode de novo.");
                return;
            }
            var sourceCostFps = AmdAudit.SourceCost(o.Frames, o.Fps, srcElapsed);
            Console.WriteLine($"Fonte materializada 1x: {sourceCostFps:0.0} fps de conteúdo em {srcElapsed:0.00}s, " +
                              $"fora do cronômetro de todas as pontas.");
            Console.WriteLine($"Ela entregaria só {sourceCostFps:0.0} fps contra o alvo de {o.Fps} fps: " +
                              "é por isso que a geração dentro do encode escondia o encoder.");
            Console.WriteLine();

            // ---------------- ponta de produção ----------------
            // Daqui para baixo toda ponta lê o y4m. `sourceMode` é constante de propósito:
            // se um braço usasse lavfi e outro o arquivo, a coluna fps misturaria duas
            // unidades e a comparação entre pontas deixaria de valer.
            const AmdSourceMode sourceMode = AmdSourceMode.PreMaterialized;
            Step("medindo a produção (vbr_peak + 0,36)...");
            var prodTune = AmdAudit.ProductionTune(o.Codec, req, bframes: 0);
            var prodArm = MeasureArm(o, req, sourceFile, sourceMode, dir, "prod-0.36", prodTune, Step);

            var cqpArms = new List<AmdCqpArm>();
            var auto = AmdCqpAutoLadder.IsAuto(o.Qps);
            // `auto` só pode ser materializado aqui: a sequência depende do CQ, e parar
            // depende dos bytes da produção — que acabou de ser medida.
            var qps = auto
                ? AmdCqpAutoLadder.QpSequence(o.Cq, AmdCqpAutoLadder.DefaultStep, AmdCqpAutoLadder.DefaultMaxArms)
                : o.Qps;
            Console.WriteLine(auto
                // Sem bytes de produção, o critério de parada é INATIVO (ShouldStop devolve
                // false sempre). Anunciar "cruzar 0 bytes" seria pior que inútil: 0 aqui
                // significa "não medido", não "orçamento zero", e o leitor pensaria que a
                // escada vai parar no primeiro braço.
                ? prodArm.Ok
                    ? $"Escada auto: {string.Join(", ", qps.Select(q => "qp" + q))} (para quando cruzar {prodArm.Encode.OutputBytes} bytes + {AmdCqpAutoLadder.ArmsPastCrossing} degraus abaixo)"
                    : $"Escada auto: {string.Join(", ", qps.Select(q => "qp" + q))} (produção sem bytes medidos — SEM critério de parada: mede a escada inteira)"
                : $"Escada: {string.Join(", ", qps.Select(q => "qp" + q))}");

            var medidos = new List<long>();
            // O refino precisa do VMAF por QP, que a lista de bytes nao guarda. Os dois crescem
            // juntos: TryMeasure so escreve em `medidos` quando o braco mediu de verdade.
            var medidosQp = new List<(int Qp, double Vmaf)>();

            bool TryMeasure(int qp)
            {
                var clamped = Math.Clamp(qp, MinQp, MaxQp);
                if (clamped != qp)
                {
                    // Silenciosamente saturado, o QP viraria um numero que nao foi medido.
                    Console.WriteLine($"    qp{qp} fora da faixa {MinQp}..{MaxQp}: medindo como qp{clamped} (aviso explicito).");
                }

                if (!AmdAudit.TryMakeAmfCqpTune(prodTune, clamped, out var cqpTune))
                {
                    Console.WriteLine($"    qp{clamped}: nao foi possivel montar a chain CQP (sem -rc ou sem -b:v) - rung descartado.");
                    return false;
                }

                Step($"medindo CQP qp{clamped}...");
                var arm = MeasureArm(o, req, sourceFile, sourceMode, dir, $"qp{clamped}", cqpTune, Step);
                cqpArms.Add(arm);
                if (arm.Ok)
                {
                    medidos.Add(arm.Encode.OutputBytes);
                    medidosQp.Add((clamped, arm.Vmaf));
                }

                return true;
            }

            foreach (var qp in qps)
            {
                if (!TryMeasure(qp)) continue;

                if (auto && AmdCqpAutoLadder.ShouldStop(prodArm.Encode.OutputBytes, medidos, out var motivo))
                {
                    Step($"escada auto: parando - {motivo}");
                    break;
                }
            }

            // ---- refino de passo 1 na travessia do VMAF ----
            // A escada grossa (passo 2) para por BYTES, mas quem decide o promote e o VMAF.
            // Medido na RX 5700 XT (1080p60, cq 18): producao 77,39; qp30 = 79,21 com -2,6% de
            // bytes; qp32 = 76,65. A travessia do VMAF cai ENTRE 30 e 32, entao o ULTIMO QP que
            // passa e o IMPAR - que a escada de passo 2 nunca mede. Sem isto o veredito diz
            // "nao promove" sobre um ponto que existe e nunca foi medido.
            if (auto && prodArm.Ok)
            {
                var refinados = 0;
                while (refinados < AmdCqpAutoLadder.MaxRefinements)
                {
                    var next = AmdCqpAutoLadder.NextRefinement(medidosQp, prodArm.Vmaf);
                    if (next is null) break;

                    Step($"refino: medindo CQP qp{next.Value} (passo 1 na travessia do VMAF)...");
                    // Sem chain montada o QP nao entra em medidosQp, e repetir devolveria o
                    // MESMO QP ate bater o teto. Por isso break, e nao continue.
                    if (!TryMeasure(next.Value)) break;
                    refinados++;
                }

                Console.WriteLine(refinados > 0
                    ? $"Refino: {refinados} degrau(s) de passo 1 medido(s) na travessia do VMAF da producao ({Fmt(prodArm.Vmaf, "0.00")})."
                    : $"Refino: nada a refinar - o ultimo QP que passa no VMAF ja e o mais alto medido.");
            }

            // "medido" aqui tem que contar só o que Ok — announcing 8 braços medidos quando
            // os 8 foram recusados é a mesma mentira de "0 bytes" acima, e o relatório
            // termina com um veredito UNMEASURED que o leitor não conseguiria reconciliar.
            if (auto)
            {
                var ok = cqpArms.Count(a => a.Ok);
                Console.WriteLine(ok > 0
                    ? $"Escada auto terminou: {ok} de {cqpArms.Count} braço(s) medido(s) com sucesso."
                    : $"Escada auto terminou: nenhum dos {cqpArms.Count} braço(s) mediu (ver UNMEASURED abaixo).");
            }

            Console.WriteLine();
            PrintTable(prodArm, cqpArms, o.MaxrateKbps);
            Console.WriteLine();
            PrintVerdict(prodArm, cqpArms);
        }
        finally
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        }
    }

    private static AmdCqpArm MeasureArm(
        AmdCqpProbeOptions o, AmdAuditRequest req, string source, AmdSourceMode sourceMode,
        string dir, string label, string tune, Action<string> step)
    {
        var path = Path.Combine(dir, $"{label}.{AmdAudit.RawExt(o.Codec)}");
        var enc = AmdAudit.Encode(o.Codec, req, tune, source, req.Frames, path, extraInput: null, sourceMode);
        if (enc.State != AmdProbeState.Works)
        {
            step($"{label}: {enc.State} — VMAF não medido");
            return new AmdCqpArm(label, tune, enc, 0);
        }

        // Mesma fonte e mesmo modo do encode: se o VMAF regenerasse pela lavfi, compararia
        // o distorcido contra pixels que o encoder nunca recebeu.
        var vmaf = AmdAudit.MeasureVmaf(source, path, req.Frames, sourceMode);
        return new AmdCqpArm(label, tune, enc, vmaf);
    }

    private static void PrintTable(AmdCqpArm prod, List<AmdCqpArm> cqp, int maxrateKbps)
    {
        // A coluna "vs prod" é o que responde, de relance, a pergunta que motivou a escada
        // automática: o braço entrou ou não no orçamento de bytes da produção? Sem ela o
        // leitor tem que comparar MiB de cabeça e não vê o cruzamento acontecendo.
        Console.WriteLine("ponta          estado      bytes      MiB     VMAF      fps    kbps   teto        vs prod");
        Console.WriteLine($"producao 0.36  {prod.Encode.State,-10} {prod.Encode.OutputBytes,9} " +
                          $"{Fmt(MiB(prod.Encode.OutputBytes), "0.00"),7} " +
                          $"{Fmt(prod.Vmaf, "0.00"),8} {Fmt(prod.Encode.Fps, "0.0"),7} " +
                          $"{Fmt(prod.Encode.Kbps, "0"),7} {maxrateKbps,6}  " +
                          $"{CeilingWord(prod.Ok, prod.Encode.Kbps, maxrateKbps),-8}  {VsProd(prod, prod)}");
        foreach (var a in cqp)
        {
            // O teto que segurou (ou não) o CQP é o número que separa esta configuração do
            // estouro de 930 MB já documentado: se o achieved fica colado no maxrate, o VBV
            // está mandando, e é isso que limita o estrago.
            Console.WriteLine($"CQP {a.Label,-8} {a.Encode.State,-10} {a.Encode.OutputBytes,9} " +
                              $"{Fmt(MiB(a.Encode.OutputBytes), "0.00"),7} " +
                              $"{Fmt(a.Vmaf, "0.00"),8} {Fmt(a.Encode.Fps, "0.0"),7} " +
                              $"{Fmt(a.Encode.Kbps, "0"),7} {maxrateKbps,6}  " +
                              $"{CeilingWord(a.Ok, a.Encode.Kbps, maxrateKbps),-8}  {VsProd(prod, a)}");
        }

        Console.WriteLine();
        Console.WriteLine("chain de produção : " + prod.Tune);
        foreach (var a in cqp) Console.WriteLine($"chain {a.Label,-11}: " + a.Tune);
        foreach (var a in cqp.Where(a => !a.Ok))
        {
            if (a.Encode.StderrTail.Length > 0) Console.WriteLine($"ffmpeg {a.Label}: {a.Encode.StderrTail}");
        }
    }

    /// <summary>Delta de bytes do braço contra a produção, em %.</summary>
    /// <para>Um braço que <b>não mediu</b> mostra <c>"-"</c>, e não 0%: 0% seria lido como
    /// "cabe exatamente no orçamento", que é uma afirmação sobre um encode que não aconteceu.
    /// A produção contra si mesma é <c>0%</c> por construção, e ainda assim só quando ela
    /// mediu.</para>
    internal static string VsProd(AmdCqpArm prod, AmdCqpArm arm)
    {
        if (!prod.Ok || !arm.Ok) return "-";
        return Fmt((double)(arm.Encode.OutputBytes - prod.Encode.OutputBytes) * 100.0 / prod.Encode.OutputBytes, "+0;-0;0") + "%";
    }

    private static void PrintVerdict(AmdCqpArm prod, List<AmdCqpArm> cqp)
    {
        var v = AmdAuditVerdicts.JudgeAmfCqp(prod.ToPoint(), cqp.Select(a => a.ToPoint()).ToList());
        Console.WriteLine("VEREDITO");
        foreach (var line in AmdCqpReportWriter.VerdictLines(v)) Console.WriteLine(line);
    }

    private static double MiB(long bytes) => bytes / 1024.0 / 1024.0;

    /// <summary>
    /// Palavra da coluna "teto". <b>Três estados, não dois</b>: a primeira versão tinha
    /// <c>binds ? "VBV APERTA" : "folga"</c>, e um encode que <b>falhou</b> (0 kbps) caía no
    /// "folga" — anunciando folga de teto a partir de uma medição que não existe. É a mesma
    /// classe de erro do "não compensa" do texto de UNMEASURED, numa coluna: estado ausente
    /// estava sendo publicado como se fosse um resultado. Um probe que roda pela metade
    /// imprimia uma tabela de aparência completa, e quem lesse não teria como distinguir
    /// "mediu e tinha folga" de "não mediu nada".
    /// </summary>
    internal static string CeilingWord(bool measured, double kbps, int maxrateKbps)
        => !measured ? "-" : kbps >= maxrateKbps * 0.95 ? "VBV APERTA" : "folga";

    /// <summary>Formato numérico <b>independente de cultura</b>, pelo mesmo motivo do
    /// <c>AmdAuditReportWriter.Fmt</c>: o relatório é colado em bug report e comparado com o
    /// do <c>--audit-amd</c>, que já rodou na máquina AMD. Em pt-BR a interpolação
    /// <c>{v:0.00}</c> escreveria "77,39" ao lado do "77.39" do audit, e o mesmo número
    /// apareceria de dois jeitos — a mesma armadilha do teste do resumo de NVENC, que fixava
    /// "12.00 fps" e recebia "12,00".</summary>
    internal static string Fmt(double v, string format) => v.ToString(format, CultureInfo.InvariantCulture);
}

/// <summary>
/// Texto do veredito do A/B. Função pura de propósito: ela decide a frase que o leitor vai
/// usar para trocar (ou não) a chain de produção, e essa frase precisa ser testada sem GPU.
/// </summary>
internal static class AmdCqpReportWriter
{
    internal static IReadOnlyList<string> VerdictLines(AmdCqpVerdict v)
    {
        var lines = new List<string>();
        static string F(double d, string fmt) => AmdCqpProbe.Fmt(d, fmt);
        static string Pct(double d) => F(d, "+0.0;-0.0;0");
        static string Mi(double b) => F(b / 1024.0 / 1024.0, "0.00");

        switch (v.State)
        {
            case AmdCqpState.Unmeasured:
                lines.Add("  UNMEASURED — nenhuma ponta produziu número medido (VMAF/bytes).");
                // A frase NÃO pode conter a palavra "não compensa", nem mesmo negada: a
                // versão anterior dizia "'não medi' não é 'não compensa'", que continha a
                // expressão e era lida por quem passava os olhos. O teste de texto pegou
                // isso — e é a prova de que testar a frase, e não só o veredito, era necessário.
                lines.Add("  Sem veredito: aqui nada diz que o CQP é pior, só que a máquina não respondeu.");
                return lines;

            case AmdCqpState.CannotMatch:
                lines.Add($"  CANNOT MATCH — melhor CQP medido em VMAF {F(v.BestCqpVmaf, "0.00")}, " +
                          $"produção em {F(v.AnchorVmaf, "0.00")} " +
                          $"(faltaram {F(v.AnchorVmaf - v.BestCqpVmaf, "0.00")}).");
                lines.Add("  Os bytes do CQP não são comparáveis aqui: trocar agora entrega MENOS qualidade.");
                return lines;

            case AmdCqpState.Promotes:
                lines.Add($"  PROMOVE — CQP {v.ChosenCqpLabel} atingiu VMAF {F(v.AnchorVmaf, "0.00")} ou mais " +
                          $"com {Pct(v.ByteDeltaPct)}% de bytes " +
                          $"({Mi(v.ProductionBytes)} → {Mi(v.CqpBytes)} MiB).");
                lines.Add(FpsLine(v));
                lines.Add("  ATENÇÃO: número sintético (mandelbrot). Confirmar em jogo real antes de trocar a captura.");
                return lines;

            default:
                // Só chegam aqui duas causas, e o texto precisa distinguir: ByteWin verdadeiro
                // com FpsAcceptable falso = a economia existe mas o preço não foi aceito;
                // ByteWin falso = a economia estava abaixo do corte. Dizer "não promovi" sem
                // dizer qual das duas falhou é o que faz um veredito ser re-discutido com o
                // número na mão e sem argumento.
                var motivo = v.ByteWin
                    ? "ganhou bytes, mas o custo de fps não passou no orçamento"
                    : $"abaixo do corte de {AmdCqpCriteria.MinByteWinPct:0}% de bytes";
                lines.Add($"  MANTÉM PRODUÇÃO — o melhor CQP compatível ({v.ChosenCqpLabel}) " +
                          $"ficou em {Pct(v.ByteDeltaPct)}% de bytes: {motivo}.");
                lines.Add(FpsLine(v));
                return lines;
        }
    }

    private static string FpsLine(AmdCqpVerdict v) =>
        v.FpsMeasured
            ? $"  fps {AmdCqpProbe.Fmt(v.ProductionFps, "0.0")} → {AmdCqpProbe.Fmt(v.CqpFps, "0.0")} " +
              $"({AmdCqpProbe.Fmt(v.FpsDeltaPct, "+0.0;-0.0;0")}%, orçamento {AmdCqpCriteria.MaxFpsLossPct:0}%)."
            : "  fps NÃO COMPARÁVEL (um dos lados não mediu) — o critério de desempenho não foi avaliado.";
}
