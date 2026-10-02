using System.Diagnostics;
using System.Globalization;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Memory;

/// <summary>
/// Amostra de memória instantânea usada pelas linhas pós-save. Struct puro, sem
/// I/O e sem tocar no GC real — mesmo padrão de <c>FeedSummary</c>/<c>FeedLogLine</c>,
/// para que a formatação seja testável de forma determinística.
///
/// <para>
/// Só entram campos <b>crus</b> (<c>GC.GetTotalMemory</c>,
/// <c>GC.GetGCMemoryInfo</c>, <c>WorkingSet64</c>) ou subtrações puras entre eles.
/// <c>AllocTotalMb</c> é cumulativo desde o arranque — aparece para diagnóstico de
/// churn, nunca como prova de nada. <c>ManagedRetained</c> foi removido de propósito:
/// depende do ring do <c>ReplayBuffer</c> e da convenção de pool ocioso, que o
/// watcher estático não partilha com o <c>[RAM]</c> de captura — as duas linhas
/// discordavam (118MB vs 0MB no mesmo instante).
/// </para>
/// </summary>
public readonly record struct PostSaveMemorySample(
    double SecondsSinceSave,
    long ProcMb,
    long GcManagedMb,
    long AllocTotalMb,
    long NativeMb,
    long LohMb,
    long Gen2Mb,
    long CommittedMb,
    long PoolIdleMb,
    long GcPauseTotalMs);

