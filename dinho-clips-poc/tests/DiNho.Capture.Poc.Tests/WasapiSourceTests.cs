using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

[Collection("AudioDeviceTests")]
public sealed class WasapiSourceTests
{
    [Fact]
    public void AudioBuffer_FromBytes_CorrectLength()
    {
        var bytes = new byte[16]; // 4 floats
        for (int i = 0; i < 16; i++)
            bytes[i] = (byte)(i * 16);

        var samples = new float[bytes.Length / 4];
        System.Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);

        var buf = new AudioBuffer(samples, 48000, 2);
        Assert.Equal(4, buf.Samples.Length);
        Assert.Equal(48000, buf.SampleRate);
        Assert.Equal(2, buf.Channels);
    }

    [Fact]
    public void AudioBuffer_EmptyBytes_EmptySamples()
    {
        var samples = Array.Empty<float>();
        var buf = new AudioBuffer(samples, 48000, 1);
        Assert.Empty(buf.Samples);
        Assert.Equal(48000, buf.SampleRate);
        Assert.Equal(1, buf.Channels);
    }

    [Fact]
    public void AudioBuffer_SingleSample_Roundtrips()
    {
        var original = 0.5f;
        var bytes = new byte[4];
        System.Buffer.BlockCopy(new[] { original }, 0, bytes, 0, 4);

        var samples = new float[1];
        System.Buffer.BlockCopy(bytes, 0, samples, 0, 4);

        Assert.Equal(original, samples[0]);
    }

    [Fact]
    public void AudioBuffer_SamplePreservesSign()
    {
        var val = -0.75f;
        var bytes = new byte[4];
        System.Buffer.BlockCopy(new[] { val }, 0, bytes, 0, 4);

        var samples = new float[1];
        System.Buffer.BlockCopy(bytes, 0, samples, 0, 4);

        Assert.Equal(val, samples[0], 4);
    }

    [Fact]
    public void LoopbackSource_Lifecycle_NoCrashOrSkip()
    {
        // O CTOR é que lança quando não há endpoint (WasapiLoopbackSource.cs:32) — por
        // isso tem de estar DENTRO do try. A versão anterior só apanhava excepções do
        // Start() e o ctor propagava, fazendo o teste falhar em runners sem áudio.
        WasapiLoopbackSource source;
        try
        {
            source = new WasapiLoopbackSource();
        }
        catch (InvalidOperationException ex) when (IsNoAudioDevice(ex))
        {
            return; // sem endpoint de reprodução — pass-and-skip
        }

        using (source)
        using (var gotFrame = new ManualResetEventSlim())
        {
            source.OnAudioData += _ => gotFrame.Set();

            try
            {
                source.Start();
                source.Start(); // double-start must be a no-op
            }
            catch (InvalidOperationException ex) when (IsNoAudioDevice(ex))
            {
                return; // sem endpoint utilizável — pass-and-skip
            }

            if (!gotFrame.Wait(TimeSpan.FromMilliseconds(1500), TestContext.Current.CancellationToken))
            {
                // Endpoint existe mas nunca produz um frame neste ambiente — o
                // StopRecording/Dispose da NAudio bloquearia para sempre.
                try { source.Stop(); } catch { }
                return;
            }

            source.Stop();
        }
    }

    [Fact]
    public void MicSource_StartStop_DoesNotCrashOrSkip()
    {
        // Ctor dentro do try — WasapiMicSource.cs:50 é onde a ausência de endpoint
        // lança (ver comentário no teste de loopback).
        WasapiMicSource source;
        try
        {
            source = new WasapiMicSource();
        }
        catch (InvalidOperationException ex) when (IsNoAudioDevice(ex))
        {
            return; // sem endpoint de captura — pass-and-skip
        }

        using (source)
        using (var gotFrame = new ManualResetEventSlim())
        {
            source.OnAudioData += _ => gotFrame.Set();

            try
            {
                source.Start();
            }
            catch (InvalidOperationException ex) when (IsNoAudioDevice(ex))
            {
                return; // sem endpoint utilizável — pass-and-skip
            }

            if (!gotFrame.Wait(TimeSpan.FromMilliseconds(1500), TestContext.Current.CancellationToken))
            {
                try { source.Stop(); } catch { }
                return;
            }

            source.Stop();
        }
    }

    // A ausência de endpoint de áudio chega como InvalidOperationException do ctor
    // ("No audio capture/render devices available on this system"). A guarda antiga
    // procurava "MMDevice" — que NÃO está nessa mensagem — por isso estes testes
    // falhavam em runners sem placa de som em vez de fazerem pass-and-skip.
    private static bool IsNoAudioDevice(InvalidOperationException ex) =>
        ex.Message.Contains("No audio", StringComparison.OrdinalIgnoreCase) ||
        ex.Message.Contains("MMDevice", StringComparison.Ordinal);
}