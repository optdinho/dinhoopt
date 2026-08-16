using System.Runtime;
using DiNho.Capture.Poc.Memory;

namespace DiNho.Capture.Poc.Tests;

public sealed class WorkingSetTrimmerTests : IDisposable
{
    private readonly Action _originalCollect = WorkingSetTrimmer.CollectGen2Probe;
    private readonly Action _originalTrimWs = WorkingSetTrimmer.SetProcessWorkingSetSizeProbe;

    public WorkingSetTrimmerTests()
    {
        WorkingSetTrimmer.CollectGen2Probe = () => { };
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => { };
    }

    public void Dispose()
    {
        WorkingSetTrimmer.CollectGen2Probe = _originalCollect;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = _originalTrimWs;
    }

    [Fact]
    public void Trim_SetsCompactOnce_BeforeCollect()
    {
        // Coleta no-op injectada: o CompactOnce não é consumido e deve estar
        // visível após o Trim — prova que a compactação LOH é configurada.
        WorkingSetTrimmer.Trim();

        Assert.Equal(
            GCLargeObjectHeapCompactionMode.CompactOnce,
            GCSettings.LargeObjectHeapCompactionMode);
    }

    [Fact]
    public void Trim_ForcesGen2Collection()
    {
        var before = GC.CollectionCount(2);

        // Coleta real (probe de working set no-op, coleta padrão).
        WorkingSetTrimmer.CollectGen2Probe = _originalCollect;
        WorkingSetTrimmer.Trim();

        Assert.True(GC.CollectionCount(2) > before, "gen2 collection count must increase after Trim");
    }

    [Fact]
    public void Trim_CallsSetProcessWorkingSetSize()
    {
        var called = 0;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => called++;

        WorkingSetTrimmer.Trim();

        Assert.Equal(1, called);
    }

    [Fact]
    public void Trim_ProbeThrows_DoesNotPropagate()
    {
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => throw new InvalidOperationException("probe");

        var ex = Record.Exception(() => WorkingSetTrimmer.Trim());

        Assert.Null(ex);
    }
}
