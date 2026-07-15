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
                // SYNC-PROBE: PTS offset between audio and video BEFORE any processing
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var vFirst = videoPackets[0].Pts;
                    var vLast = videoPackets[^1].Pts + videoPackets[^1].Duration;
                    var aFirst = audioPackets[0].Pts;
                    var aLast = audioPackets[^1].Pts + audioPackets[^1].Duration;
                    var startOffset = (aFirst - vFirst).TotalMilliseconds;
                    var endOffset = (aLast - vLast).TotalMilliseconds;
                    Log.I("SYNC-PROBE", $"ExportToMp4 RAW — Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({(vLast - vFirst).TotalSeconds:F2}s)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({(aLast - aFirst).TotalSeconds:F2}s)  StartOffset={startOffset:F1}ms  EndOffset={endOffset:F1}ms");
                }

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

                    int startTrimmed = audioPackets.Count;
                    audioPackets = TrimAudioStart(audioPackets, videoPackets[0].Pts);
                    int startTrimCount = startTrimmed - audioPackets.Count;

                    activeDurationSec = ComputeIntervalsDuration(intervals);
                    trueVidDuration = videoPackets.Count >= 2
                        ? (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds
                        : 0;

                    activeFps = activeDurationSec > 0 ? videoPackets.Count / activeDurationSec : frameRate;
                    if (activeFps < 1 || activeFps > frameRate * 3) activeFps = frameRate;

                    var lastVideoPts = videoPackets[^1].Pts + videoPackets[^1].Duration;
                    audioPackets = TrimAudioEnd(audioPackets, lastVideoPts);

                    // Sync start: só trima vídeo se offset >2s (AAC vs NVENC speed);
                    // offsets 30ms-2s com áudio após vídeo: não faz nada (áudio começa
                    // naturalmente, vídeo sem áudio por ~300ms é menos perceptível que
                    // silêncio artificial — ITU-R BT.1359: humano tolera áudio atrasado
                    // até 125ms como "detectável", 185ms como "aceitável").
                    // Offsets com áudio antes do vídeo: PadAudioWithSilence (silêncio
                    // no início do áudio para alinhar).
                    if (audioPackets.Count > 0 && videoPackets.Count > 0)
                    {
                        var offsetMs = (audioPackets[0].Pts - videoPackets[0].Pts).TotalMilliseconds;
                        if (offsetMs > 2000)
                        {
                            var target = audioPackets[0].Pts;
                            int trimIdx = videoPackets.FindIndex(p => p.Pts + p.Duration > target);
                            if (trimIdx > 0)
                            {
                                int lastKey = videoPackets.FindLastIndex(trimIdx, p => p.IsKeyFrame);
                                if (lastKey >= 0 && lastKey < trimIdx)
                                {
                                    Log.I("PTS", $"TrimVideoStart: rolling back from {trimIdx} to {lastKey} (keyframe at {videoPackets[lastKey].Pts.TotalSeconds:F3}s)");
                                    trimIdx = lastKey;
                                }
                                Log.I("PTS", $"TrimVideoStart: {trimIdx}/{videoPackets.Count} frames ({videoPackets[0].Pts.TotalSeconds:F3}s → {videoPackets[trimIdx].Pts.TotalSeconds:F3}s) because audio starts at {target.TotalSeconds:F3}s");
                                videoPackets = videoPackets.GetRange(trimIdx, videoPackets.Count - trimIdx);
                            }
                        }
                        else if (offsetMs < -30)
                        {
                            // Áudio começa ANTES do vídeo — não adiciona silêncio.
                            // O mixer já iniciou antes do NVENC produzir o 1º frame;
                            // silêncio artificial causaria delay incorreto.
                            // Passar null para PadAudioWithSilence = sem âncora, sem padding.
                            Log.D("PTS", $"NoSilenceNeeded: audio starts {-offsetMs:F0}ms before video — passing null anchor");
                            var silenceAnchor = audioPackets.Count > 0
                                && audioPackets[0].Pts < videoPackets[0].Pts
                                ? (TimeSpan?)null
                                : videoPackets[0].Pts;
                            audioPackets = PadAudioWithSilence(audioPackets, 48000, 2, silenceAnchor);
                        }
                        else if (offsetMs > 30 && offsetMs <= 2000)
                        {
                            // Áudio começa DEPOIS do vídeo com offset pequeno — não faz nada.
                            // O vídeo toca sem áudio por alguns ms, que é menos perceptível
                            // que silêncio artificial no início do clipe.
                            Log.D("PTS", $"NoSyncNeeded: audio starts {offsetMs:F0}ms after video — letting audio start naturally");
                        }
                    }

                    if (audioPackets.Count > 0)
                    {
                        var af = audioPackets[0].Pts;
                        var al = audioPackets[^1].Pts + audioPackets[^1].Duration;
                        audioDurationSec = (al - af).TotalSeconds;
                    }
                    if (activeDurationSec > 5 && audioDurationSec > 0 && audioDurationSec < activeDurationSec * 0.9)
                        Log.W("PTS", $"audio duration {audioDurationSec:F2}s is <90% of active video {activeDurationSec:F2}s — {audioPackets.Count} packets may be insufficient");

                    var expectedDuration = (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds;
                    var durDiff = expectedDuration - activeDurationSec;
                    Log.I("PTS", $"Post-sync — expectedDuration={expectedDuration:F2}s activeDuration={activeDurationSec:F2}s diff={durDiff:F3}s gapsRemoved={gapsRemoved} audioFrames={audioPackets.Count} startTrimmed={startTrimCount}");

                    Log.D("PTS", $"Post-sync — Video: trueDuration={trueVidDuration:F2}s activeDuration={activeDurationSec:F2}s fps={activeFps:F1} frames={videoPackets.Count}  Audio: packets={audioPackets.Count} gapsRemoved={gapsRemoved} startTrimmed={startTrimCount}");
                }

                // Frame-by-frame PTS drift diagnostic
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var driftLog = new System.Text.StringBuilder();
                    driftLog.Append("PTS-DRIFT | ");
                    var vidStart = videoPackets[0].Pts;
                    var audStart = audioPackets[0].Pts;
                    var step = Math.Max(1, videoPackets.Count / 20);
                    for (int i = 0; i < videoPackets.Count; i += step)
                    {
                        var vp = videoPackets[i];
                        var nearestAudio = audioPackets
                            .Select(a => new { Pkt = a, Delta = (a.Pts - vp.Pts).Duration() })
                            .OrderBy(a => a.Delta)
                            .FirstOrDefault();
                        var drift = nearestAudio != null
                            ? (nearestAudio.Pkt.Pts - vp.Pts).TotalMilliseconds
                            : 0;
                        if (i > 0) driftLog.Append(", ");
                        driftLog.Append($"@{((vp.Pts - vidStart).TotalSeconds):F1}s vPTS={vp.Pts.TotalMilliseconds:F0} aPTS={nearestAudio?.Pkt.Pts.TotalMilliseconds:F0} drift={drift:F1}ms");
                    }
                    Log.I("SYNC", driftLog.ToString());
                }

                WriteMatroskaFile(mkvTemp, videoPackets, rawFormat, avccFallback,
                    audioPackets.Count > 0 ? audioPackets : null);
                var mkvLen = new FileInfo(mkvTemp).Length;
                var audioCount = audioPackets?.Count(p => p.Type == MediaType.Audio) ?? 0;
                Log.I("Exporter", $"MKV temp: {mkvTemp} ({mkvLen / 1024} KB) videoFrames={videoPackets.Count} audioPackets={audioCount}");

