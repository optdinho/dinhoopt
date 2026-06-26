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
}