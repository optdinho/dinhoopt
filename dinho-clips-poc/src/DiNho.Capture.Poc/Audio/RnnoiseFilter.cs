using DiNho.Capture.Poc.Logging;
using System.Diagnostics;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Optional PCM audio filter using ffmpeg's arnndn (RNNoise) or anlmdn.
/// Wraps a long-lived ffmpeg process; input/output via stdin/stdout as f32le.
/// Safe to call Process from any thread (stdin.Write + stdout.Read are thread-safe in practice).
/// </summary>
public sealed class RnnoiseFilter : IDisposable
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly int _sampleRate;
    private readonly int _channels;
    private readonly byte[] _readBuf = new byte[65536];
    private int _readOffset;
    private volatile bool _disposed;
    private readonly CancellationTokenSource _cts = new();

    public bool Active => _process is { HasExited: false };

    public RnnoiseFilter(int sampleRate, int channels, string? modelPath = null)
    {
        _sampleRate = sampleRate;
        _channels = channels;

        var filter = !string.IsNullOrEmpty(modelPath) && File.Exists(modelPath)
            ? $"arnndn=m={modelPath}"
            : "anlmdn";

        _process = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = $"-y -loglevel error -f f32le -ar {sampleRate} -ac {channels} -i pipe:0 " +
                            $"-af {filter} -f f32le -flush_packets 1 pipe:1",
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            }
        };
        _process.Start();
        _stdin = _process.StandardInput.BaseStream;
        _stdout = _process.StandardOutput.BaseStream;

        Log.I("RnnoiseFilter", $"Started: filter={filter} SR={sampleRate} Ch={channels}");
    }

    public float[] Process(float[] input)
    {
        if (_disposed) return input;
        var stdin = _stdin;
        var stdout = _stdout;
        var process = _process;
        if (process == null || process.HasExited || stdin == null || stdout == null)
            return input;

        int byteLen = input.Length * 4;
        var inBytes = new byte[byteLen];
        System.Buffer.BlockCopy(input, 0, inBytes, 0, byteLen);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        try
        {
            cts.CancelAfter(5000);

            var writeTask = stdin.WriteAsync(inBytes, 0, byteLen, cts.Token);
            if (!writeTask.Wait(5000))
            {
                Log.W("RnnoiseFilter", "Write timeout after 5000ms, skipping frame");
                return input;
            }
            // Async flush with 1s timeout — avoids blocking if ffmpeg stdin buffer is full
            var flushTask = stdin.FlushAsync(cts.Token);
            if (!flushTask.Wait(1000))
            {
                Log.W("RnnoiseFilter", "Flush timeout after 1000ms — ffmpeg may be stuck");
            }

            int expectedBytes = byteLen;
            int totalRead = 0;
            var sw = Stopwatch.StartNew();
            while (totalRead < expectedBytes)
            {
                if (sw.ElapsedMilliseconds > 5000 || cts.Token.IsCancellationRequested)
                {
                    Log.W("RnnoiseFilter", "Read timeout after 5000ms while waiting for filtered audio — returning original frame");
                    break;
                }
                int toRead = Math.Min(_readBuf.Length - _readOffset, expectedBytes - totalRead);
                // Async read with per-call timeout — prevents indefinite block on hung ffmpeg
                var readTask = stdout.ReadAsync(_readBuf, _readOffset, toRead, cts.Token);
                if (!readTask.Wait(2000))
                {
                    Log.W("RnnoiseFilter", "ReadAsync timeout after 2000ms — returning original frame");
                    break;
                }
                int read = readTask.Result;
                if (read <= 0)
                    break;
                _readOffset += read;
                totalRead += read;
            }

            if (totalRead < 4)
                return input;

            int sampleCount = totalRead / 4;
            var result = new float[sampleCount];
            System.Buffer.BlockCopy(_readBuf, 0, result, 0, totalRead);

            if (_readOffset > totalRead)
            {
                int leftover = _readOffset - totalRead;
                System.Buffer.BlockCopy(_readBuf, totalRead, _readBuf, 0, leftover);
                _readOffset = leftover;
            }
            else
            {
                _readOffset = 0;
            }

            return result;
        }
        catch (OperationCanceledException)
        {
            Log.D("RnnoiseFilter", "Process: cancelled (timeout or disposed)");
            return input;
        }
        catch (IOException ex)
        {
            Log.D("RnnoiseFilter", $"Process: IO error: {ex.Message}");
            return input;
        }
        catch (InvalidOperationException ex)
        {
            Log.D("RnnoiseFilter", $"Process: invalid state: {ex.Message}");
            return input;
        }
        finally { cts.Dispose(); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();

        try { _stdin?.Dispose(); } catch (Exception ex) { Log.D("RnnoiseFilter", $"stdin dispose error: {ex.Message}"); }

        var process = _process;
        var stdout = _stdout;
        _stdin = null;
        _stdout = null;
        _process = null;

        if (process == null) return;

        _ = Task.Run(() =>
        {
            try
            {
                if (!process.HasExited)
                {
                    if (!process.WaitForExit(5000))
                    {
                        try { process.Kill(entireProcessTree: true); } catch (Exception ex) { Log.D("RnnoiseFilter", $"Kill error: {ex.Message}"); }
                        process.WaitForExit(1000);
                    }
                }
            }
            catch (Exception ex) { Log.D("RnnoiseFilter", $"Process stop error: {ex.Message}"); }
            finally
            {
                try { stdout?.Dispose(); } catch (Exception ex) { Log.D("RnnoiseFilter", $"stdout dispose error: {ex.Message}"); }
                process.Dispose();
            }
        });
    }
}
