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
        int frameRate)
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

            var h264Temp = Path.Combine(Path.GetTempPath(), $"dhn_{Guid.NewGuid():N}.h264");

            try
            {
                // Build video PTS intervals (continuous segments, excluding gaps from alt-tab)
                var gapsRemoved = 0;
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var vFirst = videoPackets[0].Pts;
                    var vLast = videoPackets[^1].Pts;
                    var aFirst = audioPackets[0].Pts;
                    var aLast = audioPackets[^1].Pts;
                    Console.Error.WriteLine($"[PTS] Pre-sync — Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({videoPackets.Count} frames)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({audioPackets.Count} packets)");

                    // Identify contiguous video PTS intervals (gap tolerance: 50ms)
                    var intervals = new List<(TimeSpan start, TimeSpan end)>();
                    foreach (var pkt in videoPackets)
                    {
                        var s = pkt.Pts;
                        var e = s + pkt.Duration;
                        if (intervals.Count == 0 || s - intervals[^1].end > TimeSpan.FromMilliseconds(50))
                            intervals.Add((s, e));
                        else
                            intervals[^1] = (intervals[^1].start, e);
                    }

                    // Filter audio packets to only those within video intervals
                    int intervalIdx = 0;
                    var syncedAudio = new List<EncodedPacket>(audioPackets.Count);
                    foreach (var pkt in audioPackets)
                    {
                        while (intervalIdx < intervals.Count && pkt.Pts >= intervals[intervalIdx].end)
                            intervalIdx++;
                        if (intervalIdx < intervals.Count && pkt.Pts >= intervals[intervalIdx].start)
                            syncedAudio.Add(pkt);
                    }
                    gapsRemoved = audioPackets.Count - syncedAudio.Count;
                    audioPackets = syncedAudio;

                    // Compute true video duration (sum of frame durations, ignoring alt-tab gaps)
                    double trueVidDuration = 0;
                    int framesWithDur = 0;
                    foreach (var pkt in videoPackets)
                        if (pkt.Duration.Ticks > 0)
                        {
                            trueVidDuration += pkt.Duration.TotalSeconds;
                            framesWithDur++;
                        }

                    // Trim audio end to match video true duration exactly
                    if (audioPackets.Count > 0)
                    {
                        double audioAccum = 0;
                        int trimAt = audioPackets.Count;
                        for (int i = 0; i < audioPackets.Count; i++)
                        {
                            double next = audioAccum + audioPackets[i].Duration.TotalSeconds;
                            if (next >= trueVidDuration)
                            {
                                trimAt = i + 1;
                                break;
                            }
                            audioAccum = next;
                        }
                        if (trimAt < audioPackets.Count)
                            audioPackets = audioPackets.GetRange(0, trimAt);
                    }

                    Console.Error.WriteLine($"[PTS] Post-sync — Video: trueDuration={trueVidDuration:F2}s frames={framesWithDur}  Audio: packets={audioPackets.Count} gapsRemoved={gapsRemoved}");
                }

                WriteH264File(h264Temp, videoPackets);
                Console.Error.WriteLine($"[Exporter] H264 temp: {h264Temp} ({new FileInfo(h264Temp).Length / 1024} KB)");

                double totalRealSec = videoPackets.Count >= 2
                    ? (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds
                    : (double)videoPackets.Count / frameRate;
                double accurateFps = totalRealSec > 0 ? videoPackets.Count / totalRealSec : frameRate;
                Console.Error.WriteLine($"[Exporter] nominalFps={frameRate} accurateFps={accurateFps:F3} totalRealSec={totalRealSec:F3}s videoFrames={videoPackets.Count} audioPackets={audioPackets.Count} gapsRemoved={gapsRemoved}");

                MuxWithFfmpegStreaming(outputPath, h264Temp, audioPackets, accurateFps);
            }
            finally
            {
                try { File.Delete(h264Temp); } catch { }
            }

            return outputPath;
        }
        finally
        {
            Monitor.Exit(_exportLock);
        }
    }

    internal static double CalculateEffectiveFps(List<EncodedPacket> videoPackets, int nominalFps)
    {
        if (videoPackets.Count < 2)
            return nominalFps;

        // Average inter-frame interval from non-gap consecutive frames
        double totalInterval = 0;
        int intervalCount = 0;
        for (int i = 0; i < videoPackets.Count - 1; i++)
        {
            var interval = (videoPackets[i + 1].Pts - videoPackets[i].Pts).TotalSeconds;
            if (interval > 0.050) continue; // alt-tab gap, skip
            totalInterval += interval;
            intervalCount++;
        }

        if (intervalCount == 0)
            return nominalFps;

        double avgInterval = totalInterval / intervalCount;
        double fps = 1.0 / avgInterval;

        if (fps < 1 || fps > nominalFps * 3)
            return nominalFps;

        return fps;
    }

    private static void WriteH264File(string path, List<EncodedPacket> packets)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);

        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            fs.Write(pkt.Data, 0, pkt.DataLength);
        }
    }

    private static void MuxWithFfmpegStreaming(
        string outputPath,
        string h264Path,
        List<EncodedPacket> audioPackets,
        double frameRate)
    {
        bool hasAudio = audioPackets.Count > 0;
        bool isAac = hasAudio && IsAdts(audioPackets[0]);

        var args = $"-y -loglevel warning " +
                   $"-f h264 -framerate {frameRate.ToString("F3", CultureInfo.InvariantCulture)} -i \"{h264Path}\"";

        // Audio goes to ffmpeg's stdin (pipe:0 is video file, we use audio as second input via pipe)
        // ffmpeg maps video file as input 0 and stdin as input 1
        args += hasAudio
            ? (isAac ? " -f aac -i pipe:0" : " -f s16le -ar 48000 -ac 2 -i pipe:0")
            : "";

        args += $" -map 0:v:0" +
                (hasAudio ? " -map 1:a:0" : "") +
                $" -c:v copy" +
                (hasAudio ? (isAac ? " -c:a copy" : " -c:a aac -b:a 192k") : "") +
                $" -fflags +genpts -movflags +faststart \"{outputPath}\"";

        Console.Error.WriteLine($"[Exporter] ffmpeg mux: {args.Replace("\"", "'")}");

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
        try { proc.PriorityClass = ProcessPriorityClass.Idle; } catch { }
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
            Console.Error.WriteLine($"[Exporter] ffmpeg stderr: {finalStderr.Trim()}");
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
