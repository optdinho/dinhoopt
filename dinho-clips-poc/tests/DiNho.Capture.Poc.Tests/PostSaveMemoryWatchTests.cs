using DiNho.Capture.Poc.Memory;
using Xunit;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Telemetria de recuperação pós-save. O objetivo não é só produzir linhas: é
/// distinguir "a RAM voltou" de "a RAM parece que voltou", comparando o pico do
/// export com a amostra final.
///
/// <para>
/// <b>Contrato corrigido em 2026-10-01.</b> A versão anterior gateava o veredito em
/// <c>allocated</c>, lido de <c>GC.GetTotalAllocatedBytes()</c> — um contador
/// cumulativo do processo que NUNCA desce, logo <c>Recovered</c> era
/// matemáticamente impossível. O gate é agora <c>proc</c> (working set) e
/// <c>gcManaged</c> (heap managed vivo): ambos caem de facto quando o trim
/// funciona. <c>allocTotal</c> e <c>committed</c> são reportados, nunca gateados.
/// </para>
///
/// <para>
/// <b>Baseline no pico.</b> A amostra inicial também vinha depois de os packets
/// serem liberados e do <c>PostSaveTrim</c>, quando a recuperação já tinha
/// acontecido — a janela só conseguia observar churn. O pico agora é capturado no
/// <c>finally</c> <b>antes</b> de qualquer <c>Release()</c>.
/// </para>
///
/// <para>
/// Coleção não-paralela: as probes são <c>static</c> (mesmo padrão de
/// <c>WorkingSetTrimmer</c>), e outra classe da suíte desliga o watch ao exercitar
/// <c>SaveClipAsync</c>. Executar em paralelo tornaria isso uma corrida.
/// </para>
/// </summary>
[Collection("PostSaveMemoryWatch")]
public sealed class PostSaveMemoryWatchTests : IDisposable
{
    private readonly bool _originalEnabled = PostSaveMemoryWatch.Enabled;
    private readonly Func<DateTime> _originalNow = PostSaveMemoryWatch.NowProbe;
    private readonly Action<TimeSpan> _originalSleep = PostSaveMemoryWatch.SleepProbe;
    private readonly Func<double, PostSaveMemorySample> _originalCapture = PostSaveMemoryWatch.CaptureProbe;
    private readonly Action<string> _originalLine = PostSaveMemoryWatch.LineProbe;

    public PostSaveMemoryWatchTests() => PostSaveMemoryWatch.ResetForTest();

    public void Dispose()
    {
        PostSaveMemoryWatch.ResetForTest();
        PostSaveMemoryWatch.Enabled = _originalEnabled;
        PostSaveMemoryWatch.NowProbe = _originalNow;
        PostSaveMemoryWatch.SleepProbe = _originalSleep;
        PostSaveMemoryWatch.CaptureProbe = _originalCapture;
        PostSaveMemoryWatch.LineProbe = _originalLine;
    }

    private static PostSaveMemorySample Sample(
        double seconds,
        long proc = 600,
        long gcManaged = 500,
        long allocTotal = 1150,
        long committed = 1300,
        long native = 100,
        long loh = 267,
        long gen2 = 174,
        long poolIdle = 64) =>
        new(
            SecondsSinceSave: seconds,
            ProcMb: proc,
            GcManagedMb: gcManaged,
            AllocTotalMb: allocTotal,
            NativeMb: native,
            LohMb: loh,
            Gen2Mb: gen2,
            CommittedMb: committed,
            PoolIdleMb: poolIdle,
            GcPauseTotalMs: 120);

    /// <summary>
    /// Clock falso com estado compartilhado: <c>sleep</c> avança o mesmo instante que
    /// <c>Now</c> devolve. Precisa ser uma classe — desestruturar um
    /// <c>(DateTime, Action)</c> copiaria o <c>DateTime</c> por valor e o relógio
    /// nunca andaria.
    /// </summary>
    private sealed class FakeClock
    {
        private DateTime _t = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

        public DateTime Now() => _t;

        public void Sleep(TimeSpan d) => _t = _t.Add(d);
    }

