namespace DiNho.Capture.Poc.Audio;

public sealed class AudioBuffer
{
    public float[] Samples { get; }
    public int SampleRate { get; }
    public int Channels { get; }

    public AudioBuffer(float[] samples, int sampleRate, int channels)
    {
        Samples = samples;
        SampleRate = sampleRate;
        Channels = channels;
    }
}

public interface IAudioSource : IDisposable
{
    int SampleRate { get; }
    int Channels { get; }
    event Action<AudioBuffer> OnAudioData;
    void Start();
    void Stop();
}
