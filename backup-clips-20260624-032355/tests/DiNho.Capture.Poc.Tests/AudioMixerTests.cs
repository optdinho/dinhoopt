using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

public sealed class AudioMixerTests
{
    [Fact]
    public void Mix_StereoLoopback_StereoMic_Sums()
    {
        var loopback = new float[] { 0.3f, -0.2f, 0.1f, 0.0f };
        var mic = new float[] { 0.2f, -0.1f, 0.05f, 0.0f };
        var result = AudioMixer.Mix(loopback, 2, mic);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.7f, result[0], 4);  // 0.3 + 0.2*2
        Assert.Equal(0.2f, result[1], 4);  // -0.2 + 0.2*2
        Assert.Equal(-0.1f, result[2], 4); // 0.1 + -0.1*2
        Assert.Equal(-0.2f, result[3], 4); // 0.0 + -0.1*2
    }

    [Fact]
    public void Mix_StereoLoopback_MonoMic_Upmixes()
    {
        var loopback = new float[] { 0.3f, -0.2f, 0.1f, 0.0f };
        var mic = new float[] { 0.2f, 0.05f };
        var result = AudioMixer.Mix(loopback, 2, mic);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.7f, result[0], 4);  // 0.3 + 0.2*2  (frame 0, mic[0])
        Assert.Equal(0.2f, result[1], 4);  // -0.2 + 0.2*2 (frame 0, mic[0])
        Assert.Equal(0.2f, result[2], 4);  // 0.1 + 0.05*2 (frame 1, mic[1])
        Assert.Equal(0.1f, result[3], 4);  // 0.0 + 0.05*2 (frame 1, mic[1])
    }

    [Fact]
    public void Mix_ClampsToRange()
    {
        var loopback = new float[] { 0.9f };
        var mic = new float[] { 0.8f };
        var result = AudioMixer.Mix(loopback, 1, mic);

        Assert.Single(result);
        Assert.Equal(1.0f, result[0]); // 0.9 + 0.8*2 = 2.5 -> clamped to 1.0
    }

    [Fact]
    public void Mix_ShorterMic_Loops()
    {
        var loopback = new float[] { 0.1f, 0.2f, 0.3f };
        var mic = new float[] { 0.5f };
        var result = AudioMixer.Mix(loopback, 1, mic);

        Assert.Equal(3, result.Length);
        Assert.Equal(1.0f, result[0], 4); // 0.1 + 0.5*2 = 1.1 -> clamped
        Assert.Equal(1.0f, result[1], 4); // 0.2 + 0.5*2 = 1.2 -> clamped
        Assert.Equal(1.0f, result[2], 4); // 0.3 + 0.5*2 = 1.3 -> clamped
    }
}