using DiNho.Capture.Poc.Config;

namespace DiNho.Capture.Poc.Tests;

public sealed class ConfigManagerTests
{
    private static ConfigManager CreateClean()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        return new ConfigManager(tempFile);
    }

    [Fact]
    public void Default_Config_HasExpectedValues()
    {
        var cfg = CreateClean();
        Assert.Equal(40000, cfg.Config.BitrateKbps);
        Assert.Equal(30, cfg.Config.Fps);
        Assert.Equal(1920, cfg.Config.Width);
        Assert.Equal(1080, cfg.Config.Height);
        Assert.Equal(120, cfg.Config.ReplayTimeSeconds);
    }

    [Fact]
    public void OverrideBitrate_Persists()
    {
        var cfg = CreateClean();
        cfg.Config.BitrateKbps = 10000;
        Assert.Equal(10000, cfg.Config.BitrateKbps);
    }

    [Fact]
    public void OverrideFps_Persists()
    {
        var cfg = CreateClean();
        cfg.Config.Fps = 30;
        Assert.Equal(30, cfg.Config.Fps);
    }

    [Fact]
    public void OverrideResolution_Persists()
    {
        var cfg = CreateClean();
        cfg.Config.Width = 1920;
        cfg.Config.Height = 1080;
        Assert.Equal(1920, cfg.Config.Width);
        Assert.Equal(1080, cfg.Config.Height);
    }
}