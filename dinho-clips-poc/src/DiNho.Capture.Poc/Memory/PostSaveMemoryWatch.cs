using System.Diagnostics;
using System.Globalization;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Memory;

/// <summary>
/// Amostra de memória instantânea usada pelas linhas pós-save. Struct puro, sem
/// I/O e sem tocar no GC real — mesmo padrão de <c>FeedSummary</c>/<c>FeedLogLine</c>,
/// para que a formatação seja testável de forma determinística.
/// </summary>
public readonly record struct PostSaveMemorySample(
    double SecondsSinceSave,
    long ProcMb,
    long GcManagedMb,
    long AllocatedMb,
    long NativeMb,
    long ManagedRetainedMb,
    long LohMb,
    long Gen2Mb,
    long CommittedMb,
    long PoolIdleMb,
    long GcPauseTotalMs);

/// <summary>
/// Resultado da comparação baseline→final. <c>Recovered</c> só é verdadeiro quando
/// <b>allocated</b> e <b>committed</b> caem mais que a tolerância: é essa a prova
/// pedida de que a RAM do export volta, e não a suposição de que o GC "já faz".
/// </summary>
public readonly record struct MemoryRecovery(
    bool AllocatedDropped,
    bool CommittedDropped,
    long AllocatedDeltaMb,
    long CommittedDeltaMb,
    long ProcDeltaMb,
    bool Recovered)
{
    public static MemoryRecovery Between(PostSaveMemorySample baseline, PostSaveMemorySample last, long toleranceMb)
    {
        var allocatedDelta = baseline.AllocatedMb - last.AllocatedMb;
        var committedDelta = baseline.CommittedMb - last.CommittedMb;
        var allocatedDropped = allocatedDelta > toleranceMb;
        var committedDropped = committedDelta > toleranceMb;
        return new MemoryRecovery(
            allocatedDropped,
            committedDropped,
            allocatedDelta,
            committedDelta,
            baseline.ProcMb - last.ProcMb,
            allocatedDropped && committedDropped);
    }
}

/// <summary>
/// Telemetria de recuperação de memória pós-save.
///
/// <para>
/// O log de <c>[RAM]</c> pré-existente vive dentro de <c>PipelineLoop</c> e o
/// intervalo real de um save contém a materialização de <c>List&lt;EncodedPacket&gt;</c>
/// inteira (o pico de ~1,15 GB para um clip de 316 MB). Esse mesmo log para quando o
/// save acaba, porque a captura pode ter parado — logo, ele nunca mostra o que
/// acontece <b>depois</b>. Este watcher amostra durante 60 s a partir do fim do
/// export e fecha com um veredito explícito baseline→final.
/// </para>
///
/// <para>
/// Fail-closed por contrato: é diagnóstico, nunca pode derrubar o pipeline. Toda
/// linha e o veredito são best-effort e nenhuma exceção propaga.
/// </para>
/// </summary>
public static class PostSaveMemoryWatch
{
    /// <summary>Janela total de observação após o fim do export.</summary>
    public const int DurationSec = 60;

    /// <summary>Intervalo entre amostras (inclui o baseline em t=0).</summary>
    public const int IntervalSec = 5;

    /// <summary>
    /// Tolerância de queda, em MB, para considerar que a memória "voltou".
    /// 32 MB absorve ruído de alocação normal (WGC/NVENC continuam ativos durante
    /// a janela) sem mascarar o caso real: um export de 1 GB que não libera nada.
    /// </summary>
    public const long RecoveryToleranceMb = 32;

    private static readonly Lock Sync = new();
    private static CancellationTokenSource? _running;

    /// <summary>
    /// Interruptor de telemetria. Falso em teste: a suíte exercita
    /// <c>SaveClipAsync</c> diretamente e uma janela de 60 s em background só
    /// poluiria o log de testes.
    /// </summary>
    internal static bool Enabled { get; set; } = true;

