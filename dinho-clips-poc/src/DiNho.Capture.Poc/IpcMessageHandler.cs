using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    // ── IPC Message Handler ──

    private async Task<IpcMessage?> OnIpcMessage(IpcMessage msg)
    {
        // Lida com mensagens do Electron (spec seção 16)
        switch (msg.Action)
        {
            case "handshake":
                return new IpcMessage
                {
                    Action = "handshake_ack",
                    Value = JsonSerializer.SerializeToElement(new
                    {
                        engineVersion = "1.0.0",
                        status = "ok"
                    })
                };

            case "setReplayTime":
                if (msg.Value.HasValue)
                {
                    var secs = msg.Value.Value.GetInt32();
                    _config.Update(c => c.ReplayTimeSeconds = secs);
                }
                return new IpcMessage { Action = "ok" };

            case "startEngine":
                _ = StartAsync();
                return new IpcMessage { Action = "ok" };

            case "stopEngine":
                _ = StopAsync();
                return new IpcMessage { Action = "ok" };

            case "setCustomGameProcess":
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

            case "startCapture":
                if (_captureActive)
                {
                    Log.I("EngineCoordinator", "startCapture ignorado — captura já ativa");
                    return new IpcMessage { Action = "ok" };
                }
                if (msg.Value.HasValue)
                {
                    try
                    {
                        var gameProcess = msg.Value.Value.GetProperty("gameProcess").GetString();
                        if (!string.IsNullOrEmpty(gameProcess))
                        {
                            _pendingGameProcess = gameProcess;
                            Log.I("EngineCoordinator", $"startCapture pending game process '{gameProcess}'");
                        }
                    }
                    catch { /* gameProcess not provided */ }
                }
                StartCapture();
                return new IpcMessage
                {
                    Action = _captureActive ? "ok" : "error",
                    Value = _captureActive
                        ? null
                        : JsonSerializer.SerializeToElement(new { error = "Capture failed to start" })
                };

            case "stopCapture":
                StopCapture();
                return new IpcMessage { Action = "ok" };

            case "saveClip":
            {
                var stats = _buffer.Stats();
                Log.I("EngineCoordinator", $"saveClip: video={stats.videoCount} audio={stats.audioCount} " +
                    $"dur={stats.duration.TotalSeconds:F1}s bytes={stats.bytes} " +
                    $"recording={_recording} captureActive={_captureActive}");
                if (stats.videoCount == 0)
                {
                    return new IpcMessage
                    {
                        Action = "error",
                        Value = JsonSerializer.SerializeToElement(new { error = "Nothing to save (buffer empty)" })
                    };
                }
                return await SaveClipAndRespondAsync();
            }

            case "getStatus":
                return new IpcMessage
                {
                    Action = "status",
                    Value = JsonSerializer.SerializeToElement(GetStatusMessage())
                };

            case "getAudioSessions":
            {
                // Cache de 2s — Electron pode chamar em rapid succession
                long now = Stopwatch.GetTimestamp();
                if (_cachedAudioSessionsJson != null &&
                    (now - _audioSessionsCacheTicks) / Stopwatch.Frequency < 2)
                {
                    return new IpcMessage
                    {
                        Action = "audioSessions",
                        Value = JsonSerializer.Deserialize<JsonElement>(_cachedAudioSessionsJson)
                    };
                }

                var sessions = _audioSessions.EnumerateSessions();
                var sessionPids = new HashSet<int>(sessions.Select(s => s.ProcessId));
                var selectedPids = _config.Config.SelectedAudioSessions;

                // 1. Sessions WASAPI ativas
                var list = sessions.Select(s => new
                {
                    processId = s.ProcessId,
                    processName = s.ProcessName,
                    displayName = s.DisplayName,
                    isSelected = selectedPids.Count == 0 || selectedPids.ContainsKey(s.ProcessId),
                }).ToList();

                // 2. PIDs selecionados que estão vivos mas sem session WASAPI ativa
                if (selectedPids.Count > 0)
                {
                    foreach (var (pid, name) in selectedPids)
                    {
                        if (sessionPids.Contains(pid)) continue;
                        try
                        {
                            using var proc = Process.GetProcessById(pid);
                            if (!proc.HasExited)
                            {
                                sessionPids.Add(pid);
                                list.Add(new
                                {
                                    processId = pid,
                                    processName = proc.ProcessName,
                                    displayName = proc.ProcessName,
                                    isSelected = true,
                                });
                            }
                        }
                        catch { }
                    }
                }

                // 3. Todos os processos GUI com janela (captura apps como Discord que
                //    só criam sessão WASAPI quando em call de voz)
                try
                {
                    foreach (var proc in Process.GetProcesses())
                    {
                        try
                        {
                            // Pula system idle, sistema, e processos sem janela
                            if (proc.Id < 10) continue;
                            if (proc.SessionId == 0) continue;
                            if (!proc.Responding) continue;
                            if (proc.MainWindowHandle == IntPtr.Zero) continue;
                            if (string.IsNullOrEmpty(proc.ProcessName)) continue;
                            if (sessionPids.Contains(proc.Id)) continue;

                            sessionPids.Add(proc.Id);
                            list.Add(new
                            {
                                processId = proc.Id,
                                processName = proc.ProcessName,
                                displayName = proc.ProcessName,
                                isSelected = selectedPids.Count == 0 || selectedPids.ContainsKey(proc.Id),
                            });
                        }
                        catch { }
                    }
                }
                catch { }

                var rawJson = JsonSerializer.Serialize(new { sessions = list });
                _cachedAudioSessionsJson = rawJson;
                _audioSessionsCacheTicks = Stopwatch.GetTimestamp();

                return new IpcMessage
                {
                    Action = "audioSessions",
                    Value = JsonSerializer.Deserialize<JsonElement>(rawJson)
                };
            }

            case "setAudioSessions":
            {
                if (msg.Value.HasValue)
                {
                    // Electron sends { pids: [1234, 5678] }
                    var raw = msg.Value.Value.GetRawText();
                    var dict = JsonSerializer.Deserialize<Dictionary<string, List<int>>>(raw);
                    if (dict != null && dict.TryGetValue("pids", out var pids))
                    {
                        // Expande PIDs para incluir processos filhos (ex: FiveM → GTA5.exe)
                        // sem abrir handles nos filhos (anti-cheat como BattlEye detecta)
                        var (expanded, childToParent) = ExpandWithChildProcesses(pids);

                        // Resolve nomes apenas dos PIDs originais (já seguros, da UI)
                        var selectedPids = new Dictionary<int, string>();
                        foreach (var pid in pids)
                        {
                            try
                            {
                                var proc = Process.GetProcessById(pid);
                                selectedPids[pid] = proc.ProcessName;
                            }
                            catch
                            {
                                selectedPids[pid] = $"PID:{pid}";
                            }
                        }

                        // Processos filhos expandidos usam o nome do pai (sem abrir handle)
                        foreach (var (child, parent) in childToParent)
                        {
                            if (selectedPids.TryGetValue(parent, out var parentName))
                                selectedPids[child] = parentName;
                            else
                                selectedPids[child] = $"PID:{child}";
                        }
                        Log.I("EngineCoordinator", $"setAudioSessions: {selectedPids.Count} PIDs (expandido de {pids.Count}) — {string.Join(", ", selectedPids.Select(kv => $"{kv.Value}({kv.Key})"))}");
                        _config.Update(c => c.SelectedAudioSessions = selectedPids);

                        // Reinicia captura com novo filtro per-processo (PROCESS_LOOPBACK)
                    if (_recording)
                        TryScheduleRestart("setAudioSessions");
                        else
                        {
                            Log.I("EngineCoordinator", "Filtro salvo, mas captura não está ativa — será aplicado no próximo StartCapture");
                        }
                    }
                }
                return new IpcMessage { Action = "ok" };
            }

            case "config":
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
                        var oldPttMode = NormalizePttMode(_config.Config.PttMode);

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
                            c.AutoCleanupEnabled = incoming.AutoCleanupEnabled;
                            c.AutoCleanupThresholdPercent = incoming.AutoCleanupThresholdPercent;
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

                        // Reconfigura PTT
                        _ptt.ClearKeys();
                        foreach (var vk in _config.Config.PushToTalkKeys)
                            _ptt.AddPttKey((VirtualKey)vk);
                        _ptt.Mode = NormalizePttMode(_config.Config.PttMode) switch
                        {
                            "Toggle" => PttMode.Toggle,
                            "Hold" => PttMode.Hold,
                            _ => PttMode.Off,
                        };

                        // Aplica noise suppression + gains no mixer (NÃO toca MicEnabled — PTT controla)
                        if (_audioMixer != null)
                        {
                            _audioMixer.NoiseSuppressionEnabled = _config.Config.NoiseSuppressionEnabled;
                            _audioMixer.GameGain = _config.Config.GameVolume;
                            _audioMixer.MicGain = _config.Config.MicVolume;
                            var newPttMode = NormalizePttMode(_config.Config.PttMode);
                            // Só muda MicEnabled se PTT mode foi desligado (Off) ou acabou de ser ligado
                            if (newPttMode is "Off" && oldPttMode is not "Off")
                            {
                                _audioMixer.MicEnabled = _config.Config.MicEnabled;
                                Log.I("EngineCoordinator", $"[cfgTrans→Off] MicEnabled={_audioMixer.MicEnabled}");
                            }
                            else if (newPttMode is not "Off" && oldPttMode is "Off")
                            {
                                _audioMixer.MicEnabled = false;
                                Log.I("EngineCoordinator", $"[cfgTrans→PTT] MicEnabled=false");
                            }
                            // Se PTT já estava ativo ou já estava Off: não mexe (PTT sistema controla)
                            Log.I("EngineCoordinator", $"Gains: game={_config.Config.GameVolume:F2} mic={_config.Config.MicVolume:F2} micEnabled={_audioMixer.MicEnabled} pttMode={newPttMode} (oldPtt={oldPttMode})");
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

            case "getMicDevices":
            {
                Log.I("EngineCoordinator", $"getMicDevices: enumerating...");
                var list = EnumerateMicDevices();
                Log.I("EngineCoordinator", $"getMicDevices: returning {list.Count} devices");
                return new IpcMessage
                {
                    Action = "micDevices",
                    Value = JsonSerializer.SerializeToElement(new { devices = list })
                };
            }

            case "setMicDevice":
            {
                try
                {
                    if (msg.Value.HasValue)
                    {
                        var deviceId = msg.Value.Value.GetProperty("deviceId").GetString() ?? "";
                        _config.Update(c => c.MicDeviceId = deviceId);

                        // Se estiver capturando, recria o mic source com o novo device
                        if (_recording)
                        {
                            // Create new mixer BEFORE disposing old one to avoid null window
                            var oldMixer = _audioMixer;
                            _audioMixer = null;

                            try
                            {
                                _audioMixer = CreateAudioMixer();
                            }
                            catch
                            {
                                _audioMixer = oldMixer;
                                _recording = false;
                                throw;
                            }

                            _audioMixer.MicEnabled = NormalizePttMode(_config.Config.PttMode) is "Hold" or "Toggle" ? false : _config.Config.MicEnabled;
                            Log.I("EngineCoordinator", $"[reinitMic] MicEnabled={_audioMixer.MicEnabled}");
                            _audioMixer.GameGain = _config.Config.GameVolume;
                            _audioMixer.MicGain = _config.Config.MicVolume;
                            _audioMixer.OnMixedAudio += OnAudioPacket;
                            _audioMixer.Start();

                            // Dispose old AFTER new is successfully created and started
                            oldMixer?.Stop();
                            oldMixer?.Dispose();
                        }

                        Log.I("EngineCoordinator", $"Mic device set to '{deviceId}'");
                    }
                }
                catch (Exception ex)
                {
                    Log.E("EngineCoordinator", $"Erro ao setar mic device: {ex.Message}");
                }
                return new IpcMessage { Action = "ok" };
            }

            case "getGpus":
            {
                var gpus = EncoderManager.GetGpuList();
                var items = gpus.Select(g => new { index = g.Index, name = g.Name, vendorId = g.VendorId }).ToList();
                return new IpcMessage
                {
                    Action = "gpuList",
                    Value = JsonSerializer.SerializeToElement(items)
                };
            }

            case "listClips":
            {
                try
                {
                    var dir = GetOutputDirectory();
                    var files = Directory.GetFiles(dir, "*.mp4")
                        .Select(f => new FileInfo(f))
                        .OrderByDescending(f => f.CreationTime)
                        .Select(f => new
                        {
                            name = f.Name,
                            path = f.FullName,
                            sizeBytes = f.Length,
                            creationTime = f.CreationTime.ToString("o")
                        })
                        .ToList();

                    return new IpcMessage
                    {
                        Action = "clipsList",
                        Value = JsonSerializer.SerializeToElement(new { clips = files })
                    };
                }
                catch (Exception ex)
                {
                    Log.E("EngineCoordinator", $"listClips failed: {ex.Message}");
                    return new IpcMessage
                    {
                        Action = "error",
                        Value = JsonSerializer.SerializeToElement(new { error = ex.Message })
                    };
                }
            }

            case "deleteClip":
            {
                try
                {
                    if (!msg.Value.HasValue)
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Missing clip name" }) };

                    var clipName = msg.Value.Value.GetProperty("name").GetString() ?? "";
                    var dir = GetOutputDirectory();
                    var fullPath = Path.GetFullPath(Path.Combine(dir, clipName));

                    // Path traversal protection: ensure resolved path is inside output directory
                    if (!fullPath.StartsWith(dir, StringComparison.OrdinalIgnoreCase))
                    {
                        Log.W("EngineCoordinator", $"Path traversal attempt blocked: {clipName}");
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Invalid path" }) };
                    }

                    if (!File.Exists(fullPath))
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Clip not found" }) };

                    File.Delete(fullPath);

                    // Remove associated files (thumbnail, favorite marker)
                    var thumbPath = Path.ChangeExtension(fullPath, ".thumb.jpg");
                    if (File.Exists(thumbPath)) try { File.Delete(thumbPath); } catch { }
                    var markerPath = Path.Combine(dir, $".{clipName}.favorite");
                    if (File.Exists(markerPath)) try { File.Delete(markerPath); } catch { }

                    Log.I("EngineCoordinator", $"Clip deleted: {clipName}");
                    return new IpcMessage { Action = "ok" };
                }
                catch (Exception ex)
                {
                    Log.E("EngineCoordinator", $"deleteClip failed: {ex.Message}");
                    return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = ex.Message }) };
                }
            }

            case "renameClip":
            {
                try
                {
                    if (!msg.Value.HasValue)
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Missing parameters" }) };

                    var oldName = msg.Value.Value.GetProperty("oldName").GetString() ?? "";
                    var newName = msg.Value.Value.GetProperty("newName").GetString() ?? "";

                    if (string.IsNullOrEmpty(oldName) || string.IsNullOrEmpty(newName))
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Invalid names" }) };

                    var dir = GetOutputDirectory();
                    var oldPath = Path.GetFullPath(Path.Combine(dir, oldName));
                    var newPath = Path.GetFullPath(Path.Combine(dir, newName));

                    // Path traversal protection
                    if (!oldPath.StartsWith(dir, StringComparison.OrdinalIgnoreCase) ||
                        !newPath.StartsWith(dir, StringComparison.OrdinalIgnoreCase))
                    {
                        Log.W("EngineCoordinator", $"Path traversal attempt blocked: {oldName} → {newName}");
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Invalid path" }) };
                    }

                    if (!File.Exists(oldPath))
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Clip not found" }) };

                    if (File.Exists(newPath))
                        return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Destination already exists" }) };

                    File.Move(oldPath, newPath);

                    // Rename associated thumbnail
                    var oldThumb = Path.ChangeExtension(oldPath, ".thumb.jpg");
                    var newThumb = Path.ChangeExtension(newPath, ".thumb.jpg");
                    if (File.Exists(oldThumb)) try { File.Move(oldThumb, newThumb); } catch { }

                    Log.I("EngineCoordinator", $"Clip renamed: {oldName} → {newName}");
                    return new IpcMessage { Action = "ok" };
                }
                catch (Exception ex)
                {
                    Log.E("EngineCoordinator", $"renameClip failed: {ex.Message}");
                    return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = ex.Message }) };
                }
            }

            default:
                return new IpcMessage
                {
                    Action = "error",
                    Value = JsonSerializer.SerializeToElement(new { error = $"Unknown action: {msg.Action}" })
                };
        }
    }

    // ── Save Clip ──

    private async Task<IpcMessage?> SaveClipAndRespondAsync()
    {
        try
        {
            await SaveClipAsync();
            return new IpcMessage { Action = "ok" };
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"Export falhou: {ex.Message}");
            return new IpcMessage
            {
                Action = "error",
                Value = JsonSerializer.SerializeToElement(new { error = $"Export failed: {ex.Message}" })
            };
        }
    }

    // ── Audio Session Management ──

    private void ApplyGameAudioOnly()
    {
        if (_config.Config.GameAudioOnly)
        {
            var game = _lastDetectedGame.IsValid ? _lastDetectedGame : _gameDetector.CurrentGame;
            if (game.IsValid && game.ProcessId > 0)
            {
                // Skip restart if already applied to the same PID
                if (_appliedGameAudioOnly && _appliedGameAudioPid == game.ProcessId)
                {
                    Log.I("EngineCoordinator", $"GameAudioOnly já aplicado para PID {game.ProcessId} — sem restart");
                    return;
                }

                Log.I("EngineCoordinator", $"GameAudioOnly ON — filtrando áudio para '{game.ProcessName}' PID={game.ProcessId}");
                _appliedGameAudioOnly = true;
                _appliedGameAudioPid = game.ProcessId;
                ApplyAudioSessionsInternal([game.ProcessId]);
            }
            else
            {
                Log.I("EngineCoordinator", "GameAudioOnly ON mas nenhum jogo detectado — mantendo áudio atual");
            }
        }
        else
        {
            // Skip restart if GameAudioOnly was already OFF
            if (!_appliedGameAudioOnly)
            {
                Log.I("EngineCoordinator", "GameAudioOnly já estava OFF — sem restart");
                return;
            }

            Log.I("EngineCoordinator", "GameAudioOnly OFF — restaurando áudio completo do sistema");
            _appliedGameAudioOnly = false;
            _appliedGameAudioPid = 0;
            ApplyAudioSessionsInternal([]);
        }
    }

    // ── Microphone Enumeration ──

    /// <summary>
    /// Enumerates microphone devices on an STA thread (required by NAudio/COM MMDeviceEnumerator).
    /// If already on STA, runs inline; otherwise spawns a dedicated STA thread.
    /// </summary>
    private static List<object> EnumerateMicDevices()
    {
        // Need STA for NAudio COM MMDeviceEnumerator
        try
        {
            if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
                return EnumerateMicDevicesInner();
        }
        catch
        {
            // Unknown apartment state — run on dedicated STA thread
        }

        var result = new List<object>();
        var thread = new Thread(() =>
        {
            result = EnumerateMicDevicesInner();
        })
        {
            IsBackground = true,
            Name = "MicEnumSTA"
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(5000))
            Log.E("EngineCoordinator", "MicEnumSTA thread timed out after 5s");
        return result;
    }

    private static List<object> EnumerateMicDevicesInner()
    {
        var list = new List<object>();
        try
        {
            using var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            Log.I("EngineCoordinator", $"EnumerateMicDevices: enumerator created (STA={Thread.CurrentThread.GetApartmentState()})");
            var devices = enumerator.EnumerateAudioEndPoints(
                NAudio.CoreAudioApi.DataFlow.Capture,
                NAudio.CoreAudioApi.DeviceState.Active);
            Log.I("EngineCoordinator", $"EnumerateMicDevices: found {devices.Count} devices");
            string defaultId;
            try
            {
                defaultId = enumerator.GetDefaultAudioEndpoint(
                    NAudio.CoreAudioApi.DataFlow.Capture,
                    NAudio.CoreAudioApi.Role.Communications)?.ID ?? "";
                Log.I("EngineCoordinator", $"EnumerateMicDevices: defaultId='{defaultId}'");
            }
            catch (Exception exDef)
            {
                Log.E("EngineCoordinator", $"GetDefaultAudioEndpoint failed: {exDef.Message}");
                defaultId = "";
            }

            foreach (var dev in devices)
            {
                using (dev)
                {
                    Log.I("EngineCoordinator", $"EnumerateMicDevices: dev id='{dev.ID}' name='{dev.FriendlyName}'");
                    list.Add(new
                    {
                        id = dev.ID,
                        name = dev.FriendlyName,
                        isDefault = dev.ID == defaultId,
                        channels = 2,
                        sampleRate = 48000,
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"Erro ao enumerar mics: {ex.Message}");
        }
        Log.I("EngineCoordinator", $"EnumerateMicDevices: returning {list.Count} devices");
        return list;
    }

    // ── Process Helpers ──

    /// <summary>
    /// Expande uma lista de PIDs incluindo processos filhos via Toolhelp32Snapshot.
    /// Retorna (todos os PIDs, mapeamento child→parent para resolver nomes sem abrir handles).
    /// </summary>
    private static (HashSet<int>, Dictionary<int, int>) ExpandWithChildProcesses(IEnumerable<int> pids)
    {
        var result = new HashSet<int>(pids);
        var childToParent = new Dictionary<int, int>();
        try
        {
            var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == INVALID_HANDLE_VALUE) return (result, childToParent);

            try
            {
                var entry = new PROCESSENTRY32 { dwSize = Marshal.SizeOf<PROCESSENTRY32>() };
                if (!Process32First(snapshot, ref entry))
                    return (result, childToParent);

                var parentMap = new Dictionary<int, int>();
                do
                {
                    parentMap[entry.th32ProcessID] = entry.th32ParentProcessID;
                }
                while (Process32Next(snapshot, ref entry));

                // BFS: para cada PID selecionado, adiciona todos os descendentes
                var queue = new Queue<int>(result);
                while (queue.Count > 0)
                {
                    var pid = queue.Dequeue();
                    foreach (var (child, parent) in parentMap)
                    {
                        if (parent == pid && result.Add(child))
                        {
                            childToParent[child] = pid;
                            queue.Enqueue(child);
                        }
                    }
                }
            }
            finally
            {
                CloseHandle(snapshot);
            }
        }
        catch { }
        return (result, childToParent);
    }
}
