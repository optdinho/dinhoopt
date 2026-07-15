using Vortice.Direct3D11;

namespace DiNho.Capture.Poc.Capture;

public sealed class CapturedFrame : IDisposable
{
    public long CaptureStartTicks { get; }
    public long CaptureEndTicks { get; }
    public long WaitEndTicks { get; }
    public long CopyEndTicks { get; }
    public int Width { get; }
    public int Height { get; }
    public bool Success { get; }
    public ID3D11Texture2D? Texture { get; }
    public ID3D11Device? Device { get; }
    public bool OwnsTexture { get; }

    public CapturedFrame(long startTicks, long endTicks, int width, int height, bool success,
        ID3D11Texture2D? texture = null, ID3D11Device? device = null,
        long waitEndTicks = 0, long copyEndTicks = 0, bool ownsTexture = true)
    {
        CaptureStartTicks = startTicks;
        CaptureEndTicks = endTicks;
        WaitEndTicks = waitEndTicks;
        CopyEndTicks = copyEndTicks;
        Width = width;
        Height = height;
        Success = success;
        Texture = texture;
        Device = device;
        OwnsTexture = ownsTexture;
    }

    public void Dispose()
    {
        if (OwnsTexture) Texture?.Dispose();
    }
}

public interface ICaptureSource : IDisposable
{
    string Name { get; }
    int Width { get; }
    int Height { get; }
    void Initialize(ID3D11Device? sharedDevice = null);
    CapturedFrame TryCaptureFrame(int timeoutMs);
    ID3D11Device? Device { get; }
    bool CheckDeviceLost() => false;
}