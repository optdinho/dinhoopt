using System.Reflection;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

public sealed class FfmpegEncoderTests
{
    // ── Keyframe detection (byte[] param, works with reflection) ────

    [Fact]
    public void CheckKeyFrame_ReturnsTrue_ForIDRSlice()
    {
        var data = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84 };
        Assert.True(InvokeCheckKeyFrame(data));
    }

    [Fact]
    public void CheckKeyFrame_ReturnsFalse_ForNonIDRSlice()
    {
        var data = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x41, 0x9A, 0x22 };
        Assert.False(InvokeCheckKeyFrame(data));
    }

    [Fact]
    public void CheckKeyFrame_ReturnsFalse_ForEmptyData()
    {
        Assert.False(InvokeCheckKeyFrame(Array.Empty<byte>()));
    }

    [Fact]
    public void CheckKeyFrame_DetectsIDRAfterSPSPPS()
    {
        var data = new byte[]
        {
            0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1E,
            0x00, 0x00, 0x00, 0x01, 0x68, 0xEB,
            0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x20
        };
        Assert.True(InvokeCheckKeyFrame(data));
    }

    [Fact]
    public void CheckKeyFrame_NonIDR_A_SliceTypes()
    {
        var data = new byte[]
        {
            0x00, 0x00, 0x00, 0x01, 0x41, 0x9A, 0x22, // P slice type=1
            0x00, 0x00, 0x00, 0x01, 0x01, 0x9A, 0x22, // B slice type=1 (actually nal_type=1 with different first_byte)
            0x00, 0x00, 0x00, 0x01, 0x61, 0x00, 0x00, // nal_type=1 (0x61 & 0x1F = 1) future ref
        };
        Assert.False(InvokeCheckKeyFrame(data));
        // First slice type found determines result: nal_type=1 → false
    }

    [Fact]
    public void CheckKeyFrame_Handles_3ByteStartCode()
    {
        var data = new byte[] { 0x00, 0x00, 0x01, 0x65, 0x88 };
        Assert.True(InvokeCheckKeyFrame(data));
    }

    // ── Audio float32 → s16le via reflection ────────────────────────

    [Fact]
    public void ConvertAudioToS16Le_ConvertsCorrectly()
    {
        var packets = new List<EncodedPacket>
        {
            new(new byte[] { 0x00, 0x00, 0x00, 0x00 }, MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(1), false),
            new(new byte[] { 0x00, 0x00, 0x80, 0x3F }, MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(1), false),
            new(new byte[] { 0x00, 0x00, 0x80, 0xBF }, MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(1), false),
        };

        var result = InvokeAudioConversion(packets);
        Assert.NotNull(result);
        Assert.Equal(3 * 2, result.Length); // 3 float32 → 3 s16 = 6 bytes

        Assert.Equal(0, BitConverter.ToInt16(result, 0));
        Assert.Equal(32767, BitConverter.ToInt16(result, 2));
        Assert.Equal(-32767, BitConverter.ToInt16(result, 4));
    }

    [Fact]
    public void ConvertAudioToS16Le_ClampsOutOfRange()
    {
        var packets = new List<EncodedPacket>
        {
            new(new byte[] { 0x00, 0x00, 0xC0, 0x3F }, MediaType.Audio, TimeSpan.Zero, TimeSpan.FromSeconds(1), false)
        };

        var result = InvokeAudioConversion(packets);
        Assert.NotNull(result);
        Assert.Equal(32767, BitConverter.ToInt16(result, 0));
    }

    [Fact]
    public void ConvertAudioToS16Le_ReturnsNull_ForEmpty()
    {
        Assert.Null(InvokeAudioConversion(new List<EncodedPacket>()));
    }

    [Fact]
    public void ConvertAudioToS16Le_SkipsNonAudioPackets()
    {
        var packets = new List<EncodedPacket>
        {
            new(new byte[] { 0x00, 0x00, 0x80, 0x3F }, MediaType.Video, TimeSpan.Zero, TimeSpan.FromSeconds(1), false),
        };

        var result = InvokeAudioConversion(packets);
        Assert.Null(result); // only video packets → totalBytes stays 0
    }

    // ── EncodedPacket basics ────────────────────────────────────────

    [Fact]
    public void EncodedPacket_PropertiesWork()
    {
        var pts = TimeSpan.FromSeconds(10);
        var dur = TimeSpan.FromTicks(333_333);
        var pkt = new EncodedPacket([0x41], MediaType.Video, pts, dur, true, 1920, 1080);

        Assert.Equal(pts, pkt.Pts);
        Assert.Equal(dur, pkt.Duration);
        Assert.True(pkt.IsKeyFrame);
        Assert.Equal(MediaType.Video, pkt.Type);
        Assert.Equal(1920, pkt.Width);
        Assert.Equal(1080, pkt.Height);
    }

    // ── Reflection helpers ──────────────────────────────────────────

    private static bool InvokeCheckKeyFrame(byte[] data)
    {
        var m = typeof(FfmpegEncoder).GetMethod("CheckKeyFrame",
            BindingFlags.NonPublic | BindingFlags.Static, null, [typeof(byte[])], null);
        Assert.NotNull(m);
        return (bool)m.Invoke(null, [data])!;
    }

    private static byte[]? InvokeAudioConversion(List<EncodedPacket> packets)
    {
        var m = typeof(ClipExporter).GetMethod("ConvertAudioToS16Le",
            BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(m);
        return (byte[]?)m.Invoke(null, [packets]);
    }
}