    // Probes injetáveis — padrão da casa (mesmo de WorkingSetTrimmer/FeedTelemetry).
    internal static Func<DateTime> NowProbe = () => DateTime.UtcNow;
    internal static Action<TimeSpan> SleepProbe = t => Thread.Sleep(t);
    internal static Func<double, PostSaveMemorySample> CaptureProbe = CaptureReal;
    internal static Action<string> LineProbe = line => Log.I("PostSaveRAM", line);

    /// <summary>
    /// Inicia (ou reinicia) a janela de observação. Chamado do <c>finally</c> do
    /// save, já com os packets liberados e o trim agendado.
    /// </summary>
    public static void Start()
    {
        if (!Enabled)
            return;

        lock (Sync)
        {
            try
            {
                _running?.Cancel();
                _running?.Dispose();
            }
            catch (Exception ex)
            {
                Log.D("PostSaveRAM", $"watch anterior nao cancelou: {ex.Message}");
            }

            var cts = new CancellationTokenSource();
            _running = cts;
            _ = Task.Run(() => Watch(cts), CancellationToken.None);
        }
    }

    /// <summary>Cancela a janela em curso (usado por shutdown e por testes).</summary>
    public static void Stop()
    {
        lock (Sync)
        {
            try
            {
                _running?.Cancel();
                _running?.Dispose();
            }
            catch (Exception ex)
            {
                Log.D("PostSaveRAM", $"stop falhou: {ex.Message}");
            }

            _running = null;
        }
    }

    /// <summary>Rezausível em teste.</summary>
    internal static void ResetForTest()
    {
        Stop();
        Enabled = true;
        NowProbe = () => DateTime.UtcNow;
        SleepProbe = t => Thread.Sleep(t);
        CaptureProbe = CaptureReal;
        LineProbe = line => Log.I("PostSaveRAM", line);
    }

    private static void Watch(CancellationTokenSource cts)
    {
        var ct = cts.Token;
        try
        {
            var samples = RunCycle(NowProbe, SleepProbe, CaptureProbe, ct);
            if (samples.Count == 0)
                return;

            var baseline = samples[0];
            var last = samples[^1];
            Emit($"POST-SAVE baseline {BuildSampleLine(baseline)}");
            foreach (var sample in samples)
                Emit($"t+{sample.SecondsSinceSave:F0}s {BuildSampleLine(sample)}");

            Emit(BuildVerdictLine(baseline, last, samples.Count));
        }
        catch (OperationCanceledException)
        {
            // cancelamento esperado (save seguinte / shutdown) — sem linha de erro.
        }
        catch (Exception ex)
        {
            // Fail-closed: telemetria nunca derruba nada.
            Log.D("PostSaveRAM", $"watch encerrou: {ex.Message}");
        }
    }

    private static void Emit(string line)
    {
        try
        {
            LineProbe(line);
        }
        catch (Exception ex)
        {
            Log.D("PostSaveRAM", $"linha descartada: {ex.Message}");
        }
    }

    /// <summary>
    /// Motor da janela: baseline em t=0 e depois uma amostra a cada intervalo até
    /// fechar a duração. Clock e sleep injetados tornam isso determinístico em teste
    /// (zero espera real) sem perder a forma do loop de produção.
    /// </summary>
    internal static List<PostSaveMemorySample> RunCycle(
        Func<DateTime> now,
        Action<TimeSpan> sleep,
        Func<double, PostSaveMemorySample> capture,
        CancellationToken ct = default)
    {
        var start = now();
        var samples = new List<PostSaveMemorySample>();

        samples.Add(capture(0));
        for (var step = 1; step <= DurationSec / IntervalSec; step++)
        {
            ct.ThrowIfCancellationRequested();
            sleep(TimeSpan.FromSeconds(IntervalSec));
            samples.Add(capture((now() - start).TotalSeconds));
        }

        return samples;
    }

    /// <summary>
    /// Linha por amostra. Usa a mesma gramática do <c>[RAM]</c> de captura para que a
    /// leitura seja comparável entre antes e depois do save.
    /// </summary>
    internal static string BuildSampleLine(PostSaveMemorySample s)
    {
        return string.Create(CultureInfo.InvariantCulture,
            $"proc={s.ProcMb}MB | gcManaged={s.GcManagedMb}MB | allocated={s.AllocatedMb}MB | " +
            $"native={s.NativeMb}MB | managedRetained={s.ManagedRetainedMb}MB | loh={s.LohMb}MB | " +
            $"gen2={s.Gen2Mb}MB | committed={s.CommittedMb}MB | poolIdle={s.PoolIdleMb}MB | gcPause={s.GcPauseTotalMs}ms");
    }

