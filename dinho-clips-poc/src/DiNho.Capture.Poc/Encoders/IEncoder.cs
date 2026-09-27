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

    /// <summary>
    /// Codec de ffmpeg em uso ("h264_nvenc", "hevc_amf", "libx264"...), ou null antes do
    /// Initialize. O editor de clipes lê isto pelo status do engine para re-encodar com a
    /// mesma família de encoder em vez de fixar libx264.
    /// </summary>
    string? Codec { get; }
}
