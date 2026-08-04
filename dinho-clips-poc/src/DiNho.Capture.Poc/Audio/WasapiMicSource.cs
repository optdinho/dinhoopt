using NAudio.Wave;
using NAudio.CoreAudioApi;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Audio;

public sealed class WasapiMicSource : IAudioSource
{
    private WasapiCapture? _capture;
    private readonly MMDevice _device;
    private bool _running;
    private readonly int _sampleRate;

    public int SampleRate => _sampleRate;
    public int Channels { get; private set; } = 1;
    public string DeviceId { get; }

    public event Action<AudioBuffer>? OnAudioData;

    public WasapiMicSource(int sampleRate = 48000, string? deviceId = null)
    {
        _sampleRate = sampleRate;
        using var enumerator = new MMDeviceEnumerator();
        if (!string.IsNullOrEmpty(deviceId))
        {
            try
            {
                _device = enumerator.GetDevice(deviceId);
                DeviceId = deviceId;
            }
            catch (System.Runtime.InteropServices.COMException ex)
            {
                Log.W("WasapiMicSource", $"Microfone '{deviceId}' não encontrado (0x{ex.ErrorCode:X8}) — usando default");
                _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
                DeviceId = "";
            }
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
        _capture = new WasapiCapture(_device, true);
        _capture.WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(_sampleRate, 1);
        _capture.DataAvailable += OnDataAvailable;
        _capture.RecordingStopped += (s, e) => _running = false;
        try
        {
            _capture.StartRecording();
        }
        catch
        {
            _capture.Dispose();
            _capture = null;
            throw;
        }
        _running = true;
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
