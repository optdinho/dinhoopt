using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace DiNho.Capture.Poc.Encoders;

/// <summary>De onde um probe tira os frames — e, o que de fato interessa, o que o
/// <b>cronômetro</b> dele está incluindo por acidente.</summary>
internal enum AmdSourceMode
{
    /// <summary><c>-f lavfi -i &lt;grafo&gt;</c>: a fonte é <b>gerada dentro</b> do processo
    /// cronometrado. Legítimo para quem mede bytes/VMAF e não throughput.</summary>
    LavfiRealtime,

    /// <summary>Arquivo y4m materializado <b>uma vez</b>, fora do relógio de cada braço.
    /// Obrigatório para qualquer probe que publique fps — ver
    /// <c>AmdSourceIsolationTests</c> para a medição que prova por quê.</summary>
    PreMaterialized,
}

/// <summary>Parâmetros que o audit valida. Vem da <c>AppConfig</c> real, não de constantes
/// duplicadas: o que o usuário está gravando agora é o que precisa ser auditado.</summary>
internal sealed record AmdAuditRequest(int Width, int Height, int Fps, int Cq, int MaxrateKbps, int BufsizeKbps, int Frames)
{
    /// <summary>Alvo médio que a chain AMF vai receber de fato.</summary>
    public int AmfTargetKbps => FfmpegEncoder.ComputeAmfTargetKbps(MaxrateKbps);

    /// <summary><c>lookahead</c> da produção. O default <b>não é 0</b>: <c>ConfigManager</c>
    /// tem 16, e é o número que a captura realmente entrega ao encoder. O audit usava 4.</summary>
    public int Lookahead { get; init; } = 16;

    /// <summary>Multipass da produção (<c>ConfigManager.Multipass</c> = true por default).
    /// O audit usava false, ou seja, media um encoder com VBV em um passe só.</summary>
    public bool Multipass { get; init; } = true;

    /// <summary>B-frames do perfil ativo. A produção roda 0 (decisão do Item 7), e é o que o
    /// audit tem que varrer contra.</summary>
    public int Bframes { get; init; }
}

/// <summary>Resultado completo do audit. Cada seção é independente: uma que não mediu não
/// impede as outras de reportarem.</summary>
internal sealed record AmdAuditReport(
    string Header,
    IReadOnlyList<AmdEncodeOutcome> EncoderMatrix,
    string? ChosenCodec,
    IReadOnlyList<AmdEncodeOutcome> BitrateLadder,
    AmdKnobState BitrateVerdict,
    IReadOnlyList<AmdEncodeOutcome> QualityLadder,
    AmdKnobState QualityVerdict,
    AmdEncodeOutcome Production,
    IReadOnlyList<AmdVmafPoint> AmfVmafCurve,
    IReadOnlyList<AmdVmafPoint> X264VmafSweep,
    AmdCalibrationVerdict Calibration,
    IReadOnlyList<AmdLadderPoint> QualityFps,
    string? LadderChoice,
    AmdLadderVerdict LadderVerdict,
    bool? PreanalysisSupported,
    bool? SavSupported,
    AmdByteCostVerdict GopCost,
    AmdByteCostVerdict BframeCost,
    IReadOnlyList<string> Notes);

/// <summary>
/// Audit AMD (<c>--audit-amd</c>).
///
/// <para><b>Por que existe.</b> A chain AMF de produção não recebe o CQ do usuário: não
/// emite <c>qp</c>/<c>cq</c> (<c>FfmpegEncoder.cs:394-396</c>) e deriva o alvo médio de
/// <c>ComputeAmfTargetKbps(maxrate) = clamp(maxrate * 0.36, 6000, 50000)</c>
/// (<c>FfmpegEncoder.cs:236</c>). Esse <b>0,36 nunca foi medido em hardware AMD</b>, e a escala
/// de <c>cq</c> já se provou não comparável entre famílias (Item 8 mediu ~2,4x de diferença
/// entre x264 e nvenc no mesmo CQ). Se o fator estiver errado, todo preset sai pior na AMD e
/// nada denuncia, porque a UI só mostra o CQ.</para>
///
/// <para><b>Args de produção, sem drift.</b> Todo encode do audit passa por
/// <c>FfmpegEncoder.BuildEncoderTuneArgs</c> — a mesma função que a captura usa — e os
/// knobs que a produção resolve por medição (<c>SelectAmfPreset</c>,
/// <c>SelectAmfPreanalysis</c>, <c>SupportsSmartAccessVideo</c>, mais
/// <c>ConfigManager.Lookahead</c> e <c>Multipass</c>) são resolvidos aqui pelos mesmos
/// chamadores. Reescrever os args no roteiro seria reintroduzir exatamente a classe de bug
/// do Item 8 (o editor mandava <c>-rc vbr_peak</c> para nvenc, que só aceita
/// <c>constqp|vbr|cbr</c>, e matava todo trim com HW) e do Item 10 (o <c>-preset fast</c>
/// que o SVT recusa). <b>Exceção declarada:</b> a S4 varre <c>-quality</c> de propósito, e
/// nessse ponto a varredura substitui a medição.</para>
///
/// <para><b>Conteúdo.</b> Usa <c>lavfi mandelbrot</c> e <c>lavfi life</c>, <b>não</b> o ruído
/// reaproveitado de <c>RunEncodeProbe</c>: aquele gerador já produziu duas conclusões
/// generalizadas que a remedição refutou (documentado nas linhas 659-683 de
/// <c>EncoderManager.cs</c>), porque ~99,6% de cada frame era byte-idêntico ao anterior.</para>
///
/// <para><b>Ressalva de interpretação.</b> <c>mandelbrot</c> e <c>life</c> são sintéticos e
/// não são jogo. O audit só vale como <b>comparação relativa entre famílias no mesmo
/// conteúdo</b> — que é a pergunta que ele faz — e não como número absoluto de qualidade.</para>
/// </summary>
internal static class AmdAudit
{
    /// <summary>2 s a 60 fps. Curto o bastante para o audit inteiro rodar em minutos, longo
    /// o bastante para o RC do encoder ter tempo de estabilizar.</summary>
    internal const int DefaultFrames = 120;

    private const int TimeoutMs = 180_000;

    /// <summary>Todos os encoders que a detecção pode escolher, mais os fallbacks de software.
    /// A ordem é a de preferência real, porque o relatório precisa dizer qual o
    /// <c>DetectBestCodec</c> teria pego.</summary>
    internal static readonly string[] Codecs =
    {
        "h264_amf", "hevc_amf", "av1_amf",
        "h264_d3d12va", "hevc_d3d12va", "av1_d3d12va",
        "h264_nvenc", "hevc_nvenc", "av1_nvenc",
        "h264_qsv", "hevc_qsv", "av1_qsv",
        "libx264", "libsvtav1",
    };

    /// <summary>Famílias que o audit <b>não</b> mede, porque a invocação correta delas exige
    /// o caminho de captura (frames d3d12 via hwupload) que o audit não replica. Ver a
    /// justificativa em <see cref="AmdProbeState.NotAudited"/>: reportar a falha de
    /// invocação como se fosse o encoder recusando é publicar causa falsa.</summary>
    internal static readonly string[] NotAuditedCodecs = { "h264_d3d12va", "hevc_d3d12va", "av1_d3d12va" };

