using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace DiNho.Capture.Poc.Audio;

public sealed class WasapiMicSource : IAudioSource
{
    private WasapiCapture? _capture;
    private readonly MMDevice _device;
    private bool _running;

    public int SampleRate { get; private set; } = 48000;
    public int Channels { get; private set; } = 1;
    public string DeviceId { get; }

    public event Action<AudioBuffer>? OnAudioData;

    public WasapiMicSource(string? deviceId = null)
    {
        using var enumerator = new MMDeviceEnumerator();
        if (!string.IsNullOrEmpty(deviceId))
        {
            DeviceId = deviceId;
            _device = enumerator.GetDevice(deviceId);
        }
        else
        {
            DeviceId = "";
            _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
        }
    }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _capture = new WasapiCapture(_device, true);
        _capture.WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(48000, 1);
        _capture.DataAvailable += OnDataAvailable;
        _capture.RecordingStopped += (s, e) => _running = false;
        _capture.StartRecording();
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
