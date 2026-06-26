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
    private bool _disposed;

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

        Console.Error.WriteLine($"[RnnoiseFilter] Started: filter={filter} SR={sampleRate} Ch={channels}");
    }

    public float[] Process(float[] input)
    {
        if (_disposed || _process == null || _process.HasExited)
            return input;

        int byteLen = input.Length * 4;
        var inBytes = new byte[byteLen];
        System.Buffer.BlockCopy(input, 0, inBytes, 0, byteLen);

        try
        {
            _stdin!.Write(inBytes, 0, byteLen);
            _stdin.Flush();

            int expectedBytes = byteLen;
            int totalRead = 0;
            while (totalRead < expectedBytes)
            {
                int read = _stdout!.Read(_readBuf, _readOffset, Math.Min(_readBuf.Length - _readOffset, expectedBytes - totalRead));
                if (read <= 0) break;
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
        catch (IOException)
        {
            return input;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try { _stdin?.Dispose(); } catch { }
        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(1000);
        }
        _stdout?.Dispose();
        _process?.Dispose();
        _stdin = null;
        _stdout = null;
        _process = null;
    }
}