    #region MemoryRecovery — gates em proc + gcManaged

    [Fact]
    public void Between_ProcAndManagedDropped_IsRecovered()
    {
        // Reproduz o runtime real de 2026-10-01: pico 566/435 -> final 469/196.
        var r = MemoryRecovery.Between(
            Sample(0, proc: 566, gcManaged: 435, committed: 362, allocTotal: 867),
            Sample(60, proc: 469, gcManaged: 196, committed: 348, allocTotal: 1039),
            32);

        Assert.True(r.ProcDropped);
        Assert.True(r.GcManagedDropped);
        Assert.True(r.Recovered);
        Assert.Equal(97, r.ProcDeltaMb);
        Assert.Equal(239, r.GcManagedDeltaMb);
    }

    [Fact]
    public void Between_UnchangedMemory_IsNotRecovered()
    {
        var r = MemoryRecovery.Between(Sample(0), Sample(60), 32);

        Assert.False(r.ProcDropped);
        Assert.False(r.GcManagedDropped);
        Assert.False(r.Recovered);
        Assert.Equal(0, r.ProcDeltaMb);
    }

    [Fact]
    public void Between_CumulativeAllocTotalGrowth_DoesNotBlockRecovery()
    {
        // Regressão do bug de 2026-10-01: allocTotal é cumulativo e cresce sempre
        // (~2,4 MB/s com WGC+NVENC ativos). Ele não pode validar nem invalidar o
        // veredito — por isso deixou de ser um gate.
        var r = MemoryRecovery.Between(
            Sample(0, proc: 566, gcManaged: 435, allocTotal: 867),
            Sample(60, proc: 469, gcManaged: 196, allocTotal: 1039),
            32);

        Assert.Equal(-172, r.AllocTotalDeltaMb);
        Assert.True(r.Recovered);
    }

    [Fact]
    public void Between_CumulativeAllocTotalDrop_AloneDoesNotProveRecovery()
    {
        // O espelho: mesmo que allocTotal descesse (impossível na vida real), sem
        // queda de proc/gcManaged continua a não ser prova de nada.
        var r = MemoryRecovery.Between(
            Sample(0, proc: 566, gcManaged: 435, allocTotal: 1150),
            Sample(60, proc: 560, gcManaged: 430, allocTotal: 300),
            32);

        Assert.Equal(850, r.AllocTotalDeltaMb);
        Assert.False(r.ProcDropped);
        Assert.False(r.GcManagedDropped);
        Assert.False(r.Recovered);
    }

    [Fact]
    public void Between_Growth_IsNegativeDeltaAndNotRecovered()
    {
        var r = MemoryRecovery.Between(Sample(0, proc: 300, gcManaged: 300), Sample(60, proc: 900, gcManaged: 900), 32);

        Assert.False(r.Recovered);
        Assert.Equal(-600, r.ProcDeltaMb);
        Assert.Equal(-600, r.GcManagedDeltaMb);
    }

    [Fact]
    public void Between_DropWithinTolerance_IsNotRecovered()
    {
        // Queda real mas pequena: ruído de captura ativa não conta como "voltou".
        var r = MemoryRecovery.Between(Sample(0, proc: 300, gcManaged: 300), Sample(60, proc: 280, gcManaged: 290), 32);

        Assert.False(r.ProcDropped);
        Assert.False(r.Recovered);
    }

    [Fact]
    public void Between_ProcDroppedButManagedHeld_IsNotRecovered()
    {
        // Só uma das duas dimensões caiu: o heap managed preso impede a conclusão.
        var r = MemoryRecovery.Between(
            Sample(0, proc: 566, gcManaged: 435),
            Sample(60, proc: 469, gcManaged: 430),
            32);

        Assert.True(r.ProcDropped);
        Assert.False(r.GcManagedDropped);
        Assert.False(r.Recovered);
    }

