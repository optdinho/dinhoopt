using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Encoders;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Windows.Win32;

namespace DiNho.Capture.Poc;

internal static class Program
{
    private static bool _forceSoftware;
    private static bool _benchJson;
    private static int _durationSeconds;

    /// <summary>Argumento posicional como inteiro, com fallback quando ausente, vazio ou
    /// inválido. <b>Inválido cai no fallback em vez de estourar</b>: um probe de diagnóstico
    /// que morre com <c>FormatException</c> porque alguém digitou <c>--probe-amf-cqp 1920
    /// 1080 sessenta</c> não mede nada e não diz por quê — e o sintoma (nenhum relatório)
    /// parece hardware, não digitação.</summary>
    private static int Pick(string[] args, int index, int fallback) =>
        index < args.Length
        && int.TryParse(args[index], NumberStyles.Integer, CultureInfo.InvariantCulture, out var v)
        && v > 0
            ? v
            : fallback;

    private static async Task Main(string[] args)
    {
        _forceSoftware = args.Contains("--force-software");
        _benchJson = args.Contains("--bench-json");
        var durationIdx = Array.IndexOf(args, "--duration");
        if (durationIdx >= 0 && durationIdx + 1 < args.Length)
            _durationSeconds = int.Parse(args[durationIdx + 1]);

        if (args.Length > 0 && args[0] == "--test")
        {
            await ProgramBenchmark.RunTestsAsync();
            return;
        }

        if (args.Length > 0 && args[0] == "--encoders")
        {
            ProgramBenchmark.TestEncoders();
            return;
        }

        if (args.Length > 0 && args[0] == "--probe-nvenc")
        {
            ProgramBenchmark.ProbeNvencPresets(
                args.Length > 1 ? args[1] : "1920",
                args.Length > 2 ? args[2] : "1080",
                args.Length > 3 ? args[3] : "60");
            return;
        }

        if (args.Length > 0 && args[0] == "--probe-vbv")
        {
            ProgramBenchmark.ProbeVbv(
                args.Length > 1 ? args[1] : "1920",
                args.Length > 2 ? args[2] : "1080",
                args.Length > 3 ? args[3] : "60",
                args.Length > 4 ? args[4] : "18",
                args.Length > 5 ? args[5] : "55000",
                args.Length > 6 ? args[6] : "");
            return;
        }

        if (args.Length > 0 && args[0] == "--probe-amf-cqp")
        {
            // A/B entre a chain AMF de produção (vbr_peak + 0,36) e CQP com o mesmo teto VBV.
            // Sem override, usa a AppConfig real — o veredito só vale para a config que o
            // usuário está gravando, e um CQ diferente muda a resposta.
            var cfg = ProgramBenchmark.ReadLiveConfigOrDefault();
            var cqpBase = new AmdCqpProbeOptions(
                Pick(args, 1, cfg.Width), Pick(args, 2, cfg.Height), Pick(args, 3, cfg.Fps),
                Pick(args, 4, cfg.Cq), Pick(args, 5, cfg.MaxrateKbps), Pick(args, 6, cfg.BufsizeKbps),
                Math.Clamp(Pick(args, 7, AmdAudit.DefaultFrames), 30, 600),
                args.Length > 8 && !string.IsNullOrWhiteSpace(args[8]) ? args[8].Trim() : "h264_amf");

            // A lista de QP é o 9º argumento. Erro duro e nomeando o token: uma lista mal
            // digitada caindo na escada default faria o probe publicar um veredito legítimo
            // sobre uma escada que ninguém pediu — a mesma classe do "--ffmpeg sem valor"
            // do verify-ffmpeg.js.
            var qpsArg = args.Length > 9 ? args[9] : "";
            if (!AmdCqpProbe.TryNormalizeQps(qpsArg, cqpBase.Cq, out var qps, out var qpsErro))
            {
                Console.Error.WriteLine($"ERRO: lista de QP inválida — {qpsErro}");
                Console.Error.WriteLine("       uso: --probe-amf-cqp [W H FPS CQ MAXRATE BUFSIZE FRAMES [CODEC [QPS|auto]]]");
                return;
            }

            AmdCqpProbe.Run(cqpBase with { Qps = qps }, msg => Console.WriteLine("  [" + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "] " + msg));
            return;
        }

        if (args.Length > 0 && args[0] == "--probe-amf-usage")
        {
            ProgramBenchmark.ProbeAmfUsage(
                args.Length > 1 ? args[1] : "1920",
                args.Length > 2 ? args[2] : "1080",
                args.Length > 3 ? args[3] : "60",
                args.Length > 4 ? args[4] : "18",
                args.Length > 5 ? args[5] : "55000",
                args.Length > 6 ? args[6] : "h264_amf",
                args.Length > 7 ? args[7] : "",
                args.Length > 8 ? args[8] : "3");
            return;
        }

        if (args.Length > 0 && args[0] == "--probe-amd-sweep")
        {
            // Grade usage x QP. Sem override, usa a AppConfig real: o veredito so vale para a
            // config que o usuario esta gravando.
            var cfg = ProgramBenchmark.ReadLiveConfigOrDefault();
            var baseOpts = new AmdSweepOptions(
                Pick(args, 1, cfg.Width), Pick(args, 2, cfg.Height), Pick(args, 3, cfg.Fps),
                Pick(args, 4, cfg.Cq), Pick(args, 5, cfg.MaxrateKbps), Pick(args, 6, cfg.BufsizeKbps),
                Math.Clamp(Pick(args, 7, AmdAudit.DefaultFrames), 30, 600),
                args.Length > 8 && !string.IsNullOrWhiteSpace(args[8]) ? args[8].Trim() : "h264_amf",
                // Default curado, nao a lista inteira: `webcam` e `lowlatency_high_quality` nao
                // sao candidatos plausiveis para captura de jogo, e cada usage a mais sao 8
                // encodes + 8 VMAF. `USAGES=` abre a lista toda.
                Array.Empty<string>(), Array.Empty<int>(), 3, 3);

            var usageArg = args.Length > 9 ? args[9] : "";
            if (!AmdSweepProbe.TryNormalizeUsages(usageArg, out var usages, out var usageErro))
            {
                Console.Error.WriteLine($"ERRO: {usageErro}");
                return;
            }
            if (usages.Length == 0)
            {
                // Default curado, nao a lista inteira: `webcam` e `lowlatency_high_quality` nao
                // sao candidatos plausiveis para captura de jogo, e cada usage a mais sao 8
                // encodes + 8 VMAF. `USAGES=` abre a lista toda.
                usages = new[] { "", "transcoding", "ultralowlatency", "lowlatency", "high_quality" };
            }

            // Vazio = "auto", e nao a escada curta. A escada base {cq-2..cq+4} mede o cqp so
            // onde ele NAO tem chance - foi assim que a primeira rodada mediu 43,7 a 67,7 Mbps
            // contra os 22,1 da producao e Said "cqp nao compensa" sem chegar no lado barato da
            // curva. Num probe que existe para achar o lado barato, a escada curta repetiria o
            // erro que o "auto" do probe 7 ja conserta.
            var qpArg = args.Length > 10 && args[10].Trim().Length > 0 ? args[10].Trim() : "auto";
            if (!AmdCqpProbe.TryNormalizeQps(qpArg, baseOpts.Cq, out var sweepQps, out var qpErro))
            {
                Console.Error.WriteLine($"ERRO: lista de QP invalida - {qpErro}");
                Console.Error.WriteLine("       uso: --probe-amd-sweep [W H FPS CQ MAXRATE BUFSIZE FRAMES [CODEC [USAGES [QPS [FINALISTAS [VOLTAS]]]]]]");
                return;
            }

            AmdSweepProbe.Run(baseOpts with
            {
                Usages = usages,
                Qps = AmdSweepProbe.ResolveQps(sweepQps, baseOpts.Cq),
                Finalists = Math.Clamp(Pick(args, 11, 3), 1, 32),
                Rounds = Math.Clamp(Pick(args, 12, 3), 1, 9),
            }, msg => Console.WriteLine("  [" + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "] " + msg));
            return;
        }

        if (args.Length > 0 && args[0] == "--probe-hevc-profile")
        {
            ProgramBenchmark.ProbeHevcProfile(
                args.Length > 1 ? args[1] : "1920",
                args.Length > 2 ? args[2] : "1080",
                args.Length > 3 ? args[3] : "60",
                args.Length > 4 ? args[4] : "18",
                args.Length > 5 ? args[5] : "55000",
                args.Length > 6 ? args[6] : "hevc_nvenc",
                args.Length > 7 ? args[7] : "");
            return;
        }

        if (args.Length > 0 && args[0] == "--audit-amd")
        {
            ProgramBenchmark.RunAmdAudit(
                args.Length > 1 ? args[1] : null,
                args.Length > 2 ? args[2] : null,
                args.Length > 3 ? args[3] : null,
                args.Length > 4 ? args[4] : null,
                args.Length > 5 ? args[5] : null,
                args.Length > 6 ? args[6] : null,
                args.Length > 7 ? args[7] : null,
                args.Length > 8 ? args[8] : null);
            return;
        }

        if (args.Length > 0 && (args[0] == "--bench" || args[0] == "--bench-json"))
        {
            await ProgramBenchmark.RunBenchmarkAsync(_benchJson);
            return;
        }

        if (args.Length > 0 && args[0] == "--validate")
        {
            await ProgramBenchmark.ValidateCaptureAsync();
            return;
        }

        if (args.Length > 0 && args[0] is "--help" or "-h" or "/?")
        {
            ProgramBenchmark.ShowHelp();
            return;
        }

        await RunEngine();
    }