    internal const string NotAuditedReason =
        "familia exige frames d3d12 via hwupload com referencia de device; o audit nao replica esse caminho, entao medir aqui mediria o proprio audit";

    internal static bool IsNotAudited(string codec) =>
        Array.Exists(NotAuditedCodecs, c => string.Equals(c, codec, StringComparison.OrdinalIgnoreCase));

    /// <summary>Fonte de alta entropia para medir <i>qualidade</i> (S3): fractal com zoom,
    /// detalhe espacial alto e movimento entre frames — o mais próximo de cena de jogo que
    /// o lavfi entrega sem arquivo externo.
    ///
    /// <para><b>O <c>,format=yuv420p</c> não é cosmético.</b> <c>mandelbrot</c> e
    /// <c>life</c> saem em <b>monocromático</b> (<c>monob</c>), e a captura real entra em
    /// NV12/yuv420p. Sem o format, o audit media um conteúdo sem croma — e pior, o
    /// <c>d3d12va</c> recusava com <c>Impossible to convert ... src: monob dst: monob</c>,
    /// que é um veredito <b>falso</b> de "não suporta": ele não falhava por falta de device,
    /// falhava por causa do meu conteúdo. Medido: forçar o formato tirou o erro de formato e
    /// deixou o <c>d3d12va</c> recusando por device (exit -40), que é a recusa real.</para></summary>
    internal static string QualitySource(int w, int h, int fps) =>
        $"mandelbrot=size={w}x{h}:rate={fps},format=yuv420p";

    /// <summary>Fonte de máxima entropia para medir <i>taxa</i> (S2): o frame inteiro muda a
    /// cada passo, que é a condição em que o teto do VBV realmente aperta. Mesmo
    /// <c>format=yuv420p</c> da fonte de qualidade, pelo mesmo motivo.</summary>
    internal static string RateSource(int w, int h, int fps) =>
        $"life=size={w}x{h}:rate={fps},format=yuv420p";

    // ---------------- isolamento da fonte do cronômetro ----------------

    /// <summary>Argumentos de entrada da fonte, no modo pedido. É uma função separada de
    /// <see cref="BuildVmafArgs"/> e de <see cref="Encode"/> porque os dois precisam da
    /// <b>mesma</b> fonte: se o encode lê o arquivo e o VMAF regenera pela lavfi, o VMAF
    /// passa a comparar contra pixels que o encoder nunca viu — e a qualidade vira fiction.</summary>
    internal static string[] SourceInputArgs(string spec, AmdSourceMode mode) => mode switch
    {
        AmdSourceMode.LavfiRealtime => ["-f", "lavfi", "-i", spec],
        AmdSourceMode.PreMaterialized => ["-i", Quote(spec)],
        _ => throw new ArgumentOutOfRangeException(nameof(mode), mode, "modo de fonte desconhecido"),
    };

    /// <summary>Throughput da materialização, em fps de conteúdo. É o número que
    /// <b>explica</b> por que o modo lavfi não serve para medir encoder, e por isso o probe
    /// o imprime.</summary>
    ///
    /// <para>Denominador é a duração <b>nominal</b> (frames/fps), não o wall-clock — o mesmo
    /// critério de <see cref="Nominal"/>. Os dois divisores têm guarda explícita porque 0 é
    /// alcançável de verdade: fps <= 0 numa config malformada, e um relógio de parede parado
    /// numa máquina sob carga (que é exatamente a máquina que interessa medir).</para>
    internal static double SourceCost(int frames, int fps, double elapsedSeconds)
    {
        var nominal = fps > 0 ? frames / (double)fps : 0;
        if (nominal <= 0 || elapsedSeconds <= 0) return 0;
        return frames / elapsedSeconds;
    }

    /// <summary>Grava a fonte lavfi em y4m e devolve o tempo que isso custou. Roda
    /// <b>uma vez</b> por probe, fora do cronômetro de cada braço.
    ///
    /// <para><b>Por que y4m e não um container de vídeo.</b> y4m é YUV cru com o frame rate e
    /// o pixel format no cabeçalho: a demux é praticamente um memcpy (GB/s), que é ~0,3 ms/frame
    /// em 1080p contra os ~23 ms do mandelbrot. Um mp4 exigiria um encoder a mais no caminho e
    /// o VMAF perderia a referência bit-exata.</para>
    ///
    /// <para><b>Por que o VMAF continua comparável com o audit.</b> A referência passa a ser o
    /// mesmo arquivo de pixels que o encoder recebeu. Não é a segunda geração independente da
    /// lavfi — é exatamente o mesmo conteúdo, que é o que a comparação exige.</para>
    ///
    /// <para>Devolve <c>false</c> em vez de lançar: quem chama decide se aborta, e o probe
    /// <b>não</b> pode cair de volta na lavfi (ver o comentário do chamador).</para>
    internal static bool MaterializeSource(
        string lavfiSpec, int frames, int fps, string y4mPath, out double elapsedSeconds, out string error)
    {
        var args = new List<string>
        {
            "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", lavfiSpec,
            "-frames:v", frames.ToString(CultureInfo.InvariantCulture),
            "-pix_fmt", "yuv420p",
            // O nome do muxer é yuv4mpegPIPE, não yuv4mpeg - confirmado no binário
            // embarcado (`ffmpeg -muxers` lista `E yuv4mpegpipe`), onde `-f yuv4mpeg`
            // morre com "Requested output format 'yuv4mpeg' is not known" (exit -22). É a
            // mesma classe de erro do `-rc vbr_peak` do Item 8: o argv "parece" certo e
            // só o binário real diz que não é. Nenhum teste de forma pega isso.
            "-f", "yuv4mpegpipe",
            Quote(y4mPath),
        };

        elapsedSeconds = 0;
        error = "";
        var sw = Stopwatch.StartNew();
        try
        {
            var psi = FfmpegPathResolver.CreateFfmpegStartInfo(
                Join(args), redirectInput: false, redirectOutput: false, redirectError: true);
            using var p = Process.Start(psi)!;
            var drain = Task.Run(() =>
            {
                try { return p.StandardError.ReadToEnd(); }
                catch (IOException) { return ""; }
                catch (ObjectDisposedException) { return ""; }
            });
            if (!p.WaitForExit(TimeoutMs))
            {
                try { p.Kill(true); } catch { }
                error = "timeout materializando a fonte";
                return false;
            }
            sw.Stop();
            try { drain.Wait(2000); } catch { }
            elapsedSeconds = sw.Elapsed.TotalSeconds;

            if (p.ExitCode != 0)
            {
                string text;
                try { text = drain.Result; } catch (AggregateException) { text = ""; }
                error = $"ffmpeg saiu {p.ExitCode} ao materializar a fonte: {LastLine(text)}";
                return false;
            }
            // Sem o -frames:v o y4m sai com 1 frame e todo braço mede 1/120 do conteúdo -
            // e o VMAF compararia um frame contra o arquivo inteiro. Arquivo vazio aqui é
            // falha silenciosa, então é checado.
            try
            {
                if (!File.Exists(y4mPath) || new FileInfo(y4mPath).Length < 1024)
                {
                    error = "fonte materializada saiu vazia";
                    return false;
                }
            }
            catch (Exception ex) { error = ex.GetType().Name; return false; }
            return true;
        }
        catch (Exception ex) { error = ex.GetType().Name; return false; }
    }

