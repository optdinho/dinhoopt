using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Export;

public sealed class ClipExporter : IDisposable
{
    private readonly object _exportLock = new();
    private bool _disposed;

    public static string GenerateOutputPath(string? directory = null)
    {
        directory ??= Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
            "DiNhoClips");
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, $"DiNho Optimizer {DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4");
    }

    public string ExportToMp4(
        string outputPath,
        List<EncodedPacket> videoPackets,
        List<EncodedPacket> audioPackets,
        int width,
        int height,
        int frameRate,
        string rawFormat = "h264",
        byte[]? avccFallback = null)
    {
        if (videoPackets.Count == 0)
            throw new InvalidOperationException("No video packets to export");

        if (!Monitor.TryEnter(_exportLock))
            throw new InvalidOperationException("Export ja em andamento");

        try
        {
            var outputDir = Path.GetDirectoryName(Path.GetFullPath(outputPath))!;
            var drive = new DriveInfo(outputDir);
            if (drive.AvailableFreeSpace < 100_000_000)
                throw new InvalidOperationException(
                    $"Espaco insuficiente: {drive.AvailableFreeSpace / 1024 / 1024}MB");

            var mkvTemp = Path.Combine(Path.GetTempPath(), $"dhn_{Guid.NewGuid():N}.mkv");

            try
            {
                double activeDurationSec = 0;
                double activeFps = frameRate;
                double trueVidDuration = 0;
                double audioDurationSec = 0;
                int gapsRemoved = 0;

                // Sync audio to video PTS intervals (handles alt-tab gaps)
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var vFirst = videoPackets[0].Pts;
                    var vLast = videoPackets[^1].Pts;
                    var aFirst = audioPackets[0].Pts;
                    var aLast = audioPackets[^1].Pts;
                    Log.D("PTS", $"Pre-sync — Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({videoPackets.Count} frames)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({audioPackets.Count} packets)");

                    int origAudioCount = audioPackets.Count;
                    var intervals = GetVideoIntervals(videoPackets, TimeSpan.FromMilliseconds(50));
                    audioPackets = FilterAudioByIntervals(audioPackets, intervals);
                    gapsRemoved = origAudioCount - audioPackets.Count;
                    // Note: gapsRemoved is number of audio packets removed = original - filtered.

                    activeDurationSec = ComputeIntervalsDuration(intervals);
                    trueVidDuration = videoPackets.Count >= 2
                        ? (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds
                        : 0;

                    activeFps = activeDurationSec > 0 ? videoPackets.Count / activeDurationSec : frameRate;
                    if (activeFps < 1 || activeFps > frameRate * 3) activeFps = frameRate;

                    var lastVideoPts = videoPackets[^1].Pts + videoPackets[^1].Duration;
                    audioPackets = TrimAudioEnd(audioPackets, lastVideoPts);

                    audioPackets = PadAudioWithSilence(audioPackets, activeDurationSec, 48000);

                    if (audioPackets.Count > 0)
                    {
                        var af = audioPackets[0].Pts;
                        var al = audioPackets[^1].Pts + audioPackets[^1].Duration;
                        audioDurationSec = (al - af).TotalSeconds;
                    }
                    if (activeDurationSec > 5 && audioDurationSec > 0 && audioDurationSec < activeDurationSec * 0.9)
                        Log.W("PTS", $"audio duration {audioDurationSec:F2}s is <90% of active video {activeDurationSec:F2}s — {audioPackets.Count} packets may be insufficient");

                    Log.D("PTS", $"Post-sync — Video: trueDuration={trueVidDuration:F2}s activeDuration={activeDurationSec:F2}s fps={activeFps:F1} frames={videoPackets.Count}  Audio: packets={audioPackets.Count} gapsRemoved={gapsRemoved}");
                }

                WriteMatroskaFile(mkvTemp, videoPackets, rawFormat, avccFallback);
                var mkvLen = new FileInfo(mkvTemp).Length;
                Log.I("Exporter", $"MKV temp: {mkvTemp} ({mkvLen / 1024} KB) frames={videoPackets.Count}");

                // Hex dump first 100 bytes of MKV for diagnostics
                try
                {
                    var mkvBytes = new byte[Math.Min((int)mkvLen, 200)];
                    using (var mkvFs = File.OpenRead(mkvTemp))
                        mkvFs.ReadExactly(mkvBytes, 0, mkvBytes.Length);
                    var hex = new System.Text.StringBuilder();
                    for (int i = 0; i < mkvBytes.Length; i++)
                        hex.Append($"{mkvBytes[i]:X2} ");
                    Log.I("Exporter", $"MKV hex ({mkvBytes.Length}B)={hex.ToString().Trim()}");
                }
                catch { }

                Log.D("Exporter", $"nominalFps={frameRate} activeFps={activeFps:F1} activeDuration={activeDurationSec:F3}s totalDuration={trueVidDuration:F3}s videoFrames={videoPackets.Count} audioPackets={audioPackets.Count} gapsRemoved={gapsRemoved} audioDurationSec={audioDurationSec:F3}s");

                MuxWithFfmpegStreaming(outputPath, mkvTemp, audioPackets, rawFormat);

                // Gera thumbnail (320x180 JPEG) a partir do MP4 final
                try { GenerateThumbnail(outputPath); }
                catch (Exception ex) { Log.W("Exporter", $"Thumbnail generation failed: {ex.Message}"); }
            }
            finally
            {
                try { File.Delete(mkvTemp); } catch { }
            }

            return outputPath;
        }
        finally
        {
            Monitor.Exit(_exportLock);
        }
    }

    internal static List<EncodedPacket> GenerateSilentAacFrames(int count, TimeSpan startPts, int sampleRate)
    {
        var frames = new List<EncodedPacket>(count);
        long durTicks = 1024L * 10_000_000 / sampleRate;
        var dur = TimeSpan.FromTicks(durTicks);

        for (int i = 0; i < count; i++)
        {
            int frameLen = 9;
            var data = new byte[frameLen];

            int profile = 1; // AAC-LC
            int sampleRateIdx = sampleRate switch
            {
                96000 => 0, 88200 => 1, 64000 => 2, 48000 => 3,
                44100 => 4, 32000 => 5, 24000 => 6, 22050 => 7,
                16000 => 8, 12000 => 9, 11025 => 10, 8000 => 11, _ => 3
            };
            int chanConfig = 2;

            int h1 = 0xFFF1; // syncword=0xFFF, ID=0(MPEG4), layer=0, protection_absent=1
            int h2 = (profile << 6) | (sampleRateIdx << 2) | (chanConfig >> 2);
            int h3 = ((chanConfig & 3) << 6) | ((frameLen >> 11) & 0x03);
            int h4 = (frameLen >> 3) & 0xFF;
            int h5 = ((frameLen & 7) << 5) | 0x1F;
            int h6 = 0xFC;

            data[0] = (byte)(h1 >> 8);
            data[1] = (byte)(h1 & 0xFF);
            data[2] = (byte)h2;
            data[3] = (byte)h3;
            data[4] = (byte)h4;
            data[5] = (byte)h5;
            data[6] = (byte)h6;
            data[7] = 0;
            data[8] = 0;

            var pts = startPts + TimeSpan.FromTicks(durTicks * i);
            frames.Add(new EncodedPacket(data, MediaType.Audio, pts, dur, false));
        }
        return frames;
    }

    // ── EBML/Matroska helpers ─────────────────────────────────────────

    private static void WriteEbmlMaster(BinaryWriter bw, uint id, Action<BinaryWriter> body)
    {
        var ms = new MemoryStream();
        using (var inner = new BinaryWriter(ms))
        {
            body(inner);
        }
        var data = ms.ToArray();
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, (ulong)data.Length);
        bw.Write(data);
    }

    private static void WriteEbmlMasterBegin(BinaryWriter bw, uint id)
    {
        WriteEbmlId(bw, id);
        bw.Write((byte)0xFF); // 1-byte VINT → all 7 data bits = 1 = unknown size
    }

    private static void WriteEbmlId(BinaryWriter bw, uint id)
    {
        if (id >= 0x10000000) bw.Write((byte)(id >> 24));
        if (id >= 0x100000) bw.Write((byte)(id >> 16));
        if (id >= 0x100) bw.Write((byte)(id >> 8));
        bw.Write((byte)id);
    }

    // ── PTS/AV Sync Helpers ────────────────────────────────────────────

    internal static List<(TimeSpan start, TimeSpan end)> GetVideoIntervals(List<EncodedPacket> videoPackets, TimeSpan gapThreshold)
    {
        var intervals = new List<(TimeSpan start, TimeSpan end)>();
        if (videoPackets.Count == 0) return intervals;

        for (int vi = 0; vi < videoPackets.Count; vi++)
        {
            var pkt = videoPackets[vi];
            var s = pkt.Pts;
            var e = s + pkt.Duration;
            if (intervals.Count == 0 || s - intervals[^1].end > gapThreshold)
                intervals.Add((s, e));
            else
                intervals[^1] = (intervals[^1].start, e);
        }

        return intervals;
    }

    internal static List<EncodedPacket> FilterAudioByIntervals(List<EncodedPacket> audioPackets, List<(TimeSpan start, TimeSpan end)> intervals)
    {
        if (audioPackets.Count == 0 || intervals.Count == 0) return audioPackets;

        int intervalIdx = 0;
        var result = new List<EncodedPacket>(audioPackets.Count);
        foreach (var pkt in audioPackets)
        {
            while (intervalIdx < intervals.Count && pkt.Pts >= intervals[intervalIdx].end)
                intervalIdx++;
            if (intervalIdx < intervals.Count && pkt.Pts >= intervals[intervalIdx].start)
                result.Add(pkt);
        }

        return result;
    }

    internal static double ComputeIntervalsDuration(List<(TimeSpan start, TimeSpan end)> intervals)
    {
        double total = 0;
        foreach (var (start, end) in intervals)
            total += (end - start).TotalSeconds;
        return total;
    }

    internal static List<EncodedPacket> TrimAudioEnd(List<EncodedPacket> audioPackets, TimeSpan lastVideoPts)
    {
        if (audioPackets.Count == 0) return audioPackets;

        int trimAt = audioPackets.Count;
        for (int i = 0; i < audioPackets.Count; i++)
        {
            if (audioPackets[i].Pts + audioPackets[i].Duration > lastVideoPts)
            {
                trimAt = i;
                break;
            }
        }

        return trimAt < audioPackets.Count ? audioPackets.GetRange(0, trimAt) : audioPackets;
    }

    internal static List<EncodedPacket> PadAudioWithSilence(List<EncodedPacket> audioPackets, double activeDurationSec, int sampleRate)
    {
        if (audioPackets.Count == 0 || activeDurationSec <= 0) return audioPackets;

        double audioDurSec = 0;
        foreach (var pkt in audioPackets)
            audioDurSec += pkt.Duration.TotalSeconds;
        double gapSec = activeDurationSec - audioDurSec;

        if (gapSec <= 0.010) return audioPackets;

        int silentFrames = (int)Math.Ceiling(gapSec * sampleRate / 1024.0);
        var silent = GenerateSilentAacFrames(silentFrames, audioPackets[^1].Pts + audioPackets[^1].Duration, sampleRate);
        audioPackets.AddRange(silent);
        return audioPackets;
    }

    private static void WriteEbmlVint(BinaryWriter bw, ulong value)
    {
        // ffmpeg's matroskadec.c: ebml_read_vint counts leading ZERO bits before the first 1
        // bit in the first octet. num_size = leading_zero_count + 1.
        //  1 byte: 1xxx xxxx  (mask = 0x80, leading zeros = 0, num_size = 1)
        //  2 bytes: 01xx xxxx  (mask = 0x40, leading zeros = 1, num_size = 2)
        //  3 bytes: 001x xxxx  (mask = 0x20, leading zeros = 2, num_size = 3)
        //  etc.
        // After removing width/marker, value occupies (num_size * 8 - num_size) bits.
        // IMPORTANT: the ALL-1s value for a given width is the "unknown size" sentinel
        // and MUST NOT be used for data elements. Each range check excludes the max value,
        // bumping to the next width to avoid producing the sentinel.
        if (value < 0x7F) { bw.Write((byte)(0x80 | value)); return; }
        if (value < 0x3FFF) { bw.Write((byte)(0x40 | (byte)(value >> 8))); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x1FFFFF) { bw.Write((byte)(0x20 | (byte)(value >> 16))); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x0FFFFFFF) { bw.Write((byte)(0x10 | (byte)(value >> 24))); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x07FFFFFFFF) { bw.Write((byte)(0x08 | (byte)(value >> 32))); bw.Write((byte)((value >> 24) & 0xFF)); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x03FFFFFFFFFFF) { bw.Write((byte)(0x04 | (byte)(value >> 40))); bw.Write((byte)((value >> 32) & 0xFF)); bw.Write((byte)((value >> 24) & 0xFF)); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        if (value < 0x01FFFFFFFFFFFFF) { bw.Write((byte)(0x02 | (byte)(value >> 48))); bw.Write((byte)((value >> 40) & 0xFF)); bw.Write((byte)((value >> 32) & 0xFF)); bw.Write((byte)((value >> 24) & 0xFF)); bw.Write((byte)((value >> 16) & 0xFF)); bw.Write((byte)((value >> 8) & 0xFF)); bw.Write((byte)(value & 0xFF)); return; }
        bw.Write((byte)(0x01 | (byte)(value >> 56)));
        bw.Write((byte)((value >> 48) & 0xFF));
        bw.Write((byte)((value >> 40) & 0xFF));
        bw.Write((byte)((value >> 32) & 0xFF));
        bw.Write((byte)((value >> 24) & 0xFF));
        bw.Write((byte)((value >> 16) & 0xFF));
        bw.Write((byte)((value >> 8) & 0xFF));
        bw.Write((byte)(value & 0xFF));
    }

    private static void WriteEbmlUnsignedInt(BinaryWriter bw, uint id, ulong value)
    {
        WriteEbmlId(bw, id);
        if (value <= 0xFF) { WriteEbmlVint(bw, 1); bw.Write((byte)value); }
        else if (value <= 0xFFFF) { WriteEbmlVint(bw, 2); var b = BitConverter.GetBytes((ushort)value); Array.Reverse(b); bw.Write(b); }
        else if (value <= 0xFFFFFFFF) { WriteEbmlVint(bw, 4); var b = BitConverter.GetBytes((uint)value); Array.Reverse(b); bw.Write(b); }
        else { WriteEbmlVint(bw, 8); var b = BitConverter.GetBytes(value); Array.Reverse(b); bw.Write(b); }
    }

    private static void WriteEbmlFloat(BinaryWriter bw, uint id, double value)
    {
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, 8);
        var b = BitConverter.GetBytes(value);
        Array.Reverse(b);
        bw.Write(b);
    }

    private static void WriteEbmlString(BinaryWriter bw, uint id, string value)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(value);
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, (ulong)bytes.Length);
        bw.Write(bytes);
    }

    private static void WriteEbmlBinary(BinaryWriter bw, uint id, byte[] data)
    {
        WriteEbmlId(bw, id);
        WriteEbmlVint(bw, (ulong)data.Length);
        bw.Write(data);
    }

    private static void WriteSimpleBlock(BinaryWriter bw, int trackNumber, int timecode, bool keyframe, byte[] data, int dataLength)
    {
        int payloadSize = 0;
        int trackSize = trackNumber < 0x7F ? 1 : 2;
        payloadSize += trackSize + 2 + 1 + dataLength; // track + timecode + flags + data
        WriteEbmlId(bw, 0xA3);
        WriteEbmlVint(bw, (ulong)payloadSize);

        if (trackNumber < 0x7F)
            bw.Write((byte)(0x80 | trackNumber));
        else
        {
            bw.Write((byte)(0xC0 | (trackNumber >> 8)));
            bw.Write((byte)(trackNumber & 0xFF));
        }

        var tcBytes = BitConverter.GetBytes((short)timecode);
        Array.Reverse(tcBytes);
        bw.Write(tcBytes);

        byte flags = 0;
        if (keyframe) flags |= 0x80;
        flags |= 0x01;
        bw.Write(flags);

        bw.Write(data, 0, dataLength);
    }

    /// <summary>Convert AVCC (4-byte length prefix) to AnnexB (00 00 01 start code).
    /// SimpleBlocks in Matroska require AnnexB format for H.264/HEVC/AV1 data.</summary>
    internal static byte[] ConvertAvccToAnnexB(byte[] avccData, int dataLength)
    {
        // Count NALUs to allocate exact buffer size
        int nalCount = 0;
        int pos = 0;
        while (pos + 4 <= dataLength)
        {
            int nalLen = (avccData[pos] << 24) | (avccData[pos + 1] << 16) | (avccData[pos + 2] << 8) | avccData[pos + 3];
            if (nalLen <= 0 || pos + 4 + nalLen > dataLength) break;
            nalCount++;
            pos += 4 + nalLen;
        }

        if (nalCount == 0) return avccData[..dataLength];

        int annexBSize = dataLength - nalCount * 4 + nalCount * 3; // replace 4-byte len with 3-byte sc
        var result = new byte[annexBSize];
        int srcPos = 0;
        int dstPos = 0;

        while (srcPos + 4 <= dataLength)
        {
            int nalLen = (avccData[srcPos] << 24) | (avccData[srcPos + 1] << 16) | (avccData[srcPos + 2] << 8) | avccData[srcPos + 3];
            if (nalLen <= 0 || srcPos + 4 + nalLen > dataLength) break;

            // Write start code (0x00 0x00 0x01) instead of 4-byte length
            result[dstPos] = 0;
            result[dstPos + 1] = 0;
            result[dstPos + 2] = 1;
            dstPos += 3;

            // Copy NAL data
            System.Buffer.BlockCopy(avccData, srcPos + 4, result, dstPos, nalLen);
            srcPos += 4 + nalLen;
            dstPos += nalLen;
        }

        return result;
    }

    internal static void WriteMatroskaFile(string path, List<EncodedPacket> packets, string rawFormat, byte[]? avccFallback = null)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);
        using var bw = new BinaryWriter(fs);

        // Re-baseline PTS so the first frame starts at 0
        var minPts = packets.Count > 0 ? packets[0].Pts : TimeSpan.Zero;
        for (int i = 1; i < packets.Count; i++)
            if (packets[i].Pts < minPts)
                minPts = packets[i].Pts;

        // EBML Header (known-size — ffmpeg must be able to skip it cleanly)
        WriteEbmlMaster(bw, 0x1A45DFA3, (w) =>
        {
            WriteEbmlUnsignedInt(w, 0x4286, 1);  // EBMLVersion
            WriteEbmlUnsignedInt(w, 0x42F7, 1);  // EBMLReadVersion
            WriteEbmlUnsignedInt(w, 0x42F2, 4);  // EBMLMaxIDLength
            WriteEbmlUnsignedInt(w, 0x42F3, 8);  // EBMLMaxSizeLength
            WriteEbmlString(w, 0x4282, "matroska"); // DocType
            WriteEbmlUnsignedInt(w, 0x4287, 4);  // DocTypeVersion
            WriteEbmlUnsignedInt(w, 0x4285, 2);  // DocTypeReadVersion
        });

        // Segment (unknown size — ffmpeg doesn't need it for demux)
        WriteEbmlMasterBegin(bw, 0x18538067); // Segment

        // ── Info (known-size — required for ffmpeg when Segment has unknown size) ──
        WriteEbmlMaster(bw, 0x1549A966, (w) =>
        {
            WriteEbmlUnsignedInt(w, 0x2AD7B1, 1_000_000); // TimecodeScale (1ms)
            if (packets.Count >= 2)
            {
                double totalSec = (packets[^1].Pts - minPts).TotalSeconds + packets[^1].Duration.TotalSeconds;
                WriteEbmlFloat(w, 0x4489, totalSec);
            }
            WriteEbmlString(w, 0x4D80, "DiNho Capture"); // MuxingApp
            WriteEbmlString(w, 0x5741, "DiNho Capture"); // WritingApp
        });

        // ── Tracks (known-size) ──
        WriteEbmlMaster(bw, 0x1654AE6B, (w) =>
        {
            WriteEbmlMaster(w, 0xAE, (tw) =>       // TrackEntry
        {
            WriteEbmlUnsignedInt(tw, 0xD7, 1);  // TrackNumber
            WriteEbmlUnsignedInt(tw, 0x73C5, 1); // TrackUID
            WriteEbmlUnsignedInt(tw, 0x83, 1);  // TrackType (1=video)
            WriteEbmlUnsignedInt(tw, 0x9A, 0);  // FlagDefault
            WriteEbmlUnsignedInt(tw, 0x9C, 1);  // FlagLacing
            WriteEbmlString(tw, 0x86, rawFormat switch
            {
                "hevc" => "V_MPEG4/ISO/HEVC",
                "av1" => "V_AV1",
                _ => "V_MPEG4/ISO/AVC"
            }); // CodecID

            // CodecPrivate (avcC for H264, hvcC for HEVC, AV1CodecConfigurationRecord for AV1)
            // Use encoder-cached avcC (avccFallback) first — it's from the FIRST keyframe's
            // SPS/PPS and is always correct. ExtractAvccExtradata may find false-positive SPS
            // bytes within slice data that happen to look like NAL type 7 with a valid length.
            if (rawFormat == "h264")
            {
                var avcc = avccFallback ?? ExtractAvccExtradata(packets);
                if (avcc != null)
                {
                    // Log avcC bytes for diagnostics
                    {
                        int spsLen = avcc.Length >= 8 ? (avcc[6] << 8) | avcc[7] : 0;
                        int ppsOff = 8 + spsLen;
                        int ppsLen = (ppsOff + 2 < avcc.Length) ? (avcc[ppsOff + 1] << 8) | avcc[ppsOff + 2] : 0;
                        var hex = new System.Text.StringBuilder();
                        for (int i = 0; i < Math.Min(avcc.Length, 40); i++)
                            hex.Append($"{avcc[i]:X2} ");
                        string source = avcc == avccFallback ? "encoder" : "packets";
                    Log.I("Exporter", $"avcC len={avcc.Length} spsLen={spsLen} ppsOff={ppsOff} ppsLen={ppsLen} source={source} hex={hex.ToString().Trim()}");
                    }

                    WriteEbmlBinary(tw, 0x63A2, avcc);
                }
                else
                    Log.W("Exporter", $"avcC CodecPrivate not found in packets or fallback — MKV may not mux correctly");
            }

            WriteEbmlMaster(tw, 0xE0, (vw) => // Video
            {
                WriteEbmlUnsignedInt(vw, 0xB0, packets.Count > 0 ? (uint)packets[0].Width : 1920);
                WriteEbmlUnsignedInt(vw, 0xBA, packets.Count > 0 ? (uint)packets[0].Height : 1080);
            });
        });
        });

        // ── Diagnostics: log first frame hex ──
        bool loggedFirstFrame = false;

        // ── Clusters (PTS re-baselined to minPts) ──
        int clusterSize = 0;
        const int maxClusterFrames = 1000;
        long clusterBaseTimecode = 0;

        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;

            if (!loggedFirstFrame)
            {
                loggedFirstFrame = true;
                var hex = new System.Text.StringBuilder();
                int dumpLen = Math.Min(pkt.DataLength, 128);
                for (int i = 0; i < dumpLen; i++)
                    hex.Append($"{pkt.Data[i]:X2} ");
                Log.I("Exporter", $"first frame: pts={pkt.Pts.TotalMilliseconds:F0}ms len={pkt.DataLength}B key={pkt.IsKeyFrame} hex={hex.ToString().Trim()}");
            }

            long ptsMs = (pkt.Pts - minPts).Ticks / 10_000; // 100ns → ms, re-baselined

            bool startNew = clusterSize == 0 ||
                            clusterSize >= maxClusterFrames ||
                            ptsMs - clusterBaseTimecode > 30000 ||
                            ptsMs - clusterBaseTimecode > short.MaxValue;

            if (startNew)
            {
                clusterSize = 0;
                clusterBaseTimecode = ptsMs;
                WriteEbmlMasterBegin(bw, 0x1F43B675); // Cluster
                WriteEbmlUnsignedInt(bw, 0xE7, (ulong)ptsMs); // Timecode (re-baselined ms)
                clusterSize = 1;
            }
            else
            {
                clusterSize++;
            }

            int relTc = (int)(ptsMs - clusterBaseTimecode);
            // Write AVCC (4-byte length-prefixed NALUs) directly.
            // The CodecPrivate (avcC) in the Track header tells ffmpeg's matroskadec
            // to expect AVCC format, not AnnexB. Writing AnnexB would cause mismatch.
            WriteSimpleBlock(bw, 1, relTc, pkt.IsKeyFrame, pkt.Data, pkt.DataLength);
        }

        // Copy MKV to Desktop for analysis
        try
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            string mkvCopy = System.IO.Path.Combine(desktop, "dinho_debug.mkv");
            fs.Flush();
            System.IO.File.Copy(path, mkvCopy, overwrite: true);
            Log.I("Exporter", $"MKV diagnostic copy saved to {mkvCopy} ({new System.IO.FileInfo(mkvCopy).Length}B)");
        }
        catch (Exception ex)
        {
            Log.W("Exporter", $"Failed to copy MKV to Desktop: {ex.Message}");
        }
    }

    internal static byte[]? ExtractAvccExtradata(List<EncodedPacket> packets)
    {
        // Scan video packets for SPS (type 7) and PPS (type 8) NAL units.
        // Data is in AVCC format: 4-byte big-endian length prefix + NAL unit.
        byte[]? sps = null, pps = null;
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            var data = pkt.Data;
            int len = pkt.DataLength;
            int pos = 0;
            while (pos + 4 <= len)
            {
                int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
                if (nalLen <= 0 || pos + 4 + nalLen > len) break;
                int nalStart = pos + 4;
                int nalType = data[nalStart] & 0x1F;

                if (nalType == 7 && sps == null)
                {
                    sps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, sps, 0, nalLen);
                }
                else if (nalType == 8 && pps == null)
                {
                    pps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, pps, 0, nalLen);
                }

                pos = nalStart + nalLen;
            }
            if (sps != null && pps != null) break;
        }

        if (sps == null || pps == null) return null;

        return BuildAvcc(sps, pps);
    }

    /// <summary>Convert AVCC data (4-byte BE length prefix per NAL) to AnnexB (00 00 00 01 start code per NAL).
    /// Output buffer has the same length as input (4-byte prefix → 4-byte start code).</summary>
    private static byte[] AvccToAnnexB(byte[] avcc, int length)
    {
        if (avcc == null || length < 4) return avcc ?? Array.Empty<byte>();
        var result = new byte[length];
        System.Buffer.BlockCopy(avcc, 0, result, 0, length);
        int pos = 0;
        while (pos + 4 <= length)
        {
            int nalLen = (result[pos] << 24) | (result[pos + 1] << 16) | (result[pos + 2] << 8) | result[pos + 3];
            if (nalLen <= 0 || pos + 4 + nalLen > length) break;
            result[pos] = 0x00;
            result[pos + 1] = 0x00;
            result[pos + 2] = 0x00;
            result[pos + 3] = 0x01;
            pos += 4 + nalLen;
        }
        return result;
    }

    internal static byte[]? BuildAvcc(byte[] sps, byte[] pps)
    {
        if (sps.Length < 4 || pps.Length == 0) return null;

        byte[] cleanSps = RemoveEmulationPrevention(sps);
        byte[] cleanPps = RemoveEmulationPrevention(pps);

        int avccLen = 5 + 1 + 2 + cleanSps.Length + 1 + 2 + cleanPps.Length;
        var avcc = new byte[avccLen];
        avcc[0] = 1;
        avcc[1] = cleanSps[1];
        avcc[2] = cleanSps[2];
        avcc[3] = cleanSps[3];
        avcc[4] = 0xFC | 3;
        avcc[5] = 0xE0 | 1;
        avcc[6] = (byte)(cleanSps.Length >> 8);
        avcc[7] = (byte)(cleanSps.Length & 0xFF);
        System.Buffer.BlockCopy(cleanSps, 0, avcc, 8, cleanSps.Length);
        int off = 8 + cleanSps.Length;
        avcc[off] = 1;
        avcc[off + 1] = (byte)(cleanPps.Length >> 8);
        avcc[off + 2] = (byte)(cleanPps.Length & 0xFF);
        System.Buffer.BlockCopy(cleanPps, 0, avcc, off + 3, cleanPps.Length);
        return avcc;
    }

    /// <summary>Strip H.264/HEVC emulation prevention bytes (00 00 03) from a NAL unit.
    /// Per ISO 14496-10, avcC must store NAL data without emulation prevention.</summary>
    internal static byte[] RemoveEmulationPrevention(byte[] nal)
    {
        int count = 0;
        for (int i = 2; i < nal.Length; i++)
            if (nal[i - 2] == 0 && nal[i - 1] == 0 && nal[i] == 3)
                count++;

        if (count == 0) return nal;

        var result = new byte[nal.Length - count];
        int ri = 0;
        for (int i = 0; i < nal.Length; i++)
        {
            if (i >= 2 && nal[i - 2] == 0 && nal[i - 1] == 0 && nal[i] == 3)
                continue;
            result[ri++] = nal[i];
        }
        return result;
    }

    private static void MuxWithFfmpegStreaming(
        string outputPath,
        string videoPath,
        List<EncodedPacket> audioPackets,
        string rawFormat = "h264")
    {
        bool hasAudio = audioPackets.Count > 0;
        bool isAac = hasAudio && IsAdts(audioPackets[0]);

        var args = $"-y -loglevel warning " +
                   $"-f matroska -i \"{videoPath}\"";

        var audioInput = "";
        var audioOpts = "";
        if (hasAudio)
        {
            if (isAac)
            {
                audioInput = " -f aac -i pipe:0";
                audioOpts = " -c:a copy";
            }
            else
            {
                audioInput = " -f s16le -ar 48000 -ac 2 -i pipe:0";
                audioOpts = " -c:a aac -b:a 192k";
            }
        }

        // NO bitstream filter: WriteMatroskaFile writes AVCC (4-byte length-prefixed NALUs)
        // with avcC CodecPrivate. The MP4 muxer with -c:v copy expects AVCC natively —
        // adding h264_mp4toannexb would convert AVCC→AnnexB (wrong direction for MP4 output).
        // AV1 doesn't need any bsf (no AnnexB concept), but our muxer doesn't use AV1.
        args += audioInput +
                $" -map 0:v:0" +
                (hasAudio ? " -map 1:a:0" : "") +
                $" -c:v copy" +
                audioOpts +
                $" -metadata title=\"DiNho Clip\" -metadata comment=\"Recorded with DiNho Clips\"" +
                $" -movflags +faststart \"{outputPath}\"";

        Log.I("Exporter", $"ffmpeg mux: {args.Replace("\"", "'")}");

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = args,
                RedirectStandardInput = hasAudio,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        var stderr = new StringBuilder();
        proc.ErrorDataReceived += (s, e) =>
        {
            if (e.Data != null)
                lock (stderr) { stderr.AppendLine(e.Data); }
        };

        proc.Start();

        proc.BeginErrorReadLine();

        if (hasAudio)
        {
            try
            {
                var stdin = proc.StandardInput.BaseStream;
                if (isAac)
                {
                    foreach (var pkt in audioPackets)
                    {
                        if (pkt.Type != MediaType.Audio) continue;
                        stdin.Write(pkt.Data, 0, pkt.DataLength);
                    }
                }
                else
                {
                    StreamPcmAsS16Le(audioPackets, stdin);
                }
                stdin.Flush();
                stdin.Dispose();
            }
            catch (IOException ex)
            {
                proc.WaitForExit(5000);
                string stderrText;
                lock (stderr) { stderrText = stderr.ToString(); }
                throw new InvalidOperationException(
                    $"ffmpeg mux failed: {ex.Message}. stderr: {stderrText.Trim()}");
            }
        }

        if (!proc.WaitForExit(300_000))
        {
            proc.Kill();
            throw new InvalidOperationException(
                $"ffmpeg nao terminou em 5min");
        }

        string finalStderr;
        lock (stderr) { finalStderr = stderr.ToString(); }

        if (proc.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"ffmpeg exit code {proc.ExitCode}: {finalStderr.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(finalStderr))
            Log.I("Exporter", $"ffmpeg stderr: {finalStderr.Trim()}");
    }

    private static void StreamPcmAsS16Le(List<EncodedPacket> packets, Stream output)
    {
        var buf = new byte[65536];
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Audio) continue;

            if (pkt.PcmSamples is { } pcmSamples)
            {
                int byteLen = pcmSamples.Length * 2;
                var conversionBuf = buf;
                if (byteLen > conversionBuf.Length)
                    conversionBuf = new byte[byteLen * 2];

                unsafe
                {
                    fixed (float* src = pcmSamples)
                    fixed (byte* dst = conversionBuf)
                    {
                        var sDst = (short*)dst;
                        for (int i = 0; i < pcmSamples.Length; i++)
                        {
                            float f = Math.Clamp(src[i], -1f, 1f);
                            sDst[i] = (short)(f * 32767f);
                        }
                    }
                }
                output.Write(conversionBuf, 0, byteLen);
            }
            else
            {
                int len = pkt.DataLength / 4;
                var conversionBuf = buf;
                if (len * 2 > conversionBuf.Length)
                    conversionBuf = new byte[len * 2];

                unsafe
                {
                    fixed (byte* src = pkt.Data)
                    fixed (byte* dst = conversionBuf)
                    {
                        var fSrc = (float*)src;
                        var sDst = (short*)dst;
                        for (int i = 0; i < len; i++)
                        {
                            float f = Math.Clamp(fSrc[i], -1f, 1f);
                            sDst[i] = (short)(f * 32767f);
                        }
                    }
                }
                output.Write(conversionBuf, 0, pkt.DataLength / 2);
            }
        }
    }

    internal static bool IsAdts(EncodedPacket pkt) =>
        pkt.Data.Length >= 2 && pkt.Data[0] == 0xFF && (pkt.Data[1] & 0xF0) == 0xF0;

    public static string EncodeRawNv12ToMp4(
        string outputPath,
        int width, int height, int frameRate,
        IReadOnlyList<ReadOnlyMemory<byte>> nv12Frames,
        IReadOnlyList<long> ptsHns,
        IReadOnlyList<long> durationHns)
    {
        if (nv12Frames.Count == 0)
            throw new InvalidOperationException("No frames to encode");

        var codec = DetectFastestCodec();
        int frameSize = width * height * 3 / 2;

        var args = $"-y -loglevel warning " +
                   $"-f rawvideo -pix_fmt nv12 -s {width}x{height} " +
                   $"-r {frameRate} -i pipe:0 " +
                   $"-c:v {codec} ";

        args += codec switch
        {
            "libx264" => "-preset ultrafast -tune zerolatency",
            "h264_nvenc" => "-preset p1 -tune ll -rc constqp -qp 23",
            _ => ""
        };

        args += $" -movflags +faststart \"{outputPath}\"";

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = args,
                RedirectStandardInput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        proc.Start();
        try { proc.PriorityClass = ProcessPriorityClass.Idle; } catch { }

        try
        {
            var stdin = proc.StandardInput.BaseStream;
            foreach (var frame in nv12Frames)
            {
                stdin.Write(frame.Span);
            }
            stdin.Flush();
            stdin.Dispose();
        }
        catch (IOException ex)
        {
            proc.WaitForExit(5000);
            var err = proc.StandardError.ReadToEnd();
            throw new InvalidOperationException(
                $"ffmpeg encode failed: {ex.Message}. stderr: {err.Trim()}");
        }

        if (!proc.WaitForExit(300_000))
        {
            proc.Kill();
            throw new InvalidOperationException(
                $"ffmpeg nao terminou em 5min");
        }

        if (proc.ExitCode != 0)
        {
            var err = proc.StandardError.ReadToEnd();
            throw new InvalidOperationException(
                $"ffmpeg exit code {proc.ExitCode}: {err.Trim()}");
        }

        return outputPath;
    }

    internal static void GenerateThumbnail(string videoPath)
    {
        var thumbPath = Path.ChangeExtension(videoPath, ".thumb.jpg");

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = $"-y -loglevel warning -i \"{videoPath}\" -vframes 1 -s 320x180 -f image2 \"{thumbPath}\"",
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        proc.Start();
        proc.BeginErrorReadLine();

        if (!proc.WaitForExit(30_000))
        {
            proc.Kill();
            throw new InvalidOperationException("ffmpeg thumbnail timed out");
        }

        if (proc.ExitCode != 0)
            throw new InvalidOperationException($"ffmpeg thumbnail exit code {proc.ExitCode}");

        if (File.Exists(thumbPath))
            Log.I("Exporter", $"Thumbnail: {thumbPath} ({new FileInfo(thumbPath).Length / 1024} KB)");
    }

    private static string DetectFastestCodec()
    {
        try
        {
            using var p = new Process
            {
                StartInfo = new ProcessStartInfo("ffmpeg")
                {
                    Arguments = "-encoders",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            p.Start();
            var o = p.StandardOutput.ReadToEnd();
            p.WaitForExit(2000);
            if (o.Contains("h264_nvenc", StringComparison.OrdinalIgnoreCase)) return "h264_nvenc";
            if (o.Contains("h264_amf", StringComparison.OrdinalIgnoreCase)) return "h264_amf";
            if (o.Contains("h264_qsv", StringComparison.OrdinalIgnoreCase)) return "h264_qsv";
        }
        catch { }
        return "libx264";
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
    }
}