/// <summary>
/// Resultado da comparação pico→final.
///
/// <para>
/// <b>Por que o gate é <c>proc</c> + <c>gcManaged</c>.</b> A versão anterior gateava
/// em <c>allocated</c>, lido de <c>GC.GetTotalAllocatedBytes()</c>: um contador
/// cumulativo do processo que só cresce. Como <c>Recovered</c> exigia uma queda
/// nele, o veredito era <b>matematicamente impossível</b> — em runtime real (2026-10-01)
/// imprimiu "NAO recuperou" para uma recuperação que tinha acontecido por completo
/// (<c>proc</c> 566→469MB, <c>gcManaged</c> 435→196MB). <c>proc</c> (working set) e
/// <c>gcManaged</c> (heap vivo) são níveis: sobem e descem, e é a queda deles que
/// significa RAM devolvida ao sistema.
/// </para>
///
/// <para>
/// <c>Committed</c> é reportado mas não gateia: a granularidade de commit do
/// Workstation GC é fina (no mesmo runtime caiu apenas 14MB, abaixo dos 32MB de
/// tolerância) e gatear por ele classificaria uma recuperação real como falha.
/// </para>
/// </summary>
public readonly record struct MemoryRecovery(
    bool ProcDropped,
    bool GcManagedDropped,
    long ProcDeltaMb,
    long GcManagedDeltaMb,
    long CommittedDeltaMb,
    long AllocTotalDeltaMb,
    bool Recovered)
{
    public static MemoryRecovery Between(PostSaveMemorySample peak, PostSaveMemorySample last, long toleranceMb)
    {
        var procDelta = peak.ProcMb - last.ProcMb;
        var managedDelta = peak.GcManagedMb - last.GcManagedMb;
        var procDropped = procDelta > toleranceMb;
        var managedDropped = managedDelta > toleranceMb;
        return new MemoryRecovery(
            procDropped,
            managedDropped,
            procDelta,
            managedDelta,
            peak.CommittedMb - last.CommittedMb,
            peak.AllocTotalMb - last.AllocTotalMb,
            procDropped && managedDropped);
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
/// acontece <b>depois</b>. Este watcher amostra durante 60 s e fecha com um veredito
/// explícito pico→final.
/// </para>
///
/// <para>
/// <b>Por que o pico vem do save.</b> A primeira versão tirava o baseline de dentro do
/// watcher, que só arranca <b>depois</b> de os packets serem liberados e do
/// <c>PostSaveTrim</c> — nesse ponto a recuperação já tinha acontecido e a janela só
/// via churn de captura. O pico é capturado pelo chamador em
/// <see cref="SnapshotPreRelease"/>, dentro do <c>finally</c> do save e
/// <b>antes</b> de qualquer <c>Release()</c>; sem ele o veredito não tem o que medir.
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

    /// <summary>Intervalo entre amostras (inclui a primeira em t=0).</summary>
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
    /// Captura o footprint <b>antes</b> de os packets do export serem liberados.
    ///
    /// <para>
    /// Tem de ser chamada dentro do <c>finally</c> do save, antes de
    /// <c>Release()</c>/<c>PostSaveTrim</c>. É este o número que o veredito compara
    /// com t+60s: o pico do export. Capturado depois do trim, não haveria queda
    /// nenhuma para medir.
    /// </para>
    ///
    /// <para>
    /// Fail-closed: devolve <c>default</c> (tudo zero) se a leitura falhar ou se a
    /// telemetria estiver desligada — nunca propaga exceção para o save.
    /// </para>
    /// </summary>
    public static PostSaveMemorySample SnapshotPreRelease()
    {
        if (!Enabled)
            return default;

        try
        {
            return CaptureProbe(0);
        }
        catch (Exception ex)
        {
            Log.D("PostSaveRAM", $"pico pre-release falhou: {ex.Message}");
            return default;
        }
    }

    /// <summary>
    /// Inicia (ou reinicia) a janela de observação. <paramref name="peak"/> vem de
    /// <see cref="SnapshotPreRelease"/>; se ausente, o watcher tira o seu próprio
    /// baseline (que só é útil quando o save ainda não liberou nada).
    /// </summary>
    public static void Start(PostSaveMemorySample? peak = null)
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
            _ = Task.Run(() => Watch(cts, peak), CancellationToken.None);
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

    private static void Watch(CancellationTokenSource cts, PostSaveMemorySample? peakOpt)
    {
        var ct = cts.Token;
        try
        {
            var samples = new List<PostSaveMemorySample>();
            PostSaveMemorySample? peak = null;
            if (peakOpt.HasValue)
            {
                peak = peakOpt.Value;
                Emit($"POST-SAVE pico (pre-release) {BuildSampleLine(peak.Value)}");
            }
            else
            {
                // Sem pico não há baseline, logo não há veredito possível. Ainda assim
                // a janela corre: as amostras por si só já descrevem a curva e um
                // silêncio total seria indistinguível de "o watcher morreu".
                Emit("POST-SAVE pico (pre-release) INDISPONIVEL - janela sem veredito");
            }

            // Cada amostra é emitida no momento em que é capturada. A versão anterior
            // acumulava o ciclo inteiro e despejava as 15 linhas de uma vez no fim —
            // no log de 2026-10-01 saíram todas com o mesmo timestamp.
            RunCycle(
                NowProbe,
                SleepProbe,
                CaptureProbe,
                sample =>
                {
                    samples.Add(sample);
                    Emit($"t+{sample.SecondsSinceSave:F0}s {BuildSampleLine(sample)}");
                },
                ct);

            if (samples.Count == 0)
                return;

            var first = samples[0];
            var last = samples[^1];
            if (peak.HasValue)
            {
                Emit(BuildVerdictLine(peak.Value, last, (peak.Value.ProcMb - first.ProcMb, peak.Value.GcManagedMb - first.GcManagedMb), samples.Count));
            }
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
    /// Motor da janela: primeira amostra em t=0 e depois uma a cada intervalo até
    /// fechar a duração. Clock e sleep injetados tornam isso determinístico em teste
    /// (zero espera real) sem perder a forma do loop de produção.
    /// <paramref name="onSample"/> é chamado assim que cada amostra existe, para que
    /// a linha entre no log no instante da medição e não no fim da janela.
    /// </summary>
    internal static List<PostSaveMemorySample> RunCycle(
        Func<DateTime> now,
        Action<TimeSpan> sleep,
        Func<double, PostSaveMemorySample> capture,
        Action<PostSaveMemorySample>? onSample = null,
        CancellationToken ct = default)
    {
        var start = now();
        var samples = new List<PostSaveMemorySample>();

        void Take(double seconds)
        {
            var sample = capture(seconds);
            samples.Add(sample);
            onSample?.Invoke(sample);
        }

        Take(0);
        for (var step = 1; step <= DurationSec / IntervalSec; step++)
        {
            ct.ThrowIfCancellationRequested();
            sleep(TimeSpan.FromSeconds(IntervalSec));
            Take((now() - start).TotalSeconds);
        }

        return samples;
    }

    /// <summary>
    /// Linha por amostra. Mesma gramática do <c>[RAM]</c> de captura e apenas campos
    /// crus, para que as duas linhas sejam comparáveis sem depender de convenções
    /// derivadas distintas.
    /// </summary>
    internal static string BuildSampleLine(PostSaveMemorySample s)
    {
        return string.Create(CultureInfo.InvariantCulture,
            $"proc={s.ProcMb}MB | gcManaged={s.GcManagedMb}MB | native={s.NativeMb}MB | " +
            $"loh={s.LohMb}MB | gen2={s.Gen2Mb}MB | committed={s.CommittedMb}MB | " +
            $"poolIdle={s.PoolIdleMb}MB | allocTotal={s.AllocTotalMb}MB | gcPause={s.GcPauseTotalMs}ms");
    }

    /// <summary>
    /// Linha de veredito: diz explicitamente se a memória voltou, em vez de deixar a
    /// leitura do log concluir o que o número quer dizer. Compara o pico do export
    /// (pre-release) com a amostra final, e isola o efeito do <c>PostSaveTrim</c> no
    /// intervalo pico→t+0s.
    /// </summary>
    internal static string BuildVerdictLine(
        PostSaveMemorySample peak,
        PostSaveMemorySample last,
        (long ProcMb, long GcManagedMb) peakReleaseDelta,
        int sampleCount)
    {
        var r = MemoryRecovery.Between(peak, last, RecoveryToleranceMb);
        var veredito = r.Recovered
            ? "RECUPEROU (proc e gcManaged caem acima da tolerancia)"
            : $"NAO recuperou (tolerancia {RecoveryToleranceMb}MB)";

        return string.Create(CultureInfo.InvariantCulture,
            $"POST-SAVE VEREDITO {veredito} em {last.SecondsSinceSave:F0}s sobre {sampleCount} amostras | " +
            $"proc {peak.ProcMb}MB -> {last.ProcMb}MB ({Signed(r.ProcDeltaMb)}MB) | " +
            $"gcManaged {peak.GcManagedMb}MB -> {last.GcManagedMb}MB ({Signed(r.GcManagedDeltaMb)}MB) | " +
            $"committed {peak.CommittedMb}MB -> {last.CommittedMb}MB ({Signed(r.CommittedDeltaMb)}MB, nao gate) | " +
            $"pico->t+0s proc {Signed(peakReleaseDelta.ProcMb)}MB | gcManaged {Signed(peakReleaseDelta.GcManagedMb)}MB | " +
            $"allocTotal {peak.AllocTotalMb}MB -> {last.AllocTotalMb}MB ({Signed(r.AllocTotalDeltaMb)}MB, cumulativo desde o arranque: nao gate)");
    }

    private static string Signed(long mb) => mb > 0 ? $"-{mb}" : $"+{-mb}";

    /// <summary>
    /// Leitura real. Reusa os helpers já testados do <c>[RAM]</c> de captura
    /// (<c>ReadGcDiagnostics</c>/<c>ReadGcBreakdown</c>/<c>DeriveFootprint</c>) em vez
    /// de duplicar a derivação de footprint.
    ///
    /// <para>
    /// <c>DeriveFootprint</c> é chamado só para o <c>native</c>, que é subtração pura
    /// dos dois valores medidos e por isso independe do ring/pool que o <c>[RAM]</c>
    /// lhe passa.
    /// </para>
    /// </summary>
    private static PostSaveMemorySample CaptureReal(double secondsSinceSave)
    {
        long procMb = 0, gcManagedMb = 0, allocTotalMb = 0;
        long lohMb = 0, gen2Mb = 0, committedMb = 0, gcPauseMs = 0;
        try
        {
            using var proc = Process.GetCurrentProcess();
            procMb = proc.WorkingSet64 / (1024L * 1024L);
            (gcManagedMb, allocTotalMb) = EngineCoordinator.ReadGcDiagnostics(
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
        var (nativeMb, _) = EngineCoordinator.DeriveFootprint(procMb, gcManagedMb, 0, 0);
        return new PostSaveMemorySample(
            secondsSinceSave, procMb, gcManagedMb, allocTotalMb, nativeMb,
            lohMb, gen2Mb, committedMb, poolIdleMb, gcPauseMs);
    }
}