    private static string LastLine(string text)
    {
        var t = text.Trim();
        if (t.Length == 0) return "";
        var i = t.LastIndexOfAny(['\r', '\n']);
        return i < 0 ? t : t[(i + 1)..].Trim();
    }

    /// <summary>Fonte de medicao do audit, ja materializada em disco (ou nao).</summary>
    internal readonly record struct AmdAuditSource(string Spec, string Path, AmdSourceMode Mode, double MaterializeSeconds)
    {
        internal bool Materialized => Mode == AmdSourceMode.PreMaterialized;
    }

    /// <summary>Materializa a fonte do audit UMA VEZ por conteudo e devolve o caminho do
    /// arquivo, para que o cronometro de cada encode meca o encoder e nao a CPU gerando a
    /// fonte.
    ///
    /// <para><b>Por que o audit era todo contaminado.</b> <c>Encode</c> e <c>MeasureVmaf</c>
    /// aceitam <see cref="AmdSourceMode"/> com default <c>LavfiRealtime</c>, e nenhum dos 16
    /// call sites do audit o passava. Medindo direto da lavfi, o tempo includia a geracao de
    /// <c>life</c>/<c>mandelbrot</c>: 44,3 fps de fonte contra 230 fps do encoder na mesma
    /// maquina, ou seja o FPS de saida era o TETO DA FONTE, nao o do encoder. Medido na
    /// RX 5700 XT: o S4 reportava 42,4-43,0 fps e reprovava o alvo de 60 fps, e o probe CQP
    /// com a mesma config reportava 230,0 fps. Bytes e VMAF concordavam exatamente entre os
    /// dois (5,26 MiB e VMAF 77,39 nos dois) - o materializar nao muda o conteudo, so o
    /// relogio. Era por isso que os dois artefatos nao se conciliavam.</para>
    ///
    /// <para><b>Por que degrada em vez de abortar.</b> Sem espaco em disco, o audit inteiro
    /// seria jogado fora - inclusive o S1, que e a resposta principal ("qual encoder
    /// funciona aqui"). Entao a falha vira um AVISO explicito no relatorio, e nao um numero
    /// silenciosamente errado: quem ler sabe que a coluna de FPS nao vale. O oposto - cair
    /// na lavfi sem avisar - e o que produziu o falso negativo do S4.</para></summary>
    internal static AmdAuditSource PrepareSource(
        string dir, string spec, int frames, int fps, string tag, Action<string>? step = null)
    {
        var path = Path.Combine(dir, $"fonte-{tag}.y4m");
        if (MaterializeSource(spec, frames, fps, path, out var seconds, out var error) && File.Exists(path))
        {
            step?.Invoke($"Fonte '{tag}' materializada 1x em {seconds:0.0}s: {spec}");
            return new AmdAuditSource(spec, path, AmdSourceMode.PreMaterialized, seconds);
        }

        step?.Invoke($"AVISO: fonte '{tag}' NAO materializada ({error}). Os FPS deste relatorio vao medir a geracao da fonte, nao o encoder.");
        return new AmdAuditSource(spec, spec, AmdSourceMode.LavfiRealtime, 0);
    }
    internal static AmdAuditReport Run(AmdAuditRequest req) => Run(req, null);

    /// <param name="progress">Recebe uma linha por seção concluída. O audit leva minutos
    /// (são dezenas de encodes de verdade); sem isso ele parece travado, e quem roda na
    /// máquina do usuário não tem como distinguir "trabalhando" de "preso".</param>

    /// <param name="codecOverride">Mede outra família no lugar da primeira AMF que funcionar.
    /// Serve para duas coisas: auditar a máquina do usuário quando ela é NVIDIA/QSV (o
    /// relatório continua válido, só muda o subject), e <b>permitir que o caminho completo do
    /// audit seja exercitado em máquina sem AMF</b> — sem isso, as seções S2/S3/S4/S6 nunca
    /// rodariam fora de hardware AMD e iria para a máquina do usuário com bug de
    /// null-reference. Default null = primeira AMF que produzir arquivo.</param>
    internal static AmdAuditReport Run(AmdAuditRequest req, string? codecOverride, Action<string>? progress = null)
    {
        var dir = Path.Combine(Path.GetTempPath(), "dinho-amd-audit");
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        Directory.CreateDirectory(dir);

        try
        {
            return RunCore(req, codecOverride, progress, dir);
        }
        finally
        {
            // Uma execução deixa dezenas de arquivos (uma fonte por seção, um encode por
            // ponto, o VMAF por par). Sem isto, cada rodada do kit enche o %TEMP% do
            // usuário com centenas de MB. Falha de limpeza não pode virar falha do audit,
            // por isso o catch vazio — o resto do relatório continua válido.
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        }
    }

