using System.Diagnostics;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

public sealed class ClipExporterIntegrationTests
{
    private const int Fps = 60;
    private static readonly long TicksPerFrame = TimeSpan.TicksPerSecond / Fps;
    private static readonly TimeSpan FrameDuration = TimeSpan.FromTicks(TicksPerFrame);

    // ── Helpers ──────────────────────────────────────────────────────

    private static byte[] BuildAvccNal(byte[] nalData)
    {
        var result = new byte[4 + nalData.Length];
        int len = nalData.Length;
        result[0] = (byte)(len >> 24);
        result[1] = (byte)(len >> 16);
        result[2] = (byte)(len >> 8);
        result[3] = (byte)len;
        System.Buffer.BlockCopy(nalData, 0, result, 4, nalData.Length);
        return result;
    }

    private static List<EncodedPacket> GenerateH264Packets(int count, int width = 1920, int height = 1080)
    {
        var sps = BuildAvccNal([
            0x67, 0x64, 0x00, 0x1E, 0xAC, 0x52, 0x80, 0x7B,
            0x02, 0x20, 0x20, 0x20, 0x80
        ]);

        var pps = BuildAvccNal([0x68, 0xEE, 0x3C, 0x80]);

        var idr = BuildAvccNal([
            0x65, 0x88, 0x84, 0x00, 0x00, 0x7D, 0x40,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00
        ]);

        var nonIdr = BuildAvccNal([
            0x41, 0x9A, 0x22, 0x00, 0x00, 0x7D, 0x40,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00
        ]);

        var packets = new List<EncodedPacket>(count);

        for (int i = 0; i < count; i++)
        {
            byte[] frameData;
            bool isKeyFrame;

            if (i == 0)
            {
                frameData = new byte[sps.Length + pps.Length + idr.Length];
                System.Buffer.BlockCopy(sps, 0, frameData, 0, sps.Length);
                System.Buffer.BlockCopy(pps, 0, frameData, sps.Length, pps.Length);
                System.Buffer.BlockCopy(idr, 0, frameData, sps.Length + pps.Length, idr.Length);
                isKeyFrame = true;
            }
            else
            {
                frameData = nonIdr;
                isKeyFrame = false;
            }

            var pts = TimeSpan.FromTicks(TicksPerFrame * i);
            packets.Add(new EncodedPacket(
                frameData, MediaType.Video,
                pts, FrameDuration,
                isKeyFrame, width, height));
        }

        return packets;
    }

