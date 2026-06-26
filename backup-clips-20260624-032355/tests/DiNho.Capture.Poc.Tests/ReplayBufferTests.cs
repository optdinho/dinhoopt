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
}