    private static AmdAuditReport RunCore(AmdAuditRequest req, string? codecOverride, Action<string>? progress, string dir)
    {
        void Step(string msg) => progress?.Invoke(msg);

        var notes = new List<string>();
        var listed = ListedEncoders();

        // ---------- fontes materializadas (1x cada) ----------
        // Duas, nao uma: S1/S2 medem TAXA (life, entropia maxima) e S3/S4/S6 medem QUALIDADE
        // (mandelbrot). Sao conteudos diferentes, logo dois arquivos. Custo: 2x o frame em
        // disco (1080p x 120 frames yuv420p = 373 MB cada), pago uma vez por corrida.
        var fonteTaxa = PrepareSource(dir, RateSource(req.Width, req.Height, req.Fps), req.Frames, req.Fps, "taxa", Step);
        var fonteQualidade = PrepareSource(dir, QualitySource(req.Width, req.Height, req.Fps), req.Frames, req.Fps, "qualidade", Step);
        if (!fonteTaxa.Materialized || !fonteQualidade.Materialized)
        {
            notes.Add("AVISO: fonte NAO materializada - as colunas de FPS deste relatorio medem a geracao da fonte e NAO o encoder; nao podem virar decisao.");
            notes.Add("Bytes e VMAF continuam validos: o conteudo e o mesmo, so o relogio muda.");
        }

        // ---------- S1: matriz de encoders ----------
        var matrix = new List<AmdEncodeOutcome>();
        foreach (var codec in Codecs)
        {
            if (IsNotAudited(codec))
            {
                matrix.Add(new AmdEncodeOutcome(codec, true, false, 0, 0, 0, NotAuditedReason, 0, true));
                continue;
            }

            var isListed = listed.Contains(codec);
            if (!isListed)
            {
                matrix.Add(new AmdEncodeOutcome(codec, false, true, 0, 0, 0, ""));
                continue;
            }

            var tune = ProductionTune(codec, req, 0, "speed");
            var path = Path.Combine(dir, $"s1-{codec}.{RawExt(codec)}");
            var o = Encode(codec, req, tune, fonteTaxa.Path, req.Frames, path, extraInput: null, fonteTaxa.Mode);
            matrix.Add(o with { Listed = true });
        }

        var subject = codecOverride ?? Codecs.FirstOrDefault(c => c.EndsWith("_amf", StringComparison.Ordinal) && matrix.First(m => m.Label == c).State == AmdProbeState.Works);

        // A mensagem precisa dizer o que o audit vai FAZER, não só o que encontrou. A
        // primeira versao dizia "nenhum AMF; retornando relatorio minimo" antes do if, e
        // no smoke test com override ela aparecia seguida das secoes S2..S6 — a tela
        // contradizia a frase, que e a mesma classe de log que mente do Item 5.
        if (subject == null || matrix.FirstOrDefault(m => m.Label == subject).State != AmdProbeState.Works)
        {
            Step("S1: nenhum AMF funcional; retornando relatorio minimo");

            // Se nenhum AMF abriu, as seções de AMF não têm o que medir. Em vez de inventar
            // número, o audit diz isso e mede o que der (S1 já é a informação principal).
            notes.Add("Nenhum encoder AMF produziu arquivo nesta maquina: S2/S3/S4/S6 de AMF ficam UNMEASURED.");
            notes.Add("S1 acima ja e a resposta principal: rodar aqui, no maximo, confirma que a captura cairia no fallback.");
            return MinimalReport(req, matrix, notes, dir);
        }

        Step($"S1: familia medida = {subject}; seguindo para S2/S3/S4/S6");

        // ---------- S2a: escada de bitrate alvo (knob -b:v) ----------
        var target = req.AmfTargetKbps;
        var bitrateLadder = new List<AmdEncodeOutcome>();
        foreach (var mult in new[] { 0.5, 1.0, 2.0 })
        {
            var kbps = Math.Max(600, (int)Math.Round(target * mult));
            var tune = ProductionTune(subject, req with { MaxrateKbps = (int)Math.Round(kbps / AmdAuditCriteria.ProductionFactor) }, 0, "speed");
            // ProductionTune recalcula o alvo de maxrate; aqui queremos o -b:v EXATO, então
            // passamos a variante que fixa o bitrate final. Sem -b:v não há rampa de taxa
            // para medir (ver TryFixAmfBitrate) e a escada inteira é inútil.
            if (!TryFixAmfBitrate(tune, kbps, out tune)) break;
            var path = Path.Combine(dir, $"s2-bv-{kbps}.{RawExt(subject)}");
            bitrateLadder.Add(Encode(subject, req, tune, fonteTaxa.Path, req.Frames, path, null, fonteTaxa.Mode) with { RequestedKbps = kbps });
        }

        Step("S2a: escada de bitrate concluida");

        // ---------- S2b: escada de -quality ----------
        // O `Label` de cada rung é carimbado pelo seam com o NOME do preset: `Encode` só
        // conhece o codec, e a seção que varia o preset com o codec fixo é exatamente a que
        // sairia com quatro linhas idênticas.
        var qualityLadder = AmdAudit.BuildQualityLadder(q =>
        {
            var tune = ProductionTune(subject, req, 0, q);
            var path = Path.Combine(dir, $"s2-q-{q}.{RawExt(subject)}");
            return Encode(subject, req, tune, fonteTaxa.Path, req.Frames, path, null, fonteTaxa.Mode);
        });

        Step("S2b: escada de -quality concluida");

        // ---------- S3: calibracao do 0.36 com VMAF ----------
        var src = fonteQualidade.Path;
        var srcMode = fonteQualidade.Mode;
        var amfCurve = new List<AmdVmafPoint>();
        foreach (var kbps in new[] { target, target * 2, target * 3 })
        {
            // O teto do VBV sobe junto com o alvo. Sem isto, o ponto de 3x nascia com
            // -b:v 3T contra um -maxrate herdado da config: como 3 × 0.36 = 1.08, o topo
            // da curva era sempre cappingado abaixo do próprio rótulo, em qualquer maxrate
            // do usuário. Isso achata a curva (e o judge chama curva achatada de
            // "não medível"), achata o SuggestedKbps para baixo e pode trocar
            // ALVO INALCANÇÁVEL por FATOR SUSPEITO — o par que o próprio judge diz que
            // "levam a consertos completamente diferentes".
            // kbps / fator = o maxrate que a produção usaria para chegar em kbps. Divide
            // pelo fator nominal, e não por um 0.36 escrito aqui de novo: este é o mesmo
            // número que o relatório imprime e que o clamp pode mudar.
            var scaled = req with { MaxrateKbps = (int)Math.Ceiling(kbps / AmdAuditCriteria.ProductionFactor) };
            if (!TryFixAmfBitrate(ProductionTune(subject, scaled, 0, "speed"), kbps, out var tune))
            {
                // Codec sem -b:v (o override sem AMF cai aqui): não há taxa para varrer, e
                // fingir que varrer dá uma curva de três pontos idênticos.
                break;
            }

            var path = Path.Combine(dir, $"s3-amf-{kbps}.{RawExt(subject)}");
            var o = Encode(subject, req, tune, src, req.Frames, path, null, srcMode);
            if (o.State != AmdProbeState.Works) continue;
            var vmaf = MeasureVmaf(src, path, req.Frames, srcMode);
            if (vmaf > 0) amfCurve.Add(new AmdVmafPoint($"{kbps / 1000.0:0.0} Mbps", kbps, vmaf, o.OutputBytes));
        }

        // Varredura de CRF no x264: a referência de "o que o CQ do usuário promete". Usa os
        // args de produção do x264 (mesmo BuildEncoderTuneArgs), não -crf digitado à mão.
        var x264Sweep = new List<AmdVmafPoint>();
        foreach (var crf in new[] { 16, 18, 20, 22, 24 })
        {
            var tune = FfmpegEncoder.BuildEncoderTuneArgs("libx264", crf, req.MaxrateKbps, req.BufsizeKbps, 0, 4, "p4");
            var path = Path.Combine(dir, $"s3-x264-crf{crf}.h264");
            var o = Encode("libx264", req, tune, src, req.Frames, path, null, srcMode);
            if (o.State != AmdProbeState.Works) continue;
            var vmaf = MeasureVmaf(src, path, req.Frames, srcMode);
            if (vmaf > 0) x264Sweep.Add(new AmdVmafPoint($"crf{crf}", 0, vmaf, o.OutputBytes));
        }

        Step("S3: curvas VMAF coletadas (AMF=" + amfCurve.Count + " pontos, x264=" + x264Sweep.Count + ")");

        // VMAF alvo = o do x264 no MESMO CQ que o usuário configurou.
        //
        // Sem fallback para "qualquer outro CRF": se o ponto do CQ configurado não mediu, o
        // alvo é desconhecido, e usar o primeiro ponto da lista faria o relatório comparar a
        // AMF contra um CQ que o usuário nunca pediu. Foi o que a primeira versão fazia
        // (OrderBy(Label).First()), herdando a mesma classe de erro do Item 8: um default
        // silencioso que produz número plausível errado em vez de dizer "não sei".
        var targetPoint = x264Sweep.FirstOrDefault(p => p.Label == $"crf{req.Cq}");
        var targetVmaf = targetPoint.Vmaf > 0 ? targetPoint.Vmaf : 0;
        if (targetVmaf <= 0)
        {
            notes.Add($"S3: o x264 no CQ {req.Cq} (o seu) nao produziu VMAF, entao nao ha alvo de comparacao: calibracao fica UNMEASURED.");
        }

        var productionTune = ProductionTune(subject, req, 0, "speed");
        var productionPath = Path.Combine(dir, $"s3-producao.{RawExt(subject)}");
        var production = Encode(subject, req, productionTune, src, req.Frames, productionPath, null, srcMode);
        var calibration = AmdAuditVerdicts.JudgeCalibration(production, amfCurve, x264Sweep, targetVmaf, req.MaxrateKbps);

        Step("S3: veredito de calibracao calculado");

        // ---------- S4: escada adaptativa ----------
        var qualityFps = new List<AmdLadderPoint>();
        foreach (var q in new[] { "high_quality", "quality", "balanced", "speed" })
        {
            var tune = ProductionTune(subject, req, 0, q);
            var path = Path.Combine(dir, $"s4-fps-{q}.{RawExt(subject)}");
            var o = Encode(subject, req, tune, src, req.Frames, path, null, srcMode);
            qualityFps.Add(new AmdLadderPoint(q, o.Fps, o.State == AmdProbeState.Works));
        }

        var chosen = EncoderManager.SelectAmfPreset(subject, req.Width, req.Height, req.Fps);
        var ladderVerdict = AmdAuditVerdicts.JudgeLadder(qualityFps, chosen, req.Fps, 0.85);
        var pa = TryProbeAmfExtra(subject, req, " -preanalysis true -pa_lookahead_buffer_depth 40 -pa_taq_mode 2", src, srcMode);
        var sav = TryProbeAmfExtra(subject, req, " -smart_access_video 1", src, srcMode);

        Step("S4: escada de preset medida; escolhendo com a logica de producao");

        // ---------- S6: custo em bytes de GOP 60 e b-frames na AMF ----------
        var gopBaseline = Path.Combine(dir, "s6-gop60." + RawExt(subject));
        var gopVariant = Path.Combine(dir, "s6-gop120." + RawExt(subject));
        var g60 = Encode(subject, req, ProductionTune(subject, req, 0, "speed"), src, req.Frames, gopBaseline, null, srcMode);
        var g120 = Encode(subject, req, ReplaceGop(ProductionTune(subject, req, 0, "speed"), 120), src, req.Frames, gopVariant, null, srcMode);
        var gopCost = AmdAuditVerdicts.JudgeByteCost(g60.OutputBytes, g120.OutputBytes, 2.0);

        var bfBaseline = Path.Combine(dir, "s6-bf0." + RawExt(subject));
        var bfVariant = Path.Combine(dir, "s6-bf2." + RawExt(subject));
        var b0 = Encode(subject, req, ProductionTune(subject, req, 0, "speed"), src, req.Frames, bfBaseline, null, srcMode);
        var b2 = Encode(subject, req, ReplaceBframes(ProductionTune(subject, req, 2, "speed")), src, req.Frames, bfVariant, null, srcMode);
        var bframeCost = AmdAuditVerdicts.JudgeByteCost(b0.OutputBytes, b2.OutputBytes, 2.0);

        Step("S6: custos de GOP e b-frames medidos");

        return new AmdAuditReport(
            BuildHeader(req, subject),
            matrix, subject,
            bitrateLadder, AmdAuditVerdicts.JudgeScaling(bitrateLadder),
            qualityLadder, AmdAuditVerdicts.JudgeScaling(qualityLadder),
            production, amfCurve, x264Sweep, calibration,
            qualityFps, chosen, ladderVerdict, pa, sav, gopCost, bframeCost, notes);
    }

