using System.Diagnostics;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
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
    private RnnoiseFilter? _noiseFilter;
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
            if (value == _micEnabled) return;
            _micEnabled = value;
            lock (_lock)
            {
                _micQueue.Clear();
                _loopbackQueue.Clear();
            }
            Log.I("AudioMixer", $"Mic {(value ? "ativado" : "desativado")}, filas limpas");
        }
    }
    public bool NoiseSuppressionEnabled
    {
        get => _noiseFilter?.Active == true;
        set
        {
            if (value == (_noiseFilter?.Active == true)) return;
            if (value)
            {
                _noiseFilter?.Dispose();
                _noiseFilter = new RnnoiseFilter(_sampleRate > 0 ? _sampleRate : 48000, _channels > 0 ? _channels : 2);
                Log.I("AudioMixer", "NoiseSuppression ON");
            }
            else
            {
                _noiseFilter?.Dispose();
                _noiseFilter = null;
                Log.I("AudioMixer", "NoiseSuppression OFF");
            }
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
        Log.I("AudioMixer", $"Started: SR={_sampleRate} Ch={_channels} loopback={_loopbackSource.GetType().Name} mic={_micSource.GetType().Name}");
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

    private const int MaxLoopbackQueue = 1024;
    private const int MaxMicQueue = 256;

    private void OnLoopbackData(AudioBuffer buf)
    {
        lock (_lock)
        {
            if (_loopbackQueue.Count >= MaxLoopbackQueue)
                _loopbackQueue.Dequeue();
            _loopbackQueue.Enqueue((buf, _clock.Now));
        }
        TryMix();
    }

    private void OnMicData(AudioBuffer buf)
    {
        if (!_micEnabled) return;

        AudioBuffer filtered = buf;
        if (_noiseFilter?.Active == true)
        {
            var denoised = _noiseFilter.Process(buf.Samples);
            filtered = new AudioBuffer(denoised, buf.SampleRate, buf.Channels);
        }

        lock (_lock)
        {
            if (_micQueue.Count >= MaxMicQueue)
                _micQueue.Dequeue();
            _micQueue.Enqueue((filtered, _clock.Now));
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
                TimeSpan? firstMicTs = null;
                TimeSpan? lastMicTs = null;
                int micPackets = 0;
                while (_micQueue.Count > 0)
                {
                    var (buf, ts) = _micQueue.Dequeue();
                    firstMicTs ??= ts;
                    lastMicTs = ts;
                    micPackets++;
                    combined.AddRange(buf.Samples);
                }
                micSamples = [.. combined];
                var drift = lastMicTs.Value - loopbackItem.Timestamp;
                var n = Stopwatch.GetTimestamp();
                if (n - _lastLogTicks >= LogThrottleTicks)
                {
                    _lastLogTicks = n;
                    Log.D("Sync", $"loopbackTs={loopbackItem.Timestamp.TotalSeconds:F3} firstMicTs={firstMicTs.Value.TotalSeconds:F3} lastMicTs={lastMicTs.Value.TotalSeconds:F3} driftMs={drift.TotalMilliseconds:F1} micPackets={micPackets}");
                }
            }
        }

        if (micSamples != null)
        {
            var mixed = Mix(loopbackItem.Buffer.Samples, loopbackItem.Buffer.Channels, micSamples, _gameGain, _micGain);
            var n = Stopwatch.GetTimestamp();
            if (n - _lastLogTicks >= LogThrottleTicks)
            {
                _lastLogTicks = n;
                Log.D("AudioMixer", $"Mic mixed: loopbackLen={loopbackItem.Buffer.Samples.Length} micLen={micSamples.Length}");
            }
            EmitPacket(mixed, loopbackItem.Timestamp, AudioStreamKind.Mixed);
        }
        else
        {
            if (_micEnabled)
                Log.W("AudioMixer", $"Mic enabled but queue empty (loopback={_loopbackQueue.Count} mic={_micQueue.Count})");
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
    private long _lastLogTicks;
    private const long LogThrottleTicks = 5_000_000; // 500ms
    private void EmitPacket(float[] samples, TimeSpan pts, AudioStreamKind kind, bool isPooled = false)
    {
        _emittedPackets++;
        var duration = TimeSpan.FromSeconds((double)samples.Length / (_sampleRate * _channels));
        var packet = new EncodedPacket(samples, MediaType.Audio, pts, duration, isPooled);

        var now = Stopwatch.GetTimestamp();
        if (_emittedPackets <= 3 || now - _lastLogTicks >= LogThrottleTicks)
        {
            _lastLogTicks = now;
            Log.D("AudioMixer", $"EmitPacket #{_emittedPackets} kind={kind} samples={samples.Length} dur={duration.TotalSeconds:F4}s isPooled={isPooled}");
        }

        OnMixedAudio?.Invoke(packet);
    }

    public (List<EncodedPacket> game, List<EncodedPacket> mic) GetPendingAudio()
    {
        return (new List<EncodedPacket>(), new List<EncodedPacket>());
    }

    public void Dispose()
    {
        Stop();
        _loopbackSource.OnAudioData -= OnLoopbackData;
        _micSource.OnAudioData -= OnMicData;
        if (_loopbackSource is IDisposable loopbackDisposable)
            loopbackDisposable.Dispose();
        if (_micSource is IDisposable micDisposable)
            micDisposable.Dispose();
        _noiseFilter?.Dispose();
        _noiseFilter = null;
    }
}
