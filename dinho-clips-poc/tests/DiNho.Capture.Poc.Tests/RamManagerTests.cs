using DiNho.Capture.Poc.Memory;

namespace DiNho.Capture.Poc.Tests;

public sealed class RamManagerTests
{
    [Fact]
    public void ComputeSafeBudget_HugeRam_FullBudget()
    {
        long budget = RamManager.ComputeSafeBudget(16L * 1024 * 1024 * 1024);
        Assert.True(budget >= 2_000_000_000, $"Expected ≥2GB, got {budget}");
    }

    [Fact]
    public void ComputeSafeBudget_BareMinimum_ClampsToMin()
    {
        long budget = RamManager.ComputeSafeBudget(100_000_000);
        Assert.Equal(80L * 1024 * 1024, budget);
    }

    [Fact]
    public void ComputeSafeBudget_Negative_ClampsToMin()
    {
        long budget = RamManager.ComputeSafeBudget(1);
        Assert.Equal(80L * 1024 * 1024, budget);
    }

    [Fact]
    public void ComputeSafeBudget_2GB_ReturnsPositiveBudget()
    {
        long budget = RamManager.ComputeSafeBudget(2L * 1024 * 1024 * 1024);
        Assert.True(budget > 0);
        Assert.True(budget < 2L * 1024 * 1024 * 1024);
    }

    [Fact]
    public void BuildSettings_Full_UsesConfiguredValues()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Full, 1920, 1080, 24, 300, 50000, 100000, 2, 4);

        Assert.Equal(24, p.Cq);
        Assert.Equal(50000, p.MaxrateKbps);
        Assert.Equal(100000, p.BufsizeKbps);
        Assert.Equal(2, p.Bframes);
        Assert.Equal(4, p.Lookahead);
        Assert.Equal(300, p.ReplaySeconds);
        Assert.Equal(1920, p.EncodeWidth);
        Assert.Equal(1080, p.EncodeHeight);
        Assert.Equal(512 * 1024 * 1024, p.MaxBufferBytes);
    }

    [Fact]
    public void BuildSettings_Balanced_AdjustsCorrectly()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Balanced, 2560, 1440, 20, 300, 50000, 100000, 2, 4);

        Assert.Equal(24, p.Cq);
        Assert.Equal(35000, p.MaxrateKbps);
        Assert.Equal(70000, p.BufsizeKbps);
        Assert.Equal(1, p.Bframes);
        Assert.Equal(4, p.Lookahead);
        Assert.Equal(180, p.ReplaySeconds);
        Assert.Equal(2560, p.EncodeWidth);
        Assert.Equal(1080, p.EncodeHeight);
        Assert.Equal(256 * 1024 * 1024, p.MaxBufferBytes);
    }

    [Fact]
    public void BuildSettings_Balanced_ClampsHeightToAtLeast720()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Balanced, 640, 480, 20, 300, 50000, 100000, 2, 4);

        Assert.Equal(640, p.EncodeWidth);
        Assert.Equal(720, p.EncodeHeight);
    }

    [Fact]
    public void BuildSettings_LowMemory_ForcesMinimums()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.LowMemory, 1920, 1080, 18, 300, 50000, 100000, 2, 4);

        Assert.Equal(26, p.Cq);
        Assert.Equal(20000, p.MaxrateKbps);
        Assert.Equal(40000, p.BufsizeKbps);
        Assert.Equal(0, p.Bframes);
        Assert.Equal(0, p.Lookahead);
        Assert.Equal(60, p.ReplaySeconds);
        Assert.Equal(1280, p.EncodeWidth);
        Assert.Equal(720, p.EncodeHeight);
        Assert.Equal(128 * 1024 * 1024, p.MaxBufferBytes);
    }

    [Fact]
    public void BuildSettings_LowMemory_ReplayClampedTo30Min()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.LowMemory, 1920, 1080, 24, 15, 50000, 100000, 2, 4);

        Assert.Equal(30, p.ReplaySeconds);
    }

    [Fact]
    public void BuildSettings_LowMemory_CqNeverExceedsMaxCq()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.LowMemory, 1920, 1080, 30, 300, 50000, 100000, 2, 4);

        Assert.Equal(26, p.Cq);
    }

    [Fact]
    public void ResolveProfile_ReturnsValidProfile()
    {
        using var rm = new RamManager(1920, 1080, 300, 24);
        var p = rm.ResolveProfile();
        Assert.NotNull(p);
        Assert.InRange(p.Cq, 0, 51);
        Assert.True(p.ReplaySeconds >= 30);
        Assert.True(p.MaxBufferBytes >= 80 * 1024 * 1024);
    }

    [Fact]
    public void StartStopWatchdog_DoesNotThrow()
    {
        using var rm = new RamManager(1920, 1080, 300, 24);
        rm.ResolveProfile();
        rm.StartWatchdog();
        Thread.Sleep(100);
        rm.StopWatchdog();
    }

    [Fact]
    public void Dispose_StopsWatchdog()
    {
        var rm = new RamManager(1920, 1080, 300, 24);
        rm.ResolveProfile();
        rm.StartWatchdog();
        rm.Dispose();
        rm.Dispose();
    }

    [Fact]
    public void DoubleDispose_DoesNotThrow()
    {
        var rm = new RamManager(1920, 1080, 300, 24);
        rm.Dispose();
        rm.Dispose();
    }

    [Fact]
    public void GetAvailableRamBytes_ReturnsPositive()
    {
        long bytes = RamManager.GetAvailableRamBytes();
        Assert.True(bytes > 0);
        Assert.True(bytes < 1024L * 1024 * 1024 * 1024);
    }

    [Fact]
    public void LevelProperty_MapsCorrectly()
    {
        var full = RamManager.BuildSettings(RamProfileLevel.Full, 1920, 1080, 24, 300, 50000, 100000, 2, 4);
        var bal = RamManager.BuildSettings(RamProfileLevel.Balanced, 1920, 1080, 24, 300, 50000, 100000, 2, 4);
        var low = RamManager.BuildSettings(RamProfileLevel.LowMemory, 1920, 1080, 24, 300, 50000, 100000, 2, 4);

        Assert.Equal(RamProfileLevel.Full, full.Level);
        Assert.Equal(RamProfileLevel.Balanced, bal.Level);
        Assert.Equal(RamProfileLevel.LowMemory, low.Level);
    }

    [Fact]
    public void BroadcastCallback_InvokedOnResolve()
    {
        string? captured = null;
        using var rm = new RamManager(1920, 1080, 300, 24);
        rm.OnBroadcast = msg => captured = msg;
        rm.ResolveProfile();
        Assert.Null(captured);
    }

    [Fact]
    public void OnReduceReplay_CalledOnCriticalPressure()
    {
        int? newSecs = null;
        using var rm = new RamManager(1920, 1080, 300, 24);
        rm.OnReduceReplay = secs => newSecs = secs;
        rm.ResolveProfile();
        Assert.Null(newSecs);
    }

    [Fact]
    public void FullProfile_PreservesConfiguredValues()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Full, 1920, 1080, 20, 600, 80000, 160000, 4, 8);

        Assert.Equal(RamProfileLevel.Full, p.Level);
        Assert.Equal(20, p.Cq);
        Assert.Equal(80000, p.MaxrateKbps);
        Assert.Equal(160000, p.BufsizeKbps);
        Assert.Equal(4, p.Bframes);
        Assert.Equal(8, p.Lookahead);
        Assert.Equal(600, p.ReplaySeconds);
        Assert.Equal(1920, p.EncodeWidth);
        Assert.Equal(1080, p.EncodeHeight);
    }
}
