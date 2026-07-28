using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

public sealed class AudioMixerTests
{
    [Fact]
    public void Mix_StereoLoopback_StereoMic_Sums()
    {
        var loopback = new float[] { 0.05f, 0.02f, 0.03f, -0.02f };
        var mic = new float[] { 0.05f, 0.03f, 0.02f, 0.01f };
        var result = AudioMixer.Mix(loopback, 2, mic, micGain: 4.0f);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.2449f, result[0], 4);  // tanh(0.25)
        Assert.Equal(0.2165f, result[1], 4);  // tanh(0.22)
        Assert.Equal(0.1489f, result[2], 4);  // tanh(0.15)
        Assert.Equal(0.0997f, result[3], 4);  // tanh(0.10)
    }

    [Fact]
    public void Mix_StereoLoopback_MonoMic_Upmixes()
    {
        var loopback = new float[] { 0.05f, 0.02f, 0.03f, -0.02f };
        var mic = new float[] { 0.05f, 0.03f };
        var result = AudioMixer.Mix(loopback, 2, mic, micGain: 4.0f);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.2449f, result[0], 4);  // tanh(0.05 + 0.05*4)
        Assert.Equal(0.2165f, result[1], 4);  // tanh(0.02 + 0.05*4)
        Assert.Equal(0.1489f, result[2], 4);  // tanh(0.03 + 0.03*4)
        Assert.Equal(0.0997f, result[3], 4);  // tanh(-0.02 + 0.03*4)
    }

    [Fact]
    public void Mix_ClampsToRange()
    {
        var loopback = new float[] { 0.9f };
        var mic = new float[] { 0.8f };
        var result = AudioMixer.Mix(loopback, 1, mic);

        Assert.Single(result);
        Assert.Equal(0.9354f, result[0], 4); // tanh(1.7)
    }

    [Fact]
    public void Mix_ShorterMic_Loops()
    {
        var loopback = new float[] { 0.05f, 0.1f, 0.15f };
        var mic = new float[] { 0.04f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 4.0f);

        Assert.Equal(3, result.Length);
        Assert.Equal(0.2070f, result[0], 3); // tanh(0.05 + 0.04*4)
        Assert.Equal(0.0997f, result[1], 3); // tanh(0.10)
        Assert.Equal(0.1489f, result[2], 3); // tanh(0.15)
    }

    // --- New tests ---

    [Fact]
    public void Mix_NaNInLoopback_IsFiltered()
    {
        var loopback = new float[] { 0.1f, float.NaN, 0.3f };
        var mic = new float[] { 0.05f, 0.05f, 0.05f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(3, result.Length);
        Assert.Equal(0.1489f, result[0], 3); // tanh(0.15)
        Assert.Equal(0.0f, result[1], 3);    // NaN in loopback → 0
        Assert.Equal(0.3364f, result[2], 3); // tanh(0.35)
    }

    [Fact]
    public void Mix_NaNInMic_IsFiltered()
    {
        var loopback = new float[] { 0.1f, 0.2f };
        var mic = new float[] { 0.05f, float.NaN };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.1489f, result[0], 3); // tanh(0.15)
        Assert.Equal(0.0f, result[1], 3);    // NaN in mic → 0
    }

    [Fact]
    public void Mix_GainScaling_AppliedToMicOnly()
    {
        var loopback = new float[] { 0.1f, 0.1f };
        var mic = new float[] { 0.1f, 0.1f };

        var resultLow = AudioMixer.Mix(loopback, 1, mic, micGain: 0.5f);
        var resultHigh = AudioMixer.Mix(loopback, 1, mic, micGain: 2.0f);

        Assert.Equal(0.1489f, resultLow[0], 3);  // tanh(0.15)
        Assert.Equal(0.2913f, resultHigh[0], 3); // tanh(0.3)
    }

    [Fact]
    public void Mix_ZeroGain_MicSilent()
    {
        var loopback = new float[] { 0.2f, 0.3f };
        var mic = new float[] { 0.9f, 0.9f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 0.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.1974f, result[0], 3); // tanh(0.2)
        Assert.Equal(0.2913f, result[1], 3); // tanh(0.3)
    }

    [Fact]
    public void Mix_EmptyLoopback_ReturnsEmpty()
    {
        var result = AudioMixer.Mix([], 2, [0.1f, 0.2f], micGain: 1.0f);
        Assert.Empty(result);
    }

    [Fact]
    public void Mix_AllNaNs_ProducesSilence()
    {
        var loopback = new float[] { float.NaN, float.NaN };
        var mic = new float[] { float.NaN, float.NaN };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.0f, result[0], 3);
        Assert.Equal(0.0f, result[1], 3);
    }
}