    [Fact]
    public void Between_CommittedIsReportedButNeverGates()
    {
        // No runtime o committed caiu só 14MB (< tolerância de 32MB) porque a
        // granularidade de commit do Workstation GC é fina. Gatear por ele daria
        // "NAO recuperou" para uma recuperação real e completa.
        var r = MemoryRecovery.Between(
            Sample(0, proc: 566, gcManaged: 435, committed: 362),
            Sample(60, proc: 469, gcManaged: 196, committed: 348),
            32);

        Assert.Equal(14, r.CommittedDeltaMb);
        Assert.True(r.Recovered);
    }

    #endregion

    #region RunCycle

    [Fact]
    public void RunCycle_CoversSixtySecondsWithBaselineAndIntervals()
    {
        var clock = new FakeClock();

        var samples = PostSaveMemoryWatch.RunCycle(clock.Now, clock.Sleep, s => Sample(s));

        // baseline + 60/5 = 13 amostras.
        Assert.Equal(13, samples.Count);
        Assert.Equal(0, samples[0].SecondsSinceSave);
        Assert.Equal(60, samples[^1].SecondsSinceSave);
        Assert.Equal(5, samples[1].SecondsSinceSave);
    }

    [Fact]
    public void RunCycle_NeverWaitsInRealTime()
    {
        var clock = new FakeClock();
        var realSleeps = 0;

        PostSaveMemoryWatch.RunCycle(
            clock.Now,
            d => { realSleeps++; clock.Sleep(d); },
            s => Sample(s));

        // 12 esperas de 5s = 60s de janela, mas o relógio real não andou nada.
        Assert.Equal(12, realSleeps);
    }

    [Fact]
    public void RunCycle_Cancelled_ThrowsImmediately()
    {
        var clock = new FakeClock();
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        Assert.Throws<OperationCanceledException>(() =>
            PostSaveMemoryWatch.RunCycle(clock.Now, clock.Sleep, s => Sample(s), onSample: null, ct: cts.Token));
    }

    [Fact]
    public void RunCycle_EmitsEachSampleAsItIsCaptured()
    {
        // Regressão de 2026-10-01: o ciclo completo era acumulado e as 15 linhas
        // saíam de uma vez no fim (todas com o mesmo timestamp no log).
        var clock = new FakeClock();
        var order = new List<string>();

        PostSaveMemoryWatch.RunCycle(
            clock.Now,
            clock.Sleep,
            seconds => { order.Add($"cap{seconds:F0}"); return Sample(seconds); },
            sample => order.Add($"emit{sample.SecondsSinceSave:F0}"));

        Assert.Equal("cap0", order[0]);
        Assert.Equal("emit0", order[1]);
        Assert.Equal("cap5", order[2]);
    }

    [Fact]
    public void RunCycle_NullObserverIsAllowed()
    {
        var clock = new FakeClock();

        var samples = PostSaveMemoryWatch.RunCycle(clock.Now, clock.Sleep, s => Sample(s), onSample: null);

        Assert.Equal(13, samples.Count);
    }

    [Fact]
    public void RunCycle_ExposesRecoveryTrendAcrossWindow()
    {
        // Memória caindo ao longo da janela: as amostras devem contar a história.
        var clock = new FakeClock();
        var samples = PostSaveMemoryWatch.RunCycle(
            clock.Now,
            clock.Sleep,
            s => Sample(s, proc: (long)(1150 - s * 10), gcManaged: (long)(900 - s * 11)));

        Assert.True(samples[0].ProcMb > samples[^1].ProcMb);
        Assert.True(MemoryRecovery.Between(samples[0], samples[^1], 32).Recovered);
    }

    #endregion

    #region BuildVerdictLine

    [Fact]
    public void VerdictLine_SaysRecoveredWithGatedDeltas()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(
            Sample(0, proc: 566, gcManaged: 435, committed: 362, allocTotal: 867),
            Sample(60, proc: 469, gcManaged: 196, committed: 348, allocTotal: 1039),
            peakReleaseDelta: (100, 265),
            sampleCount: 13);

