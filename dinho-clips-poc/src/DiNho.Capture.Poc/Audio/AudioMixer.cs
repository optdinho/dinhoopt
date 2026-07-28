using System.Buffers;
using System.Diagnostics;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Sync;

namespace DiNho.Capture.Poc.Audio;

public enum AudioStreamKind { Game, Mic, Mixed }

/// <summary>
/// Mistura áudio de jogo (loopback) com microfone opcional com noise suppression.
/// Emite pacotes PCM float32 via OnMixedAudio para o encoder AAC.
///
/// Fluxo:
///   [CppLoopbackSource | WasapiLoopbackSource] → OnLoopbackData → _loopbackQueue
///   [WasapiMicSource] → OnMicData → RnnoiseFilter (opcional) → _micQueue
///   TryMix: drena _loopbackQueue, mistura com mic proporcional, emite EncodedPacket
/// </summary>
public sealed class AudioMixer : IDisposable
{
    // Fontes
    private readonly IAudioSource _loopbackSource;
    private readonly IAudioSource _micSource;
    private readonly MasterClock _clock;

    // Filas internas — protegidas por _lock
    private readonly Queue<(AudioBuffer Buffer, TimeSpan Pts)> _loopbackQueue = new();
    private readonly Queue<(float[] Samples, int Offset, int Length, TimeSpan Pts)> _micQueue = new();
    private readonly object _lock = new();

    // Configuração (thread-safe via propriedades)
    private volatile bool _micEnabled;
    private int _sampleRate = 48000;
    private int _channels = 2;
    private RnnoiseFilter? _noiseFilter;
    private MaxineAfxFilter? _maxineFilter;
    private float _gameGain = 1.0f;
    private float _micGain = 1.0f;

    // Log throttle — separados por contexto
    private long _lastEmitLogTick;
    private long _lastSyncLogTick;
    private int _emittedPackets;
    private static readonly long LogThrottleTicks = Stopwatch.Frequency / 2; // 500ms

    // Capacidades das filas
    private const int MaxLoopbackQueue = 512;  // ~5s a 48kHz/960frames
    private const int MaxMicQueue = 256;        // ~2.5s

    // Propriedades públicas
    public float GameGain
    {
        get => _gameGain;
        set => _gameGain = Math.Clamp(value, 0f, 4f);
    }
    public float MicGain
    {
        get => _micGain;
        set => _micGain = Math.Clamp(value, 0f, 4f);
    }
    public bool MicEnabled
    {
        get => _micEnabled;
        set
        {
            if (_micEnabled == value) return;
            _micEnabled = value;
            lock (_lock)
            {
                _micQueue.Clear();
                if (!value) _loopbackQueue.Clear(); // descarta acúmulo ao desativar
            }
            Log.I("AudioMixer", $"Mic {(value ? "ativado" : "desativado")}");
        }
    }
    public bool NoiseSuppressionEnabled
    {
        get => _noiseFilter?.Active == true || _maxineFilter?.Active == true;
        set
        {
            if (value == (_noiseFilter?.Active == true || _maxineFilter?.Active == true)) return;
            
            // Dispose existing filters
            _noiseFilter?.Dispose();
            _maxineFilter?.Dispose();
            _noiseFilter = null;
            _maxineFilter = null;
            
            if (value)
            {
                // Try Maxine AFX first (RTX GPU), fallback to RNNoise
                var maxineFilter = new MaxineAfxFilter(_sampleRate, _channels);
                if (maxineFilter.IsMaxineAvailable)
                {
                    _maxineFilter = maxineFilter;
                    Log.I("AudioMixer", $"NoiseSuppression ON (Maxine AFX)");
                }
                else
                {
                    // Maxine not available, dispose and use RNNoise
                    maxineFilter.Dispose();
                    _noiseFilter = new RnnoiseFilter(_sampleRate, _channels);
                    Log.I("AudioMixer", $"NoiseSuppression ON (RNNoise fallback)");
                }
            }
            else
            {
                Log.I("AudioMixer", $"NoiseSuppression OFF");
            }
        }
    }
    public int SampleRate => _sampleRate;
    public int Channels => _channels;

