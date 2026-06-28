using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using DiNho.Capture.Poc.Export;
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
    private bool _initialized;
    private volatile bool _disposed;
    private Thread? _readerThread;
    private CancellationTokenSource? _readerCts;
    private Thread? _stderrThread;
    private CancellationTokenSource? _stderrCts;
    private string? _processFailedCause;
    private static readonly string[] FallbackCodecs = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"];
    private string? _codec;
    private readonly bool _useHardware;
    private int _bitrateKbps = 2000;

    private GpuVideoConverter? _gpuConverter;
    private ID3D11Texture2D? _nv12Staging;
    private ID3D11Texture2D? _inputCopy;
    private int _inputCopyW, _inputCopyH, _stagingW, _stagingH;
    private Format _inputCopyFormat;

    private readonly Queue<EncodedPacket> _pendingOutputs = new();
    private bool _processFailed;
    private int _frameCount;
    private int _restartAttempts;
    private long _lastRestartTicks;
    private int _gpuConvertFails;

    // CRF+VBV quality params (NVENC/AV1)
    private int _cq = 24;
    private int _maxrateKbps = 80000;
    private int _bufsizeKbps = 100000;
    private int _bframes = 0;
    private int _lookahead = 0;
    private string _nvencPreset = "p2";

    // Reusable NV12 scratch buffer — elimina alocação de 3.1MB no LOH a cada frame
    private byte[]? _nv12Scratch;

    // Real PTS tracking — ConcurrentQueue because Enqueue (pipeline thread) and Dequeue (reader thread) are different threads
    private readonly ConcurrentQueue<TimeSpan> _inputPtsQueue = new();
    private long _lastRealPtsTicks = -1; // Last known real PTS for extrapolation when queue is drained

    // H.264 parser state
    private byte[]? _pendingBuf;   // AVCC frame assembly buffer (ParseAvcc → EmitPacket)
    private int _pendingLen;
    private bool _hadSlice;
    private long _outputFrameIndex;

    // Raw AnnexB/AVCC accumulation buffer — handles pipe splits that land mid-NALU
    private byte[]? _rawBuf;
    private int _rawLen;

    // Format latch — ffmpeg -f h264 with -bsf:v should output AnnexB, but sometimes
    // frames slip through in AVCC format. We detect once and latch.
    private enum PipeFormat { Unknown, AnnexB, Avcc }
    private PipeFormat _pipeFormat;

    // Cached avcC (AVCDecoderConfigurationRecord) extracted from the first SPS/PPS encountered.
    // Needed by clip exporter when the rolling replay buffer has evicted the initial packet.
    private byte[]? _cachedSps;
    private byte[]? _cachedPps;
    private byte[]? _cachedAvcc;

    public FfmpegEncoder(bool useHardware = true) => _useHardware = useHardware;
    public byte[]? AvccCache => _cachedAvcc;
    private bool IsHevc => _codec is "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "libx265";
    private bool IsAv1 => _codec is "av1_nvenc" or "libsvtav1";
    public string RawFormat => IsHevc ? "hevc" : IsAv1 ? "av1" : "h264";
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
        Log.I("FfmpegEncoder", $"codec={_codec} bitrate={_bitrateKbps}Kbps cq={_cq} maxrate={_maxrateKbps}Kbps bufsize={_bufsizeKbps}Kbps res={width}x{height}@{frameRate}fps preset={_nvencPreset} _useHardware={_useHardware}");
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
            "h264_nvenc" => $"-preset p2 -tune ll -rc vbr -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -profile:v high -bf 0 -rc-lookahead 0 -spatial-aq 0 -temporal-aq 0 -zerolatency 1 -g 60 -keyint_min 60",
            "hevc_nvenc" => $"-preset p2 -tune ll -rc vbr -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -profile:v main10 -bf 0 -rc-lookahead 0 -spatial-aq 0 -temporal-aq 0 -zerolatency 1 -g 60 -keyint_min 60",
            "av1_nvenc" => $"-preset p2 -tune ll -rc vbr -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -bf 0 -rc-lookahead 0 -spatial-aq 0 -temporal-aq 0 -zerolatency 1 -g 60 -keyint_min 60",
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

        var rawFmt = _codec switch
        {
            "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "libx265" => "hevc",
            "av1_nvenc" or "libsvtav1" => "av1",
            _ => "h264"
        };

        // NVENC/AMF/QSV produce AVCC (4-byte length prefix) natively.
        // h264_mp4toannexb/hevc_mp4toannexb converts to AnnexB so the ReaderLoop
        // always gets start-code delimited data — no heuristic AVCC scan needed.
        string bsfArg = rawFmt switch
        {
            "hevc" => " -bsf:v hevc_mp4toannexb",
            "av1" => "",
            _ => " -bsf:v h264_mp4toannexb"
        };

        _process = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = $"-y -loglevel info " +
                            $"-f rawvideo -pix_fmt nv12 -s {_width}x{_height} " +
                            $"-r {_frameRate} -i pipe:0 " +
                            $"{cropFilter} -c:v {_codec} {tune} " +
                            $"-f {rawFmt}{bsfArg} pipe:1",
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };
        Log.I("FfmpegEncoder", $"ffmpeg args: {_process.StartInfo.Arguments}");

        _process.Start();

        try { _process.PriorityClass = ProcessPriorityClass.Normal; } catch { }

        _stdin = _process.StandardInput.BaseStream;
        _stdout = new BufferedStream(_process.StandardOutput.BaseStream, 2 * 1024 * 1024);

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
                    if (line.Length > 0)
                        Log.D("ffmpeg", line);
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

    /// <summary>Check if buffer starts with an AnnexB start code (00 00 01 or 00 00 00 01).</summary>
    internal static bool IsAnnexB(byte[] buf, int len)
    {
        if (len < 3) return false;
        if (buf[0] != 0 || buf[1] != 0) return false;
        if (buf[2] == 1) return true;
        return len >= 4 && buf[2] == 0 && buf[3] == 1;
    }

    /// <summary>Scan entire buffer for any AnnexB start code (00 00 01 or 00 00 00 01).
    /// Returns true and the position of the first start code if found.</summary>
    internal static bool ScanForStartCode(byte[] buf, int len, out int position)
    {
        position = -1;
        int end = len - 2;
        for (int i = 0; i < end; i++)
        {
            if (buf[i] != 0 || buf[i + 1] != 0) continue;
            if (buf[i + 2] == 1) { position = i; return true; }
            if (i + 3 < len && buf[i + 2] == 0 && buf[i + 3] == 1) { position = i; return true; }
        }
        return false;
    }

    /// <summary>Convert AnnexB (start-code delimited) to AVCC (4-byte length-prefixed) in-place.
    /// Returns the length of valid AVCC data, or 0 if no complete NALU was found (buffer ends mid-NALU).</summary>
    internal static int ConvertAnnexBToAvcc(byte[] buf, int length, out int consumed)
    {
        int readPos = 0, writePos = 0;
        // When the buffer starts with orphaned tail (no start code at pos 0),
        // the data before the first start code is a continuation from a previous
        // call where the preceding start code was already consumed. Treat it as
        // a valid NALU by setting foundFirstSc=true when firstScPos > 0.
        int firstScPos = -1;
        for (int i = 0; i < length - 2; i++)
        {
            if (buf[i] != 0) continue;
            if (buf[i + 1] != 0) continue;
            if (buf[i + 2] == 1) { firstScPos = i; break; }
            if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { firstScPos = i; break; }
        }
        bool foundFirstSc = firstScPos != 0;

        while (readPos + 2 < length)
        {
            // Scan for next start code from current read position
            int scPos = -1, scLen = 3;
            int scanEnd = length - 2;
            for (int i = readPos; i < scanEnd; i++)
            {
                if (buf[i] != 0) continue;
                if (buf[i + 1] != 0) continue;
                if (buf[i + 2] == 1) { scPos = i; scLen = 3; break; }
                if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { scPos = i; scLen = 4; break; }
            }

            if (scPos < 0)
            {
                // No more start codes found — remaining data is incomplete NALU
                consumed = readPos;
                return writePos;
            }

            int nalLen = scPos - readPos;
            if (nalLen > 0 && foundFirstSc)
            {
                // Move NAL data toward start of buffer first (BlockCopy handles
                // overlapping source/dest via internal temp buffer). Then write
                // 4-byte big-endian length prefix — order matters because the
                // length prefix write at [writePos..writePos+3] may overlap the
                // source [readPos..readPos+3] when NALUs are small.
                if (readPos != writePos + 4)
                    System.Buffer.BlockCopy(buf, readPos, buf, writePos + 4, nalLen);
                buf[writePos] = (byte)(nalLen >> 24);
                buf[writePos + 1] = (byte)(nalLen >> 16);
                buf[writePos + 2] = (byte)(nalLen >> 8);
                buf[writePos + 3] = (byte)nalLen;
                writePos += 4 + nalLen;
            }

            readPos = scPos + scLen;
            foundFirstSc = true;
        }

        consumed = readPos;
        return writePos;
    }

    private void ReaderLoop(CancellationToken ct)
    {
        var buf = ArrayPool<byte>.Shared.Rent(2 * 1024 * 1024);
        bool firstData = true;

        try
        {
            while (!ct.IsCancellationRequested)
            {
                int read = _stdout!.Read(buf, 0, buf.Length);
                if (read == 0)
                {
                    _processFailed = true;
                    _processFailedCause = "reader:stdout_eof";
                    Log.W("FfmpegEncoder", $"stdout EOF after {_frameCount} frames written, {_outputFrameIndex} packets emitted");
                    break;
                }

                if (_disposed) break;

                if (firstData)
                {
                    firstData = false;
                    int rawHexLen = Math.Min(read, 32);
                    var rawHex = Convert.ToHexString(buf.AsSpan(0, rawHexLen));
                    Log.I("FfmpegEncoder", $"reader first data: {read}B, rawHex={rawHex}");
                }

                // Step 1: Append raw data to persistent raw buffer (handles pipe splits)
                if (_rawBuf == null)
                {
                    _rawBuf = ArrayPool<byte>.Shared.Rent(Math.Max(512 * 1024, read));
                    _rawLen = 0;
                }
                int need = _rawLen + read;
                if (need > _rawBuf.Length)
                {
                    byte[] newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_rawBuf.Length * 2, need));
                    System.Buffer.BlockCopy(_rawBuf, 0, newBuf, 0, _rawLen);
                    ArrayPool<byte>.Shared.Return(_rawBuf);
                    _rawBuf = newBuf;
                }
                System.Buffer.BlockCopy(buf, 0, _rawBuf, _rawLen, read);
                _rawLen = need;

                // Step 2: Detect format once, then latch.
                // The -bsf:v h264_mp4toannexb in ffmpeg args should always
                // produce AnnexB, but some versions of ffmpeg still output
                // native AVCC for occasional frames. We handle both.
                if (_pipeFormat == PipeFormat.Unknown && _rawLen >= 64)
                {
                    // Scan first 128 bytes (or less) for AnnexB start code
                    int scanLen = Math.Min(_rawLen, 128);
                    _pipeFormat = ScanForStartCode(_rawBuf, scanLen, out _)
                        ? PipeFormat.AnnexB
                        : PipeFormat.Avcc;
                    Log.I("FfmpegEncoder", $"pipe format latched: {_pipeFormat} (codec={_codec})");
                }

                if (_pipeFormat == PipeFormat.Unknown)
                {
                    // Too little data to detect format — accumulate more
                    continue;
                }

                if (_pipeFormat == PipeFormat.AnnexB)
                {
                    // AnnexB path: convert to AVCC, parse, keep orphaned tail
                    int avccLen = ConvertAnnexBToAvcc(_rawBuf, _rawLen, out int consumed);
                    if (avccLen > 0)
                        ParseAvcc(new ReadOnlySpan<byte>(_rawBuf, 0, avccLen));
                    int orphaned = _rawLen - consumed;
                    if (orphaned > 0)
                        System.Buffer.BlockCopy(_rawBuf, consumed, _rawBuf, 0, orphaned);
                    _rawLen = orphaned;
                }
                else
                {
                    // AVCC path: parse length-prefixed NALUs directly.
                    // Pipe writes are complete frames so orphaned tails are rare;
                    // ParseAvcc handles incomplete tails via _pendingBuf.
                    ParseAvcc(new ReadOnlySpan<byte>(_rawBuf, 0, _rawLen));
                    _rawLen = 0;
                }
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
            if (_rawBuf != null)
            {
                ArrayPool<byte>.Shared.Return(_rawBuf);
                _rawBuf = null;
            }
            _pendingLen = 0;
            _rawLen = 0;
            _hadSlice = false;
            LogProcessExit();
        }
    }

    private void ParseAvcc(ReadOnlySpan<byte> data)
    {
        int pos = 0;
        int firstHex = data.Length >= 4 ? (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3] : -1;
        Log.D("FfmpegEncoder", $"ParseAvcc: dataLen={data.Length} first4Bytes=0x{firstHex:X8} pending={_pendingLen} hadSlice={_hadSlice}");

        while (pos + 4 <= data.Length)
        {
            // Read 4-byte big-endian NAL unit length (AVCC format)
            int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            int totalSize = 4 + nalLen;

            if (nalLen <= 0 || pos + totalSize > data.Length)
            {
                // Incomplete NALU at end of chunk — cache for next read
                if (pos < data.Length)
                {
                    int tailLen = data.Length - pos;
                    Log.W("FfmpegEncoder", $"ParseAvcc: incomplete NALU at pos={pos} nalLen={nalLen} tailLen={tailLen} — appending to pending");
                    AppendPending(data.Slice(pos));
                }
                break;
            }

            int nalType = IsHevc ? (data[pos + 4] >> 1) & 0x3F : data[pos + 4] & 0x1F;
            bool isSlice = IsHevc ? nalType <= 9 : nalType >= 1 && nalType <= 5;
            bool isAUD = IsHevc ? nalType == 35 : nalType == 9;

            if (_outputFrameIndex == 0 && _frameCount < 10)
                Log.D("FfmpegEncoder", $"ParseAvcc: codec={_codec} NAL type={nalType} isSlice={isSlice} isAUD={isAUD} nalLen={nalLen} pos={pos} hadSlice={_hadSlice}");

            if (isAUD)
            {
                // AUD (Access Unit Delimiter, NAL type 9) marks frame boundary.
                // Primary emit trigger — more reliable than waiting for next slice.
                if (_hadSlice)
                    EmitPacket();
                // Do NOT append AUD to pending (delimiter only, no frame data)
            }
            else
            {
                // Cache SPS/PPS for avcC fallback (H264/HEVC only; AV1 uses OBU, no SPS/PPS)
                if (_cachedAvcc == null && !IsAv1)
                {
                    int spsType = IsHevc ? 33 : 7;
                    int ppsType = IsHevc ? 34 : 8;
                    if (nalType == spsType && _cachedSps == null)
                    {
                        _cachedSps = new byte[nalLen];
                        data.Slice(pos + 4, nalLen).CopyTo(_cachedSps);
                    }
                    else if (nalType == ppsType && _cachedPps == null)
                    {
                        _cachedPps = new byte[nalLen];
                        data.Slice(pos + 4, nalLen).CopyTo(_cachedPps);
                    }
                    if (_cachedSps != null && _cachedPps != null)
                        _cachedAvcc = ClipExporter.BuildAvcc(_cachedSps, _cachedPps);
                }

                // Frame boundary (fallback): new slice NALU while one is pending → emit
                if (isSlice && _hadSlice)
                    EmitPacket();

                // PPS emit trigger: when PPS arrives after we already have slice data,
                // it signals a new access unit. Handles streams where AUD is absent.
                int ppsNalType = IsHevc ? 34 : 8;
                if (nalType == ppsNalType && _hadSlice)
                    EmitPacket();

                AppendPending(data.Slice(pos, totalSize));
                if (isSlice) _hadSlice = true;
            }

            pos += totalSize;
        }
    }

    private void AppendPending(ReadOnlySpan<byte> chunk)
    {
        if (_pendingBuf == null)
        {
            _pendingBuf = ArrayPool<byte>.Shared.Rent(64 * 1024);
            _pendingLen = 0;
        }
        if (_pendingLen > 50 * 1024 * 1024)
        {
            Log.W("FfmpegEncoder", $"AppendPending: pendingLen={_pendingLen} exceeds 50MB — resetting to prevent OOM");
            _pendingLen = 0;
            _hadSlice = false;
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

    /// <summary>Checks that pending buffer contains at least one valid slice NALU (type 1-5).
    /// Prevents emitting partial packets that only have SPS/PPS/SEI without frame data.</summary>
    private bool CheckPendingHasSlice()
    {
        if (_pendingBuf == null || _pendingLen == 0) return false;
        if (IsAv1) return true;
        int pos = 0;
        while (pos + 4 <= _pendingLen)
        {
            int nalLen = (_pendingBuf[pos] << 24) | (_pendingBuf[pos + 1] << 16) | (_pendingBuf[pos + 2] << 8) | _pendingBuf[pos + 3];
            if (nalLen <= 0 || pos + 4 + nalLen > _pendingLen) break;
            int nalType = IsHevc ? (_pendingBuf[pos + 4] >> 1) & 0x3F : _pendingBuf[pos + 4] & 0x1F;
            if (IsHevc ? nalType <= 9 : nalType >= 1 && nalType <= 5) return true;
            pos += 4 + nalLen;
        }
        return false;
    }

    private void EmitPacket()
    {
        if (_pendingLen == 0 || !_hadSlice || _pendingBuf == null) return;
        if (!CheckPendingHasSlice()) return;

        byte[] data = ArrayPool<byte>.Shared.Rent(_pendingLen);
        System.Buffer.BlockCopy(_pendingBuf, 0, data, 0, _pendingLen);

        long dur = 10_000_000L / _frameRate;
        // Use real PTS from input queue (pipeline clock). When queue is drained
        // (e.g., after ffmpeg restart), extrapolate from last known real PTS to
        // prevent non-monotonic timestamps that would corrupt the Matroska writer.
        bool gotRealPts = _inputPtsQueue.TryDequeue(out var realPts);
        long pts;
        if (gotRealPts)
        {
            pts = realPts.Ticks;
            _lastRealPtsTicks = pts;
        }
        else if (_lastRealPtsTicks >= 0)
        {
            pts = _lastRealPtsTicks + dur;
            _lastRealPtsTicks = pts;
        }
        else
        {
            pts = _outputFrameIndex * dur;
        }
        bool key = CheckKeyFrame(data);

        _outputChannel.Writer.TryWrite(new EncodedPacket(
            data, MediaType.Video,
            TimeSpan.FromTicks(pts), TimeSpan.FromTicks(dur),
            key, isPooled: true, dataLength: _pendingLen, width: _width, height: _height));

        long ptsMs = pts / 10_000;
        if (_outputFrameIndex < 10 || _outputFrameIndex % 300 == 1)
            Log.I("FfmpegEncoder", $"EmitPacket #{_outputFrameIndex} pts={ptsMs}ms len={_pendingLen}B key={key} hadSlice={_hadSlice}");

        _outputFrameIndex++;
        _pendingLen = 0;
        _hadSlice = false;
    }

    private bool CheckKeyFrame(byte[] data)
    {
        if (IsAv1) return false;
        int pos = 0;
        while (pos + 5 <= data.Length)
        {
            int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            if (nalLen <= 0) break;
            int nalStart = pos + 4;
            if (IsHevc)
            {
                int t = (data[nalStart] >> 1) & 0x3F;
                if (t == 19 || t == 20) return true;
                if (t <= 9) return false;
            }
            else
            {
                int t = data[nalStart] & 0x1F;
                if (t == 5) return true;
                if (t >= 1 && t <= 5) return false;
            }
            pos = nalStart + nalLen;
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
            // Só enfileira o PTS depois que o Write for bem-sucedido —
            // se falhar, o EmitPacket() nunca vai desenfileirar e o PTS
            // ficaria órfão na fila, corrompendo o sync dos frames seguintes
            _inputPtsQueue.Enqueue(pts);
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
        {
            if (_pendingOutputs.Count < 32)
                _pendingOutputs.Enqueue(pkt);
            else
                pkt.Release();
        }

        if (_pendingOutputs.Count > 0)
            return _pendingOutputs.Dequeue();
        if (!_processFailed)
        {
            if (_frameCount % 300 == 1)
            {
                bool exited = _process?.HasExited == true;
                string exitInfo = exited ? $" exited={_process!.ExitCode}" : "";
                int first4 = _pendingBuf != null && _pendingLen >= 4 ? (_pendingBuf[0] << 24) | (_pendingBuf[1] << 16) | (_pendingBuf[2] << 8) | _pendingBuf[3] : 0;
                Log.W("FfmpegEncoder", $"no output packets after {_frameCount} frames written — ffmpeg exited={exited}{exitInfo}, pendingBytes={_pendingLen}, hadSlice={_hadSlice}, frameIndex={_outputFrameIndex}, pendingFirst4=0x{first4:X8}");
            }
        }
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
        _pipeFormat = PipeFormat.Unknown;
        if (_pendingBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = null;
        }
        _pendingLen = 0;
        while (_pendingOutputs.Count > 0)
            _pendingOutputs.Dequeue().Release();

        while (_inputPtsQueue.TryDequeue(out _)) { }

        while (_outputChannel.Reader.TryRead(out var pkt))
            pkt.Release();

        // Fresh GPU converter after each restart to avoid stale MFT state
        _gpuConverter?.Dispose();
        _gpuConverter = null;
        _nv12Staging?.Dispose();
        _nv12Staging = null;
        _inputCopy?.Dispose();
        _inputCopy = null;
        _nv12Scratch = null;
    }

    // ── GPU NV12 conversion only (no CPU fallback) ───────────────────

    private unsafe byte[]? ConvertGpuNv12(ID3D11Texture2D texture)
    {
        // Crop muito pequeno: GpuVideoConverter falha com E_INVALIDARG + ffmpeg output vazio
        if ((_cropW > 0 && _cropW < 320) || (_cropH > 0 && _cropH < 240))
        {
            _gpuConvertFails++; // evita restart loop
            Log.W("FfmpegEncoder", $"crop too small {_cropW}x{_cropH} — skipping frame");
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
            Width = desc.Width, Height = desc.Height, MipLevels = 1, ArraySize = 1,
            Format = desc.Format,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget,
            CPUAccessFlags = CpuAccessFlags.None,
        });
        Log.D("FfmpegEncoder", $"EnsureInputCopy: {desc.Width}x{desc.Height} fmt={desc.Format}");
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
        int totalSize = ySize + _height / 2 * _width;

        if (_nv12Scratch?.Length != totalSize)
            _nv12Scratch = new byte[totalSize];

        var src = (byte*)map.DataPointer.ToPointer();

        for (int y = 0; y < _height; y++)
            Unsafe.CopyBlockUnaligned(
                ref _nv12Scratch[y * _width],
                ref src[y * srcPitch],
                (uint)_width);

        int uvSrcBase = srcPitch * _height;
        for (int y = 0; y < _height / 2; y++)
            Unsafe.CopyBlockUnaligned(
                ref _nv12Scratch[ySize + y * _width],
                ref src[uvSrcBase + y * srcPitch],
                (uint)_width);

        return _nv12Scratch;
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
        _nv12Scratch = null;
    }
}