    /// <summary>
    /// Linha de veredito: diz explicitamente se a memória voltou, em vez de deixar
    /// o leitura do log concluir o que o número quer dizer.
    /// </summary>
    internal static string BuildVerdictLine(PostSaveMemorySample baseline, PostSaveMemorySample last, int sampleCount)
    {
        var r = MemoryRecovery.Between(baseline, last, RecoveryToleranceMb);
        var veredito = r.Recovered
            ? "RECUPEROU (allocated e committed cairam acima da tolerancia)"
            : $"NAO recuperou (tolerancia {RecoveryToleranceMb}MB)";

        return string.Create(CultureInfo.InvariantCulture,
            $"POST-SAVE VEREDITO {veredito} em {last.SecondsSinceSave:F0}s sobre {sampleCount} amostras | " +
            $"allocated {baseline.AllocatedMb}MB -> {last.AllocatedMb}MB ({Signed(r.AllocatedDeltaMb)}MB) | " +
            $"committed {baseline.CommittedMb}MB -> {last.CommittedMb}MB ({Signed(r.CommittedDeltaMb)}MB) | " +
            $"proc {baseline.ProcMb}MB -> {last.ProcMb}MB ({Signed(r.ProcDeltaMb)}MB)");
    }

    private static string Signed(long mb) => mb > 0 ? $"-{mb}" : $"+{-mb}";

    /// <summary>
    /// Leitura real. Reusa os helpers já testados do <c>[RAM]</c> de captura
    /// (<c>ReadGcDiagnostics</c>/<c>ReadGcBreakdown</c>/<c>DeriveFootprint</c>) em vez
    /// de duplicar a derivação de footprint — o número do pós-save sai pelo mesmo
    /// caminho do log pré-save, logo as duas linhas são comparáveis.
    /// </summary>
    private static PostSaveMemorySample CaptureReal(double secondsSinceSave)
    {
        long procMb = 0, gcManagedMb = 0, allocatedMb = 0;
        long lohMb = 0, gen2Mb = 0, committedMb = 0, gcPauseMs = 0;
        try
        {
            using var proc = Process.GetCurrentProcess();
            procMb = proc.WorkingSet64 / (1024L * 1024L);
            (gcManagedMb, allocatedMb) = EngineCoordinator.ReadGcDiagnostics(
                () => GC.GetTotalMemory(false) / (1024L * 1024L),
                () => GC.GetTotalAllocatedBytes() / (1024L * 1024L));
            var info = GC.GetGCMemoryInfo();
            (lohMb, gen2Mb, _, committedMb, _) = EngineCoordinator.ReadGcBreakdown(
                () => info.GenerationInfo[3].SizeAfterBytes,
                () => info.GenerationInfo[2].SizeAfterBytes,
                () => info.GenerationInfo[0].SizeAfterBytes + info.GenerationInfo[1].SizeAfterBytes,
                () => info.TotalCommittedBytes,
                () => info.PinnedObjectsCount);
            gcPauseMs = EngineCoordinator.ReadGcPauseMs(() => GC.GetTotalPauseDuration());
        }
        catch (Exception ex)
        {
            Log.D("PostSaveRAM", $"leitura real falhou: {ex.Message}");
        }

        // Idle ao vivo, não o teto: e o que o trim pós-save realmente deixou.
        long poolIdleMb = VideoPacketPool.IdleBytes / (1024L * 1024L);
        var (nativeMb, retainedMb) = EngineCoordinator.DeriveFootprint(procMb, gcManagedMb, 0, poolIdleMb);
        return new PostSaveMemorySample(
            secondsSinceSave, procMb, gcManagedMb, allocatedMb, nativeMb, retainedMb,
            lohMb, gen2Mb, committedMb, poolIdleMb, gcPauseMs);
    }
}
