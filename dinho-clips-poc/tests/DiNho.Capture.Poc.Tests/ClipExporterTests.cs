using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

public sealed class ClipExporterTests
{
    private static EncodedPacket MakePacket(long ptsTicks, long durTicks, MediaType type = MediaType.Video)
    {
        return new EncodedPacket(
            Array.Empty<byte>(), type,
            TimeSpan.FromTicks(ptsTicks), TimeSpan.FromTicks(durTicks),
            false, false, 1920, 1080);
    }

    [Fact]
    public void CalculateEffectiveFps_ReturnsNominal_WhenFewerThan2Packets()
    {
        var single = new List<EncodedPacket> { MakePacket(0, 166_667) };
        Assert.Equal(60, ClipExporter.CalculateEffectiveFps(single, 60));
    }

    [Fact]
    public void CalculateEffectiveFps_ReturnsNominal_WhenEmpty()
    {
        Assert.Equal(60, ClipExporter.CalculateEffectiveFps([], 60));
    }

    [Fact]
    public void CalculateEffectiveFps_ReturnsCorrectFps_WithValidPackets()
    {
        var packets = new List<EncodedPacket>();
        long dur = 166_667; // ~60fps
        for (int i = 0; i < 120; i++)
            packets.Add(MakePacket(i * dur, dur));

        double fps = ClipExporter.CalculateEffectiveFps(packets, 60);
        Assert.Equal(60.0, fps, 1);
    }

    [Fact]
    public void CalculateEffectiveFps_ReturnsLowerFps_WhenGameIsSlow()
    {
        // Game runs at ~40fps: each frame takes ~25ms
        var packets = new List<EncodedPacket>();
        long interval = 250_000; // 25ms between frames
        for (int i = 0; i < 100; i++)
            packets.Add(MakePacket(i * interval, 166_667));

        double fps = ClipExporter.CalculateEffectiveFps(packets, 60);
        Assert.Equal(40.0, fps, 1);
    }

    [Fact]
    public void CalculateEffectiveFps_IgnoresAltTabGaps()
    {
        // 50 frames at 60fps, then 5s alt-tab gap, then 50 more frames
        var packets = new List<EncodedPacket>();
        long dur = 166_667;
        for (int i = 0; i < 50; i++)
            packets.Add(MakePacket(i * dur, dur));
        long gapStart = 50 * dur;
        long gapEnd = gapStart + 5_000_000; // 5s gap
        for (int i = 0; i < 50; i++)
            packets.Add(MakePacket(gapEnd + i * dur, dur));

        double fps = ClipExporter.CalculateEffectiveFps(packets, 60);
        Assert.Equal(60.0, fps, 2); // still ~60fps (gap excluded)
    }

    [Fact]
    public void CalculateEffectiveFps_ClampsToNominal_WhenFpsTooHigh()
    {
        var packets = new List<EncodedPacket>();
        packets.Add(MakePacket(0, 1));
        packets.Add(MakePacket(1, 1)); // only 100ns apart → 10M fps
        Assert.Equal(60.0, ClipExporter.CalculateEffectiveFps(packets, 60), 1);
    }

    [Fact]
    public void CalculateEffectiveFps_ClampsToNominal_WhenFpsBelow1()
    {
        var packets = new List<EncodedPacket>
        {
            MakePacket(0, 166_667),
            MakePacket(10_000_000, 166_667), // 1s apart for 2 frames
        };
        double fps = ClipExporter.CalculateEffectiveFps(packets, 60);
        Assert.InRange(fps, 1, 60);
    }

    [Theory]
    [InlineData(new byte[] { 0xFF, 0xF0 }, true)]
    [InlineData(new byte[] { 0xFF, 0x01 }, false)]
    [InlineData(new byte[] { 0x00, 0x00 }, false)]
    [InlineData(new byte[0], false)]
    public void IsAdts_DetectsAacCorrectly(byte[] data, bool expected)
    {
        var pkt = new EncodedPacket(data, MediaType.Audio, TimeSpan.Zero, TimeSpan.Zero, false, false, 0, 0);
        Assert.Equal(expected, ClipExporter.IsAdts(pkt));
    }
}
