using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class FfmpegEncoderTests
{
    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("h264_amf")]
    [InlineData("libx264")]
    public void CheckFfmpegEncoder_FindsKnownEncoders(string encoder)
    {
        // This test requires ffmpeg to be in PATH (as it is in the build env)
        // If not found, it simply returns false — no crash
        var result = FfmpegEncoder.CheckFfmpegEncoder(encoder);
        Assert.True(result, $"Expected ffmpeg to have {encoder} available");
    }

    [Theory]
    [InlineData("nonexistent_codec_xyz")]
    [InlineData("")]
    [InlineData("  ")]
    public void CheckFfmpegEncoder_ReturnsFalseForUnknown(string encoder)
    {
        var result = FfmpegEncoder.CheckFfmpegEncoder(encoder);
        Assert.False(result);
    }
}
