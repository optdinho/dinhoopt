using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace DiNho.Capture.Poc.Audio;

public sealed class WasapiLoopbackSource : IAudioSource
{
    private WasapiLoopbackCapture? _capture;
    private readonly MMDevice _device;
    private bool _running;

    public int SampleRate { get; private set; }
    public int Channels { get; private set; }

    public event Action<AudioBuffer>? OnAudioData;

    public WasapiLoopbackSource()
    {
        using var enumerator = new MMDeviceEnumerator();
        _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
    }

    public void Start()
    {
        if (_running) return;
        _running = true;

        _capture = new WasapiLoopbackCapture(_device);
        _capture.WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
        Console.WriteLine($"[WasapiLoopbackSource] Format set: {_capture.WaveFormat.Encoding} SR={_capture.WaveFormat.SampleRate} Ch={_capture.WaveFormat.Channels} Bps={_capture.WaveFormat.BitsPerSample}");
        SampleRate = 48000;
        Channels = 2;

        _capture.DataAvailable += OnDataAvailable;
        _capture.RecordingStopped += (s, e) =>
        {
            Console.WriteLine("[WasapiLoopbackSource] RecordingStopped");
            _running = false;
        };

        _capture.StartRecording();
        Console.WriteLine("[WasapiLoopbackSource] StartRecording() OK");
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
