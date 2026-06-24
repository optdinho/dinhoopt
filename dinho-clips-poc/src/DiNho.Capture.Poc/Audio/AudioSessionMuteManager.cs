using NAudio.CoreAudioApi;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Mutes all audio sessions except the target PIDs before loopback capture.
/// Restores original mute states on dispose/restore.
/// Used when VAD per-process loopback is not supported on this Windows version.
/// </summary>
public sealed class AudioSessionMuteManager : IDisposable
{
    private readonly MMDevice _device;
    private readonly List<SavedState> _saved = [];
    private bool _disposed;

    public AudioSessionMuteManager()
    {
        var enumerator = new MMDeviceEnumerator();
        _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
    }

    public int MutedCount => _saved.Count;

    /// <summary>Mute all audio sessions except those belonging to targetPids.</summary>
    public void MuteAllExcept(HashSet<int> targetPids)
    {
        _saved.Clear();
        var sessions = _device.AudioSessionManager.Sessions;

        for (var i = 0; i < sessions.Count; i++)
        {
            try
            {
                var session = sessions[i];
                var pid = (int)session.GetProcessID;
                if (pid == 0 || targetPids.Contains(pid)) continue;

                var volume = session.SimpleAudioVolume;
                if (volume is null) continue;

                _saved.Add(new SavedState
                {
                    Volume = volume,
                    PreviousMute = volume.Mute,
                });
                volume.Mute = true;
                Console.WriteLine($"[SessionMuteManager] Muted pid={pid} (wasMuted={_saved[^1].PreviousMute})");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SessionMuteManager] Erro ao mutar sessão #{i}: {ex.GetType().Name}: {ex.Message}");
            }
        }

        Console.WriteLine($"[SessionMuteManager] MuteAllExcept: {_saved.Count} sessões mutadas (targetPids=[{string.Join(",", targetPids)}])");
    }

    /// <summary>Restore all previously muted sessions to their original state.</summary>
    public void Restore()
    {
        var restored = 0;
        var failed = 0;

        foreach (var state in _saved)
        {
            try
            {
                state.Volume.Mute = state.PreviousMute;
                restored++;
            }
            catch (Exception ex)
            {
                failed++;
                Console.WriteLine($"[SessionMuteManager] Falha ao restaurar mute: {ex.GetType().Name}: {ex.Message}");
            }
        }

        Console.WriteLine($"[SessionMuteManager] Restore: {restored} restaurados, {failed} falhas");
        _saved.Clear();
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            Console.WriteLine("[SessionMuteManager] Dispose() — restaurando sessões...");
            Restore();
            _device.Dispose();
            _disposed = true;
            Console.WriteLine("[SessionMuteManager] Dispose() OK");
        }
    }

    private sealed record SavedState
    {
        public required SimpleAudioVolume Volume { get; set; }
        public bool PreviousMute { get; set; }
    }
}
