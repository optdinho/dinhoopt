using DiNho.Capture.Poc.Memory;
using Xunit;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Telemetria de recuperação pós-save. O objetivo não é só produzir linhas: é
/// distinguir "a RAM voltou" de "a RAM parece que voltou", comparando baseline e
/// amostra final em <c>allocated</c> e <c>committed</c> — que era exatamente a
/// suposição que o log antigo deixava em aberto.
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
        double seconds, long proc = 600, long allocated = 1150, long committed = 1300) =>
        new(
            seconds,
            ProcMb: proc,
            GcManagedMb: 500,
            AllocatedMb: allocated,
            NativeMb: 100,
            ManagedRetainedMb: 400,
            LohMb: 267,
            Gen2Mb: 174,
            CommittedMb: committed,
            PoolIdleMb: 64,
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

    #region MemoryRecovery

    [Fact]
    public void Between_ClearedMemory_IsRecovered()
    {
        var r = MemoryRecovery.Between(Sample(0, allocated: 1150, committed: 1300), Sample(60, allocated: 300, committed: 400), 32);

        Assert.True(r.AllocatedDropped);
        Assert.True(r.CommittedDropped);
        Assert.True(r.Recovered);
        Assert.Equal(850, r.AllocatedDeltaMb);
        Assert.Equal(900, r.CommittedDeltaMb);
    }

    [Fact]
    public void Between_UnchangedMemory_IsNotRecovered()
    {
        var r = MemoryRecovery.Between(Sample(0), Sample(60), 32);

        Assert.False(r.AllocatedDropped);
        Assert.False(r.CommittedDropped);
        Assert.False(r.Recovered);
        Assert.Equal(0, r.AllocatedDeltaMb);
    }

    [Fact]
    public void Between_Growth_IsNegativeDeltaAndNotRecovered()
    {
        var r = MemoryRecovery.Between(Sample(0, allocated: 300), Sample(60, allocated: 900), 32);

        Assert.False(r.Recovered);
        Assert.Equal(-600, r.AllocatedDeltaMb);
    }

    [Fact]
    public void Between_DropWithinTolerance_IsNotRecovered()
    {
        // Queda real mas pequena: ruído de captura ativa não conta como "voltou".
        var r = MemoryRecovery.Between(Sample(0, allocated: 300), Sample(60, allocated: 280), 32);

        Assert.False(r.AllocatedDropped);
        Assert.False(r.Recovered);
    }

    [Fact]
    public void Between_AllocatedOnlyDropped_IsNotRecovered()
    {
        // Só uma das duas dimensões caiu: committed preso impede a conclusão.
        var r = MemoryRecovery.Between(Sample(0, allocated: 1150, committed: 1300), Sample(60, allocated: 300, committed: 1290), 32);

        Assert.True(r.AllocatedDropped);
        Assert.False(r.CommittedDropped);
        Assert.False(r.Recovered);
    }

    [Fact]
    public void Between_ProcDeltaIsAlsoReported()
    {
        var r = MemoryRecovery.Between(Sample(0, proc: 690), Sample(60, proc: 610), 32);

        Assert.Equal(80, r.ProcDeltaMb);
    }

    #endregion

    #region RunCycle

    [Fact]
    public void RunCycle_CoversSixtySecondsWithBaselineAndIntervals()
    {
        var clock = new FakeClock();

        var samples = PostSaveMemoryWatch.RunCycle(
            clock.Now, clock.Sleep, s => Sample(s));

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
            PostSaveMemoryWatch.RunCycle(clock.Now, clock.Sleep, s => Sample(s), cts.Token));
    }

    [Fact]
    public void RunCycle_ExposesRecoveryTrendAcrossWindow()
    {
        // Memória caindo ao longo da janela: as amostras devem contar a história.
        var clock = new FakeClock();
        var samples = PostSaveMemoryWatch.RunCycle(
            clock.Now, clock.Sleep, s => Sample(s, allocated: (long)(1150 - s * 10), committed: (long)(1300 - s * 11)));

        Assert.True(samples[0].AllocatedMb > samples[^1].AllocatedMb);
        Assert.True(MemoryRecovery.Between(samples[0], samples[^1], 32).Recovered);
    }

    #endregion

    #region BuildVerdictLine

    [Fact]
    public void VerdictLine_SaysRecoveredWithBothDeltas()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(
            Sample(0, allocated: 1150, committed: 1300, proc: 690),
            Sample(60, allocated: 300, committed: 400, proc: 610),
            sampleCount: 13);

        Assert.Contains("RECUPEROU", line, StringComparison.Ordinal);
        Assert.Contains("allocated 1150MB -> 300MB (-850MB)", line, StringComparison.Ordinal);
        Assert.Contains("committed 1300MB -> 400MB (-900MB)", line, StringComparison.Ordinal);
        Assert.Contains("proc 690MB -> 610MB (-80MB)", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_SaysNotRecoveredWhenMemoryStaysHigh()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(Sample(0), Sample(60), sampleCount: 13);

        Assert.Contains("NAO recuperou", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_ShowsGrowthAsPlus()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(
            Sample(0, allocated: 300, committed: 400),
            Sample(60, allocated: 900, committed: 1000),
            sampleCount: 13);

        Assert.Contains("(+600MB)", line, StringComparison.Ordinal);
    }

    [Fact]
    public void VerdictLine_MentionsTolerance()
    {
        var line = PostSaveMemoryWatch.BuildVerdictLine(Sample(0), Sample(60), sampleCount: 13);

        Assert.Contains($"tolerancia {PostSaveMemoryWatch.RecoveryToleranceMb}MB", line, StringComparison.Ordinal);
    }

    #endregion

    #region BuildSampleLine

    [Fact]
    public void SampleLine_CarriesRecoveryRelevantFields()
    {
        var line = PostSaveMemoryWatch.BuildSampleLine(Sample(30, allocated: 1150, committed: 1300, proc: 690));

        Assert.Contains("allocated=1150MB", line, StringComparison.Ordinal);
        Assert.Contains("committed=1300MB", line, StringComparison.Ordinal);
        Assert.Contains("proc=690MB", line, StringComparison.Ordinal);
        Assert.Contains("loh=267MB", line, StringComparison.Ordinal);
        Assert.Contains("gen2=174MB", line, StringComparison.Ordinal);
        Assert.Contains("poolIdle=64MB", line, StringComparison.Ordinal);
    }

    #endregion

    #region Start / Stop

    [Fact]
    public void Start_WhenDisabled_DoesNothing()
    {
        PostSaveMemoryWatch.Enabled = false;
        var started = 0;
        PostSaveMemoryWatch.CaptureProbe = s => { started++; return Sample(s); };

        PostSaveMemoryWatch.Start();

        Assert.Equal(0, started);
    }

    [Fact]
    public async Task Start_WhenEnabled_EmitsSamplesAndVerdict()
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

        PostSaveMemoryWatch.Start();

        var done = await Task.WhenAny(gate.Task, Task.Delay(TimeSpan.FromSeconds(20)));
        Assert.Same(gate.Task, done);

        lock (lines)
        {
            Assert.Contains(lines, l => l.StartsWith("POST-SAVE baseline", StringComparison.Ordinal));
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
            if (Interlocked.Increment(ref emitted) >= 13)
                gate.TrySetResult();
        };

        var sw = System.Diagnostics.Stopwatch.StartNew();
        PostSaveMemoryWatch.Start();
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

        PostSaveMemoryWatch.Start();
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

        PostSaveMemoryWatch.Start();
        PostSaveMemoryWatch.Stop();
        PostSaveMemoryWatch.Start();

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
    public void Start_WhenCaptureThrows_DoesNotPropagate()
    {
        PostSaveMemoryWatch.LineProbe = _ => throw new InvalidOperationException("log caiu");
        PostSaveMemoryWatch.CaptureProbe = s => throw new InvalidOperationException("GC caiu");

        PostSaveMemoryWatch.Start();

        // Falha-closed: o chamador do save não pode ver exceção vindo da telemetria.
        Assert.True(true);
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
