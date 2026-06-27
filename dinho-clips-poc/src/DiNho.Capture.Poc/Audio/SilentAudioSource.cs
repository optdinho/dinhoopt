using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Audio;

public sealed class SilentAudioSource : IAudioSource
{
    public int SampleRate => 48000;
    public int Channels => 2;

    public event Action<AudioBuffer>? OnAudioData;

    public void Start()
    {
        Log.I("SilentAudioSource", "Iniciado — sem áudio do sistema (loopback desligado)");
    }

    public void Stop()
    {
        Log.I("SilentAudioSource", "Parado");
    }

    public void Dispose() { }
}
