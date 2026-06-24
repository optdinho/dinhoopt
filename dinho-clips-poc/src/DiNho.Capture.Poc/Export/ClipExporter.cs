using System.Diagnostics;
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
        return Path.Combine(directory, $"{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4");
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
            throw new InvalidOperationException("Export já em andamento");

        try
        {
            var outputDir = Path.GetDirectoryName(Path.GetFullPath(outputPath))!;
            var drive = new DriveInfo(outputDir);
            if (drive.AvailableFreeSpace < 100_000_000)
                throw new InvalidOperationException(
                    $"Espaço insuficiente: {drive.AvailableFreeSpace / 1024 / 1024}MB");

            var h264Temp = Path.Combine(Path.GetTempPath(), $"dhn_{Guid.NewGuid():N}.h264");

            try
            {
                WriteH264File(h264Temp, videoPackets);
                Console.Error.WriteLine($"[Exporter] H264 temp: {h264Temp} ({new FileInfo(h264Temp).Length / 1024} KB)");
                MuxWithFfmpeg(outputPath, h264Temp, audioPackets, frameRate);
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

    private static void WriteH264File(string path, List<EncodedPacket> packets)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);

        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Video) continue;
            fs.Write(pkt.Data, 0, pkt.Data.Length);
        }
    }

    private void MuxWithFfmpeg(
        string outputPath,
        string h264Path,
        List<EncodedPacket> audioPackets,
        int frameRate)
    {
        bool hasAudio = audioPackets.Count > 0;
        bool isAac = hasAudio && IsAdts(audioPackets[0]);

        var args = $"-y -loglevel warning " +
                   $"-f h264 -framerate {frameRate} -i \"{h264Path}\"";

        string? audioTemp = null;
        string audioInput = "";

        if (hasAudio)
        {
            if (isAac)
            {
                audioTemp = Path.Combine(Path.GetTempPath(), $"dhn_audio_{Guid.NewGuid():N}.aac");
                using var fs = new FileStream(audioTemp, FileMode.Create, FileAccess.Write,
                    FileShare.Read, 256 * 1024, FileOptions.SequentialScan);
                foreach (var pkt in audioPackets)
                    fs.Write(pkt.Data, 0, pkt.Data.Length);
                audioInput = $" -i \"{audioTemp}\"";

                // Diagnóstico: verificar se o AAC temp é válido
                using var probe = new Process
                {
                    StartInfo = new ProcessStartInfo("ffprobe")
                    {
                        Arguments = $"-v error -show_entries format=duration,size -of default=noprint_wrappers=1 \"{audioTemp}\"",
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }
                };
                probe.Start();
                var probeOut = probe.StandardOutput.ReadToEnd();
                probe.WaitForExit(2000);
                Console.Error.WriteLine($"[Exporter] ffprobe aac: exit={probe.ExitCode} {probeOut.Trim().Replace("\n", " ")}");
            }
            else
            {
                var pcmData = ConvertAudioToS16Le(audioPackets);
                if (pcmData != null)
                {
                    audioTemp = Path.Combine(Path.GetTempPath(), $"dhn_audio_{Guid.NewGuid():N}.raw");
                    File.WriteAllBytes(audioTemp, pcmData);
                    audioInput = $" -f s16le -ar 48000 -ac 2 -i \"{audioTemp}\"";
                }
            }
        }

        args += audioInput +
                $" -map 0:v:0" +
                (hasAudio ? " -map 1:a:0" : "") +
                $" -c:v copy" +
                (hasAudio ? (isAac ? " -c:a copy" : " -c:a aac -b:a 192k") : "") +
                $" -fflags +genpts -movflags +faststart \"{outputPath}\"";

        Console.Error.WriteLine($"[Exporter] ffmpeg mux: {args.Replace("\"", "'")} " +
            (audioTemp != null ? $"audioTemp={new FileInfo(audioTemp).Length / 1024}KB" : "sem-audio"));

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true
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

        if (!proc.WaitForExit(300_000))
        {
            proc.Kill();
            throw new InvalidOperationException(
                $"ffmpeg não terminou em 5min");
        }

        string stderrText;
        lock (stderr) { stderrText = stderr.ToString(); }

        if (proc.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"ffmpeg exit code {proc.ExitCode}: {stderrText.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(stderrText))
            Console.Error.WriteLine($"[Exporter] ffmpeg stderr: {stderrText.Trim()}");
    }

    private static byte[]? ConvertAudioToS16Le(List<EncodedPacket> packets)
    {
        int totalBytes = 0;
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Audio) continue;
            totalBytes += pkt.Data.Length;
        }

        if (totalBytes == 0) return null;

        int sampleCount = totalBytes / 4;
        var result = new byte[sampleCount * 2];

        int dstOffset = 0;
        foreach (var pkt in packets)
        {
            if (pkt.Type != MediaType.Audio) continue;

            unsafe
            {
                fixed (byte* src = pkt.Data)
                fixed (byte* dst = result)
                {
                    var fSrc = (float*)src;
                    var sDst = (short*)(dst + dstOffset);
                    int len = pkt.Data.Length / 4;

                    for (int i = 0; i < len; i++)
                    {
                        float f = Math.Clamp(fSrc[i], -1f, 1f);
                        sDst[i] = (short)(f * 32767f);
                    }
                }
            }

            dstOffset += pkt.Data.Length / 2;
        }

        return result;
    }

    /// <summary>
    /// Creates MP4 from raw NV12 frames by encoding through ffmpeg.
    /// No MF dependency.
    /// </summary>
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
                $"ffmpeg não terminou em 5min");
        }

        if (proc.ExitCode != 0)
        {
            var err = proc.StandardError.ReadToEnd();
            throw new InvalidOperationException(
                $"ffmpeg exit code {proc.ExitCode}: {err.Trim()}");
        }

        return outputPath;
    }

    private static bool IsAdts(EncodedPacket pkt) =>
        pkt.Data.Length >= 2 && pkt.Data[0] == 0xFF && (pkt.Data[1] & 0xF0) == 0xF0;

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
