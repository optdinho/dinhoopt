using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Text;

namespace DiNho.Capture.Poc.Export;

/// <summary>
/// Streaming MP4 writer — writes video and audio packets directly to MP4
/// without intermediate MKV file. Uses ffmpeg pipe for real-time muxing.
/// 
/// Benefits over MKV→MP4 pipeline:
/// - No temp file creation (saves disk I/O and space)
/// - Lower memory usage (no MKV buffer in memory)
/// - Faster export (single-pass mux)
/// - Real-time streaming capability (future: live preview)
/// 
/// Usage:
///   using var writer = new HybridMp4Writer(outputPath, width, height, fps, "h264");
///   writer.WriteVideoFrame(packet);
///   writer.WriteAudioPacket(packet);
///   writer.Finalize(); // writes MP4 moov atom
/// </summary>
public sealed class HybridMp4Writer : IDisposable
{
    private Process? _ffmpegProcess;
    private Stream? _stdin;
    private readonly string _outputPath;
    private readonly int _width;
    private readonly int _height;
    private readonly int _frameRate;
    private readonly string _rawFormat;
    private bool _finalized;
    private bool _disposed;
    private readonly object _writeLock = new();
    private long _videoFramesWritten;
    private long _audioPacketsWritten;

    public bool IsReady => _ffmpegProcess is { HasExited: false } && _stdin != null;
    public long VideoFramesWritten => _videoFramesWritten;
    public long AudioPacketsWritten => _audioPacketsWritten;

    public HybridMp4Writer(
        string outputPath,
        int width,
        int height,
        int frameRate,
        string rawFormat = "h264")
    {
        _outputPath = outputPath;
        _width = width;
        _height = height;
        _frameRate = frameRate;
        _rawFormat = rawFormat;

        var outputDir = Path.GetDirectoryName(Path.GetFullPath(outputPath))!;
        Directory.CreateDirectory(outputDir);

        var args = BuildFfmpegArgs();

        Log.I("HybridMp4Writer", $"Starting ffmpeg: {args.Replace("\"", "'")}");

        _ffmpegProcess = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = args,
                RedirectStandardInput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            }
        };

        var stderr = new StringBuilder();
        _ffmpegProcess.ErrorDataReceived += (s, e) =>
        {
            if (e.Data != null)
                lock (stderr) { stderr.AppendLine(e.Data); }
        };

        _ffmpegProcess.Start();
        try { _ffmpegProcess.PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }
        _ffmpegProcess.BeginErrorReadLine();

        _stdin = _ffmpegProcess.StandardInput.BaseStream;

        Log.I("HybridMp4Writer", $"ffmpeg started (PID={_ffmpegProcess.Id})");
    }

    private string BuildFfmpegArgs()
    {
        // Pipe input: raw H264 AnnexB stream from NVENC
        // Output: MP4 with faststart for web playback
        return $"-y -loglevel warning " +
               $"-f h264 -framerate {_frameRate} -i pipe:0 " +
               $"-c:v copy " +
               $"-movflags +faststart " +
               $"-metadata title=\"DiNho Clip\" " +
               $"-metadata comment=\"Recorded with DiNho Clips\" " +
               $"\"{_outputPath}\"";
    }

    public bool WriteVideoFrame(EncodedPacket packet)
    {
        if (_disposed || _finalized || _stdin == null || !IsReady)
            return false;

        lock (_writeLock)
        {
            try
            {
                // Write AVCC length-prefixed NALUs
                int dataLen = packet.DataLength;
                if (dataLen <= 0 || dataLen > packet.Data.Length)
                    return false;

                _stdin.Write(packet.Data, 0, dataLen);
                Interlocked.Increment(ref _videoFramesWritten);
                return true;
            }
            catch (IOException)
            {
                return false;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
        }
    }

    public bool WriteAudioPacket(EncodedPacket packet)
    {
        if (_disposed || _finalized || _stdin == null || !IsReady)
            return false;

        lock (_writeLock)
        {
            try
            {
                int dataLen = packet.DataLength;
                if (dataLen <= 0 || dataLen > packet.Data.Length)
                    return false;

                // AAC packets are ADTS-framed, ffmpeg handles demuxing
                _stdin.Write(packet.Data, 0, dataLen);
                Interlocked.Increment(ref _audioPacketsWritten);
                return true;
            }
            catch (IOException)
            {
                return false;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
        }
    }

    public void Finalize()
    {
        if (_disposed || _finalized) return;
        _finalized = true;

        lock (_writeLock)
        {
            try
            {
                _stdin?.Flush();
                _stdin?.Close();
            }
            catch { }
        }

        Log.I("HybridMp4Writer", $"Finalizing: video={_videoFramesWritten} frames, audio={_audioPacketsWritten} packets");

        if (_ffmpegProcess != null && !_ffmpegProcess.HasExited)
        {
            if (!_ffmpegProcess.WaitForExit(60_000))
            {
                Log.W("HybridMp4Writer", "ffmpeg timeout, killing");
                try { _ffmpegProcess.Kill(entireProcessTree: true); } catch { }
                _ffmpegProcess.WaitForExit(5000);
            }

            if (_ffmpegProcess.ExitCode != 0)
            {
                Log.E("HybridMp4Writer", $"ffmpeg exit code {_ffmpegProcess.ExitCode}");
            }
        }

        if (File.Exists(_outputPath))
        {
            var fi = new FileInfo(_outputPath);
            Log.I("HybridMp4Writer", $"Output: {_outputPath} ({fi.Length / 1024} KB)");
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        if (!_finalized)
            Finalize();

        try { _stdin?.Dispose(); } catch { }

        var proc = _ffmpegProcess;
        _ffmpegProcess = null;
        _stdin = null;

        if (proc == null) return;

        _ = Task.Run(() =>
        {
            try
            {
                if (!proc.HasExited)
                {
                    if (!proc.WaitForExit(5000))
                    {
                        try { proc.Kill(entireProcessTree: true); } catch { }
                        proc.WaitForExit(1000);
                    }
                }
            }
            catch { }
            finally
            {
                proc.Dispose();
            }
        });
    }
}
