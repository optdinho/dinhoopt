using System.Buffers;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

public sealed class FfmpegEncoder : IEncoder
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly Channel<EncodedPacket> _outputChannel =
        Channel.CreateBounded<EncodedPacket>(new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });

    private int _width, _height, _frameRate;
    private int _cropX, _cropY, _cropW, _cropH;
    private bool _initialized, _disposed;
    private Thread? _readerThread;
    private CancellationTokenSource? _readerCts;
    private Thread? _stderrThread;
    private CancellationTokenSource? _stderrCts;
    private string? _processFailedCause;
    private static readonly string[] FallbackCodecs = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"];
    private string _codec = "libx264";
    private readonly bool _useHardware;
    private int _bitrateKbps = 2000;

    private GpuVideoConverter? _gpuConverter;
    private ID3D11Texture2D? _nv12Staging;
    private ID3D11Texture2D? _inputCopy;
    private Format _inputCopyFormat;
    private int _inputCopyW, _inputCopyH;
    private int _stagingW, _stagingH;

    private readonly Queue<EncodedPacket> _pendingOutputs = new();
    private bool _processFailed;
    private int _frameCount;
    private int _restartAttempts;
    private long _lastRestartTicks;
    private int _gpuConvertFails;

    // H.264 parser state
    private byte[]? _pendingBuf;
    private int _pendingLen;
    private bool _hadSlice;
    private long _outputFrameIndex;

    public FfmpegEncoder(bool useHardware = true) => _useHardware = useHardware;
    public void SetD3DManager(IMFDXGIDeviceManager? manager) { }

    public void SetCropRect(int x, int y, int w, int h)
    {
        _cropX = x; _cropY = y; _cropW = w; _cropH = h;
    }

    public void Initialize(int width, int height, int frameRate, int bitrateKbps = 2000)
    {
        _width = width;
        _height = height;
        _frameRate = frameRate;
        _bitrateKbps = bitrateKbps;
        _codec = DetectBestCodec();
        StartFfmpeg();

        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "FfmpegReader"
        };
        _readerThread.Start();
        _initialized = true;

        Console.Error.WriteLine($"[FfmpegEncoder] initialized (codec={_codec})");
    }

    // ── ffmpeg detection ─────────────────────────────────────────────

    private string DetectBestCodec()
    {
        if (!_useHardware) return "libx264";

        // Vendor-aware detection: try GPU vendor's codec first
        var vendorId = EncoderManager.DetectGpuVendorId();
        var vendorCodec = EncoderManager.GetPreferredCodec(vendorId);
        if (!string.IsNullOrEmpty(vendorCodec) && CheckFfmpegEncoder(vendorCodec))
            return vendorCodec;

        // Fallback chain (NVENC → AMF → QSV → libx264)
        foreach (var c in FallbackCodecs)
            if (c == "libx264" || CheckFfmpegEncoder(c)) return c;
        return "libx264";
    }

    private static bool CheckFfmpegEncoder(string enc)
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
            return o.Contains(enc, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    // ── ffmpeg process ───────────────────────────────────────────────

    private int BitrateToQp()
    {
        return _bitrateKbps switch
        {
            >= 40000 => 17,
            >= 20000 => 18,
            >= 12000 => 19,
            >= 8000  => 20,
            >= 5000  => 22,
            >= 3000  => 25,
            _        => 28
        };
    }

    private void StartFfmpeg()
    {
        var qp = BitrateToQp();
        var tune = _codec switch
        {
            "libx264" => "-preset ultrafast -tune zerolatency -threads 1",
            "h264_nvenc" => $"-preset p4 -tune hq -rc constqp -qp {qp}",
            "h264_amf" => $"-quality quality -rc cqp -qp_i {qp} -qp_p {qp}",
            "h264_qsv" => $"-preset medium -global_quality {qp}",
            _ => "-preset ultrafast -tune zerolatency -threads 1"
        };

        var aud = _codec switch
        {
            "libx264" => "-flags +aud",
            _ => ""
        };

        if (_cropW > 0 && _cropH > 0)
        {
            Console.WriteLine($"[FfmpegEncoder] crop={_cropW}:{_cropH}:{_cropX}:{_cropY} src={_width}x{_height}");
        }
        var cropFilter = _cropW > 0 && _cropH > 0
            ? $" -vf \"crop={_cropW}:{_cropH}:{_cropX}:{_cropY}\""
            : "";

        _process = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = $"-y -loglevel warning " +
                            $"-f rawvideo -pix_fmt nv12 -s {_width}x{_height} " +
                            $"-r {_frameRate} -i pipe:0 " +
                            $"{cropFilter} -c:v {_codec} {tune} " +
                            $"{aud} -f h264 pipe:1",
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };
        _process.Start();

        try { _process.PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }

        _stdin = _process.StandardInput.BaseStream;
        _stdout = _process.StandardOutput.BaseStream;

        var stderrStream = _process.StandardError;
        _stderrCts?.Dispose();
        _stderrCts = new CancellationTokenSource();
        var stCt = _stderrCts.Token;
        _stderrThread = new Thread(() =>
        {
            try
            {
                while (!stCt.IsCancellationRequested)
                {
                    var line = stderrStream.ReadLine();
                    if (line == null) break;
                    Console.Error.WriteLine($"[ffmpeg-stderr] {line}");
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
        })
        {
            IsBackground = true,
            Name = "FfmpegStderr"
        };
        _stderrThread.Start();
    }

    // ── Reader thread: H.264 output ──────────────────────────────────

    private void ReaderLoop(CancellationToken ct)
    {
        var buf = ArrayPool<byte>.Shared.Rent(512 * 1024);

        try
        {
            while (!ct.IsCancellationRequested)
            {
                int read = _stdout!.Read(buf, 0, buf.Length);
                if (read == 0)
                {
                    _processFailed = true;
                    _processFailedCause = "reader:stdout_eof";
                    break;
                }
                ParseAnnexB(new ReadOnlySpan<byte>(buf, 0, read));
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException ex)
        {
            _processFailed = true;
            _processFailedCause = "reader:stdout_io_error";
            Console.Error.WriteLine($"[FfmpegEncoder] stdout: {ex.Message}");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buf);
            if (_pendingBuf != null)
            {
                ArrayPool<byte>.Shared.Return(_pendingBuf);
                _pendingBuf = null;
            }
            _pendingLen = 0;
            _hadSlice = false;
            LogProcessExit();
        }
    }

    private void ParseAnnexB(ReadOnlySpan<byte> data)
    {
        int pos = 0;

        // Find the first start code in this chunk. If we're in the middle of
        // a NAL unit (_hadSlice), any data before the first start code is the
        // tail of that NAL and must be appended — otherwise it's lost when the
        // scanning loop below only appends from start-code positions forward.
        int firstSC = FindNextSC(data, 0);
        if (firstSC < 0)
        {
            if (_hadSlice)
                AppendPending(data);
            return;
        }

        if (_hadSlice && firstSC > 0)
            AppendPending(data.Slice(0, firstSC));

        pos = firstSC;

        while (pos < data.Length - 3)
        {
            int scLen = ScanSC(data.Slice(pos));
            if (scLen == 0) { pos++; continue; }

            int nalStart = pos + scLen;
            if (nalStart >= data.Length - 1) break;

            int nalType = data[nalStart] & 0x1F;
            bool isSlice = nalType >= 1 && nalType <= 5;
            bool isAUD = nalType == 9;

            int nextNAL = FindNextSC(data, nalStart + 1);
            int chunkEnd = nextNAL > pos ? nextNAL : data.Length;

            if (isAUD)
            {
                pos = nalStart + 1;
                continue;
            }

            if (isSlice && _hadSlice)
                EmitPacket();

            AppendPending(data.Slice(pos, chunkEnd - pos));

            if (isSlice) _hadSlice = true;
            pos = nextNAL > pos ? nextNAL : data.Length;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static int ScanSC(ReadOnlySpan<byte> d)
    {
        if (d.Length < 3) return 0;
        if (d[0] == 0 && d[1] == 0 && d[2] == 1) return 3;
        if (d.Length >= 4 && d[0] == 0 && d[1] == 0 && d[2] == 0 && d[3] == 1) return 4;
        return 0;
    }

    private static int FindNextSC(ReadOnlySpan<byte> d, int off)
    {
        for (int i = off; i < d.Length - 2; i++)
        {
            if (d[i] != 0) continue;
            if (d[i + 1] != 0) continue;
            if (d[i + 2] == 1) return i;
            if (i + 3 < d.Length && d[i + 2] == 0 && d[i + 3] == 1) return i + 1;
        }
        return -1;
    }

    private void AppendPending(ReadOnlySpan<byte> chunk)
    {
        if (_pendingBuf == null)
        {
            _pendingBuf = ArrayPool<byte>.Shared.Rent(64 * 1024);
            _pendingLen = 0;
        }
        int need = _pendingLen + chunk.Length;
        if (need > _pendingBuf.Length)
        {
            var newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_pendingBuf.Length * 2, need));
            System.Buffer.BlockCopy(_pendingBuf, 0, newBuf, 0, _pendingLen);
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = newBuf;
        }
        chunk.CopyTo(new Span<byte>(_pendingBuf, _pendingLen, chunk.Length));
        _pendingLen += chunk.Length;
    }

    private void EmitPacket()
    {
        if (_pendingLen == 0 || !_hadSlice || _pendingBuf == null) return;

        var data = new byte[_pendingLen];
        System.Buffer.BlockCopy(_pendingBuf, 0, data, 0, _pendingLen);

        long dur = 10_000_000L / _frameRate;
        long pts = _outputFrameIndex * dur;
        bool key = CheckKeyFrame(data);

        _outputChannel.Writer.TryWrite(new EncodedPacket(
            data, MediaType.Video,
            TimeSpan.FromTicks(pts), TimeSpan.FromTicks(dur),
            key, _width, _height));

        _outputFrameIndex++;
        _pendingLen = 0;
        _hadSlice = false;
    }

    private static bool CheckKeyFrame(byte[] data)
    {
        for (int i = 0; i < data.Length - 4; i++)
        {
            if ((data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) ||
                (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1))
            {
                int off = data[i + 2] == 1 ? i + 3 : i + 4;
                if (off >= data.Length) continue;
                int t = data[off] & 0x1F;
                if (t == 5) return true;
                if (t >= 1 && t <= 5) return false;
            }
        }
        return false;
    }

    // ── Encode frame ─────────────────────────────────────────────────

    public EncodedPacket? EncodeFrame(ID3D11Texture2D texture, TimeSpan pts)
    {
        if (!_initialized) throw new InvalidOperationException("not initialized");

        if (_processFailed && !TryRestart())
            return null;

        var nv12 = ConvertGpuNv12(texture);
        if (nv12 == null) return null;

        try
        {
            _stdin!.Write(nv12);
            _stdin.Flush();
            _frameCount++;
            _restartAttempts = 0;
        }
        catch (IOException ex)
        {
            _processFailed = true;
            _processFailedCause = "encoder:stdin_io_error";
            Console.Error.WriteLine($"[FfmpegEncoder] stdin: {ex.Message}");
            LogProcessExit();
            return null;
        }

        while (_outputChannel.Reader.TryRead(out var pkt))
            _pendingOutputs.Enqueue(pkt);

        if (_pendingOutputs.Count > 0)
            return _pendingOutputs.Dequeue();
        return null;
    }

    // ── Codec fallback chain ─────────────────────────────────────────

    private bool TryFallbackCodec()
    {
        int idx = Array.IndexOf(FallbackCodecs, _codec);
        if (idx < 0 || idx >= FallbackCodecs.Length - 1) return false;
        _codec = FallbackCodecs[idx + 1];
        _restartAttempts = 0;
        Console.Error.WriteLine($"[FfmpegEncoder] falling back to codec={_codec}");
        return true;
    }

    // ── Watchdog: auto-restart on crash ──────────────────────────────

    private bool TryRestart()
    {
        if (_disposed) return false;

        long now = Stopwatch.GetTimestamp();
        long elapsedSec = (now - _lastRestartTicks) / Stopwatch.Frequency;
        int delaySec = 1 << Math.Min(_restartAttempts, 4);

        if (_restartAttempts > 0 && elapsedSec < delaySec)
        {
            _outputChannel.Reader.TryRead(out _);
            return false;
        }

        if (_restartAttempts >= 5)
        {
            if (!TryFallbackCodec())
            {
                Console.Error.WriteLine("[FfmpegEncoder] max restart attempts reached, no codec fallback");
                return false;
            }
        }

        _restartAttempts++;
        Console.Error.WriteLine($"[FfmpegEncoder] restarting ffmpeg (attempt {_restartAttempts}, cause={_processFailedCause ?? "unknown"}, gpuFails={_gpuConvertFails})");
        StopFfmpeg();
        ResetState();

        try
        {
            StartFfmpeg();
            _readerCts = new CancellationTokenSource();
            _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
            {
                IsBackground = true,
                Name = "FfmpegReader"
            };
            _readerThread.Start();
            _processFailed = false;
            _lastRestartTicks = Stopwatch.GetTimestamp();
            Console.Error.WriteLine("[FfmpegEncoder] restart OK");
            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[FfmpegEncoder] restart failed: {ex.Message}");
            return false;
        }
    }

    private void StopFfmpeg()
    {
        _readerCts?.Cancel();
        _stderrCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }
        try { _stdout?.Dispose(); } catch { }

        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }

        _readerThread?.Join(1000);
        _stderrThread?.Join(500);
        _readerCts?.Dispose();
        _stderrCts?.Dispose();
        _process?.Dispose();
        _readerCts = null;
        _stderrCts = null;
        _readerThread = null;
        _stderrThread = null;
        _process = null;
        _stdin = null;
        _stdout = null;
    }

    private void ResetState()
    {
        _processFailed = false;
        _processFailedCause = null;
        _gpuConvertFails = 0;
        _frameCount = 0;
        _outputFrameIndex = 0;
        _hadSlice = false;
        _pendingLen = 0;
        _pendingOutputs.Clear();

        while (_outputChannel.Reader.TryRead(out _)) { }

        // Fresh GPU converter after each restart to avoid stale MFT state
        _gpuConverter?.Dispose();
        _gpuConverter = null;
        _nv12Staging?.Dispose();
        _nv12Staging = null;
        _inputCopy?.Dispose();
        _inputCopy = null;
    }

    // ── GPU NV12 conversion only (no CPU fallback) ───────────────────

    private unsafe byte[]? ConvertGpuNv12(ID3D11Texture2D texture)
    {
        var device = texture.Device;
        var ctx = device.ImmediateContext;

        try
        {
            _gpuConverter ??= new GpuVideoConverter(device, _width, _height);
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            Console.Error.WriteLine($"[FfmpegEncoder] GpuVideoConverter constructor fail #{_gpuConvertFails}: {ex.Message}");
            return null;
        }

        try
        {
            // Freeze the WGC texture immediately
            EnsureInputCopy(texture, device);
            ctx.CopyResource(_inputCopy, texture);
            ctx.Flush();

            var nv12Tex = _gpuConverter.Convert(_inputCopy);
            EnsureStaging(device);
            ctx.CopyResource(_nv12Staging, nv12Tex);
            ctx.Flush();

            var map = ctx.Map(_nv12Staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            _gpuConvertFails = 0;
            try
            {
                return PackNv12(map);
            }
            finally { ctx.Unmap(_nv12Staging, 0); }
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            Console.Error.WriteLine($"[FfmpegEncoder] GPU convert fail #{_gpuConvertFails}: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }

    private void EnsureInputCopy(ID3D11Texture2D texture, ID3D11Device device)
    {
        var desc = texture.Description;
        if (_inputCopy != null && _inputCopyW == desc.Width && _inputCopyH == desc.Height && _inputCopyFormat == desc.Format)
            return;
        _inputCopy?.Dispose();
        _inputCopy = device.CreateTexture2D(new Texture2DDescription
        {
            Width = desc.Width,
            Height = desc.Height,
            MipLevels = 1,
            ArraySize = 1,
            Format = desc.Format,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.None,
        });
        _inputCopyW = desc.Width;
        _inputCopyH = desc.Height;
        _inputCopyFormat = desc.Format;
    }

    private void EnsureStaging(ID3D11Device device)
    {
        if (_nv12Staging != null && _stagingW == _width && _stagingH == _height) return;
        _nv12Staging?.Dispose();
        _nv12Staging = device.CreateTexture2D(new Texture2DDescription
        {
            Width = _width, Height = _height, MipLevels = 1, ArraySize = 1,
            Format = Format.NV12,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Staging,
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.Read,
        });
        _stagingW = _width;
        _stagingH = _height;
    }

    private unsafe byte[] PackNv12(MappedSubresource map)
    {
        int srcPitch = map.RowPitch;
        int ySize = _height * _width;
        var result = new byte[ySize + _height / 2 * _width];
        var src = (byte*)map.DataPointer.ToPointer();

        for (int y = 0; y < _height; y++)
            Unsafe.CopyBlockUnaligned(
                ref result[y * _width],
                ref src[y * srcPitch],
                (uint)_width);

        int uvSrcBase = srcPitch * _height;
        for (int y = 0; y < _height / 2; y++)
            Unsafe.CopyBlockUnaligned(
                ref result[ySize + y * _width],
                ref src[uvSrcBase + y * srcPitch],
                (uint)_width);

        return result;
    }

    // ── Cleanup ──────────────────────────────────────────────────────

    private void LogProcessExit()
    {
        if (_process == null) return;
        try
        {
            if (_process.HasExited)
                Console.Error.WriteLine($"[FfmpegEncoder] ffmpeg exited code={_process.ExitCode}");
        }
        catch { }
    }

    public void Flush()
    {
        // Close stdin to signal EOF to ffmpeg (like the working PowerShell test)
        try { _stdin?.Dispose(); } catch { }

        // Wait for reader thread to finish (ffmpeg will close stdout after EOF on stdin)
        if (_readerThread?.IsAlive == true)
            _readerThread.Join(5000);

        // Emit any remaining packet
        if (_pendingLen > 0 && _hadSlice)
            EmitPacket();

        // Collect remaining packets from the channel
        while (_outputChannel.Reader.TryRead(out var pkt))
            _pendingOutputs.Enqueue(pkt);

        // Restart ffmpeg for next capture session
        StopFfmpeg();
        ResetState();
        StartFfmpeg();
        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "FfmpegReader"
        };
        _readerThread.Start();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _readerCts?.Cancel();
        _stderrCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }

        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }

        _readerThread?.Join(1000);
        _stderrThread?.Join(500);
        _readerCts?.Dispose();
        _stderrCts?.Dispose();
        _process?.Dispose();
        _gpuConverter?.Dispose();
        _nv12Staging?.Dispose();
        _inputCopy?.Dispose();
    }
}
