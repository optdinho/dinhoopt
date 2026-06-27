using DiNho.Capture.Poc.Logging;
using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace DiNho.Capture.Poc.Audio;

public sealed class WasapiLoopbackSource : IAudioSource
{
    private WasapiLoopbackCapture? _capture;
    private readonly MMDevice _device;
    private bool _running;
    private readonly int _sampleRate;

    public int SampleRate => _sampleRate;
    public int Channels { get; private set; }

    public event Action<AudioBuffer>? OnAudioData;

    public WasapiLoopbackSource(int sampleRate = 48000)
    {
        _sampleRate = sampleRate;
        using var enumerator = new MMDeviceEnumerator();
        _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
    }

    public void Start()
    {
        if (_running) return;
        _running = true;

        _capture = new WasapiLoopbackCapture(_device);
        _capture.WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(_sampleRate, 2);
        Log.I("WasapiLoopbackSource", $"Format set: {_capture.WaveFormat.Encoding} SR={_capture.WaveFormat.SampleRate} Ch={_capture.WaveFormat.Channels} Bps={_capture.WaveFormat.BitsPerSample}");
        Channels = 2;

        _capture.DataAvailable += OnDataAvailable;
        _capture.RecordingStopped += (s, e) =>
        {
            Log.I("WasapiLoopbackSource", "RecordingStopped");
            _running = false;
        };

        _capture.StartRecording();
        Log.I("WasapiLoopbackSource", "StartRecording() OK");
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (OnAudioData == null) return;

        var samples = new float[e.BytesRecorded / 4];
        System.Buffer.BlockCopy(e.Buffer, 0, samples, 0, e.BytesRecorded);
        OnAudioData(new AudioBuffer(samples, SampleRate, Channels));
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
        _capture?.StopRecording();
    }

    public void Dispose()
    {
        Stop();
        _capture?.Dispose();
        _device?.Dispose();
    }
}