    private static List<EncodedPacket> GenerateValidH264Packets(int targetFrames, int width, int height)
    {
        var tempRaw = Path.Combine(Path.GetTempPath(), $"h264gen_{Guid.NewGuid():N}.264");
        try
        {
            double durationSec = targetFrames / 30.0;
            using var gen = new Process
            {
                StartInfo = new ProcessStartInfo("ffmpeg")
                {
                    Arguments = $"-y -f lavfi -i color=c=black:s={width}x{height}:d={durationSec:F4} " +
                                $"-c:v libx264 -preset ultrafast -crf 51 -profile baseline -level 30 " +
                                $"-bsf:v h264_mp4toannexb -f h264 \"{tempRaw}\"",
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            gen.Start();
            gen.WaitForExit(15000);
            if (gen.ExitCode != 0 || !File.Exists(tempRaw))
                return [];

            var raw = File.ReadAllBytes(tempRaw);
            return SplitH264IntoFrames(raw, targetFrames, width, height);
        }
        finally
        {
            try { File.Delete(tempRaw); } catch { }
        }
    }

    private static byte[] ConvertAnnexBFrameToAvcc(byte[] annexBFrame)
    {
        var result = new List<byte>();
        int pos = 0;
        while (pos < annexBFrame.Length)
        {
            if (pos + 3 > annexBFrame.Length) break;
            if (annexBFrame[pos] != 0 || annexBFrame[pos + 1] != 0) { pos++; continue; }

            int scLen = (pos + 3 <= annexBFrame.Length && annexBFrame[pos + 2] == 1) ? 3 :
                        (pos + 4 <= annexBFrame.Length && annexBFrame[pos + 2] == 0 && annexBFrame[pos + 3] == 1) ? 4 : 0;
            if (scLen == 0) { pos++; continue; }

            int nalStart = pos + scLen;
            int nextSC = -1;
            for (int j = nalStart; j < annexBFrame.Length - 2; j++)
            {
                if (annexBFrame[j] != 0) continue;
                if (annexBFrame[j + 1] != 0) continue;
                if (j + 2 < annexBFrame.Length && annexBFrame[j + 2] == 1) { nextSC = j; break; }
                if (j + 3 < annexBFrame.Length && annexBFrame[j + 2] == 0 && annexBFrame[j + 3] == 1) { nextSC = j; break; }
            }

            int nalLen = nextSC > 0 ? nextSC - nalStart : annexBFrame.Length - nalStart;
            result.Add((byte)(nalLen >> 24));
            result.Add((byte)(nalLen >> 16));
            result.Add((byte)(nalLen >> 8));
            result.Add((byte)nalLen);
            for (int k = 0; k < nalLen; k++)
                result.Add(annexBFrame[nalStart + k]);

            pos = nextSC > 0 ? nextSC : annexBFrame.Length;
        }
        return result.ToArray();
    }

    private static List<EncodedPacket> SplitH264IntoFrames(byte[] raw, int targetFrames, int width, int height)
    {
        var packets = new List<EncodedPacket>();
        int i = 0;
        int frameStart = -1;
        int frameCount = 0;

        while (i < raw.Length - 3 && frameCount < targetFrames)
        {
            if (!(raw[i] == 0 && raw[i + 1] == 0)) { i++; continue; }

            int scLen = (i + 3 < raw.Length && raw[i + 2] == 1) ? 3 :
                        (i + 4 < raw.Length && raw[i + 2] == 0 && raw[i + 3] == 1) ? 4 : 0;
            if (scLen == 0) { i++; continue; }

            int nalStart = i + scLen;
            if (nalStart >= raw.Length) break;
            int nalType = raw[nalStart] & 0x1F;

            int nextSC = -1;
            for (int j = i + scLen + 1; j < raw.Length - 2; j++)
            {
                if (raw[j] != 0) continue;
                if (raw[j + 1] != 0) continue;
                if (j + 2 < raw.Length && raw[j + 2] == 1) { nextSC = j; break; }
                if (j + 3 < raw.Length && raw[j + 2] == 0 && raw[j + 3] == 1) { nextSC = j; break; }
            }

            int nalEnd = nextSC > 0 ? nextSC : raw.Length;
            bool isSlice = nalType == 1 || nalType == 5;

            if (frameStart < 0)
                frameStart = i;

            if (isSlice)
            {
                int frameLen = nalEnd - frameStart;
                var tempFrame = new byte[frameLen];
                System.Buffer.BlockCopy(raw, frameStart, tempFrame, 0, frameLen);
                var frameData = ConvertAnnexBFrameToAvcc(tempFrame);

                bool isKeyFrame = nalType == 5;
                var pts = TimeSpan.FromTicks(TicksPerFrame * frameCount);
                packets.Add(new EncodedPacket(
                    frameData, MediaType.Video,
                    pts, FrameDuration,
                    isKeyFrame, width, height));

                frameCount++;
                frameStart = -1;
            }

            i = nextSC > 0 ? nextSC : raw.Length;
        }

        return packets;
    }

    private static bool ToolAvailable(string tool)
    {
        try
        {
            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo(tool)
                {
                    Arguments = "-version",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            proc.Start();
            proc.WaitForExit(2000);
            return proc.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    // ── ExtractAvccExtradata tests ───────────────────────────────────

    [Fact]
    [Trait("Category", "Integration")]
    public void ExtractAvccExtradata_FromSpsPps_ReturnsCorrectAvcc()
    {
        var sps = new byte[] { 0x67, 0x64, 0x00, 0x1E, 0xAC, 0x52, 0x80, 0x7B, 0x02, 0x20, 0x20, 0x20, 0x80 };
        var pps = new byte[] { 0x68, 0xEE, 0x3C, 0x80 };

        var avccSps = BuildAvccNal(sps);
        var avccPps = BuildAvccNal(pps);
        var data = new byte[avccSps.Length + avccPps.Length];
        System.Buffer.BlockCopy(avccSps, 0, data, 0, avccSps.Length);
        System.Buffer.BlockCopy(avccPps, 0, data, avccSps.Length, avccPps.Length);

        var packet = new EncodedPacket(
            data, MediaType.Video,
            TimeSpan.Zero, FrameDuration,
            true, 1920, 1080);

        var avcc = ClipExporter.ExtractAvccExtradata(new List<EncodedPacket> { packet });

        Assert.NotNull(avcc);
        Assert.Equal(1, avcc[0]);
        Assert.Equal(0x64, avcc[1]);
        Assert.Equal(0x00, avcc[2]);
        Assert.Equal(0x1E, avcc[3]);
        Assert.Equal(0xFC | 3, avcc[4]);
        Assert.Equal(0xE0 | 1, avcc[5]);

        int spsLen = (avcc[6] << 8) | avcc[7];
        Assert.Equal(sps.Length, spsLen);

        int ppsOff = 8 + spsLen;
        Assert.Equal(1, avcc[ppsOff]);

        int ppsLen = (avcc[ppsOff + 1] << 8) | avcc[ppsOff + 2];
        Assert.Equal(pps.Length, ppsLen);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void ExtractAvccExtradata_NullWhenMissingSps()
    {
        var pps = new byte[] { 0x68, 0xEE, 0x3C, 0x80 };
        var data = BuildAvccNal(pps);

        var packet = new EncodedPacket(
            data, MediaType.Video,
            TimeSpan.Zero, FrameDuration, true, 1920, 1080);

        var avcc = ClipExporter.ExtractAvccExtradata(new List<EncodedPacket> { packet });
        Assert.Null(avcc);
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void ExtractAvccExtradata_NullWhenEmptyPackets()
    {
        var avcc = ClipExporter.ExtractAvccExtradata([]);
        Assert.Null(avcc);
    }

    // ── WriteMatroskaFile tests (MKV structure, no ffprobe) ──────────

    [Fact]
    [Trait("Category", "Integration")]
    public void WriteMatroskaFile_CreatesValidMkv()
    {
        var tempMkv = Path.Combine(Path.GetTempPath(), $"test_{Guid.NewGuid():N}.mkv");

        try
        {
            var packets = GenerateH264Packets(30);
            ClipExporter.WriteMatroskaFile(tempMkv, packets, "h264");

            var fi = new FileInfo(tempMkv);
            Assert.True(fi.Exists);
            Assert.True(fi.Length > 0, "MKV file is empty");

            // Verify EBML header
            using var fs = File.OpenRead(tempMkv);
            var header = new byte[4];
            fs.ReadExactly(header, 0, 4);
            // EBML header ID: 0x1A 0x45 0xDF 0xA3
            Assert.Equal(0x1A, header[0]);
            Assert.Equal(0x45, header[1]);
            Assert.Equal(0xDF, header[2]);
            Assert.Equal(0xA3, header[3]);

            // Read DocType string (matroska)
            fs.Position = 0;
            var all = new byte[fi.Length];
            fs.ReadExactly(all, 0, (int)fi.Length);
            var docType = System.Text.Encoding.UTF8.GetString(all, 0, Math.Min(1024, (int)fi.Length));
            Assert.Contains("matroska", docType);

            // Verify Segment element present
            Assert.Contains("DiNho Capture", docType);
        }
        finally
        {
            try { File.Delete(tempMkv); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void WriteMatroskaFile_UsesCorrectCodecId_H264()
    {
        var tempMkv = Path.Combine(Path.GetTempPath(), $"test_codec_{Guid.NewGuid():N}.mkv");

        try
        {
            var packets = GenerateH264Packets(5);
            ClipExporter.WriteMatroskaFile(tempMkv, packets, "h264");

            var all = File.ReadAllBytes(tempMkv);
            var text = System.Text.Encoding.UTF8.GetString(all);
            Assert.Contains("V_MPEG4/ISO/AVC", text);
            Assert.DoesNotContain("V_MPEG4/ISO/HEVC", text);
        }
        finally
        {
            try { File.Delete(tempMkv); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void WriteMatroskaFile_UsesCorrectCodecId_HEVC()
    {
        var tempMkv = Path.Combine(Path.GetTempPath(), $"test_codec_hevc_{Guid.NewGuid():N}.mkv");

        try
        {
            var packets = GenerateH264Packets(5);
            ClipExporter.WriteMatroskaFile(tempMkv, packets, "hevc");

            var all = File.ReadAllBytes(tempMkv);
            var text = System.Text.Encoding.UTF8.GetString(all);
            Assert.Contains("V_MPEG4/ISO/HEVC", text);
            Assert.DoesNotContain("V_MPEG4/ISO/AVC", text);
        }
        finally
        {
            try { File.Delete(tempMkv); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void WriteMatroskaFile_ProducesExpectedClusterCount()
    {
        var tempMkv = Path.Combine(Path.GetTempPath(), $"test_clusters_{Guid.NewGuid():N}.mkv");

        try
        {
            // With 30 frames at 60fps, maxClusterFrames=1000 → single cluster
            var packets = GenerateH264Packets(30);
            ClipExporter.WriteMatroskaFile(tempMkv, packets, "h264");

            var all = File.ReadAllBytes(tempMkv);
            // Cluster ID: 0x1F43B675 → bytes 0x1F 0x43 0xB6 0x75
            int clusterCount = 0;
            for (int i = 0; i < all.Length - 4; i++)
            {
                if (all[i] == 0x1F && all[i + 1] == 0x43 && all[i + 2] == 0xB6 && all[i + 3] == 0x75)
                    clusterCount++;
            }
            Assert.Equal(1, clusterCount);
        }
        finally
        {
            try { File.Delete(tempMkv); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void WriteMatroskaFile_WithManyFrames_SplitsIntoMultipleClusters()
    {
        var tempMkv = Path.Combine(Path.GetTempPath(), $"test_multi_{Guid.NewGuid():N}.mkv");

        try
        {
            var packets = GenerateH264Packets(2500);
            ClipExporter.WriteMatroskaFile(tempMkv, packets, "h264");

            var all = File.ReadAllBytes(tempMkv);
            int clusterCount = 0;
            for (int i = 0; i < all.Length - 4; i++)
            {
                if (all[i] == 0x1F && all[i + 1] == 0x43 && all[i + 2] == 0xB6 && all[i + 3] == 0x75)
                    clusterCount++;
            }
            // 2500 frames with maxClusterFrames=1000 → at least 3 clusters
            Assert.True(clusterCount >= 3, $"Expected ≥3 clusters, got {clusterCount}");
        }
        finally
        {
            try { File.Delete(tempMkv); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void WriteMatroskaFile_CodecPrivateAvccPresent()
    {
        var tempMkv = Path.Combine(Path.GetTempPath(), $"test_avcc_{Guid.NewGuid():N}.mkv");

        try
        {
            var packets = GenerateH264Packets(5);
            ClipExporter.WriteMatroskaFile(tempMkv, packets, "h264");

            var all = File.ReadAllBytes(tempMkv);
            // CodecPrivate EBML ID for Track entries: 0x63A2 → 0x63 0xA2
            // Look for the avcC signature byte pattern
            bool hasAvcc = false;
            for (int i = 0; i < all.Length - 8; i++)
            {
                // avcC: version=1, profile=0x64, byte4=0xFF (0xFC|3 reserved|lengthSize)
                if (all[i] == 1 && all[i + 1] == 0x64 && all[i + 4] == 0xFF)
                {
                    hasAvcc = true;
                    break;
                }
            }
            Assert.True(hasAvcc, "avcC extra data not found in MKV");
        }
        finally
        {
            try { File.Delete(tempMkv); } catch { }
        }
    }

    // ── Full pipeline test (requires ffmpeg + ffprobe) ──────────────

    [Fact]
    [Trait("Category", "Integration")]
    public void ExportToMp4_ProducesValidMp4()
    {
        if (!ToolAvailable("ffmpeg") || !ToolAvailable("ffprobe"))
            return;

        var tempMp4 = Path.Combine(Path.GetTempPath(), $"test_{Guid.NewGuid():N}.mp4");

        try
        {
            var videoPackets = GenerateValidH264Packets(30, 1920, 1080);
            if (videoPackets.Count < 2)
                return;

            var audioPackets = ClipExporter.GenerateSilentAacFrames(
                videoPackets.Count, TimeSpan.Zero, 48000);

            using var exporter = new ClipExporter();
            var resultPath = exporter.ExportToMp4(
                tempMp4, videoPackets, audioPackets,
                1920, 1080, Fps, "h264");

            var fi = new FileInfo(resultPath);
            Assert.True(fi.Exists, $"Output MP4 not found at {resultPath}");
            Assert.True(fi.Length > 0, "MP4 file is empty");

            // Use ffprobe with 10s timeout per call
            var duration = RunFfprobe(resultPath, "format=duration");
            Assert.NotNull(duration);
            Assert.True(double.TryParse(duration, out var durSeconds));
            Assert.True(durSeconds > 0, $"MP4 duration not positive: {durSeconds}");

            var codec = RunFfprobe(resultPath, "stream=codec_name");
            Assert.NotNull(codec);
            Assert.Contains("h264", codec, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            try { File.Delete(tempMp4); } catch { }
        }
    }

    private static string? RunFfprobe(string filePath, string entries)
    {
        try
        {
            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo("ffprobe")
                {
                    Arguments = $"-v error -show_entries {entries} -of default=noprint_wrappers=1:nokey=1 \"{filePath}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            proc.Start();
            var output = proc.StandardOutput.ReadToEnd();
            if (!proc.WaitForExit(10000))
            {
                proc.Kill();
                return null;
            }
            return proc.ExitCode == 0 ? output.Trim() : null;
        }
        catch
        {
            return null;
        }
    }
}
