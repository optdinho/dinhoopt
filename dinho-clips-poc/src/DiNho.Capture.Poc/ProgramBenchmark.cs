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
        Console.WriteLine();

        if (!EncoderManager.CheckFfmpegEncoder(codec))
        {
            Console.WriteLine($"'{codec}' indisponível neste ffmpeg/hardware. Rode numa máquina com GPU AMD.");
            return;
        }

        double? baselineFps = null;
        double? baselineRate = null;
        long baselineBytes = 0;
        var algumMedido = false;
        foreach (var usage in candidates)
        {
            var r = EncoderManager.RunAmfUsageProbe(
                codec, width, height, targetFps, targetCq, maxrateKbps, bufsizeKbps, usage);
            if (r is null)
            {
                // usage rejeitado pelo encoder (ou GPU ocupada): o stderr real só aparece se
                // pedir um retry com callback — 1 retry, não 6, pra não custar 6x o kill-guard.
                var saida = new List<string>();
                var retry = EncoderManager.RunAmfUsageProbe(
                    codec, width, height, targetFps, targetCq, maxrateKbps, bufsizeKbps, usage,
                    onStderr: saida.Add);
                if (retry is null)
                {
                    Console.WriteLine($"    {AmfUsageLabel(usage),-24}: RECUSADO pelo encoder");
                    foreach (var l in saida) Console.WriteLine($"      ffmpeg: {l}");
                    // Se a PRIMEIRA referência (o default de produção, sem -usage) foi recusada, não há
                    // device AMF funcional — todos os outros usages vão falhar igual. Testar os 5
                    // restantes só multiplica o custo, então aborta o codec aqui.
                    if (usage.Length == 0)
                    {
                        Console.WriteLine($"    '{codec}' sem device AMF utilizável — demais usages abortados.");
                        break;
                    }
                    continue;
                }
                r = retry;
            }
            algumMedido = true;
            baselineFps ??= r.AchievedFps;
            baselineRate ??= r.BitrateKbps;
            baselineBytes = Math.Max(baselineBytes, r.OutputBytes);
            var dFps = baselineFps > 0 ? (r.AchievedFps / baselineFps - 1) * 100 : 0;
            var dRate = baselineRate > 0 ? (r.BitrateKbps / baselineRate.Value - 1) * 100 : 0;
            // Format com ';' precisa sair do hole de interpolação (o ';' fecha a seção).
            var dFpsTxt = $"{dFps:+0;-0;0}%";
            var dRateTxt = $"{dRate:+0;-0;0}%";
            var dBytes = baselineBytes > 0 ? (r.OutputBytes / (double)baselineBytes - 1) * 100 : 0;
            var dBytesTxt = $"{dBytes:+0;-0;0}%";
            var headroomTxt = r.VbvBinds
                ? $"VBV APERTA (-{-r.HeadroomToMaxrateKbps:0} K)"
                : $"folga p/ teto {r.HeadroomToMaxrateKbps:0} K";
            Console.WriteLine(
                $"    {AmfUsageLabel(usage),-24}: {r.AchievedFps,7:0.00} fps ({dFpsTxt,7}) | " +
                $"{r.BitrateKbps,8:0.0} Kbps ({dRateTxt,7}) | {r.OutputBytes / 1024,6} KiB ({dBytesTxt,6}) | {headroomTxt}");
        }
        Console.WriteLine();
        if (!algumMedido)
            Console.WriteLine("Nenhum candidate medido — sem GPU AMF funcional aqui (resposta honesta, sem chute).");
        else
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
        var cfg = ReadLiveConfig();
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
    private static AppConfig ReadLiveConfig()
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
        Console.WriteLine("  DiNho.Capture.Poc --probe-vbv [W H FPS CQ MAXRATE BUFSIZES]  Mede bitrate/fps por -bufsize");
        Console.WriteLine("  DiNho.Capture.Poc --probe-amf-usage [W H FPS CQ MAXRATE CODEC USAGES]  Mede fps/bitrate por -usage da AMF (precisa de GPU AMD)");
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
