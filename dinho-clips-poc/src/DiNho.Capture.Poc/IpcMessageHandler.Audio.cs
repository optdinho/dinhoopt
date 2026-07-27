using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Diagnostics.ToolHelp;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private IpcMessage HandleAudioMessages(IpcMessage msg, string action)
    {
        return action switch
        {
            "getAudioSessions" => HandleGetAudioSessions(),
            "setAudioSessions" => HandleSetAudioSessions(msg),
            _ => throw new InvalidOperationException($"Unexpected audio action: {action}")
        };
    }

    private IpcMessage HandleGetAudioSessions()
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
                    if (proc.Id < 10) { proc.Dispose(); continue; }
                    if (proc.SessionId == 0) { proc.Dispose(); continue; }
                    if (!proc.Responding) { proc.Dispose(); continue; }
                    if (proc.MainWindowHandle == IntPtr.Zero) { proc.Dispose(); continue; }
                    if (string.IsNullOrEmpty(proc.ProcessName)) { proc.Dispose(); continue; }
                    if (sessionPids.Contains(proc.Id)) { proc.Dispose(); continue; }

                    sessionPids.Add(proc.Id);
                    list.Add(new
                    {
                        processId = proc.Id,
                        processName = proc.ProcessName,
                        displayName = proc.ProcessName,
                        isSelected = selectedPids.Count == 0 || selectedPids.ContainsKey(proc.Id),
                    });
                }
                catch { try { proc.Dispose(); } catch { } }
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

    private IpcMessage HandleSetAudioSessions(IpcMessage msg)
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

    // ── Process Helpers ──

    /// <summary>
    /// Expande uma lista de PIDs incluindo processos filhos via Toolhelp32Snapshot.
    /// Retorna (todos os PIDs, mapeamento child→parent para resolver nomes sem abrir handles).
    /// </summary>
    private static unsafe (HashSet<int>, Dictionary<int, int>) ExpandWithChildProcesses(IEnumerable<int> pids)
    {
        var result = new HashSet<int>(pids);
        var childToParent = new Dictionary<int, int>();
        try
        {
            HANDLE snapshot = PInvoke.CreateToolhelp32Snapshot(CREATE_TOOLHELP_SNAPSHOT_FLAGS.TH32CS_SNAPPROCESS, 0);
            if (snapshot == (HANDLE)(nint)(-1)) return (result, childToParent);

            try
            {
                var entry = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
                if (!PInvoke.Process32FirstW(snapshot, &entry))
                    return (result, childToParent);

                var parentMap = new Dictionary<int, int>();
                do
                {
                    parentMap[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                }
                while (PInvoke.Process32NextW(snapshot, &entry));

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
                PInvoke.CloseHandle(snapshot);
            }
        }
        catch { }
        return (result, childToParent);
    }
}
