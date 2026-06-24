using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

public sealed class AudioMixerTests
{
    [Fact]
    public void Mix_StereoLoopback_StereoMic_Sums()
    {
        var loopback = new float[] { 0.05f, 0.02f, 0.03f, -0.02f };
        var mic = new float[] { 0.05f, 0.03f, 0.02f, 0.01f };
        var result = AudioMixer.Mix(loopback, 2, mic);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.25f, result[0], 4);  // 0.05 + 0.05*4
        Assert.Equal(0.22f, result[1], 4);  // 0.02 + 0.05*4
        Assert.Equal(0.15f, result[2], 4);  // 0.03 + 0.03*4
        Assert.Equal(0.10f, result[3], 4);  // -0.02 + 0.03*4 (frame 1, mic[1])
    }

    [Fact]
    public void Mix_StereoLoopback_MonoMic_Upmixes()
    {
        var loopback = new float[] { 0.05f, 0.02f, 0.03f, -0.02f };
        var mic = new float[] { 0.05f, 0.03f };
        var result = AudioMixer.Mix(loopback, 2, mic);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.25f, result[0], 4);  // 0.05 + 0.05*4 (frame 0, mic[0])
        Assert.Equal(0.22f, result[1], 4);  // 0.02 + 0.05*4 (frame 0, mic[0])
        Assert.Equal(0.15f, result[2], 4);  // 0.03 + 0.03*4 (frame 1, mic[1])
        Assert.Equal(0.10f, result[3], 4);  // -0.02 + 0.03*4 (frame 1, mic[1])
    }

    [Fact]
    public void Mix_ClampsToRange()
    {
        var loopback = new float[] { 0.9f };
        var mic = new float[] { 0.8f };
        var result = AudioMixer.Mix(loopback, 1, mic);

        Assert.Single(result);
        Assert.Equal(1.0f, result[0]); // 0.9 + 0.8*4 = 4.1 -> soft-clipped to 1.0
    }

    [Fact]
    public void Mix_ShorterMic_Loops()
    {
        var loopback = new float[] { 0.05f, 0.1f, 0.15f };
        var mic = new float[] { 0.04f };
        var result = AudioMixer.Mix(loopback, 1, mic);

        Assert.Equal(3, result.Length);
        Assert.Equal(0.21f, result[0], 4); // 0.05 + 0.04*4 = 0.21
        Assert.Equal(0.26f, result[1], 4); // 0.10 + 0.04*4 = 0.26
        Assert.Equal(0.31f, result[2], 4); // 0.15 + 0.04*4 = 0.31
    }
}