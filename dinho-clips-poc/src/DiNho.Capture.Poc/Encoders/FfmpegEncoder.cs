using System.Buffers;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using DiNho.Capture.Poc.Logging;
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
    private static readonly string[] FallbackCodecs = ["h264_nvenc", "av1_nvenc", "h264_amf", "h264_qsv", "libx264"];
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

    // CRF+VBV quality params (NVENC/AV1)
    private int _cq = 24;
    private int _maxrateKbps = 50000;
    private int _bufsizeKbps = 100000;
    private int _bframes = 2;
    private int _lookahead = 4;
    private string _nvencPreset = "p4";

    // Real PTS tracking — lock-protected queue because Enqueue (pipeline thread) and Dequeue (reader thread) are different threads
    private readonly Queue<TimeSpan> _inputPtsQueue = new();
    private readonly object _ptsQueueLock = new();

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

    /// <summary>
    /// Define parâmetros de qualidade CRF+VBV para NVENC/AV1.
    /// bitrateKbps ainda é usado como fallback para AMF/QSV/libx264.
    /// </summary>
    public void SetQualityParams(int cq, int maxrateKbps, int bufsizeKbps, int bframes = 2, int lookahead = 4, string preset = "p4", string? codec = null)
    {
        _cq = cq;
        _maxrateKbps = maxrateKbps;
        _bufsizeKbps = bufsizeKbps;
        _bframes = bframes;
        _lookahead = lookahead;
        _nvencPreset = preset;
        if (!string.IsNullOrEmpty(codec) && codec != "auto")
            _codec = ResolveCodec(codec);
    }

    public void Initialize(int width, int height, int frameRate, int bitrateKbps = 2000)
    {
        _width = width;
        _height = height;
        _frameRate = frameRate;
        _bitrateKbps = bitrateKbps;
        if (_codec == null)
            _codec = DetectBestCodec();
        Log.I("FfmpegEncoder", $"codec={_codec} bitrate={_bitrateKbps}Kbps cq={_cq} maxrate={_maxrateKbps}Kbps bufsize={_bufsizeKbps}Kbps res={width}x{height}@{frameRate}fps preset={_nvencPreset}");
        StartFfmpeg();

        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "FfmpegReader"
        };
        _readerThread.Start();
        _initialized = true;

        Log.I("FfmpegEncoder", $"initialized (codec={_codec})");
    }

    // ── ffmpeg detection (cached) ────────────────────────────────────

    private static readonly Dictionary<string, bool> _encoderCache = new();
    private static string? _bestCodecCache;
    private static readonly object _cacheLock = new();

    private string DetectBestCodec()
    {
        if (!_useHardware) return "libx264";
        lock (_cacheLock)
        {
            if (_bestCodecCache != null) return _bestCodecCache;
        }

        // Vendor-aware detection: try GPU vendor's codec first
        var vendorId = EncoderManager.DetectGpuVendorId();
        var vendorCodec = EncoderManager.GetPreferredCodec(vendorId);
        if (!string.IsNullOrEmpty(vendorCodec) && CheckFfmpegEncoderCached(vendorCodec))
        {
            CacheBest(vendorCodec);
            return vendorCodec;
        }

        // Fallback chain (NVENC → AMF → QSV → libx264)
        foreach (var c in FallbackCodecs)
        {
            if (c == "libx264" || CheckFfmpegEncoderCached(c))
            {
                CacheBest(c);
                return c;
            }
        }
        CacheBest("libx264");
        return "libx264";
    }

    /// <summary>Resolve user-facing codec name to concrete ffmpeg encoder.</summary>
    private string ResolveCodec(string preferred)
    {
        if (!_useHardware) return preferred switch
        {
            "libx265" => "libx265",
            _ => "libx264"
        };

        // Map user preference to vendor-aware encoder name
        var vendorId = EncoderManager.DetectGpuVendorId();
        var result = EncoderManager.MapUserCodec(preferred, vendorId);

        if (result != null && CheckFfmpegEncoderCached(result))
            return result;

        // If preferred codec not available, fall back to DetectBestCodec
        return DetectBestCodec();
    }

    private static void CacheBest(string codec)
    {
        lock (_cacheLock) { _bestCodecCache ??= codec; }
    }

    private static bool CheckFfmpegEncoderCached(string enc)
    {
        lock (_cacheLock)
        {
            if (_encoderCache.TryGetValue(enc, out var cached)) return cached;
        }
        var result = CheckFfmpegEncoder(enc);
        lock (_cacheLock) { _encoderCache[enc] = result; }
        return result;
    }

    internal static bool CheckFfmpegEncoder(string enc)
    {
        if (string.IsNullOrWhiteSpace(enc))
            return false;
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

    private void StartFfmpeg()
    {
        /* NVENC/AV1: CRF+VBV — sem -b:v, CQ guia qualidade, maxrate/bufsize como segurança VBV.
           AMF/QSV/libx264: fallback com bitrateKbps alvo (esses codecs não têm CRF+VBV bom). */
        var bframesArg = _bframes > 0 ? $"-bf {_bframes}" : "-bf 0";
        var lookaheadArg = $"-rc-lookahead {_lookahead}";
        var tune = _codec switch
        {
            "libx264" => "-preset ultrafast -tune zerolatency -threads 1",
            "libx265" => "-preset ultrafast -tune zerolatency -x265-params no-open-gop=1:bframes=0:keyint=60:min-keyint=60",
            "h264_nvenc" => $"-preset {_nvencPreset} -rc vbr -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -profile:v high {bframesArg} {lookaheadArg} -spatial-aq 1 -temporal-aq 1 -g 60 -keyint_min 60 -sc_threshold 0",
            "hevc_nvenc" => $"-preset {_nvencPreset} -rc vbr -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -profile:v main10 {bframesArg} {lookaheadArg} -spatial-aq 1 -temporal-aq 1 -g 60 -keyint_min 60 -sc_threshold 0",
            "av1_nvenc" => $"-preset {_nvencPreset} -rc vbr -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K {bframesArg} {lookaheadArg} -spatial-aq 1 -temporal-aq 1 -g 60 -keyint_min 60 -sc_threshold 0",
            "h264_amf" => $"-quality quality -rc cqp -qp_i {Math.Clamp(_cq - 4, 0, 51)} -qp_p {Math.Clamp(_cq - 4, 0, 51)}",
            "h264_qsv" => $"-preset medium -global_quality {Math.Clamp(_cq - 4, 0, 51)}",
            _ => "-preset ultrafast -tune zerolatency -threads 1"
        };

        int cw = _cropW, ch = _cropH;
        if (cw > 0 && ch > 0)
        {
            cw = Math.Max(cw, 320);
            ch = Math.Max(ch, 240);
            Log.I("FfmpegEncoder", $"crop={cw}:{ch}:{_cropX}:{_cropY} src={_width}x{_height}");
        }
        var cropFilter = cw > 0 && ch > 0
            ? $" -vf \"crop={cw}:{ch}:{_cropX}:{_cropY}\""
            : "";

        _process = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = $"-y -loglevel warning " +
                            $"-f rawvideo -pix_fmt nv12 -s {_width}x{_height} " +
                            $"-r {_frameRate} -i pipe:0 " +
                            $"{cropFilter} -c:v {_codec} {tune} " +
                            $"-f h264 pipe:1",
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
                    Log.D("ffmpeg", $"{line}");
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
            Log.E("FfmpegEncoder", $"stdout: {ex.Message}");
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

        byte[] data = ArrayPool<byte>.Shared.Rent(_pendingLen);
        System.Buffer.BlockCopy(_pendingBuf, 0, data, 0, _pendingLen);

        long dur = 10_000_000L / _frameRate;
        // Use real PTS from input queue (pipeline clock) instead of fake CFR _outputFrameIndex * dur
        bool gotRealPts;
        TimeSpan realPts;
        lock (_ptsQueueLock) { gotRealPts = _inputPtsQueue.TryDequeue(out realPts); }
        long pts = gotRealPts ? realPts.Ticks : _outputFrameIndex * dur;
        bool key = CheckKeyFrame(data);

        _outputChannel.Writer.TryWrite(new EncodedPacket(
            data, MediaType.Video,
            TimeSpan.FromTicks(pts), TimeSpan.FromTicks(dur),
            key, isPooled: true, dataLength: _pendingLen, width: _width, height: _height));

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

        // Enfileira o PTS real antes de escrever — EmitPacket() vai desenfileirar
        lock (_ptsQueueLock) { _inputPtsQueue.Enqueue(pts); }

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
            Log.E("FfmpegEncoder", $"stdin: {ex.Message}");
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
        Log.W("FfmpegEncoder", $"falling back to codec={_codec}");
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
                Log.E("FfmpegEncoder", "max restart attempts reached, no codec fallback");
                return false;
            }
        }

        _restartAttempts++;
        Log.W("FfmpegEncoder", $"restarting ffmpeg (attempt {_restartAttempts}, cause={_processFailedCause ?? "unknown"}, gpuFails={_gpuConvertFails})");
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
            Log.I("FfmpegEncoder", "restart OK");
            return true;
        }
        catch (Exception ex)
        {
            Log.E("FfmpegEncoder", $"restart failed: {ex.Message}");
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
        lock (_ptsQueueLock) { _inputPtsQueue.Clear(); }

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
        // Crop muito pequeno: GpuVideoConverter falha com E_INVALIDARG + ffmpeg output vazio
        if ((_cropW > 0 && _cropW < 320) || (_cropH > 0 && _cropH < 240))
        {
            _gpuConvertFails++; // evita restart loop
            return null;
        }

        // Guard DIM MISMATCH: textura com dimensão diferente do esperado pelo encoder.
        // O WgcCaptureSource já faz partial copy para o ContentSize correto,
        // mas este guard previne E_OUTOFMEMORY no GpuVideoConverter se alguma
        // textura com dimensão errada chegar aqui.
        var texDesc = texture.Description;
        if (texDesc.Width != _width || texDesc.Height != _height)
        {
            _gpuConvertFails++;
            Log.W("FfmpegEncoder", $"DIM MISMATCH guard: tex={texDesc.Width}x{texDesc.Height} esperado={_width}x{_height} — frame pulado");
            return null;
        }

        var device = texture.Device;
        var ctx = device.ImmediateContext;

        try
        {
            _gpuConverter ??= new GpuVideoConverter(device, _width, _height);
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            Log.E("FfmpegEncoder", $"GpuVideoConverter constructor fail #{_gpuConvertFails}: {ex.Message}");
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
            Log.E("FfmpegEncoder", $"GPU convert fail #{_gpuConvertFails}: {ex.GetType().Name}: {ex.Message}");
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
                Log.W("FfmpegEncoder", $"ffmpeg exited code={_process.ExitCode}");
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
