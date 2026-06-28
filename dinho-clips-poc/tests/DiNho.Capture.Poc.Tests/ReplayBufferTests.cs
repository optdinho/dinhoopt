using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class ReplayBufferTests
{
    private static EncodedPacket MakeVideo(TimeSpan pts, bool isKey = false, int size = 100)
    {
        var data = new byte[size];
        data[0] = 0x00; data[1] = 0x00; data[2] = 0x00; data[3] = 0x01;
        data[4] = isKey ? (byte)0x67 : (byte)0x41;
        return new EncodedPacket(data, MediaType.Video, pts, TimeSpan.FromTicks(333_333), isKey);
    }

    private static EncodedPacket MakeAudio(TimeSpan pts, int size = 256)
    {
        return new EncodedPacket(new byte[size], MediaType.Audio, pts, TimeSpan.FromTicks(1_000_000), false);
    }

    [Fact]
    public void Buffer_StartsEmpty()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        var s = buf.Stats();
        Assert.Equal(0, s.videoCount);
        Assert.Equal(0, s.audioCount);
    }

    [Fact]
    public void AddVideo_OnePacket()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        var s = buf.Stats();
        Assert.Equal(1, s.videoCount);
    }

    [Fact]
    public void AddVideo_OverflowTrims()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        var frameDuration = TimeSpan.FromTicks(333_333);
        var framesIn5s = (int)(TimeSpan.FromSeconds(5).Ticks / frameDuration.Ticks) + 10;

        for (int i = 0; i < framesIn5s; i++)
        {
            var pts = TimeSpan.FromTicks(i * frameDuration.Ticks);
            buf.AddVideo(MakeVideo(pts));
        }

        var s = buf.Stats();
        Assert.True(s.videoCount < framesIn5s, "Should have trimmed excess");
        Assert.InRange(s.duration.TotalSeconds, 4.5, 5.5);
    }

    [Fact]
    public void AddAudio_AndVideo_Separate()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        buf.AddAudio(MakeAudio(TimeSpan.Zero));
        var s = buf.Stats();
        Assert.Equal(1, s.videoCount);
        Assert.Equal(1, s.audioCount);
    }

    [Fact]
    public void GetSegments_ReturnsAll()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        buf.AddVideo(MakeVideo(TimeSpan.FromTicks(333_333)));
        buf.AddAudio(MakeAudio(TimeSpan.Zero));

        var (video, audio) = buf.GetSegments();
        Assert.Equal(2, video.Count);
        Assert.Single(audio);
    }

    [Fact]
    public void GetSegments_WithDuration_Filters()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        for (int i = 0; i < 60; i++)
        {
            var pts = TimeSpan.FromSeconds(i * 0.5);
            buf.AddVideo(MakeVideo(pts));
        }

        var (video, _) = buf.GetSegments(TimeSpan.FromSeconds(5));
        Assert.True(video.Count > 0);
        Assert.True(video.Count <= 12);
    }

    [Fact]
    public void Clear_EmptiesBuffer()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        buf.Clear();
        var s = buf.Stats();
        Assert.Equal(0, s.videoCount);
        Assert.Equal(0, s.audioCount);
    }

    [Fact]
    public void MaxBytes_Set_TrimsExcess()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30), 20000);
        for (int i = 0; i < 20; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 100));

        var before = buf.Stats();
        Assert.True(before.bytes >= 2000, $"Should have ≥2000 bytes, got {before.bytes}");

        buf.MaxBytes = 500;
        var after = buf.Stats();
        Assert.True(after.bytes <= 500, $"Should trim to ≤500 bytes, got {after.bytes}");
    }

    [Fact]
    public void MaxBytes_Zero_NoByteLimit()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(1), 0);
        for (int i = 0; i < 10; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 1000));

        var s = buf.Stats();
        Assert.True(s.videoCount > 0);
        Assert.True(s.bytes > 1000);
    }

    [Fact]
    public void VideoCount_ReturnsCorrectCount()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        Assert.Equal(0, buf.VideoCount);
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        Assert.Equal(1, buf.VideoCount);
        buf.AddVideo(MakeVideo(TimeSpan.FromTicks(333_333)));
        Assert.Equal(2, buf.VideoCount);
    }

    [Fact]
    public void MaxBytes_CombinedAudioVideo_TrimsToBudget()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30), 1000);
        for (int i = 0; i < 10; i++)
        {
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 200));
            buf.AddAudio(MakeAudio(TimeSpan.FromTicks(i * 333_333), 100));
        }

        var s = buf.Stats();
        Assert.True(s.videoCount > 0, "Video should still have frames after trim");
        Assert.True(s.bytes <= 1000, $"Combined bytes {s.bytes} exceeded maxBytes budget");
    }

    // ─── New tests ──────────────────────────────────────────────────────

    [Fact]
    public void StatsDetailed_ReportsBreakdown()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        buf.AddVideo(MakeVideo(TimeSpan.Zero, false, 200));
        buf.AddVideo(MakeVideo(TimeSpan.FromTicks(333_333), false, 200));
        buf.AddAudio(MakeAudio(TimeSpan.Zero, 256));

        var d = buf.StatsDetailed();
        Assert.Equal(2, d.videoCount);
        Assert.Equal(1, d.audioCount);
        Assert.Equal(400, d.videoBytes);
        Assert.Equal(256, d.audioBytes);
    }

    [Fact]
    public void GetSegments_EmptyBuffer_ReturnsEmpty()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        var (video, audio) = buf.GetSegments();
        Assert.Empty(video);
        Assert.Empty(audio);
    }

    [Fact]
    public void GetSegments_WithEndOffset_FiltersOldest()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        // Add frames: 0s, 0.5s, 1.0s, 1.5s, ...
        for (int i = 0; i < 20; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i * 0.5)));

        // endOffset = 30s → cutoff = -0.5s → all 20 match
        var (all, _) = buf.GetSegments(endOffset: TimeSpan.FromSeconds(20));
        Assert.Equal(20, all.Count);

        // endOffset = 30s → cutoff = 9.5s → only newest frame matches
        var (all2, _) = buf.GetSegments(endOffset: TimeSpan.FromSeconds(30));
        Assert.Equal(1, all2.Count);
    }

    [Fact]
    public void MaxDuration_PropertyCanChange()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(10));
        // Add a few frames
        for (int i = 0; i < 5; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 1_000_000)));

        var before = buf.Stats();
        Assert.True(before.videoCount > 0);

        // Reduce max duration to near zero → all frames trimmed
        buf.MaxDuration = TimeSpan.FromMilliseconds(1);
        var after = buf.Stats();
        Assert.Equal(0, after.videoCount);
        Assert.Equal(0, after.audioCount);
    }

    [Fact]
    public void RingBuffer_WrapAfterTrim()
    {
        // Fill buffer, then partially trim, then add more — this exercises
        // the ring-buffer wrap with head != 0 after TrimExcess
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60));
        for (int i = 0; i < 100; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333)));

        // Trim to 1 second → most frames removed
        buf.MaxDuration = TimeSpan.FromSeconds(1);
        var trimmed = buf.Stats();
        Assert.True(trimmed.videoCount > 0);
        // 100 frames at 33ms spacing = ~3.3s total; 1s window = ~30 frames
        Assert.InRange(trimmed.videoCount, 25, 35);

        // Add more frames (exercises wrap with non-zero head)
        for (int i = 0; i < 50; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i * 0.5 + 100)));

        var afterAdd = buf.Stats();
        // Trim is Duration-based (not PTS-based), so after 50 more 33ms frames
        // we still keep ~30 frames (the newest 30 by ring order)
        Assert.InRange(afterAdd.videoCount, 20, 35);
    }

    [Fact]
    public void AudioMaxBytes_TrimsCombinedExcess()
    {
        // With a tight byte budget, audio should be trimmed first
        // (video-only budget means _totalVideoBytes > _maxBytes triggers video trim,
        //  otherwise audio is trimmed when combined exceeds budget)
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30), 2000);
        for (int i = 0; i < 20; i++)
        {
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 150));
            buf.AddAudio(MakeAudio(TimeSpan.FromTicks(i * 333_333), 200));
        }

        var s = buf.StatsDetailed();
        Assert.True(s.videoBytes > 0, "Some video should remain");
        Assert.True(s.videoBytes + s.audioBytes <= 2000,
            $"Combined bytes {s.videoBytes + s.audioBytes} > 2000");
    }

    [Fact]
    public void BufferGrow_MultipleCapacities()
    {
        // Grow the audio buffer past multiple capacity doublings
        // (initial 1024, then 2048, 4096, ...)
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60));
        for (int i = 0; i < 3000; i++)
            buf.AddAudio(MakeAudio(TimeSpan.FromTicks(i * 1_000_000)));

        var s = buf.Stats();
        Assert.True(s.audioCount > 0, "Audio should survive grow");
    }

    [Fact]
    public void GetSegments_DurationAndEndOffset_Combine()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        for (int i = 0; i < 30; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i * 1.0)));

        // Get last 5 seconds: newest Pts=29s, start=29-5=24s
        var (video, _) = buf.GetSegments(TimeSpan.FromSeconds(5));
        Assert.InRange(video.Count, 4, 6);
        Assert.True(video[0].Pts >= TimeSpan.FromSeconds(24), $"First frame PTS {video[0].Pts} should be ≥24s");
    }
}