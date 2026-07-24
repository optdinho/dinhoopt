using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Memory;
using DiNho.Capture.Poc.Watchdog;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private void ToggleCapture()
    {
        if (_captureActive)
            StopCapture();
        else
            StartCapture();
    }

    private void StartCapture()
    {
        lock (_pipelineLock)
        {
            if (_captureActive) return;

            try
            {
                // Se o usuário iniciou manualmente (Alt+1 ou botão), permite auto-start novamente
                _userStoppedProcess = "";

                _reinitCount = 0;
                _gameBackgrounded = false;
                _bgDropCount = 0;
                _fgGoodCount = 0;

                var game = ResolveTargetGame();
                _captureTargetGame = game;

                _captureActive = true;

                Log.I("EngineCoordinator", "=== StartCapture INICIADO ===");

                // D3D11 device compartilhado entre capture + encoder
                if (_sharedDevice == null)
                {
                    var creationFlags = DeviceCreationFlags.BgraSupport;
                    var hr = Vortice.Direct3D11.D3D11.D3D11CreateDevice(
                        null, DriverType.Hardware, creationFlags,
                        new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                        out _sharedDevice, out _, out _);
                    if (!hr.Success || _sharedDevice is null)
                    {
                        Log.E("EngineCoordinator", $"D3D11CreateDevice falhou: {hr}");
                        _captureActive = false;
                        return;
                    }
                    Log.I("EngineCoordinator", $"D3D11 device criado (feature level {_sharedDevice.FeatureLevel})");

                    _dxgiManager = MediaFactory.MFCreateDXGIDeviceManager();
                    _dxgiManager.ResetDevice(_sharedDevice!).CheckError();
                }
                Log.I("EngineCoordinator", "[1/7] D3D11 device OK");

                // Encoder (NVENC/AMF/QSV/software)
                Log.I("EngineCoordinator", $"EncoderPreset config: '{_config.Config.EncoderPreset}' Cq={_activeProfile.Cq} Maxrate={_activeProfile.MaxrateKbps}kbps Bframes={_activeProfile.Bframes} Lookahead={_activeProfile.Lookahead}");
                _encoder?.Dispose();
                _encoder = null;
                _encoder = EncoderManager.CreateBestEncoder(_config.Config.ForceSoftware, _sharedDevice, _activeProfile.MaxrateKbps);
                if (_encoder is FfmpegEncoder fe)
                {
                    fe.SetQualityParams(
                        cq: _activeProfile.Cq,
                        maxrateKbps: _activeProfile.MaxrateKbps,
                        bufsizeKbps: _activeProfile.BufsizeKbps,
                        bframes: _activeProfile.Bframes,
                        lookahead: _activeProfile.Lookahead,
                        preset: _config.Config.EncoderPreset,
                        codec: _config.Config.Codec);
                    Log.I("EngineCoordinator", $"SetQualityParams aplicado: preset='{_config.Config.EncoderPreset}' cq={_activeProfile.Cq} maxrate={_activeProfile.MaxrateKbps} bufsize={_activeProfile.BufsizeKbps} bf={_activeProfile.Bframes} lookahead={_activeProfile.Lookahead}");
                }
                Log.I("EngineCoordinator", "[2/7] Encoder criado");

                // Seleciona fonte de captura (WGC/DXGI/Hybrid/PrintWindow) — async selector with Task.Delay retries
                SelectCaptureSourceAsync().GetAwaiter().GetResult();
                Log.I("EngineCoordinator", "[3/7] SelectCaptureSource OK (async)");

                if (_capture == null)
                {
                    Log.E("EngineCoordinator", "Nenhuma fonte de captura disponível");
                    _encoder?.Dispose();
                    _encoder = null;
                    _sharedDevice?.Dispose();
                    _sharedDevice = null;
                    _captureActive = false;
                    return;
                }

                // Inicializa encoder com dimensões reais da captura
                _captureWidth = Math.Max(_capture.Width, 320);
                _captureHeight = Math.Max(_capture.Height, 240);
                _encoder.Initialize(_captureWidth, _captureHeight, _config.Config.Fps, _activeProfile.MaxrateKbps);
                _status.Update(s =>
                {
                    s.Recording = true;
                    s.Encoder = _encoder.GetType().Name.Replace("Encoder", "");
                    s.ActivePipelines = 1;
                });

                Log.I("EngineCoordinator", $"[4/7] Encoder: {_encoder.GetType().Name} ({_captureWidth}x{_captureHeight} @ {_config.Config.Fps}fps)");

                // Áudio
                _audioMixer = CreateAudioMixer();
                _audioSampleRate = _audioMixer.SampleRate;
                _lastAudioAnchor = TimeSpan.Zero;
                _audioPacketCount = 0;
                _maxAacDrainCount = 0;
                _audioMixer.OnMixedAudio += OnAudioPacket;
                _audioMixer.Start();
                Log.I("EngineCoordinator", "[5/7] Audio mixer started");

                // AAC encoder
                _aacEncoder?.Dispose();
                _aacEncoder = null;
                _aacEncoder = new FfmpegAacEncoder();
                _aacEncoder.Initialize(_audioSampleRate, 2, 192000);
                Log.I("EngineCoordinator", "[6/7] AAC encoder initialized");

                // RamManager — detecta perfil e configura limites
                if (_config.Config.AdaptiveQualityEnabled)
                {
                    _ramManager ??= new RamManager(
                        _captureWidth, _captureHeight,
                        _config.Config.EffectiveReplaySeconds,
                        _activeProfile.Cq,
                        _activeProfile.MaxrateKbps,
                        _activeProfile.BufsizeKbps,
                        _activeProfile.Bframes,
                        _activeProfile.Lookahead);
                    _ramManager.StartWatchdog();
                    _activeProfile = _ramManager.ResolveProfile();
                }
                else
                {
                    _ramManager?.StopWatchdog();
                    Log.I("EngineCoordinator", "AdaptiveQuality DISABLED — usando config do usuário sem ajuste RAM");
                }
                _buffer.MaxDuration = TimeSpan.FromSeconds(_activeProfile.ReplaySeconds);
                _buffer.MaxBytes = _activeProfile.MaxBufferBytes;

                // Enable disk spill when the requested replay duration exceeds what RAM can hold.
                // Evicted frames are written to a temp file and merged back in GetSegments().
                long neededBytes = (long)_activeProfile.MaxrateKbps * _activeProfile.ReplaySeconds * 1024L * 13L / 80L;
                if (neededBytes > _activeProfile.MaxBufferBytes && !_buffer.IsDiskSpillEnabled)
                {
                    _buffer.EnableDiskSpill();
                    Log.I("EngineCoordinator", $"Disk spill ENABLED — need={neededBytes / (1024 * 1024)}MB buf={_activeProfile.MaxBufferBytes / (1024 * 1024)}MB");
                }

                Log.I("EngineCoordinator", $"RAM profile: {_activeProfile.Level} — {_activeProfile.EncodeWidth}x{_activeProfile.EncodeHeight} " +
                    $"maxRate={_activeProfile.MaxrateKbps}kbps maxBuf={_activeProfile.MaxBufferBytes / (1024 * 1024)}MB " +
                    $"replay={_activeProfile.ReplaySeconds}s diskSpill={_buffer.IsDiskSpillEnabled}");

                // Pipeline loop
                _recording = true;
                _needsReinit = false;
                _pipelineCts = new CancellationTokenSource();
                _pipelineTask = Task.Run(() => PipelineLoop(_pipelineCts.Token));
                Log.I("EngineCoordinator", $"[7/7] Pipeline task created (status={_pipelineTask.Status})");

                // Timer de diagnóstico PTT
                _pttDiagTimer = new Timer(_ =>
                {
                    var mixer = _audioMixer;
                    if (mixer != null)
                        Log.D("PTT", $"pttKeys=[{string.Join(",", _config.Config.PushToTalkKeys)}] mode={_config.Config.PttMode} mic={mixer.MicEnabled} active={_ptt.MicActive}");
                }, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));

                Log.I("EngineCoordinator", "=== StartCapture CONCLUIDO ===");
            }
            catch (Exception ex)
            {
                Log.E("EngineCoordinator", $"=== StartCapture FALHOU: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace} ===");

                // Full cleanup so future startCapture calls can retry
                _recording = false;
                _captureActive = false;
                _captureTargetGame = new GameInfo();
                _captureTargetHwnd = IntPtr.Zero;

                _audioMixer?.Stop();
                _audioMixer?.Dispose();
                _audioMixer = null;

                _aacEncoder?.Dispose();
                _aacEncoder = null;

                _capture?.Dispose();
                _capture = null;

                _encoder?.Dispose();
                _encoder = null;

                _wgcPump?.Dispose();
                _wgcPump = null;

                _sharedDevice?.Dispose();
                _sharedDevice = null;

                _dxgiManager?.Dispose();
                _dxgiManager = null;

                _status.Update(s => s.Recording = false);
            }
        }
    }

    private void StopCapture()
    {
        lock (_pipelineLock)
        {
            _recording = false;
            _captureActive = false;
            _ramManager?.StopWatchdog();
            _captureTargetGame = new GameInfo();
            _captureTargetHwnd = IntPtr.Zero;
            _gameBackgrounded = false;
            _bgDropCount = 0;
            _fgGoodCount = 0;

            _pipelineCts?.Cancel();
            try
            {
                _pipelineTask?.Wait(2000);
            }
            catch (AggregateException)
            {
                // Pipeline cancelado ou falhou, ignorar
            }
            _pipelineTask = null;
            _pipelineCts = null;

            _audioMixer?.Stop();
            _audioMixer?.Dispose();
            _audioMixer = null;

            if (_loopbackSource != null)
            {
                _loopbackSource.Stop();
                _loopbackSource.Dispose();
                _loopbackSource = null;
            }

            if (_micSource != null)
            {
                _micSource.Stop();
                _micSource.Dispose();
                _micSource = null;
            }

            if (_aacEncoder != null)
            {
                var remaining = new List<EncodedPacket>();
                _aacEncoder.FlushAndDrain(remaining);
                int flushIdx = 0;
                foreach (var pkt in remaining)
                {
                    var pts = _lastAudioAnchor + TimeSpan.FromSeconds((double)flushIdx * 1024.0 / _audioSampleRate);
                    flushIdx++;
                    var corrected = new EncodedPacket(pkt.Data, pkt.Type, pts, pkt.Duration, pkt.IsKeyFrame);
                    _buffer.AddAudio(corrected);
                }
                _aacEncoder.Dispose();
                _aacEncoder = null;
            }

            // Reseta contadores entre sessões de captura
            _audioPacketCount = 0;
            _maxAacDrainCount = 0;
            _audioSampleRate = 48000;

            _capture?.Dispose();
            _capture = null;

            _pttDiagTimer?.Dispose();
            _pttDiagTimer = null;

            _encoder?.Dispose();
            _encoder = null;

            _wgcPump?.Dispose();
            _wgcPump = null;

            _sharedDevice?.Dispose();
            _sharedDevice = null;

            _dxgiManager?.Dispose();
            _dxgiManager = null;

            _status.Update(s => s.Recording = false);
            Log.I("EngineCoordinator", "Captura parada.");
        }
    }

    private async Task PipelineLoop(CancellationToken ct)
    {
        try
        {
            Log.I("Pipeline", $"PipelineLoop INICIADO — capture={_capture?.GetType().Name ?? "null"} encoder={_encoder?.GetType().Name ?? "null"} fps={_config.Config.Fps} ct={ct.IsCancellationRequested}");
        }
        catch (Exception ex)
        {
            Log.E("Pipeline", $"PipelineLoop Log.I CRASHED: {ex.GetType().Name}: {ex.Message}");
            return;
        }

        // AvSetMmThreadCharacteristics prioriza esta thread no scheduler
        // como thread de captura multimídia, reduzindo latência e glitches
        SetMmThreadPriority();

        var frameIntervalUs = 1_000_000L / _config.Config.Fps;
        var frameDuration = TimeSpan.FromSeconds(1.0 / _config.Config.Fps);
        var frameDurationHns = frameDuration.Ticks;
        var freq = Stopwatch.Frequency;
        var freqPerUs = freq / 1_000_000L;
        var spinTargetTicks = 0L;
            var modeCheckDue = DateTime.UtcNow;
            var diagFrames = 0;
            var loggedFirstNullFrame = false;
            var loggedFirstFailFrame = false;

        while (!ct.IsCancellationRequested && _capture != null && _encoder != null)
        {
            var cap = _capture;
            var enc = _encoder;

            var beforeCapture = Stopwatch.GetTimestamp();
            // Captura o PTS da câmera ANTES de TryCaptureFrame — reflete o momento
            // real da captura, não o momento após latência de encoding (NVENC/AMF)
            var capturePts = TimeSpan.FromSeconds((double)(beforeCapture - _clock.StartTimestamp) / Stopwatch.Frequency);
            try
            {
                int captureTimeout = Math.Max(1, Math.Min(100, 1000 / _config.Config.Fps));
                using var frame = cap?.TryCaptureFrame(captureTimeout);
                if (frame is null)
                {
                    if (!loggedFirstNullFrame)
                    {
                        loggedFirstNullFrame = true;
                        Log.E("Pipeline", $"TryCaptureFrame retornou NULL — cap={cap?.GetType().Name ?? "null"} cap disposed={cap == null}. Isso significa que _capture é null no momento da chamada.");
                    }
                    _watchdog.ReportDroppedFrame(PipelineIssue.CaptureError);
                    continue;
                }
                if (++diagFrames % 60 == 1)
                {
                    var captureType = _capture?.GetType().Name ?? "null";
                    Log.I("PipelineDiag", $"frame.Success={frame.Success} texture={(frame.Texture != null ? "ok" : "null")} " +
                        $"capture={captureType} encoder={(_encoder?.GetType().Name ?? "null")}");
                }
                if (frame.Success)
                {
                    if (frame.Texture != null)
                    {
                        if (diagFrames == 1)
                            Log.I("Pipeline", $"Primeiro frame com textura! width={frame.Width} height={frame.Height} captureType={_capture?.GetType().Name ?? "null"}");
                        if (_gameBackgrounded && frame.Texture != null)
                        {
                            _fgGoodCount++;
                            if (_fgGoodCount >= FG_DEBOUNCE_FRAMES)
                            {
                                _gameBackgrounded = false;
                                _fgGoodCount = 0;
                                Log.I("Pipeline", "Jogo retornou ao foreground — frames retomados");
                            }
                        }
                        else
                        {
                            _fgGoodCount = 0;
                        }
                        _bgDropCount = 0;
                        _starvationStart = default;
                        // Suprimir GC durante encode + buffer write (~3MB NV12) para evitar frame drops
                        var gcSuppressed = GC.TryStartNoGCRegion(4 * 1024 * 1024);
                        try
                        {
                            var encoded = enc.EncodeFrame(frame.Texture, capturePts);
                            if (encoded != null)
                            {
                                _buffer.AddVideo(encoded);
                                var elapsedMs = (Stopwatch.GetTimestamp() - beforeCapture) * 1000.0 / Stopwatch.Frequency;
                                _watchdog.ReportGoodFrame(elapsedMs);
                                _hasEverBeenHealthy = true;
                            }
                            else
                            {
                                _watchdog.ReportDroppedFrame(PipelineIssue.EncodeError);
                            }
                        }
                        finally
                        {
                            if (gcSuppressed) GC.EndNoGCRegion();
                        }
                    }
                    else
                    {
                        if (_starvationStart == default)
                        {
                            _starvationStart = DateTime.UtcNow;
                            Log.W("Pipeline", "Frame sem textura detectado — possível GPU starvation ou WGC throttle. Monitorando...");
                        }
                    }
                }
                else
                {
                    if (!loggedFirstFailFrame)
                    {
                        loggedFirstFailFrame = true;
                        Log.W("Pipeline", $"Primeiro frame Success=false capturado — width={frame.Width} height={frame.Height} waitMs={frame.WaitEndTicks - frame.CaptureStartTicks}. Monitorando...");
                    }
                    if (_starvationStart == default)
                    {
                        _starvationStart = DateTime.UtcNow;
                        Log.W("Pipeline", "Frame dropped (Success=false) — possível GPU overload ou device busy. Monitorando...");
                    }
                    _watchdog.ReportDroppedFrame(PipelineIssue.NoFrame);
                }

                if (!_needsReinit)
                {
                    // Se o processo alvo ainda está vivo e usamos WGC per-window,
                    // NÃO reinicia JAMAIS — o usuário só alt-tabou e vai voltar.
                    // WGC per-window retoma frames naturalmente quando o jogo
                    // voltar ao foreground. O watchdog é resetado para evitar
                    // que o acúmulo de frames dropped dispare ShouldReinit()
                    // quando o jogo retornar.
                    if (_capture is WgcCaptureSource && _captureTargetGame.IsValid &&
                        IsProcessAlive(_captureTargetGame.ProcessName))
                    {
                        _bgDropCount++;
                        if (_bgDropCount >= BG_DEBOUNCE_DROPS)
                        {
                            if (!_gameBackgrounded)
                            {
                                _gameBackgrounded = true;
                                Log.I("Pipeline", "Jogo em background (alt-tab) — frames ausentes. Aguardando retorno...");
                            }
                            _starvationStart = default;
                            _watchdog.Reset();
                        }
                    }
                    else if (_watchdog.ShouldReinit()
                        || (_starvationStart != default && (DateTime.UtcNow - _starvationStart).TotalSeconds > 8))
                    {
                        // Se o processo alvo MORREU enquanto backgrounded, sai do loop
                        // (não chama StopCapture() aqui para evitar deadlock com _pipelineTask.Wait)
                        if (_gameBackgrounded && _captureTargetGame.IsValid &&
                                 !IsProcessAlive(_captureTargetGame.ProcessName))
                        {
                            Log.I("Pipeline", $"Jogo '{_captureTargetGame.ProcessName}' fechou enquanto backgrounded — encerrando pipeline");
                            _recording = false;
                            _captureActive = false;
                            _captureTargetGame = new GameInfo();
                            _captureTargetHwnd = IntPtr.Zero;
                            break;
                        }
                        else
                        {
                            var health = _watchdog.GetHealth();
                            var starvationSec = (_starvationStart != default ? (DateTime.UtcNow - _starvationStart).TotalSeconds : 0);
                            Log.E("Pipeline", $"Reinit acionado: watchdog={_watchdog.ShouldReinit()} starvation={_starvationStart != default} " +
                                $"consecutiveGood={health.ConsecutiveGoodFrames} dropped={health.DroppedFrames}/{health.TotalFrames} " +
                                $"lastIssue={health.LastIssue} reinitCount={_reinitCount} starvationTime={starvationSec:F1}s");
                            if (starvationSec > 8)
                            {
                                Log.E("Pipeline", $"GPU starvation sustentado ({starvationSec:F0}s) — considere reduzir qualidade (preset/resolução) ou fechar aplicações que usam GPU");
                            }
                            _needsReinit = true;
                            _reinitCount++;
                            _ = ReinitializePipelineAsync();
                        }
                    }
                }

                if (modeCheckDue <= DateTime.UtcNow)
                {
                    modeCheckDue = DateTime.UtcNow.AddSeconds(2);
                    // Mode switching (DXGI↔PrintWindow) é gerenciado internamente
                    // pelo HybridCaptureSource via PickDesiredMode().
                    // Crop é atualizado uma vez no startup — não periodicamente,
                    // pois Flush() reinicia o ffmpeg e causa flickering.
                }

                _status.Update(s =>
                {
                    s.LastFrameMs = _watchdog.GetHealth().AvgFrameTimeMs;
                    s.WatchdogOk = _watchdog.GetHealth().Level != HealthLevel.Red;
                    var (vFramesTotal, _, _, bytesTotal) = _buffer.Stats();
                    s.ReplayBufferBytes = bytesTotal;
                    var d = _buffer.StatsDetailed();
                    s.ReplayBufferVideoFrames = d.videoCount;
                    s.ReplayBufferVideoBytes = d.videoBytes;
                    s.ReplayBufferAudioPackets = d.audioCount;
                    s.ReplayBufferAudioBytes = d.audioBytes;
                });

                // Log de RAM a cada ~60 frames (~1s a 60fps)
                if (diagFrames % 60 == 0)
                {
                    var d = _buffer.StatsDetailed();
                    double videoMb = d.videoBytes / (1024.0 * 1024.0);
                    double audioMb = d.audioBytes / (1024.0 * 1024.0);
                    double totalMb = videoMb + audioMb;
                    Log.I("RAM", $"video={d.videoCount}frames {videoMb:F1}MB | audio={d.audioCount}pkts {audioMb:F1}MB | total={totalMb:F1}MB | duracao={d.videoDuration.TotalSeconds:F1}s");
                }

                // DriftMonitor: a cada ~300 frames (~5s a 60fps), verifica se o PTS de
                // vídeo e áudio estão divergindo. Loga warning se drift > 150ms (ITU-R perceptível).
                if (diagFrames % 300 == 0)
                {
                    var (vPts, aPts) = _buffer.StatsPtsRange();
                    if (vPts > TimeSpan.Zero && aPts > TimeSpan.Zero)
                    {
                        var driftMs = (aPts - vPts).TotalMilliseconds;
                        if (Math.Abs(driftMs) > DRIFT_WARN_THRESHOLD_MS)
                            Log.W("DriftMonitor", $"A/V PTS drift: audio={aPts.TotalSeconds:F2}s video={vPts.TotalSeconds:F2}s drift={driftMs:F0}ms (threshold={DRIFT_WARN_THRESHOLD_MS}ms)");
                        else if (diagFrames % 600 == 0)
                            Log.D("DriftMonitor", $"A/V PTS drift OK: drift={driftMs:F0}ms video={vPts.TotalSeconds:F2}s audio={aPts.TotalSeconds:F2}s");
                    }
                }
            }
            catch (Exception ex)
            {
                if (ex is DeviceLostException || cap?.CheckDeviceLost() == true)
                {
                    _deviceLost = true;
                    _needsReinit = true;
                    Log.E("Pipeline", $"Device D3D11 perdido ({ex.GetType().Name})! Recriando...");
                }
                _watchdog.ReportDroppedFrame(PipelineIssue.CaptureError);
                Log.E("Pipeline", $"Erro: {ex}");
            }

            // Timing preciso (QPC-based): sleep para o bulk, spin para o residual
            var elapsedSinceCapture = Stopwatch.GetTimestamp() - beforeCapture;
            var elapsedUs = elapsedSinceCapture / freqPerUs;
            var remainingUs = frameIntervalUs - elapsedUs;
            if (remainingUs > 500)
            {
                var remainingMs = (int)(remainingUs / 1000);
                await Task.Delay(Math.Max(1, remainingMs - 1), ct);
                spinTargetTicks = beforeCapture + frameIntervalUs * freqPerUs;
            }
            else
            {
                spinTargetTicks = beforeCapture + frameIntervalUs * freqPerUs;
            }

            while (Stopwatch.GetTimestamp() < spinTargetTicks && !ct.IsCancellationRequested)
                Thread.SpinWait(8);
        }

        var reason = ct.IsCancellationRequested ? "cancelamento" :
                     _capture == null ? "captura nula" :
                     _encoder == null ? "encoder nulo" : "desconhecido";
        Log.E("Pipeline", $"Loop encerrado: {reason} diagFrames={diagFrames} loggedFirstNull={loggedFirstNullFrame} loggedFirstFail={loggedFirstFailFrame}");
        RevertMmThreadPriority();
    }

    private async Task ReinitializePipelineAsync()
    {
        var reinitGame = _gameDetector.CurrentGame;
        Log.I("EngineCoordinator", $"Reinicializando pipeline (watchdog)... foreground='{reinitGame.ProcessName}' hwnd=0x{reinitGame.Hwnd:X8} starvationSec={(_starvationStart != default ? (DateTime.UtcNow - _starvationStart).TotalSeconds.ToString("F1") : "N/A")}");

        if (!_captureActive)
        {
            _needsReinit = false;
            return;
        }

        // Capture CTS/task to locals BEFORE cancelling — StopCapture() may null them
        // concurrently under _pipelineLock. Using locals prevents NRE from TOCTOU.
        var cts = _pipelineCts;
        var task = _pipelineTask;

        // Cancel the running pipeline loop (thread-safe, no lock needed)
        cts?.Cancel();

        // Wait for the pipeline loop to exit (outside lock to avoid deadlock with PipelineLoop)
        if (task != null)
        {
            try { await task.WaitAsync(TimeSpan.FromSeconds(2)); }
            catch { }
        }

        lock (_pipelineLock)
        {
            // Null the fields under lock — StopCapture() also nulls them under lock,
            // so only one thread will actually null them.
            _pipelineCts = null;
            _pipelineTask = null;
            try
            {
                if (_deviceLost)
            {
                _sharedDevice?.Dispose();
                _sharedDevice = null;
                _dxgiManager?.Dispose();
                _dxgiManager = null;

                var creationFlags = DeviceCreationFlags.BgraSupport;
                var result = Vortice.Direct3D11.D3D11.D3D11CreateDevice(
                    null, DriverType.Hardware, creationFlags,
                    new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                    out _sharedDevice, out _, out _);
                if (result.Success && _sharedDevice is not null)
                {
                    _dxgiManager = MediaFactory.MFCreateDXGIDeviceManager();
                    _dxgiManager.ResetDevice(_sharedDevice!).CheckError();
                    Log.E("EngineCoordinator", "Device D3D11 recriado após TDR/device lost.");
                }

                _deviceLost = false;
            }

            _capture?.Dispose();
            _capture = null;

            SelectCaptureSource();

            // Reinicia o encoder (ffmpeg pode ter travado ou atrasado)
            _encoder?.Dispose();
            _encoder = EncoderManager.CreateBestEncoder(_config.Config.ForceSoftware, _sharedDevice, _activeProfile.MaxrateKbps);
            if (_encoder is FfmpegEncoder fe)
                fe.SetQualityParams(
                    cq: _activeProfile.Cq,
                    maxrateKbps: _activeProfile.MaxrateKbps,
                    bufsizeKbps: _activeProfile.BufsizeKbps,
                    bframes: _activeProfile.Bframes,
                    lookahead: _activeProfile.Lookahead,
                    preset: _config.Config.EncoderPreset,
                    codec: _config.Config.Codec);
            _encoder.Initialize(_activeProfile.EncodeWidth, _activeProfile.EncodeHeight, _config.Config.Fps, _activeProfile.MaxrateKbps);
            _status.Update(s => s.Encoder = _encoder.GetType().Name.Replace("Encoder", ""));

            if (_capture != null)
            {
                _starvationStart = default;
                _watchdog.Reset();
                _pipelineCts = new CancellationTokenSource();
                _pipelineTask = Task.Run(() => PipelineLoop(_pipelineCts.Token));
                _needsReinit = false;
                if (_hasEverBeenHealthy)
                    _status.Update(snap => snap.LastCrashRecovered = true);
                Log.I("EngineCoordinator", $"Pipeline reinicializado com sucesso ({_capture!.Name}, {_captureWidth}x{_captureHeight}).");
            }
        }
            catch (Exception ex)
            {
                Log.E("EngineCoordinator", $"Falha na reinicialização: {ex.Message}");
                _recording = false;
                _captureActive = false;
            }
        }
    }

    private void SelectCaptureSource()
    {
        var game = _captureTargetGame;
        var gameHwnd = game.IsValid ? game.Hwnd : IntPtr.Zero;

        // Salva o HWND original para usar como fallback em reinit
        // (quando o jogo está minimizado, MainWindowHandle pode ser Zero)
        if (gameHwnd != IntPtr.Zero)
            _captureTargetHwnd = gameHwnd;

        // WDA check — jogos que usam WDA_EXCLUDEFROMCAPTURE não podem ser capturados via WGC per-window
        if (game.IsValid && gameHwnd != IntPtr.Zero && WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            Log.I("EngineCoordinator", $"Jogo '{game.ProcessName}' usa WDA_EXCLUDEFROMCAPTURE — pulando WGC per-window, usando desktop/Hybrid");
        }

        // 1) WGC per-window (melhor qualidade) — tenta até 3x com 400ms entre tentativas
        if (game.IsValid && gameHwnd != IntPtr.Zero && IsWindowValidForWgc(gameHwnd)
            && !WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            const int maxRetries = 3;
            const int retryDelayMs = 400;

            // Ensure we have a dedicated STA thread with message pump for WGC.
            // WGC FrameArrived needs a message pump for DWM to deliver frames.
            _wgcPump ??= new Capture.WindowsMessagePump();

            for (var attempt = 1; attempt <= maxRetries; attempt++)
                {
                    // Capture device reference locally — StopCapture() may dispose it during retry delay
                    var device = _sharedDevice;
                    if (device == null || !_captureActive)
                    {
                        Log.W("EngineCoordinator", $"WGC retry aborted: device={device != null} active={_captureActive}");
                        break;
                    }
                    try
                    {
                        var wgc = new WgcCaptureSource();
                        // Marshal Initialize + StartFramePump to the pump thread.
                        // This ensures the WGC capture session is created on an STA thread
                        // with a message pump, which is required for FrameArrived to fire.
                        _wgcPump.Invoke(() =>
                        {
                            wgc.Initialize(device, gameHwnd);
                            wgc.StartFramePump();
                        });
                        _capture = wgc;
                        _status.Update(s => s.CaptureBackend = $"WGC:{game.ProcessName}");
                        Log.I("EngineCoordinator", $"Captura: janela '{game.ProcessName}' ({gameHwnd})");
                        goto multiMonitor;
                    }
                    catch (Exception ex) when (attempt < maxRetries)
                    {
                        var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                        Log.E("EngineCoordinator", $"WGC window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{innerMsg}, retry em {retryDelayMs}ms...");
                        // Release lock during delay to avoid starving StopCapture, but re-check device on resume
                        bool heldLock = Monitor.IsEntered(_pipelineLock);
                        if (heldLock) Monitor.Exit(_pipelineLock);
                        try { Thread.Sleep(retryDelayMs); }
                        finally { if (heldLock) Monitor.Enter(_pipelineLock); }
                    }
                    catch (Exception ex)
                    {
                        var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                        Log.E("EngineCoordinator", $"WGC window tentativa {maxRetries}/{maxRetries} falhou: {ex.Message}{innerMsg}, fallback...");
                    }
                }
        }

        // 2) WGC desktop (full monitor via DWM) — funciona para qualquer janela
        //    No multi-monitor, captura o monitor onde o jogo está
        try
        {
            var gameMonitor = gameHwnd != IntPtr.Zero
                ? MonitorHelper.GetMonitorFromWindowHandle(gameHwnd)
                : IntPtr.Zero;

            _wgcPump ??= new Capture.WindowsMessagePump();

            var wgc = new WgcCaptureSource();
            _wgcPump.Invoke(() =>
            {
                wgc.Initialize(_sharedDevice, IntPtr.Zero, gameMonitor);
                wgc.StartFramePump();
            });
            _capture = wgc;
            _status.Update(s => s.CaptureBackend = "WGC");
            Log.I("EngineCoordinator", "Captura: Windows Graphics Capture (desktop)");
            goto multiMonitor;
        }
        catch (Exception wgcEx)
        {
            var innerMsg = wgcEx.InnerException != null ? $" → {wgcEx.InnerException.GetType().Name}: {wgcEx.InnerException.Message}" : "";
            Log.E("EngineCoordinator", $"WGC desktop falhou: {wgcEx.GetType().Name}: {wgcEx.Message}{innerMsg}");
        }

        // 3) DXGI Desktop Duplication (full monitor, funciona sempre)
        try
        {
            var dxgi = new DxgiCaptureSource();
            dxgi.Initialize(_sharedDevice, gameHwnd);
            _capture = dxgi;
            _status.Update(s => s.CaptureBackend = "DXGI");
            Log.I("EngineCoordinator", "Captura: DXGI Desktop Duplication");
            goto multiMonitor;
        }
        catch (Exception dxgiEx)
        {
            Log.E("EngineCoordinator", $"DXGI falhou: {dxgiEx.GetType().Name}: {dxgiEx.Message}");
        }

        // 4) Hybrid (DXGI + PrintWindow) — fallback para janela em background
        try
        {
            var hybrid = new HybridCaptureSource();
            hybrid.Initialize(_sharedDevice, gameHwnd);
            _capture = hybrid;
            _status.Update(s => s.CaptureBackend = _capture.Name);
            Log.I("EngineCoordinator", $"Captura híbrida: HWND=0x{gameHwnd:X8}");
            goto multiMonitor;
        }
        catch (Exception hybridEx)
        {
            Log.E("EngineCoordinator", $"Hybrid falhou: {hybridEx.GetType().Name}: {hybridEx.Message}");
        }

        multiMonitor:
        // Detecta configuração multi-monitor
        var monitorCount = MonitorHelper.GetMonitorCount();
        if (monitorCount > 1 && game.IsValid)
        {
            var gameMonitor = MonitorHelper.GetMonitorFromWindow(game.Hwnd);
            Log.I("EngineCoordinator", $"Multi-monitor: {monitorCount} telas, jogo no monitor {gameMonitor}");
        }
    }

    private async Task SelectCaptureSourceAsync()
    {
        var game = _captureTargetGame;
        var gameHwnd = game.IsValid ? game.Hwnd : IntPtr.Zero;

        // Save hwnd fallback
        if (gameHwnd != IntPtr.Zero)
            _captureTargetHwnd = gameHwnd;

        // WDA exclusion check
        if (game.IsValid && gameHwnd != IntPtr.Zero && WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            Log.I("EngineCoordinator", $"Jogo '{game.ProcessName}' usa WDA_EXCLUDEFROMCAPTURE — pulando WGC per-window, usando desktop/Hybrid");
        }

        // 1) WGC per-window (best) — async retries with delay, do not block pipeline lock        
        if (game.IsValid && gameHwnd != IntPtr.Zero && IsWindowValidForWgc(gameHwnd)
            && !WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            const int maxRetries = 3;
            const int retryDelayMs = 400;

            // Ensure pump exists
            _wgcPump ??= new Capture.WindowsMessagePump();

            for (var attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    var wgc = new WgcCaptureSource();
                    // Marshal Initialize + StartFramePump to the pump thread.
                    _wgcPump.Invoke(() =>
                    {
                        wgc.Initialize(_sharedDevice, gameHwnd);
                        wgc.StartFramePump();
                    });
                    _capture = wgc;
                    _status.Update(s => s.CaptureBackend = $"WGC:{game.ProcessName}");
                    Log.I("EngineCoordinator", $"Captura: janela '{game.ProcessName}' ({gameHwnd})");
                    return;
                }
                catch (Exception ex)
                {
                    var inner = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                    if (attempt < maxRetries)
                    {
                        Log.W("EngineCoordinator", $"WGC per-window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{inner} — retry em {retryDelayMs}ms (async)");
                        await Task.Delay(retryDelayMs);
                        continue;
                    }
                    else
                    {
                        Log.E("EngineCoordinator", $"WGC per-window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{inner} — fallback");
                    }
                }
            }
        }

        // 2) WGC desktop (monitor)
        try
        {
            var gameMonitor = gameHwnd != IntPtr.Zero ? MonitorHelper.GetMonitorFromWindowHandle(gameHwnd) : IntPtr.Zero;
            _wgcPump ??= new Capture.WindowsMessagePump();
            var wgc = new WgcCaptureSource();
            _wgcPump.Invoke(() =>
            {
                wgc.Initialize(_sharedDevice, IntPtr.Zero, gameMonitor);
                wgc.StartFramePump();
            });
            _capture = wgc;
            _status.Update(s => s.CaptureBackend = "WGC");
            Log.I("EngineCoordinator", "Captura: Windows Graphics Capture (desktop)");
            return;
        }
        catch (Exception wgcEx)
        {
            var inner = wgcEx.InnerException != null ? $" → {wgcEx.InnerException.GetType().Name}: {wgcEx.InnerException.Message}" : "";
            Log.E("EngineCoordinator", $"WGC desktop falhou: {wgcEx.GetType().Name}: {wgcEx.Message}{inner}");
        }

        // 3) DXGI Desktop Duplication (full monitor)
        try
        {
            var dxgi = new DxgiCaptureSource();
            dxgi.Initialize(_sharedDevice, gameHwnd);
            _capture = dxgi;
            _status.Update(s => s.CaptureBackend = "DXGI");
            Log.I("EngineCoordinator", "Captura: DXGI Desktop Duplication");
            return;
        }
        catch (Exception dxgiEx)
        {
            Log.E("EngineCoordinator", $"DXGI falhou: {dxgiEx.GetType().Name}: {dxgiEx.Message}");
        }

        // 4) Hybrid fallback
        try
        {
            var hybrid = new HybridCaptureSource();
            hybrid.Initialize(_sharedDevice, gameHwnd);
            _capture = hybrid;
            _status.Update(s => s.CaptureBackend = _capture.Name);
            Log.I("EngineCoordinator", $"Captura híbrida: HWND=0x{gameHwnd:X8}");
            return;
        }
        catch (Exception hybridEx)
        {
            Log.E("EngineCoordinator", $"Hybrid falhou: {hybridEx.GetType().Name}: {hybridEx.Message}");
        }

        // If all fail, leave _capture null and caller handles cleanup.
    }

    private int _lastCropX, _lastCropY, _lastCropW, _lastCropH;

    private void UpdateDxgiCropRect()
    {
        var game = ResolveTargetGame();
        int cropX = 0, cropY = 0, cropW = 0, cropH = 0;

        if (game.IsValid && game.Hwnd != IntPtr.Zero && DwmGetWindowAttribute(game.Hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out var rect, Marshal.SizeOf<RECT>()) == 0)
        {
            var hMon = MonitorHelper.GetMonitorFromWindowHandle(game.Hwnd);
            var (mLeft, mTop, mRight, mBottom) = MonitorHelper.GetMonitorRect(hMon);

            cropW = rect.Right - rect.Left;
            cropH = rect.Bottom - rect.Top;
            if (cropW > 0 && cropH > 0)
            {
                var clampedLeft = Math.Max(rect.Left, mLeft);
                var clampedTop = Math.Max(rect.Top, mTop);
                var clampedRight = Math.Min(rect.Right, mRight);
                var clampedBottom = Math.Min(rect.Bottom, mBottom);
                cropW = (clampedRight - clampedLeft) & ~1;
                cropH = (clampedBottom - clampedTop) & ~1;
                cropX = clampedLeft - mLeft;
                cropY = clampedTop - mTop;
                Log.I("UpdateDxgiCropRect", $"window={rect.Left}:{rect.Top}:{rect.Right}:{rect.Bottom} monitor={mLeft}:{mTop}:{mRight}:{mBottom} clamped={clampedLeft}:{clampedTop}:{clampedRight}:{clampedBottom} crop={cropX}:{cropY}:{cropW}:{cropH}");

                // Crop muito pequeno: GpuVideoConverter falha com E_INVALIDARG e ffmpeg produz output vazio.
                // Ignora crop e usa quadro completo quando abaixo de 320x240.
                if (cropW > 0 && (cropW < 320 || cropH < 240))
                {
                    Log.I("UpdateDxgiCropRect", $"Crop muito pequeno ({cropW}x{cropH}) — usando quadro completo");
                    cropW = 0;
                    cropH = 0;
                }
            }
        }

        if (_encoder != null && (cropX != _lastCropX || cropY != _lastCropY || cropW != _lastCropW || cropH != _lastCropH))
        {
            _encoder.SetCropRect(cropX, cropY, cropW, cropH);

            // Se crop cobre a tela inteira (crop=source=no-op), não precisa restartar ffmpeg
            bool isNoop = cropW == _captureWidth && cropH == _captureHeight && cropX == 0 && cropY == 0;
            if (!isNoop)
            {
                Log.E("UpdateDxgiCropRect", $"Crop real: {_lastCropX},{_lastCropY},{_lastCropW},{_lastCropH} → {cropX},{cropY},{cropW},{cropH}. Chamando Flush()...");
                _encoder.Flush();
            }
            else
            {
                Log.I("UpdateDxgiCropRect", $"Crop no-op (tela inteira) — Flush ignorado");
            }

            _lastCropX = cropX; _lastCropY = cropY; _lastCropW = cropW; _lastCropH = cropH;
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("avrt.dll", SetLastError = true)]
    private static extern IntPtr AvSetMmThreadCharacteristicsW([MarshalAs(UnmanagedType.LPWStr)] string taskName, out uint taskIndex);

    [DllImport("avrt.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AvRevertMmThreadCharacteristics(IntPtr handle);

    private IntPtr _mmThreadHandle = IntPtr.Zero;

    private void SetMmThreadPriority()
    {
        uint index = 0;
        var ret = AvSetMmThreadCharacteristicsW("Capture", out index);
        if (ret == IntPtr.Zero)
            Log.D("EngineCoordinator", $"AvSetMmThreadCharacteristics('Capture') failed: {Marshal.GetLastWin32Error()}");
        else
            _mmThreadHandle = ret;
    }

    private void RevertMmThreadPriority()
    {
        if (_mmThreadHandle != IntPtr.Zero)
        {
            AvRevertMmThreadCharacteristics(_mmThreadHandle);
            _mmThreadHandle = IntPtr.Zero;
        }
    }
}
