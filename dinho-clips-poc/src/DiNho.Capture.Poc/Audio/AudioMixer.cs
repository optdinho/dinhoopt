using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Sync;

namespace DiNho.Capture.Poc.Audio;

public enum AudioStreamKind { Game, Mic, Mixed }

public sealed class AudioMixer : IDisposable
{
    private readonly IAudioSource _loopbackSource;
    private readonly IAudioSource _micSource;
    private readonly MasterClock _clock;
    private readonly Queue<(AudioBuffer Buffer, TimeSpan Timestamp)> _loopbackQueue = new();
    private readonly Queue<(AudioBuffer Buffer, TimeSpan Timestamp)> _micQueue = new();
    private readonly object _lock = new();
    private bool _micEnabled;
    private int _sampleRate;
    private int _channels;
    private float _gameGain = 1.0f;
    private float _micGain = 1.0f;

    /// <summary>
    /// Game audio volume multiplier (0.0 – 2.0). Default 1.0.
    /// </summary>
    public float GameGain { get => _gameGain; set => _gameGain = Math.Clamp(value, 0f, 2f); }

    /// <summary>
    /// Microphone volume multiplier aplicado sobre o boost fixo de 2x (0.0 – 2.0). Default 1.0.
    /// Ex: 0.5 → 1x, 1.0 → 2x, 2.0 → 4x.
    /// </summary>
    public float MicGain { get => _micGain; set => _micGain = Math.Clamp(value, 0f, 4f); }

    public event Action<EncodedPacket>? OnMixedAudio;
    public event Action<float>? OnMicLevel;

    public bool MicEnabled
    {
        get => _micEnabled;
        set
        {
            if (value && !_micEnabled)
            {
                lock (_lock)
                    _micQueue.Clear();
                Console.WriteLine($"[AudioMixer] Mic ativado, fila limpa");
            }
            _micEnabled = value;
        }
    }
    public int SampleRate => _sampleRate;
    public int Channels => _channels;

    public AudioMixer(IAudioSource loopbackSource, IAudioSource micSource, MasterClock clock)
    {
        _loopbackSource = loopbackSource;
        _micSource = micSource;
        _clock = clock;

        _loopbackSource.OnAudioData += OnLoopbackData;
        _micSource.OnAudioData += OnMicData;
    }

    public void Start()
    {
        _loopbackSource.Start();
        _micSource.Start();
        _sampleRate = _loopbackSource.SampleRate;
        _channels = _loopbackSource.Channels;
        Console.WriteLine($"[AudioMixer] Started: SR={_sampleRate} Ch={_channels} loopback={_loopbackSource.GetType().Name} mic={_micSource.GetType().Name}");
    }

    public void Stop()
    {
        _loopbackSource.Stop();
        _micSource.Stop();

        lock (_lock)
        {
            _loopbackQueue.Clear();
            _micQueue.Clear();
        }
    }

    private void OnLoopbackData(AudioBuffer buf)
    {
        lock (_lock)
        {
            _loopbackQueue.Enqueue((buf, _clock.Now));
        }
        TryMix();
    }

    private void OnMicData(AudioBuffer buf)
    {
        lock (_lock)
        {
            _micQueue.Enqueue((buf, _clock.Now));
        }
        TryMix();

        float peak = 0f;
        for (int i = 0; i < buf.Samples.Length; i++)
        {
            var abs = Math.Abs(buf.Samples[i]);
            if (abs > peak) peak = abs;
        }
        OnMicLevel?.Invoke(peak);
    }

    private void TryMix()
    {
        (AudioBuffer Buffer, TimeSpan Timestamp) loopbackItem;
        float[]? micSamples = null;

        lock (_lock)
        {
            if (_loopbackQueue.Count == 0) return;
            loopbackItem = _loopbackQueue.Dequeue();

            if (_micEnabled && _micQueue.Count > 0)
            {
                var combined = new List<float>(loopbackItem.Buffer.Samples.Length);
                while (_micQueue.Count > 0)
                    combined.AddRange(_micQueue.Dequeue().Buffer.Samples);
                micSamples = [.. combined];
            }
        }

        if (micSamples != null)
        {
            var mixed = Mix(loopbackItem.Buffer.Samples, loopbackItem.Buffer.Channels, micSamples, _gameGain, _micGain);
            Console.WriteLine($"[AudioMixer] Mic mixed: loopbackLen={loopbackItem.Buffer.Samples.Length} micLen={micSamples.Length}");
            EmitPacket(mixed, loopbackItem.Timestamp, AudioStreamKind.Mixed);
        }
        else
        {
            if (_micEnabled)
                Console.WriteLine($"[AudioMixer] Mic enabled but queue empty (loopback={_loopbackQueue.Count} mic={_micQueue.Count})");
            EmitPacket(loopbackItem.Buffer.Samples, loopbackItem.Timestamp, AudioStreamKind.Game);
        }
    }

    internal static float[] Mix(
        float[] loopbackSamples, int loopbackChannels,
        float[] micSamples,
        float gameGain = 1.0f, float micGain = 1.0f)
    {
        var result = new float[loopbackSamples.Length];
        int micFrames = micSamples.Length;
        int loopbackFrames = loopbackSamples.Length / loopbackChannels;

        for (int i = 0; i < loopbackSamples.Length; i++)
        {
            int frame = i / loopbackChannels;
            int micIdx = frame < micFrames ? frame : micFrames - 1;
            float micVal = micIdx >= 0 ? micSamples[micIdx] * 4f * micGain : 0f;
            float sample = loopbackSamples[i] * gameGain + micVal;
            result[i] = SoftClip(sample);
        }

        return result;
    }

    internal static float SoftClip(float x)
    {
        float abs = Math.Abs(x);
        if (abs <= 0.333f) return x;
        if (abs < 1f) return Math.Sign(x) * (3f - (2f - 3f * abs) * (2f - 3f * abs)) / 3f;
        return Math.Sign(x);
    }

    private int _emittedPackets;
    private void EmitPacket(float[] samples, TimeSpan pts, AudioStreamKind kind)
    {
        _emittedPackets++;
        var byteLen = samples.Length * 4;
        var bytes = new byte[byteLen];
        System.Buffer.BlockCopy(samples, 0, bytes, 0, byteLen);
        var duration = TimeSpan.FromSeconds((double)samples.Length / (_sampleRate * _channels));
        var packet = new EncodedPacket(bytes, MediaType.Audio, pts, duration, false);

        if (_emittedPackets <= 3 || _emittedPackets % 200 == 0)
            Console.WriteLine($"[AudioMixer] EmitPacket #{_emittedPackets} kind={kind} samples={samples.Length} dur={duration.TotalSeconds:F4}s");

        OnMixedAudio?.Invoke(packet);
    }

    public (List<EncodedPacket> game, List<EncodedPacket> mic) GetPendingAudio()
    {
        return (new List<EncodedPacket>(), new List<EncodedPacket>());
    }

    public void Dispose()
    {
    }
}
