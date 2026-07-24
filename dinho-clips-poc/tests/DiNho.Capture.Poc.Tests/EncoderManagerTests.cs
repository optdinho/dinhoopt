using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class EncoderManagerTests
{
    // ── ProbeEncoder ─────────────────────────────────────────────────

    [Fact]
    public void ProbeEncoder_libx264_ReturnsSuccess()
    {
        var result = EncoderManager.ProbeEncoder("libx264");
        Assert.True(result.Success, $"Probe should succeed for libx264: {result.Error}");
        Assert.True(result.OutputBytes > 0, "Should produce output bytes");
        Assert.False(result.IsNvencSessionLimit);
        Assert.Equal("libx264", result.Codec);
    }

    [Fact]
    public void ProbeEncoder_nonexistentCodec_ReturnsFailure()
    {
        var result = EncoderManager.ProbeEncoder("nonexistent_codec_xyz");
        Assert.False(result.Success);
        Assert.Equal(0, result.OutputBytes);
        Assert.NotNull(result.Error);
    }

    // ── BuildFallbackChain ──────────────────────────────────────────

    [Fact]
    public void BuildFallbackChain_auto_Nvidia_IncludesHWAndCPU()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);
        Assert.NotEmpty(chain);
        // Should contain NVENC entries + libx264
        Assert.Contains(chain, e => e.Codec.Contains("nvenc"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_auto_Amd_IncludesAMF()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x1002);
        Assert.Contains(chain, e => e.Codec.Contains("amf"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_auto_Intel_IncludesQSV()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x8086);
        Assert.Contains(chain, e => e.Codec.Contains("qsv"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_auto_NoGPU_OnlyCPU()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0);
        Assert.DoesNotContain(chain, e => e.Codec.Contains("nvenc"));
        Assert.DoesNotContain(chain, e => e.Codec.Contains("amf"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_h264_Nvidia_IncludesNvenc()
    {
        var chain = EncoderManager.BuildFallbackChain("h264", 0x10DE);
        Assert.Contains(chain, e => e.Codec == "h264_nvenc");
    }

    [Fact]
    public void BuildFallbackChain_hevc_Nvidia_IncludesHevcNvenc()
    {
        var chain = EncoderManager.BuildFallbackChain("hevc", 0x10DE);
        Assert.Contains(chain, e => e.Codec == "hevc_nvenc");
    }

    [Fact]
    public void BuildFallbackChain_libx264_OnlySoftware()
    {
        var chain = EncoderManager.BuildFallbackChain("libx264", 0x10DE);
        Assert.DoesNotContain(chain, e => e.Codec.Contains("nvenc"));
        Assert.Contains(chain, e => e.Codec == "libx264");
    }

    [Fact]
    public void BuildFallbackChain_IncludesReducedResolutionSteps()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);
        // Should have full-res, 720p (scale 1/2), 480p (scale 1/4), CPU, CPU 720p
        Assert.Contains(chain, e => e.ScaleDivisor == 1);
        Assert.Contains(chain, e => e.ScaleDivisor == 2);
        Assert.Contains(chain, e => e.ScaleDivisor == 4);
    }

    [Fact]
    public void BuildFallbackChain_CPUFallback_LastResort()
    {
        var chain = EncoderManager.BuildFallbackChain("auto", 0x10DE);
        // Last entries should be CPU
        var lastEntries = chain.TakeLast(2).ToList();
        Assert.All(lastEntries, e => Assert.Equal("libx264", e.Codec));
    }

    // ── MapUserCodec ────────────────────────────────────────────────

    [Fact]
    public void MapUserCodec_libx264_AlwaysReturnsLibx264()
    {
        Assert.Equal("libx264", EncoderManager.MapUserCodec("libx264", 0x10DE));
        Assert.Equal("libx264", EncoderManager.MapUserCodec("libx264", 0));
    }

    [Fact]
    public void MapUserCodec_auto_ReturnsNull()
    {
        Assert.Null(EncoderManager.MapUserCodec("auto", 0x10DE));
    }

    [Fact]
    public void MapUserCodec_h264_Nvidia_ReturnsNvenc()
    {
        Assert.Equal("h264_nvenc", EncoderManager.MapUserCodec("h264", 0x10DE));
    }

    [Fact]
    public void MapUserCodec_h264_Amd_ReturnsAmf()
    {
        Assert.Equal("h264_amf", EncoderManager.MapUserCodec("h264", 0x1002));
    }

    [Fact]
    public void MapUserCodec_h264_Intel_ReturnsQsv()
    {
        Assert.Equal("h264_qsv", EncoderManager.MapUserCodec("h264", 0x8086));
    }

    [Fact]
    public void MapUserCodec_h264_UnknownVendor_ReturnsEmpty()
    {
        Assert.Equal("", EncoderManager.MapUserCodec("h264", 0x1234));
    }

    // ── GetPreferredCodec ───────────────────────────────────────────

    [Theory]
    [InlineData(0x10DE, "h264_nvenc")]
    [InlineData(0x1002, "h264_amf")]
    [InlineData(0x8086, "h264_qsv")]
    [InlineData(0, "")]
    [InlineData(0x1234, "")]
    public void GetPreferredCodec_ReturnsCorrectCodec(int vendorId, string expected)
    {
        Assert.Equal(expected, EncoderManager.GetPreferredCodec(vendorId));
    }

    // ── DetectAvailableEncoders ─────────────────────────────────────

    [Fact]
    public void DetectAvailableEncoders_ReturnsAtLeastSoftware()
    {
        var available = EncoderManager.DetectAvailableEncoders();
        Assert.NotEmpty(available);
        Assert.Contains(EncoderType.Ffmpeg, available);
    }

    // ── CheckFfmpegAvailable ────────────────────────────────────────

    [Fact]
    public void CheckFfmpegAvailable_ReturnsTrue()
    {
        Assert.True(EncoderManager.CheckFfmpegAvailable());
    }

    // ── GetGpuList ──────────────────────────────────────────────────

    [Fact]
    public void GetGpuList_ReturnsValidResult()
    {
        var list = EncoderManager.GetGpuList();
        // May be empty in CI environments without GPU — just ensure no exception
        Assert.NotNull(list);
    }

    // ── DetectAllGpuAdapters ────────────────────────────────────────

    [Fact]
    public void DetectAllGpuAdapters_ReturnsValidResult()
    {
        var adapters = EncoderManager.DetectAllGpuAdapters();
        // May be empty in CI environments without GPU — just ensure no exception
        Assert.NotNull(adapters);
        if (adapters.Count > 0)
            Assert.All(adapters, a => Assert.False(string.IsNullOrEmpty(a.Name)));
    }

    // ── GetNvencSessionInfo ─────────────────────────────────────────

    [Fact]
    public void GetNvencSessionInfo_ReturnsValidResult()
    {
        // This machine has RTX 5050 — nvidia-smi should be available
        var info = EncoderManager.GetNvencSessionInfo();
        // MaxSessions = -1 means nvidia-smi not available or probe failed — that's OK
        if (info.MaxSessions > 0)
        {
            Assert.True(info.SessionCount >= 0);
        }
    }

    // ── FallbackEntry ───────────────────────────────────────────────

    [Fact]
    public void FallbackEntry_DefaultScaleDivisor_IsOne()
    {
        var entry = new EncoderManager.FallbackEntry { Codec = "h264_nvenc", Label = "test" };
        Assert.Equal(1, entry.ScaleDivisor);
    }

    // ── ProbeResult ─────────────────────────────────────────────────

    [Fact]
    public void ProbeResult_RecordProperties_AreCorrect()
    {
        var result = new EncoderManager.ProbeResult
        {
            Codec = "libx264",
            Success = true,
            OutputBytes = 1234,
        };
        Assert.Equal("libx264", result.Codec);
        Assert.True(result.Success);
        Assert.Equal(1234, result.OutputBytes);
        Assert.Null(result.Error);
        Assert.False(result.IsNvencSessionLimit);
    }

    // ── SupportsAv1Hardware ─────────────────────────────────────────

    [Fact]
    public void SupportsAv1Hardware_Nvidia_ChecksFfmpeg()
    {
        // On RTX 5050, av1_nvenc should be available
        var result = EncoderManager.SupportsAv1Hardware(0x10DE);
        // We can't assert true/false without knowing the GPU — just ensure no exception
        Assert.IsType<bool>(result);
    }

    [Fact]
    public void SupportsAv1Hardware_UnknownVendor_ReturnsFalse()
    {
        Assert.False(EncoderManager.SupportsAv1Hardware(0x1234));
    }

    // ── ProbeEncoder with real codecs ───────────────────────────────

    [Fact]
    public void ProbeEncoder_h264_nvenc_SucceedsOnThisMachine()
    {
        var result = EncoderManager.ProbeEncoder("h264_nvenc");
        Assert.True(result.Success, $"NVENC probe failed: {result.Error}");
        Assert.True(result.OutputBytes > 0);
    }

    [Fact]
    public void ProbeEncoder_hevc_nvenc_SucceedsOnThisMachine()
    {
        var result = EncoderManager.ProbeEncoder("hevc_nvenc");
        Assert.True(result.Success, $"HEVC NVENC probe failed: {result.Error}");
        Assert.True(result.OutputBytes > 0);
    }
}
