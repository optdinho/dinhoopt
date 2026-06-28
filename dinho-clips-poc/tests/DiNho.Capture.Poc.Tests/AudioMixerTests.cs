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
        Assert.Equal(0.20f, result[0], 4);  // SoftClip(0.25) = 0.25/1.25
        Assert.Equal(0.1803f, result[1], 4); // SoftClip(0.22) = 0.22/1.22
        Assert.Equal(0.1304f, result[2], 4); // SoftClip(0.15) = 0.15/1.15
        Assert.Equal(0.0909f, result[3], 4); // SoftClip(0.10) = 0.10/1.10
    }

    [Fact]
    public void Mix_StereoLoopback_MonoMic_Upmixes()
    {
        var loopback = new float[] { 0.05f, 0.02f, 0.03f, -0.02f };
        var mic = new float[] { 0.05f, 0.03f };
        var result = AudioMixer.Mix(loopback, 2, mic, micGain: 4.0f);

        Assert.Equal(4, result.Length);
        Assert.Equal(0.20f, result[0], 4);  // SoftClip(0.05 + 0.05*4)
        Assert.Equal(0.1803f, result[1], 4); // SoftClip(0.02 + 0.05*4)
        Assert.Equal(0.1304f, result[2], 4); // SoftClip(0.03 + 0.03*4)
        Assert.Equal(0.0909f, result[3], 4); // SoftClip(-0.02 + 0.03*4)
    }

    [Fact]
    public void Mix_ClampsToRange()
    {
        var loopback = new float[] { 0.9f };
        var mic = new float[] { 0.8f };
        var result = AudioMixer.Mix(loopback, 1, mic);

        Assert.Single(result);
        Assert.Equal(0.6296f, result[0], 4); // SoftClip(0.9 + 0.8) = 1.7/2.7
    }

    [Fact]
    public void Mix_ShorterMic_Loops()
    {
        var loopback = new float[] { 0.05f, 0.1f, 0.15f };
        var mic = new float[] { 0.04f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 4.0f);

        Assert.Equal(3, result.Length);
        Assert.Equal(0.1736f, result[0], 4); // SoftClip(0.05 + 0.04*4) = 0.21/1.21
        Assert.Equal(0.0909f, result[1], 4); // SoftClip(0.10) = 0.10/1.10
        Assert.Equal(0.1304f, result[2], 4); // SoftClip(0.15) = 0.15/1.15
    }

    // ─── New tests ──────────────────────────────────────────────────────

    [Fact]
    public void Mix_NaNInLoopback_IsFiltered()
    {
        var loopback = new float[] { 0.1f, float.NaN, 0.3f };
        var mic = new float[] { 0.05f, 0.05f, 0.05f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(3, result.Length);
        // NaN in loopback causes sample=NaN → IsNaN check sets to 0
        Assert.Equal(0.1304f, result[0], 4); // SoftClip(0.1 + 0.05)
        Assert.Equal(0.0f, result[1], 4);    // SoftClip(0 + 0.05) = NaN → 0
        Assert.Equal(0.2593f, result[2], 4); // SoftClip(0.3 + 0.05)
    }

    [Fact]
    public void Mix_NaNInMic_IsFiltered()
    {
        var loopback = new float[] { 0.1f, 0.2f };
        var mic = new float[] { 0.05f, float.NaN };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 1.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.1304f, result[0], 4); // SoftClip(0.1 + 0.05)
        Assert.Equal(0.0f, result[1], 4);    // SoftClip(0.2 + NaN) = NaN → 0
    }

    [Fact]
    public void Mix_GainScaling_AppliedToMicOnly()
    {
        // Verify mic gain scales mic but not loopback
        var loopback = new float[] { 0.1f, 0.1f };
        var mic = new float[] { 0.1f, 0.1f };

        var resultLow = AudioMixer.Mix(loopback, 1, mic, micGain: 0.5f);
        var resultHigh = AudioMixer.Mix(loopback, 1, mic, micGain: 2.0f);

        Assert.Equal(0.1304f, resultLow[0], 4);  // SoftClip(0.1 + 0.1*0.5) = 0.15/1.15
        Assert.Equal(0.2308f, resultHigh[0], 4); // SoftClip(0.1 + 0.1*2) = 0.3/1.3
    }

    [Fact]
    public void Mix_ZeroGain_MicSilent()
    {
        var loopback = new float[] { 0.2f, 0.3f };
        var mic = new float[] { 0.9f, 0.9f };
        var result = AudioMixer.Mix(loopback, 1, mic, micGain: 0.0f);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.1667f, result[0], 4); // SoftClip(0.2) = 0.2/1.2
        Assert.Equal(0.2308f, result[1], 4); // SoftClip(0.3) = 0.3/1.3
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
        Assert.Equal(0.0f, result[0], 4); // SoftClip(0)
        Assert.Equal(0.0f, result[1], 4); // SoftClip(0)
    }
}