#if DEBUG
                // Copia MKV para o mesmo diretório do MP4 para diagnóstico
                try
                {
                    var mkvDiag = Path.Combine(
                        Path.GetDirectoryName(Path.GetFullPath(outputPath))!,
                        Path.GetFileNameWithoutExtension(outputPath) + ".mkv");
                    File.Copy(mkvTemp, mkvDiag, overwrite: true);
                    Log.D("Exporter", $"MKV diagnostic: {mkvDiag} ({new FileInfo(mkvDiag).Length / 1024} KB)");
                }
                catch (Exception ex)
                {
                    Log.W("Exporter", $"Failed to save MKV diagnostic: {ex.Message}");
                }

                // Hex dump first 200 bytes of MKV for diagnostics
                try
                {
                    var mkvBytes = new byte[Math.Min((int)mkvLen, 200)];
                    using (var mkvFs = File.OpenRead(mkvTemp))
                        mkvFs.ReadExactly(mkvBytes, 0, mkvBytes.Length);
                    var hex = new System.Text.StringBuilder();
                    for (int i = 0; i < mkvBytes.Length; i++)
                        hex.Append($"{mkvBytes[i]:X2} ");
                    Log.D("Exporter", $"MKV hex ({mkvBytes.Length}B)={hex.ToString().Trim()}");
                }
                catch { }