    // ------------------------------------------------------------------ helpers

    private static string BuildHeader(AmdAuditRequest req, string subject)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"GPU: {GpuName()}");
        sb.AppendLine($"Config auditada: {req.Width}x{req.Height}@{req.Fps}, CQ {req.Cq}, maxrate {req.MaxrateKbps}K, bufsize {req.BufsizeKbps}K");
        sb.AppendLine($"Alvo AMF de producao (0.36 do maxrate): {req.AmfTargetKbps}K");
        sb.AppendLine($"Familia medida: {subject}");
        return sb.ToString();
    }

    private static AmdAuditReport MinimalReport(AmdAuditRequest req, IReadOnlyList<AmdEncodeOutcome> matrix, List<string> notes, string dir)
    {
        var empty = Array.Empty<AmdEncodeOutcome>();
        var emptyVmaf = Array.Empty<AmdVmafPoint>();

        // Mesmo cabeçalho do caminho normal: a pessoa precisa do alvo AMF de produção mesmo
        // quando não há AMF para medir, senão não dá para conferir contra a config dela.
        var header = new StringBuilder();
        header.AppendLine($"GPU: {GpuName()}");
        header.AppendLine($"Config auditada: {req.Width}x{req.Height}@{req.Fps}, CQ {req.Cq}, maxrate {req.MaxrateKbps}K, bufsize {req.BufsizeKbps}K");
        header.AppendLine($"Alvo AMF de producao (0.36 do maxrate): {req.AmfTargetKbps}K");
        header.AppendLine("Nenhum encoder AMF produziu arquivo: as secoes de AMF ficam UNMEASURED.");

        return new AmdAuditReport(
            header.ToString(),
            matrix, null,
            empty, AmdKnobState.Unmeasured,
            empty, AmdKnobState.Unmeasured,
            new AmdEncodeOutcome("producao", true, false, 0, 0, 0, "sem AMF"),
            emptyVmaf, emptyVmaf,
            new AmdCalibrationVerdict(AmdCalibrationState.Unmeasured, 0.36, null, null, null, 0, 0),
            Array.Empty<AmdLadderPoint>(), null,
            new AmdLadderVerdict(AmdProbeState.Unmeasured, "", 0, req.Fps, false, false),
            null, null,
            new AmdByteCostVerdict(0, false, "unmeasured"),
            new AmdByteCostVerdict(0, false, "unmeasured"),
            notes);
    }

    /// <summary>
    /// Args de produção, resolvidos como a captura os resolve.
    ///
    /// <para><b>A versão anterior fixava <c>lookahead: 4</c>, <c>"p4"</c>, sem preanalysis e
    /// sem SAV, e o cabeçalho do arquivo afirmava "zero drift de args". Não havia zero
    /// drift: a comparação honesta é com o que a produção realmente manda, que é
    /// <c>ConfigManager.Lookahead = 16</c>, <c>Multipass = true</c> e — para AMF —
    /// <c>EncoderManager.SelectAmfPreset</c>, <c>SelectAmfPreanalysis</c> e
    /// <c>SupportsSmartAccessVideo</c>, os três medidos. Um audit que mede preanalysis
    /// desligado e relata o resultado como se fosse a configuração de produção está
    /// medindo outro encoder, e a diferença não é cosmética: preanalysis é boa parte do
    /// controle de taxa da AMF, que é justamente o que a S2 e a S3 tentam calibrar.</para>
    ///
    /// <para>Os <c>Select*</c> são os mesmos da produção e usam o mesmo cache, então o custo
    /// é o de uma medição por sessão — e é o que torna o número comparável com o que a
    /// captura fará. Eles exigem dimensões reais: passar <c>0x0@0</c> faz o probe não ter o
    /// que medir.</para>
    ///
    /// <para><b>internal desde o <c>--probe-amf-cqp</c></b>: o A/B do CQP precisa da chain de
    /// produção <b>exata</b> (mesmo preset adaptativo, mesmo lookahead, mesmo multipass) como
    /// uma das pontas, e reconstruir a string no runner criaria uma segunda cópia que
    /// diverge em silêncio — o mesmo motivo de <c>amfTargetFor</c> chamar
    /// <c>ComputeAmfTargetKbps</c> em vez de replicar o 0,36.</para>
    /// </summary>
    internal static string ProductionTune(string codec, AmdAuditRequest req, int bframes, string? amfPreset = null)
    {
        var isAmf = EncoderManager.IsAmfCodec(codec);
        var resolvedPreset = amfPreset
            ?? (isAmf ? EncoderManager.SelectAmfPreset(codec, req.Width, req.Height, req.Fps) : "speed");
        var preanalysis = isAmf && amfPreset == null
            && EncoderManager.SelectAmfPreanalysis(codec, req.Width, req.Height, req.Fps, resolvedPreset);
        var sav = isAmf && amfPreset == null
            && EncoderManager.SupportsSmartAccessVideo(codec, req.Width, req.Height, req.Fps);

        return FfmpegEncoder.BuildEncoderTuneArgs(
            codec, req.Cq, req.MaxrateKbps, req.BufsizeKbps, bframes, req.Lookahead, "p4",
            amfPreset: resolvedPreset, multipass: req.Multipass, amfPreanalysis: preanalysis, amfSav: sav);
    }

    /// <summary>Args de produção com o preset de <c>-quality</c> fixado à mão. Existe para a
    /// S4, onde varrer o preset é o objetivo — e só lá a varredura substitui a medição.
    /// </summary>

    /// <summary>Troca o <c>-b:v</c> da linha de comando. Devolve <c>false</c> quando não
    /// havia <c>-b:v</c> para trocar — não é caso theoretical: só AMF e D3D12VA recebem
    /// <c>-b:v</c> de <c>BuildEncoderTuneArgs</c>, e <c>--audit-amd</c> aceita um
    /// <c>CODEC</c> arbitrário justamente para rodar em máquina sem AMF.
    ///
    /// <para>A versão anterior devolvia a string sem mudar nada, e o chamador seguia como se
    /// tivesse calibrado: os três pontos da curva saíam com a taxa da config, o VMAF ficava
    /// igual nos três, e o judge respondia "curva chapada" — que é um diagnóstico plausível
    /// e <b>errado</b>, porque nenhum rung variou taxa alguma. Agora o rung é descartado e o
    /// relatório mostra uma curva de um ponto só, que é o que aconteceu.</para></summary>
    internal static bool TryFixAmfBitrate(string tune, int kbps, out string patched)
    {
        var parts = tune.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        var i = parts.FindIndex(p => p == "-b:v");
        if (i < 0 || i + 1 >= parts.Count)
        {
            patched = tune;
            return false;
        }

        parts[i + 1] = $"{kbps}K";
        patched = string.Join(' ', parts);
        return true;
    }

    /// <summary>
    /// Reescreve a chain AMF de produção (<c>-rc vbr_peak -b:v {maxrate*0,36}</c>) no modo
    /// CQP, para o A/B do <c>--probe-amf-cqp</c>: <c>-rc cqp -qp_i {cq} -qp_p {cq}</c>,
    /// <b>tirando o alvo de taxa e preservando o teto VBV e o AQ</b>.
    ///
    /// <para><b>Por que preservar <c>-maxrate</c>/<c>-bufsize</c> e não fazer CQP puro.</b>
    /// A cadeia de produção registra (<c>FfmpegEncoder.cs:321-325</c>) que <b>CQP puro já
    /// estourou ~180 Mbps na RX 5700 XT</b>, com spill ~10x e clip de 94 s ≈ 930 MB. Refazer
    /// isso aqui não mediria nada de novo: o probe repetiria um estouro conhecido e o
    /// chamaria de "CQP não serve na AMF". O que nunca foi medido é CQP <i>com o teto que o
    /// front já manda</i>, e é essa a pergunta do A/B. Teto igual nas duas pontas também
    /// mantém a variável isolada: muda o RC, nada mais.</para>
    ///
    /// <para><b>Por que <c>-b:v</c> sai em vez de virar 0.</b> Alvo de taxa e QP brigam: o
    /// QP é sobreposto pelo alvo (issue obs-ffmpeg #12994, citada na própria cadeia), que é
    /// exatamente o motivo de a produção não emitir QP. Um A/B entre "taxa" e "QP" que
    /// mantém a taxa nos dois lados não é um A/B de RC.</para>
    ///
    /// <para><b>Nome, e não índice.</b> O <c>-rc cqp</c> é o <b>nome</b> do modo, e o ffmpeg
    /// valida nome de RC — o que o <c>-rc 1</c> do D3D12VA não faz (aceita em silêncio, e
    /// ninguém sabe se 1 é CQP). Se este nome deixar de existir, o probe morre alto em vez
    /// de medir em modo errado.</para>
    ///
    /// <para>Devolve <c>false</c> sem <c>-rc</c> ou sem <c>-b:v</c>: nesses casos devolver a
    /// string intacta mediria as mesmas duas chains e publicaria um A/B que não aconteceu.</para>
    /// </summary>
    /// <summary>Os quatro presets de <c>-quality</c> que o S2b mede, na ordem do
    /// <c>ffmpeg -h encoder=h264_amf</c> (rápido → Caro). Os <b>nomes</b> são os mesmos nos
    /// três AMF; os <b>índices</b> não (medido: <c>speed</c> = 1 no h264, 10 no hevc, 100 no
    /// av1) — por isso a lista é de nomes e a cadeia nunca emite número. Ver
    /// <c>AmfNumericIndexDivergenceTests</c>.</summary>
    internal static readonly IReadOnlyList<string> QualityPresets = new[] { "speed", "balanced", "quality", "high_quality" };

    /// <summary>Monta a escada do S2b e carimba cada rung com o <b>nome do preset</b>.
    ///
    /// <para><b>Por que um seam e não a lista inline no <c>Run</c>.</b> O <c>Label</c> do
    /// <see cref="AmdEncodeOutcome"/> é preenchido por <c>Encode</c> com o <b>codec</b>, e o
    /// S2b é justamente a seção que varia o preset com o codec fixo. A tabela imprimia
    /// <c>o =&gt; o.Label</c>, então as quatro linhas saíam <b>"h264_amf" quatro vezes</b> —
    /// lidas como quatro encodes do mesmo preset, quando são <c>speed</c>, <c>balanced</c>,
    /// <c>quality</c> e <c>high_quality</c>. A tabela não conseguia responder a pergunta que
    /// o S2b faz ("o -quality tem autoridade?"), porque a coluna que varia era constante.
    ///
    /// <para><b>Por que o teste do report writer não pegaria.</b> Ele recebe as linhas já
    /// prontas: com quatro labels iguais, imprimir quatro linhas iguais é o comportamento
    /// <i>correto</i> da impressora. O defeito está em como as linhas são construídas, e isso
    /// só aparece perto do <c>Encode</c> real. Passando o encode por um delegate, o teste
    /// exercita a carimbagem sem ffmpeg — e <b>cai se o <c>with { Label = ... }c> for
    /// removido</b>, que é a mutação que reproduz o bug.</para>
    ///
    /// <para>Mesma forma do <c>TryMakeAmfCqpTune</c>: transformar, não adicionar parâmetro
    /// de produção.</para></summary>
    internal static IReadOnlyList<AmdEncodeOutcome> BuildQualityLadder(
        Func<string, AmdEncodeOutcome> runOne, IReadOnlyList<string>? presets = null)
    {
        var lista = presets ?? QualityPresets;
        var ladder = new List<AmdEncodeOutcome>(lista.Count);
        foreach (var preset in lista)
            ladder.Add(runOne(preset) with { Label = preset });
        return ladder;
    }

    internal static bool TryMakeAmfCqpTune(string tune, int cq, out string patched)
    {
        patched = tune;
        var parts = tune.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();

        var rcIdx = parts.FindIndex(p => p == "-rc");
        if (rcIdx < 0 || rcIdx + 1 >= parts.Count) return false;

        var bvIdx = parts.FindIndex(p => p == "-b:v");
        if (bvIdx < 0 || bvIdx + 1 >= parts.Count) return false;

        var qp = cq.ToString(CultureInfo.InvariantCulture);
        // O -rc é ajustado ANTES do RemoveRange: remover "-b:v <valor>" desloca os índices
        // seguintes em 2, e ajustar depois escreveria no lugar errado.
        parts[rcIdx + 1] = "cqp";
        parts.RemoveRange(bvIdx, 2);
        // Reaproveitado o lugar do alvo de taxa, para o relatório mostrar um diff curto.
        parts.InsertRange(bvIdx, new[] { "-qp_i", qp, "-qp_p", qp });

        patched = string.Join(' ', parts);
        return true;
    }

    private static string ReplaceGop(string tune, int gop)
    {

        var parts = tune.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        var i = parts.FindIndex(p => p == "-g");
        if (i >= 0 && i + 1 < parts.Count) parts[i + 1] = gop.ToString(CultureInfo.InvariantCulture);
        return string.Join(' ', parts);
    }

    private static string ReplaceBframes(string tune)
    {
        var parts = tune.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        var i = parts.FindIndex(p => p == "-bf");
        if (i >= 0 && i + 1 < parts.Count) parts[i + 1] = "2";
        return string.Join(' ', parts);
    }

    internal static string RawExt(string codec) =>
        FfmpegEncoder.GetRawFormatForCodec(codec) == "av1" ? "ivf" : FfmpegEncoder.GetRawFormatForCodec(codec);

    internal static HashSet<string> ListedEncoders()
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var psi = FfmpegPathResolver.CreateFfmpegStartInfo(
                "-hide_banner -encoders", redirectOutput: true, redirectError: true);
            using var p = Process.Start(psi)!;
            // Mesmo bug que a correção do drain em MeasureVmaf documenta, e na forma mais
            // pura: dois ReadToEnd() sequenciais e o WaitForExit(timeout) DEPOIS deles. O
            // timeout nunca chega a rodar (os ReadToEnd só voltam quando o processo
            // termina), e dois pipes lidos em sequência é a forma clássica de travar em
            // buffer cheio de 4 KB. No binário de hoje o stderr de -encoders vem vazio, então
            // isto é armadilha latente — e armadilha latente em ferramenta que o usuário
            // roda com a mão é exatamente o tipo de coisa que trava o teste 6 no dia errado.
            var outTask = Task.Run(() => p.StandardOutput.ReadToEnd());
            var errTask = Task.Run(() => p.StandardError.ReadToEnd());
            if (!p.WaitForExit(30_000))
            {
                try { p.Kill(true); } catch { }
                return set;
            }

            var text = outTask.Wait(5_000) ? outTask.Result : "";
            foreach (var line in text.Split('\n'))
            {
                var t = line.Trim();
                if (t.Length < 8 || t.Contains("-------")) continue;
                var parts = t.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 2) continue;
                var name = parts[1];
                if (Codecs.Contains(name, StringComparer.OrdinalIgnoreCase)) set.Add(name);
            }
        }
        catch { /* ffmpeg ausente: tudo vira NotPresent, que o relatório diz */ }
        return set;
    }

    /// <summary>Roda um encode real e devolve o resultado cru. Nunca lança: um probe que
    /// falha é um dado do relatório, não uma exceção que derruba o audit inteiro.</summary>
    internal static AmdEncodeOutcome Encode(
        string codec, AmdAuditRequest req, string tune, string source, int frames, string outPath, string? extraInput,
        AmdSourceMode sourceMode)
    {
        var args = new List<string> { "-y", "-loglevel", "error" };
        args.AddRange(SourceInputArgs(source, sourceMode));
        if (extraInput != null) { args.Add("-f"); args.Add("lavfi"); args.Add("-i"); args.Add(extraInput); }
        args.Add("-c:v"); args.Add(codec);
        foreach (var a in tune.Split(' ', StringSplitOptions.RemoveEmptyEntries)) args.Add(a);

        // Mesmo formato para todas as famílias: sem isto, cada encoder escolhe o seu
        // default e a comparação de bytes entre AMF e x264 passa a medir também uma
        // diferença de formato. yuv420p é o mesmo layout 4:2:0 8-bit que a captura entrega
        // em NV12.
        args.Add("-pix_fmt"); args.Add("yuv420p");
        args.Add("-frames:v"); args.Add(frames.ToString(CultureInfo.InvariantCulture));
        args.Add(Quote(outPath));

        var sw = Stopwatch.StartNew();
        var stderr = new List<string>();
        try
        {
            var psi = FfmpegPathResolver.CreateFfmpegStartInfo(
                Join(args), redirectInput: false, redirectOutput: false, redirectError: true);
            using var p = Process.Start(psi)!;
            var errTask = Task.Run(() =>
            {
                try
                {
                    string? line;
                    while ((line = p.StandardError.ReadLine()) != null)
                    {
                        lock (stderr) { if (stderr.Count < 6) stderr.Add(line.Trim()); }
                    }
                }
                catch (IOException) { }
                catch (ObjectDisposedException) { }
            });
            if (!p.WaitForExit(TimeoutMs))
            {
                try { p.Kill(true); } catch { }
                return new AmdEncodeOutcome(codec, true, false, 0, sw.Elapsed.TotalSeconds, 0, "timeout") { NominalSeconds = Nominal(req, frames) };
            }
            // sw.Stop() ANTES de esperar o drain: o drain pode levar até 2 s e contaminaria
            // o tempo do encode. A leitura do pipe termina junto com o processo, então
            // esperar depois não muda o que já foi lido.
            sw.Stop();
            try { errTask.Wait(2000); } catch { }

            long bytes = 0;
            try { if (File.Exists(outPath)) bytes = new FileInfo(outPath).Length; } catch { }
            string tail;
            lock (stderr) { tail = string.Join(" | ", stderr); }

            // Exit code vai junto porque o ffmpeg pode sair com erro DEPOIS de escrever parte
            // do arquivo; sem ele, um encode truncado seria reportado como WORKS.
            return new AmdEncodeOutcome(codec, true, true, bytes, sw.Elapsed.TotalSeconds, frames, tail, p.ExitCode) { NominalSeconds = Nominal(req, frames) };
        }
        catch (Exception ex)
        {
            return new AmdEncodeOutcome(codec, true, false, 0, sw.Elapsed.TotalSeconds, 0, ex.GetType().Name) { NominalSeconds = Nominal(req, frames) };
        }
    }

    /// <summary>Duração que o clipe deveria ter (frames / fps da fonte). É o denominador
    /// honesto da taxa: o wall-clock do processo inclui startup do ffmpeg e init do encoder,
    /// que não são "conteúdo por segundo".</summary>
    internal static double Nominal(AmdAuditRequest req, int frames) => req.Fps > 0 ? frames / (double)req.Fps : 0;

    /// <summary>VMAF do distorcido contra a referência lavfi. Devolve 0 quando não dá para
    /// medir — e 0 nunca vira veredito, o judge trata como UNMEASURED.
    ///
    /// <para><b>Por que o drain vai numa task e não em ReadToEnd antes do WaitForExit.</b>
    /// <c>ReadToEnd()</c> em processo filho bloqueia até o pipe fechar, então um
    /// <c>WaitForExit(timeout)</c> escrito DEPOIS dele nunca roda: se o ffmpeg travar, esta
    /// função espera para sempre. Foi exatamente o que aconteceu na primeira execução
    /// completa (o audit passou de 30 min sem imprimir nada). O drain em task separada dá um
    /// timeout que existe de fato, com kill no estouro.</para></summary>
    /// <summary>Argumentos do <c>libvmaf</c>, com a ordem de entradas <b>certa</b>.
    ///
    /// <para><b>Por que isto é uma função e não uma lista inline:</b> porque a primeira
    /// versão estava invertida e nada no resultado denunciava. O <c>ffmpeg -h filter=libvmaf</c>
    /// do binário embarcado diz <c>#0: main</c> e <c>#1: reference</c>; a versão anterior
    /// passava a fonte lavfi (íntegra) como <c>#0</c> e o arquivo codificado como <c>#1</c>,
    /// ou seja media "quão bem a íntegra adivinha a codificada" — que não é VMAF. Medido no
    /// binário real com um arquivo destruído (x264 crf 40, 33 KB contra 2038 KB de
    /// referência): a ordem correta dá <b>36,77</b> e a invertida dava <b>60,68</b>. O pior:
    /// a inflação <i>cresce</i> com a distorção (numa medição a 5,79 reais viravam 34,00),
    /// então o número parecia bom justamente nas imagens ruins — que é o caso em que o
    /// relatório serve para acusar alguma coisa.</para>
    ///
    /// <para>O <c>-frames:v</c> não é opcional: a fonte lavfi é infinita, e sem o limite o
    /// ffmpeg nunca chega ao EOF (foi o que gastou 24 min na primeira execução completa). E
    /// o <c>eof_action=endall</c> impede o framesync de <b>repetir o último frame</b> de um
    /// arquivo curto: sem ele, um encode que entregou 112 de 120 frames ainda produzia uma
    /// pontuação válida, escondendo o arquivo truncado.</para></summary>
    internal static string[] BuildVmafArgs(string source, string distortedPath, int frames,
        AmdSourceMode sourceMode)
    {
        var args = new List<string>
        {
            "-hide_banner",
            // #0 = main = o que foi codificado (o distorcido).
            "-i", Quote(distortedPath),
        };
        // #1 = reference = a origem íntegra, pela MESMA fonte que o encoder recebeu.
        args.AddRange(SourceInputArgs(source, sourceMode));
        args.AddRange([
            "-frames:v", frames.ToString(CultureInfo.InvariantCulture),
            "-lavfi", "libvmaf=model=version=vmaf_v0.6.1:eof_action=endall",
            "-f", "null", "-",
        ]);
        return [.. args];
    }

    internal static double MeasureVmaf(string source, string distortedPath, int frames,
        AmdSourceMode sourceMode)
    {
        try
        {
            var args = new List<string>(BuildVmafArgs(source, distortedPath, frames, sourceMode));
            var psi = FfmpegPathResolver.CreateFfmpegStartInfo(
                Join(args), redirectInput: false, redirectOutput: false, redirectError: true);
            using var p = Process.Start(psi)!;
            var drain = Task.Run(() =>
            {
                try { return p.StandardError.ReadToEnd(); }
                catch (IOException) { return ""; }
                catch (ObjectDisposedException) { return ""; }
            });

            if (!p.WaitForExit(TimeoutMs))
            {
                try { p.Kill(true); } catch { }
                return 0;
            }

            string text;
            try { text = drain.Wait(5_000) ? drain.Result : ""; }
            catch (AggregateException) { return 0; }

            // "VMAF score: 92.352499" - âncora no texto, não na posição, porque o ffmpeg
            // pode imprimir outras linhas com número antes.
            const string anchor = "VMAF score:";
            var idx = text.IndexOf(anchor, StringComparison.Ordinal);
            if (idx < 0) return 0;
            var tail = text[(idx + anchor.Length)..].Trim();
            var end = 0;
            while (end < tail.Length && (char.IsDigit(tail[end]) || tail[end] == '.')) end++;
            return double.TryParse(tail[..end], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
        }
        catch { return 0; }
    }

    private static bool? TryProbeAmfExtra(string codec, AmdAuditRequest req, string extra, string source, AmdSourceMode sourceMode)
    {
        var dir = Path.Combine(Path.GetTempPath(), "dinho-amd-audit");
        var tune = ProductionTune(codec, req, 0, "speed") + extra;
        var path = Path.Combine(dir, $"s4-extra-{extra.GetHashCode():X}.{RawExt(codec)}");
        var o = Encode(codec, req, tune, source, req.Frames, path, null, sourceMode);

        // Recusa é <c>false</c>, não <c>null</c>. Devolver null (desconhecido) para os três
        // casos punha na coluna "sem dados" um resultado que foi medido: a diferença entre
        // "o encoder não suporta isto" e "não sei" é a diferença entre fechar a investigação
        // e não ter para onde olhar. Só exception/timeout continuam desconhecidos.
        return o.State switch
        {
            AmdProbeState.Works => true,
            AmdProbeState.Refused => false,
            _ => null,
        };
    }

    /// <summary>Monta a linha de comando. <c>CreateFfmpegStartInfo</c> preenche
    /// <c>ProcessStartInfo.Arguments</c> (uma string), não <c>ArgumentList</c> — então o
    /// quoting é responsabilidade de quem chama, e o TEMP do usuário pode ter espaço.
    /// Não cita automaticamente: os chamadores já citam o que precisa, e citar duas vezes
    /// seria pior que não citar.</summary>
    private static string Join(IEnumerable<string> args) => string.Join(' ', args);

    private static string Quote(string s) => $"\"{s}\"";

    private static string GpuName()
    {
        try
        {
            var psi = new ProcessStartInfo("powershell.exe")
            {
                RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
            };
            foreach (var a in new[] { "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name" }) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            var name = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(15_000);
            return string.IsNullOrWhiteSpace(name) ? "desconhecida" : name;
        }
        catch { return "desconhecida"; }
    }
}