        Assert.Contains("RECUPEROU", line, StringComparison.Ordinal);
        Assert.Contains("proc 566MB -> 469MB (-97MB)", line, StringComparison.Ordinal);
        Assert.Contains("gcManaged 435MB -> 196MB (-239MB)", line, StringComparison.Ordinal);
        Assert.Contains("committed 362MB -> 348MB (-14MB, nao gate)", line, StringComparison.Ordinal);
        Assert.Contains("t+0s", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_SaysNotRecoveredWhenMemoryStaysHigh()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(Sample(0), Sample(60), (0, 0), sampleCount: 13);

        Assert.Contains("NAO recuperou", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_ShowsGrowthAsPlus()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(
            Sample(0, proc: 300, gcManaged: 300, committed: 400, allocTotal: 300),
            Sample(60, proc: 900, gcManaged: 900, committed: 1000, allocTotal: 900),
            peakReleaseDelta: (0, 0),
            sampleCount: 13);

        Assert.Contains("(+600MB)", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_MentionsTolerance()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(Sample(0), Sample(60), (0, 0), sampleCount: 13);

        Assert.Contains($"tolerancia {PostSaveMemoryWatch.RecoveryToleranceMb}MB", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_LabelsAllocTotalAsCumulative()
    {
        // allocTotal entra no log para diagnóstico de churn, mas a linha tem de dizer
        // que é cumulativo — foi exatamente a ambiguidade que gerou o veredito errado.
        var line = PostSaveMemoryWatch.BuildVerdictLine(
            Sample(0, allocTotal: 867),
            Sample(60, allocTotal: 1039),
            (0, 0),
            sampleCount: 13);

        Assert.Contains("allocTotal 867MB -> 1039MB", line, StringComparison.Ordinal);
        Assert.Contains("cumulativo", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_ReportsPeakToFirstSampleReleaseEffect()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(
            Sample(0, proc: 566, gcManaged: 435),
            Sample(60, proc: 469, gcManaged: 196),
            peakReleaseDelta: (100, 265),
            sampleCount: 13);

        // O trim pós-save é o que produziu esta queda: tem de ficar visível.
        Assert.Contains("pico->t+0s proc -100MB | gcManaged -265MB", line, StringComparison.Ordinal);
    }

    #endregion

    #region BuildSampleLine

    [Fact]
    public void SampleLine_CarriesRecoveryRelevantFields()
    {
        var line = PostSaveMemoryWatch.BuildSampleLine(Sample(30, proc: 690, gcManaged: 500, committed: 1300));

        Assert.Contains("proc=690MB", line, StringComparison.Ordinal);
        Assert.Contains("gcManaged=500MB", line, StringComparison.Ordinal);
        Assert.Contains("committed=1300MB", line, StringComparison.Ordinal);
        Assert.Contains("loh=267MB", line, StringComparison.Ordinal);
        Assert.Contains("gen2=174MB", line, StringComparison.Ordinal);
        Assert.Contains("poolIdle=64MB", line, StringComparison.Ordinal);
        Assert.Contains("allocTotal=1150MB", line, StringComparison.Ordinal);
    }

    [Fact]
    public void SampleLine_HasNoManagedRetained()
    {
        // managedRetained exigia ringBytes do ReplayBuffer, que o watcher estático não
        // tem: a linha dizia 118MB enquanto o [RAM] concorrente dizia 0MB. Fields
        // crus (gcManaged/loh/gen2) são comparáveis; a derivação não era.
        var line = PostSaveMemoryWatch.BuildSampleLine(Sample(30));

        Assert.DoesNotContain("managedRetained", line, StringComparison.Ordinal);
    }

    #endregion

    #region Start / Stop

    [Fact]
    public void SnapshotPreRelease_WhenDisabled_ReturnsDefault()
    {
        PostSaveMemoryWatch.Enabled = false;
        PostSaveMemoryWatch.CaptureProbe = _ => throw new InvalidOperationException("nao deveria ler");

        var snap = PostSaveMemoryWatch.SnapshotPreRelease();

        Assert.Equal(0, snap.ProcMb);
    }

    [Fact]
    public void SnapshotPreRelease_WhenEnabled_CapturesThroughProbe()
    {
        PostSaveMemoryWatch.CaptureProbe = s => Sample(s, proc: 566, gcManaged: 435);

        var snap = PostSaveMemoryWatch.SnapshotPreRelease();

        Assert.Equal(566, snap.ProcMb);
        Assert.Equal(435, snap.GcManagedMb);
    }

    [Fact]
    public void Start_WhenDisabled_DoesNothing()
    {
        PostSaveMemoryWatch.Enabled = false;
        var started = 0;
        PostSaveMemoryWatch.CaptureProbe = s => { started++; return Sample(s); };

        PostSaveMemoryWatch.Start(Sample(0, proc: 566));

        Assert.Equal(0, started);
    }

    [Fact]
    public async Task Start_WhenEnabled_EmitsPeakSamplesAndVerdict()
    {
        var clock = new FakeClock();
        PostSaveMemoryWatch.NowProbe = clock.Now;
        PostSaveMemoryWatch.SleepProbe = clock.Sleep;

        var lines = new List<string>();
        var gate = new TaskCompletionSource();
        PostSaveMemoryWatch.LineProbe = line =>
        {
            lock (lines) lines.Add(line);
            if (line.Contains("VEREDITO", StringComparison.Ordinal))
                gate.TrySetResult();
        };
        PostSaveMemoryWatch.CaptureProbe = s => Sample(s);

        PostSaveMemoryWatch.Start(Sample(0, proc: 566, gcManaged: 435, allocTotal: 867));

        var done = await Task.WhenAny(gate.Task, Task.Delay(TimeSpan.FromSeconds(20)));
        Assert.Same(gate.Task, done);

        lock (lines)
        {
            Assert.Contains(lines, l => l.StartsWith("POST-SAVE pico", StringComparison.Ordinal));
            Assert.Contains(lines, l => l.StartsWith("t+0s ", StringComparison.Ordinal));
            Assert.Contains(lines, l => l.StartsWith("t+60s ", StringComparison.Ordinal));
            Assert.Contains(lines, l => l.Contains("POST-SAVE VEREDITO", StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task Start_WhenEnabled_WindowCompletesWithoutRealWaiting()
    {
        // Relógio instantâneo: prova que o loop inteiro (13 amostras) roda em ms.
        var clock = new FakeClock();
        PostSaveMemoryWatch.NowProbe = clock.Now;
        PostSaveMemoryWatch.SleepProbe = clock.Sleep;

        var gate = new TaskCompletionSource();
        var emitted = 0;
        PostSaveMemoryWatch.LineProbe = line =>
        {
            if (Interlocked.Increment(ref emitted) >= 15)
                gate.TrySetResult();
        };

        var sw = System.Diagnostics.Stopwatch.StartNew();
        PostSaveMemoryWatch.Start(Sample(0, proc: 566, gcManaged: 435));
        var done = await Task.WhenAny(gate.Task, Task.Delay(TimeSpan.FromSeconds(20)));
        sw.Stop();

        Assert.Same(gate.Task, done);
        Assert.True(sw.ElapsedMilliseconds < 5000, $"levou {sw.ElapsedMilliseconds}ms — esperou tempo real");
    }

    [Fact]
    public async Task Stop_CutsWindowShort()
    {
        // Sleep de 20ms por passo: a janela completa levaria ~240ms. Cortar no meio
        // deve deixá-la incompleta (nenhum veredito), com folga de tempo suficiente
        // para não depender do agendador.
        PostSaveMemoryWatch.NowProbe = () => DateTime.UtcNow;
        PostSaveMemoryWatch.SleepProbe = _ => Thread.Sleep(20);

        var sleeps = 0;
        var verdicts = 0;
        PostSaveMemoryWatch.CaptureProbe = s =>
        {
            Interlocked.Increment(ref sleeps);
            return Sample(s);
        };
        PostSaveMemoryWatch.LineProbe = line =>
        {
            if (line.Contains("VEREDITO", StringComparison.Ordinal))
                Interlocked.Increment(ref verdicts);
        };

        PostSaveMemoryWatch.Start(Sample(0, proc: 566));
        await Task.Delay(50);
        PostSaveMemoryWatch.Stop();
        await Task.Delay(400);

        Assert.Equal(0, Volatile.Read(ref verdicts));
        Assert.True(Volatile.Read(ref sleeps) < 13, $"o loop continuou apos Stop: {sleeps} passos");
    }

    [Fact]
    public async Task Start_AfterStop_OpensFreshWindow()
    {
        var clock = new FakeClock();
        PostSaveMemoryWatch.NowProbe = clock.Now;
        PostSaveMemoryWatch.SleepProbe = clock.Sleep;

        var gate = new TaskCompletionSource();
        PostSaveMemoryWatch.LineProbe = line =>
        {
            if (line.Contains("VEREDITO", StringComparison.Ordinal))
                gate.TrySetResult();
        };

        PostSaveMemoryWatch.Start(Sample(0, proc: 566));
        PostSaveMemoryWatch.Stop();
        PostSaveMemoryWatch.Start(Sample(0, proc: 566));

        var done = await Task.WhenAny(gate.Task, Task.Delay(TimeSpan.FromSeconds(20)));
        Assert.Same(gate.Task, done);
    }

    [Fact]
    public void Stop_IsIdempotent()
    {
        PostSaveMemoryWatch.Stop();
        PostSaveMemoryWatch.Stop();

        Assert.True(true);
    }

    [Fact]
    public async Task Start_WhenCaptureThrows_DoesNotPropagate()
    {
        PostSaveMemoryWatch.LineProbe = _ => throw new InvalidOperationException("log caiu");
        PostSaveMemoryWatch.CaptureProbe = s => throw new InvalidOperationException("GC caiu");

        PostSaveMemoryWatch.Start(Sample(0, proc: 566));

        // Fail-closed: o chamador do save não pode ver exceção vindo da telemetria.
        Assert.True(true);
    }

    [Fact]
    public async Task Start_WithoutPeak_StillSamplesAndDeclaresNoVerdict()
    {
        // Sem pico não há baseline — mas a janela ainda corre e diz isso, em vez de
        // falhar em silêncio (indistinguível de "o watcher morreu").
        var clock = new FakeClock();
        PostSaveMemoryWatch.NowProbe = clock.Now;
        PostSaveMemoryWatch.SleepProbe = clock.Sleep;
        PostSaveMemoryWatch.CaptureProbe = s => Sample(s);

        var lines = new List<string>();
        var gate = new TaskCompletionSource();
        PostSaveMemoryWatch.LineProbe = line =>
        {
            lock (lines) lines.Add(line);
            if (line.Contains("t+60s ", StringComparison.Ordinal))
                gate.TrySetResult();
        };

        PostSaveMemoryWatch.Start();

        var done = await Task.WhenAny(gate.Task, Task.Delay(TimeSpan.FromSeconds(20)));
        Assert.Same(gate.Task, done);

        lock (lines)
        {
            Assert.Contains(lines, l => l.Contains("INDISPONIVEL", StringComparison.Ordinal));
            Assert.Contains(lines, l => l.StartsWith("t+60s ", StringComparison.Ordinal));
            Assert.DoesNotContain(lines, l => l.Contains("POST-SAVE VEREDITO", StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task SnapshotPreRelease_WhenCaptureThrows_DoesNotPropagate()
    {
        // SnapshotPreRelease é chamado no finally do save: uma falha de leitura ali
        // não pode derrubar o pipeline nem o export.
        PostSaveMemoryWatch.CaptureProbe = _ => throw new InvalidOperationException("GC caiu no pico");

        var snap = PostSaveMemoryWatch.SnapshotPreRelease();

        Assert.Equal(0, snap.ProcMb);
        Assert.Equal(0, snap.GcManagedMb);
    }

    #endregion

    #region Constants

    [Fact]
    public void WatchWindow_IsSixtySecondsAtFiveSecondInterval()
    {
        Assert.Equal(60, PostSaveMemoryWatch.DurationSec);
        Assert.Equal(5, PostSaveMemoryWatch.IntervalSec);
        Assert.Equal(13, 1 + PostSaveMemoryWatch.DurationSec / PostSaveMemoryWatch.IntervalSec);
    }

    #endregion
}

