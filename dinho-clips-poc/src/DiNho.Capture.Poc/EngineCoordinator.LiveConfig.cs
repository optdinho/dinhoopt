using System;
using System.Threading;
using System.Threading.Tasks;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    // ── Config em runtime (2026-11-10) ────────────────────────────────────────
    // Até aqui o motor lia Fps/Cq/preset SÓ dentro de StartCapture: mudar a qualidade
    // com a gravação a correr não tinha efeito nenhum até parar e voltar a gravar.
    // Agora qualidade e fps são reaplicados reiniciando APENAS o encoder — a fonte de
    // captura (WGC/DXGI) e o buffer de replay ficam intactos. Resolução e codec
    // continuam a entrar só no próximo arranque: o save usa `-c:v copy` e um ficheiro
    // com pacotes de duas resoluções sai corrompido (ver PipelineConfigSnapshot.DiffTo).
    //
    // O reinício é o mesmo tipo de operação que o watchdog já faz em produção
    // (cancelar o loop, trocar o encoder, relançar), com o PTS a continuar absoluto
    // porque o MasterClock é por processo — logo a timeline não recomeça nem fura.

    /// <summary>Espera entre tentativas quando o pipeline está a meio de outro reinício.</summary>
    private const int LiveConfigRetryDelayMs = 2000;

    /// <summary>~30 s no pior caso; depois desiste e a config entra no próximo arranque.</summary>
    private const int LiveConfigMaxAttempts = 15;

    /// <summary>Config que o pipeline em curso está realmente a usar.</summary>
    private PipelineConfigSnapshot _appliedPipelineConfig;

    private int _liveConfigApplyRunning;
    private int _liveConfigApplyDirty;

    /// <summary>
    /// Decide e agenda a reaplicação. Devolve <c>true</c> quando a alteração foi
    /// entregue ao pipeline em curso; <c>false</c> quando não há nada aplicável a quente.
    /// Chamado de <c>HandleConfig</c> — nunca lança (o comando `config` tem de responder).
    /// </summary>
    internal bool TryScheduleLiveConfigApply(LiveConfigChange change)
    {
        if (!_captureActive || change.IsEmpty)
            return false;

        if (change.OutputFormat)
        {
            Log.I("EngineCoordinator",
                "Config: resolução/codec alterados — sem efeito a quente, entram no próximo início de " +
                "gravação (o buffer de replay em curso continua válido)");
        }

        if (!change.NeedsEncoderRestart)
            return false;

        ScheduleLiveConfigApply();
        return true;
    }

    /// <summary>
    /// Marca a config como por-aplicar e garante UM aplicador a correr. Alterações em
    /// rajada (arrastar o slider de CQ) colapsam numa aplicação que lê sempre a config
    /// mais recente no momento em que corre.
    /// </summary>
    private void ScheduleLiveConfigApply()
    {
        Volatile.Write(ref _liveConfigApplyDirty, 1);
        if (Interlocked.CompareExchange(ref _liveConfigApplyRunning, 1, 0) != 0)
            return; // já há um a correr — ele reavalia a config no fim

        _ = Task.Run(async () =>
        {
            var attempts = 0;
            try
            {
                while (Volatile.Read(ref _liveConfigApplyDirty) == 1)
                {
                    Volatile.Write(ref _liveConfigApplyDirty, 0);

                    if (await ApplyLiveConfigAsync())
                    {
                        attempts = 0;
                        continue;
                    }

                    if (!_captureActive || ++attempts >= LiveConfigMaxAttempts)
                    {
                        if (attempts > 0)
                            Log.W("EngineCoordinator",
                                $"Config em runtime: desisti após {attempts} tentativas (pipeline a reiniciar) — " +
                                "os valores entram no próximo início de gravação");
                        break;
                    }

                    // Outro reinício (watchdog) está a caminho e já vai reler a config:
                    // competir com ele duplicaria o restart do ffmpeg.
                    await Task.Delay(LiveConfigRetryDelayMs);
                    Volatile.Write(ref _liveConfigApplyDirty, 1);
                }
            }
            catch (Exception ex)
            {
                Log.E("EngineCoordinator", $"Config em runtime falhou: {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                Volatile.Write(ref _liveConfigApplyRunning, 0);
                // Fecha a corrida "saiu do while" vs "chegou config nova": se sujar
                // depois de limpar o running, ninguém mais o apanhava.
                if (Volatile.Read(ref _liveConfigApplyDirty) == 1)
                    ScheduleLiveConfigApply();
            }
        });
    }

    /// <summary>
    /// Reaplica a config ao pipeline em curso. Devolve <c>true</c> quando não há nada
    /// pendente (ou quando aplicou); <c>false</c> só quando precisa e não pode agora.
    /// </summary>
    private async Task<bool> ApplyLiveConfigAsync()
    {
        if (!_captureActive || !_recording)
            return true; // a próxima captura lê a config do zero

        var target = PipelineConfigSnapshot.From(_config.Config);
        var change = _appliedPipelineConfig.DiffTo(target);
        if (!change.NeedsEncoderRestart)
            return true;

        if (_needsReinit)
            return false;

        var cts = _pipelineCts;
        var task = _pipelineTask;

        Log.I("EngineCoordinator",
            $"Config em runtime: {change} — reiniciando apenas o encoder " +
            $"(captura={_capture?.Name ?? "null"} {_captureWidth}x{_captureHeight})");

        // Mesma dança do ReinitializePipelineAsync: cancelar FORA do lock e guardar
        // as referências em locais (StopCapture pode anulá-las em paralelo).
        cts?.Cancel();
        if (task != null)
        {
            try { await task.WaitAsync(TimeSpan.FromSeconds(2)); }
            catch (TimeoutException ex) { Log.W("EngineCoordinator", $"Pipeline não saiu em 2s após cancel (config em runtime): {ex.Message}"); }
            catch { /* esperado: TaskCanceledException do cancel acima */ }
        }

        lock (_pipelineLock)
        {
            // StopCapture pode ter corrido durante a espera — não ressuscitar um pipeline zumbi.
            if (!_captureActive || !_recording)
                return true;

            _pipelineCts?.Dispose();
            _pipelineCts = null;
            _pipelineTask = null;

            // Perfil de RAM/qualidade com os valores novos (Cq/bitrate/bframes/...).
            // NÃO toca em _outputWidth/_outputHeight: a resolução em uso é sagrada e uma
            // resolução nova fica pendente para o próximo arranque. O adaptive quality
            // também é diferido, por isso resolve-se com o valor APLICADO (ele impõe cap
            // de resolução de saída).
            ResolveActiveProfileFromConfig(_appliedPipelineConfig.AdaptiveQualityEnabled);

            if (change.FrameRate && _capture is WgcCaptureSource wgc)
            {
                // Sem isto, 60→30 (ou 30→60) ficava preso no cap antigo do DWM e o fps
                // pedido só valeria no próximo arranque.
                wgc.SetCaptureFrameRate(target.Fps);
                Log.I("EngineCoordinator", $"Cap de captura ajustado para {target.Fps} fps");
            }

            _encoder?.Dispose();
            _encoder = null;
            // Formato de saída vem do snapshot APLICADO, nunca da config: uma troca de
            // codec/ForceSoftware pendente não pode entrar por aqui — o buffer de replay
            // em curso passaria a ter pacotes de outro codec e o save (`-c:v copy`) sairia
            // corrompido. Só os parâmetros de qualidade/fps é que vêm da config.
            _encoder = EncoderManager.CreateBestEncoder(
                _appliedPipelineConfig.ForceSoftware, _sharedDevice, _activeProfile.MaxrateKbps);
            if (_encoder is FfmpegEncoder fe)
            {
                fe.SetQualityParams(
                    cq: _activeProfile.Cq,
                    maxrateKbps: _activeProfile.MaxrateKbps,
                    bufsizeKbps: _activeProfile.BufsizeKbps,
                    bframes: _activeProfile.Bframes,
                    lookahead: _activeProfile.Lookahead,
                    preset: _config.Config.EncoderPreset,
                    codec: _appliedPipelineConfig.Codec,
                    multipass: _config.Config.Multipass,
                    amfUsage: _config.Config.AmfUsage);
                fe.SetOutputResolution(_outputWidth, _outputHeight);
                fe.SetRemoveBlackBars(_config.Config.StretchToFit);
            }
            _encoder.Initialize(_captureWidth, _captureHeight, target.Fps, _activeProfile.MaxrateKbps);

            _buffer.MaxBytes = _activeProfile.MaxBufferBytes;
            ApplyReplayBufferMode();

            // O restart pode trocar o codec (escada adaptativa), então o status é
            // reescrito junto — senão o editor re-encodava com o codec antigo.
            _status.Update(s =>
            {
                s.Encoder = _encoder.GetType().Name.Replace("Encoder", "");
                s.Codec = _encoder.Codec ?? "";
            });

            _starvationStart = default;
            _watchdog.Reset();
            _pendingTimeoutDrop = false;
            _pipelineCts = new CancellationTokenSource();
            _pipelineTask = Task.Run(() => PipelineLoop(_pipelineCts.Token));

            // A resolução/codec novos (se houver) continuam PENDENTES: guarda-se o
            // formato que está mesmo em uso, senão a alteração perdia-se.
            _appliedPipelineConfig = change.OutputFormat
                ? target.KeepOutputFormatOf(_appliedPipelineConfig)
                : target;

            Log.I("EngineCoordinator",
                $"Config aplicada em runtime: cq={_activeProfile.Cq} maxrate={_activeProfile.MaxrateKbps}kbps " +
                $"bf={_activeProfile.Bframes} lookahead={_activeProfile.Lookahead} preset='{_config.Config.EncoderPreset}' " +
                $"fps={target.Fps} codec={_encoder.Codec ?? "?"} " +
                $"encoded={(_outputWidth > 0 ? $"{_outputWidth}x{_outputHeight}" : $"{_captureWidth}x{_captureHeight}")}");
        }

        return true;
    }
}
