using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Threading.Channels;

namespace DiNho.Capture.Poc.Encoders;

public sealed class FfmpegAacEncoder : IDisposable
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly Channel<EncodedPacket> _outputChannel =
        Channel.CreateBounded<EncodedPacket>(new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });

    private int _sampleRate;
    private int _channels;
    private bool _initialized, _disposed;
    private Thread? _readerThread;
    private CancellationTokenSource? _readerCts;
    private long _outputFrameIndex;
    private byte[]? _pcmBuf;
    private long _pcmBytesWritten;
    private int _pcmWriteErrors;
    private int _totalAacFrames;
    private volatile bool _flushing;

    public void Initialize(int sampleRate, int channels, int bitrate = 128000)
    {
        _sampleRate = sampleRate;
        _channels = channels;

        _process = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = $"-y -loglevel warning " +
                            $"-f f32le -ar {sampleRate} -ac {channels} -i pipe:0 " +
                            $"-c:a aac -b:a {bitrate} -f adts pipe:1",
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };
        _process.Start();
        try { _process.PriorityClass = ProcessPriorityClass.Normal; } catch { }

        // Read stderr asynchronously to prevent pipe deadlock
        _process.BeginErrorReadLine();
        _process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                Log.D("ffmpeg-aac-stderr", e.Data);
        };

        _stdin = _process.StandardInput.BaseStream;
        _stdout = _process.StandardOutput.BaseStream;

        Log.I("FfmpegAacEncoder", $"Initialized (ffmpeg PID={_process.Id})");

        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "AacReader"
        };
        _readerThread.Start();
        _initialized = true;
    }

    public void EncodeAudio(float[] pcmSamples)
    {
        if (!_initialized || _disposed || _flushing) return;
        int byteLen = pcmSamples.Length * 4;
        if (_pcmBuf == null || _pcmBuf.Length < byteLen)
            _pcmBuf = new byte[byteLen * 2];
        System.Buffer.BlockCopy(pcmSamples, 0, _pcmBuf, 0, byteLen);
        try
        {
            _stdin!.Write(_pcmBuf, 0, byteLen);
            _stdin.Flush();
            _pcmBytesWritten += byteLen;
        }
        catch (Exception ex)
        {
            _pcmWriteErrors++;
            Log.E("FfmpegAacEncoder", $"PCM write #{_pcmWriteErrors} failed ({byteLen} bytes, totalWrote={_pcmBytesWritten}): {ex.GetType().Name}: {ex.Message}");
        }

        if (_pcmBuf.Length > byteLen * 4 && _pcmBuf.Length > 65536)
            Array.Resize(ref _pcmBuf, Math.Max(byteLen, 65536));
    }

    public EncodedPacket? TryReadPacket()
    {
        _outputChannel.Reader.TryRead(out var pkt);
        return pkt;
    }

    public void LogStats()
    {
        Log.I("FfmpegAacEncoder", $"STATS: pcmBytesWritten={_pcmBytesWritten} aacFrames={_totalAacFrames} pcmWriteErrors={_pcmWriteErrors}");
        int ch = _channels > 0 ? _channels : 2;
        long expectedAacFrames = _pcmBytesWritten / 4 / ch / 1024;
        if (_totalAacFrames > 0 && expectedAacFrames > 0 && _totalAacFrames < expectedAacFrames * 0.95)
            Log.W("FfmpegAacEncoder", $"AAC frames ({_totalAacFrames}) << expected ({expectedAacFrames}) — PCM data may be lost");
    }

    public int FlushAndDrain(List<EncodedPacket> outBuffer)
    {
        int count = 0;
        _flushing = true;
        try
        {
            _stdin?.Dispose();
            _readerThread?.Join(1000);
        }
        catch { }

        while (_outputChannel.Reader.TryRead(out var pkt))
        {
            outBuffer.Add(pkt);
            count++;
        }
        return count;
    }

    private void ReaderLoop(CancellationToken ct)
    {
        var buf = new byte[8192];
        int offset = 0;
        int totalReads = 0, totalFrames = 0;

        while (!ct.IsCancellationRequested)
        {
            int read;
            try { read = _stdout!.Read(buf, offset, buf.Length - offset); }
            catch { break; }

            if (read == 0)
            {
                Log.I("FfmpegAacEncoder", $"ReaderLoop: stdout closed (reads={totalReads} frames={totalFrames})");
                break;
            }

            totalReads++;
            int total = offset + read;
            int pos = 0;
            int framesInChunk = 0;

            while (pos + 7 < total)
            {
                if (buf[pos] != 0xFF || (buf[pos + 1] & 0xF0) != 0xF0)
                {
                    pos++;
                    continue;
                }

                int frameLen = ((buf[pos + 3] & 0x03) << 11)
                             | (buf[pos + 4] << 3)
                             | ((buf[pos + 5] >> 5) & 0x07);

                if (frameLen < 7 || pos + frameLen > total) break;

                var data = new byte[frameLen];
                System.Buffer.BlockCopy(buf, pos, data, 0, frameLen);

                long dur = 1024L * 10_000_000 / _sampleRate;
                long pts = _outputFrameIndex * dur;

                _outputChannel.Writer.TryWrite(new EncodedPacket(
                    data, MediaType.Audio,
                    TimeSpan.FromTicks(pts), TimeSpan.FromTicks(dur),
                    false));

                _outputFrameIndex++;
                framesInChunk++;
                pos += frameLen;
            }

            totalFrames += framesInChunk;
            _totalAacFrames = totalFrames;
            if (totalReads <= 3 || framesInChunk > 0)
                Log.D("FfmpegAacEncoder", $"ReaderLoop: read={read} bytes framesInChunk={framesInChunk} totalFrames={totalFrames}");

            offset = total - pos;
            if (offset > 0 && pos < total)
                System.Buffer.BlockCopy(buf, pos, buf, 0, offset);
            else
                offset = 0;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _readerCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }
        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }
        _readerThread?.Join(1000);
        _readerCts?.Dispose();
        _process?.Dispose();
    }
}
