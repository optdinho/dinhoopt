using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using System.Text.Json;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private IpcMessage HandleConfigMessages(IpcMessage msg, string action)
    {
        return action switch
        {
            "handshake" => HandleHandshake(),
            "setReplayTime" => HandleSetReplayTime(msg),
            "startEngine" => HandleStartEngine(),
            "stopEngine" => HandleStopEngine(),
            "setCustomGameProcess" => HandleSetCustomGameProcess(msg),
            "config" => HandleConfig(msg),
            "getGpus" => HandleGetGpus(),
            _ => throw new InvalidOperationException($"Unexpected config action: {action}")
        };
    }

    private IpcMessage HandleHandshake()
    {
        return new IpcMessage
        {
            Action = "handshake_ack",
            Value = JsonSerializer.SerializeToElement(new
            {
                engineVersion = "1.0.0",
                status = "ok"
            })
        };
    }

    private IpcMessage HandleSetReplayTime(IpcMessage msg)
    {
        if (msg.Value.HasValue)
        {
            var secs = msg.Value.Value.GetInt32();
            _config.Update(c => c.ReplayTimeSeconds = secs);
        }
        return new IpcMessage { Action = "ok" };
    }

    private IpcMessage HandleStartEngine()
    {
        _ = StartAsync();
        return new IpcMessage { Action = "ok" };
    }

    private IpcMessage HandleStopEngine()
    {
        _ = StopAsync();
        return new IpcMessage { Action = "ok" };
    }

    private IpcMessage HandleSetCustomGameProcess(IpcMessage msg)
    {
        if (msg.Value.HasValue)
        {
            try
            {
                var processName = msg.Value.Value.GetProperty("processName").GetString() ?? "";
                _customGameProcess = processName;
                Log.I("EngineCoordinator", $"Custom game process set to '{processName}'");
            }
            catch { /* ignore malformed */ }
        }
        return new IpcMessage { Action = "ok" };
    }

    private IpcMessage HandleConfig(IpcMessage msg)
    {
        try
        {
            if (!msg.Value.HasValue)
                return new IpcMessage { Action = "ok" };

            var cfgEl = msg.Value.Value;
            // Electron envia { config: {...} } dentro do payload
            if (cfgEl.TryGetProperty("config", out var inner))
                cfgEl = inner;

            var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            var incoming = JsonSerializer.Deserialize<AppConfig>(cfgEl.GetRawText(), opts);
            if (incoming != null)
            {
                var oldGameDetection = _config.Config.GameDetection;
                var oldPttMode = PttModeHelper.Normalize(_config.Config.PttMode);

                _config.Update(c =>
                {
                    c.ReplayTimeSeconds = incoming.ReplayTimeSeconds;
                    c.MicEnabled = incoming.MicEnabled;
                    c.AudioSampleRate = incoming.AudioSampleRate;
                    c.MicVolume = incoming.MicVolume;
                    c.GameVolume = incoming.GameVolume;
                    c.Fps = incoming.Fps;
                    c.Width = incoming.Width;
                    c.Height = incoming.Height;
                    c.BitrateKbps = incoming.BitrateKbps;
                    c.OutputDirectory = incoming.OutputDirectory;
                    c.ForceSoftware = incoming.ForceSoftware;
                    c.Codec = incoming.Codec;
                    c.HotkeyBindings = incoming.HotkeyBindings;
                    c.PushToTalkKeys = incoming.PushToTalkKeys;
                    c.PttMode = incoming.PttMode;
                    c.MicDeviceId = incoming.MicDeviceId;
                    c.AutoStartCapture = incoming.AutoStartCapture;
                    c.UseExcludeMode = incoming.UseExcludeMode;
                    c.ExcludeProcessId = incoming.ExcludeProcessId;
                    c.ElectronPid = incoming.ElectronPid;
					c.AudioLoopback = incoming.AudioLoopback;
					c.GameDetection = incoming.GameDetection;
					// GameAudioOnly vem do Electron: o frontend garante que
					// audioLoopback e gameAudioOnly são mutuamente exclusivos
					c.GameAudioOnly = incoming.GameAudioOnly;
                    c.NoiseSuppressionEnabled = incoming.NoiseSuppressionEnabled;
                    c.AdaptiveQualityEnabled = incoming.AdaptiveQualityEnabled;
                    c.AutoCleanupEnabled = incoming.AutoCleanupEnabled;
                    c.AutoCleanupThresholdGB = incoming.AutoCleanupThresholdGB;
                    if (incoming.SelectedAudioSessions.Count > 0)
                        c.SelectedAudioSessions = incoming.SelectedAudioSessions;
                });

                // Aplica GameAudioOnly: auto-filtra áudio para só o jogo + mic
                // Quando GameAudioOnly=true, C++ DLL captura só o PID do jogo
                // Quando GameAudioOnly=false, pipeline reinicia com WasapiLoopbackSource
                ApplyGameAudioOnly();

                // Aplica GameDetection: liga/desliga o detector de jogos
                if (incoming.GameDetection && !oldGameDetection)
                {
                    Log.I("EngineCoordinator", "GameDetection ON — iniciando detector");
                    _gameDetector.Start();
                }
                else if (!incoming.GameDetection && oldGameDetection)
                {
                    Log.I("EngineCoordinator", "GameDetection OFF — parando detector, limpando jogo atual");
                    _gameDetector.Stop();
                    _lastDetectedGame = new GameInfo();
                    _status.Update(s => s.Game = null);
                }

                ApplyHotkeyBindings();

                // Aplica AutoCleanup: restart/stop timer
                _cleanupTimer?.Change(Timeout.Infinite, Timeout.Infinite);
                if (_config.Config.AutoCleanupEnabled)
                    _cleanupTimer?.Change(TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

                // Reconfigura PTT — atomically replace keys to avoid dropping in-flight events
                _ptt.ReplaceKeys(_config.Config.PushToTalkKeys);
                _ptt.Mode = PttModeHelper.Normalize(_config.Config.PttMode) switch
                {
                    "Toggle" => PttMode.Toggle,
                    "Hold" => PttMode.Hold,
                    _ => PttMode.Off,
                };

                // Aplica noise suppression + gains no mixer
                var mixer = _audioMixer;
                if (mixer != null)
                {
                    mixer.NoiseSuppressionEnabled = _config.Config.NoiseSuppressionEnabled;
                    mixer.GameGain = _config.Config.GameVolume;
                    mixer.MicGain = _config.Config.MicVolume;
                    var newPttMode = PttModeHelper.Normalize(_config.Config.PttMode);
                    if (newPttMode is "Off")
                    {
                        // PTT Off: mic always follows config (user toggle or slider)
                        mixer.MicEnabled = _config.Config.MicEnabled;
                    }
                    else if (newPttMode is not "Off" && oldPttMode is "Off")
                    {
                        // Transition Off→PTT: mic starts disabled, PTT keys control it
                        mixer.MicEnabled = false;
                        Log.I("EngineCoordinator", $"[cfgTrans→PTT] MicEnabled=false");
                    }
                    // PTT already active: PTT system controls MicEnabled via key events
                    Log.I("EngineCoordinator", $"Gains: game={_config.Config.GameVolume:F2} mic={_config.Config.MicVolume:F2} micEnabled={mixer.MicEnabled} pttMode={newPttMode} (oldPtt={oldPttMode})");
                }

                // Propaga ElectronPid para o GameDetector (filtro de falsos foreground)
                _gameDetector.SetElectronPid(_config.Config.ElectronPid);

                Log.I("EngineCoordinator", "Config atualizada via pipe");
            }
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"Erro ao aplicar config: {ex.Message}");
        }
        return new IpcMessage { Action = "ok" };
    }

    private IpcMessage HandleGetGpus()
    {
        var gpus = EncoderManager.GetGpuList();
        var items = gpus.Select(g => new { index = g.Index, name = g.Name, vendorId = g.VendorId }).ToList();
        return new IpcMessage
        {
            Action = "gpuList",
            Value = JsonSerializer.SerializeToElement(items)
        };
    }
}
