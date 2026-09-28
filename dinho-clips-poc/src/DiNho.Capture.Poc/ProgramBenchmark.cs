using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;
using DiNho.Capture.Poc.Bench;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Sync;
using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;
using Windows.Win32;
using Windows.Win32.Foundation;

namespace DiNho.Capture.Poc;

/// <summary>
/// Veredito do A/B de <c>-profile:v</c> no HEVC (Item 9). Fixado ANTES de medir: main10 só fica
/// se ganhar bytes sem custo de fps relevante, senão sai. O ponto de <see cref="Unmeasured"/>
/// existir é que ele é um estado de primeira classe — sem ele, "não medi" seria reportado como
/// "não compensa", que é uma conclusão que o número não sustenta.
/// </summary>
internal enum HevcProfileVerdict
{
    /// <summary>Nenhum dos dois lados mediu (ffmpeg ausente, encoder recusou a chain).</summary>
    Unmeasured,
    /// <summary>main10 passa nos dois lados do critério: fica em produção.</summary>
    KeepMain10,
    /// <summary>main10 reprova o critério: sai de produção.</summary>
    RemoveMain10,
}

internal static class ProgramBenchmark
{
    private const int FramesBenchmark = 300;
    private const int CaptureTimeoutMs = 500;

    internal static void TestEncoders()
    {
        Console.WriteLine("=== Available Encoders ===\n");

        var avail = EncoderManager.DetectAvailableEncoders();
        foreach (var enc in avail)
            Console.WriteLine($"  {enc}");

        Console.WriteLine();
        Console.WriteLine("Testing encoder initialization...\n");

        foreach (var type in avail)
        {
            Console.Write($"  {type}... ");
            try
            {
                using var enc = EncoderManager.CreateEncoder(type);
                enc.Initialize(640, 480, 30);
                enc.Flush();
                Console.WriteLine("OK");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"FAILED: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// CLI --probe-nvenc: mede achievedFps real de cada preset NVENC (p7→p1) na resolução/fps
    /// alvo (default 1920x1080@60, override via args). Usa a MESMA cadeia de tune de produção
    /// (cq18/lookahead16/multipass fullres) — o número medido é o throughput que o pipeline teria.
    /// Diagnóstico do drift A/V: av1_nvenc p5 sustentava só ~46fps (0.76x) → vídeo atrasava.
    /// </summary>
    /// <summary>
    /// Resumo de um probe de presets NVENC, separando as DUAS perguntas que o relatório
    /// confidia: o preset mais rápido (argmax) e o preset de melhor qualidade que sustenta o
    /// alvo (primeiro sustaining na escada p7→p1). O relatório antigo anunciava a segunda e
    /// imprimia a primeira, e essa inversão já gerou uma leitura errada de plano.
    /// </summary>
    internal readonly record struct NvencProbeSummary(
        string? FastestPreset, double? FastestFps,
        string? BestQualitySustaining, double? BestQualitySustainingFps,
        double SustainThresholdFps, bool AnyMeasured)
    {
        internal string ToReportLine(int targetFps)
        {
            if (!AnyMeasured) return "  → nenhum preset medido (ffmpeg indisponível?)";
            var fastest = FastestPreset is null
                ? "nenhum"
                : $"{FastestPreset} ({FastestFps:0.00} fps)";
            // Sem nada que sustente: só essa linha, e ela já é o alerta. A versão anterior
            // usava "{0:F0}" sem string.Format — o CLI imprimia o placeholder literal no
            // aviso de que nenhum preset aguenta o alvo, e o teste passava porque só
            // checava o prefixo.
            var best = BestQualitySustaining is null
                ? $"NENHUM sustenta (abaixo de {SustainThresholdFps:F0}fps) — GPU não dá conta do alvo"
                : $"{BestQualitySustaining} ({BestQualitySustainingFps:0.00} fps)";
            return $"  → mais rápido: {fastest} | melhor qualidade que sustenta ≥{SustainThresholdFps:F0}fps: {best}";
        }
    }

    /// <summary>
    /// Escada de presets NVENC em ordem de qualidade: p7 (best quality) → p1 (lowest quality),
    /// conforme <c>ffmpeg -h encoder=h264_nvenc</c>. O probe do CLI percorre nessa ordem.
    /// </summary>
    internal static readonly string[] NvencPresetLadder = { "p7", "p6", "p5", "p4", "p3", "p2", "p1" };

    /// <summary>
    /// Seam puro do resumo do probe (sem I/O, sem ffmpeg) para ser testado. Sustenta o alvo
    /// quando o preset mede ≥ 85% do fps — o mesmo corte do
    /// <see cref="EncoderManager.SelectNvencPreset"/>, para o CLI e a produção nunca discordarem
    /// do que é "sustentável".
    /// </summary>
    internal static NvencProbeSummary SummarizeNvencProbe(
        IReadOnlyDictionary<string, double?> measured, int targetFps)
    {
        var threshold = targetFps * 0.85;

        string? fastestPreset = null;
        double? fastestFps = null;
        foreach (var (preset, fps) in measured)
        {
            if (fps is null) continue;
            if (fastestFps is null || fps > fastestFps)
            {
                fastestFps = fps;
                fastestPreset = preset;
            }
        }

        // Escada p7→p1 = melhor→pior qualidade: a PRIMEIRA que sustenta é a melhor possível.
        string? best = null;
        double? bestFps = null;
        foreach (var preset in NvencPresetLadder)
        {
            if (!measured.TryGetValue(preset, out var fps) || fps is null) continue;
            if (fps >= threshold) { best = preset; bestFps = fps; break; }
        }

        return new NvencProbeSummary(
            fastestPreset, fastestFps, best, bestFps, threshold, fastestPreset is not null);
    }

    internal static void ProbeNvencPresets(string widthArg, string heightArg, string fpsArg)
    {
        int.TryParse(widthArg, out var w);
        int.TryParse(heightArg, out var h);
        int.TryParse(fpsArg, out var fps);
        int width = w > 0 ? w : 1920;
        int height = h > 0 ? h : 1080;
        int targetFps = fps > 0 ? fps : 60;

        Console.WriteLine("=== NVENC Throughput Probe ===");
        Console.WriteLine($"Resolução: {width}x{height}@{targetFps}fps | cadeia = produção (cq18/lookahead16/multipass fullres)");
        Console.WriteLine();

        foreach (var codec in new[] { "av1_nvenc", "hevc_nvenc", "h264_nvenc" })
        {
            if (!EncoderManager.CheckFfmpegEncoder(codec))
            {
                Console.WriteLine($"  {codec}: ffmpeg sem suporte — pulado");
                Console.WriteLine();
                continue;
            }
            Console.WriteLine($"-- {codec} --");
            // Duas perguntas DISTINTAS, e confundi-las gera leitura errada da tabela:
            //
            //   1. "qual preset é o mais rápido?" → o argmax do fps medido. Serve para ver o
            //      custo máximo de preset, mas é Ruído quando tudo está muito acima do alvo
            //      (medido: o argmax saltou entre p1/p2/p6 em runs repetidos a 1080p60).
            //
            //   2. "qual o preset de MELHOR QUALIDADE que ainda sustenta o alvo?" → primeira
            //      sustaining na escada p7→p1. p7 é "slowest (best quality)" no NVENC e p1 é
            //      "fastest (lowest quality)" (ffmpeg -h encoder=h264_nvenc), então p7→p1 é
            //      da melhor para a pior qualidade. É a escada que ResolveEffectiveNvencPreset
            //      usa em produção.
            //
            // O relatório antigo dizia "melhor preset que sustenta >=51fps" e imprimia o
            // argmax — ou seja, anunciava a pergunta 2 e respondia a pergunta 1.
            var measured = new Dictionary<string, double?>();
            foreach (var preset in NvencPresetLadder)
            {
                double? achieved;
                try { achieved = EncoderManager.ProbeNvencSpeed(codec, width, height, targetFps, preset); }
                catch { achieved = null; }
                string ok = achieved.HasValue && achieved >= targetFps * 0.85 ? "  ✓ sustenta" : "";
                Console.WriteLine($"    {preset}: {(achieved.HasValue ? $"{achieved.Value:0.00} fps" : "falhou")}{ok}");
                measured[preset] = achieved;
            }
            var summary = SummarizeNvencProbe(measured, targetFps);
            Console.WriteLine(summary.ToReportLine(targetFps));
            Console.WriteLine();
        }
    }

    /// <summary>
    /// CLI --probe-vbv: mede throughput e bitrate efetivo de cada candidato de -bufsize (VBV)
    /// na cadeia de tune REAL de produção. Existe para responder com NÚMERO, não com palpite,
    /// a pergunta "o bufsizeFolgado (2 x maxrate) do front é o motivo dos arquivos inchados?".
    ///
    /// <para>RESULTADO MEDIDO (RTX 5050, driver 32.0.16.1714, ffmpeg 9.0.1 Gyan full,
    /// 2026-09-25, cq 16 / 1920x1080@60 / maxrate 65000): <b>o -bufsize não tem efeito</b>.
    /// h264_nvenc devolveu 3019 KiB byte-idêntico com 130000/64000/48000/32000 K; bitrate
    /// efetivo 16,5 Mbps contra teto de 65 Mbps. hevc_nvenc e av1_nvenc idem. Com
    /// <c>-rc vbr -b:v 0</c> o VBV só é consultado quando o -maxrate é atingido, e as chains
    /// atuais nunca chegam lá. A linha "VBV APERTA" só aparece com maxrate apertado.</para>
    ///
    /// <para>Uso: --probe-vbv [W H FPS CQ MAXRATE BUFSIZES(com vírgula)]  (default 1920 1080 60 18 55000)</para>
    /// </summary>
    internal static void ProbeVbv(
        string widthArg, string heightArg, string fpsArg, string cqArg, string maxrateArg, string candidatesArg)
    {
        int.TryParse(widthArg, out var w);
        int.TryParse(heightArg, out var h);
        int.TryParse(fpsArg, out var fps);
        int.TryParse(cqArg, out var cq);
        int.TryParse(maxrateArg, out var mr);
        int width = w > 0 ? w : 1920;
        int height = h > 0 ? h : 1080;
        int targetFps = fps > 0 ? fps : 60;
        int targetCq = cq > 0 ? cq : 18;
        int maxrateKbps = mr > 0 ? mr : 55000;
        var configuredBufsize = maxrateKbps * 2;

        var candidates = (candidatesArg ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var v) ? v : 0)
            .Where(v => v > 0)
            .ToList();
        if (candidates.Count == 0) candidates = [configuredBufsize, 64000, 48000, 32000];
        if (!candidates.Contains(configuredBufsize)) candidates.Insert(0, configuredBufsize);

        Console.WriteLine("=== VBV Probe (-bufsize) ===");
        Console.WriteLine($"Resolução: {width}x{height}@{targetFps}fps | cq={targetCq} | maxrate={maxrateKbps}K");
        Console.WriteLine($"bufsize cru do front (2 x maxrate) = {configuredBufsize}K");
        Console.WriteLine($"alvo médio AMF (-b:v) = {FfmpegEncoder.ComputeAmfTargetKbps(maxrateKbps)}K");
        Console.WriteLine();

        foreach (var codec in new[] { "h264_nvenc", "hevc_nvenc", "av1_nvenc", "h264_amf", "hevc_amf", "av1_amf" })
        {
            if (!EncoderManager.CheckFfmpegEncoder(codec)) continue;

            Console.WriteLine($"-- {codec} --");
            double? baselineFps = null;
            double? baselineRate = null;
            var codecIndisponivel = false;
            foreach (var vbv in candidates)
            {
                if (codecIndisponivel) break;
                var r = EncoderManager.RunVbvProbe(codec, width, height, targetFps, targetCq, maxrateKbps, configuredBufsize, vbv);
                if (r is null)
                {
                    // Sem GPU para este codec (ex.: h264_amf numa máquina NVIDIA) o ffmpeg
                    // sai != 0 em TODOS os candidatos. Testar os outros só multiplica o
                    // kill-guard por 4 — aborta o codec aqui, mas imprime o stderr do ffmpeg
                    // pra distinguir "sem GPU" de "VBV inválido".
                    var saida = new List<string>();
                    var retry = EncoderManager.RunVbvProbe(
                        codec, width, height, targetFps, targetCq, maxrateKbps,
                        configuredBufsize, vbv, onStderr: saida.Add);
                    if (retry is null)
                    {
                        Console.WriteLine("    sem GPU/driver (ou VBV inválido) — abortado");
                        foreach (var l in saida) Console.WriteLine($"      ffmpeg: {l}");
                        codecIndisponivel = true;
                        break;
                    }
                    r = retry;
                }
                baselineFps ??= r.AchievedFps;
                baselineRate ??= r.BitrateKbps;
                var dFps = baselineFps > 0 ? (r.AchievedFps / baselineFps - 1) * 100 : 0;
                var dRate = baselineRate > 0 ? (r.BitrateKbps / baselineRate.Value - 1) * 100 : 0;
                // Format com ';' precisa sair do hole de interpolação (o ';' fecha a seção).
                var dFpsTxt = $"{dFps:+0;-0;0}%";
                var dRateTxt = $"{dRate:+0;-0;0}%";
                // headroom negativo = o encoder passou do -maxrate, ou seja, o VBV apertou.
                var headroomTxt = r.VbvBinds
                    ? $"VBV APERTA (-{-r.HeadroomToMaxrateKbps:0} K)"
                    : $"folga p/ teto {r.HeadroomToMaxrateKbps:0} K";
                Console.WriteLine(
                    $"    {vbv,7} K: {r.AchievedFps,7:0.00} fps ({dFpsTxt,7}) | " +
                    $"{r.BitrateKbps,8:0.0} Kbps ({dRateTxt,7}) | {r.OutputBytes / 1024,6} KiB | {headroomTxt}");
            }
            Console.WriteLine();
        }
    }

    /// <summary>
    /// CLI --probe-amf-usage: mede throughput e bitrate efetivo de cada <c>-usage</c> da AMF
    /// (ffmpeg 9) na cadeia de tune REAL de produção, com CQ e bitrate idênticos em todos os
    /// candidatos — o probe isola o usage. É o que decide, com NÚMERO, se o default de
    /// <c>AmfUsage</c> deve sair de <c>transcoding</c> (PCVBR, VBV 20 Mbit,
    /// LOWLATENCY_MODE=false ⇒ ≥3 frames antes de qualquer output) para <c>ultralowlatency</c>
    /// (LCVBR, VBV 735 kbit, output no 1º frame — o usage que a doc da AMD indica para video
    /// game streaming) ou <c>webcam</c> (PCVBR, VBV 2 Mbit).
    ///
    /// <para><b>Precisa rodar em máquina com GPU AMD.</b> Sem AMF todos os candidatos devolvem
    /// null e o probe diz "sem encoder AMF disponível" — resposta honesta, e não um chute.</para>
    ///
    /// <para>Uso: --probe-amf-usage [W H FPS CQ MAXRATE CODEC USAGES(com vírgula)]
    /// (default 1920 1080 60 18 55000 h264_amf, todos os seis)</para>
    /// </summary>
    /// <summary>Token de linha de comando que pede a referência: o default de produção, que
    /// depois do Item 3 é <b>não passar <c>-usage</c> nenhum</b>.</summary>
    internal const string AmfDefaultUsageToken = "default";

    /// <summary>Todos os <c>-usage</c> que o encoder aceita, com a referência (vazio) primeiro.</summary>
    private static readonly string[] AmfAllUsages =
    {
        "", "transcoding", "ultralowlatency", "lowlatency",
        "webcam", "high_quality", "lowlatency_high_quality",
    };

    /// <summary>Como a referência aparece na tabela. String vazia = sem <c>-usage</c>, e imprimir a
    /// coluna sem nome seria um bug de leitura: o usuário não saberia o que a 1ª linha significa.</summary>
    internal static string AmfUsageLabel(string usage)
        => usage.Length == 0 ? "(default, sem -usage)" : usage;

    /// <summary>
    /// A linha da tabela do <c>--probe-amf-usage</c>, como função pura.
    ///
    /// <para>Existiu porque o <c>--probe-amf-usage</c> é a única leitura que já roda na máquina
    /// AMD, e o <see cref="AmfCqpVerdictTests"/> provou que a frase de um relatório é
    /// testável sem GPU — o que vale para a linha inteira, não só para a frase de veredito.</para>
    ///
    /// <para><b>Referência única para as três colunas de delta.</b> A primeira versão calculava
    /// o delta de bytes com <c>Math.Max</c> acumulado dentro do laço de impressão, enquanto fps
    /// e kbps eram first-wins: o denominador de KiB crescia a cada linha. No
    /// <c>RESULT-AMF-USAGE.txt</c> real isso imprimiu <c>+0%</c> para um usage que era
    /// <b>1,5% maior</b> que a referência, e <c>−2%/−4%</c> de economia para dois usages que
    /// eram <b>iguais ou menores</b>. Ver <c>AmfUsageReportDeltaTests</c>.</para>
    /// </summary>
    internal static class AmfUsageReport
    {
        /// <summary>As três bases de delta, fixadas numa só linha da tabela (o default de produção).
        ///
        /// <para><b>FpsSamples/FpsSpreadPct são o piso de ruído.</b> Com uma volta só não existe
        /// dispersão, e <see cref="NoiseMeasured"/> falso faz o relatório dizer "ruído não
        /// medido" em vez de imprimir um delta com precisão que a medição não tem. Ver
        /// <see cref="AmfUsageRepeat"/>.</para></summary>
        internal sealed record AmfUsageReference(double Fps, double Kbps, long Bytes)
        {
            /// <summary>Dispersão do fps da referência entre as voltas, em %.</summary>
            public double FpsSpreadPct { get; init; }

            /// <summary>Quantas voltas entraram na mediana.</summary>
            public int FpsSamples { get; init; }

            /// <summary>Dá para comparar um delta contra o ruído? Exige 2+ voltas e dispersão
            /// não-nula: uma lista de amostras todas iguais é ruído zero <i>medido</i>, o que é
            /// legítimo — mas precisa de N para ser crível como zero e não como falta de
            /// amostra.</summary>
            public bool NoiseMeasured => FpsSamples >= 2;
        }

        /// <summary>Primeira linha medida vence; a partir dela a referência é fixa. <b>Nunca a
        /// maior</b> — do contrário o delta se anula sozinho quando a linha corrente é a maior,
        /// que foi exatamente o defeito lido no <c>RESULT-AMF-USAGE.txt</c> real.</summary>
        internal static AmfUsageReference Reference(EncoderManager.EncodeProbeResult primeira)
            => new(primeira.AchievedFps, primeira.BitrateKbps, primeira.OutputBytes) { FpsSamples = 1 };

        /// <summary>Referência das <b>várias voltas</b>: a mediana, não a primeira nem a maior.
        ///
        /// <para>É aqui que o drift deixa de contaminar os deltas. Medida uma vez, a referência
        /// carregava a variação daquela volta para todos os braços — foi o que fez o mesmo
        /// probe reportar +0/+5/+6% às 19h e +11/+12/+15% às 20h. Medida em toda volta e
        /// reduzida por mediana, o pico e a vala de uma volta ficam de fora.</para></summary>
        internal static AmfUsageReference Reference(IReadOnlyList<EncoderManager.EncodeProbeResult> voltas)
        {
            var list = (voltas ?? Array.Empty<EncoderManager.EncodeProbeResult>()).Where(v => v is not null).ToList();
            if (list.Count == 0) return new AmfUsageReference(0, 0, 0);

            var fps = list.Select(v => v.AchievedFps).ToList();
            return new AmfUsageReference(
                AmfUsageRepeat.Median(fps),
                AmfUsageRepeat.Median(list.Select(v => v.BitrateKbps).ToList()),
                (long)Math.Round(AmfUsageRepeat.Median(list.Select(v => (double)v.OutputBytes).ToList())))
            {
                FpsSpreadPct = AmfUsageRepeat.SpreadPct(fps),
                FpsSamples = fps.Count(a => a > 0),
            };
        }


        /// <summary>Se a referência já foi fixada por uma linha anterior, ela permanece: uma linha
        /// maior que venha depois não pode redefinir a base do que já foi impresso.</summary>
        internal static AmfUsageReference Reference(EncoderManager.EncodeProbeResult linha, AmfUsageReference? jaFixada)
            => jaFixada ?? Reference(linha);

        /// <summary>Delta de bytes contra a referência, ou <c>"-"</c> quando não há base.
        /// Publicar "0%" sem referência seria um empate que ninguém mediu.</summary>
        internal static string ByteDeltaText(long bytes, long baselineBytes)
            => baselineBytes > 0
                ? $"{((double)bytes / baselineBytes - 1) * 100:+0;-0;0}%"
                : "-";

        /// <param name="usage">String crua do candidate. <b>Não</b> usar
        /// <c>EncoderManager.EncodeProbeResult.Variant</c>: ele é <c>"usage=&lt;normalizado&gt;"</c> e no
        /// default vira <c>"usage="</c>, sem nome nenhum para o usuário.</param>
        internal static string FormatRow(string usage, IReadOnlyList<EncoderManager.EncodeProbeResult> voltas, AmfUsageReference referencia)
        {
            var r = Medido(voltas);
            // Format com ';' precisa sair do hole de interpolação (o ';' fecha a seção).
            // <b>1 casa decimal no fps, e não 0:</b> é a coluna que decide o promote, e o
            // pior caso real fica a 0,30 ponto do corte — arredondado, "+10,4%" vira "+10%",
            // que é indistinguível de reprovado. Com 0 casas o leitor não consegue auditar o
            // veredito, e um veredito que ninguém consegue checar é o defeito original de novo.
            var dFps = referencia.Fps > 0 ? $"{(r.AchievedFps / referencia.Fps - 1) * 100:+0.0;-0.0;0.0}%" : "-";
            var dRate = referencia.Kbps > 0 ? $"{(r.BitrateKbps / referencia.Kbps - 1) * 100:+0;-0;0}%" : "-";
            var dBytes = ByteDeltaText(r.OutputBytes, referencia.Bytes);
            var headroom = r.VbvBinds
                ? $"VBV APERTA ({-r.HeadroomToMaxrateKbps:0} K acima do teto)"
                : $"folga p/ teto {r.HeadroomToMaxrateKbps:0} K";
            // A coluna de quantas voltas entraram não é enfeite: é o que diz ao leitor se um
            // "+6%" veio de 1 amostra ou de 3, e o piso de ruído abaixo do delta é quem dá
            // sentido a esse número.
            var n = voltas?.Count(v => v is not null && v.AchievedFps > 0) ?? 0;
            var amostra = n > 1 ? $" [n={n}, {AmfUsageRepeat.FmtPct(AmfUsageRepeat.SpreadPct(voltas!.Select(v => v.AchievedFps).ToList()))}% de dispersão]" : "";
            return $"    {AmfUsageLabel(usage),-24}: {r.AchievedFps,7:0.00} fps ({dFps,7}) | " +
                   $"{r.BitrateKbps,8:0.0} Kbps ({dRate,7}) | {r.OutputBytes / 1024,6} KiB ({dBytes,6}) | {headroom}{amostra}";
        }

        /// <summary>Uma volta só. Atalho para a implementação de N voltas, que é quem a
        /// produção usa; existe para as regressões de formatação (bytes, headroom) poderem
        /// fixar uma linha medida sem ter que simular 3 voltas.</summary>
        internal static string FormatRow(string usage, EncoderManager.EncodeProbeResult r, AmfUsageReference referencia)
            => FormatRow(usage, new[] { r }, referencia);

        /// <summary>Reduz as voltas a uma linha: mediana de fps/kbps/bytes. Uma volta só
        /// devolve a própria linha, então o caminho de 1 volta é idêntico ao antigo — nenhum
        /// relatório já publicado muda de formato por causa da repetição.</summary>
        private static EncoderManager.EncodeProbeResult Medido(IReadOnlyList<EncoderManager.EncodeProbeResult> voltas)
        {
            var list = (voltas ?? Array.Empty<EncoderManager.EncodeProbeResult>()).Where(v => v is not null).ToList();
            if (list.Count == 0) return new EncoderManager.EncodeProbeResult("?", "?", 0, 0, 0, 0, 0);
            if (list.Count == 1) return list[0];

            var any = list[0];
            // VbvBinds e HeadroomToMaxrateKbps são DERIVADOS de (MaxrateKbps - BitrateKbps),
            // e o MaxrateKbps é o mesmo em todas as voltas (mesma chain). Passar a mediana do
            // bitrate e o maxrate do primeiro braço faz a mediana da folga sair de graça — e
            // evitar reconstruir o flag de "VBV apertou" por voto é o que impede a mediana de
            // discordar da própria linha que a gerou.
            return new EncoderManager.EncodeProbeResult(
                any.Codec, any.Variant,
                AmfUsageRepeat.Median(list.Select(v => v.AchievedFps).ToList()),
                AmfUsageRepeat.Median(list.Select(v => v.BitrateKbps).ToList()),
                (int)Math.Round(AmfUsageRepeat.Median(list.Select(v => (double)v.OutputBytes).ToList())),
                any.FrameCount,
                any.MaxrateKbps);
        }
    }
    /// <summary>
    /// Repetição, mediana e <b>piso de ruído</b> do <c>--probe-amf-usage</c>.
    ///
    /// <para><b>O defeito que isto corrige, medido.</b> Duas execuções do mesmo probe, mesmo
    /// PC, ~1 h de intervalo: a referência (default, sem <c>-usage</c>) foi de <b>351,99</b>
    /// para <b>336,40</b> fps (−4,4%), enquanto os braços foram de 368–374 para 371–386
    /// (~+3%). Como a referência era medida <b>uma única vez</b> e todo delta é relativo a
    /// ela, os deltas pularam de +0/+5/+6% para <b>+11/+12/+15%</b> — o mesmo número, com o
    /// veredito invertido. Repetir as execuções <b>não</b> conserta isso: o viés fica, só
    /// encolhe. O que neutraliza o drift é medir a referência <b>em toda volta</b>, usar a
    /// <b>mediana</b>, e publicar a <b>dispersão dela</b> para o leitor saber que +6% está
    /// dentro do próprio ruído.</para>
    ///
    /// <para><b>Por que isso importa mais do que parece.</b> O critério de promote é 10% e o
    /// ruído observado no delta é ±7 pontos. Um "+6%" e um "+15%" saíam visualmente
    /// idênticos a um "+600%", que seria um sinal claro. Não é erro de aritmética: é um
    /// número sem erro aparente que a pessoa usa para trocar a chain de produção.</para>
    /// </summary>
    internal static class AmfUsageRepeat
    {
        /// <summary>Corte de promote do Item 3, por fps.</summary>
        internal const double PromotePct = 10.0;

        /// <summary>Teto de voltas. Acima disso o custo é de minutos do usuário sem ganho de
        /// confiança proporcional: a mediana de 5 já é estável para um effect size de ~10%.</summary>
        internal const int MaxRounds = 9;

        /// <summary>Formata um percentage no relatório, na <b>cultura corrente</b> — e não
        /// invariant como o <c>AmdCqpProbe.Fmt</c>. A tabela já é da cultura corrente em todos
        /// os outros campos (fps, Kbps, KiB, os três deltas), então um campo invariant aqui
        /// apareceria com "." no meio de uma linha cheia de "," — pior que qualquer das duas
        /// escolhas, porque o leitor não sabe qual dos dois formatos está olhando.</summary>
        internal static string FmtPct(double v, string fmt = "0.0")
            => v.ToString(fmt, CultureInfo.CurrentCulture);

        /// <summary>Mediana. Par = média dos dois do meio; ímpar = o do meio. Lista vazia
        /// devolve 0 e quem chama precisa checar — 0 aqui significa "sem amostra", e o
        /// relatório não pode imprimir "0 fps" como se fosse medição.</summary>
        internal static double Median(IReadOnlyList<double> amostras)
        {
            if (amostras is null || amostras.Count == 0) return 0;
            var s = amostras.Where(a => a > 0).OrderBy(a => a).ToList();
            if (s.Count == 0) return 0;
            var mid = s.Count / 2;
            return s.Count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2.0;
        }

        /// <summary>Dispersão relativa da amostra, em % da mediana: <b>o piso de ruído</b>.
        /// Com menos de 2 amostras devolve 0, e quem chama precisa dizer "não medido" em vez
        /// de publicar "ruído 0%" — que seria a afirmação falsa que o defeito Original produzia
        /// (um delta com precisão que a medição não tinha).</summary>
        internal static double SpreadPct(IReadOnlyList<double> amostras)
        {
            if (amostras is null || amostras.Count < 2) return 0;
            var s = amostras.Where(a => a > 0).ToList();
            if (s.Count < 2) return 0;
            var med = Median(s);
            return med <= 0 ? 0 : (s.Max() - s.Min()) * 100.0 / med;
        }

        /// <summary>Piso de ruído do delta entre dois braços: o <b>pior</b> dos dois, não só o da
        /// referência. O delta é a diferença entre duas medições independentes, então quem
        /// domina a incerteza é o braço que mais treme. Nos dados reais isso decide o caso
        /// <c>transcoding</c>: ele treme 5,99% contra os 4,53% da referência, e o delta de
        /// +5,79% cai para dentro do ruído — deixa de ser promovível.</summary>
        internal static double NoiseFloor(double refNoisePct, double candidatoNoisePct)
            => Math.Max(refNoisePct, candidatoNoisePct);

        /// <summary>Voltas mínimas para promover. Um veredito que depende do 3º decimal de uma
        /// mediana de 2 amostras tem aparência de decisão sem medição atrás — o pior caso real
        /// é <c>ultralowlatency</c> a +10,30%, 0,30 acima da barra. Esta trava só pode
        /// <b>impedir</b> um promote, nunca conceder um.</summary>
        internal const int MinRoundsForPromote = 3;

        /// <summary>O delta supera o corte <b>e</b> o ruído, com o ruído medido e amostra
        /// suficiente? Promover com N=1 é ler ruído: não há como distinguir "+15% de verdade" de
        /// "+15% porque a referência foi rápida". A saída honesta é não promover.</summary>
        internal static bool Promote(double deltaPct, double noisePct, bool noiseMeasured = true, int samples = MinRoundsForPromote)
            => noiseMeasured
               && samples >= MinRoundsForPromote
               && deltaPct >= PromotePct
               && deltaPct > noisePct;

        /// <summary>Como o delta é apresentado. O número continua impresso — escondê-lo seria
        /// pior — mas vem marcado quando não é distinguível de zero. A ambiguidade é
        /// simétrica: "−4%" com ruído de ±5% não é lentidão, é nada.</summary>
        internal static string DeltaText(double deltaPct, double noisePct, double promotePct, bool noiseMeasured)
        {
            var d = $"{deltaPct:+0;-0;0}%";
            if (!noiseMeasured) return $"{d} (1 execucao: ruido nao medido)";
            return Math.Abs(deltaPct) <= noisePct
                ? $"{d} (dentro do ruido {noisePct:0.#}%)"
                : d;
        }
    }

    /// <summary>Seam puro (sem ffmpeg, sem I/O) da lista de candidates do <c>--probe-amf-usage</c>.
    /// A referência — a string vazia — entra sempre na 1ª linha: o critério de promote do Item 3 foi
    /// fixado contra "o default em uso", e o default em uso é o vazio (medir contra
    /// <c>transcoding</c> responderia uma pergunta diferente, e um <c>-usage</c> pode ganhar contra
    /// <c>transcoding</c> e perder contra o vazio).
    ///
    /// O descarte de token inválido não é cosmético: <see cref="FfmpegEncoder.NormalizeAmfUsage"/>
    /// devolve <c>""</c> tanto para entrada inválida quanto para a vazia, então sem o filtro um
    /// token de lixo viraria a referência em silêncio — o probe mediria "sem -usage" e rotularia a
    /// linha com outro nome.</summary>
    internal static IReadOnlyList<string> ResolveAmfProbeCandidates(string? candidatesArg)
    {
        var tokens = (candidatesArg ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s =>
            {
                var t = s.Trim().ToLowerInvariant();
                if (t == AmfDefaultUsageToken) return "";
                var normalized = FfmpegEncoder.NormalizeAmfUsage(t);
                return normalized.Length == 0 ? null : normalized; // null = inválido, descarta
            })
            .Where(t => t is not null)
            .Select(t => t!)
            .Distinct()
            .ToList();

        if (tokens.Count == 0) tokens = AmfAllUsages.ToList();
        tokens.Remove(""); // a referência entra sempre na 1ª linha, uma vez só
        tokens.Insert(0, "");
        return tokens;
    }

    internal static void ProbeAmfUsage(
        string widthArg, string heightArg, string fpsArg, string cqArg, string maxrateArg,
        string codecArg, string candidatesArg, string? repeatArg = null)
    {
        int.TryParse(widthArg, out var w);
        int.TryParse(heightArg, out var h);
        int.TryParse(fpsArg, out var fps);
        int.TryParse(cqArg, out var cq);
        int.TryParse(maxrateArg, out var mr);
        int.TryParse(repeatArg, out var repeatN);
        var voltas = Math.Clamp(repeatN <= 0 ? 3 : repeatN, 1, AmfUsageRepeat.MaxRounds);

        int width = w > 0 ? w : 1920;
        int height = h > 0 ? h : 1080;
        int targetFps = fps > 0 ? fps : 60;
        int targetCq = cq > 0 ? cq : 18;
        int maxrateKbps = mr > 0 ? mr : 55000;
        var bufsizeKbps = maxrateKbps * 2;

        var codec = (codecArg ?? "").Trim();
        if (codec.Length == 0) codec = "h264_amf";
        if (!EncoderManager.IsAmfCodec(codec))
        {
            Console.WriteLine($"ERRO: '{codec}' não é um codec AMF. Use h264_amf/hevc_amf/av1_amf.");
            return;
        }

        var candidates = ResolveAmfProbeCandidates(candidatesArg);

        Console.WriteLine("=== AMF -usage Probe ===");
        Console.WriteLine($"Resolução: {width}x{height}@{targetFps}fps | cq={targetCq} (inalterado) | maxrate={maxrateKbps}K | bufsize={bufsizeKbps}K");
        Console.WriteLine($"Codec: {codec} | alvo médio -b:v = {FfmpegEncoder.ComputeAmfTargetKbps(maxrateKbps)}K");
        Console.WriteLine($"Referência: {AmfUsageLabel("")} — é o default de produção (não emitimos -usage); delta em % relativo a ela");
        Console.WriteLine($"Voltas: {voltas} (mediana por braço; a referência é medida em TODAS as voltas — é a dispersão dela que vira o piso de ruído)");

        if (!EncoderManager.CheckFfmpegEncoder(codec))
        {
            Console.WriteLine($"'{codec}' indisponível neste ffmpeg/hardware. Rode numa máquina com GPU AMD.");
            return;
        }

        // Uma volta por braço. A referência é medida em toda volta de propósito: é a
        // repetição DELA que mede o drift, e sem essa repetição o delta de cada braço
        // carrega o tremor de uma única medição. Ver AmfUsageRepeat.
        var porUsage = new Dictionary<string, List<EncoderManager.EncodeProbeResult>>();
        var algumMedido = false;
        for (var volta = 1; volta <= voltas; volta++)
        {
            if (voltas > 1) Console.WriteLine($"  --- volta {volta}/{voltas} ---");
            foreach (var usage in candidates)
            {
                var r = MeasureAmfUsageOnce(codec, width, height, targetFps, targetCq, maxrateKbps, bufsizeKbps, usage);
                if (r is null)
                {
                    if (usage.Length == 0)
                    {
                        // Se a PRIMEIRA referência (o default de produção, sem -usage) foi
                        // recusada, não há device AMF funcional — todos os outros usages vão
                        // falhar igual, e repetir as voltas só multiplica o custo.
                        Console.WriteLine($"    '{codec}' sem device AMF utilizável — demais usages abortados.");
                        break;
                    }
                    Console.WriteLine($"    {AmfUsageLabel(usage),-24}: RECUSADO pelo encoder");
                    continue;
                }

                if (!porUsage.TryGetValue(usage, out var lista)) porUsage[usage] = lista = new List<EncoderManager.EncodeProbeResult>();
                lista.Add(r);
                algumMedido = true;
            }
            if (algumMedido && !porUsage.ContainsKey("")) break;
        }

        if (!algumMedido)
        {
            Console.WriteLine();
            Console.WriteLine("Nenhum candidate medido — sem GPU AMF funcional aqui (resposta honesta, sem chute).");
            return;
        }

        // A referência sai de TODAS as voltas dela, por mediana. Nem a primeira (carrega o
        // tremor daquela volta) nem a maior (denominador que se auto-anula — o defeito do
        // Math.Max que o RESULT-AMF-USAGE.txt real expôs).
        var refSamples = porUsage.TryGetValue("", out var refList)
            ? (IReadOnlyList<EncoderManager.EncodeProbeResult>)refList
            : Array.Empty<EncoderManager.EncodeProbeResult>();
        var referencia = AmfUsageReport.Reference(refSamples);

        Console.WriteLine();
        foreach (var usage in candidates)
        {
            if (!porUsage.TryGetValue(usage, out var samples) || samples.Count == 0) continue;
            Console.WriteLine(AmfUsageReport.FormatRow(usage, samples, referencia));
        }

        Console.WriteLine();
        PrintAmfUsageNoise(referencia, porUsage, candidates);
    }

    /// <summary>Uma medição de um braço, com 1 retry só (o retry com callback custa o
    /// kill-guard inteiro, então 1, não 6). Devolve null quando o encoder recusou.</summary>
    private static EncoderManager.EncodeProbeResult? MeasureAmfUsageOnce(
        string codec, int width, int height, int fps, int cq, int maxrateKbps, int bufsizeKbps, string usage)
    {
        var r = EncoderManager.RunAmfUsageProbe(codec, width, height, fps, cq, maxrateKbps, bufsizeKbps, usage);
        if (r is not null) return r;

        var saida = new List<string>();
        r = EncoderManager.RunAmfUsageProbe(codec, width, height, fps, cq, maxrateKbps, bufsizeKbps, usage, onStderr: saida.Add);
        if (r is null)
        {
            // O stderr só é capturado no retry; na 1ª tentativa ele não aparece, e uma recusa
            // sem motivo é exatamente o que fez o D3D12VA parecer "faixa inválida" quando era
            // falha de feed de frames.
            foreach (var l in saida) Console.WriteLine($"      ffmpeg: {l}");
        }
        return r;
    }

    /// <summary>Fecha o relatório: o piso de ruído e o que ele engole. Sem esta seção, um
    /// "+6%" e um "+600%" têm o mesmo formato, e a pessoa não tem como saber que o primeiro
    /// está dentro do próprio ruído da máquina.</summary>
    private static void PrintAmfUsageNoise(
        AmfUsageReport.AmfUsageReference referencia,
        Dictionary<string, List<EncoderManager.EncodeProbeResult>> porUsage,
        IReadOnlyList<string> candidates)
    {
        var refSamples = referencia.FpsSamples;
        var refNoise = referencia.FpsSpreadPct;

        if (refSamples < AmfUsageRepeat.MinRoundsForPromote)
        {
            Console.WriteLine($"Piso de ruído: NÃO CONFIÁVEL ({refSamples} execução(ões); o promote exige " +
                              $"{AmfUsageRepeat.MinRoundsForPromote}). Os deltas acima não decidem nada.");
        }
        else
        {
            Console.WriteLine($"Piso de ruído da referência: {AmfUsageRepeat.FmtPct(refNoise)} em {refSamples} execuções " +
                              $"(fps {AmfUsageRepeat.FmtPct(referencia.Fps, "0.00")}). Deltas com |delta| <= isso são indistinguíveis de zero.");
        }

        foreach (var usage in candidates)
        {
            if (usage.Length == 0) continue;
            if (!porUsage.TryGetValue(usage, out var samples) || samples.Count == 0) continue;

            var fps = samples.Select(v => v.AchievedFps).ToList();
            var n = fps.Count(a => a > 0);
            var deltaPct = referencia.Fps > 0 ? (AmfUsageRepeat.Median(fps) / referencia.Fps - 1) * 100.0 : 0;
            // O piso é o pior dos dois braços, e a amostra é a MENOR das duas: promover exige
            // que os dois lados tenham medido o bastante.
            var piso = AmfUsageRepeat.NoiseFloor(refNoise, AmfUsageRepeat.SpreadPct(fps));
            var amostras = Math.Min(n, refSamples);
            var acima = AmfUsageRepeat.Promote(deltaPct, piso, refSamples >= AmfUsageRepeat.MinRoundsForPromote, amostras);
            var marker = acima ? "  <- supera o corte E o ruído" : "";
            Console.WriteLine($"  {AmfUsageLabel(usage),-24}: {AmfUsageRepeat.DeltaText(deltaPct, piso, AmfUsageRepeat.PromotePct, refSamples >= 2)}" +
                              $" [piso {AmfUsageRepeat.FmtPct(piso)}, n={amostras}]{marker}");
        }

        Console.WriteLine("Leitura: fps maior = mais folga p/ 60fps; Kbps menor = arquivo menor no MESMO cq.");
    }

    /// <summary>
    /// Veredito do A/B de <c>-profile:v</c> no HEVC (Item 9). Fixado ANTES de medir: main10 só
    /// fica se ganhar bytes sem custo de fps relevante, senão sai. O ponto do enum é que
    /// <see cref="Unmeasured"/> é um estado de primeira classe — sem ele, "não medi" seria
    /// reportado como "não compensa", que é uma conclusão que o número não sustenta.
    /// </summary>
    /// <summary>Resumo do probe de profile HEVC: os dois lados medidos, os dois deltas e o
    /// veredito contra o critério. Os deltas são negativo = main10 é melhor (menos bytes, mais
    /// fps), que é a convenção das duas pontas do relatório.</summary>
    internal readonly record struct HevcProfileProbeSummary(
        double? MainFps, double? Main10Fps, double? MainBytes, double? Main10Bytes,
        double? FpsDeltaPct, double? ByteDeltaPct, HevcProfileVerdict Verdict)
    {
        internal string ToReportLine()
        {
            if (Verdict == HevcProfileVerdict.Unmeasured)
                return "  → nada medido (ffmpeg indisponível ou encoder recusou a chain) — sem veredito";

            var byteTxt = $"bytes {ByteDeltaPct:+0.0;-0.0;0}%";
            var fpsTxt = $"fps {FpsDeltaPct:+0.0;-0.0;0}%";
            var acao = Verdict == HevcProfileVerdict.KeepMain10
                ? "MANTER main10"
                : $"REMOVER main10 (não passa dos {HevcProfileMinByteGainPct:0}% de byte sem perder {HevcProfileMaxFpsLossPct:0}% de fps)";
            return $"  → main10 vs main: {byteTxt} | {fpsTxt} ⇒ {acao}";
        }
    }

    /// <summary>Critério do Item 9, fixado no plano antes da medição. main10 só continua se
    /// ganhar pelo menos <see cref="HevcProfileMinByteGainPct"/>% de bytes no mesmo CQ
    /// (<b>E</b> — os dois lados) sem perder <see cref="HevcProfileMaxFpsLossPct"/>% de fps.
    /// O teste <c>Criterion_ThresholdsAreTheOnesFixededInThePlan</c> amarra estes números ao
    /// plano, para ninguém afrouxar o critério depois de ver o resultado.</summary>
    internal const double HevcProfileMinByteGainPct = 5.0;
    internal const double HevcProfileMaxFpsLossPct = 5.0;

    /// <summary>Seam puro do resumo (sem I/O, sem ffmpeg) do A/B de profile HEVC.
    /// Argumentos são <c>(fps, bytes)</c> de cada lado, ou null quando o encoder recusou/ausente.</summary>
    internal static HevcProfileProbeSummary SummarizeHevcProfileProbe(
        (double Fps, double Bytes)? main, (double Fps, double Bytes)? main10)
    {
        if (main is null || main10 is null)
        {
            return new HevcProfileProbeSummary(
                main?.Fps, main10?.Fps, main?.Bytes, main10?.Bytes,
                null, null, HevcProfileVerdict.Unmeasured);
        }

        // Delta relativo ao main (a referência é o 8-bit, que é o que a entrada realmente é).
        // Negativo = main10 melhor.
        var fpsDelta = (main10.Value.Fps / main.Value.Fps - 1) * 100;
        var byteDelta = (main10.Value.Bytes / main.Value.Bytes - 1) * 100;

        // "≥5% menos bytes" ⇒ byteDelta <= -5. "<5% de fps" ⇒ fpsDelta > -5 (estritamente).
        var bytesOk = byteDelta <= -HevcProfileMinByteGainPct;
        var fpsOk = fpsDelta > -HevcProfileMaxFpsLossPct;
        var verdict = bytesOk && fpsOk ? HevcProfileVerdict.KeepMain10 : HevcProfileVerdict.RemoveMain10;

        return new HevcProfileProbeSummary(
            main.Value.Fps, main10.Value.Fps, main.Value.Bytes, main10.Value.Bytes,
            Math.Round(fpsDelta, 1), Math.Round(byteDelta, 1), verdict);
    }

    /// <summary>
    /// CLI --probe-hevc-profile: A/B de <c>-profile:v</c> no HEVC (Item 9), com o MESMO CQ e
    /// bitrate nos dois lados — o probe isola só o profile. Responde, com número, a pergunta que
    /// a flag hardcoded na production não respondia: <c>main10</c> compensa com entrada NV12
    /// 8-bit, ou é um upconvert pago à toa?
    ///
    /// <para><b>Contexto que decide a leitura:</b> a entrada da captura é
    /// <c>-f rawvideo -pix_fmt nv12</c> (FfmpegEncoder.cs:627), ou seja <b>8 bits</b>.
    /// <c>main10</c> só faria sentido com sinal de 10 bits (P010), que o pipeline não produz.
    ///
    /// <para><b>RESULTADO MEDIDO (RTX 5050, ffmpeg 9.0.1, 2026-09-26, cq 18 /
    /// 1920x1080@60 / maxrate 55000): o main10 foi REMOVIDO da production.</b> main e main10
    /// dão 25141,5 Kbps / 4603 KiB idênticos, e o diff byte a byte dos dois arquivos são
    /// <b>4 bytes</b> — o <c>general_profile_idc</c> do VPS NAL (0x21 Main vs 0x22 Main10), com
    /// os outros 4.134.825 bit-idênticos. O NVENC não converte 8→10: a flag só mentia no
    /// header, e o clip saía rotulado como Main 10 cheio de amostras de 8 bits. Reproduzido em
    /// runs repetidos (bytes 0%, fps −1,2%/−1,3% = ruído).</para>
    ///
    /// <para>Critério FIXADO antes de medir (e travado em teste): main10 só voltaria com ≥5%
    /// menos bytes no mesmo CQ <b>E</b> perder &lt;5% de fps. Reprovar qualquer um dos dois ⇒
    /// não usar. O veredito sai pelo <see cref="SummarizeHevcProfileProbe"/>, não por leitura do
    /// operador. O probe continua existindo para o dia em que a captura virar P010 de verdade —
    /// aí a hipótese volta a ter o que ganhar e precisa ser rechecada.</para>
    ///
    /// <para>Uso: --probe-hevc-profile [W H FPS CQ MAXRATE CODEC PROFILES(com vírgula)]
    /// (default 1920 1080 60 18 55000 hevc_nvenc, main/main10)</para>
    /// </summary>
    internal static void ProbeHevcProfile(
        string widthArg, string heightArg, string fpsArg, string cqArg, string maxrateArg,
        string codecArg, string candidatesArg)
    {
        int.TryParse(widthArg, out var w);
        int.TryParse(heightArg, out var h);
        int.TryParse(fpsArg, out var fps);
        int.TryParse(cqArg, out var cq);
        int.TryParse(maxrateArg, out var mr);
        int width = w > 0 ? w : 1920;
        int height = h > 0 ? h : 1080;
        int targetFps = fps > 0 ? fps : 60;
        int targetCq = cq > 0 ? cq : 18;
        int maxrateKbps = mr > 0 ? mr : 55000;
        int bufsizeKbps = maxrateKbps * 2;

        var codec = (codecArg ?? "").Trim();
        if (codec.Length == 0) codec = "hevc_nvenc";

        var candidates = (candidatesArg ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.Trim().ToLowerInvariant())
            .Where(s => s.Length > 0)
            .Distinct()
            .ToList();
        if (candidates.Count == 0) candidates = ["main", "main10"];
        // "main" é a referência: é o perfil que casa com a entrada de 8 bits que a captura
        // produz. Entra sempre na 1ª linha, como transcoding no probe de AMF.
        candidates.Remove("main");
        candidates.Insert(0, "main");

        Console.WriteLine("=== HEVC -profile:v Probe (Item 9) ===");
        Console.WriteLine($"Resolução: {width}x{height}@{targetFps}fps | cq={targetCq} (inalterado) | maxrate={maxrateKbps}K | bufsize={bufsizeKbps}K");
        Console.WriteLine($"Codec: {codec} | entrada do pipeline = rawvideo NV12 8-bit");
        Console.WriteLine($"Produção hoje: -profile:v main (o main10 foi REMOVIDO no Item 9 — só reescrevia a tag do header)");
        Console.WriteLine($"Referência: main (8-bit, casa com a entrada) | delta em % relativo a ela");
        Console.WriteLine($"Critério: main10 só fica com ≥{ProgramBenchmark.HevcProfileMinByteGainPct:0}% menos bytes E <{ProgramBenchmark.HevcProfileMaxFpsLossPct:0}% de fps");
        Console.WriteLine();

        if (!EncoderManager.CheckFfmpegEncoder(codec))
        {
            Console.WriteLine($"'{codec}' indisponível neste ffmpeg/hardware.");
            Console.WriteLine(SummarizeHevcProfileProbe(null, null).ToReportLine());
            return;
        }

        (double Fps, double Bytes)? main = null;
        (double Fps, double Bytes)? main10 = null;

        foreach (var profile in candidates)
        {
            var r = EncoderManager.RunHevcProfileProbe(
                codec, width, height, targetFps, targetCq, maxrateKbps, bufsizeKbps, profile);
            if (r is null)
            {
                // 1 retry só pra capturar o stderr — distinguir "encoder recusou" de "sem GPU".
                var saida = new List<string>();
                var retry = EncoderManager.RunHevcProfileProbe(
                    codec, width, height, targetFps, targetCq, maxrateKbps, bufsizeKbps, profile,
                    onStderr: saida.Add);
                if (retry is null)
                {
                    Console.WriteLine($"    {profile,-10}: RECUSADO pelo encoder");
                    foreach (var l in saida) Console.WriteLine($"      ffmpeg: {l}");
                    continue;
                }
                r = retry;
            }

            var linha = (r.AchievedFps, (double)r.OutputBytes);
            if (profile == "main") main = linha;
            else if (profile == "main10") main10 = linha;
            Console.WriteLine(
                $"    {profile,-10}: {r.AchievedFps,7:0.00} fps | {r.BitrateKbps,8:0.0} Kbps | " +
                $"{r.OutputBytes / 1024,6} KiB");
        }

        Console.WriteLine();
        Console.WriteLine(SummarizeHevcProfileProbe(main, main10).ToReportLine());
    }

    /// <summary>
    /// CLI do <c>--audit-amd</c>. Todos os parâmetros são opcionais e o default vem da
    /// <b>config real do usuário</b> (<see cref="ConfigManager.Config"/>), não de constantes
    /// duplicadas: o que precisa ser auditado é o que ele está gravando agora, e um default
    /// hardcoded (720p/CQ20/30000) mediria uma configuração que talvez nem seja a dele —
    /// veredito sobre a máquina errada é a forma mais cara de erro num tool de diagnóstico.
    /// </summary>
    internal static void RunAmdAudit(
        string? widthArg, string? heightArg, string? fpsArg, string? cqArg, string? maxrateArg, string? bufArg, string? framesArg,
        string? codecArg = null)
    {
        var cfg = ReadLiveConfigOrDefault();
        var req = new AmdAuditRequest(
            Pick(widthArg, cfg.Width),
            Pick(heightArg, cfg.Height),
            Pick(fpsArg, cfg.Fps),
            Pick(cqArg, cfg.Cq),
            Pick(maxrateArg, cfg.MaxrateKbps),
            Pick(bufArg, cfg.BufsizeKbps),
            Pick(framesArg, AmdAudit.DefaultFrames));
        req = req with { Frames = Math.Clamp(req.Frames, 30, 600) };

        // Codec explícito: deixa o audit rodar em máquina sem AMF (útil para NVIDIA/QSV, e
        // é o que permite exercitar o caminho inteiro antes de chegar no hardware AMD).
        var subject = string.IsNullOrWhiteSpace(codecArg) ? null : codecArg.Trim();
        if (subject != null) Console.WriteLine($"Medindo a familia {subject} (override).");

        Console.WriteLine("Iniciando audit AMD. Pode levar alguns minutos (cada encode roda de verdade)...");
        Console.WriteLine();
        // Imprime em tempo real: dozens de encodes sem nenhuma saída fazem o tool parecer
        // travado, e a pessoa não tem como saber se ainda está trabalhando.
        var report = AmdAudit.Run(req, subject, msg => Console.WriteLine("  [" + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "] " + msg));
        Console.WriteLine();
        Console.WriteLine(AmdAuditReportWriter.Format(report));
    }

    private static int Pick(string? arg, int fallback) =>
        int.TryParse(arg, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : fallback;

    /// <summary>Lê a config real; se ela não existir, cai nos defaults sem quebrar o audit
    /// (um tool de diagnóstico que não roda por falta de config é inútil na hora do
    /// problema).</summary>
    internal static AppConfig ReadLiveConfigOrDefault()
    {
        try
        {
            using var cm = new ConfigManager();
            return cm.Config;
        }
        catch
        {
            return new AppConfig();
        }
    }

    internal static void ShowHelp()
    {
        Console.WriteLine("DiNho Clips Engine v1.0.0");
        Console.WriteLine();
        Console.WriteLine("Uso:");
        Console.WriteLine("  DiNho.Capture.Poc                  Inicia o engine (modo produção)");
        Console.WriteLine($"  DiNho.Capture.Poc --test           Executa testes de Fase 0 + Fase 1");
        Console.WriteLine("  DiNho.Capture.Poc --bench           Benchmark de captura + encode");
        Console.WriteLine("  DiNho.Capture.Poc --bench-json      Benchmark com saída em JSON (Desktop\\DiNhoClips\\bench-*.json)");
        Console.WriteLine("  DiNho.Capture.Poc --force-software    Força encoder CPU (sem GPU)");
        Console.WriteLine("  DiNho.Capture.Poc --duration <seg>    Tempo limite de gravação (ex.: --duration 300)");
        Console.WriteLine("  DiNho.Capture.Poc --encoders          Lista e testa encoders disponíveis (ffmpeg)");
        Console.WriteLine("  DiNho.Capture.Poc --probe-nvenc [W H FPS]  Mede achievedFps real de cada preset NVENC");
        Console.WriteLine("  DiNho.Capture.Poc --audit-amd [W H FPS CQ MAXRATE BUFSIZE FRAMES [CODEC]]");
        Console.WriteLine("      Audit da stack AMF. Default: config real do usuario. CODEC fixa a familia medida");
        Console.WriteLine("      (ex.: h264_nvenc) para rodar o audit inteiro em maquina sem AMF.");
        Console.WriteLine("  DiNho.Capture.Poc --probe-amf-cqp [W H FPS CQ MAXRATE BUFSIZE FRAMES [CODEC [QPS]]]]");
        Console.WriteLine("      A/B da chain AMF real: vbr_peak + b:v (maxrate*0.36) vs cqp nos QPs indicados");
        Console.WriteLine("      (padrao: cq-2,cq,cq+2,cq+4). Criterio travado: promove com >=5% de bytes no");
        Console.WriteLine("      VMAF da producao ou acima e <=5% de fps. QPS = lista 0..51 ou 'auto', que sobe");
        Console.WriteLine("      de 2 em 2 ate cruzar os bytes da producao. Default: config real (precisa de GPU AMD).");
        Console.WriteLine("  DiNho.Capture.Poc --probe-vbv [W H FPS CQ MAXRATE BUFSIZES]  Mede bitrate/fps por -bufsize");
        Console.WriteLine("  DiNho.Capture.Poc --probe-amf-usage [W H FPS CQ MAXRATE CODEC USAGES [REPETIÇÕES]]");
        Console.WriteLine("      Mede fps/bitrate por -usage da AMF (precisa de GPU AMD). Repeticoes (padrao 3) medem a");
        Console.WriteLine("      referencia em TODAS as voltas; a mediana dela vira o piso de ruido do veredito.");
        Console.WriteLine("  DiNho.Capture.Poc --probe-amd-sweep [W H FPS CQ MAXRATE BUFSIZE FRAMES [CODEC [USAGES [QPS [FINALISTAS [VOLTAS]]]]]]");
        Console.WriteLine("      Grade usage x QP do AMF: procura o melhor custo/desempenho sem perder qualidade");
        Console.WriteLine("      contra a cadeia de producao (precisa de GPU AMD). USAGES = lista separada por virgula");
        Console.WriteLine("      (default: default,transcoding,ultralowlatency,lowlatency,high_quality); QPS = lista");
        Console.WriteLine("      0..51 ou 'auto' (mesma escada do --probe-amf-cqp). Faz 1 volta por celula e so");
        Console.WriteLine("      repete a frente de Pareto. Devolve DOIS picks: menor byte e maior fps, cada um");
        Console.WriteLine("      com o VMAF >= producao. VOLTAS=1 desliga o pick de desempenho (piso de 3).");
        Console.WriteLine("  DiNho.Capture.Poc --probe-hevc-profile [W H FPS CQ MAXRATE CODEC PROFILES]  A/B main vs main10 (entrada NV12 8-bit)");
        Console.WriteLine("  DiNho.Capture.Poc --help              Mostra esta ajuda");
        Console.WriteLine();
        Console.WriteLine("Hotkeys (padrão):");
        Console.WriteLine("  F8   Salvar clip");
        Console.WriteLine("  F9   Iniciar/Parar captura");
        Console.WriteLine("  F10  Mutar microfone");
        Console.WriteLine();
        Console.WriteLine("IPC:");
        Console.WriteLine("  Named pipe: \\\\.\\pipe\\dinho-clips-engine");
        Console.WriteLine("  Protocolo v1.0 (JSON)");
    }

    internal static async Task ValidateCaptureAsync()
    {
        Console.WriteLine("=== Validação de Captura ===\n");

        // HWND do foreground
        var hwnd = (IntPtr)PInvoke.GetForegroundWindow();
        var title = GetWindowText(hwnd);
        Console.WriteLine($"Foreground window: HWND=0x{hwnd:X8}  Title=\"{title}\"");
        Console.WriteLine();

        // Se não há jogo detectado, usa o foreground diretamente
        using var detector = new GameDetection.GameDetector();
        detector.Start();
        await Task.Delay(500);
        var game = detector.CurrentGame;
        Console.WriteLine($"GameDetector: valid={game.IsValid} process=\"{game.ProcessName}\" hwnd=0x{game.Hwnd:X8} mode={game.DisplayMode}");
        detector.Stop();
        Console.WriteLine();

        // Validar DXGI output mapping
        Console.WriteLine("--- DXGI Outputs x Monitores ---");
        using var device = CreateD3D11Device();
        using var dxgiDevice = device.QueryInterface<IDXGIDevice>();
        using var adapter = dxgiDevice.GetAdapter();

        var primaryMonitor = MonitorHelper.GetPrimaryMonitorHandle();
        Console.WriteLine($"  HMONITOR primário: 0x{primaryMonitor:X8}");

        var gameMonitor = game.IsValid && game.Hwnd != IntPtr.Zero
            ? MonitorHelper.GetMonitorFromWindowHandle(game.Hwnd)
            : MonitorHelper.GetMonitorFromWindowHandle(hwnd);
        Console.WriteLine($"  HMONITOR do jogo:  0x{gameMonitor:X8}");

        for (uint i = 0; adapter.EnumOutputs(i, out var output).Success; i++)
        {
            using (output)
            {
                using var output1 = output.QueryInterface<IDXGIOutput1>();
                var desc = output1.Description;
                var bounds = desc.DesktopCoordinates;
                var midX = (bounds.Left + bounds.Right) / 2;
                var midY = (bounds.Top + bounds.Bottom) / 2;
                var outputMonitor = MonitorHelper.MonitorFromPoint(midX, midY);
                var isMatch = outputMonitor == gameMonitor ? " ← JOGO" :
                              outputMonitor == primaryMonitor ? " ← PRIMÁRIO" : "";
                Console.WriteLine($"  Output[{i}]: {bounds.Right - bounds.Left}x{bounds.Bottom - bounds.Top} @({bounds.Left},{bounds.Top}) HMONITOR=0x{outputMonitor:X8}{isMatch}");
            }
        }
        Console.WriteLine();

        // Validar WGC window capture
        Console.WriteLine("--- WGC TryCreateFromWindowId ---");
        try
        {
            var targetHwnd = game.IsValid && game.Hwnd != IntPtr.Zero ? game.Hwnd : hwnd;
            var captureItem = Capture.GraphicsCaptureItemHelper.CreateForWindow(targetHwnd);
            if (captureItem != null)
            {
                Console.WriteLine($"  ✓ GraphicsCaptureItem criado: {captureItem.Size.Width}x{captureItem.Size.Height}");
                Console.WriteLine($"  Nome: {captureItem.DisplayName}");
            }
            else
            {
                Console.WriteLine("  ✗ TryCreateFromWindowId retornou null");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  ✗ WGC falhou: {ex.GetType().Name}: {ex.Message}");
        }

        Console.WriteLine("\n=== Validação concluída ===");
    }

    private static ID3D11Device CreateD3D11Device()
    {
        var creationFlags = DeviceCreationFlags.BgraSupport;
        var result = D3D11.D3D11CreateDevice(
            null, DriverType.Hardware, creationFlags,
            new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
            out ID3D11Device device, out _, out _);
        if (result.Failure || device is null)
            throw new InvalidOperationException($"Falha ao criar D3D11 device: {result}");
        return device;
    }

    private static unsafe string GetWindowText(IntPtr hwnd)
    {
        int len = PInvoke.GetWindowTextLength((HWND)hwnd);
        if (len == 0) return string.Empty;
        char* buf = stackalloc char[len + 1];
        PInvoke.GetWindowText((HWND)hwnd, buf, len + 1);
        return new string(buf);
    }

    // GetForegroundWindow and GetWindowText — generated by CsWin32 (NativeMethods.txt)

    internal static async Task RunBenchmarkAsync(bool benchJson)
    {
        Console.WriteLine("=== DiNho Clips — Benchmark Pipeline GPU ===");
        Console.WriteLine();

        var result = new BenchmarkResult();
        var gpuName = Program.CheckGpuDriver();
        result.GpuName = gpuName;

        MediaFactory.MFStartup(false);

        try
        {
            var adapters = ListAdapters();
            var best = PickBestAdapter(adapters);
            foreach (var adapter in adapters)
            {
                if (!ReferenceEquals(adapter, best)) adapter.Dispose();
            }
            if (best == null)
            {
                Console.Error.WriteLine("  Nenhum adaptador D3D11 disponível");
                return;
            }

            var creationFlags = DeviceCreationFlags.BgraSupport;
            D3D11.D3D11CreateDevice(
                best, DriverType.Unknown, creationFlags,
                new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                out ID3D11Device device, out var featureLevel, out _).CheckError();

            best.Dispose();

            using (device)
            {
                using var dxgiDevice = device.QueryInterface<IDXGIDevice>();
                using var chosen = dxgiDevice.GetAdapter();
                var desc = chosen.Description;
                result.Adapter = desc.Description;
                Console.WriteLine($"  Device: {desc.Description} (FL {featureLevel})");

                ICaptureSource capture;
                WgcCaptureSource? wgc = null;
                WindowsMessagePump? pump = null;
                try
                {
                    Console.WriteLine("  (TEMP WGC-FIRST SMOKE)");
                    wgc = new WgcCaptureSource();
                    pump = new WindowsMessagePump();
                    pump.Invoke(() => { wgc.Initialize(); wgc.StartFramePump(); });
                    capture = wgc;
                    result.CaptureBackend = "WGC";
                    Console.WriteLine($"  Captura: Windows Graphics Capture");
                }
                catch (Exception ex)
                {
                    wgc?.Dispose();
                    pump?.Dispose();
                    Console.WriteLine($"  WGC falhou: {ex.Message}, tentando DXGI...");
                    var dxgi = new DxgiCaptureSource();
                    dxgi.Initialize(device);
                    capture = dxgi;
                    result.CaptureBackend = "DXGI";
                    Console.WriteLine($"  Captura: DXGI Desktop Duplication (fallback)");
                }

                using (capture)
                {
                    // Warmup
                    for (int i = 0; i < 5; i++)
                    {
                        capture.TryCaptureFrame(500);
                        await Task.Delay(16);
                    }

                    // Capture benchmark
                    const int captureFrames = 300;
                    var totalLatencies = new List<double>(captureFrames);
                    var waitLatencies = new List<double>(captureFrames);
                    var copyLatencies = new List<double>(captureFrames);
                    int captureSuccess = 0;

                    for (int i = 0; i < captureFrames; i++)
                    {
                        var frame = capture.TryCaptureFrame(500);

                        if (frame.Success)
                        {
                            totalLatencies.Add((frame.CaptureEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                            waitLatencies.Add((frame.WaitEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                            copyLatencies.Add((frame.CopyEndTicks - frame.WaitEndTicks) * 1000.0 / Stopwatch.Frequency);
                            captureSuccess++;
                        }
                        await Task.Delay(1);
                    }

                    totalLatencies.Sort();
                    waitLatencies.Sort();
                    copyLatencies.Sort();

                    static LatencyStats ComputeStats(List<double> sorted)
                    {
                        return sorted.Count > 0 ? new LatencyStats
                        {
                            Min = sorted.Min(),
                            P50 = sorted[(int)(sorted.Count * 0.50)],
                            P95 = sorted[(int)(sorted.Count * 0.95)],
                            P99 = sorted[(int)(sorted.Count * 0.99)],
                            Avg = sorted.Average(),
                            Max = sorted.Max()
                        } : new LatencyStats();
                    }

                    result.Capture = new CaptureBench
                    {
                        FramesCaptured = captureSuccess,
                        FramesTotal = captureFrames,
                        LatencyMs = ComputeStats(totalLatencies),
                        WaitMs = ComputeStats(waitLatencies),
                        CopyMs = ComputeStats(copyLatencies),
                        P95Met = totalLatencies.Count > 0 && totalLatencies[(int)(totalLatencies.Count * 0.95)] < 16.0
                    };

                    Console.WriteLine($"  Captura: {result.Capture.FramesCaptured}/{result.Capture.FramesTotal} frames");
                    Console.WriteLine($"  Latência total (ms): p50={result.Capture.LatencyMs.P50:F2}  p95={result.Capture.LatencyMs.P95:F2}  p99={result.Capture.LatencyMs.P99:F2}");
                    Console.WriteLine($"  Espera (ms):          p50={result.Capture.WaitMs.P50:F2}  p95={result.Capture.WaitMs.P95:F2}");
                    Console.WriteLine($"  Cópia (ms):           p50={result.Capture.CopyMs.P50:F2}  p95={result.Capture.CopyMs.P95:F2}");
                    Console.WriteLine($"  Meta p95 < 16ms: {(result.Capture.P95Met ? "✓" : "✗")}");

                    // Encoder benchmark
                    Console.WriteLine($"  Enumerando encoders HW H.264 disponíveis...");
                    var avail = EncoderManager.DetectAvailableEncoders();
                    foreach (var enc in avail)
                        Console.WriteLine($"    - {enc}");

                    Console.WriteLine($"  Criando encoder via EncoderManager...");
                    using var encoder = EncoderManager.CreateBestEncoder(sharedDevice: device);
                    encoder.Initialize(1920, 1080, 60);
                    result.Encoder = encoder.GetType().Name;
                    Console.WriteLine($"  Encoder: {result.Encoder}");

                    const int maxEncodeFrames = 100;
                    var gpuTimings = new List<long>(maxEncodeFrames);
                    var pts = TimeSpan.Zero;
                    int encodedCount = 0;

                    for (int i = 0; i < maxEncodeFrames && encodedCount < 30; i++)
                    {
                        var frame = capture.TryCaptureFrame(500);
                        if (!frame.Success || frame.Texture == null) continue;

                        var sw = Stopwatch.StartNew();
                        var packet = encoder.EncodeFrame(frame.Texture, pts);
                        sw.Stop();

                        if (packet != null)
                        {
                            gpuTimings.Add(sw.ElapsedTicks);
                            encodedCount++;
                            pts += TimeSpan.FromTicks(166_667);
                        }
                    }

                    result.Encode = new EncodeBench
                    {
                        FramesEncoded = encodedCount,
                        AvgUs = encodedCount > 0 ? gpuTimings.Average() * 1_000_000 / Stopwatch.Frequency : 0
                    };

                    Console.WriteLine($"  Encode: {encodedCount} frames, média {result.Encode.AvgUs:F1} us/frame");

                    // CPU benchmark: sample process CPU during ~30s of active capture
                    Console.WriteLine($"  Amostrando CPU por 30s (simulando gravação ativa)...");
                    var proc = Process.GetCurrentProcess();
                    var cpuSamples = new List<double>(60);
                    var prevCpuTime = proc.TotalProcessorTime;
                    var prevWall = DateTime.UtcNow;

                    for (int s = 0; s < 30; s++)
                    {
                        await Task.Delay(1000);
                        var curCpuTime = proc.TotalProcessorTime;
                        var curWall = DateTime.UtcNow;
                        var cpuDelta = (curCpuTime - prevCpuTime).TotalSeconds;
                        var wallDelta = (curWall - prevWall).TotalSeconds;
                        var cpuPct = wallDelta > 0 ? cpuDelta / wallDelta * 100 : 0;
                        cpuSamples.Add(cpuPct);
                        prevCpuTime = curCpuTime;
                        prevWall = curWall;
                    }

                    result.Cpu = new CpuBench
                    {
                        AvgCpuPercent = cpuSamples.Average(),
                        PeakCpuPercent = cpuSamples.Max(),
                        SamplingDurationSec = 30
                    };

                    Console.WriteLine($"  CPU: média={result.Cpu.AvgCpuPercent:F1}%  pico={result.Cpu.PeakCpuPercent:F1}%");
                }

                pump?.Dispose();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"  Benchmark falhou: {ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            MediaFactory.MFShutdown();
        }

        if (benchJson)
        {
            var path = BenchmarkResult.DefaultOutputPath();
            var dir = Path.GetDirectoryName(path);
            if (dir != null) Directory.CreateDirectory(dir);
            File.WriteAllText(path, result.ToJson());
            Console.WriteLine($"  Resultados salvos em: {path}");
        }

        Console.WriteLine();
    }

    private static List<IDXGIAdapter1> ListAdapters()
    {
        var list = new List<IDXGIAdapter1>();
        using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        for (uint i = 0; ; i++)
        {
            var result = factory.EnumAdapters1(i, out var adapter);
            if (result.Failure || adapter == null) break;
            var desc = adapter.Description;
            Console.WriteLine($"  Adapter #{i}: {desc.Description} (VID={desc.VendorId:X4}, DEV={desc.DeviceId:X4})");
            list.Add(adapter);
        }
        return list;
    }

    private static IDXGIAdapter1? PickBestAdapter(List<IDXGIAdapter1> adapters)
    {
        var preferred = adapters.FirstOrDefault(a =>
        {
            var d = a.Description;
            return d.VendorId == 0x10DE || // NVIDIA
                   d.VendorId == 0x1002 || // AMD
                   d.VendorId == 0x8086;   // Intel
        });
        if (preferred != null)
        {
            Console.WriteLine($"  Adapter selecionado: {preferred.Description.Description}");
            return preferred;
        }
        var fallback = adapters.FirstOrDefault(a => a.Description.VendorId != 0x1414);
        return fallback;
    }

    internal static async Task RunTestsAsync()
    {
        Console.WriteLine("=== DiNho Clips — Fase 0: Benchmark de Captura ===");
        Console.WriteLine();

        await TestCaptureLatencyBenchmark();

        Console.WriteLine("=== Fase 1: Núcleo do Engine ===");
        Console.WriteLine();

        TestMasterClock();
        TestReplayBuffer();
        await TestEncoderInitAsync();
        TestAudioCapture();
        TestExporter();

        Console.WriteLine("=== Fase 1 concluída ===");
    }

    private static async Task TestCaptureLatencyBenchmark()
    {
        Console.WriteLine("--- Fase 0: Latência WGC Desktop Duplication (TEMP WGC-FIRST SMOKE) ---");

        ICaptureSource? capture = new WgcCaptureSource();
        WindowsMessagePump? pump = null;

        try
        {
            pump = new WindowsMessagePump();
            pump.Invoke(() =>
            {
                capture.Initialize();
                ((WgcCaptureSource)capture).StartFramePump();
                Console.WriteLine($"  [{capture.Name}] Inicializado.");
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  WGC indisponível: {ex.Message}");
            try
            {
                capture = new DxgiCaptureSource();
                capture.Initialize();
                Console.WriteLine($"  [{capture.Name}] Inicializado.");
            }
            catch (Exception ex2)
            {
                Console.WriteLine($"  DXGI indisponível: {ex2.Message}");
                Console.WriteLine("  Pulando benchmark de captura.");
                capture?.Dispose();
                pump?.Dispose();
                return;
            }
        }

        for (int i = 0; i < 5; i++)
        {
            capture.TryCaptureFrame(CaptureTimeoutMs);
            await Task.Delay(1);
        }

        var latencies = new List<double>(FramesBenchmark);
        var successCount = 0;

        var totalLat2 = new List<double>(FramesBenchmark);
        var waitLat2 = new List<double>(FramesBenchmark);
        var copyLat2 = new List<double>(FramesBenchmark);

        for (int i = 0; i < FramesBenchmark; i++)
        {
            var frame = capture.TryCaptureFrame(CaptureTimeoutMs);

            if (frame.Success)
            {
                totalLat2.Add((frame.CaptureEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                waitLat2.Add((frame.WaitEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency);
                copyLat2.Add((frame.CopyEndTicks - frame.WaitEndTicks) * 1000.0 / Stopwatch.Frequency);
                successCount++;
            }
            await Task.Delay(1);
        }

        capture.Dispose();
        pump?.Dispose();

        if (totalLat2.Count == 0)
        {
            Console.WriteLine($"  Nenhum frame capturado em {FramesBenchmark} tentativas.");
            Console.WriteLine();
            return;
        }

        totalLat2.Sort();
        waitLat2.Sort();
        copyLat2.Sort();

        static (double p50, double p95, double p99, double avg, double min, double max) Compute(
            List<double> sorted) => (
            sorted[(int)(sorted.Count * 0.50)],
            sorted[(int)(sorted.Count * 0.95)],
            sorted[(int)(sorted.Count * 0.99)],
            sorted.Average(),
            sorted.Min(),
            sorted.Max());

        var (tp50, tp95, tp99, tavg, tmin, tmax) = Compute(totalLat2);
        var (wp50, wp95, _, _, wmin, _) = Compute(waitLat2);
        var (cp50, cp95, _, _, cmin, _) = Compute(copyLat2);

        Console.WriteLine($"  Frames: {successCount}/{FramesBenchmark}");
        Console.WriteLine($"  Latência total (ms): min={tmin:F2}  p50={tp50:F2}  p95={tp95:F2}  p99={tp99:F2}  avg={tavg:F2}  max={tmax:F2}");
        Console.WriteLine($"  Espera (ms):         min={wmin:F2}  p50={wp50:F2}  p95={wp95:F2}");
        Console.WriteLine($"  Cópia (ms):          min={cmin:F2}  p50={cp50:F2}  p95={cp95:F2}");
        Console.WriteLine($"  Meta Fase 0: p95 < 16ms {(tp95 < 16 ? "✓ ATINGIDA" : "✗ NÃO ATINGIDA")}");
        Console.WriteLine();
    }

    private static void TestMasterClock()
    {
        Console.WriteLine("--- Teste: MasterClock ---");
        var clock = new MasterClock();
        Thread.Sleep(100);
        var elapsed = clock.Now;
        Console.WriteLine($"  Elapsed (100ms sleep): {elapsed.TotalMilliseconds:F1} ms");
        Console.WriteLine($"  NowHns: {clock.NowHns} hns");
        clock.Dispose();
        Console.WriteLine();
    }

    private static void TestReplayBuffer()
    {
        Console.WriteLine("--- Teste: ReplayBuffer ---");
        var buffer = new ReplayBuffer(TimeSpan.FromSeconds(5));

        for (int i = 0; i < 10; i++)
        {
            var pts = TimeSpan.FromMilliseconds(i * 33.33);
            var packet = new EncodedPacket(
                new byte[] { 0, 0, 0, 1, (byte)(i == 0 ? 0x67 : 0x41) },
                MediaType.Video,
                pts,
                TimeSpan.FromTicks(333_333),
                i == 0);
            buffer.AddVideo(packet);
        }

        var stats = buffer.Stats();
        Console.WriteLine($"  Pacotes de vídeo: {stats.videoCount}");
        Console.WriteLine($"  Duração total: {stats.duration.TotalSeconds:F2}s");

        var (video, audio) = buffer.GetSegments();
        Console.WriteLine($"  Pacotes no snapshot: {video.Count} vídeo, {audio.Count} áudio");

        for (int i = 10; i < 500; i++)
        {
            var pts = TimeSpan.FromMilliseconds(i * 33.33);
            var packet = new EncodedPacket(
                new byte[] { 0, 0, 0, 1, 0x41 },
                MediaType.Video,
                pts,
                TimeSpan.FromTicks(333_333),
                false);
            buffer.AddVideo(packet);
        }

        stats = buffer.Stats();
        Console.WriteLine($"  Após overflow (500 pacotes ~16s): {stats.videoCount} pacotes, duração={stats.duration.TotalSeconds:F1}s (esperado ~5s)");

        buffer.Dispose();
        Console.WriteLine();
    }

    private static Task TestEncoderInitAsync()
    {
        Console.WriteLine("--- Teste: Encoder (inicialização) ---");

        try
        {
            using var encoder = EncoderManager.CreateBestEncoder();
            encoder.Initialize(640, 480, 30);
            Console.WriteLine($"  {encoder.GetType().Name}: Inicializado (640x480 @ 30fps).");
            Console.WriteLine("  (encode com textura real requer GPU)");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Encoder: {ex.GetType().Name}: {ex.Message}");
        }

        Console.WriteLine();
        return Task.CompletedTask;
    }

    private static void TestAudioCapture()
    {
        Console.WriteLine("--- Teste: WASAPI Loopback Audio ---");

        try
        {
            using var audio = new Audio.WasapiLoopbackSource();
            var received = 0;

            audio.OnAudioData += buf =>
            {
                if (Interlocked.Exchange(ref received, 1) == 0)
                    Console.WriteLine($"  Primeiro buffer: {buf.Samples.Length} samples, {buf.SampleRate}Hz, {buf.Channels}ch");
            };

            audio.Start();
            Console.WriteLine("  WASAPI loopback iniciado (aguardando áudio por 1s)...");
            Thread.Sleep(1000);
            audio.Stop();

            Console.WriteLine($"  Áudio recebido: {(received > 0 ? "SIM" : "NÃO (silêncio?)")}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  WASAPI indisponível: {ex.Message}");
        }

        Console.WriteLine();
    }

    private static void TestExporter()
    {
        Console.WriteLine("--- Teste: ClipExporter (sintético) ---");

        try
        {
            var videoPackets = new List<EncodedPacket>();
            var audioPackets = new List<EncodedPacket>();

            // Gerar H.264 válido via ffmpeg
            var tempRaw = Path.GetTempFileName() + ".h264";
            var psi = new ProcessStartInfo
            {
                FileName = "ffmpeg",
                Arguments = $"-y -f lavfi -i color=c=black:s=640x480:d=0.5 -c:v libx264 -preset veryfast -frames:v 15 -f h264 \"{tempRaw}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
            };
            using var proc = Process.Start(psi)!;
            proc.WaitForExit(10000);
            var rawData = File.ReadAllBytes(tempRaw);
            File.Delete(tempRaw);

            // Dividir em NAL units e criar pacotes
            var nalStart = FindNalStart(rawData, 0);
            var nalIndex = 0;
            while (nalStart >= 0)
            {
                var nextStart = FindNalStart(rawData, nalStart + 4);
                var nalLen = (nextStart >= 0 ? nextStart : rawData.Length) - nalStart;
                var nalData = rawData.AsSpan(nalStart, nalLen).ToArray();
                var nalType = nalData[4] & 0x1F;
                var isKeyframe = nalType == 7; // SPS = IDR
                var pts = TimeSpan.FromTicks(nalIndex * 333_333);

                videoPackets.Add(new EncodedPacket(
                    nalData, MediaType.Video, pts,
                    TimeSpan.FromTicks(333_333), isKeyframe, 640, 480));

                nalIndex++;
                nalStart = nextStart;
            }

            if (videoPackets.Count > 0)
            {
                using var exporter = new ClipExporter();
                var outputPath = ClipExporter.GenerateOutputPath(Path.GetTempPath());
                var result = exporter.ExportToMp4(outputPath, videoPackets, [], 640, 480, 30);
                Console.WriteLine($"  Exportado: {result} ({new FileInfo(result).Length / 1024} KB)");
            }
            else
            {
                Console.WriteLine("  Nenhum NAL encontrado no H.264 gerado.");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Export FALHOU: {ex.GetType().Name}: {ex.Message}");
        }

        Console.WriteLine();
    }

    private static int FindNalStart(byte[] data, int offset)
    {
        for (int i = offset; i < data.Length - 3; i++)
        {
            if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1)
                return i;
        }
        return -1;
    }
}