    // Eventos
    public event Action<EncodedPacket>? OnMixedAudio;
    public event Action<float>? OnMicLevel;

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
        Log.I("AudioMixer",
            $"Iniciado: SR={_sampleRate} Ch={_channels} " +
            $"loopback={_loopbackSource.GetType().Name} " +
            $"mic={_micSource.GetType().Name}");
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
        // Use Stopwatch-based capture timestamp for A/V sync — same clock as video
        var pts = _clock.FromTimestamp(buf.CaptureTicks);

        lock (_lock)
        {
            if (_loopbackQueue.Count >= MaxLoopbackQueue)
                _loopbackQueue.Dequeue(); // descarta o mais antigo
            _loopbackQueue.Enqueue((buf, pts));
        }
        TryMix();
    }

    private void OnMicData(AudioBuffer buf)
    {
        // Nível do mic — sempre, independente de estar habilitado (para VU meter no UI)
        float peak = 0f;
        foreach (var s in buf.Samples)
        {
            var abs = MathF.Abs(s);
            if (abs > peak) peak = abs;
        }
        OnMicLevel?.Invoke(peak);

        if (!_micEnabled) return;

        // Aplica noise suppression se ativo (Maxine AFX ou RNNoise)
        float[] samples;
        if (_maxineFilter?.Active == true)
            samples = _maxineFilter.Process(buf.Samples);
        else if (_noiseFilter?.Active == true)
            samples = _noiseFilter.Process(buf.Samples);
        else
            samples = buf.Samples;

        var pts = _clock.FromTimestamp(buf.CaptureTicks);

        lock (_lock)
        {
            if (_micQueue.Count >= MaxMicQueue)
                _micQueue.Dequeue();
            _micQueue.Enqueue((samples, 0, samples.Length, pts));
        }
        TryMix();
    }

    private void TryMix()
    {
        (AudioBuffer Buffer, TimeSpan Pts) loopback;
        float[]? micOut = null;

        lock (_lock)
        {
            if (_loopbackQueue.Count == 0) return;
            loopback = _loopbackQueue.Dequeue();

            if (_micEnabled)
            {
                int needed = loopback.Buffer.Samples.Length;
                micOut = ArrayPool<float>.Shared.Rent(needed);
                int filled = 0;

                while (filled < needed && _micQueue.Count > 0)
                {
                    var (samples, offset, length, pts) = _micQueue.Peek();
                    int take = Math.Min(length - offset, needed - filled);

                    // Upmix mono mic para stereo loopback se necessário
                    if (_channels == 2 && loopback.Buffer.Channels == 2)
                    {
                        for (int i = 0; i < take; i++)
                        {
                            if (filled + 1 >= needed) break;
                            float s = samples[offset + i];
                            micOut[filled++] = s;
                            micOut[filled++] = s;
                        }
                    }
                    else
                    {
                        Array.Copy(samples, offset, micOut, filled, take);
                        filled += take;
                    }

                    int newOffset = offset + take;
                    _micQueue.Dequeue();
                    if (newOffset < length)
                    {
                        // Reinsere o restante sem alocar novo array
                        _micQueue.Enqueue((samples, newOffset, length, pts));
                    }
                }

                // Silêncio para o restante se mic não tiver amostras suficientes
                if (filled < needed)
                    Array.Clear(micOut, filled, needed - filled);

                // Log de drift A/V do mic (throttled)
                var now = Stopwatch.GetTimestamp();
                if (now - _lastSyncLogTick >= LogThrottleTicks)
                {
                    _lastSyncLogTick = now;
                    if (_micQueue.Count > 0)
                    {
                        var (_, _, _, micPts) = _micQueue.Peek();
                        var drift = (micPts - loopback.Pts).TotalMilliseconds;
                        Log.D("AudioMixer",
                            $"MicDrift={drift:+0.0;-0.0}ms loopbackQ={_loopbackQueue.Count} micQ={_micQueue.Count}");
                    }
                }
            }
        }

        float[] outSamples;
        bool pooled = false;
        if (micOut != null)
        {
            try
            {
                outSamples = MixSamples(loopback.Buffer.Samples, micOut,
                    loopback.Buffer.Samples.Length, _gameGain, _micGain);
                pooled = true;
            }
            finally
            {
                ArrayPool<float>.Shared.Return(micOut);
            }
        }
        else
        {
            // Só jogo — aplicar gain sem alocar novo array quando gain == 1.0
            if (_gameGain == 1.0f)
            {
                outSamples = loopback.Buffer.Samples;
            }
            else
            {
                outSamples = ApplyGain(loopback.Buffer.Samples, _gameGain);
                pooled = true;
            }
        }

        EmitPacket(outSamples, loopback.Pts,
            micOut != null ? AudioStreamKind.Mixed : AudioStreamKind.Game, pooled);
    }

    /// <summary>
    /// Mistura loopback + mic com ganhos independentes.
    /// Usa SoftClip (x / (1 + |x|)) — função C¹ contínua sem aliasing.
    /// HardClip (Math.Clamp) introduz harmônicos ímpares que o AAC encoder
    /// não remove e soa agressivo em repetições.
    /// </summary>
    /// <summary>
    /// Wrapper preservado para compatibilidade com testes existentes.
    /// Converte mic per-frame para upmix stereo e delega a MixSamples.
    /// </summary>
    internal static float[] Mix(float[] loopbackSamples, int loopbackChannels,
                                 float[] micSamples, float gameGain = 1.0f, float micGain = 1.0f)
    {
        int frames = loopbackSamples.Length / loopbackChannels;
        var upmixed = new float[loopbackSamples.Length];
        for (int i = 0; i < upmixed.Length; i++)
        {
            int frame = i / loopbackChannels;
            upmixed[i] = frame < micSamples.Length ? micSamples[frame] : 0f;
        }
        var pooled = MixSamples(loopbackSamples, upmixed, loopbackSamples.Length, gameGain, micGain);
        var result = new float[loopbackSamples.Length];
        Array.Copy(pooled, result, loopbackSamples.Length);
        ArrayPool<float>.Shared.Return(pooled);
        return result;
    }

    internal static float[] MixSamples(float[] game, float[] mic, int length,
                                        float gameGain, float micGain)
    {
        var result = ArrayPool<float>.Shared.Rent(length);
        for (int i = 0; i < length; i++)
        {
            float g = i < game.Length ? game[i] : 0f;
            float m = i < mic.Length ? mic[i] : 0f;
            float mixed = g * gameGain + m * micGain;
            result[i] = float.IsNaN(mixed) ? 0f : SoftClip(mixed);
        }
        return result;
    }

    private static float[] ApplyGain(float[] samples, float gain)
    {
        var result = ArrayPool<float>.Shared.Rent(samples.Length);
        for (int i = 0; i < samples.Length; i++)
            result[i] = SoftClip(samples[i] * gain);
        return result;
    }

    internal static float SoftClip(float x)
    {
        return x / (1f + Math.Abs(x));
    }

    private void EmitPacket(float[] samples, TimeSpan pts, AudioStreamKind kind, bool isPooled = false)
    {
        _emittedPackets++;
        var duration = TimeSpan.FromSeconds((double)samples.Length / (_sampleRate * _channels));
        var packet = new EncodedPacket(samples, MediaType.Audio, pts, duration, isPooled: isPooled);

        var now = Stopwatch.GetTimestamp();
        if (_emittedPackets <= 5 || now - _lastEmitLogTick >= LogThrottleTicks)
        {
            _lastEmitLogTick = now;
            Log.D("AudioMixer",
                $"EmitPacket #{_emittedPackets} kind={kind} " +
                $"samples={samples.Length} dur={duration.TotalSeconds:F4}s " +
                $"pts={pts.TotalSeconds:F3}s");
        }

        OnMixedAudio?.Invoke(packet);
    }

    public void Dispose()
    {
        Stop();
        _loopbackSource.OnAudioData -= OnLoopbackData;
        _micSource.OnAudioData -= OnMicData;
        (_loopbackSource as IDisposable)?.Dispose();
        (_micSource as IDisposable)?.Dispose();
        _noiseFilter?.Dispose();
        _noiseFilter = null;
        _maxineFilter?.Dispose();
        _maxineFilter = null;
    }
}
