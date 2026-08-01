using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading.Channels;
using DiNho.Capture.Poc.Logging;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

internal sealed partial class FfmpegEncoder : IEncoder
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
    private string? _codec;
    private readonly bool _useHardware;
    private int _bitrateKbps = 2000;

    // Cascading fallback chain — built once at first probe, consumed by TryFallbackCodec()
    private List<EncoderManager.FallbackEntry>? _fallbackChain;
    private int _currentFallbackIndex;
    private int _scaleDivisor = 1; // 1 = full res, 2 = half, 4 = quarter

    // Resolução de saída configurável pelo usuário (0 = mantém resolução de entrada).
    // O input rawvideo fica sempre na resolução da captura (_width/_height); o scale
    // acontece dentro do ffmpeg via -vf "scale=..." antes do encoder.
    private int _outputWidth;
    private int _outputHeight;

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

    // Absolute restart limiter: max 10 restarts in any 30-second window to prevent CLR crash from GC pressure
    private int _restartsInWindow;
    private long _restartWindowStartTicks;

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
    private bool _pendingTooLarge; // Set by ParseAvcc when pending exceeds 200KB — prevents false EmitPacket
    private long _outputFrameIndex;

    // Raw AnnexB/AVCC accumulation buffer — handles pipe splits that land mid-NALU
    private byte[]? _rawBuf;
    private int _rawLen;
    private bool _hadRawSlice; // tracked in AnnexB path before conversion
    private bool _loggedParseAvcc; // first-call guard for ParseAvcc log
    private string? _userCodec; // original user codec preference, for fallback chain building
    private byte[]? _incompleteNalBuf;   // Incomplete NALU tail from ParseAvcc (Bug 1 fix)
    private int _incompleteNalLen;        // Length of incomplete NALU tail

    // Format latch — ffmpeg -f h264 with -bsf:v should output AnnexB, but sometimes
    // frames slip through in AVCC format. We detect once and latch.
    private enum PipeFormat { Unknown, AnnexB, Avcc, Ivf }
    private PipeFormat _pipeFormat;

    // Cached avcC (AVCDecoderConfigurationRecord) extracted from the first SPS/PPS encountered.
    // Needed by clip exporter when the rolling replay buffer has evicted the initial packet.
    private byte[]? _cachedVps;
    private byte[]? _cachedSps;
    private byte[]? _cachedPps;
    private byte[]? _cachedAvcc;
    private byte[]? _cachedHvcc;
    private bool _ivfHeaderParsed;
    private uint _ivfTimebaseDen;
    private uint _ivfTimebaseNum;

    public FfmpegEncoder(bool useHardware = true) => _useHardware = useHardware;
    public byte[]? AvccCache => _cachedAvcc;
    public byte[]? HvccCache => _cachedHvcc;
    public byte[]? VpsCache => _cachedVps;
    public byte[]? SpsCache => _cachedSps;
    public byte[]? PpsCache => _cachedPps;
    private bool IsHevc => _codec is "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "libx265";
    private bool IsAv1 => _codec is "av1_nvenc" or "libsvtav1";
    public string RawFormat => IsHevc ? "hevc" : IsAv1 ? "av1" : "h264";
    public void SetD3DManager(IMFDXGIDeviceManager? manager) { }

    public void SetCropRect(int x, int y, int w, int h)
    {
        _cropX = x; _cropY = y; _cropW = w; _cropH = h;
    }

    /// <summary>
    /// Define a resolução de saída desejada (ex.: 854×480, 1280×720, 1920×1080).
    /// O frame é redimensionado inteiro via filtro scale do ffmpeg — sem recorte.
    /// Valores ≤ 0 mantêm a resolução de entrada. Dimensões ímpares são arredondadas
    /// para baixo (par), exigência do NV12.
    /// </summary>
    public void SetOutputResolution(int width, int height)
    {
        _outputWidth = width > 0 ? width & ~1 : 0;
        _outputHeight = height > 0 ? height & ~1 : 0;
    }

    /// <summary>Resolução efetiva dos pacotes emitidos, determinada no StartFfmpeg a partir do
    /// scale aplicado (usuário + divisor) e do crop. Cobre tanto o scale do usuário quanto o
    /// cascading fallback — evita que o header do MKV (EncodedPacket.Width/Height) divirja do
    /// bitstream real.</summary>
    private int _encodedW;
    private int _encodedH;
    private int EncodedWidth => _encodedW > 0 ? _encodedW : _width;
    private int EncodedHeight => _encodedH > 0 ? _encodedH : _height;

    /// <summary>
    /// Calcula a resolução alvo do filtro scale combinando a resolução de saída do
    /// usuário com o scale do cascading fallback (1/N da entrada). Preserva o aspect
    /// ratio da entrada quando a resolução do usuário tem proporção diferente (ex.:
    /// captura 16:10/21:9 + preset 16:9) — ajusta dentro do box alvo sem esticar.
    /// Retorna null quando nenhum scale é necessário (saída == entrada).
    /// O divisor do fallback SÓ se aplica quando o usuário não definiu resolução
    /// explícita (nativo, outputW &lt;= 0). Se o usuário escolheu um alvo (ex.: 720p),
    /// esse alvo é o piso — o fallback troca o encoder, nunca degrada a resolução
    /// escolhida (filosofia OBS: output resolution é decisão do usuário).
    /// </summary>
    internal static (int Width, int Height)? ComputeScaleTarget(
        int inputW, int inputH, int outputW, int outputH, int scaleDivisor)
    {
        int outW = outputW > 0 ? outputW : inputW;
        int outH = outputH > 0 ? outputH : inputH;
        if (scaleDivisor > 1 && outputW <= 0)
        {
            outW = Math.Min(outW, inputW / scaleDivisor);
            outH = Math.Min(outH, inputH / scaleDivisor);
        }
        // Nunca faz upscale — limita à resolução de entrada (mesma regra do EngineCoordinator)
        outW = Math.Min(outW, inputW);
        outH = Math.Min(outH, inputH);
        // Preserva o aspect ratio da captura quando o alvo do usuário tem proporção distinta.
        if (outW > 0 && outH > 0)
        {
            double inAr = (double)inputW / inputH;
            double outAr = (double)outW / outH;
            if (Math.Abs(inAr - outAr) > 0.01)
            {
                if (inAr > outAr) // entrada mais larga: limita por largura
                    outH = (int)Math.Round(outW / inAr);
                else // entrada mais estreita: limita por altura
                    outW = (int)Math.Round(outH * inAr);
            }
        }
        outW &= ~1;
        outH &= ~1;
        if (outW == inputW && outH == inputH)
            return null;
        return (outW, outH);
    }

    /// <summary>
    /// Define parâmetros de qualidade CRF+VBV para NVENC/AV1.
    /// bitrateKbps ainda é usado como fallback para AMF/QSV/libx264.
    /// </summary>
    public void SetQualityParams(int cq, int maxrateKbps, int bufsizeKbps, int bframes = 2, int lookahead = 4, string preset = "p5", string? codec = null)
    {
        _cq = cq;
        _maxrateKbps = maxrateKbps;
        _bufsizeKbps = bufsizeKbps;
        _bframes = bframes;
        _lookahead = lookahead;
        _nvencPreset = preset;
        if (!string.IsNullOrEmpty(codec) && codec != "auto")
        {
            _userCodec = codec;
            var resolved = ResolveCodec(codec);
            // A failed resolve must never leave an empty codec — null lets Initialize pick DetectBestCodec.
            _codec = string.IsNullOrWhiteSpace(resolved) ? null : resolved;
        }
    }

    public void Initialize(int width, int height, int frameRate, int bitrateKbps = 2000)
    {
        // NV12 requires even dimensions — round down to avoid libx264/NVENC "height not divisible by 2"
        _width = width & ~1;
        _height = height & ~1;
        _frameRate = frameRate;
        _bitrateKbps = bitrateKbps;
        if (string.IsNullOrWhiteSpace(_codec))
        {
            _codec = DetectBestCodec();
        }
        else
        {
            var vendorId = EncoderManager.DetectEncodingVendorId();
            _fallbackChain = EncoderManager.BuildFallbackChain(_userCodec ?? "auto", vendorId);
            _currentFallbackIndex = 0;
        }
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

    // ── ffmpeg process ───────────────────────────────────────────────

    private void StartFfmpeg()
    {
        /* NVENC/AV1: CRF+VBV — -b:v 0 torna o CQ explícito (sem bitrate alvo implícito),
           maxrate/bufsize como segurança VBV.
           AMF/QSV/libx264: fallback com bitrateKbps alvo (esses codecs não têm CRF+VBV bom).
           Melhorias de qualidade sem alterar CQ/res:
             NVENC: spatial-aq 1 + temporal-aq 1 + multipass fullres + weighted_pred + nonref_p
                    (weighted_pred apenas em H264/HEVC — av1_nvenc rejeita e falha com
                     "No capable devices found"; remoção confirmada em ffmpeg 8.1.2)
             AMF:   preanalysis + pa_taq_mode 2 + vbaq + scene change detection + me_quarter_pel
             QSV:   veryslow + extbrc + rdo 1 + adaptive_i/b + b_strategy + mbbrc
           Cor BT.709: tagging no output → NVENC escreve VUI → atom `colr` no MP4 (players corretos).
           GOP 120 (~2s a 60fps): OBS recomenda, ~10% menos bits que GOP 60. */
        var bframesArg = _bframes > 0 ? $"-bf {_bframes}" : "-bf 0";
        var lookaheadArg = $"-rc-lookahead {_lookahead}";
        // Fallback de CPU (libx264/libx265): CRF+VBV com preset veryfast. Sem -tune zerolatency
        // (bframes=0 garante ordem de saída = ordem de entrada p/ o PTS do pipeline) e sem
        // -threads 1 (usa todos os cores). CABAC/High profile recupera ~15% de eficiência.
        var cpuCq = Math.Clamp(_cq, 1, 51);
        var tune = _codec switch
        {
            "libx264" => $"-preset veryfast -crf {cpuCq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -bf 0 -profile:v high",
            "libx265" => $"-preset veryfast -crf {cpuCq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -bf 0 -x265-params no-open-gop=1:keyint=60:min-keyint=60",
            "h264_nvenc" => $"-preset {_nvencPreset} -tune hq -rc vbr -b:v 0 -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -profile:v high -bf {_bframes} -rc-lookahead {_lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass fullres -weighted_pred 1 -nonref_p 1 -g 120 -keyint_min 120",
            "hevc_nvenc" => $"-preset {_nvencPreset} -tune hq -rc vbr -b:v 0 -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -profile:v main10 -bf {_bframes} -b_ref_mode middle -rc-lookahead {_lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass fullres -weighted_pred 1 -nonref_p 1 -g 120 -keyint_min 120",
            "av1_nvenc" => $"-preset {_nvencPreset} -tune hq -rc vbr -b:v 0 -cq {_cq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -bf {_bframes} -rc-lookahead {_lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass fullres -nonref_p 1 -g 120 -keyint_min 120",
            "h264_amf" => $"-quality quality -rc vbr_peak -qp_i {Math.Clamp(_cq - 4, 0, 51)} -qp_p {Math.Clamp(_cq - 4, 0, 51)} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -bf 0 -g 60 -filler 0 -enforce_hrd 0 -preanalysis true -pa_taq_mode 2 -vbaq true -high_motion_quality_boost_enable true -pa_lookahead_buffer_depth 40 -pa_paq_mode 1 -pa_adaptive_mini_gop true -pa_scene_change_detection_enable true -me_quarter_pel true",
            "hevc_amf" => $"-quality quality -rc vbr_peak -qp_i {Math.Clamp(_cq - 4, 0, 51)} -qp_p {Math.Clamp(_cq - 4, 0, 51)} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -bf 0 -g 60 -filler 0 -enforce_hrd 0 -preanalysis true -pa_taq_mode 2 -vbaq true -high_motion_quality_boost_enable true -pa_lookahead_buffer_depth 40 -pa_paq_mode 1 -pa_adaptive_mini_gop true -pa_scene_change_detection_enable true -me_quarter_pel true",
            "h264_qsv" => $"-preset veryslow -global_quality {Math.Clamp(_cq - 4, 0, 51)} -bf 0 -g 60 -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -extbrc 1 -look_ahead_depth 40 -extra_hw_frames 40 -rdo 1 -low_power 0 -adaptive_i 1 -adaptive_b 1 -b_strategy 1 -mbbrc 1 -async_depth 1",
            _ => $"-preset veryfast -crf {cpuCq} -maxrate {_maxrateKbps}K -bufsize {_bufsizeKbps}K -bf 0 -profile:v high"
        };

        int cw = _cropW, ch = _cropH;
        if (cw > 0 && ch > 0)
        {
            cw = Math.Max(cw, 320);
            ch = Math.Max(ch, 240);
            Log.I("FfmpegEncoder", $"crop={cw}:{ch}:{_cropX}:{_cropY} src={_width}x{_height}");
        }

        // Build -vf filter chain: optional crop + optional scale (user output resolution + cascading fallback)
        // O scale é relativo à resolução PÓS-crop — se um crop estiver ativo, o "nunca upscale"
        // e o divisor do fallback aplicam-se ao frame cortado, não ao frame cheio.
        var vfParts = new List<string>();
        if (cw > 0 && ch > 0)
            vfParts.Add($"crop={cw}:{ch}:{_cropX}:{_cropY}");
        int baseW = cw > 0 && ch > 0 ? cw : _width;
        int baseH = cw > 0 && ch > 0 ? ch : _height;
        var scaleTarget = ComputeScaleTarget(baseW, baseH, _outputWidth, _outputHeight, _scaleDivisor);
        _encodedW = scaleTarget?.Width ?? baseW;
        _encodedH = scaleTarget?.Height ?? baseH;
        if (scaleTarget.HasValue)
        {
            var sw = scaleTarget.Value.Width;
            var sh = scaleTarget.Value.Height;
            vfParts.Add($"scale={sw}:{sh}");
            Log.I("FfmpegEncoder", $"output scale: {baseW}x{baseH} → {sw}x{sh} (user={( _outputWidth > 0 ? $"{_outputWidth}x{_outputHeight}" : "native" )}, fallback=1/{_scaleDivisor})");
        }
        var cropFilter = vfParts.Count > 0
            ? $" -vf \"{string.Join(",", vfParts)}\""
            : "";

        var rawFmt = _codec switch
        {
            "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "libx265" => "hevc",
            "av1_nvenc" or "libsvtav1" => "av1",
            _ => "h264"
        };

        // For AV1, use IVF container (explicit frame boundaries with 12-byte headers).
        // Raw AV1 OBU data is not parseable by our AnnexB/AVCC detector.
        // H264/HEVC use raw format with bitstream filter for AnnexB output.
        string outputFmt = rawFmt == "av1" ? "ivf" : rawFmt;

        // Apply bitstream filter to ensure clean AnnexB output (start-code delimited)
        // instead of AVCC (4-byte length prefix). The AnnexB path in ReaderLoop is
        // more robust against pipe splits and arbitrary offsets than the AVCC parser.
        // AV1 IVF format doesn't need a bsf.
        string bsfArg = rawFmt == "av1" ? "" : $" -bsf:v {rawFmt}_mp4toannexb";
        // Note: if the bsf occasionally fails (known ffmpeg quirk with random frames),
        // the AVCC fallback in ReaderLoop handles misdetected data via the 512KB pending
        // guard + format re-detect at NalParsing:335-345.

        _process = new Process
        {
            StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(
                            args: $"-y -loglevel info " +
                            $"-f rawvideo -pix_fmt nv12 -s {_width}x{_height} " +
                            $"-r {_frameRate} -i pipe:0 " +
                            $"-colorspace bt709 -color_primaries bt709 -color_trc bt709 " +
                            $"{cropFilter} -c:v {_codec} {tune} " +
                            $"-f {outputFmt}{bsfArg} pipe:1",
                            redirectInput: true,
                            redirectOutput: true,
                            redirectError: true)
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

    // ── Reader thread: H.264 output (moved to FfmpegEncoder.NalParsing.cs) ──

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
        if (_fallbackChain == null || _fallbackChain.Count == 0) return false;

        // Move to next entry in the chain
        _currentFallbackIndex++;
        if (_currentFallbackIndex >= _fallbackChain.Count)
        {
            Log.E("FfmpegEncoder", "cascading fallback exhausted — no more entries in chain");
            return false;
        }

        var entry = _fallbackChain[_currentFallbackIndex];
        var oldCodec = _codec;
        _codec = entry.Codec;
        _scaleDivisor = entry.ScaleDivisor;
        _restartAttempts = 0;
        _restartsInWindow = 0;

        Log.W("FfmpegEncoder", $"cascading fallback: {oldCodec} (1/{(_scaleDivisor > 1 ? _scaleDivisor.ToString() : "full")}) → {entry.Label}");
        return true;
    }

    // ── Watchdog: auto-restart on crash ──────────────────────────────

    private bool TryRestart()
    {
        if (_disposed) return false;

        long now = Stopwatch.GetTimestamp();

        // Absolute restart limiter: max 10 restarts in 30-second window
        const int MaxRestartsInWindow = 10;
        const int WindowDurationSec = 30;
        if (_restartsInWindow == 0)
            _restartWindowStartTicks = now;
        double windowElapsedSec = (now - _restartWindowStartTicks) / Stopwatch.Frequency;
        if (windowElapsedSec > WindowDurationSec)
        {
            _restartsInWindow = 0;
            _restartWindowStartTicks = now;
        }
        if (_restartsInWindow >= MaxRestartsInWindow)
        {
            if (!TryFallbackCodec())
            {
                Log.E("FfmpegEncoder", $"max restarts in {WindowDurationSec}s window reached ({MaxRestartsInWindow}), no codec fallback");
                return false;
            }
        }

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
        _restartsInWindow++;
        Log.W("FfmpegEncoder", $"restarting ffmpeg (attempt {_restartAttempts}, window={_restartsInWindow}/{MaxRestartsInWindow}, cause={_processFailedCause ?? "unknown"}, gpuFails={_gpuConvertFails})");
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
        _lastRealPtsTicks = -1;
        _hadSlice = false;
        _hadRawSlice = false;
        _pendingTooLarge = false;
        _loggedParseAvcc = false;
        _pipeFormat = PipeFormat.Unknown;
        if (_pendingBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = null;
        }
        // Return raw buffer if rented to avoid ArrayPool leaks
        if (_rawBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_rawBuf);
            _rawBuf = null;
            _rawLen = 0;
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
        _gpuConverterFailedUntil = DateTime.MinValue;
        _nv12Staging?.Dispose();
        _nv12Staging = null;
        _inputCopy?.Dispose();
        _inputCopy = null;
        _cpuStaging?.Dispose();
        _cpuStaging = null;
        _cpuStagingW = 0;
        _cpuStagingH = 0;
        _nv12Scratch = null;
        _ivfHeaderParsed = false;
        _ivfTimebaseDen = 0;
        _ivfTimebaseNum = 0;
    }

    // ── GPU NV12 conversion (moved to FfmpegEncoder.GpuConvert.cs) ──

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
        _cpuStaging?.Dispose();
        _nv12Scratch = null;

        // Release pooled buffers and packets to prevent ArrayPool leaks
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

        while (_pendingOutputs.Count > 0)
            _pendingOutputs.Dequeue().Release();

        while (_inputPtsQueue.TryDequeue(out _)) { }

        while (_outputChannel.Reader.TryRead(out var pkt))
            pkt.Release();
    }
}