#endif

                Log.D("Exporter", $"nominalFps={frameRate} activeFps={activeFps:F1} activeDuration={activeDurationSec:F3}s totalDuration={trueVidDuration:F3}s videoFrames={videoPackets.Count} audioPackets={audioPackets.Count} gapsRemoved={gapsRemoved} audioDurationSec={audioDurationSec:F3}s");

                bool hasAudioTracks = audioPackets.Count > 0 && IsAdts(audioPackets[0]);
                MuxWithFfmpegStreaming(outputPath, mkvTemp, hasAudioTracks, rawFormat);

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

    /// <summary>
    /// Hybrid MP4 export — streaming writer that avoids intermediate MKV file.
    /// Faster and lower memory than ExportToMp4 for large clips.
    /// </summary>
    public string ExportToMp4Hybrid(
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

            // Process PTS sync (same as ExportToMp4)
            if (videoPackets.Count > 0 && audioPackets.Count > 0)
            {
                var vFirst = videoPackets[0].Pts;
                var aFirst = audioPackets[0].Pts;
                var startOffset = (aFirst - vFirst).TotalMilliseconds;
                Log.I("HYBRID", $"PTS offset: {startOffset:F1}ms");
            }

            // Use hybrid writer
            using var writer = new HybridMp4Writer(outputPath, width, height, frameRate, rawFormat);

            // Write video frames
            foreach (var pkt in videoPackets)
                writer.WriteVideoFrame(pkt);

            // Write audio packets (if AAC)
            if (audioPackets.Count > 0 && IsAdts(audioPackets[0]))
            {
                foreach (var pkt in audioPackets)
                    writer.WriteAudioPacket(pkt);
            }

            writer.Finalize();

            Log.I("HYBRID", $"Export complete: video={writer.VideoFramesWritten}, audio={writer.AudioPacketsWritten}");

            // Generate thumbnail
            try { GenerateThumbnail(outputPath); }
            catch (Exception ex) { Log.W("Exporter", $"Thumbnail generation failed: {ex.Message}"); }

            return outputPath;
        }
        finally
        {
            Monitor.Exit(_exportLock);
        }
    }

    internal static List<EncodedPacket> GenerateSilentAacFrames(int count, TimeSpan startPts, int sampleRate, int channels = 2)
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
            int chanConfig = channels;

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

    internal static List<EncodedPacket> TrimAudioStart(List<EncodedPacket> audioPackets, TimeSpan firstVideoPts)
    {
        if (audioPackets.Count == 0) return audioPackets;

        int skip = 0;
        for (int i = 0; i < audioPackets.Count; i++)
        {
            if (audioPackets[i].Pts + audioPackets[i].Duration < firstVideoPts)
                skip = i + 1;
            else
                break;
        }

        return skip > 0 ? audioPackets.GetRange(skip, audioPackets.Count - skip) : audioPackets;
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

    internal static int FindTrailingFrozenFrames(List<EncodedPacket> videoPackets, TimeSpan minFreezeDuration, int nominalFps)
    {
        // Scan from the end for the last PTS gap >= minFreezeDuration (WGC paused during alt-tab).
        // Everything after this gap is stale/frozen frames from WGC resumption.
        // Small gaps (< minFreezeDuration) are skipped — we continue scanning for larger gaps further back.
        for (int i = videoPackets.Count - 1; i > 0; i--)
        {
            var gap = videoPackets[i].Pts - (videoPackets[i - 1].Pts + videoPackets[i - 1].Duration);
            if (gap >= minFreezeDuration)
            {
                int trailingFrames = videoPackets.Count - i;
                // Sanity check: if more than 50% of frames would be discarded,
                // it's probably a circular buffer boundary, not a real alt-tab freeze.
                if (trailingFrames > videoPackets.Count / 2)
                {
                    Log.W("PTS", $"FindTrailingFrozenFrames: gap at frame #{i} of {gap.TotalSeconds:F3}s but {trailingFrames}/{videoPackets.Count} frames would be discarded — assuming buffer boundary, keeping all frames");
                    return videoPackets.Count;
                }
                Log.I("PTS", $"FindTrailingFrozenFrames: gap at frame #{i} of {gap.TotalSeconds:F3}s — truncating {trailingFrames} trailing frames");
                return i;
            }
        }

        return videoPackets.Count;
    }

    internal static List<EncodedPacket> PadAudioWithSilence(List<EncodedPacket> audioPackets, int sampleRate, int channels = 2, TimeSpan? expectedStart = null)
    {
        if (audioPackets.Count == 0) return audioPackets;

        long durTicks = 1024L * 10_000_000 / sampleRate;
        var gapThreshold = TimeSpan.FromMilliseconds(30);

        var result = new List<EncodedPacket>(audioPackets.Count * 2);

        // If expectedStart is set and audio starts later (e.g. WASAPI init delay), pad silence upfront
        var expectedPts = expectedStart ?? audioPackets[0].Pts;
        if (expectedStart.HasValue && audioPackets[0].Pts > expectedStart.Value + gapThreshold)
        {
            var gapSec = (audioPackets[0].Pts - expectedStart.Value).TotalSeconds;
            int silentFrames = (int)(gapSec * sampleRate / 1024.0); // floor — remaining sub-frame gap handled by in-loop check
            if (silentFrames > 0)
            {
                Log.I("PTS", $"PadAudioWithSilence: inserting {silentFrames} silent frames at start for init delay gap of {gapSec:F3}s");
                result.AddRange(GenerateSilentAacFrames(silentFrames, expectedStart.Value, sampleRate, channels));
                expectedPts = expectedStart.Value + TimeSpan.FromTicks(durTicks * silentFrames);
            }
        }

        foreach (var pkt in audioPackets)
        {
            // Insert silence at any PTS gap > 30ms (e.g. alt-tab gaps, buffer eviction gaps)
            if (pkt.Pts > expectedPts + gapThreshold)
            {
                var gapSec = (pkt.Pts - expectedPts).TotalSeconds;
                int silentFrames = (int)Math.Ceiling(gapSec * sampleRate / 1024.0);
                result.AddRange(GenerateSilentAacFrames(silentFrames, expectedPts, sampleRate, channels));
            }
            result.Add(pkt);
            expectedPts = pkt.Pts + pkt.Duration;
        }

        return result;
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

    internal static void WriteMatroskaFile(string path, List<EncodedPacket> packets, string rawFormat, byte[]? avccFallback = null, List<EncodedPacket>? audioPackets = null)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);
        using var bw = new BinaryWriter(fs);

        // Re-baseline PTS so the first frame starts at 0
        var minPts = packets.Count > 0 ? packets[0].Pts : TimeSpan.Zero;
        for (int i = 1; i < packets.Count; i++)
            if (packets[i].Pts < minPts)
                minPts = packets[i].Pts;
        if (audioPackets != null)
            foreach (var pkt in audioPackets)
                if (pkt.Pts < minPts)
                    minPts = pkt.Pts;

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
            double totalSec = 0;
            if (packets.Count >= 2)
                totalSec = (packets[^1].Pts - minPts).TotalSeconds + packets[^1].Duration.TotalSeconds;
            if (audioPackets?.Count >= 2)
            {
                double audioEnd = (audioPackets[^1].Pts - minPts).TotalSeconds + audioPackets[^1].Duration.TotalSeconds;
                if (audioEnd > totalSec) totalSec = audioEnd;
            }
            if (totalSec > 0)
                WriteEbmlFloat(w, 0x4489, totalSec);
            WriteEbmlString(w, 0x4D80, "DiNho Capture"); // MuxingApp
            WriteEbmlString(w, 0x5741, "DiNho Capture"); // WritingApp
        });

        // ── Tracks (known-size) ──
        WriteEbmlMaster(bw, 0x1654AE6B, (w) =>
        {
            // Track 1: Video
            WriteEbmlMaster(w, 0xAE, (tw) =>
        {
            WriteEbmlUnsignedInt(tw, 0xD7, 1);  // TrackNumber
            WriteEbmlUnsignedInt(tw, 0x73C5, 1); // TrackUID
            WriteEbmlUnsignedInt(tw, 0x83, 1);  // TrackType (1=video)
            WriteEbmlUnsignedInt(tw, 0x9A, 0);  // FlagDefault (audio é o default)
            WriteEbmlUnsignedInt(tw, 0x9C, 1);  // FlagLacing
            WriteEbmlString(tw, 0x86, rawFormat switch
            {
                "hevc" => "V_MPEG4/ISO/HEVC",
                "av1" => "V_AV1",
                _ => "V_MPEG4/ISO/AVC"
            }); // CodecID

            // CodecPrivate (avcC for H264, hvcC for HEVC, AV1CodecConfigurationRecord for AV1)
            if (rawFormat == "h264")
            {
                var avcc = avccFallback ?? ExtractAvccExtradata(packets);
                if (avcc != null)
                {
                    Log.I("Exporter", $"avcC len={avcc.Length} source={(avcc == avccFallback ? "encoder" : "packets")}");
                    WriteEbmlBinary(tw, 0x63A2, avcc);
                }
                else
                    Log.W("Exporter", "avcC CodecPrivate not found — MKV may not mux correctly");
            }
            else if (rawFormat == "hevc")
            {
                var hvcc = ExtractHvccExtradata(packets);
                if (hvcc != null)
                {
                    Log.I("Exporter", $"hvcC len={hvcc.Length}");
                    WriteEbmlBinary(tw, 0x63A2, hvcc);
                }
                else
                    Log.W("Exporter", "hvcC CodecPrivate not found — MKV may not mux correctly");
            }
            else if (rawFormat == "av1")
            {
                var av1c = ExtractAv1Extradata(packets);
                if (av1c != null)
                {
                    Log.I("Exporter", $"AV1CodecConfigurationRecord len={av1c.Length}");
                    WriteEbmlBinary(tw, 0x63A2, av1c);
                }
                else
                    Log.W("Exporter", "AV1CodecConfigurationRecord not found — MKV may not mux correctly");
            }

            WriteEbmlMaster(tw, 0xE0, (vw) => // Video
            {
                WriteEbmlUnsignedInt(vw, 0xB0, packets.Count > 0 ? (uint)packets[0].Width : 1920);
                WriteEbmlUnsignedInt(vw, 0xBA, packets.Count > 0 ? (uint)packets[0].Height : 1080);
            });
        });

            // Track 2: Audio (AAC) — only if audio packets are provided
            if (audioPackets?.Count > 0)
            {
                var asc = BuildAudioSpecificConfig(audioPackets[0]);
                var adtsProfile = (audioPackets[0].Data[2] >> 6) & 0x03;
                var adtsSampleRateIdx = (audioPackets[0].Data[2] >> 2) & 0x0F;
                var adtsChanConfig = ((audioPackets[0].Data[2] & 0x03) << 2) | ((audioPackets[0].Data[3] >> 6) & 0x03);
                int[] sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
                int sampleRate = adtsSampleRateIdx < sampleRates.Length ? sampleRates[adtsSampleRateIdx] : 48000;

            WriteEbmlMaster(w, 0xAE, (tw) =>
            {
                WriteEbmlUnsignedInt(tw, 0xD7, 2);   // TrackNumber
                WriteEbmlUnsignedInt(tw, 0x73C5, 2); // TrackUID
                WriteEbmlUnsignedInt(tw, 0x83, 2);   // TrackType (2=audio)
                WriteEbmlUnsignedInt(tw, 0x9A, 1);   // FlagDefault
                WriteEbmlUnsignedInt(tw, 0x9C, 1);   // FlagLacing
                WriteEbmlString(tw, 0x86, "A_AAC");  // CodecID
                if (asc != null)
                    WriteEbmlBinary(tw, 0x63A2, asc); // CodecPrivate (AudioSpecificConfig)
                WriteEbmlMaster(tw, 0xE1, (aw) => // Audio
                {
                    WriteEbmlUnsignedInt(aw, 0xB5, (uint)sampleRate); // SamplingFrequency
                    WriteEbmlUnsignedInt(aw, 0x9F, (uint)adtsChanConfig); // Channels
                });
            });
            }

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

        // ── Audio Clusters ──
        if (audioPackets?.Count > 0)
        {
            int audioClusterSize = 0;
            long audioClusterBaseTimecode = 0;

            foreach (var pkt in audioPackets)
            {
                if (pkt.Type != MediaType.Audio) continue;

                long ptsMs = (pkt.Pts - minPts).Ticks / 10_000;

                bool startNew = audioClusterSize == 0 ||
                                audioClusterSize >= maxClusterFrames ||
                                ptsMs - audioClusterBaseTimecode > 30000 ||
                                ptsMs - audioClusterBaseTimecode > short.MaxValue;

                if (startNew)
                {
                    audioClusterSize = 0;
                    audioClusterBaseTimecode = ptsMs;
                    WriteEbmlMasterBegin(bw, 0x1F43B675); // Cluster
                    WriteEbmlUnsignedInt(bw, 0xE7, (ulong)ptsMs); // Timecode
                    audioClusterSize = 1;
                }
                else
                {
                    audioClusterSize++;
                }

                int relTc = (int)(ptsMs - audioClusterBaseTimecode);
                WriteSimpleBlock(bw, 2, relTc, false, pkt.Data, pkt.DataLength);
            }
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

    /// <summary>
    /// Extract HEVCDecoderConfigurationRecord (hvcC) from video packets.
    /// Scans for VPS (NAL type 32), SPS (NAL type 33), and PPS (NAL type 34).
    /// </summary>
    internal static byte[]? ExtractHvccExtradata(List<EncodedPacket> packets)
    {
        byte[]? vps = null, sps = null, pps = null;
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
                int nalType = (data[nalStart] >> 1) & 0x3F;

                if (nalType == 32 && vps == null)
                {
                    vps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, vps, 0, nalLen);
                }
                else if (nalType == 33 && sps == null)
                {
                    sps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, sps, 0, nalLen);
                }
                else if (nalType == 34 && pps == null)
                {
                    pps = new byte[nalLen];
                    System.Buffer.BlockCopy(data, nalStart, pps, 0, nalLen);
                }

                pos = nalStart + nalLen;
            }
            if (vps != null && sps != null && pps != null) break;
        }

        if (vps == null || sps == null || pps == null) return null;
        return BuildHvcc(vps, sps, pps);
    }

    internal static byte[] BuildHvcc(byte[] vps, byte[] sps, byte[] pps)
    {
        var cleanVps = RemoveEmulationPrevention(vps);
        var cleanSps = RemoveEmulationPrevention(sps);
        var cleanPps = RemoveEmulationPrevention(pps);

        int profileSpace = (cleanSps[0] >> 6) & 0x03;
        bool tierFlag = (cleanSps[0] & 0x20) != 0;
        int profileIdc = cleanSps[0] & 0x1F;
        int generalProfileCompat = (cleanSps[1] << 24) | (cleanSps[2] << 16) | (cleanSps[3] << 8) | cleanSps[4];
        int generalLevelIdc = cleanSps[12];

        int len = 23 + 2 + cleanVps.Length + 2 + cleanSps.Length + 2 + cleanPps.Length;
        var hvcc = new byte[len];
        hvcc[0] = 1;
        hvcc[1] = (byte)((profileSpace << 6) | (tierFlag ? 0x20 : 0) | profileIdc);
        hvcc[2] = (byte)(generalProfileCompat >> 24);
        hvcc[3] = (byte)(generalProfileCompat >> 16);
        hvcc[4] = (byte)(generalProfileCompat >> 8);
        hvcc[5] = (byte)generalProfileCompat;
        hvcc[10] = (byte)generalLevelIdc;
        hvcc[11] = 0xF0;
        hvcc[12] = 0xFC;
        hvcc[13] = 0xFC;
        hvcc[14] = 0xF8;
        hvcc[15] = 0xF8;
        hvcc[16] = 0; hvcc[17] = 0;
        hvcc[18] = 0x0F;
        hvcc[19] = 3;

        int off = 20;
        hvcc[off++] = 0x20;
        hvcc[off++] = 0; hvcc[off++] = 1;
        hvcc[off++] = (byte)(cleanVps.Length >> 8);
        hvcc[off++] = (byte)(cleanVps.Length & 0xFF);
        System.Buffer.BlockCopy(cleanVps, 0, hvcc, off, cleanVps.Length);
        off += cleanVps.Length;

        hvcc[off++] = 0x21;
        hvcc[off++] = 0; hvcc[off++] = 1;
        hvcc[off++] = (byte)(cleanSps.Length >> 8);
        hvcc[off++] = (byte)(cleanSps.Length & 0xFF);
        System.Buffer.BlockCopy(cleanSps, 0, hvcc, off, cleanSps.Length);
        off += cleanSps.Length;

        hvcc[off++] = 0x22;
        hvcc[off++] = 0; hvcc[off++] = 1;
        hvcc[off++] = (byte)(cleanPps.Length >> 8);
        hvcc[off++] = (byte)(cleanPps.Length & 0xFF);
        System.Buffer.BlockCopy(cleanPps, 0, hvcc, off, cleanPps.Length);

        return hvcc;
    }

    /// <summary>
    /// Extract AV1CodecConfigurationRecord from AV1 OBUs.
    /// </summary>
    internal static byte[]? ExtractAv1Extradata(List<EncodedPacket> packets)
    {
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            var data = pkt.Data;
            int len = pkt.DataLength;
            int pos = 0;

            while (pos < len)
            {
                if (pos + 2 > len) break;
                int headerByte = data[pos];
                int obuType = (headerByte >> 3) & 0x0F;
                bool obuExtension = (headerByte & 0x04) != 0;
                int headerLen = 1 + (obuExtension ? 1 : 0);

                int sizeStart = pos + headerLen;
                if (sizeStart >= len) break;
                ulong obuSize = 0;
                int shift = 0;
                int sizeIdx = sizeStart;
                while (sizeIdx < len && shift < 64)
                {
                    byte b = data[sizeIdx++];
                    obuSize |= (ulong)(b & 0x7F) << shift;
                    shift += 7;
                    if ((b & 0x80) == 0) break;
                }

                int obuStart = sizeIdx;
                int obuEnd = obuStart + (int)obuSize;
                if (obuEnd > len) break;

                if (obuType == 1)
                {
                    int seqHeaderLen = obuEnd - obuStart;
                    var seqHeader = new byte[seqHeaderLen];
                    System.Buffer.BlockCopy(data, obuStart, seqHeader, 0, seqHeaderLen);
                    int seqProfile = seqHeader.Length > 0 ? (seqHeader[0] >> 5) & 0x07 : 0;

                    return [
                        0,
                        (byte)((seqProfile << 5) | 0x1F),
                        0x0C,
                        0
                    ];
                }

                pos = obuEnd;
            }
        }
        return null;
    }

    /// <summary>Build a 2-byte AudioSpecificConfig from an AAC ADTS frame.
    /// Per ISO 14496-3, this is the CodecPrivate for A_AAC in Matroska.</summary>
    internal static byte[]? BuildAudioSpecificConfig(EncodedPacket audioPkt)
    {
        if (audioPkt.Data == null || audioPkt.DataLength < 5) return null;
        var data = audioPkt.Data;
        if (data[0] != 0xFF || (data[1] & 0xF0) != 0xF0) return null; // not ADTS

        int profile = (data[2] >> 6) & 0x03;
        int sampleRateIdx = (data[2] >> 2) & 0x0F;
        int channelConfig = ((data[2] & 0x03) << 2) | ((data[3] >> 6) & 0x03);
        int audioObjectType = profile + 1;

        return [ (byte)((audioObjectType << 3) | (sampleRateIdx >> 1)),
                 (byte)(((sampleRateIdx & 0x01) << 7) | (channelConfig << 3)) ];
    }

    private static void MuxWithFfmpegStreaming(
        string outputPath,
        string videoPath,
        bool hasAudioTracks,
        string rawFormat = "h264")
    {
        string args;
        if (hasAudioTracks)
        {
            args = $"-y -loglevel warning " +
                   $"-f matroska -i \"{videoPath}\" " +
                   $"-map 0:v:0 -map 0:a:0 " +
                   $"-c:v copy -c:a copy " +
                   $"-metadata title=\"DiNho Clip\" -metadata comment=\"Recorded with DiNho Clips\" " +
                   $"-movflags +faststart \"{outputPath}\"";
        }
        else
        {
            args = $"-y -loglevel warning " +
                   $"-f matroska -i \"{videoPath}\" " +
                   $"-map 0:v:0 -c:v copy " +
                   $"-metadata title=\"DiNho Clip\" -metadata comment=\"Recorded with DiNho Clips\" " +
                   $"-movflags +faststart \"{outputPath}\"";
        }

        Log.I("Exporter", $"ffmpeg mux: {args.Replace("\"", "'")}");

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = args,
                RedirectStandardInput = false,
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

        if (!proc.WaitForExit(300_000))
        {
            proc.Kill();
            throw new InvalidOperationException("ffmpeg nao terminou em 5min");
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

    internal static bool IsAdts(EncodedPacket pkt) =>
        pkt.Data.Length >= 2 && pkt.Data[0] == 0xFF && (pkt.Data[1] & 0xF0) == 0xF0;

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

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
    }
}
