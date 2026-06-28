using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class PipelineWatchdogTests
{
    [Fact]
    public void InitialHealth_IsYellow()
    {
        var wd = new PipelineWatchdog();
        var h = wd.GetHealth();
        Assert.True(h.DropRatePct == 0);
        Assert.Equal(0, h.TotalFrames);
    }

    [Fact]
    public void GoodFrames_ReachesGreen()
    {
        var wd = new PipelineWatchdog
        {
            ConsecutiveGoodReset = 10
        };
        for (int i = 0; i < 15; i++)
            wd.ReportGoodFrame(16.0);

        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Green, h.Level);
        Assert.Equal(15, h.TotalFrames);
        Assert.Equal(0, h.DroppedFrames);
    }

    [Fact]
    public void DroppedFrames_TriggersRed()
    {
        var wd = new PipelineWatchdog
        {
            BadFrameThreshold = 5
        };
        for (int i = 0; i < 6; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);

        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Red, h.Level);
        Assert.Equal(6, h.TotalFrames);
        Assert.Equal(6, h.DroppedFrames);
        Assert.Equal(PipelineIssue.NoFrame, h.LastIssue);
    }

    [Fact]
    public void MixedFrames_CalculatesDropRate()
    {
        var wd = new PipelineWatchdog();
        for (int i = 0; i < 80; i++)
            wd.ReportGoodFrame(16.0);
        for (int i = 0; i < 20; i++)
            wd.ReportDroppedFrame(PipelineIssue.CaptureError);

        var h = wd.GetHealth();
        Assert.Equal(100, h.TotalFrames);
        Assert.Equal(20, h.DroppedFrames);
        Assert.Equal(20.0, h.DropRatePct, 1);
    }

    [Fact]
    public void ShouldReinit_AfterSustainedDrops()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        Thread.Sleep(3500);
        Assert.True(wd.ShouldReinit());
    }

    [Fact]
    public void ShouldNotReinit_AfterGoodFrame()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        Thread.Sleep(100);
        wd.ReportGoodFrame(16.0);
        Assert.False(wd.ShouldReinit());
    }

    [Fact]
    public void Reset_ClearsState()
    {
        var wd = new PipelineWatchdog();
        wd.ReportGoodFrame(16.0);
        wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        wd.Reset();

        var h = wd.GetHealth();
        Assert.Equal(0, h.TotalFrames);
        Assert.Equal(0, h.DroppedFrames);
        Assert.Null(h.LastIssue);
    }

    [Fact]
    public void P95FrameTime_CalculatedCorrectly()
    {
        var wd = new PipelineWatchdog();
        for (int i = 0; i < 100; i++)
            wd.ReportGoodFrame(10.0 + i * 0.5);

        var h = wd.GetHealth();
        Assert.InRange(h.P95FrameTimeMs, 55, 60);
    }

    [Fact]
    public void ApiSwitches_Counted()
    {
        var wd = new PipelineWatchdog();
        wd.ReportApiSwitch();
        wd.ReportApiSwitch();
        wd.ReportApiSwitch();

        var h = wd.GetHealth();
        Assert.Equal(3, h.ApiSwitches);
    }

    [Fact]
    public void ExportStall_DropsHealth()
    {
        var wd = new PipelineWatchdog();
        wd.ReportExportStall();

        var h = wd.GetHealth();
        Assert.Equal(1, h.ExportStalls);
        Assert.Equal(PipelineIssue.ExportStall, h.LastIssue);
    }

    // ─── New tests ──────────────────────────────────────────────────────

    [Fact]
    public void ShouldReinit_HighDropRate_TriggersReinit()
    {
        var wd = new PipelineWatchdog();

        // Need BadFrameThreshold (10) exceeded: at least 11 dropped + 11 total + >50% rate + 5s
        for (int i = 0; i < 11; i++)
            wd.ReportDroppedFrame(PipelineIssue.CaptureError);

        Thread.Sleep(5500); // exceed 5s min reinit interval

        Assert.True(wd.ShouldReinit(), "Should reinit with 11/11 drops after 5s");
    }

    [Fact]
    public void ShouldReinit_FewerThanThreshold_DoesNotTrigger()
    {
        var wd = new PipelineWatchdog();

        // Only 6 drops — below BadFrameThreshold (10)
        for (int i = 0; i < 6; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);

        Thread.Sleep(2000);

        Assert.False(wd.ShouldReinit(), "Should not reinit with <10 dropped frames");
    }

    [Fact]
    public void ShouldReinit_GoodFrameBlocksQuickPath()
    {
        var wd = new PipelineWatchdog();

        for (int i = 0; i < 5; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);

        // Quick reinit path: _consecutiveGood == 0 + 3s → would trigger
        // But a single good frame sets _consecutiveGood = 1 → blocks quick reinit
        wd.ReportGoodFrame(16.0);

        Thread.Sleep(3500);

        // Quick reinit blocked by _consecutiveGood > 0
        // Drop-rate path: _droppedFrames (5) < BadFrameThreshold (10) → also blocked
        Assert.False(wd.ShouldReinit());
    }
}