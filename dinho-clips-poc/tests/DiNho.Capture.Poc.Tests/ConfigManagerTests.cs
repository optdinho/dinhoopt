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
        Assert.Equal(30000, cfg.Config.BitrateKbps);
        Assert.Equal(60, cfg.Config.Fps);
        Assert.Equal(1280, cfg.Config.Width);
        Assert.Equal(720, cfg.Config.Height);
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

    [Theory]
    [InlineData("p1", true)]
    [InlineData("p5", true)]
    [InlineData("p7", true)]
    [InlineData("P5", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData(null, false)]
    [InlineData("p8", false)]
    [InlineData("veryfast", false)]
    [InlineData("veryslow", false)]
    [InlineData("p5; shutdown /s", false)]
    [InlineData("--preset evil", false)]
    public void IsValidEncoderPreset_Validates(string? preset, bool expected)
    {
        Assert.Equal(expected, ConfigManager.IsValidEncoderPreset(preset));
    }

    [Fact]
    public void Load_InvalidEncoderPreset_FallsBackToDefault()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var tempFile = Path.Combine(tempDir, "config.json");
        File.WriteAllText(tempFile, "{\"EncoderPreset\":\"p5; shutdown /s\"}");
        try
        {
            var cfg = new ConfigManager(tempFile);
            Assert.Equal("p5", cfg.Config.EncoderPreset);
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }
}