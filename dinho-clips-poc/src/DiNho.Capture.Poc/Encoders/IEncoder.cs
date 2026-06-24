using Vortice.Direct3D11;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

public interface IEncoder : IDisposable
{
    void Initialize(int width, int height, int frameRate, int bitrateKbps = 2000);
    void SetD3DManager(IMFDXGIDeviceManager? manager);
    void SetCropRect(int x, int y, int w, int h);
    EncodedPacket? EncodeFrame(ID3D11Texture2D texture, TimeSpan pts);
    void Flush();
}
