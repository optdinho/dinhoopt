using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private AudioMixer CreateAudioMixer()
    {
        _audioFallback = false;
        var cfg = _config.Config;
        var sampleRate = cfg.AudioSampleRate is 44100 or 48000 or 96000 ? cfg.AudioSampleRate : 48000;

        // GameAudioOnly=true  → CppLoopbackSource (só jogo + mic via C++ DLL)
        // GameAudioOnly=false → WasapiLoopbackSource (áudio completo do sistema)
        // GameAudioOnly vem do Electron, controlado pelos toggles na UI

        if (cfg.UseExcludeMode && cfg.ExcludeProcessId > 0)
        {
            Log.I("EngineCoordinator", $"Áudio: EXCLUDE mode (C++ DLL) — excluindo PID {cfg.ExcludeProcessId} (e filhos), capturando TODO o resto");
            _loopbackSource = new CppLoopbackSource(cfg.ExcludeProcessId, includeTree: false, sampleRate: sampleRate);
        }
        else
        {
            var selectedPids = cfg.SelectedAudioSessions;

            if (selectedPids.Count > 0)
            {
                var processes = ResolveAudioPids(selectedPids);

                if (processes.Count > 0)
                {
                    Log.I("EngineCoordinator", $"Áudio: CppLoopbackSource INCLUDE para {processes.Count} processo(s)");
                    foreach (var (pid, name) in processes)
                        Log.I("EngineCoordinator", $"PID alvo {pid}: {name}");

                    // VAD INCLUDE mode captura o processo + filhos (includeTree=true)
                    // Para múltiplos PIDs, capturamos apenas o primeiro (includeTree já pega filhos)
                    var (targetPid, procName) = processes[0];
                    _loopbackSource = new CppLoopbackSource(targetPid, includeTree: true, sampleRate: sampleRate);

                    _audioFallback = false;
                }
                else
                {
                    Log.I("EngineCoordinator", "Nenhum PID selecionado está vivo — usando loopback completo");
                    _loopbackSource = new WasapiLoopbackSource(sampleRate);
                }
            }
            else
            {
                _loopbackSource = new WasapiLoopbackSource(sampleRate);
                Log.I("EngineCoordinator", "Áudio: captura completa (loopback) — NENHUM filtro ativo");
            }
        }

        _micSource = string.IsNullOrEmpty(_config.Config.MicDeviceId)
            ? new WasapiMicSource(sampleRate, null)
            : new WasapiMicSource(sampleRate, _config.Config.MicDeviceId);
        return new AudioMixer(_loopbackSource, _micSource, _clock);
    }

    private int _audioPacketCount;
    private int _audioSampleRate = 48000;
    private TimeSpan _lastAudioAnchor = TimeSpan.Zero;
    private int _maxAacDrainCount;

    private void OnAudioPacket(EncodedPacket packet)
    {
        if (!_recording)
        {
            if (_audioPacketCount == 0)
                Log.W("AudioDiag", $"Primeiro packet DESCARTADO: !_recording. packet pts={packet.Pts.TotalSeconds:F3}s");
            _audioPacketCount++;
            return;
        }

        _audioPacketCount++;

        if (_audioPacketCount <= 5 || _audioPacketCount % 100 == 0)
            Log.D("AudioDiag", $"packet #{_audioPacketCount} pts={packet.Pts.TotalSeconds:F3}s clock={_clock.Now.TotalSeconds:F3}s anchor={_lastAudioAnchor.TotalSeconds:F3}s");

        // Envia PCM ao encoder ANTES de drenar AAC — o encoder precisa de dados
        // para produzir frames. A drenagem usa _lastAudioAnchor (PTS do batch PCM
        // que gerou estes AAC frames), que é atualizado SÓ DEPOIS do drain.
        if (packet.PcmSamples != null)
            _aacEncoder?.EncodeAudio(packet.PcmSamples);
        else if (_audioPacketCount <= 5)
            Log.W("AudioDiag", $"packet #{_audioPacketCount}: PcmSamples=null (sem dados PCM)");

        // Drena AAC frames usando _lastAudioAnchor (PTS do PCM que os produziu)
        // — NÃO packet.Pts (que pode ser de um batch MAIS NOVO se o encoder
        // estiver acumulando backlog). Isso limita o erro de PTS a ~20ms.
        int aacCount = 0;
        while (_aacEncoder?.TryReadPacket() is { } aacPkt)
        {
            aacCount++;
            var pts = _lastAudioAnchor + TimeSpan.FromSeconds((double)(aacCount - 1) * 1024.0 / _audioSampleRate);
            var corrected = new EncodedPacket(aacPkt.Data, aacPkt.Type, pts, aacPkt.Duration, aacPkt.IsKeyFrame);
            _buffer.AddAudio(corrected);
        }

        // Avança o anchor SÓ DEPOIS do drain, usando o PTS do batch atual.
        // Antes o anchor era atualizado ANTES do drain, fazendo AAC frames
        // receberem PTS de batches MAIS NOVOS que os produziram.
        if (packet.Pts > _lastAudioAnchor || _lastAudioAnchor == TimeSpan.Zero)
            _lastAudioAnchor = packet.Pts;

        // Diagnóstico de A/V sync: rastreia pico de aacCount (frames AAC drenados por batch).
        // Se aacCount > 1, o offset dentro do batch usa o mesmo anchor → erro potencial
        // de (aacCount-1) * 21.3ms (1024 samples / 48kHz).
        if (aacCount > _maxAacDrainCount)
            _maxAacDrainCount = aacCount;

        if (_audioPacketCount % 1000 == 0 && _audioPacketCount > 0)
            Log.I("AudioDiag", $"SYNC-DIAG: packets={_audioPacketCount} maxAacDrain={_maxAacDrainCount} anchorGap={(_lastAudioAnchor - TimeSpan.FromSeconds((_audioPacketCount - 1) * 1024.0 / _audioSampleRate)).TotalMilliseconds:F1}ms");

        if ((_audioPacketCount <= 5 || _audioPacketCount % 100 == 0) && aacCount > 0)
            Log.D("AudioDiag", $"packet #{_audioPacketCount}: AAC frames produced={aacCount}");
        else if (_audioPacketCount <= 5 && aacCount == 0 && packet.PcmSamples != null)
            Log.W("AudioDiag", $"packet #{_audioPacketCount}: AAC frames produced=0 (encoder pode estar aquecendo)");
    }

    private List<(int Pid, string Name)> ResolveAudioPids(Dictionary<int, string> selectedPids)
    {
        var resolved = new Dictionary<int, string>();
        foreach (var (pid, name) in selectedPids)
        {
            bool alive = false;
            try { using var p = Process.GetProcessById(pid); alive = !p.HasExited; }
            catch (Exception ex) { Log.W("AudioPids", $"PID {pid}: {ex.GetType().Name}"); }

            if (alive)
            {
                resolved[pid] = name;
                // Inclui subprocessos — FiveM e outros jogos modernos usam múltiplos processos
                // e o áudio pode vir de um filho (ex: FiveM_GTAProcess.exe)
                var children = GetChildProcesses(pid);
                foreach (var childPid in children)
                {
                    if (!resolved.ContainsKey(childPid))
                    {
                        resolved[childPid] = $"{name}>child#{childPid}";
                        Log.I("EngineCoordinator", $"Subprocesso encontrado: PID {childPid} (filho de {name}/{pid})");
                    }
                }
            }
            else
            {
                var matches = Process.GetProcessesByName(name.Replace(".exe", ""));
                try
                {
                    var found = matches.FirstOrDefault(p => !p.HasExited);
                    if (found != null)
                    {
                        Log.I("EngineCoordinator", $"PID {pid} ({name}) morto na resolução — resolvido para PID {found.Id}");
                        resolved[found.Id] = name;
                        // Também inclui subprocessos do PID resolvido
                        var children = GetChildProcesses(found.Id);
                        foreach (var childPid in children)
                        {
                            if (!resolved.ContainsKey(childPid))
                            {
                                resolved[childPid] = $"{name}>child#{childPid}";
                                Log.I("EngineCoordinator", $"Subprocesso {childPid} de {name} (resolvido)");
                            }
                        }
                    }
                }
                finally
                {
                    foreach (var m in matches) m.Dispose();
                }
            }
        }
        return resolved.Select(kvp => (kvp.Key, kvp.Value)).ToList();
    }

    private void ToggleMic()
    {
        var mixer = _audioMixer;
        if (mixer != null)
        {
            mixer.MicEnabled = !mixer.MicEnabled;
            Log.I("EngineCoordinator", $"[toggleMic] Microfone: {(mixer.MicEnabled ? "ATIVO" : "MUTO")}");
        }
    }

    private void OnMicStateChanged(bool active)
    {
        var mixer = _audioMixer;
        if (mixer != null)
            mixer.MicEnabled = active;
        Log.I("EngineCoordinator", $"[pttEvent] Microfone (PTT): {(active ? "ATIVO" : "MUTO")}");
    }

    private static string NormalizePttMode(string mode)
    {
        return mode?.ToLowerInvariant() switch
        {
            "hold" => "Hold",
            "toggle" => "Toggle",
            _ => "Off",
        };
    }

    private bool _appliedGameAudioOnly;
    private int _appliedGameAudioPid;

    private void ApplyAudioSessionsInternal(List<int> pids)
    {
        _config.Update(c =>
        {
            if (pids.Count > 0)
            {
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
                c.SelectedAudioSessions = selectedPids;
            }
            else
            {
                c.SelectedAudioSessions = new Dictionary<int, string>();
            }
        });

        if (_recording)
            TryScheduleRestart("GameAudioOnly");
    }

    private void TryScheduleRestart(string reason)
    {
        lock (_restartLock)
        {
            if (_restartPending)
            {
                Log.I("EngineCoordinator", $"Restart já pendente — ignorando ({reason})");
                return;
            }
            _restartPending = true;
        }

        Log.I("EngineCoordinator", $"Reiniciando pipeline ({reason})...");
        _ = Task.Run(() =>
        {
            try
            {
                StopCapture();
                StartCapture();
            }
            finally
            {
                lock (_restartLock)
                    _restartPending = false;
            }
        });
    }
}