    private static async Task RunEngine()
    {
        Console.WriteLine("=== DiNho Clips Engine v1.0.0 ===");
        Console.WriteLine();

        SetupGlobalExceptionHandler();
        SetAppUserModelId();
        CheckGpuDriver();

        if (_forceSoftware)
            Console.WriteLine("  Modo: force-software (encoder CPU)");
        Console.WriteLine();

        using var engine = new EngineCoordinator(forceSoftware: _forceSoftware);
        await engine.StartAsync();

        var tcs = new TaskCompletionSource();
        Console.CancelKeyPress += (s, e) =>
        {
            e.Cancel = true;
            tcs.TrySetResult();
        };

        if (_durationSeconds > 0)
        {
            Console.WriteLine($"Gravando por {_durationSeconds}s. Pressione Ctrl+C para parar antes.");
            using var timer = new Timer(_ => tcs.TrySetResult(), null, _durationSeconds * 1000, Timeout.Infinite);
            await tcs.Task;
        }
        else
        {
            Console.WriteLine("Pressione Ctrl+C para parar.");
            await tcs.Task;
        }

        await engine.StopAsync();
        Console.WriteLine("Engine parado.");
    }

    internal static string? CheckGpuDriver()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0000");
            if (key != null)
            {
                var name = key.GetValue("DriverDesc")?.ToString() ?? "?";
                var version = key.GetValue("DriverVersion")?.ToString() ?? "?";
                var date = key.GetValue("DriverDate")?.ToString() ?? "?";
                Console.WriteLine($"  GPU: {name} (driver v{version}, {date})");
                return $"{name} v{version}";
            }
            else
            {
                Console.WriteLine("  GPU: não detectada");
                return null;
            }
        }
        catch
        {
            Console.WriteLine("  GPU: não foi possível detectar");
            return null;
        }
    }

    /// <summary>
    /// Define o AppUserModelId para o processo.
    /// Necessário para Windows.Graphics.Capture (WGC) funcionar em processos
    /// não-APPX (modo installed/packaged).
    /// Sem este ID, WGC pode falhar com ArgumentException "Parâmetro incorreto"
    /// porque o WinRT não consegue ativar o GraphicsCaptureItem corretamente.
    /// </summary>
    private static void SetAppUserModelId()
    {
        try
        {
            const string appId = "DiNho.ClipsEngine";
            var hr = PInvoke.SetCurrentProcessExplicitAppUserModelID(appId);
            if (hr == 0)
                Console.WriteLine($"[Program] AppUserModelId set to '{appId}'");
            else
                Console.Error.WriteLine($"[Program] SetCurrentProcessExplicitAppUserModelID falhou: HRESULT=0x{hr:X8}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Program] SetAppUserModelId exceção: {ex.Message}");
        }
    }

    // SetCurrentProcessExplicitAppUserModelID — generated by CsWin32 (NativeMethods.txt)

    private static void SetupGlobalExceptionHandler()
    {
        AppDomain.CurrentDomain.UnhandledException += (sender, args) =>
        {
            var ex = args.ExceptionObject as Exception;
            var crashLog = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DiNhoClips", "crash", $"crash_{DateTime.Now:yyyyMMdd_HHmmss}.txt");

            var dir = Path.GetDirectoryName(crashLog);
            if (dir != null) Directory.CreateDirectory(dir);

            File.WriteAllText(crashLog,
                $"DiNho Clips Crash Report\n" +
                $"Time: {DateTime.Now:yyyy-MM-dd HH:mm:ss}\n" +
                $"OS: {Environment.OSVersion}\n" +
                $"Runtime: {RuntimeInformation.FrameworkDescription}\n" +
                $"Exception: {ex?.GetType().FullName}\n" +
                $"Message: {ex?.Message}\n" +
                $"Stack: {ex?.StackTrace}\n");

            Console.Error.WriteLine($"[FATAL] Crash inesperado. Log salvo em: {crashLog}");
        };
    }
}
